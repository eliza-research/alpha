import { cuttlefishOptions, writeCuttlefishNatives } from './aosp-cuttlefish.mjs';
import { verifyPixel10aSource, defaultLockPath } from './pixel10a-source-contract.mjs';
import { pixel10aOptions, pixel10aProductProblems, writePixel10aProduct, PIXEL10A_PRODUCT } from './aosp-pixel10a.mjs';
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
import { loadProfile } from "../vendor/eliza/packages/os/scripts/android/verify-source-lock.ts";
import { loadBrandConfig } from "../vendor/eliza/packages/os/scripts/android/brand-config.ts";

export const PRODUCT_DESCRIPTOR = "android/aosp/product.json";
export const AOSP_TARGETS = Object.freeze(["cuttlefish_x86_64", "cuttlefish_arm64"]);
const HEX64 = /^[0-9a-f]{64}$/;

/** JSON paths whose string value is unset or a placeholder. */
function placeholders(value, at = "") {
  if (typeof value === "string") return /^(unset|todo|tbd)$/i.test(value.trim()) || /placeholder/i.test(value) ? [at || "(value)"] : [];
  if (Array.isArray(value)) return value.flatMap((item, index) => placeholders(item, `${at}[${index}]`));
  if (value && typeof value === "object") return Object.entries(value).filter(([key]) => key !== "description").flatMap(([key, item]) => placeholders(item, at ? `${at}.${key}` : key));
  return [];
}

/**
 * Problems that keep the Alpha AOSP product from production staging, read from `root`: the
 * product descriptor, its brand config (upstream brand-config schema), its source-lock profile
 * (upstream verify-source-lock schema), the Cuttlefish host package hashes and the reviewed
 * signer. An empty list means the lock is complete; it says nothing about an image build or boot.
 */
export function aospProductLockProblems(root = process.cwd()) {
  const at = rel => path.join(root, rel);
  const read = rel => JSON.parse(fs.readFileSync(at(rel), "utf8"));
  if (!fs.existsSync(at(PRODUCT_DESCRIPTOR))) return [`${PRODUCT_DESCRIPTOR} is missing`];
  const problems = [];
  let product;
  try { product = read(PRODUCT_DESCRIPTOR); } catch (error) { return [`${PRODUCT_DESCRIPTOR} is unreadable: ${error.message}`]; }
  if (product.schema !== 1) problems.push(`${PRODUCT_DESCRIPTOR}: schema must be 1`);
  for (const field of placeholders(product)) problems.push(`${PRODUCT_DESCRIPTOR}: ${field} is unset or a placeholder`);
  if (!AOSP_TARGETS.includes(product.target)) problems.push(`${PRODUCT_DESCRIPTOR}: target must be one of ${AOSP_TARGETS.join(", ")}`);
  const identity = read("app.config.json");
  // Brand config through the pinned upstream loader (required fields, architecture, lock path).
  let brand = null;
  if (typeof product.brandConfig !== "string" || !product.brandConfig.startsWith("android/aosp/")) problems.push(`${PRODUCT_DESCRIPTOR}: brandConfig must name a file under android/aosp/`);
  else {
    try { brand = loadBrandConfig(at(product.brandConfig)); } catch (error) { problems.push(`${product.brandConfig}: ${error.message}`); }
    if (brand) {
      for (const field of placeholders(brand)) problems.push(`${product.brandConfig}: ${field} is unset or a placeholder`);
      if (brand.packageName !== identity.appId) problems.push(`${product.brandConfig}: packageName ${brand.packageName} is not ${identity.appId}`);
      if (brand.productName !== product.product) problems.push(`${product.brandConfig}: productName ${brand.productName} is not ${product.product}`);
      if (brand.aospLockProfile !== product.sourceLock?.profile) problems.push(`${product.brandConfig}: aospLockProfile is not the descriptor's source-lock profile`);
      if (brand.aospLockPath !== product.sourceLock?.file) problems.push(`${product.brandConfig}: aospLockPath is not the descriptor's source lock`);
    }
  }
  // Source lock through the pinned upstream loader (manifest url, tag and full object IDs).
  const lockFile = product.sourceLock?.file, profileName = product.sourceLock?.profile;
  if (typeof lockFile !== "string" || !lockFile.startsWith("android/aosp/") || !fs.existsSync(at(lockFile))) problems.push(`${PRODUCT_DESCRIPTOR}: sourceLock.file must name an existing lock under android/aosp/`);
  else if (Object.values(product.separateLocks ?? {}).includes(lockFile)) problems.push(`${lockFile} is a separate product's lock; it is not admitted for the Cuttlefish product`);
  else {
    const lock = read(lockFile);
    if (lock.admitted === false) problems.push(`${lockFile} is not admitted`);
    let profile = null;
    try { profile = loadProfile(profileName, at(lockFile)); } catch (error) { problems.push(`${lockFile}: ${error.message}`); }
    for (const field of placeholders(lock.profiles?.[profileName] ?? {})) problems.push(`${lockFile}: profiles.${profileName}.${field} is unset or a placeholder`);
    if (profile && profile.kind !== "virtual") problems.push(`${lockFile}: profile ${profileName} is a ${profile.kind} device; only the Cuttlefish product is admitted`);
    if (profile && !(profile.supportedProducts ?? []).includes(product.product)) problems.push(`${lockFile}: profile ${profileName} does not list ${product.product}`);
  }
  const hosts = Array.isArray(product.hostPackages) ? product.hostPackages : [];
  if (!hosts.length) problems.push(`${PRODUCT_DESCRIPTOR}: hostPackages lists no Cuttlefish host package`);
  for (const pkg of hosts) if (!pkg?.name || !pkg?.version || !HEX64.test(pkg?.sha256 ?? "")) problems.push(`${PRODUCT_DESCRIPTOR}: host package ${pkg?.name ?? "(unnamed)"} needs a version and a SHA-256`);
  // The reviewed signer: the APK release signer descriptor and the image platform certificate.
  if (product.signer?.apkDescriptor !== "android/release-signer.json") problems.push(`${PRODUCT_DESCRIPTOR}: signer.apkDescriptor must be android/release-signer.json`);
  else {
    const signer = read(product.signer.apkDescriptor).signerSha256;
    if (!HEX64.test(signer ?? "")) problems.push(`android/release-signer.json signerSha256 is ${JSON.stringify(signer)}, not a reviewed release certificate`);
  }
  if (!HEX64.test(product.signer?.platformCertificateSha256 ?? "")) problems.push(`${PRODUCT_DESCRIPTOR}: signer.platformCertificateSha256 must be a SHA-256`);
  return [...new Set(problems)];
}
import { VOICE_HOST_RECORD, checkListenerDescriptor, checkListenerSpeechBundle, checkListenerSpeechNatives, stageListener } from "./aosp-listener.mjs";

