// @vitest-environment happy-dom
import { systemNoticeText } from "@elizaos/core";
import { Effect } from "effect";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Machine as Conversation } from "../gen/app__assistant.effect.vibe";
import { Machine as Attachments } from "../gen/app__assistant__attachments.effect.vibe";
import { Machine as Chats } from "../gen/app__assistant__chats.effect.vibe";
import { Machine as Composer } from "../gen/app__assistant__composer.effect.vibe";
import { Machine as Locator } from "../gen/app__assistant__context.effect.vibe";
import { Machine as Reply } from "../gen/app__assistant__reply.effect.vibe";
import { Machine as Search } from "../gen/app__assistant__search.effect.vibe";
import * as Pages from "../gen/app__settings.effect.vibe";
import * as Prefs from "../gen/app__settings__preferences.effect.vibe";
import { Machine as Shell } from "../gen/app__shell.effect.vibe";
import type { Detent, Event as ShellEvent } from "../gen/app__shell.ts";
import { Machine as Layers } from "../gen/app__shell__layers.effect.vibe";
import type { Mount } from "../src/areas.ts";
import assistant from "../src/assistant/index.tsx";
import { Talk } from "../src/assistant/talk.vibe";
import { MailQuestions } from "../src/inbox/mail-context.vibe";
import { MessagingBridge } from "../src/messaging/bridge.vibe";
import { untimed } from "../src/runtime/reactor.vibe";
import type { Alpha } from "../src/runtime/area.tsx";
import { button, chatAction, closeAll, drawn, fill, hardware, later, open, press, seen, typeInto, underAct, until } from "./alpha.tsx";
import { draftKey, untoldStep } from "./fakes/ask.ts";
import { scene } from "./fakes/scene.ts";
import { textReview } from "./fakes/text-review.ts";

underAct();
afterEach(closeAll);

/**
 * Ask Alpha in full at its place, and Settings with the Agent activity page, where the owner lists, restores and
 * starts conversations as in Alpha's Sunday v119 build (45f6bed30, settings-adapter.ts:1038-1043).
 */
const mounts: Mount[] = [
  { at: "assistant", load: () => import("../src/assistant/index.tsx") },
  { at: "view:Settings", load: () => import("../src/settings/index.tsx") },
  { at: "settings/activity", load: () => import("../src/assistant/settingsActivity.tsx") },
];

const lines = () => [...document.querySelectorAll("section[aria-label='Ask Alpha'] [role=log] article")].map((line) => line.querySelector("span:not([aria-hidden])")?.textContent);
/** Whether the foot of the conversation shows the dots of a reply being written. */
const replying = () => document.querySelector("section[aria-label='Ask Alpha'] [role=status][aria-label='Replying']") !== null;
/** The text of the reply being written, if any shows. */
const writingReply = () => document.querySelector("section[aria-label='Ask Alpha'] [data-alpha-message-id='reply']")?.textContent ?? undefined;
const rows = (list: string) => document.querySelector(`section[aria-label='${list}'] > div`)?.children.length ?? 0;

/** Write `text` in the composer, as the owner types it. */
function write(text: string) {
  act(() => {
    const box = document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Message Alpha']");
    if (!box) throw new Error("no composer");
    typeInto(box, text);
  });
}

/** Touch the composer's field, as the owner does to type in it, after anything else they touched took its focus. */
function touchField() {
  act(() => {
    const box = document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Message Alpha']");
    if (!box) throw new Error("no composer");
    box.blur();
    box.focus();
  });
}

/** Open the menu of the message that says `text` and choose `item`, as the owner does with the keyboard. */
function onMessage(text: string, item: string) {
  act(() => {
    const found = [...document.querySelectorAll("[role=log] article button[aria-haspopup=menu]")].find((one) => one.nextElementSibling?.textContent === text);
    if (!(found instanceof HTMLButtonElement)) throw new Error(`no message ${text}`);
    found.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  act(() => {
    const chosen = [...document.querySelectorAll("[role=menuitem]")].find((one) => (one.getAttribute("aria-label") ?? one.textContent) === item);
    if (!(chosen instanceof HTMLElement)) throw new Error(`no ${item} for ${text}`);
    chosen.click();
  });
}

/** The saved conversations Agent activity lists, by title. */
const restorable = () => [...document.querySelectorAll("button[aria-label^='Restore conversation: ']")].map((found) => found.getAttribute("aria-label")?.slice("Restore conversation: ".length));

/** Open Settings at About, then Agent activity, as the owner does. */
async function agentActivity(alpha: Alpha) {
  const shown = await alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.get()));
  if (shown.trail.at(-1) !== "Settings") await alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.send({ type: "openView", view: "Settings" })));
  await alpha.runtime.runPromise(Effect.flatMap(Pages.Machine, (pages) => pages.send({ type: "openSection", page: "About" })));
  await alpha.runtime.runPromise(Effect.flatMap(Pages.Machine, (pages) => pages.send({ type: "open", page: "Activity" })));
  await until(alpha, alpha.runtime, Pages.Machine, (s) => s.page === "Activity");
  await drawn(() => vi.waitFor(() => expect(button(/^Load(ing)? conversations$/)).toBeDefined()));
}

/** Open the list of conversations: History on Agent activity in Settings. */
async function chatsList(alpha: Alpha) {
  await agentActivity(alpha);
  await press(/^Load(ing)? conversations$/);
}

/** Back, as the owner presses it, until Settings has closed, and Ask Alpha raised again to `detent`. */
async function leaveSettings(alpha: Alpha, detent: Detent) {
  const shell = () => alpha.runtime.runPromise(Effect.flatMap(Shell, (machine) => machine.get()));
  for (let presses = 0; presses < 5 && ((await shell()).trail.length > 0 || (await shell()).assistant !== "Bar"); presses++) await hardware("back");
  expect([(await shell()).trail, (await shell()).assistant]).toEqual([[], "Bar"]);
  if (detent !== "Bar") await alpha.runtime.runPromise(Effect.flatMap(Shell, (machine) => machine.send({ type: "raise", detent })));
  await until(alpha, alpha.runtime, Shell, (s) => s.assistant === detent);
}

/** Restore the saved conversation titled `title` from Agent activity, which raises Ask Alpha onto it. */
async function restore(title: string) {
  await drawn(() => vi.waitFor(() => expect(restorable()).toContain(title)));
  await press(`Restore conversation: ${title}`);
}

/** Click the row of the list named `list` whose text starts with `text`. */
function row(list: string, text: string) {
  act(() => {
    const found = [...document.querySelectorAll(`section[aria-label='${list}'] button`)].find((one) => one.textContent?.startsWith(text));
    if (!(found instanceof HTMLButtonElement)) throw new Error(`no row ${text} in ${list}`);
    found.click();
  });
}

/** Open Ask Alpha on `world`, waiting for its composer slot to open and optionally for the agent and preferences. */
async function openAssistant(world: ReturnType<typeof scene>, ready = true, waitPrefs = false) {
  const { alpha, close } = await open(world, mounts);
  const runtime = assistant.runtime(alpha);
  await until(alpha, runtime, Composer, (s) => s.slot === "Open");
  if (ready) await until(alpha, runtime, Conversation, (s) => s.ready);
  if (waitPrefs) await until(alpha, alpha.runtime, Prefs.Machine, (s) => s.document.read.status === "Loaded");
  await drawn(() => vi.waitFor(() => expect(document.querySelector("textarea[aria-label='Message Alpha']")).not.toBeNull()));
  return { alpha, runtime, close };
}

async function openAssistantWithPreferences(world: ReturnType<typeof scene>) {
  const opening = await openAssistant(world);
  await until(opening.alpha, opening.alpha.runtime, Prefs.Machine, (s) => s.document.read.status === "Loaded");
  return opening;
}

/** The location carried on the observation of `metadata`, if any. */
function locationIn(metadata: unknown): { latitude?: number; longitude?: number; accuracyMeters?: number; capturedAt?: number } | undefined {
  return (metadata as { observation?: { location?: { latitude?: number; longitude?: number; accuracyMeters?: number; capturedAt?: number } } } | undefined)?.observation?.location;
}

function composerText() {
  return document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Message Alpha']")?.value;
}

/** What Ask Alpha shows outside its conversation: every note or alert drawn by the field rather than in the log, and any words or worded button around the field, but for screen-reader-only text. */
const byTheField = () => {
  const notes = [...document.querySelectorAll("section[aria-label='Ask Alpha'] [role=note], section[aria-label='Ask Alpha'] [role=alert]")]
    .filter((one) => !one.closest("[role=log]")).map((one) => one.textContent);
  const around = document.querySelector("textarea[aria-label='Message Alpha']")?.parentElement?.parentElement;
  const words = around === null || around === undefined ? [] : [...around.querySelectorAll("*")]
    .filter((one) => one.closest(".sr-only") === null && one.tagName !== "TEXTAREA" && one.tagName !== "svg" && one.closest("svg") === null)
    .flatMap((one) => [...one.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent?.trim() ?? ""))
    .filter((text) => text !== "" && text !== "Talk");
  return [...notes, ...words];
};

/** The button named `name` that the conversation shows, if any. */
const inConversation = (name: string) => [...document.querySelectorAll("section[aria-label='Ask Alpha'] [role=log] button")].find((one) => one.textContent === name);

function webStorageContains(text: string) {
  return [localStorage, sessionStorage].some((store) =>
    Array.from({ length: store.length }, (_, index) => store.key(index))
      .some((key) => key !== null && (key.includes(text) || store.getItem(key)?.includes(text))));
}

it('Keeps my phone draft through restart and leaves it with my account (spec/app/assistant/composer.md, "Story: Keep what I am writing")', async () => {
  const world = { ...scene(), phone: true };
  const firstOwner = world.notes.ownerIdentity;
  world.ask.kept.set("c1", { roomId: "r1", title: "Shared fixture ID", messages: [] });

  const selectConversation = async (alpha: Awaited<ReturnType<typeof open>>["alpha"], runtime: ReturnType<typeof assistant.runtime>) => {
    await chatsList(alpha);
    await until(alpha, runtime, Chats, (state) => state.list.status === "Loaded");
    await restore("Shared fixture ID");
    await until(alpha, runtime, Composer, (state) => state.binding.conversation > 0 && state.slot === "Open");
  };

  const first = await open(world, mounts);
  const firstRuntime = assistant.runtime(first.alpha);
  await until(first.alpha, firstRuntime, Conversation, (state) => state.ready);
  await selectConversation(first.alpha, firstRuntime);
  const original = "First owner's unsent phone draft";
  const firstKey = draftKey(firstOwner, world.notes.owner, "c1", "r1");
  write(original);
  await until(first.alpha, firstRuntime, Composer, (state) => state.draft.sync === "Kept" && state.editor.text);
  expect(JSON.parse(world.ask.drafts.get(firstKey) ?? "{}")).toMatchObject({ text: original, sending: false });
  expect(webStorageContains(original)).toBe(false);
  await first.close();

  const second = await open(world, mounts);
  const runtime = assistant.runtime(second.alpha);
  await until(second.alpha, runtime, Conversation, (state) => state.ready);
  await until(second.alpha, runtime, Composer, (state) => state.binding.conversation > 0 && state.slot === "Open" && state.editor.text);
  expect(composerText()).toBe(original);

  const initialSeat = await runtime.runPromise(Composer.use((machine) => Effect.map(machine.get(), (state) => state.binding.owner)));
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  world.ask.beforeDraftExchange = () => {
    entered.resolve();
    return release.promise;
  };
  const stale = "A late save from the first account";
  try {
    write(stale);
    await entered.promise;
    world.notes.ownerIdentity = "second-draft-owner";
    await seen(false);
    await seen(true);
    await until(second.alpha, runtime, Composer, (state) => state.binding.owner > initialSeat && state.slot === "Open");
    expect(composerText()).toBe("");
  } finally {
    delete world.ask.beforeDraftExchange;
    await drawn(() => release.resolve());
  }

  await vi.waitFor(() => expect(world.ask.refusedDraftExchanges).toBe(1));
  await selectConversation(second.alpha, runtime);
  expect(composerText()).toBe("");
  expect(JSON.parse(world.ask.drafts.get(firstKey) ?? "{}")).toMatchObject({ text: original, sending: false });
  expect(webStorageContains(stale)).toBe(false);

  const next = "Second owner's unsent phone draft";
  const secondKey = draftKey(world.notes.ownerIdentity, world.notes.owner, "c1", "r1");
  write(next);
  await until(second.alpha, runtime, Composer, (state) => state.draft.sync === "Kept" && state.editor.text);
  expect(JSON.parse(world.ask.drafts.get(secondKey) ?? "{}")).toMatchObject({ text: next, sending: false });
  expect(webStorageContains(next)).toBe(false);
  expect(world.ask.said).toEqual([]);
});

/** Wait, on the runtime of `alpha`, until `check` holds. */
async function settled(alpha: Awaited<ReturnType<typeof open>>["alpha"], check: () => boolean, detail: () => unknown) {
  for (let turn = 0; turn < 2_000 && !check(); turn += 1) await drawn(() => alpha.runtime.runPromise(Effect.yieldNow));
  if (!check()) throw new Error(`did not settle: ${JSON.stringify(detail())}`);
}

// spec/app/assistant/reply.md, "The planning label shows until the first settled text, and provisional text is neither shown nor spoken"
it("Hear a brief acknowledgment and still get the whole answer: the replying dots leave with the settled reply while the turn still finishes on an enrolled phone (spec/app/assistant/reply.md, \"Story: Hear a brief acknowledgment and still get the whole answer\")", async () => {
  const world = { ...scene(), phone: true, image: true };
  const review = textReview(world.notes.owner, "camera-shot", { type: "camera_capture_photo" });
  const gate = Promise.withResolvers<void>();
  review.proposalsGate = gate.promise;
  world.telephony.textReview = review;
  const { alpha, runtime } = await openAssistantWithPreferences(world);
  await until(alpha, alpha.runtime, Shell, (s) => s.image);
  world.ask.nextReplyChunks = ["Here you go."];
  world.ask.nextReplyProvisional = true;
  world.ask.noStatus = true;
  try {
    write("Say something");
    await until(alpha, runtime, Composer, (s) => s.draft.sync === "Kept");
    await press("Send");
    await until(alpha, runtime, Reply, (s) => s.status === "Settled");
    await vi.waitFor(() => expect(review.pendingReads).toBeGreaterThan(0));
    const finishing = await runtime.runPromise(Effect.flatMap(Conversation, (machine) => machine.get()));
    expect(finishing.turn.reply).toBe("Streaming");
    await vi.waitFor(() => expect(lines()).toEqual(["Say something", "Here you go."]));
    expect(replying()).toBe(false);
  } finally {
    gate.resolve();
  }
  await until(alpha, runtime, Conversation, (s) => s.turn.reply === "Complete");
});

