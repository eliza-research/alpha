import { cuttlefishOptions, writeCuttlefishNatives } from './aosp-cuttlefish.ts';
import { verifyPixel10aSource, defaultLockPath, listenerSystemuiPatch, aospBuildPatch } from './pixel10a-source-contract.ts';
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
import { writeImageCapability } from "./aosp-image-capability.ts";
import { releaseBlockers } from "./release-blockers.ts";
import {signerDigest} from "./apk.ts";
import {readApkEntries} from "../vendor/eliza/packages/app/scripts/mobile/artifact-inspection/apk-distribution.mjs";
import { aaptManifestTree, admitImageApk, manifestTreeIsDebuggable, reviewedSourceOverrides as sharedReviewedSourceOverrides } from "../vendor/eliza/packages/os/scripts/android/image-apk-admission.mjs";
import { CUTTLEFISH_TARGETS, cuttlefishProductProblems } from "../vendor/eliza/packages/os/scripts/android/cuttlefish-product.mjs";

export const PRODUCT_DESCRIPTOR = "android/aosp/product.json";
/**
 * The one privileged permission the Alpha launcher may hold on the image: the phone's own IMEI and
 * SIM serial for Settings → Phone. The shared overlay stager installs the launcher under priv-app
 * with an allow-list naming exactly this; every other privileged permission stays refused.
 */
export const LAUNCHER_PRIVILEGED_PERMISSIONS = ["android.permission.READ_PRIVILEGED_PHONE_STATE"];
export const SHARED_CUTTLEFISH_LOCK = "vendor/eliza/packages/os/android/aosp.lock.json";
export const AOSP_TARGETS = CUTTLEFISH_TARGETS;
type ReviewedSourcePatch = ReturnType<typeof listenerSystemuiPatch>;
type PhysicalSource = Awaited<ReturnType<typeof verifyPixel10aSource>> & {hardwareLayout?: ReturnType<typeof pixel10aSourceLayout>};
interface SourceOverrideOptions {
  physicalSource?: PhysicalSource | null;
  cuttlefish?: boolean;
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
interface ListenerOptions {
  listenerApk: string;
  listenerDescriptor: string | null;
  development: boolean;
  appId: string;
  env: NodeJS.ProcessEnv;
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);


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
import { VOICE_HOST_RECORD, checkListenerDescriptor, checkListenerSpeechBundle, checkListenerSpeechNatives, stageListener } from "./aosp-listener.ts";

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
      manifest: {testMocks?: boolean; results?: Record<string, unknown>[]} | null;
      judge: (row: Record<string, unknown>, manifest: {testMocks?: boolean}) => string[];
    },
  ) => ReturnType<typeof admitImageApk>;
  return admit({
    apk,
    sha256: hash,
    development,
    manifest: fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : null,
    manifestFile,
    testMocksDir: path.resolve("artifacts/test-mocks"),
    judge: (row, manifest) => releaseBlockers(row, { manifestTestMocks: manifest.testMocks, ...current }),
    readManifestTree: file => aaptManifestTree(file, { aapt: tool("aapt"), env: androidEnv() }),
  });
}
/**
 * Source overrides the secure-camera source check admits. Pixel and Cuttlefish images are built from the same
 * reviewed Android 17 tree, so both admit exactly its hash-pinned overrides; other development staging admits none.
 */
export function reviewedSourceOverrides({physicalSource = null, cuttlefish = false, lockPath = defaultLockPath, source, appliedPatches = []}: SourceOverrideOptions = {}) {
  const reviewed = sharedReviewedSourceOverrides as unknown as (options: {
    physicalSource: PhysicalSource | null;
    imageTarget: boolean;
    lockPath: string;
    source?: string | null;
    appliedPatches: ReviewedSourcePatch[];
  }) => ReturnType<typeof sharedReviewedSourceOverrides>;
  return reviewed({physicalSource, imageTarget: cuttlefish, lockPath, source, appliedPatches});
}

export function stagingSystemuiPatches(names: string[], imageTarget: boolean) {
  if (!names.length) return [];
  if (!imageTarget) throw Error('--applied-systemui-patch requires --target pixel10a or cuttlefish');
  if (new Set(names).size !== names.length) throw Error('Duplicate applied SystemUI patch');
  return names.map(listenerSystemuiPatch);
}

export function stagingBuildPatches(names: string[], imageTarget: boolean) {
  if (!names.length) return [];
  if (!imageTarget) throw Error('--applied-build-patch requires --target pixel10a or cuttlefish');
  if (new Set(names).size !== names.length) throw Error('Duplicate applied build patch');
  return names.map(aospBuildPatch);
}

