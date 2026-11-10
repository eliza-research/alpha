#!/usr/bin/env node
/**
 * Read-only evidence capture for the always-on listener gates G2-G6 (docs/adr/0001-privileged-listener.md,
 * docs/runbooks/664-listener-qualification.md, issue #664, docs/human-actions.md H-20).
 *
 *   node scripts/owner/listener-evidence.ts --dry-run --gates G2,G3
 *   node scripts/owner/listener-evidence.ts --serial SERIAL --user 0 --class image|device \
 *     --gates G2,G3,G4,G5,G6 --label "<scenario>" --out NEW_FILE.json \
 *     [--attest ATTEST.json] [--samples N --interval-min M] [--logcat-lines N]
 *   node scripts/owner/listener-evidence.ts --fixtures CAPTURES.json --class device --gates ... --out NEW_FILE.json
 *     (test data: evidence class `fixture`, earns no gate and has no candidate record)
 *
 * It runs only against the one device the operator names with --serial, and only the read-only
 * commands in READ_ONLY (getprop, pm list, dumpsys, settings get, device_config get, cmd role
 * get-role-holders, am get-current-user, logcat -d). It never presses keys, starts activities,
 * kills processes, changes settings, resets batterystats or writes to the device; the runbook
 * tells the operator which scenario to set up by hand before each capture.
 *
 * Captured output is reduced to the listener's own lines (its package, UID, the SenseListener tag,
 * AlphaAssistActivity launches) plus system state the gates need (audio mode, focus owners,
 * battery, thermal, wakefulness). Notification text of other apps, user names, phone state and
 * audio are never kept. The listener never logs transcripts; the filter drops anything else.
 *
 * Output (a new file; never android/sense/qualified-listener.json): the per-gate automated checks,
 * the manual items with the operator's attestations, and `candidateRecord`, the committed record
 * with only this run's earned gate results applied, validated by listenerRecordProblems from
 * scripts/listener-qualification.ts. `qualified` and `distributable` are never changed: a named
 * reviewer copies the earned fields into the committed record. Evidence classes are kept apart:
 * `--class image` (a booted image, Cuttlefish or Pixel) can only earn G2 and evidence.aospImage;
 * `--class device` must be a physical Pixel 10a (ro.product.device stallion, not virtual).
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { LISTENER_RECORD, listenerRecordProblems } from "../listener-qualification.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SCHEMA = "alpha-listener-evidence-v1";
export const PIXEL_10A_DEVICE = "stallion";
export const CAPTURE_GATES = ["G2", "G3", "G4", "G5", "G6"] as const;
type Gate = (typeof CAPTURE_GATES)[number];
type EvidenceClass = "image" | "device" | "fixture";
type Dump = string | null | undefined;
type Captures = Record<string, string | undefined>;
type CommandPlan = Record<string, string[]>;
type ListenerRecord = Parameters<typeof listenerRecordProblems>[0];
type VerifyListener = (user: string, appId: string) => unknown;

interface Sample {
  at: string;
  battery: ReturnType<typeof batteryFacts>;
  thermal: ReturnType<typeof thermalFacts>;
  power: ReturnType<typeof powerFacts>;
  listenerRecording: boolean;
  errors?: string[];
}

interface AttestationItem {
  result?: string;
  note?: string;
  media?: string;
}

interface Attestation {
  items?: Record<string, AttestationItem>;
  reviewer?: string;
  operator?: string;
}

interface GateChecks {
  checks: ReturnType<typeof check>[];
  facts?: unknown;
  g1Observation?: { privappPermissions: string | null; enforced: boolean };
}

interface GateResult extends GateChecks {
  manual: { id: string; result: string; note: string | null; media: string | null }[];
  classAllowed: boolean;
  earned: boolean;
  status: "passed" | "open";
}

interface EvidenceOptions {
  captures: Captures;
  samples?: Sample[];
  appId: string;
  user?: string;
  gates: readonly Gate[];
  evidenceClass: EvidenceClass;
  label?: string | null;
  attest?: Attestation | null;
  verifyListener?: VerifyListener | null;
  capturedAt?: string;
  serial?: string | null;
  record?: ListenerRecord | null;
  evidenceFile?: string | null;
  captureSource?: "adb" | "fixtures";
}

function isGate(value: string): value is Gate {
  return CAPTURE_GATES.some(gate => gate === value);
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export const INDICATOR_EXEMPT_ROLES = ["AMBIENT_AUDIO", "UI", "AUDIO", "NOTIFICATION", "TEXT", "VISUAL"].map(name => `android.app.role.SYSTEM_${name}_INTELLIGENCE`);
const SENSE_TAG = "SenseListener";
/** A capture whose adb command failed is stored as this prefix and the error text. */
export const CAPTURE_FAILED = "__error__";
export const captureFailed = (text: unknown) => typeof text === "string" && text.startsWith(CAPTURE_FAILED);
const SAMPLE_KEYS = ["dumpsys.battery", "dumpsys.thermal", "dumpsys.power", "dumpsys.audio"];
const roleKey = (role: string) => `role.${role.split(".").pop()}`;

