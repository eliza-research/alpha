import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {composePixel10aProduct} from '../vendor/eliza/packages/os/scripts/android/pixel10a-product.ts';
import {placeholderFields, releaseDescriptorProblems} from '../vendor/eliza/packages/os/scripts/android/pixel10a-release.mjs';
import {assertStockVendorApi} from '../vendor/eliza/packages/os/scripts/android/vendor-api.mjs';

export {placeholderFields};
/** The production descriptor for Pixel 10a (stallion) on Android 17. */
export const PIXEL10A_PRODUCT = 'android/aosp/pixel10a-product.json';
export const PIXEL10A_COMPOSITION = 'vendor/eliza/packages/os/android/products/pixel10a-alpha.json';
/**
 * Alpha's binding of the shared Pixel 10a release inputs: its product (the
 * alpha_stallion_phone composition), its descriptor, the vendored path of the shared
 * source lock and its APK release signer. A descriptor naming another product is refused.
 */
export const PIXEL10A_RELEASE = Object.freeze({
  productName: 'alpha_stallion_phone',
  descriptorFile: PIXEL10A_PRODUCT,
  sourceLockPath: 'vendor/eliza/packages/os/android/sources/pixel10a-stallion.json',
  applicationSignerFile: 'android/release-signer.json',
});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/**
 * Whether this run stages the physical Pixel 10a product. Development staging needs the exact
 * source and factory inputs; production staging additionally needs the reviewed launcher
 * descriptor (checked by stage-aosp) and a complete production descriptor (pixel10aProductProblems).
 */
export function pixel10aOptions({target, development, production, source, factory}) {
  if (target != null && target !== 'pixel10a') throw Error('Only --target pixel10a is supported; omit --target for the existing product');
  if (!target) {
    if (factory) throw Error('--factory-image requires --target pixel10a');
    return false;
  }
  if (development && production) throw Error('--production and --development are exclusive');
  if (!development && !production) throw Error('Pixel 10a staging needs --development or --production');
  if (!source || !factory) throw Error('Pixel 10a staging requires --aosp-source and --factory-image');
  return true;
}

/**
 * Problems that keep alpha_stallion_phone from production staging, read from `root` by the
 * shared Pixel 10a release checks: the production descriptor, its pinned source lock, the APK
 * release signer and the image platform certificate. An empty list admits staging inputs
 * only; it is never an image build, signed image, boot, device or release qualification.
 */
export function pixel10aProductProblems(root = process.cwd()) {
  const at = rel => path.join(root, rel);
  if (!fs.existsSync(at(PIXEL10A_PRODUCT))) return [`${PIXEL10A_PRODUCT} is missing`];
  let product;
  try { product = JSON.parse(fs.readFileSync(at(PIXEL10A_PRODUCT), 'utf8')); } catch (error) { return [`${PIXEL10A_PRODUCT} is unreadable: ${error.message}`]; }
  return releaseDescriptorProblems(product, {root, file: PIXEL10A_PRODUCT, productName: PIXEL10A_RELEASE.productName, sourceLockPath: PIXEL10A_RELEASE.sourceLockPath, applicationSignerFile: PIXEL10A_RELEASE.applicationSignerFile});
}

/**
 * The shared stock-vendor contract for the verified source tree: the composition's lunch release and
 * the generated stallion vendor VINTF manifest both carry the shared profile's locked vendor API.
 * A mismatch is refused, never rewritten.
 */
export function pixel10aVendorApi({root = process.cwd(), source}) {
  const profile = JSON.parse(fs.readFileSync(path.join(root, 'vendor/eliza/packages/os/android/aosp.lock.json'), 'utf8')).profiles.pixel10a;
  const product = JSON.parse(fs.readFileSync(path.join(root, PIXEL10A_COMPOSITION), 'utf8'));
  return assertStockVendorApi(source, {codename: profile.device.codename, releaseConfig: product.releaseConfig, vendorApiLevel: profile.device.vendorApiLevel});
}

export function writePixel10aProduct({root, output, apk, identity, launcher, sourceEvidence, production = false, bootAnimation = null, vendorApi = null}) {
  const nativeStagingEvidence = JSON.parse(execFileSync('python3', [path.join(root, 'scripts/stage-aosp-native.py'), '--apk', path.resolve(apk), '--output', output, '--module', identity.moduleName, '--target', 'stallion', '--defer-soong'], {encoding:'utf8'}));
  const product = JSON.parse(fs.readFileSync(path.join(root, PIXEL10A_COMPOSITION), 'utf8'));
  // A brand boot animation is staged only when the shared composition pins its bytes.
  const report = composePixel10aProduct({output, product, launcher, sourceEvidence, nativeStagingEvidence, production, bootAnimation, vendorApi});
  execFileSync('python3', [path.join(root, 'scripts/stage-aosp-native.py'), '--apk', path.resolve(apk), '--output', output, '--module', identity.moduleName, '--finalize-soong'], {stdio:'pipe'});
  if (production) {
    const bytes = fs.readFileSync(path.join(root, PIXEL10A_PRODUCT));
    const descriptor = JSON.parse(bytes);
    Object.assign(report, {productDescriptor:{file:PIXEL10A_PRODUCT, sha256:sha256(bytes)}, sourceLockSha256:descriptor.sourceLock.sha256, platformCertificateSha256:descriptor.signer.platformCertificateSha256});
    fs.writeFileSync(path.join(output, 'physical-product.json'), JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}
