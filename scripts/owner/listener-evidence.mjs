#!/usr/bin/env node
/**
 * Read-only evidence capture for the always-on listener gates G2-G6 (docs/adr/0001-privileged-listener.md,
 * docs/runbooks/664-listener-qualification.md, issue #664, docs/human-actions.md H-20).
 *
 *   node scripts/owner/listener-evidence.mjs --dry-run --gates G2,G3
 *   node scripts/owner/listener-evidence.mjs --serial SERIAL --user 0 --class image|device \
 *     --gates G2,G3,G4,G5,G6 --label "<scenario>" --out NEW_FILE.json \
 *     [--attest ATTEST.json] [--samples N --interval-min M] [--logcat-lines N]
 *   node scripts/owner/listener-evidence.mjs --fixtures CAPTURES.json --class device --gates ... --out NEW_FILE.json
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
 * scripts/listener-qualification.mjs. `qualified` and `distributable` are never changed: a named
 * reviewer copies the earned fields into the committed record. Evidence classes are kept apart:
 * `--class image` (a booted image, Cuttlefish or Pixel) can only earn G2 and evidence.aospImage;
 * `--class device` must be a physical Pixel 10a (ro.product.device stallion, not virtual).
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { LISTENER_RECORD, listenerRecordProblems } from "../listener-qualification.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SCHEMA = "alpha-listener-evidence-v1";
export const PIXEL_10A_DEVICE = "stallion";
export const CAPTURE_GATES = ["G2", "G3", "G4", "G5", "G6"];
export const INDICATOR_EXEMPT_ROLES = ["AMBIENT_AUDIO", "UI", "AUDIO", "NOTIFICATION", "TEXT", "VISUAL"].map(name => `android.app.role.SYSTEM_${name}_INTELLIGENCE`);
const SENSE_TAG = "SenseListener";
const roleKey = role => `role.${role.split(".").pop()}`;

/** Every command this script may send, as adb argument vectors after `-s SERIAL`. */
export function commandPlan({ appId, user = "0", gates, logcatLines = 4000 }) {
  const pkg = `${appId}.sense`;
  const shell = (...args) => ["shell", ...args];
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
export function assertReadOnly(argv) {
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

const lines = text => String(text ?? "").split(/\r?\n/);
const trim = text => String(text ?? "").trim();
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The listener's UID from `dumpsys package`, or null. */
export function packageUid(dump) {
  return /\b(?:userId|appId)=(\d+)/.exec(dump ?? "")?.[1] ?? null;
}

/** Keeps only the lines of `dumpsys notification` that belong to the listener's records. */
export function listenerNotifications(dump, pkg) {
  const out = [], all = lines(dump), own = new RegExp(`pkg=${escape(pkg)}(\\s|$)`);
  for (let i = 0; i < all.length; i++) {
    if (!/NotificationRecord\(/.test(all[i]) || !own.test(all[i])) continue;
    const indent = /^\s*/.exec(all[i])[0].length;
    out.push(all[i].trim());
    for (let j = i + 1; j < all.length && j < i + 60; j++) {
      if (!all[j].trim()) continue;
      if (/^\s*/.exec(all[j])[0].length <= indent) break;
      // Only the listener's own record: its title/text are fixed status strings (never transcripts).
      if (/(channel|importance|visibility|flags|actions|mVisibility|isHidden|lockscreen|fgs|ongoing|userSentiment|interruption|android\.(title|text)=)/i.test(all[j])) out.push(all[j].trim());
    }
  }
  return out;
}

/** Lines of `dumpsys audio` the gates need: mode, focus owners, ringer, and recordings by the listener. */
export function audioFacts(dump, { pkg, uid }) {
  const kept = [], recordings = [];
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
export function appopsFacts(dump) {
  const kept = [];
  let op = null, running = false;
  for (const line of lines(dump)) {
    const t = line.trim(), name = /^([A-Z_]+) \(/.exec(t)?.[1];
    if (name) op = name;
    if (/RECORD_AUDIO|Running|Access:|Reject:|mode=|uid mode/i.test(t)) kept.push(t);
    if (/^Running\b/.test(t) && op?.startsWith("RECORD_AUDIO")) running = true;
  }
  return { lines: kept.slice(0, 80), recordAudioRunning: running };
}

/** Logcat lines about the listener, its UID or assistant launches. */
export function logcatFacts(text, { pkg, appId, uid }) {
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
export function userFacts(text) {
  return lines(text).map(t => /UserInfo\{(\d+):[^:]*:([0-9a-fx]+)\}(.*)/.exec(t)).filter(Boolean).map(([, id, flags, rest]) => ({ id, flags, running: /running/.test(rest) }));
}

export function batteryFacts(text) {
  const get = key => new RegExp(`^\\s*${escape(key)}:\\s*(.+)$`, "m").exec(text ?? "")?.[1]?.trim() ?? null;
  return {
    level: Number(get("level")), scale: Number(get("scale")), temperatureDeciC: Number(get("temperature")), status: get("status"),
    acPowered: get("AC powered") === "true", usbPowered: get("USB powered") === "true", wirelessPowered: get("Wireless powered") === "true",
  };
}

export function thermalFacts(text) {
  const status = Number(/Thermal Status:\s*(\d+)/.exec(text ?? "")?.[1] ?? NaN);
  const temps = [...String(text ?? "").matchAll(/Temperature\{mValue=([-\d.]+), mType=(\d+), mName=([^,]+), mStatus=(\d+)\}/g)].map(m => ({ value: Number(m[1]), type: Number(m[2]), name: m[3], status: Number(m[4]) }));
  const max = type => temps.filter(t => t.type === type).reduce((a, t) => Math.max(a, t.value), -Infinity);
  return { status: Number.isFinite(status) ? status : null, maxSkinC: Number.isFinite(max(3)) ? max(3) : null, maxCpuC: Number.isFinite(max(0)) ? max(0) : null, maxBatteryC: Number.isFinite(max(2)) ? max(2) : null };
}

export function powerFacts(text) {
  return { wakefulness: /mWakefulness=(\w+)/.exec(text ?? "")?.[1] ?? null, listenerWakeLocks: lines(text).filter(t => /SenseListener|\.sense\b/.test(t) && /WAKE_LOCK|WakeLock/i.test(t)).map(t => t.trim()).slice(0, 20) };
}

/** Lines of `dumpsys activity activities` for the assistant activity (launch source only). */
export function activityFacts(text) {
  const out = [], all = lines(text);
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
export function fixtureRunner(plan, captures) {
  const byArgv = new Map(Object.entries(plan).map(([key, argv]) => [argv.join("\u0000"), key]));
  return (...argv) => {
    const key = byArgv.get(argv.join("\u0000"));
    if (!key) throw Error(`No captured output for: ${argv.join(" ")}`);
    return captures[key] ?? "";
  };
}

const check = (id, ok, detail) => ({ id, ok: ok === true, detail });

/**
 * Evidence from captured command output. `captures` maps plan keys to stdout (one snapshot) and
 * `samples` is a list of {at, battery, thermal, power, listenerRecording} for G6.
 * `verifyListener` is scripts/aosp-listener.mjs verifyAospListener (injected so tests need no checkout).
 */
export function buildEvidence({ captures, samples = [], appId, user = "0", gates, evidenceClass, label = null, attest = null, verifyListener = null, capturedAt = new Date().toISOString(), serial = null, record = null, evidenceFile = null }) {
  const pkg = `${appId}.sense`, c = key => captures[key] ?? "";
  const uid = packageUid(c("dumpsys.listenerPackage"));
  const device = { fingerprint: trim(c("prop.fingerprint")), product: trim(c("prop.device")), hardware: trim(c("prop.hardware")), buildType: trim(c("prop.buildType")),
    verifiedBootState: trim(c("prop.verifiedBoot")), virtual: trim(c("prop.qemu")) === "1" || /^(cutf|ranchu|goldfish|vsoc)/.test(trim(c("prop.hardware"))) || /^vsoc|^cf_/.test(trim(c("prop.device"))) };
  const physicalPixel10a = !device.virtual && device.product === PIXEL_10A_DEVICE;
  const classProblem = evidenceClass === "device" && !physicalPixel10a ? `--class device needs a physical Pixel 10a (ro.product.device ${PIXEL_10A_DEVICE}); this is ${device.product || "unknown"}${device.virtual ? " (virtual)" : ""}` : null;
  const audio = audioFacts(c("dumpsys.audio"), { pkg, uid });
  const appops = appopsFacts(c("dumpsys.appops"));
  const notifications = listenerNotifications(c("dumpsys.notification"), pkg);
  const logcat = logcatFacts(c("logcat"), { pkg, appId, uid });
  const services = /\.ListeningService\b/.test(c("dumpsys.services"));
  const roles = Object.fromEntries(INDICATOR_EXEMPT_ROLES.map(role => [role, trim(c(roleKey(role)))]));
  const facts = { uid, listeningServiceRunning: services, audio, appops, notifications, logcat: { assistLaunches: logcat.assistLaunches, listenerCrashes: logcat.listenerCrashes, senseWarnings: logcat.senseWarnings },
    currentUser: trim(c("user.current")), lockScreenNotifications: trim(c("settings.lockScreenNotifications")), lockScreenSilentNotifications: trim(c("settings.lockScreenSilent")), alwaysOnDisplay: trim(c("settings.aod")) };
  const result = {};
  const gateClass = gate => gate === "G2" ? ["image", "device"] : ["device"];

  if (gates.includes("G2")) {
    let verified = null, error = null;
    try { verified = verifyListener ? verifyListener(user, appId) : null; }
    catch (failure) { error = failure.message; }
    result.G2 = { checks: [
      check("G2.verifyAospListener", verified !== null && !error, error ?? (verified ? "scripts/verify-aosp-listener.mjs checks passed" : "verifier not run")),
      check("G2.hotwordAttributionProperty", trim(c("prop.hotwordRequired")) === "true", `ro.hotword.detection_service_required=${trim(c("prop.hotwordRequired")) || "unset"}`),
      check("G2.micIconsNotDisabled", !/^false$/i.test(trim(c("deviceConfig.micIcons"))), `privacy/camera_mic_icons_enabled=${trim(c("deviceConfig.micIcons")) || "default"}`),
      check("G2.indicatorExemptRolesEmpty", Object.values(roles).every(v => !v), Object.entries(roles).filter(([, v]) => v).map(([r, v]) => `${r}=${v}`).join(", ") || "all six empty"),
      check("G2.verifiedBoot", ["green", "yellow"].includes(device.verifiedBootState), `ro.boot.verifiedbootstate=${device.verifiedBootState || "unset"}`),
    ], facts: verified,
    // G1 (image build) is not captured here, but whether the booted image enforces the privapp
    // allowlist is observable: unset means DISABLE at the pinned frameworks/base (RoSystemProperties).
    g1Observation: { privappPermissions: trim(c("prop.privappPermissions")) || null, enforced: /^enforce$/i.test(trim(c("prop.privappPermissions"))) } };
  }
  if (gates.includes("G3")) result.G3 = { checks: [
    check("G3.listenerRecordingObserved", audio.listenerRecording && !audio.silenced, audio.listenerRecording ? `listener UID ${uid} recording${audio.silenced ? " (silenced)" : ""}` : "no listener recording configuration (set up the LISTENING state before capturing)"),
    check("G3.hotwordSource", audio.hotwordSource, "listener capture uses AUDIO_SOURCE_HOTWORD"),
    check("G3.appopsRecordAudioRunning", appops.recordAudioRunning, "RECORD_AUDIO op running for the listener (attribution under detection_service_required)"),
    check("G3.listenerNotificationPosted", notifications.some(t => /listening-indicator/.test(t)), `${notifications.length} listener notification line(s); channel listening-indicator expected`),
    check("G3.lockScreenNotificationsOn", facts.lockScreenNotifications !== "0", `lock_screen_show_notifications=${facts.lockScreenNotifications || "default"}`),
    check("G3.noListenerCrash", logcat.listenerCrashes === 0, `${logcat.listenerCrashes} listener crash line(s) in logcat`),
  ] };
  if (gates.includes("G4")) {
    const activity = activityFacts(c("dumpsys.activities"));
    const longPress = trim(c("settings.powerLongPress")), chord = trim(c("settings.powerVolumeUpChord"));
    result.G4 = { checks: [
      check("G4.longPressPowerIsAssistant", longPress === "5" || longPress === "null" || longPress === "", `power_button_long_press=${longPress || "null"} (null means the overlay default config_longPressOnPowerBehavior=5; confirm by pressing)`),
      check("G4.powerVolumeUpIsPowerMenu", chord === "2" || chord === "null" || chord === "", `key_chord_power_volume_up=${chord || "null"} (2 = power menu)`),
      check("G4.assistantRoleIsAlpha", trim(c("role.assistant")).split(/\s+/).includes(appId), `ASSISTANT role holder: ${trim(c("role.assistant")) || "none"}`),
      check("G4.emergencyGestureNotDisabled", trim(c("settings.emergencyGesture")) !== "0", `emergency_gesture_enabled=${trim(c("settings.emergencyGesture")) || "default"}`),
      check("G4.cameraDoubleTapNotDisabled", trim(c("settings.cameraDoubleTapDisabled")) !== "1", `camera_double_tap_power_gesture_disabled=${trim(c("settings.cameraDoubleTapDisabled")) || "default"}`),
      check("G4.assistLaunchLogged", logcat.assistLaunches > 0, `${logcat.assistLaunches} AlphaAssistActivity launch line(s) in logcat (press-and-hold power before capturing)`),
    ], facts: { activity } };
  }
  if (gates.includes("G5")) result.G5 = { checks: [
    check("G5.snapshotCaptured", Boolean(c("dumpsys.audio")), `audio mode ${audio.mode ?? "unknown"}, current user ${facts.currentUser || "unknown"}, listener recording ${audio.listenerRecording}`),
  ], facts: { users: userFacts(c("pm.users")) } };
  if (gates.includes("G6")) {
    const all = samples.length ? samples : [{ at: capturedAt, battery: batteryFacts(c("dumpsys.battery")), thermal: thermalFacts(c("dumpsys.thermal")), power: powerFacts(c("dumpsys.power")), listenerRecording: audio.listenerRecording }];
    const first = all[0], last = all[all.length - 1];
    const hours = (Date.parse(last.at) - Date.parse(first.at)) / 3_600_000;
    const drop = first.battery.level - last.battery.level;
    const plugged = all.some(s => s.battery.acPowered || s.battery.usbPowered || s.battery.wirelessPowered);
    const worst = all.reduce((a, s) => Math.max(a, s.thermal.status ?? 0), 0);
    result.G6 = { checks: [
      check("G6.unpluggedThroughout", !plugged, plugged ? "charging during the run (use wireless debugging or capture before/after unplugged)" : "on battery for every sample"),
      check("G6.listeningThroughout", all.every(s => s.listenerRecording), `${all.filter(s => s.listenerRecording).length}/${all.length} samples with the listener recording`),
      check("G6.thermalBelowSevere", worst < 3, `worst thermal status ${worst} (3 = SEVERE)`),
      check("G6.twentyFourHourSpan", hours >= 24, `run span ${hours.toFixed(2)} h over ${all.length} sample(s)`),
    ], facts: { samples: all.length, spanHours: Number(hours.toFixed(3)), batteryDropPercent: drop, drainPercentPerHour: hours > 0 ? Number((drop / hours).toFixed(3)) : null, worstThermalStatus: worst,
      maxSkinC: all.reduce((a, s) => Math.max(a, s.thermal.maxSkinC ?? -Infinity), -Infinity), batterystats: lines(c("dumpsys.batterystats")).filter(t => /Estimated power use|Uid u0a|cpu:|wake|audio/i.test(t)).map(t => t.trim()).slice(0, 60), series: all } };
  }

  // Manual items and the operator's attestation; a gate is earned only with every check and item passing.
  const attested = attest?.items ?? {};
  const reviewer = typeof attest?.reviewer === "string" && attest.reviewer.trim() ? attest.reviewer.trim() : null;
  for (const gate of Object.keys(result)) {
    result[gate].manual = MANUAL_ITEMS[gate].map(id => ({ id, result: attested[id]?.result ?? "not attested", note: attested[id]?.note ?? null, media: attested[id]?.media ?? null }));
    const classOk = gateClass(gate).includes(evidenceClass) && !classProblem;
    const automated = result[gate].checks.every(entry => entry.ok);
    const manual = result[gate].manual.every(item => item.result === "pass");
    result[gate].classAllowed = classOk;
    result[gate].earned = classOk && automated && manual && reviewer !== null;
    result[gate].status = result[gate].earned ? "passed" : "open";
  }
  return {
    schema: SCHEMA, capturedAt, label, evidenceClass, classProblem, user, serialSha256: serial ? createHash("sha256").update(serial).digest("hex") : null,
    reviewer, operator: attest?.operator ?? null, device: { ...device, physicalPixel10a }, packageName: pkg, gates: result,
    facts: { ...facts, logcatLines: logcat.lines, audioLines: audio.lines, appopsLines: appops.lines },
    candidateRecord: record ? candidateRecord(record, result, { evidenceClass, classProblem, label, evidenceFile }) : null,
    note: "Read-only capture. Not image-build (G1), SystemUI compilation or release evidence. A named reviewer copies earned gates into android/sense/qualified-listener.json; qualified/distributable are never set here.",
  };
}

/** The committed record with this run's earned gates applied (never downgrades, never qualifies). */
export function candidateRecord(record, gates, { evidenceClass, classProblem, label, evidenceFile = null }) {
  const next = structuredClone(record);
  for (const [gate, value] of Object.entries(gates)) if (value.earned) next.gates[gate] = "passed";
  if (gates.G2?.earned) next.evidence.aospImage = { recorded: true, class: "aosp-image-boot", record: evidenceFile, note: `G2 captured on a booted image (${label ?? "unlabelled"})` };
  const deviceGates = ["G3", "G4", "G5", "G6"];
  if (evidenceClass === "device" && !classProblem && deviceGates.every(gate => next.gates[gate] === "passed"))
    next.evidence.deviceAcceptance = { recorded: true, class: "device-acceptance", record: evidenceFile, note: "G3-G6 earned on a physical Pixel 10a; reviewer to confirm before committing" };
  next.qualified = record.qualified;
  next.distributable = record.distributable;
  return { record: next, problems: listenerRecordProblems(next) };
}

function parseArgs(argv) {
  const opts = { gates: CAPTURE_GATES, user: "0", logcatLines: 4000, samples: 1, intervalMin: 30 };
  const value = (i, name) => { const v = argv[i + 1]; if (!v || v.startsWith("--")) throw Error(`${name} needs a value`); return v; };
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
  if (opts.gates.some(g => !CAPTURE_GATES.includes(g))) throw Error(`--gates takes ${CAPTURE_GATES.join(",")} (G1 is the image build, G7 is optional hardening)`);
  if (!/^(0|[1-9]\d*)$/.test(opts.user)) throw Error("--user must be an Android user id");
  if (!Number.isInteger(opts.samples) || opts.samples < 1 || !(opts.intervalMin > 0)) throw Error("--samples must be a positive integer and --interval-min positive");
  if (opts.samples > 1 && !opts.gates.includes("G6")) throw Error("--samples is for the G6 power run");
  if (!opts.dryRun) {
    if (!["image", "device"].includes(opts.evidenceClass)) throw Error("--class image|device is required");
    if (!opts.out) throw Error("--out NEW_FILE is required");
    if (fs.existsSync(opts.out)) throw Error(`${opts.out} exists; evidence files are never overwritten`);
    if (path.resolve(opts.out) === path.join(ROOT, LISTENER_RECORD)) throw Error("Never write the committed listener record; a reviewer copies earned fields");
    if (!opts.fixtures && (!opts.serial || !/^[A-Za-z0-9_.:-]+$/.test(opts.serial))) throw Error("Explicit --serial required (the device the operator chose)");
  }
  return opts;
}

async function main(argv) {
  const opts = parseArgs(argv);
  const { appId } = JSON.parse(fs.readFileSync(path.join(ROOT, "app.config.json"), "utf8"));
  const plan = commandPlan({ appId, user: opts.user, gates: opts.gates, logcatLines: opts.logcatLines });
  if (opts.dryRun) {
    const serial = opts.serial ?? "SERIAL";
    console.log(`Read-only commands for gates ${opts.gates.join(",")} (nothing is sent in --dry-run):`);
    for (const [key, args] of Object.entries(plan)) console.log(`  ${key.padEnd(34)} adb -s ${serial} ${args.join(" ")}`);
    if (opts.gates.includes("G6")) console.log(`  G6 power run: battery, thermal, power and audio repeat ${opts.samples} time(s) every ${opts.intervalMin} min`);
    console.log(`Manual items to attest (--attest FILE): ${opts.gates.flatMap(g => MANUAL_ITEMS[g]).join(", ")}`);
    return;
  }
  const record = JSON.parse(fs.readFileSync(path.join(ROOT, LISTENER_RECORD), "utf8"));
  const attest = opts.attest ? JSON.parse(fs.readFileSync(opts.attest, "utf8")) : null;
  let captures, samples = [], verifyListener = null, upstream = null;
  try { ({ verifyAospListener: upstream } = await import("../aosp-listener.mjs")); }
  catch (error) { console.error(`G2 verifier unavailable (needs vendor/eliza at the pin): ${error.message.split("\n")[0]}`); }
  if (opts.fixtures) {
    const fixture = JSON.parse(fs.readFileSync(opts.fixtures, "utf8"));
    captures = fixture.captures; samples = fixture.samples ?? [];
    if (upstream) verifyListener = (user, id) => upstream(fixtureRunner(plan, captures), user, id);
  } else {
    const { execFileSync } = await import("node:child_process");
    const { androidEnv } = await import("../toolchain.mjs");
    const env = androidEnv(), adb = path.join(env.ANDROID_HOME, "platform-tools/adb");
    const run = (...argv) => { assertReadOnly(argv); try { return execFileSync(adb, ["-s", opts.serial, ...argv], { encoding: "utf8", env, timeout: 30_000, maxBuffer: 64 << 20 }); } catch (error) { return `__error__ ${error.message.split("\n")[0]}`; } };
    captures = Object.fromEntries(Object.entries(plan).map(([key, args]) => [key, run(...args)]));
    if (upstream) verifyListener = (user, id) => upstream((...argv) => { assertReadOnly(argv); return execFileSync(adb, ["-s", opts.serial, ...argv], { encoding: "utf8", env, timeout: 30_000, maxBuffer: 64 << 20 }); }, user, id);
    if (opts.gates.includes("G6")) {
      const pkg = `${appId}.sense`, uid = packageUid(captures["dumpsys.listenerPackage"]);
      const sampleOnce = () => ({ at: new Date().toISOString(), battery: batteryFacts(run(...plan["dumpsys.battery"])), thermal: thermalFacts(run(...plan["dumpsys.thermal"])),
        power: powerFacts(run(...plan["dumpsys.power"])), listenerRecording: audioFacts(run(...plan["dumpsys.audio"]), { pkg, uid }).listenerRecording });
      samples.push(sampleOnce());
      for (let n = 1; n < opts.samples; n++) {
        await new Promise(resolve => setTimeout(resolve, opts.intervalMin * 60_000));
        samples.push(sampleOnce());
        console.error(`G6 sample ${n + 1}/${opts.samples} at ${samples.at(-1).at}: battery ${samples.at(-1).battery.level}%, thermal ${samples.at(-1).thermal.status}`);
      }
    }
  }
  const out = path.resolve(opts.out);
  const evidence = buildEvidence({ captures, samples, appId, user: opts.user, gates: opts.gates, evidenceClass: opts.evidenceClass, label: opts.label ?? null, attest, verifyListener, serial: opts.serial ?? null, record, evidenceFile: path.relative(ROOT, out) });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
  console.log(`Wrote ${opts.out} (${evidence.evidenceClass}${evidence.classProblem ? `; ${evidence.classProblem}` : ""})`);
  for (const [gate, value] of Object.entries(evidence.gates))
    console.log(`  ${gate} ${value.status.padEnd(6)} automated ${value.checks.filter(x => x.ok).length}/${value.checks.length}, manual ${value.manual.filter(x => x.result === "pass").length}/${value.manual.length}${value.classAllowed ? "" : " (evidence class cannot earn this gate)"}`);
  if (evidence.candidateRecord.problems.length) console.log(`  candidate record problems: ${evidence.candidateRecord.problems.join("; ")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 2; });
