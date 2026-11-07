import { cuttlefishOptions, writeCuttlefishNatives } from './aosp-cuttlefish.mjs';
import { verifyPixel10aSource, defaultLockPath, listenerSystemuiPatch, aospBuildPatch } from './pixel10a-source-contract.mjs';
import { pixel10aOptions, pixel10aProductProblems, pixel10aVendorApi, writePixel10aProduct, PIXEL10A_PRODUCT } from './aosp-pixel10a.mjs';
import { readReleaseSigner } from './build-android.mjs';
import fs from "node:fs";
import { writeAospCapabilityOverlay } from "./aosp-capability-overlay.mjs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { androidEnv, tool } from "./toolchain.mjs";
import { verifySecureCameraSource, writeSecureCameraOverlay, assertNoAlphaLockScreenSurface } from "./aosp-secure-camera-contract.mjs";
import { clockProductRequirement } from "./aosp-clock-contract.mjs";
import { provisioningComponents, writeProvisioningOverlay } from "./aosp-provisioning-overlay.mjs";
import { writeImageCapability } from "./aosp-image-capability.mjs";
import { releaseBlockers } from "./release-blockers.mjs";
import { aaptManifestTree, admitImageApk, manifestTreeIsDebuggable, reviewedSourceOverrides as sharedReviewedSourceOverrides } from "../vendor/eliza/packages/os/scripts/android/image-apk-admission.mjs";
import { CUTTLEFISH_TARGETS, cuttlefishProductProblems } from "../vendor/eliza/packages/os/scripts/android/cuttlefish-product.mjs";

export const PRODUCT_DESCRIPTOR = "android/aosp/product.json";
export const SHARED_CUTTLEFISH_LOCK = "vendor/eliza/packages/os/android/aosp.lock.json";
export const AOSP_TARGETS = CUTTLEFISH_TARGETS;

/**
 * Problems that keep the Alpha AOSP product from production staging, read from `root` by the shared
 * Cuttlefish product checks (vendor/eliza/packages/os/scripts/android/cuttlefish-product.mjs): the
 * product descriptor, its brand config, the shared reviewed Cuttlefish source-lock profile, the host
 * package hashes and the reviewed signer. An empty list means the lock is complete; it says nothing
 * about an image build or boot.
 */
export function aospProductLockProblems(root = process.cwd()) {
  const at = rel => path.join(root, rel);
  if (!fs.existsSync(at(PRODUCT_DESCRIPTOR))) return [`${PRODUCT_DESCRIPTOR} is missing`];
  let product;
  try { product = JSON.parse(fs.readFileSync(at(PRODUCT_DESCRIPTOR), "utf8")); } catch (error) { return [`${PRODUCT_DESCRIPTOR} is unreadable: ${error.message}`]; }
  const identity = JSON.parse(fs.readFileSync(at("app.config.json"), "utf8"));
  return cuttlefishProductProblems(product, { root, file: PRODUCT_DESCRIPTOR, appId: identity.appId, productDirectory: "android/aosp", sharedSourceLock: SHARED_CUTTLEFISH_LOCK, applicationSignerFile: "android/release-signer.json" });
}
import { VOICE_HOST_RECORD, checkListenerDescriptor, checkListenerSpeechBundle, checkListenerSpeechNatives, stageListener } from "./aosp-listener.mjs";

/**
 * Alpha's policy for the shared image APK admission
 * (vendor/eliza/packages/os/scripts/android/image-apk-admission.mjs): its separate test-mocks
 * builds live in artifacts/test-mocks/, and a release row is judged by release-blockers.mjs
 * (Alpha's signer and font-licence policy). Production judges the row against the committed
 * release signer now, not only the admission verify-apks recorded, and requires the reviewed
 * image platform certificate. Open-source licence flags are a record, never a blocker (P-09).
 */
