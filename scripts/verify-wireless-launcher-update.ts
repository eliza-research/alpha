#!/usr/bin/env node
/** Record an operator-run wireless launcher replacement using read-only ADB commands. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {readReleaseSigner} from './build-android.ts';
import {readHome} from './android-instrumentation.ts';
import {parseOffer, publicObject} from './deliver-app-update.ts';
import {adbFor, admitUnitApk, apkRuntimeIdentity, deviceFacts, PACKAGE, packageFacts, snapshotUnitApk} from './provision-unit.ts';
import {inspectUpdateApk} from './update-apk-admission.ts';
import {APP_UPDATE_TAG, appUpdateManifestUrl, isPublishedUpdateApkUrl} from './update-channel.ts';
import {verifiedBootProblem} from './verify-pixel10a-image.ts';
import {readAutomaticInstallHistory} from './wireless-install-history.ts';
import {releaseRecordProblems} from '../vendor/eliza/packages/os/scripts/android/aosp-ota-update.mjs';

type Adb = ReturnType<typeof adbFor>;
type Distribution = 'sideload' | 'image-preinstalled';
const HEX = /^[a-f0-9]{64}$/;
const GIT_COMMIT = /^[a-f0-9]{40}$/;
const isSha256 = (value: unknown) => typeof value === 'string' && HEX.test(value);
const EMPTY_SHA256 = createHash('sha256').digest('hex');
const SCHEMA = 'alpha-wireless-launcher-readback/v2';
const HOME = 'android.intent.category.HOME';
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

function inspectReadbackApk(apk: ReturnType<typeof admitUnitApk>, descriptor: ReturnType<typeof readReleaseSigner>) {
  const {versionCode} = apk;
  assert.ok(versionCode !== null, 'Release version code is missing');
  const directory = mkdtempSync(path.join(tmpdir(), 'alpha-wireless-apk-'));
  try {
    const snapshot = snapshotUnitApk(apk, directory);
    const {signerRootSha256} = inspectUpdateApk({...snapshot, versionCode}, {descriptor});
    const runtime = apkRuntimeIdentity(snapshot.file);
    assert.ok(runtime.runtime === 'PACKAGED' && runtime.base && GIT_COMMIT.test(runtime.base), 'Release SDK revision is missing');
    return {signerRootSha256, sdkCommit: runtime.base, versionCode};
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
}

interface ImageExpectation {
  releaseRecordSha256: string;
  signedTargetFilesSha256: string;
  fingerprintSha256: string;
  vbmetaDigest: string;
}

function readImageExpectation(file: string, vbmetaDigest: string, apk: ReturnType<typeof admitUnitApk>): ImageExpectation {
  assert.ok(HEX.test(vbmetaDigest), 'Expected the signed image’s chained VBMeta SHA-256');
  const stat = lstatSync(file);
  assert.ok(stat.isFile() && stat.size <= (1 << 20), 'Expected a bounded signed image release record');
  const bytes = readFileSync(file);
  assert.equal(bytes.length, stat.size, 'Image release record changed during capture');
  const record = JSON.parse(bytes.toString('utf8'));
  const channel = JSON.parse(readFileSync(new URL('../android/aosp/pixel10a-ota-channel.json', import.meta.url), 'utf8'));
  const problems = releaseRecordProblems(record, channel);
  assert.ok(problems.length === 0, `Image release record rejected: ${problems.join('; ')}`);
  assert.ok(record.build.androidRelease === '17' && record.build.fingerprint.endsWith(':user/release-keys'),
    'Expected the production Android 17 image fingerprint');
  assert.ok(Array.isArray(record.apks) && record.apks.some((row: {sha256?: string; versionCode?: number; signerSha256?: string; distributable?: boolean}) =>
    row?.distributable === true && row.sha256 === apk.sha256 && row.versionCode === apk.versionCode && row.signerSha256 === apk.signerSha256),
    'Image release record does not admit the baked launcher APK');
  return {
    releaseRecordSha256: sha256(bytes),
    signedTargetFilesSha256: record.artifacts.signedTargetFiles.sha256,
    fingerprintSha256: sha256(record.build.fingerprint),
    vbmetaDigest,
  };
}

function installedState(adb: Adb) {
  const dump = adb(['shell', 'dumpsys', 'package', PACKAGE]).split(/\r?\n/);
  const packages = dump.indexOf('Packages:');
  assert.ok(packages >= 0, 'Android did not report installed packages');
  const active = dump.slice(packages + 1);
  const end = active.findIndex(line => /^\S/.test(line));
  const installed = end < 0 ? active : active.slice(0, end);
  const start = installed.findIndex(line => line.trimStart().startsWith(`Package [${PACKAGE}] (`));
  assert.ok(start >= 0, 'Alpha is missing from the active package list');
  const rows = installed.slice(start + 1);
  const next = rows.findIndex(line => /^  Package \[/.test(line));
  const block = (next < 0 ? rows : rows.slice(0, next)).join('\n');
  const facts = packageFacts(block);
  assert.ok(facts.versionCode !== null && Number.isSafeInteger(facts.versionCode) &&
    facts.versionCode > 0 && facts.userId && /^[1-9]\d*$/.test(facts.userId) && facts.lastUpdateTime,
    'Android package version, app ID or update time is unavailable');
  const user = /^    User 0: ([^\n]+)\n((?:      [^\n]*\n?)*)/m.exec(block);
  const firstInstallTime = user?.[2].match(/^      firstInstallTime=(.+)$/m)?.[1]?.trim();
  assert.ok(user && /\binstalled=true\b/.test(user[1]) && firstInstallTime,
    'Alpha is not installed for user 0 or its first install time is unavailable');
  const flags = /^    pkgFlags=\[([^\n\]]*)\][ \t]*$/m.exec(block)?.[1]?.trim().split(/\s+/);
  assert.ok(flags, 'Android package flags are unavailable');
  const initiator = /^    initiatingPackageName=(\S+)[ \t]*$/m.exec(block)?.[1] ?? null;
  const apkPath = /^package:(\/[A-Za-z0-9_./=+~-]+\.apk)$/.exec(adb(['shell', 'pm', 'path', '--user', '0', PACKAGE]))?.[1];
  assert.ok(apkPath && !apkPath.split('/').some(part => part === '.' || part === '..'), 'Expected one installed base APK');
  const apkLocation = apkPath.startsWith('/data/app/') ? 'data'
    : /^\/(?:system|system_ext|product|vendor|odm)\//.test(apkPath) ? 'image' : null;
  assert.ok(apkLocation, 'Installed APK is outside Android app data and image partitions');
  const sha256 = adb(['shell', 'sha256sum', apkPath], {timeout: 600_000}).split(/\s+/, 1)[0];
  assert.ok(HEX.test(sha256), 'Installed APK digest is unavailable');
  return {
    versionCode: facts.versionCode, appId: facts.userId, firstInstallTime, lastUpdateTime: facts.lastUpdateTime,
    system: flags.includes('SYSTEM'), updatedSystemApp: flags.includes('UPDATED_SYSTEM_APP'),
    initiator: initiator === 'null' ? null : initiator, sha256, apkLocation,
  };
}

export function captureLauncher(adb: Adb, serial: string) {
  assert.equal(adb(['get-state']), 'device', 'Device is unavailable');
  const device = deviceFacts(adb, serial);
  assert.ok(!device.emulator && device.sdk && device.sdk >= 34,
    'Use a physical Android 14 or later device for install initiator readback');
  assert.ok(device.model && device.abi && device.buildFingerprintSha256 !== EMPTY_SHA256,
    'Device model, ABI or build fingerprint is unavailable');
  assert.equal(adb(['shell', 'am', 'get-current-user']), '0', 'Use the primary Android user');
  const verifiedBootState = adb(['shell', 'getprop', 'ro.boot.verifiedbootstate']);
  const flashLocked = adb(['shell', 'getprop', 'ro.boot.flash.locked']);
  const vbmetaDigest = adb(['shell', 'getprop', 'ro.boot.vbmeta.digest']);
  const codename = adb(['shell', 'getprop', 'ro.product.device']);
  const installed = installedState(adb);
  const home = readHome(adb, '0');
  assert.ok(home.holders.length === 1 && home.holders[0] === PACKAGE && home.activity.startsWith(PACKAGE + '/'),
    `Alpha must hold and resolve the ${HOME} role`);
  assert.deepEqual(installedState(adb), installed, 'Package changed during readback');
  assert.deepEqual(readHome(adb, '0'), home, 'HOME selection changed during readback');
  assert.equal(adb(['shell', 'am', 'get-current-user']), '0', 'Android user changed during readback');
  return {device: {...device, verifiedBootState, flashLocked, vbmetaDigest, codename}, installed, home};
}

function checkDistribution(distribution: Distribution, observation: Observation, phase: 'initial' | 'updated', image?: ImageExpectation) {
  const {system, updatedSystemApp, apkLocation} = observation.installed;
  if (distribution === 'sideload') {
    assert.ok(image === undefined, 'Sideload receipt must omit signed image evidence');
    assert.ok(!system && !updatedSystemApp && apkLocation === 'data', 'Sideload baseline must be an Android data installation');
    return;
  }
  const {verifiedBootState, flashLocked, vbmetaDigest, codename, buildFingerprintSha256} = observation.device;
  const bootProblem = verifiedBootProblem({verifiedBoot: {state: verifiedBootState}});
  assert.ok(!bootProblem && flashLocked === '1' && codename === 'stallion', 'Image baseline must be a Pixel 10a with locked verified boot');
  assert.ok(image && isSha256(image.releaseRecordSha256) && isSha256(image.signedTargetFilesSha256) &&
    isSha256(image.fingerprintSha256) && isSha256(image.vbmetaDigest), 'Expected reviewed signed image evidence');
  assert.ok(vbmetaDigest === image.vbmetaDigest && buildFingerprintSha256 === image.fingerprintSha256,
    'Booted image differs from the reviewed fingerprint or chained VBMeta digest');
  if (phase === 'initial') {
    assert.ok(system && !updatedSystemApp && apkLocation === 'image',
      'Initial image baseline must run the launcher baked into the image. Use --previous for a follow-up.');
  } else {
    assert.ok(updatedSystemApp && apkLocation === 'data', 'Updated image launcher must have Android system-app provenance and a data APK');
  }
}

type Offer = Awaited<ReturnType<typeof readPublicLauncherOffer>>;
type Observation = ReturnType<typeof captureLauncher>;
interface Receipt {
  schema: typeof SCHEMA;
  phase: 'before' | 'after';
  packageName: string;
  distribution: Distribution;
  observation: Observation;
  signerRootSha256: string;
  sdkCommit: string;
  offer: Offer;
  image?: ImageExpectation;
  automaticInstall?: ReturnType<typeof readAutomaticInstallHistory>;
  previousReceiptSha256?: string;
  beforeReceiptSha256?: string;
}

function requireAutomaticEvidence(evidence: Receipt['automaticInstall']) {
  assert.ok(evidence && Number.isSafeInteger(evidence.sessionId) && evidence.sessionId > 0 && evidence.userId === 0 &&
    evidence.requireUserAction === 'NOT_REQUIRED' && evidence.permissionsManuallyAccepted === false && evidence.finalStatus === 1,
    'Expected Android’s verified automatic install history');
}

function readReceipt<P extends Receipt['phase']>(file: string, phase: P) {
  const stat = lstatSync(file);
  assert.ok(stat.isFile() && stat.size <= 32768, 'Expected a bounded wireless readback receipt');
  const bytes = readFileSync(file);
  assert.ok(bytes.length === stat.size, 'Wireless readback receipt changed during capture');
  const record = JSON.parse(bytes.toString('utf8')) as Receipt & {phase: P};
  assert.ok(record?.schema === SCHEMA && record.phase === phase && record.packageName === PACKAGE &&
    (record.distribution === 'sideload' || record.distribution === 'image-preinstalled') &&
    isSha256(record.signerRootSha256) && typeof record.sdkCommit === 'string' && GIT_COMMIT.test(record.sdkCommit) &&
    record.observation && record.offer, 'Invalid wireless readback receipt');
  const {manifestUrl, manifestSha256, apkUrl, versionCode, sha256: apkSha256, signerSha256, sizeBytes} = record.offer;
  assert.ok(manifestUrl === appUpdateManifestUrl() && isSha256(manifestSha256) && isSha256(apkSha256) &&
    signerSha256 === record.signerRootSha256 && Number.isSafeInteger(versionCode) && versionCode > 0 &&
    isPublishedUpdateApkUrl(apkUrl, APP_UPDATE_TAG, versionCode) &&
    Number.isSafeInteger(sizeBytes) && sizeBytes > 0 && sizeBytes <= 2**31,
    'Receipt does not describe an exact public launcher offer');
  assert.ok(phase === 'after'
    ? isSha256(record.beforeReceiptSha256) && record.previousReceiptSha256 === undefined
    : record.beforeReceiptSha256 === undefined && (record.previousReceiptSha256 === undefined || isSha256(record.previousReceiptSha256)),
    'Invalid wireless readback receipt link');
  if (phase === 'after') requireAutomaticEvidence(record.automaticInstall);
  else assert.ok(record.automaticInstall === undefined, 'Baseline must omit automatic install history');
  checkDistribution(record.distribution, record.observation, phase === 'after' || record.previousReceiptSha256 ? 'updated' : 'initial', record.image);
  return {record, sha256: sha256(bytes)};
}

export function checkFollowup(previous: Receipt, distribution: Distribution, observation: Observation, signerRootSha256: string) {
  assert.ok(previous.schema === SCHEMA && previous.phase === 'after' && previous.packageName === PACKAGE &&
    previous.distribution === distribution &&
    HEX.test(previous.beforeReceiptSha256 ?? ''), 'Follow-up requires a completed readback for the same distribution');
  requireAutomaticEvidence(previous.automaticInstall);
  assert.ok(previous.signerRootSha256 === signerRootSha256 && previous.offer.signerSha256 === signerRootSha256,
    'Follow-up signing family differs');
  assert.deepEqual(observation, previous.observation, 'Phone, OS, HOME or installed APK differs from the previous update');
  assert.ok(observation.installed.initiator === PACKAGE && observation.installed.versionCode === previous.offer.versionCode &&
    observation.installed.sha256 === previous.offer.sha256, 'Previous readback does not bind the installed update');
  checkDistribution(distribution, observation, 'updated', previous.image);
}

export async function readPublicLauncherOffer(read = publicObject) {
  const manifestUrl = appUpdateManifestUrl();
  const manifest = await read(manifestUrl, {maxBytes: 32768});
  assert.ok(manifest?.bytes && HEX.test(manifest.sha256), 'Public launcher manifest is unavailable');
  const {variant, versionCode, signerSha256, sha256, sizeBytes, apkUrl} = parseOffer(manifest.bytes);
  assert.ok(variant === 'launcher' && typeof signerSha256 === 'string' && typeof sha256 === 'string' &&
    isPublishedUpdateApkUrl(apkUrl, APP_UPDATE_TAG, versionCode),
    'Expected the published Alpha launcher APK');
  return {manifestUrl, manifestSha256: manifest.sha256, versionCode, signerSha256, sha256, sizeBytes, apkUrl};
}

export async function verifyPublicLauncherBytes(offer: Offer, read = publicObject) {
  const apk = await read(offer.apkUrl, {maxBytes: offer.sizeBytes});
  assert.ok(apk && apk.size === offer.sizeBytes && apk.sha256 === offer.sha256, 'Public APK differs from the offer');
  assert.deepEqual(await readPublicLauncherOffer(read), offer, 'Public offer changed while verifying its APK');
}

export function checkReplacement(before: Receipt, after: Observation, signerRootSha256: string, offer: Offer) {
  assert.ok(before.schema === SCHEMA && before.phase === 'before' && before.packageName === PACKAGE,
    'Expected a launcher baseline receipt');
  const previous = before.previousReceiptSha256;
  assert.ok(previous === undefined || HEX.test(previous), 'Invalid previous wireless readback receipt digest');
  checkDistribution(before.distribution, before.observation, previous ? 'updated' : 'initial', before.image);
  checkDistribution(before.distribution, after, 'updated', before.image);
  assert.deepEqual(after.device, before.observation.device, 'Device or OS identity changed');
  assert.deepEqual(after.home, before.observation.home, 'HOME selection changed');
  assert.deepEqual(offer, before.offer, 'Public offer changed across the drill');
  const old = before.observation.installed, updated = after.installed;
  assert.ok(updated.appId === old.appId && updated.firstInstallTime === old.firstInstallTime &&
    updated.lastUpdateTime !== old.lastUpdateTime, 'Android did not report an in-place replacement');
  assert.ok(updated.versionCode > old.versionCode && updated.versionCode === offer.versionCode &&
    updated.sha256 === offer.sha256, 'Installed APK does not match the advancing public offer');
  assert.ok(updated.initiator === PACKAGE, 'Android does not identify Alpha as the install initiator');
  assert.ok(signerRootSha256 === before.signerRootSha256 && offer.signerSha256 === signerRootSha256,
    'Release signing family changed');
}

function checkReadbackChain(files: readonly string[], distribution: Distribution) {
  assert.equal(files.length, 4, `Expected four ${distribution} receipts in before, after, follow-up before, follow-up after order`);
  const firstBefore = readReceipt(files[0], 'before');
  const firstAfter = readReceipt(files[1], 'after');
  const nextBefore = readReceipt(files[2], 'before');
  const nextAfter = readReceipt(files[3], 'after');
  const chain = [firstBefore, firstAfter, nextBefore, nextAfter];
  assert.ok(chain.every(({record}) => record.distribution === distribution), `Expected only ${distribution} receipts`);
  assert.equal(firstBefore.record.previousReceiptSha256, undefined, 'First receipt must be an initial baseline');
  assert.equal(nextBefore.record.previousReceiptSha256, firstAfter.sha256, 'Follow-up does not link to the first after receipt');
  assert.equal(nextBefore.record.sdkCommit, firstAfter.record.sdkCommit, 'Follow-up SDK revision differs from the installed release');
  assert.deepEqual(nextBefore.record.image, firstAfter.record.image, 'Reviewed image evidence changed between updates');
  checkFollowup(firstAfter.record, distribution, nextBefore.record.observation, nextBefore.record.signerRootSha256);
  for (const [before, after] of [[firstBefore, firstAfter], [nextBefore, nextAfter]]) {
    assert.equal(after.record.beforeReceiptSha256, before.sha256, 'After receipt does not link to its before receipt');
    assert.deepEqual(after.record.image, before.record.image, 'Reviewed image evidence changed across the update');
    checkReplacement(before.record, after.record.observation, after.record.signerRootSha256, after.record.offer);
  }
  return {
    releases: [firstAfter, nextAfter].map(({record}) => ({offer: record.offer, sdkCommit: record.sdkCommit})),
    receipts: chain.map(({sha256: digest}) => digest),
  };
}

/** Recheck both saved device trails after the public channel has advanced. */
export function verifyWirelessLauncherMatrix(sideload: readonly string[], imagePreinstalled: readonly string[]) {
  const stock = checkReadbackChain(sideload, 'sideload');
  const image = checkReadbackChain(imagePreinstalled, 'image-preinstalled');
  assert.deepEqual(image.releases, stock.releases, 'Both distributions must record the same two published releases');
  return {
    schema: 'alpha-wireless-launcher-matrix/v1',
    packageName: PACKAGE,
    releases: stock.releases,
    receipts: {sideload: stock.receipts, imagePreinstalled: image.receipts},
  };
}

