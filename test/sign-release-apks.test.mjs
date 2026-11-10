// Release APK signing outside Gradle: the ceremony's key files or a
// PKCS#11 token sign the unsigned releases, and nothing replaces an unsigned release unless the
// result verifies against android/release-signer.json. A stub apksigner records argument vectors;
// where the Android SDK is installed, one case signs a real APK with a throwaway key.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { approvedSigningRotation, KEYSTORE_PASSWORD_ENV, PIN_ENV, PKCS11_JVM_OPTION, keyFileProblems, main, signArguments, toolMessage } from "../scripts/sign-release-apks.ts";

const RELEASE = "e5".repeat(32);

function scratch(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A product root with a release signer record and the two unsigned releases verify-apks names. */
function product(t, signer = RELEASE) {
  const root = scratch(t, "alpha-sign-root-");
  fs.mkdirSync(path.join(root, "android"));
  fs.writeFileSync(path.join(root, "android/release-signer.json"), JSON.stringify({ schema: 1, signerSha256: signer, lastRelease: { versionCode: null, versionName: null, recordedAt: null } }));
  fs.mkdirSync(path.join(root, "artifacts"));
  for (const variant of ["standalone", "launcher"]) fs.writeFileSync(path.join(root, `artifacts/${variant}-release-unsigned.apk`), `unsigned ${variant}`);
  return root;
}

/**
 * Decrypted ceremony layout for one signing job (contents unused by the stub): an owner-only
 * directory, the private key 0600 and the certificate with the default mode decrypt-release-keys.ts
 * gives it (it writes the public certificate without a mode).
 */
function keys(t, { dirMode = 0o700, keyMode = 0o600, certMode = 0o644 } = {}) {
  const dir = scratch(t, "alpha-sign-keys-");
  fs.chmodSync(dir, dirMode);
  for (const [file, mode] of [["alphaphone_app.pk8", keyMode], ["alphaphone_app.x509.pem", certMode]]) {
    fs.writeFileSync(path.join(dir, file), "public-or-throwaway");
    fs.chmodSync(path.join(dir, file), mode);
  }
  return dir;
}

/** A stub apksigner that records its argv and whether the PIN variable reached it, then copies input to --out. */
function stubSigner(t) {
  const dir = scratch(t, "alpha-sign-tool-");
  const log = path.join(dir, "calls.jsonl");
  const tool = path.join(dir, "apksigner");
  fs.writeFileSync(tool, `#!${process.execPath}\nconst fs=require("fs");const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({argv:a,pin:process.env.${PIN_ENV}??null})+"\\n");const o=a[a.indexOf("--out")+1];fs.copyFileSync(a.at(-1),o);\n`, { mode: 0o755 });
  return { tool, calls: () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [] };
}

async function sign(root, argv, { env = {}, digest = async () => RELEASE } = {}) {
  const out = [], err = [], ran = [];
  const code = await main(argv, { root, env, digest, run: (command, args) => ran.push(args), log: line => out.push(line), error: line => err.push(line) });
  return { code, out: out.join("\n"), err: err.join("\n"), ran };
}

test("key files sign both releases, replace the unsigned files only after the signer matches, and refresh the manifest and SBOM", async t => {
  const root = product(t), dir = keys(t), { tool, calls } = stubSigner(t);
  const result = await sign(root, ["--keys-dir", dir, "--apksigner", tool]);
  assert.equal(result.code, 0, result.err);
  for (const variant of ["standalone", "launcher"]) {
    assert.equal(fs.readFileSync(path.join(root, `artifacts/${variant}-release.apk`), "utf8"), `unsigned ${variant}`);
    assert.equal(fs.existsSync(path.join(root, `artifacts/${variant}-release-unsigned.apk`)), false, "exactly one release name per variant");
    assert.equal(fs.existsSync(path.join(root, `artifacts/${variant}-release.apk.partial`)), false);
  }
  const real = fs.realpathSync(dir);
  assert.deepEqual(calls()[0].argv, ["sign", "--key", path.join(real, "alphaphone_app.pk8"), "--cert", path.join(real, "alphaphone_app.x509.pem"),
    "--v4-signing-enabled", "false", "--out", path.join(root, "artifacts/standalone-release.apk.partial"), path.join(root, "artifacts/standalone-release-unsigned.apk")]);
  assert.deepEqual(result.ran.map(args => args[0]), ["scripts/verify-apks.ts", "scripts/generate-sbom.ts"]);
  assert.deepEqual(result.ran[0], ["scripts/verify-apks.ts"]);
  assert.ok(result.ran[1].includes("--apks"));
});

test("re-verification takes no profile option; a build recorded for a removed profile, and a test-mocks build, are never signed for release", async t => {
  const { tool } = stubSigner(t);
  const current = product(t);
  fs.writeFileSync(path.join(current, "artifacts/build-config.json"), JSON.stringify({ testMocks: false, runtimeProfile: "native" }));
  const signed = await sign(current, ["--keys-dir", keys(t), "--apksigner", tool]);
  assert.equal(signed.code, 0, signed.err);
  assert.deepEqual(signed.ran[0], ["scripts/verify-apks.ts"]);
  // One runtime profile: artifacts built for the removed Cloud profile or local-embeddings capability are refused.
  for (const record of [{ testMocks: false, runtimeProfile: "cloud" }, { testMocks: false, runtimeProfile: "native", localEmbeddings: true }]) {
    const stale = product(t);
    fs.writeFileSync(path.join(stale, "artifacts/build-config.json"), JSON.stringify(record));
    const refusedStale = await sign(stale, ["--keys-dir", keys(t), "--apksigner", tool]);
    assert.equal(refusedStale.code, 1);
    assert.match(refusedStale.err, /names a removed runtime profile; rebuild/);
    assert.equal(fs.existsSync(path.join(stale, "artifacts/standalone-release.apk")), false);
  }
  const mocks = product(t);
  fs.writeFileSync(path.join(mocks, "artifacts/build-config.json"), JSON.stringify({ testMocks: true, runtimeProfile: "native" }));
  const refused = await sign(mocks, ["--keys-dir", keys(t), "--apksigner", tool]);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /test-mocks build, which is never distributable/);
  assert.equal(fs.existsSync(path.join(mocks, "artifacts/standalone-release.apk")), false);
});

