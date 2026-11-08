// Read-only production staging preflight (issue #672). These tests check the report against the
// committed records and fixture copies; they establish nothing about an image build, signature,
// boot, device or release.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { CHANNEL, CUTTLEFISH_PRODUCT, GATES, PIXEL10A_PRODUCT, RELEASE_SIGNER, filledBy, placeholderFields, stagingPreflight } from "../scripts/owner/production-staging-preflight.mjs";

const root = path.resolve(import.meta.dirname, "..");
const script = path.join(root, "scripts/owner/production-staging-preflight.mjs");
const read = (base, rel) => JSON.parse(fs.readFileSync(path.join(base, rel), "utf8"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const pixelLock = read(root, PIXEL10A_PRODUCT).sourceLock.file;
const cuttlefishLock = read(root, CUTTLEFISH_PRODUCT).sourceLock.file;
const vendorPresent = fs.existsSync(path.join(root, pixelLock));

/** A copy of every record the preflight reads. */
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-preflight-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const rel of [CUTTLEFISH_PRODUCT, PIXEL10A_PRODUCT, RELEASE_SIGNER, CHANNEL, GATES, "android/aosp/brand.alphaphone.json", "app.config.json", pixelLock, cuttlefishLock]) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.copyFileSync(path.join(root, rel), path.join(dir, rel));
  }
  const write = (rel, value) => fs.writeFileSync(path.join(dir, rel), typeof value === "string" ? value : JSON.stringify(value, null, 2));
  return { dir, write };
}

/** Fill every open record field and pass every drill and gate, as a finished release would. */
function complete(repo) {
  const hex = c => c.repeat(64);
  const product = read(repo.dir, PIXEL10A_PRODUCT);
  product.signer.platformCertificateSha256 = hex("a");
  for (const name of Object.keys(product.signer.releaseCertificates)) product.signer.releaseCertificates[name] = hex("b");
  product.avb.publicKeySha256 = hex("c");
  repo.write(PIXEL10A_PRODUCT, product);
  const cf = read(repo.dir, CUTTLEFISH_PRODUCT);
  cf.hostPackages = cf.hostPackages.map(item => ({ ...item, version: "1.0.0", sha256: hex("d") }));
  cf.signer.platformCertificateSha256 = hex("a");
  repo.write(CUTTLEFISH_PRODUCT, cf);
  repo.write(RELEASE_SIGNER, { ...read(repo.dir, RELEASE_SIGNER), signerSha256: hex("e") });
  const channel = read(repo.dir, CHANNEL);
  Object.assign(channel, { otaCertificateSha256: hex("f"), avbPublicKeySha256: hex("c") });
  channel.recovery.knownGoodRelease = { buildFingerprint: "Alpha/alpha_stallion_phone/stallion:17/X/1:user/release-keys", otaSha256: hex("1"), recordFile: "releases/x/release-record.json" };
  for (const drill of Object.keys(channel.drills)) channel.drills[drill] = "passed";
  repo.write(CHANNEL, channel);
  const gates = read(repo.dir, GATES);
  for (const gate of Object.values(gates.gates)) gate.status = "passed";
  repo.write(GATES, gates);
}

test("the committed records: every UNSET field is listed once with the step that fills it", { skip: !vendorPresent && "pinned checkout absent" }, () => {
  const result = stagingPreflight(root);
  assert.equal(result.ready, false);
  assert.deepEqual(result.unreadable, []);
  const byFile = Object.groupBy(result.open, item => item.file);
  assert.match(read(root, RELEASE_SIGNER).signerSha256, /^[0-9a-f]{64}$/);
  assert.equal(byFile[RELEASE_SIGNER], undefined, "the enrolled app signer is no longer an open field");
  assert.deepEqual(byFile[CHANNEL].map(item => item.field).sort(), ["avbPublicKeySha256", "otaCertificateSha256", "recovery.knownGoodRelease.buildFingerprint", "recovery.knownGoodRelease.otaSha256", "recovery.knownGoodRelease.recordFile"]);
  assert.ok(byFile[PIXEL10A_PRODUCT].some(item => item.field === "avb.publicKeySha256"));
  assert.ok(byFile[CUTTLEFISH_PRODUCT].some(item => item.field === "hostPackages[0].sha256" && item.step === "A-01 / H-23"));
  // enroll-release-keys.mjs does not write product.json, so its platform digest is a separate edit.
  assert.equal(byFile[CUTTLEFISH_PRODUCT].find(item => item.field === "signer.platformCertificateSha256")?.step, "H-09 (manual)");
  assert.equal(byFile[pixelLock], undefined, "the admitted Pixel 10a source lock carries no placeholder");
  for (const item of result.open) assert.notEqual(item.step, "unmapped", `${item.file} ${item.field}`);
  for (const name of ["Pixel 10a source lock bytes match sourceLock.sha256", "Pixel 10a source lock is not developmentOnly"])
    assert.equal(result.checks.find(item => item.name === name)?.ok, true, name);
});

