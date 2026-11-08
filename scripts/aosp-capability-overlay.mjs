/**
 * Alpha's image provisioning overlay (P-36). Alpha's APK is presigned, so the image sets its
 * provisioning boolean with a product-partition runtime resource overlay. The generator is the
 * shared one (vendor/eliza/packages/os/scripts/android/image-capability.mjs); Alpha keeps only the
 * installed identifiers its shipped APK declares (android/app/src/main/res/values/aosp-capabilities.xml),
 * which the shared Pixel 10a composition also names in products/pixel10a-alpha.json.
 */
import {
  assertProvisioningResourceDefault,
  writeImageProvisioningOverlay,
} from "../vendor/eliza/packages/os/scripts/android/image-capability.mjs";

export const ALPHA_IMAGE_PROVISIONING = Object.freeze({
  module: "AlphaImageCapabilityOverlay",
  overlayable: "AlphaImageProvisioning",
  resource: "alpha_aosp_image_capability",
});

/** Production staging only: native admission also requires a system-installed release build. */
export function writeAospCapabilityOverlay(output, packageName) {
  return writeImageProvisioningOverlay(output, packageName, ALPHA_IMAGE_PROVISIONING);
}

/** The APK's own default must stay false and overlayable only by system or product partitions. */
export function assertAlphaProvisioningDefault(valuesXml) {
  return assertProvisioningResourceDefault(valuesXml, ALPHA_IMAGE_PROVISIONING);
}