function admitApk({ apk, hash, development, manifestFile, platformCertificateSha256 }) {
  const current = development ? {} : { releaseSigner: readReleaseSigner(), image: { platformCertificateSha256 } };
  return admitImageApk({
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
export function reviewedSourceOverrides({physicalSource = null, cuttlefish = false, lockPath = defaultLockPath, source, appliedPatches = []} = {}) {
  return sharedReviewedSourceOverrides({physicalSource, imageTarget: cuttlefish, lockPath, source, appliedPatches});
}

export function stagingSystemuiPatches(names, imageTarget) {
  if (!names.length) return [];
  if (!imageTarget) throw Error('--applied-systemui-patch requires --target pixel10a or cuttlefish');
  if (new Set(names).size !== names.length) throw Error('Duplicate applied SystemUI patch');
  return names.map(listenerSystemuiPatch);
}

export function stagingBuildPatches(names, imageTarget) {
  if (!names.length) return [];
  if (!imageTarget) throw Error('--applied-build-patch requires --target pixel10a or cuttlefish');
  if (new Set(names).size !== names.length) throw Error('Duplicate applied build patch');
  return names.map(aospBuildPatch);
}

async function main(args) {
const appliedPatchNames = [];
const appliedBuildNames = [];
const get = (key) => {
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
const cuttlefish = cuttlefishOptions({target:get('--target'), source:get('--aosp-source'), factory:get('--factory-image')});
const physical = pixel10aOptions({target:cuttlefish ? null : get('--target'), development, production, source:get('--aosp-source'), factory:get('--factory-image')});
if (get('--boot-animation') && !physical) throw new Error('--boot-animation belongs to --target pixel10a');
if (production && development) throw new Error("--production and --development are exclusive");
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
const physicalSource = physical ? await verifyPixel10aSource({source:get('--aosp-source'), factory:get('--factory-image'), appliedPatches}) : null;
// The verified tree must also lunch a release carrying the stock stallion vendor API (shared check).
const vendorApi = physical ? pixel10aVendorApi({root:process.cwd(), source:get('--aosp-source')}) : null;
if (physical && production && physicalSource.sourceLockSha256 !== JSON.parse(fs.readFileSync(PIXEL10A_PRODUCT, "utf8")).sourceLock?.sha256)
  throw new Error(`Refusing production staging: the verified source lock is not the one pinned in ${PIXEL10A_PRODUCT}.`);
// The always-on listener is part of the AOSP MVP (issue #424): production images must include it.
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
const identity = JSON.parse(fs.readFileSync("app.config.json"));
const hash = createHash("sha256").update(fs.readFileSync(apk)).digest("hex");
admitApk({
  apk,
  hash,
  development,
  manifestFile: get("--apk-manifest") || "artifacts/apk-manifest.json",
  platformCertificateSha256,
});
if (descriptor) {
  const supplied = JSON.parse(fs.readFileSync(descriptor));
  if (supplied.packageName !== identity.appId || supplied.moduleName !== identity.moduleName)
    throw new Error(`Descriptor does not belong to this product: packageName ${supplied.packageName} and moduleName ${supplied.moduleName} must be ${identity.appId} and ${identity.moduleName} (app.config.json).`);
}
// Checked after APK admission so input refusals are reported first.
if (production && !listenerApk)
  throw new Error("Production staging requires --listener-apk (the always-on listener built by ./gradlew :sense:assembleRelease).");
if (production && !listenerDescriptor)
  throw new Error("Production staging requires --listener-descriptor: an independently reviewed record of the listener's packageName, apkSha256 and certificateSha256.");
const cameraOverrides = reviewedSourceOverrides({physicalSource, cuttlefish, source:get('--aosp-source'), appliedPatches});
const cameraSource = get("--aosp-source") || !development
  ? verifySecureCameraSource(get("--aosp-source"), undefined, cameraOverrides)
  : { sourceVerified: false, imageVerified: false, lockedCaptureVerified: false, deviceAcceptanceVerified: false, reason: "Development staging without reviewed AOSP source" };
const env = androidEnv();
const tree = execFileSync(tool("aapt"), ["dump", "xmltree", apk, "AndroidManifest.xml"], { encoding: "utf8", env, maxBuffer: 64 << 20 });
assertNoAlphaLockScreenSurface(tree);
if (!descriptor) {
  if (!development)
    throw new Error(
      "Production staging requires an independently reviewed --descriptor with pinned hash and signer.",
    );
  const cert = execFileSync(
    tool("apksigner"),
    ["verify", "--print-certs", apk],
    { encoding: "utf8", env },
  );
  const signer = /Signer #1 certificate SHA-256 digest:\s*([a-fA-F0-9]+)/
    .exec(cert)?.[1]
    .toLowerCase();
  if (!signer) throw new Error("No verified signer found");
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
      },
      null,
      2,
    ) + "\n",
  );
}
const reviewed = JSON.parse(fs.readFileSync(descriptor));
if (
  reviewed.packageName !== identity.appId ||
  reviewed.moduleName !== identity.moduleName
)
  throw new Error("Descriptor does not belong to this product");
const destination = path.resolve(get("--output") || `artifacts/aosp/${identity.slug}-${hash.slice(0, 12)}`);
if ((physical || cuttlefish) && fs.existsSync(destination)) throw Error('Output already exists: ' + destination);
if (physical || cuttlefish) fs.mkdirSync(path.dirname(destination), {recursive:true});
const temporary = physical || cuttlefish ? fs.mkdtempSync(path.join(path.dirname(destination), physical ? '.pixel10a-stage-' : '.cuttlefish-stage-')) : null;
const output = physical || cuttlefish ? path.join(temporary, 'overlay') : destination;
try {
execFileSync(
  "node",
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
// Phone, Contacts or SMS (P-36). Development and production images both declare it; test-mocks APKs
// were refused above, and a sideloaded APK never has the system-partition install. The shared
// Pixel 10a composition declares it for every brand, so only the other products write it here.
if (!physical) {
  const capability = writeImageCapability(output, identity.appId);
  console.log(`Image capability: ${Object.keys(capability).find(name => name !== "productMakefile")}.`);
}
writeSecureCameraOverlay(output, cameraSource);
if (production) {
  const components = provisioningComponents(tree, identity.appId);
  writeProvisioningOverlay(output, identity.appId, components);
  // The shared Pixel 10a composition writes the same overlay from products/pixel10a-alpha.json.
  if (!physical) writeAospCapabilityOverlay(output, identity.appId);
  console.log(`Provisioning overlay: HOME ${components.home}, assistant ${identity.appId}, Autofill ${components.autofill}.`);
}
if (listenerApk) {
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
  const listenerCert = execFileSync(tool("apksigner"), ["verify", "--print-certs", listenerApk], { encoding: "utf8", env });
  const listenerSigner = /Signer #1 certificate SHA-256 digest:\s*([a-fA-F0-9]+)/.exec(listenerCert)?.[1]?.toLowerCase();
  const dump = execFileSync(tool("aapt"), ["dump", "permissions", listenerApk], { encoding: "utf8", env, maxBuffer: 16 << 20 });
  // The privileged APK is pinned like the launcher: reviewed bytes and signer, not just a name.
  const listenerHash = createHash("sha256").update(fs.readFileSync(listenerApk)).digest("hex");
  if (listenerDescriptor)
    checkListenerDescriptor(JSON.parse(fs.readFileSync(listenerDescriptor, "utf8")), { appId: identity.appId, apkSha256: listenerHash, signer: listenerSigner });
  // A listener without its speech model can never listen; production refuses it.
  const voiceHost = JSON.parse(fs.readFileSync(VOICE_HOST_RECORD, "utf8"));
  const entries = execFileSync("unzip", ["-Z1", listenerApk], { encoding: "utf8", maxBuffer: 64 << 20 }).split(/\r?\n/).filter(Boolean);
  try {
    const packaged = checkListenerSpeechBundle(entries, voiceHost, entry => execFileSync("unzip", ["-p", listenerApk, entry], { encoding: "utf8", maxBuffer: 1 << 20 }));
    checkListenerSpeechNatives(packaged, voiceHost, entry => createHash("sha256").update(execFileSync("unzip", ["-p", listenerApk, entry], { maxBuffer: 256 << 20 })).digest("hex"), file => JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (problem) {
    if (production) throw new Error(`Refusing ${listenerApk}: ${problem.message}`);
    console.warn(`Development listener: ${problem.message}. It will report SPEECH_UNAVAILABLE on the image.`);
  }
  stageListener({ root: process.cwd(), output, apk: listenerApk, dump, signer: listenerSigner, launcherSigner: String(reviewed.certificateSha256 ?? "").toLowerCase(), appId: identity.appId });
  console.log(`Always-on listener staged: ${identity.appId}.sense (privileged, no network). Grants, indicator and invocation are image-boot evidence, not staging evidence.`);
}
if (cuttlefish) writeCuttlefishNatives({root:process.cwd(), output, apk, module:identity.moduleName});
if (physical) {
  writePixel10aProduct({root:process.cwd(), output, apk, identity, launcher:reviewed, sourceEvidence:physicalSource, production, bootAnimation:get('--boot-animation'), vendorApi});
}
if (physical || cuttlefish) {
  if (fs.existsSync(destination)) throw Error('Output appeared during staging: ' + destination);
  fs.renameSync(output, destination);
}
console.log(
  `Add under vendor/${identity.slug.replaceAll("-", "_")} and inherit product.mk from the selected AOSP product. This is staging evidence, not an image boot.`,
);
} finally { if (temporary) fs.rmSync(temporary, {recursive:true, force:true}); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
