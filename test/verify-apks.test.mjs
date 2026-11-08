// Integration checks of packaging CLIs and archived APK bytes.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { archiveWebPayload, parseXmlTree, readBuildFlags, verifyOwnerRouteTable } from "../scripts/apk.mjs";
import { webViewFilterProblems, webViewFilters } from "../scripts/render-assetlinks.mjs";
import { voiceBundleAdmission } from "../scripts/voice-host.mjs";
const root = path.resolve(import.meta.dirname, "..");
/** Copy the committed AOSP product files into `dir` with every unset value filled, so production staging passes its lock check. */
function completeAospLock(dir) {
  const read = rel => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
  const write = (rel, value) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), JSON.stringify(value)); };
  const product = read("android/aosp/product.json");
  write("android/aosp/product.json", { ...product, hostPackages: product.hostPackages.map(pkg => ({ ...pkg, version: "1.0.0", sha256: "e".repeat(64) })),
    signer: { ...product.signer, platformCertificateSha256: "c".repeat(64) } });
  write(product.brandConfig, read(product.brandConfig));
  write(product.sourceLock.file, read(product.sourceLock.file));
  write("android/release-signer.json", { ...read("android/release-signer.json"), signerSha256: "d".repeat(64) });
}
function zip(file, entries) {
  execFileSync("python3", ["-c", "import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n for k,v in json.loads(sys.argv[2]).items(): z.writestr(k,v)", file, JSON.stringify(entries)]);
}

