import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const verifier = fileURLToPath(new URL("./VerifyApkRotation.java", import.meta.url));
const sha256 = (value: any) => createHash("sha256").update(value).digest("hex");
const digest = /^[0-9a-f]{64}$/;

/** Scope comes from the committed release-signer descriptor, never from CLI pins. */
export function pilotRotationRecord(descriptor: any, apk: any) {
  const record = descriptor?.pilotRotation;
  if (apk.build !== "release" || record?.schema !== 1 ||
      !["launcher", "standalone"].includes(record.variant) || record.variant !== apk.variant ||
      !Number.isSafeInteger(record.deviceApi) || record.deviceApi < 29 || record.deviceApi > 37 ||
      [record.deviceSerialSha256, record.deviceBuildFingerprintSha256, record.previousSignerSha256, record.installedApkSha256,
        record.replacementApkSha256, record.lineageSha256, record.verifierJarSha256,
        descriptor.signerSha256].some((value: any) => typeof value !== "string" || !digest.test(value)) ||
      record.previousSignerSha256 === descriptor.signerSha256 ||
      record.replacementApkSha256 !== apk.sha256 || apk.signerSha256 !== descriptor.signerSha256) {
    throw new Error("No matching reviewed pilot APK rotation record in android/release-signer.json");
  }
  return record;
}

export function verifyPilotRotation({
  descriptor, apk, device, before, installedFile, replacementFile, lineageFile,
  packageName, javaHome, apksigner,
}: any) {
  const record = pilotRotationRecord(descriptor, apk);
  if (record.deviceSerialSha256 !== device.serialSha256 || record.deviceApi !== device.sdk ||
      record.deviceBuildFingerprintSha256 !== device.buildFingerprintSha256)
    throw new Error("This device is outside the reviewed APK rotation scope");
  const jar = path.join(path.dirname(apksigner), "lib", "apksigner.jar");
  if (sha256(fs.readFileSync(jar)) !== record.verifierJarSha256)
    throw new Error("APK rotation verifier JAR differs from the reviewed digest");
  const result = JSON.parse(execFileSync(path.join(javaHome, "bin", "java"), [
    "-cp", jar, verifier, installedFile, replacementFile, lineageFile,
    record.installedApkSha256, record.replacementApkSha256, record.lineageSha256,
    record.previousSignerSha256, descriptor.signerSha256, packageName, String(device.sdk),
  ], { encoding: "utf8", timeout: 120_000 }));
  if (result.verified !== true || result.api !== device.sdk ||
      result.installedVersionCode !== before.versionCode || result.replacementVersionCode !== apk.versionCode)
    throw new Error("Verified APK rotation versions differ from the admitted update");
  return record.lineageSha256;
}
