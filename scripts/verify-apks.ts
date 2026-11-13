/**
 * Verify the launcher APKs of one build and record the result in apk-manifest.json.
 *
 *   bun scripts/verify-apks.ts [--signer-api-level=N] [--cloud-voice-evidence=FILE]
 *
 * The APKs in artifacts/ must be flag-off (testMocks:false), pass the shared production
 * bundle audit, carry no development hooks and package the authenticated resident runtime
 * and on-device voice.
 *
 * Licences (decision P-09): open-source licences never fail verification and never
 * make a release distributable:false. Every flagged entry of the packaged notices
 * (copyleft, unknown, unverified, missing licence text, proprietary font) is
 * recorded per APK in `licenceFlags` and printed as a LICENCE FLAG warning. The one
 * separately named check, unresolved-font-licence (proprietary fonts), is always
 * recorded in `fontLicenceCheck`: `resolved` lists fonts covered by the owner's
 * statement in licenses/font-licenses.json (the Denton typeface), `items` lists
 * fonts with no record. Unresolved items are copied to `licenceBlockers` and keep
 * a release distributable:false only while
 * UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION (scripts/licence-policy.ts) is true.
 * App Links: each row records `appLinks` ({present, hosts}), the https autoVerify filters in
 * the packaged manifest: the configured production web host.
 * Every http/https VIEW filter in the merged manifest must be in an exact allowed set
 * (webViewFiltersAllowed below); an extra or missing filter fails verification.
 * This is APK-build evidence only; it does not install or run anything.
 */
import fs from "node:fs";
import {renderSensePermissions} from "../vendor/eliza/packages/os/scripts/android/pixel10a-product.ts";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {sha256, sha256File} from "./sha256.ts";
import { CLOUD_DEPLOYMENT } from "./cloud-deployment-policy.ts";
import { readUpstreamPin } from "./upstream-pin.ts";
import {apkUpdateChannel,validateUpdateChannel} from './update-channel.ts';
import type {UpdateChannel} from './update-channel.ts';
import {nativeCartesiaBlockers, releaseDistributable} from './release-distributable.ts';
import {
  auditBundle, distributionProblems, extractWebPayload, parseXmlTree, readBuildFlags, signerDigest, validateApk, verifyOwnerRouteTable,
} from "./apk.ts";
import type {ApkMode, ApkVariant} from "./apk.ts";
import { androidEnv, tool } from "./toolchain.ts";
import { readApkEntries } from "../vendor/eliza/packages/app/scripts/mobile/artifact-inspection/apk-distribution.mjs";
import { readReleaseSigner, releaseAdmission, RELEASE_SIGNER_FILE, SIGNING_ENV } from "./build-android.ts";
import { BUN_ENTRY } from "./generate-licenses.ts";
import { fontLicenceCheck, fontLicenceLine } from "./font-license-blockers.ts";
import { licenceFlagLines, licenceFlagRecords } from "./licence-policy.ts";
import { packagedGzipProblems } from "./android-gzip-assets.ts";
import { appLinkFilters, requiredAppLinkProblems, webViewFilterProblems } from "./render-assetlinks.ts";
import { readVoiceHost, voiceBundleAdmission } from "./voice-host.ts";
import {embeddingApkProblems,type EmbeddingManifest} from './stage-embedding-host.ts';
import {readNativeBuildReceipt} from './native-build-inputs.ts';
import { apkPermissions, checkListenerPermissions, checkListenerSpeechBundle, listenerPackage } from "./aosp-listener.ts";

