// Pilot provisioning/update policy on synthetic inputs; not emulator or device evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { admitUnitApk, apkContradictions, apkFacts, apkRuntimeIdentity, packageFacts, parseUnitArgs, requireConsistentApk, snapshotUnitApk } from "../scripts/provision-unit.ts";
import { releaseBlockers } from "../scripts/release-blockers.ts";
import { compareDomains, DOMAIN_SCRIPT, parseDomainInventory, readbackInventory, unitApkMismatch, updateAdmission } from "../scripts/pilot-update.ts";

const sha = text => createHash("sha256").update(text).digest("hex");
const SIGNER = "a".repeat(64);

function build(t, row, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-pilot-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const name = row.mode === "release" ? "launcher-release.apk" : "launcher-debug.apk";
  fs.writeFileSync(path.join(dir, name), "apk bytes");
  fs.writeFileSync(path.join(dir, "apk-manifest.json"), JSON.stringify({ testMocks: false, ...extra,
    results: [{ variant: "launcher", file: `artifacts/${name}`, sha256: sha("apk bytes"), versionCode: 5, versionName: "0.5.0", testMocks: false, bundleAudit: "passed", ...row }] }));
  return path.join(dir, "apk-manifest.json");
}
// Everything verify-apks records for a distributable release.
const DISTRIBUTABLE = { mode: "release", signed: true, signerSha256: SIGNER, distributable: true, runtime: "PACKAGED", runtimeNotices: true,
  voiceHost: { packaged: true, asr: true, differences: [], qualified: true }, licenceBlockers: [] };
const descriptor = (signerSha256 = SIGNER, versionCode = 4) => ({ schema: 1, signerSha256, lastRelease: { versionCode, versionName: null, recordedAt: null } });

test("unit arguments require an alias that is neither a name nor a serial pattern", () => {
  const options = parseUnitArgs(["--serial", "emulator-5554", "--alias", "unit-01", "--apk-manifest", "m.json"]);
  assert.deepEqual([options.variant, options.build], ["launcher", "release"]);
  for (const alias of ["Unit 1", "", "a".repeat(41)]) assert.throws(() => parseUnitArgs(["--serial", "emulator-5554", "--alias", alias, "--apk-manifest", "m"]));
  assert.throws(() => parseUnitArgs(["--serial", "x;id", "--alias", "u", "--apk-manifest", "m"]));
  assert.throws(() => parseUnitArgs(["--serial", "s", "--alias", "u", "--apk-manifest", "m", "--build", "test-mocks"]));
});

test("a pilot release must be signed by the recorded signer, advance versionCode and pass the audit", t => {
  const ok = admitUnitApk(build(t, DISTRIBUTABLE), { variant: "launcher", build: "release" }, { descriptor: descriptor() });
  assert.equal(ok.distributable, true);
  assert.equal(ok.signed, true);
  assert.equal(ok.rehearsal, false);
  assert.throws(() => admitUnitApk(build(t, { mode: "release", signed: false }), { variant: "launcher", build: "release" }, { descriptor: descriptor() }), /unsigned/);
  assert.throws(() => admitUnitApk(build(t, { mode: "release", signed: true, signerSha256: "b".repeat(64) }), { variant: "launcher", build: "release" }, { descriptor: descriptor() }), /does not match/);
  assert.throws(() => admitUnitApk(build(t, { mode: "release", signed: true, signerSha256: SIGNER }), { variant: "launcher", build: "release" }, { descriptor: descriptor("unset") }), /unset/);
  assert.throws(() => admitUnitApk(build(t, { mode: "release", signed: true, signerSha256: SIGNER }), { variant: "launcher", build: "release" }, { descriptor: descriptor(SIGNER, 5) }), /not greater/);
  assert.throws(() => admitUnitApk(build(t, { mode: "release", signed: true, signerSha256: SIGNER }, { testMocks: true }), { variant: "launcher", build: "release" }, { descriptor: descriptor() }), /test-mocks/);
  const rehearsal = admitUnitApk(build(t, { mode: "debug", signed: true }), { variant: "launcher", build: "debug" }, { descriptor: descriptor("unset") });
  assert.equal(rehearsal.rehearsal, true);
  const changed = build(t, { mode: "debug", signed: true });
  fs.writeFileSync(path.join(path.dirname(changed), "launcher-debug.apk"), "other");
  assert.throws(() => admitUnitApk(changed, { variant: "launcher", build: "debug" }, { descriptor: descriptor() }), /does not match/);
});