/**
 * Checks the listener APK before any staging output is written: a release build outside --development,
 * its reviewed descriptor when one is given, and reports missing packaged speech.
 * Returns the permission dump and signer stageListener needs.
 */
function admitListener({ listenerApk, listenerDescriptor, development, appId, env }: ListenerOptions) {
  // Debuggable listener builds are development-only; a production image takes a release build.
  if (!development) {
    let debuggable;
    try {
      debuggable = manifestTreeIsDebuggable(aaptManifestTree(listenerApk, { aapt: tool("aapt"), env }));
    } catch {
      throw new Error(`Refusing ${listenerApk}: its manifest could not be read.`);
    }
    if (debuggable) throw new Error(`Refusing ${listenerApk}: a debuggable listener is staged only with --development.`);
  }
  const signer = signerDigest(listenerApk);
  const dump = execFileSync(tool("aapt"), ["dump", "permissions", listenerApk], { encoding: "utf8", env, maxBuffer: 16 << 20 });
  // The privileged APK is pinned like the launcher: reviewed bytes and signer, not just a name.
  const listenerHash = createHash("sha256").update(fs.readFileSync(listenerApk)).digest("hex");
  if (listenerDescriptor)
    checkListenerDescriptor(JSON.parse(fs.readFileSync(listenerDescriptor, "utf8")), { appId, apkSha256: listenerHash, signer });
  // A listener without its speech model can never listen; production refuses it.
  const voiceHost = JSON.parse(fs.readFileSync(VOICE_HOST_RECORD, "utf8"));
  const entries = readApkEntries(listenerApk);
  try {
    const packaged = checkListenerSpeechBundle(entries, voiceHost, (entry: string) => execFileSync("unzip", ["-p", listenerApk, entry], { encoding: "utf8", maxBuffer: 1 << 20 }));
    checkListenerSpeechNatives(packaged, voiceHost, (entry: string) => createHash("sha256").update(execFileSync("unzip", ["-p", listenerApk, entry], { maxBuffer: 256 << 20 })).digest("hex"));
  } catch (problem) {
    console.warn(`Development listener: ${message(problem)}. It will report SPEECH_UNAVAILABLE on the image.`);
  }
  return { dump, signer };
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
    !["--apk", "--output", "--descriptor", "--apk-manifest", "--aosp-source", "--listener-apk", "--listener-descriptor", "--target", "--factory-image", "--applied-systemui-patch", "--applied-build-patch", "--boot-animation"].includes(args[i]) ||
    !args[i + 1] ||
    args[i + 1].startsWith("--")
  )
    throw new Error(
      "Use --apk FILE --output NEW_DIR [--descriptor FILE [--production] | --development] [--apk-manifest FILE] [--aosp-source PATH] [--target cuttlefish | --target pixel10a --factory-image FILE (--development | --production --descriptor FILE)] [--listener-apk FILE [--listener-descriptor FILE]] [--applied-systemui-patch chip|ops|assist ...] [--applied-build-patch soong-memory|soong-app-native ...] [--boot-animation ZIP (pixel10a, when the composition pins one)]",
    );
  if (args[i] === '--applied-systemui-patch') appliedPatchNames.push(args[i + 1]);
  if (args[i] === '--applied-build-patch') appliedBuildNames.push(args[i + 1]);
  i++;
}
const development = args.includes("--development");
// --production adds the provisioning overlay (default HOME, assistant role, Autofill
// offer). It needs a reviewed descriptor and a distributable release, so it is
// refused until a signed, PACKAGED, qualified release APK exists.
const production = args.includes("--production");
const source = get('--aosp-source');
const factory = get('--factory-image');
const cuttlefish = cuttlefishOptions({target:get('--target'), source, factory});
const physical = pixel10aOptions({target:cuttlefish ? null : get('--target'), development, production, source, factory});
if (get('--boot-animation') && !physical) throw new Error('--boot-animation belongs to --target pixel10a');
if (production && development) throw new Error("--production and --development are exclusive");
// P-78 defers wake listening, and AlphaSense's tile and consent would open a microphone whose wake
// lands on the disabled AlphaAssistActivity, so no production image carries it while P-78 stands.
// Development staging still takes it so the listener can be tested.
if (production && (get("--listener-apk") || get("--listener-descriptor")))
  throw new Error("Refusing --listener-apk for --production: wake listening is deferred (P-78), so production images leave AlphaSense out. Stage the listener with --development.");
