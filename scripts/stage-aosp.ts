import { cuttlefishOptions, writeCuttlefishNatives } from './aosp-cuttlefish.ts';
import { verifyPixel10aSource, defaultLockPath, listenerSystemuiPatch, alphaProtectedPowerPatch, aospBuildPatch, type ReviewedSourcePatch } from './pixel10a-source-contract.ts';
import { pixel10aOptions, pixel10aProductProblems, pixel10aSourceLayout, pixel10aVendorApi, writePixel10aProduct, PIXEL10A_PRODUCT } from './aosp-pixel10a.ts';
import { readReleaseSigner } from './build-android.ts';
import fs from "node:fs";
import { writeAospCapabilityOverlay } from "./aosp-capability-overlay.ts";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { androidEnv, tool } from "./toolchain.ts";
import { verifySecureCameraSource, writeSecureCameraOverlay, assertNoAlphaLockScreenSurface } from "./aosp-secure-camera-contract.ts";
import { clockProductRequirement } from "./aosp-clock-contract.ts";
import { provisioningComponents, writeProvisioningOverlay } from "./aosp-provisioning-overlay.ts";
import { aospTelephonyRoleComponents } from "./aosp-telephony-roles.ts";
import { writeImageCapability } from "./aosp-image-capability.ts";
import { releaseBlockers } from "./release-blockers.ts";
import {parseXmlTree, signerDigest, telephonySetupReceiverProblems} from "./apk.ts";
import {apkUpdateChannelOrLegacy, assertProvisioningUpdateChannel, recordedProvisioningUpdateChannel} from "./update-channel.ts";
import {updateArtifactDigest} from "./update-artifact.ts";
import { aaptManifestTree, admitImageApk, reviewedSourceOverrides as sharedReviewedSourceOverrides } from "../vendor/eliza/packages/os/scripts/android/image-apk-admission.mjs";
import { CUTTLEFISH_TARGETS, cuttlefishProductProblems } from "../vendor/eliza/packages/os/scripts/android/cuttlefish-product.mjs";
import { assertSenseLauncher, assertSenseQualification, readSenseQualification, senseLauncherDigest, writeSenseImageActivation, type SenseImageActivation } from './aosp-sense-image.ts';
import { stageAlphaSensePolicy } from './aosp-sense-policy.ts';
import { verifyPinnedUpstream } from './pinned-upstream-source.ts';

export const PRODUCT_DESCRIPTOR = "android/aosp/product.json";
/**
 * The one privileged permission the Alpha launcher may hold on the image: the phone's own IMEI and
 * SIM serial for Settings → Phone. The shared overlay stager installs the launcher under priv-app
 * with an allow-list naming exactly this; every other privileged permission stays refused.
 */
export const LAUNCHER_PRIVILEGED_PERMISSIONS = ["android.permission.READ_PRIVILEGED_PHONE_STATE"];
/**
 * Runtime permissions the image grants the preinstalled launcher on first boot, so a fresh phone
 * shows no Android permission dialogs for them: every step of the startup access walkthrough
 * (apps/app/src/startup-permission-flow.ts) plus Contacts and phone state for the image's Phone and
 * Contacts views. The shared stager writes them as a product default-permissions exception with
 * fixed="false", so the owner can still revoke each one in Settings. All files access is granted by
 * AlphaSharedStoragePolicy; SMS and CALL_PHONE come with the SMS and dialer roles; call history
 * stays behind the owner's own "Allow call history" control.
 */
