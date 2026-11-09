import { createHmac } from "node:crypto";

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

// The update window on a scripted adb: the order of device commands, not device evidence.
const ALPHA = "ai.elizaresearch.alphaphone";
const STOCK = "com.android.launcher3/.uioverrides.QuickstepLauncher";
const APK = { file: "/tmp/new.apk", sha256: "c".repeat(64), versionCode: 2 };
const BEFORE = { versionCode: 1, userId: "10100", firstInstallTime: "2026-10-01 10:00:00" };
function fakeUnit({ alphaHome = true, runningAt = null, agentLog = "I ElizaAgent: Detached agent health check passed." } = {}) {
  const state = { holder: alphaHome ? ALPHA : "com.android.launcher3", activity: alphaHome ? `${ALPHA}/.MainActivity` : STOCK, pids: "", integrity: false, calls: [] };
  const adb = args => {
    const line = args.join(" ");
    state.calls.push(line);
    if (line.includes("get-role-holders")) return state.holder;
    if (line.includes("resolve-activity")) return state.activity;
    if (line === "shell am get-current-user") return "0";
    if (line.includes("query-activities")) return `3 activities found:\n  Activity #0:\n    priority=0\n    ${ALPHA}/.MainActivity\n  Activity #1:\n    ${STOCK}\n  Activity #2:\n    com.android.settings/.FallbackHome\n`;
    if (line.includes("add-role-holder")) { state.holder = args.at(-1); return ""; }
    if (line.includes("set-home-activity")) { state.activity = args.at(-1); return ""; }
    if (line === "shell ps -A -o PID,NAME") return ["PID NAME", ...(state.pids ? [`${state.pids} ${ALPHA}`] : []), ...(state.integrity ? [`98 ${ALPHA}:integrity`] : [])].join("\n");
    if (line === `shell am force-stop ${ALPHA}`) { state.pids = ""; state.integrity = false; return ""; }
    if (line.includes("run-as")) return "run-as: package not debuggable";
    if (line.includes("content query")) {
      state.integrity = true;
      const post = state.calls.some(call => call.startsWith("install"));
      if (runningAt === (post ? "post-export" : "pre-export")) state.pids = "4321";
      return exported(DATA, /nonce=(\w+)/.exec(line)[1]);
    }
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

export { ALPHA, STOCK, APK, BEFORE, DATA, NONCE, exported, hmac, fakeUnit, timing };
