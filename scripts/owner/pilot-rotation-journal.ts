import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { errorCode, isRecord } from "./input.ts";

const hex64 = /^[a-f0-9]{64}$/;
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function syncDirectory(directory: string) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try { fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

function exclusiveJson(file: string, value: object) {
  const bytes = Buffer.from(JSON.stringify(value) + "\n");
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  syncDirectory(path.dirname(file));
  return sha256(bytes);
}

function paths(directory: string, deviceId: string) {
  if (!hex64.test(deviceId)) throw new Error("Invalid pilot device identity");
  const prefix = path.join(directory, deviceId);
  return { lock: prefix + ".lock", intent: prefix + ".intent.json", result: prefix + ".result.json" };
}

function read(file: string) {
  let bytes;
  try {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > 16_384)
        throw new Error("Pilot rotation journal is not a private regular record");
      bytes = fs.readFileSync(fd);
    } finally { fs.closeSync(fd); }
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  return { value, sha256: sha256(bytes) };
}

interface PendingRotation {
  state: "unknown" | "verified-applied";
  intent: Record<string, unknown>;
  intentSha256: string;
}

/** This read path never releases a lock or authorizes replay. */
export function inspectPilotRotation(directory: string, deviceId: string): { state: "none" } | PendingRotation {
  const files = paths(directory, deviceId);
  const intent = read(files.intent);
  const result = read(files.result);
  if (!intent && !result) return { state: "none" };
  if (!intent || !isRecord(intent.value) || intent.value.schema !== 1 || intent.value.deviceSerialSha256 !== deviceId)
    throw new Error("Pilot rotation journal identity is invalid");
  if (!result) return { state: "unknown", intent: intent.value, intentSha256: intent.sha256 };
  if (!isRecord(result.value) || result.value.schema !== 1 || result.value.intentSha256 !== intent.sha256 ||
      result.value.state !== "verified-applied" ||
      result.value.replacementApkSha256 !== intent.value.replacementApkSha256)
    throw new Error("Pilot rotation terminal result does not match its intent");
  return { state: "verified-applied", intent: intent.value, intentSha256: intent.sha256 };
}

/** Hold the same device lock across every pilot install, regardless of alias or worktree. */
export function claimPilotInstall(directory: string, deviceId: string, durableAnchor: string) {
  directory = path.resolve(directory);
  const anchor = path.resolve(durableAnchor);
  const relative = path.relative(anchor, directory);
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
    throw new Error("Pilot journal must be inside its durable anchor");
  const files = paths(directory, deviceId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const owner = fs.lstatSync(directory);
  if (!owner.isDirectory() || owner.uid !== process.getuid?.() || (owner.mode & 0o077) !== 0)
    throw new Error("Pilot rotation journal directory must be owner-only");
  // Another process may have just created an ancestor and not synced it yet.
  for (let parent = path.dirname(directory); ; parent = path.dirname(parent)) {
    syncDirectory(parent);
    if (parent === anchor) break;
  }
  try { fs.mkdirSync(files.lock, { mode: 0o700 }); }
  catch (error) {
    if (errorCode(error) === "EEXIST") throw new Error("Pilot install lock is held. Reconcile the device before another install.");
    throw error;
  }
  syncDirectory(directory);
  return () => {
    fs.rmdirSync(files.lock);
    syncDirectory(directory);
  };
}

/** Call while holding the device lock. A successfully created intent consumes the attempt. */
export function beginPilotRotation(directory: string, deviceId: string, intent: { replacementApkSha256: string } & Record<string, unknown>) {
  if (inspectPilotRotation(directory, deviceId).state !== "none")
    throw new Error("A pilot rotation intent already exists. Reconcile the recorded attempt; do not dispatch again.");
  return exclusiveJson(paths(directory, deviceId).intent, { ...intent, schema: 1, deviceSerialSha256: deviceId });
}

export function completePilotRotation(directory: string, deviceId: string, intentSha256: string, replacementApkSha256: string) {
  const current = inspectPilotRotation(directory, deviceId);
  if (current.state !== "unknown" || current.intentSha256 !== intentSha256 ||
      current.intent.replacementApkSha256 !== replacementApkSha256)
    throw new Error("Pilot rotation completion does not match the pending intent");
  exclusiveJson(paths(directory, deviceId).result,
    { schema: 1, state: "verified-applied", intentSha256, replacementApkSha256 });
}

/** Classify observed package identity without changing journal state or allowing a retry. */
export function observePilotRotation(journal: PendingRotation, { device, installed, apkSha256 }: {
  device: { serialSha256: string; sdk: number | null; buildFingerprintSha256: string };
  installed: { userId: string | null; firstInstallTime: string | null; versionCode: number | null };
  apkSha256: string | null;
}) {
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