export const LAUNCHER_DEFAULT_PERMISSIONS = [
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.RECORD_AUDIO",
  "android.permission.CAMERA",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.READ_CALENDAR",
  "android.permission.WRITE_CALENDAR",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
  "android.permission.READ_CONTACTS",
  "android.permission.WRITE_CONTACTS",
  "android.permission.READ_PHONE_STATE",
  "android.permission.READ_PHONE_NUMBERS",
];
export const SHARED_CUTTLEFISH_LOCK = "vendor/eliza/packages/os/android/aosp.lock.json";
export const AOSP_TARGETS = CUTTLEFISH_TARGETS;
type PhysicalSource = Awaited<ReturnType<typeof verifyPixel10aSource>> & {hardwareLayout?: ReturnType<typeof pixel10aSourceLayout>};
interface SourceOverrideOptions {
  physicalSource?: PhysicalSource | null;
  lockPath?: string;
  source?: string | null;
  appliedPatches?: ReviewedSourcePatch[];
}
interface ImageApkOptions {
  apk: string;
  hash: string;
  development: boolean;
  manifestFile: string;
  platformCertificateSha256?: string;
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Require the first-run contract from the APK itself, including when reusing an old admission receipt. */
export function assertImageLauncherManifest(tree: string, production: boolean) {
  assertNoAlphaLockScreenSurface(tree);
  if (!production) return;
  const problems = telephonySetupReceiverProblems(parseXmlTree(tree));
  if (problems.length) throw Error(`Production launcher cannot be staged: ${problems.join("; ")}`);
}


/**
 * Problems that keep the Alpha AOSP product from production staging, read from `root` by the shared
 * Cuttlefish product checks (vendor/eliza/packages/os/scripts/android/cuttlefish-product.mjs): the
 * product descriptor, its brand config, the shared reviewed Cuttlefish source-lock profile, the host
 * package hashes and the reviewed signer. An empty list means the lock is complete; it says nothing
 * about an image build or boot.
 */
export function aospProductLockProblems(root = process.cwd()) {
  const at = (rel: string) => path.join(root, rel);
  if (!fs.existsSync(at(PRODUCT_DESCRIPTOR))) return [`${PRODUCT_DESCRIPTOR} is missing`];
  let product;
  try { product = JSON.parse(fs.readFileSync(at(PRODUCT_DESCRIPTOR), "utf8")); } catch (error) { return [`${PRODUCT_DESCRIPTOR} is unreadable: ${message(error)}`]; }
  const identity = JSON.parse(fs.readFileSync(at("app.config.json"), "utf8"));
  const productProblems = cuttlefishProductProblems as unknown as (product: unknown, options: {
    root: string; file: string; appId: string; productDirectory: string; sharedSourceLock: string; applicationSignerFile: string;
  }) => string[];
  return productProblems(product, { root, file: PRODUCT_DESCRIPTOR, appId: identity.appId, productDirectory: "android/aosp", sharedSourceLock: SHARED_CUTTLEFISH_LOCK, applicationSignerFile: "android/release-signer.json" });
}
import { stageListener } from "./aosp-listener.ts";

/**
 * Alpha's policy for the shared image APK admission
 * (vendor/eliza/packages/os/scripts/android/image-apk-admission.mjs): its separate test-mocks
 * builds live in artifacts/test-mocks/, and a release row is judged by release-blockers.ts
 * (Alpha's signer and font-licence policy). Production judges the row against the committed
 * release signer now, not only the admission verify-apks recorded, and requires the reviewed
 * image platform certificate. Open-source licence flags are a record, never a blocker (P-09).
 */
function admitApk({ apk, hash, development, manifestFile, platformCertificateSha256 }: ImageApkOptions) {
  const current = development ? {} : { releaseSigner: readReleaseSigner(), image: { platformCertificateSha256 } };
  const admit = admitImageApk as unknown as (
    options: {
      apk: string; sha256: string; development: boolean; manifestFile: string; testMocksDir: string;
      readManifestTree: (file: string) => string;
      manifest: {testMocks?: boolean; updateChannel?: unknown; results?: Record<string, unknown>[]} | null;
      judge: (row: Record<string, unknown>, manifest: {testMocks?: boolean}) => string[];
    },
  ) => ReturnType<typeof admitImageApk>;
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : null;
  const {entry} = admit({
    apk,
    sha256: hash,
    development,
    manifest,
    manifestFile,
    testMocksDir: path.resolve("artifacts/test-mocks"),
    judge: (row, manifest) => releaseBlockers(row, { manifestTestMocks: manifest.testMocks, ...current }),
    readManifestTree: file => aaptManifestTree(file, { aapt: tool("aapt"), env: androidEnv() }),
  });
  const apkChannel = entry && "updateChannel" in entry ? entry.updateChannel : undefined;
  return development ? null : recordedProvisioningUpdateChannel(manifest?.updateChannel, apkChannel);
}
/**
 * Source overrides the secure-camera source check admits. Pixel and Cuttlefish images are built from the same
 * reviewed Android 17 tree, so both admit exactly its hash-pinned overrides.
 */
export function reviewedSourceOverrides({physicalSource = null, lockPath = defaultLockPath, source, appliedPatches = []}: SourceOverrideOptions = {}) {
  const reviewed = sharedReviewedSourceOverrides as unknown as (options: {
    physicalSource: PhysicalSource | null;
    imageTarget: boolean;
    lockPath: string;
    source?: string | null;
    appliedPatches: ReviewedSourcePatch[];
  }) => ReturnType<typeof sharedReviewedSourceOverrides>;
  return reviewed({physicalSource, imageTarget: true, lockPath, source, appliedPatches});
}

export function stagingSystemuiPatches(names: string[]): ReviewedSourcePatch[] {
  if (new Set(names).size !== names.length) throw Error('Duplicate applied SystemUI patch');
  if (names.includes('alpha-protected-power') && names.includes('assist'))
    throw Error('The protected Power patch and the generic assist patch change the same SystemUI source');
  return names.map(name => name === 'alpha-protected-power' ? alphaProtectedPowerPatch() : listenerSystemuiPatch(name));
}

/** Every image is built from a tree carrying soong-app-native: Soong installs the APK and its JNI only with it. */
export function stagingBuildPatches(names: string[]) {
  const applied = ['soong-app-native', ...names];
  if (new Set(applied).size !== applied.length) throw Error('Duplicate applied build patch');
  return applied.map(aospBuildPatch);
}

async function main(args: string[]) {
const appliedPatchNames: string[] = [];
const appliedBuildNames: string[] = [];
const get = (key: string) => {
  const i = args.indexOf(key);
  return i < 0 ? null : args[i + 1];
};
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--development" || args[i] === "--production") continue;
  if (
    !["--apk", "--output", "--descriptor", "--apk-manifest", "--aosp-source", "--listener-apk", "--listener-descriptor", "--listener-qualification", "--target", "--factory-image", "--applied-systemui-patch", "--applied-build-patch", "--boot-animation"].includes(args[i]) ||
    !args[i + 1] ||
    args[i + 1].startsWith("--")
  )
    throw new Error(
      "Use --target cuttlefish | --target pixel10a --factory-image FILE (--development | --production), with --aosp-source PATH --apk FILE --output NEW_DIR [--descriptor FILE (required by --production)] [--apk-manifest FILE] [--listener-apk FILE [--listener-descriptor FILE] [--listener-qualification FILE]] [--applied-systemui-patch chip|ops|assist|alpha-protected-power ...] [--applied-build-patch soong-memory|alpha-sense-policy ...] [--boot-animation ZIP (pixel10a, when the composition pins one)]",
    );
  if (args[i] === '--applied-systemui-patch') appliedPatchNames.push(args[i + 1]);
  if (args[i] === '--applied-build-patch') appliedBuildNames.push(args[i + 1]);
  i++;
}
const development = args.includes("--development");
// --production adds the provisioning overlay (default HOME and Autofill offer).
// It needs a reviewed descriptor and a distributable release, so it is
// refused until a signed, PACKAGED, qualified release APK exists.
const production = args.includes("--production");
const source = get('--aosp-source');
const factory = get('--factory-image');
const cuttlefish = cuttlefishOptions({target:get('--target'), source, factory});
const physical = !cuttlefish && pixel10aOptions({target:get('--target'), development, production, source, factory});
if (get('--boot-animation') && !physical) throw new Error('--boot-animation belongs to --target pixel10a');
if (production && development) throw new Error("--production and --development are exclusive");
const listenerApk = get('--listener-apk');
const listenerDescriptor = get('--listener-descriptor');
const qualificationFile = get('--listener-qualification');
if (listenerDescriptor && !listenerApk) throw Error('--listener-descriptor needs --listener-apk');
const senseImage = Boolean(qualificationFile || (production && listenerApk));
if (senseImage && (!physical || !listenerApk || !listenerDescriptor || !qualificationFile))
  throw Error('An activated Sense image requires Pixel 10a, --listener-apk, --listener-descriptor and --listener-qualification');
if (senseImage && (!['chip', 'ops', 'alpha-protected-power'].every(name => appliedPatchNames.includes(name)) ||
    !appliedBuildNames.includes('alpha-sense-policy')))
  throw Error('An activated Sense image requires chip, ops, alpha-protected-power and alpha-sense-policy source patches');
if (!senseImage && appliedBuildNames.includes('alpha-sense-policy'))
  throw Error('The alpha-sense-policy patch requires an activated Sense image');
// The product lock is checked before any source or APK is read: production never stages into an
// unset product. Pixel 10a has its own production descriptor; the Cuttlefish product its own lock.
if (production || senseImage) {
  const problems = physical ? pixel10aProductProblems(process.cwd()) : aospProductLockProblems(process.cwd());
  const name = physical ? `Pixel 10a production product (${PIXEL10A_PRODUCT})` : "Alpha AOSP product lock";
  if (problems.length) throw new Error(`Refusing production staging: the ${name} is incomplete.\n${problems.map(item => `  - ${item}`).join("\n")}`);
}
const product = production || senseImage ? JSON.parse(fs.readFileSync(physical ? PIXEL10A_PRODUCT : PRODUCT_DESCRIPTOR, 'utf8')) : null;
const platformCertificateSha256 = product?.signer?.platformCertificateSha256;
const qualification = qualificationFile ? readSenseQualification(qualificationFile, product?.listenerQualificationSha256, production) : null;
const senseSdk = qualification ? verifyPinnedUpstream(process.cwd()) : null;
const appliedPatches = [...stagingSystemuiPatches(appliedPatchNames), ...stagingBuildPatches(appliedBuildNames)];
const physicalSource: PhysicalSource | null = physical ? await verifyPixel10aSource({source:get('--aosp-source'), factory:get('--factory-image'), appliedPatches}) : null;
if (physicalSource) physicalSource.hardwareLayout = pixel10aSourceLayout({source:source!});
// The verified tree must also lunch a release carrying the stock stallion vendor API (shared check).
const vendorApi = physical && source ? pixel10aVendorApi({root:process.cwd(), source}) : null;
if (physicalSource && (production || senseImage) && physicalSource.sourceLockSha256 !== product.sourceLock?.sha256)
  throw new Error(`Refusing production staging: the verified source lock is not the one pinned in ${PIXEL10A_PRODUCT}.`);
let descriptor = get("--descriptor");
if ((production || senseImage) && !descriptor)
  throw new Error("--production requires --descriptor FILE: an independently reviewed descriptor with pinned hash and signer.");
const apk = get("--apk");
if (!apk)
  throw new Error(development
    ? "Development staging: supply --apk PATH to a flag-off debug launcher APK."
    : "Production staging: supply --apk PATH to the signed launcher release APK that verify-apks recorded as distributable.");
const identity = JSON.parse(fs.readFileSync("app.config.json", "utf8"));
const hash = createHash("sha256").update(fs.readFileSync(apk)).digest("hex");
const manifestFile = get('--apk-manifest') || 'artifacts/apk-manifest.json';
const reviewedUpdateChannel = admitApk({
  apk,
  hash,
  development: development && !senseImage,
  manifestFile,
  platformCertificateSha256,
});
if (descriptor) {
  const supplied = JSON.parse(fs.readFileSync(descriptor, "utf8"));
  if (supplied.packageName !== identity.appId || supplied.moduleName !== identity.moduleName)
    throw new Error(`Descriptor does not belong to this product: packageName ${supplied.packageName} and moduleName ${supplied.moduleName} must be ${identity.appId} and ${identity.moduleName} (app.config.json).`);
}
const cameraSource = verifySecureCameraSource(source, undefined, reviewedSourceOverrides({physicalSource, source, appliedPatches}));
const env = androidEnv();
if (!descriptor) {
  if (!development)
    throw new Error(
      "Production staging requires an independently reviewed --descriptor with pinned hash and signer.",
    );
  const signer = signerDigest(apk);
  fs.mkdirSync("artifacts", { recursive: true });
  descriptor = `artifacts/launcher-${hash.slice(0, 12)}.json`;
  fs.writeFileSync(
    descriptor,
    JSON.stringify(
      {
        schemaVersion: 1,
        brand: identity.slug.replaceAll("-", "_"),
        moduleName: identity.moduleName,
        packageName: identity.appId,
        apkSha256: hash,
        certificateSha256: signer,
        defaultPermissions: LAUNCHER_DEFAULT_PERMISSIONS,
        privilegedPermissions: LAUNCHER_PRIVILEGED_PERMISSIONS,
      },
      null,
      2,
    ) + "\n",
  );
}
const reviewedBytes = fs.readFileSync(descriptor);
const reviewed = JSON.parse(reviewedBytes.toString('utf8'));
// Identifier access is all or nothing and never wider: a reviewed descriptor either names exactly
// the one permission below (the launcher is then staged as a privileged app with an allow-list for
// it alone) or none, in which case Settings → Phone shows no IMEI and links to Android's status screen.
if (reviewed.privilegedPermissions !== undefined && JSON.stringify(reviewed.privilegedPermissions) !== JSON.stringify(LAUNCHER_PRIVILEGED_PERMISSIONS))
  throw new Error(`Descriptor privilegedPermissions must be exactly ${JSON.stringify(LAUNCHER_PRIVILEGED_PERMISSIONS)} or absent.`);
// First-boot grants are not optional: an image whose descriptor omits them makes the owner accept
// each Android permission dialog on a phone whose launcher is the system itself.
if (JSON.stringify(reviewed.defaultPermissions) !== JSON.stringify(LAUNCHER_DEFAULT_PERMISSIONS))
  throw new Error(`Descriptor defaultPermissions must be exactly ${JSON.stringify(LAUNCHER_DEFAULT_PERMISSIONS)}.`);
if (
  reviewed.packageName !== identity.appId ||
  reviewed.moduleName !== identity.moduleName
)
  throw new Error("Descriptor does not belong to this product");
if (reviewed.apkSha256 !== hash)
  throw new Error("Launcher descriptor hash differs from the admitted APK");
const destination = path.resolve(get("--output") || `artifacts/aosp/${identity.slug}-${hash.slice(0, 12)}`);
// Every product is staged in a sibling temporary directory (same filesystem, so the rename is atomic)
// and published only after the last check; a refusal leaves the destination absent.
if (fs.existsSync(destination)) throw Error('Output already exists: ' + destination);
fs.mkdirSync(path.dirname(destination), {recursive:true});
const temporary = fs.mkdtempSync(path.join(path.dirname(destination), `.${physical ? 'pixel10a' : 'cuttlefish'}-stage-`));
const output = path.join(temporary, 'overlay');
try {
const admittedLauncherDescriptor = path.join(temporary, 'launcher-descriptor.json');
fs.writeFileSync(admittedLauncherDescriptor, reviewedBytes, {flag:'wx', mode:0o600});
let admittedListenerDescriptor = listenerDescriptor;
let descriptorDigests: {launcherDescriptorSha256: string; listenerDescriptorSha256: string} | null = null;
if (qualification && listenerDescriptor) {
  admittedListenerDescriptor = path.join(temporary, 'listener-descriptor.json');
  const listenerDescriptorBytes = fs.readFileSync(listenerDescriptor);
  fs.writeFileSync(admittedListenerDescriptor, listenerDescriptorBytes, {flag:'wx', mode:0o600});
  descriptorDigests = {
    launcherDescriptorSha256: createHash('sha256').update(reviewedBytes).digest('hex'),
    listenerDescriptorSha256: createHash('sha256').update(listenerDescriptorBytes).digest('hex'),
  };
}
execFileSync(
  process.execPath,
  [
    "vendor/eliza/packages/os/scripts/android/stage-launcher-overlay.ts",
    "--descriptor",
    admittedLauncherDescriptor,
    "--apk",
    path.resolve(apk),
    "--output",
    path.resolve(output),
    "--aapt",
    tool("aapt"),
    "--apksigner",
    tool("apksigner"),
    ...(development && !senseImage ? ["--development"] : []),
  ],
  { stdio: "inherit", env },
);
const stagedLauncher = path.join(output, 'Launcher.apk');
if (updateArtifactDigest(stagedLauncher).sha256 !== hash)
  throw Error("Staged launcher differs from the admitted APK");
const provisioningTree = aaptManifestTree(stagedLauncher, {aapt: tool("aapt"), env});
assertImageLauncherManifest(provisioningTree, production);
if (production) aospTelephonyRoleComponents(provisioningTree, identity.appId);
if (senseImage) assertSenseLauncher(provisioningTree, identity.appId);
if (!development || senseImage)
  assertProvisioningUpdateChannel(apkUpdateChannelOrLegacy(parseXmlTree(provisioningTree)), reviewedUpdateChannel);
fs.appendFileSync(path.join(output, "product.mk"), clockProductRequirement);
// The image system feature Alpha Phone requires, with a system-partition install, before it offers
// Phone, Contacts or SMS (P-36). Every image declares it, but the app also requires a release
// launcher and the provisioning overlay written below for production and admitted Sense qualification
// images. Test-mocks APKs were refused above, and a sideloaded APK never has the
// system-partition install. The shared Pixel 10a composition declares it for every brand, so only
// the Cuttlefish product writes it here.
if (!physical) {
  const capability = writeImageCapability(output, identity.appId);
  const feature = Object.keys(capability).find(name => name !== "productMakefile");
  console.log(production
    ? `Image capability: ${feature}.`
    : `Image capability: ${feature} declared; Phone, Contacts and SMS need a production-staged release launcher.`);
}
writeSecureCameraOverlay(output, cameraSource);
let senseActivation: SenseImageActivation | null = null;
if (listenerApk) {
  const certificateSha256 = String(reviewed.certificateSha256 ?? '').toLowerCase();
  const listener = stageListener({ root: process.cwd(), output, apk: listenerApk, launcherSigner: certificateSha256, appId: identity.appId, descriptorFile: admittedListenerDescriptor, production: !development || senseImage, aapt: tool("aapt"), apksigner: tool("apksigner"), env });
  if (qualification) {
    if (!senseSdk || !physicalSource || !descriptorDigests) throw Error('Sense activation requires the verified Pixel source, SDK and private descriptors');
    const sepolicySha256 = stageAlphaSensePolicy({root: process.cwd(), output, appId: identity.appId, certificateSha256});
    const launcherSha256 = senseLauncherDigest(stagedLauncher, hash);
    admitApk({apk:stagedLauncher, hash:launcherSha256, development:false, manifestFile, platformCertificateSha256});
    const listenerSha256 = createHash('sha256').update(fs.readFileSync(path.join(output, 'listener', `${listener.moduleName}.apk`))).digest('hex');
    assertSenseQualification(qualification, {appId: identity.appId, launcherSha256, listenerSha256,
      ...descriptorDigests, certificateSha256, sourceLockSha256: physicalSource.sourceLockSha256,
      sdkCommit:senseSdk.commit, sepolicySha256, patches: appliedPatches});
    senseActivation = {
      ...writeSenseImageActivation(output, identity.appId, provisioningTree),
      qualificationSha256: product.listenerQualificationSha256,
      qualificationPassed: qualification.qualified,
    };
  }
  if (!listener.speechIncluded) console.warn("Development listener will report SPEECH_UNAVAILABLE on the image.");
  console.log(`Always-on listener staged: ${identity.appId}.sense (privileged, no network). Grants, indicator and invocation are image-boot evidence, not staging evidence.`);
}
if (production || senseActivation) {
  const components = provisioningComponents(provisioningTree, identity.appId, {assistant: senseActivation !== null});
  writeProvisioningOverlay(output, identity.appId, components, {freshTelephony: production});
  // Pixel production adds its launcher overlay inside shared composition. A Sense qualification
  // image also needs the same capability to exercise the guarded source on its userdebug build.
  if (!physical || !production) writeAospCapabilityOverlay(output, identity.appId);
  console.log(`Provisioning overlay: HOME ${components.home}, Autofill ${components.autofill}${components.assistant ? `, assistant ${components.assistant}` : ''}.`);
}
if (cuttlefish) writeCuttlefishNatives({root:process.cwd(), output, apk:stagedLauncher, module:identity.moduleName});
if (physical) {
  writePixel10aProduct({root:process.cwd(), output, apk:stagedLauncher, identity, launcher:reviewed, sourceEvidence:physicalSource, production, bootAnimation:get('--boot-animation'), vendorApi, senseActivation});
}
if (fs.existsSync(destination)) throw Error('Output appeared during staging: ' + destination);
fs.renameSync(output, destination);
console.log(
  `Add under vendor/${identity.slug.replaceAll("-", "_")} and inherit product.mk from the selected AOSP product. This is staging evidence, not an image boot.`,
);
} finally { fs.rmSync(temporary, {recursive:true, force:true}); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
