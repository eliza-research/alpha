#!/usr/bin/env node
/**
 * Static check and dispatch plan for the hosted CI and emulator campaigns of issue #676 (H-31).
 *
 *   node scripts/owner/emulator-campaign-check.ts [--json]
 *   node scripts/owner/emulator-campaign-check.ts --dispatch-plan --sha <40-hex commit>
 *
 * The check reads source files only: for every instrumented class the issue lists it confirms the
 * Java/Kotlin test source exists under android/(module)/src/(androidTest|testMocks/androidTest),
 * reads how scripts/android-instrumentation.ts registers it (default, HOME-role phase, test-mocks
 * only, flag-off only, named campaign or "no runner"), whether a hosted suite runs it
 * (scripts/ci/emulator-suite.ts for android-emulator.yml, scripts/ci/resident-native.py and
 * scripts/ci/pending-recovery-ui.py for resident-android.yml) or a campaign script names it, and
 * flags each gap. It prints the local command for every class and both flavors where they apply.
 *
 * --dispatch-plan prints the commands a person runs to dispatch the two workflows on one exact
 * commit. It runs nothing: no `gh`, no `git push`, no network. workflow_dispatch takes a branch or
 * tag, not a SHA, so the plan pins the SHA to a dedicated ref first and then checks that each run's
 * headSha is that SHA.
 *
 * Everything these campaigns produce is emulator HOME-role evidence (class E) at best: not an AOSP
 * image boot, a real integration, a physical device or user acceptance.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { option } from "./input.ts";

export const ROOT = path.resolve(import.meta.dirname, "../..");

interface IssueGroup {
  group: string;
  classes: readonly string[];
  items?: readonly (keyof typeof ITEM_RUNNERS)[];
  notes?: Readonly<Record<string, string>>;
}

/** The classes and items #676 step 3 names, in its order. `class` is the short name the runner takes. */
export const ISSUE_676: readonly IssueGroup[] = Object.freeze([
  { group: "Shell/HOME", classes: ["LauncherApps", "LauncherHome", "SettingsRoles"] },
  { group: "Settings", classes: ["SettingsFlow", "ResetPolicy", "ResetExternalFixture"], items: ["Quick Settings tile placement and unlock"] },
  { group: "Assistant", classes: ["Assistant", "Flow", "ChatContinuity", "AssistantResidentReuse", "AccessibilityViews"], notes: { AccessibilityViews: "the 200% composer overlap rerun (#676 Assistant line)" } },
  { group: "Workflows", classes: ["WorkflowNoticeTap", "WorkflowNoticeProcessDeath", "HostedProcessRestart"], items: ["npm run agent:test-digest-restart"] },
  { group: "Agent", classes: ["ResidentAlwaysPresent", "ResidentService", "ResidentEgressRedaction"], items: ["resident restart, history and missed-run checks on an installed APK"] },
  { group: "Browser (Chromium 157 WebView)", classes: ["BrowserDownload", "BrowserAutofill", "PasswordBrowserFill", "BrowserIsolatedReading"] },
  { group: "Accessibility", classes: ["Accessibility", "AccessibilityViews", "AccessibilityLifecycle", "AccessibilityHomeRole", "Rotation"] },
  { group: "Media", classes: ["CameraScan", "PhotoEdit", "PhotoFilter", "PhotosBatch", "StorageCategories"] },
  { group: "Upgrade", classes: [], items: ["upgrade from earlier installs that saved mock state"] },
]);

/**
 * The local batches that cover every runnable #676 class, in run order. Each is argv for
 * `npm run test:android:instrumentation --` after `--owned-emulator --avd <avd> --serial <serial>`;
 * test/owner-emulator-campaign-check.test.mjs parses each with the runner's own parser.
 */
