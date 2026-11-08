// Release-build data integrity export as pilot-update reads it, on synthetic `content query`
// output. Not emulator or device evidence: an emulator run of the export is separate (class E).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHmac } from "node:crypto";
import { compareDomains, integrityQuery, INTEGRITY_AUTHORITY, parseIntegrityExport } from "../scripts/pilot-update.mjs";

const NONCE = "ab".repeat(32);
const hmac = (value, nonce = NONCE) => createHmac("sha256", Buffer.from(nonce, "ascii")).update(value).digest("hex");
/** What the provider returns: one row per file and an end row with the count, as `content query` prints them. */
function exported(files, nonce = NONCE) {
  const rows = Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([relative, bytes]) => {
    const domain = relative.includes("/") ? relative.slice(0, relative.indexOf("/")) : ".";
    return `domain=${domain}, key=${hmac(`path:${relative}`, nonce)}, digest=${hmac(bytes, nonce)}`;
  });
  rows.push(`domain=#end, key=${rows.length}, digest=${hmac(`count:${rows.length}`, nonce)}`);
  return rows.map((row, index) => `Row: ${index} ${row}`).join("\n") + "\n";
}

const DATA = {
  "files/notes/document.json": "{\"notes\":[1]}", "no_backup/connection-credentials/slot.bin": "sealed",
  "databases/androidx.work.workdb": "work", "shared_prefs/alpha.xml": "<map/>", "root-file": "x",
};

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

// The update window on a scripted adb: the order of device commands, not device evidence.
const ALPHA = "ai.elizaresearch.alphaphone";
const STOCK = "com.android.launcher3/.uioverrides.QuickstepLauncher";
const APK = { file: "/tmp/new.apk", sha256: "c".repeat(64), versionCode: 2 };
const BEFORE = { versionCode: 1, userId: "10100", firstInstallTime: "2026-10-01 10:00:00" };
function fakeUnit({ alphaHome = true, runningAt = null, agentLog = "I ElizaAgent: Detached agent health check passed." } = {}) {
  const state = { holder: alphaHome ? ALPHA : "com.android.launcher3", activity: alphaHome ? `${ALPHA}/.MainActivity` : STOCK, pids: "", calls: [] };
  const adb = (args, { allowFailure = false } = {}) => {
    const line = args.join(" ");
    state.calls.push(line);
    if (line.includes("get-role-holders")) return state.holder;
    if (line.includes("resolve-activity")) return state.activity;
    if (line === "shell am get-current-user") return "0";
    if (line.includes("query-activities")) return `3 activities found:\n  Activity #0:\n    priority=0\n    ${ALPHA}/.MainActivity\n  Activity #1:\n    ${STOCK}\n  Activity #2:\n    com.android.settings/.FallbackHome\n`;
    if (line.includes("add-role-holder")) { state.holder = args.at(-1); return ""; }
    if (line.includes("set-home-activity")) { state.activity = args.at(-1); return ""; }
    if (line === `shell pidof ${ALPHA}`) { if (!state.pids && !allowFailure) throw new Error("pidof failed"); return state.pids; }
    if (line === `shell am force-stop ${ALPHA}`) { state.pids = ""; return ""; }
    if (line.includes("run-as")) return "run-as: package not debuggable";
    if (line.includes("content query")) { if (runningAt === "post-update" && state.calls.some(call => call.startsWith("install"))) state.pids = "4321"; return exported(DATA, /nonce=(\w+)/.exec(line)[1]); }
    if (line.startsWith("install -r")) { if (runningAt === "post-update") state.pids = "4321"; return "Success"; }
    if (line === `shell dumpsys package ${ALPHA}`) return `versionCode=2 minSdk=31\n  userId=10100\n  firstInstallTime=2026-10-01 10:00:00\n`;
    if (line === `shell pm path ${ALPHA}`) return "package:/data/app/alpha/base.apk";
    if (line.startsWith("shell sha256sum")) return `${APK.sha256}  /data/app/alpha/base.apk`;
    if (line === "shell date +%s") return "1700000000";
    if (line.startsWith("shell am start")) { state.pids = "1234"; return ""; }
    if (line.startsWith("shell logcat")) return agentLog;
    if (line.startsWith("shell dumpsys activity services")) return "";
    throw new Error(`unexpected adb ${line}`);
  };
  if (runningAt === "pre-update") { const original = adb; return { state, adb: (args, options) => (args.join(" ") === `shell am force-stop ${ALPHA}` ? (state.calls.push(args.join(" ")), state.pids = "999", "") : original(args, options)) }; }
  return { state, adb };
}
const timing = { sleep: () => {}, agentAttempts: 2 };
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
