// scripts/owner/emulator-campaign-check.mjs (issue #676, H-31): every listed class has a test
// source, the hosted-suite mapping is read from the suite's own plan, the local batches parse with
// the runner's own argument parser, and the dispatch plan only prints commands for an exact SHA.
import test from "node:test";
import assert from "node:assert/strict";
import * as runner from "../scripts/android-instrumentation.mjs";
import * as suite from "../scripts/ci/emulator-suite.mjs";
import { CAMPAIGN_BATCHES, ISSUE_676, ROOT, analyse, dispatchPlan, instrumentedSources, localCommand } from "../scripts/owner/emulator-campaign-check.mjs";

const rows = analyse(ROOT, runner, suite);
const classes = rows.filter(row => row.class);

test("every class #676 lists has an instrumented test source", () => {
  const sources = instrumentedSources(ROOT);
  for (const group of ISSUE_676) for (const name of group.classes) assert.ok(sources.has(name), `${name}InstrumentedTest source`);
  assert.equal(classes.filter(row => !row.sources.length).length, 0);
});

test("hosted-suite mapping comes from the suites themselves", () => {
  const byName = Object.fromEntries(classes.map(row => [row.class, row]));
  assert.ok(byName.BrowserIsolatedReading.hosted.some(name => name.includes("browser-reading (test-mocks pair)")));
  assert.ok(byName.WorkflowNoticeTap.hosted.some(name => name.includes("recovery-ui")));
  assert.ok(byName.WorkflowNoticeProcessDeath.hosted.some(name => name.includes("recovery-ui")));
  for (const name of runner.DEFAULT_CLASSES) assert.ok(!byName[name] || byName[name].hosted.some(entry => entry.includes("suite=instrumentation")), name);
  // HOME-role classes have no hosted suite, and the check says so.
  for (const row of classes.filter(entry => entry.homeRole)) assert.ok(row.gaps.some(gap => gap.startsWith("HOME-role phase")), row.class);
});

test("every runnable class is in exactly the batch its build needs, and every batch parses", () => {
  const base = ["--owned-emulator", "--avd", "test", "--serial", "emulator-5554"];
  const covered = new Set();
  for (const batch of CAMPAIGN_BATCHES) {
    const options = runner.parseInstrumentationArgs([...base, ...batch.args]);
    assert.equal(options.testMocks, batch.build === "test-mocks", batch.name);
    for (const cls of options.classes) covered.add(cls.replace(/^.*\./, "").replace(/InstrumentedTest$/, ""));
  }
  for (const row of classes) {
    const spec = runner.CLASS_REGISTRY[row.class];
    const runnableHere = spec && !spec.campaign;
    assert.equal(covered.has(row.class), Boolean(runnableHere), row.class);
  }
});

test("local commands keep HOME-role classes on the launcher and the test-mocks classes on that pair", () => {
  assert.match(localCommand("LauncherHome", runner.CLASS_REGISTRY.LauncherHome), /--variants launcher --home-role --classes LauncherHome$/);
  assert.match(localCommand("BrowserDownload", runner.CLASS_REGISTRY.BrowserDownload), /--test-mocks --classes BrowserDownload$/);
  assert.equal(localCommand("Nope", undefined), null);
});

test("the dispatch plan pins an exact SHA to a non-main ref and runs nothing", () => {
  assert.throws(() => dispatchPlan("main"));
  assert.throws(() => dispatchPlan("abc123"));
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const plan = dispatchPlan(sha);
  assert.equal(plan.ref, "ci/h31-0123456789ab");
  assert.ok(plan.pin.some(line => line.startsWith(`git push origin ${sha}:refs/heads/ci/h31-`)));
  assert.deepEqual(plan.dispatch.map(run => run.workflow), ["resident-android.yml", "android-emulator.yml", "android-emulator.yml", "digest-restart.yml"]);
  assert.ok(plan.dispatch.every(run => run.command.includes(`--ref ${plan.ref}`) && run.command.includes("-R eliza-research/alphaphone")));
  assert.ok(plan.dispatch[0].command.endsWith("-f runtime_profile=native"));
  assert.ok(!plan.dispatch.some(run => /suite=(fused-speech|all)/.test(run.command)));
  assert.ok(plan.verify.some(line => line.includes(sha)));
});