export const CAMPAIGN_BATCHES = Object.freeze([
  { name: "h31-flagoff", build: "flag-off", args: ["--classes", "ResidentAlwaysPresent,Assistant,Flow,ChatContinuity,AssistantResidentReuse,SettingsFlow,ResetPolicy,LauncherApps,PasswordBrowserFill,Accessibility,Rotation,CameraScan,PhotoEdit,PhotoFilter,PhotosBatch,StorageCategories"] },
  { name: "h31-home-role", build: "flag-off", args: ["--variants", "launcher", "--home-role", "--classes", "SettingsRoles,LauncherHome"] },
  { name: "h31-test-mocks", build: "test-mocks", args: ["--test-mocks", "--classes", "AccessibilityViews,AccessibilityLifecycle,HostedProcessRestart,BrowserIsolatedReading,BrowserDownload,BrowserAutofill"] },
  { name: "h31-test-mocks-home-role", build: "test-mocks", args: ["--variants", "launcher", "--home-role", "--test-mocks", "--classes", "AccessibilityHomeRole"] },
]);

/** Non-class items: what runs each, or null when nothing in the repository does. */
export const ITEM_RUNNERS = Object.freeze({
  "Quick Settings tile placement and unlock": { runner: null, gap: "no instrumented class drives AlphaQuickSettingsTile (scripts/apk.ts only checks the manifest declaration); manual emulator check only" },
  "npm run agent:test-digest-restart": { runner: ".github/workflows/resident-prepare.yml (job prepare) or locally `npm run agent:test-digest-restart`", gap: null, evidence: "host-runtime evidence (synthetic model, no emulator), not class E" },
  "resident restart, history and missed-run checks on an installed APK": { runner: "resident-android.yml job native (scripts/ci/resident-native.py) for restart; no script covers history or missed runs on an installed APK", gap: "history and missed-run checks have no runner; record them as a manual emulator procedure" },
  "upgrade from earlier installs that saved mock state": { runner: null, gap: "manual procedure only; scripts/test-installed-upgrade.ts covers Calendar and reminder upgrades, not saved mock state" },
});

const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), "utf8");
const short = (name: string) => name.replace(/^.*\./, "").replace(/InstrumentedTest$/, "");

/** Every *InstrumentedTest source file under android/*\/src/**\/androidTest, keyed by short class name. */
export function instrumentedSources(root = ROOT) {
  const found = new Map<string, { file: string; sourceSet: string }[]>();
  const walk = (dir: string, visit: (file: string) => void) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "build" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, visit); else visit(full);
    }
  };
  const android = path.join(root, "android");
  for (const module of fs.readdirSync(android, { withFileTypes: true })) {
    if (!module.isDirectory()) continue;
    const src = path.join(android, module.name, "src");
    if (!fs.existsSync(src)) continue;
    walk(src, file => {
      const relative = path.relative(root, file).split(path.sep).join("/");
      const match = /\/src\/(androidTest|testMocks\/androidTest)\/.*\/([A-Za-z0-9_]+InstrumentedTest)\.(java|kt)$/.exec(relative);
      if (!match) return;
      const name = short(match[2]);
      found.set(name, [...(found.get(name) ?? []), { file: relative, sourceSet: match[1] }]);
    });
  }
  return found;
}

type Runner = Pick<typeof import("../android-instrumentation.ts"),
  "DEFAULT_CLASSES" | "CLASS_REGISTRY" | "CAMPAIGN_RUNNERS" | "NOT_RUN_BY_A_RUNNER">;
type ClassSpec = Runner["CLASS_REGISTRY"][string];
type Suite = Pick<typeof import("../ci/emulator-suite.ts"),
  "suitePlan" | "READING_CLASSES" | "READING_TEST_MOCKS_CLASSES">;

