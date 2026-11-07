import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const hex64 = /^[a-f0-9]{64}$/;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function syncDirectory(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try { fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

function exclusiveJson(file, value) {
  const bytes = Buffer.from(JSON.stringify(value) + "\n");
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  syncDirectory(path.dirname(file));
  return sha256(bytes);
}

function paths(directory, deviceId) {
  if (!hex64.test(deviceId)) throw new Error("Invalid pilot device identity");
  const prefix = path.join(directory, deviceId);
  return { lock: prefix + ".lock", intent: prefix + ".intent.json", result: prefix + ".result.json" };
}

function read(file) {
  let bytes;
  try {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0 || stat.size > 16_384)
        throw new Error("Pilot rotation journal is not a private regular record");
      bytes = fs.readFileSync(fd);
    } finally { fs.closeSync(fd); }
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  return { value: JSON.parse(bytes), sha256: sha256(bytes) };
}

/** This read path never releases a lock or authorizes replay. */
export function inspectPilotRotation(directory, deviceId) {
  const files = paths(directory, deviceId);
  const intent = read(files.intent);
  const result = read(files.result);
  if (!intent && !result) return { state: "none" };
  if (!intent || intent.value.schema !== 1 || intent.value.deviceSerialSha256 !== deviceId)
    throw new Error("Pilot rotation journal identity is invalid");
  if (!result) return { state: "unknown", intent: intent.value, intentSha256: intent.sha256 };
  if (result.value.schema !== 1 || result.value.intentSha256 !== intent.sha256 ||
      result.value.state !== "verified-applied" ||
      result.value.replacementApkSha256 !== intent.value.replacementApkSha256)
    throw new Error("Pilot rotation terminal result does not match its intent");
  return { state: "verified-applied", intent: intent.value, intentSha256: intent.sha256 };
}

/** Hold the same device lock across every pilot install, regardless of alias or worktree. */
export function claimPilotInstall(directory, deviceId) {
  const files = paths(directory, deviceId);
  const created = fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const owner = fs.lstatSync(directory);
  if (!owner.isDirectory() || owner.uid !== process.getuid() || (owner.mode & 0o077) !== 0)
    throw new Error("Pilot rotation journal directory must be owner-only");
  if (created) {
    const firstParent = path.dirname(created);
    for (let parent = path.dirname(directory); ; parent = path.dirname(parent)) {
      syncDirectory(parent);
      if (parent === firstParent) break;
    }
  }
  try { fs.mkdirSync(files.lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error("Pilot install lock is held. Reconcile the device before another install.");
    throw error;
  }
  syncDirectory(directory);
  return () => {
    fs.rmdirSync(files.lock);
    syncDirectory(directory);
  };
}

/** Call while holding the device lock. A successfully created intent consumes the attempt. */
export function beginPilotRotation(directory, deviceId, intent) {
  if (inspectPilotRotation(directory, deviceId).state !== "none")
    throw new Error("A pilot rotation intent already exists. Reconcile the recorded attempt; do not dispatch again.");
  return exclusiveJson(paths(directory, deviceId).intent, { ...intent, schema: 1, deviceSerialSha256: deviceId });
}

export function completePilotRotation(directory, deviceId, intentSha256, replacementApkSha256) {
  const current = inspectPilotRotation(directory, deviceId);
  if (current.state !== "unknown" || current.intentSha256 !== intentSha256 ||
      current.intent.replacementApkSha256 !== replacementApkSha256)
    throw new Error("Pilot rotation completion does not match the pending intent");
  exclusiveJson(paths(directory, deviceId).result,
    { schema: 1, state: "verified-applied", intentSha256, replacementApkSha256 });
}

/** Classify observed package identity without changing journal state or allowing a retry. */
export function observePilotRotation(journal, { device, installed, apkSha256 }) {
  const intent = journal.intent;
  const sameDevice = device.serialSha256 === intent.deviceSerialSha256 &&
    device.sdk === intent.deviceApi && device.buildFingerprintSha256 === intent.deviceBuildFingerprintSha256;
  const sameInstall = installed.userId === intent.userId && installed.firstInstallTime === intent.firstInstallTime;
  const replacementObserved = sameDevice && sameInstall && apkSha256 === intent.replacementApkSha256 &&
    installed.versionCode === intent.replacementVersionCode;
  const previousObserved = sameDevice && sameInstall && apkSha256 === intent.installedApkSha256 &&
    installed.versionCode === intent.installedVersionCode;
  return {
    state: journal.state,
    observation: replacementObserved ? "replacement-observed" : previousObserved ? "previous-observed" : "unmatched",
    replayAllowed: false,
  };
}
