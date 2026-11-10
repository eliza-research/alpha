#!/usr/bin/env node
/**
 * Hosted half of on-device speech qualification (.github/workflows/android-emulator.yml, job
 * `fused-speech`). The engine is libelizainference with the shared paradee-voice library (Paradee
 * TTS, misaki G2P, the ASR slot (Phonon-2), Silero VAD) recorded in
 * android/voice-host/qualified-voice-host.json; this script checks the APK before the run and
 * packages what the run produced afterwards.
 *
 *   node scripts/ci/speech-candidate.ts check <app.apk>
 *   node scripts/ci/speech-candidate.ts package <results-directory> <new-output-directory>
 *
 * `check` refuses an APK whose voice bundle (assets/paradee-voice/v1) or x86_64 engine libraries are
 * not the exact recorded bytes, that lacks a recorded non-ASR file, or that carries no voice bundle
 * at all (the emulator would only prove that local speech is unavailable). A bundle without the ASR
 * slot file is admitted for the TTS and
 * cancellation classes; the packaged result then records asrPackaged:false with on-device
 * transcription under notEvidenceFor. `package` copies the instrumentation record, the raw class
 * logs and the exact APK pair into one folder and writes result.json. Nothing is inferred: a run
 * that failed or never started is packaged as that.
 *
 * An x86_64 pass here is one ABI on an emulator (evidence class E). Qualification still needs the
 * arm64-v8a engine on hardware (class D) and a reviewer named by a person; the result never edits
 * qualified-voice-host.json.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FUSED_SPEECH_CLASSES, readInstrumentationEvidence } from "./emulator-suite.ts";

export const CANONICAL_TEST = "android/app/src/androidTest/java/ai/elizaresearch/alphaphone/LocalSpeechInstrumentedTest.java";
export const BUNDLE = "assets/paradee-voice/v1";
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** The reviewed ASR slot files (android/paradee-voice/asr-inputs.json): today the one Phonon-2 GGUF. */
export function asrSlotPaths(root = repositoryRoot) {
  const {files}: {files: {path: string}[]} = JSON.parse(fs.readFileSync(path.join(root, "android/paradee-voice/asr-inputs.json"), "utf8"));
  return files.map(row => row.path);
}
export const ABI = "x86_64";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

interface ApkReader {
  names: readonly string[];
  read: (entry: string) => Buffer | null;
}
interface VoiceFile {
  bytes: number;
  sha256: string;
}
interface VoiceHost {
  models: (VoiceFile & {path: string; role: string})[];
  abis: {abi: string; libraries: (VoiceFile & {name: string})[]}[];
}
interface PackageOptions {
  results: string;
  output: string;
  repository?: string;
  environment?: NodeJS.ProcessEnv;
  asr?: boolean | null;
}

/** Whether the APK's voice bundle lists every reviewed ASR slot file. `read(entry)` returns bytes or null. */
export function asrPackaged({read}: Pick<ApkReader, 'read'>, slot = asrSlotPaths()) {
  try {
    const files: {path: string}[] = JSON.parse(read(`${BUNDLE}/manifest.json`)?.toString("utf8") ?? "null")?.files ?? [];
    return slot.length > 0 && slot.every(file => files.some(row => row.path === file));
  } catch { return false; }
}

/** Problems that make an APK unusable for the hosted run; empty when it can run. `read(entry)` returns bytes or null. */
export function candidateProblems({names, read}: ApkReader, host: VoiceHost) {
  const problems: string[] = [];
  const manifestBytes = read(`${BUNDLE}/manifest.json`);
  if (!manifestBytes) return [`the APK carries no on-device voice bundle (${BUNDLE})`];
  let bundle: {files?: {path: string}[]};
  try { bundle = JSON.parse(manifestBytes.toString("utf8")); } catch { return [`${BUNDLE}/manifest.json is not JSON`]; }
  const pinned = new Map(host.models.map(row => [row.path, row]));
  const files = Array.isArray(bundle.files) ? bundle.files : [];
  for (const row of files) {
    const expected = pinned.get(row.path), bytes = read(`${BUNDLE}/${row.path}`);
    if (!expected || !bytes || bytes.length !== expected.bytes || sha(bytes) !== expected.sha256) problems.push(`${BUNDLE}/${row.path} is not a recorded voice file`);
  }
  // No ASR slot is not a refusal: the run records asrPackaged:false and proves nothing about transcription.
  // Every other recorded file must be there, and the ASR slot is all or nothing.
  const listed = new Set(files.map(row => row.path));
  const asr = host.models.filter(row => row.role === "asr-model" || row.role === "asr-mmproj");
  for (const row of host.models) if (!asr.includes(row) && !listed.has(row.path)) problems.push(`${BUNDLE}/${row.path} is recorded but not packaged`);
  if (asr.some(row => listed.has(row.path)) && !asr.every(row => listed.has(row.path))) problems.push(`${BUNDLE} carries an incomplete ASR slot`);
  const libraries = host.abis.find(row => row.abi === ABI)?.libraries.filter(library => library.name === "libelizainference.so" || library.name === "libc++_shared.so") ?? [];
  if (!libraries.some(library => library.name === "libelizainference.so")) problems.push(`${ABI} has no recorded engine in android/voice-host/qualified-voice-host.json`);
  for (const library of libraries) {
    const bytes = read(`lib/${ABI}/${library.name}`);
    if (!bytes || bytes.length !== library.bytes || sha(bytes) !== library.sha256) problems.push(`lib/${ABI}/${library.name} differs from the recorded ${library.name === "libelizainference.so" ? "engine" : "library"}`);
  }
  if (!names.some(name => name === `lib/${ABI}/libparadeevoicejni.so`)) problems.push(`lib/${ABI}/libparadeevoicejni.so is not packaged`);
  return problems;
}

