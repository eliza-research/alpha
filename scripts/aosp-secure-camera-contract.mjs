/**
 * Alpha's binding of the shared system secure camera (policy P-23):
 * vendor/eliza/packages/os/scripts/android/secure-camera.mjs owns the reviewed Camera2/SystemUI
 * source contract (packages/os/android/sources/secure-camera.json), the product overlay, the
 * launcher manifest policy and the read-only image checks. Alpha supplies only its package.
 */
import fs from "node:fs";
import {
  assertNoLockScreenSurface,
  verifySecureCameraImage as sharedImageCheck,
} from "../vendor/eliza/packages/os/scripts/android/secure-camera.mjs";

export {
  SECURE_CAMERA_CONTRACT,
  loadSecureCameraContract,
  secureCameraActions,
  secureCameraComponent,
  secureCameraPackage,
  verifySecureCameraSource,
  writeSecureCameraOverlay,
} from "../vendor/eliza/packages/os/scripts/android/secure-camera.mjs";

const alphaPackage = JSON.parse(fs.readFileSync(new URL("../app.config.json", import.meta.url), "utf8")).appId;

/** Read-only image checks; Alpha must not handle any secure capture action. */
export function verifySecureCameraImage(run, user, expectedFingerprint) {
  return sharedImageCheck(run, user, expectedFingerprint, { launcherPackage: alphaPackage, brand: "Alpha" });
}

/** Refuses an Alpha APK manifest that shows over Keyguard or handles secure capture. */
export function assertNoAlphaLockScreenSurface(xmltree) {
  return assertNoLockScreenSurface(xmltree, { brand: "Alpha" });
}