test("packaged-runtime verification refuses unpackaged releases unless explicitly allowed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-runtime-"));
  try {
    fs.mkdirSync(path.join(dir, "scripts"));
    fs.copyFileSync(path.join(root, "scripts/verify-packaged-runtime.py"), path.join(dir, "scripts/verify-packaged-runtime.py"));
    const release = path.join(dir, "launcher-release-unsigned.apk");
    const debug = path.join(dir, "launcher-debug.apk");
    zip(release, { "classes.dex": "app" });
    zip(debug, { "classes.dex": "app" });
    const run = args => spawnSync("python3", [path.join(dir, "scripts/verify-packaged-runtime.py"), ...args], { encoding: "utf8" });
    const strict = run(["--release", release, debug]);
    assert.equal(strict.status, 3, strict.stderr);
    assert.match(strict.stderr, /not distributable/);
    const report = JSON.parse(strict.stdout);
    assert.equal(report[0].runtime, "NOT_PACKAGED");
    assert.equal(report[0].distributable, false);
    const allowed = run(["--allow-unpackaged-runtime", "--release", release, debug]);
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.equal(JSON.parse(allowed.stdout)[0].distributable, false);
    const debugOnly = run([debug]);
    assert.equal(debugOnly.status, 0, debugOnly.stderr);
    assert.equal(JSON.parse(debugOnly.stdout)[0].runtime, "NOT_PACKAGED");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AOSP staging refuses test-mocks and non-distributable inputs before any staging", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-stage-"));
  try {
    fs.copyFileSync(path.join(root, "app.config.json"), path.join(dir, "app.config.json"));
    completeAospLock(dir);
    fs.mkdirSync(path.join(dir, "artifacts/test-mocks"), { recursive: true });
    const stage = args => spawnSync(process.execPath, [path.join(root, "scripts/stage-aosp.mjs"), ...args], { cwd: dir, encoding: "utf8" });
    const flagOn = path.join(dir, "artifacts/test-mocks/launcher-debug.apk");
    zip(flagOn, { "assets/public/build-flags.json": JSON.stringify({ testMocks: true }) });
    let out = stage(["--apk", flagOn, "--development"]);
    assert.notEqual(out.status, 0);
    assert.match(out.stderr, /artifacts\/test-mocks\/ builds are never staged/);
    const copied = path.join(dir, "copied.apk");
    fs.copyFileSync(flagOn, copied);
    out = stage(["--apk", copied, "--development"]);
    assert.match(out.stderr, /built with test mocks enabled/);
    const unflagged = path.join(dir, "old.apk");
    zip(unflagged, { "classes.dex": "app" });
    assert.match(stage(["--apk", unflagged, "--development"]).stderr, /test-mocks flag is unverified/);
    const release = path.join(dir, "artifacts/launcher-release-unsigned.apk");
    zip(release, { "assets/public/build-flags.json": JSON.stringify({ testMocks: false }) });
    const sha256 = createHash("sha256").update(fs.readFileSync(release)).digest("hex");
    fs.writeFileSync(path.join(dir, "artifacts/apk-manifest.json"), JSON.stringify({ testMocks: false, results: [{ file: "artifacts/launcher-release-unsigned.apk", mode: "release", sha256, runtime: "NOT_PACKAGED", distributable: false, signed: false }] }));
    assert.match(stage(["--apk", release, "--development"]).stderr, /not distributable/);
    assert.match(stage(["--apk", release, "--descriptor", "reviewed.json"]).stderr, /not distributable/);
    // Each recorded blocker is named, in development and production staging alike.
    // Production staging re-judges the row against the committed signer, so the row records the signer it was signed with.
    const full = { file: "artifacts/launcher-release-unsigned.apk", mode: "release", sha256, testMocks: false, bundleAudit: "passed", signed: true, signerSha256: "d".repeat(64), runtime: "PACKAGED", runtimeNotices: true,
      releaseAdmission: { failures: [], blockers: [], signerMatches: true }, voiceHost: { packaged: true, asr: true, differences: [], qualified: true }, licenceBlockers: [] };
    const record = row => fs.writeFileSync(path.join(dir, "artifacts/apk-manifest.json"), JSON.stringify({ testMocks: false, results: [{ ...full, ...row }] }));
    const font = "unresolved-font-licence: Denton typeface (assets/denton.woff2) has no recorded embedding licence";
    record({ distributable: false, licenceBlockers: [font], voiceHost: { packaged: true, asr: true, differences: [], qualified: false } });
    for (const mode of [["--development"], ["--descriptor", "reviewed.json", "--production"]]) {
      out = stage(["--apk", release, ...mode]);
      assert.notEqual(out.status, 0);
      assert.match(out.stderr, /not distributable[\s\S]*- unqualified on-device voice \(device qualification pending\)/);
      // The Denton font check is flag-only (P-09, A-21): recorded on the row, never cited as a blocker.
      assert.doesNotMatch(out.stderr, /unresolved-font-licence/);
    }
    // A release flagged distributable whose recorded facts still hold a blocker is not staged either.
    record({ distributable: true, licenceBlockers: [font], runtimeNotices: false });
    assert.match(stage(["--apk", release, "--descriptor", "reviewed.json", "--production"]).stderr, /not distributable[\s\S]*notices lack the packaged runtime/);
    assert.match(stage(["--apk", release, "--development"]).stderr, /notices lack the packaged runtime/);
    // The recorded font item alone does not make staging cite a licence blocker.
    record({ distributable: true, licenceBlockers: [font] });
    assert.doesNotMatch(stage(["--apk", release, "--descriptor", "reviewed.json", "--production"]).stderr, /unresolved-font-licence|not distributable/);
    // A recorded admission does not outlive the committed signer: another certificate is refused in production staging.
    record({ distributable: true, signerSha256: "e".repeat(64) });
    assert.match(stage(["--apk", release, "--descriptor", "reviewed.json", "--production"]).stderr, /not distributable[\s\S]*does not match android\/release-signer\.json/);
    // A release cannot be staged as a development input by hiding its row: relabelled "debug", recorded for
    // other bytes, or with the manifest pointed elsewhere. Only a debuggable build passes without a release row.
    const onlyDebugBuilds = /--development stages debug builds only/;
    record({ mode: "debug", distributable: undefined });
    assert.match(stage(["--apk", release, "--development"]).stderr, onlyDebugBuilds);
    record({ sha256: "0".repeat(64), distributable: true });
    assert.match(stage(["--apk", release, "--development"]).stderr, onlyDebugBuilds);
    assert.match(stage(["--apk", release, "--development", "--apk-manifest", path.join(dir, "absent.json")]).stderr, onlyDebugBuilds);
    fs.writeFileSync(path.join(dir, "broken.json"), "{ not json");
    out = stage(["--apk", release, "--development", "--apk-manifest", path.join(dir, "broken.json")]);
    assert.notEqual(out.status, 0);
    assert.doesNotMatch(out.stdout, /staging evidence/);
    // Production staging still needs a manifest row: an APK verify-apks never recorded is refused.
    fs.rmSync(path.join(dir, "artifacts/apk-manifest.json"));
    assert.match(stage(["--apk", release, "--development"]).stderr, onlyDebugBuilds);
    assert.match(stage(["--apk", release, "--descriptor", "reviewed.json", "--production"]).stderr, /Production staging requires a release APK that verify-apks recorded as distributable/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AOSP staging refuses --production without a descriptor, with --development, or with a foreign descriptor", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-stage-refusals-"));
  try {
    fs.copyFileSync(path.join(root, "app.config.json"), path.join(dir, "app.config.json"));
    completeAospLock(dir);
    const stage = args => spawnSync(process.execPath, [path.join(root, "scripts/stage-aosp.mjs"), ...args], { cwd: dir, encoding: "utf8" });
    // The missing-APK message says which staging was asked for.
    assert.match(stage(["--development"]).stderr, /Development staging: supply --apk PATH to a flag-off debug launcher APK\./);
    assert.match(stage(["--descriptor", "reviewed.json", "--production"]).stderr, /Production staging: supply --apk PATH to the signed launcher release APK that verify-apks recorded as distributable\./);
    assert.match(stage([]).stderr, /Production staging: supply --apk PATH/);
    let out = stage(["--apk", "absent.apk", "--production"]);
    assert.notEqual(out.status, 0);
    assert.match(out.stderr, /--production requires --descriptor FILE/);
    out = stage(["--apk", "absent.apk", "--descriptor", "reviewed.json", "--production", "--development"]);
    assert.notEqual(out.status, 0);
    assert.match(out.stderr, /--production and --development are exclusive/);
    // A distributable release passes admission; a descriptor for another package or module is then refused.
    fs.mkdirSync(path.join(dir, "artifacts"));
    const release = path.join(dir, "artifacts/launcher-release.apk");
    zip(release, { "assets/public/build-flags.json": JSON.stringify({ testMocks: false }) });
    const sha256 = createHash("sha256").update(fs.readFileSync(release)).digest("hex");
    fs.writeFileSync(path.join(dir, "artifacts/apk-manifest.json"), JSON.stringify({ testMocks: false, results: [{ file: "artifacts/launcher-release.apk", mode: "release", sha256,
      testMocks: false, bundleAudit: "passed", signed: true, signerSha256: "d".repeat(64), runtime: "PACKAGED", runtimeNotices: true, distributable: true, licenceBlockers: [],
      releaseAdmission: { failures: [], blockers: [], signerMatches: true }, voiceHost: { packaged: true, asr: true, differences: [], qualified: true } }] }));
    const identity = JSON.parse(fs.readFileSync(path.join(root, "app.config.json"), "utf8"));
    for (const [name, foreign] of [["package", { packageName: "ai.elizaos.app", moduleName: identity.moduleName }], ["module", { packageName: identity.appId, moduleName: "Eliza" }]]) {
      fs.writeFileSync(path.join(dir, "foreign.json"), JSON.stringify({ schemaVersion: 1, apkSha256: sha256, certificateSha256: "d".repeat(64), ...foreign }));
      out = stage(["--apk", release, "--descriptor", "foreign.json", "--production"]);
      assert.notEqual(out.status, 0, name);
      assert.match(out.stderr, /Descriptor does not belong to this product: packageName .* must be ai\.elizaresearch\.alphaphone and AlphaPhone \(app\.config\.json\)/, name);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("APK verification requires the packaged owner route table to be config/owner-routes.json byte for byte", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-owner-routes-apk-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const table = fs.readFileSync(path.join(root, "config/owner-routes.json"), "utf8"), apk = path.join(dir, "app.apk");
  zip(apk, { "classes.dex": "app", "assets/owner-routes.json": table });
  verifyOwnerRouteTable(apk);
  zip(apk, { "classes.dex": "app" });
  assert.throws(() => verifyOwnerRouteTable(apk), /assets\/owner-routes\.json is missing/);
  for (const other of [table + "\n", table.replace("/api/approvals?", "/api/approvals/x?"), ""]) {
    zip(apk, { "assets/owner-routes.json": other });
    assert.throws(() => verifyOwnerRouteTable(apk), /assets\/owner-routes\.json differs from config\/owner-routes\.json/);
  }
});

for (const testMocks of [false, true]) test(`archive retains actual APK web bytes with testMocks=${testMocks}`, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-archive-web-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const publicDir = path.join(dir, 'assets/public');
  fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'build-flags.json'), JSON.stringify({ testMocks }));
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<html>Actual APK payload</html>');
  const apkFile = path.join(dir, 'app.apk');
  execFileSync('zip', ['-q', '-r', apkFile, 'assets'], { cwd: dir });
  // Working assets may be restored to a different mode after the APK was built.
  fs.writeFileSync(path.join(publicDir, 'build-flags.json'), JSON.stringify({ testMocks: !testMocks }));
  const archived = path.join(dir, 'archived-web');
  archiveWebPayload(apkFile, archived, { testMocks });
  assert.equal(readBuildFlags(archived).testMocks, testMocks);
  assert.equal(fs.readFileSync(path.join(archived, 'index.html'), 'utf8'), '<html>Actual APK payload</html>');
  assert.throws(() => archiveWebPayload(apkFile, path.join(dir, 'wrong-mode'), { testMocks: !testMocks }), /testMocks/);
  assert.equal(fs.existsSync(path.join(dir, 'wrong-mode')), false);
});

