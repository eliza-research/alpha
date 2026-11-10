// Alpha's binding of the shared Pixel 10a release signing, compatibility record and update
// client (issues #399, #400). The signing job, record and update client are tested upstream
// (vendor/eliza/packages/os/scripts/__tests__); these tests establish that Alpha's descriptors,
// channel and APK release signer are the inputs they receive. Releasetools are the upstream
// test doubles and every key is a throwaway value: no signed image, image boot, applied OTA, or
// rollback or recovery drill.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { PIXEL10A_COMPOSITION, PIXEL10A_PRODUCT, PIXEL10A_RELEASE, pixel10aOptions, pixel10aProductProblems } from "../scripts/aosp-pixel10a.mjs";
import { channelDistributionProblems, channelSigningProblems, signRelease, X509_KEYS } from "../scripts/sign-aosp-release.mjs";
import { RECORD_KIND } from "../scripts/aosp-release-record.mjs";
import { releaseBlockers } from "../scripts/release-blockers.mjs";
import { cloudVoiceAdmission } from "../vendor/eliza/packages/os/scripts/android/apk-release-record.mjs";
import { clockActions, clockProductRequirement, verifyAospClockHandlers } from "../scripts/aosp-clock-contract.mjs";
import * as sharedClock from "../vendor/eliza/packages/os/scripts/android/aosp-clock-handlers.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = rel => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const CHANNEL = "android/aosp/pixel10a-ota-channel.json";
const LOCK = PIXEL10A_RELEASE.sourceLockPath;
const DOUBLES = path.join(root, "vendor/eliza/packages/os/scripts/__tests__/fixtures/aosp-releasetools");
const FINGERPRINT = "Alpha/alpha_stallion_phone/stallion:17/CP2A.261005.001/42:user/release-keys";
const DEV = "build/make/target/product/security";

function zip(file, entries) {
  execFileSync("python3", ["-c", "import io,json,sys,zipfile\ndef build(e):\n b=io.BytesIO()\n with zipfile.ZipFile(b,'w') as z:\n  for k,v in e.items(): z.writestr(k, build(v) if isinstance(v,dict) else v)\n return b.getvalue()\nopen(sys.argv[1],'wb').write(build(json.loads(sys.argv[2])))", file, JSON.stringify(entries)]);
}
function temporary(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function certificate(dir, name) {
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-subj", `/CN=alpha-test-${name}`, "-days", "1",
    "-keyout", path.join(dir, `${name}.key.tmp`), "-out", path.join(dir, `${name}.x509.pem`)], { stdio: "ignore" });
  fs.rmSync(path.join(dir, `${name}.key.tmp`));
  fs.chmodSync(path.join(dir, `${name}.x509.pem`), 0o600);
  return sha256(Buffer.from(fs.readFileSync(path.join(dir, `${name}.x509.pem`), "utf8").replace(/-----[^-]+-----|\s/g, ""), "base64"));
}

/** A throwaway key directory in the upstream layout; private files hold a marker, never a key. */
function keyDirectory(t) {
  const keys = temporary(t, "alpha-test-keys-");
  fs.chmodSync(keys, 0o700);
  const platform = certificate(keys, "platform"), releasekey = certificate(keys, "releasekey");
  const write = (name, value) => { fs.writeFileSync(path.join(keys, name), value); fs.chmodSync(path.join(keys, name), 0o600); };
  for (const name of X509_KEYS) {
    if (!["platform", "releasekey"].includes(name)) write(`${name}.x509.pem`, fs.readFileSync(path.join(keys, "releasekey.x509.pem")));
    write(`${name}.pk8`, "TEST-ONLY-PRIVATE-MARKER");
  }
  write("avb.pem", "TEST-ONLY-PRIVATE-MARKER");
  write("avb_pkmd.bin", "test avb public key metadata");
  return { keys, platform, releasekey, avb: sha256(Buffer.from("test avb public key metadata")) };
}