import {cloudVoiceAdmission} from '../vendor/eliza/packages/os/scripts/android/apk-release-record.mjs';
import { preparePatchedNative, nativePatchReceipt, verifyNativePatchReceipt } from './prepare-patched-native.ts';
const USAGE = "Usage: bun scripts/verify-apks.ts [--signer-api-level=N] [--cloud-voice-evidence=FILE]";
interface RuntimePackaging {
  apk: string;
  runtime: "PACKAGED";
  distributable?: boolean;
}
interface BuildRecord {
  updateChannel?: unknown;
  runtimeProfile?: string;
  localEmbeddings?: boolean;
  testMocks?: boolean;
  mapsProvider?: string;
}
type ApkInspection = ReturnType<typeof validateApk>;
type RuntimeVoiceHost = ReturnType<typeof voiceHostAdmission>;
type VerificationRow = Omit<ApkInspection, "badging" | "xml" | "names" | "dexClasses" | "removedSpeechClasses"> & {
  variant: ApkVariant;
  mode: ApkMode;
  updateChannel: UpdateChannel;
  versionCode: number | null;
  versionName: string | null;
  signed: boolean;
  signerSha256: string | null;
  signerApiLevel: number | null;
  exportedComponents: string[];
  appLinks: ReturnType<typeof appLinkFilters>;
  testMocks: boolean | null;
  bundleAudit: "failed" | "passed";
  runtimeNotices: boolean;
  licenceFlags: ReturnType<typeof licenceFlagRecords>;
  fontLicenceCheck: Omit<ReturnType<typeof fontLicenceCheck>, "blockers">;
  licenceBlockers: string[];
  runtimeProfile?: "native";
  releaseAdmission?: ReturnType<typeof releaseAdmission>;
  runtime?: RuntimePackaging["runtime"];
  voiceHost?: RuntimeVoiceHost;
  cloudVoice?: ReturnType<typeof cloudVoiceAdmission>;
  distributable?: boolean;
};
const variant: ApkVariant = "launcher";
const modes = ["debug", "release"] as const;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const args = process.argv.slice(2);
for (const arg of args)
  if (!/^--signer-api-level=[1-9][0-9]*$/.test(arg) && !/^--cloud-voice-evidence=.+$/.test(arg)) throw new Error(`Unknown option ${arg}. ${USAGE}`);
// Artifact signing admission is explicitly scoped to this Android API. Device
// install/update independently verify the certificate applicable to the actual device.
const signerApiArgs = args.filter(arg => arg.startsWith("--signer-api-level="));
if (signerApiArgs.length > 1) throw new Error("Specify --signer-api-level only once");
const signerApiLevel = signerApiArgs.length ? Number(signerApiArgs[0].split("=")[1]) : undefined;
if (signerApiLevel !== undefined && !Number.isSafeInteger(signerApiLevel)) throw new Error("Invalid signer API level");
// The one profile's name in records; a build record naming another profile is refused below.
const runtimeProfile="native";
// Optional Cloud speech (Cartesia) evidence for these exact release bytes. When supplied it is
// recorded and must pass; on-device voice is required of every distributable release regardless.
const cloudEvidenceArgs=args.filter(arg=>arg.startsWith('--cloud-voice-evidence='));
if(cloudEvidenceArgs.length>1)throw Error('Specify --cloud-voice-evidence only once');
const directory = "artifacts";
const manifestFile = path.join(directory, "apk-manifest.json");
// Never leave an older passing manifest beside APKs that failed verification.
fs.rmSync(manifestFile, { force: true });
let cloudEvidence: unknown, cloudEvidenceSha256: string | undefined;
if(cloudEvidenceArgs.length){
  try {
    const bytes=fs.readFileSync(cloudEvidenceArgs[0].slice('--cloud-voice-evidence='.length));
    cloudEvidence=JSON.parse(bytes.toString('utf8'));
    cloudEvidenceSha256=sha256(bytes);
  } catch { throw Error('Cloud voice evidence could not be read as JSON'); }
}

const identity = JSON.parse(fs.readFileSync("app.config.json", "utf8"));
const callbackHost = new URL(CLOUD_DEPLOYMENT.production.web).hostname;
// The only web VIEW filters an APK may carry: the main manifest's two returns on the production web
// host (android/app/product.gradle supplies appLinkHost). Add a new app link here deliberately.
const mainActivity = `${identity.appId}.MainActivity`;
const webViewFiltersAllowed = [
  `${mainActivity} https://${callbackHost}/alphaphone/auth/callback`,
  `${mainActivity} https://${callbackHost}/alphaphone/gmail/callback`,
];
const buildRecordFile = path.join(directory, "build-config.json");
if (!fs.existsSync(buildRecordFile)) throw new Error(`Missing ${buildRecordFile}. Run bun run android:build first.`);
const buildRecord: BuildRecord = JSON.parse(fs.readFileSync(buildRecordFile, "utf8"));
const updateChannel=validateUpdateChannel(buildRecord?.updateChannel);
if(updateChannel.manifestUrlSha256!==sha256(identity.updateManifestUrl))throw Error('Public update channel differs from source configuration');
if((buildRecord?.runtimeProfile||"native")!==runtimeProfile||buildRecord?.localEmbeddings!==undefined)throw Error("Build record names a removed runtime profile; rebuild (there is one profile now)");
if (buildRecord.testMocks !== false)
  throw new Error(`${buildRecordFile} records testMocks=${buildRecord.testMocks}; an APK build is always flag-off`);

