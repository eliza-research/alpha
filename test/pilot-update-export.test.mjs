// Release-build data integrity export as pilot-update reads it, on synthetic `content query`
// output. Not emulator or device evidence: an emulator run of the export is separate (class E).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ALPHA, STOCK, APK, BEFORE, DATA, NONCE, exported, hmac, fakeUnit, timing } from "./fixtures/pilot-update.mjs";
import { compareDomains, integrityQuery, INTEGRITY_AUTHORITY, parseIntegrityExport } from "../scripts/pilot-update.mjs";
import { beginPilotRotation, claimPilotInstall, inspectPilotRotation } from "../scripts/owner/pilot-rotation-journal.mjs";

test("the export query is the read-only provider URI with a nonce, quoted for the device shell", () => {
  assert.equal(INTEGRITY_AUTHORITY, "ai.elizaresearch.alphaphone.integrity");
  assert.deepEqual(integrityQuery(NONCE), ["shell", "content", "query", "--uri", `'content://ai.elizaresearch.alphaphone.integrity/domains?nonce=${NONCE}'`]);
  for (const nonce of ["", "abc", "z".repeat(64), `${NONCE}'; rm -rf /`]) assert.throws(() => integrityQuery(nonce), /nonce/);
});

test("export rows parse into per-domain inventories keyed by path digest; no names or contents appear", () => {
  const output = exported(DATA);
  const domains = parseIntegrityExport(output);
  assert.deepEqual(Object.keys(domains).sort(), [".", "databases", "files", "no_backup", "shared_prefs"]);
  assert.equal(domains.files[`files/${hmac("path:files/notes/document.json")}`], hmac(DATA["files/notes/document.json"]));
  assert.equal(Object.values(domains).reduce((total, files) => total + Object.keys(files).length, 0), 5);
  for (const secret of ["document.json", "slot.bin", "sealed", "notes"]) assert.ok(!output.includes(secret), secret);
  assert.deepEqual(compareDomains(domains, parseIntegrityExport(exported(DATA))), [], "the same data under the same nonce is identical");
});

test("a lost, changed or new file after the update is reported per domain", () => {
  const before = parseIntegrityExport(exported(DATA));
  const changed = { ...DATA, "shared_prefs/alpha.xml": "<map><x/></map>", "databases/new.db": "new" };
  delete changed["files/notes/document.json"];
  const problems = compareDomains(before, parseIntegrityExport(exported(changed)));
  assert.deepEqual(problems, [
    `databases/${hmac("path:databases/new.db")} appeared`,
    `files/${hmac("path:files/notes/document.json")} was lost`,
    `shared_prefs/${hmac("path:shared_prefs/alpha.xml")} changed`,
  ].sort());
  // A different nonce for the second read would make every file look replaced: the update uses one nonce.
  assert.equal(compareDomains(before, parseIntegrityExport(exported(DATA, "cd".repeat(32)))).length, 10);
});

test("a refused, failed, truncated or malformed export never reads as an unchanged inventory", () => {
  assert.equal(parseIntegrityExport("Error while accessing provider:ai.elizaresearch.alphaphone.integrity\njava.lang.IllegalArgumentException: Could not find provider"), null);
  assert.equal(parseIntegrityExport("[ERROR] Unknown authority ai.elizaresearch.alphaphone.integrity"), null, "an older build without the export");
  assert.throws(() => parseIntegrityExport("Error while accessing provider:x\njava.lang.SecurityException: Permission Denial: opening provider requires android.permission.DUMP"), /Integrity export failed/);
  assert.throws(() => parseIntegrityExport("java.lang.IllegalStateException: Integrity export failed: IOException"), /Integrity export failed/);
  const output = exported(DATA);
  assert.throws(() => parseIntegrityExport(output.split("\n").filter(line => !line.includes("#end")).join("\n")), /no end row/);
  assert.throws(() => parseIntegrityExport(output.split("\n").filter((_, index) => index !== 1).join("\n")), /lists 4 files but its end row says 5/);
  assert.throws(() => parseIntegrityExport(`Row: 0 domain=files, key=12, digest=${"0".repeat(64)}\nRow: 1 domain=#end, key=1, digest=${"0".repeat(64)}`), /Malformed integrity export row/);
  assert.throws(() => parseIntegrityExport(""), /no end row/);
});

