#!/usr/bin/env node
/**
 * Status of the human-only MVP steps in docs/human-actions.md, as far as this checkout records it.
 *
 *   node scripts/human-actions.ts [--json]        (npm run human:status)
 *
 * The steps, their order and their Verify lines come from docs/human-actions.md, the single
 * checklist. Steps whose outcome is recorded in this repository are read from those records:
 * the release identities (android/release-signer.json, android/aosp/pixel10a-product.json,
 * android/aosp/pixel10a-ota-channel.json), the recorded last release or a distributable build in
 * this checkout's artifacts/apk-manifest.json, the voice host and listener qualification records,
 * the embedding host toolchain, the Pixel 10a distribution gates, the update channel drills, the
 * owner's release key custody decision in docs/decisions.md and the owner's per-view approvals in
 * docs/app-qa-checklist.json.
 * Each such step is `done`, `open` or `not needed`; every other step is `external` (recorded
 * outside this repository) and prints its Verify line. Reads files only, prints no secret (signing
 * variables are reported by name) and always exits 0, like `npm run android:build:inputs`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHECKLIST_JSON, approvalStatusDetail, approved, seekerPendingStrict } from "./owner/qa-approval-report.ts";
import { releaseBlockers } from "./release-blockers.ts";

export const CHECKLIST = "docs/human-actions.md";
const UNSET = new Set(["unset", "UNSET"]);
const SIGNING_ENV = ["ELIZAOS_KEYSTORE_PATH", "ELIZAOS_KEYSTORE_PASSWORD", "ELIZAOS_KEY_ALIAS", "ELIZAOS_KEY_PASSWORD"];
interface ChecklistStep { id: string; title: string; verify: string | null }
interface Check { state: "done" | "open" | "not needed"; detail: string }
interface StepState extends ChecklistStep { state: Check["state"] | "external"; detail: string }
interface SignerRecord { signerSha256?: string; lastRelease?: {versionCode?: number; versionName?: string; recordedAt?: string} }
interface ProductRecord {
  signer?: {platformCertificateSha256?: string; releaseCertificates?: Record<string, string>; apexPayloadAvbPublicKeySha256?: string};
  avb?: {publicKeySha256?: string};
}
interface OtaRecord {
  otaCertificateSha256?: string;
  avbPublicKeySha256?: string;
  recovery?: {knownGoodRelease?: Record<string, string>};
  drills?: Record<string, string>;
}
const readJson = <T>(root: string, file: string): T => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));

/** Steps in checklist order: {id, title, verify}. */
export function checklistSteps(markdown: string) {
  const steps: ChecklistStep[] = [];
  const sections = markdown.split(/^### /m).slice(1);
  for (const section of sections) {
    const heading = /^(H-\d\d) (.+)$/m.exec(section.split("\n")[0]);
    if (!heading) continue;
    const verify = /^- Verify: ([\s\S]*?)(?=\n- |\n\n|\n#|(?![\s\S]))/m.exec(section);
    // Markdown links print as their text; the page itself keeps the link.
    steps.push({ id: heading[1], title: heading[2].trim(), verify: verify ? verify[1].replace(/\s*\n\s*/g, " ").replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1").trim() : null });
  }
  return steps;
}

/**
 * Whether this checkout's verify-apks manifest (artifacts/apk-manifest.json) records both releases
 * as admissible against the committed signer, judged as provisioning judges them (recorded facts
 * only; the APK files are not re-read). {ready, detail}.
 */
function distributableBuild(root: string, descriptor: SignerRecord) {
  const file = path.join(root, "artifacts/apk-manifest.json");
  if (!fs.existsSync(file)) return { ready: false, detail: "no artifacts/apk-manifest.json in this checkout" };
  let manifest: {results?: Record<string, unknown>[]; testMocks?: boolean; version?: {name?: string; code?: number}};
  try { manifest = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { ready: false, detail: "artifacts/apk-manifest.json is unreadable" }; }
  const problems: string[] = [];
  for (const variant of ["standalone", "launcher"]) {
    const row = (manifest.results ?? []).find(entry => entry?.variant === variant && entry?.mode === "release");
    if (!row) { problems.push(`no ${variant} release`); continue; }
    const blockers = releaseBlockers(row, { manifestTestMocks: manifest.testMocks, releaseSigner: descriptor });
    if (blockers.length) problems.push(`${variant}: ${blockers.join(", ")}`);
  }
  const version = manifest.version ? `${manifest.version.name ?? "?"} (${manifest.version.code ?? "?"})` : "unversioned";
  return problems.length ? { ready: false, detail: `artifacts/apk-manifest.json ${version} is not distributable (${problems.join("; ")})` }
    : { ready: true, detail: `artifacts/apk-manifest.json records distributable standalone and launcher releases ${version} signed by the recorded certificate; record lastRelease once they are distributed (H-32)` };
}

function gate(root: string, name: string) {
  try { return readJson<{gates?: Record<string, {status?: string}>}>(root, "android/aosp/pixel10a-qualification-gates.json").gates?.[name]?.status ?? "not recorded"; }
  catch { return "not recorded"; }
}

/**
 * Repository-recorded checks, keyed by step. Each returns {state, detail}; state is done, open or
 * "not needed". `env` is consulted for variable names only.
 */
export const CHECKS: Readonly<Record<string, (root: string, env: NodeJS.ProcessEnv) => Check>> = Object.freeze({
  // The owner's custody choice is a dated P- entry in docs/decisions.md that names H-01.
  "H-01": root => {
    const entry = /^- \*\*(P-\d\d)\*\* — [^\n]*\bH-01\b/m.exec(fs.readFileSync(path.join(root, "docs/decisions.md"), "utf8"));
    return entry ? { state: "done", detail: `release key custody recorded as ${entry[1]} in docs/decisions.md` }
      : { state: "open", detail: "docs/decisions.md records no P- entry for H-01" };
  },
  "H-09": root => {
    const signer = readJson<SignerRecord>(root, "android/release-signer.json");
    const product = readJson<ProductRecord>(root, "android/aosp/pixel10a-product.json");
    const channel = readJson<OtaRecord>(root, "android/aosp/pixel10a-ota-channel.json");
    const payloadDigest = product.signer?.apexPayloadAvbPublicKeySha256;
    const fields: [string, string | undefined][] = [
      ["android/release-signer.json signerSha256", signer.signerSha256],
      ["pixel10a-product.json signer.platformCertificateSha256", product.signer?.platformCertificateSha256],
      ...Object.entries(product.signer?.releaseCertificates ?? {}).map(([name, value]): [string, string] => [`pixel10a-product.json signer.releaseCertificates.${name}`, value]),
      ["pixel10a-product.json signer.apexPayloadAvbPublicKeySha256", /^[0-9a-f]{64}$/.test(payloadDigest ?? "") ? payloadDigest : undefined],
      ["pixel10a-product.json avb.publicKeySha256", product.avb?.publicKeySha256],
      ["pixel10a-ota-channel.json otaCertificateSha256", channel.otaCertificateSha256],
      ["pixel10a-ota-channel.json avbPublicKeySha256", channel.avbPublicKeySha256],
    ];
    const unset = fields.filter(([, value]) => value === undefined || UNSET.has(value));
    return unset.length ? { state: "open", detail: `${unset.length} of ${fields.length} release digests unset (${unset.map(([name]) => name).join(", ")})` }
      : { state: "done", detail: `all ${fields.length} release digests recorded` };
  },
  "H-10": (root, env) => {
    const descriptor = readJson<SignerRecord>(root, "android/release-signer.json");
    const last = descriptor.lastRelease ?? {};
    if (Number.isInteger(last.versionCode)) return { state: "done", detail: `last distributed release ${last.versionName ?? "?"} (${last.versionCode}) recorded ${last.recordedAt ?? "without a date"} in android/release-signer.json` };
    const built = distributableBuild(root, descriptor);
    if (built.ready) return { state: "done", detail: built.detail };
    const present = SIGNING_ENV.filter(name => env[name]?.trim());
    const signing = present.length === SIGNING_ENV.length ? "all four ELIZAOS_KEYSTORE_* variables are set" : present.length ? `only ${present.join(", ")} set (Gradle refuses a partial set)` : "no ELIZAOS_KEYSTORE_* variable is set (use scripts/sign-release-apks.ts or set all four)";
    const host = env.ELIZAOS_APP_LINK_HOST ? `ELIZAOS_APP_LINK_HOST=${env.ELIZAOS_APP_LINK_HOST}` : "ELIZAOS_APP_LINK_HOST unset";
    return { state: "open", detail: `${built.detail}; no distributed release recorded in android/release-signer.json lastRelease; this environment: ${signing}; ${host}` };
  },
  "H-18": root => {
    const voice = readJson<{qualified?: boolean; evidence?: {deviceExecuted?: boolean; emulatorDeviceExecuted?: boolean; userAccepted?: boolean}}>(root, "android/voice-host/qualified-voice-host.json");
    const evidence = voice.evidence ?? {};
    return voice.qualified === true ? { state: "done", detail: "android/voice-host/qualified-voice-host.json records qualified: true" }
      : { state: "open", detail: `qualified: false (device executed: ${evidence.deviceExecuted === true}, emulator executed: ${evidence.emulatorDeviceExecuted === true}, user accepted: ${evidence.userAccepted === true})` };
  },
  "H-19": root => {
    const toolchain = readJson<{remapBuildPath?: boolean}>(root, "android/embedding-host/build-toolchain.json");
    return toolchain.remapBuildPath === true ? { state: "not needed", detail: "script-supplied while remapBuildPath is true; npm run android:build:inputs reports any change" }
      : { state: "open", detail: "remapBuildPath is not true: a person supplies the reviewed libraries (npm run android:build:inputs)" };
  },
  "H-20": root => {
    const listener = readJson<{qualified?: boolean; gates?: Record<string, string | {status?: string}>}>(root, "android/sense/qualified-listener.json");
    const gates = Object.entries(listener.gates ?? {}).map(([name, value]) => `${name} ${typeof value === "object" && value ? value.status ?? "recorded" : value}`);
    return listener.qualified === true ? { state: "done", detail: "android/sense/qualified-listener.json records qualified: true" }
      : { state: "open", detail: `qualified: false; ${gates.join(", ")}` };
  },
  "H-22": root => {
    const known = readJson<OtaRecord>(root, "android/aosp/pixel10a-ota-channel.json").recovery?.knownGoodRelease ?? {};
    const unset = Object.entries(known).filter(([, value]) => UNSET.has(value)).map(([name]) => name);
    return Object.keys(known).length && !unset.length ? { state: "done", detail: `known-good release ${known.buildFingerprint}` }
      : { state: "open", detail: `known-good release unset (${unset.join(", ") || "not recorded"})` };
  },
  "H-23": root => { const status = gate(root, "cuttlefishBoot"); return { state: status === "passed" ? "done" : "open", detail: `cuttlefishBoot gate: ${status}` }; },
  "H-24": root => { const status = gate(root, "physicalDevice"); return { state: status === "passed" ? "done" : "open", detail: `physicalDevice gate: ${status}` }; },
  "H-25": root => {
    const drills = readJson<OtaRecord>(root, "android/aosp/pixel10a-ota-channel.json").drills ?? {};
    const status = gate(root, "signedUpdateRecovery");
    const open = Object.entries(drills).filter(([, value]) => value !== "passed");
    return !open.length && Object.keys(drills).length && status === "passed" ? { state: "done", detail: "every drill and the signedUpdateRecovery gate passed" }
      : { state: "open", detail: `${Object.entries(drills).map(([name, value]) => `${name} ${value}`).join(", ")}; signedUpdateRecovery gate: ${status}` };
  },
  "H-34": root => { const status = gate(root, "userAcceptance"); return { state: status === "passed" ? "done" : "open", detail: `userAcceptance gate: ${status}` }; },
  "H-38": root => {
    // Only the owner marks userApproval; a row counts as approved when its value starts with "Approved".
    const items = (readJson<{items?: {scope?: string; userApproval?: string; seeker?: string}[]}>(root, CHECKLIST_JSON).items ?? []).filter(item => item?.scope === "MVP");
    const approvedRows = items.filter(approved).length;
    const seekerPending = items.filter(seekerPendingStrict).length;
    return {
      state: items.length && approvedRows === items.length ? "done" : "open",
      detail: approvalStatusDetail(approvedRows, items.length, seekerPending),
    };
  },
});

/** Every step with its state. A check that cannot read its record reports open with the reason. */
export function humanActionStates(root = process.cwd(), env = process.env): StepState[] {
  const steps = checklistSteps(fs.readFileSync(path.join(root, CHECKLIST), "utf8"));
  return steps.map(step => {
    const check = CHECKS[step.id];
    if (!check) return { ...step, state: "external", detail: step.verify ? `verify: ${step.verify}` : "recorded outside this repository" };
    try { return { ...step, ...check(root, env) }; }
    catch (error) { return { ...step, state: "open", detail: `record unreadable: ${error instanceof Error ? error.message : String(error)}` }; }
  });
}

export function formatStates(rows: readonly StepState[]) {
  const lines = [`Human actions (${CHECKLIST}), as recorded in this checkout:`];
  for (const row of rows) lines.push(`  ${row.id} ${row.state.padEnd(10)} ${row.title}`, `       ${row.detail}`);
  const count = (state: StepState["state"]) => rows.filter(row => row.state === state).length;
  lines.push("", `${count("done")} done, ${count("open")} open, ${count("external")} recorded outside this repository, ${count("not needed")} not needed.`,
    "Repository records are not acceptance evidence by themselves; each step names its evidence class.");
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--json")) { console.error("Usage: node scripts/human-actions.ts [--json]"); process.exitCode = 2; }
  else {
    const rows = humanActionStates(path.resolve(import.meta.dirname, ".."));
    console.log(args.includes("--json") ? JSON.stringify(rows, null, 2) : formatStates(rows));
  }
}