/**
 * Refuse inputs that must never reach an image: anything from the separate
 * test-mocks build, APKs whose packaged web bundle was built with test mocks,
 * and releases verify-apks recorded as non-distributable. Production staging
 * additionally requires a verified distributable release from apk-manifest.json.
 */
function admitApk({ apk, hash, development, manifestFile, platformCertificateSha256 }) {
  const testMocksDir = path.resolve("artifacts/test-mocks");
  const real = fs.realpathSync(apk);
  for (const candidate of [path.resolve(apk), real]) {
    const relative = path.relative(testMocksDir, candidate);
    if (!relative.startsWith("..") && !path.isAbsolute(relative))
      throw new Error(`Refusing ${apk}: artifacts/test-mocks/ builds are never staged into an image.`);
  }
  let flags;
  try {
    flags = JSON.parse(execFileSync("unzip", ["-p", apk, "assets/public/build-flags.json"], { encoding: "utf8" }));
  } catch {
    throw new Error(`Refusing ${apk}: its web bundle has no assets/public/build-flags.json, so its test-mocks flag is unverified.`);
  }
  if (flags.testMocks !== false)
    throw new Error(`Refusing ${apk}: its web bundle was built with test mocks enabled.`);
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : null;
  const entry = manifest?.results?.find(row => row.sha256 === hash) ?? null;
  if (entry && (manifest.testMocks === true || entry.testMocks === true))
    throw new Error(`Refusing ${apk}: ${manifestFile} records it as a test-mocks build.`);
  // Every unresolved blocker verify-apks recorded for a release (signing, runtime, speech,
  // the proprietary-font check, test mocks) is named; a release is never staged while one remains.
  // Open-source licence flags (licenceFlags) are a record, never a blocker (decision P-09).
  // Production judges the row against the committed release signer now, not only the admission
  // verify-apks recorded, and requires the reviewed image platform certificate.
  const current = development ? {} : { releaseSigner: readReleaseSigner(), image: { platformCertificateSha256 } };
  const blockers = entry?.mode === "release" || entry?.distributable !== undefined
    ? releaseBlockers(entry, { manifestTestMocks: manifest.testMocks, ...current }) : [];
  if (entry && (entry.distributable === false || (entry.mode === "release" && blockers.length)))
    throw new Error(`Refusing ${apk}: ${manifestFile} records this release as not distributable (runtime ${entry.runtime ?? "unknown"}, ${entry.signed ? "signed" : "unsigned"}). Unresolved blockers:\n${blockers.map(item => `  - ${item}`).join("\n")}`);
  if (!development && !(entry && entry.mode === "release" && entry.distributable === true && blockers.length === 0))
    throw new Error(`Production staging requires a release APK that verify-apks recorded as distributable in ${manifestFile}.`);
  // --development is for debug builds. A release reaches an image only through its distributable
  // manifest row (checked above), so an APK without that row must itself be a debuggable build:
  // a missing manifest, a row for other bytes or a row relabelled "debug" admits no release.
  if (development && entry?.mode !== "release") {
    let debuggable;
    try {
      debuggable = /android:debuggable[^\n]*0xffffffff/.test(execFileSync(tool("aapt"), ["dump", "xmltree", apk, "AndroidManifest.xml"], { encoding: "utf8", env: androidEnv(), maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] }));
    } catch {
      throw new Error(`Refusing ${apk}: --development stages debug builds only, and this APK's build type could not be read.`);
    }
    if (!debuggable)
      throw new Error(`Refusing ${apk}: --development stages debug builds only. This is a release build that ${manifestFile} does not record as distributable.`);
  }
}
/**
 * Source overrides the secure-camera source check admits. Pixel and Cuttlefish images are built from the same
 * reviewed Android 17 tree, so both admit exactly its hash-pinned overrides; other development staging admits none.
 */
