/**
 * Alpha AOSP image capability declaration (owner decision P-36, issue #420).
 *
 * Phone, Contacts and SMS exist only on the Alpha AOSP image. The app recognises the image by a
 * system feature only the image product declares, together with installation from a system
 * partition (AlphaImageCapability.java). The declaration is the shared one every brand's image
 * uses (vendor/eliza/packages/os/scripts/android/image-capability.mjs); the Pixel 10a composition
 * writes it itself, and scripts/stage-aosp.mjs writes it for the Cuttlefish and generic products.
 * It is staging output: only a boot of the built image shows Android reporting the feature.
 */
export {
  IMAGE_FEATURE_VERSION,
  imageFeatureName,
  renderImageCapability,
  stagedImageFeature,
  writeImageCapability,
} from "../vendor/eliza/packages/os/scripts/android/image-capability.mjs";