test("a result signed by any other certificate leaves the unsigned releases and no signed file", async t => {
  const root = product(t), dir = keys(t), { tool } = stubSigner(t);
  const result = await sign(root, ["--keys-dir", dir, "--apksigner", tool], { digest: async () => "f6".repeat(32) });
  assert.equal(result.code, 1);
  assert.match(result.err, /not the recorded release certificate/);
  for (const variant of ["standalone", "launcher"]) {
    assert.equal(fs.existsSync(path.join(root, `artifacts/${variant}-release-unsigned.apk`)), true);
    assert.equal(fs.existsSync(path.join(root, `artifacts/${variant}-release.apk`)), false);
    assert.equal(fs.existsSync(path.join(root, `artifacts/${variant}-release.apk.partial`)), false);
  }
  assert.deepEqual(result.ran, []);
});

test("PKCS#11 signing names the token key by label and passes a PIN only through the environment", async t => {
  const root = product(t), { tool, calls } = stubSigner(t);
  const config = path.join(scratch(t, "alpha-sign-p11-"), "sunpkcs11.cfg");
  fs.writeFileSync(config, "name = alpha\nlibrary = /usr/lib/pkcs11/example.so\n");
  const withPin = await sign(root, ["--pkcs11-config", config, "--key-label", "alpha-release-app", "--apksigner", tool, "--no-verify"], { env: { [PIN_ENV]: "123456" } });
  assert.equal(withPin.code, 0, withPin.err);
  const [first] = calls();
  // apksigner's launcher turns "-J-x" into the JVM option "--x"; "-J--x" would reach java as "---x" and stop it.
  assert.equal(PKCS11_JVM_OPTION, "-J-add-exports=jdk.crypto.cryptoki/sun.security.pkcs11=ALL-UNNAMED");
  assert.deepEqual(first.argv.slice(0, 14), [PKCS11_JVM_OPTION, "sign", "--provider-class", "sun.security.pkcs11.SunPKCS11",
    "--provider-arg", config, "--ks", "NONE", "--ks-type", "PKCS11", "--ks-key-alias", "alpha-release-app", "--ks-pass", `env:${PIN_ENV}`]);
  assert.equal(first.pin, "123456", "the PIN reaches apksigner through its environment");
  assert.ok(!first.argv.join(" ").includes("123456"), "the PIN is never on the command line");
  assert.match(withPin.out, /Skipped verify-apks/);
  assert.deepEqual(signArguments({ mode: "pkcs11", pkcs11Config: config, keyLabel: "x", pin: false, input: "in.apk", output: "out.apk" }).slice(12, 14), ["--ks-pass", "pass:"]);
});