test("the local placeholder rule matches the shared Pixel 10a rule on every record", { skip: !vendorPresent && "pinned checkout absent" }, async () => {
  const shared = await import("../vendor/eliza/packages/os/scripts/android/pixel10a-release.mjs");
  for (const rel of [CUTTLEFISH_PRODUCT, PIXEL10A_PRODUCT, RELEASE_SIGNER, CHANNEL, pixelLock])
    assert.deepEqual(placeholderFields(read(root, rel)), shared.placeholderFields(read(root, rel)), rel);
  for (const value of ["UNSET", " tbd ", "Todo", "a placeholder value", "unsettled", "0".repeat(64), null, 3])
    assert.deepEqual(placeholderFields({ value }), shared.placeholderFields({ value }), String(value));
});

test("a finished release's records leave nothing open; each reintroduced gap is reported", { skip: !vendorPresent && "pinned checkout absent" }, t => {
  const repo = fixture(t);
  complete(repo);
  const done = stagingPreflight(repo.dir);
  assert.deepEqual(done.open, []);
  assert.deepEqual(done.checks.filter(item => !item.ok), []);
  assert.equal(done.ready, true);

  const lockBytes = fs.readFileSync(path.join(repo.dir, pixelLock), "utf8");
  repo.write(pixelLock, lockBytes.replace('"developmentOnly": false', '"developmentOnly": true'));
  const lock = stagingPreflight(repo.dir);
  assert.equal(lock.ready, false);
  assert.equal(lock.checks.find(item => item.name.includes("not developmentOnly")).ok, false);
  assert.equal(lock.checks.find(item => item.name.includes("match sourceLock.sha256")).ok, false, "edited lock bytes no longer match the pin");
  repo.write(pixelLock, lockBytes);
  assert.equal(sha256(fs.readFileSync(path.join(repo.dir, pixelLock))), read(repo.dir, PIXEL10A_PRODUCT).sourceLock.sha256);

  const channel = read(repo.dir, CHANNEL);
  repo.write(CHANNEL, { ...channel, drills: { ...channel.drills, stockRecovery: "failed" }, recovery: { ...channel.recovery, knownGoodRelease: { ...channel.recovery.knownGoodRelease, otaSha256: "UNSET" } } });
  const drill = stagingPreflight(repo.dir);
  assert.deepEqual(drill.open.map(item => `${item.file} ${item.field} ${item.step}`), [`${CHANNEL} recovery.knownGoodRelease.otaSha256 H-22`]);
  assert.equal(drill.checks.find(item => item.name === "drill stockRecovery passed (H-25)").ok, false);

  repo.write(PIXEL10A_PRODUCT, { ...read(repo.dir, PIXEL10A_PRODUCT), releaseQualified: true });
  assert.equal(stagingPreflight(repo.dir).checks.find(item => item.name.endsWith("releaseQualified stays false before release evidence")).ok, false);
});

test("an unenrolled app signer remains a separate open input", { skip: !vendorPresent && "pinned checkout absent" }, t => {
  const repo = fixture(t);
  repo.write(RELEASE_SIGNER, { ...read(repo.dir, RELEASE_SIGNER), signerSha256: "unset" });
  const open = stagingPreflight(repo.dir).open.filter(item => item.file === RELEASE_SIGNER);
  assert.deepEqual(open.map(item => [item.field, item.step]), [["signerSha256", "H-09"]]);
});

test("a missing record is reported, not skipped", { skip: !vendorPresent && "pinned checkout absent" }, t => {
  const repo = fixture(t);
  fs.rmSync(path.join(repo.dir, CHANNEL));
  const result = stagingPreflight(repo.dir);
  assert.equal(result.ready, false);
  assert.deepEqual(result.unreadable.map(item => [item.file, item.error]), [[CHANNEL, "missing"]]);
});

test("an unknown placeholder field is flagged as unmapped instead of being attributed to a step", () => {
  assert.equal(filledBy(PIXEL10A_PRODUCT, "lunch.production").step, "unmapped");
  assert.equal(filledBy(CHANNEL, "recovery.knownGoodRelease.recordFile").step, "H-22");
  assert.equal(filledBy(RELEASE_SIGNER, "signerSha256").step, "H-09");
});

test("the CLI reports, exits 1 only under --strict, refuses unknown flags and never writes", { skip: !vendorPresent && "pinned checkout absent" }, () => {
  const run = args => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
  const text = run([]);
  assert.equal(text.status, 0, text.stderr);
  assert.doesNotMatch(text.stdout, /UNSET signerSha256/);
  assert.match(text.stdout, /UNSET signer\.platformCertificateSha256/);
  assert.match(text.stdout, /Shared staging checks \(authoritative/);
  const json = JSON.parse(run(["--json"]).stdout);
  assert.equal(json.ready, false);
  assert.ok(Array.isArray(json.shared.pixel10a) && json.shared.pixel10a.length > 0);
  assert.equal(run(["--strict"]).status, 1);
  assert.equal(run(["--write"]).status, 2);
  const source = fs.readFileSync(script, "utf8");
  assert.doesNotMatch(source, /writeFileSync|appendFileSync|rmSync|fetch\(|node:https?|node:net|child_process/, "the preflight only reads files");
});