/** A copy of Alpha's release inputs, complete for the given keys. */
function completeRoot(t, { platform, releasekey, avb }) {
  const dir = temporary(t, "alpha-release-root-");
  const write = (rel, value) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), typeof value === "string" ? value : JSON.stringify(value, null, 2)); };
  const lock = JSON.stringify({ schema: 1, target: "pixel10a", device: { codename: "stallion", androidRelease: "17" }, developmentOnly: false, releaseQualified: false, factory: read(LOCK).factory });
  write(LOCK, lock);
  write(PIXEL10A_COMPOSITION, read(PIXEL10A_COMPOSITION));
  const product = read(PIXEL10A_PRODUCT);
  const others = Object.fromEntries(Object.keys(product.signer.releaseCertificates).map(name => [name, releasekey]));
  write(PIXEL10A_PRODUCT, { ...product, sourceLock: { ...product.sourceLock, sha256: sha256(lock) }, signer: { ...product.signer, platformCertificateSha256: platform, releaseCertificates: others }, avb: { ...product.avb, publicKeySha256: avb } });
  write(CHANNEL, { ...read(CHANNEL), otaCertificateSha256: releasekey, avbPublicKeySha256: avb });
  write("android/release-signer.json", { ...read("android/release-signer.json"), signerSha256: "d".repeat(64) });
  return { dir, write };
}

function releasetools(t) {
  const bin = path.join(temporary(t, "alpha-otatools-"), "bin");
  fs.mkdirSync(bin);
  for (const name of ["sign_target_files_apks", "ota_from_target_files", "apksigner"]) { fs.copyFileSync(path.join(DOUBLES, name), path.join(bin, name)); fs.chmodSync(path.join(bin, name), 0o755); }
  return bin;
}

function targetFiles(t) {
  const file = path.join(temporary(t, "alpha-target-files-"), "unsigned-target_files.zip");
  const cert = (name, key) => `name="${name}" certificate="${DEV}/${key}.x509.pem" private_key="${DEV}/${key}.pk8"`;
  zip(file, {
    "SYSTEM/build.prop": `ro.system.build.fingerprint=${FINGERPRINT}\nro.build.version.release=17\nro.build.version.security_patch=2026-10-05\nro.build.date.utc=1790000000\n`,
    "META/misc_info.txt": ["avb_enable=true", "avb_vbmeta_key_path=k.pem", "avb_vbmeta_system_key_path=k.pem", "avb_vbmeta_system_rollback_index_location=1", "avb_vbmeta_vendor_key_path=k.pem", "avb_vbmeta_vendor_rollback_index_location=2"].join("\n") + "\n",
    "META/apkcerts.txt": `${cert("AlphaPhone.apk", "testkey")}\n${cert("Settings.apk", "platform")}\n`,
    "META/apexkeys.txt": "",
    "PRODUCT/app/AlphaPhone/AlphaPhone.apk": { CERT: "0".repeat(64) },
    "SYSTEM/priv-app/Settings/Settings.apk": { CERT: "0".repeat(64) },
  });
  return { file, sha256: sha256(fs.readFileSync(file)) };
}

test("the committed Pixel 10a descriptor admits the app signer but still refuses unset OS inputs and qualification", () => {
  const product = read(PIXEL10A_PRODUCT), channel = read(CHANNEL);
  assert.equal(product.product, "alpha_stallion_phone");
  assert.equal(product.product, read("android/aosp/pixel10a-composition.json").productName);
  assert.deepEqual(product.device, { codename: "stallion", androidRelease: "17" });
  assert.equal(product.releaseQualified, false);
  assert.equal(product.deviceAcceptanceVerified, false);
  assert.equal(product.ota.channel, CHANNEL);
  assert.equal(channel.recovery.stockFactoryImage.sha256, read(LOCK).factory.sha256, "stock recovery is the locked factory archive");
  const problems = pixel10aProductProblems(root);
  assert.match(read("android/release-signer.json").signerSha256, /^[0-9a-f]{64}$/);
  assert.ok(!problems.some(problem => /android\/release-signer\.json signerSha256/.test(problem)), problems.join("\n"));
  assert.ok(problems.some(problem => /platformCertificateSha256 must be a SHA-256/.test(problem)), problems.join("\n"));
  const lockBytes = fs.readFileSync(path.join(root, product.sourceLock.file));
  assert.equal(JSON.parse(lockBytes).developmentOnly, false);
  assert.equal(sha256(lockBytes), product.sourceLock.sha256);
  assert.ok(!problems.some(problem => /sourceLock|developmentOnly/.test(problem)), problems.join("\n"));
  assert.ok(channelSigningProblems(channel, product, CHANNEL, read(LOCK)).some(problem => /otaCertificateSha256 is unset/.test(problem)));
  const distribution = channelDistributionProblems(channel, CHANNEL);
  for (const drill of ["signedUpdate", "interruptedUpdate", "compatibleRollback", "stockRecovery"]) assert.ok(distribution.some(problem => problem.includes(`${drill} drill is "not run"`)), drill);
  assert.ok(distribution.some(problem => /knownGoodRelease\.otaSha256 is unset/.test(problem)));
});

