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
 * --dispatch-plan prints the commands a person runs to dispatch the three workflows on one exact
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

export const ROOT = path.resolve(import.meta.dirname, "../..");

/** The classes and items #676 step 3 names, in its order. `class` is the short name the runner takes. */
export const ISSUE_676: ReadonlyArray<{group:string;classes:string[];notes?:Record<string,string>;items?:string[]}> = Object.freeze([
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
export const ITEM_RUNNERS: Readonly<Record<string,{runner:string|null;gap:string|null;evidence?:string}>> = Object.freeze({
  "Quick Settings tile placement and unlock": { runner: null, gap: "no instrumented class drives AlphaQuickSettingsTile (scripts/apk.ts only checks the manifest declaration); manual emulator check only" },
  "npm run agent:test-digest-restart": { runner: ".github/workflows/digest-restart.yml (job digest-restart) or locally `npm run agent:test-digest-restart`", gap: null, evidence: "host-runtime evidence (synthetic model, no emulator), not class E" },
  "resident restart, history and missed-run checks on an installed APK": { runner: "resident-android.yml job native (scripts/ci/resident-native.py) for restart; no script covers history or missed runs on an installed APK", gap: "history and missed-run checks have no runner; record them as a manual emulator procedure" },
  "upgrade from earlier installs that saved mock state": { runner: null, gap: "manual procedure only; scripts/test-installed-upgrade.ts covers Calendar and reminder upgrades, not saved mock state" },
});

const read = (root: any, file: any) => fs.readFileSync(path.join(root, file), "utf8");
const short = (name: any) => name.replace(/^.*\./, "").replace(/InstrumentedTest$/, "");

/** Every *InstrumentedTest source file under android/*\/src/**\/androidTest, keyed by short class name. */
export function instrumentedSources(root: any = ROOT) {
  const found = new Map();
  const walk = (dir: any, visit: any) => {
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
    walk(src, (file: any) => {
      const relative = path.relative(root, file).split(path.sep).join("/");
      const match = /\/src\/(androidTest|testMocks\/androidTest)\/.*\/([A-Za-z0-9_]+InstrumentedTest)\.(java|kt)$/.exec(relative);
      if (!match) return;
      const name = short(match[2]);
      found.set(name, [...(found.get(name) ?? []), { file: relative, sourceSet: match[1] }]);
    });
  }
  return found;
}

/** Classes each hosted job runs, from the job's own scripts. */
export function hostedSuites(root: any, { suitePlan, DEFAULT_CLASSES, READING_CLASSES, READING_TEST_MOCKS_CLASSES, FUSED_SPEECH_CLASSES }: any) {
  const named = (file: any) => new Set([...read(root, file).matchAll(/(?<![A-Za-z0-9_])([A-Za-z0-9_]+)InstrumentedTest/g)].map((match: any) => match[1]));
  // Bind the suite constants to the plan so a renamed suite cannot pass silently.
  const plan = (suite: any) => suitePlan(suite).map((step: any) => step.command?.join(" ") ?? step.action).join("\n");
  const inPlan = (suite: any, classes: any) => classes.filter((name: any) => suite === "instrumentation" || plan(suite).includes(name));
  return {
    "android-emulator.yml suite=instrumentation (flag-off developer pair, both flavors)": new Set(inPlan("instrumentation", DEFAULT_CLASSES)),
    "android-emulator.yml suite=browser-reading (flag-off pair)": new Set(inPlan("browser-reading", READING_CLASSES)),
    "android-emulator.yml suite=browser-reading (test-mocks pair)": new Set(inPlan("browser-reading", READING_TEST_MOCKS_CLASSES)),
    "android-emulator.yml suite=fused-speech (refused until hosted voice staging exists)": new Set(inPlan("fused-speech", FUSED_SPEECH_CLASSES)),
    "resident-android.yml job native (scripts/ci/resident-native.py)": named("scripts/ci/resident-native.py"),
    "resident-android.yml job recovery-ui (scripts/ci/pending-recovery-ui.py)": named("scripts/ci/pending-recovery-ui.py"),
  };
}

/** How to run one class locally on an owned, disposable emulator; one entry per flavor set. */
/** A class whose only methods need a test-mocks app build, even when the registry records that only in its note. */
export const needsTestMocks = (spec: any) => Boolean(spec && (spec.testMocks || spec.requiresTestMocksBuild || /needs --test-mocks/.test(spec.note ?? "")));

export function localCommand(name: any, spec: any) {
  if (!spec) return null;
  if (spec.campaign) return spec.campaign;
  const base = "npm run test:android:instrumentation -- --owned-emulator --avd <avd> --serial emulator-NNNN";
  const flags: any[] = [];
  if (spec.homeRole) flags.push("--variants launcher --home-role");
  if (needsTestMocks(spec)) flags.push("--test-mocks");
  if (spec.requires) flags.push(spec.requires);
  return `${base} ${[...flags, `--classes ${name}`].join(" ")}`;
}

export function flavorsOf(spec: any) {
  if (spec?.homeRole) return ["launcher"];
  return ["standalone", "launcher"];
}

export function buildPairOf(spec: any) {
  if (!spec) return "n/a";
  if (spec.campaign) return "as its campaign builds it";
  if (spec.testMocks) return "test-mocks pair only (class compiled only into the test-mocks instrumentation APK)";
  if (needsTestMocks(spec)) return "test-mocks pair only";
  if (spec.flagOffOnly) return "flag-off pair only";
  return "flag-off pair (also test-mocks where the class allows)";
}

export function analyse(root: any, runner: any, suite: any) {
  const sources = instrumentedSources(root);
  const suites = hostedSuites(root, { ...suite, DEFAULT_CLASSES: runner.DEFAULT_CLASSES });
  const campaignText = Object.fromEntries(runner.CAMPAIGN_RUNNERS.filter((file: string) => fs.existsSync(path.join(root, file))).map((file: string) => [file, read(root, file)]));
  const rows: any[] = [];
  for (const group of ISSUE_676) {
    for (const name of group.classes) {
      const spec = runner.CLASS_REGISTRY[name] ?? null;
      const hosted = Object.entries(suites).filter(([, set]: any) => set.has(name)).map(([suiteName]: any) => suiteName);
      const campaigns = Object.entries(campaignText).filter(([, body]: any) => new RegExp(`(?<![A-Za-z0-9_])${name}InstrumentedTest`).test(body)).map(([file]: any) => file);
      const notRun = runner.NOT_RUN_BY_A_RUNNER[name] ?? null;
      const gaps: any[] = [];
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
    for (const item of group.items ?? []) rows.push({ group: group.group, item, ...ITEM_RUNNERS[item], gaps: ITEM_RUNNERS[item]?.gap ? [ITEM_RUNNERS[item].gap] : [] });
  }
  return rows;
}

/** Commands for one exact commit; printed, never executed. */
export function dispatchPlan(sha: any, { repo = "eliza-research/alphaphone", gh = "gh" }: any = {}) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? "")) throw new Error("--sha needs the full 40-character commit");
  const ref = `ci/h31-${sha.slice(0, 12)}`;
  const R = `-R ${repo}`;
  const runs = [
    { workflow: "resident-android.yml", fields: ["-f runtime_profile=native"], jobs: "build, then native and recovery-ui", artifacts: ["resident-native-evidence-<RUN_ID>", "pending-recovery-ui-evidence-<RUN_ID>"] },
    { workflow: "android-emulator.yml", fields: ["-f suite=instrumentation"], jobs: "build, instrumentation", artifacts: ["android-emulator-build-evidence-<RUN_ID>-<ATTEMPT>", "the instrumentation job's evidence artifact"] },
    { workflow: "android-emulator.yml", fields: ["-f suite=browser-reading"], jobs: "build, browser-reading", artifacts: ["the browser-reading job's evidence artifact"] },
    { workflow: "digest-restart.yml", fields: [], jobs: "digest-restart (host runtime, no emulator)", artifacts: ["the digest-restart artifact"] },
  ];
  return {
    sha, ref,
    pin: [
      `git fetch origin ${sha}`,
      `git cat-file -e ${sha}^{commit}`,
      `git merge-base --is-ancestor ${sha} origin/main   # the candidate is on main, or say why not`,
      `git push origin ${sha}:refs/heads/${ref}   # a branch outside main/develop starts no push-triggered workflow`,
    ],
    dispatch: runs.map((run: any) => ({ ...run, command: `${gh} workflow run ${run.workflow} ${R} --ref ${ref}${run.fields.length ? ` ${run.fields.join(" ")}` : ""}` })),
    verify: [
      `${gh} run list ${R} --branch ${ref} --event workflow_dispatch --json databaseId,workflowName,headSha,status,conclusion`,
      `# every run's headSha must equal ${sha}; a different headSha is not evidence for this commit`,
      `${gh} run view <RUN_ID> ${R} --json jobs --jq '.jobs[] | [.name, .conclusion] | @tsv'   # native and recovery-ui must not be "skipped"`,
      `${gh} run download <RUN_ID> ${R} -D test-results/h31/<RUN_ID>`,
    ],
    refused: ["android-emulator.yml -f suite=fused-speech and -f suite=all stop in the build job until hosted voice staging exists; do not dispatch them"],
    cleanup: [`git push origin --delete ${ref}   # after the evidence is downloaded and committed`],
    evidenceClass: "Emulator HOME-role evidence (class E) on developer-override APKs for android-emulator.yml; PACKAGED developer APKs for resident-android.yml; host-runtime for digest-restart.yml. Not an image boot, real integration, device or user acceptance.",
  };
}

