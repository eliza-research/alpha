import { serializeOwnerRouteTable } from "../apps/app/src/product/owner-route-table.ts";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { androidEnv, tool } from "./toolchain.ts";
import {
  apkDistributionProblems, extractApkWebPayload, parseApkSignerDigest, readApk, readApkSignerDigest,
} from "../vendor/eliza/packages/app/scripts/mobile/artifact-inspection/apk-distribution.mjs";
import { manifestFacts as readManifestFacts, parseXmlTree as parseAaptTree } from "../vendor/eliza/packages/app/scripts/lib/android-manifest-facts.mjs";

export type ApkMode = "debug" | "release";
export type ApkVariant = "standalone" | "launcher";

export interface ManifestNode {
  name: string;
  attrs: Record<string, string | undefined>;
  children: ManifestNode[];
  indent: number;
}
interface ManifestComponent {
  name: string;
  tag: string;
  exported: boolean;
  permission: string | null;
}
interface ManifestFacts {
  packageName: string | undefined;
  versionCodeText: string | null;
  versionCode: number | null;
  versionName: string | null;
  permissions: string[];
  components: ManifestComponent[];
  exported: ManifestComponent[];
  queriedPackages: string[];
  application: {
    allowBackup: string | null;
    usesCleartextTraffic: string | null;
    networkSecurityConfig: string | null;
    debuggable: string | null;
  };
}
interface DistributionInput {
  xml: string;
  home?: boolean;
  badging?: string;
  names: string[];
  dexClasses?: string[];
  forbiddenDex?: string[];
  removedSpeechClasses?: string[];
}
interface DistributionOptions {mode?: ApkMode; testMocks?: boolean}
interface ApkInspection extends DistributionInput {
  file: string;
  packageName: string | undefined;
  home: boolean;
  launcher: boolean;
  debuggable: boolean;
  webPayload: boolean;
  sha256: string;
  badging: string;
  dexClasses: string[];
  removedSpeechClasses: string[];
}

// Upstream's JS parser builds children and attributes after initialization.
export const parseXmlTree = parseAaptTree as (text: string, options?: {decodeAttribute?: (encoded: string) => string}) => ManifestNode;
export const manifestFacts = readManifestFacts as (xml: string, badging?: string) => ManifestFacts;
const assessDistribution = apkDistributionProblems as (
  apk: DistributionInput, policy: typeof DISTRIBUTION_POLICY, options?: DistributionOptions,
) => {facts: ManifestFacts; problems: string[]};