test("the protected PKCS#12 adapter signs both APKs with an environment-only password", async t => {
  const root = product(t), { tool, calls } = stubSigner(t);
  const keystore = path.join(scratch(t, "alpha-sign-p12-"), "app.p12");
  fs.writeFileSync(keystore, "fixture bytes read only by a real signer", { mode: 0o600 });
  const argv = ["--keystore", keystore, "--key-label", "alpha-release", "--apksigner", tool, "--no-verify"];
  assert.match((await sign(root, argv)).err, /PASSWORD is required/);
  const password = "fixture-not-a-secret";
  const result = await sign(root, argv, { env: { [KEYSTORE_PASSWORD_ENV]: password } });
  assert.equal(result.code, 0, result.err);
  assert.equal(calls().length, 2);
  for (const { argv: args } of calls()) {
    assert.deepEqual(args.slice(0, 11), ["sign", "--ks", keystore, "--ks-type", "PKCS12", "--ks-key-alias",
      "alpha-release", "--ks-pass", `env:${KEYSTORE_PASSWORD_ENV}`, "--key-pass", `env:${KEYSTORE_PASSWORD_ENV}`]);
    assert.ok(!args.includes(password));
  }
  assert.doesNotMatch(result.out + result.err, /fixture-not-a-secret/);
  assert.deepEqual(result.ran, []);
});

test("an apksigner failure is reported by its message, not by Java stack frames", () => {
  const trace = ["Exception in thread \"main\" java.lang.IllegalAccessException: cannot access class sun.security.pkcs11.SunPKCS11",
    "\tat java.base/jdk.internal.reflect.Reflection.newIllegalAccessException(Reflection.java:394)", "\tat com.android.apksigner.ApkSignerTool.sign(ApkSignerTool.java:358)", "\t... 2 more"].join("\n");
  assert.equal(toolMessage({ stderr: trace }), "Exception in thread \"main\" java.lang.IllegalAccessException: cannot access class sun.security.pkcs11.SunPKCS11");
  assert.equal(toolMessage({ stderr: "", stdout: "Failed to load signer \"signer #1\": NONE entry \"x\" does not contain a key\n" }), "Failed to load signer \"signer #1\": NONE entry \"x\" does not contain a key");
  assert.equal(toolMessage({ error: new Error("spawn apksigner ENOENT") }), "spawn apksigner ENOENT");
  assert.equal(toolMessage({}), "no output");
});