export function formatCheck(rows: any) {
  const lines = ["| Group | Class / item | Test source | Runner registration | Build pair | Flavors | Hosted job | Latest Emulator-results section naming it | Gaps |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"];
  for (const row of rows) {
    if (row.item) { lines.push(`| ${row.group} | ${row.item} | n/a | ${row.runner ?? "none"} | n/a | n/a | ${/yml/.test(row.runner ?? "") ? "see runner" : "none"} | n/a | ${row.gaps.join("; ") || "none"} |`); continue; }
    const registration = row.notRunByARunner ? "NOT_RUN_BY_A_RUNNER" : row.registered ? [row.defaultClass && "default", row.homeRole && `homeRole=${row.homeRole}`, "registered"].filter(Boolean).join(", ") : row.campaigns.length ? "campaign script only" : "none";
    lines.push(`| ${row.group} | ${row.class}${row.note ? ` (${row.note})` : ""} | ${row.sources.map((source: any) => source.sourceSet).join(", ") || "MISSING"} | ${registration}${row.campaigns.length ? `; ${row.campaigns.join(", ")}` : ""} | ${row.buildPair} | ${row.flavors.join(", ")} | ${row.hosted.join("; ") || "none"} | ${row.recorded[0] ?? "none"} | ${row.gaps.join("; ").replace(/\|/g, "/") || "none"} |`);
  }
  return `${lines.join("\n")}\n`;
}