/** Every command this script may send, as adb argument vectors after `-s SERIAL`. */
export function commandPlan({ appId, user = "0", gates, logcatLines = 4000 }: { appId: string; user?: string; gates: readonly Gate[]; logcatLines?: number }): CommandPlan {
  const pkg = `${appId}.sense`;
  const shell = (...args: string[]) => ["shell", ...args];
  const plan = {
    "prop.fingerprint": shell("getprop", "ro.build.fingerprint"),
    "prop.device": shell("getprop", "ro.product.device"),
    "prop.qemu": shell("getprop", "ro.kernel.qemu"),
    "prop.hardware": shell("getprop", "ro.hardware"),
    "prop.buildType": shell("getprop", "ro.build.type"),
    "prop.verifiedBoot": shell("getprop", "ro.boot.verifiedbootstate"),
    "prop.hotwordRequired": shell("getprop", "ro.hotword.detection_service_required"),
    "prop.privappPermissions": shell("getprop", "ro.control_privapp_permissions"),
    "pm.system": shell("pm", "list", "packages", "-s", "--user", user, pkg),
    "dumpsys.listenerPackage": shell("dumpsys", "package", pkg),
    "dumpsys.appPackage": shell("dumpsys", "package", appId),
    "dumpsys.services": shell("dumpsys", "activity", "services", pkg),
    "deviceConfig.micIcons": shell("device_config", "get", "privacy", "camera_mic_icons_enabled"),
    ...Object.fromEntries(INDICATOR_EXEMPT_ROLES.map(role => [roleKey(role), shell("cmd", "role", "get-role-holders", "--user", user, role)])),
    "user.current": shell("am", "get-current-user"),
    "dumpsys.audio": shell("dumpsys", "audio"),
    "dumpsys.appops": shell("dumpsys", "appops", "--package", pkg),
    "dumpsys.notification": shell("dumpsys", "notification"),
    "settings.lockScreenNotifications": shell("settings", "get", "secure", "lock_screen_show_notifications"),
    "settings.lockScreenSilent": shell("settings", "get", "secure", "lock_screen_show_silent_notifications"),
    "settings.aod": shell("settings", "get", "secure", "doze_always_on"),
    "logcat": ["logcat", "-d", "-v", "threadtime", "-t", String(logcatLines)],
  };
  if (gates.includes("G4")) Object.assign(plan, {
    "settings.powerLongPress": shell("settings", "get", "global", "power_button_long_press"),
    "settings.powerVolumeUpChord": shell("settings", "get", "global", "key_chord_power_volume_up"),
    "settings.emergencyGesture": shell("settings", "get", "secure", "emergency_gesture_enabled"),
    "settings.cameraDoubleTapDisabled": shell("settings", "get", "secure", "camera_double_tap_power_gesture_disabled"),
    "role.assistant": shell("cmd", "role", "get-role-holders", "--user", user, "android.app.role.ASSISTANT"),
    "dumpsys.activities": shell("dumpsys", "activity", "activities"),
  });
  if (gates.includes("G5")) Object.assign(plan, { "pm.users": shell("pm", "list", "users") });
  if (gates.includes("G6")) Object.assign(plan, {
    "dumpsys.battery": shell("dumpsys", "battery"),
    "dumpsys.thermal": shell("dumpsys", "thermalservice"),
    "dumpsys.power": shell("dumpsys", "power"),
    "dumpsys.batterystats": shell("dumpsys", "batterystats", "--charged", pkg),
  });
  for (const argv of Object.values(plan)) assertReadOnly(argv);
  return plan;
}

/** Refuses anything that is not one of the read-only command shapes above. */
export function assertReadOnly(argv: readonly string[]) {
  const [head, ...rest] = argv;
  const ok = head === "logcat" ? rest[0] === "-d" && !rest.includes("-c") && !rest.includes("-G")
    : head === "shell" && (
      (rest[0] === "getprop" && rest.length === 2) ||
      (rest[0] === "pm" && rest[1] === "list") ||
      (rest[0] === "dumpsys" && !rest.some(arg => /^--(reset|enable|disable|write|set|clear)/.test(arg) || /^(reset|enable|disable|set|clear)$/.test(arg))) ||
      (rest[0] === "settings" && rest[1] === "get") ||
      (rest[0] === "device_config" && rest[1] === "get") ||
      (rest[0] === "cmd" && rest[1] === "role" && rest[2] === "get-role-holders") ||
      (rest[0] === "am" && rest[1] === "get-current-user" && rest.length === 2));
  if (!ok) throw Error(`Refusing non-read-only adb command: ${argv.join(" ")}`);
}

const lines = (text: Dump) => String(text ?? "").split(/\r?\n/);
const trim = (text: Dump) => String(text ?? "").trim();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The listener's UID from `dumpsys package`, or null. */
export function packageUid(dump: Dump) {
  return /\b(?:userId|appId)=(\d+)/.exec(dump ?? "")?.[1] ?? null;
}