test("the key directory and private key must be owner-only, outside Git and real files; the public certificate keeps its mode", t => {
  assert.match(keyFileProblems("relative/keys", "alphaphone_app").join(), /absolute path/);
  assert.match(keyFileProblems(path.join(os.tmpdir(), "alpha-missing-keys-dir"), "alphaphone_app").join(), /does not exist/);
  assert.match(keyFileProblems(keys(t, { dirMode: 0o750 }), "alphaphone_app").join(), /owner-only/);
  const readable = keyFileProblems(keys(t, { keyMode: 0o640 }), "alphaphone_app");
  assert.equal(readable.length, 1);
  assert.match(readable[0], /alphaphone_app\.pk8 must have mode 0600 or stricter/);
  // decrypt-release-keys.ts writes the certificate with the default mode; that layout is accepted as is.
  assert.deepEqual(keyFileProblems(keys(t, { certMode: 0o644 }), "alphaphone_app"), []);
  assert.deepEqual(keyFileProblems(keys(t, { certMode: 0o600 }), "alphaphone_app"), []);
  const linkedCertificate = keys(t);
  const elsewhere = path.join(scratch(t, "alpha-sign-cert-"), "alphaphone_app.x509.pem");
  fs.renameSync(path.join(linkedCertificate, "alphaphone_app.x509.pem"), elsewhere);
  fs.symlinkSync(elsewhere, path.join(linkedCertificate, "alphaphone_app.x509.pem"));
  assert.match(keyFileProblems(linkedCertificate, "alphaphone_app").join(), /alphaphone_app\.x509\.pem is not a regular file/);
  const tree = scratch(t, "alpha-sign-tree-");
  fs.mkdirSync(path.join(tree, ".git"));
  const inside = path.join(tree, "keys");
  fs.mkdirSync(inside, { mode: 0o700 });
  for (const file of ["alphaphone_app.pk8", "alphaphone_app.x509.pem"]) fs.writeFileSync(path.join(inside, file), "x", { mode: 0o600 });
  assert.match(keyFileProblems(inside, "alphaphone_app").join(), /inside the Git working tree/);
  const link = path.join(scratch(t, "alpha-sign-link-"), "keys");
  fs.symlinkSync(keys(t), link);
  assert.match(keyFileProblems(link, "alphaphone_app").join(), /symbolic link/);
  const pair = keys(t);
  fs.rmSync(path.join(pair, "alphaphone_app.x509.pem"));
  assert.match(keyFileProblems(pair, "alphaphone_app").join(), /alphaphone_app\.x509\.pem is missing/);
  assert.deepEqual(keyFileProblems(keys(t), "alphaphone_app"), []);
});

test("refusals: no enrolled signer, already signed releases, mixed modes, dry run changes nothing", async t => {
  const { tool, calls } = stubSigner(t);
  const unset = await sign(product(t, "unset"), ["--keys-dir", keys(t), "--apksigner", tool]);
  assert.equal(unset.code, 1);
  assert.match(unset.err, /enroll the release certificate first/);
  const root = product(t);
  fs.writeFileSync(path.join(root, "artifacts/launcher-release.apk"), "signed by Gradle");
  const twice = await sign(root, ["--keys-dir", keys(t), "--apksigner", tool]);
  assert.equal(twice.code, 1);
  assert.match(twice.err, /launcher-release\.apk already exists/);
  for (const argv of [[], ["--keys-dir", "/k", "--key-label", "x"], ["--pkcs11-config", "/c"], ["--pkcs11-config", "/c", "--key-label", "x", "--key-name", "y"], ["--keys-dir"], ["--keys-dir", "/k", "--bogus"], ["--keys-dir", "/k", "--artifacts", "x"]])
    assert.equal((await sign(product(t), argv)).code, 2, argv.join(" "));
  const dry = product(t);
  const dryRun = await sign(dry, ["--keys-dir", keys(t), "--apksigner", tool, "--dry-run"]);
  assert.equal(dryRun.code, 0, dryRun.err);
  assert.match(dryRun.out, /Dry run: nothing signed/);
  assert.match(dryRun.out, /sign --key .*alphaphone_app\.pk8/);
  assert.deepEqual(calls(), []);
  assert.equal(fs.existsSync(path.join(dry, "artifacts/standalone-release-unsigned.apk")), true);
  // One explicit APK (for example the preprocessed listener) keeps its input and does not rewrite the manifest.
  const single = product(t);
  const listener = path.join(single, "sense-release-unsigned.apk");
  fs.writeFileSync(listener, "listener");
  const one = await sign(single, ["--keys-dir", keys(t), "--apksigner", tool, "--apk", listener, "--out", path.join(single, "sense-release.apk")]);
  assert.equal(one.code, 0, one.err);
  assert.equal(fs.existsSync(listener), true);
  assert.equal(fs.readFileSync(path.join(single, "sense-release.apk"), "utf8"), "listener");
  assert.deepEqual(one.ran, []);
});

