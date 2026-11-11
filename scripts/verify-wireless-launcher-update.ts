#!/usr/bin/env node
/** Record an operator-run wireless launcher replacement using read-only ADB commands. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, lstatSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {readHome} from './android-instrumentation.ts';
import {parseOffer, publicObject} from './deliver-app-update.ts';
import {adbFor, admitUnitApk, apkRuntimeIdentity, deviceFacts, PACKAGE, packageFacts} from './provision-unit.ts';
import {inspectUpdateApk} from './update-apk-admission.ts';
import {APP_UPDATE_TAG, appUpdateManifestUrl, isPublishedUpdateApkUrl} from './update-channel.ts';

type Adb = ReturnType<typeof adbFor>;
type Distribution = 'sideload' | 'image-preinstalled';
const HEX = /^[a-f0-9]{64}$/;
const EMPTY_SHA256 = createHash('sha256').digest('hex');
const SCHEMA = 'alpha-wireless-launcher-readback/v1';
const HOME = 'android.intent.category.HOME';

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
  const sha256 = adb(['shell', 'sha256sum', apkPath], {timeout: 600_000}).split(/\s+/, 1)[0];
  assert.ok(HEX.test(sha256), 'Installed APK digest is unavailable');
  return {
    versionCode: facts.versionCode, appId: facts.userId, firstInstallTime, lastUpdateTime: facts.lastUpdateTime,
    system: flags.includes('SYSTEM'), updatedSystemApp: flags.includes('UPDATED_SYSTEM_APP'),
    initiator: initiator === 'null' ? null : initiator, sha256,
  };
}

export function captureLauncher(adb: Adb, serial: string) {
  assert.equal(adb(['get-state']), 'device', 'Device is unavailable');
  const device = deviceFacts(adb, serial);
  assert.ok(!device.emulator && device.sdk && device.sdk >= 31, 'Use a physical Android device with API level 31 or later');
  assert.ok(device.model && device.abi && device.buildFingerprintSha256 !== EMPTY_SHA256,
    'Device model, ABI or build fingerprint is unavailable');
  assert.equal(adb(['shell', 'am', 'get-current-user']), '0', 'Use the primary Android user');
  const verifiedBootState = adb(['shell', 'getprop', 'ro.boot.verifiedbootstate']);
  const flashLocked = adb(['shell', 'getprop', 'ro.boot.flash.locked']);
  const vbmetaDigest = adb(['shell', 'getprop', 'ro.boot.vbmeta.digest']);
  const installed = installedState(adb);
  const home = readHome(adb, '0');
  assert.ok(home.holders.length === 1 && home.holders[0] === PACKAGE && home.activity.startsWith(PACKAGE + '/'),
    `Alpha must hold and resolve the ${HOME} role`);
  assert.deepEqual(installedState(adb), installed, 'Package changed during readback');
  assert.deepEqual(readHome(adb, '0'), home, 'HOME selection changed during readback');
  assert.equal(adb(['shell', 'am', 'get-current-user']), '0', 'Android user changed during readback');
  return {device: {...device, verifiedBootState, flashLocked, vbmetaDigest}, installed, home};
}

function checkDistribution(distribution: Distribution, observation: ReturnType<typeof captureLauncher>, after: boolean) {
  const {system, updatedSystemApp} = observation.installed;
  if (distribution === 'sideload') {
    assert.ok(!system && !updatedSystemApp, 'Sideload baseline must be a non-system installation');
  } else {
    assert.ok(HEX.test(observation.device.vbmetaDigest) && (system || updatedSystemApp) &&
      (!after || updatedSystemApp), 'Image baseline must have a vbmeta digest and Android system-app provenance');
  }
}

type Offer = Awaited<ReturnType<typeof readPublicLauncherOffer>>;
type Observation = ReturnType<typeof captureLauncher>;
interface Baseline {
  schema: typeof SCHEMA;
  phase: 'before';
  distribution: Distribution;
  observation: Observation;
  signerRootSha256: string;
  offer: Offer;
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

export function checkReplacement(before: Baseline, after: Observation, signerRootSha256: string, offer: Offer) {
  checkDistribution(before.distribution, before.observation, false);
  checkDistribution(before.distribution, after, true);
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

async function main() {
  const {positionals: [phase, ...extra], values} = parseArgs({
    allowPositionals: true, options: {
      serial: {type: 'string'}, 'apk-manifest': {type: 'string'}, distribution: {type: 'string'},
      before: {type: 'string'}, out: {type: 'string'},
    },
  });
  assert.ok(extra.length === 0 && (phase === 'before' || phase === 'after') &&
    values.serial && /^[A-Za-z0-9._:-]{1,64}$/.test(values.serial) && values['apk-manifest'] && values.out,
    'Use before or after with --serial, --apk-manifest and --out');
  assert.ok(phase === 'before' ? !values.before && (values.distribution === 'sideload' || values.distribution === 'image-preinstalled')
    : values.before && !values.distribution, 'Before requires --distribution. After requires --before');
  let before: Baseline | undefined;
  if (values.before) {
    const stat = lstatSync(values.before);
    assert.ok(stat.isFile() && stat.size <= 32768, 'Expected a bounded baseline receipt');
    before = JSON.parse(readFileSync(values.before, 'utf8')) as Baseline;
    assert.ok(before?.schema === SCHEMA && before.phase === 'before' &&
      (before.distribution === 'sideload' || before.distribution === 'image-preinstalled'), 'Invalid baseline receipt');
  }
  const distribution = before?.distribution ?? values.distribution as Distribution;
  const {updateManifestUrl} = JSON.parse(readFileSync(new URL('../app.config.json', import.meta.url), 'utf8'));
  assert.equal(updateManifestUrl, appUpdateManifestUrl(), 'The configured launcher channel differs from the public release');
  const apk = admitUnitApk(values['apk-manifest'], {variant: 'launcher', build: 'release'});
  assert.ok(apk.versionCode !== null, 'Release version code is missing');
  const {signerRootSha256} = inspectUpdateApk({...apk, versionCode: apk.versionCode});
  const runtime = apkRuntimeIdentity(apk.file);
  assert.ok(runtime.runtime === 'PACKAGED' && runtime.base && /^[a-f0-9]{40}$/.test(runtime.base), 'Release SDK revision is missing');
  const offer = await readPublicLauncherOffer();
  assert.equal(offer.signerSha256, signerRootSha256, 'Public offer has a different signing family');
  if (!before) {
    assert.ok(offer.versionCode > apk.versionCode, 'Public launcher version must advance the baseline');
    await verifyPublicLauncherBytes(offer);
  }
  const observation = captureLauncher(adbFor(values.serial), values.serial);
  assert.ok(observation.installed.sha256 === apk.sha256 && observation.installed.versionCode === apk.versionCode,
    'Installed launcher differs from the locally admitted APK');
  if (before) checkReplacement(before, observation, signerRootSha256, offer);
  else checkDistribution(distribution, observation, false);
  assert.deepEqual(await readPublicLauncherOffer(), offer, 'Public offer changed during device readback');
  writeFileSync(values.out, JSON.stringify({
    schema: SCHEMA, phase, packageName: PACKAGE, distribution, capturedAt: new Date().toISOString(),
    observation, signerRootSha256, sdkCommit: runtime.base, offer,
  }, null, 2) + '\n', {flag: 'wx', mode: 0o600});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Wireless launcher readback failed');
    process.exitCode = 1;
  });
}
