import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {
  captureLauncher, checkFollowup, checkReplacement, readPublicLauncherOffer, verifyPublicLauncherBytes,
  verifyWirelessLauncherMatrix,
} from '../scripts/verify-wireless-launcher-update.ts';
import {appUpdateManifestUrl} from '../scripts/update-channel.ts';

const packageName = 'ai.alphacompute.alphaphone';
const dataApkPath = '/data/app/~~AA==/ai.alphacompute.alphaphone-X=/base.apk';
const imageApkPath = '/product/app/AlphaPhone/AlphaPhone.apk';
const imageFlags = 'SYSTEM HAS_CODE';
const updatedImageFlags = 'SYSTEM HAS_CODE UPDATED_SYSTEM_APP';
const schema = 'alpha-wireless-launcher-readback/v2';
const hash = value => createHash('sha256').update(value).digest('hex');
const signingFamily = 'b'.repeat(64);
const apk = Buffer.from('fixture APK bytes');
const publicUrl = appUpdateManifestUrl();
const manifest = {
  schema: 'alpha-update/v1', variant: 'launcher', versionCode: 8,
  signerSha256: signingFamily, sha256: hash(apk), sizeBytes: apk.length,
  apkUrl: new URL('alpha-phone-8.apk', publicUrl).href,
};
const publicBytes = value => ({size: value.length, sha256: hash(value), bytes: value});
const pointer = publicBytes(Buffer.from(JSON.stringify(manifest)));
const props = {
  'ro.kernel.qemu': '0', 'ro.boot.qemu': '', 'ro.product.model': 'Pixel',
  'ro.product.cpu.abi': 'arm64-v8a',
  'ro.product.device': 'stallion',
  'ro.build.fingerprint': 'brand/device/product:17/build/100:user/release-keys',
  'ro.boot.verifiedbootstate': 'green', 'ro.boot.flash.locked': '1', 'ro.boot.vbmeta.digest': 'a'.repeat(64),
};
const imageEvidence = {
  releaseRecordSha256: hash('image release record'),
  signedTargetFilesSha256: hash('signed target-files'),
  fingerprintSha256: hash(props['ro.build.fingerprint']),
  vbmetaDigest: props['ro.boot.vbmeta.digest'],
};
const automaticInstall = {
  sessionId: 123, userId: 0, requireUserAction: 'NOT_REQUIRED', permissionsManuallyAccepted: false, finalStatus: 1,
};

function deviceReader({
  version = 7, sha256 = 'c'.repeat(64), flags = 'HAS_CODE', initiator = 'com.android.shell',
  appId = 10123, firstInstallTime = '2026-11-01 10:00:00', apkPath = dataApkPath, packagePath = `package:${apkPath}`,
  home = packageName, changeDuringReadback = false, serial = 'fixture-phone', sdk = '37', deviceProperties = {},
  manualApproval = false,
} = {}) {
  let dumps = 0;
  const properties = {...props, ...deviceProperties};
  const adb = args => {
    if (args[0] === 'get-state') return 'device';
    assert.equal(args[0], 'shell', 'acceptance capture only uses read commands');
    if (args[1] === 'getprop' && args[2] === 'ro.build.version.sdk') return sdk;
    if (args[1] === 'getprop' && Object.hasOwn(properties, args[2])) return properties[args[2]];
    if (args.slice(1).join(' ') === 'dumpsys package installs') return [
      'Historical install sessions:', '  Session 123:',
      `    userId=0 mOriginalInstallerUid=${appId} mOriginalInstallerPackageName=${packageName} installerPackageName=${packageName} installInitiatingPackageName=${packageName} installOriginatingPackageName=null mInstallerUid=${appId}`,
      `    mode=1 appPackageName=${packageName} referrerUri=alpha-update://${packageName}/${version}/${sha256}/${signingFamily}/3/intent/automatic requireUserAction=NOT_REQUIRED`,
      `    mCommitted=true mPermissionsManuallyAccepted=${manualApproval} mFinalStatus=1`,
      '', 'Legacy install sessions:', '  []',
    ].join('\n');
    switch (args.slice(1, 3).join(' ')) {
      case 'am get-current-user': return '0';
      case 'cmd role': return home;
      case 'cmd package': return `priority=0\n${home}/.MainActivity`;
      case 'pm path': return packagePath;
      case `sha256sum ${apkPath}`: return `${sha256}  ${apkPath}`;
      case 'dumpsys package': {
        dumps++;
        const activeVersion = changeDuringReadback && dumps > 1 ? version + 1 : version;
        return [
          'Packages:', `  Package [${packageName}] (a1):`, `    appId=${appId}`,
          `    versionCode=${activeVersion} minSdk=31 targetSdk=36`,
          `    lastUpdateTime=2026-11-11 10:00:0${version}`, `    initiatingPackageName=${initiator}`,
          `    pkgFlags=[ ${flags} ]`, '    User 0: ceDataInode=1 installed=true hidden=false',
          `      firstInstallTime=${firstInstallTime}`, '    User 10: ceDataInode=2 installed=true hidden=false',
          '      firstInstallTime=2026-11-09 10:00:00', '', 'Hidden system packages:',
          `  Package [${packageName}] (b1):`, '    appId=99999', '    versionCode=2', '    pkgFlags=[ SYSTEM ]',
        ].join('\n');
      }
      default: throw Error('Unexpected ADB command ' + args.join(' '));
    }
  };
  return adb;
}