/** Classes each hosted job runs, from the job's own scripts. */
export function hostedSuites(root: string, { suitePlan, DEFAULT_CLASSES, READING_CLASSES, READING_TEST_MOCKS_CLASSES }: Suite & Pick<Runner, "DEFAULT_CLASSES">) {
  const named = (file: string) => new Set([...read(root, file).matchAll(/(?<![A-Za-z0-9_])([A-Za-z0-9_]+)InstrumentedTest/g)].map(match => match[1]));
  // Bind the suite constants to the plan so a renamed suite cannot pass silently.
  const plan = (suite: string) => suitePlan(suite).map(step => step.command.join(" ")).join("\n");
  const inPlan = (suite: string, classes: readonly string[]) => {
    if (suite === "instrumentation") return classes;
    const commands = plan(suite);
    return classes.filter(name => commands.includes(name));
  };
  return {
    "android-emulator.yml suite=instrumentation (flag-off developer pair, both flavors)": new Set(inPlan("instrumentation", DEFAULT_CLASSES)),
    "android-emulator.yml suite=browser-reading (flag-off pair)": new Set(inPlan("browser-reading", READING_CLASSES)),
    "android-emulator.yml suite=browser-reading (test-mocks pair)": new Set(inPlan("browser-reading", READING_TEST_MOCKS_CLASSES)),
    "resident-android.yml job native (scripts/ci/resident-native.py)": named("scripts/ci/resident-native.py"),
    "resident-android.yml job recovery-ui (scripts/ci/pending-recovery-ui.py)": named("scripts/ci/pending-recovery-ui.py"),
  };
}

/** A class whose only methods need a test-mocks app build, even when the registry records that only in its note. */
export const needsTestMocks = (spec: ClassSpec | null) => Boolean(spec && (spec.testMocks || spec.requiresTestMocksBuild || /needs --test-mocks/.test(spec.note ?? "")));

/** How to run one class locally on an owned, disposable emulator. */
export function localCommand(name: string, spec: ClassSpec | null) {
  if (!spec) return null;
  if (spec.campaign) return spec.campaign;
  const base = "npm run test:android:instrumentation -- --owned-emulator --avd <avd> --serial emulator-NNNN";
  const flags = [];
  if (spec.homeRole) flags.push("--variants launcher --home-role");
  if (needsTestMocks(spec)) flags.push("--test-mocks");
  if (spec.requires) flags.push(spec.requires);
  return `${base} ${[...flags, `--classes ${name}`].join(" ")}`;
}

export function flavorsOf(spec: ClassSpec | null) {
  if (spec?.homeRole) return ["launcher"];
  return ["standalone", "launcher"];
}

export function buildPairOf(spec: ClassSpec | null) {
  if (!spec) return "n/a";
  if (spec.campaign) return "as its campaign builds it";
  if (spec.testMocks) return "test-mocks pair only (class compiled only into the test-mocks instrumentation APK)";
  if (needsTestMocks(spec)) return "test-mocks pair only";
  if (spec.flagOffOnly) return "flag-off pair only";
  return "flag-off pair (also test-mocks where the class allows)";
}