// Alpha's distribution policy as data for the upstream APK inspection
// (vendor/eliza/packages/app/scripts/mobile/artifact-inspection/apk-distribution.mjs).
// Debug-only native hooks that may exist only in an explicit test-mocks build
// (src/testMocks attached to debug variants when ELIZA_DEV_ALLOW_TEST_MOCKS=1).
export const DEVELOPMENT_CLASSES = Object.freeze([
  "SyntheticAutofillService",
  "DevelopmentAgentPlugin",
  "DevelopmentVoiceCapture",
  "DevelopmentChatContract",
]);
const TELEPHONY_SETUP_RECEIVER = "ai.alphacompute.alphaphone.AlphaTelephonySetupReceiver";
const MANAGE_ROLE_HOLDERS = "android.permission.MANAGE_ROLE_HOLDERS";
// Components a distribution APK may export. Each one must be guarded by the
// listed permission (null: a deliberate public entry point).
export const EXPORTED_COMPONENTS = Object.freeze({
  "ai.alphacompute.alphaphone.MainActivity": null,
  "ai.alphacompute.alphaphone.AlphaAssistActivity": null,
  // Power entry is reserved for platform status-bar callers.
  "ai.alphacompute.alphaphone.AlphaPowerVoiceActivity": "android.permission.STATUS_BAR_SERVICE",
  "ai.alphacompute.alphaphone.AlphaNotificationListener": "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE",
  "ai.alphacompute.alphaphone.AlphaQuickSettingsTile": "android.permission.BIND_QUICK_SETTINGS_TILE",
  "ai.alphacompute.alphaphone.AlphaKeyboardDictationService": "android.permission.BIND_INPUT_METHOD",
  // Alpha's password vault as an Android Autofill provider (shared plugin-native-passwords).
  "ai.eliza.plugins.passwords.ElizaPasswordAutofillService": "android.permission.BIND_AUTOFILL_SERVICE",
  // Google Play services alone may notify this native sign-in revocation service.
  "com.google.android.gms.auth.api.signin.RevocationBoundService": "com.google.android.gms.auth.api.signin.permission.REVOCATION_NOTIFICATION",
  "androidx.work.impl.background.systemjob.SystemJobService": "android.permission.BIND_JOB_SERVICE",
  "androidx.work.impl.diagnostics.DiagnosticsReceiver": "android.permission.DUMP",
  "androidx.profileinstaller.ProfileInstallReceiver": "android.permission.DUMP",
  // Read-only release data integrity export for pilot updates (adb shell holds DUMP).
  "ai.alphacompute.alphaphone.release.DataIntegrityProvider": "android.permission.DUMP",
  // Launcher-only dialer role (#420), declared disabled and enabled only on the verified Alpha image:
  // Telecom alone may bind the InCallService, and ACTION_DIAL is the role's public entry point.
  "ai.alphacompute.alphaphone.AlphaInCallService": "android.permission.BIND_INCALL_SERVICE",
  "ai.alphacompute.alphaphone.AlphaDialPadActivity": null,
  // Launcher-only SMS role (#421), enabled only on the verified image: only the telephony stack may
  // deliver texts, MMS notifications and quick replies; SENDTO is the role's public compose entry.
  "ai.alphacompute.alphaphone.AlphaSmsDeliverReceiver": "android.permission.BROADCAST_SMS",
  "ai.alphacompute.alphaphone.AlphaMmsWapPushReceiver": "android.permission.BROADCAST_WAP_PUSH",
  "ai.alphacompute.alphaphone.AlphaRespondViaMessageService": "android.permission.SEND_RESPOND_VIA_MESSAGE",
  "ai.alphacompute.alphaphone.AlphaSmsComposeActivity": null,
  // The privileged image Provision app can prepare, but cannot assign roles through this receiver.
  [TELEPHONY_SETUP_RECEIVER]: MANAGE_ROLE_HOLDERS,
});
// On-device speech is the fused libelizainference engine only. Entries and classes of the removed
// speech runtimes (Open Neural Network Exchange models and runtimes, sherpa, ORT-Web, the former
// in-browser model directory public/browser-speech/) never ship.
export const REMOVED_SPEECH_ENTRY = /(?:\.on{2}x$|libon{2}xruntime|libsherpa|k2fsa|ort-wasm|^assets\/public\/browser-speech\/)/i;
export const REMOVED_SPEECH_CLASSES = Object.freeze(["Lcom/k2fsa/", "Lai/eliza/speech/"]);
export const DISTRIBUTION_POLICY = Object.freeze({
  developmentClasses: DEVELOPMENT_CLASSES,
  developmentManifestText: ["peerfixture"],
  developmentEntries: [/^res\/xml\/development_network_security_config\.xml$/],
  exportedComponents: EXPORTED_COMPONENTS,
  // WRITE_EXTERNAL_STORAGE is admitted only up to API 29 (Files' legacy storage); distributionProblems checks it.
  forbiddenPermissions: [MANAGE_ROLE_HOLDERS],
  forbiddenEntries: REMOVED_SPEECH_ENTRY,
  forbiddenEntriesLabel: "Removed speech runtime entries are packaged",
  forbiddenDexPrefixes: REMOVED_SPEECH_CLASSES,
  forbiddenDexLabel: "Removed speech runtime classes are packaged",
  requiredEntries: ["assets/public/licenses/third-party-notices.json"],
});