// Exercise the archive CLI, its child environments and real ZIP retention without
// running Gradle. Only the Android builder and source snapshot are fixture commands.
for (const mode of ['native', 'test-mocks', 'cloud', 'wrong-cloud-profile']) test(`build archive preserves its selected runtime profile: ${mode}`, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-build-archive-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  for (const name of ['scripts', 'bin']) fs.mkdirSync(path.join(dir, name));
  fs.symlinkSync(path.join(root, 'scripts/audit-production-bundle.mjs'), path.join(dir, 'scripts/audit-production-bundle.mjs'));
  fs.writeFileSync(path.join(dir, 'scripts/stage-local-agent-sources.mjs'), '');
  // The generated Gradle host is written before the source snapshot; the stub stands in for it.
  fs.writeFileSync(path.join(dir, 'scripts/android-host.mjs'), '');
  fs.writeFileSync(path.join(dir, 'scripts/source-snapshot.mjs'), 'console.log(JSON.stringify({digest:"synthetic-stable-source"}));');
  fs.writeFileSync(path.join(dir, 'bin/npm'), `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const args=process.argv.slice(2), profile=process.env.VITE_ELIZA_RUNTIME_PROFILE||'native';
const mocks=process.env.ELIZA_DEV_ALLOW_TEST_MOCKS==='1';
fs.appendFileSync('calls.jsonl',JSON.stringify({args,profile,mocks})+'\\n');
if(args[1]==='android:build'){
 const output=mocks?'artifacts/test-mocks':'artifacts';
 fs.mkdirSync(output,{recursive:true});
 fs.mkdirSync('payload/assets/public',{recursive:true});
 fs.writeFileSync('payload/assets/public/build-flags.json',JSON.stringify({testMocks:mocks,runtimeProfile:profile}));
 fs.writeFileSync('payload/assets/public/index.html','<html>Synthetic build payload</html>');
 const results=[];
 for(const variant of ['standalone','launcher']){
  for(const suffix of ['debug','release-unsigned']){
   const file=path.join(output,variant+'-'+suffix+'.apk');
   execFileSync('zip',['-q','-r',path.resolve(file),'assets'],{cwd:'payload'});
   results.push({file,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
  }
  const file=mocks?path.join(output,variant+'-androidTest.apk'):'android/app/build/outputs/apk/androidTest/'+variant+'/debug/app-'+variant+'-debug-androidTest.apk';
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'synthetic instrumentation');
 }
 fs.writeFileSync(path.join(output,'apk-manifest.json'),JSON.stringify({testMocks:mocks,runtimeProfile:process.env.FIXTURE_WRONG_PROFILE?'native':profile,results}));
}
`, {mode:0o755});
  const cloud = mode.includes('cloud'), testMocks = mode === 'test-mocks';
  const args = cloud ? ['--runtime-profile=cloud'] : testMocks ? ['--test-mocks'] : [];
  const env = {...process.env, PATH:path.join(dir, 'bin')+path.delimiter+process.env.PATH};
  for (const name of ['ELIZA_DEV_ALLOW_TEST_MOCKS', 'VITE_ELIZA_DEV_ALLOW_TEST_MOCKS', 'ORG_GRADLE_PROJECT_ELIZA_DEV_ALLOW_TEST_MOCKS', 'FIXTURE_WRONG_PROFILE']) delete env[name];
  if (cloud) Object.assign(env, {ELIZA_DEV_ALLOW_TEST_MOCKS:'1', VITE_ELIZA_DEV_ALLOW_TEST_MOCKS:'1', ORG_GRADLE_PROJECT_ELIZA_DEV_ALLOW_TEST_MOCKS:'1'});
  if (mode === 'wrong-cloud-profile') env.FIXTURE_WRONG_PROFILE='1';
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/build-archive.mjs'), ...args, 'test-results/archive'], {cwd:dir, env, encoding:'utf8'});
  const archive = path.join(dir, 'test-results/archive');
  if (mode === 'wrong-cloud-profile') {
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Verified APK runtime profile differs from archive/);
    assert.ok(!fs.existsSync(path.join(archive, 'apk-manifest.json')));
    return;
  }
  assert.equal(run.status, 0, run.stderr);
  const calls = fs.readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(calls.map(row => row.args[1]), ['android:sync', 'verify', 'android:build']);
  assert.ok(calls.every(row => row.profile === (cloud ? 'cloud' : 'native')));
  assert.equal(calls[1].mocks, false, 'verification stays flag-off even for a fixture archive');
  assert.equal(calls[0].mocks, testMocks);
  assert.equal(calls[2].mocks, testMocks);
  assert.deepEqual(calls[2].args, ['run', 'android:build', ...(args.length ? ['--', ...args] : [])]);
  const configuration = JSON.parse(fs.readFileSync(path.join(archive, 'configuration.json')));
  assert.equal(configuration.runtimeProfile, cloud ? 'cloud' : 'native');
  assert.equal(configuration.testMocks, testMocks);
  const manifest = JSON.parse(fs.readFileSync(path.join(archive, 'apk-manifest.json')));
  assert.equal(Object.keys(manifest).length, 6);
  for (const [name, expected] of Object.entries(manifest)) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(archive, name))).digest('hex'), expected);
  const flags = JSON.parse(fs.readFileSync(path.join(archive, 'web-dist/build-flags.json')));
  assert.equal(flags.runtimeProfile, cloud ? 'cloud' : 'native');
  assert.equal(flags.testMocks, testMocks);
});