async function loadRunner(root: any) {
  const runner = await import(path.join(root, "scripts/android-instrumentation.ts"));
  const suite = await import(path.join(root, "scripts/ci/emulator-suite.ts"));
  return { runner, suite };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--dispatch-plan") {
    const shaIndex = args.indexOf("--sha");
    const plan = dispatchPlan(args[shaIndex + 1]);
    if (args.includes("--json")) console.log(JSON.stringify(plan, null, 2));
    else {
      console.log(`# Dispatch plan for ${plan.sha} (printed only; nothing was run)\n\n# 1. Pin the commit to a ref\n${plan.pin.join("\n")}\n\n# 2. Dispatch`);
      for (const run of plan.dispatch) console.log(`${run.command}   # ${run.jobs}`);
      console.log(`\n# Refused\n# ${plan.refused.join("\n# ")}\n\n# 3. Verify and download\n${plan.verify.join("\n")}\n\n# 4. Clean up\n${plan.cleanup.join("\n")}\n\n# ${plan.evidenceClass}`);
    }
  } else if (args.every((arg: any) => arg === "--json")) {
    const { runner, suite } = await loadRunner(ROOT);
    const rows = analyse(ROOT, runner, suite);
    if (args.includes("--json")) console.log(JSON.stringify(rows, null, 2));
    else {
      console.log(formatCheck(rows));
      console.log("Local commands (owned, disposable emulator; developer APKs, then the strict-chain debug APKs):\n");
      for (const row of rows.filter((entry: any) => entry.class)) console.log(`- ${row.class} (${row.flavors.join(", ")}): ${row.local ?? (row.campaigns.length ? `see ${row.campaigns.join(", ")}` : "no command")}`);
      console.log("");
      const missing = rows.filter((row: any) => row.class && !row.sources.length).map((row: any) => row.class);
      const unrunnable = rows.filter((row: any) => row.class && row.gaps.some((gap: any) => gap.startsWith("no runner") || gap.startsWith("not registered"))).map((row: any) => row.class);
      const localOnly = rows.filter((row: any) => row.class && !row.hosted.length).map((row: any) => row.class);
      console.log(`Classes listed: ${rows.filter((row: any) => row.class).length}; missing source: ${missing.join(", ") || "none"}; no runner: ${unrunnable.join(", ") || "none"}; no hosted job: ${localOnly.length}.`);
      console.log("Emulator HOME-role evidence (class E) only; this check ran nothing on an emulator.");
    }
  } else { console.error("Usage: node scripts/owner/emulator-campaign-check.ts [--json] | --dispatch-plan --sha <commit> [--json]"); process.exitCode = 2; }
}