test("installed release readback bypasses only the new-release version floor", t => {
  const selection = { variant: "launcher", build: "release" };
  const current = descriptor(SIGNER, 5);
  const recorded = build(t, DISTRIBUTABLE);
  const readback = { descriptor: current, installedReadback: true };
  assert.throws(() => admitUnitApk(recorded, selection, { descriptor: current }), /not greater/);
  assert.equal(admitUnitApk(recorded, selection, readback).versionCode, 5);
  assert.throws(() => admitUnitApk(build(t, { ...DISTRIBUTABLE, signerSha256: "b".repeat(64) }), selection, readback), /does not match/);
  assert.throws(() => admitUnitApk(build(t, { ...DISTRIBUTABLE, runtimeNotices: false }), selection, readback), /notices lack the packaged runtime/);
  fs.writeFileSync(path.join(path.dirname(recorded), "launcher-release.apk"), "different bytes");
  assert.throws(() => admitUnitApk(recorded, selection, readback), /does not match its verified manifest row/);
});

test("a pilot or acceptance unit never gets a non-distributable release, and every blocker is named", t => {
  const admit = (row, extra) => admitUnitApk(build(t, { ...DISTRIBUTABLE, ...row }, extra), { variant: "launcher", build: "release" }, { descriptor: descriptor() });
  const refusal = (row, extra) => { try { admit(row, extra); } catch (error) { return error.message; } return assert.fail(`admitted ${JSON.stringify(row)}`); };
  const font = "unresolved-font-licence: Denton typeface (assets/denton.woff2) has no recorded embedding licence; license it or replace it before distribution (owner decision A-21, licenses/font-licenses.json)";
  // Owner decision 2026-10-10 (P-09, A-21): the Denton font check is flag-only. It is recorded but is not a blocker,
  // so a row that names it and is otherwise distributable is admitted, and a refused row does not cite it.
  assert.equal(admit({ licenceBlockers: [font], fontLicenceCheck: { check: "unresolved-font-licence", blocksDistribution: false, items: [font] } }).distributable, true);
  assert.doesNotMatch(refusal({ distributable: false, licenceBlockers: [font] }), /unresolved-font-licence/);
  assert.match(refusal({ distributable: false, licenceBlockers: [font] }), /verify-apks did not record this release as distributable/);
  // With the policy constant restored to blocking, the same recorded item is a named blocker again.
  assert.deepEqual(releaseBlockers({ ...DISTRIBUTABLE, testMocks: false, bundleAudit: "passed", releaseAdmission: { failures: [], blockers: [], signerMatches: true }, licenceBlockers: [font] }, { fontLicenceBlocks: true }), [font]);
  // The check must still have been run and recorded.
  assert.match(refusal({ licenceBlockers: undefined }), /font licence check was not recorded/);
  assert.match(refusal({ distributable: false, runtime: "NOT_PACKAGED", runtimeNotices: false }), /unpackaged runtime \(resident runtime NOT_PACKAGED\)/);
  assert.match(refusal({ runtime: undefined }), /unpackaged runtime \(resident runtime not recorded\)/);
  assert.match(refusal({ runtimeNotices: false }), /notices lack the packaged runtime/);
  // A packaged voice bundle needs the admitted bytes; device acceptance is observed separately.
  assert.match(refusal({ voiceHost: { packaged: true, asr: true, differences: ["assets/paradee-voice/v1/x: differs"], qualified: false } }), /bytes differ from the voice-host record/);
  assert.equal(admit({ voiceHost: { packaged: true, asr: true, differences: [], qualified: false } }).distributable, true);
  assert.match(refusal({ voiceHost: { packaged: false, asr: false, differences: [], qualified: false } }), /no on-device voice packaged/);
  assert.equal(admit({ voiceHost: { packaged: true, asr: true, differences: [], qualified: true } }).distributable, true);
  assert.match(refusal({ voiceHost: undefined }), /on-device voice admission was not recorded/);
  assert.match(refusal({ testMocks: true }), /test-mocks build/);
  assert.match(refusal({ bundleAudit: "failed" }), /flag-off bundle audit/);
  assert.match(refusal({ distributable: false }), /verify-apks did not record this release as distributable/);
  assert.match(refusal({ releaseAdmission: { failures: [], blockers: ["release signer is unset in android/release-signer.json"], signerMatches: false } }), /release signer is unset/);
  // All open blockers are listed together, once each.
  const all = refusal({ distributable: false, signed: false, signerSha256: null, runtime: "NOT_PACKAGED", licenceBlockers: [font, font],
    voiceHost: { packaged: true, asr: true, differences: ["assets/paradee-voice/v1/x: differs"], qualified: false } });
  const listed = all.split("\n").filter(line => line.startsWith("  - "));
  assert.deepEqual(listed.map(line => line.slice(4).split(/[:(]/)[0].trim()), ["unsigned release", "unpackaged runtime", "unqualified on-device voice"]);
  assert.match(all, /--build debug rehearses the same steps on a disposable emulator/);
  // The documented rehearsal path is unchanged: a debug row is admitted, labelled, and never distributable.
  const rehearsal = admitUnitApk(build(t, { mode: "debug", signed: true }), { variant: "launcher", build: "debug" }, { descriptor: descriptor() });
  assert.deepEqual([rehearsal.rehearsal, rehearsal.distributable], [true, false]);
  // A debug row can never be passed off as the release.
  assert.throws(() => admitUnitApk(build(t, { mode: "debug", signed: true, distributable: true }), { variant: "launcher", build: "release" }, { descriptor: descriptor() }), /no launcher release APK/);
});

test("pilot release admission rejects another update channel in either the record or the exact APK", t => {
  const publicChannel = {kind: "public", manifestUrlSha256: sha("public")};
  const otherChannel = {kind: "other", manifestUrlSha256: sha("other fixture")};
  const admit = (row, extra) => admitUnitApk(build(t, {...DISTRIBUTABLE, ...row}, extra),
    {variant: "launcher", build: "release"}, {descriptor: descriptor()});
  assert.throws(() => admit({updateChannel: otherChannel}, {updateChannel: publicChannel}), /Update channel input refused/);
  assert.throws(() => admit({updateChannel: publicChannel}, {updateChannel: otherChannel}), /Update channel input refused/);
  const legacy = admit({}, {});
  const release = admit({updateChannel: publicChannel}, {updateChannel: publicChannel});
  const facts = {testMocks: false, debuggable: false, runtime: "PACKAGED", signerSha256: SIGNER};
  const check = (apk, updateChannel) => apkContradictions(apk, {descriptor: descriptor(), facts: {...facts, updateChannel}});
  assert.deepEqual(check(legacy, "legacy"), []);
  assert.deepEqual(check(release, publicChannel), []);
  assert.match(check(legacy, publicChannel).join(), /differs from the reviewed release/);
  assert.match(check(release, "legacy").join(), /differs from the reviewed release/);
  assert.match(check(release, null).join(), /could not be verified/);
});

test("pilot installers get a private copy of the admitted APK bytes", t => {
  const manifest = build(t, DISTRIBUTABLE);
  const release = admitUnitApk(manifest, {variant: "launcher", build: "release"}, {descriptor: descriptor()});
  const destination = fs.mkdtempSync(path.join(path.dirname(manifest), "staged-"));
  const candidate = snapshotUnitApk(release, destination);
  assert.equal(candidate.sha256, release.sha256);
  assert.equal(fs.statSync(candidate.file).mode & 0o777, 0o400);
  fs.writeFileSync(release.file, "different bytes");
  assert.equal(fs.readFileSync(candidate.file, "utf8"), "apk bytes");
  const next = fs.mkdtempSync(path.join(path.dirname(manifest), "staged-"));
  assert.throws(() => snapshotUnitApk(release, next), /changed after APK admission/);
});

test("the packaged agent bundle is hashed whatever its size, and an unreadable bundle fails provisioning", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-runtime-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "assets/agent"), { recursive: true });
  fs.writeFileSync(path.join(dir, "assets/agent/alpha-source.json"), JSON.stringify({ base: "b".repeat(40), patches: [] }));
  const zip = (name, ...entries) => { execFileSync("zip", ["-q", name, ...entries], { cwd: dir }); return path.join(dir, name); };
  // Larger than the 64 MiB a buffered read used to allow.
  const bundle = Buffer.alloc((1 << 26) + 4096, "x");
  fs.writeFileSync(path.join(dir, "assets/agent/agent-bundle.js"), bundle);
  assert.deepEqual(apkRuntimeIdentity(zip("big.apk", "assets/agent/alpha-source.json", "assets/agent/agent-bundle.js")),
    { runtime: "PACKAGED", base: "b".repeat(40), patches: [], agentBundleSha256: sha(bundle) });
  assert.throws(() => apkRuntimeIdentity(zip("no-bundle.apk", "assets/agent/alpha-source.json")), /agent-bundle\.js cannot be read/);
  assert.deepEqual(apkRuntimeIdentity(zip("no-runtime.apk", "assets/agent/agent-bundle.js")), { runtime: "NOT_PACKAGED" });
});