function apkReader(file: string): ApkReader {
  const names = execFileSync("unzip", ["-Z1", file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean);
  return { names, read: entry => names.includes(entry) ? execFileSync("unzip", ["-p", file, entry], { maxBuffer: 1536 * 1024 * 1024 }) : null };
}

/** Copies the run's record and APK pair into a new folder and says what the record shows. */
export function packageSpeechRun({results, output, repository = process.cwd(), environment = process.env, asr = null}: PackageOptions) {
  const target = path.resolve(repository, output);
  if (fs.existsSync(target)) throw new Error(`${output} already exists; evidence is never replaced`);
  fs.mkdirSync(target, { recursive: true });
  const missing: string[] = [];
  const files: Record<string, string> = {};
  const copy = (source: string, name: string) => {
    if (!fs.existsSync(source)) { missing.push(name); return false; }
    if (fs.statSync(source).isDirectory()) {
      fs.cpSync(source, path.join(target, name), { recursive: true });
      // Every copied record file is hashed too, so the package names exactly what it holds.
      for (const entry of fs.readdirSync(path.join(target, name), { recursive: true }).map(String).sort()) {
        const file = path.join(target, name, entry);
        if (fs.statSync(file).isFile()) files[`${name}/${entry.split(path.sep).join("/")}`] = sha(fs.readFileSync(file));
      }
    }
    else { fs.mkdirSync(path.dirname(path.join(target, name)), { recursive: true }); fs.copyFileSync(source, path.join(target, name)); files[name] = sha(fs.readFileSync(path.join(target, name))); }
    return true;
  };
  copy(path.resolve(repository, results), "instrumentation");
  copy(path.resolve(repository, "artifacts/standalone-debug.apk"), "standalone-debug.apk");
  copy(path.resolve(repository, "artifacts/instrumentation/standalone-androidTest.apk"), "standalone-androidTest.apk");
  const record = readInstrumentationEvidence(path.join(target, "instrumentation/results.json"));
  const classes = (record?.classes ?? []).map(({class: name, status}) => ({class: name, status}));
  const ran = new Set(classes.filter(row => row.status === "passed").map(row => row.class));
  const result = {
    abi: ABI, commit: environment.GITHUB_SHA ?? null, runId: environment.GITHUB_RUN_ID ?? null, evidenceClass: "E",
    canonicalTestSha256: fs.existsSync(path.resolve(repository, CANONICAL_TEST)) ? sha(fs.readFileSync(path.resolve(repository, CANONICAL_TEST))) : null,
    // Exactly what the instrumentation record says; `passed` is never inferred here.
    passed: record?.passed === true && FUSED_SPEECH_CLASSES.every(name => ran.has(name)) && missing.length === 0,
    classes, missing, files,
    // true, false, or null when the APK could not be read; anything but true leaves transcription unproven.
    asrPackaged: asr,
    admission: "not admitted: arm64-v8a on hardware (class D) and a reviewer named by a person are still required; qualified-voice-host.json evidence is edited only by that review",
    notEvidenceFor: ["arm64-v8a", "microphone, speaker or perceptual quality", "Paradee intelligibility", "physical-device acceptance",
      ...(asr === true ? [] : ["on-device transcription (no ASR slot file was packaged)"])],
  };
  fs.writeFileSync(path.join(target, "result.json"), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, first, second] = process.argv.slice(2);
  if (command === "check" && first && !second) {
    const host = JSON.parse(fs.readFileSync("android/voice-host/qualified-voice-host.json", "utf8"));
    const reader = apkReader(first);
    const problems = candidateProblems(reader, host);
    if (problems.length) { console.error(`Speech candidate refused:\n  - ${problems.join("\n  - ")}`); process.exit(1); }
    console.log(`Speech candidate admitted for the ${ABI} emulator run${asrPackaged(reader) ? "" : " without the ASR slot file: Paradee and cancellation only; transcription is not evidenced"}`);
  } else if (command === "package" && first && second) {
    let asr: boolean | null = null;
    try { asr = asrPackaged(apkReader("artifacts/standalone-debug.apk")); } catch { /* Unreadable APK: recorded as null. */ }
    const result = packageSpeechRun({ results: first, output: second, asr });
    console.log(JSON.stringify({ abi: result.abi, passed: result.passed, asrPackaged: result.asrPackaged, classes: result.classes, missing: result.missing }, null, 2));
  } else {
    console.error("Use: node scripts/ci/speech-candidate.ts check <app.apk> | package <results-directory> <new-output-directory>");
    process.exit(2);
  }
}