test('archive rejects Cloud mocks and unsupported profile switches before creating output', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-build-archive-invalid-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  for (const args of [['--runtime-profile=cloud', '--test-mocks'], ['--runtime-profile=other'], ['--allow-unpackaged-runtime']]) {
    const run = spawnSync(process.execPath, [path.join(root, 'scripts/build-archive.mjs'), ...args, 'test-results/archive'], {cwd:dir, encoding:'utf8'});
    assert.notEqual(run.status, 0);
    assert.ok(!fs.existsSync(path.join(dir, 'test-results')));
  }
});

test("APK voice admission requires the complete recorded bundle and every recorded engine library", () => {
  const sha = bytes => createHash("sha256").update(bytes).digest("hex");
  const bytes = { "tts/paradee/paradee.gguf": "tts", "tts/paradee/misaki.lex": "lex", "vad/silero.gguf": "vad", "asr/phonon.gguf": "asr" };
  const row = (file, role) => ({ path: file, role, sha256: sha(bytes[file]), bytes: bytes[file].length });
  const library = (name, value) => ({ name, sha256: sha(value), bytes: value.length });
  const host = {
    qualified: true,
    models: [row("tts/paradee/paradee.gguf", "tts-model"), row("tts/paradee/misaki.lex", "g2p-lexicon"), row("vad/silero.gguf", "vad-model"), row("asr/phonon.gguf", "asr-model")],
    asrSlot: { paths: ["asr/phonon.gguf"] },
    abis: [{ abi: "x86_64", libraries: [library("libelizainference.so", "engine"), library("libc++_shared.so", "stl")] }],
  };
  const apk = (change = () => {}, listed = Object.keys(bytes)) => {
    const files = { "lib/x86_64/libparadeevoicejni.so": "jni", "lib/x86_64/libelizainference.so": "engine", "lib/x86_64/libc++_shared.so": "stl",
      "assets/paradee-voice/v1/manifest.json": JSON.stringify({ format: "eliza-paradee-voice-v1", files: listed.map(file => ({ path: file })) }) };
    for (const file of listed) files[`assets/paradee-voice/v1/${file}`] = bytes[file];
    change(files);
    return { names: Object.keys(files), read: entry => Buffer.from(files[entry]) };
  };
  assert.deepEqual(voiceBundleAdmission(apk(), host), { packaged: true, asr: true, differences: [], qualified: true });
  assert.deepEqual(voiceBundleAdmission({ names: ["classes.dex"], read: () => null }, host), { packaged: false, asr: false, differences: [], qualified: false });
  // Without the ASR slot the bundle is admitted, but asr:false keeps a release distributable:false (verify-apks).
  const noAsr = voiceBundleAdmission(apk(undefined, Object.keys(bytes).filter(file => !file.startsWith("asr/"))), host);
  assert.deepEqual(noAsr.differences, []);
  assert.equal(noAsr.asr, false);
  // A manifest that lists a subset of the non-ASR files, or none, is a difference.
  assert.match(voiceBundleAdmission(apk(undefined, ["tts/paradee/paradee.gguf", "asr/phonon.gguf"]), host).differences.join(), /misaki\.lex: recorded voice file is not packaged.*silero\.gguf: recorded voice file is not packaged/);
  const empty = voiceBundleAdmission(apk(files => { files["assets/paradee-voice/v1/manifest.json"] = JSON.stringify({ format: "eliza-paradee-voice-v1", files: [] }); }, []), host);
  assert.equal(empty.differences.length, 3);
  // A differing libc++_shared.so beside the pinned engine is reported, not only the engine.
  assert.deepEqual(voiceBundleAdmission(apk(files => { files["lib/x86_64/libc++_shared.so"] = "other"; }), host).differences,
    ["lib/x86_64/libc++_shared.so: differs from the recorded voice host library"]);
  assert.match(voiceBundleAdmission(apk(files => { delete files["lib/x86_64/libc++_shared.so"]; }), host).differences.join(), /libc\+\+_shared\.so: differs/);
  assert.match(voiceBundleAdmission(apk(files => { files["assets/paradee-voice/v1/vad/silero.gguf"] = "changed"; }), host).differences.join(), /silero\.gguf: differs from the recorded bytes/);
  assert.match(voiceBundleAdmission(apk(files => { files["assets/paradee-voice/v1/extra.bin"] = "x"; }), host).differences.join(), /extra\.bin: unlisted voice entry/);
  // A two-file ASR slot is all or nothing.
  bytes["asr/mmproj.gguf"] = "mmproj";
  const pair = { ...host, models: [...host.models, row("asr/mmproj.gguf", "asr-mmproj")], asrSlot: { paths: ["asr/phonon.gguf", "asr/mmproj.gguf"] } };
  assert.match(voiceBundleAdmission(apk(undefined, ["tts/paradee/paradee.gguf", "tts/paradee/misaki.lex", "vad/silero.gguf", "asr/phonon.gguf"]), pair).differences.join(), /ASR slot is incomplete \(asr\/mmproj\.gguf missing\)/);
  assert.equal(voiceBundleAdmission(apk(), pair).asr, true);
});