test("an admitted APK whose own contents contradict its manifest row is refused before any device is touched", t => {
  const release = admitUnitApk(build(t, DISTRIBUTABLE), { variant: "launcher", build: "release" }, { descriptor: descriptor() });
  const good = { testMocks: false, debuggable: false, runtime: "PACKAGED", signerSha256: SIGNER, updateChannel: "legacy" };
  const check = (apk, facts) => apkContradictions(apk, { descriptor: descriptor(), facts });
  assert.deepEqual(check(release, good), []);
  // A hand-edited row can claim anything; the file is what gets installed.
  assert.match(check(release, { ...good, signerSha256: "b".repeat(64) }).join(), /signed by b{64}, not the certificate in android\/release-signer\.json/);
  assert.match(check(release, { ...good, signerSha256: null }).join(), /no verified signer/);
  assert.match(check(release, { ...good, runtime: "NOT_PACKAGED" }).join(), /does not package the resident runtime/);
  assert.match(check(release, { ...good, debuggable: true }).join(), /not a release build/);
  assert.match(check(release, { ...good, testMocks: true }).join(), /not a verified flag-off build/);
  // A fact that could not be read is never taken as good.
  assert.equal(check(release, { testMocks: null, debuggable: null, runtime: null, signerSha256: null, updateChannel: null }).length, 5);
  assert.throws(() => requireConsistentApk(release, { descriptor: descriptor(), facts: { ...good, runtime: "NOT_PACKAGED" } }), /contradicts the manifest row that admitted it:\n  - it does not package the resident runtime/);
  // The synthetic file in this test is not an APK: reading it yields no fact, so it is refused.
  assert.deepEqual(apkFacts(release.file), { testMocks: null, debuggable: null, signerSha256: null, runtime: "NOT_PACKAGED", updateChannel: null });
  assert.throws(() => requireConsistentApk(release, { descriptor: descriptor() }), /contradicts the manifest row/);
  // The rehearsal build must really be the debug build, flag-off; a release relabelled "debug" is not a rehearsal.
  const rehearsal = admitUnitApk(build(t, { mode: "debug", signed: true }), { variant: "launcher", build: "debug" }, { descriptor: descriptor() });
  assert.deepEqual(check(rehearsal, { testMocks: false, debuggable: true, runtime: "NOT_PACKAGED", signerSha256: "c".repeat(64) }), []);
  assert.match(check(rehearsal, { ...good, debuggable: false }).join(), /not the debug rehearsal APK/);
  assert.match(check(rehearsal, { testMocks: true, debuggable: true }).join(), /not a verified flag-off build/);
  // A row that contradicts the manifest's own flag-off claim is refused for the rehearsal too.
  assert.throws(() => admitUnitApk(build(t, { mode: "debug", signed: true, testMocks: true }), { variant: "launcher", build: "debug" }, { descriptor: descriptor() }), /recorded as a test-mocks build/);
  assert.throws(() => admitUnitApk(build(t, { mode: "debug", signed: true, testMocks: undefined }), { variant: "launcher", build: "debug" }, { descriptor: descriptor() }), /recorded as a test-mocks build/);
  // Unreadable or structurally wrong manifests fail closed: never an empty blocker list.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-pilot-bad-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bad = (name, text) => { const file = path.join(dir, name); fs.writeFileSync(file, text); return file; };
  for (const [name, text] of [["truncated.json", '{"testMocks":false,"results":['], ["no-results.json", '{"testMocks":false}'], ["object-results.json", '{"testMocks":false,"results":{"0":{}}}'],
    ["null.json", "null"], ["empty.json", ""], ["no-flag.json", '{"results":[]}']])
    assert.throws(() => admitUnitApk(bad(name, text), { variant: "launcher", build: "release" }, { descriptor: descriptor() }), undefined, name);
  for (const row of [null, undefined, "release", 1, [], {}]) {
    let outcome; try { outcome = releaseBlockers(row); } catch (error) { outcome = [error.message]; }
    assert.ok(outcome.length > 0, `admitted ${JSON.stringify(row)}`);
  }
  // Recorded facts of the wrong shape are blockers or errors, never a pass.
  const shaped = { ...DISTRIBUTABLE, testMocks: false, bundleAudit: "passed", releaseAdmission: { failures: [], blockers: [], signerMatches: true } };
  for (const change of [{ licenceBlockers: "" }, { licenceBlockers: null }, { licenceBlockers: {} }, { voiceHost: true }, { voiceHost: [] }, { voiceHost: {} }, { voiceHost: { packaged: true, differences: null } }, { releaseAdmission: true }, { releaseAdmission: {} },
    { releaseAdmission: { failures: [], blockers: [] } }, { runtimeNotices: "true" }, { signed: "true" }, { distributable: "true" }, { testMocks: undefined }, { runtime: "packaged" }]) {
    let outcome; try { outcome = releaseBlockers({ ...shaped, ...change }); } catch (error) { outcome = [error.message]; }
    assert.ok(outcome.length > 0, `admitted ${JSON.stringify(change)}`);
  }
});