test("the provider is a registered, read-only, DUMP-protected release component, not a debug or mock surface", () => {
  const manifest = fs.readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
  const provider = /<provider android:name="\.release\.DataIntegrityProvider"[^>]*>/.exec(manifest)?.[0];
  assert.ok(provider, "registered in the main manifest, so release builds carry it");
  assert.match(provider, /android:authorities="\$\{applicationId\}\.integrity"/);
  assert.match(provider, /android:permission="android\.permission\.DUMP"/);
  assert.match(provider, /android:process=":integrity"/);
  assert.match(provider, /android:grantUriPermissions="false"/);
  const source = fs.readFileSync("android/app/src/main/java/ai/elizaresearch/alphaphone/release/DataIntegrityProvider.java", "utf8");
  assert.doesNotMatch(source, /BuildConfig\.DEBUG|ELIZA_DEV_ALLOW_TEST_MOCKS|isDebuggable/);
  assert.match(source, /HmacSHA256/);
  for (const write of ["insert", "delete", "update"]) assert.match(source, new RegExp(`public (?:Uri|int) ${write}\\([^)]*\\)\\{throw new UnsupportedOperationException`));
  assert.match(source, /List\.of\("cache", "code_cache"\)/);
  const apk = fs.readFileSync("scripts/apk.mjs", "utf8");
  assert.match(apk, /"ai\.elizaresearch\.alphaphone\.release\.DataIntegrityProvider": "android\.permission\.DUMP"/);
  assert.ok(!fs.existsSync("android/app/src/testMocks/java/ai/elizaresearch/alphaphone/release"), "no test-mocks variant of the export");
});

const { planHome, updateUnit } = await import("../scripts/pilot-update.mjs");
const indexOf = (calls, predicate, from = 0) => calls.findIndex((call, index) => index >= from && predicate(call));
const lastIndexOf = (calls, predicate) => calls.findLastIndex(predicate);

test("HOME held by Alpha moves to the stock launcher for the readback and comes back before Alpha is started", () => {
  const { state, adb } = fakeUnit();
  const home = planHome(adb);
  assert.equal(home.stock, STOCK, "the one stock HOME app; Alpha and FallbackHome are not candidates");
  const update = updateUnit({ adb, apk: APK, before: BEFORE, home, timing });
  assert.deepEqual(update.failures, []);
  assert.equal(update.passed, true);
  const calls = state.calls;
  const moved = indexOf(calls, call => call.includes("add-role-holder") && call.endsWith("com.android.launcher3"));
  const firstRead = indexOf(calls, call => call.includes("content query"));
  const restored = indexOf(calls, call => call.includes("add-role-holder") && call.endsWith(ALPHA));
  assert.ok(moved >= 0 && moved < firstRead, "HOME leaves Alpha before the first readback");
  assert.ok(restored > lastIndexOf(calls, call => call.includes("content query")), "and returns after the last one");
  assert.ok(restored < indexOf(calls, call => call.startsWith("shell am start")), "before Alpha is started");
  assert.equal(state.holder, ALPHA);
  assert.equal(update.home.restoration.restored, true);
  assert.equal(update.home.recovery, undefined);
  assert.deepEqual(update.appStopped, { "pre-update": { running: null }, "post-update": { running: null } });
  assert.deepEqual(update.agentRestart, { state: "running" });
});

test("a unit where Alpha is not HOME keeps its HOME app; two stock launchers need --stock-home", () => {
  const { state, adb } = fakeUnit({ alphaHome: false });
  assert.equal(planHome(adb), null);
  assert.equal(updateUnit({ adb, apk: APK, before: BEFORE, timing }).passed, true);
  assert.ok(!state.calls.some(call => call.includes("add-role-holder")));
  const two = fakeUnit();
  const query = two.adb;
  const adb2 = (args, options) => args.join(" ").includes("query-activities") ? `${STOCK}\ncom.other.launcher/.Home\n` : query(args, options);
  assert.throws(() => planHome(adb2), /--stock-home/);
  assert.equal(planHome(adb2, { stockHome: "com.other.launcher/.Home" }).stock, "com.other.launcher/.Home");
});

test("Alpha running before a readback fails the update", () => {
  const pre = fakeUnit({ runningAt: "pre-update" });
  const refused = updateUnit({ adb: pre.adb, apk: APK, before: BEFORE, home: planHome(pre.adb), timing });
  assert.equal(refused.passed, false);
  assert.equal(refused.installed, false);
  assert.match(refused.failures.join("\n"), /Alpha was running before the pre-update readback \(pid 999\)/);
  assert.ok(!pre.state.calls.some(call => call.startsWith("install")), "nothing is installed over a running app");
  assert.equal(pre.state.holder, ALPHA, "HOME is still put back");
  const post = fakeUnit({ runningAt: "post-update" });
  const update = updateUnit({ adb: post.adb, apk: APK, before: BEFORE, home: planHome(post.adb), timing });
  assert.equal(update.passed, false);
  assert.deepEqual(update.appStopped["post-update"], { running: "4321" });
});