export function analyse(root: string, runner: Runner, suite: Suite) {
  const sources = instrumentedSources(root);
  const suites = hostedSuites(root, { ...suite, DEFAULT_CLASSES: runner.DEFAULT_CLASSES });
  const campaignText = Object.fromEntries(runner.CAMPAIGN_RUNNERS.filter(file => fs.existsSync(path.join(root, file))).map(file => [file, read(root, file)]));
  type ClassRow = {
    group: string; class: string; note: string | null;
    sources: {file: string; sourceSet: string}[];
    registered: boolean; defaultClass: boolean; homeRole: string | boolean | null;
    buildPair: string; flavors: string[]; hosted: string[]; campaigns: string[];
    notRunByARunner: string | null; local: string | null; gaps: string[];
  };
  type ItemRow = {group: string; item: string; runner?: string | null; gap?: string | null; gaps: string[]};
  const rows: (ClassRow | ItemRow)[] = [];
  for (const group of ISSUE_676) {
    for (const name of group.classes) {
      const spec = runner.CLASS_REGISTRY[name] ?? null;
      const hosted = Object.entries(suites).filter(([, set]) => set.has(name)).map(([suiteName]) => suiteName);
      const campaigns = Object.entries(campaignText).filter(([, body]) => new RegExp(`(?<![A-Za-z0-9_])${name}InstrumentedTest`).test(body)).map(([file]) => file);
      const unregistered: Readonly<Record<string, string>> = runner.NOT_RUN_BY_A_RUNNER;
      const notRun = unregistered[name] ?? null;
      const gaps = [];
      if (!sources.has(name)) gaps.push("no test source");
      if (!spec && !campaigns.length && !hosted.length) gaps.push(notRun ? `no runner: ${notRun}` : "not registered in scripts/android-instrumentation.ts and named by no campaign or hosted job");
      if (!hosted.length) gaps.push("no hosted job runs it: owned local emulator only (agents in this orchestration may not run emulators)");
      if (spec?.homeRole) gaps.push("HOME-role phase: no hosted suite passes --home-role");
      rows.push({
        group: group.group, class: name, note: group.notes?.[name] ?? null,
        sources: sources.get(name) ?? [], registered: Boolean(spec), defaultClass: runner.DEFAULT_CLASSES.includes(name),
        homeRole: spec?.homeRole ?? null, buildPair: buildPairOf(spec), flavors: flavorsOf(spec),
        hosted, campaigns, notRunByARunner: notRun, local: localCommand(name, spec), gaps,
      });
    }
    for (const item of group.items ?? []) {
      const spec = ITEM_RUNNERS[item];
      rows.push({ group: group.group, item, ...spec, gaps: spec.gap ? [spec.gap] : [] });
    }
  }
  return rows;
}

/** Commands for one exact commit; printed, never executed. */
export function dispatchPlan(sha: string | undefined, { repo = "eliza-research/alphaphone", gh = "gh" } = {}) {
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) throw new Error("--sha needs the full 40-character commit");
  const ref = `ci/h31-${sha.slice(0, 12)}`;
  const R = `-R ${repo}`;
  const runs = [
    { workflow: "resident-android.yml", fields: ["-f runtime_profile=native"], jobs: "build, then native and recovery-ui", artifacts: ["resident-native-evidence-<RUN_ID>", "pending-recovery-ui-evidence-<RUN_ID>"] },
    { workflow: "android-emulator.yml", fields: ["-f suite=instrumentation"], jobs: "build, instrumentation", artifacts: ["android-emulator-build-evidence-<RUN_ID>-<ATTEMPT>", "the instrumentation job's evidence artifact"] },
    { workflow: "android-emulator.yml", fields: ["-f suite=browser-reading"], jobs: "build, browser-reading", artifacts: ["the browser-reading job's evidence artifact"] },
  ];
  return {
    sha, ref,
    pin: [
      `git fetch origin ${sha}`,
      `git cat-file -e ${sha}^{commit}`,
      `git merge-base --is-ancestor ${sha} origin/main   # the candidate is on main, or say why not`,
      `git push origin ${sha}:refs/heads/${ref}   # a branch outside main/develop starts no push-triggered workflow`,
    ],
    dispatch: runs.map(run => ({ ...run, command: `${gh} workflow run ${run.workflow} ${R} --ref ${ref}${run.fields.length ? ` ${run.fields.join(" ")}` : ""}` })),
    verify: [
      `${gh} run list ${R} --branch ${ref} --event workflow_dispatch --json databaseId,workflowName,headSha,status,conclusion`,
      `# every run's headSha must equal ${sha}; a different headSha is not evidence for this commit`,
      `${gh} run view <RUN_ID> ${R} --json jobs --jq '.jobs[] | [.name, .conclusion] | @tsv'   # native and recovery-ui must not be "skipped"`,
      `${gh} run download <RUN_ID> ${R} -D test-results/h31/<RUN_ID>`,
    ],
    cleanup: [`git push origin --delete ${ref}   # after the evidence is downloaded and committed`],
    evidenceClass: "Emulator HOME-role evidence (class E) on developer-override APKs for android-emulator.yml; PACKAGED developer APKs for resident-android.yml. Not an image boot, real integration, device or user acceptance.",
  };
}

