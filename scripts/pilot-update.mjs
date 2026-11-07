#!/usr/bin/env node
/**
 * Update a provisioned pilot unit in place with a higher-versionCode signed APK.
 *
 *   node scripts/pilot-update.mjs --serial <adb serial> --alias <unit-name> \
 *     --apk-manifest <new build>/apk-manifest.json [--variant launcher|standalone] \
 *     [--build release|debug] [--units test-results/pilot-units]
 *
 * Generalizes scripts/test-installed-upgrade.mjs from one domain to the whole app:
 *  1. admit the new APK (as provision-unit.mjs does) and the unit's provisioning record;
 *  2. require the installed signer to equal the new APK's signer (the pulled installed
 *     APK is digested with apksigner) and the new versionCode to be greater;
 *  3. stop the app and read back every app-data domain (files, no_backup, databases,
 *     shared_prefs, app_webview, ...) as per-file SHA-256 inventories;
 *  4. `adb install -r` (data kept), then read back again without launching the app:
 *     the package uid and first-install time must be unchanged and every domain
 *     byte-identical. The app is not started in between, so nothing may change.
 * Readback uses run-as, which Android allows only for debuggable builds. A release unit
 * is read through the in-app integrity export instead (release/DataIntegrityProvider,
 * `content query` as adb's shell, which holds the DUMP permission it requires): every file
 * as an HMAC-SHA-256 of its path and bytes under one random nonce per update, so before and
 * after compare file by file without any name or content leaving the device. An installed
 * build without the export gets the package-identity readback only and the record says so.
 *
 * An explicit --rotation-lineage <public proof file> admits only the exact migration
 * recorded in android/release-signer.json, including unit, APK pair and verifier pins.
 * The ordinary update path still requires the same active signer. An ambiguous install
 * is held for read-only reconciliation with --reconcile-rotation --serial <adb serial>.
 *
 * Rollback is not offered: a lower versionCode cannot replace an install without
 * erasing data, and the rollback design (A-06) is still blocked.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signerDigest } from "./apk.mjs";
import { readReleaseSigner } from "./build-android.mjs";
import { pilotRotationRecord, verifyPilotRotation } from "./owner/pilot-rotation.mjs";
import { androidEnv, tool } from "./toolchain.mjs";
import { beginPilotRotation, claimPilotInstall, completePilotRotation, inspectPilotRotation, observePilotRotation } from "./owner/pilot-rotation-journal.mjs";
import { adbFor, admitUnitApk, deviceFacts, installedApkSha256, PACKAGE, packageFacts, parseUnitArgs, requireConsistentApk } from "./provision-unit.mjs";
import { apkUpdateAdmission, compareDomains, DOMAIN_SCRIPT, inPlaceUpdateFailures, integrityQuery as sharedIntegrityQuery, parseDomainInventory, parseIntegrityExport, readbackInventory } from "../vendor/eliza/packages/os/scripts/android/apk-release-record.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

// The comparison, inventory and export parsers are shared with every product
// (vendor/eliza/packages/os/scripts/android/apk-release-record.mjs); Alpha binds its package.
export { compareDomains, DOMAIN_SCRIPT, parseDomainInventory, parseIntegrityExport, readbackInventory };
export const updateAdmission = apkUpdateAdmission;

/** Both variants share one package id, so an update never switches the unit's variant or build type. */
export function unitApkMismatch(unit, apk) {
  if (unit?.apk?.variant === apk.variant && unit?.apk?.build === apk.build) return null;
  return `provisioned with the ${unit?.apk?.variant ?? "unknown"} ${unit?.apk?.build ?? "unknown"} APK, not ${apk.variant} ${apk.build}; pass the same --variant and --build`;
}

export const INTEGRITY_AUTHORITY = `${PACKAGE}.integrity`;
/** The export query for one nonce; the URI is single-quoted for the device shell ("?" must not glob). */
export const integrityQuery = nonce => sharedIntegrityQuery(INTEGRITY_AUTHORITY, nonce);

function readExport(adb, nonce) {
  return parseIntegrityExport(adb(integrityQuery(nonce), { allowFailure: true, withStderr: true }));
}

function readDomains(adb) {
  return readbackInventory(adb(["shell", "run-as", PACKAGE, "sh", "-c", `'${DOMAIN_SCRIPT}'`], { allowFailure: true, withStderr: true }));
}

