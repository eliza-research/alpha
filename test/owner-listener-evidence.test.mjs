// scripts/owner/listener-evidence.mjs captures G2-G6 listener evidence (issue #664). These cases run
// it against synthetic dumpsys/logcat text only: they check the read-only command allowlist, the
// privacy filters, the evidence-class separation and that the candidate record stays acceptable to
// scripts/listener-qualification.mjs. They prove nothing about an image or a device.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CAPTURE_GATES, MANUAL_ITEMS, assertReadOnly, buildEvidence, commandPlan, fixtureRunner, listenerNotifications, logcatFacts, userFacts,
} from "../scripts/owner/listener-evidence.mjs";
import { LISTENER_RECORD, listenerRecordProblems } from "../scripts/listener-qualification.mjs";

const root = path.resolve(import.meta.dirname, "..");
const fixtures = path.join(root, "test/fixtures/owner-listener-evidence");
const load = name => JSON.parse(fs.readFileSync(path.join(fixtures, name), "utf8"));
const appId = "ai.elizaresearch.alphaphone", pkg = `${appId}.sense`;
const record = JSON.parse(fs.readFileSync(path.join(root, LISTENER_RECORD), "utf8"));
const okVerifier = () => ({ packageName: pkg, privileged: true, persistent: true, captureHotwordGranted: true });
const script = path.join(root, "scripts/owner/listener-evidence.mjs");

test("every planned command is one of the read-only shapes and mutating commands are refused", () => {
  const plan = commandPlan({ appId, user: "0", gates: CAPTURE_GATES });
  assert.ok(Object.keys(plan).length > 30);
  for (const argv of Object.values(plan)) assert.doesNotThrow(() => assertReadOnly(argv));
  for (const argv of [
    ["shell", "input", "keyevent", "26"], ["shell", "am", "start", "-a", "android.intent.action.ASSIST"], ["shell", "settings", "put", "global", "x", "1"],
    ["shell", "dumpsys", "batterystats", "--reset"], ["logcat", "-c"], ["shell", "pkill", "com.android.systemui"], ["shell", "cmd", "role", "add-role-holder", "x", "y"],
    ["shell", "pm", "grant", pkg, "android.permission.RECORD_AUDIO"], ["shell", "device_config", "put", "privacy", "camera_mic_icons_enabled", "false"], ["reboot"],
  ]) assert.throws(() => assertReadOnly(argv), /non-read-only/, argv.join(" "));
});

test("the plan covers every command the upstream G2 verifier issues", () => {
  const plan = commandPlan({ appId, user: "0", gates: ["G2"] });
  const run = fixtureRunner(plan, load("pixel10a.json").captures);
  for (const argv of [["shell", "pm", "list", "packages", "-s", "--user", "0", pkg], ["shell", "dumpsys", "package", pkg], ["shell", "dumpsys", "package", appId],
    ["shell", "getprop", "ro.hotword.detection_service_required"], ["shell", "device_config", "get", "privacy", "camera_mic_icons_enabled"],
    ["shell", "cmd", "role", "get-role-holders", "--user", "0", "android.app.role.SYSTEM_TEXT_INTELLIGENCE"], ["shell", "dumpsys", "activity", "services", pkg]])
    assert.equal(typeof run(...argv), "string");
  assert.throws(() => run("shell", "dumpsys", "meminfo"), /No captured output/);
});

test("a Pixel 10a capture with every item attested earns G2-G6 without qualifying the listener", () => {
  const { captures, samples } = load("pixel10a.json");
  const evidence = buildEvidence({ captures, samples, appId, gates: CAPTURE_GATES, evidenceClass: "device", attest: load("attest-all-pass.json"), verifyListener: okVerifier, record, evidenceFile: "docs/evidence/listener/x.json" });
  assert.equal(evidence.classProblem, null);
  assert.equal(evidence.device.physicalPixel10a, true);
  for (const gate of CAPTURE_GATES) {
    assert.deepEqual(evidence.gates[gate].checks.filter(entry => !entry.ok), [], gate);
    assert.equal(evidence.gates[gate].status, "passed", gate);
    assert.equal(evidence.gates[gate].manual.length, MANUAL_ITEMS[gate].length);
  }
  assert.equal(evidence.facts.uid, "10234");
  assert.equal(evidence.facts.audio.hotwordSource, true);
  assert.equal(evidence.gates.G4.facts.activity.launchedFromSystemUi, true);
  assert.equal(evidence.gates.G6.facts.spanHours, 24.5);
  const candidate = evidence.candidateRecord;
  assert.deepEqual(candidate.problems, []);
  assert.deepEqual(listenerRecordProblems(candidate.record), []);
  assert.equal(candidate.record.qualified, false);
  assert.equal(candidate.record.distributable, false);
  assert.equal(candidate.record.gates.G1, record.gates.G1, "G1 is the image build and is never captured here");
  assert.equal(candidate.record.evidence.deviceAcceptance.recorded, true);
  assert.equal(candidate.record.evidence.aospImage.class, "aosp-image-boot");
});

