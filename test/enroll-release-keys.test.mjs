// Release identity enrollment (docs/human-actions.md H-08, H-09): Alpha's key list drives the
// pinned upstream ceremony, and scripts/enroll-release-keys.mjs records only the ceremony's public
// digests in Alpha's three release records. No key material is created outside a temporary
// directory, and nothing here signs an APK or image.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { X509Certificate, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  APPLICATION_KEY, CHANNEL, ENROLLMENT, IMAGE_CERTIFICATES, KEY_MANIFEST, PRODUCT, RELEASE_SIGNER,
  fingerprintProblems, formatRecord, main, testSubjectProblem,
} from "../scripts/enroll-release-keys.mjs";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, KEY_MANIFEST), "utf8"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function scratch(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * A copy of Alpha's three records and key list, so enrollment can write without touching the
 * checkout. Every enrolled field starts unset, as before the ceremony, whatever the checkout has
 * recorded since (these cases must keep passing after the real enrollment is committed).
 */
function recordsFixture(t) {
  const dir = scratch(t, "alpha-enroll-root-");
  for (const file of [KEY_MANIFEST, RELEASE_SIGNER, PRODUCT, CHANNEL]) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(dir, file));
  }
  const records = new Map();
  for (const row of ENROLLMENT) {
    if (!records.has(row.file)) records.set(row.file, JSON.parse(fs.readFileSync(path.join(dir, row.file), "utf8")));
    const parent = row.field.slice(0, -1).reduce((value, key) => value[key], records.get(row.file));
    if (row.initial !== undefined) delete parent[row.field.at(-1)];
    else parent[row.field.at(-1)] = row.file === RELEASE_SIGNER ? "unset" : "UNSET";
  }
  for (const [file, value] of records) fs.writeFileSync(path.join(dir, file), formatRecord(value));
  return dir;
}
/** The record files' current text, to show that a refused or dry run wrote nothing. */
const recordText = dir => Object.fromEntries([RELEASE_SIGNER, PRODUCT, CHANNEL].map(file => [file, fs.readFileSync(path.join(dir, file), "utf8")]));

/** A release-like ceremony directory: throwaway EC certificates with neutral subjects, never real keys. */
function ceremony(t, { subject = name => `/O=Example Release/CN=${name}` } = {}) {
  const dir = scratch(t, "alpha-enroll-ceremony-");
  const keys = [];
  for (const key of manifest.keys) {
    const entry = { name: key.name, kind: key.kind, storage: key.storage };
    if (key.kind === "x509-pk8") {
      const pem = path.join(dir, `${key.name}.x509.pem`);
      execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-subj", subject(key.name), "-days", "1",
        "-keyout", path.join(dir, `${key.name}.key.tmp`), "-out", pem], { stdio: "ignore" });
      fs.rmSync(path.join(dir, `${key.name}.key.tmp`));
      const certificate = new X509Certificate(fs.readFileSync(pem));
      entry.certificateSha256 = certificate.fingerprint256.replaceAll(":", "").toLowerCase();
      entry.subject = certificate.subject.replace(/\n/g, ", ");
    } else {
      const avb = randomBytes(1032);
      fs.writeFileSync(path.join(dir, `${key.name}.avbpubkey`), avb);
      if (key.name === "avb") fs.writeFileSync(path.join(dir, "avb_pkmd.bin"), avb);
      entry.avbPublicKeySha256 = sha256(avb);
    }
    keys.push(entry);
  }
  const fingerprints = { schemaVersion: 1, generatedAt: "2026-10-27T00:00:00.000Z", testKeys: false, organization: "Example Release", manifestReviewedAt: manifest.reviewedAt, keys };
  fs.writeFileSync(path.join(dir, "fingerprints.json"), `${JSON.stringify(fingerprints, null, 2)}\n`);
  return { dir, fingerprints, file: path.join(dir, "fingerprints.json") };
}