export function reviewedSourceOverrides({physicalSource = null, cuttlefish = false, lockPath = defaultLockPath} = {}) {
  if (!physicalSource && !cuttlefish) return [];
  const lockBytes = fs.readFileSync(lockPath);
  if (physicalSource && createHash('sha256').update(lockBytes).digest('hex') !== physicalSource.sourceLockSha256) throw Error('Pixel source lock changed during staging');
  return JSON.parse(lockBytes).overrides;
}

async function main(args) {
const get = (key) => {
  const i = args.indexOf(key);
  return i < 0 ? null : args[i + 1];
};
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--development" || args[i] === "--production") continue;
  if (
    !["--apk", "--output", "--descriptor", "--apk-manifest", "--aosp-source", "--listener-apk", "--listener-descriptor", "--target", "--factory-image"].includes(args[i]) ||
    !args[i + 1] ||
    args[i + 1].startsWith("--")
  )
    throw new Error(
      "Use --apk FILE --output NEW_DIR [--descriptor FILE [--production] | --development] [--apk-manifest FILE] [--aosp-source PATH] [--target cuttlefish | --target pixel10a --factory-image FILE (--development | --production --descriptor FILE)] [--listener-apk FILE [--listener-descriptor FILE]]",
    );
  i++;
}
const development = args.includes("--development");
// --production adds the provisioning overlay (default HOME, assistant role, Autofill
// offer). It needs a reviewed descriptor and a distributable release, so it is
// refused until a signed, PACKAGED, qualified release APK exists.
const production = args.includes("--production");
const cuttlefish = cuttlefishOptions({target:get('--target'), source:get('--aosp-source'), factory:get('--factory-image')});
const physical = pixel10aOptions({target:cuttlefish ? null : get('--target'), development, production, source:get('--aosp-source'), factory:get('--factory-image')});
if (production && development) throw new Error("--production and --development are exclusive");
// The product lock is checked before any source or APK is read: production never stages into an
// unset product. Pixel 10a has its own production descriptor; the Cuttlefish product its own lock.
if (production) {
  const problems = physical ? pixel10aProductProblems(process.cwd()) : aospProductLockProblems(process.cwd());
  const name = physical ? `Pixel 10a production product (${PIXEL10A_PRODUCT})` : "Alpha AOSP product lock";
  if (problems.length) throw new Error(`Refusing production staging: the ${name} is incomplete.\n${problems.map(item => `  - ${item}`).join("\n")}`);
}
const platformCertificateSha256 = production ? JSON.parse(fs.readFileSync(physical ? PIXEL10A_PRODUCT : PRODUCT_DESCRIPTOR, "utf8")).signer?.platformCertificateSha256 : undefined;
const physicalSource = physical ? await verifyPixel10aSource({source:get('--aosp-source'), factory:get('--factory-image')}) : null;
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
const cameraOverrides = reviewedSourceOverrides({physicalSource, cuttlefish});
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
// were refused above, and a sideloaded APK never has the system-partition install.
const capability = writeImageCapability(output, identity.appId);
console.log(`Image capability: ${Object.keys(capability).find(name => name !== "productMakefile")}.`);
writeSecureCameraOverlay(output, cameraSource);
if (production) {
  const components = provisioningComponents(tree, identity.appId);
  writeProvisioningOverlay(output, identity.appId, components);
  writeAospCapabilityOverlay(output, identity.appId);
  console.log(`Provisioning overlay: HOME ${components.home}, assistant ${identity.appId}, Autofill ${components.autofill}.`);
}
if (listenerApk) {
  // Debuggable listener builds are development-only; a production image takes a release build.
  if (!development) {
    let debuggable;
    try {
      debuggable = /android:debuggable[^\n]*0xffffffff/.test(execFileSync(tool("aapt"), ["dump", "xmltree", listenerApk, "AndroidManifest.xml"], { encoding: "utf8", env, maxBuffer: 64 << 20 }));
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
  writePixel10aProduct({root:process.cwd(), output, apk, identity, sourceEvidence:physicalSource, production});
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