describe.each([["a browser", false], ["a phone", true]])("in %s", (_where, phone) => {
  // spec/app/assistant/index.md, "Story: Ask Alpha something"; spec/app/assistant/composer.md, "Story: Send what I wrote"; spec/app/assistant/chats.md, "Story: Start a conversation, or fork one"
  it("Ask Alpha something, in a conversation made for it (spec/app/assistant/index.md, \"Story: Ask Alpha something\")", async () => {
    const world = { ...scene(), phone };
    // spec/app/assistant/composer.md, "The slot is opened when the composer is shown, and opened again after it could not be read"
    const { alpha, runtime } = await openAssistantWithPreferences(world);

    // spec/app/assistant/composer.md, "A message written before its conversation existed moves into the new one, then its old slot is cleared on the exact revision read"
    world.ask.metadata = [];
    const draftSlot = (conversation?: string, room?: string) => {
      const key = draftKey(world.notes.ownerIdentity, world.notes.owner, conversation, room);
      return phone ? world.ask.drafts.get(key) ?? null : localStorage.getItem(`alpha/assistant/slot-v2/${encodeURIComponent(key)}`);
    };
    // spec/app/assistant/chats.md, "A conversation made new here shows what it holds while its page is read": the first send stays in place, never loading rows, while the page of the conversation made for it is read.
    world.ask.holdPages = true;
    world.ask.holdAfterTools = true;
    const loadingRows = () => document.querySelector("section[aria-label='Ask Alpha'] [role=log] [aria-busy]");
    write("Hello ");
    await press("Send");
    await until(alpha, runtime, Chats, (s) => s.chosen > 0 && s.page.status === "Loading");
    expect(loadingRows()).toBeNull();
    await until(alpha, runtime, Conversation, (s) => s.turn.send.id === 1);
    await drawn(() => vi.waitFor(() => expect([world.ask.heldPages.length, world.ask.turns.size]).toEqual([1, 1])));
    expect(lines()).toEqual(["Hello"]);
    expect(loadingRows()).toBeNull();
    await drawn(() => { for (const answer of world.ask.turns.values()) answer(); });
    // spec/app/assistant/index.md, "A reply completes, streamed or all at once, even after the owner asked to stop it"
    await until(alpha, runtime, Conversation, (s) => s.turn.reply === "Complete");
    // spec/app/assistant/reply.md, "The settled reply is the whole final answer, shown and spoken, never the acknowledgment"
    await until(alpha, runtime, Reply, (s) => s.status === "Settled" && s.final === "You said: Hello".length);
    expect([world.ask.heldPages.length, lines(), loadingRows()]).toEqual([1, ["Hello", "You said: Hello"], null]);
    world.ask.holdPages = false;
    for (const release of world.ask.heldPages.splice(0)) release();
    await until(alpha, runtime, Chats, (s) => s.page.status === "Loaded");
    // spec/app/assistant/index.md, "The agent is told the view, the time zone, the day only from Calendar, and whether something is selected"
    expect(world.ask.metadata).toMatchObject([{ observation: { view: "home", sensitive: false } }]);
    // spec/app/browser/reading.md, "Only the committed page of a normal tab in front, while Browser is the open screen and Browser page for Alpha is on, is ever handed over": a turn asked on Home takes no page.
    expect(world.ask.metadata[0]).not.toHaveProperty("browserPage");
    // spec/app/assistant/context.md, "The locator holds whether the owner allows it, the time last told, the last GPS fix and the last network answer, each read once under its ticket, and when each may be read again": a cold turn never waits for a fix, and starts one read behind it.
    expect(locationIn(world.ask.metadata[0])).toBe(undefined);
    if (phone) await until(alpha, runtime, Locator, (s) => s.gpsAt >= 0);
    await until(alpha, runtime, Composer, (s) => s.away === "Free" && s.clear.outcome === "Confirmed" && s.draft.sync === "Kept");
    expect([lines(), world.ask.said, world.ask.opened]).toEqual([["Hello", "You said: Hello"], ["Hello"], 1]);
    expect(draftSlot()).toBe(null);
    expect(JSON.parse(draftSlot("c1", "r1") ?? "{}")).toMatchObject({ text: "", sending: false });

    // spec/app/assistant/composer.md, "Story: Keep what I am writing": a draft is kept in its conversation's slot.
    write("Not yet");
    await until(alpha, runtime, Composer, (s) => s.draft.sync === "Kept" && s.editor.text);
    expect(JSON.parse(draftSlot("c1", "r1") ?? "{}")).toMatchObject({ text: "Not yet", sending: false });
    // spec/app/assistant/composer.md, "A message longer than a message may hold is kept as a draft and never sent"
    write("x".repeat(64_001));
    await until(alpha, runtime, Composer, (s) => s.long);
    expect(button("Send")?.disabled).toBe(true);
    // spec/app/assistant/reply.md, "One brief acknowledgment at most, only from the agent's acknowledgment frame, before any tool runs"
    world.ask.acknowledgment = "Let me look";
    write("Again");
    await until(alpha, runtime, Composer, (s) => !s.long && s.draft.sync === "Kept");
    await press("Send");
    await until(alpha, runtime, Conversation, (s) => s.turn.send.id === 2 && s.turn.reply === "Complete");
    await until(alpha, runtime, Reply, (s) => s.turn === 2 && s.status === "Settled");
    await until(alpha, runtime, Composer, (s) => s.hold === 2 && !s.held.text && s.draft.sync === "Kept");
    const said = await runtime.runPromise(Effect.flatMap(Reply, (machine) => machine.get()));
    expect([said.acks, said.ackUnits, said.final]).toEqual([1, "Let me look".length, "You said: Again".length]);
    expect(lines()).toEqual(["Hello", "You said: Hello", "Again", "You said: Again"]);

    // spec/app/assistant/chats.md, "A fork is asked for from a message of the conversation showing"
    // spec/app/assistant/chats.md, "A conversation made new here shows what it holds while its page is read": a fork shows as loading until its page answers.
    world.ask.holdPages = true;
    onMessage("Hello", "New chat from here");
    await until(alpha, runtime, Chats, (s) => s.origin === 1 && s.page.status === "Loading");
    expect(loadingRows()).not.toBeNull();
    world.ask.holdPages = false;
    for (const release of world.ask.heldPages.splice(0)) release();
    await until(alpha, runtime, Chats, (s) => s.origin === 1 && s.page.status === "Loaded");
    expect(lines()).toEqual(["Hello"]);
    // spec/app/assistant/chats.md, "Back to the original leaves the fork for the conversation it came from"
    await press("Original chat");
    await until(alpha, runtime, Chats, (s) => s.chosen === 1 && s.page.status === "Loaded");
    expect(lines()).toEqual(["Hello", "You said: Hello", "Again", "You said: Again"]);

    // spec/app/assistant/chats.md, "The newest list says which conversations there are, and a conversation no longer listed stops showing"
    const raised = (await alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.get()))).assistant;
    await chatsList(alpha);
    await until(alpha, runtime, Chats, (s) => s.list.status === "Loaded");
    await drawn(() => vi.waitFor(() => expect(restorable()).toHaveLength(2)));
    await leaveSettings(alpha, raised);

    // spec/app/assistant/index.md, "A sensitive screen is never sent, and no reply is awaited over one": Settings showing carrier identifiers is a sensitive screen (on a phone).
    if (phone) {
      await alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.send({ type: "openView", view: "Settings" })));
      await alpha.runtime.runPromise(Effect.flatMap(Pages.Machine, (pages) => pages.send({ type: "open", page: "General" })));
      await alpha.runtime.runPromise(Effect.flatMap(Pages.Machine, (pages) => pages.send({ type: "open", page: "CarrierPage" })));
      await until(alpha, runtime, Conversation, (s) => s.context.sensitive && s.context.showing.tag === "App");
      await press("Type");
      await until(alpha, alpha.runtime, Shell, (s) => s.assistant === "Typing");
      await fill("Message Alpha", "my password is hunter2");
      expect([button("Send")?.disabled, world.ask.said.length]).toEqual([true, 2]);
      // spec/app/assistant/index.md, "A sensitive screen says only that it is sensitive: no selection and no day"
      await alpha.runtime.runPromise(Effect.flatMap(Pages.Machine, (pages) => pages.send({ type: "goBack" })));
      await until(alpha, runtime, Conversation, (s) => !s.context.sensitive);
      // spec/app/assistant/index.md, "A sensitive screen says only that it is sensitive: no selection and no day": General, drawn again, focuses the row the owner left, which ends typing; the draft stays for the next Type.
      await until(alpha, alpha.runtime, Shell, (s) => s.assistant === "Bar");
      await press("Type");
      await until(alpha, alpha.runtime, Shell, (s) => s.assistant === "Typing");
      expect([button("Send")?.disabled, composerText()]).toEqual([false, "my password is hunter2"]);
      await hardware("home");
      await until(alpha, runtime, Conversation, (s) => s.context.showing.tag === "Home");
      await press("Open conversation");
      await until(alpha, alpha.runtime, Shell, (s) => s.assistant === "Sheet");
    }

    // spec/app/assistant/reply.md, "A failure refused before any output replaces the streamed text; any other failure is added after it": a reply the agent chose not to give leaves no bubble.
    world.ask.silent = true;
    write("Shh");
    await press("Send");
    await until(alpha, runtime, Reply, (s) => s.turn === 3 && s.status === "Ignored");
    await until(alpha, runtime, Composer, (s) => s.away === "Free");
    expect(lines().slice(-2)).toEqual(["You said: Again", "Shh"]);
    world.ask.silent = undefined;

    // spec/app/assistant/reply.md, "Out of funds is refused before any output, is never spoken, and offers only Manage plan"
    world.ask.refusal = { failureKind: "insufficient_credits", cloudCode: "allowance_exhausted", planAction: "funding" };
    write("Hi");
    await press("Send");
    await until(alpha, runtime, Reply, (s) => s.turn === 4 && s.status === "Interrupted");
    expect([(document.querySelector("section[aria-label='Ask Alpha'] [role=log]")?.textContent ?? "").includes("You’re out of plan allowance and credits, so I couldn’t reply."), Boolean(button("Manage plan"))]).toEqual([true, true]);
    world.ask.refusal = undefined;

    // spec/app/assistant/reply.md, "At most five reply notices of at most 500 units reach the conversation, and only the latest system notice stays, until a real reply follows it": a runtime error the agent stored in answer to the owner's message is v119's one line, "Agent error · Send again", with no control of its own.
    world.ask.kept.get("c1")?.messages.push({ id: "n1u", role: "user", text: "Ping" }, { id: "n1a", role: "assistant", text: systemNoticeText("runtime-error") });
    // spec/app/assistant/chats.md, "Older or newer messages are read around a message of the conversation showing": with no Earlier, read around the first message directly.
    expect(button("Earlier")).toBeUndefined();
    await runtime.runPromise(Effect.flatMap(Chats, (chats) => chats.send({ type: "scroll", around: 1 })));
    await until(alpha, runtime, Chats, (s) => s.around > 0 && s.page.status === "Loaded");
    expect(lines().slice(0, 2)).toEqual(["Hello", "You said: Hello"]);
    const log = () => document.querySelector("section[aria-label='Ask Alpha'] [role=log]")?.textContent ?? "";
    expect([log().includes("Agent error · Send again"), log().includes(systemNoticeText("runtime-error")), button("Send again")]).toEqual([true, false, undefined]);
    // spec/app/assistant/reply.md, "Out of funds is refused before any output, is never spoken, and offers only Manage plan": read again from history, the refused reply is the same one line, never "Out of credits".
    const reopened = document.querySelector("[role=log] [data-alpha-message-id='m4a']");
    const fundingLine = "You’re out of plan allowance and credits, so I couldn’t reply.";
    const refusedRows = [...document.querySelectorAll("[role=log] article")].filter((line) => line.textContent?.includes(fundingLine));
    const managePlan = [...(reopened?.querySelectorAll("button") ?? [])].some((control) => control.textContent === "Manage plan");
    expect([reopened?.textContent?.includes(fundingLine), managePlan, refusedRows.length]).toEqual([true, true, 1]);

    // spec/app/assistant/composer.md, "A quoted message goes with the next send, until the owner removes the quote"
    onMessage("You said: Hello", "Reply");
    await until(alpha, runtime, Composer, (s) => s.editor.quote === 2);
    write("Why?");
    await press("Send");
    await until(alpha, runtime, Conversation, (s) => s.turn.send.id === 5 && s.turn.reply === "Complete");
    expect([world.ask.metadata?.at(-1), world.ask.said.at(-1)]).toEqual([expect.objectContaining({ replyToMessageId: "m1a" }), "Why?"]);
    // spec/app/assistant/composer.md, "Edit and resend puts a message the owner sent in an empty composer, to be sent as a new message"
    write("");
    onMessage("Why?", "Edit and resend");
    await until(alpha, runtime, Composer, (s) => s.editor.editing > 0);
    // spec/app/assistant/index.md, "Back closes a review, then search, then a quote or an edit, one at a time; with none of them open Back is the shell's"; spec/app/assistant/composer.md, "Back, or removing the mark, leaves an edit as an ordinary draft"
    if (phone) await hardware("back");
    else await press("Stop editing");
    await until(alpha, runtime, Composer, (s) => s.editor.editing === 0 && s.editor.text);
    expect(composerText()).toBe("Why?");
    // spec/app/assistant/context.md, "A turn carries the location only while the owner allows it, from a screen that is not sensitive, to a peer that declares it, and only a GPS fix at most thirty minutes old or a network answer that still stands": the phone's last fix, read behind an earlier turn, goes with this one.
    const carried = locationIn(world.ask.metadata?.at(-1));
    expect(phone ? { latitude: carried?.latitude, longitude: carried?.longitude, accuracyMeters: carried?.accuracyMeters, timed: typeof carried?.capturedAt === "number" } : carried)
      .toEqual(phone ? { latitude: 43.73, longitude: 7.42, accuracyMeters: 8, timed: true } : undefined);

    if (phone) {
      // spec/app/assistant/context.md, "Turning Location for Alpha off, or Android taking the permission away, forgets every fix and answer, and leaves what was being read behind"
      await alpha.runtime.runPromise(Effect.flatMap(Prefs.Machine, (prefs) => prefs.send({ type: "setShare", share: "AgentLocation", on: false, at: untimed }, "Owner")));
      await until(alpha, alpha.runtime, Prefs.Machine, (s) => !Prefs.allows(s, "AgentLocation"));
      await until(alpha, runtime, Locator, (s) => !s.enabled && s.gpsAt === -1);
      write("Where am I?");
      await press("Send");
      await until(alpha, runtime, Conversation, (s) => s.turn.send.id === 6 && s.turn.reply === "Complete");
      expect(locationIn(world.ask.metadata?.at(-1))).toBe(undefined);

      // spec/app/assistant/context.md, "A turn carries the location only while the owner allows it, from a screen that is not sensitive, to a peer that declares it, and only a GPS fix at most thirty minutes old or a network answer that still stands": a fix older than thirty minutes is never sent.
      await alpha.runtime.runPromise(Effect.flatMap(Prefs.Machine, (prefs) => prefs.send({ type: "setShare", share: "AgentLocation", on: true, at: untimed }, "Owner")));
      await until(alpha, alpha.runtime, Prefs.Machine, (s) => Prefs.allows(s, "AgentLocation"));
      await until(alpha, runtime, Locator, (s) => s.enabled);
      write("Refresh");
      await press("Send");
      await until(alpha, runtime, Conversation, (s) => s.turn.send.id === 7 && s.turn.reply === "Complete");
      await until(alpha, runtime, Locator, (s) => s.gpsAt >= 0);
      world.maps.here = undefined;
      await later(alpha, 1_800_001);
      write("Too old");
      await press("Send");
      await until(alpha, runtime, Conversation, (s) => s.turn.send.id === 8 && s.turn.reply === "Complete");
      expect(locationIn(world.ask.metadata?.at(-1))).toBe(undefined);
    }

    // spec/app/assistant/reply.md, "A recognized tool block outside a fence becomes its card; inside a fence every line stays code": a tool call written out as text is hidden from Alpha's words, never from the owner's.
    const written = "Open Maps <tool_call>\n<function=phone_use() {}</function>\n</tool_call>";
    write(written);
    await press("Send");
    await until(alpha, runtime, Conversation, (s) => s.turn.send.id === (phone ? 9 : 6) && s.turn.reply === "Complete");
    expect(lines().slice(-2)).toEqual([written, "You said: Open Maps"]);
    // spec/app/assistant/reply.md, "Prose is shown as the model wrote it, line for line; only a bare https address is a link, and HTML reads as text"
    const marked = "**Limes** tonight?\n> Ask [Ana](https://ana.example/) <b>now</b>\n- [one](javascript:alert(1))";
    write(marked);
    await press("Send");
    await until(alpha, runtime, Reply, (s) => s.status === "Settled" && s.final === `You said: ${marked}`.length);
    await vi.waitFor(() => expect([...document.querySelectorAll("[role=log] article")].at(-1)?.querySelector("a")).toBeTruthy());
    const reply = [...document.querySelectorAll("[role=log] article")].at(-1);
    expect([reply?.querySelector("strong, em, blockquote, ul, ol, li, hr, b"), [...(reply?.querySelectorAll("a") ?? [])].map((one) => [one.getAttribute("href"), one.textContent]), lines().at(-1)])
      .toEqual([null, [["https://ana.example/", "https://ana.example/"]], `You said: ${marked}`]);
    // spec/app/assistant/reply.md, "Prose is shown as the model wrote it, line for line; only a bare https address is a link, and HTML reads as text": Enter on the link is the link's own, and the message's press still opens its actions.
    const link = reply?.querySelector("a");
    act(() => { link?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect([link?.closest("button"), document.querySelector("[role=menu]")]).toEqual([null, null]);
    const messagePress = reply?.querySelector<HTMLButtonElement>("button[aria-haspopup=menu]");
    expect([messagePress?.getAttribute("aria-label"), messagePress?.textContent, messagePress?.hasAttribute("aria-labelledby"), messagePress?.nextElementSibling?.textContent]).toEqual(["Message actions", "", false, `You said: ${marked}`]);
    act(() => { messagePress?.click(); });
    expect(document.querySelector("[role=menu]")?.getAttribute("aria-label")).toBe("Message actions");
    act(() => { reply?.querySelector<HTMLButtonElement>("button[aria-haspopup=menu]")?.click(); });
    // spec/app/assistant/reply.md, "Copy, quote, read aloud, use in email and Talk take the reply's plain words, without its marks"
    if (phone) {
      await vi.waitFor(() => onMessage(`You said: ${marked}`, "Copy"));
      await vi.waitFor(() => expect(world.settings.copied.at(-1)).toBe("You said: Limes tonight?\n\nAsk Ana (https://ana.example/) <b>now</b>\n\n• one"));
    }

    // spec/app/assistant/reply.md, "The agent's turn tag is never drawn, copied, quoted, emailed or spoken, and a reply still being written holds back what may become one": the owner's own words keep it, and a link's words stay.
    const tagged = [[["Sure.\n[answer] Paris"], "Sure.\nParis", "Sure.\nParis"], [["Paris. [answer]"], "Paris.", "Paris."], [["<promise> One sec."], "One sec.", "One sec."], [["[ans", "wer] Paris"], "Paris", "Paris"], [["[answer", "](https://example.com)"], "[answer](https://example.com)", "answer (https://example.com/)"]] as const;
    for (const [said, drawn, plain] of tagged) {
      const { turn } = await runtime.runPromise(Effect.flatMap(Conversation, (machine) => machine.get()));
      world.ask.nextReplyChunks = said;
      write("Capital of France? [answer]");
      await press("Send");
      await until(alpha, runtime, Conversation, (s) => s.turn.send.id === turn.send.id + 1 && s.turn.reply === "Complete");
      await until(alpha, runtime, Reply, (s) => s.status === "Settled");
      await vi.waitFor(() => expect(lines().slice(-2)).toEqual(["Capital of France? [answer]", drawn]));
      if (phone) {
        await vi.waitFor(() => onMessage(drawn, "Copy"));
        await vi.waitFor(() => expect(world.settings.copied.at(-1)).toBe(plain));
      }
    }
  });

  // spec/app/assistant/search.md, "Story: Search my conversations"; spec/app/assistant/chats.md, "Story: Open a message that search found"
  it("Hear a brief acknowledgment and still get the whole answer: the acknowledgment stays the label while tools run (spec/app/assistant/reply.md, \"Story: Hear a brief acknowledgment and still get the whole answer\")", async () => {
    const world = { ...scene(), phone };
    const { alpha, runtime } = await openAssistantWithPreferences(world);
    // spec/app/assistant/reply.md, "The planning label shows until the first settled text, and provisional text is neither shown nor spoken": once taken, the acknowledgment stays the label through a later tool label and status, until text arrives.
    world.ask.acknowledgment = "Let me look";
    world.ask.holdAfterTools = true;
    write("What's on today?");
    await until(alpha, runtime, Composer, (s) => s.draft.sync === "Kept");
    await press("Send");
    await vi.waitFor(() => expect(world.ask.turns.size).toBe(1));
    await vi.waitFor(() => expect(document.body.textContent).toContain("Let me look"));
    expect([document.body.textContent?.includes("Using Calendar"), document.body.textContent?.includes("Working")]).toEqual([false, false]);
    await drawn(() => { for (const release of [...world.ask.turns.values()]) release(); });
    await until(alpha, runtime, Reply, (s) => s.status === "Settled" && s.final === "You said: What's on today?".length);
    const said = await runtime.runPromise(Effect.flatMap(Reply, (machine) => machine.get()));
    expect([said.acks, lines()]).toEqual([1, ["What's on today?", "You said: What's on today?"]]);
    expect(document.body.textContent?.includes("Let me look")).toBe(false);
  });

  // spec/app/assistant/reply.md, "The planning label shows until the first settled text, and provisional text is neither shown nor spoken"
  it("Hear a brief acknowledgment and still get the whole answer: text that may still be taken back is never shown, the dots say Alpha is replying, and the settled reply is shown (spec/app/assistant/reply.md, \"Story: Hear a brief acknowledgment and still get the whole answer\")", async () => {
    const world = { ...scene(), phone };
    const { alpha, runtime } = await openAssistantWithPreferences(world);
    const ready = Promise.withResolvers<void>();
    const done = Promise.withResolvers<void>();
    world.ask.nextReplyChunks = ["I can't open the Camera", " for you."];
    world.ask.nextReplyProvisional = true;
    world.ask.holdReady = ready.promise;
    world.ask.holdDoneAfterReady = done.promise;
    world.ask.noStatus = true;
    try {
      write("Open the camera");
      await until(alpha, runtime, Composer, (s) => s.draft.sync === "Kept");
      await press("Send");
      await until(alpha, runtime, Reply, (s) => s.provisional && s.shown === 0);
      expect(document.body.textContent?.includes("I can't open the Camera")).toBe(false);
      await vi.waitFor(() => expect(replying()).toBe(true));
      // spec/app/assistant/reply.md, "The planning label shows until the first settled text, and provisional text is neither shown nor spoken": the reply the agent stored is settled text, shown before its last frame.
      ready.resolve();
      await until(alpha, runtime, Reply, (s) => s.status === "Streaming" && !s.provisional && s.shown === "I can't open the Camera for you.".length);
      await vi.waitFor(() => expect(writingReply()).toBe("I can't open the Camera for you."));
      expect(replying()).toBe(false);
    } finally {
      ready.resolve();
      done.resolve();
    }
    await until(alpha, runtime, Reply, (s) => s.status === "Settled" && s.final === "I can't open the Camera for you.".length);
    await vi.waitFor(() => expect(lines()).toEqual(["Open the camera", "I can't open the Camera for you."]));
  });

  // spec/app/assistant/reply.md, "Each step the agent marked untold draws Alpha's step notice under its reply, live and read again, and a reply with no text that marks one is answered, never declined"
  it("Understand why a reply did not finish: each step the agent marked untold shows Alpha's notice under its reply, from the stored reply's announcement, its last frame, a resend and history, and a reply with no text that marks nothing still leaves no bubble (spec/app/assistant/reply.md, \"Story: Understand why a reply did not finish\")", async () => {
    const world = { ...scene(), phone };
    const { alpha, runtime } = await openAssistantWithPreferences(world);
    const bubbles = () => [...document.querySelectorAll("section[aria-label='Ask Alpha'] [role=log] article")].map((line) => line.textContent ?? "");
    const ask = async (text: string) => {
      write(text);
      await until(alpha, runtime, Composer, (s) => s.draft.sync === "Kept");
      await press("Send");
    };
    const ready = Promise.withResolvers<void>();
    const done = Promise.withResolvers<void>();
    world.ask.nextReplyChunks = ["Your table ", "is booked."];
    world.ask.nextReplyProvisional = true;
    world.ask.nextReplySettledAs = "";
    world.ask.nextActions = () => [{ action: "CALENDAR", data: { actionName: "CALENDAR" } }, untoldStep("BOOK_TABLE")];
    world.ask.holdReady = ready.promise;
    world.ask.holdDoneAfterReady = done.promise;
    try {
      await ask("Book a table at Nopa");
      await until(alpha, runtime, Reply, (s) => s.provisional && s.shown === 0);
      // spec/app/assistant/reply.md, "Each step the agent marked untold draws Alpha's step notice under its reply, live and read again, and a reply with no text that marks one is answered, never declined": the stored reply's announcement draws the notice at once, and the provisional text it settled away from never shows.
      ready.resolve();
      await vi.waitFor(() => expect(writingReply()).toBe("Book table did not complete"));
    } finally {
      ready.resolve();
      done.resolve();
    }
    await until(alpha, runtime, Reply, (s) => s.status === "Settled" && s.final === 0);
    const booked = ["Book a table at Nopa", "Book table did not complete"];
    await vi.waitFor(() => expect(bubbles()).toEqual(booked));

    world.ask.nextDropsWith = { text: "", untold: ["HOLD_SEAT"] };
    await ask("Hold me a seat");
    const held = [...booked, "Hold me a seat", "Hold seat did not complete"];
    await vi.waitFor(() => expect(bubbles()).toEqual(held));

    world.ask.nextReplyChunks = ["Hmm."];
    world.ask.nextReplyProvisional = true;
    world.ask.nextReplySettledAs = "";
    await ask("Say nothing");
    await until(alpha, runtime, Reply, (s) => s.status === "Ignored");
    await vi.waitFor(() => expect(bubbles()).toEqual([...held, "Say nothing"]));

    const before = await runtime.runPromise(Effect.flatMap(Chats, (chats) => chats.get()));
    const reads = world.ask.pageReads;
    await runtime.runPromise(Effect.flatMap(Chats, (chats) => chats.send({ type: "reread" })));
    await until(alpha, runtime, Chats, (s) => s.page.ticket > before.page.ticket && s.page.status === "Loaded");
    await vi.waitFor(() => expect([world.ask.pageReads > reads, bubbles()]).toEqual([true, [...held, "Say nothing"]]));
    expect(["booked", "Hmm", "did not finish", "Reply failed", "Agent error"].filter((words) => document.body.textContent?.includes(words))).toEqual([]);

    // spec/app/assistant/reply.md, "Each step the agent marked untold draws Alpha's step notice under its reply, live and read again, and a reply with no text that marks one is answered, never declined": a streamed reply that marks nothing makes no read of its history row.
    const plainReads = world.ask.pageReads;
    world.ask.nextReplyChunks = ["Nopa opens ", "at five."];
    await ask("When does Nopa open");
    const opens = [...held, "Say nothing", "When does Nopa open", "Nopa opens at five."];
    await vi.waitFor(() => expect(bubbles()).toEqual(opens));
    await until(alpha, runtime, Composer, (s) => s.slot === "Open" && s.away === "Free" && !s.unsettled);
    expect(world.ask.pageReads).toBe(plainReads);

    // spec/app/assistant/reply.md, "Each step the agent marked untold draws Alpha's step notice under its reply, live and read again, and a reply with no text that marks one is answered, never declined": the resend of a dropped turn whose stored reply has words answers those words alone, so the chat shows them and takes the untold step from the reply's history row, read once more when the first read fails.
    world.ask.nextDropsWith = { text: "Here are two cafes near Nopa.", untold: ["BOOK_TABLE"] };
    await ask("Book Nopa and find cafes");
    const cafes = [...opens, "Book Nopa and find cafes", "Here are two cafes near Nopa.Book table did not complete"];
    await vi.waitFor(() => expect(bubbles()).toEqual(cafes));
    const retryReads = world.ask.pageReads;
    world.ask.aroundDown = 1;
    world.ask.nextDropsWith = { text: "I found one cafe.", untold: ["BOOK_TABLE"] };
    await ask("Book it and find one more");
    await vi.waitFor(() => expect(bubbles()).toEqual([...cafes, "Book it and find one more", "I found one cafe.Book table did not complete"]));
    expect([world.ask.aroundDown, world.ask.pageReads - retryReads]).toEqual([0, 2]);

    const asked = "I asked for a table.Book table did not complete";
    const stopAfterNotice = async (text: string) => {
      const held = Promise.withResolvers<void>();
      world.ask.nextReplyChunks = ["I asked ", "for a table."];
      world.ask.nextReplyProvisional = true;
      world.ask.nextReplySettledAs = "I asked for a table.";
      world.ask.nextActions = () => [untoldStep("BOOK_TABLE")];
      world.ask.holdDoneAfterReady = held.promise;
      try {
        await until(alpha, runtime, Composer, (s) => s.slot === "Open" && s.away === "Free" && !s.unsettled);
        await ask(text);
        await vi.waitFor(() => expect(writingReply()).toBe(asked));
        await press("Stop reply");
        await until(alpha, runtime, Conversation, (s) => s.turn.reply === "Stopped" && s.check !== "Aborting" && s.recheck.status !== "Loading");
      } finally {
        held.resolve();
      }
      expect(writingReply()).toBe(asked);
    };
    // spec/app/assistant/reply.md, "Each step the agent marked untold draws Alpha's step notice under its reply, live and read again, and a reply with no text that marks one is answered, never declined": a reply stopped after its notice keeps it, and the next message's reply starts without it.
    await stopAfterNotice("Book it again");
    world.ask.stalled = true;
    world.ask.nextReplyChunks = ["Thinking"];
    world.ask.nextReplyProvisional = true;
    await until(alpha, runtime, Composer, (s) => s.slot === "Open" && s.away === "Free" && !s.unsettled);
    await ask("Try once more");
    await until(alpha, runtime, Reply, (s) => s.provisional && s.shown === 0);
    expect(writingReply()).toBeUndefined();
    await press("Stop reply");
    await until(alpha, runtime, Conversation, (s) => s.turn.reply === "Stopped" && s.check !== "Aborting" && s.recheck.status !== "Loading");
    world.ask.stalled = false;

    // spec/app/assistant/reply.md, "Each step the agent marked untold draws Alpha's step notice under its reply, live and read again, and a reply with no text that marks one is answered, never declined": another chat shows without the notice of a reply written in this one.
    await stopAfterNotice("Book it once more");
    const left = (await runtime.runPromise(Effect.flatMap(Chats, (chats) => chats.get()))).chosen;
    await chatsList(alpha);
    await press("New conversation");
    await until(alpha, runtime, Chats, (s) => s.chosen > 0 && s.chosen !== left && s.page.status === "Loaded");
    await until(alpha, runtime, Composer, (s) => s.binding.conversation !== left);
    await vi.waitFor(() => expect(writingReply()).toBeUndefined());
  });

  // spec/app/assistant/index.md, "Alpha asks the agent to warm up at launch, on return to the foreground, after a sign-in and when Ask Alpha is raised from its bar, only while the agent can answer, and shows nothing of it"
  it("Warm the agent before my first message: at launch, on return, after a sign-in and when Ask Alpha is raised, never while it cannot answer, and without a word (spec/app/assistant/index.md, \"Alpha asks the agent to warm up at launch, on return to the foreground, after a sign-in and when Ask Alpha is raised from its bar, only while the agent can answer, and shows nothing of it\")", async () => {
    const world = { ...scene(), phone };
    const { alpha, runtime } = await openAssistant(world);
    const asked = () => world.ask.warmUps.length;
    await settled(alpha, () => asked() === 1, asked);
    await seen(false);
    await seen(true);
    await settled(alpha, () => asked() === 2, asked);
    await alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.send({ type: "raise", detent: "Sheet" })));
    await settled(alpha, () => asked() === 3, asked);
    await alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.send({ type: "raise", detent: "Full" })));
    /** Only the phone's sign-in settles; Talk warming speech for the new account asks the agent for nothing more. */
    const signedIn = phone ? 1 : 0;
    await drawn(() => world.voice.signedInHere?.());
    await settled(alpha, () => asked() === 3 + signedIn, asked);
    world.ask.warmUpFails = true;
    await seen(false);
    await seen(true);
    await settled(alpha, () => asked() === 4 + signedIn, asked);
    world.ask.canRespond = false;
    const reads = world.ask.statusReads;
    await seen(false);
    await seen(true);
    await settled(alpha, () => world.ask.statusReads > reads, () => world.ask.statusReads);
    await later(alpha, 10);
    expect([asked(), world.ask.opened, world.ask.said, lines(), document.body.textContent?.toLowerCase().includes("warm"), new Set(world.ask.warmUps.map((headers) => JSON.stringify(headers))).size]).toEqual([4 + signedIn, 0, [], [], false, 1]);
    world.ask.canRespond = true;
    write("Hello");
    await press("Send");
    await until(alpha, runtime, Conversation, (s) => s.turn.reply === "Complete");
    expect([lines(), world.ask.said]).toEqual([["Hello", "You said: Hello"], ["Hello"]]);
  });

  it("Search my conversations, and open a hit where it was said (spec/app/assistant/search.md, \"Story: Search my conversations\")", async () => {
    const world = { ...scene(), phone };
    world.ask.kept.set("c7", { roomId: "r7", title: "Lunch", messages: [
      { id: "m1", role: "user", text: "Lunch on Friday?" },
      { id: "m2", role: "assistant", text: "Friday at noon works." },
      { id: "m3", role: "assistant", text: "", failureKind: "limit_reached" },
      { id: "m4", role: "assistant", text: "", failureKind: "insufficient_credits" },
      { id: "m5", role: "assistant", text: "", failureKind: "insufficient_credits", cloudCode: "allowance_exhausted" },
      { id: "m6", role: "assistant", text: "<promise> Friday is free." },
      { id: "m7", role: "user", text: "Friday [answer] again?" },
      { id: "m8", role: "assistant", text: "Yes." },
      { id: "m9", role: "assistant", text: systemNoticeText("runtime-error") },
    ] });
    const { alpha, runtime } = await openAssistant(world, false);

    await press("Open conversation");
    await until(alpha, runtime, Shell, (s) => s.assistant === "Sheet");

    // spec/app/assistant/search.md, "Story: Search my conversations": a hit returns to the full conversation.
    const openSearch = async () => {
      chatAction("Search chat");
      await drawn(() => vi.waitFor(() => expect(document.querySelector("input[aria-label='Search chats']")).not.toBeNull()));
    };
    await openSearch();
    await fill("Search chats", "friday");
    await until(alpha, runtime, Search, (s) => s.hits.status === "Loaded" && s.words === "friday");
    expect(rows("Results")).toBe(4);
    // spec/app/assistant/reply.md, "The agent's turn tag is never drawn, copied, quoted, emailed or spoken, and a reply still being written holds back what may become one": a hit of the agent's loses the tag, the owner's keeps it.
    const results = document.querySelector("section[aria-label='Results']")?.textContent ?? "";
    expect([results.includes("Friday is free."), results.includes("<promise>"), results.includes("Friday [answer] again?")]).toEqual([true, false, true]);
    // spec/app/assistant/search.md, "Opening a hit closes search and opens its conversation around its message, and another conversation only while the turn and the composer are free"
    row("Results", "Friday at noon");
    await until(alpha, runtime, Chats, (s) => s.chosen > 0 && s.around > 0 && s.page.status === "Loaded");
    const askDetent = () => document.querySelector("section[aria-label='Ask Alpha']")?.getAttribute("data-alpha-detent");
    expect([lines().slice(0, 2), document.querySelector("section[aria-label='Results']"), askDetent()]).toEqual([["Lunch on Friday?", "Friday at noon works."], null, "full"]);
    // spec/app/assistant/reply.md, "A failed reply offers the fix the agent named, and a limit reached shows its live wait, never sending the message again": a reply read again from history says why it did not finish, and to wait a moment.
    expect(document.querySelector("[role=log]")?.textContent).toContain("Too many requests. Wait a moment, then try again");
    // spec/app/assistant/reply.md, "Out of funds is refused before any output, is never spoken, and offers only Manage plan"; spec/app/assistant/reply.md, "A failure refused before any output replaces the streamed text; any other failure is added after it": spent credits stored without Cloud's code keep their own words, and only the reply stored with it reads as the one out-of-funds line.
    const kept = [...document.querySelectorAll("[role=log] article")].map((line) => line.textContent ?? "");
    expect([kept.filter((text) => text.includes("Out of credits")).length, kept.filter((text) => text.includes("You’re out of plan allowance and credits, so I couldn’t reply.")).length]).toEqual([1, 1]);
    // spec/app/assistant/reply.md, "At most five reply notices of at most 500 units reach the conversation, and only the latest system notice stays, until a real reply follows it": a runtime error stored after the agent's own reply, with nothing of the owner's waiting, is v119's "Agent degraded".
    expect([kept.filter((text) => text.includes("Agent degraded")).length, kept.some((text) => text.includes("Agent error"))]).toEqual([1, false]);

    // spec/app/assistant/search.md, "Only the newest asking's hits are shown, a page at a time, after those already shown": a search that fails says so.
    world.ask.searchDown = true;
    await openSearch();
    await fill("Search chats", "noon");
    await until(alpha, runtime, Search, (s) => s.hits.status === "Failed");
    expect(document.body.textContent).toContain("Search did not finish");
    // spec/app/assistant/index.md, "Back closes a review, then search, then a quote or an edit, one at a time; with none of them open Back is the shell's"
    await hardware("back");
    await until(alpha, runtime, Search, (s) => !s.open);
    expect(askDetent()).toBe("full");
  });

  // spec/app/assistant/chats.md, "Story: Find my conversations"
  it("Find the conversation I was in after a restart, or the agent's newest, or a new chat once it has none (spec/app/assistant/chats.md, \"Story: Find my conversations\")", async () => {
    const world = { ...scene(), phone };
    const first = await open(world, mounts);
    let runtime = assistant.runtime(first.alpha);
    await until(first.alpha, runtime, Composer, (s) => s.slot === "Open");
    await until(first.alpha, runtime, Conversation, (s) => s.ready);
    write("Hello before restart");
    await press("Send");
    await until(first.alpha, runtime, Chats, (s) => s.chosen === 1 && s.page.status === "Loaded");
    await until(first.alpha, runtime, Conversation, (s) => s.turn.reply === "Complete");
    await first.close();

    // spec/app/assistant/chats.md, "The conversation showing, and the one a fork came from, are remembered through a restart and read again": a read that fails offers Try again.
    world.ask.pagesDown = true;
    const second = await open(world, mounts);
    runtime = assistant.runtime(second.alpha);
    await until(second.alpha, runtime, Chats, (s) => s.chosen === 1 && s.page.status === "Failed");
    expect(document.body.textContent).toContain("Messages did not load");
    world.ask.pagesDown = false;
    await press("Try again");
    await until(second.alpha, runtime, Chats, (s) => s.chosen === 1 && s.page.status === "Loaded");
    expect(lines()).toEqual(["Hello before restart", "You said: Hello before restart"]);
    await second.close();

    // spec/app/assistant/chats.md, "A read of the latest messages answered 404 asks the agent's list whether the conversation is still there": a conversation the agent still lists is a read that failed, read once and never again by itself.
    world.ask.pagesMissing = true;
    world.ask.pageReads = 0;
    world.ask.listReads = 0;
    const listedYetMissing = await open(world, mounts);
    runtime = assistant.runtime(listedYetMissing.alpha);
    await until(listedYetMissing.alpha, runtime, Chats, (s) => s.chosen === 1 && s.page.status === "Failed");
    await until(listedYetMissing.alpha, runtime, Conversation, (s) => s.ready);
    expect([document.body.textContent?.includes("Messages did not load"), world.ask.pageReads, world.ask.listReads]).toEqual([true, 1, 1]);
    world.ask.pagesMissing = false;
    await press("Try again");
    await until(listedYetMissing.alpha, runtime, Chats, (s) => s.chosen === 1 && s.page.status === "Loaded");
    expect([lines(), world.ask.pageReads]).toEqual([["Hello before restart", "You said: Hello before restart"], 2]);
    await listedYetMissing.close();

    // spec/app/assistant/chats.md, "A conversation the list no longer has is forgotten, and the first it lists, the most recently used, shows in its place, or a new chat when there is none"
    world.ask.kept.clear();
    world.ask.kept.set("c8", { roomId: "r8", title: "Dinner", messages: [{ id: "m8", role: "user", text: "Dinner at eight?" }] });
    world.ask.kept.set("c7", { roomId: "r7", title: "Lunch", messages: [{ id: "m7", role: "user", text: "Lunch on Friday?" }] });
    const third = await open(world, mounts);
    runtime = assistant.runtime(third.alpha);
    await until(third.alpha, runtime, Chats, (s) => s.chosen > 1 && s.ids.length === 2 && s.page.status === "Loaded");
    expect([document.body.textContent?.includes("Messages did not load"), button("Try again"), lines()]).toEqual([false, undefined, ["Dinner at eight?"]]);

    // spec/app/assistant/chats.md, "The list of conversations is read whenever it is shown": Back from Agent activity keeps the current conversation and draft.
    write("Ideas for dinner");
    await until(third.alpha, runtime, Composer, (s) => s.editor.text && s.draft.sync === "Kept");
    const chosen = (await runtime.runPromise(Effect.flatMap(Chats, (machine) => machine.get()))).chosen;
    const detent = (await third.alpha.runtime.runPromise(Effect.flatMap(Shell, (machine) => machine.get()))).assistant;
    await chatsList(third.alpha);
    await until(third.alpha, runtime, Chats, (s) => s.list.status === "Loaded");
    await drawn(() => vi.waitFor(() => expect(restorable()).toEqual(["Dinner", "Lunch"])));
    await hardware("back");
    await until(third.alpha, third.alpha.runtime, Pages.Machine, (s) => s.page === "About");
    const kept = await runtime.runPromise(Effect.flatMap(Chats, (machine) => machine.get()));
    expect([kept.chosen, composerText(), lines()]).toEqual([chosen, "Ideas for dinner", ["Dinner at eight?"]]);
    write("");
    await leaveSettings(third.alpha, detent);
    await third.close();

    // spec/app/assistant/chats.md, "Older or newer messages are read around a message of the conversation showing"
    world.ask.kept.set("c8", { roomId: "r8", title: "Dinner", messages: Array.from({ length: 205 }, (_, at) => ({
      id: `history-${at + 1}`, role: "user", text: `History ${at + 1}`,
    })) });
    const long = await open(world, mounts);
    runtime = assistant.runtime(long.alpha);
    await until(long.alpha, runtime, Chats, (s) => s.page.status === "Loaded");
    await press("Open conversation");
    await until(long.alpha, runtime, Shell, (s) => s.assistant === "Sheet");
    expect([lines().length, lines()[0], lines().at(-1), button("Later")]).toEqual([200, "History 6", "History 205", undefined]);
    await until(long.alpha, runtime, Composer, (s) => s.slot === "Open");
    onMessage("History 205", "Reply");
    await until(long.alpha, runtime, Composer, (s) => s.editor.quote > 0);
    const currentPage = () => runtime.runSync(Effect.flatMap(Chats, (machine) => machine.get())).page.ticket;
    for (let visit = 0; visit < 3; visit++) {
      const laterPage = currentPage();
      await press("Earlier");
      await until(long.alpha, runtime, Chats, (s) => s.page.status === "Loaded" && s.page.ticket > laterPage);
      expect([lines()[0], lines().at(-1), button("Earlier")]).toEqual(["History 1", "History 106", undefined]);
      expect(button("Remove quote")?.parentElement?.textContent).toContain("History 205");

      const earlierPage = currentPage();
      await press("Later");
      await until(long.alpha, runtime, Chats, (s) => s.page.status === "Loaded" && s.page.ticket > earlierPage);
      expect([lines()[0], lines().at(-1), Boolean(button("Earlier")), button("Later")]).toEqual(["History 6", "History 205", true, undefined]);
    }
    const laterPage = currentPage();
    await press("Earlier");
    await until(long.alpha, runtime, Chats, (s) => s.page.status === "Loaded" && s.page.ticket > laterPage);
    world.ask.metadata = [];
    write("Reply to a message outside this window");
    await press("Send");
    await until(long.alpha, runtime, Conversation, (s) => s.turn.reply === "Complete");
    expect(world.ask.metadata?.at(-1)).toMatchObject({ replyToMessageId: "history-205" });
    await long.close();

    world.ask.kept.clear();
    const fourth = await open(world, mounts);
    runtime = assistant.runtime(fourth.alpha);
    await until(fourth.alpha, runtime, Chats, (s) => s.chosen === 0 && s.ids.length === 0 && s.page.status === "Idle");
    await until(fourth.alpha, runtime, Composer, (s) => s.binding.conversation === 0 && s.slot === "Open");
    await until(fourth.alpha, runtime, Conversation, (s) => s.ready);
    expect([document.body.textContent?.includes("Messages did not load"), button("Try again"), lines()]).toEqual([false, undefined, []]);
    write("Hello after restart");
    await press("Send");
    await until(fourth.alpha, runtime, Chats, (s) => s.chosen > 0 && s.page.status === "Loaded");
    await until(fourth.alpha, runtime, Conversation, (s) => s.turn.reply === "Complete");
    expect([lines(), world.ask.said.at(-1), world.ask.opened]).toEqual([["Hello after restart", "You said: Hello after restart"], "Hello after restart", 2]);
    await fourth.close();

    // spec/app/assistant/chats.md, "The newest list says which conversations there are, and a conversation no longer listed stops showing"; spec/app/assistant/chats.md, "A new chat holds no conversation's page": a list without the conversation that lands while its 404 is being checked leaves its page behind, and the new chat settles.
    world.ask.kept.clear();
    world.ask.kept.set("c7", { roomId: "r7", title: "Lunch", messages: [{ id: "m7", role: "user", text: "Lunch on Friday?" }] });
    world.ask.holdLists = true;
    const fifth = await open(world, mounts);
    runtime = assistant.runtime(fifth.alpha);
    await vi.waitFor(() => expect(world.ask.heldLists.length).toBe(1));
    world.ask.holdLists = false;
    await chatsList(fifth.alpha);
    await until(fifth.alpha, runtime, Chats, (s) => s.chosen === 0 && s.list.status === "Loaded" && s.page.status === "Idle");
    expect([document.querySelector("[role=log] [aria-busy]"), document.body.textContent?.includes("Messages did not load")]).toEqual([null, false]);
    for (const release of world.ask.heldLists.splice(0)) release();
    await hardware("back");
    await until(fifth.alpha, fifth.alpha.runtime, Pages.Machine, (s) => s.page === "About");

    // spec/app/assistant/chats.md, "A list asked before a conversation was made is left behind, so its answer never takes that conversation away": the list read asked before New chat answers after the conversation was made.
    world.ask.holdLists = true;
    await chatsList(fifth.alpha);
    await vi.waitFor(() => expect(world.ask.heldLists.length).toBe(1));
    await press("New conversation");
    await until(fifth.alpha, runtime, Chats, (s) => s.chosen > 0 && s.make.outcome === "Confirmed" && s.page.status === "Loaded");
    const chats = () => runtime.runPromise(Effect.flatMap(Chats, (machine) => machine.get()));
    const made = (await chats()).chosen;
    world.ask.holdLists = false;
    for (const release of world.ask.heldLists.splice(0)) release();
    await until(fifth.alpha, runtime, Chats, (s) => s.list.status === "Loaded");
    const after = await chats();
    expect([after.chosen, after.ids.includes(made)]).toEqual([made, true]);

    // spec/app/assistant/composer.md, "A typed draft in a conversation that vanished moves into the new chat"
    const carried = "Carry this draft into the new chat";
    write(carried);
    await until(fifth.alpha, runtime, Composer, (s) => s.binding.conversation === made && s.editor.text && s.draft.sync === "Kept");
    world.ask.kept.clear();
    await chatsList(fifth.alpha);
    await until(fifth.alpha, runtime, Chats, (s) => s.chosen === 0 && s.ids.length === 0 && s.list.status === "Loaded");
    await until(fifth.alpha, runtime, Composer, (s) => s.binding.conversation === 0 && s.slot === "Open" && s.editor.text && s.draft.sync === "Kept");
    expect(composerText()).toBe(carried);
    await press("Send");
    await until(fifth.alpha, runtime, Chats, (s) => s.chosen > 0 && s.page.status === "Loaded");
    await until(fifth.alpha, runtime, Conversation, (s) => s.turn.reply === "Complete");
    expect(world.ask.said.at(-1)).toBe(carried);
  });

  it('Keeps the Later boundary ahead of my new turn when I send while reading older messages (spec/app/assistant/chats.md, "Older or newer messages are read around a message of the conversation showing")', async () => {
    const world = { ...scene(), phone };
    world.ask.kept.set("c1", { roomId: "r1", title: "Earlier history", messages: Array.from({ length: 205 }, (_, at) => ({
      id: `history-${at + 1}`, role: "user", text: `History ${at + 1}`,
    })) });
    const { alpha, runtime } = await openAssistant(world);
    await press("Open conversation");
    await until(alpha, runtime, Shell, (state) => state.assistant === "Sheet");
    await chatsList(alpha);
    await until(alpha, runtime, Chats, (state) => state.list.status === "Loaded");
    await restore("Earlier history");
    await until(alpha, runtime, Chats, (state) => state.chosen > 0 && state.page.status === "Loaded");
    await until(alpha, runtime, Composer, (state) => state.binding.conversation > 0 && state.slot === "Open");
    await press("Earlier");
    await until(alpha, runtime, Chats, (state) => state.around > 0 && state.page.status === "Loaded");

    const transcriptOrder = () => [...document.querySelectorAll("[role=log] [data-alpha-message-text], [role=log] button")].flatMap((element) =>
      element.hasAttribute("data-alpha-message-text") || element.textContent === "Later" ? [element.textContent] : []);
    const lastFour = ["History 106", "Later", "Question from here", "Reply from the current turn"];
    const done = Promise.withResolvers<void>();
    world.ask.nextReplyChunks = ["Reply from the current turn"];
    world.ask.holdDoneAfterReady = done.promise;
    try {
      write("Question from here");
      await press("Send");
      await drawn(() => vi.waitFor(() => expect(transcriptOrder().slice(-4)).toEqual(lastFour)));
    } finally {
      done.resolve();
    }
    await until(alpha, runtime, Conversation, (state) => state.turn.reply === "Complete");
    expect(transcriptOrder().slice(-4)).toEqual(lastFour);
    expect(lines()[0]).toBe("History 1");
    expect(lines().slice(-2)).toEqual(["Question from here", "Reply from the current turn"]);
  });

  // spec/app/assistant/reply.md, "A failure refused before any output replaces the streamed text; any other failure is added after it"
  it("Stop a reply: it keeps the settled text it reached, and never text that might still be taken back (spec/app/assistant/index.md, \"Story: Stop a reply\")", async () => {
    const world = { ...scene(), phone };
    const { alpha, runtime } = await openAssistantWithPreferences(world);
    world.ask.stalled = true;
    world.ask.nextReplyChunks = ["I can't open", " the Camera"];
    world.ask.nextReplyProvisional = true;
    write("Open the camera");
    await until(alpha, runtime, Composer, (s) => s.draft.sync === "Kept");
    await press("Send");
    await until(alpha, runtime, Reply, (s) => s.provisional && s.shown === 0);
    await press("Stop reply");
    await until(alpha, runtime, Conversation, (s) => s.turn.reply === "Stopped" && s.check !== "Aborting" && s.recheck.status !== "Loading");
    const nothingSettled = await runtime.runPromise(Effect.flatMap(Reply, (machine) => machine.get()));
    expect([nothingSettled.stopped, nothingSettled.shown, writingReply(), lines()]).toEqual([true, 0, undefined, ["Open the camera"]]);
    expect(document.body.textContent?.includes("I can't open")).toBe(false);

    world.ask.stalled = false;
    const done = Promise.withResolvers<void>();
    world.ask.nextReplyChunks = ["I can't open the Camera", " for you."];
    world.ask.nextReplyProvisional = true;
    world.ask.holdDoneAfterReady = done.promise;
    try {
      await until(alpha, runtime, Composer, (s) => s.slot === "Open" && s.away === "Free" && !s.unsettled);
      write("Open the camera now");
      await until(alpha, runtime, Composer, (s) => s.draft.sync === "Kept");
      await press("Send");
      await until(alpha, runtime, Reply, (s) => s.status === "Streaming" && !s.provisional && s.shown === "I can't open the Camera for you.".length);
      await press("Stop reply");
      await until(alpha, runtime, Conversation, (s) => s.turn.reply === "Stopped" && s.check !== "Aborting" && s.recheck.status !== "Loading");
      const settled = await runtime.runPromise(Effect.flatMap(Reply, (machine) => machine.get()));
      expect([settled.stopped, settled.shown]).toEqual([true, "I can't open the Camera for you.".length]);
      expect([writingReply(), lines()]).toEqual(["I can't open the Camera for you.", ["Open the camera", "Open the camera now", "I can't open the Camera for you."]]);
    } finally {
      done.resolve();
    }
  });

  // spec/app/assistant/reply.md, "The planning label shows until the first settled text, and provisional text is neither shown nor spoken"
  it("See the reply as soon as the agent decides it, before it is stored, and keep exactly that text on Stop (spec/app/assistant/reply.md, \"The planning label shows until the first settled text, and provisional text is neither shown nor spoken\"; spec/app/assistant/index.md, \"Story: Stop a reply\")", async () => {
    const world = { ...scene(), phone };
    const { alpha, runtime } = await openAssistantWithPreferences(world);
    world.ask.stalled = true;
    world.ask.noStatus = true;
    world.ask.nextReplyChunks = ["I can't open", " the Camera from here."];
    world.ask.nextReplyProvisional = true;
    world.ask.nextReplySettled = true;
    write("Open the camera");
    await until(alpha, runtime, Composer, (s) => s.draft.sync === "Kept");
    await press("Send");
    await until(alpha, runtime, Reply, (s) => s.status === "Streaming" && !s.provisional && s.shown === "I can't open the Camera from here.".length);
    await vi.waitFor(() => expect(writingReply()).toBe("I can't open the Camera from here."));
    expect([replying(), (await runtime.runPromise(Effect.flatMap(Reply, (machine) => machine.get()))).final]).toEqual([false, 0]);
    await press("Stop reply");
    await until(alpha, runtime, Conversation, (s) => s.turn.reply === "Stopped" && s.check !== "Aborting" && s.recheck.status !== "Loading");
    const stopped = await runtime.runPromise(Effect.flatMap(Reply, (machine) => machine.get()));
    expect([stopped.stopped, stopped.shown]).toEqual([true, "I can't open the Camera from here.".length]);
    expect([writingReply(), lines()]).toEqual(["I can't open the Camera from here.", ["Open the camera", "I can't open the Camera from here."]]);
  });

  // spec/app/assistant/index.md, "Story: Stop a reply"
  it("Stop a reply, and learn how it ended (spec/app/assistant/index.md, \"Story: Stop a reply\")", async () => {
    const world = { ...scene(), phone };
    world.ask.kept.set("c1", { roomId: "r1", title: "Ask Alpha", messages: [] });
    world.ask.opened = 1;
    const { alpha, runtime } = await openAssistant(world);
    await chatsList(alpha);
    await until(alpha, runtime, Chats, (s) => s.list.status === "Loaded");
    await restore("Ask Alpha");
    await until(alpha, runtime, Composer, (s) => s.binding.conversation === 1 && s.slot === "Open");

    // spec/app/assistant/index.md, "Stop reply ends a streaming reply, and takes back a message nothing was heard of"
    world.ask.stalled = true;
    world.ask.nextReplyChunks = ["Read [Octopus](https://en.wikipedia.org/wiki/Octopus) and **Lim", " [ans"];
    write("Take your time");
    await press("Send");
    await until(alpha, runtime, Conversation, (s) => s.turn.reply === "Streaming");
    expect(button("Send")).toBe(undefined);
    // spec/app/assistant/reply.md, "Prose is shown as the model wrote it, line for line; only a bare https address is a link, and HTML reads as text": the reply still being written prints its marks as written, and its address opens through the phone's link path.
    // spec/app/assistant/reply.md, "The agent's turn tag is never drawn, copied, quoted, emailed or spoken, and a reply still being written holds back what may become one": the "[ans" it ends in is held back too.
    const writing = await vi.waitFor(() => {
      const found = document.querySelector("[data-alpha-message-id='reply'] a");
      if (!found) throw new Error("no link in the reply being written");
      return found;
    });
    const tap = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => { writing.dispatchEvent(tap); });
    expect([writing.getAttribute("href"), writing.closest("[data-alpha-message-id]")?.textContent, tap.defaultPrevented]).toEqual(["https://en.wikipedia.org/wiki/Octopus", "Read [Octopus](https://en.wikipedia.org/wiki/Octopus) and **Lim", phone]);
    await press("Stop reply");
    // spec/app/assistant/index.md, "The agent's answer to the abort starts the one read of the conversation"; spec/app/assistant/index.md, "The read says the reply finished anyway, was stopped for sure, was never recorded, or to look later"
    await until(alpha, runtime, Conversation, (s) => s.turn.reply === "Stopped" && s.check !== "Aborting" && s.recheck.status !== "Loading");
    const first = await runtime.runPromise(Effect.flatMap(Conversation, (machine) => machine.get()));
    expect([world.ask.turns.size, lines()[0], first.check]).toEqual([0, "Take your time", "StoppedForSure"]);

    await until(alpha, runtime, Composer, (s) => s.slot === "Open" && s.away === "Free" && !s.unsettled);
    write("Take your time");
    await press("Send");
    await until(alpha, runtime, Conversation, (s) => s.turn.reply === "Streaming");
    world.ask.afterStop = [{ id: "scheduled-reminder", role: "assistant", text: "Your review starts now." }];
    await press("Stop reply");
    await until(alpha, runtime, Conversation, (s) => s.turn.reply === "Stopped" && s.recheck.ticket > first.recheck.ticket && s.recheck.status !== "Loading");
    const second = await runtime.runPromise(Effect.flatMap(Conversation, (machine) => machine.get()));
    expect([world.ask.turns.size, world.ask.said, second.check]).toEqual([0, ["Take your time", "Take your time"], "LookLater"]);
  });

  // spec/app/assistant/context.md, "Story: Let my agent see the Telegram or Slack chat I have open"; spec/app/assistant/context.md, "A turn carries bounded Telegram or Slack context only while that app is in front, authenticated, non-sensitive, allowed by Settings' privacy share, and taken by the peer"
  it("Carries bounded Telegram or Slack context only when authenticated, non-sensitive and allowed, and stages drafts for explicit Send (spec/app/assistant/context.md, \"Story: Let my agent see the Telegram or Slack chat I have open\")", async () => {
    const world = { ...scene(), phone };
    const { alpha } = await open(world, mounts);
    const runtime = assistant.runtime(alpha);
    const bridge = alpha.runtime.runSync(MessagingBridge);
    await until(alpha, runtime, Conversation, (s) => s.ready);
    await until(alpha, runtime, Composer, (s) => s.binding.owner > 0 && s.slot === "Open");
    await until(alpha, alpha.runtime, Prefs.Machine, (s) => s.document.read.status === "Loaded");

    await drawn(() => alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.send({ type: "openView", view: "Telegram" }))));
    await drawn(() => alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.send({ type: "raise", detent: "Sheet" }))));
    await drawn(() => {
      bridge.publishContext("Telegram", {
        platform: "telegram",
        authenticated: false,
        sensitive: true,
        pane: "auth",
        accountLabel: "",
        recentMessages: [],
      });
    });
    await until(alpha, runtime, Conversation, (s) => s.context.sensitive && s.context.showing.tag === "App");
    const sheetHeader = () => document.querySelector("[data-alpha-chat-header]");
    expect([sheetHeader()?.textContent, sheetHeader()?.querySelector("[aria-label='Private screen']") !== null]).toEqual(["Telegram", true]);
    write("read my code");
    expect(button("Send")?.disabled).toBe(true);

    await drawn(() => {
      bridge.publishContext("Telegram", {
        platform: "telegram",
        authenticated: true,
        sensitive: false,
        pane: "conversation",
        accountLabel: "@owner",
        conversation: { id: "chat-1", title: "Alex", kind: "direct", muted: false, unreadCount: 1 },
        recentMessages: [{ id: "m1", sender: "Alex", at: 1000, text: "See you at 5", isOwn: false }],
      });
    });
    await until(alpha, runtime, Conversation, (s) => !s.context.sensitive && s.context.selected);
    await vi.waitFor(() => expect(sheetHeader()?.textContent).toBe(""));
    world.ask.metadata = [];
    write("Summarize this chat");
    await vi.waitFor(() => expect(button("Send")?.disabled).toBe(false));
    await press("Send");
    await until(alpha, runtime, Conversation, (s) => s.turn.reply === "Complete");
    expect(world.ask.metadata?.at(-1)).toMatchObject({
      observation: { view: "telegram", sensitive: false },
      messagingContext: { platform: "telegram", accountLabel: "@owner", conversation: { id: "chat-1", title: "Alex" } },
    });

    await drawn(() => alpha.runtime.runPromise(Effect.flatMap(Prefs.Machine, (prefs) => prefs.send({ type: "setShare", share: "TelegramContext", on: false, at: 0 }, "Owner"))));
    await until(alpha, alpha.runtime, Prefs.Machine, (s) => !Prefs.allows(s, "TelegramContext"));
    await until(alpha, runtime, Conversation, (s) => !s.context.selected);
    await until(alpha, runtime, Composer, (s) => s.slot === "Open" && s.away === "Free");
    write("Any update?");
    await vi.waitFor(() => expect(button("Send")?.disabled).toBe(false));
    await press("Send");
    await until(alpha, runtime, Conversation, (s) => s.turn.send.id === 2 && s.turn.reply === "Complete");
    expect(world.ask.metadata?.at(-1)).toMatchObject({ observation: { view: "telegram", sensitive: true } });
    expect((world.ask.metadata?.at(-1) as Record<string, unknown> | undefined)?.messagingContext).toBeUndefined();

    const sentBodies: string[] = [];
    bridge.registerHandler("Slack", {
      sendDraft: (draft) => Effect.sync(() => {
        sentBodies.push(draft.body);
        return { status: "sent" as const };
      }),
      openTarget: () => Effect.void,
    });
    await drawn(() => {
      bridge.stageDraft({
        id: "d1",
        platform: "Slack",
        target: "Acme · #design",
        targetId: "C1",
        workspaceId: "T1",
        body: "Joining in 5",
        revision: 1,
        status: "draft",
      });
    });
    expect(sentBodies).toEqual([]);
    const cardSend = [...document.querySelectorAll<HTMLButtonElement>("section[aria-label='Ask Alpha'] [role=log] button")]
      .find((btn) => btn.textContent === "Send");
    expect(cardSend).toBeDefined();
    await drawn(() => { cardSend?.click(); });
    expect(sentBodies).toEqual(["Joining in 5"]);
  });

  // spec/app/assistant/index.md, "A sensitive screen is never sent, and no reply is awaited over one"
  it("marks screen context sensitive on a sensitive screen and hides pagination on a fresh 2-message chat", async () => {
    const world = { ...scene(), phone };
    const { alpha, runtime } = await openAssistant(world);
    const bridge = alpha.runtime.runSync(MessagingBridge);
    write("Hello");
    await press("Send");
    await until(alpha, runtime, Conversation, (s) => s.turn.reply === "Complete");
    expect(lines()).toEqual(["Hello", "You said: Hello"]);
    expect([button("Earlier"), button("Later")]).toEqual([undefined, undefined]);

    await drawn(() => alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.send({ type: "openView", view: "Slack" }))));
    await drawn(() => bridge.publishContext("Slack", { platform: "slack", authenticated: false, sensitive: true, pane: "auth", accountLabel: "", recentMessages: [] }));
    await until(alpha, runtime, Conversation, (s) => s.context.sensitive);
    await hardware("home");
    await until(alpha, runtime, Conversation, (s) => !s.context.sensitive);
  });
});