export function formatCheck(rows: ReturnType<typeof analyse>) {
  const lines = ["| Group | Class / item | Test source | Runner registration | Build pair | Flavors | Hosted job | Gaps |", "| --- | --- | --- | --- | --- | --- | --- | --- |"];
  for (const row of rows) {
    if ("item" in row) { lines.push(`| ${row.group} | ${row.item} | n/a | ${row.runner ?? "none"} | n/a | n/a | ${/yml/.test(row.runner ?? "") ? "see runner" : "none"} | ${row.gaps.join("; ") || "none"} |`); continue; }
    const registration = row.notRunByARunner ? "NOT_RUN_BY_A_RUNNER" : row.registered ? [row.defaultClass && "default", row.homeRole && `homeRole=${row.homeRole}`, "registered"].filter(Boolean).join(", ") : row.campaigns.length ? "campaign script only" : "none";
    lines.push(`| ${row.group} | ${row.class}${row.note ? ` (${row.note})` : ""} | ${row.sources.map(source => source.sourceSet).join(", ") || "MISSING"} | ${registration}${row.campaigns.length ? `; ${row.campaigns.join(", ")}` : ""} | ${row.buildPair} | ${row.flavors.join(", ")} | ${row.hosted.join("; ") || "none"} | ${row.gaps.join("; ").replace(/\|/g, "/") || "none"} |`);
  }
  return `${lines.join("\n")}\n`;
}

async function loadRunner(root: string) {
  const runner: Runner = await import(path.join(root, "scripts/android-instrumentation.ts"));
  const suite: Suite = await import(path.join(root, "scripts/ci/emulator-suite.ts"));
  return { runner, suite };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--dispatch-plan") {
    const plan = dispatchPlan(option(args, "--sha"));
    if (args.includes("--json")) console.log(JSON.stringify(plan, null, 2));
    else {
      console.log(`# Dispatch plan for ${plan.sha} (printed only; nothing was run)\n\n# 1. Pin the commit to a ref\n${plan.pin.join("\n")}\n\n# 2. Dispatch`);
      for (const run of plan.dispatch) console.log(`${run.command}   # ${run.jobs}`);
      console.log(`\n# 3. Verify and download\n${plan.verify.join("\n")}\n\n# 4. Clean up\n${plan.cleanup.join("\n")}\n\n# ${plan.evidenceClass}`);
    }
  } else if (args.every(arg => arg === "--json")) {
    const { runner, suite } = await loadRunner(ROOT);
    const rows = analyse(ROOT, runner, suite);
    if (args.includes("--json")) console.log(JSON.stringify(rows, null, 2));
    else {
      console.log(formatCheck(rows));
      console.log("Local commands (owned, disposable emulator; developer APKs, then the strict-chain debug APKs):\n");
      const classes = rows.filter((row): row is Extract<typeof row, {class: string}> => "class" in row);
      for (const row of classes) console.log(`- ${row.class} (${row.flavors.join(", ")}): ${row.local ?? (row.campaigns.length ? `see ${row.campaigns.join(", ")}` : "no command")}`);
      console.log("");
      const missing = classes.filter(row => !row.sources.length).map(row => row.class);
      const unrunnable = classes.filter(row => row.gaps.some(gap => gap.startsWith("no runner") || gap.startsWith("not registered"))).map(row => row.class);
      const localOnly = classes.filter(row => !row.hosted.length).map(row => row.class);
      console.log(`Classes listed: ${classes.length}; missing source: ${missing.join(", ") || "none"}; no runner: ${unrunnable.join(", ") || "none"}; no hosted job: ${localOnly.length}.`);
      console.log("Emulator HOME-role evidence (class E) only; this check ran nothing on an emulator.");
    }
  } else { console.error("Usage: node scripts/owner/emulator-campaign-check.ts [--json] | --dispatch-plan --sha <commit> [--json]"); process.exitCode = 2; }
}
