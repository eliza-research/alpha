#!/usr/bin/env bun
/**
 * One emulator suite of .github/workflows/android-emulator.yml (nightly and on dispatch), run
 * inside the hosted runner's disposable emulator:
 *
 *   bun scripts/ci/emulator-suite.ts instrumentation | browser-reading
 *
 * instrumentation   `bun run test:android:instrumentation` with its default classes on the
 *                   launcher APK.
 * browser-reading   the same runner after the pinned Chromium 157 WebView is installed
 *                   (scripts/prepare-ci-webview.ts): BrowserReadingNavigation. The real
 *                   page-question journey additionally needs independently admitted sign-in.
 *
 * A preparation step that fails stops the suite. Evidence steps are independent: each runs, and
 * the suite fails when any of them did not pass (a failed, skipped or missing class fails the
 * instrumentation runner). `test-results/emulator-suite/<suite>.json` records every step.
 *
 * Emulator-class evidence for the launcher debug APK on an x86_64 SDK image. Not a distributable
 * build, a device or acceptance.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SERIAL = "emulator-5554";
export const AVD = "test";
/** Classes that need isolated-world injection. */
export const READING_CLASSES = ["BrowserReadingNavigation"];

type Command = string[];
type SuiteStep = {name: string; command: Command; env?: NodeJS.ProcessEnv} & (
  {kind: 'preparation'; results?: never}
  | {kind: 'evidence'; results: string}
);
type Execute = (command: Command, env: NodeJS.ProcessEnv) => number;
interface ClassEvidence {
  variant?: string;
  class: string;
  status: string;
  failed?: unknown[];
}
interface Evidence {
  passed: boolean;
  classes: ClassEvidence[];
}
interface StepResult {
  name: string;
  kind: SuiteStep['kind'];
  command: Command;
  status: 'not-run' | 'passed' | 'failed';
  exitCode?: number;
  error?: string;
  results?: string;
  evidence?: Evidence;
}
interface SuiteReport {
  suite: string;
  commit: string | null;
  runId: string | null;
  serial: string;
  avd: string;
  evidenceClass: 'E';
  notEvidenceFor: string[];
  passed: boolean;
  steps: StepResult[];
}
interface SuiteOptions {
  execute: Execute;
  record?: (report: SuiteReport) => void;
  environment?: NodeJS.ProcessEnv;
}

const node = (...args: string[]) => [process.execPath, ...args];
const runner = (name: string, ...args: string[]): SuiteStep => ({
  name, kind: "evidence", results: `test-results/android-instrumentation/${name}/results.json`,
  command: ["bun", "run", "test:android:instrumentation", "--", "--owned-emulator", "--avd", AVD, "--serial", SERIAL,
    "--output", `test-results/android-instrumentation/${name}`, ...args],
});
const prepareEmulator: SuiteStep = { name: "prepare-emulator", kind: "preparation", command: node("scripts/prepare-ci-emulator.ts"), env: { ANDROID_SERIAL: SERIAL } };
// Replace the image's WebView with Chromium 157 on the hosted API 35 x86_64 fixture.
const prepareWebView: SuiteStep = { name: "prepare-webview", kind: "preparation", command: node("scripts/prepare-ci-webview.ts"), env: { ANDROID_SERIAL: SERIAL, ALPHA_DISPOSABLE_WEBVIEW_FIXTURE: "api35-default-x86_64" } };

/** The ordered steps of a suite. Pure: nothing is run. */
export function suitePlan(suite: string): SuiteStep[] {
  if (suite === "instrumentation") return [
    prepareEmulator,
    runner("ci-default"),
  ];
  if (suite === "browser-reading") return [
    prepareEmulator,
    prepareWebView,
    runner("ci-reading", "--classes", READING_CLASSES.join(",")),
  ];
  throw new Error(`Unknown suite ${JSON.stringify(suite)}; use instrumentation or browser-reading`);
}

/** Outside a hosted runner emulator-5554 may be someone's emulator; nothing is touched or written. */
export function requireHostedRunner(environment = process.env) {
  if (environment.GITHUB_ACTIONS !== "true" || environment.RUNNER_ENVIRONMENT !== "github-hosted")
    throw new Error("These suites treat emulator-5554 as disposable; they run only on a GitHub-hosted runner");
}