function readDevice(options = {}) {
  return captureLauncher(deviceReader(options), options.serial ?? 'fixture-phone');
}

test('capture selects the active package and primary user, omitting raw device identifiers', () => {
  const state = readDevice({initiator: 'null'});
  assert.equal(state.installed.versionCode, 7);
  assert.equal(state.installed.appId, '10123');
  assert.equal(state.installed.firstInstallTime, '2026-11-01 10:00:00');
  assert.equal(state.installed.initiator, null);
  assert.equal(state.installed.system, false);
  assert.equal(state.installed.apkLocation, 'data');
  assert.equal(readDevice({apkPath: imageApkPath, flags: imageFlags}).installed.apkLocation, 'image');
  assert.ok(!JSON.stringify(state).includes('fixture-phone'));
  assert.ok(!JSON.stringify(state).includes(dataApkPath));
  assert.throws(() => readDevice({serial: 'emulator-5554'}), /physical/);
  assert.throws(() => readDevice({sdk: '33'}), /Android 14 or later/);
  assert.equal(readDevice({sdk: '34'}).device.sdk, 34);
  assert.throws(() => readDevice({changeDuringReadback: true}), /changed during readback/);
  assert.throws(() => readDevice({packagePath: `package:${dataApkPath}\npackage:/data/app/split.apk`}), /one installed base/);
  assert.throws(() => readDevice({packagePath: 'package:/data/app/a;id.apk'}), /one installed base/);
  assert.throws(() => readDevice({apkPath: '/data/local/tmp/copied.apk'}), /outside Android app data and image partitions/);
  assert.throws(() => readDevice({home: 'com.android.launcher3'}), /must hold/);
});

test('public readback binds the canonical channel, exact bytes and offer stability', async () => {
  const read = async url => url === publicUrl ? pointer : publicBytes(apk);
  const offer = await readPublicLauncherOffer(read);
  assert.equal(offer.manifestSha256, pointer.sha256);
  await verifyPublicLauncherBytes(offer, read);
  await assert.rejects(verifyPublicLauncherBytes(offer, async () => publicBytes(Buffer.from('wrong'))), /APK differs/);
  await assert.rejects(verifyPublicLauncherBytes(offer, async url => url === publicUrl
    ? publicBytes(Buffer.from(JSON.stringify({...manifest, notes: 'later'}))) : publicBytes(apk)), /offer changed/);
  await assert.rejects(readPublicLauncherOffer(async () => publicBytes(Buffer.from(JSON.stringify({...manifest,
    apkUrl: 'https://example.test/alpha-phone-8.apk',
  })))), /published Alpha launcher/);
});

