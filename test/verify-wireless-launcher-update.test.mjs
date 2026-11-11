import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {
  captureLauncher, checkReplacement, readPublicLauncherOffer, verifyPublicLauncherBytes,
} from '../scripts/verify-wireless-launcher-update.ts';
import {appUpdateManifestUrl} from '../scripts/update-channel.ts';

const packageName = 'ai.alphacompute.alphaphone';
const installedPath = '/data/app/~~AA==/ai.alphacompute.alphaphone-X=/base.apk';
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
  'ro.build.fingerprint': 'brand/device/product:17/build/100:user/release-keys',
  'ro.boot.verifiedbootstate': 'green', 'ro.boot.flash.locked': '1', 'ro.boot.vbmeta.digest': 'a'.repeat(64),
};

function deviceReader({
  version = 7, sha256 = 'c'.repeat(64), flags = 'HAS_CODE', initiator = 'com.android.shell',
  appId = 10123, firstInstallTime = '2026-11-01 10:00:00', packagePath = `package:${installedPath}`,
  home = packageName, changeDuringReadback = false, serial = 'fixture-phone', sdk = '37',
} = {}) {
  let dumps = 0;
  const adb = args => {
    if (args[0] === 'get-state') return 'device';
    assert.equal(args[0], 'shell', 'acceptance capture only uses read commands');
    if (args[1] === 'getprop' && args[2] === 'ro.build.version.sdk') return sdk;
    if (args[1] === 'getprop' && Object.hasOwn(props, args[2])) return props[args[2]];
    switch (args.slice(1, 3).join(' ')) {
      case 'am get-current-user': return '0';
      case 'cmd role': return home;
      case 'cmd package': return `priority=0\n${home}/.MainActivity`;
      case 'pm path': return packagePath;
      case `sha256sum ${installedPath}`: return `${sha256}  ${installedPath}`;
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
  assert.ok(!JSON.stringify(state).includes('fixture-phone'));
  assert.throws(() => readDevice({serial: 'emulator-5554'}), /physical/);
  assert.throws(() => readDevice({sdk: '33'}), /Android 14 or later/);
  assert.equal(readDevice({sdk: '34'}).device.sdk, 34);
  assert.throws(() => readDevice({changeDuringReadback: true}), /changed during readback/);
  assert.throws(() => readDevice({packagePath: `package:${installedPath}\npackage:/data/app/split.apk`}), /one installed base/);
  assert.throws(() => readDevice({packagePath: 'package:/data/app/a;id.apk'}), /one installed base/);
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
      schema: 'alpha-wireless-launcher-readback/v1', phase: 'before', distribution,
      observation: readDevice({flags: image ? 'SYSTEM HAS_CODE' : 'HAS_CODE'}),
      signerRootSha256: signingFamily, offer,
    };
    const flags = image ? 'SYSTEM HAS_CODE UPDATED_SYSTEM_APP' : 'HAS_CODE';
    const after = readDevice({...next, flags});
    checkReplacement(before, after, signingFamily, offer);
    assert.throws(() => checkReplacement(before, readDevice({...next, flags, initiator: 'com.android.shell'}), signingFamily, offer),
      /install initiator/);
    assert.throws(() => checkReplacement(before, readDevice({...next, flags, appId: 54321}), signingFamily, offer), /in-place/);
    assert.throws(() => checkReplacement(before, readDevice({...next, flags, sha256: 'd'.repeat(64)}), signingFamily, offer), /advancing/);
    assert.throws(() => checkReplacement(before, after, signingFamily, {...offer, manifestSha256: 'f'.repeat(64)}), /offer changed/);
    assert.throws(() => checkReplacement(before, after, 'f'.repeat(64), offer), /signing family/);
    assert.throws(() => checkReplacement(before, readDevice({...next, flags, serial: 'other-phone'}), signingFamily, offer), /Device or OS/);
    if (image) assert.throws(() => checkReplacement(before, readDevice({...next, flags: 'SYSTEM HAS_CODE'}), signingFamily, offer), /provenance/);
  }
});

