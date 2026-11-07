#!/usr/bin/env node
/**
 * Voice-trial export layout and dry-run check for the device pilot (issue #677, H-33).
 *
 *   node scripts/owner/voice-trial-export.mjs extract <diagnostics.json> --unit unit-a --variant launcher --session <yyyymmddThhmmZ> [--root voice-trials]
 *   node scripts/owner/voice-trial-export.mjs check [--root voice-trials]
 *   node scripts/owner/voice-trial-export.mjs dry-run
 *
 * Settings › Export diagnostics writes an `alpha-diagnostics/v1` report whose `nativeVoiceTiming`
 * member is the `alpha-native-voice-timing-v3` export. scripts/aggregate-voice-latency.mjs reads
 * only timing exports, so a diagnostics report passed to it directly is refused as bad input
 * (exit 1). `extract` copies just that member into the layout
 *
 *   <root>/<unit>/<variant>/<session>.native-voice-timing.json
 *
 * and nothing else from the report. `check` reads the layout, groups trials into the aggregator's
 * cohorts (source, engine, model, device, environment, ABI, build, network, dirty state) and says
 * which cohorts can be acceptance candidates and how many passed warm/cold trials each still needs;
 * it then prints the exact aggregator command. `dry-run` builds synthetic exports of the shape
 * test/native-voice-latency.test.mjs uses, runs the real aggregator CLI on them in a temporary
 * directory, and confirms exit 0 (sufficient device cohort), 2 (emulator only), 3 (over budget)
 * and 1 (a diagnostics report passed unextracted). Synthetic data is never evidence.
 *
 * Reads only the files named; writes only under --root (extract) or a temporary directory (dry-run).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateNativeVoice, minimumTrials, nativeTimingFormat, nativeTimingFormats } from "../native-voice-latency.mjs";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const DIAGNOSTICS_FORMAT = "alpha-diagnostics/v1";
export const VARIANTS = Object.freeze(["launcher", "standalone"]);
const alias = /^unit-[a-d]$/;
const session = /^\d{8}T\d{4}Z$/;

/** The native timing export inside a diagnostics report (or the export itself). */
export function nativeExport(document) {
  if (nativeTimingFormats.includes(document?.format)) return document;
  if (document?.format === DIAGNOSTICS_FORMAT && nativeTimingFormats.includes(document.nativeVoiceTiming?.format)) return document.nativeVoiceTiming;
  throw new Error(`Neither ${DIAGNOSTICS_FORMAT} with nativeVoiceTiming nor ${nativeTimingFormats.join("/")}`);
}

export function layoutPath(root, { unit, variant, session: name }) {
  if (!alias.test(unit ?? "")) throw new Error("--unit must be unit-a … unit-d (an alias, never a serial or a person)");
  if (!VARIANTS.includes(variant)) throw new Error(`--variant must be ${VARIANTS.join(" or ")}`);
  if (!session.test(name ?? "")) throw new Error("--session must be a UTC stamp like 20261105T1430Z");
  return path.join(root, unit, variant, `${name}.native-voice-timing.json`);
}

/** Every export in the layout, with the unit and variant its path names. */
export function layoutFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  for (const unit of fs.readdirSync(root).sort()) for (const variant of VARIANTS) {
    const dir = path.join(root, unit, variant);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) if (name.endsWith(".native-voice-timing.json")) files.push({ unit, variant, file: path.join(dir, name) });
  }
  return files;
}

/** Layout problems and, per aggregator cohort, what is still needed. */
export function checkLayout(root) {
  const problems = [], documents = [];
  for (const entry of layoutFiles(root)) {
    if (!alias.test(entry.unit)) problems.push(`${entry.file}: directory ${entry.unit} is not unit-a … unit-d`);
    let document;
    try { document = JSON.parse(fs.readFileSync(entry.file, "utf8")); } catch (error) { problems.push(`${entry.file}: ${error.message}`); continue; }
    if (document.format !== nativeTimingFormat) problems.push(`${entry.file}: format ${document.format} (only ${nativeTimingFormat} can be acceptance evidence)`);
    for (const row of document.records ?? []) {
      const build = row?.identity?.build ?? "";
      if (!build.startsWith(`${entry.variant}-`)) problems.push(`${entry.file}: trial ${row?.id} build ${build} is not the ${entry.variant} directory's variant`);
    }
    documents.push(document);
  }
  const summary = documents.length ? aggregateNativeVoice(documents.filter(document => nativeTimingFormats.includes(document?.format))) : null;
  const cohorts = (summary?.cohorts ?? []).map(row => ({
    class: row.class, build: row.identity.build, abi: row.identity.abi, environment: row.identity.environment, network: row.network,
    source: row.identity.sourceCommit.slice(0, 12), passed: row.passed, warm: row.warm.samples, cold: row.cold.samples,
    needs: { passed: Math.max(0, minimumTrials - row.passed), warm: Math.max(0, summary.requiredWarm - row.warm.samples), cold: Math.max(0, summary.requiredCold - row.cold.samples) },
    failures: row.failures, noResponse: row.noResponse, withinBudget: row.withinBudget,
  }));
  return { files: documents.length, problems, invalid: summary?.invalid ?? 0, rejected: summary?.rejected ?? {}, conflictingTrials: summary?.conflictingTrials ?? 0, cohorts,
    command: `node scripts/aggregate-voice-latency.mjs ${path.join(root, "*", "*", "*.native-voice-timing.json")} --out ${path.join(root, "summary.json")}` };
}