test("a complete copy of Alpha's descriptors admits Pixel 10a production staging inputs; each gap is refused", t => {
  const repo = completeRoot(t, keyDirectory(t));
  assert.deepEqual(pixel10aProductProblems(repo.dir), []);
  const refuse = (rel, change, pattern) => {
    const original = fs.readFileSync(path.join(repo.dir, rel), "utf8");
    repo.write(rel, change(JSON.parse(original)));
    const problems = pixel10aProductProblems(repo.dir);
    assert.ok(problems.some(problem => pattern.test(problem)), `${pattern}\n${problems.join("\n")}`);
    fs.writeFileSync(path.join(repo.dir, rel), original);
  };
  refuse(PIXEL10A_PRODUCT, p => ({ ...p, releaseQualified: true }), /releaseQualified must stay false/);
  refuse(PIXEL10A_PRODUCT, p => ({ ...p, signer: { ...p.signer, apkDescriptor: "android/other-signer.json" } }), /signer\.apkDescriptor must be android\/release-signer\.json/);
  refuse(PIXEL10A_PRODUCT, p => ({ ...p, lunch: { ...p.lunch, production: "alpha_stallion_phone-cp2a-userdebug" } }), /user build/);
  // Alpha's descriptor cannot name another brand's shared composition.
  refuse(PIXEL10A_PRODUCT, p => ({ ...p, product: "eliza_stallion_phone", lunch: { development: "eliza_stallion_phone-cp2a-userdebug", production: "eliza_stallion_phone-cp2a-user" } }), /product must be alpha_stallion_phone/);
  refuse("android/release-signer.json", s => ({ ...s, signerSha256: "unset" }), /signerSha256 is "unset"/);
  refuse(LOCK, l => ({ ...l, developmentOnly: true }), /still marked developmentOnly|differs from the pinned/);
  assert.match(pixel10aProductProblems(temporary(t, "alpha-empty-")).join("\n"), /pixel10a-product\.json is missing/);
});

test("Pixel 10a staging options: development or production, never both, always with exact source inputs", () => {
  const base = { target: "pixel10a", source: "/source", factory: "/factory" };
  assert.equal(pixel10aOptions({ ...base, development: true }), true);
  assert.equal(pixel10aOptions({ ...base, production: true }), true);
  assert.throws(() => pixel10aOptions({ ...base, development: true, production: true }), /exclusive/);
  assert.throws(() => pixel10aOptions(base), /--development or --production/);
  assert.throws(() => pixel10aOptions({ ...base, production: true, factory: null }), /--aosp-source and --factory-image/);
  assert.throws(() => pixel10aOptions({ ...base, development: true, source: null }), /--aosp-source and --factory-image/);
  // Without a target the existing product is staged, and a factory image alone is refused.
  assert.equal(pixel10aOptions({ development: true, target: null }), false);
  assert.throws(() => pixel10aOptions({ factory: "/factory" }), /requires --target pixel10a/);
  assert.throws(() => pixel10aOptions({ ...base, target: "stallion", development: true }), /Only --target pixel10a/);
});

test("stage-aosp --target pixel10a --production refuses the committed descriptor before reading source or APK", () => {
  const out = spawnSync(process.execPath, [path.join(root, "scripts/stage-aosp.mjs"), "--target", "pixel10a", "--production", "--descriptor", "reviewed.json",
    "--apk", "absent.apk", "--aosp-source", "/absent/source", "--factory-image", "/absent/factory.zip"], { cwd: root, encoding: "utf8" });
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /Refusing production staging: the Pixel 10a production product \(android\/aosp\/pixel10a-product\.json\) is incomplete\.[\s\S]*platformCertificateSha256/);
  assert.doesNotMatch(out.stderr, /absent/);
});

test("the stallion product sets no board AVB variables and no key material is committed", () => {
  for (const name of fs.readdirSync(path.join(root, "vendor/eliza/packages/os/android/devices/pixel10a")).filter(name => name.endsWith(".mk")))
    assert.doesNotMatch(fs.readFileSync(path.join(root, "vendor/eliza/packages/os/android/devices/pixel10a", name), "utf8"), /^\s*BOARD_AVB_/m, name);
  assert.equal(read(PIXEL10A_PRODUCT).avb.makefile, undefined);
  const files = execFileSync("git", ["-C", root, "ls-files", "android/aosp"], { encoding: "utf8" }).split("\n");
  assert.deepEqual(files.filter(name => /\.(pk8|pem|key|p12|jks|keystore)$|avb_pkmd/.test(name)), []);
});

