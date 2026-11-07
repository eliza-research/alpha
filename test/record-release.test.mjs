// Recording a distributed release as lastRelease (docs/human-actions.md H-32) on synthetic
// manifests and copies of android/release-signer.json. Not a build, signature or distribution.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { main, releaseToRecord } from "../scripts/record-release.mjs";
import { releaseAdmission } from "../scripts/build-android.mjs";

const root = path.resolve(import.meta.dirname, "..");
const SIGNER = "a".repeat(64);
const sha = text => createHash("sha256").update(text).digest("hex");
// Everything verify-apks records for a distributable release (as in test/pilot-units.test.mjs).
const DISTRIBUTABLE = { mode: "release", signed: true, signerSha256: SIGNER, distributable: true, runtime: "PACKAGED", runtimeNotices: true, testMocks: false, bundleAudit: "passed",
  voiceHost: { packaged: true, asr: true, differences: [], qualified: true }, licenceBlockers: [] };

/**
 * A checkout with the committed release-signer record (signer set to SIGNER, no release recorded
 * unless `last` names one, whatever the checkout has recorded since) and a verify-apks build of both releases.
 */
function fixture(t, { rows = {}, last = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-record-release-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const committed = JSON.parse(fs.readFileSync(path.join(root, "android/release-signer.json"), "utf8"));
  fs.mkdirSync(path.join(dir, "android"), { recursive: true });
  fs.writeFileSync(path.join(dir, "android/release-signer.json"), `${JSON.stringify({ ...committed, signerSha256: SIGNER, lastRelease: last ?? { versionCode: null, versionName: null, recordedAt: null } }, null, 2)}\n`);
  fs.mkdirSync(path.join(dir, "artifacts"));
  const results = ["standalone", "launcher"].map(variant => {
    const name = `${variant}-release.apk`;
    fs.writeFileSync(path.join(dir, "artifacts", name), `${variant} bytes`);
    return { variant, file: `artifacts/${name}`, sha256: sha(`${variant} bytes`), versionCode: 12, versionName: "1.0.0", ...DISTRIBUTABLE, ...rows[variant] };
  });
  fs.writeFileSync(path.join(dir, "artifacts/apk-manifest.json"), JSON.stringify({ testMocks: false, results }));
  return dir;
}
const io = () => { const out = [], err = []; return { out, err, log: line => out.push(line), error: line => err.push(line) }; };
const signer = dir => JSON.parse(fs.readFileSync(path.join(dir, "android/release-signer.json"), "utf8"));

test("a distributed release is recorded as lastRelease only with --write, and later builds must then advance", t => {
  const dir = fixture(t);
  const before = fs.readFileSync(path.join(dir, "android/release-signer.json"), "utf8");
  const dry = io();
  assert.equal(main(["--apk-manifest", "artifacts/apk-manifest.json"], { root: dir, now: new Date("2026-11-02T10:00:00Z"), ...dry }), 0);
  assert.match(dry.out.join("\n"), /lastRelease: none -> 1\.0\.0 \(12, 2026-11-02\)/);
  assert.match(dry.out.join("\n"), /Dry run: nothing written/);
  assert.equal(fs.readFileSync(path.join(dir, "android/release-signer.json"), "utf8"), before);

  const write = io();
  assert.equal(main(["--apk-manifest", "artifacts/apk-manifest.json", "--date", "2026-11-03", "--write"], { root: dir, ...write }), 0);
  const recorded = signer(dir);
  assert.deepEqual(recorded.lastRelease, { versionCode: 12, versionName: "1.0.0", recordedAt: "2026-11-03" });
  assert.equal(recorded.signerSha256, SIGNER, "only lastRelease changes");
  assert.equal(recorded.description, JSON.parse(before).description);
  // From now on the same versionCode is refused by verify-apks and provisioning, and recording it again is refused.
  assert.match(releaseAdmission({ signed: true, signerSha256: SIGNER, versionCode: 12 }, recorded).failures.join(), /not greater than the last recorded release 12/);
  assert.equal(releaseAdmission({ signed: true, signerSha256: SIGNER, versionCode: 13 }, recorded).failures.length, 0);
  const again = io();
  assert.equal(main(["--apk-manifest", "artifacts/apk-manifest.json", "--write"], { root: dir, ...again }), 1);
  assert.match(again.err.join("\n"), /not greater than the last recorded release 12/);
});

test("a release that is not distributable, differs between variants or does not match its file is refused before anything is written", t => {
  const cases = [
    [{ rows: { launcher: { signed: false } } }, /launcher: .*unsigned release/s],
    [{ rows: { standalone: { signerSha256: "b".repeat(64) } } }, /standalone: .*does not match/s],
    [{ rows: { launcher: { voiceHost: { packaged: true, asr: true, differences: [], qualified: false } } } }, /device qualification pending/],
    [{ rows: { launcher: { versionCode: 13 } } }, /different versions/],
    [{ rows: { standalone: { sha256: "c".repeat(64) } } }, /does not match its verified manifest row/],
    [{ last: { versionCode: 12, versionName: "1.0.0", recordedAt: "2026-11-01" } }, /not greater than the last recorded release 12/],
  ];
  for (const [options, message] of cases) {
    const dir = fixture(t, options);
    const before = fs.readFileSync(path.join(dir, "android/release-signer.json"), "utf8");
    const run = io();
    assert.equal(main(["--apk-manifest", "artifacts/apk-manifest.json", "--write"], { root: dir, ...run }), 1, String(message));
    assert.match(run.err.join("\n"), message);
    assert.equal(fs.readFileSync(path.join(dir, "android/release-signer.json"), "utf8"), before, "nothing written");
  }
  // A test-mocks manifest is never a release.
  const mocks = fixture(t);
  const manifest = path.join(mocks, "artifacts/apk-manifest.json");
  fs.writeFileSync(manifest, JSON.stringify({ ...JSON.parse(fs.readFileSync(manifest, "utf8")), testMocks: true }));
  assert.match(releaseToRecord(manifest, signer(mocks)).problems.join(), /test-mocks build/);
});

test("usage errors and an unset signer are refused", t => {
  for (const argv of [[], ["--write"], ["--apk-manifest"], ["--apk-manifest", "m.json", "--date", "11/03/2026"], ["--apk-manifest", "m.json", "--date", "2026-02-30"], ["--apk-manifest", "m.json", "--extra"]]) {
    const run = io();
    assert.equal(main(argv, { root, ...run }), 2, argv.join(" "));
  }
  const dir = fixture(t);
  const file = path.join(dir, "android/release-signer.json");
  fs.writeFileSync(file, JSON.stringify({ ...signer(dir), signerSha256: "unset" }));
  const run = io();
  assert.equal(main(["--apk-manifest", "artifacts/apk-manifest.json", "--write"], { root: dir, ...run }), 1);
  assert.match(run.err.join("\n"), /release signer is unset/);
});