test("force-stop follows the last integrity export, so its :integrity process is gone before Alpha starts", () => {
  const { state, adb } = fakeUnit({ alphaHome: false });
  updateUnit({ adb, apk: APK, before: BEFORE, timing });
  const lastExport = lastIndexOf(state.calls, call => call.includes("content query"));
  const stop = indexOf(state.calls, call => call === `shell am force-stop ${ALPHA}`, lastExport);
  assert.ok(lastExport > indexOf(state.calls, call => call.startsWith("install")));
  assert.ok(stop > lastExport && stop < indexOf(state.calls, call => call.startsWith("shell am start")));
});

test("an agent that is refused or never reports running after the restart fails the update", () => {
  const refused = fakeUnit({ agentLog: "E ElizaAgent: Private IPC recovery refused\njava.io.IOException: unregistered same-UID process; preserve it" });
  const update = updateUnit({ adb: refused.adb, apk: APK, before: BEFORE, home: planHome(refused.adb), timing });
  assert.equal(update.passed, false);
  assert.equal(update.agentRestart.state, "refused");
  assert.match(update.failures.join("\n"), /the agent did not restart: Private IPC recovery refused/);
  const silent = fakeUnit({ agentLog: "" });
  const services = silent.adb;
  const withService = (args, options) => args.join(" ").startsWith("shell dumpsys activity services") ? `ServiceRecord{1 u0 ${ALPHA}/ai.elizaos.app.ElizaAgentService}` : services(args, options);
  const stalled = updateUnit({ adb: withService, apk: APK, before: BEFORE, home: planHome(withService), timing });
  assert.equal(stalled.passed, false);
  assert.equal(stalled.agentRestart.state, "not-running");
  const retried = fakeUnit({ agentLog: "W ElizaAgent: Agent process exited early (pid=1 code=1 alive=10ms).\nI ElizaAgent: Agent health restored." });
  assert.equal(updateUnit({ adb: retried.adb, apk: APK, before: BEFORE, home: planHome(retried.adb), timing }).passed, true, "a restart the service recovers from passes");
  const crashing = fakeUnit({ agentLog: "W ElizaAgent: Agent process exited early (pid=1 code=1 alive=10ms)." });
  const crashed = updateUnit({ adb: crashing.adb, apk: APK, before: BEFORE, home: planHome(crashing.adb), timing });
  assert.equal(crashed.agentRestart.state, "not-running");
  assert.equal(crashed.passed, false);
  const regressed = fakeUnit({ agentLog: "I ElizaAgent: Agent health restored.\nW ElizaAgent: Agent process exited early (pid=1 code=1 alive=10ms)." });
  assert.equal(updateUnit({ adb: regressed.adb, apk: APK, before: BEFORE, timing }).agentRestart.state, "not-running");
  const none = fakeUnit({ agentLog: "" });
  const cloud = updateUnit({ adb: none.adb, apk: APK, before: BEFORE, home: planHome(none.adb), timing });
  assert.equal(cloud.agentRestart.state, "not-verified", "no on-device agent is configured: recorded, not claimed");
  assert.equal(cloud.passed, true);
});

test("HOME that cannot be put back fails the update and records the recovery command", () => {
  const { state, adb } = fakeUnit();
  const home = planHome(adb);
  const stuck = (args, options) => args.join(" ").includes("add-role-holder") && args.at(-1) === ALPHA ? "" : adb(args, options);
  const update = updateUnit({ adb: stuck, apk: APK, before: BEFORE, home, timing });
  assert.equal(update.passed, false);
  assert.equal(update.agentRestart, null, "Alpha is not started while HOME is unproven");
  assert.match(update.home.recovery, /cmd role add-role-holder --user 0 android\.app\.role\.HOME ai\.elizaresearch\.alphaphone/);
  assert.notEqual(state.holder, ALPHA);
});