/**
 * Pure release-policy assessment. `apk` holds aapt dumps, zip entry names and
 * the development class names found in dex. Returns `{ facts, problems }`.
 * The upstream inspection applies DISTRIBUTION_POLICY; the Power entry's
 * component kind and the Quick Settings tile shape and target are Alpha's own checks.
 */
export function distributionProblems(apk: DistributionInput, { mode, testMocks = false }: DistributionOptions = {}) {
  const { facts, problems } = assessDistribution(
    { ...apk, forbiddenDex: apk.forbiddenDex ?? apk.removedSpeechClasses },
    DISTRIBUTION_POLICY,
    { mode, testMocks },
  );
  problems.push(...legacyStorageProblems(apk.xml));
  const powerName = "ai.alphacompute.alphaphone.AlphaPowerVoiceActivity";
  if (facts.exported.some(component => component.name === powerName && component.tag !== "activity"))
    problems.push("AlphaPowerVoiceActivity must be an activity");
  const tileName = "ai.alphacompute.alphaphone.AlphaQuickSettingsTile";
  const assistName = "ai.alphacompute.alphaphone.AlphaAssistActivity";
  // aapt prints android:enabled="false" as (type 0x12)0x0; a missing attribute means enabled.
  const enabled = (node: ManifestNode | undefined) => node && node.attrs.enabled !== "0x0" && node.attrs.enabled !== "false";
  const tile = facts.components.find(component => component.name === tileName);
  if (tile) {
    const application = parseXmlTree(apk.xml).children.find(node => node.name === "manifest")
      ?.children.find(node => node.name === "application");
    const nodes = application?.children.filter(node =>
      node.attrs.name === tileName || node.attrs.name === ".AlphaQuickSettingsTile") ?? [];
    const actions = nodes.flatMap(node => node.children.filter(child => child.name === "intent-filter")
      .flatMap(filter => filter.children.filter(child => child.name === "action").map(child => child.attrs.name)));
    if (tile.tag !== "service" || !tile.exported ||
        tile.permission !== EXPORTED_COMPONENTS[tileName] || nodes.length !== 1 ||
        actions.length !== 1 || actions[0] !== "android.service.quicksettings.action.QS_TILE")
      problems.push("Alpha Quick Settings tile must be one exported, permission-protected QS_TILE service");
    // The tile's only target is AlphaAssistActivity (AlphaQuickSettingsTile.entryIntent); a tile that
    // can be tapped while that activity is disabled or absent opens nothing.
    const assist = application?.children.find(node => node.name === "activity" &&
      (node.attrs.name === assistName || node.attrs.name === ".AlphaAssistActivity"));
    if (enabled(nodes[0]) && !enabled(assist))
      problems.push("Alpha Quick Settings tile must be disabled while AlphaAssistActivity is disabled");
  }
  const dictationName = "ai.alphacompute.alphaphone.AlphaKeyboardDictationService";
  const dictation = facts.components.find(component => component.name === dictationName);
  if (dictation) {
    const application = parseXmlTree(apk.xml).children.find(node => node.name === "manifest")
      ?.children.find(node => node.name === "application");
    const nodes = application?.children.filter(node =>
      node.attrs.name === dictationName || node.attrs.name === ".AlphaKeyboardDictationService") ?? [];
    const actions = nodes.flatMap(node => node.children.filter(child => child.name === "intent-filter")
      .flatMap(filter => filter.children.filter(child => child.name === "action").map(child => child.attrs.name)));
    const metadata = nodes.flatMap(node => node.children.filter(child => child.name === "meta-data" && child.attrs.name === "android.view.im"));
    if (!apk.home || dictation.tag !== "service" || !dictation.exported ||
        dictation.permission !== EXPORTED_COMPONENTS[dictationName] || nodes.length !== 1 ||
        actions.length !== 1 || actions[0] !== "android.view.InputMethod" ||
        metadata.length !== 1 || !metadata[0].attrs.resource)
      problems.push("Alpha voice typing must be one launcher-only, Android-bound input-method service with subtype metadata");
  }
  return { facts, problems };
}