// A merged-manifest xmltree with the product.gradle overlay's three filters on MainActivity.
function webFilterTree(extra = "") {
  const attr = (name, value, indent) => `${" ".repeat(indent)}A: http://schemas.android.com/apk/res/android:${name}(0x01010000)="${value}" (Raw: "${value}")`;
  const filter = data => ["      E: intent-filter (line=4)", "        A: http://schemas.android.com/apk/res/android:autoVerify(0x010104ee)=(type 0x12)0xffffffff",
    "        E: action (line=5)", attr("name", "android.intent.action.VIEW", 10),
    "        E: category (line=6)", attr("name", "android.intent.category.BROWSABLE", 10),
    "        E: data (line=7)", ...Object.entries(data).map(([name, value]) => attr(name, value, 10))].join("\n");
  return ["E: manifest (line=1)", '  A: package="ai.elizaresearch.alphaphone" (Raw: "ai.elizaresearch.alphaphone")', "  E: application (line=2)",
    "    E: activity (line=3)", attr("name", "ai.elizaresearch.alphaphone.MainActivity", 6),
    filter({scheme: "https", host: "eliza.app", pathPrefix: "/alphaphone/cloud-delegation"}),
    filter({scheme: "https", host: "eliza.app", path: "/alphaphone/auth/callback"}),
    filter({scheme: "https", host: "eliza.app", path: "/alphaphone/gmail/callback"}),
    // A custom-scheme return is not a web handler.
    filter({scheme: "alphaphone", host: "cloud-delegation"}),
    extra].join("\n");
}
const allowedWebFilters = ["/alphaphone/cloud-delegation*", "/alphaphone/auth/callback", "/alphaphone/gmail/callback"]
  .map(shape => `ai.elizaresearch.alphaphone.MainActivity https://eliza.app${shape}`);

