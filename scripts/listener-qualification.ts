/**
 * The always-on listener's own qualification row (android/sense/qualified-listener.json, ADR 0001).
 * The listener is a separate image-only APK, so it gets its own rows in apk-manifest.json instead of
 * riding on the Alpha rows. Bytes never qualify it: `qualified` comes only from the reviewed record,
 * and the record may not claim qualification while any gate G1-G6 is open or any evidence class
 * (APK build, AOSP image, device acceptance) is missing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const LISTENER_RECORD = "android/sense/qualified-listener.json";
export const LISTENER_GATES = ["G1", "G2", "G3", "G4", "G5", "G6"];
const DIGEST = /^[0-9a-f]{64}$/;

interface ListenerEvidence {
  recorded?: boolean;
  record?: string | null;
  class?: string;
  note?: string;
  current?: boolean;
}
interface ListenerRecord {
  schemaVersion: number;
  packageName: string;
  gradleTask: string;
  artifacts: string[];
  qualified: boolean;
  distributable: boolean;
  gates?: Record<string, string>;
  evidence?: Record<string, ListenerEvidence | undefined>;
  indicatorLease?: {systemUiCompiled?: boolean; qualified?: boolean};
}

export interface ListenerApkFacts {
  file: string;
  mode: "debug" | "release";
  sha256: string;
  signed: boolean;
  signerSha256?: string;
  packageName?: string | null;
  requested?: string[];
  permissionProblem?: string;
  voiceBundle?: {packaged: true; abis: string[]} | {packaged: false; problem: string};
}

/** An evidence path under `root`, or null unless it is a non-empty relative path that stays inside it. */
function evidencePath(root: string, file: unknown) {
  if (typeof file !== "string" || !file.trim() || path.isAbsolute(file) || file.split(/[\\/]/).includes("..")) return null;
  return path.join(root, file);
}
const isFile = (file: string | null) => { try { return file !== null && fs.statSync(file).isFile(); } catch { return false; } };
const captureSource = (file: string) => { try { return JSON.parse(fs.readFileSync(file, "utf8")).captureSource ?? null; } catch { return null; } };

/** Problems with a listener record; empty when it is well formed and its claims are earned. */
export function listenerRecordProblems(record: ListenerRecord, appId = "ai.elizaresearch.alphaphone", root = ROOT) {
  const problems: string[] = [];
  if (!record || typeof record !== "object") return ["The listener record is not an object"];
  if (record.schemaVersion !== 1) problems.push("schemaVersion must be 1");
  if (record.packageName !== `${appId}.sense`) problems.push(`packageName must be ${appId}.sense`);
  if (record.gradleTask !== ":sense:assembleRelease") problems.push("gradleTask must be :sense:assembleRelease");
  if (!Array.isArray(record.artifacts) || !record.artifacts.length || record.artifacts.some(name => !/^sense-(debug|release|release-unsigned)\.apk$/.test(name)))
    problems.push("artifacts must name sense-*.apk files");
  if (typeof record.qualified !== "boolean" || typeof record.distributable !== "boolean") problems.push("qualified and distributable must be booleans");
  for (const gate of LISTENER_GATES) if (!["open", "passed"].includes(record.gates?.[gate] ?? "")) problems.push(`gate ${gate} must be open or passed`);
  const evidence = record.evidence ?? {};
  for (const name of ["hostTests", "apkBuild", "emulator", "aospImage", "deviceAcceptance"])
    if (typeof evidence[name]?.recorded !== "boolean") problems.push(`evidence.${name}.recorded must be a boolean`);
  if (evidence.apkBuild?.recorded && !isFile(evidencePath(root, evidence.apkBuild.record)))
    problems.push("evidence.apkBuild.record must name a committed evidence file");
  // scripts/owner/listener-evidence.ts --fixtures output is test data and never earns image or device evidence.
  for (const name of ["aospImage", "deviceAcceptance"]) {
    const file = evidence[name]?.recorded ? evidencePath(root, evidence[name].record) : null;
    if (file && isFile(file) && captureSource(file) === "fixtures") problems.push(`evidence.${name}.record is fixture evidence, which never earns gates`);
  }
  const earned = LISTENER_GATES.every(gate => record.gates?.[gate] === "passed") &&
    evidence.apkBuild?.recorded === true && evidence.apkBuild?.current === true &&
    evidence.aospImage?.recorded === true && evidence.deviceAcceptance?.recorded === true &&
    record.indicatorLease?.systemUiCompiled === true && record.indicatorLease?.qualified === true;
  if (record.qualified && !earned) problems.push("qualified needs every gate G1-G6 passed, a current APK build, an AOSP image, device acceptance and a qualified SystemUI indicator lease");
  if (record.distributable && !record.qualified) problems.push("an unqualified listener cannot be distributable");
  if (record.indicatorLease?.qualified && !record.indicatorLease?.systemUiCompiled) problems.push("the indicator lease cannot be qualified before SystemUI compiles it");
  return problems;
}

export function readListenerRecord(root = ROOT) {
  const record: ListenerRecord = JSON.parse(fs.readFileSync(path.join(root, LISTENER_RECORD), "utf8"));
  const problems = listenerRecordProblems(record, undefined, root);
  if (problems.length) throw new Error(`${LISTENER_RECORD} is invalid:\n  - ${problems.join("\n  - ")}`);
  return record;
}

/**
 * One apk-manifest row for a built listener APK. `facts` are read from the APK by the caller:
 * {file, mode, sha256, signed, signerSha256, packageName, requested, permissionProblem, voiceBundle}.
 * The row is APK-build evidence only and is never distributable while the record is unqualified.
 */
export function listenerApkRow(record: ListenerRecord, facts: ListenerApkFacts) {
  const network = (facts.requested ?? []).filter(name => /\.(INTERNET|ACCESS_NETWORK_STATE)$/.test(name));
  const problems = [
    facts.packageName !== record.packageName && `package ${facts.packageName}, expected ${record.packageName}`,
    network.length && `network permission requested: ${network.join(", ")}`,
    facts.permissionProblem,
    facts.signed && !DIGEST.test(facts.signerSha256 ?? "") && "signed APK without a SHA-256 signer digest",
  ].filter(item => typeof item === "string" && item.length > 0);
  return {
    file: facts.file,
    mode: facts.mode,
    sha256: facts.sha256,
    packageName: facts.packageName,
    signed: facts.signed === true,
    signerSha256: facts.signerSha256 ?? null,
    requestedPermissions: [...(facts.requested ?? [])].sort(),
    networkPermission: network.length > 0,
    voiceBundle: facts.voiceBundle ?? { packaged: false },
    evidence: "apk-build",
    problems,
    record: LISTENER_RECORD,
    qualified: record.qualified === true,
    indicatorLeaseQualified: record.indicatorLease?.qualified === true,
    distributable: problems.length === 0 && facts.mode === "release" && facts.signed === true && record.qualified === true && record.distributable === true,
  };
}

/** The apk-manifest `listener` section: the record's state plus a row per listener APK found. */
export function listenerManifestSection(record: ListenerRecord, rows: ReturnType<typeof listenerApkRow>[]) {
  const blockers = [
    !rows.length && "no listener APK in this build (./gradlew :sense:assembleRelease, then copy it next to the Alpha APKs)",
    record.qualified !== true && "listener not device-qualified (gates G1-G6 open)",
    record.indicatorLease?.qualified !== true && "SystemUI indicator lease not compiled or qualified on an image",
  ].filter(item => typeof item === "string" && item.length > 0);
  return { record: LISTENER_RECORD, qualified: record.qualified === true, gates: record.gates, apks: rows, blockers };
}
