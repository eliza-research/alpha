// Writing the one-tap update manifest from a verify-apks release row, on synthetic manifests and a copy
// of android/release-signer.json. Not a build, signature, upload or install.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { main, MANIFEST_NAME } from "../scripts/publish-update-manifest.ts";

const root = path.resolve(import.meta.dirname, "..");
const SIGNER = "a".repeat(64);
const sha = text => createHash("sha256").update(text).digest("hex");
// Everything verify-apks records for a distributable release (as in test/record-release.test.mjs).
const DISTRIBUTABLE = { mode: "release", signed: true, signerSha256: SIGNER, distributable: true, runtime: "PACKAGED", runtimeNotices: true, testMocks: false, bundleAudit: "passed",
  voiceHost: { packaged: true, asr: true, differences: [], qualified: true }, licenceBlockers: [], releaseAdmission: { failures: [], blockers: [], signerMatches: true } };

function fixture(t, rows = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-update-manifest-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const committed = JSON.parse(fs.readFileSync(path.join(root, "android/release-signer.json"), "utf8"));
  fs.mkdirSync(path.join(dir, "android"), { recursive: true });
  fs.writeFileSync(path.join(dir, "android/release-signer.json"), JSON.stringify({ ...committed, signerSha256: SIGNER, lastRelease: { versionCode: 1, versionName: "0.1.0", recordedAt: "2026-11-01" } }));
  fs.copyFileSync(path.join(root, "app.config.json"), path.join(dir, "app.config.json"));
  fs.mkdirSync(path.join(dir, "artifacts"));
  const results = ["launcher"].map(variant => {
    const name = `${variant}-release.apk`;
    fs.writeFileSync(path.join(dir, "artifacts", name), `${variant} bytes`);
    return { variant, file: `artifacts/${name}`, sha256: sha(`${variant} bytes`), versionCode: 2, versionName: "0.1.1", ...DISTRIBUTABLE, ...rows[variant] };
  });
  fs.writeFileSync(path.join(dir, "artifacts/apk-manifest.json"), JSON.stringify({ testMocks: false, results }));
  return dir;
}
// These tests use synthetic APK bytes; native archive inspection has separate
// contradiction tests. Production's default inspector is mandatory at the CLI.
const io = () => { const out = [], err = []; return { out, err, inspectApk: () => ({signerRootSha256:SIGNER}), log: line => out.push(line), error: line => err.push(line) }; };
const written = dir => path.join(dir, "artifacts/app-stable", MANIFEST_NAME);


test("a distributable signed release becomes the manifest phones parse, beside its APK copy", t => {
  const dir = fixture(t);
  const run = io();
  assert.equal(main(["--variant", "launcher", "--notes", "Fixes"], { root: dir, ...run }), 0, run.err.join("\n"));
  const update = JSON.parse(fs.readFileSync(written(dir), "utf8"));
  const { updateManifestUrl } = JSON.parse(fs.readFileSync(path.join(root, "app.config.json"), "utf8"));
  assert.deepEqual(update, {
    schema: "alpha-update/v1", versionCode: 2, versionName: "0.1.1", variant: "launcher", signerSha256: SIGNER,
    apkUrl: new URL("alpha-phone-2.apk", updateManifestUrl).href, sha256: sha("launcher bytes"), sizeBytes: "launcher bytes".length, notes: "Fixes",
  });
  assert.equal(fs.readFileSync(path.join(dir, "artifacts/app-stable/alpha-phone-2.apk"), "utf8"), "launcher bytes");
});

test("a release that is not distributable, unsigned, signed otherwise or not the verified file writes nothing", t => {
  const cases = [
    [{ distributable: false }, /not distributable/],
    [{ signed: false }, /unsigned release/],
    [{ signerSha256: "b".repeat(64), releaseAdmission: { failures: [], blockers: [], signerMatches: false } }, /not recorded as signed by android\/release-signer.json/],
    [{ sha256: "c".repeat(64) }, /does not match its verified manifest row/],
  ];
  for (const [row, message] of cases) {
    const dir = fixture(t, { launcher: row });
    const run = io();
    assert.equal(main(["--variant", "launcher"], { root: dir, ...run }), 1, String(message));
    assert.match(run.err.join("\n"), message);
    assert.equal(fs.existsSync(written(dir)), false);
  }
});

test("an unknown variant or overlong notes are a usage error", t => {
  const dir = fixture(t);
  assert.equal(main(["--variant", "debug"], { root: dir, ...io() }), 2);
  assert.equal(main(["--variant", "launcher", "--notes", "x".repeat(501)], { root: dir, ...io() }), 2);
  assert.equal(fs.existsSync(written(dir)), false);
});

test("a release row cannot override contradictory archive facts", t => {
  const dir = fixture(t), run = io();
  let inspected = false;
  assert.equal(main(["--variant", "launcher"], { root: dir, ...run, inspectApk(apk, { descriptor }) {
    inspected = true;
    assert.equal(apk.sha256, sha("launcher bytes"));
    assert.equal(descriptor.signerSha256, SIGNER);
    throw Error("archive signer differs from the enrolled release signer");
  } }), 1);
  assert.equal(inspected, true);
  assert.match(run.err.join("\n"), /archive signer differs/);
  assert.equal(fs.existsSync(written(dir)), false);
});

test("the feed selects the APK's verified original signing family after approved rotation", t => {
  const dir = fixture(t), run = io(), originalRoot = 'b'.repeat(64);
  assert.equal(main(['--variant','launcher'],{root:dir,...run,inspectApk:()=>({signerRootSha256:originalRoot})}),0);
  assert.equal(JSON.parse(fs.readFileSync(written(dir),'utf8')).signerSha256,originalRoot);
});