describe("Ask Alpha edge flows", () => {
  const openKeptChat = async (world: ReturnType<typeof scene>, title: string) => {
    world.ask.kept.set("c1", { roomId: "r1", title, messages: [] });
    const opened = await openAssistant(world);
    await chatsList(opened.alpha);
    await until(opened.alpha, opened.runtime, Chats, (s) => s.list.status === "Loaded");
    await restore(title);
    return opened;
  };

  // spec/app/assistant/composer.md, "A message that may already have been sent is checked by itself, and what the read found settles it"
  it("A message that may already have been sent is checked by itself: LookLater without a turn receipt, and an unrecorded unsettled draft restored into the editor and slot", async () => {
    const world = { ...scene(), phone: true };
    const key = draftKey(world.notes.ownerIdentity, world.notes.owner, "c1", "r1");
    world.ask.drafts.set(key, JSON.stringify({ revision: 1, text: "Unsent important draft", sending: true }));
    const { alpha, runtime } = await openKeptChat(world, "Ask Alpha");
    await until(alpha, runtime, Composer, (s) => s.binding.conversation === 1 && s.slot === "Open" && s.unsettled);

    await until(alpha, runtime, Conversation, (s) => s.recheck.ticket > 0 && s.recheck.status !== "Loading" && s.check === "LookLater");
    expect(byTheField()).toEqual([]);
    await drawn(() => runtime.runPromise(Effect.flatMap(Conversation, (machine) => Effect.gen(function* () {
      const checked = yield* machine.send({ type: "checkForReply" });
      yield* machine.send({ type: "reconcile", ticket: checked.state.recheck.ticket, found: "Unrecorded" });
    }))));
    await until(alpha, runtime, Composer, (s) => !s.unsettled && s.editor.text && s.draft.sync === "Kept");
    expect(composerText()).toBe("Unsent important draft");
    expect(JSON.parse(world.ask.drafts.get(key) ?? "{}")).toMatchObject({ text: "Unsent important draft", sending: false });
  });

  // spec/app/assistant/chats.md, "Story: Start a conversation, or fork one"; spec/app/assistant/composer.md, "Story: Send what I wrote"
  it("a failed first-send conversation creation does not auto-send when opening another chat", async () => {
    const world = { ...scene(), phone: false };
    world.ask.kept.set("c1", { roomId: "r1", title: "Earlier chat", messages: [] });
    const { alpha, runtime } = await openAssistant(world);
    await until(alpha, runtime, Composer, (s) => s.binding.conversation === 0 && s.slot === "Open");

    world.ask.down = true;
    write("First attempt");
    await until(alpha, runtime, Composer, (s) => s.editor.text && s.draft.sync === "Kept");
    await press("Send");
    await until(alpha, runtime, Chats, (s) => s.make.id > 0 && s.make.outcome !== "Sent");

    write("");
    await until(alpha, runtime, Composer, (s) => !s.editor.text && s.draft.sync === "Kept");
    world.ask.down = false;
    await chatsList(alpha);
    await until(alpha, runtime, Chats, (s) => s.list.status === "Loaded");
    await restore("Earlier chat");
    await until(alpha, runtime, Composer, (s) => s.binding.conversation === 1 && s.slot === "Open");

    write("Draft only");
    await until(alpha, runtime, Composer, (s) => s.editor.text && s.draft.sync === "Kept");
    for (let turn = 0; turn < 20; turn += 1) await drawn(() => alpha.runtime.runPromise(Effect.yieldNow));
    const box = document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Message Alpha']");
    expect([world.ask.said, box?.value]).toEqual([[], "Draft only"]);
  });

  // spec/app/assistant/search.md, "Only the newest asking's hits are shown, a page at a time, after those already shown"
  it("closing search discards in-flight search hits instead of writing them to the board", async () => {
    const world = { ...scene(), phone: false };
    world.ask.kept.set("c1", { roomId: "r1", title: "Notes", messages: [{ id: "m1", role: "user", text: "secret phrase" }] });
    const { alpha, runtime } = await openAssistant(world);

    await runtime.runPromise(Effect.flatMap(Search, (m) => Effect.all([
      m.send({ type: "openSearch" }),
      m.send({ type: "find", words: "secret" }),
      m.send({ type: "closeSearch" }),
    ])));
    for (let turn = 0; turn < 40; turn += 1) await drawn(() => alpha.runtime.runPromise(Effect.yieldNow));
    expect(runtime.runSync(Talk).board.snapshot().hits).toEqual([]);
  });

  // spec/app/assistant/index.md, "Back closes a review, then search, then a quote or an edit, one at a time; with none of them open Back is the shell's"; spec/app/shell/layers.md, "A screen says when it has a step of its own to take Back, and when it has none left; its page stays usable"
  it("Ask Alpha offers a Back step to Layers while an email question review is open", async () => {
    const world = { ...scene(), phone: false };
    const { alpha, runtime } = await openAssistant(world);
    const mail = runtime.runSync(MailQuestions);
    const review = {
      accountId: "g1", messageId: "msg-1", revision: "1", from: "Ada", to: ["Me"], subject: "Hello", bodyText: "Body",
      destination: { kind: "assistant" as const },
    };
    await drawn(() => mail.show({
      question: {
        review: review as never,
        current: () => Effect.succeed({ source: review, destination: review.destination } as never),
      },
    }));
    for (let turn = 0; turn < 40; turn += 1) await drawn(() => alpha.runtime.runPromise(Effect.yieldNow));
    const offered = await alpha.runtime.runPromise(Effect.flatMap(Layers, (m) => m.get()));
    expect(offered.steps.includes("assistant")).toBe(true);
    await drawn(() => alpha.back());
    for (let turn = 0; turn < 40; turn += 1) await drawn(() => alpha.runtime.runPromise(Effect.yieldNow));
    const after = await alpha.runtime.runPromise(Effect.flatMap(Layers, (m) => m.get()));
    expect([mail.snapshot().question, after.steps.includes("assistant")]).toEqual([undefined, false]);
  });

  // spec/app/assistant/composer.md, "Files chosen are added up to the upload limit of four"
  it("Attach media opens with remaining file room when three files and an email are attached", async () => {
    const world = { ...scene(), phone: false };
    const { alpha, runtime } = await openKeptChat(world, "Ask Alpha");
    await until(alpha, runtime, Composer, (s) => s.binding.conversation === 1 && s.slot === "Open");

    await runtime.runPromise(Effect.flatMap(Composer, (m) => Effect.all([
      m.send({ type: "attach", count: 3 }),
      m.send({ type: "offer", kind: "Mail", revision: 1 }),
    ])));
    await drawn(() => undefined);
    chatAction("Attach media");
    for (let turn = 0; turn < 40; turn += 1) await drawn(() => alpha.runtime.runPromise(Effect.yieldNow));
    const picker = await runtime.runPromise(Effect.flatMap(Attachments, (m) => m.get()));
    expect([picker.open, picker.room]).toEqual([true, 1]);
  });
});