// ---- dry run on synthetic fixtures (same shape as test/native-voice-latency.test.mjs) ----
const identity = { sourceCommit: "a".repeat(40), sourceDirty: false, engineSha256: "b".repeat(64), modelSha256: "c".repeat(64), device: "Google Pixel 10a", environment: "device", abi: "arm64-v8a", build: "launcher-release" };
export function syntheticTrial(index, { duration = 5900, environment = "device", build = "launcher-release" } = {}) {
  return {
    id: `synthetic-${build}-${index}`, turnId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, pipeline: "live-voice", clock: "native-monotonic-ms",
    captureClock: "audiorecord-timestamp", audibleClock: "audiotrack-timestamp", cold: index < 5, outcome: "passed", network: "wifi", thermal: "none",
    identity: { ...identity, environment, build },
    marks: { "last-user-audio": 1000, endpoint: 1550, "asr-final": 1700, request: 1720, "first-token": 2900, "tts-start": 3300, "tts-ready": 4000, "first-pcm": 4100, "audible-playback": 1000 + duration },
  };
}
const exportOf = rows => ({ format: nativeTimingFormat, clock: "CLOCK_MONOTONIC", units: "ms", dropped: 0, records: rows });
const fifty = options => Array.from({ length: 50 }, (_, index) => syntheticTrial(index, options));

export const DRY_RUN_CASES = Object.freeze([
  { name: "sufficient device cohort, both variants", expect: 0, files: () => [exportOf(fifty({ build: "launcher-release" })), exportOf(fifty({ build: "standalone-release" }))] },
  { name: "emulator only", expect: 2, files: () => [exportOf(fifty({ environment: "emulator", build: "launcher-debug" }))] },
  { name: "one variant short of 50 trials", expect: 2, files: () => [exportOf(fifty({ build: "launcher-release" })), exportOf(fifty({ build: "standalone-release" }).slice(1))] },
  { name: "over the six-second budget", expect: 3, files: () => [exportOf(fifty({ duration: 7000 }))] },
  { name: "diagnostics report passed unextracted", expect: 1, files: () => [{ format: DIAGNOSTICS_FORMAT, nativeVoiceTiming: exportOf(fifty()) }] },
]);

export function dryRun({ node = process.execPath, root = ROOT } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-voice-dry-run-"));
  try {
    return DRY_RUN_CASES.map((testCase, index) => {
      const files = testCase.files().map((document, n) => { const file = path.join(dir, `case${index}-${n}.json`); fs.writeFileSync(file, JSON.stringify(document)); return file; });
      const run = spawnSync(node, [path.join(root, "scripts/aggregate-voice-latency.mjs"), ...files, "--out", path.join(dir, `case${index}-summary.json`)], { encoding: "utf8" });
      return { name: testCase.name, expected: testCase.expect, exit: run.status, ok: run.status === testCase.expect };
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function option(args, name) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const root = path.resolve(option(args, "--root") ?? "voice-trials");
  try {
    if (command === "extract") {
      const source = args[0];
      if (!source || source.startsWith("--")) throw new Error("extract needs the diagnostics export file");
      const target = layoutPath(root, { unit: option(args, "--unit"), variant: option(args, "--variant"), session: option(args, "--session") });
      const exported = nativeExport(JSON.parse(fs.readFileSync(source, "utf8")));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `${JSON.stringify(exported, null, 2)}\n`, { flag: "wx" });
      console.log(`${target}: ${exported.records?.length ?? 0} trials (${exported.format}); only the native timing member was copied.`);
    } else if (command === "check") {
      const result = checkLayout(root);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.problems.length || result.invalid || result.conflictingTrials ? 1 : 0;
    } else if (command === "dry-run") {
      const results = dryRun();
      for (const row of results) console.log(`${row.ok ? "ok  " : "FAIL"} exit ${row.exit} (expected ${row.expected}): ${row.name}`);
      console.log("Synthetic fixtures only: this shows how the aggregator judges inputs, never device latency.");
      process.exitCode = results.every(row => row.ok) ? 0 : 1;
    } else throw new Error("Use extract, check or dry-run");
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}

