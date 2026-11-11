import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord, isSafeInteger } from "./input.ts";

const verifier = fileURLToPath(new URL("./VerifyApkRotation.java", import.meta.url));
const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const digest = /^[0-9a-f]{64}$/;

const RECORD_DIGESTS = [
  "deviceSerialSha256", "deviceBuildFingerprintSha256", "previousSignerSha256", "installedApkSha256",
  "replacementApkSha256", "lineageSha256", "verifierJarSha256",
] as const;

function hasDigests<K extends string>(record: Record<string, unknown>, fields: readonly K[]): record is Record<K, string> {
  return fields.every(field => typeof record[field] === "string" && digest.test(record[field]));
}

interface PilotApk {
  build: string;
  variant: string;
  sha256: string;
  signerSha256: string | null;
  versionCode?: number | null;
}

/** Scope comes from the committed release-signer descriptor, never from CLI pins. */
export function pilotRotationRecord(descriptor: unknown, apk: PilotApk) {
  const record = isRecord(descriptor) ? descriptor.pilotRotation : undefined;
  const signer = isRecord(descriptor) ? descriptor.signerSha256 : undefined;
  const deviceApi = isRecord(record) ? record.deviceApi : undefined;
  if (apk.build !== "release" || !isRecord(record) || record.schema !== 1 ||
      (record.variant !== "launcher" && record.variant !== "standalone") || record.variant !== apk.variant ||
      !isSafeInteger(deviceApi) || deviceApi < 29 || deviceApi > 37 ||
      typeof signer !== "string" || !digest.test(signer) || !hasDigests(record, RECORD_DIGESTS) ||
      (record.preserveSignaturePermissions !== undefined && typeof record.preserveSignaturePermissions !== "boolean") ||
      record.previousSignerSha256 === signer ||
      record.replacementApkSha256 !== apk.sha256 || apk.signerSha256 !== signer) {
    throw new Error("No matching reviewed pilot APK rotation record in android/release-signer.json");
  }
  return { ...record, deviceApi };
}

export function verifyPilotRotation({
  descriptor, apk, device, before, installedFile, replacementFile, lineageFile,
  packageName, javaHome, apksigner,
}: {
  descriptor: { signerSha256: string };
  apk: PilotApk;
  device: { serialSha256: string; sdk: number | null; buildFingerprintSha256: string };
  before: { versionCode: number | null };
  installedFile: string;
  replacementFile: string;
  lineageFile: string;
  packageName: string;
  javaHome: string;
  apksigner: string;
}) {
  const record = pilotRotationRecord(descriptor, apk);
  if (record.deviceSerialSha256 !== device.serialSha256 || record.deviceApi !== device.sdk ||
      record.deviceBuildFingerprintSha256 !== device.buildFingerprintSha256)
    throw new Error("This device is outside the reviewed APK rotation scope");
  const jar = path.join(path.dirname(apksigner), "lib", "apksigner.jar");
  if (sha256(fs.readFileSync(jar)) !== record.verifierJarSha256)
    throw new Error("APK rotation verifier JAR differs from the reviewed digest");
  const result: unknown = JSON.parse(execFileSync(path.join(javaHome, "bin", "java"), [
    "-cp", jar, verifier, installedFile, replacementFile, lineageFile,
    record.installedApkSha256, record.replacementApkSha256, record.lineageSha256,
    record.previousSignerSha256, descriptor.signerSha256, packageName, String(device.sdk),
    ...(record.preserveSignaturePermissions ? ["--preserve-signature-permissions"] : []),
  ], { encoding: "utf8", timeout: 120_000 }));
  if (!isRecord(result) || result.verified !== true || result.api !== device.sdk ||
      result.installedVersionCode !== before.versionCode || result.replacementVersionCode !== apk.versionCode)
    throw new Error("Verified APK rotation versions differ from the admitted update");
  return record.lineageSha256;
}