/** Keeps only the lines of `dumpsys notification` that belong to the listener's records. */
export function listenerNotifications(dump: Dump, pkg: string) {
  const out: string[] = [], all = lines(dump), own = new RegExp(`pkg=${escape(pkg)}(\\s|$)`);
  for (let i = 0; i < all.length; i++) {
    if (!/NotificationRecord\(/.test(all[i]) || !own.test(all[i])) continue;
    const indent = all[i].length - all[i].trimStart().length;
    out.push(all[i].trim());
    for (let j = i + 1; j < all.length && j < i + 60; j++) {
      if (!all[j].trim()) continue;
      if (all[j].length - all[j].trimStart().length <= indent) break;
      // Only the listener's own record: its title/text are fixed status strings (never transcripts).
      if (/(channel|importance|visibility|flags|actions|mVisibility|isHidden|lockscreen|fgs|ongoing|userSentiment|interruption|android\.(title|text)=)/i.test(all[j])) out.push(all[j].trim());
    }
  }
  return out;
}

/** Lines of `dumpsys audio` the gates need: mode, focus owners, ringer, and recordings by the listener. */
export function audioFacts(dump: Dump, { pkg, uid }: { pkg: string; uid: string | null }) {
  const kept: string[] = [], recordings: string[] = [];
  let section = "";
  for (const line of lines(dump)) {
    if (/^\S/.test(line)) section = line.trim();
    const t = line.trim();
    if (/^(mode|Audio mode|mMode|ringer mode|mRingerMode)\b/i.test(t) || /^- mode/i.test(t)) kept.push(t);
    else if (/Focus/i.test(section) && /source:|pack:|uid:/.test(t)) kept.push(t.replace(/ -- clientId:[^ ]+/, ""));
    else if (/session:|source:|riid:|recording/i.test(t) && (t.includes(pkg) || (uid && new RegExp(`\\buid:? ?${uid}\\b`).test(t)))) {
      kept.push(t);
      // Configuration lines (source:...) describe current recordings; "rec start/stop" lines are history.
      if (/source:/.test(t) && !/\brec (start|stop|update|release)\b/i.test(t)) recordings.push(t);
    }
  }
  const active = recordings.filter(t => !/released|state:stopped/i.test(t));
  return {
    lines: kept.slice(0, 200),
    listenerRecording: active.length > 0,
    hotwordSource: active.some(t => /HOTWORD|source:1999|source client=1999/i.test(t)),
    silenced: active.length > 0 && active.every(t => /silenced:? ?true/i.test(t)),
    mode: /mode(?: \((?:internal|external)\))?\s*[:=]\s*([A-Z_]+|\d+)/i.exec(kept.join("\n"))?.[1] ?? null,
  };
}

/** Listener RECORD_AUDIO / RECORD_AUDIO_HOTWORD op lines from `dumpsys appops --package`. */
export function appopsFacts(dump: Dump) {
  const kept: string[] = [];
  let op: string | null = null;
  let running = false;
  for (const line of lines(dump)) {
    const t = line.trim(), name = /^([A-Z_]+) \(/.exec(t)?.[1];
    if (name) op = name;
    if (/RECORD_AUDIO|Running|Access:|Reject:|mode=|uid mode/i.test(t)) kept.push(t);
    if (/^Running\b/.test(t) && op?.startsWith("RECORD_AUDIO")) running = true;
  }
  return { lines: kept.slice(0, 80), recordAudioRunning: running };
}

/** Logcat lines about the listener, its UID or assistant launches. */
export function logcatFacts(text: Dump, { pkg, appId, uid }: { pkg: string; appId: string; uid: string | null }) {
  const kept = lines(text).filter(t => t.includes(` ${SENSE_TAG}`) || t.includes(`${SENSE_TAG}:`) || t.includes(pkg) || /AlphaAssistActivity/.test(t) ||
    (uid && new RegExp(`\\buid[ =:]${uid}\\b`).test(t))).map(t => t.trim()).slice(-400);
  return {
    lines: kept,
    assistLaunches: kept.filter(t => /START u\d+ .*AlphaAssistActivity/.test(t) || /Displayed .*AlphaAssistActivity/.test(t)).length,
    listenerCrashes: kept.filter(t => /FATAL EXCEPTION|ANR in|Process .* has died|Force finishing/.test(t) && t.includes(pkg)).length,
    senseWarnings: kept.filter(t => t.includes(SENSE_TAG) && /\sW\s/.test(t)).length,
    appId,
  };
}

/** `pm list users` without user names. */
export function userFacts(text: Dump) {
  return lines(text).map(t => /UserInfo\{(\d+):[^:]*:([0-9a-fx]+)\}(.*)/.exec(t)).filter(match => match !== null).map(([, id, flags, rest]) => ({ id, flags, running: /running/.test(rest) }));
}

export function batteryFacts(text: Dump) {
  const get = (key: string) => new RegExp(`^\\s*${escape(key)}:\\s*(.+)$`, "m").exec(text ?? "")?.[1]?.trim() ?? null;
  return {
    level: Number(get("level")), scale: Number(get("scale")), temperatureDeciC: Number(get("temperature")), status: get("status"),
    acPowered: get("AC powered") === "true", usbPowered: get("USB powered") === "true", wirelessPowered: get("Wireless powered") === "true",
  };
}

export function thermalFacts(text: Dump) {
  const status = Number(/Thermal Status:\s*(\d+)/.exec(text ?? "")?.[1] ?? NaN);
  const temps = [...String(text ?? "").matchAll(/Temperature\{mValue=([-\d.]+), mType=(\d+), mName=([^,]+), mStatus=(\d+)\}/g)].map(m => ({ value: Number(m[1]), type: Number(m[2]), name: m[3], status: Number(m[4]) }));
  const max = (type: number) => {
    const value = temps.reduce((highest, temp) => temp.type === type ? Math.max(highest, temp.value) : highest, -Infinity);
    return Number.isFinite(value) ? value : null;
  };
  return { status: Number.isFinite(status) ? status : null, maxSkinC: max(3), maxCpuC: max(0), maxBatteryC: max(2) };
}

export function powerFacts(text: Dump) {
  return { wakefulness: /mWakefulness=(\w+)/.exec(text ?? "")?.[1] ?? null, listenerWakeLocks: lines(text).filter(t => /SenseListener|\.sense\b/.test(t) && /WAKE_LOCK|WakeLock/i.test(t)).map(t => t.trim()).slice(0, 20) };
}

/** Lines of `dumpsys activity activities` for the assistant activity (launch source only). */
export function activityFacts(text: Dump) {
  const out: string[] = [], all = lines(text);
  for (let i = 0; i < all.length; i++) if (/ActivityRecord\{[^}]*AlphaAssistActivity/.test(all[i])) {
    out.push(all[i].trim());
    for (let j = i + 1; j < all.length && j < i + 30; j++) if (/launchedFrom(Uid|Package)|launchedFromFeature/.test(all[j])) out.push(all[j].trim());
  }
  return { lines: out.slice(0, 40), launchedFromSystemUi: out.some(t => /launchedFromPackage=com\.android\.systemui\b/.test(t)) };
}

/** Manual items per gate: what the operator observes and attests (ADR 0001 gate table). */
export const MANUAL_ITEMS = Object.freeze({
  G2: ["G2.noCaptureBeforeConsent", "G2.consentRequestsRecordAudioAndNotifications"],
  G3: ["G3.micIndicatorUnlocked", "G3.chipStatusBar", "G3.chipLockScreen", "G3.chipAod", "G3.hideSilentNotificationsOn", "G3.notificationLockScreenControls",
    "G3.systemUiKillStops", "G3.immersivePauses", "G3.shadePauses", "G3.unattributedRecordingStops", "G3.aodOffPausesAndResumes", "G3.noResumeAfterLoss", "G3.senseConsentText"],
  G4: ["G4.pressHoldStartsOneVoiceTurn", "G4.appSentAssistOnlyOpens", "G4.powerVolumeUpPowerMenu", "G4.emergencySosUnchanged", "G4.doublePressCameraUnchanged",
    "G4.coldStartWakeOwnerAdmission", "G4.lockedWakeIgnored"],
  G5: ["G5.guestSwitchStops", "G5.secondaryUserStops", "G5.ringingPauses", "G5.callPauses", "G5.otherRecorderReleases", "G5.alphaVoiceTurnReleases",
    "G5.mediaSuppressesWake", "G5.bluetoothRouting", "G5.noEchoReinvocation", "G5.recoversAfterEach", "G5.revocationOnReset"],
  G6: ["G6.pauseFromNotification", "G6.turnOffFromNotification", "G6.tilePause", "G6.lockScreenPause", "G6.rebootBeforeUnlockNoCapture", "G6.crashLoopStops",
    "G6.multiHourRun", "G6.twentyFourHourRun"],
});

/** A `run(argv)` for the upstream verifier that answers from captured plan output. */
export function fixtureRunner(plan: CommandPlan, captures: Captures) {
  const byArgv = new Map(Object.entries(plan).map(([key, argv]) => [argv.join("\u0000"), key]));
  return (...argv: string[]) => {
    const key = byArgv.get(argv.join("\u0000"));
    if (!key) throw Error(`No captured output for: ${argv.join(" ")}`);
    return captures[key] ?? "";
  };
}

const check = (id: string, ok: boolean, detail: string) => ({ id, ok: ok === true, detail });

/**
 * Evidence from captured command output. `captures` maps plan keys to stdout (one snapshot) and
 * `samples` is a list of {at, battery, thermal, power, listenerRecording, errors} for G6, `errors`
 * naming the sample's failed captures. A check that reads a failed capture fails.
 * `verifyListener` is scripts/aosp-listener.ts verifyAospListener (injected so tests need no checkout).
 * `captureSource` is "adb" or "fixtures"; fixture evidence has class `fixture` and earns nothing.
 */
export function buildEvidence({ captures, samples = [], appId, user = "0", gates, evidenceClass, label = null, attest = null, verifyListener = null, capturedAt = new Date().toISOString(), serial = null, record = null, evidenceFile = null, captureSource = "adb" }: EvidenceOptions) {
  const fromFixtures = captureSource === "fixtures";
  if (fromFixtures) evidenceClass = "fixture";
  const failed = Object.keys(captures).filter(key => captureFailed(captures[key]));
  const pkg = `${appId}.sense`, c = (key: string) => failed.includes(key) ? null : captures[key] ?? "";
  const captured = (keys: string[], id: string, ok: boolean, detail: string) => {
    const bad = keys.filter(key => failed.includes(key));
    return bad.length ? check(id, false, `capture failed: ${bad.join(", ")}`) : check(id, ok, detail);
  };
  const uid = packageUid(c("dumpsys.listenerPackage"));
  const device = { fingerprint: trim(c("prop.fingerprint")), product: trim(c("prop.device")), hardware: trim(c("prop.hardware")), buildType: trim(c("prop.buildType")),
    verifiedBootState: trim(c("prop.verifiedBoot")), virtual: trim(c("prop.qemu")) === "1" || /^(cutf|ranchu|goldfish|vsoc)/.test(trim(c("prop.hardware"))) || /^vsoc|^cf_/.test(trim(c("prop.device"))) };
  const physicalPixel10a = !device.virtual && device.product === PIXEL_10A_DEVICE;
  const classProblem = fromFixtures ? "fixture captures are test data and never earn gates" : evidenceClass === "device" && !physicalPixel10a ? `--class device needs a physical Pixel 10a (ro.product.device ${PIXEL_10A_DEVICE}); this is ${device.product || "unknown"}${device.virtual ? " (virtual)" : ""}` : null;
  const audio = audioFacts(c("dumpsys.audio"), { pkg, uid });
  const appops = appopsFacts(c("dumpsys.appops"));
  const notifications = listenerNotifications(c("dumpsys.notification"), pkg);
  const logcat = logcatFacts(c("logcat"), { pkg, appId, uid });
  const services = /\.ListeningService\b/.test(c("dumpsys.services") ?? "");
  const roles = Object.fromEntries(INDICATOR_EXEMPT_ROLES.map(role => [role, trim(c(roleKey(role)))]));
  const facts = { uid, listeningServiceRunning: services, audio, appops, notifications, logcat: { assistLaunches: logcat.assistLaunches, listenerCrashes: logcat.listenerCrashes, senseWarnings: logcat.senseWarnings },
    currentUser: trim(c("user.current")), lockScreenNotifications: trim(c("settings.lockScreenNotifications")), lockScreenSilentNotifications: trim(c("settings.lockScreenSilent")), alwaysOnDisplay: trim(c("settings.aod")) };
  const drafts: Partial<Record<Gate, GateChecks>> = {};

  if (gates.includes("G2")) {
    let verified: unknown = null;
    let error: string | null = null;
    try { verified = verifyListener ? verifyListener(user, appId) : null; }
    catch (failure) { error = message(failure); }
    drafts.G2 = { checks: [
      check("G2.verifyAospListener", verified !== null && !error, error ?? (verified ? "scripts/verify-aosp-listener.ts checks passed" : "verifier not run")),
      captured(["prop.hotwordRequired"], "G2.hotwordAttributionProperty", trim(c("prop.hotwordRequired")) === "true", `ro.hotword.detection_service_required=${trim(c("prop.hotwordRequired")) || "unset"}`),
      captured(["deviceConfig.micIcons"], "G2.micIconsNotDisabled", !/^false$/i.test(trim(c("deviceConfig.micIcons"))), `privacy/camera_mic_icons_enabled=${trim(c("deviceConfig.micIcons")) || "default"}`),
      captured(INDICATOR_EXEMPT_ROLES.map(roleKey), "G2.indicatorExemptRolesEmpty", Object.values(roles).every(v => !v), Object.entries(roles).filter(([, v]) => v).map(([r, v]) => `${r}=${v}`).join(", ") || "all six empty"),
      captured(["prop.verifiedBoot"], "G2.verifiedBoot", ["green", "yellow"].includes(device.verifiedBootState), `ro.boot.verifiedbootstate=${device.verifiedBootState || "unset"}`),
    ], facts: verified,
    // G1 (image build) is not captured here, but whether the booted image enforces the privapp
    // allowlist is observable: unset means DISABLE at the pinned frameworks/base (RoSystemProperties).
    g1Observation: { privappPermissions: trim(c("prop.privappPermissions")) || null, enforced: /^enforce$/i.test(trim(c("prop.privappPermissions"))) } };
  }
  if (gates.includes("G3")) drafts.G3 = { checks: [
    captured(["dumpsys.audio", "dumpsys.listenerPackage"], "G3.listenerRecordingObserved", audio.listenerRecording && !audio.silenced, audio.listenerRecording ? `listener UID ${uid} recording${audio.silenced ? " (silenced)" : ""}` : "no listener recording configuration (set up the LISTENING state before capturing)"),
    captured(["dumpsys.audio", "dumpsys.listenerPackage"], "G3.hotwordSource", audio.hotwordSource, "listener capture uses AUDIO_SOURCE_HOTWORD"),
    captured(["dumpsys.appops"], "G3.appopsRecordAudioRunning", appops.recordAudioRunning, "RECORD_AUDIO op running for the listener (attribution under detection_service_required)"),
    captured(["dumpsys.notification"], "G3.listenerNotificationPosted", notifications.some(t => /listening-indicator/.test(t)), `${notifications.length} listener notification line(s); channel listening-indicator expected`),
    captured(["settings.lockScreenNotifications"], "G3.lockScreenNotificationsOn", facts.lockScreenNotifications !== "0", `lock_screen_show_notifications=${facts.lockScreenNotifications || "default"}`),
    captured(["logcat"], "G3.noListenerCrash", logcat.listenerCrashes === 0, `${logcat.listenerCrashes} listener crash line(s) in logcat`),
  ] };
  if (gates.includes("G4")) {
    const activity = activityFacts(c("dumpsys.activities"));
    const longPress = trim(c("settings.powerLongPress")), chord = trim(c("settings.powerVolumeUpChord"));
    drafts.G4 = { checks: [
      captured(["settings.powerLongPress"], "G4.longPressPowerIsAssistant", longPress === "5" || longPress === "null" || longPress === "", `power_button_long_press=${longPress || "null"} (null means the overlay default config_longPressOnPowerBehavior=5; confirm by pressing)`),
      captured(["settings.powerVolumeUpChord"], "G4.powerVolumeUpIsPowerMenu", chord === "2" || chord === "null" || chord === "", `key_chord_power_volume_up=${chord || "null"} (2 = power menu)`),
      captured(["role.assistant"], "G4.assistantRoleIsAlpha", trim(c("role.assistant")).split(/\s+/).includes(appId), `ASSISTANT role holder: ${trim(c("role.assistant")) || "none"}`),
      captured(["settings.emergencyGesture"], "G4.emergencyGestureNotDisabled", trim(c("settings.emergencyGesture")) !== "0", `emergency_gesture_enabled=${trim(c("settings.emergencyGesture")) || "default"}`),
      captured(["settings.cameraDoubleTapDisabled"], "G4.cameraDoubleTapNotDisabled", trim(c("settings.cameraDoubleTapDisabled")) !== "1", `camera_double_tap_power_gesture_disabled=${trim(c("settings.cameraDoubleTapDisabled")) || "default"}`),
      captured(["logcat"], "G4.assistLaunchLogged", logcat.assistLaunches > 0, `${logcat.assistLaunches} AlphaAssistActivity launch line(s) in logcat (press-and-hold power before capturing)`),
    ], facts: { activity } };
  }
  if (gates.includes("G5")) drafts.G5 = { checks: [
    captured(["dumpsys.audio"], "G5.snapshotCaptured", audio.mode !== null, `audio mode ${audio.mode ?? "unknown"}, current user ${facts.currentUser || "unknown"}, listener recording ${audio.listenerRecording}`),
  ], facts: { users: userFacts(c("pm.users")) } };
  if (gates.includes("G6")) {
    const all = samples.length ? samples : [{ at: capturedAt, battery: batteryFacts(c("dumpsys.battery")), thermal: thermalFacts(c("dumpsys.thermal")), power: powerFacts(c("dumpsys.power")), listenerRecording: audio.listenerRecording, errors: SAMPLE_KEYS.filter(key => failed.includes(key)) }];
    const first = all[0], last = all[all.length - 1];
    const hours = (Date.parse(last.at) - Date.parse(first.at)) / 3_600_000;
    const drop = first.battery.level - last.battery.level;
    const plugged = all.some(s => s.battery.acPowered || s.battery.usbPowered || s.battery.wirelessPowered);
    const worst = all.reduce((a, s) => Math.max(a, s.thermal.status ?? 0), 0);
    const sampleFailures = [...new Set(all.flatMap(s => s.errors ?? []))];
    const sampled = (id: string, ok: boolean, detail: string) => sampleFailures.length ? check(id, false, `capture failed: ${sampleFailures.join(", ")}`) : check(id, ok, detail);
    drafts.G6 = { checks: [
      sampled("G6.unpluggedThroughout", !plugged, plugged ? "charging during the run (use wireless debugging or capture before/after unplugged)" : "on battery for every sample"),
      sampled("G6.listeningThroughout", all.every(s => s.listenerRecording), `${all.filter(s => s.listenerRecording).length}/${all.length} samples with the listener recording`),
      sampled("G6.thermalBelowSevere", worst < 3, `worst thermal status ${worst} (3 = SEVERE)`),
      check("G6.twentyFourHourSpan", hours >= 24, `run span ${hours.toFixed(2)} h over ${all.length} sample(s)`),
    ], facts: { samples: all.length, spanHours: Number(hours.toFixed(3)), batteryDropPercent: drop, drainPercentPerHour: hours > 0 ? Number((drop / hours).toFixed(3)) : null, worstThermalStatus: worst,
      maxSkinC: all.reduce((a, s) => Math.max(a, s.thermal.maxSkinC ?? -Infinity), -Infinity), batterystats: lines(c("dumpsys.batterystats")).filter(t => /Estimated power use|Uid u0a|cpu:|wake|audio/i.test(t)).map(t => t.trim()).slice(0, 60), series: all } };
  }

  // Manual items and the operator's attestation; a gate is earned only with every check and item passing.
  const attested = attest?.items ?? {};
  const reviewer = typeof attest?.reviewer === "string" && attest.reviewer.trim() ? attest.reviewer.trim() : null;
  const result: Partial<Record<Gate, GateResult>> = {};
  for (const gate of CAPTURE_GATES) {
    const draft = drafts[gate];
    if (!draft) continue;
    const manual = MANUAL_ITEMS[gate].map(id => ({ id, result: attested[id]?.result ?? "not attested", note: attested[id]?.note ?? null, media: attested[id]?.media ?? null }));
    const classAllowed = !classProblem && (evidenceClass === "device" || (gate === "G2" && evidenceClass === "image"));
    const earned = classAllowed && draft.checks.every(entry => entry.ok) && manual.every(item => item.result === "pass") && reviewer !== null;
    result[gate] = { ...draft, manual, classAllowed, earned, status: earned ? "passed" : "open" };
  }
  return {
    schema: SCHEMA, capturedAt, label, captureSource, evidenceClass, classProblem, user,
    serialSha256: !fromFixtures && serial ? createHash("sha256").update(serial).digest("hex") : null, captureFailed: failed,
    reviewer, operator: attest?.operator ?? null, device: { ...device, physicalPixel10a }, packageName: pkg, gates: result,
    facts: { ...facts, logcatLines: logcat.lines, audioLines: audio.lines, appopsLines: appops.lines },
    candidateRecord: record && !fromFixtures ? candidateRecord(record, result, { evidenceClass, classProblem, label, evidenceFile }) : null,
    note: "Read-only capture. Not image-build (G1), SystemUI compilation or release evidence. A named reviewer copies earned gates into android/sense/qualified-listener.json; qualified/distributable are never set here.",
  };
}

/** The committed record with this run's earned gates applied (never downgrades, never qualifies). */
export function candidateRecord(record: ListenerRecord, gates: Partial<Record<Gate, { earned: boolean }>>, { evidenceClass, classProblem, label, evidenceFile = null }: {
  evidenceClass: EvidenceClass; classProblem?: string | null; label?: string | null; evidenceFile?: string | null;
}) {
  const next = structuredClone(record);
  if (!next.gates || !next.evidence) throw Error("Listener qualification record needs gates and evidence");
  const nextGates = next.gates;
  for (const [gate, value] of Object.entries(gates)) if (value?.earned) nextGates[gate] = "passed";
  if (gates.G2?.earned) next.evidence.aospImage = { recorded: true, class: "aosp-image-boot", record: evidenceFile, note: `G2 captured on a booted image (${label ?? "unlabelled"})` };
  const deviceGates = ["G3", "G4", "G5", "G6"];
  if (evidenceClass === "device" && !classProblem && deviceGates.every(gate => nextGates[gate] === "passed"))
    next.evidence.deviceAcceptance = { recorded: true, class: "device-acceptance", record: evidenceFile, note: "G3-G6 earned on a physical Pixel 10a; reviewer to confirm before committing" };
  next.qualified = record.qualified;
  next.distributable = record.distributable;
  return { record: next, problems: listenerRecordProblems(next) };
}

function parseArgs(argv: readonly string[]) {
  const opts: {
    gates: readonly string[]; user: string; logcatLines: number; samples: number; intervalMin: number;
    dryRun?: boolean; serial?: string; evidenceClass?: string; label?: string; out?: string; attest?: string; fixtures?: string;
  } = { gates: CAPTURE_GATES, user: "0", logcatLines: 4000, samples: 1, intervalMin: 30 };
  const value = (i: number, name: string) => { const v = argv[i + 1]; if (!v || v.startsWith("--")) throw Error(`${name} needs a value`); return v; };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--serial") opts.serial = value(i++, arg);
    else if (arg === "--user") opts.user = value(i++, arg);
    else if (arg === "--class") opts.evidenceClass = value(i++, arg);
    else if (arg === "--gates") opts.gates = value(i++, arg).split(",").map(g => g.trim().toUpperCase());
    else if (arg === "--label") opts.label = value(i++, arg);
    else if (arg === "--out") opts.out = value(i++, arg);
    else if (arg === "--attest") opts.attest = value(i++, arg);
    else if (arg === "--fixtures") opts.fixtures = value(i++, arg);
    else if (arg === "--samples") opts.samples = Number(value(i++, arg));
    else if (arg === "--interval-min") opts.intervalMin = Number(value(i++, arg));
    else if (arg === "--logcat-lines") opts.logcatLines = Number(value(i++, arg));
    else throw Error(`Unknown option ${arg}`);
  }
  const { gates, evidenceClass, out, fixtures, serial } = opts;
  if (!gates.every(isGate)) throw Error(`--gates takes ${CAPTURE_GATES.join(",")} (G1 is the image build, G7 is optional hardening)`);
  if (!/^(0|[1-9]\d*)$/.test(opts.user)) throw Error("--user must be an Android user id");
  if (!Number.isInteger(opts.samples) || opts.samples < 1 || !(opts.intervalMin > 0)) throw Error("--samples must be a positive integer and --interval-min positive");
  if (opts.samples > 1 && !opts.gates.includes("G6")) throw Error("--samples is for the G6 power run");
  if (opts.dryRun) return { ...opts, gates, dryRun: true as const };
  if (evidenceClass !== "image" && evidenceClass !== "device") throw Error("--class image|device is required");
  if (!out) throw Error("--out NEW_FILE is required");
  if (fs.existsSync(out)) throw Error(`${out} exists; evidence files are never overwritten`);
  if (path.resolve(out) === path.join(ROOT, LISTENER_RECORD)) throw Error("Never write the committed listener record; a reviewer copies earned fields");
  const captureOptions = { ...opts, gates, dryRun: false, out, evidenceClass } as const;
  if (fixtures) return { ...captureOptions, capture: { source: "fixtures" as const, file: fixtures } };
  if (!serial || !/^[A-Za-z0-9_.:-]+$/.test(serial)) throw Error("Explicit --serial required (the device the operator chose)");
  return { ...captureOptions, capture: { source: "adb" as const, serial } };
}

async function main(argv: readonly string[]) {
  const opts = parseArgs(argv);
  const { appId }: { appId: string } = JSON.parse(fs.readFileSync(path.join(ROOT, "app.config.json"), "utf8"));
  const plan = commandPlan({ appId, user: opts.user, gates: opts.gates, logcatLines: opts.logcatLines });
  if (opts.dryRun) {
    const serial = opts.serial ?? "SERIAL";
    console.log(`Read-only commands for gates ${opts.gates.join(",")} (nothing is sent in --dry-run):`);
    for (const [key, args] of Object.entries(plan)) console.log(`  ${key.padEnd(34)} adb -s ${serial} ${args.join(" ")}`);
    if (opts.gates.includes("G6")) console.log(`  G6 power run: battery, thermal, power and audio repeat ${opts.samples} time(s) every ${opts.intervalMin} min`);
    console.log(`Manual items to attest (--attest FILE): ${opts.gates.flatMap(g => MANUAL_ITEMS[g]).join(", ")}`);
    return;
  }
  const record: ListenerRecord = JSON.parse(fs.readFileSync(path.join(ROOT, LISTENER_RECORD), "utf8"));
  const attest: Attestation | null = opts.attest ? JSON.parse(fs.readFileSync(opts.attest, "utf8")) : null;
  let captures: Captures;
  let samples: Sample[] = [];
  let verifyListener: VerifyListener | null = null;
  let upstream: typeof import("../aosp-listener.ts").verifyAospListener | undefined;
  try { ({ verifyAospListener: upstream } = await import("../aosp-listener.ts")); }
  catch (error) { console.error(`G2 verifier unavailable (needs vendor/eliza at the pin): ${message(error).split("\n")[0]}`); }
  const verify = upstream;
  if (opts.capture.source === "fixtures") {
    const fixture: { captures: Captures; samples?: Sample[] } = JSON.parse(fs.readFileSync(opts.capture.file, "utf8"));
    captures = fixture.captures;
    samples = fixture.samples ?? [];
    if (verify) verifyListener = (user, id) => verify(fixtureRunner(plan, captures), user, id);
  } else {
    const { serial } = opts.capture;
    const { execFileSync } = await import("node:child_process");
    const { androidEnv } = await import("../toolchain.ts");
    const env = androidEnv(), adb = path.join(env.ANDROID_HOME, "platform-tools/adb");
    const read = (...args: string[]) => {
      assertReadOnly(args);
      return execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", env, timeout: 30_000, maxBuffer: 64 << 20 });
    };
    const run = (...args: string[]) => {
      try { return read(...args); }
      catch (error) { return `${CAPTURE_FAILED} ${message(error).split("\n")[0]}`; }
    };
    captures = Object.fromEntries(Object.entries(plan).map(([key, args]) => [key, run(...args)]));
    if (verify) verifyListener = (user, id) => verify(read, user, id);
    if (opts.gates.includes("G6")) {
      const pkg = `${appId}.sense`, uid = packageUid(captures["dumpsys.listenerPackage"]);
      const sampleOnce = () => {
        const at = new Date().toISOString(), out = Object.fromEntries(SAMPLE_KEYS.map(key => [key, run(...plan[key])]));
        const ok = (key: string) => captureFailed(out[key]) ? null : out[key];
        return { at, battery: batteryFacts(ok("dumpsys.battery")), thermal: thermalFacts(ok("dumpsys.thermal")), power: powerFacts(ok("dumpsys.power")),
          listenerRecording: audioFacts(ok("dumpsys.audio"), { pkg, uid }).listenerRecording, errors: SAMPLE_KEYS.filter(key => captureFailed(out[key])) };
      };
      samples.push(sampleOnce());
      for (let n = 1; n < opts.samples; n++) {
        await new Promise(resolve => setTimeout(resolve, opts.intervalMin * 60_000));
        const sample = sampleOnce();
        samples.push(sample);
        console.error(`G6 sample ${n + 1}/${opts.samples} at ${sample.at}: battery ${sample.battery.level}%, thermal ${sample.thermal.status}`);
      }
    }
  }
  const out = path.resolve(opts.out);
  const evidence = buildEvidence({ captures, samples, appId, user: opts.user, gates: opts.gates, evidenceClass: opts.evidenceClass, label: opts.label ?? null, attest, verifyListener, serial: opts.serial ?? null, record, evidenceFile: path.relative(ROOT, out), captureSource: opts.capture.source });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
  console.log(`Wrote ${opts.out} (${evidence.evidenceClass}${evidence.classProblem ? `; ${evidence.classProblem}` : ""})`);
  if (opts.capture.source === "fixtures") console.log("  Fixture evidence never earns gates and has no candidate record.");
  if (evidence.captureFailed.length) console.log(`  capture failed: ${evidence.captureFailed.join(", ")}`);
  for (const [gate, value] of Object.entries(evidence.gates)) {
    if (!value) continue;
    console.log(`  ${gate} ${value.status.padEnd(6)} automated ${value.checks.filter(x => x.ok).length}/${value.checks.length}, manual ${value.manual.filter(x => x.result === "pass").length}/${value.manual.length}${value.classAllowed ? "" : " (evidence class cannot earn this gate)"}`);
  }
  if (evidence.candidateRecord?.problems.length) console.log(`  candidate record problems: ${evidence.candidateRecord.problems.join("; ")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(message(error)); process.exitCode = 2; });