const admittedNativePatches = preparePatchedNative();

function releaseFile(dir: string) {
  const signed = path.join(dir, `${variant}-release.apk`);
  const unsigned = path.join(dir, `${variant}-release-unsigned.apk`);
  const present = [signed, unsigned].filter(file => fs.existsSync(file));
  if (present.length !== 1)
    throw new Error(`Expected exactly one ${variant} release APK in ${dir}, found ${present.length ? present.join(", ") : "none"}`);
  return { file: present[0], signed: present[0] === signed };
}

/** The packaged voice bundle and engine libraries against qualified-voice-host.json (scripts/voice-host.ts). */
function voiceHostAdmission(file: string, names: string[]) {
  return voiceBundleAdmission({ names, read: (entry: string) => execFileSync("unzip", ["-p", file, entry], { maxBuffer: 1536 * 1024 * 1024 }) }, () => readVoiceHost("."));
}
const embeddingManifest:EmbeddingManifest=readNativeBuildReceipt('.')?.embedding as EmbeddingManifest ?? JSON.parse(fs.readFileSync('android/embedding-host/qualified-host.json','utf8'));

const results: VerificationRow[] = [];
const failures: string[] = [];
const flagLines = new Set<string>();
const entriesByApk = new Map<string, string[]>();
for (const mode of modes) {
    const { file, signed } = mode === "release"
      ? releaseFile(directory)
      : { file: path.join(directory, `${variant}-debug.apk`), signed: true };
    if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
    const d = validateApk(file, identity);
    if (d.debuggable !== (mode === "debug"))
      throw new Error(`Wrong debug flag: ${file}`);
    const { facts, problems } = distributionProblems(d, { mode });
    const tree = parseXmlTree(d.xml);
    try{
      const compiled=apkUpdateChannel(tree);
      if(compiled.kind!==updateChannel.kind||compiled.manifestUrlSha256!==updateChannel.manifestUrlSha256)problems.push('Compiled APK update channel differs from build evidence');
    }catch{problems.push('Compiled APK update channel could not be verified');}
    problems.push(...requiredAppLinkProblems(tree, {
      host: callbackHost, path: '/alphaphone/auth/callback', activity: `${identity.appId}.MainActivity`,
    }));
    problems.push(...webViewFilterProblems(tree, webViewFiltersAllowed));
    // Shared web bundle audit on the exact packaged payload.
    const payload = extractWebPayload(file);
    let flags: ReturnType<typeof readBuildFlags> | undefined;
    // A PACKAGED distribution must ship notices regenerated with --packaged-runtime (Bun and
    // the bundled agent/worker packages); the committed notices carry only the umbrella entry.
    let runtimeNotices = false;
    // The font check is recorded in full; only its `blockers` (policy constant) affect distributable.
    let fontCheck: ReturnType<typeof fontLicenceCheck>;
    try { fontCheck = fontLicenceCheck(payload.public); }
    catch (error) { const items = [`font licence check failed: ${message(error)}`]; fontCheck = { ...fontLicenceCheck(path.join(payload.root, "absent")), status: "unresolved", items, blockers: items }; }
    const licenceBlockers = fontCheck.blockers;
    // Flags are a record of the packaged notices. They are never a blocker.
    let licenceFlags: ReturnType<typeof licenceFlagRecords> = [];
    try {
      const notices = path.join(payload.public, "licenses", "third-party-notices.json");
      const entries = fs.existsSync(notices) ? JSON.parse(fs.readFileSync(notices, "utf8")) : [];
      runtimeNotices = Array.isArray(entries) && entries.some(entry => entry?.name === BUN_ENTRY);
      licenceFlags = licenceFlagRecords(entries);
      for (const line of licenceFlagLines(entries)) flagLines.add(line);
    } catch { runtimeNotices = false; }
    try {
      flags = readBuildFlags(payload.public);
      if (Object.hasOwn(flags, "runtimeProfile")) problems.push("Packaged web bundle names a removed runtime profile");
      if (flags.testMocks !== false)
        problems.push(`Packaged web bundle has testMocks=${flags.testMocks}; an APK packages only a flag-off bundle`);
      auditBundle(payload.public);
      // The asset merger unpacks *.gz; the scan engine needs its model under the published name.
      problems.push(...packagedGzipProblems(payload.public));
    } catch (error) {
      problems.push(message(error));
    } finally {
      fs.rmSync(payload.root, { recursive: true, force: true });
    }
    try { verifyNativePatchReceipt(execFileSync('unzip', ['-p', file, 'assets/native-patches.json'], {encoding:'utf8',stdio:['ignore','pipe','pipe']}), admittedNativePatches); }
    catch (error) { problems.push(`Native patch provenance: ${message(error)}`); }
    try { verifyOwnerRouteTable(file); }
    catch (error) { problems.push(`Owner route table: ${message(error)}`); }
    problems.push(...embeddingApkProblems({names:d.names,read:entry=>execFileSync('unzip',['-p',file,entry],{maxBuffer:256*1024*1024})},embeddingManifest));
    let signerSha256: string | null = null;
    if (signed) {
      try { signerSha256 = signerDigest(file, {apiLevel: signerApiLevel}); }
      catch (error) { problems.push(`apksigner verify failed for ${file}: ${message(error)}`); }
    }
    if (problems.length) failures.push(`${file}:\n  - ${problems.join("\n  - ")}`);
    const { badging, xml, names, dexClasses, removedSpeechClasses, ...record } = d;
    entriesByApk.set(file, names);
    results.push({
      ...record,
      variant,
      mode,
      updateChannel,
      versionCode: facts.versionCode,
      versionName: facts.versionName,
      signed,
      signerSha256,
      signerApiLevel: signerApiLevel ?? null,
      exportedComponents: facts.exported.map(component => component.name).sort(),
      appLinks: appLinkFilters(xml),
      testMocks: flags?.testMocks ?? null,
      bundleAudit: problems.length ? "failed" : "passed",
      runtimeNotices,
      licenceFlags,
      fontLicenceCheck: { check: fontCheck.check, status: fontCheck.status, blocksDistribution: fontCheck.blocksDistribution, items: fontCheck.items, resolved: fontCheck.resolved },
      licenceBlockers,
    });
  }