// spec/app/assistant/context.md, "Story: Let my agent know where I am when I allow it"
it("Let my agent know where I am indoors: a turn with no position looks it up on the network (spec/app/assistant/context.md, \"Story: Let my agent know where I am when I allow it\")", async () => {
  const world = { ...scene(), phone: true };
  world.maps.here = undefined;
  world.maps.network = { latitude: 43.7311, longitude: 7.4222, accuracy: 900 };
  const { alpha, runtime } = await openAssistant(world);
  world.ask.metadata = [];
  // spec/app/assistant/context.md, "The network is looked up only when GPS has nothing current, and its answer is reused before it is asked again": the first turn has no position, so it goes without one and starts one lookup behind it, which the network answers.
  write("Where am I?");
  await press("Send");
  await until(alpha, runtime, Conversation, (s) => s.turn.send.id === 1 && s.turn.reply === "Complete");
  await until(alpha, runtime, Locator, (s) => s.networkAt >= 0 && s.gpsAt < 0 && s.network.status === "Loaded");
  expect(world.ask.metadata.map((one) => (one as { observation?: { location?: unknown } }).observation?.location)).toEqual([undefined]);
});

// spec/app/assistant/composer.md, "Story: Keep what I am writing"
it("Keep what I was writing in the earlier Alpha: an unused slot takes its draft once, and a text it was sending waits for review (spec/app/assistant/composer.md, \"A draft the earlier Alpha kept for the conversation is taken once into an unused slot, and one it was sending comes back for review\")", async () => {
  const { createHash } = await import("node:crypto");
  const binding = JSON.stringify(["https://device.alpha.invalid", "agent-owner", "agent-owner", null]);
  const slot = `assistant-draft:v1:${createHash("sha256").update(binding).digest("hex")}`;
  const kept = (text: string, sending: boolean) => JSON.stringify(sending ? { version: 1, binding, revision: "r1", text, sending: true } : { version: 1, binding, revision: "r1", text });

  const world = { ...scene(), phone: true };
  world.platform.earlier.set(slot, kept("Half a thought", false));
  const first = await open(world, mounts);
  let runtime = assistant.runtime(first.alpha);
  await until(first.alpha, runtime, Composer, (s) => s.slot === "Open" && s.editor.text);
  expect([composerText(), world.platform.earlier.has(slot)]).toEqual(["Half a thought", false]);
  expect(JSON.parse(world.ask.drafts.get(draftKey(world.notes.ownerIdentity, world.notes.owner)) ?? "{}")).toMatchObject({ text: "Half a thought", sending: false });
  await first.close();

  world.platform.earlier.set(slot, kept("Something else", false));
  const second = await open(world, mounts);
  runtime = assistant.runtime(second.alpha);
  await until(second.alpha, runtime, Composer, (s) => s.slot === "Open" && s.editor.text);
  expect([composerText(), world.platform.earlier.has(slot)]).toEqual(["Half a thought", true]);
  await second.close();

  world.ask.drafts.clear();
  world.platform.earlier.set(slot, kept("Book the table", true));
  const third = await open(world, mounts);
  runtime = assistant.runtime(third.alpha);
  await until(third.alpha, runtime, Composer, (s) => s.slot === "Open" && s.unsettled);
  await until(third.alpha, runtime, Conversation, (s) => s.ready);
  expect([world.ask.said, world.platform.earlier.has(slot)]).toEqual([[], false]);
});