test("without a named reviewer or with an unattested item no gate is earned", () => {
  const { captures, samples } = load("pixel10a.json");
  const attest = load("attest-all-pass.json");
  const unnamed = buildEvidence({ captures, samples, appId, gates: CAPTURE_GATES, evidenceClass: "device", attest: { ...attest, reviewer: " " }, verifyListener: okVerifier, record });
  assert.ok(CAPTURE_GATES.every(gate => unnamed.gates[gate].status === "open"));
  const items = { ...attest.items }; delete items["G3.chipAod"];
  const partial = buildEvidence({ captures, samples, appId, gates: CAPTURE_GATES, evidenceClass: "device", attest: { ...attest, items }, verifyListener: okVerifier, record });
  assert.equal(partial.gates.G3.status, "open");
  assert.equal(partial.gates.G4.status, "passed");
  assert.equal(partial.candidateRecord.record.evidence.deviceAcceptance.recorded, false, "device acceptance needs all of G3-G6");
});

test("a Cuttlefish image can earn only G2 as image evidence and is refused as device evidence", () => {
  const { captures } = load("cuttlefish.json");
  const attest = load("attest-all-pass.json");
  const asDevice = buildEvidence({ captures, appId, gates: CAPTURE_GATES, evidenceClass: "device", attest, verifyListener: okVerifier, record });
  assert.match(asDevice.classProblem, /physical Pixel 10a/);
  assert.ok(CAPTURE_GATES.every(gate => asDevice.gates[gate].status === "open"));
  const asImage = buildEvidence({ captures, appId, gates: CAPTURE_GATES, evidenceClass: "image", attest, verifyListener: okVerifier, record });
  assert.equal(asImage.gates.G2.status, "passed");
  for (const gate of ["G3", "G4", "G5", "G6"]) assert.equal(asImage.gates[gate].classAllowed, false, gate);
  assert.equal(asImage.candidateRecord.record.evidence.aospImage.recorded, true);
  assert.equal(asImage.candidateRecord.record.evidence.deviceAcceptance.recorded, false);
  assert.deepEqual(asImage.candidateRecord.problems, []);
});

test("a failing G2 verifier, a plugged-in or short power run and a silenced capture keep their gates open", () => {
  const { captures, samples } = load("pixel10a.json");
  const attest = load("attest-all-pass.json");
  const failing = () => { throw Error("CAPTURE_AUDIO_HOTWORD is not granted to the listener"); };
  const plugged = samples.map((sample, i) => i === 1 ? { ...sample, battery: { ...sample.battery, usbPowered: true } } : sample);
  const silenced = { ...captures, "dumpsys.audio": captures["dumpsys.audio"].replace(`pack:${pkg} -- silenced:false`, `pack:${pkg} -- silenced:true`) };
  const evidence = buildEvidence({ captures: silenced, samples: plugged.slice(0, 3), appId, gates: CAPTURE_GATES, evidenceClass: "device", attest, verifyListener: failing, record });
  assert.equal(evidence.gates.G2.status, "open");
  assert.match(evidence.gates.G2.checks[0].detail, /CAPTURE_AUDIO_HOTWORD/);
  assert.equal(evidence.gates.G3.checks.find(entry => entry.id === "G3.listenerRecordingObserved").ok, false);
  const g6 = Object.fromEntries(evidence.gates.G6.checks.map(entry => [entry.id, entry.ok]));
  assert.equal(g6["G6.unpluggedThroughout"], false);
  assert.equal(g6["G6.twentyFourHourSpan"], false);
  assert.equal(evidence.gates.G6.status, "open");
});