function writeMatrix(args: string[]) {
  const {values} = parseArgs({args, options: {
    sideload: {type: 'string', multiple: true},
    'image-preinstalled': {type: 'string', multiple: true},
    out: {type: 'string'},
  }});
  assert.ok(values.sideload && values['image-preinstalled'] && values.out,
    'Use matrix with --sideload, --image-preinstalled and --out');
  const report = verifyWirelessLauncherMatrix(values.sideload, values['image-preinstalled']);
  writeFileSync(values.out, JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'matrix') return writeMatrix(args.slice(1));
  const {positionals: [phase, ...extra], values} = parseArgs({
    args, allowPositionals: true, options: {
      serial: {type: 'string'}, 'apk-manifest': {type: 'string'}, distribution: {type: 'string'},
      before: {type: 'string'}, previous: {type: 'string'}, out: {type: 'string'},
      'image-release-record': {type: 'string'}, 'image-vbmeta-digest': {type: 'string'},
    },
  });
  assert.ok(extra.length === 0 && (phase === 'before' || phase === 'after') &&
    values.serial && /^[A-Za-z0-9._:-]{1,64}$/.test(values.serial) && values['apk-manifest'] && values.out,
    'Use before or after with --serial, --apk-manifest and --out');
  assert.ok(phase === 'before' ? !values.before && (values.distribution === 'sideload' || values.distribution === 'image-preinstalled')
    : values.before && !values.distribution && !values.previous, 'Before requires --distribution. After requires --before');
  const baseline = values.before ? readReceipt(values.before, 'before') : undefined;
  const previous = values.previous ? readReceipt(values.previous, 'after') : undefined;
  const distribution = baseline?.record.distribution ?? values.distribution as Distribution;
  const firstImage = phase === 'before' && distribution === 'image-preinstalled' && !previous;
  const recordFile = values['image-release-record'], vbmetaDigest = values['image-vbmeta-digest'];
  assert.ok(firstImage ? recordFile && vbmetaDigest : recordFile === undefined && vbmetaDigest === undefined,
    'Provide --image-release-record and --image-vbmeta-digest only for the first image-preinstalled baseline');
  const {updateManifestUrl} = JSON.parse(readFileSync(new URL('../app.config.json', import.meta.url), 'utf8'));
  assert.equal(updateManifestUrl, appUpdateManifestUrl(), 'The configured launcher channel differs from the public release');
  const descriptor = readReleaseSigner();
  const apk = admitUnitApk(values['apk-manifest'], {variant: 'launcher', build: 'release'}, {descriptor, installedReadback: true});
  const {signerRootSha256, sdkCommit, versionCode} = inspectReadbackApk(apk, descriptor);
  const image = recordFile && vbmetaDigest ? readImageExpectation(recordFile, vbmetaDigest, apk)
    : baseline?.record.image ?? previous?.record.image;
  const offer = await readPublicLauncherOffer();
  assert.equal(offer.signerSha256, signerRootSha256, 'Public offer has a different signing family');
  if (!baseline) {
    assert.ok(offer.versionCode > versionCode, 'Public launcher version must advance the baseline');
    await verifyPublicLauncherBytes(offer);
  }
  const adb = adbFor(values.serial);
  const observation = captureLauncher(adb, values.serial);
  assert.ok(observation.installed.sha256 === apk.sha256 && observation.installed.versionCode === versionCode,
    'Installed launcher differs from the locally admitted APK');
  if (baseline) checkReplacement(baseline.record, observation, signerRootSha256, offer);
  else if (previous) checkFollowup(previous.record, distribution, observation, signerRootSha256);
  else checkDistribution(distribution, observation, 'initial', image);
  const automaticInstall = baseline && readAutomaticInstallHistory(
    adb(['shell', 'dumpsys', 'package', 'installs'], {allowFailure: true}),
    {
      packageName: PACKAGE,
      appId: observation.installed.appId,
      versionCode: observation.installed.versionCode,
      apkSha256: observation.installed.sha256,
      signerRootSha256,
    },
  );
  assert.deepEqual(await readPublicLauncherOffer(), offer, 'Public offer changed during device readback');
  writeFileSync(values.out, JSON.stringify({
    schema: SCHEMA, phase, packageName: PACKAGE, distribution, capturedAt: new Date().toISOString(),
    observation, signerRootSha256, sdkCommit, offer, ...(image ? {image} : {}),
    ...(baseline ? {beforeReceiptSha256: baseline.sha256, automaticInstall} : previous ? {previousReceiptSha256: previous.sha256} : {}),
  }, null, 2) + '\n', {flag: 'wx', mode: 0o600});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Wireless launcher readback failed');
    process.exitCode = 1;
  });
}