test('both baseline shapes require an exact advancing self-initiated replacement', async () => {
  const offer = await readPublicLauncherOffer(async () => pointer);
  const next = {version: 8, sha256: hash(apk), initiator: packageName};
  for (const distribution of ['sideload', 'image-preinstalled']) {
    const image = distribution === 'image-preinstalled';
    const before = {
      schema, phase: 'before', packageName, distribution,
      observation: image ? readDevice({apkPath: imageApkPath, flags: imageFlags}) : readDevice(),
      ...(image ? {image: imageEvidence} : {}),
      signerRootSha256: signingFamily, offer,
    };
    const flags = image ? updatedImageFlags : 'HAS_CODE';
    const after = readDevice({...next, flags});
    checkReplacement(before, after, signingFamily, offer);
    assert.throws(() => checkReplacement(before, readDevice({...next, flags, initiator: 'com.android.shell'}), signingFamily, offer),
      /install initiator/);
    assert.throws(() => checkReplacement(before, readDevice({...next, flags, appId: 54321}), signingFamily, offer), /in-place/);
    assert.throws(() => checkReplacement(before, readDevice({...next, flags, sha256: 'd'.repeat(64)}), signingFamily, offer), /advancing/);
    assert.throws(() => checkReplacement(before, after, signingFamily, {...offer, manifestSha256: 'f'.repeat(64)}), /offer changed/);
    assert.throws(() => checkReplacement(before, after, 'f'.repeat(64), offer), /signing family/);
    assert.throws(() => checkReplacement(before, readDevice({...next, flags, serial: 'other-phone'}), signingFamily, offer), /Device or OS/);
    if (image) {
      assert.throws(() => checkReplacement(before, readDevice({...next, flags: imageFlags}), signingFamily, offer), /system-app provenance/);
      assert.throws(() => checkReplacement(before, readDevice({...next, flags, apkPath: imageApkPath}), signingFamily, offer), /data APK/);
      for (const replaced of [
        readDevice({flags: updatedImageFlags}), readDevice({flags: imageFlags}),
        readDevice({flags: updatedImageFlags, apkPath: imageApkPath}),
      ]) {
        assert.throws(() => checkReplacement({...before, observation: replaced}, after, signingFamily, offer), /launcher baked into the image/);
      }
      assert.throws(() => checkReplacement({
        ...before, observation: readDevice({flags: updatedImageFlags}), previousReceiptSha256: 'bad-digest',
      }, after, signingFamily, offer), /receipt|SHA-256/i);
      for (const deviceProperties of [
        {'ro.boot.verifiedbootstate': 'orange'},
        {'ro.boot.verifiedbootstate': 'yellow', 'ro.boot.flash.locked': '0'},
        {'ro.boot.flash.locked': ''},
        {'ro.boot.flash.locked': 'locked'},
        {'ro.product.device': 'other'},
      ]) {
        assert.throws(() => checkReplacement({
          ...before, observation: readDevice({apkPath: imageApkPath, flags: imageFlags, deviceProperties}),
        }, readDevice({...next, flags, deviceProperties}), signingFamily, offer), /locked verified boot/);
      }
      assert.throws(() => checkReplacement({...before, image: undefined}, after, signingFamily, offer), /reviewed signed image evidence/);
      for (const key of ['vbmetaDigest', 'fingerprintSha256']) {
        assert.throws(() => checkReplacement({...before, image: {...imageEvidence, [key]: hash('other image')}},
          after, signingFamily, offer), /reviewed fingerprint or chained VBMeta/);
      }
    } else {
      assert.throws(() => checkReplacement({...before, observation: readDevice({apkPath: imageApkPath})},
        after, signingFamily, offer), /Sideload baseline must be an Android data installation/);
    }
  }
});

