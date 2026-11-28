// @vitest-environment happy-dom
import { NOT_DISPATCHED } from "@elizaos/agent";
import { MMS_MAX_BODY } from "@elizaos/os-bridges";
import { type Context, Effect, type ManagedRuntime, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Machine as Conversation } from "../gen/app__assistant.effect.vibe";
import { Machine as Shell } from "../gen/app__shell.effect.vibe";
import { Machine as Messages } from "../gen/app__messages.effect.vibe";
import { Machine as Composer } from "../gen/app__messages__composer.effect.vibe";
import { Machine as Phone } from "../gen/app__phone.effect.vibe";
import { Machine as Toasts } from "../gen/app__notices__toasts.effect.vibe";
import { Machine as Voice } from "../gen/app__voice.effect.vibe";
import { Machine as Tabs } from "../gen/app__browser.effect.vibe";
import { Machine as Page } from "../gen/app__browser__address.effect.vibe";
import { Machine as Home } from "../gen/app__home.effect.vibe";
import assistant from "../src/assistant/index.tsx";
import { executeMedia } from "../src/assistant/media-executors.ts";
import { readAgentSms } from "../src/messages/agent-send.vibe";
import { answerReading } from "../src/contacts/reads.vibe";
import { Drafts } from "../src/messages/composer.vibe";
import { idOf, Pages } from "../src/browser/browser.vibe";
import browser from "../src/browser/index.tsx";
import home from "../src/home/index.tsx";
import messages from "../src/messages/index.tsx";
import { displayNumber } from "../src/phone/words.ts";
import { button, closeAll, drawn, fill, hardware, input, later, only, open, press, shownWords, underAct, until } from "./alpha.tsx";
import { alphaImage as image } from "./fakes/scene.ts";
import { textReview } from "./fakes/text-review.ts";

underAct();
afterEach(closeAll);

const mounts = only("home", "assistant", "notice", "view:Messages", "view:Browser");
const openImage = (world: ReturnType<typeof image>) => open(world, mounts);

/** Poll real machine readiness without leaving React inside act after a failure. */
async function ready<I, S>(runtime: ManagedRuntime.ManagedRuntime<I, unknown>, key: Context.Key<I, { readonly changes: Stream.Stream<S> }>, label: string, accepted: (state: S) => boolean) {
  await vi.waitFor(async () => {
    const current = await runtime.runPromise(Effect.flatMap(key, (machine) => Stream.runHead(machine.changes)));
    if (current._tag === "None" || !accepted(current.value)) throw new Error(`${label}: ${JSON.stringify(current)}`);
  }, { timeout: 12_000, interval: 50 });
  await drawn(() => undefined);
}

async function readyImageWithIdlePhone(world: ReturnType<typeof image>) {
  const { alpha } = await openImage(world);
  await ready(alpha.runtime, Shell, "Alpha image admitted", (state) => state.image);
  await ready(alpha.runtime, Phone, "Known call state", (state) => state.telecom === "NoCall");
  return alpha;
}

async function openTextReview(world: ReturnType<typeof image>, review: ReturnType<typeof textReview>) {
  world.telephony.textReview = review;
  const { alpha } = await openImage(world);
  return { alpha, runtime: assistant.runtime(alpha) };
}

/** Open Ask Alpha over Home with `review` waiting on the phone, and send `text`, which the agent answers by proposing it: once the phone has read the proposal (`read`). */
async function proposeText(world: ReturnType<typeof image>, review: ReturnType<typeof textReview>, text: string, read: string) {
  const { alpha, runtime } = await openTextReview(world, review);
  await ready(alpha.runtime, Shell, "Alpha image admitted", (state) => state.image);
  await openHomeConversation(alpha, runtime);

  world.ask.nextReplyChunks = ["Review this request on your phone before it can run."];
  world.ask.nextActions = () => [{ action: "PROPOSE_DEVICE_ACTION", data: { proposalId: review.proposal.id, state: "pending", executed: false, approvalRequired: true, awaitingUserInput: true } }];
  await fill("Message Alpha", text);
  await vi.waitFor(() => expect(button("Send")?.disabled).toBe(false));
  await press("Send");
  await ready(runtime, Conversation, read, (state) => review.pendingReads >= 1 && state.turn.reply === "Complete");
  return { alpha, runtime };
}

async function exactSmsConfirmation(
  review: ReturnType<typeof textReview>,
  sms: Pick<ReturnType<typeof textReview>["confirmations"][number], "recipients" | "body" | "subscriptionId">,
) {
  await vi.waitFor(() => expect(review.confirmations).toHaveLength(1));
  const confirmation = review.confirmations[0];
  expect(confirmation).toMatchObject({ operationId: review.proposal.id, recipients: sms.recipients, body: sms.body, subscriptionId: sms.subscriptionId });
  return confirmation;
}

async function openHomeConversation(alpha: Awaited<ReturnType<typeof openImage>>["alpha"], runtime: ReturnType<typeof assistant.runtime>) {
  await ready(runtime, Conversation, "Ask Alpha ready on Home", (state) => state.ready && state.context.showing.tag === "Home");
  await vi.waitFor(() => expect(button("Open conversation")).toBeDefined());
  await press("Open conversation");
  await ready(alpha.runtime, Shell, "Ask Alpha open", (state) => state.assistant === "Sheet");
}

async function openMessages(alpha: Awaited<ReturnType<typeof openImage>>["alpha"]) {
  await ready(alpha.runtime, Shell, "Alpha image admitted", (state) => state.image);
  await ready(home.runtime(alpha), Home, "Home tiles read", (state) => state.tiles.load.status === "Loaded");
  const tile = await vi.waitFor(() => {
    const found = document.querySelector<HTMLButtonElement>('[data-home-tile="view:Messages"]');
    if (!found) throw new Error("Messages tile was not drawn");
    return found;
  });
  await drawn(() => tile.click());
}

/** Open Maya's conversation from the Messages list, with its composer empty. */
async function openMaya(alpha: Awaited<ReturnType<typeof openImage>>["alpha"]) {
  await openMessages(alpha);
  await ready(alpha.runtime, Messages, "Messages list loaded", (state) => state.list.status === "Loaded" && state.threads === 1);
  await press("Maya Chen");
  await ready(alpha.runtime, Composer, "Composer ready", (state) => state.thread > 0 && state.slot.author === "Nobody");
}

/** Dictate one clip into the open conversation's bar and wait for the recorder to close. */
async function dictateToMaya(alpha: Awaited<ReturnType<typeof openImage>>["alpha"]) {
  const messageView = messages.runtime(alpha);
  await press("Dictate a text to Maya");
  await ready(messageView, Voice, "Messages recording", (state) => state.recorder.field === "MessagesBar" && state.recorder.stage === "Recording");
  await press("Stop recording");
  await ready(messageView, Voice, "Messages transcript returned", (state) => state.recorder.stage === "Closed");
}

/** Wait until Maya's message field reads `text`. */
async function mayaReads(text: string) {
  await vi.waitFor(async () => {
    await drawn(() => undefined);
    expect(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Text Maya"]')?.value).toBe(text);
  }, { timeout: 12_000 });
}

const toastsIssued = async (alpha: Awaited<ReturnType<typeof openImage>>["alpha"]) =>
  (await alpha.runtime.runPromise(Effect.flatMap(Toasts, (toasts) => toasts.get()))).issued;

async function openUnreadCard() {
  const card = await vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLButtonElement>("section[aria-label='Your day'] > button")].find((button) => button.getAttribute("aria-label")?.startsWith("Open Messages"));
    if (!found) throw new Error("Messages unread card was not drawn");
    return found;
  });
  await drawn(() => card.click());
}

/** Press `name` in the open confirmation. */
const confirm = (name: string) => drawn(() => {
  const found = [...document.querySelectorAll("[role=alertdialog] button")].find((one) => one.textContent === name);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`no ${name} in the confirmation`);
  found.click();
});

/** Open the message action menu from the keyboard. */
const bubble = (text: string) => drawn(() => {
  const found = [...document.querySelectorAll("[role=log] [data-alpha-message-id]")].find((one) => one.textContent?.includes(text));
  if (!(found instanceof HTMLElement)) throw new Error(`no message ${text}`);
  found.focus();
  found.dispatchEvent(new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true }));
});

