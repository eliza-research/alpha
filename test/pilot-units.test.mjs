// Pilot provisioning/update policy on synthetic inputs; not emulator or device evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { admitUnitApk, apkContradictions, apkFacts, apkRuntimeIdentity, packageFacts, parseUnitArgs, requireConsistentApk } from "../scripts/provision-unit.ts";
import { releaseBlockers } from "../scripts/release-blockers.ts";
import { CAMPAIGNS, candidateManifest, parseQualifyArgs, readCampaigns, recordCandidate, releaseDistribution, verdict } from "../scripts/qualify-head.ts";
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
  const good = { testMocks: false, debuggable: false, runtime: "PACKAGED", signerSha256: SIGNER };
  const check = (apk, facts) => apkContradictions(apk, { descriptor: descriptor(), facts });
  assert.deepEqual(check(release, good), []);
  // A hand-edited row can claim anything; the file is what gets installed.
  assert.match(check(release, { ...good, signerSha256: "b".repeat(64) }).join(), /signed by b{64}, not the certificate in android\/release-signer\.json/);
  assert.match(check(release, { ...good, signerSha256: null }).join(), /no verified signer/);
  assert.match(check(release, { ...good, runtime: "NOT_PACKAGED" }).join(), /does not package the resident runtime/);
  assert.match(check(release, { ...good, debuggable: true }).join(), /not a release build/);
  assert.match(check(release, { ...good, testMocks: true }).join(), /not a verified flag-off build/);
  // A fact that could not be read is never taken as good.
  assert.equal(check(release, { testMocks: null, debuggable: null, runtime: null, signerSha256: null }).length, 4);
  assert.throws(() => requireConsistentApk(release, { descriptor: descriptor(), facts: { ...good, runtime: "NOT_PACKAGED" } }), /contradicts the manifest row that admitted it:\n  - it does not package the resident runtime/);
  // The synthetic file in this test is not an APK: reading it yields no fact, so it is refused.
  assert.deepEqual(apkFacts(release.file), { testMocks: null, debuggable: null, signerSha256: null, runtime: "NOT_PACKAGED" });
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

test("release blockers are named for staging and head qualification", () => {
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
  const blocked = { ...flagged, distributable: false };
  const apks = [{ mode: "debug" }, { mode: "release", distributable: true, distributionBlockers: [] }, { mode: "release", distributable: false, distributionBlockers: releaseBlockers(blocked, { fontLicenceBlocks: true }) }];
  assert.deepEqual(releaseDistribution(apks), { releasesDistributable: false, releaseBlockers: ["unresolved-font-licence: Denton typeface has no recorded embedding licence"] });
  assert.deepEqual(releaseDistribution([apks[1], apks[1]]), { releasesDistributable: true, releaseBlockers: [] });
  // A flag without recorded blockers, a contradicting flag, and a run with no release are all not distributable.
  assert.equal(releaseDistribution([{ mode: "release", distributable: true }]).releasesDistributable, false);
  assert.equal(releaseDistribution([{ mode: "release", distributable: true, distributionBlockers: ["unsigned release"] }]).releasesDistributable, false);
  assert.equal(releaseDistribution([{ mode: "debug" }]).releasesDistributable, false);
  assert.equal(releaseDistribution(undefined).releasesDistributable, false);
  // A test-mocks build can never qualify the head.
  const step = { status: "passed" };
  const browser = { status: "passed", expected: 3, unexpected: 0, flaky: 0, skipped: 0, failures: [] };
  const result = { clean: true, upstream: { matches: true }, verify: step, bundleAudit: step, androidBuild: { ...step, testMocks: false },
    storageSpecs: { chromium: browser, firefox: browser, webkit: browser }, browserSuite: step, productionSurface: step };
  assert.equal(verdict(result), true);
  assert.equal(verdict({ ...result, androidBuild: { ...step, testMocks: true } }), false);
  assert.equal(verdict({ ...result, androidBuild: step }), false);
});

test("package facts, update admission and data-domain readback", () => {
  const facts = packageFacts("Packages:\n  Package [ai.elizaresearch.alphaphone] (1a2b):\n    userId=10123\n    versionCode=7 minSdk=26 targetSdk=36\n    versionName=0.7.0\n    firstInstallTime=2026-10-08 10:00:00\n    lastUpdateTime=2026-10-08 11:00:00\n");
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
  assert.equal(readbackInventory("\nrun-as: package not debuggable: ai.elizaresearch.alphaphone"), null);
});