test("release blockers are named for staging", () => {
  const row = { ...DISTRIBUTABLE, testMocks: false, bundleAudit: "passed", releaseAdmission: { failures: [], blockers: [], signerMatches: true } };
  assert.deepEqual(releaseBlockers(row), []);
  assert.deepEqual(releaseBlockers({ ...row, releaseAdmission: undefined }), ["release signing admission was not recorded"]);
  assert.deepEqual(releaseBlockers({ ...row, releaseAdmission: { failures: [], blockers: [], signerMatches: false } }), ["release signer does not match android/release-signer.json"]);
  assert.deepEqual(releaseBlockers(row, { manifestTestMocks: true }), ["test-mocks build"]);
  assert.deepEqual(releaseBlockers({ ...row, signed: false, releaseAdmission: { failures: [], blockers: ["unsigned release"], signerMatches: false } }), ["unsigned release"]);
  // The font check is flag-only by default; it is a named blocker only when the policy constant says so.
  const flagged = { ...row, licenceBlockers: ["unresolved-font-licence: Denton typeface has no recorded embedding licence"] };
  assert.deepEqual(releaseBlockers(flagged), []);
  assert.deepEqual(releaseBlockers({ ...flagged, licenceFlags: [{ name: "ffmpeg-static", version: "5.3.0", license: "GPL-3.0-or-later", flags: ["copyleft-strong"] }] }), [], "open-source licence flags are never blockers");
});