/**
 * Files' Android 10 legacy storage: WRITE_EXTERNAL_STORAGE may be requested only with
 * maxSdkVersion 29 or lower (never on API 30+, where all-files access is used), and READ_ only up
 * to 32 (Photos). Legacy storage itself is requested by the application.
 */
export function legacyStorageProblems(xml: string) {
  const manifest = parseXmlTree(xml).children.find(node => node.name === "manifest");
  const problems: string[] = [];
  const limits: Record<string, number> = { "android.permission.WRITE_EXTERNAL_STORAGE": 29, "android.permission.READ_EXTERNAL_STORAGE": 32 };
  for (const node of manifest?.children ?? []) {
    const name = node.attrs.name;
    if (!name || !/^uses-permission(?:-sdk-23)?$/.test(node.name) || !Object.hasOwn(limits, name)) continue;
    const max = node.attrs.maxSdkVersion === undefined ? Infinity : Number(node.attrs.maxSdkVersion);
    if (!(max <= limits[name]))
      problems.push(`${name.split(".").pop()} is requested above API ${limits[name]}`);
  }
  return problems;
}

export function inspectApk(file: string): ApkInspection {
  const { forbiddenDex, ...apk } = readApk(file, { aapt: tool("aapt"), policy: DISTRIBUTION_POLICY });
  return { ...apk, removedSpeechClasses: forbiddenDex };
}

/** Extract assets/public into a fresh temporary directory; caller removes it. */
export function extractWebPayload(file: string): {root: string; public: string} {
  return extractApkWebPayload(file, { prefix: "alpha-apk-public-" });
}

/** Read the build-time flag record that vite writes beside the web bundle. */
export function readBuildFlags(publicDir: string): {testMocks: boolean} {
  const file = path.join(publicDir, "build-flags.json");
  if (!fs.existsSync(file))
    throw new Error(`build-flags.json is missing from the packaged web bundle (${file}); the web build did not record its test-mocks flag`);
  const flags = JSON.parse(fs.readFileSync(file, "utf8"));
  if (typeof flags?.testMocks !== "boolean") throw new Error("build-flags.json has no boolean testMocks");
  return flags;
}

/** Check that the packaged Android owner-route table is generated from the renderer source. */
export function verifyOwnerRouteTable(file: string) {
  let packaged;
  try { packaged = execFileSync("unzip", ["-p", file, "assets/owner-routes.json"], { stdio: ["ignore", "pipe", "pipe"] }); }
  catch { throw new Error("assets/owner-routes.json is missing"); }
  if (!packaged.equals(Buffer.from(serializeOwnerRouteTable())))
    throw new Error("assets/owner-routes.json differs from the generated owner-route table");
}