test("an update keeps the unit's provisioned variant and build type", () => {
  const unit = { apk: { variant: "launcher", build: "release" } };
  assert.equal(unitApkMismatch(unit, { variant: "launcher", build: "release" }), null);
  assert.match(unitApkMismatch(unit, { variant: "standalone", build: "release" }), /provisioned with the launcher release/);
  assert.match(unitApkMismatch(unit, { variant: "launcher", build: "debug" }), /same --variant and --build/);
  assert.match(unitApkMismatch({}, { variant: "launcher", build: "release" }), /unknown/);
});

test("head qualification records the full Chromium suite and the production surface, and verdict() needs both", () => {
  const step = { status: "passed" };
  const browser = { status: "passed", expected: 3, unexpected: 0, flaky: 0, skipped: 0, failures: [] };
  const result = { clean: true, upstream: { matches: true }, verify: step, bundleAudit: step, androidBuild: { ...step, testMocks: false },
    storageSpecs: { chromium: browser, firefox: browser, webkit: browser }, browserSuite: step, productionSurface: step };
  assert.equal(verdict(result), true);
  for (const name of ["browserSuite", "productionSurface"]) {
    assert.equal(verdict({ ...result, [name]: undefined }), false, `${name} missing`);
    assert.equal(verdict({ ...result, [name]: { status: "failed", exitCode: 1 } }), false, `${name} failed`);
  }
  // Campaign evidence never enters the S/B verdict, whatever it says.
  assert.equal(verdict({ ...result, candidate: { complete: false, campaigns: [] }, candidateQualified: false }), true);
  const source = fs.readFileSync("scripts/qualify-head.ts", "utf8");
  assert.match(source, /step\("browser-chromium", "npm", \["run", "test:browser"\]/);
  assert.match(source, /step\("browser-production", "npm", \["run", "test:browser:production"\], flagOff\)/);
  assert.deepEqual(parseQualifyArgs(["--candidate"]).candidateOnly, true);
  assert.throws(() => parseQualifyArgs(["--candidate", "--fresh"]), /takes no other option/);
});

test("the candidate manifest admits only campaigns whose APK hashes are this qualify run's", () => {
  const apks = [{ variant: "launcher", mode: "debug", sha256: "1".repeat(64) }, { variant: "standalone", mode: "debug", sha256: "2".repeat(64) }];
  const campaign = (id, apkSha256, passed = true) => ({ id, present: true, passed, apkSha256, records: [`${id}.json`] });
  const all = CAMPAIGNS.map(row => campaign(row.id, ["1".repeat(64)]));
  const ok = candidateManifest(apks, all);
  assert.equal(ok.complete, true);
  assert.deepEqual(ok.campaigns.map(row => row.status), CAMPAIGNS.map(() => "passed"));
  assert.deepEqual(ok.candidateApks, ["1".repeat(64), "2".repeat(64)]);
  // A campaign run on another build is rejected, however well it went.
  const other = candidateManifest(apks, [campaign("emulator-suite:instrumentation", ["1".repeat(64), "9".repeat(64)]), ...all.slice(1)]);
  assert.equal(other.complete, false);
  assert.equal(other.campaigns[0].status, "mismatched");
  assert.match(other.campaigns[0].reason, new RegExp(`not this candidate: ${"9".repeat(64)}`));
  // A record that names no APK cannot be bound, a bound failure is a failure, and an absent campaign is missing.
  const rows = candidateManifest(apks, [campaign("a", []), campaign("b", ["2".repeat(64)], false), { id: "c", present: false }]).campaigns;
  assert.deepEqual(rows.map(row => row.status), ["mismatched", "failed", "missing"]);
  assert.equal(candidateManifest(undefined, all).complete, false, "no candidate APKs admits nothing");
});

test("campaign records are read from emulator-suite, resident proofs and resident CI results", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-candidate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (rel, value) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), JSON.stringify(value)); };
  const app = "1".repeat(64), test = "3".repeat(64);
  write("test-results/emulator-suite/instrumentation.json", { suite: "instrumentation", passed: true,
    steps: [{ name: "prepare-emulator" }, { name: "ci-default", results: "test-results/android-instrumentation/ci-default/results.json" }] });
  write("test-results/android-instrumentation/ci-default/results.json", { passed: true, apks: [{ variant: "launcher", role: "app", sha256: app }, { variant: "launcher", role: "test", sha256: test }] });
  write("test-results/emulator-suite/browser-reading.json", { suite: "browser-reading", passed: true, steps: [{ name: "ci-reading", results: "test-results/android-instrumentation/ci-reading/results.json" }] });
  write("test-results/android-instrumentation/ci-reading/results.json", { passed: true, apks: [{ variant: "launcher", role: "app", sha256: "8".repeat(64) }] });
  write("test-results/resident-instrumentation/redaction.json", { passed: true, apkSha256: app });
  write("test-results/resident-ci-archive/apk-manifest.json", { "launcher-debug.apk": app, "launcher-androidTest.apk": test, "private-peer-debug.apk": "4".repeat(64) });
  write("test-results/resident-ci-native/launcher-recovery.json", { passed: true, cleanupComplete: true });
  const campaigns = readCampaigns(root);
  const byId = Object.fromEntries(campaigns.map(row => [row.id, row]));
  assert.deepEqual(byId["emulator-suite:instrumentation"].apkSha256, [app], "test APKs are not the candidate");
  assert.deepEqual(byId["resident-android"].apkSha256, [app], "helper and test APKs are not the candidate");
  assert.equal(byId["emulator-suite:fused-speech"].present, false);
  const result = recordCandidate({ qualified: true, androidBuild: { apks: [{ sha256: app }] } }, root);
  assert.deepEqual(Object.fromEntries(result.candidate.campaigns.map(row => [row.id, row.status])), {
    "emulator-suite:instrumentation": "passed", "emulator-suite:browser-reading": "mismatched", "emulator-suite:fused-speech": "missing",
    "resident-instrumentation": "passed", "resident-android": "passed" });
  // A missing campaign leaves the candidate unqualified, even though the head itself qualified.
  assert.equal(result.qualified, true);
  assert.equal(result.candidateQualified, false);
  write("test-results/emulator-suite/fused-speech.json", { suite: "fused-speech", passed: true, steps: [{ name: "speech", results: "test-results/android-instrumentation/ci-default/results.json" }] });
  write("test-results/android-instrumentation/ci-reading/results.json", { passed: true, apks: [{ variant: "launcher", role: "app", sha256: app }] });
  assert.equal(recordCandidate({ qualified: true, androidBuild: { apks: [{ sha256: app }] } }, root).candidateQualified, true);
  // A test-mocks step in the suite is recorded but binds nothing; it does not make the campaign foreign.
  write("test-results/emulator-suite/browser-reading.json", { suite: "browser-reading", passed: true, steps: [
    { name: "ci-reading", results: "test-results/android-instrumentation/ci-reading/results.json" },
    { name: "ci-reading-test-mocks", results: "test-results/android-instrumentation/ci-reading-test-mocks/results.json" }] });
  write("test-results/android-instrumentation/ci-reading-test-mocks/results.json", { passed: true, apks: [{ variant: "launcher", role: "app", sha256: "7".repeat(64), testMocks: true }] });
  const reading = () => recordCandidate({ qualified: true, androidBuild: { apks: [{ sha256: app }] } }, root).candidate.campaigns.find(row => row.id === "emulator-suite:browser-reading");
  assert.equal(reading().status, "passed");
  assert.deepEqual(reading().apkSha256, [app]);
  // A suite step whose record is missing, or names no APK, leaves the campaign unbound.
  fs.rmSync(path.join(root, "test-results/android-instrumentation/ci-reading/results.json"));
  assert.equal(reading().status, "mismatched");
  write("test-results/android-instrumentation/ci-reading/results.json", { passed: true, apks: [{ variant: "launcher", role: "app", sha256: app }] });
  assert.equal(recordCandidate({ qualified: false, androidBuild: { apks: [{ sha256: app }] } }, root).candidateQualified, false, "campaigns never replace the S/B verdict");
  // A resident proof without the hash of the APK it ran on is not admitted.
  write("test-results/resident-instrumentation/unbound.json", { passed: true });
  assert.equal(recordCandidate({ qualified: true, androidBuild: { apks: [{ sha256: app }] } }, root).candidate.campaigns.find(row => row.id === "resident-instrumentation").status, "mismatched");
});


test("the provisioning record keeps only its secret-free fields", () => {
  const source = fs.readFileSync("scripts/provision-unit.ts", "utf8");
  const body = /const record = \{([\s\S]*?)\n  \};/.exec(source)[1];
  const keys = [...body.matchAll(/^\s{4}([a-zA-Z]+)[:,]/gm)].map(match => match[1]);
  assert.deepEqual(keys, ["schema", "alias", "createdAt", "sourceCommit", "evidence", "notEvidenceFor", "device", "apk", "installed", "runtimeIdentity", "homeRole"]);
  assert.match(source, /buildFingerprintSha256: sha256\(/);
});
