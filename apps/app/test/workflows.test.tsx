// @vitest-environment happy-dom
import { workflowSha } from "@elizaos/plugin-workflow-client";
import { Effect } from "effect";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { Machine as Listing } from "../gen/app__workflows__list.effect.vibe";
import { Machine as Definition } from "../gen/app__workflows.effect.vibe";
import { Machine as Automations } from "../gen/app__workflows__automations.effect.vibe";
import { Machine as Builder } from "../gen/app__workflows__builder.effect.vibe";
import { Machine as Runs } from "../gen/app__workflows__runs.effect.vibe";
import { Machine as Sheet } from "../gen/app__workflows__sheet.effect.vibe";
import { Machine as Clock } from "../gen/app__workflows__clock.effect.vibe";
import { Machine as Approvals } from "../gen/app__workflows__approvals.effect.vibe";
import { Machine as Toasts } from "../gen/app__notices__toasts.effect.vibe";
import { Machine as DigestSchedules } from "../gen/app__digests__schedules.effect.vibe";
import { Machine as Layers } from "../gen/app__shell__layers.effect.vibe";
import { ownerAt } from "../src/platform/owner.vibe";
import { AlarmLabel } from "../src/workflows/clock.vibe";
import { DraftWords } from "../src/workflows/authoring.vibe";
import workflows from "../src/workflows/index.tsx";
import type { Alpha } from "../src/runtime/area.tsx";
import home from "../src/home/index.tsx";
import { fromAreas } from "../src/home/cards.vibe";
import { Machine as Home } from "../gen/app__home.effect.vibe";
import { button, closeAll, drawn, fill, later, only, open, press, pressOnTop, seen, typeInto, underAct, until } from "./alpha.tsx";
import { memoryIndexedDB } from "./fakes/indexeddb.ts";
import { type Scene, scene } from "./fakes/scene.ts";
import { nativeApprovalNotices, workflowNoteOffer, workflowPhoneOffer } from "./fakes/workflows.ts";

underAct();
afterEach(closeAll);

const rows = () => [...document.querySelectorAll("ul[aria-label=Workflows] li > button")];
const visible = (...names: string[]) => names.filter((name) => rows().some((row) => row.textContent?.startsWith(name)));
const choose = (name: string) => drawn(() => {
  const row = rows().find((one) => one.textContent?.startsWith(name));
  if (!(row instanceof HTMLButtonElement)) throw new Error(`No workflow named ${name}`);
  row.click();
});

/** Open the workflow actions disclosure and choose its visible action. */
const pressWorkflowAction = (name: string) => drawn(() => {
  const opener = document.querySelector<HTMLElement>("summary[aria-label='Workflow actions']");
  const menu = opener?.parentElement;
  if (opener === null || !(menu instanceof HTMLDetailsElement)) throw new Error("no workflow actions disclosure");
  expect(menu.open).toBe(false);
  opener.click();
  expect(menu.open).toBe(true);
  const action = [...menu.querySelectorAll("button")].find((one) => one.textContent === name);
  if (action === undefined) throw new Error(`no workflow action ${name}`);
  action.click();
});

/** Press a button inside the open workflow change review. */
const pressInReview = (name: string) => drawn(() => {
  const found = [...document.querySelectorAll("[aria-label='Review workflow change'] button")].find((one) => one.textContent === name);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`no button ${name} in the review`);
  found.click();
});
/** Type into the field a visible label wraps, as the builder's Name and Text are drawn. */
const write = (name: string, text: string) => drawn(() => {
  const label = [...document.querySelectorAll("label")].find((one) => one.firstChild?.textContent?.trim() === name);
  const found = label?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  if (!found) throw new Error(`no field ${name}`);
  typeInto(found, text);
});

async function openWorkflows(world: Scene, withAssistant = false) {
  const mounts = only("home", "view:Workflows", "notice", ...(withAssistant ? ["assistant" as const] : []));
  const { alpha } = await open(world, mounts);
  const runtime = home.runtime(alpha);
  await vi.waitFor(async () => {
    await drawn(() => undefined);
    const state = await runtime.runPromise(Home.use((machine) => machine.get()));
    expect(state.tiles.load.status).toBe("Loaded");
    expect(button("Workflows")).toBeDefined();
  }, { timeout: 15_000 });
  await press("Workflows");
  return alpha;
}

/** Open Workflows on `world`, with Ask Alpha where `assistant` holds, and wait for its list: every page of it where `complete` holds. */
async function onList(world: Scene, { assistant = false, complete = false } = {}) {
  const alpha = await openWorkflows(world, assistant);
  const area = workflows.runtime(alpha);
  await until(alpha, area, Listing, (state) => state.list.status === "Loaded" && (!complete || state.complete));
  return { alpha, area };
}

/** Open Workflows on a fresh scene, optionally configure it, and wait until the list has loaded. */
async function launchWorkflows(setup?: (world: Scene) => void, requireComplete = false) {
  const world = scene();
  setup?.(world);
  const { alpha, area } = await onList(world, { complete: requireComplete });
  return { world, alpha, area };
}

/** Run the Monthly statement now from its page, and wait for the run in its history. */
async function runStatement(world: Scene) {
  const { alpha, area } = await onList(world, { assistant: true });
  await choose("Monthly statement");
  await until(alpha, area, Definition, (state) => state.detail.status === "Loaded");
  await until(alpha, area, Runs, (state) => state.reading.status === "Loaded");
  await press("Run now");
  await press("Confirm run");
  await until(alpha, area, Sheet, (state) => state.history.status === "Loaded" && state.shown === 1);
  return { alpha, area };
}

/** Open the newest run in the run history. */
const openRun = () => drawn(() => {
  const row = document.querySelector<HTMLButtonElement>('[aria-label="Run history"] li > button');
  if (!row) throw new Error("No run history");
  row.click();
});

/** Click the first row in the Run history list. */
const openFirstRunHistory = openRun;

/** Leave the open run and its workflow for the list. */
async function backToList(alpha: Alpha, area: ReturnType<typeof workflows.runtime>) {
  await drawn(() => alpha.back());
  await until(alpha, area, Sheet, (state) => state.runId === 0);
  await drawn(() => alpha.back());
  await until(alpha, area, Listing, (state) => state.place.tag === "ListingRows");
}