if (failures.length)
  throw new Error(`APK distribution verification failed:\n${failures.join("\n")}`);

// One product version across the debug and release APKs, matching an explicit override.
const versions = new Set(results.map(row => `${row.versionCode}/${row.versionName}`));
if (versions.size !== 1) throw new Error(`APK versions differ: ${[...versions].join(", ")}`);
const { versionCode, versionName } = results[0];
if (process.env.ELIZAOS_VERSION_CODE && String(versionCode) !== process.env.ELIZAOS_VERSION_CODE)
  throw new Error(`versionCode ${versionCode} does not match ELIZAOS_VERSION_CODE=${process.env.ELIZAOS_VERSION_CODE}`);
if (process.env.ELIZAOS_VERSION_NAME && versionName !== process.env.ELIZAOS_VERSION_NAME)
  throw new Error(`versionName ${versionName} does not match ELIZAOS_VERSION_NAME=${process.env.ELIZAOS_VERSION_NAME}`);

const release = results.filter(row => row.mode === "release");

// A release is distributable only when signed by the committed release signer with
// a versionCode above the last recorded release. A mismatch fails verification.
const releaseSigner = readReleaseSigner();
for (const row of release) {
  row.runtimeProfile = runtimeProfile;
  row.releaseAdmission = releaseAdmission(row, releaseSigner);
  if (row.releaseAdmission.failures.length)
    throw new Error(`Release signing admission failed for ${row.file}: ${row.releaseAdmission.failures.join("; ")}`);
}