describe('Keep what I am writing, settled without a word by the field (spec/app/assistant/composer.md, "Story: Keep what I am writing")', () => {
  const newChat = (world: ReturnType<typeof scene>) => draftKey(world.notes.ownerIdentity, world.notes.owner);
  const dinner = (world: ReturnType<typeof scene>) => draftKey(world.notes.ownerIdentity, world.notes.owner, "c1", "r1");
  const kept = (world: ReturnType<typeof scene>, key = newChat(world)) => JSON.parse(world.ask.drafts.get(key) ?? "{}") as { revision?: number; text?: string; sending?: boolean };
  const sheet = (alpha: Alpha) => alpha.runtime.runPromise(Effect.flatMap(Shell, (machine) => machine.send({ type: "raise", detent: "Sheet" })));
  const detent = (alpha: Alpha) => alpha.runtime.runSync(Effect.flatMap(Shell, (machine) => machine.get())).assistant;
  const storageDown = (world: ReturnType<typeof scene>) => { world.ask.beforeDraftExchange = () => Promise.reject(new Error("storage is full")); };
  const storageUp = (world: ReturnType<typeof scene>) => { delete world.ask.beforeDraftExchange; };
  /** Storage works again and the owner presses the card's Try again, until the draft is kept. */
  const triedAgain = async (world: ReturnType<typeof scene>, alpha: Alpha, runtime: ReturnType<typeof assistant.runtime>) => {
    storageUp(world);
    await drawn(() => (inConversation("Try again") as HTMLButtonElement).click());
    await until(alpha, runtime, Composer, (s) => !s.failing && s.draft.sync === "Kept");
  };
  /** Let time pass half a second at a time, up to `most` milliseconds, until `check` holds of what the owner sees. */
  const waitOut = async (alpha: Alpha, most: number, check: () => boolean) => {
    for (let waited = 0; waited < most && !check(); waited += 500) await later(alpha, 500);
    expect(check()).toBe(true);
  };
  const machine = (runtime: ReturnType<typeof assistant.runtime>) => runtime.runSync(Effect.flatMap(Composer, (composer) => composer.get()));
  /** Whether the conversation's button `name` is drawn where the owner can see it, not in the conversation the bar hides. */
  const inSight = (name: string) => inConversation(name)?.closest("[hidden]") === null;
  const card = () => ["Your saved draft is damaged", "This may already have been sent", "Alpha cannot keep your draft", "Alpha cannot open your draft"]
    .filter((title) => document.querySelector("section[aria-label='Ask Alpha'] [role=log]")?.textContent?.includes(title));
  /** Open the kept conversation "Dinner" and send `text` in it while the agent never answers, then stop Alpha mid-send. */
  const diesMidSend = async (world: ReturnType<typeof scene>, text: string) => {
    world.ask.kept.set("c1", { roomId: "r1", title: "Dinner", messages: [] });
    const first = await openAssistant(world);
    await chatsList(first.alpha);
    await until(first.alpha, first.runtime, Chats, (s) => s.list.status === "Loaded");
    await restore("Dinner");
    await until(first.alpha, first.runtime, Composer, (s) => s.binding.conversation > 0 && s.slot === "Open");
    write(text);
    await until(first.alpha, first.runtime, Composer, (s) => s.draft.sync === "Kept" && s.editor.text);
    await press("Send");
    await until(first.alpha, first.runtime, Composer, (s) => s.away === "Asked");
    await drawn(() => vi.waitFor(() => expect([...world.ask.said, ...world.ask.unheard]).toEqual([text])));
    expect(kept(world, dinner(world))).toMatchObject({ text, sending: true });
    await first.close();
  };
  /** Write "Mine" until it is kept, then let another Alpha save `saved` over it as revision 5 before "Mine too" is written. */
  const savedMeanwhile = async (world: ReturnType<typeof scene>, saved: { text: string; sending: boolean }) => {
    const opened = await openAssistant(world);
    write("Mine");
    await until(opened.alpha, opened.runtime, Composer, (s) => s.draft.sync === "Kept" && s.editor.text);
    world.ask.drafts.set(newChat(world), JSON.stringify({ revision: 5, ...saved }));
    write("Mine too");
    return opened;
  };
  /** Open Alpha again after `diesMidSend`, on the conversation it was sending in, once its slot is open. */
  const reopened = async (world: ReturnType<typeof scene>) => {
    const again = await open(world, mounts);
    const runtime = assistant.runtime(again.alpha);
    await until(again.alpha, runtime, Conversation, (s) => s.ready);
    await until(again.alpha, runtime, Composer, (s) => s.binding.conversation > 0 && s.slot === "Open");
    return { alpha: again.alpha, runtime, close: again.close };
  };

  // spec/app/assistant/composer.md, "Retry writes the draft again after storage failed"; spec/app/assistant/composer.md, "Story: Keep what I am writing"
  it("A save that failed is tried again by itself, at the next edit and after a wait, and only storage that stays broken is told in the conversation, raised to be seen", async () => {
    const world = { ...scene(), phone: true };
    const { alpha, runtime } = await openAssistant(world);
    storageDown(world);
    write("Lunch at noon");
    await until(alpha, runtime, Composer, (s) => s.failing);
    expect([byTheField(), button("Retry"), inConversation("Try again")]).toEqual([[], undefined, undefined]);

    storageUp(world);
    write("Lunch at noon!");
    await until(alpha, runtime, Composer, (s) => !s.failing && s.draft.sync === "Kept");
    expect(kept(world).text).toBe("Lunch at noon!");

    storageDown(world);
    write("Lunch at one");
    await until(alpha, runtime, Composer, (s) => s.failing);
    storageUp(world);
    await waitOut(alpha, 1500, () => kept(world).text === "Lunch at one");

    storageDown(world);
    write("Lunch at two");
    await until(alpha, runtime, Composer, (s) => s.failing);
    await waitOut(alpha, 40000, () => inConversation("Try again") !== undefined);
    expect([byTheField(), composerText(), kept(world).text, detent(alpha)]).toEqual([[], "Lunch at two", "Lunch at one", "Sheet"]);

    await triedAgain(world, alpha, runtime);
    await drawn(() => vi.waitFor(() => expect(inConversation("Try again")).toBeUndefined()));
    expect([kept(world).text, world.ask.said]).toEqual(["Lunch at two", []]);
  });

  // spec/app/assistant/composer.md, "Story: Keep what I am writing"; spec/app/assistant/composer.md, "Retry writes the draft again after storage failed"; spec/app/assistant/dock.md, "A touch of the bar or of Type while the conversation holds a card about the draft opens the sheet, where the card shows"
  it("A card that comes due while Ask Alpha cannot be seen rises once it can, never over Messages, and never again by itself once seen; a touch of the bar or of Type opens it again", async () => {
    const world = { ...scene(), phone: true, image: true };
    const { alpha, runtime } = await openAssistant(world);
    const shell = (event: ShellEvent) => drawn(() => alpha.runtime.runPromise(Effect.flatMap(Shell, (machine) => machine.send(event))));
    const where = () => { const at = alpha.runtime.runSync(Effect.flatMap(Shell, (machine) => machine.get())); return [at.trail.at(-1) ?? "Home", at.assistant]; };
    const due = () => runtime.runSync(Talk).board.snapshot().mending;
    await shell({ type: "raise", detent: "Typing" });
    storageDown(world);
    write("Lunch at two");
    await until(alpha, runtime, Composer, (s) => s.failing);
    await shell({ type: "goBack" });
    await shell({ type: "openView", view: "Messages" });
    await waitOut(alpha, 40000, () => due() === "Unkept");
    expect([where(), inConversation("Try again"), world.ask.said]).toEqual([["Messages", "Bar"], undefined, []]);

    await shell({ type: "raise", detent: "Sheet" });
    await later(alpha, 500);
    expect([where(), inConversation("Try again")]).toEqual([["Messages", "Sheet"], undefined]);

    await shell({ type: "goHome" });
    await drawn(() => vi.waitFor(() => expect(inConversation("Try again")).toBeDefined()));
    expect([where(), byTheField(), composerText()]).toEqual([["Home", "Sheet"], [], "Lunch at two"]);

    await shell({ type: "goBack" });
    await shell({ type: "openView", view: "Messages" });
    await shell({ type: "goHome" });
    await later(alpha, 500);
    expect([where(), inSight("Try again"), due()]).toEqual([["Home", "Bar"], false, "Unkept"]);
    touchField();
    await drawn(() => vi.waitFor(() => expect(inSight("Try again")).toBe(true)));
    expect([where(), composerText(), byTheField()]).toEqual([["Home", "Sheet"], "Lunch at two", []]);

    await shell({ type: "goBack" });
    await shell({ type: "openView", view: "Calendar" });
    await press("Type");
    await drawn(() => vi.waitFor(() => expect(inSight("Try again")).toBe(true)));
    expect([where(), composerText()]).toEqual([["Calendar", "Sheet"], "Lunch at two"]);

    await shell({ type: "raise", detent: "Full" });
    await triedAgain(world, alpha, runtime);
    expect([kept(world).text, world.ask.said, where()]).toEqual(["Lunch at two", [], ["Calendar", "Full"]]);

    await shell({ type: "goHome" });
    touchField();
    await later(alpha, 500);
    expect([where(), inConversation("Try again"), button("Send")?.hasAttribute("disabled")]).toEqual([["Home", "Typing"], undefined, false]);
  });

  // spec/app/assistant/composer.md, "The slot is opened when the composer is shown, and opened again after it could not be read"
  it("A slot that could not be read is opened again by itself, when Alpha comes back to the front and after a wait, and one that stays unreadable is told in the conversation", async () => {
    const world = { ...scene(), phone: true };
    world.ask.drafts.set(newChat(world), JSON.stringify({ revision: 1, text: "Kept for later", sending: false }));
    world.ask.draftReadsFail = true;
    const first = await open(world, mounts);
    let runtime = assistant.runtime(first.alpha);
    await until(first.alpha, runtime, Composer, (s) => s.slot === "Unreadable");
    expect([byTheField(), button("Try again")]).toEqual([[], undefined]);
    world.ask.draftReadsFail = false;
    await seen(false);
    await seen(true);
    await until(first.alpha, runtime, Composer, (s) => s.slot === "Open" && s.editor.text);
    expect(composerText()).toBe("Kept for later");
    await first.close();

    world.ask.draftReadsFail = true;
    const second = await open(world, mounts);
    runtime = assistant.runtime(second.alpha);
    await until(second.alpha, runtime, Composer, (s) => s.slot === "Unreadable");
    world.ask.draftReadsFail = false;
    await waitOut(second.alpha, 1500, () => composerText() === "Kept for later");
    await second.close();

    world.ask.draftReadsFail = true;
    const third = await open(world, mounts);
    runtime = assistant.runtime(third.alpha);
    await until(third.alpha, runtime, Composer, (s) => s.slot === "Unreadable");
    await waitOut(third.alpha, 40000, () => inConversation("Try again") !== undefined);
    expect([byTheField(), detent(third.alpha)]).toEqual([[], "Sheet"]);
    world.ask.draftReadsFail = false;
    await drawn(() => (inConversation("Try again") as HTMLButtonElement).click());
    await until(third.alpha, runtime, Composer, (s) => s.slot === "Open" && s.editor.text);
    expect([composerText(), inConversation("Try again")]).toEqual(["Kept for later", undefined]);
  });

  // spec/app/assistant/composer.md, "The slot's answer fills the empty editor with the saved draft, or reports it damaged or unreadable"; spec/app/assistant/composer.md, "A damaged slot is recovered on the owner's word"; spec/app/assistant/composer.md, "Story: Keep what I am writing"
  it("A damaged slot gives back the text it still holds, and one with none waits in the conversation, raised to be seen, for the owner to keep a copy or discard it", async () => {
    const world = { ...scene(), phone: true };
    world.ask.drafts.set(newChat(world), '{"revision":"one","text":"Half a thought","sending":false}');
    const first = await openAssistant(world);
    await until(first.alpha, first.runtime, Composer, (s) => s.slot === "Open" && s.editor.text && !s.unsettled);
    expect([composerText(), kept(world), byTheField()]).toEqual(["Half a thought", { revision: 1, text: "Half a thought", sending: false }, []]);
    await first.close();

    world.ask.drafts.set(newChat(world), '{"revision":1,"sending":false,"text":"Call the va');
    const cut = await openAssistant(world);
    await until(cut.alpha, cut.runtime, Composer, (s) => s.slot === "Open" && s.editor.text && !s.unsettled);
    expect([composerText(), kept(world)]).toEqual(["Call the va", { revision: 1, text: "Call the va", sending: false }]);
    await cut.close();

    world.ask.drafts.set(newChat(world), '{"revision":1,"text":"Book the ta');
    const second = await openAssistant(world);
    await until(second.alpha, second.runtime, Composer, (s) => s.slot === "Open" && s.unsettled);
    expect([composerText(), kept(world), world.ask.said]).toEqual(["", { revision: 1, text: "Book the ta", sending: true }, []]);
    await second.close();

    world.ask.drafts.set(newChat(world), "not a draft");
    const third = await open(world, mounts);
    const runtime = assistant.runtime(third.alpha);
    await until(third.alpha, runtime, Composer, (s) => s.slot === "Damaged");
    await drawn(() => vi.waitFor(() => expect(inConversation("Discard")).toBeDefined()));
    expect([byTheField(), button("Recover"), inConversation("Keep a copy"), world.ask.drafts.get(newChat(world)), detent(third.alpha)]).toEqual([[], undefined, undefined, "not a draft", "Sheet"]);
    await drawn(() => third.alpha.runtime.runPromise(Effect.flatMap(Shell, (machine) => machine.send({ type: "goBack" }))));
    expect([detent(third.alpha), inSight("Discard")]).toEqual(["Bar", false]);
    await press("Open conversation");
    await drawn(() => vi.waitFor(() => expect(inSight("Discard")).toBe(true)));
    expect(detent(third.alpha)).toBe("Sheet");
    await drawn(() => (inConversation("Discard") as HTMLButtonElement).click());
    await until(third.alpha, runtime, Composer, (s) => s.slot === "Open");
    expect([world.ask.drafts.has(newChat(world)), inConversation("Discard")]).toEqual([false, undefined]);
  });

  // spec/app/assistant/composer.md, "A damaged slot is recovered on the owner's word"
  it("Keep a copy sets a damaged slot's bytes aside beside it before the slot is reset", async () => {
    const world = { ...scene(), phone: false };
    const probe = await openAssistant(world);
    write("Where is the slot");
    await until(probe.alpha, probe.runtime, Composer, (s) => s.draft.sync === "Kept" && s.editor.text);
    const slot = Object.keys(localStorage).find((key) => key.startsWith("alpha/assistant/slot-v2/") && localStorage.getItem(key)?.includes("Where is the slot"));
    if (slot === undefined) throw new Error("no slot in the browser's store");
    await probe.close();

    localStorage.setItem(slot, "not a draft");
    localStorage.setItem(`${slot}.unreadable`, "an older copy");
    const { alpha } = await open(world, mounts);
    const runtime = assistant.runtime(alpha);
    await until(alpha, runtime, Composer, (s) => s.slot === "Damaged");
    await drawn(() => vi.waitFor(() => expect(inConversation("Keep a copy")).toBeDefined()));
    await drawn(() => (inConversation("Keep a copy") as HTMLButtonElement).click());
    await until(alpha, runtime, Composer, (s) => s.slot === "Open");
    expect([localStorage.getItem(slot), localStorage.getItem(`${slot}.unreadable`), localStorage.getItem(`${slot}.unreadable.2`), byTheField()]).toEqual([null, "an older copy", "not a draft", []]);
  });

  // spec/app/assistant/composer.md, "A conflict keeps the saved copy and the current text together, and saves them"
  it("A copy saved elsewhere meanwhile is kept with my text in the field, and both are saved, even where one holds the other's words", async () => {
    const world = { ...scene(), phone: true };
    const { alpha, runtime } = await savedMeanwhile(world, { text: "From the other window", sending: false });
    await until(alpha, runtime, Composer, (s) => s.draft.sync === "Kept" && s.draft.base === 6);
    expect([composerText(), kept(world), byTheField(), button("Restore saved")]).toEqual(["From the other window\nMine too", { revision: 6, text: "From the other window\nMine too", sending: false }, [], undefined]);

    world.ask.drafts.set(newChat(world), JSON.stringify({ revision: 9, text: "ok", sending: false }));
    write("book it");
    await until(alpha, runtime, Composer, (s) => s.draft.sync === "Kept" && s.draft.base === 10);
    expect([composerText(), kept(world).text]).toEqual(["ok\nbook it", "ok\nbook it"]);

    world.ask.drafts.set(newChat(world), JSON.stringify({ revision: 12, text: "a".repeat(40000), sending: false }));
    write("b".repeat(30000));
    await until(alpha, runtime, Composer, (s) => s.draft.sync === "Kept" && s.draft.base >= 13);
    expect([composerText()?.length, kept(world).text?.length, machine(runtime).long, button("Send")?.hasAttribute("disabled") ?? true]).toEqual([70001, 70001, true, true]);
  });

  // spec/app/assistant/composer.md, "A write that lands clears any sending mark, and one that finds another revision stops until both texts are kept or the message it marks is checked"; spec/app/assistant/composer.md, "A message that may already have been sent is checked by itself, and what the read found settles it"
  it("A message another Alpha marked as sending in the same slot is held for review, never put in my field, and settled once that Alpha writes over its mark", async () => {
    const world = { ...scene(), phone: true };
    const { alpha, runtime } = await savedMeanwhile(world, { text: "Book the table", sending: true });
    await until(alpha, runtime, Composer, (s) => s.unsettled);
    expect([composerText(), kept(world), byTheField()]).toEqual(["Mine too", { revision: 5, text: "Book the table", sending: true }, []]);

    world.ask.drafts.set(newChat(world), JSON.stringify({ revision: 6, text: "", sending: false }));
    await waitOut(alpha, 2000, () => !machine(runtime).unsettled && machine(runtime).draft.sync === "Kept");
    expect([composerText(), kept(world), world.ask.said]).toEqual(["Mine too", { revision: 7, text: "Mine too", sending: false }, []]);
  });

  // spec/app/assistant/composer.md, "A write that lands clears any sending mark, and one that finds another revision stops until both texts are kept or the message it marks is checked"; spec/app/assistant/composer.md, "A message written before its conversation existed moves into the new one, then its old slot is cleared on the exact revision read"
  it("A message sent from a new chat into a conversation whose slot another Alpha marked as sending is held for review with that message, and neither is sent", async () => {
    const world = { ...scene(), phone: true };
    const mark = { revision: 5, text: "Book the table", sending: true };
    world.ask.drafts.set(dinner(world), JSON.stringify(mark));
    const { alpha, runtime } = await openAssistant(world);
    write("Hello");
    await until(alpha, runtime, Composer, (s) => s.draft.sync === "Kept" && s.editor.text);
    await press("Send");
    await until(alpha, runtime, Composer, (s) => s.binding.conversation > 0 && s.draft.sync !== "Saving");
    await later(alpha, 500);
    expect([machine(runtime).unsettled, composerText(), kept(world, dinner(world)), kept(world).text, world.ask.said])
      .toEqual([true, "Hello", mark, "Hello", []]);

    // spec/app/assistant/composer.md, "A send holds the message: the composer clears, and the slot is marked as sending before anything is asked": the Send that made the conversation is spent once its message comes under review, so putting it back sends nothing until the owner taps Send
    await waitOut(alpha, 40000, () => inConversation("Put back in the field") !== undefined);
    await drawn(() => (inConversation("Put back in the field") as HTMLButtonElement).click());
    await until(alpha, runtime, Composer, (s) => !s.unsettled && s.draft.sync === "Kept" && s.editor.text);
    await later(alpha, 500);
    const putBack = composerText();
    expect([putBack?.endsWith("Hello"), world.ask.said]).toEqual([true, []]);
    await press("Send");
    await drawn(() => vi.waitFor(() => expect(world.ask.said).toEqual([putBack])));
  });

  // spec/app/assistant/composer.md, "A send holds the message: the composer clears, and the slot is marked as sending before anything is asked"; spec/app/assistant/composer.md, "Story: Send what I wrote"
  it("A message of non-Latin text near the length limit is marked within what the phone's slot takes, and sent once", async () => {
    const world = { ...scene(), phone: true };
    const { alpha, runtime } = await openAssistant(world);
    const long = "書".repeat(60000);
    write(long);
    await until(alpha, runtime, Composer, (s) => s.draft.sync === "Kept" && s.editor.text && !s.long);
    await press("Send");
    await drawn(() => vi.waitFor(() => expect(world.ask.said.map((said) => said === long)).toEqual([true])));
    expect(composerText()).toBe("");
  });

  // spec/app/assistant/composer.md, "A send holds the message: the composer clears, and the slot is marked as sending before anything is asked"; spec/app/assistant/composer.md, "Story: Send what I wrote"
  it("A new chat's message cannot be sent while another Alpha's mark in its slot is under review, and once put back goes only on the owner's Send", async () => {
    const world = { ...scene(), phone: true };
    const { alpha, runtime } = await savedMeanwhile(world, { text: "Book the table", sending: true });
    await until(alpha, runtime, Composer, (s) => s.unsettled);
    await waitOut(alpha, 40000, () => inConversation("Put back in the field") !== undefined);
    expect([composerText(), button("Send")?.disabled ?? true, world.ask.said]).toEqual(["Mine too", true, []]);
    await drawn(() => (inConversation("Put back in the field") as HTMLButtonElement).click());
    await until(alpha, runtime, Composer, (s) => !s.unsettled && s.draft.sync === "Kept" && s.editor.text);
    await later(alpha, 500);
    expect([composerText(), world.ask.said]).toEqual(["Book the table\nMine too", []]);
    await press("Send");
    await drawn(() => vi.waitFor(() => expect(world.ask.said).toEqual(["Book the table\nMine too"])));
  });

  // spec/app/assistant/composer.md, "A message that may already have been sent is checked by itself, and what the read found settles it"; spec/app/assistant/composer.md, "Story: Send what I wrote"
  it("A restart after the message reached the agent settles by itself with nothing shown: it is never sent again, and the next message goes once", async () => {
    const world = { ...scene(), phone: true };
    world.ask.holdPosts = "unanswered";
    await diesMidSend(world, "Book the table");
    expect(world.ask.said).toEqual(["Book the table"]);

    delete world.ask.holdPosts;
    const { alpha, runtime } = await reopened(world);
    await until(alpha, runtime, Composer, (s) => !s.unsettled && s.draft.sync === "Kept");
    expect([composerText(), kept(world, dinner(world)).sending, byTheField(), card(), detent(alpha), world.ask.said]).toEqual(["", false, [], [], "Bar", ["Book the table"]]);

    await sheet(alpha);
    write("for four");
    await press("Send");
    await drawn(() => vi.waitFor(() => expect(world.ask.said).toEqual(["Book the table", "for four"])));
  });

  // spec/app/assistant/composer.md, "A message that may already have been sent is checked by itself, and what the read found settles it"; spec/app/assistant/composer.md, "Story: Send what I wrote"
  it("A restart without the send key in history holds the message until the owner puts it back in the field", async () => {
    const world = { ...scene(), phone: true };
    world.ask.holdPosts = "unheard";
    await diesMidSend(world, "Book the table");
    expect(world.ask.said).toEqual([]);

    delete world.ask.holdPosts;
    const { alpha, runtime } = await reopened(world);
    await waitOut(alpha, 40000, () => inConversation("Put back in the field") !== undefined);
    expect([composerText(), kept(world, dinner(world)).sending, card(), world.ask.said]).toEqual(["", true, ["This may already have been sent"], []]);

    await drawn(() => (inConversation("Put back in the field") as HTMLButtonElement).click());
    await until(alpha, runtime, Composer, (s) => !s.unsettled && s.draft.sync === "Kept");
    expect([composerText(), kept(world, dinner(world)).sending, card()]).toEqual(["Book the table", false, []]);
    await press("Send");
    await drawn(() => vi.waitFor(() => expect(world.ask.said).toEqual(["Book the table"])));
  });

  // spec/app/assistant/composer.md, "A message that may already have been sent is checked by itself, and what the read found settles it"; spec/app/assistant/composer.md, "Story: Send what I wrote"
  it("A message whose arrival cannot be told waits in the conversation, raised to be seen, for the owner to say it was sent or to put it back, never sent again by itself", async () => {
    const world = { ...scene(), phone: true };
    world.ask.holdPosts = "unanswered";
    await diesMidSend(world, "Book the table");

    delete world.ask.holdPosts;
    world.ask.pagesDown = true;
    const first = await reopened(world);
    await until(first.alpha, first.runtime, Composer, (s) => s.unsettled);
    await until(first.alpha, first.runtime, Conversation, (s) => s.recheck.ticket > 0 && s.recheck.status !== "Loading");
    expect([inConversation("It was sent"), composerText(), byTheField(), button("Check for reply"), world.ask.said]).toEqual([undefined, "", [], undefined, ["Book the table"]]);
    await waitOut(first.alpha, 40000, () => inConversation("It was sent") !== undefined);
    expect([card(), composerText(), byTheField(), button("Send"), button("Check for reply"), detent(first.alpha), world.ask.said])
      .toEqual([["This may already have been sent"], "", [], undefined, undefined, "Sheet", ["Book the table"]]);

    write("for four");
    await drawn(() => (inConversation("It was sent") as HTMLButtonElement).click());
    await until(first.alpha, first.runtime, Composer, (s) => !s.unsettled && s.draft.sync === "Kept" && s.editor.text);
    expect([composerText(), kept(world, dinner(world)).text, kept(world, dinner(world)).sending, card(), world.ask.said]).toEqual(["for four", "for four", false, [], ["Book the table"]]);
    await first.close();

    world.ask.drafts.set(dinner(world), JSON.stringify({ revision: 9, text: "Book the table", sending: true }));
    const second = await reopened(world);
    await until(second.alpha, second.runtime, Composer, (s) => s.unsettled);
    await waitOut(second.alpha, 40000, () => inConversation("Put back in the field") !== undefined);
    write("for four");
    await drawn(() => (inConversation("Put back in the field") as HTMLButtonElement).click());
    await until(second.alpha, second.runtime, Composer, (s) => !s.unsettled && s.draft.sync === "Kept" && s.editor.text);
    const { text, sending } = kept(world, dinner(world));
    expect([composerText(), { text, sending }, card(), world.ask.said]).toEqual(["Book the table\nfor four", { text: "Book the table\nfor four", sending: false }, [], ["Book the table"]]);
  });
});