test("package facts, update admission and data-domain readback", () => {
  const facts = packageFacts("Packages:\n  Package [ai.alphacompute.alphaphone] (1a2b):\n    userId=10123\n    versionCode=7 minSdk=26 targetSdk=36\n    versionName=0.7.0\n    firstInstallTime=2026-10-08 10:00:00\n    lastUpdateTime=2026-10-08 11:00:00\n");
  assert.deepEqual(facts, { versionCode: 7, versionName: "0.7.0", firstInstallTime: "2026-10-08 10:00:00", lastUpdateTime: "2026-10-08 11:00:00", userId: "10123" });
  assert.deepEqual(updateAdmission({ installedVersionCode: 7, installedSigner: SIGNER, newVersionCode: 8, newSigner: SIGNER }), []);
  assert.match(updateAdmission({ installedVersionCode: 7, installedSigner: SIGNER, newVersionCode: 7, newSigner: SIGNER }).join(), /greater/);
  assert.match(updateAdmission({ installedVersionCode: 7, installedSigner: SIGNER, newVersionCode: 8, newSigner: "c".repeat(64) }).join(), /differs/);
  const before = parseDomainInventory(`${"1".repeat(64)}  ./files/notes.json\n${"2".repeat(64)}  ./no_backup/credential slot.bin\n${"3".repeat(64)}  ./shared_prefs/a.xml\nnoise\n`);
  assert.deepEqual(Object.keys(before).sort(), ["files", "no_backup", "shared_prefs"]);
  assert.ok("no_backup/credential slot.bin" in before.no_backup, "paths with spaces are kept");
  assert.deepEqual(compareDomains(before, before), []);
  const after = structuredClone(before);
  delete after.files["files/notes.json"];
  after.shared_prefs["shared_prefs/a.xml"] = "4".repeat(64);
  after.databases = { "databases/new.db": "5".repeat(64) };
  assert.deepEqual(compareDomains(before, after), ["databases/new.db appeared", "files/notes.json was lost", "shared_prefs/a.xml changed"]);
});