// Every APK packages the authenticated resident runtime.
let runtimeOutput: string;
try {
  runtimeOutput = execFileSync("python3", ["scripts/verify-packaged-runtime.py", ...release.flatMap(row => ["--release", row.file]), ...results.filter(row => row.mode === "debug").map(row => row.file)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (error) {
  const stdout = error instanceof Error && "stdout" in error ? error.stdout : "";
  const stderr = error instanceof Error && "stderr" in error ? error.stderr : "";
  throw new Error(`Packaged runtime verification failed:\n${stdout ?? ""}${stderr ?? ""}`);
}
const runtimePackaging: RuntimePackaging[] = JSON.parse(runtimeOutput);
const runtimeByApk = new Map(runtimePackaging.map(entry => [entry.apk, entry]));
function checkedRuntime(file: string) {
  const runtime = runtimeByApk.get(file);
  if (!runtime) throw new Error(`Missing packaged runtime verification for ${file}`);
  return runtime;
}
function checkedVoiceHost(file: string) {
  const names = entriesByApk.get(file);
  if (!names) throw new Error(`Missing inspected APK entries for ${file}`);
  const voiceHost = voiceHostAdmission(file, names);
  if (voiceHost.differences.length)
    throw new Error(`On-device voice in ${file} is not admitted:\n  - ${voiceHost.differences.join("\n  - ")}`);
  return voiceHost;
}
for (const row of release) {
  if (!row.releaseAdmission) throw new Error(`Missing release signing admission for ${row.file}`);
  const runtime = checkedRuntime(row.file);
  row.runtime = runtime.runtime;
  // Signing is recorded separately (row.signed). The packaged voice
  // bundle must match android/voice-host/qualified-voice-host.json byte for byte.
  // A supplied Cloud speech receipt must also pass for these exact APK bytes.
  row.voiceHost = checkedVoiceHost(row.file);
  if (row.voiceHost.differences.length)
    throw new Error(`On-device voice in ${row.file} is not admitted:\n  - ${row.voiceHost.differences.join("\n  - ")}`);
  const cartesia = cloudEvidenceSha256 === undefined ? undefined : {
    apkSha256: row.sha256,
    admission: cloudVoiceAdmission(row.sha256, cloudEvidence, cloudEvidenceSha256),
  };
  if (cartesia) row.cloudVoice = cartesia.admission;
  // releaseDistributable requires packaged on-device voice with ASR (voiceHost.packaged and .asr).
  row.distributable = releaseDistributable({signed: row.signed, releaseAdmission: row.releaseAdmission,
      runtime, runtimeNotices: row.runtimeNotices, voiceHost: row.voiceHost, licenceBlockers: row.licenceBlockers, cartesia});
}
for (const row of results.filter(row => row.mode === "debug")) {
  row.runtime = checkedRuntime(row.file).runtime;
  row.voiceHost = checkedVoiceHost(row.file);
}

// Inspect the separate image-only listener APKs when they are present beside the app APKs.
function listenerFacts(file: string, mode: ApkMode, signed: boolean) {
  const facts: {
    file: string; mode: ApkMode; signed: boolean; sha256: string;
    signerSha256?: string | null; permissionProblem?: string;
    packageName?: string | null; requested?: string[];
    voiceBundle?: {packaged: boolean; abis?: ReturnType<typeof checkListenerSpeechBundle>; problem?: string};
  } = { file, mode, signed, sha256: sha256File(file) };
  if (signed) {
    try { facts.signerSha256 = signerDigest(file, {apiLevel: signerApiLevel}); }
    catch (error) { facts.permissionProblem = `apksigner verify failed: ${message(error)}`; }
  }
  const dump = execFileSync(tool("aapt"), ["dump", "permissions", file], { encoding: "utf8", env: androidEnv(), maxBuffer: 16 << 20 });
  Object.assign(facts, apkPermissions(dump));
  try { checkListenerPermissions(dump, renderSensePermissions(identity.appId), listenerPackage(identity.appId)); }
  catch (error) { facts.permissionProblem ??= message(error); }
  const entries = readApkEntries(file);
  try {
    const abis = checkListenerSpeechBundle(entries, readVoiceHost("."), (entry: string) => execFileSync("unzip", ["-p", file, entry], { encoding: "utf8", maxBuffer: 1 << 20 }));
    facts.voiceBundle = { packaged: true, abis };
  } catch (error) { facts.voiceBundle = { packaged: false, problem: message(error) }; }
  const network = (facts.requested ?? []).filter(name => /\.(INTERNET|ACCESS_NETWORK_STATE)$/.test(name));
  return {
    file: facts.file,
    mode: facts.mode,
    sha256: facts.sha256,
    packageName: facts.packageName,
    signed: facts.signed === true,
    signerSha256: facts.signerSha256 ?? null,
    requestedPermissions: [...(facts.requested ?? [])].sort(),
    networkPermission: network.length > 0,
    voiceBundle: facts.voiceBundle,
    evidence: "apk-build",
    problems: [
      facts.packageName !== listenerPackage(identity.appId) && `package ${facts.packageName}, expected ${listenerPackage(identity.appId)}`,
      network.length && `network permission requested: ${network.join(", ")}`,
      facts.permissionProblem,
      facts.voiceBundle?.packaged !== true && `listener voice bundle: ${facts.voiceBundle?.problem ?? "missing"}`,
      facts.signed && !/^[0-9a-f]{64}$/.test(facts.signerSha256 ?? "") && "signed APK without a SHA-256 signer digest",
    ].filter(Boolean),
  };
}
const listenerApks = [["sense-debug.apk", "debug", true], ["sense-release.apk", "release", true], ["sense-release-unsigned.apk", "release", false]] as const;
const listenerRows = listenerApks
  .filter(([name]) => fs.existsSync(path.join(directory, name)))
  .map(([name, mode, signed]) => listenerFacts(path.join(directory, name), mode, signed));
const listenerFailures = listenerRows.filter(row => row.problems.length);
if (listenerFailures.length)
  throw new Error(`Listener APK verification failed:\n${listenerFailures.map(row => `${row.file}:\n  - ${row.problems.join("\n  - ")}`).join("\n")}`);
const listener = { apks: listenerRows };

const mappingFile = path.join(directory, "mapping", `${variant}-release-mapping.txt`);
const mappings = { [variant]: fs.existsSync(mappingFile) ? mappingFile : null };
// The instrumentation APK built with these APKs (scripts/android-instrumentation.ts binds to it).
const instrumentation: Partial<Record<ApkVariant, {file: string; sha256: string}>> = {};
const instrumentationFile = path.join(directory, "instrumentation", `${variant}-androidTest.apk`);
if (fs.existsSync(instrumentationFile)) instrumentation[variant] = { file: instrumentationFile, sha256: sha256File(instrumentationFile) };
let apksignerVersion: string | null = null;
try { apksignerVersion = execFileSync(tool("apksigner"), ["--version"], { encoding: "utf8", env: androidEnv() }).trim(); }
catch { /* recorded as unknown */ }

fs.writeFileSync(
  manifestFile,
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      evidence: "apk-build",
      // Constant fields that provisioning, qualification and release admission compare.
      testMocks: false,
      demoEntryPoints: false,
      allowUnpackagedRuntime: false,
      mapsProvider: "cloud",
      runtimeProfile,
      updateChannel,
      version: { code: versionCode, name: versionName },
      signing: {
        release: release.every(row => row.signed) ? { signed: true, signerSha256: release[0].signerSha256 } : { signed: false },
        debugSignerSha256: results.find(row => row.mode === "debug")?.signerSha256 ?? null,
        apksigner: apksignerVersion,
        apiLevel: signerApiLevel ?? null,
        scope: signerApiLevel === undefined ? "unscoped legacy signer" : "specified Android API; device admission is checked separately",
        descriptor: { file: RELEASE_SIGNER_FILE, signerSha256: releaseSigner.signerSha256, lastReleaseVersionCode: releaseSigner.lastRelease.versionCode },
      },
      mappings,
      instrumentation,
      upstream: readUpstreamPin(process.cwd()),
      nativePatches: nativePatchReceipt(admittedNativePatches),
      results,
      runtimePackaging,
      listener,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify(results, null, 2));
const undistributable = release.filter(row => !row.distributable);
if (undistributable.length)
  console.warn(`Not distributable: ${undistributable.map(row => {
    const cartesia = cloudEvidenceSha256 === undefined ? [] : nativeCartesiaBlockers(row.sha256, row.cloudVoice);
    const blockers = [
      row.runtime !== "PACKAGED" && "no packaged runtime",
      !row.runtimeNotices && "notices lack the packaged runtime (run bun scripts/generate-licenses.ts --packaged-runtime after staging)",
      !row.voiceHost?.packaged && "no on-device voice packaged",
      row.voiceHost?.packaged && !row.voiceHost.asr && "on-device voice has no ASR",
      ...cartesia,
      ...(row.releaseAdmission?.blockers ?? []),
      ...row.licenceBlockers,
    ];
    return `${row.file} (${blockers.filter(Boolean).join(", ")})`;
  }).join("; ")}`);
// Licence flags are warnings: recorded per APK above, printed once here, never a failure.
for (const line of flagLines) console.warn(line);
const fontItems = new Map(release.flatMap(row => [...row.fontLicenceCheck.items, ...row.fontLicenceCheck.resolved].map(item => [item, row.fontLicenceCheck.blocksDistribution] as const)));
for (const [item, blocks] of fontItems) console.warn(fontLicenceLine(item, blocks));
const unsigned = release.filter(row => !row.signed);
if (unsigned.length)
  console.warn(`Unsigned releases (set ${SIGNING_ENV.join(", ")} to sign; android/consumer-host.json names them): ${unsigned.map(row => row.file).join(", ")}`);
console.log(`Verified ${results.length} APKs in ${directory} (APK-build evidence only; not an install, emulator or device result).`);