test("Alpha's signing binding signs with its descriptor, channel and APK signer through the shared job", async t => {
  const key = keyDirectory(t), repo = completeRoot(t, key), tf = targetFiles(t), bin = releasetools(t);
  const out = path.join(temporary(t, "alpha-release-out-"), "release");
  const options = { root: repo.dir, targetFiles: tf.file, targetFilesSha256: tf.sha256, keysDir: key.keys, releasetools: bin, out };
  // The binding cannot be redirected to another product or its descriptor.
  const dry = await signRelease({ ...options, productName: "eliza_stallion_phone", descriptorFile: "android/releases/pixel10a-eliza.json", dryRun: true });
  assert.deepEqual(dry.problems, []);
  const apkManifest = path.join(path.dirname(out), "apk-manifest.json");
  fs.writeFileSync(apkManifest, JSON.stringify({ results: [{ file: "launcher-release.apk", mode: "release", sha256: "a".repeat(64), signerSha256: "d".repeat(64), versionCode: 12, distributable: false }] }));
  const result = await signRelease({ ...options, apkManifest });
  const record = JSON.parse(fs.readFileSync(result.record, "utf8"));
  assert.equal(record.kind, RECORD_KIND);
  assert.equal(record.product, "alpha_stallion_phone");
  assert.equal(record.channel, read(CHANNEL).channel);
  assert.equal(record.build.fingerprint, FINGERPRINT);
  assert.equal(record.inputs.productDescriptorSha256, sha256(fs.readFileSync(path.join(repo.dir, PIXEL10A_PRODUCT))));
  assert.deepEqual(record.verifiedBoot.rollbackIndexes.map(row => row.location), [0, 1, 2]);
  assert.deepEqual(record.apks.map(row => row.versionCode), [12]);
  assert.deepEqual(record.problems, []);
  for (const flag of ["imageBooted", "signedUpdateApplied", "releaseQualified", "deviceAcceptanceVerified"]) assert.equal(record[flag], false, flag);
  assert.ok(result.distributionProblems.some(problem => /signedUpdate drill is "not run"/.test(problem)));
  // The committed repository is refused for its unset release inputs before any tool runs.
  const committed = await signRelease({ ...options, root, out: path.join(path.dirname(out), "committed"), dryRun: true });
  assert.ok(!committed.problems.some(problem => /android\/release-signer\.json signerSha256/.test(problem)), committed.problems.join("\n"));
  assert.ok(committed.problems.some(problem => /platformCertificateSha256 must be a SHA-256/.test(problem)), committed.problems.join("\n"));
  assert.ok(committed.problems.some(problem => /otaCertificateSha256 is unset/.test(problem)));
  // The standalone record command defaults to Alpha's descriptor and channel.
  const file = path.join(path.dirname(out), "standalone-record.json");
  const cli = spawnSync(process.execPath, [path.join(root, "scripts/aosp-release-record.mjs"), "--signed-target-files", path.join(out, "signed-target_files.zip"), "--ota", path.join(out, "ota.zip"), "--out", file], { cwd: repo.dir, encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).product, "alpha_stallion_phone");
});

test("the OTA update client defaults to Alpha's channel and refuses records it does not sign", t => {
  const dir = temporary(t, "alpha-ota-check-");
  const recordFile = (name, build, dateUtc) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify({ schema: 1, kind: RECORD_KIND, product: "alpha_stallion_phone", device: "stallion", channel: "stable", build: { fingerprint: `Alpha/alpha_stallion_phone/stallion:17/${build}:user/release-keys`, dateUtc, securityPatch: "2026-10-05" },
      artifacts: { signedTargetFiles: { sha256: "1".repeat(64) }, ota: { sha256: "2".repeat(64), type: "full" } }, verifiedBoot: { publicKeySha256: "3".repeat(64), rollbackIndexes: [{ location: 0, index: "1" }] }, certificates: { releasekey: "4".repeat(64) },
      problems: [], imageBooted: false, signedUpdateApplied: false, releaseQualified: false, deviceAcceptanceVerified: false }));
    return file;
  };
  const out = spawnSync(process.execPath, [path.join(root, "scripts/aosp-ota-update.mjs"), "check", "--from", recordFile("from.json", "A/1", "1790000000"), "--to", recordFile("to.json", "B/2", "1792000000")], { cwd: root, encoding: "utf8" });
  assert.equal(out.status, 1, out.stderr);
  const result = JSON.parse(out.stdout);
  assert.ok(result.problems.some(problem => /candidate OTA package certificate is not the channel's otaCertificateSha256/.test(problem)), result.problems.join("\n"));
  assert.ok(!result.problems.some(problem => /is not a stable release of alpha_stallion_phone/.test(problem)), "the records match Alpha's channel identity");
});