const rotationJournal = path.join(os.homedir(), ".local", "state", "alphaphone-pilot-rotation");

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--reconcile-rotation") {
    const [, flag, serial] = argv;
    if (argv.length !== 3 || flag !== "--serial" || !/^[A-Za-z0-9._:-]{1,64}$/.test(serial ?? ""))
      throw new Error("Use --reconcile-rotation --serial <adb serial>");
    const adb = adbFor(serial);
    const device = deviceFacts(adb, serial);
    const journal = inspectPilotRotation(rotationJournal, device.serialSha256);
    if (journal.state === "none") {
      console.log(JSON.stringify({ state: "none" }));
      return;
    }
    const installed = packageFacts(adb(["shell", "dumpsys", "package", PACKAGE]));
    console.log(JSON.stringify(observePilotRotation(journal, {
      device, installed, apkSha256: installedApkSha256(adb),
    })));
    return;
  }
  const unitsIndex = argv.findIndex(arg => arg === "--units" || arg.startsWith("--units="));
  let units = "test-results/pilot-units";
  if (unitsIndex >= 0) { units = argv[unitsIndex].includes("=") ? argv[unitsIndex].split("=")[1] : argv[unitsIndex + 1]; argv.splice(unitsIndex, argv[unitsIndex].includes("=") ? 1 : 2); }
  const rotationIndex = argv.indexOf("--rotation-lineage");
  let lineageFile;
  if (rotationIndex >= 0) {
    const requested = argv[rotationIndex + 1];
    if (!requested || requested.startsWith("--")) throw new Error("--rotation-lineage needs a public proof file");
    lineageFile = path.resolve(requested);
    argv.splice(rotationIndex, 2);
  }
  const options = parseUnitArgs(argv);
  const recordFile = path.resolve(units, `${options.alias}.json`);
  if (!fs.existsSync(recordFile)) throw new Error(`${recordFile} is missing; provision the unit with scripts/provision-unit.mjs first`);
  const unit = JSON.parse(fs.readFileSync(recordFile, "utf8"));
  const descriptor = readReleaseSigner();
  const apk = admitUnitApk(options.apkManifest, options, { descriptor });
  const rotation = lineageFile && pilotRotationRecord(descriptor, apk);
  if (rotation) {
    const committed = execFileSync("git", ["--no-replace-objects", "show", "HEAD:android/release-signer.json"]);
    if (!committed.equals(fs.readFileSync("android/release-signer.json")))
      throw new Error("The pilot rotation record must match the reviewed committed descriptor");
  }
  const mismatch = unitApkMismatch(unit, apk);
  if (mismatch) throw new Error(`Unit ${options.alias}: ${mismatch}`);
  const adb = adbFor(options.serial);
  const device = deviceFacts(adb, options.serial);
  if (!Number.isSafeInteger(device.sdk) || device.sdk < 1) throw new Error("Device Android API level is unavailable");
  requireConsistentApk(apk, {apiLevel: device.sdk});
  if (device.serialSha256 !== unit.device?.serialSha256) throw new Error(`Serial does not belong to unit ${options.alias}`);
  if (apk.rehearsal && !device.emulator) throw new Error("--build debug is an emulator rehearsal only");

  const releaseInstallLock = claimPilotInstall(rotationJournal, device.serialSha256);
  let pulled;
  try {
    const pendingRotation = inspectPilotRotation(rotationJournal, device.serialSha256);
    if (pendingRotation.state === "unknown")
      throw new Error("A pilot rotation outcome is unknown. Use --reconcile-rotation before any further install.");
    if (rotation && pendingRotation.state !== "none")
      throw new Error("The pilot rotation attempt is already consumed");
    const before = packageFacts(adb(["shell", "dumpsys", "package", PACKAGE]));
    pulled = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-installed-"));
    const installedFile = path.join(pulled, "installed.apk");
    const apkPath = /^package:(\/\S+\.apk)$/m.exec(adb(["shell", "pm", "path", PACKAGE]))?.[1];
    if (!apkPath) throw new Error("Alpha Phone is not installed on this unit");
    adb(["pull", apkPath, installedFile], { timeout: 600_000 });
    const installedSigner = signerDigest(installedFile, {apiLevel: device.sdk});
    const replacementFile = lineageFile ? path.join(pulled, "migration.apk") : apk.file;
    let rotationLineageSha256;
    if (lineageFile) {
      fs.copyFileSync(apk.file, replacementFile, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(replacementFile, 0o400);
      rotationLineageSha256 = verifyPilotRotation({
        descriptor, apk, device, before, installedFile, replacementFile, lineageFile,
        packageName: PACKAGE, javaHome: androidEnv().JAVA_HOME, apksigner: tool("apksigner"),
      });
    }
    const newSigner = signerDigest(replacementFile, {apiLevel: device.sdk});
    if (rotationLineageSha256) {
      if (newSigner !== descriptor.signerSha256) throw new Error("The verified migration signer changed");
    } else {
      const problems = updateAdmission({ installedVersionCode: before.versionCode, installedSigner, newVersionCode: apk.versionCode, newSigner });
      if (problems.length) throw new Error(`Update refused: ${problems.join("; ")}`);
    }

    adb(["shell", "am", "force-stop", PACKAGE]);
    // run-as on a debuggable rehearsal; the in-app integrity export on a release.
    const nonce = randomBytes(32).toString("hex");
    const runAs = readDomains(adb);
    const method = runAs ? "run-as" : "integrity-export";
    const domainsBefore = runAs ?? readExport(adb, nonce);
    let rotationIntentSha256;
    if (rotation) {
      if (!before.userId || !before.firstInstallTime ||
          !Object.values(domainsBefore ?? {}).some(files => Object.keys(files).length))
        throw new Error("Migration requires a pre-install package identity and nonempty data readback");
      const currentDevice = deviceFacts(adb, options.serial);
      const currentPackage = packageFacts(adb(["shell", "dumpsys", "package", PACKAGE]));
      if (currentDevice.serialSha256 !== device.serialSha256 || currentDevice.sdk !== device.sdk ||
          currentDevice.buildFingerprintSha256 !== device.buildFingerprintSha256 ||
          currentPackage.userId !== before.userId || currentPackage.firstInstallTime !== before.firstInstallTime ||
          currentPackage.versionCode !== before.versionCode ||
          installedApkSha256(adb) !== rotation.installedApkSha256 ||
          sha256(fs.readFileSync(replacementFile)) !== apk.sha256)
        throw new Error("The device, package identity or migration APK changed after verification");
      rotationIntentSha256 = beginPilotRotation(rotationJournal, device.serialSha256, {
        createdAt: new Date().toISOString(), deviceApi: device.sdk,
        deviceBuildFingerprintSha256: device.buildFingerprintSha256,
        installedApkSha256: rotation.installedApkSha256, replacementApkSha256: apk.sha256,
        installedVersionCode: before.versionCode, replacementVersionCode: apk.versionCode,
        userId: before.userId, firstInstallTime: before.firstInstallTime,
        variant: apk.variant, lineageSha256: rotationLineageSha256,
      });
    }
    adb(["install", "-r", replacementFile], { timeout: 600_000 });
    const after = packageFacts(adb(["shell", "dumpsys", "package", PACKAGE]));
    const installedSha256 = installedApkSha256(adb);
    const domainsAfter = !domainsBefore ? null : method === "run-as" ? readDomains(adb) : readExport(adb, nonce);
    const failures = inPlaceUpdateFailures({ apk, before, after, installedSha256, domainsBefore, domainsAfter });
    const update = {
      createdAt: new Date().toISOString(),
      signerApiLevel: device.sdk,
      ...(rotationLineageSha256 ? { rotationLineageSha256 } : {}),
      from: { versionCode: before.versionCode, versionName: before.versionName, signerSha256: installedSigner },
      to: { versionCode: apk.versionCode, versionName: apk.versionName, sha256: apk.sha256, signerSha256: newSigner, build: apk.build },
      packageIdentityPreserved: after.userId === before.userId && after.firstInstallTime === before.firstInstallTime,
      dataReadback: domainsBefore
        ? { method: method === "run-as" ? "run-as per-file SHA-256" : "in-app integrity export: per-file HMAC-SHA-256 of path and bytes under one per-update nonce",
          domains: Object.fromEntries(Object.entries(domainsBefore).map(([domain, files]) => [domain, Object.keys(files).length])) }
        : { method: "unavailable", reason: "run-as is refused for a non-debuggable release and the installed build has no integrity export; only package identity was read back" },
      failures,
      passed: failures.length === 0,
      rollback: "not offered (A-06 rollback design blocked)",
    };
    unit.updates = [...(unit.updates ?? []), update];
    fs.writeFileSync(recordFile, `${JSON.stringify(unit, null, 2)}\n`);
    console.log(`${options.alias}: ${update.passed ? "updated" : "UPDATE FAILED"} ${update.from.versionCode} -> ${update.to.versionCode}; ${domainsBefore ? `${Object.keys(domainsBefore).length} data domains byte-identical` : "package identity readback only"}${failures.length ? `\n  ${failures.join("\n  ")}` : ""}`);
    if (rotationIntentSha256 && update.passed)
      completePilotRotation(rotationJournal, device.serialSha256, rotationIntentSha256, apk.sha256);
    process.exitCode = update.passed ? 0 : 1;
  } finally {
    try { if (pulled) fs.rmSync(pulled, { recursive: true, force: true }); }
    finally { releaseInstallLock(); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
export { sha256 };