/** Choose an action from the open conversation's composer menu. */
async function composeAction(name: string) {
  await drawn(() => {
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Message attachments"]');
    if (!trigger) throw new Error("Message attachments are unavailable");
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await drawn(() => {
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((one) => one.textContent === name);
    if (!item) throw new Error(`Message action ${name} was not shown`);
    item.click();
  });
}

describe("Messages on an Alpha image", () => {
  it('Requires a new choice when a SIM is replaced and keeps that choice when rows reorder (spec/app/messages/composer.md, "Story: Send a message")', async () => {
    const world = image();
    const first = world.telephony.subscriptions[0];
    const second = { id: 2, slot: 1, displayName: "Travel", carrierName: "Travel", defaultSms: false, defaultVoice: false };
    world.telephony.subscriptions = [first, second];
    const { alpha } = await openImage(world);
    await openMessages(alpha);
    await ready(alpha.runtime, Messages, "Messages read", (state) => state.list.status === "Loaded" && state.threads === 1);
    await press("Maya Chen");
    await ready(alpha.runtime, Composer, "Two SIMs loaded", (state) => state.thread > 0 && state.sims === 2 && state.simInfo.grant === "Granted");
    await fill("Text Maya", "Use the reviewed line");
    await ready(alpha.runtime, Composer, "The message draft is saved", (state) => state.slot.author === "OwnerWrote" && state.slot.draft.sync === "Kept");
    const chooseTravel = async () => {
      await press("Travel");
      await vi.waitFor(async () => {
        await drawn(() => undefined);
        expect(button("Travel")?.getAttribute("aria-pressed")).toBe("true");
        expect(button("Send")?.disabled).toBe(false);
      }, { timeout: 12_000, interval: 50 });
    };
    await chooseTravel();

    const replacement = { ...second, id: 9 };
    world.telephony.subscriptions = [replacement, first];
    await press("Send");
    await ready(alpha.runtime, Composer, "Old SIM refused", (state) => state.outgoing.denied && state.slot.author === "OwnerWrote");
    expect(world.telephony.sent).toEqual([]);

    await chooseTravel();
    world.telephony.subscriptions = [first, replacement];
    await press("Send");
    await ready(alpha.runtime, Composer, "Replacement SIM sent", (state) => state.outgoing.op.outcome === "Confirmed");
    expect(world.telephony.sent).toHaveLength(1);
    expect(world.telephony.journal.get(world.telephony.sent[0].operationId)).toMatchObject({ subscriptionId: 9, status: "sent" });
  });

  it("See my conversations, read one, and send a message once (spec/app/messages/index.md, \"Story: See my conversations\"; spec/app/messages/composer.md, \"Story: Let Alpha suggest a draft\"; spec/app/messages/index.md, \"Story: Read a conversation\"; spec/app/messages/composer.md, \"Story: Send a message\"; spec/app/messages/sending.md, \"Story: Send a message once\"; spec/app/messages/sending.md, \"Story: Know whether it arrived\")", async () => {
    const world = image();
    world.telephony.live = [];
    const { alpha } = await open(world, [...mounts, ...only("view:Phone")]);
    // spec/app/messages/index.md, "Messages reads the conversation list each time it comes to the front"
    await openMessages(alpha);
    await ready(alpha.runtime, Messages, "Messages state", (s) => s.list.status === "Loaded" && s.threads === 1);
    const listHeading = document.querySelector("[data-alpha-messages-header] h1");
    // spec/app/messages/index.md, "Story: See my conversations"
    expect([listHeading?.textContent, listHeading?.classList.contains("sr-only")]).toEqual(["Messages", false]);

    // spec/app/messages/index.md, "Only the newest read of the open conversation is shown, and it marks the shown messages read only where Alpha is the phone's SMS app"
    await press("Maya Chen");
    await ready(alpha.runtime, Messages, "Messages state", (s) => s.pane === "Conversation" && s.page.status === "Loaded" && s.shown.rows === 1);
    await ready(alpha.runtime, Messages, "Messages state", () => world.telephony.texts[0].read);

    // spec/app/messages/index.md, "Copy puts a message's text on the clipboard, Call opens Phone with the number, and a message Alpha cannot show opens in the messaging app; none changes anything here"
    const actions = () => document.querySelector('[data-alpha-sms-actions]');
    await bubble("See you at five");
    await press("Copy");
    await vi.waitFor(async () => {
      await drawn(() => undefined);
      expect(button("Copied!")).toBeDefined();
    }, { timeout: 12_000, interval: 50 });
    expect([actions()?.querySelector('[role="status"]')?.textContent, world.settings.copied]).toEqual(["Copied.", ["See you at five"]]);
    await later(alpha, 1_400);
    expect(button("Copy")).toBeDefined();
    world.settings.refusesCopy = true;
    await press("Copy");
    await vi.waitFor(async () => {
      await drawn(() => undefined);
      expect(actions()?.querySelector('[role="status"]')?.textContent).toBe("Copy failed");
    }, { timeout: 12_000, interval: 50 });
    expect([Boolean(button("Copy")), world.settings.copied]).toEqual([true, ["See you at five"]]);
    await drawn(() => actions()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(actions()).toBeNull();

    // spec/app/messages/composer.md, "Typing changes the draft and makes it the owner's; emptying it leaves no draft"
    await ready(alpha.runtime, Composer, "Composer state", (s) => s.thread > 0 && s.recipients === 1);

    // spec/app/messages/composer.md, "Alpha's suggestion is asked for only when the draft is empty, and lands only if it still is"; spec/app/messages/composer.md, "Undo takes Alpha's draft away"
    await composeAction("Let Alpha suggest a reply");
    await ready(alpha.runtime, Composer, "Composer state", (s) => s.slot.author === "AlphaWrote" && s.suggestion.status === "Loaded");
    expect([world.telephony.asked, (document.querySelector("textarea[aria-label='Text Maya']") as HTMLTextAreaElement).value, world.telephony.sent]).toEqual([
      [{ participant: "+14155550100", messages: [{ direction: "in", date: 1_700_000_050_000, body: "See you at five" }], truncated: false }], "Five works, see you there", [],
    ]);
    expect(document.querySelector("[role=group][aria-label='Message draft to Maya Chen · +14155550100']")).not.toBeNull();
    await press("Don’t send");
    await ready(alpha.runtime, Composer, "Composer state", (s) => s.slot.author === "Nobody");
    await fill("Text Maya", "On my way");
    await ready(alpha.runtime, Composer, "Composer state", (s) => s.slot.author === "OwnerWrote");
    expect(world.telephony.sent).toEqual([]);

    // spec/app/phone/comms.md, "Story: Address the person or Alpha from one bar"
    expect(document.querySelectorAll("[data-alpha-composer]")).toHaveLength(1);
    await press("Open Alpha");
    await ready(alpha.runtime, Shell, "Ask Alpha sheet", (s) => s.assistant === "Sheet");
    await vi.waitFor(async () => {
      await drawn(() => undefined);
      expect([...document.querySelectorAll("[data-alpha-composer]")].map((field) => field.getAttribute("aria-label"))).toEqual(["Ask Alpha"]);
    }, { timeout: 12_000 });
    await fill("Ask Alpha", "What did I miss?");

    // spec/app/messages/index.md, "Returning from Phone restores the conversation the Ask Alpha stage held"
    await ready(alpha.runtime, Composer, "The message draft is saved", (state) => state.slot.author === "OwnerWrote" && state.slot.draft.sync === "Kept");
    const beforePhone = alpha.runtime.runSync(Messages.use((machine) => machine.get()));
    await press("Call Maya Chen");
    await ready(alpha.runtime, Shell, "Phone on the same Ask Alpha sheet", (state) => state.trail.at(-1) === "Phone" && state.assistant === "Sheet");
    await ready(alpha.runtime, Phone, "Maya's number on the keypad", (state) => state.front && state.tab === "Keypad" && state.digits === "+14155550100".length);
    await vi.waitFor(async () => {
      await drawn(() => undefined);
      expect(document.querySelector<HTMLInputElement>("[data-alpha-phone-number]")?.value).toBe("+14155550100");
    }, { timeout: 12_000 });
    expect([world.telephony.dialed, world.telephony.placed, world.telephony.sent]).toEqual([[], [], []]);
    await hardware("back");
    await ready(alpha.runtime, Shell, "Messages again on the same Ask Alpha sheet", (state) => state.trail.at(-1) === "Messages" && state.assistant === "Sheet");
    await ready(alpha.runtime, Messages, "The exact conversation was read again", (state) => state.thread === beforePhone.thread && state.page.ticket > beforePhone.page.ticket && state.page.status === "Loaded");
    await ready(alpha.runtime, Composer, "The exact conversation's draft was restored", (state) => state.thread === beforePhone.thread && state.slot.author === "OwnerWrote" && state.slot.draft.sync === "Kept");
    expect(document.querySelector("[role='log'][aria-label='Messages']")?.textContent).toContain("See you at five");

    await press("Back to texting Maya Chen");
    await ready(alpha.runtime, Shell, "Alpha image admitted", (s) => s.assistant === "Bar");
    expect([document.querySelectorAll("[data-alpha-composer]").length, document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Text Maya"]')?.value, world.telephony.sent])
      .toEqual([1, "On my way", []]);

    // spec/app/voice/index.md, "Using the transcript fills the field dictation started in, and dictation never sends"
    const openedChats = world.ask.opened;
    await dictateToMaya(alpha);
    const dictated = "On my way Dictated note";
    await vi.waitFor(async () => {
      await drawn(() => undefined);
      expect(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Text Maya"]')?.value).toBe(dictated);
    }, { timeout: 12_000 });
    expect([document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Text Maya"]')?.value, world.telephony.sent, world.ask.opened, world.ask.said, world.voice.startLiveCaptureCalls])
      .toEqual([dictated, [], openedChats, [], 0]);

    // spec/app/voice/index.md, "Using the transcript fills the field dictation started in, and dictation never sends": a transcript past the longest text goes into the draft whole, as v119 did, with no words
    const full = "x".repeat(MMS_MAX_BODY - 4);
    await fill("Text Maya", full);
    await ready(alpha.runtime, Composer, "A draft at the length limit is saved", (state) => state.slot.author === "OwnerWrote" && state.slot.draft.sync === "Kept");
    const beforeLong = await toastsIssued(alpha);
    const savedAtLimit = (await alpha.runtime.runPromise(Effect.flatMap(Composer, (machine) => machine.get()))).slot.draft.edits;
    await dictateToMaya(alpha);
    const long = `${full} Dictated note`;
    await vi.waitFor(async () => {
      await drawn(() => undefined);
      expect(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Text Maya"]')?.value).toBe(long);
    }, { timeout: 12_000 });
    await ready(alpha.runtime, Composer, "The long dictated draft is saved", (state) => state.slot.draft.edits > savedAtLimit && state.slot.draft.sync === "Kept");
    // spec/app/messages/composer.md, "Only the owner's Send sends: a draft or a picture, with send access, a SIM where there is a choice, and never during a call that may be an emergency call": Send waits until the owner shortens it
    expect([await toastsIssued(alpha) - beforeLong, button("Send")?.disabled ?? true, world.telephony.sent]).toEqual([0, true, []]);
    await fill("Text Maya", dictated);
    await ready(alpha.runtime, Composer, "The dictated draft is saved again", (state) => state.slot.author === "OwnerWrote" && state.slot.draft.sync === "Kept");

    // spec/app/messages/composer.md, "Only the owner's Send sends: a draft or a picture, with send access, a SIM where there is a choice, and never during a call that may be an emergency call"
    await press("Send");
    await ready(alpha.runtime, Composer, "Composer state", (s) => s.outgoing.op.outcome === "Confirmed" && s.slot.author === "Nobody");
    expect(world.telephony.sent.map(({ recipients, body }) => ({ recipients, body }))).toEqual([{ recipients: ["+14155550100"], body: dictated }]);
    expect([...document.querySelectorAll("[role=status]")].map((one) => one.textContent)).toContain("Sent to Maya Chen");

    // spec/app/messages/sending.md, "A delivery report counts only for a part reported sent"; spec/app/messages/sending.md, "A finished record is retired by a tombstone"
    world.telephony.deliver(world.telephony.sent[0].operationId);
    await ready(alpha.runtime, Composer, "Composer state", (s) => s.outgoing.reported === 1 && s.outgoing.retired === s.outgoing.op.id);

    // spec/app/messages/index.md, "Confirming removes the message under a new number, never during a call that may be an emergency call"
    world.telephony.holdMessageDeletion = true;
    await bubble("See you at five");
    await press("Delete");
    await ready(alpha.runtime, Messages, "Messages state", (s) => s.confirming);
    await confirm("Delete");
    await ready(alpha.runtime, Toasts, "Undo toast", (state) => state.showing && state.current.undo);
    await press("Undo");
    await ready(alpha.runtime, Messages, "Messages state", (s) => s.removal.outcome === "Refused" && s.page.status === "Loaded");
    expect(world.telephony.texts.map((one) => one.body)).toEqual(["See you at five", dictated]);

    world.telephony.holdMessageDeletion = false;
    await bubble("See you at five");
    await press("Delete");
    await ready(alpha.runtime, Messages, "Messages state", (s) => s.confirming);
    await confirm("Delete");
    await ready(alpha.runtime, Messages, "Messages state", (s) => s.removal.outcome === "Confirmed");
    expect(world.telephony.texts.map((one) => one.body)).toEqual([dictated]);

    // spec/app/messages/index.md, "Back returns from a conversation or the picker to the list, and reads it again"
    const read = (await alpha.runtime.runPromise(Messages.use((machine) => machine.get()))).list.ticket;
    await hardware("back");
    await ready(alpha.runtime, Messages, "Messages state", (s) => s.pane === "Threads" && s.list.ticket > read && s.list.status === "Loaded");
  });

  it("See my conversations from Home's unread card (spec/app/messages/index.md, \"Story: See my conversations\")", async () => {
    const world = image();
    world.telephony.texts.push({ id: 2, thread: 2, address: "+14155550122", box: "inbox", date: 1_700_000_060_000, body: "Lunch?", read: false });
    const { alpha } = await openImage(world);
    await ready(alpha.runtime, Shell, "Alpha image admitted", (s) => s.image);

    // spec/app/messages/index.md, "The phone reports how many conversations are unread, for the list and Home"; spec/app/messages/index.md, "One tap on Home's unread card opens the conversation when exactly one is unread, and the list filtered to the unread ones when several are"
    await ready(alpha.runtime, Messages, "Messages state", (s) => s.unread === 2);
    await openUnreadCard();
    await ready(alpha.runtime, Messages, "Messages state", (s) => s.front && s.pane === "Threads" && s.chip === "UnreadThreads" && s.list.status === "Loaded" && s.threads === 2);

    // spec/app/messages/index.md, "Only the newest read of the open conversation is shown, and it marks the shown messages read only where Alpha is the phone's SMS app"
    await press("Ben Ortiz");
    await ready(alpha.runtime, Messages, "Messages state", (s) => s.pane === "Conversation" && s.page.status === "Loaded");
    await ready(alpha.runtime, Messages, "Messages state", () => world.telephony.texts[1].read);
    await hardware("home");
    await ready(alpha.runtime, Messages, "Messages state", (s) => s.unread === 1);
    await openUnreadCard();
    await ready(alpha.runtime, Messages, "Messages state", (s) => s.front && s.pane === "Conversation" && s.page.status === "Loaded" && s.shown.rows === 1);
    await ready(alpha.runtime, Messages, "Messages state", () => world.telephony.texts[0].read);

    const title = () => document.querySelector("[data-alpha-messages-title]")?.textContent;
    expect(title()).toBe("Maya Chen");
    const ticket = alpha.runtime.runSync(Messages.use((machine) => machine.get())).page.ticket;
    world.telephony.contacts = false;
    await drawn(() => world.telephony.changed());
    await ready(alpha.runtime, Messages, "Open conversation read after Contacts access ended", (state) => state.page.ticket > ticket && state.page.status === "Loaded");
    expect(title()).toBe(displayNumber("+14155550100"));
  });

  it("Start a new message to a number I type (spec/app/messages/index.md, \"Story: Start a new message\")", async () => {
    const world = image();
    const { alpha, close } = await openImage(world);
    await openMessages(alpha);
    await ready(alpha.runtime, Messages, "Messages state", (s) => s.list.status === "Loaded");

    // spec/app/messages/index.md, "New message reads the contacts that have a number and brings back the owner's unsent New draft"
    await press("New message");
    await ready(alpha.runtime, Messages, "New draft", (s) => s.pane === "New" && s.picker.status === "Loaded" && s.choices === 2);
    const body = "Meet at five";
    const message = () => document.querySelector<HTMLTextAreaElement>("[data-alpha-messages-composer] textarea");
    await vi.waitFor(() => expect(message()?.getAttribute("aria-label")).toBe("Message"));
    await fill("Message", body);
    await vi.waitFor(() => expect(button("Send")?.disabled).toBe(true));
    expect(world.telephony.sent).toEqual([]);

    // spec/app/messages/index.md, "The owner can write before choosing To, then adjust To without moving or losing the message"
    await press("Ben Ortiz");
    await ready(alpha.runtime, Messages, "Ben addressed in New", (s) => s.pane === "New" && s.newDraft.recipient > 0);
    expect(message()?.value).toBe(body);
    await vi.waitFor(() => expect(message()?.getAttribute("aria-label")).toBe("Text Ben"), { timeout: 12_000 });
    await press("Choose contacts");
    await ready(alpha.runtime, Messages, "Recipient picker open", (s) => s.newDraft.picking);
    await press("Dictate a text to Ben");
    await ready(messages.runtime(alpha), Voice, "New message recording", (s) => s.recorder.field === "MessagesBar" && s.recorder.stage === "Recording");
    // spec/app/voice/index.md, "Using the transcript fills the field dictation started in, and dictation never sends": the bar's recorder shows no words
    await drawn(() => undefined);
    expect(shownWords(document.querySelector("[data-alpha-bar-recorder]"))).toBe("");
    await press("Stop recording");
    await ready(messages.runtime(alpha), Voice, "New message transcript returned", (s) => s.recorder.stage === "Closed");
    const dictated = `${body} Dictated note`;
    await vi.waitFor(async () => {
      await drawn(() => undefined);
      expect(message()?.value).toBe(dictated);
    }, { timeout: 12_000 });
    expect(world.telephony.sent).toEqual([]);
    await press("Back");
    await ready(alpha.runtime, Messages, "Only the recipient picker closed", (s) => s.pane === "New" && !s.newDraft.picking);
    expect(message()?.value).toBe(dictated);

    await press("Back");
    await ready(alpha.runtime, Messages, "Messages state", (s) => s.pane === "Threads" && s.list.status === "Loaded");
    await press("New message");
    await ready(alpha.runtime, Messages, "New draft restored", (s) => s.pane === "New" && s.picker.status === "Loaded" && s.newDraft.recipient > 0);
    expect(message()?.value).toBe(dictated);
    await fill("To", "+14155550100, +14155550122");
    await vi.waitFor(() => expect(message()?.getAttribute("aria-label")).toBe("Text Maya Chen, Ben Ortiz"), { timeout: 12_000 });
    await vi.waitFor(() => expect(button("Send")?.disabled).toBe(false));
    expect(world.telephony.sent).toEqual([]);
    await press("Send");
    await ready(alpha.runtime, Composer, "Composer state", (s) => s.outgoing.op.outcome === "Confirmed");
    await ready(alpha.runtime, Messages, "New draft sent", (s) => s.pane === "Threads" && s.list.status === "Loaded");
    expect(world.telephony.sent.map(({ operationId, recipients, body }) => ({ kind: world.telephony.journal.get(operationId)?.kind, recipients, body }))).toEqual([
      { kind: "mms-send", recipients: ["+14155550100", "+14155550122"], body: dictated },
    ]);
    await press("New message");
    await ready(alpha.runtime, Messages, "A fresh New draft", (s) => s.pane === "New" && s.newDraft.recipient === 0);
    expect(message()?.value).toBe("");

    // spec/app/messages/index.md, "A current Android text request opens New only when its saved draft is empty"
    await press("Back");
    await ready(alpha.runtime, Messages, "Messages list before the Android request", (s) => s.pane === "Threads");
    const sent = [...world.telephony.sent];
    const first = { token: "first-android-text", recipients: ["+14155550122"], body: "Draft from Android" };
    const second = { token: "second-android-text", recipients: ["+14155550100"], body: "A different Android draft" };
    const to = () => document.querySelector<HTMLInputElement>("[data-alpha-messages-recipients]")?.value;
    const bridge = (globalThis as { Capacitor?: { nativePromise(name: string, method: string, input: unknown): Promise<unknown> } }).Capacitor;
    if (!bridge) throw new Error("The phone fixture has no native bridge");
    const nativePromise = bridge.nativePromise.bind(bridge);
    const write = Promise.withResolvers<void>();
    let writing = false;
    const pendingWrite = vi.spyOn(bridge, "nativePromise").mockImplementation((name, method, input) => {
      if (name === "ElizaSecureStore" && method === "compareAndExchange" && typeof input === "object" && input !== null
        && "key" in input && input.key === "sms-draft:v2:new") {
        writing = true;
        return write.promise.then(() => nativePromise(name, method, input));
      }
      return nativePromise(name, method, input);
    });
    const acknowledgment = Promise.withResolvers<void>();
    world.telephony.holdSmsDraftAcknowledgment = acknowledgment.promise;
    try {
      world.telephony.smsDraft = first;
      await drawn(world.telephony.wakeSmsDraft);
      await vi.waitFor(() => expect(writing).toBe(true));
      await ready(alpha.runtime, Messages, "New admitted before Android draft storage", (s) => s.pane === "New" && s.newDraft.recipient === 0);
      expect([to(), message()?.value, world.telephony.smsDraftAcknowledgments]).toEqual(["", "", []]);
      write.resolve();
      pendingWrite.mockRestore();
      await vi.waitFor(() => expect(world.telephony.smsDraftAcknowledgments).toEqual([first.token]));
      await drawn(() => undefined);
      expect([to(), message()?.value, world.telephony.sent]).toEqual([first.recipients[0], first.body, sent]);
      const imported = await alpha.runtime.runPromise(Effect.flatMap(Messages, (machine) => machine.get()));

      const ownerEdit = "I am editing my own draft";
      const label = message()?.getAttribute("aria-label");
      if (!label) throw new Error("The Android text draft did not show an editor");
      await fill(label, ownerEdit);
      await ready(alpha.runtime, Messages, "Owner edit in Android draft is saved", (s) => s.pane === "New" && s.newDraft.revision > imported.newDraft.revision);
      const saved = world.secrets.get("sms-draft:v2:new");
      expect(saved).toBeDefined();
      await close();
      expect(world.telephony.smsDraft).toEqual(first);
      const restarted = await openImage(world);
      await vi.waitFor(() => expect(world.telephony.smsDraftAcknowledgments).toEqual([first.token, first.token]));
      await ready(restarted.alpha.runtime, Messages, "Messages list after Android draft restart", (s) => s.front && s.pane === "Threads");
      expect(world.secrets.get("sms-draft:v2:new")).toBe(saved);
      await press("New message");
      await ready(restarted.alpha.runtime, Messages, "Owner-edited Android draft restored", (s) => s.pane === "New" && s.newDraft.revision > imported.newDraft.revision);
      expect([to(), message()?.value]).toEqual([first.recipients[0], ownerEdit]);

      world.telephony.smsDraft = second;
      await drawn(world.telephony.wakeSmsDraft);
      acknowledgment.resolve();
      const secondReads = () => world.telephony.smsDraftReads.filter((token) => token === second.token).length;
      await vi.waitFor(() => expect(secondReads()).toBeGreaterThan(0));
      const reads = secondReads();
      await drawn(world.telephony.wakeSmsDraft);
      await vi.waitFor(() => expect(secondReads()).toBeGreaterThan(reads));
      await drawn(() => undefined);
      expect([to(), message()?.value, world.telephony.sent]).toEqual([first.recipients[0], ownerEdit, sent]);
      expect([world.telephony.smsDraft, world.telephony.smsDraftAcknowledgments]).toEqual([second, [first.token, first.token]]);
    } finally {
      write.resolve();
      pendingWrite.mockRestore();
      acknowledgment.resolve();
    }
  });

  it.each(["unused", "owner-touched"] as const)('Keeps the right New message when Android replaces a request and the opening is %s (spec/app/messages/index.md, "A current Android text request opens New only when its saved draft is empty")', async (opening) => {
    const world = image();
    const { alpha } = await openImage(world);
    await openMessages(alpha);
    await ready(alpha.runtime, Messages, "Messages list", (state) => state.front && state.pane === "Threads");
    const first = { token: "android-old", recipients: ["+14155550122"], body: "Older Android request" };
    const second = { token: "android-new", recipients: ["+14155550100"], body: "Current Android request" };
    const ownerBody = "Keep the message I am writing";
    const to = () => document.querySelector<HTMLInputElement>("[data-alpha-messages-recipients]")?.value;
    const message = () => document.querySelector<HTMLTextAreaElement>("[data-alpha-messages-composer] textarea");
    const bridge = (globalThis as { Capacitor?: { nativePromise(name: string, method: string, input: unknown): Promise<unknown> } }).Capacitor;
    if (!bridge) throw new Error("The phone fixture has no native bridge");
    const nativePromise = bridge.nativePromise.bind(bridge);
    const check = Promise.withResolvers<void>();
    let pendingReads = 0;
    const watched = vi.spyOn(bridge, "nativePromise").mockImplementation((name, method, input) => {
      if (name === "ElizaTelephony" && method === "smsDraftPending" && world.telephony.smsDraft === first && ++pendingReads === 3) {
        return check.promise.then(() => nativePromise(name, method, input));
      }
      return nativePromise(name, method, input);
    });
    try {
      world.telephony.smsDraft = first;
      await drawn(world.telephony.wakeSmsDraft);
      await ready(alpha.runtime, Messages, "First empty New visit", (state) => state.pane === "New" && state.newDraft.recipient === 0);
      await vi.waitFor(() => expect(pendingReads).toBe(3));
      expect([to(), message()?.value]).toEqual(["", ""]);
      if (opening === "owner-touched") {
        await drawn(() => message()?.focus());
        await fill("Message", ownerBody);
        expect(message()?.value).toBe(ownerBody);
      }

      world.telephony.smsDraft = second;
      await drawn(world.telephony.wakeSmsDraft);
      check.resolve();
      if (opening === "unused") {
        await vi.waitFor(() => expect(world.telephony.smsDraftAcknowledgments).toEqual([second.token]));
        await drawn(() => undefined);
        expect([to(), message()?.value]).toEqual([second.recipients[0], second.body]);
      } else {
        await vi.waitFor(() => expect(world.telephony.smsDraftReads.filter((token) => token === second.token).length).toBeGreaterThan(1));
        await ready(alpha.runtime, Messages, "Owner kept the same New visit", (state) => state.pane === "New" && state.newDraft.revision > 0);
        expect([to(), message()?.value, document.activeElement]).toEqual(["", ownerBody, message()]);
        expect([world.telephony.smsDraft, world.telephony.smsDraftAcknowledgments]).toEqual([second, []]);
      }
      expect(world.telephony.sent).toEqual([]);
    } finally {
      check.resolve();
      watched.mockRestore();
    }
  });

  it(`Sends New without replacing a saved draft for the same recipient (spec/app/messages/composer.md, "The owner's New message uses the same send and never takes another draft's place")`, async () => {
    const world = image();
    const { alpha } = await openImage(world);
    await openMessages(alpha);
    await ready(alpha.runtime, Messages, "Conversations read", (s) => s.list.status === "Loaded");
    await press("Maya Chen");
    await ready(alpha.runtime, Composer, "Maya composer", (s) => s.thread > 0 && s.slot.author === "Nobody");
    await fill("Text Maya", "Keep this reply draft");
    await ready(alpha.runtime, Composer, "Maya draft kept", (s) => s.slot.author === "OwnerWrote" && s.slot.draft.sync === "Kept");
    await press("Back");
    await ready(alpha.runtime, Messages, "Conversations restored", (s) => s.pane === "Threads" && s.list.status === "Loaded");
    await press("New message");
    await ready(alpha.runtime, Messages, "New draft open", (s) => s.pane === "New" && s.picker.status === "Loaded");
    await fill("Message", "A separate new message");
    await press("Maya Chen");
    await vi.waitFor(() => expect(button("Send")?.disabled).toBe(false));
    await press("Send");
    await ready(alpha.runtime, Messages, "New completed", (s) => s.pane === "Threads" && s.list.status === "Loaded");
    expect(world.telephony.sent).toMatchObject([{ recipients: ["+14155550100"], body: "A separate new message" }]);
    await press("Maya Chen");
    await ready(alpha.runtime, Composer, "Maya draft reopened", (s) => s.thread > 0 && s.slot.author === "OwnerWrote");
    expect(document.querySelector<HTMLTextAreaElement>("[data-alpha-messages-composer] textarea")?.value).toBe("Keep this reply draft");
  });

  // spec/app/messages/index.md, "The phone's answer ends the removal it names, and the conversation is read again unless it was refused"
  it.each([
    { reply: "lost", outcome: "Unknown", staged: true },
    { reply: "refused", outcome: "Refused", staged: false },
  ] as const)("Ends a $reply Android message deletion as $outcome (spec/app/messages/index.md, \"The phone's answer ends the removal it names, and the conversation is read again unless it was refused\")", async ({ reply, outcome, staged }) => {
    const world = image();
    world.telephony.deletionReply = reply;
    world.telephony.holdMessageDeletion = true;
    const { alpha } = await openImage(world);
    await openMessages(alpha);
    await ready(alpha.runtime, Messages, "Conversation list loaded", (state) => state.list.status === "Loaded" && state.threads === 1);
    await press("Maya Chen");
    await ready(alpha.runtime, Messages, "Conversation loaded", (state) => state.pane === "Conversation" && state.page.status === "Loaded");
    await bubble("See you at five");
    await press("Delete");
    await ready(alpha.runtime, Messages, "Message deletion confirmation", (state) => state.confirming);
    await confirm("Delete");
    await ready(alpha.runtime, Messages, "Message deletion ended", (state) => state.removal.outcome === outcome);
    expect(document.body.textContent?.includes("Alpha cannot tell whether the message was deleted")).toBe(outcome === "Unknown");
    expect(button("Undo")).toBeUndefined();
    expect(world.telephony.staged).toMatchObject(staged ? [{ kind: "message", phase: "queued", target: { id: "sms:1" } }] : []);
    expect(world.telephony.deletionAttempts).toEqual(["sms:1"]);
  });

  it('Checks the original picture message after a restart (spec/app/messages/composer.md, "The owner attaches up to five pictures, and removes them one by one"; spec/app/messages/composer.md, "A restart closes the conversation and keeps the saved drafts, the send and its pending clear, access and the SIMs the phone has"; spec/app/messages/sending.md, "The journal read back settles an unknown outcome: sent, or never sent")', async () => {
    const world = image();
    world.telephony.holdMmsSubmission = true;
    const first = await openImage(world);
    await openMessages(first.alpha);
    await ready(first.alpha.runtime, Messages, "conversation list", (state) => state.list.status === "Loaded" && state.threads === 1);
    await press("Maya Chen");
    await ready(first.alpha.runtime, Composer, "picture composer", (state) => state.thread > 0 && state.sending.grant === "Granted");
    await composeAction("Add media");
    await drawn(() => {
      const picker = document.querySelector<HTMLInputElement>('input[type="file"][aria-label="Attach a picture"]');
      if (!picker || picker.disabled) throw new Error("No usable picture picker");
      Object.defineProperty(picker, "files", { value: [new File([Uint8Array.from(atob("R0lGODlhAQABAAAAACwAAAAAAQABAAA="), (byte) => byte.charCodeAt(0))], "photo.gif", { type: "image/gif" })] });
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await ready(first.alpha.runtime, Composer, "picture draft saved", (state) => state.pictures === 1 && state.slot.draft.sync === "Kept");
    await press("Send");
    await ready(first.alpha.runtime, Composer, "picture send awaiting receipt", (state) => state.outgoing.op.outcome === "Unknown");
    const operation = world.telephony.mmsAttempts[0];
    const receipt = operation && world.telephony.journal.get(operation);
    if (!operation || !receipt) throw new Error("Android did not journal the picture message");
    expect([receipt.status, world.telephony.mmsAttempts]).toEqual(["submitted", [operation]]);
    await first.close();

    world.telephony.journal.set(operation, { ...receipt, status: "sent" });
    const restarted = await openImage(world);
    await ready(restarted.alpha.runtime, Shell, "Messages returns after restart", (state) => state.trail.at(-1) === "Messages");
    await ready(restarted.alpha.runtime, Messages, "conversation list after restart", (state) => state.list.status === "Loaded" && state.threads === 1);
    await press("Maya Chen");
    await ready(restarted.alpha.runtime, Composer, "picture restored while waiting for the original receipt", (state) => state.thread === state.outgoing.thread && state.pictures === 1 && state.outgoing.op.outcome === "Unknown");
    expect(button("Remove photo.gif")?.disabled).toBe(true);
    const priorReads = world.telephony.mmsQueries.length;
    await press("Check send status");
    await ready(restarted.alpha.runtime, Composer, "original picture confirmed and saved attachment removed", (state) => state.outgoing.op.outcome === "Confirmed" && state.pictures === 0 && state.pendingClear.id === 0);
    expect(button("Remove photo.gif")).toBeUndefined();
    expect([world.telephony.mmsAttempts, world.telephony.mmsQueries.slice(priorReads), world.telephony.sent.map((send) => send.operationId)])
      .toEqual([[operation], [operation], [operation]]);

    await fill("Text Maya", "The next message");
    await ready(restarted.alpha.runtime, Composer, "next draft saved", (state) => state.slot.author === "OwnerWrote" && state.slot.draft.sync === "Kept");
    await press("Send");
    await ready(restarted.alpha.runtime, Composer, "next message confirmed", (state) =>
      state.outgoing.op.id > 1 && state.outgoing.op.outcome === "Confirmed" && state.pendingClear.id === 0);
    expect(world.telephony.journal.get(operation)?.status).toBe("sent");
    expect(world.telephony.sent.map((send) => send.body)).toEqual(["", "The next message"]);
  });

  it('Shares only the reviewed open conversation (spec/app/contacts/agent.md, "The agent reads only the conversation, voicemail or contact open on screen, as the phone last read it")', async () => {
    const world = image();
    world.telephony.texts.push({ id: 2, thread: 2, address: "+14155550122", box: "inbox", date: 1_700_000_060_000, body: "A different conversation", read: false });
    const { alpha } = await openImage(world);
    await openMessages(alpha);
    await ready(alpha.runtime, Messages, "two conversations available", (state) => state.list.status === "Loaded" && state.threads === 2);
    await press("Maya Chen");
    await ready(alpha.runtime, Messages, "Maya conversation loaded", (state) => state.pane === "Conversation" && state.page.status === "Loaded");
    const original = await alpha.runtime.runPromise(Messages.use((machine) => machine.get()));
    const read = (approved = true) => executeMedia(alpha,
      { type: "messages_read_selected" }, { proposalId: "review-sms", operationId: "review-sms", attemptId: 1 },
      { target: { thread: original.thread, ticket: original.page.ticket }, current: () => Promise.resolve(approved) });
    const refusal = { kind: "refused", code: NOT_DISPATCHED };
    expect(await read(false)).toEqual(refusal);
    expect(await read()).toEqual({ kind: "applied", result: { kind: "messages-read", status: "read", participant: "Maya Chen", messages: [{ direction: "in", date: 1_700_000_050_000, body: "See you at five" }], truncated: false } });

    world.telephony.sms = "denied";
    expect(await read()).toEqual(refusal);
    world.telephony.sms = "granted";
    await press("Back");
    await ready(alpha.runtime, Messages, "conversation list restored", (state) => state.pane === "Threads" && state.list.status === "Loaded");
    await press("Ben Ortiz");
    await ready(alpha.runtime, Messages, "another conversation selected", (state) => state.pane === "Conversation" && state.thread !== original.thread && state.page.status === "Loaded");
    expect([await read(), world.telephony.sent]).toEqual([refusal, []]);
  });

  it(`Drafts in the exact Android thread from a reviewed sender, even when another thread has the same number (spec/app/messages/composer.md, "The agent's draft goes into the open conversation's draft only while it is empty, and never sends")`, async () => {
    const world = image();
    world.telephony.texts.push({ id: 2, thread: 23, address: "+14155550100", box: "inbox", date: 1_700_000_060_000, body: "The reviewed thread", read: true });
    const { alpha } = await openImage(world);
    await openMessages(alpha);
    await ready(alpha.runtime, Messages, "Both same-number threads are listed", (state) => state.pane === "Threads" && state.list.status === "Loaded" && state.threads === 2);
    const body = "I’m replying to the reviewed sender";
    const attempt = (replyThreadId: string) => executeMedia(alpha,
      { type: "sms_compose", target: { kind: "number", number: "+14155550100" }, draft: true, replyThreadId, body },
      { proposalId: "reviewed-sender-draft", operationId: "reviewed-sender-draft", attemptId: 1 }, { current: () => Promise.resolve(true) });

    await expect(attempt("thread:999")).resolves.toEqual({ kind: "refused", code: NOT_DISPATCHED });
    expect(document.querySelector('[data-alpha-messages-thread]')).toBeNull();
    await expect(attempt("thread:23")).resolves.toEqual({ kind: "applied", result: { kind: "sms-compose", status: "drafted" } });
    await ready(alpha.runtime, Composer, "The exact thread has Alpha’s draft", (state) => state.slot.author === "AlphaWrote");
    const lines = [...document.querySelectorAll('[role="log"][aria-label="Messages"] [data-alpha-message-body]')].map((row) => row.textContent);
    expect(lines).toEqual(["The reviewed thread"]);
    expect(document.querySelector('[data-alpha-draft-bubble="alpha"]')?.textContent).toContain(body);
    expect(world.telephony.sent).toEqual([]);
  });

  it('Confirms reviewed agent SMS with the exact native operation (spec/app/contacts/agent.md, "Only the owner approves, only what is shown as it is now, and only when the phone has ruled out an emergency call")', async () => {
    const world = image();
    const alpha = await readyImageWithIdlePhone(world);
    const sms = { type: "sms_send", recipients: ["+14155550100"], body: "Meet at the front door", subscriptionId: 1 } as const;
    const call = { proposalId: "reviewed-sms", operationId: "reviewed-sms", attemptId: 1 };
    const approved = { current: () => Promise.resolve(true) };
    let checks = 0;
    await expect(executeMedia(alpha, sms, call, { current: () => Promise.resolve(++checks === 1) })).resolves.toMatchObject({ kind: "refused" });
    await expect(executeMedia(alpha, { ...sms, subscriptionId: 9 }, call, approved)).resolves.toMatchObject({ kind: "refused" });
    expect(world.telephony.sent).toEqual([]);

    await expect(executeMedia(alpha, sms, call, approved)).resolves.toMatchObject({
      kind: "applied", result: { kind: "sms-send", operationId: call.operationId, subscriptionId: 1 },
    });
    await expect(alpha.runtime.runPromise(readAgentSms({ ...sms, body: "Different text" }, call))).resolves.toBeUndefined();
    await expect(alpha.runtime.runPromise(readAgentSms(sms, call))).resolves.toMatchObject({ kind: "found", result: { operationId: call.operationId } });
    expect(world.telephony.sent.map(({ operationId, recipients, body }) => ({ operationId, recipients, body }))).toEqual([
      { operationId: call.operationId, recipients: [...sms.recipients], body: sms.body },
    ]);
  });

  it('Watches Android’s submitted text for the carrier’s exact receipt (spec/app/contacts/agent.md, "Only the phone answers the action, and the request ends as that answer says")', async () => {
    const world = image();
    world.telephony.holdSmsSubmission = true;
    const alpha = await readyImageWithIdlePhone(world);
    const sms = { type: "sms_send", recipients: ["+14155550100"], body: "Meet at the front door", subscriptionId: 1 } as const;
    const call = { proposalId: "carrier-receipt", operationId: "carrier-receipt", attemptId: 1 };
    const send = executeMedia(alpha, sms, call, { current: () => Promise.resolve(true) });
    const submitted = await vi.waitFor(() => {
      const receipt = world.telephony.journal.get(call.operationId);
      if (receipt?.status !== "submitted") throw new Error("The carrier has not been asked");
      return receipt;
    });
    await expect(alpha.runtime.runPromise(readAgentSms(sms, call))).resolves.toBeUndefined();
    const waitForRead = (count: number) => vi.waitFor(async () => {
      if (world.telephony.smsQueries.length < count) await later(alpha, 100);
      expect(world.telephony.smsQueries).toHaveLength(count);
    }, { timeout: 4_000 });
    await waitForRead(2);
    world.telephony.journal.set(call.operationId, {
      ...submitted, status: "sent", parts: [{ index: 0, recipientIndex: 0, partIndex: 0, sent: "success", delivery: "unknown" }],
    });
    await waitForRead(3);
    await expect(send).resolves.toMatchObject({ kind: "applied", result: { operationId: call.operationId, status: "sent" } });
    expect(world.telephony.smsQueries).toEqual(Array.from({ length: 3 }, () => call.operationId));
    expect(world.telephony.sent.map(({ operationId }) => operationId)).toEqual([call.operationId]);
  });

  it("From Home, asks the owner to review the exact text the agent just proposed (spec/app/contacts/agent.md, \"Only the owner approves, only what is shown as it is now, and only when the phone has ruled out an emergency call\"; spec/app/contacts/agent.md, \"A text's review is two rows, and a tap anywhere on its first row approves the text while a tap on its second declines it\")", async () => {
    const world = image();
    const sms = { type: "sms_send", recipients: ["+14155550100"], body: "Meet at the front door", subscriptionId: 1 } as const;
    const review = textReview(world.notes.owner, "reviewed-text", sms);
    const { alpha, runtime } = await openTextReview(world, review);
    await ready(alpha.runtime, Shell, "Alpha image admitted", (state) => state.image);
    await ready(alpha.runtime, Phone, "Known call state", (state) => state.telecom === "NoCall");
    await openHomeConversation(alpha, runtime);

    const ask = async (proposalId: string, prompt: string) => {
      const reads = review.pendingReads;
      world.ask.nextReplyChunks = ["Review the text on your phone."];
      world.ask.nextActions = () => [{ action: "PROPOSE_DEVICE_ACTION", data: { proposalId, state: "pending", executed: false, approvalRequired: true, awaitingUserInput: true } }];
      await fill("Message Alpha", prompt);
      await vi.waitFor(() => expect(button("Send")?.disabled).toBe(false));
      await press("Send");
      await ready(runtime, Conversation, "Reviewed reply complete", (state) => review.pendingReads > reads && state.turn.reply === "Complete");
    };

    await ask("unrelated-proposal", "Text +14155550100 from SIM 1 saying Meet at the front door");
    expect([button("Send this text"), review.decisions, review.confirmations, world.telephony.sent]).toEqual([undefined, [], [], []]);

    await ask(review.proposal.id, "Use SIM 1 to send +14155550100 the text Meet at the front door");
    await vi.waitFor(() => expect(button("Send this text")).toBeDefined());
    expect(document.body.textContent).toContain(`To: ${displayNumber(sms.recipients[0])}`);
    expect(document.body.textContent).toContain(sms.body);
    // spec/app/contacts/agent.md, "A text's review is two rows, and a tap anywhere on its first row approves the text while a tap on its second declines it"
    const sendRow = button("Send this text")?.parentElement?.textContent ?? "";
    expect([sendRow.startsWith(`Review SMSTo: ${displayNumber(sms.recipients[0])}${sms.body}`), sendRow.endsWith("Send")]).toEqual([true, true]);
    expect(button("Decline Keep things as they are.")?.parentElement?.textContent).toBe("Keep things as they are.Decline");
    expect([review.decisions, review.confirmations, world.telephony.sent]).toEqual([[], [], []]);
    await press("Send this text");
    try {
      const confirmation = await exactSmsConfirmation(review, sms);
      expect([review.decisions, review.claims, world.telephony.sent]).toEqual([[review.proposal.id], [review.proposal.id], []]);
      expect(review.journal.get(review.proposal.id)).toMatchObject({
        ownerId: world.notes.owner, agentId: world.notes.owner, installationId: world.notes.owner,
      });
      await drawn(() => confirmation.confirm());
      await vi.waitFor(() => expect(review.receipts).toEqual([expect.objectContaining({ outcome: "applied", operationId: review.proposal.id })]));
      expect(world.telephony.sent).toEqual([{ operationId: review.proposal.id, recipients: sms.recipients, body: sms.body }]);
    } finally {
      for (const confirmation of review.confirmations) confirmation.confirm();
    }
  });

  it('Uses the sole Android SIM when Ask Alpha opens over the Messages list (spec/app/messages/composer.md, "The phone says how many SIMs it has, and with more than one the owner picks one, which needs SIM access")', async () => {
    const world = image();
    const first = world.telephony.subscriptions[0];
    world.telephony.subscriptions = [first, { ...first, id: 14, slot: 1, defaultSms: false }];
    world.ask.metadata = [];
    const sms = { type: "sms_send", recipients: ["+14155550100"], body: "Meet at the front door", subscriptionId: first.id } as const;
    const review = textReview(world.notes.owner, "text-from-threads", sms);
    const { alpha, runtime } = await openTextReview(world, review);
    await openMessages(alpha);
    await ready(alpha.runtime, Phone, "Known call state", (state) => state.telecom === "NoCall");
    await ready(alpha.runtime, Messages, "Conversation list read", (state) => state.pane === "Threads" && state.list.status === "Loaded");
    await ready(alpha.runtime, Composer, "No open text composer", (state) => state.thread === 0);
    await ready(runtime, Conversation, "Ask Alpha sees Messages", (state) => state.ready && state.context.showing.tag === "App" && state.context.showing.view === "Messages");
    await press("Open Alpha");
    await ready(alpha.runtime, Shell, "Ask Alpha sheet", (state) => state.assistant === "Sheet");

    const ask = async () => {
      const earlier = review.pendingReads;
      world.ask.nextReplyChunks = ["Review the text on your phone."];
      world.ask.nextActions = () => [{ action: "PROPOSE_DEVICE_ACTION", data: { proposalId: review.proposal.id, state: "pending", executed: false, approvalRequired: true, awaitingUserInput: true } }];
      await vi.waitFor(() => expect(document.querySelector('textarea[aria-label="Ask Alpha"]')).not.toBeNull());
      await fill("Ask Alpha", "Text +14155550100: Meet at the front door");
      await vi.waitFor(() => expect(button("Send")?.disabled).toBe(false));
      await press("Send");
      await ready(runtime, Conversation, "The proposed text returned", (state) => review.pendingReads > earlier && state.turn.reply === "Complete");
      const metadata = world.ask.metadata?.at(-1) as { observation?: { selectedObject?: unknown } } | undefined;
      return metadata?.observation?.selectedObject;
    };
    expect(await ask()).toBeUndefined();
    expect(button("Send this text")).toBeUndefined();
    world.telephony.subscriptions = [first];
    const revision: unknown = expect.stringMatching(/^[a-f0-9-]{36}$/u);
    expect(await ask()).toEqual({ kind: "sms-subscription", id: String(first.id), revision });
    await vi.waitFor(() => expect(button("Send this text")).toBeDefined());
    await press("Send this text");
    try {
      const confirmation = await exactSmsConfirmation(review, sms);
      expect(world.telephony.sent).toEqual([]);
      await drawn(() => confirmation.confirm());
      await vi.waitFor(() => expect(world.telephony.sent).toHaveLength(1));
    } finally {
      for (const confirmation of review.confirmations) confirmation.confirm();
    }
  });

  it('Reviews a Messages text only with the exact SIM the owner had selected (spec/app/messages/composer.md, "The phone says how many SIMs it has, and with more than one the owner picks one, which needs SIM access")', async () => {
    const world = image();
    const first = world.telephony.subscriptions[0];
    const second = { ...first, id: 8, slot: 1, defaultSms: false, displayName: "Personal line", carrierName: "Personal carrier" };
    world.telephony.subscriptions = [first, second];
    world.ask.metadata = [];
    const sms = { type: "sms_send", recipients: ["+14155550100"], body: "Meet at the front door", subscriptionId: second.id } as const;
    const review = textReview(world.notes.owner, "text-with-sim", sms);
    const { alpha, runtime } = await openTextReview(world, review);
    await openMessages(alpha);
    await ready(alpha.runtime, Phone, "Known call state", (state) => state.telecom === "NoCall");
    await ready(alpha.runtime, Messages, "Conversations ready", (state) => state.list.status === "Loaded" && state.threads === 1);
    await press("Maya Chen");
    await ready(alpha.runtime, Messages, "Maya conversation loaded", (state) => state.pane === "Conversation" && state.page.status === "Loaded");
    await ready(alpha.runtime, Composer, "SIMs visible", (state) => state.sims === 2 && state.simInfo.grant === "Granted");
    await ready(runtime, Conversation, "Ask Alpha sees Messages", (state) => state.ready && state.context.showing.tag === "App" && state.context.showing.view === "Messages");

    const ask = async () => {
      await press("Open Alpha");
      await ready(alpha.runtime, Shell, "Ask Alpha sheet", (state) => state.assistant === "Sheet");
      await vi.waitFor(() => expect(document.querySelector('textarea[aria-label="Ask Alpha"]')).not.toBeNull());
      const reads = review.pendingReads;
      world.ask.nextReplyChunks = ["Review the text on your phone."];
      world.ask.nextActions = () => [{ action: "PROPOSE_DEVICE_ACTION", data: { proposalId: review.proposal.id, state: "pending", executed: false, approvalRequired: true, awaitingUserInput: true } }];
      await fill("Ask Alpha", "Text +14155550100: Meet at the front door");
      await vi.waitFor(() => expect(button("Send")?.disabled).toBe(false));
      await press("Send");
      await ready(runtime, Conversation, "The proposed text has been read", (state) => review.pendingReads > reads && state.turn.reply === "Complete");
      const metadata = world.ask.metadata?.at(-1) as { observation?: { selectedObject?: unknown } } | undefined;
      return metadata?.observation?.selectedObject;
    };
    const giveBack = async () => {
      await press("Back to texting Maya Chen");
      await ready(alpha.runtime, Shell, "The Messages composer is visible", (state) => state.assistant === "Bar");
    };
    const choose = async (label: string) => {
      await giveBack();
      await vi.waitFor(() => expect(button(label)).toBeDefined());
      await press(label);
    };

    const opaqueRevision: unknown = expect.stringMatching(/^[a-f0-9-]{36}$/u);
    expect(await ask()).toBeUndefined();
    expect(button("Send this text")).toBeUndefined();
    await choose("Carrier");
    expect(await ask()).toEqual({ kind: "sms-subscription", id: String(first.id), revision: opaqueRevision });
    expect(button("Send this text")).toBeUndefined();
    await giveBack();
    await press("Back");
    await ready(alpha.runtime, Messages, "Conversation closed", (state) => state.pane === "Threads");
    await press("Maya Chen");
    await ready(alpha.runtime, Messages, "Conversation reopened", (state) => state.pane === "Conversation" && state.page.status === "Loaded");
    expect(await ask()).toBeUndefined();
    expect(button("Send this text")).toBeUndefined();
    await choose("Personal line");
    expect(await ask()).toEqual({ kind: "sms-subscription", id: String(second.id), revision: opaqueRevision });
    await vi.waitFor(() => expect(button("Send this text")).toBeDefined());

    world.telephony.subscriptions = [first, { ...second, carrierName: "Replacement carrier" }];
    await press("Send this text");
    await vi.waitFor(() => expect(review.receipts).toEqual([expect.objectContaining({ outcome: "failed", operationId: review.proposal.id })]));
    expect([review.confirmations, world.telephony.sent]).toEqual([[], []]);
  });

  it.each(["draft", "send", "send with a lost answer"] as const)(`Reviews the exact number for a named text and handles its %s (spec/app/contacts/agent.md, "The owner picks the exact number or the one contact, and that one is shown"; spec/app/messages/composer.md, "The agent's draft goes into the open conversation's draft only while it is empty, and never sends"; spec/app/messages/composer.md, "An addressed send names the exact number, text and SIM before it can send")`, async (mode) => {
    const world = image();
    const body = "Meet at the front door";
    const compose = mode === "draft" ? { type: "sms_compose", target: { kind: "contact", query: "Maya" }, draft: true, body } as const
      : { type: "sms_compose", query: "Maya", body } as const;
    const review = textReview(world.notes.owner, "draft-for-maya", compose);
    world.telephony.textReview = review;
    const lostAnswer = mode === "send with a lost answer";
    world.telephony.loseSmsReply = lostAnswer;
    const { alpha } = await open(world, lostAnswer ? [...mounts, ...only("view:Settings", "settings/activity")] : mounts);
    const runtime = assistant.runtime(alpha);
    await ready(alpha.runtime, Shell, "Alpha image admitted", (state) => state.image);
    await openHomeConversation(alpha, runtime);

    const action = mode === "draft" ? "Open draft" : "Send this text";
    world.ask.nextReplyChunks = ["Review the text for Maya."];
    world.ask.nextActions = () => [{ action: "PROPOSE_DEVICE_ACTION", data: { proposalId: review.proposal.id, state: "pending", executed: false, approvalRequired: true, awaitingUserInput: true } }];
    await fill("Message Alpha", mode === "draft" ? "Draft a text for Maya: Meet at the front door" : "Text Maya: Meet at the front door");
    await vi.waitFor(() => expect(button("Send")?.disabled).toBe(false));
    await press("Send");
    await ready(runtime, Conversation, "The named proposal is ready", (state) => review.pendingReads === 1 && state.turn.reply === "Complete");
    const choice = await vi.waitFor(() => {
      const found = document.querySelector<HTMLButtonElement>('[aria-label="Choose a phone number"] button');
      expect(found?.textContent).toContain("Maya Chen");
      return found!;
    });
    expect(button(action)).toBeUndefined();
    expect(review.decisions).toEqual([]);
    await drawn(() => choice.click());
    await vi.waitFor(() => expect(button(action)).toBeDefined());
    expect(review.decisions).toEqual([]);
    await press(action);
    if (mode !== "draft") {
      try {
        const confirmation = await exactSmsConfirmation(review, { recipients: ["+14155550100"], body, subscriptionId: 1 });
        expect(world.telephony.sent).toEqual([]);
        await drawn(() => confirmation.confirm());
        if (lostAnswer) {
          await vi.waitFor(() => expect(review.proposal.state).toBe("reconciliation_required"), { timeout: 12_000 });
          await drawn(() => alpha.runtime.runPromise(Shell.use((machine) => machine.send({ type: "openView", view: "Settings" }))));
          await until(alpha, alpha.runtime, Shell, (state) => state.trail.at(-1) === "Settings");
          await vi.waitFor(async () => {
            await drawn(() => undefined);
            expect(button("About")).toBeDefined();
          }, { timeout: 12_000 });
          await press("About");
          const activity = await vi.waitFor(async () => {
            await drawn(() => undefined);
            const row = [...document.querySelectorAll<HTMLButtonElement>("button")].find((one) => one.textContent?.includes("Agent activity"));
            if (row === undefined) throw new Error("Agent activity was not drawn");
            return row;
          }, { timeout: 12_000 });
          await drawn(() => activity.click());
          await vi.waitFor(async () => {
            await drawn(() => undefined);
            expect(document.body.textContent).toContain("Phone could not confirm the send");
          }, { timeout: 12_000 });
          expect([button("Happened"), button("Didn’t")]).toEqual([undefined, undefined]);
        } else {
          await vi.waitFor(() => expect(review.receipts.at(-1)).toMatchObject({ outcome: "applied", operationId: review.proposal.id,
            result: { kind: "sms-compose", status: "sent" } }));
        }
        expect(world.telephony.sent).toEqual([{ operationId: review.proposal.id, recipients: ["+14155550100"], body }]);
      } finally {
        for (const confirmation of review.confirmations) confirmation.confirm();
      }
      return;
    }
    await ready(alpha.runtime, Composer, "The exact draft is ready", (state) => state.slot.author === "AlphaWrote");
    await vi.waitFor(() => expect(review.receipts).toEqual([{
      outcome: "applied", operationId: review.proposal.id, result: { kind: "sms-compose", status: "drafted" },
    }]));
    expect([review.decisions, review.claims, review.confirmations, world.telephony.sent]).toEqual([[review.proposal.id], [review.proposal.id], [], []]);
    await vi.waitFor(() => expect(button("Back to texting Maya Chen")).toBeDefined());
    await press("Back to texting Maya Chen");
    await vi.waitFor(() => expect(document.querySelector('[aria-label^="Message draft to Maya Chen"]')?.textContent).toContain(compose.body));
  });

  it.each([["a draft the model declared", true], ["a text to send", false]] as const)(`Shows %s to a written number on its own card and sends nothing (spec/app/messages/composer.md, "An addressed send names the exact number, text and SIM before it can send"; spec/app/messages/composer.md, "The agent's draft goes into the open conversation's draft only while it is empty, and never sends")`, async (_label, draft) => {
    const world = image();
    const body = "Can you bring ice tomorrow?";
    const compose = draft ? { type: "sms_compose", target: { kind: "number", number: "+12025550142" }, body, draft: true } as const
      : { type: "sms_compose", target: { kind: "number", number: "+12025550142" }, body } as const;
    const review = textReview(world.notes.owner, draft ? "draft-to-number" : "text-to-number", compose);
    await proposeText(world, review, draft ? "Draft a text to 202-555-0142 saying, can you bring ice tomorrow?" : "text 202-555-0142 can you bring ice tomorrow?", "The proposal is read");
    await vi.waitFor(() => expect(button(draft ? "Open draft" : "Send this text")).toBeDefined());
    expect(document.body.textContent).toContain(draft ? "Open an editable text draft" : `To: ${displayNumber("+12025550142")}`);
    expect(document.body.textContent).not.toContain(draft ? "Review this text on your phone" : "Open an editable text draft");
    expect(button(draft ? "Send this text" : "Open draft")).toBeUndefined();
    expect([review.decisions, review.claims, review.confirmations, world.telephony.sent]).toEqual([[], [], [], []]);
  });

  it.each([["a contact's first name", "Maya", true], ["a name no contact has", "Bob", false]] as const)('Reviews a text to %s on its card and sends nothing (spec/app/contacts/agent.md, "Only the phone answers the newest search, and the request goes on by what it found")', async (_label, query, known) => {
    const world = image();
    const review = textReview(world.notes.owner, `text-${query}`, { type: "sms_compose", query, body: "I'm running late" });
    await proposeText(world, review, `text ${query} I'm running late`, "The named proposal is read");
    if (known) {
      await vi.waitFor(() => expect(document.querySelector('[aria-label="Choose a phone number"] button')?.textContent).toContain("Maya Chen"));
    } else {
      await vi.waitFor(() => expect(document.body.textContent).toContain("No matching contact with a phone number was found."));
      expect(document.querySelector('[aria-label="Choose a phone number"]')).toBeNull();
    }
    expect(button("Decline")).toBeDefined();
    expect([button("Send this text"), button("Open draft")]).toEqual([undefined, undefined]);
    expect([review.decisions, review.claims, review.confirmations, world.telephony.sent]).toEqual([[], [], [], []]);
  });

  it.each(["suffix", "whole number", "open thread"] as const)(`Completes the exact approved %s read in its original chat (spec/app/contacts/agent.md, "The latest text's sender is named by its number alone, and the whole number only where the agent asked for it"; spec/app/contacts/agent.md, "The agent reads only the conversation, voicemail or contact open on screen, as the phone last read it")`, async (scope) => {
    const world = image();
    const selected = scope === "open thread";
    const operation = selected ? { type: "messages_read_selected" } as const : scope === "whole number"
      ? { type: "sms_latest_sender", includeAddress: true } as const : { type: "sms_latest_sender" } as const;
    const review = textReview(world.notes.owner, "reviewed-messages-read", operation);
    const { alpha, runtime } = await openTextReview(world, review);
    await ready(alpha.runtime, Shell, "Alpha image admitted", (state) => state.image);
    if (selected) {
      await openMessages(alpha);
      await ready(alpha.runtime, Messages, "Conversations ready", (state) => state.list.status === "Loaded" && state.threads === 1);
      await press("Maya Chen");
      await ready(alpha.runtime, Messages, "Exact thread loaded", (state) => state.pane === "Conversation" && state.page.status === "Loaded");
      await ready(runtime, Conversation, "Ask Alpha sees Messages", (state) => state.ready && state.context.showing.tag === "App" && state.context.showing.view === "Messages");
      await press("Open Alpha");
    } else {
      await ready(runtime, Conversation, "Ask Alpha ready on Home", (state) => state.ready && state.context.showing.tag === "Home");
      await vi.waitFor(() => expect(button("Open conversation")).toBeDefined());
      await press("Open conversation");
    }
    await ready(alpha.runtime, Shell, "Ask Alpha open", (state) => state.assistant === "Sheet");
    const label = selected ? "Ask Alpha" : "Message Alpha";
    const ask = async (prompt: string, exact: boolean) => {
      const earlier = review.pendingReads;
      world.ask.nextReplyChunks = ["Review this read on your phone."];
      world.ask.nextActions = () => {
        const chat = [...world.ask.kept].at(-1);
        const owner = chat?.[1].messages.at(-1);
        if (!chat || owner?.role !== "user" || !("clientMessageId" in owner) || typeof owner.clientMessageId !== "string") throw new Error("The fake resident did not retain the owner turn");
        review.readOrigin = { version: 1, requestId: owner.clientMessageId, conversationId: chat[0], inReplyTo: exact ? owner.id : "other-message" };
        return [{ action: "PROPOSE_DEVICE_ACTION", data: { proposalId: review.proposal.id, state: "pending", executed: false, approvalRequired: true, awaitingUserInput: true } }];
      };
      await vi.waitFor(() => expect(document.querySelector(`textarea[aria-label="${label}"]`)).not.toBeNull());
      await fill(label, prompt);
      await vi.waitFor(() => expect(button("Send")?.disabled).toBe(false));
      await press("Send");
      await ready(runtime, Conversation, "The offered read returned", (state) => review.pendingReads > earlier && state.turn.reply === "Complete");
    };
    const prompt = selected ? "Read my open messages" : scope === "whole number" ? "What is the full phone number that last texted me?" : "What are the last four digits of the latest SMS sender?";
    if (scope === "suffix") {
      await ask(prompt, false);
      expect([button("Approve"), review.senderReads, review.receipts, review.completions]).toEqual([undefined, [], [], []]);
    }
    await ask(prompt, true);
    await vi.waitFor(() => expect(button("Approve")).toBeDefined());
    expect([review.senderReads, review.receipts, review.completions]).toEqual([[], [], []]);
    if (!selected) {
      const card = document.body.textContent ?? "";
      expect([card.includes("Read latest text sender"), card.includes(scope === "whole number"
        ? "Read the phone number of your latest incoming text." : "Share the last four digits of the newest incoming SMS sender."), card.includes("thread ID")]).toEqual([true, true, false]);
    }
    // spec/app/assistant/cards.md, "A phone step's result chip stands under the reply that offered it, and a reply that only offered the review gives way to it": v119's first row is the title and what it does, with a compact Approve at its end and no picture, and the reply that offered the card stays while it shows
    const offers = () => (document.body.textContent ?? "").split("Review this read on your phone.").length - 1;
    const offered = offers();
    const firstRow = button("Approve")?.parentElement;
    expect([firstRow?.textContent?.includes(selected ? "Share open messages" : "Read latest text sender"), firstRow?.parentElement?.querySelectorAll("svg").length, offered > 0])
      .toEqual([true, 0, true]);
    if (!selected) {
      world.telephony.texts.push({ id: 2, thread: 12, address: "+14155550122", box: "inbox", date: 1_700_000_060_000, body: "Keep this out of the receipt", read: false });
    }
    await press("Approve");
    await vi.waitFor(() => expect(review.completions).toHaveLength(1));
    const result = selected ? { kind: "messages-read", status: "read", participant: "Maya Chen", messages: [{ direction: "in", date: 1_700_000_050_000, body: "See you at five" }], truncated: false }
      : scope === "whole number" ? { kind: "sms-latest-sender", status: "found", address: "+14155550122", threadId: "thread:12" }
        : { kind: "sms-latest-sender", status: "found", numberEnding: "0122" };
    expect(review.receipts).toEqual([{ outcome: "applied", operationId: review.proposal.id, result }]);
    expect(review.senderReads).toEqual(selected ? [] : [scope === "whole number"]);
    expect(world.telephony.sent).toEqual([]);
    await vi.waitFor(() => expect(document.body.textContent).toContain("The reviewed read answered the original request."));
    // spec/app/assistant/cards.md, "A phone step's result chip stands under the reply that offered it, and a reply that only offered the review gives way to it": v119's chip says what the phone read, in that reply's place, before the answer
    const chip = await vi.waitFor(() => {
      const shown = document.querySelector("[data-alpha-device-receipt]")?.textContent;
      if (!shown) throw new Error("No result chip after Approve");
      return shown;
    });
    const page = document.body.textContent ?? "";
    expect([chip, offers(), page.lastIndexOf(prompt) < page.indexOf(chip), page.indexOf(chip) < page.indexOf("The reviewed read answered the original request.")])
      .toEqual([selected ? "Shared the open thread." : scope === "whole number" ? "+14155550122" : "Latest incoming SMS sender ends in 0122.", offered - 1, true, true]);
  });

  it(`Opens the exact notified conversation and follows an owner's safe link tap (spec/app/messages/index.md, "A message notification opens its exact conversation once access is available"; spec/app/messages/index.md, "Story: Read a conversation")`, async () => {
    const world = image();
    world.telephony.texts.push({ id: 2, thread: 23, address: "+14155550122", box: "inbox", date: 1_700_000_060_000, body: "Lunch? http://news.example/lunch or https://example-user@private.example/lunch", read: false });
    world.telephony.smsNotice = { threadId: "thread:23", token: "1" };
    const { alpha } = await openImage(world);
    await ready(alpha.runtime, Messages, "Messages state", (state) => state.pane === "Conversation" && state.page.status === "Loaded" && world.telephony.smsNotice === undefined && world.telephony.texts[1]?.read === true);
    expect([world.telephony.texts.map((text) => text.read), world.telephony.sent]).toEqual([[false, true], []]);
    const title = () => document.querySelector("[data-alpha-messages-title]")?.textContent;
    expect(title()).toBe("Ben Ortiz");

    await press("Back");
    await ready(alpha.runtime, Messages, "Both conversations displayed", (state) => state.pane === "Threads" && state.list.status === "Loaded" && state.threads === 2);
    expect(button("Maya Chen")).toBeDefined();
    const ticket = alpha.runtime.runSync(Messages.use((machine) => machine.get())).list.ticket;
    world.telephony.people = world.telephony.people.filter((person) => person.displayName !== "Maya Chen");
    await drawn(() => world.telephony.changed());
    await ready(alpha.runtime, Messages, "Conversations read after a contact was removed", (state) => state.list.ticket > ticket && state.list.status === "Loaded");
    expect(button("Maya Chen")).toBeUndefined();
    expect(button(displayNumber("+14155550100"))).toBeDefined();
    expect(button("Ben Ortiz")).toBeDefined();

    world.telephony.people = [];
    world.telephony.smsNotice = { threadId: "thread:23", token: "2" };
    await drawn(() => world.telephony.wakeSmsNotice());
    await ready(alpha.runtime, Messages, "Second notification opened after a contact was removed", (state) => state.pane === "Conversation" && state.page.status === "Loaded" && world.telephony.smsNotice === undefined);
    expect(title()).toBe(displayNumber("+14155550122"));

    const links = [...document.querySelectorAll<HTMLAnchorElement>("[data-alpha-message-body] a")];
    expect([links.map((one) => one.href), world.browser.tabs.size]).toEqual([["http://news.example/lunch"], 0]);
    await drawn(() => links[0]?.click());
    await ready(alpha.runtime, Shell, "Alpha image admitted", (state) => state.trail.at(-1) === "Browser");
    const runtime = browser.runtime(alpha);
    const linkTab = await vi.waitFor(() => {
      const committed = [...world.browser.tabs.values()].filter((one) => one.committed && !one.private && one.history.at(-1) === "http://news.example/lunch");
      if (committed.length !== 1 || !committed[0]) throw new Error(`Browser host did not commit the tapped URL: ${JSON.stringify(world.browser.calls)}`);
      return committed[0];
    }, { timeout: 12_000 });
    await ready(runtime, Tabs, "selected Browser link tab", (state) => idOf(state.selected) === linkTab.id);
    const tab = runtime.runSync(Effect.map(Tabs.use((machine) => machine.get()), (state) => state.selected));
    const page = runtime.runSync(Effect.flatMap(Pages, (pages) => pages.of(tab)));
    await ready(page, Page, "Browser link page", (state) => state.phase === "Shown" && !state.secure);
  });

  it(`A messaging bar's recorder shows no words, and a failed transcription keeps its retry and discard controls (spec/app/voice/index.md, "Using the transcript fills the field dictation started in, and dictation never sends")`, async () => {
    const world = image();
    world.voice.transcriptionFailures = 1;
    const alpha = await readyImageWithIdlePhone(world);
    await openMaya(alpha);
    const messageView = messages.runtime(alpha);
    const before = await toastsIssued(alpha);
    const bar = () => document.querySelector("[data-alpha-bar-recorder]");
    await press("Dictate a text to Maya");
    await ready(messageView, Voice, "Messages recording", (state) => state.recorder.field === "MessagesBar" && state.recorder.stage === "Recording");
    await drawn(() => undefined);
    expect([shownWords(bar()), bar()?.querySelector("[role=status]")?.textContent]).toEqual(["", "Recording"]);
    await press("Stop recording");
    await ready(messageView, Voice, "Messages transcription failed", (state) => state.recorder.stage === "Recorded");
    await drawn(() => undefined);
    expect([shownWords(bar()), bar()?.querySelector("[role=status]")?.textContent, [...(bar()?.querySelectorAll("button") ?? [])].map((one) => one.getAttribute("aria-label"))])
      .toEqual(["", "Couldn’t transcribe", ["Try transcription again", "Discard transcription"]]);
    await press("Try transcription again");
    await ready(messageView, Voice, "Messages transcript returned", (state) => state.recorder.stage === "Closed");
    await mayaReads("Dictated note");
    expect([await toastsIssued(alpha) - before, world.telephony.sent]).toEqual([0, []]);
  });

  it(`Dictation starts while the phone has not told its call state, as the Sunday demo build did (spec/app/voice/index.md, "Using the transcript fills the field dictation started in, and dictation never sends")`, async () => {
    const world = image();
    world.telephony.callStateKnown = false;
    const { alpha } = await openImage(world);
    await ready(alpha.runtime, Shell, "Alpha image admitted", (state) => state.image);
    await ready(alpha.runtime, Phone, "Unknown call state", (state) => state.telecom === "CallUnknown");
    await openMaya(alpha);
    await dictateToMaya(alpha);
    await mayaReads("Dictated note");
    expect(world.telephony.sent).toEqual([]);
  });

  it(`Dictation that cannot start on this phone does not start and shows no words (spec/app/voice/index.md, "Using the transcript fills the field dictation started in, and dictation never sends")`, async () => {
    const world = image();
    world.voice.onDevice = false;
    world.voice.cloudSpeech = false;
    const alpha = await readyImageWithIdlePhone(world);
    await openMaya(alpha);
    await fill("Text Maya", "On my way");
    await ready(alpha.runtime, Composer, "Owner wrote draft", (state) => state.slot.author === "OwnerWrote");
    const before = await toastsIssued(alpha);
    await press("Dictate a text to Maya");
    await later(alpha, 1_000);
    const voice = await messages.runtime(alpha).runPromise(Effect.flatMap(Voice, (machine) => machine.get()));
    expect([voice.recorder.stage, await toastsIssued(alpha) - before, document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Text Maya"]')?.value, Boolean(button("Dictate a text to Maya")), world.voice.startLiveCaptureCalls])
      .toEqual(["Closed", 0, "On my way", true, 0]);
  });

  it(`Removes a cleared draft from storage so reopening and agent drafts see an empty composer (spec/app/messages/composer.md, "Typing changes the draft and makes it the owner's; emptying it leaves no draft")`, async () => {
    const world = image();
    const { alpha } = await openImage(world);
    await openMaya(alpha);

    await fill("Text Maya", "Temporary draft");
    await ready(alpha.runtime, Composer, "Owner wrote draft", (state) => state.slot.author === "OwnerWrote");
    await fill("Text Maya", "");
    await ready(alpha.runtime, Composer, "Owner cleared draft", (state) => state.slot.author === "Nobody");

    await hardware("back");
    await ready(alpha.runtime, Messages, "Returned to threads", (state) => state.pane === "Threads");
    await press("Maya Chen");
    await ready(alpha.runtime, Composer, "Reopened empty composer", (state) => state.thread > 0 && state.slot.author === "Nobody");
    expect(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Text Maya"]')?.value).toBe("");
    expect(await alpha.runtime.runPromise(answerReading({ type: "sms_reply_selected", body: "Fresh reply" }))).toEqual({
      kind: "sms-reply", status: "drafted",
    });
    await ready(alpha.runtime, Composer, "Agent drafted into cleared composer", (state) => state.slot.author === "AlphaWrote");
    expect(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Text Maya"]')?.value).toBe("Fresh reply");
  });

  it(`Clears stale Messages search filter when opening Unread from Home (spec/app/messages/index.md, "One tap on Home's unread card opens the conversation when exactly one is unread, and the list filtered to the unread ones when several are")`, async () => {
    const world = image();
    world.telephony.texts.push({ id: 2, thread: 2, address: "+14155550122", box: "inbox", date: 1_700_000_060_000, body: "Lunch?", read: false });
    const { alpha } = await openImage(world);
    await openMessages(alpha);
    await ready(alpha.runtime, Messages, "two unread threads", (s) => s.list.status === "Loaded" && s.threads === 2);
    await fill("Search or ask", "Maya");
    await ready(alpha.runtime, Messages, "filtered to Maya", (s) => s.sought && s.list.status === "Loaded" && s.threads === 1);
    await hardware("home");
    await ready(alpha.runtime, Messages, "Messages closed on Home", (s) => !s.front);
    await openUnreadCard();
    await ready(alpha.runtime, Messages, "Unread filter loaded", (s) => s.front && s.pane === "Threads" && s.chip === "UnreadThreads" && s.list.status === "Loaded");
    const unreadState = await alpha.runtime.runPromise(Effect.flatMap(Messages, (m) => m.get()));
    const searchField = document.querySelector<HTMLInputElement>('input[aria-label="Search or ask"]');
    expect([unreadState.sought, unreadState.threads, searchField?.value ?? ""]).toEqual([false, 2, ""]);
  });

  it(`Drops stored draft text after sending so subsequent agent drafts succeed (spec/app/messages/composer.md, "Typing changes the draft and makes it the owner's; emptying it leaves no draft"; spec/app/messages/composer.md, "The agent's draft goes into the open conversation's draft only while it is empty, and never sends")`, async () => {
    const world = image();
    const { alpha } = await openImage(world);
    await openMessages(alpha);
    await ready(alpha.runtime, Messages, "Maya listed", (s) => s.list.status === "Loaded" && s.threads === 1);
    await press("Maya Chen");
    await ready(alpha.runtime, Messages, "Maya conversation", (s) => s.pane === "Conversation" && s.page.status === "Loaded");
    await ready(alpha.runtime, Composer, "Maya composer", (s) => s.thread > 0 && s.sending.grant === "Granted");
    await fill("Text Maya", "Already sent");
    await ready(alpha.runtime, Composer, "owner wrote", (s) => s.slot.author === "OwnerWrote" && s.slot.draft.sync === "Kept");
    await press("Send");
    await ready(alpha.runtime, Composer, "send confirmed and slot cleared", (s) => s.outgoing.op.outcome === "Confirmed" && s.slot.author === "Nobody" && s.slot.draft.sync === "Kept");
    const mayaThread = (await alpha.runtime.runPromise(Effect.flatMap(Composer, (m) => m.get()))).thread;
    const leftover = await alpha.runtime.runPromise(Effect.flatMap(Drafts, (drafts) => drafts.text(mayaThread)));
    const pageTicket = (await alpha.runtime.runPromise(Effect.flatMap(Messages, (m) => m.get()))).page.ticket;
    const reply = await executeMedia(
      alpha,
      { type: "sms_reply_selected", body: "Follow up" },
      { proposalId: "follow-up", operationId: "follow-up", attemptId: 1 },
      { target: { thread: mayaThread, ticket: pageTicket }, current: () => Promise.resolve(true) },
    );
    expect([leftover, reply]).toEqual(["", { kind: "applied", result: { kind: "sms-reply", status: "drafted" } }]);
  });

  it(`Does not carry a delete-refused banner into another conversation (spec/app/messages/index.md, "The phone's answer ends the removal it names, and the conversation is read again unless it was refused")`, async () => {
    const world = { ...image(), now: 1_799_999_999_000 };
    world.telephony.texts.push({ id: 2, thread: 2, address: "+14155550122", box: "inbox", date: 1_700_000_060_000, body: "Lunch?", read: false });
    const { alpha } = await openImage(world);
    await openMessages(alpha);
    await ready(alpha.runtime, Messages, "two threads", (s) => s.list.status === "Loaded" && s.threads === 2);
    await press("Maya Chen");
    await ready(alpha.runtime, Messages, "Maya conversation", (s) => s.pane === "Conversation" && s.page.status === "Loaded");
    world.telephony.holdMessageDeletion = true;
    await bubble("See you at five");
    await press("Delete");
    await ready(alpha.runtime, Messages, "delete confirmation", (s) => s.confirming);
    await confirm("Delete");
    await ready(alpha.runtime, Toasts, "undo toast", (s) => s.showing && s.current.undo);
    const staged = world.telephony.staged.at(-1);
    if (!staged) throw new Error("expected staged message deletion");
    staged.phase = "conflict";
    await later(alpha, 2_000);
    await ready(alpha.runtime, Messages, "deletion refused on conflict", (s) => s.removal.outcome === "Refused");
    expect(document.body.textContent).toContain("The message was not deleted");
    await press("Back");
    await ready(alpha.runtime, Messages, "back to thread list", (s) => s.pane === "Threads" && s.list.status === "Loaded");
    await press("Ben Ortiz");
    await ready(alpha.runtime, Messages, "Ben conversation", (s) => s.pane === "Conversation" && s.page.status === "Loaded");
    expect(document.body.textContent).not.toContain("The message was not deleted");
  });
});

describe("Messages search", () => {
  const searchField = () => input("Search conversations");

  it(`On the launcher the search draws no Back, Android's Back closes it, and the next Back leaves Messages (spec/app/messages/index.md, "The search field opens over the list, and Back closes it with what it typed")`, async () => {
    const world = image();
    world.settings.roles = world.settings.roles.map((role) => role.role === "home" ? { ...role, held: true } : role);
    const { alpha } = await open(world, only("home", "view:Messages"));
    const runtime = messages.runtime(alpha);
    await until(alpha, alpha.runtime, Shell, (state) => state.image);
    await drawn(() => {
      const tile = document.querySelector<HTMLButtonElement>("[data-home-tile='view:Messages']");
      if (!tile) throw new Error("No Messages home tile");
      tile.click();
    });
    await until(alpha, runtime, Messages, (state) => state.front && state.pane === "Threads" && state.list.status === "Loaded");
    await vi.waitFor(() => expect(document.querySelector("main")?.hasAttribute("data-alpha-launcher")).toBe(true));

    await press("Search messages");
    await until(alpha, runtime, Messages, (state) => state.searching);
    await vi.waitFor(() => expect(searchField()).not.toBeNull());
    expect(button("Back to messages")).toBeUndefined();
    await fill("Search conversations", "Maya");
    await until(alpha, runtime, Messages, (state) => state.sought);

    await hardware("back");
    await until(alpha, runtime, Messages, (state) => !state.searching && !state.sought && state.front && state.pane === "Threads");
    await vi.waitFor(() => expect(searchField()).toBeNull());
    expect(button("Search messages")).toBeDefined();
    expect((await alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.get()))).trail.at(-1)).toBe("Messages");

    await hardware("back");
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.length === 0);
  });

  async function openMessagesView(withAssistant: boolean) {
    const { alpha } = await open(image(), withAssistant ? only("home", "assistant", "view:Messages") : only("home", "view:Messages"));
    const runtime = messages.runtime(alpha);
    await until(alpha, alpha.runtime, Shell, (state) => state.image);
    await drawn(() => alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.send({ type: "openView", view: "Messages" }))));
    await until(alpha, runtime, Messages, (state) => state.front && state.pane === "Threads" && state.list.status === "Loaded");
    return { alpha, runtime };
  }

  it(`Off the launcher the search keeps its Back, which closes the search and stays in Messages (spec/app/messages/index.md, "The search field opens over the list, and Back closes it with what it typed")`, async () => {
    const { alpha, runtime } = await openMessagesView(false);
    expect(document.querySelector("main")?.hasAttribute("data-alpha-launcher")).toBe(false);

    await press("Search messages");
    await vi.waitFor(() => expect(button("Back to messages")).toBeDefined());
    await fill("Search conversations", "Maya");
    await until(alpha, runtime, Messages, (state) => state.sought);
    await press("Back to messages");
    await until(alpha, runtime, Messages, (state) => !state.searching && !state.sought && state.front && state.pane === "Threads");
    await vi.waitFor(() => expect(searchField()).toBeNull());
  });

  it(`The search opens empty, and a conversation opened from its results returns to them before Back closes the search (spec/app/messages/index.md, "The search field opens over the list, and Back closes it with what it typed")`, async () => {
    const { alpha, runtime } = await openMessagesView(true);
    const everyone = (await runtime.runPromise(Effect.flatMap(Messages, (machine) => machine.get()))).threads;
    const words = document.querySelector("ul[aria-label='Conversations'] button")?.getAttribute("aria-label")?.split(" ")[0] ?? "";

    await fill("Search or ask", "Nobody by this name");
    await until(alpha, runtime, Messages, (state) => state.sought && !state.searching && state.list.status === "Loaded" && state.threads === 0);
    await press("Search messages");
    await until(alpha, runtime, Messages, (state) => state.searching && !state.sought && state.list.status === "Loaded" && everyone > 0 && state.threads === everyone);
    await vi.waitFor(() => expect(searchField()?.value).toBe(""));

    await fill("Search conversations", words);
    await until(alpha, runtime, Messages, (state) => state.sought && state.list.status === "Loaded" && state.threads > 0);
    const found = (await runtime.runPromise(Effect.flatMap(Messages, (machine) => machine.get()))).threads;
    await drawn(() => document.querySelector<HTMLButtonElement>("ul[aria-label='Conversations'] button")?.click());
    await until(alpha, runtime, Messages, (state) => state.pane === "Conversation");

    await hardware("back");
    await until(alpha, runtime, Messages, (state) => state.pane === "Threads" && state.searching && state.sought && state.list.status === "Loaded" && state.threads === found);
    await vi.waitFor(() => expect(searchField()?.value).toBe(words));

    await hardware("back");
    await until(alpha, runtime, Messages, (state) => state.pane === "Threads" && !state.searching && !state.sought);
    await vi.waitFor(() => expect(searchField()).toBeNull());
    expect((await alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.get()))).trail.at(-1)).toBe("Messages");
  });
});