// The product lock is checked before any source or APK is read: production never stages into an
// unset product. Pixel 10a has its own production descriptor; the Cuttlefish product its own lock.
if (production) {
  const problems = physical ? pixel10aProductProblems(process.cwd()) : aospProductLockProblems(process.cwd());
  const name = physical ? `Pixel 10a production product (${PIXEL10A_PRODUCT})` : "Alpha AOSP product lock";
  if (problems.length) throw new Error(`Refusing production staging: the ${name} is incomplete.\n${problems.map(item => `  - ${item}`).join("\n")}`);
}
const platformCertificateSha256 = production ? JSON.parse(fs.readFileSync(physical ? PIXEL10A_PRODUCT : PRODUCT_DESCRIPTOR, "utf8")).signer?.platformCertificateSha256 : undefined;
const appliedPatches = [...stagingSystemuiPatches(appliedPatchNames, physical || cuttlefish), ...stagingBuildPatches(appliedBuildNames, physical || cuttlefish)];
if ((physical || cuttlefish) && !appliedBuildNames.includes('soong-app-native'))
  throw Error('Image staging requires --applied-build-patch soong-app-native for Soong-only APK and JNI installation.');
const physicalSource: PhysicalSource | null = physical ? await verifyPixel10aSource({source:get('--aosp-source'), factory:get('--factory-image'), appliedPatches}) : null;
if (physicalSource) physicalSource.hardwareLayout = pixel10aSourceLayout({source:source!});
// The verified tree must also lunch a release carrying the stock stallion vendor API (shared check).
const vendorApi = physical && source ? pixel10aVendorApi({root:process.cwd(), source}) : null;
if (physicalSource && production && physicalSource.sourceLockSha256 !== JSON.parse(fs.readFileSync(PIXEL10A_PRODUCT, "utf8")).sourceLock?.sha256)
  throw new Error(`Refusing production staging: the verified source lock is not the one pinned in ${PIXEL10A_PRODUCT}.`);
// The always-on listener is development-only while P-78 stands (refused for production above).
const listenerApk = get("--listener-apk");
const listenerDescriptor = get("--listener-descriptor");
if (listenerDescriptor && !listenerApk) throw new Error("--listener-descriptor needs --listener-apk");
let descriptor = get("--descriptor");
if (production && !descriptor)
  throw new Error("--production requires --descriptor FILE: an independently reviewed descriptor with pinned hash and signer.");
const apk = get("--apk");
if (!apk)
  throw new Error(development
    ? "Development staging: supply --apk PATH to a flag-off debug launcher APK."
    : "Production staging: supply --apk PATH to the signed launcher release APK that verify-apks recorded as distributable.");
const identity = JSON.parse(fs.readFileSync("app.config.json", "utf8"));
const hash = createHash("sha256").update(fs.readFileSync(apk)).digest("hex");
admitApk({
  apk,
  hash,
  development,
  manifestFile: get("--apk-manifest") || "artifacts/apk-manifest.json",
  platformCertificateSha256,
});
if (descriptor) {
  const supplied = JSON.parse(fs.readFileSync(descriptor, "utf8"));
  if (supplied.packageName !== identity.appId || supplied.moduleName !== identity.moduleName)
    throw new Error(`Descriptor does not belong to this product: packageName ${supplied.packageName} and moduleName ${supplied.moduleName} must be ${identity.appId} and ${identity.moduleName} (app.config.json).`);
}
const cameraOverrides = reviewedSourceOverrides({physicalSource, cuttlefish, source, appliedPatches});
const cameraSource = source || !development
  ? verifySecureCameraSource(source, undefined, cameraOverrides)
  : { sourceVerified: false, imageVerified: false, lockedCaptureVerified: false, deviceAcceptanceVerified: false, reason: "Development staging without reviewed AOSP source" };
const env = androidEnv();
const tree = execFileSync(tool("aapt"), ["dump", "xmltree", apk, "AndroidManifest.xml"], { encoding: "utf8", env, maxBuffer: 64 << 20 });
assertNoAlphaLockScreenSurface(tree);
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
        privilegedPermissions: LAUNCHER_PRIVILEGED_PERMISSIONS,
      },
      null,
      2,
    ) + "\n",
  );
}
const reviewed = JSON.parse(fs.readFileSync(descriptor, "utf8"));
// Identifier access is all or nothing and never wider: a reviewed descriptor either names exactly
// the one permission below (the launcher is then staged as a privileged app with an allow-list for
// it alone) or none, in which case Settings → Phone shows no IMEI and links to Android's status screen.
if (reviewed.privilegedPermissions !== undefined && JSON.stringify(reviewed.privilegedPermissions) !== JSON.stringify(LAUNCHER_PRIVILEGED_PERMISSIONS))
  throw new Error(`Descriptor privilegedPermissions must be exactly ${JSON.stringify(LAUNCHER_PRIVILEGED_PERMISSIONS)} or absent.`);