test("captures keep only the listener's lines: no other app's notification text, user names or unrelated logcat", () => {
  const { captures, samples } = load("pixel10a.json");
  const notes = listenerNotifications(captures["dumpsys.notification"], pkg);
  assert.ok(notes.some(line => line.includes("listening-indicator")));
  assert.ok(!notes.join("\n").includes("private message body") && !notes.join("\n").includes("Alice"));
  assert.deepEqual(userFacts(captures["pm.users"]), [{ id: "0", flags: "c13", running: true }, { id: "10", flags: "404", running: false }]);
  const log = logcatFacts(captures.logcat, { pkg, appId, uid: "10234" });
  assert.equal(log.lines.length, 2);
  assert.ok(!log.lines.join("\n").includes("alice@example.com"));
  const evidence = buildEvidence({ captures, samples, appId, gates: CAPTURE_GATES, evidenceClass: "device", verifyListener: okVerifier, record, serial: "SERIAL123" });
  const text = JSON.stringify(evidence);
  for (const secret of ["private message body", "Alice Example", "alice@example.com", "Shaw Owner", "Guest Person", "SERIAL123", "com.example.other"]) assert.ok(!text.includes(secret), secret);
});

test("the CLI dry-run contacts no device and the CLI refuses unsafe outputs", () => {
  const dry = spawnSync(process.execPath, [script, "--dry-run", "--gates", "G3,G6", "--samples", "49"], { encoding: "utf8" });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /nothing is sent in --dry-run/);
  assert.match(dry.stdout, /adb -s SERIAL shell dumpsys thermalservice/);
  const refuse = (args, pattern) => {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, pattern);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "listener-evidence-"));
  refuse(["--class", "device", "--out", path.join(dir, "a.json")], /Explicit --serial required/);
  refuse(["--serial", "S", "--class", "device", "--out", path.join(root, LISTENER_RECORD)], /exists|Never write the committed listener record/);
  refuse(["--serial", "S", "--class", "phone", "--out", path.join(dir, "b.json")], /--class image\|device/);
  refuse(["--serial", "S", "--class", "device", "--gates", "G1", "--out", path.join(dir, "c.json")], /G1 is the image build/);
  refuse(["--serial", "S", "--class", "device", "--gates", "G3", "--samples", "4", "--out", path.join(dir, "d.json")], /--samples is for the G6/);
  refuse(["--serial", "S; reboot", "--class", "device", "--out", path.join(dir, "e.json")], /Explicit --serial required/);
});

test("the CLI writes a new evidence file from fixtures and never overwrites one", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "listener-evidence-"));
  const out = path.join(dir, "evidence.json");
  const args = [script, "--fixtures", path.join(fixtures, "pixel10a.json"), "--class", "device", "--gates", "G3,G5", "--label", "fixture", "--attest", path.join(fixtures, "attest-all-pass.json"), "--out", out];
  const first = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  const written = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(written.schema, "alpha-listener-evidence-v1");
  assert.equal(written.gates.G3.status, "passed");
  assert.deepEqual(written.candidateRecord.problems, []);
  assert.equal(written.candidateRecord.record.qualified, false);
  const second = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(second.status, 2);
  assert.match(second.stderr, /never overwritten/);
});

test("the G2 capture reports whether the booted image enforces the privapp allowlist (a G1 observation)", () => {
  const { captures } = load("pixel10a.json");
  const enforced = buildEvidence({ captures, appId, gates: ["G2"], evidenceClass: "image", verifyListener: okVerifier, record });
  assert.deepEqual(enforced.gates.G2.g1Observation, { privappPermissions: "enforce", enforced: true });
  const unset = buildEvidence({ captures: { ...captures, "prop.privappPermissions": "\n" }, appId, gates: ["G2"], evidenceClass: "image", verifyListener: okVerifier, record });
  assert.deepEqual(unset.gates.G2.g1Observation, { privappPermissions: null, enforced: false });
});

test("the pinned upstream G2 verifier accepts the fixture through the capture plan", { skip: !fs.existsSync(path.join(root, "vendor/eliza/packages/os/scripts/android/sense-listener.mjs")) && "needs vendor/eliza at the pin" }, async () => {
  const { verifyAospListener } = await import("../scripts/aosp-listener.mjs");
  const run = fixtureRunner(commandPlan({ appId, user: "0", gates: ["G2"] }), load("pixel10a.json").captures);
  const facts = verifyAospListener(run, "0", appId);
  assert.equal(facts.captureHotwordGranted, true);
  assert.equal(facts.listeningServiceRunning, true);
  const unprivileged = { ...load("pixel10a.json").captures };
  unprivileged["dumpsys.listenerPackage"] = unprivileged["dumpsys.listenerPackage"].replace(" PRIVILEGED", "");
  assert.throws(() => verifyAospListener(fixtureRunner(commandPlan({ appId, user: "0", gates: ["G2"] }), unprivileged), "0", appId), /not a privileged app/);
});
