// Edge cases of Alpha's Pixel 10a release signing binding (scripts/sign-aosp-release.mjs, issue #672):
// managed (PKCS#11 / AVB helper / payload signer) options and the APEX container and payload keys,
// through Alpha's own descriptor, channel and APK signer. Releasetools are the upstream test doubles
// and every key is a throwaway value generated here. Nothing here signs a real target-files, boots an
// image, applies an OTA or touches a token; it is mocked-releasetools evidence only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PIXEL10A_PRODUCT, PIXEL10A_RELEASE } from "../scripts/aosp-pixel10a.mjs";
import { X509_KEYS, parseSigningArgs, signRelease } from "../scripts/sign-aosp-release.mjs";

const root = path.resolve(import.meta.dirname, "..");
const vendorPresent = fs.existsSync(path.join(root, "vendor/eliza/packages/os/scripts/android/aosp-release-signing.mjs"));
const skip = !vendorPresent && "pinned checkout absent";
const read = rel => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const CHANNEL = "android/aosp/pixel10a-ota-channel.json";
const LOCK = PIXEL10A_RELEASE.sourceLockPath;
const DOUBLES = path.join(root, "vendor/eliza/packages/os/scripts/__tests__/fixtures/aosp-releasetools");
const FINGERPRINT = "Alpha/alpha_stallion_phone/stallion:17/CP2A.261005.001/42:user/release-keys";
const DEV = "build/make/target/product/security";
const APEX = "com.android.alpha.test.apex";
const APEX_ROW = `name="${APEX}" public_key="system/apex/test.avbpubkey" private_key="system/apex/test.pem" container_certificate="system/apex/test.x509.pem" container_private_key="system/apex/test.pk8" partition="system"`;
const PRESIGNED_APEX_ROW = 'name="com.vendor.presigned.apex" public_key="PRESIGNED" private_key="PRESIGNED" container_certificate="PRESIGNED" container_private_key="PRESIGNED" partition="system"';

const encodeAvbPublicKey = async key => (await import("../vendor/eliza/packages/os/scripts/android/generate-release-keys.ts")).encodeAvbPublicKey(key);

function temporary(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function zip(file, entries) {
  execFileSync("python3", ["-c", "import io,json,sys,zipfile\ndef build(e):\n b=io.BytesIO()\n with zipfile.ZipFile(b,'w') as z:\n  for k,v in e.items(): z.writestr(k, build(v) if isinstance(v,dict) else v)\n return b.getvalue()\nopen(sys.argv[1],'wb').write(build(json.loads(sys.argv[2])))", file, JSON.stringify(entries)]);
}
function certificate(dir, name) {
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-subj", `/CN=alpha-owner-test-${name}`, "-days", "1",
    "-keyout", path.join(dir, `${name}.key.tmp`), "-out", path.join(dir, `${name}.x509.pem`)], { stdio: "ignore" });
  fs.rmSync(path.join(dir, `${name}.key.tmp`));
  fs.chmodSync(path.join(dir, `${name}.x509.pem`), 0o600);
  return sha256(Buffer.from(fs.readFileSync(path.join(dir, `${name}.x509.pem`), "utf8").replace(/-----[^-]+-----|\s/g, ""), "base64"));
}
const writeKey = (dir, name, value) => { fs.writeFileSync(path.join(dir, name), value); fs.chmodSync(path.join(dir, name), 0o600); };

/** A fresh RSA public key in PEM and its AVB public key metadata; the private half is discarded. */
async function avbPublic() {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = publicKey.export({ type: "spki", format: "pem" });
  return { pem, metadata: await encodeAvbPublicKey(createPublicKey(pem)) };
}

/**
 * A throwaway key directory. Key-file mode: private files hold a marker, never a key. Managed mode:
 * certificates and public keys only, as a PKCS#11 deployment would leave on disk.
 */