test("data readback never mistakes a failed or refused walk for an unchanged inventory", () => {
  // One single-quoted device-shell word: no single quotes inside, patterns double-quoted.
  assert.ok(!DOMAIN_SCRIPT.includes("'"));
  assert.match(DOMAIN_SCRIPT, /! -path "\.\/cache\/\*"/);
  assert.match(DOMAIN_SCRIPT, /echo "READBACK_EXIT=\$\?"$/);
  const ok = readbackInventory(`${"1".repeat(64)}  ./files/a.json\nREADBACK_EXIT=0\n`);
  assert.deepEqual(Object.keys(ok), ["files"]);
  assert.throws(() => readbackInventory("find: ./cache/b: unknown primary or operator\nREADBACK_EXIT=1\n"), /exit 1/);
  assert.throws(() => readbackInventory(""), /exit missing/);
  assert.equal(readbackInventory("\nrun-as: package not debuggable: ai.alphacompute.alphaphone"), null);
});

test("an update keeps the unit's provisioned variant and build type", () => {
  const unit = { apk: { variant: "launcher", build: "release" } };
  assert.equal(unitApkMismatch(unit, { variant: "launcher", build: "release" }), null);
  assert.match(unitApkMismatch(unit, { variant: "standalone", build: "release" }), /provisioned with the launcher release/);
  assert.match(unitApkMismatch(unit, { variant: "launcher", build: "debug" }), /same --variant and --build/);
  assert.match(unitApkMismatch({}, { variant: "launcher", build: "release" }), /unknown/);
});