test('the before and after CLI use one reviewed signer policy through both APK admission boundaries', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'alpha-wireless-cli-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const entry = fileURLToPath(new URL('../scripts/verify-wireless-launcher-update.ts', import.meta.url));
  const policy = pathToFileURL(fileURLToPath(new URL('../scripts/update-apk-admission.ts', import.meta.url))).href;
  const provision = pathToFileURL(fileURLToPath(new URL('../scripts/provision-unit.ts', import.meta.url))).href;
  const output = path.join(directory, 'scripts', 'wireless.mjs');
  mkdirSync(path.dirname(output));
  writeFileSync(path.join(directory, 'app.config.json'), JSON.stringify({updateManifestUrl: publicUrl}));
  const prelude = `
    globalThis.wirelessPolicy = {signerSha256:${JSON.stringify(signingFamily)}};
    globalThis.wirelessCalls = [];
    globalThis.fetch = async (url, options) => {
      if (options.redirect !== 'manual' || options.headers.authorization) throw Error('Unexpected public transport');
      if (url === ${JSON.stringify(publicUrl)}) return new Response(${JSON.stringify(pointer.bytes.toString())});
      if (url === ${JSON.stringify(manifest.apkUrl)}) return new Response(Buffer.from(${JSON.stringify([...apk])}));
      throw Error('No network port for ' + url);
    };
  `;
  const ports = {
    './build-android.ts': `export function readReleaseSigner() {
      globalThis.wirelessCalls.push('signer'); return globalThis.wirelessPolicy;
    }`,
    './provision-unit.ts': `
      import assert from 'node:assert/strict';
      export {PACKAGE, packageFacts, deviceFacts} from ${JSON.stringify(provision)};
      const packageName=${JSON.stringify(packageName)}, installedPath=${JSON.stringify(installedPath)}, props=${JSON.stringify(props)};
      ${deviceReader.toString()}
      const after=process.argv[2]==='after', image=process.env.FIXTURE_DISTRIBUTION==='image-preinstalled';
      const versionCode=after?8:7, digest=after?${JSON.stringify(hash(apk))}:${JSON.stringify('c'.repeat(64))};
      export function adbFor(serial) {
        assert.equal(serial,'fixture-phone');
        return deviceReader({version:versionCode,sha256:digest,initiator:after?packageName:'com.android.shell',
          flags:image?(after?'SYSTEM HAS_CODE UPDATED_SYSTEM_APP':'SYSTEM HAS_CODE'):'HAS_CODE'});
      }
      export function admitUnitApk(_file, selection, options={}) {
        assert.deepEqual(selection,{variant:'launcher',build:'release'});
        // The real manifest admission has its own default reader. Inspection still
        // needs the policy passed explicitly, which its real identity guard checks below.
        assert.equal(options.descriptor??globalThis.wirelessPolicy,globalThis.wirelessPolicy);
        globalThis.wirelessCalls.push('manifest');
        return {file:'closed-fixture.apk',sha256:digest,variant:'launcher',build:'release',versionCode};
      }
      export function apkRuntimeIdentity() {return {runtime:'PACKAGED',base:'d'.repeat(40)};}
    `,
    './update-apk-admission.ts': `
      import {admitUpdateApkIdentity} from ${JSON.stringify(policy)};
      export function inspectUpdateApk(apk, options={}) {
        globalThis.wirelessCalls.push('inspection');
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
    banner: {js: prelude}, footer: {js: "if(process.exitCode!==1&&JSON.stringify(globalThis.wirelessCalls)!==JSON.stringify(['signer','manifest','inspection']))throw Error('Signer policy was not read once and shared by both admissions');"},
    plugins: [{name: 'closed-readback-ports', setup(builder) {
      builder.onResolve({filter: /.*/}, args => {
        if (args.kind === 'entry-point') return;
        if (args.importer === entry && Object.hasOwn(ports, args.path)) return {path: args.path, namespace: 'closed'};
        if (args.path.startsWith('node:') || args.path.startsWith('file:')) return {path: args.path, external: true};
        return {path: pathToFileURL(path.resolve(path.dirname(args.importer), args.path)).href, external: true};
      });
      builder.onLoad({filter: /.*/, namespace: 'closed'}, args => ({contents: ports[args.path], loader: 'js'}));
    }}]});
  for (const distribution of ['sideload', 'image-preinstalled']) {
    const before = path.join(directory, distribution + '-before.json'), after = path.join(directory, distribution + '-after.json');
    const run = (phase, receipt, extra) => execFileSync(process.execPath, [realpathSync(output), phase, '--serial', 'fixture-phone',
      '--apk-manifest', 'closed-apk-manifest.json', '--out', receipt, ...extra], {
      encoding: 'utf8', timeout: 30_000, env: {...process.env, FIXTURE_DISTRIBUTION: distribution},
    });
    run('before', before, ['--distribution', distribution]);
    run('after', after, ['--before', before]);
    const initial = JSON.parse(readFileSync(before)), updated = JSON.parse(readFileSync(after));
    assert.equal(initial.phase, 'before');
    assert.equal(updated.phase, 'after');
    assert.equal(updated.signerRootSha256, signingFamily);
    assert.equal(updated.observation.installed.initiator, packageName);
    assert.equal(updated.observation.installed.sha256, manifest.sha256);
    assert.equal(updated.observation.installed.firstInstallTime, initial.observation.installed.firstInstallTime);
  }
});