if (
  reviewed.packageName !== identity.appId ||
  reviewed.moduleName !== identity.moduleName
)
  throw new Error("Descriptor does not belong to this product");
// The listener is admitted before any staging output exists, so its refusals leave none behind.
const listener = listenerApk ? admitListener({ listenerApk, listenerDescriptor, development, appId: identity.appId, env }) : null;
const destination = path.resolve(get("--output") || `artifacts/aosp/${identity.slug}-${hash.slice(0, 12)}`);
// Every product is staged in a sibling temporary directory (same filesystem, so the rename is atomic)
// and published only after the last check; a refusal leaves the destination absent.
if (fs.existsSync(destination)) throw Error('Output already exists: ' + destination);
fs.mkdirSync(path.dirname(destination), {recursive:true});
const temporary = fs.mkdtempSync(path.join(path.dirname(destination), `.${physical ? 'pixel10a' : cuttlefish ? 'cuttlefish' : identity.slug}-stage-`));
const output = path.join(temporary, 'overlay');
try {
execFileSync(
  process.execPath,
  [
    "vendor/eliza/packages/os/scripts/android/stage-launcher-overlay.ts",
    "--descriptor",
    path.resolve(descriptor),
    "--apk",
    path.resolve(apk),
    "--output",
    path.resolve(output),
    "--aapt",
    tool("aapt"),
    "--apksigner",
    tool("apksigner"),
    ...(development ? ["--development"] : []),
  ],
  { stdio: "inherit", env },
);
fs.appendFileSync(path.join(output, "product.mk"), clockProductRequirement);
// The image system feature Alpha Phone requires, with a system-partition install, before it offers
// Phone, Contacts or SMS (P-36). Every image declares it, but the app also requires a release
// launcher and the provisioning overlay written below only for production, so a development image
// never passes the capability. Test-mocks APKs were refused above, and a sideloaded APK never has the
// system-partition install. The shared Pixel 10a composition declares it for every brand, so only
// the other products write it here.
if (!physical) {
  const capability = writeImageCapability(output, identity.appId);
  const feature = Object.keys(capability).find(name => name !== "productMakefile");
  console.log(production
    ? `Image capability: ${feature}.`
    : `Image capability: ${feature} declared; Phone, Contacts and SMS need a production-staged release launcher.`);
}
writeSecureCameraOverlay(output, cameraSource);
if (production) {
  const components = provisioningComponents(tree, identity.appId);
  writeProvisioningOverlay(output, identity.appId, components);
  // The shared Pixel 10a composition writes the same overlay from android/aosp/pixel10a-composition.json.
  if (!physical) writeAospCapabilityOverlay(output, identity.appId);
  console.log(`Provisioning overlay: HOME ${components.home}, assistant ${components.assistant ? identity.appId : "none (P-78)"}, Autofill ${components.autofill}.`);
}
if (listenerApk && listener) {
  stageListener({ root: process.cwd(), output, apk: listenerApk, dump: listener.dump, signer: listener.signer, launcherSigner: String(reviewed.certificateSha256 ?? "").toLowerCase(), appId: identity.appId });
  console.log(`Always-on listener staged: ${identity.appId}.sense (privileged, no network). Grants, indicator and invocation are image-boot evidence, not staging evidence.`);
}
if (cuttlefish) writeCuttlefishNatives({root:process.cwd(), output, apk, module:identity.moduleName});
if (physical) {
  writePixel10aProduct({root:process.cwd(), output, apk, identity, launcher:reviewed, sourceEvidence:physicalSource, production, bootAnimation:get('--boot-animation'), vendorApi});
}
if (fs.existsSync(destination)) throw Error('Output appeared during staging: ' + destination);
fs.renameSync(output, destination);
console.log(
  `Add under vendor/${identity.slug.replaceAll("-", "_")} and inherit product.mk from the selected AOSP product. This is staging evidence, not an image boot.`,
);
} finally { fs.rmSync(temporary, {recursive:true, force:true}); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