test("a role change without the stock HOME activity refuses readback and restores Alpha", () => {
  const { state, adb } = fakeUnit();
  const home = planHome(adb);
  const partial = args => args.includes("set-home-activity") && args.at(-1) === STOCK ? "" : adb(args);
  const update = updateUnit({ adb: partial, apk: APK, before: BEFORE, home, timing });
  assert.equal(update.passed, false);
  assert.equal(update.installAttempted, false);
  assert.match(update.failures.join("\n"), /Stock HOME was not held/);
  assert.equal(update.home.restoration.restored, true);
  assert.ok(!state.calls.some(call => /content query|^install/.test(call)));
});

test("a process that starts during either readback prevents verification", () => {
  for (const runningAt of ["pre-export", "post-export"]) {
    const { state, adb } = fakeUnit({ runningAt });
    const update = updateUnit({ adb, apk: APK, before: BEFORE, home: planHome(adb), timing });
    assert.equal(update.installAttempted, runningAt === "post-export");
    assert.equal(update.installVerified, false);
    assert.equal(update.agentRestart, null);
    assert.equal(state.holder, ALPHA);
  }
});

test("HOME changing to Alpha during readback also blocks a unit that started on stock HOME", () => {
  const { state, adb } = fakeUnit({ alphaHome: false });
  const raced = args => {
    const result = adb(args);
    if (args.includes("content")) {
      state.holder = ALPHA;
      state.activity = `${ALPHA}/.MainActivity`;
    }
    return result;
  };
  const update = updateUnit({ adb: raced, apk: APK, before: BEFORE, timing });
  assert.equal(update.installAttempted, false);
  assert.match(update.failures.join("\n"), /Stock HOME was not held/);
  assert.ok(!state.calls.some(call => call.includes("add-role-holder")), "leave a HOME change this update does not own alone");
});

test("an unavailable process listing cannot prove quiescence", () => {
  const { state, adb } = fakeUnit();
  const update = updateUnit({ adb: args => args.includes("ps") ? "" : adb(args), apk: APK, before: BEFORE, timing });
  assert.equal(update.installAttempted, false);
  assert.match(update.failures.join("\n"), /Cannot read the Android process list/);
  assert.equal(state.holder, ALPHA);
});

test("final process readback must prove the integrity process stopped before restart", () => {
  const { state, adb } = fakeUnit();
  const stuck = args => {
    const result = adb(args);
    if (args.join(" ") === `shell am force-stop ${ALPHA}` && state.calls.some(call => call.startsWith("install"))) state.integrity = true;
    return result;
  };
  const update = updateUnit({ adb: stuck, apk: APK, before: BEFORE, home: planHome(adb), timing });
  assert.equal(update.installVerified, true);
  assert.equal(update.passed, false);
  assert.match(update.failures.join("\n"), /processes remained/);
  assert.equal(update.agentRestart, null);
  assert.equal(update.home.restoration.restored, true);
  assert.ok(!state.calls.some(call => call.startsWith("shell am start")));
});

test("rotation intent is durable at dispatch and survives an ambiguous installer outcome", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-pilot-update-fixture-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, "journal");
  const id = "a".repeat(64);
  const { state, adb } = fakeUnit();
  const release = claimPilotInstall(directory, id, root);
  try {
    const update = updateUnit({ adb: args => {
      if (args[0] === "install") {
        assert.equal(inspectPilotRotation(directory, id).state, "unknown");
        assert.equal(state.holder, "com.android.launcher3");
        throw new Error("installer response lost");
      }
      return adb(args);
    }, apk: APK, before: BEFORE, home: planHome(adb), timing,
    prepareInstall: domains => {
      assert.ok(Object.keys(domains.files).length);
      assert.equal(inspectPilotRotation(directory, id).state, "none");
      return () => beginPilotRotation(directory, id, { replacementApkSha256: APK.sha256 });
    } });
    assert.equal(update.installAttempted, true);
    assert.equal(update.installed, false);
    assert.equal(update.installVerified, false);
    assert.equal(update.agentRestart, null);
    assert.match(update.failures.join("\n"), /installer response lost/);
    assert.equal(state.holder, ALPHA);
  } finally { release(); }
  assert.equal(inspectPilotRotation(directory, id).state, "unknown");
});

test("readback is checked again after rotation validation, before consuming its intent", () => {
  const { state, adb } = fakeUnit();
  let recorded = false;
  const update = updateUnit({ adb, apk: APK, before: BEFORE, home: planHome(adb), timing,
    prepareInstall: () => {
      state.pids = "777";
      return () => { recorded = true; };
    } });
  assert.equal(recorded, false);
  assert.equal(update.installAttempted, false);
  assert.equal(update.home.restoration.restored, true);
  assert.match(update.failures.join("\n"), /running before the pre-update readback/);
});