function run(argv, rootDir) {
  const out = [], err = [];
  const code = main(argv, { root: rootDir, log: line => out.push(line), error: line => err.push(line) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

test("Alpha's key list is the upstream image signing keys plus one application key, and the pinned ceremony tool accepts it", async () => {
  const upstream = JSON.parse(fs.readFileSync(path.join(root, "vendor/eliza/packages/os/android/signing/key-manifest.json"), "utf8"));
  const names = manifest.keys.map(key => key.name);
  assert.deepEqual(names, ["releasekey", "platform", "shared", "media", "networkstack", "sdk_sandbox", "bluetooth", "nfc", "apex", "apex_payload", "avb", APPLICATION_KEY]);
  for (const key of manifest.keys.filter(row => row.name !== APPLICATION_KEY))
    assert.deepEqual(key, upstream.keys.find(row => row.name === key.name), `${key.name} must match the pinned upstream entry`);
  // Every digest enrollment writes comes from a listed key, and every image certificate the signing job pins is covered.
  for (const row of ENROLLMENT) assert.ok(names.includes(row.key), `${row.field.join(".")} reads ${row.key}`);
  assert.deepEqual(IMAGE_CERTIFICATES, Object.keys(JSON.parse(fs.readFileSync(path.join(root, PRODUCT), "utf8")).signer.releaseCertificates));
  const { loadKeyManifest } = await import("../vendor/eliza/packages/os/scripts/android/generate-release-keys.ts");
  assert.equal(loadKeyManifest(path.join(root, KEY_MANIFEST)).keys.length, names.length);
});

test("a test-key ceremony from the pinned generator is refused, also when its testKeys flag is edited", t => {
  const dir = scratch(t, "alpha-enroll-testkeys-");
  const pass = path.join(dir, "pass");
  fs.writeFileSync(pass, "test-passphrase-0123456789abcdef\n", { mode: 0o600 });
  execFileSync(process.execPath, [path.join(root, "vendor/eliza/packages/os/scripts/android/generate-release-keys.ts"), "--test-keys",
    "--manifest", path.join(root, KEY_MANIFEST), "--output", path.join(dir, "keys"), "--passphrase-file", pass], { stdio: "ignore" });
  const file = path.join(dir, "keys/fingerprints.json");
  const fixture = recordsFixture(t);
  const untouched = recordText(fixture);
  const refused = run(["--fingerprints", file, "--certificates", path.join(dir, "keys"), "--write"], fixture);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /testKeys:true/);
  assert.match(refused.err, /TEST ONLY subject/);
  const edited = JSON.parse(fs.readFileSync(file, "utf8"));
  edited.testKeys = false;
  fs.writeFileSync(file, JSON.stringify(edited));
  const still = run(["--fingerprints", file, "--write"], fixture);
  assert.equal(still.code, 1);
  assert.match(still.err, /releasekey has a test-key ceremony \(TEST ONLY subject\)/);
  assert.deepEqual(recordText(fixture), untouched, "the records must be untouched");
});

test("a release ceremony is recorded field by field, a dry run writes nothing and a repeat is a no-op", t => {
  const fixture = recordsFixture(t);
  const unenrolled = recordText(fixture);
  const { dir, fingerprints, file } = ceremony(t);
  const digest = name => fingerprints.keys.find(key => key.name === name);
  const dry = run(["--fingerprints", file, "--certificates", dir], fixture);
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /Dry run: nothing written/);
  assert.deepEqual(recordText(fixture), unenrolled);
  const certificate = new X509Certificate(fs.readFileSync(path.join(dir, `${APPLICATION_KEY}.x509.pem`)));
  assert.ok(dry.out.includes(certificate.fingerprint), "prints the SHA-1 for the Google Android OAuth client");
  assert.ok(dry.out.includes(certificate.fingerprint256), "prints the colon-form SHA-256 for the App Links association");

  const written = run(["--fingerprints", file, "--certificates", dir, "--write"], fixture);
  assert.equal(written.code, 0, written.err);
  const signer = JSON.parse(fs.readFileSync(path.join(fixture, RELEASE_SIGNER), "utf8"));
  const product = JSON.parse(fs.readFileSync(path.join(fixture, PRODUCT), "utf8"));
  const channel = JSON.parse(fs.readFileSync(path.join(fixture, CHANNEL), "utf8"));
  assert.equal(signer.signerSha256, digest(APPLICATION_KEY).certificateSha256);
  assert.deepEqual(signer.lastRelease, JSON.parse(unenrolled[RELEASE_SIGNER]).lastRelease, "lastRelease follows a distributed release, not enrollment");
  assert.equal(product.signer.platformCertificateSha256, digest("platform").certificateSha256);
  for (const name of IMAGE_CERTIFICATES) assert.equal(product.signer.releaseCertificates[name], digest(name).certificateSha256);
  assert.equal(product.signer.apexPayloadAvbPublicKeySha256, digest("apex_payload").avbPublicKeySha256);
  assert.equal(product.avb.publicKeySha256, digest("avb").avbPublicKeySha256);
  assert.equal(channel.otaCertificateSha256, digest("releasekey").certificateSha256);
  assert.equal(channel.avbPublicKeySha256, digest("avb").avbPublicKeySha256);
  assert.equal(product.releaseQualified, false);
  assert.deepEqual(channel.drills, JSON.parse(unenrolled[CHANNEL]).drills, "drills are recorded from executed drills only");
  // Only digests change: the committed style (inline chainedPartitions) is kept.
  assert.match(fs.readFileSync(path.join(fixture, PRODUCT), "utf8"), /"chainedPartitions": \["vbmeta_system", "vbmeta_vendor"\]/);
  for (const record of [RELEASE_SIGNER, PRODUCT, CHANNEL]) {
    const before = unenrolled[record].split("\n");
    let writtenText = fs.readFileSync(path.join(fixture, record), "utf8");
    if (record === PRODUCT) {
      const existingFields = JSON.parse(writtenText);
      delete existingFields.signer.apexPayloadAvbPublicKeySha256;
      writtenText = formatRecord(existingFields);
    }
    const after = writtenText.split("\n");
    assert.equal(after.length, before.length, `${record} keeps its layout apart from the new APEX payload pin`);
    const changed = after.filter((line, index) => line !== before[index]);
    assert.ok(changed.length > 0 && changed.every(line => /"[a-z_A-Z0-9]+": "[0-9a-f]{64}",?$/.test(line)), `${record} changes only digest lines`);
  }
  const repeat = run(["--fingerprints", file, "--write"], fixture);
  assert.equal(repeat.code, 0, repeat.err);
  assert.match(repeat.out, /already recorded/);
  assert.doesNotMatch(repeat.out, / -> /);
});

test("a different recorded digest is a conflict unless a reviewed rotation passes --replace", t => {
  const fixture = recordsFixture(t);
  const first = ceremony(t);
  assert.equal(run(["--fingerprints", first.file, "--write"], fixture).code, 0);
  const second = ceremony(t);
  const conflict = run(["--fingerprints", second.file, "--write"], fixture);
  assert.equal(conflict.code, 1);
  assert.match(conflict.err, /recorded digest\(s\) differ/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture, RELEASE_SIGNER), "utf8")).signerSha256, first.fingerprints.keys.find(key => key.name === APPLICATION_KEY).certificateSha256);
  const replaced = run(["--fingerprints", second.file, "--write", "--replace"], fixture);
  assert.equal(replaced.code, 0, replaced.err);
  assert.match(replaced.out, /REPLACES a recorded digest/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture, RELEASE_SIGNER), "utf8")).signerSha256, second.fingerprints.keys.find(key => key.name === APPLICATION_KEY).certificateSha256);
});