test('a second advancing image or sideload update starts from the exact previous after receipt', async () => {
  const offer = await readPublicLauncherOffer(async () => pointer);
  const nextPointer = publicBytes(Buffer.from(JSON.stringify({
    ...manifest, versionCode: 9, sha256: hash('second APK bytes'), sizeBytes: Buffer.byteLength('second APK bytes'),
    apkUrl: new URL('alpha-phone-9.apk', publicUrl).href,
  })));
  const nextOffer = await readPublicLauncherOffer(async () => nextPointer);
  for (const distribution of ['image-preinstalled', 'sideload']) {
    const flags = distribution === 'image-preinstalled' ? updatedImageFlags : 'HAS_CODE';
    const prior = {version: offer.versionCode, sha256: offer.sha256, initiator: packageName, flags};
    const current = readDevice(prior);
    const previous = {
      schema, phase: 'after', packageName, distribution, observation: current,
      beforeReceiptSha256: hash('previous before receipt'), signerRootSha256: signingFamily,
      sdkCommit: 'a'.repeat(40), offer, automaticInstall,
      ...(distribution === 'image-preinstalled' ? {image: imageEvidence} : {}),
    };
    checkFollowup(previous, distribution, current, signingFamily);
    const before = {
      schema, phase: 'before', packageName, distribution, observation: current,
      previousReceiptSha256: hash(JSON.stringify(previous)), signerRootSha256: signingFamily, offer: nextOffer,
      image: previous.image,
    };
    const after = readDevice({...prior, version: nextOffer.versionCode, sha256: nextOffer.sha256});
    checkReplacement(before, after, signingFamily, nextOffer);

    assert.throws(() => checkFollowup({...previous, phase: 'before'}, distribution, current, signingFamily), /requires a completed readback/);
    assert.throws(() => checkFollowup({...previous, beforeReceiptSha256: 'bad-digest'}, distribution, current, signingFamily), /requires a completed readback/);
    assert.throws(() => checkFollowup({...previous, automaticInstall: undefined}, distribution, current, signingFamily), /verified automatic install history/);
    assert.throws(() => checkFollowup({...previous, packageName: 'other.package'}, distribution, current, signingFamily), /requires a completed readback/);
    assert.throws(() => checkFollowup({...previous, offer: {...offer, sha256: hash('other APK bytes')}}, distribution, current, signingFamily),
      /does not bind the installed update/);
    assert.throws(() => checkFollowup(previous, distribution, readDevice({...prior, serial: 'another-phone'}), signingFamily), /Phone, OS, HOME or installed APK differs/);
    assert.throws(() => checkFollowup(previous, distribution, readDevice({...prior, sha256: hash('other APK bytes')}), signingFamily), /Phone, OS, HOME or installed APK differs/);
    assert.throws(() => checkFollowup(previous, distribution, {
      ...current, home: {...current.home, activity: `${packageName}/.AnotherHome`},
    }, signingFamily), /Phone, OS, HOME or installed APK differs/);
    assert.throws(() => checkFollowup(previous, distribution, current, 'f'.repeat(64)), /signing family differs/);
  }
});

