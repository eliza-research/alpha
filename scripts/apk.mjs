import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { androidEnv, tool } from "./toolchain.mjs";
import {
  apkDistributionProblems, extractApkWebPayload, parseApkSignerDigest, readApk, readApkSignerDigest,
} from "../vendor/eliza/packages/app/scripts/mobile/artifact-inspection/apk-distribution.mjs";
import { parseXmlTree } from "../vendor/eliza/packages/app/scripts/lib/android-manifest-facts.mjs";
export { manifestFacts, parseXmlTree } from "../vendor/eliza/packages/app/scripts/lib/android-manifest-facts.mjs";

// Alpha's distribution policy as data for the upstream APK inspection
// (vendor/eliza/packages/app/scripts/mobile/artifact-inspection/apk-distribution.mjs).
// Debug-only native hooks that may exist only in an explicit test-mocks build
// (src/testMocks attached to debug variants when ELIZA_DEV_ALLOW_TEST_MOCKS=1).
export const DEVELOPMENT_CLASSES = Object.freeze([
  "SyntheticAutofillService",
  "DevelopmentAgentPlugin",
  "DevelopmentVoiceCapture",
]);
// Components a distribution APK may export. Each one must be guarded by the
// listed permission (null: a deliberate public entry point).
export const EXPORTED_COMPONENTS = Object.freeze({
  "ai.elizaresearch.alphaphone.MainActivity": null,
  "ai.elizaresearch.alphaphone.AlphaAssistActivity": null,
  // Power entry is reserved for platform status-bar callers.
  "ai.elizaresearch.alphaphone.AlphaPowerVoiceActivity": "android.permission.STATUS_BAR_SERVICE",
  "ai.elizaresearch.alphaphone.AlphaNotificationListener": "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE",
  "ai.elizaresearch.alphaphone.AlphaQuickSettingsTile": "android.permission.BIND_QUICK_SETTINGS_TILE",
  // Alpha's password vault as an Android Autofill provider (shared plugin-native-passwords).
  "ai.eliza.plugins.passwords.ElizaPasswordAutofillService": "android.permission.BIND_AUTOFILL_SERVICE",
  // Google Play services alone may notify this native sign-in revocation service.
  "com.google.android.gms.auth.api.signin.RevocationBoundService": "com.google.android.gms.auth.api.signin.permission.REVOCATION_NOTIFICATION",
  "androidx.work.impl.background.systemjob.SystemJobService": "android.permission.BIND_JOB_SERVICE",
  "androidx.work.impl.diagnostics.DiagnosticsReceiver": "android.permission.DUMP",
  "androidx.profileinstaller.ProfileInstallReceiver": "android.permission.DUMP",
  // Read-only release data integrity export for pilot updates (adb shell holds DUMP).
  "ai.elizaresearch.alphaphone.release.DataIntegrityProvider": "android.permission.DUMP",
  // Launcher-only dialer role (#420), declared disabled and enabled only on the verified Alpha image:
  // Telecom alone may bind the InCallService, and ACTION_DIAL is the role's public entry point.
  "ai.elizaresearch.alphaphone.AlphaInCallService": "android.permission.BIND_INCALL_SERVICE",
  "ai.elizaresearch.alphaphone.AlphaDialPadActivity": null,
  // Launcher-only SMS role (#421), enabled only on the verified image: only the telephony stack may
  // deliver texts, MMS notifications and quick replies; SENDTO is the role's public compose entry.
  "ai.elizaresearch.alphaphone.AlphaSmsDeliverReceiver": "android.permission.BROADCAST_SMS",
  "ai.elizaresearch.alphaphone.AlphaMmsWapPushReceiver": "android.permission.BROADCAST_WAP_PUSH",
  "ai.elizaresearch.alphaphone.AlphaRespondViaMessageService": "android.permission.SEND_RESPOND_VIA_MESSAGE",
  "ai.elizaresearch.alphaphone.AlphaSmsComposeActivity": null,
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
  forbiddenPermissions: ["android.permission.WRITE_EXTERNAL_STORAGE"],
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
 * component kind and the Quick Settings tile shape are Alpha's own checks.
 */
export function distributionProblems(apk, { mode, testMocks = false } = {}) {
  const { facts, problems } = apkDistributionProblems(
    { ...apk, forbiddenDex: apk.forbiddenDex ?? apk.removedSpeechClasses },
    DISTRIBUTION_POLICY,
    { mode, testMocks },
  );
  const powerName = "ai.elizaresearch.alphaphone.AlphaPowerVoiceActivity";
  if (facts.exported.some(component => component.name === powerName && component.tag !== "activity"))
    problems.push("AlphaPowerVoiceActivity must be an activity");
  const tileName = "ai.elizaresearch.alphaphone.AlphaQuickSettingsTile";
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
  }
  return { facts, problems };
}

export function inspectApk(file) {
  const { forbiddenDex, ...apk } = readApk(file, { aapt: tool("aapt"), policy: DISTRIBUTION_POLICY });
  return { ...apk, removedSpeechClasses: forbiddenDex };
}

/** Extract assets/public into a fresh temporary directory; caller removes it. */
export function extractWebPayload(file) {
  return extractApkWebPayload(file, { prefix: "alpha-apk-public-" });
}

/** Read the build-time flag record that vite writes beside the web bundle. */
export function readBuildFlags(publicDir) {
  const file = path.join(publicDir, "build-flags.json");
  if (!fs.existsSync(file))
    throw new Error(`build-flags.json is missing from the packaged web bundle (${file}); the web build did not record its test-mocks flag`);
  const flags = JSON.parse(fs.readFileSync(file, "utf8"));
  if (typeof flags.testMocks !== "boolean") throw new Error("build-flags.json has no boolean testMocks");
  return flags;
}

/** OwnerRoutes reads assets/owner-routes.json; it must be config/owner-routes.json, the table the renderer imports. */
export function verifyOwnerRouteTable(file) {
  let packaged;
  try { packaged = execFileSync("unzip", ["-p", file, "assets/owner-routes.json"], { stdio: ["ignore", "pipe", "pipe"] }); }
  catch { throw new Error("assets/owner-routes.json is missing"); }
  if (!packaged.equals(fs.readFileSync(new URL("../config/owner-routes.json", import.meta.url))))
    throw new Error("assets/owner-routes.json differs from config/owner-routes.json");
}

export const AUDIT_SCRIPT = "scripts/audit-production-bundle.mjs";
/** Run the shared production-bundle audit CLI against an extracted web payload. */
export function auditBundle(directory, { testMocks = false, script = AUDIT_SCRIPT } = {}) {
  if (!fs.existsSync(script))
    throw new Error(`${script} is missing; the production bundle audit is required to verify APK web payloads`);
  const args = [script, directory, ...(testMocks ? ["--expect-test-mocks"] : [])];
  try {
    return execFileSync(process.execPath, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    throw new Error(`Production bundle audit failed for ${directory}:\n${error.stdout ?? ""}${error.stderr ?? ""}`);
  }
}

/** apksigner certificate digest of the first signer (upstream parser), or a thrown error. */
export function signerDigest(file, { apiLevel } = {}) {
  return readApkSignerDigest(file, { apksigner: tool("apksigner"), apiLevel, env: androidEnv() });
}
export const parseSignerDigest = parseApkSignerDigest;

export function validateApk(file, identity, wantsHome) {
  const data = inspectApk(file);
  if (data.packageName !== identity.appId)
    throw new Error(`Wrong package in ${file}: ${data.packageName}`);
  if (data.home !== wantsHome || !data.launcher || !data.webPayload)
    throw new Error(`Invalid launcher/web payload contract in ${file}`);
  if (
    data.xml.includes("android.permission.WRITE_SETTINGS")
  )
    throw new Error(`Unexpected elevated permission in ${file}`);
  for (const permission of ['CAMERA']) {
    if (!data.xml.includes('android.permission.' + permission)) throw new Error(`Missing native feature permission ${permission} in ${file}`);
  }
  // Contacts reads are packaged only for the launcher. The native image capability,
  // unlocked profile and runtime grant remain separate requirements for access.
  if (data.xml.includes('android.permission.READ_CONTACTS') !== wantsHome)
    throw new Error(`Invalid Contacts read permission for distribution in ${file}`);
  if (data.xml.includes('android.permission.WRITE_CONTACTS'))
    throw new Error(`Unexpected Contacts write permission in ${file}`);
  // SMS provider reads and reviewed sends (#421) are packaged only for the launcher; Android grants
  // these hard-restricted permissions only to the preinstalled image app or the SMS role holder.
  for (const permission of ['READ_SMS', 'SEND_SMS'])
    if (data.xml.includes(`android.permission.${permission}`) !== wantsHome)
      throw new Error(`Invalid ${permission} permission for distribution in ${file}`);
  // The dialer role grants CALL_PHONE to its holder; only the launcher declares the role components.
  if (data.xml.includes('android.permission.CALL_PHONE') !== wantsHome)
    throw new Error(`Invalid CALL_PHONE permission for distribution in ${file}`);
  for (const component of ['AlphaInCallService', 'AlphaCallActivity', 'AlphaDialPadActivity', 'AlphaSmsDeliverReceiver', 'AlphaMmsWapPushReceiver', 'AlphaMmsResultReceiver', 'AlphaRespondViaMessageService', 'AlphaSmsComposeActivity'])
    if (data.xml.includes(`ai.elizaresearch.alphaphone.${component}`) !== wantsHome)
      throw new Error(`Invalid telephony-role component ${component} for distribution in ${file}`);
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
export function archiveWebPayload(apkFile, destination, { testMocks = false } = {}) {
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