test("reused, debug, mismatched, missing and unexpected keys are refused before anything is written", t => {
  const fixture = recordsFixture(t);
  const unenrolled = recordText(fixture);
  const { dir, fingerprints, file } = ceremony(t);
  const clone = () => JSON.parse(JSON.stringify(fingerprints));
  const refuse = (value, pattern, options = {}) => {
    const problems = fingerprintProblems(value, manifest, options);
    assert.ok(problems.some(problem => pattern.test(problem)), `expected ${pattern} in ${JSON.stringify(problems)}`);
  };
  const reused = clone();
  reused.keys.find(key => key.name === "media").certificateSha256 = reused.keys.find(key => key.name === "platform").certificateSha256;
  refuse(reused, /media and platform share one certificate/);
  const app = fingerprints.keys.find(key => key.name === APPLICATION_KEY).certificateSha256;
  refuse(clone(), /alphaphone_app is a debug signing certificate/, { debugSigners: [app.toUpperCase().match(/../g).join(":")] });
  const missing = clone();
  missing.keys = missing.keys.filter(key => key.name !== "nfc");
  refuse(missing, /lacks nfc/);
  const extra = clone();
  extra.keys.push({ name: "release_manifest", kind: "ed25519", spkiSha256: "a".repeat(64) });
  refuse(extra, /release_manifest, which android\/signing\/alpha-key-manifest\.json does not list/);
  const aosp = clone();
  aosp.keys.find(key => key.name === "platform").subject = "C=US, ST=California, L=Mountain View, O=Android, OU=Android, CN=Android, emailAddress=android@android.com";
  refuse(aosp, /platform has the public AOSP test-key subject/);
  assert.equal(testSubjectProblem("C=US, O=Android, CN=Android Debug"), "the Android debug-keystore subject");
  assert.equal(testSubjectProblem("O=Alpha Compute, OU=Release, CN=platform"), null);

  // A debug row that verify-apks recorded on this machine is refused through the CLI too.
  fs.mkdirSync(path.join(fixture, "artifacts"));
  fs.writeFileSync(path.join(fixture, "artifacts/apk-manifest.json"), JSON.stringify({ results: [{ mode: "debug", signerSha256: app }] }));
  const debug = run(["--fingerprints", file, "--write"], fixture);
  assert.equal(debug.code, 1);
  assert.match(debug.err, /alphaphone_app is a debug signing certificate/);
  fs.rmSync(path.join(fixture, "artifacts"), { recursive: true });

  // --certificates re-hashes the public files: a swapped certificate or AVB key is refused.
  fs.copyFileSync(path.join(dir, "shared.x509.pem"), path.join(dir, "media.x509.pem"));
  fs.writeFileSync(path.join(dir, "avb_pkmd.bin"), randomBytes(1032));
  fs.writeFileSync(path.join(dir, "apex_payload.avbpubkey"), randomBytes(1032));
  const swapped = run(["--fingerprints", file, "--certificates", dir, "--write"], fixture);
  assert.equal(swapped.code, 1);
  assert.match(swapped.err, /media\.x509\.pem is [0-9a-f]{64}, not fingerprints\.json/);
  assert.match(swapped.err, /avb_pkmd\.bin does not hash to fingerprints\.json/);
  assert.match(swapped.err, /apex_payload\.avbpubkey does not hash to fingerprints\.json/);
  assert.deepEqual(recordText(fixture), unenrolled);
  assert.equal(run(["--write"], fixture).code, 2, "--fingerprints is required");
});

test("the committed records are in the format enrollment writes", () => {
  for (const record of [RELEASE_SIGNER, PRODUCT, CHANNEL]) {
    const text = fs.readFileSync(path.join(root, record), "utf8");
    assert.equal(formatRecord(JSON.parse(text)), text, `${record} round-trips byte for byte`);
  }
});