export const AUDIT_SCRIPT = "scripts/audit-production-bundle.ts";
/** Run the shared production-bundle audit CLI against an extracted web payload. */
export function auditBundle(directory: string, { testMocks = false, script = AUDIT_SCRIPT } = {}) {
  if (!fs.existsSync(script))
    throw new Error(`${script} is missing; the production bundle audit is required to verify APK web payloads`);
  const args = [script, directory, ...(testMocks ? ["--expect-test-mocks"] : [])];
  try {
    return execFileSync(process.execPath, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const stdout = error instanceof Error && 'stdout' in error ? error.stdout : "";
    const stderr = error instanceof Error && 'stderr' in error ? error.stderr : "";
    throw new Error(`Production bundle audit failed for ${directory}:\n${stdout ?? ""}${stderr ?? ""}`);
  }
}

/** apksigner certificate digest of the first signer (upstream parser), or a thrown error. */
interface SignerOptions {apiLevel?: number}
type ReadSigner = (file: string, options: SignerOptions & {apksigner: string; env: NodeJS.ProcessEnv}) => string;

export function signerDigest(file: string, { apiLevel }: SignerOptions = {}): string {
  return (readApkSignerDigest as ReadSigner)(file, { apksigner: tool("apksigner"), apiLevel, env: androidEnv() });
}
export const parseSignerDigest = parseApkSignerDigest as (output: string, options?: SignerOptions) => string;

/** The image provisioner must be able to prepare the launcher before its first activity starts. */
export function telephonySetupReceiverProblems(tree: ManifestNode, wantsHome = true): string[] {
  const manifest = tree.children.find(node => node.name === "manifest");
  const application = manifest?.children.find(node => node.name === "application");
  const receivers = application?.children.filter(node =>
    node.attrs.name === TELEPHONY_SETUP_RECEIVER ||
    node.attrs.name === ".AlphaTelephonySetupReceiver" ||
    node.attrs.name === "AlphaTelephonySetupReceiver") ?? [];
  const problems = [];
  if (wantsHome) {
    const [receiver] = receivers;
    if (!receiver || receivers.length !== 1 || receiver.name !== "receiver" || receiver.attrs.exported !== "0xffffffff" ||
        (receiver.attrs.enabled !== undefined && receiver.attrs.enabled !== "0xffffffff") ||
        receiver.attrs.permission !== MANAGE_ROLE_HOLDERS || receiver.children.some(node => node.name === "intent-filter"))
      problems.push("Invalid AlphaTelephonySetupReceiver: expected one enabled, exported, explicit receiver protected by MANAGE_ROLE_HOLDERS");
  } else if (receivers.length) {
    problems.push("Invalid AlphaTelephonySetupReceiver: the receiver is launcher-only");
  }
  if (manifest?.children.some(node =>
    (node.name === "uses-permission" || node.name.startsWith("uses-permission-sdk-")) && node.attrs.name === MANAGE_ROLE_HOLDERS))
    problems.push("Alpha must not request MANAGE_ROLE_HOLDERS");
  return problems;
}

export function validateApk(file: string, identity: {appId: string}, wantsHome: boolean, inspect: (file: string) => ApkInspection = inspectApk) {
  const data = inspect(file);
  if (data.packageName !== identity.appId)
    throw new Error(`Wrong package in ${file}: ${data.packageName}`);
  if (data.home !== wantsHome || !data.launcher || !data.webPayload)
    throw new Error(`Invalid launcher/web payload contract in ${file}`);
  if (
    data.xml.includes("android.permission.WRITE_SETTINGS")
  )
    throw new Error(`Unexpected elevated permission in ${file}`);
  if (!data.xml.includes('android.permission.CAMERA')) throw new Error(`Missing native feature permission CAMERA in ${file}`);
  // Contacts reads are packaged only for the launcher. The native image capability,
  // unlocked profile and runtime grant remain separate requirements for access.
  if (data.xml.includes('android.permission.READ_CONTACTS') !== wantsHome)
    throw new Error(`Invalid Contacts read permission for distribution in ${file}`);
  if (data.xml.includes('android.permission.WRITE_CONTACTS') !== wantsHome)
    throw new Error(`Invalid WRITE_CONTACTS permission for distribution in ${file}`);
  // The default dialer can use provider voicemail. Carrier registration needs authenticated provisioning.
  for (const entry of ['com.android.voicemail.permission.ADD_VOICEMAIL', 'android.telephony.VisualVoicemailService', 'android.permission.BIND_VISUAL_VOICEMAIL_SERVICE'])
    if (data.xml.includes(entry)) throw new Error(`Unexpected carrier voicemail manifest entry ${entry} in ${file}`);
  // SMS provider reads and reviewed sends (#421) are packaged only for the launcher; Android grants
  // these hard-restricted permissions only to the preinstalled image app or the SMS role holder.
  for (const permission of ['READ_SMS', 'SEND_SMS'])
    if (data.xml.includes(`android.permission.${permission}`) !== wantsHome)
      throw new Error(`Invalid ${permission} permission for distribution in ${file}`);
  // The dialer role grants CALL_PHONE to its holder; only the launcher declares the role components.
  if (data.xml.includes('android.permission.CALL_PHONE') !== wantsHome)
    throw new Error(`Invalid CALL_PHONE permission for distribution in ${file}`);
  // Phone state (the native phone plugin's permission, removed for standalone) and the system shade
  // are launcher-only; the merged manifest, not the source manifests, is what ships.
  // READ_PRIVILEGED_PHONE_STATE is the one privileged permission the launcher declares: the Alpha
  // image allow-lists exactly it (IMEI and SIM serial in Settings); no other install is granted it.
  for (const permission of ['READ_PHONE_STATE', 'READ_PHONE_NUMBERS', 'READ_PRIVILEGED_PHONE_STATE', 'EXPAND_STATUS_BAR'])
    if (data.xml.includes(`android.permission.${permission}`) !== wantsHome)
      throw new Error(`Invalid ${permission} permission for distribution in ${file}`);
  for (const component of ['AlphaInCallService', 'AlphaCallActivity', 'AlphaDialPadActivity', 'AlphaSmsDeliverReceiver', 'AlphaSmsSendReceiver', 'AlphaMmsWapPushReceiver', 'AlphaMmsResultReceiver', 'AlphaRespondViaMessageService', 'AlphaSmsComposeActivity'])
    if (data.xml.includes(`ai.alphacompute.alphaphone.${component}`) !== wantsHome)
      throw new Error(`Invalid telephony-role component ${component} for distribution in ${file}`);
  const setupProblems = telephonySetupReceiverProblems(parseXmlTree(data.xml), wantsHome);
  if (setupProblems.length) throw new Error(`${setupProblems.join("; ")} in ${file}`);
  // The SMS role grants these to its holder; only the launcher declares the role components.
  for (const permission of ['RECEIVE_SMS', 'RECEIVE_MMS', 'RECEIVE_WAP_PUSH'])
    if (data.xml.includes(`android.permission.${permission}`) !== wantsHome)
      throw new Error(`Invalid ${permission} permission for distribution in ${file}`);
  // Recent calls (AP-08) are packaged only for the launcher; the image capability, unlocked
  // foreground and the owner's runtime grant remain separate requirements for any read.
  if (data.xml.includes('android.permission.READ_CALL_LOG') !== wantsHome)
    throw new Error(`Invalid READ_CALL_LOG permission for distribution in ${file}`);
  for (const permission of ['WRITE_CALL_LOG', 'MANAGE_OWN_CALLS', 'ANSWER_PHONE_CALLS'])
    if (data.xml.includes(`android.permission.${permission}`))
      throw new Error(`Unexpected telephony permission ${permission} in ${file}`);
  // aapt badging distinguishes required hardware from optional feature declarations.
  if (/uses-feature: name='android\.hardware\.camera(?:\.any|\.autofocus)?'/.test(data.badging))
    throw new Error(`Camera hardware must remain optional in ${file}`);
  return data;
}

/** Archive the verified APK payload, independent of the restored working web bundle. */
export function archiveWebPayload(apkFile: string, destination: string, { testMocks = false } = {}) {
  const payload = extractWebPayload(apkFile);
  try {
    const flags = readBuildFlags(payload.public);
    if (flags.testMocks !== testMocks) throw new Error(`APK web payload has testMocks=${flags.testMocks}; expected ${testMocks}`);
    auditBundle(payload.public, { testMocks });
    fs.cpSync(payload.public, destination, { recursive: true, errorOnExist: true, force: false });
  } finally {
    fs.rmSync(payload.root, { recursive: true, force: true });
  }
}