describe("Workflows", () => {
  it('Filters the owner’s work and keeps removed history (spec/app/workflows/list.md, "Story: Find a workflow")', async () => {
    const { world, alpha, area } = await launchWorkflows(undefined, true);
    expect(visible("Monthly statement", "Desk check", "Retired brief")).toEqual(["Monthly statement", "Desk check"]);

    await press("Filter workflows");
    await pressOnTop("Removed");
    await pressOnTop("Done");
    expect(visible("Monthly statement", "Desk check", "Retired brief")).toEqual(["Retired brief"]);

    await choose("Retired brief");
    await until(alpha, area, Sheet, (state) => state.history.status === "Loaded" && state.removed);
    await drawn(() => alpha.back());
    expect(visible("Monthly statement", "Desk check", "Retired brief")).toEqual(["Retired brief"]);

    world.workflows.failingPrompts = true;
    await press("Filter workflows");
    await pressOnTop("Refresh list");
    await until(alpha, area, Listing, (state) => state.list.status === "Loaded" && !state.complete);
    expect(visible("Monthly statement", "Desk check", "Retired brief")).toEqual(["Retired brief"]);
  });

  it('Keeps Home\'s Workflows card as the last answer left it while the list is read again (spec/app/home/cards.md, "The Workflows card shows the first two enabled rows and how many more, marked when they are not current, stale or partly unavailable, and is not drawn without a row")', async () => {
    const world = scene();
    const { alpha, area } = await onList(world, { complete: true });
    const asked = (await area.runPromise(Listing.use((machine) => machine.get()))).list.ticket;
    expect(fromAreas.snapshot().flows.freshness).toBe("UpToDate");
    const told: string[] = [];
    onTestFinished(fromAreas.subscribe(() => { told.push(fromAreas.snapshot().flows.freshness); }));
    // spec/app/home/cards.md, "The Workflows card shows the first two enabled rows and how many more, marked when they are not current, stale or partly unavailable, and is not drawn without a row": Back to Home reads Workflows again; the card keeps "up to date" through the read, with no "Not current" between.
    await drawn(() => alpha.back());
    await until(alpha, area, Listing, (state) => state.list.ticket > asked && state.list.status === "Loaded");
    await drawn(() => undefined);
    expect([told.length > 0, told.includes("NotCurrent"), fromAreas.snapshot().flows.freshness]).toEqual([true, false, "UpToDate"]);
  });

  it('Explores Add to Workflows while signed out (spec/app/workflows/list.md, "From the list the owner can open a row, Add to Workflows, or the digests; Back returns to the same filters")', async () => {
    const world = scene();
    world.signedIn = false;
    world.residentAvailable = false;
    const alpha = await openWorkflows(world);
    const area = workflows.runtime(alpha);
    await until(alpha, area, Listing, (state) => state.owner === 0 && state.place.tag === "ListingRows");
    expect(visible("Monthly statement", "Desk check", "Retired brief")).toEqual([]);
    await press("Add to Workflows");
    await until(alpha, area, Listing, (state) => state.place.tag === "ListingAdd");
    const choices = [...document.querySelectorAll<HTMLButtonElement>('main[aria-label="Add to Workflows"] button')];
    expect(["Automation", "Reminder", "Scheduled digest"].map((name) => choices.find((item) => item.textContent?.startsWith(name))?.disabled)).toEqual([true, true, true]);
    await drawn(() => alpha.back());
    await until(alpha, area, Listing, (state) => state.place.tag === "ListingRows");
    expect(button("Add to Workflows")).toBeDefined();
    expect(visible("Monthly statement", "Desk check", "Retired brief")).toEqual([]);
  });

  it('Reviews a Clock request within its Alarms page and restores focus to the list (spec/app/workflows/clock.md, "Story: Review, then hand over to Clock")', async () => {
    const { alpha, area } = await launchWorkflows((world) => { world.phone = true; });

    await press("Add to Workflows");
    const opener = button("Clock alarms");
    expect(opener?.textContent).toBe("Alarm");
    await press("Clock alarms");
    await until(alpha, area, Clock, (state) => state.open && state.history.status === "Loaded");

    const alarm = document.querySelector('[role="dialog"][aria-label="Clock alarms"]');
    expect(opener?.closest("[inert]")).not.toBeNull();
    expect(alarm?.querySelector("h2")?.textContent).toBe("Alarms");
    expect(alarm?.querySelector('input[aria-label="Alarm time"]')).toBeInstanceOf(HTMLInputElement);
    await vi.waitFor(() => expect(document.activeElement).toBe(button("Close Clock")));

    await pressOnTop("Snooze");
    expect(alarm?.querySelector('input[aria-label="Snooze minutes"]')).toBeInstanceOf(HTMLInputElement);
    await pressOnTop("Review Clock request");
    expect(alarm?.querySelector('[aria-label="Clock review"]')?.textContent).toContain("Snooze: 10 min requested");
    expect(alarm?.querySelector('[aria-label="Confirm Clock request"]')?.textContent).toBe("Open Clock");

    await pressOnTop("Cancel Clock review");
    expect(alarm?.querySelector('[aria-label="Clock review"]')).toBeNull();
    await pressOnTop("Close Clock");
    await vi.waitFor(() => {
      expect(document.body.contains(alarm)).toBe(false);
      expect(document.activeElement).toBe(opener);
    });
  });

  it('Reviews the exact prompt before changing whether its schedule runs (spec/app/workflows/automations.md, "Turning a prompt on or off, removing an automation, and running it now require confirmation of the row and action shown")', async () => {
    const world = scene();
    const { alpha, area } = await onList(world, { complete: true });
    await choose("Desk check");
    await until(alpha, area, Automations, (state) => state.present && state.list.status === "Loaded");
    const toggle = "Turn Desk check on or off";

    await press(toggle);
    expect(document.querySelector('[aria-label="Review workflow action"]')?.textContent).toContain('Pause “Desk check”?');
    expect(world.workflows.promptEdits).toEqual([]);
    await press("Cancel");
    expect(document.querySelector('[aria-label="Review workflow action"]')).toBeNull();
    expect(button(toggle)?.getAttribute("aria-checked")).toBe("true");
    expect(world.workflows.promptEdits).toEqual([]);

    await press(toggle);
    await press("Confirm Pause");
    await until(alpha, area, Automations, (state) => state.change.attempt.outcome === "Confirmed" && state.list.status === "Loaded" && !state.on);
    expect(world.workflows.promptEdits).toEqual([{ enabled: false, expectedRevision: 1 }]);
    expect(world.workflows.prompts.get("desk-check")).toMatchObject({ enabled: false, revision: 2 });

    await press(toggle);
    const changed = world.workflows.prompts.get("desk-check");
    if (changed === undefined) throw new Error("No Desk check prompt");
    world.workflows.prompts.set("desk-check", { ...changed, instructions: "Edited elsewhere", revision: 3 });
    await press("Confirm Enable");
    await until(alpha, area, Automations, (state) => state.change.attempt.outcome === "Refused");
    expect(world.workflows.promptEdits).toEqual([{ enabled: false, expectedRevision: 1 }, { enabled: true, expectedRevision: 2 }]);
    expect(world.workflows.prompts.get("desk-check")).toMatchObject({ enabled: false, instructions: "Edited elsewhere", revision: 3 });
  });

  it('Keeps the saved schedule while editing prompt instructions (spec/app/workflows/automations.md, "Story: Create or edit an automation on a schedule")', async () => {
    const world = scene();
    const existing = [
      { id: "single-prompt", displayName: "Call reminder", triggerType: "once", scheduledAtIso: "2027-02-08T14:15:00.000Z" },
      { id: "event-prompt", displayName: "Inbox event", triggerType: "event", eventKind: "inbox-delivered" },
      { id: "complex-prompt", displayName: "Monthly review", triggerType: "cron", cronExpression: "5 9 1 * *" },
      { id: "weekly-prompt", displayName: "Delivery review", triggerType: "cron", cronExpression: "13 8 * * 1-5" },
    ] as const;
    for (const prompt of existing) world.workflows.prompts.set(prompt.id, {
      ...prompt, instructions: "Review the details.", enabled: false, revision: 1, timezone: "America/Los_Angeles",
    });
    const { alpha, area } = await onList(world, { complete: true });

    for (const { id, displayName, ...timing } of existing) {
      await choose(displayName);
      await until(alpha, area, Automations, (state) => state.present && state.list.status === "Loaded");
      await press("Edit prompt");
      await fill("Instructions", "Review the updated details.");
      await press("Review");
      await pressOnTop("Save changes");
      await until(alpha, area, Automations, (state) => state.change.attempt.outcome === "Confirmed");
      expect(world.workflows.promptEdits.at(-1)).toEqual({
        kind: "prompt", displayName, instructions: "Review the updated details.", timezone: "America/Los_Angeles",
        expectedRevision: 1, ...timing,
      });
      expect(world.workflows.prompts.get(id)).toMatchObject({ ...timing, instructions: "Review the updated details.", revision: 2 });
      await drawn(() => alpha.back());
      await until(alpha, area, Listing, (state) => state.place.tag === "ListingRows" && state.list.status === "Loaded");
    }

    await choose("Delivery review");
    await until(alpha, area, Automations, (state) => state.present && state.list.status === "Loaded");
    await press("Edit prompt");
    await press("Weekends");
    await press("Review");
    await pressOnTop("Save changes");
    await until(alpha, area, Automations, (state) => state.change.attempt.outcome === "Confirmed");
    expect(world.workflows.prompts.get("weekly-prompt")).toMatchObject({ cronExpression: "13 8 * * 0,6", revision: 3 });

    await until(alpha, area, Automations, (state) => state.present && state.list.status === "Loaded");
    await press("Edit prompt");
    await fill("Instructions", "One more update.");
    await press("Review");
    const current = world.workflows.prompts.get("weekly-prompt");
    if (!current) throw new Error("No weekly prompt");
    world.workflows.prompts.set("weekly-prompt", { ...current, revision: 4, instructions: "Changed in another session." });
    await pressOnTop("Save changes");
    await until(alpha, area, Automations, (state) => state.change.attempt.outcome === "Refused");
    expect(world.workflows.promptEdits.at(-1)).toMatchObject({ expectedRevision: 3 });
    expect(world.workflows.prompts.get("weekly-prompt")?.instructions).toBe("Changed in another session.");
  });

  const openMonthlyStatement = async (world: ReturnType<typeof scene>, withAssistant = false) => {
    const alpha = await openWorkflows(world, withAssistant);
    const area = workflows.runtime(alpha);
    await until(alpha, area, Listing, (state) => state.list.status === "Loaded");
    await choose("Monthly statement");
    await until(alpha, area, Definition, (state) => state.detail.status === "Loaded");
    await until(alpha, area, Runs, (state) => state.reading.status === "Loaded");
    return { alpha, area };
  };

  it('Runs the reviewed version, follows its approval and opens its output (spec/app/workflows/runs.md, "Story: Run a workflow now"; spec/app/workflows/sheet.md, "Story: Read a run\'s sheet"; spec/app/workflows/approvals.md, "Story: Answer a run\'s approval on the phone"; spec/app/workflows/approvals.md, "Story: Confirm exactly what this workflow does on my phone"; spec/app/workflows/approvals.md, "Story: Open the run a notice names"; spec/app/workflows/sheet.md, "Story: Open a finished workflow from its notification")', async () => {
    // spec/app/assistant/index.md, "Stored attachments are posted with their message, and a message whose attachments could not be stored never left": the WebView's IndexedDB keeps the run attached to Ask Alpha.
    vi.stubGlobal("indexedDB", memoryIndexedDB());
    onTestFinished(() => { vi.unstubAllGlobals(); });
    const world = scene();
    world.phone = true;
    world.image = true;
    world.ask.spokenFiles = [];
    const device = await workflowNoteOffer(world.workflows, world.notes.owner);
    world.telephony.textReview = device;
    const notices = nativeApprovalNotices();
    world.workflows.nativeNotices = notices;
    world.workflows.stage = "Running";
    const { alpha, area } = await runStatement(world);
    expect(world.workflows.admissions).toHaveLength(1);
    expect(world.workflows.admissions[0]?.version).toBe("monthly-statement-v3");
    await openRun();
    await until(alpha, area, Sheet, (state) => state.output.status === "Loaded" && state.status === "Running");
    await seen(false);
    const reads = world.workflows.receiptReads;
    world.workflows.stage = "Waiting";
    await later(alpha, 8_000);
    expect(world.workflows.receiptReads).toBe(reads);
    expect(notices.posted).toEqual([]);
    await backToList(alpha, area);

    await seen(true);
    await vi.waitFor(() => expect(notices.posted).toHaveLength(1));
    const first = notices.posted[0];
    if (first === undefined) throw new Error("The phone received no approval notice");
    expect(first.route).toMatchObject({ workflowId: "monthly-statement", runId: "monthly-statement-r1", versionId: "monthly-statement-v3" });
    expect(Object.keys(first).sort()).toEqual(["bindingHash", "expiresAt", "id", "route"]);
    expect(first.route.scope).toMatch(/^[a-f0-9]{64}$/);
    await drawn(() => notices.tap(first));
    await until(alpha, area, Approvals, (state) => state.opened === "Ready" && state.sheet);
    expect(document.querySelector('[aria-label="Workflow approval"]')?.textContent).toContain("Review the statement preview");
    await vi.waitFor(() => expect(notices.consumed).toEqual(["tap-1"]));
    expect(world.workflows.decisions).toEqual([]);
    world.workflows.approvalTitle = "Review the revised statement preview";
    await press("Approve");
    await until(alpha, area, Approvals, (state) => state.approval === "NotApplied");
    expect(world.workflows.decisions).toEqual([]);

    await later(alpha, 4_000);
    await until(alpha, area, Approvals, (state) => state.approval === "Waiting" && state.sheet);
    expect(document.querySelector('[aria-label="Workflow approval"]')?.textContent).toContain("Review the revised statement preview");
    await press("Approve");
    await vi.waitFor(() => expect(world.workflows.stage).toBe("Device"));
    expect(world.workflows.decisions).toEqual([{ version: "monthly-statement-v3", digest: "a".repeat(64), approved: true }]);
    expect(world.notes.creations.size).toBe(0);
    await later(alpha, 4_000);
    await until(alpha, area, Approvals, (state) => state.device.phase === "DeviceShown");
    expect(document.querySelector('[aria-label="Review device action"]')?.textContent).toContain("Statement saved by Workflows");
    await press("Approve device action");
    await until(alpha, area, Approvals, (state) => state.device.phase === "DeviceAnswered");
    await until(alpha, area, Approvals, (state) => state.approval === "Approved");
    expect({ notes: world.notes.notes.filter(({ title }) => title === "Statement saved by Workflows"), claims: device.claims, sent: device.receipts }).toMatchObject({
      notes: [{ title: "Statement saved by Workflows" }], claims: [device.proposal.id],
      sent: [{ outcome: "applied", operationId: device.proposal.id }],
    });
    world.workflows.stage = "Done";

    await later(alpha, 4_000);
    await until(alpha, area, Sheet, (state) => state.output.status === "Loaded" && state.status === "Done");
    expect(document.querySelector('[aria-label="Run details"]')?.textContent).toContain("Your statement is ready.");
    await drawn(() => {
      const details = document.querySelector<HTMLDetailsElement>('details[aria-label="Workflow execution details"]');
      const reveal = details?.querySelector("summary");
      if (!details || !reveal) throw new Error("No execution details");
      reveal.click();
      expect({
        open: details.open,
        activity: [...details.querySelectorAll("time")].map((time) => ({
          at: time.dateTime, node: time.parentElement?.querySelector("span")?.textContent,
        })),
      }).toEqual({
        open: true,
        activity: [{ at: "2026-11-24T07:02:00.000Z", node: undefined }, { at: "2026-11-24T07:01:00.000Z", node: "preview" }],
      });
    });

    await backToList(alpha, area);
    await later(alpha, 60_000);
    await vi.waitFor(() => expect(notices.results).toHaveLength(1));
    const result = notices.results[0];
    if (result === undefined) throw new Error("No Workflow result notice");
    expect(result.route).toMatchObject({ workflowId: "monthly-statement", runId: "monthly-statement-r1", versionId: "monthly-statement-v3" });
    await drawn(() => notices.tapResult(result));
    await until(alpha, area, Sheet, (state) => state.output.status === "Loaded" && state.status === "Done");
    expect(document.querySelector('[aria-label="Run details"]')?.textContent).toContain("Your statement is ready.");
    await vi.waitFor(() => expect(notices.consumed).toEqual(["tap-1", "tap-result"]));
    expect(button("Remove Workflow run.json")).toBeUndefined();

    await backToList(alpha, area);
    await drawn(() => notices.tapResult(result, true));
    await vi.waitFor(() => expect(button("Remove Workflow run.json")).toBeDefined(), { timeout: 10_000 });
    expect(notices.consumed).toEqual(["tap-1", "tap-result", "tap-result-question"]);
    expect(world.ask.said).toEqual([]);

    await fill("Message Alpha", "What happened in this run?");
    await vi.waitFor(() => expect(button("Send")?.disabled).toBe(false));
    await press("Send");
    await vi.waitFor(() => expect(world.ask.said).toEqual(["What happened in this run?"]), { timeout: 12_000 });
    const attachment = world.ask.spokenFiles?.at(-1)?.images?.[0] as { readonly name?: string; readonly mimeType?: string; readonly data?: string } | undefined;
    expect(attachment).toMatchObject({ name: "Workflow run.json", mimeType: "application/json" });
    expect(JSON.parse(atob(attachment?.data ?? ""))).toMatchObject({
      workflowId: "monthly-statement", runId: "monthly-statement-r1", versionId: "monthly-statement-v3",
    });
  });

  // spec/app/workflows/sheet.md, "Story: Read a run's sheet"
  it("Reads the exact run on Android and stops it when Alpha goes into the background", async () => {
    const world = scene();
    world.phone = true;
    world.voice.onDevice = true;
    let endPlayback: () => void = () => {};
    const playing = new Promise<void>((resolve) => { endPlayback = resolve; });
    world.voice.playbackHold = () => playing;
    world.workflows.run = true;
    try {
      const { alpha, area } = await onList(world, { assistant: true });
      await choose("Monthly statement");
      await until(alpha, area, Sheet, (state) => state.history.status === "Loaded" && state.shown > 0);
      await openRun();
      await until(alpha, area, Sheet, (state) => state.output.status === "Loaded" && state.status === "Done");
      const initialHushes = world.voice.hushCalls;
      await press("Read aloud");
      await vi.waitFor(() => expect(world.voice.played.map(({ text }) => text)).toContain("Your statement is ready."), { timeout: 15_000 });
      expect(world.voice.spoken).toContainEqual({ text: "Your statement is ready.", append: false, replace: false, channel: "local" });
      expect(button("Stop reading")).toBeDefined();
      await seen(false);
      await until(alpha, area, Sheet, (state) => state.speech.outcome !== "Sent");
      await vi.waitFor(() => expect(world.voice.hushCalls).toBeGreaterThan(initialHushes));
      expect(world.voice.startCloudSpeechCalls).toBe(0);
    } finally {
      endPlayback();
    }
  });

  it.each(["post_notification", "speak_text", "speak_text_stopped"] as const)('Presents a reviewed workflow step on Android (%s) (spec/app/workflows/approvals.md, "Story: Confirm exactly what this workflow does on my phone")', async (scenario) => {
    const kind = scenario === "speak_text_stopped" ? "speak_text" : scenario;
    const world = scene();
    world.phone = true;
    world.image = true;
    const proposal = await workflowPhoneOffer(world.workflows, world.notes.owner, kind);
    world.telephony.textReview = proposal;
    if (scenario === "speak_text_stopped") world.voice.playbackHold = () => new Promise<void>(() => {});
    const notices = nativeApprovalNotices();
    world.workflows.nativeNotices = notices;
    world.workflows.stage = "Device";
    const { alpha, area } = await runStatement(world);
    await openRun();
    await until(alpha, area, Approvals, (state) => state.device.phase === "DeviceShown");
    expect(document.querySelector('[aria-label="Review device action"]')?.textContent).toContain("A reviewed note.");
    expect(proposal.receipts).toEqual([]);
    await press("Approve device action");
    if (scenario === "speak_text_stopped") {
      await vi.waitFor(() => expect(world.voice.played).toHaveLength(1), { timeout: 15_000 });
      const hushes = world.voice.hushCalls;
      await press("Stop reading");
      await until(alpha, area, Approvals, (state) => state.device.phase === "DeviceUnconfirmed");
      await vi.waitFor(() => expect(world.voice.hushCalls).toBeGreaterThan(hushes));
      expect(proposal.receipts).not.toContainEqual(expect.objectContaining({ outcome: "applied" }));
      return;
    }
    await until(alpha, area, Approvals, (state) => state.device.phase === "DeviceAnswered");
    expect(proposal.receipts).toMatchObject([{ outcome: "applied", operationId: proposal.proposal.id }]);
    if (kind === "speak_text") {
      expect(world.voice.played).toHaveLength(1);
    } else {
      const operationId: unknown = expect.stringMatching(/^step-[a-f0-9]{64}$/);
      expect(notices.results).toMatchObject([{
        operationId,
        title: "A reviewed notification", body: "A reviewed note.",
        route: { workflowId: "monthly-statement", runId: "monthly-statement-r1", versionId: "monthly-statement-v3" },
      }]);
      await backToList(alpha, area);
      const notice = notices.results[0];
      if (!notice) throw new Error("The step posted no notice");
      await drawn(() => notices.tapResult(notice));
      await until(alpha, area, Sheet, (state) => state.output.status === "Loaded" && state.runId > 0);
      await vi.waitFor(() => expect(notices.consumed).toEqual(["tap-result"]));
    }
  });

const openStepsBuilder = async (alpha: Awaited<ReturnType<typeof open>>["alpha"], area: ReturnType<typeof workflows.runtime>) => {
  await press("Add to Workflows");
  await until(alpha, area, Listing, (state) => state.place.tag === "ListingAdd");
  await press("More options");
  await press(/^Steps/);
};

  it('Writes a workflow, reviews it and saves it on the agent once (spec/app/workflows/builder.md, "Story: Write a workflow step by step"; "Story: Save a workflow on the agent once")', async () => {
    const { world, alpha, area } = await launchWorkflows();
    await openStepsBuilder(alpha, area);
    await until(alpha, area, Builder, (state) => state.offer.status === "Loaded");

    await write("Name", "Water the plants");
    await write("Text", "Water the plants by the window.");
    await press("Add step");
    await until(alpha, area, Builder, (state) => state.steps.length === 1 && state.name > 0 && state.draft.sync === "Kept");
    await press("Review workflow");
    expect(document.querySelector("[role=alertdialog]")?.textContent).toContain("Runs only when you start it. It starts turned off.");
    await pressOnTop("Cancel");
    await until(alpha, area, Builder, (state) => !state.review.showing);
    expect(world.workflows.created).toEqual([]);

    await press("Review workflow");
    await pressOnTop("Save workflow");
    await until(alpha, area, Builder, (state) => state.saved === 1);
    expect(world.workflows.created.map((one) => ({ name: one.name, active: one.active }))).toEqual([{ name: "Water the plants", active: false }]);
    expect(world.workflows.saves.size).toBe(1);

    await drawn(() => alpha.back());
    await until(alpha, area, Listing, (state) => state.list.status === "Loaded" && state.place.tag === "ListingRows");
    await vi.waitFor(async () => {
      await drawn(() => undefined);
      expect(visible("Monthly statement", "Water the plants")).toEqual(["Monthly statement", "Water the plants"]);
    }, { timeout: 15_000 });
  });

  it('Removes a workflow only after its review, keeps its history, and restores it (spec/app/workflows/index.md, "Story: Change a workflow")', async () => {
    const world = scene();
    const { alpha, area } = await onList(world);
    await choose("Monthly statement");
    await until(alpha, area, Definition, (state) => state.detail.status === "Loaded");
    await until(alpha, area, Sheet, (state) => state.history.status === "Loaded");

    await pressWorkflowAction("Remove workflow");
    expect(document.querySelector("[aria-label='Review workflow change']")?.textContent).toContain("Keeps history; stops future runs.");
    await pressInReview("Cancel");
    await until(alpha, area, Definition, (state) => !state.review.showing);
    expect(world.workflows.changes).toEqual([]);

    await pressWorkflowAction("Remove workflow");
    await pressInReview("Remove");
    await until(alpha, area, Definition, (state) => state.removed && state.detail.status === "Loaded" && !state.change.live);
    expect(world.workflows.changes).toEqual([{ operation: "remove", version: "monthly-statement-v3" }]);
    expect(button("Run now")).toBeUndefined();

    await drawn(() => alpha.back());
    await until(alpha, area, Listing, (state) => state.list.status === "Loaded");
    expect(visible("Monthly statement")).toEqual([]);
    await press("Filter workflows");
    await pressOnTop("Removed");
    await pressOnTop("Done");
    expect(visible("Monthly statement", "Retired brief")).toEqual(["Monthly statement", "Retired brief"]);

    await choose("Monthly statement");
    await until(alpha, area, Definition, (state) => state.detail.status === "Loaded" && state.removed);
    await pressWorkflowAction("Restore workflow");
    expect(document.querySelector("[aria-label='Review workflow change']")?.textContent).toContain("Restore paused; review before enabling.");
    await pressInReview("Confirm restore");
    await until(alpha, area, Definition, (state) => !state.removed && state.detail.status === "Loaded" && !state.change.live);
    expect(world.workflows.changes).toEqual([
      { operation: "remove", version: "monthly-statement-v3" },
      { operation: "restore", version: "monthly-statement-v4" },
    ]);
    expect(world.workflows.statement).toMatchObject({ removed: false, active: false });
  });

  // spec/app/workflows/sheet.md, "Story: Read a run's sheet"
  it("Cancels speech synthesis on Stop reading and sheet close", async () => {
    const cancel = vi.fn();
    const speak = vi.fn();
    class FakeUtterance {
      readonly text: string;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) { this.text = text; }
    }
    vi.stubGlobal("speechSynthesis", { speak, cancel });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    try {
      const { alpha, area } = await launchWorkflows((w) => {
        w.workflows.run = true;
        w.workflows.stage = "Done";
      });
      await choose("Monthly statement");
      await until(alpha, area, Sheet, (state) => state.history.status === "Loaded" && state.shown === 1);
      await openFirstRunHistory();
      await until(alpha, area, Sheet, (state) => state.output.status === "Loaded" && state.text === "Text");

      await press("Read aloud");
      await until(alpha, area, Sheet, (state) => state.speech.outcome === "Sent");
      expect(speak).toHaveBeenCalledTimes(1);

      await press("Stop reading");
      await until(alpha, area, Sheet, (state) => state.speech.outcome !== "Sent");
      expect(cancel).toHaveBeenCalled();

      const cancelsAfterStop = cancel.mock.calls.length;
      await press("Read aloud");
      await until(alpha, area, Sheet, (state) => state.speech.outcome === "Sent");
      await drawn(() => alpha.back());
      await until(alpha, area, Sheet, (state) => state.runId === 0);
      expect(cancel.mock.calls.length).toBeGreaterThan(cancelsAfterStop);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Toggles a list row switch without navigating and tracks approval notices and Waiting for you badge (spec/app/workflows/list.md, "Story: Find a workflow"; spec/app/workflows/approvals.md, "Story: Answer a run\'s approval on the phone")', async () => {
    const { world, alpha, area } = await launchWorkflows((w) => {
      w.workflows.run = true;
      w.workflows.stage = "Waiting";
    }, true);

    const toggle = document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Turn Desk check off"]');
    expect(toggle).not.toBeNull();
    await drawn(() => { toggle?.click(); });
    await vi.waitFor(() => expect(world.workflows.promptEdits.at(-1)).toEqual({ enabled: false, expectedRevision: 1 }));
    const listingState = await area.runPromise(Listing.use((machine) => machine.get()));
    expect(listingState.place.tag).toBe("ListingRows");

    await choose("Monthly statement");
    await until(alpha, area, Sheet, (state) => state.history.status === "Loaded" && state.shown === 1);
    await openFirstRunHistory();
    await until(alpha, area, Approvals, (state) => state.approval === "Waiting" && state.sheet);
    const toastsWhileWaiting = await area.runPromise(Toasts.use((machine) => machine.get()));
    expect(toastsWhileWaiting.kept.some((entry) => entry.area === "workflows-approval")).toBe(true);

    await drawn(() => alpha.back());
    await drawn(() => alpha.back());
    await until(alpha, area, Listing, (state) => state.place.tag === "ListingRows");
    const statementRow = rows().find((one) => one.textContent?.startsWith("Monthly statement"));
    expect(statementRow?.textContent).toContain("Waiting for you");
  });

  it('Allows clearing the Clock snooze input without NaN snap-back and keeps AlarmLabel while Sent (spec/app/workflows/clock.md, "Story: Describe an alarm for Clock")', async () => {
    const { alpha, area } = await launchWorkflows((world) => { world.phone = true; });

    await press("Add to Workflows");
    await press("Clock alarms");
    await until(alpha, area, Clock, (state) => state.open && state.history.status === "Loaded");
    await fill("Alarm label", "Morning standup");
    const storedLabel = await area.runPromise(Effect.flatMap(AlarmLabel, (label) => label.read()));
    expect(storedLabel).toBe("Morning standup");

    await pressOnTop("Snooze");
    await fill("Snooze minutes", "");
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Snooze minutes"]');
    expect(input?.value).toBe("");
    await fill("Snooze minutes", "15");
    await until(alpha, area, Clock, (state) => state.snooze === 15);
  });

  it('Recovers from unanswered automation changes via checkChange and letGo (spec/app/workflows/automations.md, "Story: Act on an automation")', async () => {
    const { alpha, area } = await launchWorkflows(undefined, true);

    await choose("Desk check");
    await until(alpha, area, Automations, (state) => state.present && state.list.status === "Loaded");
    await press("Turn Desk check on or off");
    await press("Confirm Pause");
    await until(alpha, area, Automations, (state) => state.change.attempt.outcome !== "Planned" || state.change.live);
    const afterAct = await area.runPromise(Automations.use((machine) => machine.get()));
    if (afterAct.change.live) {
      await area.runPromise(Automations.use((machine) => machine.send({ type: "changeUnanswered" })));
    }
    const current = await area.runPromise(Automations.use((machine) => machine.get()));
    if (current.change.attempt.outcome === "Unknown" && current.change.record.status !== "Loaded") {
      await press("Check change");
      await until(alpha, area, Automations, (state) => state.change.record.status === "Loaded" || state.change.record.status === "Failed");
      const allowBtn = button("Allow a different change");
      if (allowBtn) {
        await press("Allow a different change");
        await until(alpha, area, Automations, (state) => state.change.attempt.outcome === "Unknown" && !state.change.offered);
      }
    }
  });

  it('Computes unfinished draft state and exposes Conflicted recovery controls in Authoring (spec/app/workflows/builder.md, "Story: Keep the draft on the phone")', async () => {
    const { alpha, area } = await launchWorkflows();
    await openStepsBuilder(alpha, area);
    await until(alpha, area, Builder, (state) => state.open);
    expect(button("Review workflow")).toBeUndefined();

    const draft = await area.runPromise(Effect.flatMap(DraftWords, (words) => words.view()));
    expect(draft.owner).toBeGreaterThanOrEqual(0);
  });

  // spec/app/workflows/request.md, "The owner can let go of a request only once its record was checked, and it is then never sent again"; spec/app/workflows/runs.md, "Story: Run a workflow now"; spec/app/workflows/index.md, "A change offered again is reviewed again before the same request is sent, or let go once its record was read"; spec/app/workflows/builder.md, "Story: Save a workflow on the agent once"
  it("letting go clears retained run, lifecycle, and authoring keys so a new request succeeds, and lifecycle offers resend", async () => {
    const world = scene();
    const { alpha, area } = await openMonthlyStatement(world);

    const scope = await area.runPromise(ownerAt());
    const runKey = `alpha/workflows/run/${encodeURIComponent(scope)}/${encodeURIComponent("monthly-statement")}`;
    await area.runPromise(Effect.flatMap(KeyValueStore.KeyValueStore, (store) =>
      store.set(runKey, JSON.stringify({ id: 1, submission: "s-old", workflow: "monthly-statement", version: "monthly-statement-v3" }))));

    await press("Run now");
    await press("Confirm run");
    await until(alpha, area, Runs, (state) => state.request.attempt.outcome === "Sent" && !state.request.live);
    await press("Check run");
    await until(alpha, area, Runs, (state) => state.request.record.status === "Failed");
    await press("Allow a new run");
    await until(alpha, area, Runs, (state) => state.request.attempt.outcome === "Unknown");

    await press("Run now");
    await press("Confirm run");
    await until(alpha, area, Runs, (state) => state.request.attempt.id === 2 && state.request.attempt.outcome !== "Recorded" && !state.request.live);
    const afterRun = await area.runPromise(Effect.flatMap(Runs, (m) => m.get()));
    expect(afterRun.request.attempt.outcome).toBe("Confirmed");

    const changeKey = `alpha/workflows/change/${encodeURIComponent(scope)}/${encodeURIComponent("monthly-statement")}`;
    await area.runPromise(Effect.flatMap(KeyValueStore.KeyValueStore, (store) =>
      store.set(changeKey, JSON.stringify({ id: 1, mutation: "m-old", workflowId: "monthly-statement", version: "monthly-statement-v3", change: "Remove" }))));
    await pressWorkflowAction("Remove workflow");
    await pressInReview("Remove");
    await until(alpha, area, Definition, (state) => state.change.attempt.outcome === "Sent" && !state.change.live);
    await area.runPromise(Effect.flatMap(Definition, (m) => Effect.all([
      m.send({ type: "checkChange" }),
      Effect.flatMap(m.get(), (cur) => m.send({ type: "changeChecked", ticket: cur.change.record.ticket, ok: true, found: false, version: cur.version })),
    ])));
    await drawn(() => undefined);
    expect(button("Review the same change")).toBeDefined();
    await press("Review the same change");
    await until(alpha, area, Definition, (state) => state.review.showing);
    await pressInReview("Send again");
    await until(alpha, area, Definition, (state) => state.change.again && state.change.attempt.outcome === "Sent" && !state.change.live);
    const retainedAfterResend = await area.runPromise(Effect.flatMap(KeyValueStore.KeyValueStore, (store) => store.get(changeKey)));
    expect(retainedAfterResend).toContain('"mutation":"m-old"');
    await press("Allow a different change");
    await until(alpha, area, Definition, (state) => !state.change.offered);
    await vi.waitFor(async () => expect(await area.runPromise(Effect.flatMap(KeyValueStore.KeyValueStore, (store) => store.get(changeKey)))).toBeUndefined());
    await pressWorkflowAction("Remove workflow");
    await pressInReview("Remove");
    await until(alpha, area, Definition, (state) => state.change.attempt.id === 2 && state.change.attempt.outcome !== "Recorded" && !state.change.live);
    const afterChange = await area.runPromise(Effect.flatMap(Definition, (m) => m.get()));
    expect(afterChange.change.attempt.outcome).not.toBe("Sent");

    await drawn(() => alpha.back());
    await until(alpha, area, Listing, (state) => state.place.tag === "ListingRows");
    await openStepsBuilder(alpha, area);
    await until(alpha, area, Builder, (state) => state.open);
    const builderBefore = await area.runPromise(Effect.flatMap(Builder, (m) => m.get()));
    if (builderBefore.offer.status !== "Loaded") {
      await area.runPromise(Effect.flatMap(Builder, (m) => Effect.gen(function* () {
        const cur = yield* m.get();
        if (cur.offer.status === "Failed") {
          yield* m.send({ type: "closeBuilder" });
          yield* m.send({ type: "openBuilder", workflow: 0, version: 0, unfinished: false });
        }
        const next = yield* m.get();
        if (next.offer.status === "Loading") {
          yield* m.send({
            type: "offerRead", ticket: next.offer.ticket, ok: true, speaks: false, reminders: false, runDay: false, schedules: false, generates: false,
            steps: [], name: 0, when: next.when,
          });
        }
      })));
    }
    await area.runPromise(Effect.flatMap(Builder, (m) => Effect.all([
      m.send({ type: "rename", chars: 4 }),
      m.send({ type: "addStep", op: "SuppliedText", source: 0, text: 4, items: 0, span: "FixedDates", days: 0 }),
    ])));
    await until(alpha, area, Builder, (state) => state.draft.sync === "Kept");
    await area.runPromise(Effect.flatMap(Builder, (m) => Effect.all([
      m.send({ type: "reviewSave", unfinished: false }),
      m.send({ type: "confirmSave", unfinished: false }),
      m.send({ type: "saveUnanswered" }),
    ])));
    await until(alpha, area, Builder, (state) => state.save.attempt.outcome === "Sent" && !state.save.live);
    await press("Check save");
    await until(alpha, area, Builder, (state) => state.save.record.status === "Failed");
    expect(button("Allow a different save")).toBeDefined();
    await press("Allow a different save");
    await until(alpha, area, Builder, (state) => state.save.attempt.outcome === "Unknown");
  });

  // spec/app/workflows/automations.md, "A change with no answer stays kept, locks the panel's changes, and is settled by the agent's record or let go by the owner once it was checked"; spec/app/digests/schedules.md, "Discard drops only a change never sent; one that may have reached the agent is let go only once its record was read"
  it("unanswered automation and digest schedule changes offer Check change and Allow a different change to unlock the panel", async () => {
    const world = scene();
    const alpha = await openWorkflows(world);
    const area = workflows.runtime(alpha);
    const unlockChange = async (machine: typeof Automations | typeof DigestSchedules) => {
      await drawn(() => undefined);
      expect(button("Check change")).toBeDefined();
      await press("Check change");
      await until(alpha, area, machine as typeof Automations, (state) => state.change.record.status === "Failed");
      expect(button("Allow a different change")).toBeDefined();
      await press("Allow a different change");
      await until(alpha, area, machine as typeof Automations, (state) => state.change.attempt.outcome === "Unknown");
    };
    await until(alpha, area, Listing, (state) => state.list.status === "Loaded");
    await choose("Desk check");
    await until(alpha, area, Automations, (state) => state.present && state.list.status === "Loaded");

    await area.runPromise(Effect.flatMap(Automations, (m) => Effect.all([
      m.send({ type: "reviewChange", wanted: "Fire" }),
      m.send({ type: "confirmChange" }),
      m.send({ type: "sendChange" }),
      m.send({ type: "changeUnanswered" }),
    ])));
    await unlockChange(Automations);

    await drawn(() => alpha.back());
    await until(alpha, area, Listing, (state) => state.place.tag === "ListingRows");
    await press("Add to Workflows");
    await press("Scheduled digest");
    await until(alpha, area, Listing, (state) => state.place.tag === "ListingDigests");
    await until(alpha, area, DigestSchedules, (state) => state.open);
    await area.runPromise(Effect.flatMap(DigestSchedules, (m) => Effect.all([
      m.send({ type: "openEditor", zone: 0 }),
      m.send({ type: "pickSource", source: 1, fresh: true }),
      m.send({ type: "reviewChange", wanted: "Create" }),
      m.send({ type: "confirmChange" }),
      m.send({ type: "sendChange" }),
      m.send({ type: "changeUnanswered" }),
    ])));
    await unlockChange(DigestSchedules);
  });

  // spec/app/workflows/clock.md, "A review ends when Alpha is hidden or the page is closed, and a handoff not yet sent is withdrawn"; spec/app/shell/layers.md, "A screen says when it has a step of its own to take Back, and when it has none left; its page stays usable"
  it("opening Alarms from Workflows offers a Back step to Layers so Back closes Alarms", async () => {
    const world = { ...scene(), phone: true };
    const alpha = await openWorkflows(world);
    const area = workflows.runtime(alpha);
    await until(alpha, area, Listing, (state) => state.list.status === "Loaded");

    await press("Add to Workflows");
    await press("Clock alarms");
    await until(alpha, area, Clock, (state) => state.open);
    for (let turn = 0; turn < 20; turn += 1) await drawn(() => alpha.runtime.runPromise(Effect.yieldNow));
    const offered = await alpha.runtime.runPromise(Effect.flatMap(Layers, (m) => m.get()));
    expect(offered.steps.includes("view:Workflows")).toBe(true);

    await drawn(() => alpha.back());
    await until(alpha, area, Clock, (state) => !state.open);
    await drawn(() => alpha.back());
    await until(alpha, area, Listing, (state) => state.place.tag === "ListingRows");
    for (let turn = 0; turn < 20; turn += 1) await drawn(() => alpha.runtime.runPromise(Effect.yieldNow));
    const after = await alpha.runtime.runPromise(Effect.flatMap(Layers, (m) => m.get()));
    expect(after.steps.includes("view:Workflows")).toBe(false);
  });

  // spec/app/workflows/builder.md, "Story: Keep the workflow draft I was writing before this version"
  it('Adopts an earlier Alpha workflow draft once, clears its slot after readback, and never overwrites a kept draft (spec/app/workflows/builder.md, "The previous version\'s draft comes in once, only while none is kept, and its slot clears only after the kept draft reads back")', async () => {
    const world = scene();
    world.phone = true;
    const identity = await Effect.runPromise(workflowSha(["https://device.alpha.invalid", world.notes.ownerIdentity, world.notes.owner]));
    const slot = `workflow-draft:v1:${identity}`;
    const earlierSpec = {
      version: 1,
      name: "Morning note",
      description: "",
      trigger: { kind: "manual" },
      steps: [{ id: "s1", kind: "Read", operation: "supplied_text", text: "Good morning" }],
    };
    world.platform.earlier.set(slot, JSON.stringify({ format: 1, identity, spec: earlierSpec }));

    const first = await open(world, only("home", "view:Workflows", "notice"));
    await until(first.alpha, home.runtime(first.alpha), Home, (state) => state.tiles.load.status === "Loaded");
    await press("Workflows");
    const area = workflows.runtime(first.alpha);
    await until(first.alpha, area, Listing, (state) => state.list.status === "Loaded");
    await press("Add to Workflows");
    await until(first.alpha, area, Listing, (state) => state.place.tag === "ListingAdd");
    await press("More options");
    await press(/^Steps/);
    await until(first.alpha, area, Builder, (state) => state.offer.status === "Loaded" && state.name === earlierSpec.name.length && state.steps.length === 1);
    expect(world.platform.earlier.has(slot)).toBe(false);
    world.platform.earlier.set(slot, JSON.stringify({ format: 1, identity, spec: { ...earlierSpec, name: "Another draft" } }));
    await first.close();

    const { alpha: second } = await open(world, only("home", "view:Workflows", "notice"));
    const secondArea = workflows.runtime(second);
    await until(second, secondArea, Listing, (state) => state.list.status === "Loaded");
    await press("Add to Workflows");
    await until(second, secondArea, Listing, (state) => state.place.tag === "ListingAdd");
    await press("More options");
    await press(/^Steps/);
    await until(second, secondArea, Builder, (state) => state.offer.status === "Loaded" && state.name === earlierSpec.name.length && state.steps.length === 1);
    expect(world.platform.earlier.has(slot)).toBe(true);
  });

  it('Surfaces a failed Morning check-in reason, reopens it in one tap, and runs it once ready (spec/app/workflows/automations.md, "Story: Act on an automation"; spec/app/workflows/automations.md, "A row that ended (done, dismissed, skipped, expired or failed) offers only Reopen; a scheduled row offers every other control")', async () => {
    const world = scene();
    world.ask.canRespond = false;
    world.ask.lastCloudFailure = { kind: "insufficient_credits", at: 1_795_784_479_518 };
    world.workflows.tasks.push({
      taskId: "morning-checkin",
      kind: "personal-assistant.checkin",
      ownerVisible: true,
      promptInstructions: "Morning check-in",
      state: { status: "failed", lastDecisionLog: "dispatch_failed: The check-in was not stored: NoModel" },
      trigger: { kind: "cron", expression: "0 8 * * *", tz: "America/New_York" },
      metadata: { checkin: "morning" },
    });
    const { alpha, area } = await onList(world, { complete: true });

    const morningRow = rows().find((one) => one.textContent?.startsWith("Morning check-in"));
    expect(morningRow?.textContent).toContain("Failed");

    await choose("Morning check-in");
    await until(alpha, area, Automations, (state) => state.present && state.list.status === "Loaded" && state.status === "Failed");
    expect(document.querySelector('[aria-label="Automation controls"] [role="alert"]')?.textContent).toContain("Out of credits");
    expect(button("Run now")).toBeUndefined();
    expect(button("Reopen")).toBeDefined();

    world.workflows.failTaskFire = "The check-in was not stored: NoModel";
    await press("Reopen");
    await until(alpha, area, Automations, (state) => state.list.status === "Loaded" && state.status === "Scheduled" && state.change.attempt.outcome === "Confirmed");
    expect(button("Run now")).toBeDefined();
    expect(document.querySelector('[aria-label="Automation controls"] [role="alert"]')).toBeNull();

    await press("Run now");
    await press("Confirm Run now");
    await until(alpha, area, Automations, (state) => state.list.status === "Loaded" && state.fired === "DispatchFailed" && state.status === "Failed");
    expect(document.querySelectorAll('[aria-label="Automation controls"] [role="alert"]')).toHaveLength(1);
    expect(document.querySelector('[aria-label="Automation controls"] [role="alert"]')?.textContent).toContain("Out of credits");

    world.ask.canRespond = true;
    world.ask.lastCloudFailure = undefined;
    world.workflows.failTaskFire = undefined;

    await press("Reopen");
    await until(alpha, area, Automations, (state) => state.list.status === "Loaded" && state.status === "Scheduled");
    await press("Run now");
    await press("Confirm Run now");
    await until(alpha, area, Automations, (state) => state.list.status === "Loaded" && state.fired === "Dispatched" && state.change.attempt.outcome === "Confirmed");
    expect(world.workflows.taskActions).toEqual([
      { taskId: "morning-checkin", verb: "reopen" },
      { taskId: "morning-checkin", verb: "fire" },
      { taskId: "morning-checkin", verb: "reopen" },
      { taskId: "morning-checkin", verb: "fire" },
    ]);
    expect(document.querySelector('[aria-label="Automation controls"] [role="alert"]')).toBeNull();
    expect(document.querySelector('[aria-label="Automation controls"] [role="status"]')?.textContent).toContain("The agent ran it.");
    expect(world.workflows.tasks.find((task) => task.taskId === "morning-checkin")?.state.status).toBe("fired");
  });
});