test("a real apksigner signs an APK with ceremony-layout key files, and the result verifies against the recorded certificate", async t => {
  let toolchain;
  try { toolchain = await import("../scripts/toolchain.ts"); toolchain.androidEnv(); } catch { t.skip("Android SDK and JDK 21 are not installed here"); return; }
  const apksigner = toolchain.tool("apksigner"), aapt2 = path.join(path.dirname(apksigner), "aapt2");
  const androidJar = path.join(toolchain.androidEnv().ANDROID_HOME, "platforms/android-36/android.jar");
  if (![apksigner, aapt2, androidJar].every(file => fs.existsSync(file))) { t.skip("build-tools 36.0.0 or platform android-36 is missing"); return; }
  const work = scratch(t, "alpha-sign-real-");
  fs.writeFileSync(path.join(work, "AndroidManifest.xml"), '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="org.example.signingtest"><uses-sdk android:minSdkVersion="28" android:targetSdkVersion="36"/><application android:hasCode="false"/></manifest>');
  const unsigned = path.join(work, "app-unsigned.apk");
  execFileSync(aapt2, ["link", "-o", unsigned, "-I", androidJar, "--manifest", path.join(work, "AndroidManifest.xml")], { stdio: "ignore" });
  const dir = keys(t);
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/O=Example Release Test/CN=alphaphone_app", "-days", "1", "-keyout", path.join(work, "key.pem"), "-out", path.join(dir, "alphaphone_app.x509.pem")], { stdio: "ignore" });
  execFileSync("openssl", ["pkcs8", "-topk8", "-nocrypt", "-outform", "DER", "-in", path.join(work, "key.pem"), "-out", path.join(dir, "alphaphone_app.pk8")], { stdio: "ignore" });
  fs.chmodSync(path.join(dir, "alphaphone_app.pk8"), 0o600);
  fs.chmodSync(path.join(dir, "alphaphone_app.x509.pem"), 0o644); // as decrypt-release-keys.ts leaves it
  const certificate = new X509Certificate(fs.readFileSync(path.join(dir, "alphaphone_app.x509.pem"))).fingerprint256.replaceAll(":", "").toLowerCase();
  const root = product(t, certificate);
  const out = [], err = [];
  const code = await main(["--keys-dir", dir, "--apksigner", apksigner, "--apk", unsigned, "--out", path.join(work, "app-release.apk")],
    { root, env: process.env, log: line => out.push(line), error: line => err.push(line) });
  assert.equal(code, 0, err.join("\n"));
  const { signerDigest } = await import("../scripts/apk.ts");
  assert.equal(signerDigest(path.join(work, "app-release.apk")), certificate);
  assert.equal(fs.existsSync(path.join(work, "app-release.apk.idsig")), false, "no v4 side file is written");
  // The same key against a different recorded signer is refused and leaves nothing behind.
  const other = product(t, "0".repeat(64));
  assert.equal(await main(["--keys-dir", dir, "--apksigner", apksigner, "--apk", unsigned, "--out", path.join(work, "other.apk")], { root: other, env: process.env, log() {}, error() {} }), 1);
  assert.equal(fs.existsSync(path.join(work, "other.apk")), false);
});