test("release blockers judge a recorded release against the current signer and the image platform certificate", () => {
  const row = { mode: "release", distributable: true, testMocks: false, bundleAudit: "passed", signed: true, signerSha256: "d".repeat(64), versionCode: 2, runtime: "PACKAGED", runtimeNotices: true,
    releaseAdmission: { failures: [], blockers: [], signerMatches: true }, voiceHost: { packaged: true, asr: true, differences: [], qualified: true }, licenceBlockers: [] };
  const signer = signerSha256 => ({ schema: 1, signerSha256, lastRelease: { versionCode: null, versionName: null, recordedAt: null } });
  assert.deepEqual(releaseBlockers(row), [], "the recorded admission alone");
  assert.ok(releaseBlockers(row, { releaseSigner: signer("unset") }).includes("release signer is unset in android/release-signer.json"));
  const committedSigner = read("android/release-signer.json");
  const committedBlockers = releaseBlockers(row, { releaseSigner: committedSigner });
  if (committedSigner.signerSha256 === "unset") assert.ok(committedBlockers.some(item => /release signer is unset/.test(item)));
  else if (committedSigner.signerSha256 !== row.signerSha256) assert.ok(committedBlockers.some(item => /does not match android\/release-signer\.json/.test(item)));
  else assert.deepEqual(committedBlockers, []);
  assert.ok(releaseBlockers(row, { releaseSigner: signer("e".repeat(64)) }).some(item => /does not match android\/release-signer\.json/.test(item)));
  assert.deepEqual(releaseBlockers(row, { releaseSigner: signer("d".repeat(64)) }), []);
  assert.deepEqual(releaseBlockers(row, { releaseSigner: signer("d".repeat(64)), image: { platformCertificateSha256: "c".repeat(64) } }), []);
  for (const value of ["UNSET", undefined, "C".repeat(64)])
    assert.ok(releaseBlockers(row, { image: { platformCertificateSha256: value } }).some(item => /image platform certificate is .*not a reviewed release certificate/.test(item)), String(value));
  assert.ok(releaseBlockers(row, { releaseSigner: { schema: 2 } }).some(item => /release-signer\.json is invalid/.test(item)));
});

test("the Clock contract is the shared system Clock requirement and handler admission", () => {
  assert.equal(verifyAospClockHandlers, sharedClock.verifyAospClockHandlers);
  assert.equal(clockProductRequirement, sharedClock.clockProductRequirement);
  assert.deepEqual(clockActions, ["SET_ALARM", "SHOW_ALARMS", "SNOOZE_ALARM", "DISMISS_ALARM"]);
  assert.match(clockProductRequirement, /^PRODUCT_PACKAGES \+= DeskClock$/m);
});

test("Alpha Cloud release evidence does not replace the signer or native-profile gate", () => {
  const apkSha256 = "a".repeat(64);
  const evidence = {format:"alpha-cloud-voice-qualification-v1",results:[{apkSha256,provider:"cartesia",outcome:"passed",checks:{consent:true,session:true,acousticInput:true,blueBar:true,transcript:true,audibleSpeakerReply:true,mute:true,unmute:true,stopReleased:true}}]};
  const candidate = {mode:"release",runtimeProfile:"cloud",sha256:apkSha256,testMocks:false,bundleAudit:"passed",signed:true,signerSha256:"d".repeat(64),versionCode:2,runtime:"PACKAGED",runtimeNotices:true,distributable:true,licenceBlockers:[],releaseAdmission:{failures:[],blockers:[],signerMatches:true},voiceHost:{packaged:false,differences:[]},cloudVoice:cloudVoiceAdmission(apkSha256,evidence,"b".repeat(64))};
  assert.deepEqual(releaseBlockers(candidate),[]);
  assert.match(releaseBlockers({...candidate,cloudVoice:undefined}).join("\n"),/Cloud voice qualification evidence is missing/);
  evidence.results[0].outcome="failed";
  assert.match(releaseBlockers({...candidate,cloudVoice:cloudVoiceAdmission(apkSha256,evidence,"c".repeat(64))}).join("\n"),/Cloud voice qualification did not pass/);
  assert.match(releaseBlockers({...candidate,runtimeProfile:"native"}).join("\n"),/no on-device voice/);
  assert.match(releaseBlockers(candidate,{releaseSigner:{schema:1,signerSha256:"unset",lastRelease:{versionCode:null}}}).join("\n"),/release signer is unset/);
});