async function keyDirectory(t, { managed = false } = {}) {
  const keys = temporary(t, "alpha-owner-keys-");
  fs.chmodSync(keys, 0o700);
  const platform = certificate(keys, "platform"), releasekey = certificate(keys, "releasekey"), apex = certificate(keys, "apex");
  for (const name of X509_KEYS) {
    if (!["platform", "releasekey"].includes(name)) writeKey(keys, `${name}.x509.pem`, fs.readFileSync(path.join(keys, "releasekey.x509.pem")));
    if (!managed) writeKey(keys, `${name}.pk8`, "TEST-ONLY-PRIVATE-MARKER");
  }
  let avb;
  if (managed) {
    const vbmeta = await avbPublic(), payload = await avbPublic();
    writeKey(keys, "avb.pem", vbmeta.pem); writeKey(keys, "avb_pkmd.bin", vbmeta.metadata);
    writeKey(keys, "apex_payload.pem", payload.pem); writeKey(keys, "apex_payload.avbpubkey", payload.metadata);
    avb = sha256(vbmeta.metadata);
  } else {
    writeKey(keys, "apex.pk8", "TEST-ONLY-PRIVATE-MARKER");
    writeKey(keys, "apex_payload.pem", "TEST-ONLY-PRIVATE-MARKER");
    writeKey(keys, "apex_payload.avbpubkey", "release apex payload public key");
    writeKey(keys, "avb.pem", "TEST-ONLY-PRIVATE-MARKER");
    writeKey(keys, "avb_pkmd.bin", "test avb public key metadata");
    avb = sha256(Buffer.from("test avb public key metadata"));
  }
  return { keys, platform, releasekey, apex, avb };
}

/** A copy of Alpha's release inputs, complete for the given keys (apex has its own reviewed digest). */
function completeRoot(t, { platform, releasekey, apex, avb }) {
  const dir = temporary(t, "alpha-owner-root-");
  const write = (rel, value) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), typeof value === "string" ? value : JSON.stringify(value, null, 2)); };
  const lock = JSON.stringify({ schema: 1, target: "pixel10a", device: { codename: "stallion", androidRelease: "17" }, developmentOnly: false, releaseQualified: false, factory: read(LOCK).factory });
  write(LOCK, lock);
  const product = read(PIXEL10A_PRODUCT);
  const others = Object.fromEntries(Object.keys(product.signer.releaseCertificates).map(name => [name, name === "apex" ? apex : releasekey]));
  write(PIXEL10A_PRODUCT, { ...product, sourceLock: { ...product.sourceLock, sha256: sha256(lock) }, signer: { ...product.signer, platformCertificateSha256: platform, releaseCertificates: others }, avb: { ...product.avb, publicKeySha256: avb } });
  write(CHANNEL, { ...read(CHANNEL), otaCertificateSha256: releasekey, avbPublicKeySha256: avb });
  write("android/release-signer.json", { ...read("android/release-signer.json"), signerSha256: "d".repeat(64) });
  return { dir, write, readBack: rel => JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8")) };
}