test("the real apksigner launcher accepts the PKCS#11 JVM option, and with a PKCS#11 module present SunPKCS11 loads", async t => {
  let toolchain;
  try { toolchain = await import("../scripts/toolchain.ts"); toolchain.androidEnv(); } catch { t.skip("Android SDK and JDK 21 are not installed here"); return; }
  const apksigner = toolchain.tool("apksigner"), aapt2 = path.join(path.dirname(apksigner), "aapt2");
  const androidJar = path.join(toolchain.androidEnv().ANDROID_HOME, "platforms/android-36/android.jar");
  if (![apksigner, aapt2, androidJar].every(file => fs.existsSync(file))) { t.skip("build-tools 36.0.0 or platform android-36 is missing"); return; }
  const env = toolchain.androidEnv();
  env.PATH = [path.join(env.JAVA_HOME, "bin"), env.PATH].filter(Boolean).join(path.delimiter);
  // The launcher forwards the option to java; the JVM must accept it (the "-J--" form fails here with "Unrecognized option").
  const version = spawnSync(apksigner, [PKCS11_JVM_OPTION, "version"], { env, encoding: "utf8" });
  assert.equal(version.status, 0, `${version.stdout}${version.stderr}`);
  assert.doesNotMatch(`${version.stdout}${version.stderr}`, /Unrecognized option/);
  // A read-only system PKCS#11 module (trust anchors, no private key) shows that the provider is constructed and the
  // token opened; the missing key is then refused and nothing is written. Hosts without such a module skip this part.
  const module = ["/usr/lib/pkcs11/p11-kit-trust.so", "/usr/lib/x86_64-linux-gnu/pkcs11/p11-kit-trust.so", "/usr/lib64/pkcs11/p11-kit-trust.so"].find(file => fs.existsSync(file));
  if (!module) { t.diagnostic("no PKCS#11 module on this host: the token path was not exercised"); return; }
  const work = scratch(t, "alpha-sign-p11-real-");
  fs.writeFileSync(path.join(work, "AndroidManifest.xml"), '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="org.example.signingtest"><uses-sdk android:minSdkVersion="28" android:targetSdkVersion="36"/><application android:hasCode="false"/></manifest>');
  const unsigned = path.join(work, "app-unsigned.apk");
  execFileSync(aapt2, ["link", "-o", unsigned, "-I", androidJar, "--manifest", path.join(work, "AndroidManifest.xml")], { stdio: "ignore" });
  const config = path.join(work, "sunpkcs11.cfg");
  fs.writeFileSync(config, `name = alpha-signing-test\nlibrary = ${module}\n`);
  const err = [];
  const code = await main(["--pkcs11-config", config, "--key-label", "alpha-no-such-key", "--apksigner", apksigner, "--apk", unsigned, "--out", path.join(work, "p11.apk")],
    { root: product(t), env, log() {}, error: line => err.push(line) });
  assert.equal(code, 1);
  assert.doesNotMatch(err.join("\n"), /IllegalAccessException|Unrecognized option|Could not create the Java Virtual Machine|ClassNotFoundException/);
  // apksigner opened the token's key store and looked the label up: it names the entry it could not use.
  assert.match(err.join("\n"), /"alpha-no-such-key"/);
  assert.equal(fs.existsSync(path.join(work, "p11.apk")), false);
  assert.equal(fs.existsSync(path.join(work, "p11.apk.partial")), false);
});


test("rotation admission requires explicit approval and preserves the exact reviewed scope", async t => {
  const root = scratch(t, "alpha-rotation-admission-");
  const lineage = path.join(root, "rotation.lineage");
  const unsigned = path.join(root, "unsigned.apk");
  fs.writeFileSync(lineage, "synthetic public lineage");
  fs.writeFileSync(unsigned, "synthetic unsigned fixture");
  const sha = bytes => createHash("sha256").update(bytes).digest("hex");
  const rotation = {
    schema: 1, approval: "approved", fromVersionCode: 44, versionCode: 45,
    previousSignerSha256: "a1".repeat(32), lineageSha256: sha(fs.readFileSync(lineage)),
    apksignerSha256: "b2".repeat(32), verifierJarSha256: "c3".repeat(32),
    unsignedApkSHA256: {standalone: sha(fs.readFileSync(unsigned)), launcher: "d4".repeat(32)},
  };
  const descriptor = {signerSha256: RELEASE, lastRelease: {versionCode: 44}, apkSigningRotation: rotation};
  const targets = [{input: unsigned}];
  assert.equal(await approvedSigningRotation(descriptor, lineage, targets), rotation);
  for (const approval of ["pending", undefined, "", true]) {
    const unapproved = {...descriptor, apkSigningRotation: {...rotation, approval}};
    await assert.rejects(approvedSigningRotation(unapproved, lineage, targets), /No reviewed APK signing rotation record/);
  }
  fs.appendFileSync(unsigned, " changed");
  await assert.rejects(approvedSigningRotation(descriptor, lineage, targets), /outside the reviewed rotation scope/);
  fs.appendFileSync(lineage, " changed");
  await assert.rejects(approvedSigningRotation(descriptor, lineage, targets), /lineage differs from the reviewed digest/);
});