test("APK verification accepts exactly the allowed web VIEW filters", () => {
  const tree = parseXmlTree(webFilterTree());
  assert.deepEqual(webViewFilters(tree), [...allowedWebFilters].sort());
  assert.deepEqual(webViewFilterProblems(tree, allowedWebFilters), []);
  assert.deepEqual(webViewFilterProblems(tree, [...allowedWebFilters, "ai.elizaresearch.alphaphone.MainActivity https://staging.eliza.app/alphaphone/auth/callback"]),
    ["Missing web VIEW intent filter ai.elizaresearch.alphaphone.MainActivity https://staging.eliza.app/alphaphone/auth/callback"]);
});

test("APK verification rejects and names an extra web VIEW filter", () => {
  const broad = ["      E: intent-filter (line=9)", "        E: action (line=10)",
    '          A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.intent.action.VIEW" (Raw: "android.intent.action.VIEW")',
    "        E: data (line=11)",
    '          A: http://schemas.android.com/apk/res/android:scheme(0x01010027)="https" (Raw: "https")',
    '          A: http://schemas.android.com/apk/res/android:host(0x01010028)="eliza.app" (Raw: "eliza.app")',
    '          A: http://schemas.android.com/apk/res/android:pathPrefix(0x0101002b)="/" (Raw: "/")'].join("\n");
  assert.deepEqual(webViewFilterProblems(parseXmlTree(webFilterTree(broad)), allowedWebFilters),
    ["Unexpected web VIEW intent filter ai.elizaresearch.alphaphone.MainActivity https://eliza.app/*; add it to the allowed set in scripts/verify-apks.mjs only if it is deliberate"]);
  // A library activity's handler with no host and no path is reported too.
  const library = ["    E: activity (line=20)",
    '      A: http://schemas.android.com/apk/res/android:name(0x01010003)="com.example.Viewer" (Raw: "com.example.Viewer")',
    broad.replace(/\n.*android:host.*/, "").replace(/\n.*android:pathPrefix.*/, "")].join("\n");
  assert.deepEqual(webViewFilterProblems(parseXmlTree(webFilterTree(library)), allowedWebFilters),
    ["Unexpected web VIEW intent filter com.example.Viewer https://(any host) (any path); add it to the allowed set in scripts/verify-apks.mjs only if it is deliberate"]);
});