function releasetools(t, mock = null) {
  const bin = path.join(temporary(t, "alpha-owner-otatools-"), "bin");
  fs.mkdirSync(bin);
  for (const name of ["sign_target_files_apks", "ota_from_target_files", "apksigner"]) { fs.copyFileSync(path.join(DOUBLES, name), path.join(bin, name)); fs.chmodSync(path.join(bin, name), 0o755); }
  if (mock) fs.writeFileSync(path.join(bin, "mock.json"), JSON.stringify(mock));
  return bin;
}
const calls = bin => fs.existsSync(path.join(bin, "calls.jsonl")) ? fs.readFileSync(path.join(bin, "calls.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];

function targetFiles(t, { apexkeys = [APEX_ROW, PRESIGNED_APEX_ROW], apexFiles = true } = {}) {
  const file = path.join(temporary(t, "alpha-owner-tf-"), "unsigned-target_files.zip");
  const cert = (name, key) => `name="${name}" certificate="${DEV}/${key}.x509.pem" private_key="${DEV}/${key}.pk8"`;
  zip(file, {
    "SYSTEM/build.prop": `ro.system.build.fingerprint=${FINGERPRINT}\nro.build.version.release=17\nro.build.version.security_patch=2026-10-05\nro.build.date.utc=1790000000\n`,
    "META/misc_info.txt": ["avb_enable=true", "avb_vbmeta_key_path=k.pem", "avb_vbmeta_system_key_path=k.pem", "avb_vbmeta_system_rollback_index_location=1", "avb_vbmeta_vendor_key_path=k.pem", "avb_vbmeta_vendor_rollback_index_location=2"].join("\n") + "\n",
    "META/apkcerts.txt": `${cert("AlphaPhone.apk", "testkey")}\n${cert("Settings.apk", "platform")}\n`,
    "META/apexkeys.txt": apexkeys.length ? `${apexkeys.join("\n")}\n` : "",
    "PRODUCT/app/AlphaPhone/AlphaPhone.apk": { CERT: "0".repeat(64) },
    "SYSTEM/priv-app/Settings/Settings.apk": { CERT: "0".repeat(64) },
    ...(apexFiles ? {
      [`SYSTEM/apex/${APEX}`]: { CERT: "0".repeat(64), apex_pubkey: "aosp test apex payload key" },
      "SYSTEM/apex/com.vendor.presigned.apex": { CERT: "e".repeat(64), apex_pubkey: "vendor key" },
    } : {}),
  });
  return { file, sha256: sha256(fs.readFileSync(file)) };
}

/** Throwaway managed-signing inputs: a token config, an AVB helper and a payload signer that never run. */
function managedTools(t) {
  const dir = temporary(t, "alpha-owner-managed-");
  const pkcs11Config = path.join(dir, "token.cfg"), avbSigningHelper = path.join(dir, "avb-helper"), payloadSigner = path.join(dir, "payload-signer");
  fs.writeFileSync(pkcs11Config, "name = AlphaReleaseTest\nlibrary = /nonexistent/pkcs11-test-module.so\n");
  for (const file of [avbSigningHelper, payloadSigner]) { fs.writeFileSync(file, "#!/bin/sh\nexit 1\n"); fs.chmodSync(file, 0o755); }
  return { dir, pkcs11Config, avbSigningHelper, payloadSigner, payloadSignerArgs: ["-key", "alpha-release-ota"], payloadSignerSignatureSize: "512" };
}

async function setup(t, { managed = false, tf = {}, mock = null } = {}) {
  const key = await keyDirectory(t, { managed });
  const repo = completeRoot(t, key), target = targetFiles(t, tf), bin = releasetools(t, mock);
  const out = path.join(temporary(t, "alpha-owner-out-"), "release");
  const tools = managed ? managedTools(t) : null;
  const { dir: _dir, ...managedOptions } = tools ?? {};
  const options = { root: repo.dir, targetFiles: target.file, targetFilesSha256: target.sha256, keysDir: key.keys, releasetools: bin, out, ...managedOptions };
  return { key, repo, bin, out, tools, options };
}
const value = (args, flag) => args[args.indexOf(flag) + 1];
const values = (args, flag) => args.flatMap((arg, index) => (arg === flag ? [args[index + 1]] : []));

test("managed signing with a re-signed APEX: token keystore, AVB helper on every AVB signature, payload signer, and the APEX keys from the key directory", { skip }, async t => {
  const fixture = await setup(t, { managed: true });
  const { keys } = fixture.key, { tools } = fixture;
  const dry = await signRelease({ ...fixture.options, dryRun: true });
  assert.deepEqual(dry.problems, []);
  assert.equal(dry.signingMode, "managed");
  // signapk looks token keys up by the private-key path it would otherwise read.
  for (const name of [...X509_KEYS, "apex"]) assert.equal(dry.tokenLabels[name], path.join(keys, `${name}.pk8`), name);
  assert.ok(!fs.readdirSync(keys).some(name => name.endsWith(".pk8")), "no private key file in a managed key directory");

  const [sign, ota] = dry.commands.map(command => command.args);
  assert.match(value(sign, "--extra_signapk_args"), new RegExp(`-providerClass sun\\.security\\.pkcs11\\.SunPKCS11 -providerArg ${tools.pkcs11Config} -loadPrivateKeysFromKeyStore PKCS11`));
  assert.match(value(sign, "--java_args"), /--add-exports=jdk\.crypto\.cryptoki\/sun\.security\.pkcs11=ALL-UNNAMED/);
  for (const partition of ["vbmeta", ...read(PIXEL10A_PRODUCT).avb.chainedPartitions, "apex"])
    assert.equal(value(sign, `--avb_${partition}_extra_args`), `--signing_helper_with_files ${tools.avbSigningHelper}`, partition);
  assert.deepEqual(values(sign, "--extra_apex_payload_key"), [`${APEX}=${path.join(keys, "apex_payload.pem")}`]);
  assert.deepEqual(values(sign, "--extra_apks"), [`${APEX}=${path.join(keys, "apex")}`]);
  assert.ok(!sign.some(arg => arg.startsWith("com.vendor.presigned.apex")), "a fully presigned APEX is left alone");
  for (const args of [sign, ota]) {
    assert.equal(value(args, "--payload_signer"), tools.payloadSigner);
    assert.equal(value(args, "--payload_signer_args"), "-key alpha-release-ota");
    assert.equal(value(args, "--payload_signer_maximum_signature_size"), "512");
  }
  assert.equal(value(sign, "--package_key"), path.join(keys, "releasekey"), "embedded boot OTAs are re-signed with the release key");
  assert.equal(value(ota, "-k"), path.join(keys, "releasekey"));
  assert.ok(!JSON.stringify(dry.commands).match(/PIN|pin=|password/i), "no token secret on any command line");

  const result = await signRelease(fixture.options);
  const record = JSON.parse(fs.readFileSync(result.record, "utf8"));
  assert.equal(record.inputs.signingMode, "managed");
  assert.equal(record.product, "alpha_stallion_phone");
  assert.deepEqual(record.problems, []);
  for (const flag of ["imageBooted", "signedUpdateApplied", "releaseQualified", "deviceAcceptanceVerified"]) assert.equal(record[flag], false, flag);
  assert.equal(calls(fixture.bin).filter(call => call[0] === "sign_target_files_apks").length, 1);
});

test("managed options are all-or-nothing, absolute, plain words, executable and sized", { skip }, async t => {
  const fixture = await setup(t, { managed: true });
  const refused = async (change, pattern) => {
    const { problems } = await signRelease({ ...fixture.options, ...change, dryRun: true });
    assert.ok(problems.some(problem => pattern.test(problem)), `${pattern}\n${problems.join("\n")}`);
  };
  await refused({ payloadSigner: undefined }, /managed signing needs .* together; missing --payload-signer/);
  await refused({ pkcs11Config: undefined, avbSigningHelper: undefined }, /missing --pkcs11-config, --avb-signing-helper/);
  await refused({ avbSigningHelper: "relative/helper" }, /--avb-signing-helper must be an absolute path/);
  await refused({ pkcs11Config: `${fixture.tools.pkcs11Config} extra` }, /--pkcs11-config must be a path without spaces, quotes or shell characters/);
  await refused({ payloadSignerArgs: ["-key", "two words"] }, /--payload-signer-arg "two words" must be a plain word/);
  for (const size of ["0", "abc", "-512"]) await refused({ payloadSignerSignatureSize: size }, /--payload-signer-signature-size must be the signer's maximum signature size/);
  fs.chmodSync(fixture.tools.payloadSigner, 0o644);
  await refused({}, /--payload-signer .* is not executable/);
  fs.chmodSync(fixture.tools.payloadSigner, 0o755);
  await refused({ avbSigningHelper: fixture.tools.dir }, /--avb-signing-helper .* is not a regular file/);
  // A payload signer argument alone switches to managed mode and so needs the rest.
  const keyFiles = await setup(t);
  const { problems } = await signRelease({ ...keyFiles.options, payloadSignerArgs: ["-key", "x"], dryRun: true });
  assert.ok(problems.some(problem => /managed signing needs/.test(problem)), problems.join("\n"));
  // The CLI keeps a dash-led signer argument as the next word.
  assert.deepEqual(parseSigningArgs(["--payload-signer-arg", "--key-label", "--payload-signer-arg", "-x"]).payloadSignerArgs, ["--key-label", "-x"]);
});

test("a managed key directory never holds a private key, and its public AVB keys must be the enrolled ones", { skip }, async t => {
  const refused = async (fixture, pattern) => {
    const { problems } = await signRelease({ ...fixture.options, dryRun: true });
    assert.ok(problems.some(problem => pattern.test(problem)), `${pattern}\n${problems.join("\n")}`);
  };
  let fixture = await setup(t, { managed: true });
  writeKey(fixture.key.keys, "platform.pk8", "TEST-ONLY-PRIVATE-MARKER");
  await refused(fixture, /--keys-dir holds platform\.pk8; managed signing keeps private keys in the PKCS#11 token/);

  fixture = await setup(t, { managed: true });
  writeKey(fixture.key.keys, "avb.pem", "-----BEGIN PRIVATE KEY-----\nTEST-ONLY\n-----END PRIVATE KEY-----\n");
  await refused(fixture, /--keys-dir avb\.pem must be the public key/);

  fixture = await setup(t, { managed: true });
  writeKey(fixture.key.keys, "avb.pem", (await avbPublic()).pem);
  await refused(fixture, /--keys-dir avb\.pem is not the key in avb_pkmd\.bin/);

  fixture = await setup(t, { managed: true });
  writeKey(fixture.key.keys, "apex_payload.pem", (await avbPublic()).pem);
  await refused(fixture, /--keys-dir apex_payload\.pem is not the key in apex_payload\.avbpubkey/);

  fixture = await setup(t, { managed: true });
  writeKey(fixture.key.keys, "apex_payload.pem", "TEST-ONLY-PRIVATE-MARKER");
  await refused(fixture, /--keys-dir apex_payload\.pem must be the public key/);

  fixture = await setup(t, { managed: true });
  fs.rmSync(path.join(fixture.key.keys, "media.x509.pem"));
  await refused(fixture, /lacks media\.x509\.pem \(managed signing needs every release certificate and public key\)/);
});

test("APEX keys in key-file mode: a re-signed APEX needs its container pair and payload key, pinned to the reviewed apex certificate", { skip }, async t => {
  const refused = async (fixture, pattern) => {
    const { problems } = await signRelease({ ...fixture.options, dryRun: true });
    assert.ok(problems.some(problem => pattern.test(problem)), `${pattern}\n${problems.join("\n")}`);
  };
  for (const name of ["apex.pk8", "apex.x509.pem", "apex_payload.pem", "apex_payload.avbpubkey"]) {
    const fixture = await setup(t);
    fs.rmSync(path.join(fixture.key.keys, name));
    await refused(fixture, new RegExp(`lacks .*${name.replace(".", "\\.")}`));
  }
  let fixture = await setup(t);
  const product = fixture.repo.readBack(PIXEL10A_PRODUCT);
  fixture.repo.write(PIXEL10A_PRODUCT, { ...product, signer: { ...product.signer, releaseCertificates: { ...product.signer.releaseCertificates, apex: "a".repeat(64) } } });
  await refused(fixture, /apex\.x509\.pem is [0-9a-f]{64}, not the product's signer\.releaseCertificates\.apex/);

  fixture = await setup(t, { tf: { apexkeys: [APEX_ROW.replace('private_key="system/apex/test.pem"', 'private_key="PRESIGNED"')] } });
  await refused(fixture, new RegExp(`APEX ${APEX.replace(/\./g, "\\.")} is only partly presigned`));

  // Only presigned APEXes: no APEX key is required or passed.
  fixture = await setup(t, { tf: { apexkeys: [PRESIGNED_APEX_ROW] } });
  for (const name of ["apex.pk8", "apex_payload.pem"]) fs.rmSync(path.join(fixture.key.keys, name));
  const dry = await signRelease({ ...fixture.options, dryRun: true });
  assert.deepEqual(dry.problems, []);
  assert.ok(!dry.commands[0].args.includes("--extra_apex_payload_key"));
});

test("after signing, a re-signed APEX that still carries the test payload key stops the job before any OTA", { skip }, async t => {
  const fixture = await setup(t, { mock: { keepApexKey: true } });
  await assert.rejects(signRelease(fixture.options), new RegExp(`${APEX.replace(/\./g, "\\.")} does not carry the release APEX payload key`));
  assert.ok(!calls(fixture.bin).some(call => call[0] === "ota_from_target_files"), "no OTA is built from a refused signed target-files");
});

// Gap recorded for the owner (docs/runbooks/672-pixel10a-production-image.md): enrollment records the
// apex container certificate but no reviewed digest for the apex_payload AVB key, so the signing job
// compares re-signed APEXes only with the key directory's own apex_payload.avbpubkey. A substituted
// payload key pair in the key directory is therefore not refused. Marked todo until a reviewed
// apex_payload digest is pinned upstream; flip to a plain test then.
test("an APEX payload key pair that is not the enrolled one is refused", { skip, todo: "no reviewed apex_payload digest is recorded (enroll-release-keys.mjs ENROLLMENT, shared keyDirectoryProblems)" }, async t => {
  const fixture = await setup(t, { managed: true });
  const other = await avbPublic();
  writeKey(fixture.key.keys, "apex_payload.pem", other.pem);
  writeKey(fixture.key.keys, "apex_payload.avbpubkey", other.metadata);
  const { problems } = await signRelease({ ...fixture.options, dryRun: true });
  assert.ok(problems.some(problem => /apex_payload/.test(problem)), `a substituted payload key passed: ${JSON.stringify(problems)}`);
});
