// docs/human-actions.md is the single ordered checklist of human-only MVP steps, and
// scripts/human-actions.mjs reports the ones this repository records. These cases keep the page
// well-formed (sequential steps, each with its seam and Verify line, every path and link real) and
// check the recorded states against fixture records. They establish nothing about the steps themselves.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CHECKLIST, CHECKS, checklistSteps, formatStates, humanActionStates } from "../scripts/human-actions.mjs";

const root = path.resolve(import.meta.dirname, "..");
const text = fs.readFileSync(path.join(root, CHECKLIST), "utf8");
const steps = checklistSteps(text);
/** GitHub's heading anchor: lower case, punctuation other than hyphens and spaces dropped, spaces to hyphens. */
const anchor = heading => heading.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-");

test("the checklist numbers its steps without gaps and gives each one who, what, seam, verification and what it unblocks", () => {
  assert.equal(steps.length, 38);
  steps.forEach((step, index) => assert.equal(step.id, `H-${String(index + 1).padStart(2, "0")}`));
  for (const section of text.split(/^### /m).slice(1)) {
    const id = section.slice(0, 4);
    for (const field of ["Who", "Do", "Seam", "Verify", "Unblocks"]) assert.match(section, new RegExp(`^- ${field}: `, "m"), `${id} lacks "${field}"`);
  }
  for (const step of steps) {
    assert.ok(step.verify && step.verify.length > 10, `${step.id} needs a Verify line the status command can print`);
    assert.doesNotMatch(step.verify, /\]\(/, `${step.id}: links print as their text`);
  }
});

test("the order-at-a-glance table lists every step in order and links its section", () => {
  const rows = [...text.matchAll(/^\| \[(H-\d\d)\]\(#([^)]+)\) \| ([^|]+) \|/gm)];
  assert.deepEqual(rows.map(row => row[1]), steps.map(step => step.id));
  for (const [, id, link] of rows) {
    const step = steps.find(row => row.id === id);
    assert.equal(link, anchor(`${step.id} ${step.title}`), `${id} links #${link}`);
  }
});

test("every repository path and document link on the page exists", () => {
  const links = [...text.matchAll(/\]\(([^)\s#]+)(?:#[^)\s]*)?\)/g)].map(match => match[1]).filter(target => !/^[a-z]+:/i.test(target));
  assert.ok(links.length > 10);
  assert.deepEqual(links.filter(target => !fs.existsSync(path.join(root, "docs", target))), []);
  const spans = [...text.matchAll(/`((?:docs|scripts|android|apps|config|licenses|test|vendor\/eliza)\/[^`\s]*)`/g)].map(match => match[1]).filter(reference => !reference.includes("<"));
  assert.ok(spans.length > 20);
  assert.deepEqual(spans.filter(reference => !fs.existsSync(path.join(root, reference.replace(/\/$/, "")))), []);
  // Commands quoted in code spans name scripts that exist.
  const commands = [...text.matchAll(/`node (scripts\/[^\s`]+)/g)].map(match => match[1]);
  assert.ok(commands.length > 8);
  assert.deepEqual(commands.filter(script => !fs.existsSync(path.join(root, script))), []);
  const npm = [...text.matchAll(/npm run ([a-z][a-z0-9:_-]*)/g)].map(match => match[1]);
  const scripts = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts;
  assert.deepEqual(npm.filter(name => !Object.hasOwn(scripts, name)), []);
  assert.equal(scripts["human:status"], "node scripts/human-actions.mjs");
});

test("every upstream elizaOS path the page names exists at the pinned commit", t => {
  // packages/cloud is not checked out in vendor/eliza, so these are read from the pinned commit's objects.
  const upstream = [...new Set([...text.matchAll(/`((?:packages|plugins)\/[^`\s]+)`/g)].map(match => match[1]))];
  assert.ok(upstream.length >= 4);
  const pin = JSON.parse(fs.readFileSync(path.join(root, "upstream.lock.json"), "utf8")).commit;
  const has = object => spawnSync("git", ["-C", path.join(root, "vendor/eliza"), "cat-file", "-e", object], { stdio: "ignore" }).status === 0;
  if (!has(`${pin}^{commit}`)) { t.skip("the pinned elizaOS commit is not available in vendor/eliza"); return; }
  assert.deepEqual(upstream.filter(file => !has(`${pin}:${file}`)), []);
});

test("every repository check belongs to a step on the page", () => {
  for (const id of Object.keys(CHECKS)) assert.ok(steps.some(step => step.id === id), `${id} has a check but no step`);
});

/**
 * A copy of the records the checks read, so states can be changed without touching the checkout.
 * The person-recorded facts start as they were before any step was taken (unset digests, no release,
 * nothing qualified, gates and drills not passed), whatever the checkout records since.
 */
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-human-actions-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const file of [CHECKLIST, "android/release-signer.json", "android/aosp/pixel10a-product.json", "android/aosp/pixel10a-ota-channel.json", "android/aosp/pixel10a-qualification-gates.json",
    "android/voice-host/qualified-voice-host.json", "android/sense/qualified-listener.json", "android/embedding-host/build-toolchain.json", "docs/app-qa-checklist.json"]) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(dir, file));
  }
  const edit = (file, change) => { const value = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")); change(value); fs.writeFileSync(path.join(dir, file), JSON.stringify(value)); };
  edit("android/release-signer.json", value => { value.signerSha256 = "unset"; value.lastRelease = { versionCode: null, versionName: null, recordedAt: null }; });
  edit("android/aosp/pixel10a-product.json", value => {
    value.signer.platformCertificateSha256 = "UNSET";
    delete value.signer.apexPayloadAvbPublicKeySha256;
    for (const name of Object.keys(value.signer.releaseCertificates)) value.signer.releaseCertificates[name] = "UNSET";
    value.avb.publicKeySha256 = "UNSET";
  });
  edit("android/aosp/pixel10a-ota-channel.json", value => {
    value.otaCertificateSha256 = "UNSET"; value.avbPublicKeySha256 = "UNSET";
    value.recovery.knownGoodRelease = { buildFingerprint: "UNSET", otaSha256: "UNSET", recordFile: "UNSET" };
    for (const name of Object.keys(value.drills)) value.drills[name] = "not run";
  });
  edit("android/aosp/pixel10a-qualification-gates.json", value => { for (const name of ["cuttlefishBoot", "physicalDevice", "signedUpdateRecovery", "userAcceptance"]) value.gates[name].status = "not run"; });
  edit("android/voice-host/qualified-voice-host.json", value => { value.qualified = false; });
  edit("android/sense/qualified-listener.json", value => { value.qualified = false; });
  edit("android/embedding-host/build-toolchain.json", value => { value.remapBuildPath = true; });
  edit("docs/app-qa-checklist.json", value => { for (const item of value.items) item.userApproval = "Pending"; });
  return { dir, edit };
}

test("recorded states follow the records: unset digests, missing releases, gates and drills stay open until recorded", t => {
  const { dir, edit } = fixture(t);
  const state = (env = {}) => Object.fromEntries(humanActionStates(dir, env).map(row => [row.id, row]));
  const before = state();
  assert.equal(before["H-09"].state, "open");
  assert.match(before["H-09"].detail, /13 of 13 release digests unset/);
  assert.equal(before["H-10"].state, "open");
  assert.equal(before["H-01"].state, "external");
  assert.match(before["H-01"].detail, /^verify: /);
  for (const id of ["H-18", "H-20", "H-22", "H-23", "H-24", "H-25", "H-34"]) assert.equal(before[id].state, "open", id);

  // Signing variables are reported by name; a value never appears.
  const partial = state({ ELIZAOS_KEYSTORE_PATH: "/secret/path/release.jks", ELIZAOS_KEYSTORE_PASSWORD: "not-a-real-password" })["H-10"].detail;
  assert.match(partial, /only ELIZAOS_KEYSTORE_PATH, ELIZAOS_KEYSTORE_PASSWORD set/);
  assert.doesNotMatch(partial, /not-a-real-password|\/secret\/path/);

  const digest = "a".repeat(64);
  edit("android/release-signer.json", value => { value.signerSha256 = digest; value.lastRelease = { versionCode: 12, versionName: "1.0.0", recordedAt: "2026-11-01" }; });
  edit("android/aosp/pixel10a-product.json", value => {
    value.signer.platformCertificateSha256 = digest;
    for (const name of Object.keys(value.signer.releaseCertificates)) value.signer.releaseCertificates[name] = digest;
    value.avb.publicKeySha256 = digest;
  });
  edit("android/aosp/pixel10a-ota-channel.json", value => {
    value.otaCertificateSha256 = digest; value.avbPublicKeySha256 = digest;
    value.recovery.knownGoodRelease = { buildFingerprint: "Alpha/alpha_stallion_phone/stallion:17/X/1:user/release-keys", otaSha256: digest, recordFile: "release-record.json" };
    for (const name of Object.keys(value.drills)) value.drills[name] = "passed";
  });
  assert.equal(state()["H-09"].state, "open");
  assert.match(state()["H-09"].detail, /1 of 13 release digests unset .*apexPayloadAvbPublicKeySha256/);
  edit("android/aosp/pixel10a-product.json", value => { value.signer.apexPayloadAvbPublicKeySha256 = digest; });
  // A passed drill record alone does not pass H-25: the gate must say so too.
  assert.equal(state()["H-25"].state, "open");
  edit("android/aosp/pixel10a-qualification-gates.json", value => { for (const name of ["cuttlefishBoot", "physicalDevice", "signedUpdateRecovery", "userAcceptance"]) value.gates[name].status = "passed"; });
  edit("android/voice-host/qualified-voice-host.json", value => { value.qualified = true; });
  edit("android/sense/qualified-listener.json", value => { value.qualified = true; });
  const after = state();
  for (const id of ["H-09", "H-10", "H-18", "H-20", "H-22", "H-23", "H-24", "H-25", "H-34"]) assert.equal(after[id].state, "done", `${id}: ${after[id].detail}`);
  assert.equal(after["H-19"].state, "not needed");
  edit("android/embedding-host/build-toolchain.json", value => { value.remapBuildPath = false; });
  assert.equal(state()["H-19"].state, "open");
  fs.rmSync(path.join(dir, "android/sense/qualified-listener.json"));
  assert.match(state()["H-20"].detail, /record unreadable/);
});

test("a distributable build in this checkout shows H-10 done before any release is recorded as distributed", t => {
  const { dir, edit } = fixture(t);
  const SIGNER = "a".repeat(64);
  edit("android/release-signer.json", value => { value.signerSha256 = SIGNER; });
  const h10 = () => humanActionStates(dir, {}).find(row => row.id === "H-10");
  assert.match(h10().detail, /no artifacts\/apk-manifest\.json in this checkout/);
  // Everything verify-apks records for a distributable release (as in test/pilot-units.test.mjs).
  const release = variant => ({ variant, mode: "release", file: `artifacts/${variant}-release.apk`, versionCode: 12, versionName: "1.0.0", signed: true, signerSha256: SIGNER,
    distributable: true, testMocks: false, bundleAudit: "passed", runtime: "PACKAGED", runtimeNotices: true, voiceHost: { packaged: true, asr: true, differences: [], qualified: true }, licenceBlockers: [] });
  const write = rows => { fs.mkdirSync(path.join(dir, "artifacts"), { recursive: true }); fs.writeFileSync(path.join(dir, "artifacts/apk-manifest.json"), JSON.stringify({ testMocks: false, version: { code: 12, name: "1.0.0" }, results: rows })); };
  write([release("standalone"), { ...release("launcher"), signed: false }]);
  assert.equal(h10().state, "open");
  assert.match(h10().detail, /launcher: unsigned release/);
  write([release("standalone"), release("launcher")]);
  assert.equal(h10().state, "done");
  assert.match(h10().detail, /records distributable standalone and launcher releases 1\.0\.0 \(12\).*record lastRelease once they are distributed \(H-32\)/);
  // The same build against an unenrolled signer is not distributable.
  edit("android/release-signer.json", value => { value.signerSha256 = "unset"; });
  assert.equal(h10().state, "open");
});

test("the report names every step and states the committed records as they are", () => {
  const rows = humanActionStates(root, {});
  const report = formatStates(rows);
  for (const step of steps) assert.ok(report.includes(`${step.id} `), step.id);
  assert.match(report, /recorded outside this repository/);
  // Each recorded step follows its committed record, so the page stays right as people record their steps.
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  const state = id => rows.find(row => row.id === id).state;
  const signer = read("android/release-signer.json"), channel = read("android/aosp/pixel10a-ota-channel.json"), gates = read("android/aosp/pixel10a-qualification-gates.json").gates;
  const unset = value => value === "unset" || value === "UNSET";
  if (unset(signer.signerSha256)) for (const id of ["H-09", "H-10"]) assert.equal(state(id), "open", id);
  assert.equal(state("H-18"), read("android/voice-host/qualified-voice-host.json").qualified === true ? "done" : "open");
  assert.equal(state("H-20"), read("android/sense/qualified-listener.json").qualified === true ? "done" : "open");
  assert.equal(state("H-22"), Object.values(channel.recovery.knownGoodRelease).some(unset) ? "open" : "done");
  assert.equal(state("H-34"), gates.userAcceptance.status === "passed" ? "done" : "open");
  for (const row of rows) assert.ok(["done", "open", "external", "not needed"].includes(row.state), `${row.id}: ${row.state}`);
});

test("H-38 stays open until the owner approves every MVP row of the app QA checklist", t => {
  const { dir, edit } = fixture(t);
  const h38 = () => humanActionStates(dir, {}).find(row => row.id === "H-38");
  const mvp = JSON.parse(fs.readFileSync(path.join(dir, "docs/app-qa-checklist.json"), "utf8")).items.filter(item => item.scope === "MVP").length;
  assert.ok(mvp > 0);
  assert.equal(h38().state, "open");
  assert.match(h38().detail, new RegExp(`^0 of ${mvp} MVP rows approved by the owner`));
  // Out-of-scope rows (AOSP only, excluded, deferred) never hold the step open; one pending MVP row does.
  edit("docs/app-qa-checklist.json", value => { value.items.forEach((item, index) => { if (item.scope === "MVP") item.userApproval = index === 0 ? "Pending" : "Approved 2026-11-02"; }); });
  assert.equal(h38().state, "open");
  assert.match(h38().detail, new RegExp(`^${mvp - 1} of ${mvp} MVP rows approved`));
  // "Not approved" is not an approval.
  edit("docs/app-qa-checklist.json", value => { value.items.forEach(item => { if (item.scope === "MVP") item.userApproval = "Not approved"; }); });
  assert.equal(h38().state, "open");
  edit("docs/app-qa-checklist.json", value => { value.items.forEach(item => { if (item.scope === "MVP") item.userApproval = "Approved"; }); });
  assert.equal(h38().state, "done");
  fs.rmSync(path.join(dir, "docs/app-qa-checklist.json"));
  assert.match(h38().detail, /record unreadable/);
});