/** Read class outcomes from an instrumentation results.json. */
export function readInstrumentationEvidence(file: string): Evidence | null {
  try {
    const value: {passed?: boolean; classes?: ClassEvidence[]} = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(value?.classes)) return null;
    const classes = value.classes.map(row => ({
      variant: row.variant, class: row.class.replace(/^.*\./, "").replace(/InstrumentedTest$/, ""),
      status: row.status, ...(row.failed?.length ? {failed: row.failed} : {}),
    }));
    return {passed: value.passed === true, classes};
  } catch { return null; }
}

/**
 * Runs a plan. `execute(command, env)` returns an exit status.
 * Never throws for a failed step: the record says what ran, and `passed` is the verdict.
 */
export function runSuite(suite: string, {execute, record = () => {}, environment = process.env}: SuiteOptions) {
  requireHostedRunner(environment);
  const plan = suitePlan(suite);
  const steps: StepResult[] = plan.map(step => ({ name: step.name, kind: step.kind, command: step.command, status: "not-run" }));
  const report: SuiteReport = { suite, commit: environment.GITHUB_SHA ?? null, runId: environment.GITHUB_RUN_ID ?? null, serial: SERIAL, avd: AVD,
    evidenceClass: "E", notEvidenceFor: ["distributable build", "physical-device acceptance", "user acceptance"], passed: false, steps };
  let stopped = false;
  for (const [index, step] of plan.entries()) {
    const row = steps[index];
    if (stopped) continue;
    try {
      row.exitCode = execute(step.command, step.env ?? {});
      row.status = row.exitCode === 0 ? "passed" : "failed";
    } catch (error) { row.status = "failed"; row.error = error instanceof Error ? error.message : String(error); }
    if (step.results) { const evidence = readInstrumentationEvidence(step.results); row.results = step.results; if (evidence) row.evidence = evidence; else if (row.status === "passed") { row.status = "failed"; row.error = `${step.results} was not written`; } }
    // An evidence step passes only when its own record says so, whatever its exit status was.
    if (step.kind === "evidence" && row.status === "passed" && row.evidence?.passed !== true) { row.status = "failed"; row.error = "the result record does not report a pass"; }
    if (step.kind === "preparation" && row.status !== "passed") stopped = true;
    record(report);
  }
  report.passed = steps.every(row => row.status === "passed");
  record(report);
  return report;
}

/** Markdown for the job summary: every step, and every class with its status. */
export function summarize(report: SuiteReport) {
  const lines = [`### Emulator suite \`${report.suite}\`: ${report.passed ? "passed" : "FAILED"}`, "",
    "Emulator-class evidence for the launcher debug APK. Not a distributable build, a device or acceptance.", "", "| Step | Result |", "| --- | --- |",
    ...report.steps.map(row => `| ${row.name} | ${row.status}${row.error ? `: ${row.error.replace(/\|/g, "/").slice(0, 300)}` : ""} |`)];
  for (const row of report.steps) {
    if (!row.evidence) continue;
    lines.push("", `**${row.name}**`, "", "| Distribution | Class | Status |", "| --- | --- | --- |", ...row.evidence.classes.map(item => `| ${item.variant} | ${item.class} | ${item.status} |`));
  }
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const suite = process.argv[2];
  if (process.argv.length !== 3) throw new Error("Run bun scripts/ci/emulator-suite.ts instrumentation|browser-reading");
  suitePlan(suite); // Refuse an unknown suite before anything is written.
  requireHostedRunner();
  const output = path.resolve("test-results/emulator-suite", `${suite}.json`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (fs.existsSync(output)) throw new Error(`${path.relative(process.cwd(), output)} already exists; evidence is never replaced`);
  const execute: Execute = (command, env) => {
    console.log(`::group::${command.join(" ")}`);
    const result = spawnSync(command[0], command.slice(1), { stdio: "inherit", env: { ...process.env, ...env } });
    console.log("::endgroup::");
    if (result.error) throw result.error;
    return result.status ?? 1;
  };
  const report = runSuite(suite, { execute, record: value => fs.writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`) });
  const summary = summarize(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  process.exitCode = report.passed ? 0 : 1;
}
