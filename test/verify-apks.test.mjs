// Integration checks of packaging CLIs and archived APK bytes.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { archiveWebPayload, readBuildFlags, verifyOwnerRouteTable } from "../scripts/apk.mjs";
const root = path.resolve(import.meta.dirname, "..");
test("Cloud QA evidence requires one explicit Cloud profile before any APK work", () => {
  for (const args of [["--cloud-voice-evidence=missing.json"], ["--runtime-profile=cloud", "--cloud-voice-evidence=a.json", "--cloud-voice-evidence=b.json"]]) {
    const result=spawnSync(process.execPath,["scripts/verify-apks.mjs",...args],{cwd:root,encoding:"utf8"});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/Cloud voice evidence requires one explicit Cloud profile/);
  }
});
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