test('the CLI binds installed releases, the production image and unattended history across two updates', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'alpha-wireless-cli-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const entry = fileURLToPath(new URL('../scripts/verify-wireless-launcher-update.ts', import.meta.url));
  const policy = pathToFileURL(fileURLToPath(new URL('../scripts/update-apk-admission.ts', import.meta.url))).href;
  const provision = pathToFileURL(fileURLToPath(new URL('../scripts/provision-unit.ts', import.meta.url))).href;
  const output = path.join(directory, 'scripts', 'wireless.mjs');
  mkdirSync(path.dirname(output));
  writeFileSync(path.join(directory, 'app.config.json'), JSON.stringify({updateManifestUrl: publicUrl}));
  const initialApk = Buffer.from('initial CLI fixture APK bytes');
  const channel = readFileSync(new URL('../android/aosp/pixel10a-ota-channel.json', import.meta.url));
  mkdirSync(path.join(directory, 'android/aosp'), {recursive: true});
  writeFileSync(path.join(directory, 'android/aosp/pixel10a-ota-channel.json'), channel);
  const releaseChannel = JSON.parse(channel);
  const imageRecord = path.join(directory, 'release-record.json');
  writeFileSync(imageRecord, JSON.stringify({
    schema: 1, kind: 'aosp-release-compatibility', problems: [],
    product: releaseChannel.product, device: releaseChannel.device, channel: releaseChannel.channel,
    build: {fingerprint: props['ro.build.fingerprint'], androidRelease: '17', dateUtc: '1794430000', securityPatch: '2026-11-05'},
    artifacts: {signedTargetFiles: {sha256: imageEvidence.signedTargetFilesSha256}, ota: {type: 'full', sha256: hash('fixture OTA')}},
    certificates: {releasekey: releaseChannel.otaCertificateSha256},
    verifiedBoot: {publicKeySha256: releaseChannel.avbPublicKeySha256, rollbackIndexes: [{location: 0, index: '1'}]},
    apks: [{versionCode: 7, sha256: hash(initialApk), signerSha256: signingFamily, distributable: true}],
    imageBooted: false, signedUpdateApplied: false, releaseQualified: false, deviceAcceptanceVerified: false,
  }));
  const secondApk = Buffer.from('second CLI fixture APK bytes');
  const secondManifest = {...manifest, versionCode: 9, sha256: hash(secondApk), sizeBytes: secondApk.length,
    apkUrl: new URL('alpha-phone-9.apk', publicUrl).href};
  const manifests = new Map();
  for (const [versionCode, bytes] of [[7, initialApk], [8, apk], [9, secondApk]]) {
    const versionDir = path.join(directory, String(versionCode));
    mkdirSync(versionDir);
    const file = 'launcher-release.apk';
    writeFileSync(path.join(versionDir, file), bytes);
    const apkManifest = path.join(versionDir, 'apk-manifest.json');
    writeFileSync(apkManifest, JSON.stringify({testMocks: false, results: [{
      variant: 'launcher', mode: 'release', file, sha256: hash(bytes), versionCode,
      signed: true, signerSha256: signingFamily, distributable: true, testMocks: false,
      bundleAudit: 'passed', runtime: 'PACKAGED', runtimeNotices: true, licenceBlockers: [],
      voiceHost: {packaged: true, asr: true, qualified: true, differences: []},
    }]}));
    manifests.set(versionCode, apkManifest);
  }
  const prelude = `
    globalThis.wirelessCalls = [];
    globalThis.wirelessOffer = process.env.FIXTURE_FOLLOWUP==='1' ? ${JSON.stringify(secondManifest)} : ${JSON.stringify(manifest)};
    globalThis.wirelessPolicy = {schema: 1, signerSha256:${JSON.stringify(signingFamily)},
      lastRelease: {versionCode: globalThis.wirelessOffer.versionCode}};
    globalThis.wirelessBytes = Buffer.from(process.env.FIXTURE_FOLLOWUP==='1' ? ${JSON.stringify([...secondApk])} : ${JSON.stringify([...apk])});
    globalThis.fetch = async (url, options) => {
      if (process.argv[2] === 'matrix') throw Error('Matrix must use saved receipts');
      if (options.redirect !== 'manual' || options.headers.authorization) throw Error('Unexpected public transport');
      if (url === ${JSON.stringify(publicUrl)}) return new Response(JSON.stringify(globalThis.wirelessOffer));
      if (url === globalThis.wirelessOffer.apkUrl) return new Response(globalThis.wirelessBytes);
      throw Error('No network port for ' + url);
    };
  `;
  const ports = {
    './build-android.ts': `export function readReleaseSigner() {
      globalThis.wirelessCalls.push('signer'); return globalThis.wirelessPolicy;
    }`,
    './provision-unit.ts': `
      import assert from 'node:assert/strict';
      import {createHash} from 'node:crypto';
      import {readFileSync, writeFileSync} from 'node:fs';
      import {admitUnitApk as admit} from ${JSON.stringify(provision)};
      export {PACKAGE, packageFacts, deviceFacts, snapshotUnitApk} from ${JSON.stringify(provision)};
      const packageName=${JSON.stringify(packageName)}, dataApkPath=${JSON.stringify(dataApkPath)},
        imageApkPath=${JSON.stringify(imageApkPath)}, props=${JSON.stringify(props)}, signingFamily=${JSON.stringify(signingFamily)};
      ${deviceReader.toString()}
      const after=process.argv[2]==='after', image=process.env.FIXTURE_DISTRIBUTION==='image-preinstalled',
        followup=process.env.FIXTURE_FOLLOWUP==='1';
      const versionCode=globalThis.wirelessOffer.versionCode-(after?0:1),
        digest=after?globalThis.wirelessOffer.sha256:followup?${JSON.stringify(hash(apk))}:${JSON.stringify(hash(initialApk))};
      export function adbFor(serial) {
        assert.equal(serial,'fixture-phone');
        return deviceReader({version:versionCode,sha256:digest,initiator:after||followup?packageName:'com.android.shell',
          apkPath:image&&!after&&!followup?imageApkPath:dataApkPath,
          manualApproval:process.env.FIXTURE_MANUAL_APPROVAL==='1',
          flags:image?(after||followup?${JSON.stringify(updatedImageFlags)}:${JSON.stringify(imageFlags)}):'HAS_CODE'});
      }
      export function admitUnitApk(file, selection, options={}) {
        assert.deepEqual(selection,{variant:'launcher',build:'release'});
        assert.equal(options.descriptor,globalThis.wirelessPolicy);
        globalThis.wirelessCalls.push('manifest');
        const apk = admit(file,selection,options);
        globalThis.wirelessAdmitted = apk;
        if (process.env.FIXTURE_REPLACE_APK==='1') writeFileSync(apk.file, 'replaced bytes');
        return apk;
      }
      export function apkRuntimeIdentity(file) {
        assert.equal(file, globalThis.wirelessInspected.file);
        assert.notEqual(file, globalThis.wirelessAdmitted.file);
        assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), globalThis.wirelessAdmitted.sha256);
        return {runtime:'PACKAGED',base:'d'.repeat(40)};
      }
    `,
    './update-apk-admission.ts': `
      import {admitUpdateApkIdentity} from ${JSON.stringify(policy)};
      export function inspectUpdateApk(apk, options={}) {
        globalThis.wirelessCalls.push('inspection');
        globalThis.wirelessInspected = apk;
        // The real signing-family policy remains in the integration. Native APK
        // inspection facts are synthetic; no signer, APK tool or release key runs.
        return admitUpdateApkIdentity(apk,options.descriptor,
          {packageName:${JSON.stringify(packageName)},home:true,launcher:true,xml:'android.permission.READ_CONTACTS'},
          {verified:true,packageName:${JSON.stringify(packageName)},versionCode:apk.versionCode,
            activeSignerSha256:${JSON.stringify(signingFamily)},signerRootSha256:${JSON.stringify(signingFamily)}});
      }
    `,
  };
  await build({entryPoints: [entry], outfile: output, bundle: true, format: 'esm', platform: 'node',
    banner: {js: prelude}, footer: {js: "if(process.exitCode!==1&&JSON.stringify(globalThis.wirelessCalls)!==JSON.stringify(process.argv[2]==='matrix'?[]:['signer','manifest','inspection']))throw Error('Unexpected signer policy or APK admission calls');"},
    plugins: [{name: 'closed-readback-ports', setup(builder) {
      builder.onResolve({filter: /.*/}, args => {
        if (args.kind === 'entry-point') return;
        if (args.importer === entry && Object.hasOwn(ports, args.path)) return {path: args.path, namespace: 'closed'};
        if (args.path.startsWith('node:') || args.path.startsWith('file:')) return {path: args.path, external: true};
        return {path: pathToFileURL(path.resolve(path.dirname(args.importer), args.path)).href, external: true};
      });
      builder.onLoad({filter: /.*/, namespace: 'closed'}, args => ({contents: ports[args.path], loader: 'js'}));
    }}]});
  const chains = new Map();
  for (const distribution of ['sideload', 'image-preinstalled']) {
    const before = path.join(directory, distribution + '-before.json'), after = path.join(directory, distribution + '-after.json');
    const run = (phase, receipt, extra, followup = false, manualApproval = false) => {
      const versionCode = (followup ? 9 : 8) - (phase === 'before' ? 1 : 0);
      return execFileSync(process.execPath, [realpathSync(output), phase, '--serial', 'fixture-phone',
        '--apk-manifest', manifests.get(versionCode), '--out', receipt, ...extra], {
        encoding: 'utf8', timeout: 30_000, stdio: 'pipe', env: {...process.env, FIXTURE_DISTRIBUTION: distribution,
          FIXTURE_FOLLOWUP: followup ? '1' : '0', FIXTURE_MANUAL_APPROVAL: manualApproval ? '1' : '0',
          FIXTURE_REPLACE_APK: '0'},
      });
    };
    const imageArgs = distribution === 'image-preinstalled'
      ? ['--image-release-record', imageRecord, '--image-vbmeta-digest', imageEvidence.vbmetaDigest] : [];
    if (distribution === 'image-preinstalled') {
      const invalid = path.join(directory, 'wrong-image.json');
      const wrongRecord = path.join(directory, 'wrong-release-record.json');
      writeFileSync(wrongRecord, JSON.stringify({...JSON.parse(readFileSync(imageRecord)), apks: []}));
      assert.throws(() => run('before', invalid, ['--distribution', distribution]),
        error => /Provide --image-release-record/.test(error.stderr));
      assert.throws(() => run('before', invalid, ['--distribution', distribution,
        '--image-release-record', wrongRecord, '--image-vbmeta-digest', imageEvidence.vbmetaDigest]),
      error => /does not admit the baked launcher APK/.test(error.stderr));
      assert.throws(() => run('before', invalid, ['--distribution', distribution,
        '--image-release-record', imageRecord, '--image-vbmeta-digest', hash('different signed image')]),
      error => /Booted image differs/.test(error.stderr));
      assert.equal(existsSync(invalid), false);
    }
    run('before', before, ['--distribution', distribution, ...imageArgs]);
    const rejected = path.join(directory, distribution + '-manual-approval.json');
    assert.throws(() => run('after', rejected, ['--before', before], false, true),
      error => /manual|approval/i.test(error.stderr));
    assert.equal(existsSync(rejected), false);
    run('after', after, ['--before', before]);
    const initial = JSON.parse(readFileSync(before)), updated = JSON.parse(readFileSync(after));
    assert.equal(initial.phase, 'before');
    assert.equal(updated.phase, 'after');
    assert.deepEqual(updated.automaticInstall, automaticInstall);
    assert.equal(initial.automaticInstall, undefined);
    assert.equal(updated.signerRootSha256, signingFamily);
    assert.equal(updated.observation.installed.initiator, packageName);
    assert.equal(updated.observation.installed.sha256, manifest.sha256);
    assert.equal(updated.observation.installed.firstInstallTime, initial.observation.installed.firstInstallTime);
    assert.equal(initial.observation.installed.apkLocation, distribution === 'image-preinstalled' ? 'image' : 'data');
    assert.deepEqual(initial.image, distribution === 'image-preinstalled' ? {
      ...imageEvidence, releaseRecordSha256: hash(readFileSync(imageRecord)),
    } : undefined);
    assert.deepEqual(updated.image, initial.image);
    assert.equal(updated.observation.installed.apkLocation, 'data');
    assert.equal(updated.beforeReceiptSha256, hash(readFileSync(before)), 'after links the actual baseline bytes');

    const nextBefore = path.join(directory, distribution + '-followup-before.json');
    const nextAfter = path.join(directory, distribution + '-followup-after.json');
    run('before', nextBefore, ['--distribution', distribution, '--previous', after], true);
    run('after', nextAfter, ['--before', nextBefore], true);
    const followingBaseline = JSON.parse(readFileSync(nextBefore)), followingUpdate = JSON.parse(readFileSync(nextAfter));
    assert.equal(followingBaseline.previousReceiptSha256, hash(readFileSync(after)), 'follow-up links the actual previous after bytes');
    assert.deepEqual(followingBaseline.observation, updated.observation, 'the prior phone, image, HOME and installed APK remain exact');
    assert.deepEqual(followingUpdate.image, initial.image);
    assert.equal(followingUpdate.beforeReceiptSha256, hash(readFileSync(nextBefore)));
    assert.equal(followingUpdate.observation.installed.versionCode, secondManifest.versionCode);
    assert.equal(followingUpdate.observation.installed.sha256, secondManifest.sha256);
    assert.equal(followingUpdate.observation.installed.firstInstallTime, initial.observation.installed.firstInstallTime);
    chains.set(distribution, [before, after, nextBefore, nextAfter]);
  }

  const replacedReceipt = path.join(directory, 'changed-apk.json');
  assert.throws(() => execFileSync(process.execPath, [realpathSync(output), 'before',
    '--serial', 'fixture-phone', '--apk-manifest', manifests.get(7), '--out', replacedReceipt, '--distribution', 'sideload'], {
    encoding: 'utf8', timeout: 30_000, stdio: 'pipe', env: {...process.env, FIXTURE_DISTRIBUTION: 'sideload',
      FIXTURE_FOLLOWUP: '0', FIXTURE_REPLACE_APK: '1'},
  }), error => /changed after APK admission/.test(error.stderr));
  assert.equal(existsSync(replacedReceipt), false);

  const sideload = chains.get('sideload'), image = chains.get('image-preinstalled');
  const read = file => JSON.parse(readFileSync(file));
  const digest = file => hash(readFileSync(file));
  const expected = {
    schema: 'alpha-wireless-launcher-matrix/v1', packageName,
    releases: [sideload[1], sideload[3]].map(file => {
      const {offer, sdkCommit} = read(file);
      return {offer, sdkCommit};
    }),
    receipts: {sideload: sideload.map(digest), imagePreinstalled: image.map(digest)},
  };
  const runMatrix = (stock, signed, report) => execFileSync(process.execPath,
    [realpathSync(output), 'matrix', '--out', report,
      ...stock.flatMap(file => ['--sideload', file]), ...signed.flatMap(file => ['--image-preinstalled', file])],
    {encoding: 'utf8', timeout: 30_000, stdio: 'pipe'});
  const report = path.join(directory, 'matrix.json');
  assert.deepEqual(verifyWirelessLauncherMatrix(sideload, image), expected);
  runMatrix(sideload, image, report);
  assert.deepEqual(read(report), expected);

  const wrongLink = path.join(directory, 'wrong-after-link.json');
  writeFileSync(wrongLink, JSON.stringify({...read(sideload[3]), beforeReceiptSha256: digest(sideload[0])}));
  const broken = [...sideload.slice(0, 3), wrongLink];
  assert.throws(() => verifyWirelessLauncherMatrix(broken, image), /does not link to its before receipt/);

  function withDifferentManifest(chain, label) {
    const linked = [];
    for (const [index, file] of chain.entries()) {
      const receipt = read(file);
      if (index < 2) receipt.offer.manifestSha256 = hash('same APK, different manifest bytes');
      if (index === 1 || index === 3) receipt.beforeReceiptSha256 = digest(linked[index - 1]);
      if (index === 2) receipt.previousReceiptSha256 = digest(linked[1]);
      const copy = path.join(directory, `${label}-${index}.json`);
      writeFileSync(copy, JSON.stringify(receipt));
      linked.push(copy);
    }
    return linked;
  }
  const otherImage = withDifferentManifest(image, 'other-image');
  const otherSideload = withDifferentManifest(sideload, 'other-sideload');
  assert.doesNotThrow(() => verifyWirelessLauncherMatrix(otherSideload, otherImage), 'both alternate chains are internally valid');
  assert.throws(() => verifyWirelessLauncherMatrix(sideload, otherImage), /same two published releases/);

  for (const [label, stock, signed, problem] of [
    ['wrong-link', broken, image, /does not link to its before receipt/],
    ['different-manifest', sideload, otherImage, /same two published releases/],
    ['swapped', image, sideload, /Expected only sideload receipts/],
    ['short', sideload.slice(0, 3), image, /Expected four sideload receipts/],
  ]) {
    const rejected = path.join(directory, `matrix-${label}.json`);
    assert.throws(() => runMatrix(stock, signed, rejected), error => problem.test(error.stderr));
    assert.equal(existsSync(rejected), false, label);
  }
});
