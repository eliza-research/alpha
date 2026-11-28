// @vitest-environment happy-dom
import type { tl } from "@mtcute/web";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { NodeHttpClient } from "@effect/platform-node";
import { startTelegramProvider, type RunningProvider } from "@repo/eliza-harness";
import { Clock, Effect, Layer, ManagedRuntime, Stream } from "effect";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import { TestClock } from "effect/testing";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as Home from "../gen/app__home.effect.vibe";
import * as Preferences from "../gen/app__settings__preferences.effect.vibe";
import * as Shell from "../gen/app__shell.effect.vibe";
import * as ChatList from "../gen/app__telegram.effect.vibe";
import * as AgentTelegram from "../gen/app__telegram__agent.effect.vibe";
import * as Auth from "../gen/app__telegram__auth.effect.vibe";
import * as Composer from "../gen/app__telegram__composer.effect.vibe";
import * as Conversation from "../gen/app__telegram__conversation.effect.vibe";
import * as Notices from "../gen/app__telegram__notices.effect.vibe";
import home from "../src/home/index.tsx";
import { MessagingBridge } from "../src/messaging/bridge.vibe";
import { toasts } from "../src/notices/toasts.vibe";
import { openTelegramNotice } from "../src/telegram/notices.vibe";
import { browserDevice } from "../src/platform/device.vibe";
import { browserMessagingNotices } from "../src/platform/messaging-notices.vibe";
import { MessagingSessions, messagingSessions, secretOf } from "../src/platform/messaging.vibe";
import { grounded } from "../src/platform/platform.vibe";
import { browserVoiceBridge } from "../src/platform/voice.vibe";
import { telegramMessages } from "../src/platform/telegram-messages.vibe";
import { telegramNetwork } from "../src/platform/telegram-mtproto.vibe";
import { mtprotoRequest, telegramAt } from "../src/platform/telegram.vibe";
import { together, whole } from "../src/runtime/reactor.vibe";
import { shell } from "../src/shell/shell.vibe";
import { TelegramScreen } from "../src/telegram/Telegram.tsx";
import {
  executeTelegramAgentRequest,
  telegramAmbientSnapshot,
  telegramHomeCard,
  telegramResident,
} from "../src/telegram/resident.vibe";
import { TELEGRAM_SESSION_KEY, TelegramStore } from "../src/telegram/store.vibe";

import { closeAll, only, open, press, seen, until as untilArea } from "./alpha.tsx";
import { scene } from "./fakes/scene.ts";

const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
env.IS_REACT_ACT_ENVIRONMENT = true;

async function drawn(work: () => unknown): Promise<void> {
  await act(async () => {
    await work();
  });
}

async function controlJson(origin: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response.json();
}

function buildTestLayer(origin: string) {
  const base = Layer.mergeAll(
    browserDevice,
    browserVoiceBridge,
    browserMessagingNotices,
    messagingSessions,
    Layer.provide(telegramAt(origin), NodeHttpClient.layerNodeHttp),
    Layer.provideMerge(Layer.effectDiscard(TestClock.setTime(1_700_000_000_000)), TestClock.layer()),
  );
  const platform = Layer.provideMerge(grounded, Layer.provideMerge(base, KeyValueStore.layerMemory));
  const prefsLayer = Preferences.machine();
  const appMachines = whole(together(shell, toasts, telegramResident));
  return Layer.provideMerge(appMachines, Layer.merge(platform, prefsLayer));
}

type TestRuntime = ManagedRuntime.ManagedRuntime<Layer.Success<ReturnType<typeof buildTestLayer>>, unknown>;

async function until<S>(
  runtime: TestRuntime,
  streamOf: Effect.Effect<Stream.Stream<S>, never, Layer.Success<ReturnType<typeof buildTestLayer>>>,
  predicate: (state: S) => boolean,
): Promise<S> {
  let matched: S | undefined;
  await drawn(async () => {
    const result = await runtime.runPromise(
      Effect.flatMap(streamOf, (changes) => Stream.runHead(Stream.filter(changes, predicate))),
    );
    if (result._tag === "Some") matched = result.value;
  });
  if (matched === undefined) throw new Error("State predicate did not match");
  return matched;
}

function findButton(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find(
    (el) => (el.getAttribute("aria-label") ?? el.textContent?.trim()) === name,
  );
}

async function clickButton(name: string): Promise<void> {
  await drawn(() => {
    const found = findButton(name);
    if (!found) throw new Error(`Button not found: ${name}`);
    found.click();
  });
}

async function clickDialogButton(name: string): Promise<void> {
  await drawn(() => {
    const found = [...document.querySelectorAll("[role=dialog] button, [role=alertdialog] button")].find(
      (el) => el.textContent?.trim() === name,
    );
    if (!(found instanceof HTMLElement)) throw new Error(`Dialog button not found: ${name}`);
    found.click();
  });
}

async function fillField(label: string, value: string): Promise<void> {
  await drawn(() => {
    const found = [...document.querySelectorAll("input, textarea")].find(
      (el) => el.getAttribute("aria-label") === label,
    );
    if (!(found instanceof HTMLInputElement || found instanceof HTMLTextAreaElement)) {
      throw new Error(`Field not found: ${label}`);
    }
    const proto = Object.getPrototypeOf(found) as object;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(found, value);
    found.dispatchEvent(new Event("input", { bubbles: true }));
    found.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function clickRowContaining(text: string): Promise<void> {
  await drawn(() => {
    const found = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes(text));
    if (!found) throw new Error(`Row button containing "${text}" not found`);
    found.click();
  });
}

async function tick(runtime: TestRuntime, ms: number): Promise<void> {
  await drawn(() => runtime.runPromise(TestClock.adjust(ms)));
}

const authChanges = Auth.Machine.use((m) => Effect.succeed(m.changes));
const listChanges = ChatList.Machine.use((m) => Effect.succeed(m.changes));
const convChanges = Conversation.Machine.use((m) => Effect.succeed(m.changes));
const compChanges = Composer.Machine.use((m) => Effect.succeed(m.changes));

/** From phone entry, sign in with the provider's test number and code, and wait for the first page of chats. */
async function signIn(rt: TestRuntime): Promise<void> {
  await fillField("Phone number", "+9996621234");
  await clickButton("Send code");
  await until(rt, authChanges, (s) => s.step === "CodePending");
  await fillField("Verification code", "22222");
  await clickButton("Verify code");
  await until(rt, listChanges, (s) => s.list.status === "Loaded" && s.pages === 1);
}

/** Sign out, and wait until sign-in rests signed out. */
async function signOut(rt: TestRuntime): Promise<void> {
  await rt.runPromise(Auth.Machine.use((m) => m.send({ type: "signOut" })));
  await until(rt, authChanges, (s) => s.step === "SignedOut" && s.work === "Idle");
}

describe("Telegram user-account client over live HTTP+SSE provider", () => {
  let provider: RunningProvider;
  let runtime: TestRuntime | undefined;
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeAll(async () => {
    provider = await startTelegramProvider();
  });

  afterAll(async () => {
    await provider.stop();
  });

  beforeEach(async () => {
    await controlJson(provider.origin, "/__control/reset", {});
    document.body.innerHTML = "";
    const layer = buildTestLayer(provider.origin);
    runtime = ManagedRuntime.make(layer);
    await runtime.runPromise(
      Effect.gen(function* () {
        const shellMachine = yield* Shell.Machine;
        yield* Effect.ignore(shellMachine.send({ type: "openView", view: "Telegram" }));
        const prefs = yield* Preferences.Machine;
        yield* Effect.ignore(
          prefs.send(
            {
              type: "start",
              at: 1_700_000_000_000,
              kept: "System",
              keptLegible: false,
              readable: true,
              look: "LightLook",
            },
            "Phone",
          ),
        );
        yield* Effect.ignore(
          prefs.send(
            {
              type: "documentRead",
              docRead: 1,
              readable: true,
              askFirst: true,
              images: true,
              shares: ["TelegramContext"],
            },
            "Phone",
          ),
        );
      }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const activeRuntime = runtime;
    await drawn(() => {
      root?.render(<TelegramScreen runtime={activeRuntime} />);
    });
  });

  afterEach(async () => {
    if (root) {
      const mounted = root;
      root = undefined;
      await drawn(() => {
        mounted.unmount();
      });
    }
    if (runtime) {
      const active = runtime;
      runtime = undefined;
      await active.dispose();
    }
    container?.remove();
    container = undefined;
  });

  // spec/app/telegram/auth.md, "Story: Sign in to my Telegram user account"
  it("authenticates via Phone->OTP, 2FA password, and QR login while rejecting bot tokens and honoring FloodWait", async () => {
    const rt = runtime!;

    // spec/app/telegram/auth.md, "Every non-authenticated auth state is sensitive, so Ask Alpha sees nothing of sign-in screens"
    expect(document.body.textContent).toContain("User account · no bot token");
    expect(document.querySelector("[data-alpha-sensitive='true']")).not.toBeNull();

    await clickButton("Continue");
    await until(rt, authChanges, (s) => s.step === "PhoneEntry");

    // spec/app/telegram/auth.md, "Bot tokens are never authenticated, an authenticated session always names a user account and positive credential revision, and FloodWait blocks submits"
    await fillField("Phone number", "123456:ABCDefghijKLMN_bot");
    await clickButton("Send code");
    await until(rt, authChanges, (s) => s.trouble === "BotTokenRejected" && s.work === "Idle");
    expect(document.body.textContent).toContain("Bot tokens are not supported");

    await fillField("Phone number", "not-a-phone");
    await clickButton("Send code");
    await until(rt, authChanges, (s) => s.trouble === "InvalidPhone" && s.work === "Idle");
    expect(document.body.textContent).toContain("Enter a valid phone number");

    // spec/app/telegram/auth.md, "Opening sign-in moves to phone entry or QR login; phone submission respects FloodWait and takes the next ticket"
    await controlJson(provider.origin, "/__control/fault", {
      path: "/rpc/auth.sendCode",
      status: 429,
      retryAfter: 2,
      body: { ok: false, error_code: 429, error_message: "FLOOD_WAIT_2" },
      remaining: 1,
    });
    await fillField("Phone number", "+9996621234");
    await clickButton("Send code");
    await until(rt, authChanges, (s) => s.trouble === "FloodWait" && s.work === "Idle");
    expect(document.body.textContent).toContain("Too many attempts");
    expect(findButton("Send code")?.disabled).toBe(true);

    await tick(rt, 2_500);
    await drawn(() => {});
    await clickButton("Send code");
    await until(rt, authChanges, (s) => s.step === "CodePending" && s.work === "Idle");

    // spec/app/telegram/auth.md, "A verification code is checked with a secret code, and may authenticate a user account, request two-factor password, expire or trigger FloodWait"
    await fillField("Verification code", "00000");
    await clickButton("Verify code");
    await until(rt, authChanges, (s) => s.trouble === "WrongCode" && s.work === "Idle");

    await fillField("Verification code", "22222");
    await clickButton("Verify code");
    await until(rt, authChanges, (s) => s.step === "Authenticated");
    await until(rt, listChanges, (s) => s.list.status === "Loaded" && s.pages === 1);

    const storedAuthState = await rt.runPromise(Auth.Machine.use((m) => m.get()));
    expect(JSON.stringify(storedAuthState)).not.toContain("tg-sess-");
    expect(JSON.stringify(storedAuthState)).not.toContain("22222");
    const sessionOpt = await rt.runPromise(MessagingSessions.use((s) => s.get(TELEGRAM_SESSION_KEY)));
    expect(sessionOpt._tag).toBe("Some");

    // spec/app/telegram/auth.md, "Two-factor cloud password is checked as a secret and authenticates only a user account"
    await signOut(rt);
    await clickButton("Continue");
    await until(rt, authChanges, (s) => s.step === "PhoneEntry");

    await fillField("Phone number", "+15550109999");
    await clickButton("Send code");
    await until(rt, authChanges, (s) => s.step === "CodePending");
    const codeInfo = (await controlJson(provider.origin, "/__control/last-code?phone=%2B15550109999")) as {
      readonly code: string;
    };
    await fillField("Verification code", codeInfo.code);
    await clickButton("Verify code");
    await until(rt, authChanges, (s) => s.step === "TwoFactorRequired");
    expect(document.body.textContent).toContain("codename");

    await fillField("Two-factor password", "wrong-pass");
    await clickButton("Unlock account");
    await until(rt, authChanges, (s) => s.trouble === "WrongPassword" && s.work === "Idle");

    await fillField("Two-factor password", "alpha-2fa");
    await clickButton("Unlock account");
    await until(rt, authChanges, (s) => s.step === "Authenticated");
    await until(rt, listChanges, (s) => s.list.status === "Loaded");

    // spec/app/telegram/auth.md, "QR login offers an alternate user-account path with expiry and optional two-factor check"
    await signOut(rt);
    await clickButton("Continue");
    await until(rt, authChanges, (s) => s.step === "PhoneEntry");

    const readQr = () => rt.runPromise(Effect.flatMap(TelegramStore, (store) => Effect.map(store.get(), (snap) => snap.auth.qrToken)));
    const startQr = async () => {
      await clickButton("Sign in with QR");
      await until(rt, authChanges, (s) => s.step === "QrPending" && s.qrExpiresAt > 0);
      expect(document.querySelector("svg[aria-label='Telegram sign-in QR code'] path")).toBeTruthy();
      return readQr();
    };
    const cancelled = await startQr();
    await clickButton("Use phone number");
    await until(rt, authChanges, (s) => s.step === "PhoneEntry");
    await controlJson(provider.origin, "/__control/approve-qr", { token: cancelled });
    await tick(rt, 2500);
    expect(await rt.runPromise(MessagingSessions.use((sessions) => sessions.get(TELEGRAM_SESSION_KEY)))).toMatchObject({ _tag: "None" });

    const clock = await rt.runPromise(Clock.currentTimeMillis);
    const expires = Math.floor(clock / 1000) + 1;
    const shortLived = "A".repeat(128);
    await controlJson(provider.origin, "/__control/fault", {
      path: "/rpc/auth.exportLoginToken", status: 200, remaining: 1,
      body: { ok: true, _type: "auth.loginToken", token: shortLived, expires, login_url: `tg://login?token=${shortLived}` },
    });
    const expired = await startQr();
    expect(expired).toBe(shortLived);
    const offered = await rt.runPromise(Auth.Machine.use((m) => m.get()));
    await tick(rt, expires * 1000 - clock);
    await until(rt, authChanges, (s) => s.qrExpiresAt > offered.qrExpiresAt && s.work === "Idle");
    const current = await readQr();
    expect(current).not.toBe(expired);
    await controlJson(provider.origin, "/__control/approve-qr", { token: current });
    await tick(rt, 2000);
    await until(rt, authChanges, (s) => s.step === "Authenticated");

    await signOut(rt);
    await clickButton("Continue");
    const protectedToken = await startQr();
    await controlJson(provider.origin, "/__control/approve-qr", { token: protectedToken, phone: "+15550109999" });
    await tick(rt, 2000);
    await until(rt, authChanges, (s) => s.step === "TwoFactorRequired");
    await fillField("Two-factor password", "alpha-2fa");
    await clickButton("Unlock account");
    await until(rt, authChanges, (s) => s.step === "Authenticated");
  });

  // spec/app/telegram/index.md, "Story: Browse and search my Telegram chats"; spec/app/telegram/conversation.md, "Story: Read and interact with a Telegram conversation"; spec/app/telegram/composer.md, "Story: Draft and send Telegram messages under my sole authority"
  it("lists dialogs, switches tabs, searches, reads history with visible-only mark-read, replies, edits, deletes with review, reacts, mutes, and enforces broadcast read-only", async () => {
    const rt = runtime!;

    await clickButton("Continue");
    await signIn(rt);

    expect(document.body.textContent).toContain("Maya");
    expect(document.body.textContent).toContain("Alpha Core");
    expect(document.body.textContent).toContain("Alpha Release Notes");

    // spec/app/telegram/index.md, "Choosing a filter, folder, search or refresh reads the first page under a new ticket"
    await rt.runPromise(ChatList.Machine.use((m) => m.send({ type: "chooseFilter", tab: "ArchivedChats", folderId: 0 })));
    await until(rt, listChanges, (s) => s.selected.tab === "ArchivedChats" && s.list.status === "Loaded");
    expect(document.body.textContent).toContain("Samira");

    await rt.runPromise(ChatList.Machine.use((m) => m.send({ type: "chooseFilter", tab: "PinnedChats", folderId: 0 })));
    await until(rt, listChanges, (s) => s.selected.tab === "PinnedChats" && s.list.status === "Loaded");
    expect(document.body.textContent).toContain("Maya");

    await rt.runPromise(ChatList.Machine.use((m) => m.send({ type: "chooseFilter", tab: "UnreadChats", folderId: 0 })));
    await until(rt, listChanges, (s) => s.selected.tab === "UnreadChats" && s.list.status === "Loaded");
    expect(document.body.textContent).toContain("Alpha Core");

    await rt.runPromise(ChatList.Machine.use((m) => m.send({ type: "chooseFilter", tab: "AllChats", folderId: 0 })));
    await until(rt, listChanges, (s) => s.selected.tab === "AllChats" && s.list.status === "Loaded");

    await fillField("Search Telegram", "Alpha");
    await until(rt, listChanges, (s) => s.selected.query === "Alpha" && s.list.status === "Loaded");
    await fillField("Search Telegram", "");
    await until(rt, listChanges, (s) => s.selected.query === "" && s.list.status === "Loaded");

    // spec/app/telegram/conversation.md, "Only the newest timeline read answers; MarkRead fires ONLY when the newest page is visibly shown in front"
    await clickRowContaining("Alpha Core");
    await until(rt, convChanges, (s) => s.chat > 0 && s.newestLoaded && s.unread === 0);
    await until(rt, compChanges, (s) => s.chat > 0);
    const readReqs = (await controlJson(provider.origin, "/__control/requests?path=/rpc/messages.readHistory")) as {
      readonly requests: ReadonlyArray<unknown>;
    };
    expect(readReqs.requests.length).toBeGreaterThanOrEqual(1);

    // spec/app/telegram/conversation.md, "Inline reply targeting works only in chats where the owner can compose"
    await clickButton("Reply");
    await until(rt, convChanges, (s) => s.replyTo > 0);
    await fillField("Message", "Inline reply from Alpha");
    await until(rt, compChanges, (s) => s.slot.author === "OwnerWrote");
    await clickButton("Send");
    await until(rt, compChanges, (s) => s.sendOp.outcome === "Confirmed");
    expect(document.body.textContent).toContain("Inline reply from Alpha");

    // spec/app/telegram/conversation.md, "Message edit, reviewed delete and reaction toggle execute one attempt at a time with honest outcomes"
    await clickButton("React");
    await until(rt, convChanges, (s) => s.opKind === "ToggleReact" && s.op.outcome === "Confirmed");

    const editButtons = [...document.querySelectorAll("button[aria-label='Edit']")];
    expect(editButtons.length).toBeGreaterThan(0);
    await drawn(() => { (editButtons[editButtons.length - 1] as HTMLButtonElement).click(); });
    await fillField("Edit message", "Edited inline reply from Alpha");
    await clickButton("Save edit");
    await until(rt, convChanges, (s) => s.opKind === "EditMsg" && s.op.outcome === "Confirmed");
    expect(document.body.textContent).toContain("Edited inline reply from Alpha");

    // spec/app/telegram/conversation.md, "Delete requires a confirmed review, broadcast read-only never holds a reply target, and every read or mutation terminates"
    const deleteButtons = [...document.querySelectorAll("button[aria-label='Delete']")];
    await drawn(() => { (deleteButtons[deleteButtons.length - 1] as HTMLButtonElement).click(); });
    await until(rt, convChanges, (s) => s.deleteReview.showing);
    const deletesBeforeConfirm = (await controlJson(provider.origin, "/__control/requests?path=/rpc/messages.deleteMessages")) as {
      readonly requests: ReadonlyArray<unknown>;
    };
    expect(deletesBeforeConfirm.requests.length).toBe(0);
    await clickDialogButton("Delete");
    await until(rt, convChanges, (s) => s.opKind === "DeleteMsg" && s.op.outcome === "Confirmed");
    expect(document.body.textContent).not.toContain("Edited inline reply from Alpha");

    // spec/app/telegram/index.md, "Muting or unmuting a chat runs as a once-only attempt"
    await clickButton("Mute chat");
    await until(rt, listChanges, (s) => s.muteOp.outcome === "Confirmed");

    // spec/app/telegram/conversation.md, "Broadcast channels without posting permission block composing and inline replies"
    await clickButton("Back to chats");
    await until(rt, convChanges, (s) => s.chat === 0);
    await clickRowContaining("Alpha Release Notes");
    await until(rt, convChanges, (s) => s.chat > 0 && s.kind === "BroadcastChannel" && !s.canPost);
    expect(document.body.textContent).toContain("This broadcast channel is read-only.");
    expect(document.querySelector("textarea[aria-label='Message']")).toBeNull();
  });

  // spec/app/telegram/agent.md, "Story: Let Alpha help with Telegram safely and transparently"; spec/app/telegram/notices.md, "Story: Hear about new Telegram messages without noise"
  it("gates ambient context, stages Alpha drafts without sending, dispatches on owner tap, and delivers SSE notices with mute suppression", async () => {
    const rt = runtime!;
    const agentChanges = AgentTelegram.Machine.use((m) => Effect.succeed(m.changes));
    const noticeChanges = Notices.Machine.use((m) => Effect.succeed(m.changes));

    // spec/app/telegram/agent.md, "Ambient context is emitted ONLY when authenticated, non-sensitive and allowed by `TelegramContext`, bounded to 15 messages and 6000 characters, with zero secrets"
    const whileAuth = await rt.runPromise(telegramAmbientSnapshot);
    expect(whileAuth.available).toBe(false);
    expect(whileAuth.sensitive).toBe(true);

    await clickButton("Continue");
    await signIn(rt);
    await until(rt, noticeChanges, (s) => s.since > 0);

    const card = await rt.runPromise(telegramHomeCard);
    expect(card.standing).toBe("Ready");
    expect(card.rows.length).toBeGreaterThan(0);

    await clickRowContaining("Maya");
    await until(rt, convChanges, (s) => s.chat > 0 && s.newestLoaded);
    await until(rt, compChanges, (s) => s.chat > 0);
    await until(rt, agentChanges, (s) => s.authenticated && s.shareAllowed && s.pane === "ChatPane" && s.activeChat > 0);

    const ambientOn = await rt.runPromise(telegramAmbientSnapshot);
    expect(ambientOn.available).toBe(true);
    if (ambientOn.available) {
      expect(ambientOn.messages.length).toBeLessThanOrEqual(15);
      expect(ambientOn.charCount).toBeLessThanOrEqual(6000);
      expect(JSON.stringify(ambientOn)).not.toContain("tg-sess-");
    }

    // spec/app/telegram/agent.md, "Ambient context is emitted ONLY when authenticated, non-sensitive and allowed by `TelegramContext`, bounded to 15 messages and 6000 characters, with zero secrets"
    await rt.runPromise(
      Effect.flatMap(Preferences.Machine, (m) => Effect.gen(function* () {
        yield* m.send({ type: "setShare", share: "TelegramContext", on: false, at: 1_700_000_001_000 }, "Owner");
        const saving = (yield* m.get()).saving.read.ticket;
        yield* m.send({ type: "documentSaved", save: saving, ok: true }, "Phone");
      })),
    );
    await until(rt, agentChanges, (s) => !s.shareAllowed);
    const ambientOff = await rt.runPromise(telegramAmbientSnapshot);
    expect(ambientOff.available).toBe(false);

    // spec/app/telegram/agent.md, "Direct read tools run only while authenticated within the 25-message bound and mutate no state"
    const listedByAgent = await rt.runPromise(executeTelegramAgentRequest({ kind: "TelegramListChats", limit: 10 }));
    expect(listedByAgent.ok).toBe(true);

    // spec/app/telegram/agent.md, "Staging a draft (`TELEGRAM_DRAFT_MESSAGE`) emits only `StageDraft` and NEVER sends"
    const openChatId = (await rt.runPromise(Conversation.Machine.use((m) => m.get()))).chat;
    const staged = await rt.runPromise(
      executeTelegramAgentRequest({
        kind: "TelegramDraftMessage",
        turn: 1,
        chat: openChatId,
        text: "Alpha drafted this reply for review",
      }),
    );
    expect(staged.ok).toBe(true);
    await until(rt, compChanges, (s) => s.slot.author === "AlphaWrote");
    expect(document.body.textContent).toContain("Alpha's draft · not sent");
    expect(document.body.textContent).toContain("Alpha drafted this reply for review");

    const sendsBeforeOwnerTap = (await controlJson(provider.origin, "/__control/requests?path=/rpc/messages.sendMessage")) as {
      readonly requests: ReadonlyArray<unknown>;
    };
    expect(sendsBeforeOwnerTap.requests.length).toBe(0);

    // spec/app/telegram/composer.md, "Only the owner's tap sends: Recorded before Sent, read-back only on Unknown, confirmed clears the draft"
    await clickButton("Send");
    await until(rt, compChanges, (s) => s.sendOp.outcome === "Confirmed");
    const sendsAfterOwnerTap = (await controlJson(provider.origin, "/__control/requests?path=/rpc/messages.sendMessage")) as {
      readonly requests: ReadonlyArray<{ readonly headers: Record<string, string> }>;
    };
    expect(sendsAfterOwnerTap.requests.length).toBe(1);
    expect(sendsAfterOwnerTap.requests[0]?.headers["idempotency-key"]).toBeTruthy();

    // spec/app/telegram/notices.md, "Own, muted, archived, read-only broadcast and currently visible front-chat messages are always suppressed"
    await clickButton("Back to chats");
    await until(rt, convChanges, (s) => s.chat === 0);
    await until(rt, noticeChanges, (s) => s.frontChat === 0);

    // spec/app/telegram/notices.md, "Own, muted, archived, read-only broadcast and currently visible front-chat messages are always suppressed"
    await controlJson(provider.origin, "/__control/inject", {
      kind: "message",
      peer: "channel:4002",
      from_id: 4002,
      text: "Muted broadcast update",
    });
    await tick(rt, 100);
    const noticesAfterMuted = await rt.runPromise(Notices.Machine.use((m) => m.get()));
    expect(noticesAfterMuted.posts).toBe(0);

    // spec/app/telegram/notices.md, "Polling reads updates from the watermark; the first answer sets the baseline quietly and later answers post only eligible messages"
    await controlJson(provider.origin, "/__control/inject", {
      kind: "message",
      peer: "user:2001",
      from_id: 2001,
      text: "Live SSE ping from Maya",
    });
    await until(rt, noticeChanges, (s) => s.posts >= 1 && s.upChats.length >= 1);
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Telegram notifications"]')?.textContent).toContain("Live SSE ping from Maya"));
    const [target] = (await rt.runPromise(TelegramStore.use((store) => store.get()))).notices;
    await controlJson(provider.origin, "/__control/fault", { path: "/rpc/messages.getHistory", status: 503, remaining: 1 });
    expect(await rt.runPromise(openTelegramNotice(target.scope, target.peerKey))).toBe("pending");
    await controlJson(provider.origin, "/__control/fault", { path: "/rpc/messages.getHistory", status: 400, remaining: 1,
      body: { ok: false, error_code: 400, error_message: "PEER_ID_INVALID" } });
    await clickRowContaining("Live SSE ping from Maya");
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Telegram notifications"]')).toBeNull());
    expect((await rt.runPromise(Conversation.Machine.use((m) => m.get()))).chat).toBe(0);
    await controlJson(provider.origin, "/__control/inject", { kind: "message", peer: "user:2001", from_id: 2001, text: "New available message from Maya" });
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Telegram notifications"]')?.textContent).toContain("New available message from Maya"));
    await clickRowContaining("New available message from Maya");
    await until(rt, convChanges, (state) => state.front && state.chat > 0 && state.newestLoaded);
    const selected = await rt.runPromise(Conversation.Machine.use((machine) => machine.get()));
    expect(await rt.runPromise(TelegramStore.use((store) => store.peerKeyOf(selected.chat)))).toBe("user:2001");
  });

  // spec/app/telegram/auth.md, "Remote revocation and explicit sign-out wipe local data, advance the credential revision and stop sync"
  it("wipes cached state on remote revocation and calls auth.logOut on explicit Sign Out", async () => {
    const rt = runtime!;

    await clickButton("Continue");
    await signIn(rt);

    await controlJson(provider.origin, "/__control/revoke", {});
    await until(rt, authChanges, (s) => s.step === "SessionExpired" && s.trouble === "SessionRevoked");
    await until(rt, listChanges, (s) => !s.authenticated && s.pages === 0);
    const afterRevokeSnap = await rt.runPromise(TelegramStore.use((s) => s.get()));
    expect(afterRevokeSnap.dialogs).toEqual([]);
    expect(afterRevokeSnap.historyByPeer.size).toBe(0);
    expect(afterRevokeSnap.drafts.size).toBe(0);
    const revokedCard = await rt.runPromise(telegramHomeCard);
    expect(revokedCard).toEqual({ standing: "SignedOut", unread: 0, mentions: 0, rows: [] });

    // spec/app/telegram/auth.md, "Remote revocation and explicit sign-out wipe local data, advance the credential revision and stop sync"
    await clickButton("Sign in again");
    await until(rt, authChanges, (s) => s.step === "PhoneEntry");
    await signIn(rt);

    await signOut(rt);
    await until(rt, listChanges, (s) => !s.authenticated && s.pages === 0);

    const logOutReqs = (await controlJson(provider.origin, "/__control/requests?path=/rpc/auth.logOut")) as {
      readonly requests: ReadonlyArray<unknown>;
    };
    expect(logOutReqs.requests.length).toBeGreaterThanOrEqual(1);
    const afterSignOutSession = await rt.runPromise(MessagingSessions.use((s) => s.get(TELEGRAM_SESSION_KEY)));
    expect(afterSignOutSession._tag).toBe("None");
    const afterSignOutSnap = await rt.runPromise(TelegramStore.use((s) => s.get()));
    expect(afterSignOutSnap.dialogs).toEqual([]);
    expect(afterSignOutSnap.drafts.size).toBe(0);
  });
});

describe("Telegram on a phone", () => {
  afterEach(closeAll);

  // spec/app/telegram/notices.md, "Story: Hear about new Telegram messages without noise"
  it('keeps a pending sign-in bound to the Cloud account that requested it (spec/app/telegram/auth.md, "Story: Sign in to my Telegram user account")', async () => {
    const phone = { ...scene(), phone: true };
    phone.telegram.enabled = true;
    localStorage.setItem("alpha/app/telegram/auth@1", JSON.stringify({ ...Auth.initial, step: "Authenticated", account: 57, credentialRev: 1 }));
    const mounts = only("home", "view:Telegram");
    const { alpha, close } = await open(phone, mounts);
    await untilArea(alpha, home.runtime(alpha), Home.Machine, (s) => s.tiles.load.status === "Loaded");
    await press("Telegram");
    await untilArea(alpha, alpha.runtime, Shell.Machine, (s) => s.trail.at(-1) === "Telegram");
    await clickButton("Continue");
    await fillField("Phone number", "+9996621234");
    await clickButton("Send code");
    await untilArea(alpha, alpha.runtime, Auth.Machine, (s) => s.step === "CodePending");
    const originalOwner = phone.voice.organizationId;
    phone.voice.organizationId = "other-phone-owner";
    await fillField("Verification code", "22222");
    await clickButton("Verify code");
    await untilArea(alpha, alpha.runtime, Auth.Machine, (s) => s.step === "PhoneEntry" && s.trouble === "ExpiredCode");
    const grants = MessagingSessions.use((s) => s.keys());
    expect(await alpha.runtime.runPromise(grants)).toEqual([]);
    phone.voice.organizationId = originalOwner;
    expect(await alpha.runtime.runPromise(grants)).toEqual([]);

    await fillField("Phone number", "+9996621234");
    await clickButton("Send code");
    await untilArea(alpha, alpha.runtime, Auth.Machine, (s) => s.step === "CodePending");
    await fillField("Verification code", "22222");
    await clickButton("Verify code");
    await untilArea(alpha, alpha.runtime, Auth.Machine, (s) => s.step === "Authenticated");
    const tray = phone.messagingNotices;
    const incoming = (id: number, missingGroup = false) => {
      const date = 1_700_000_000;
      const peer = missingGroup ? { peer_id: { _type: "peerChat", chat_id: 131 }, peer_key: "chat:131" } : { peer_id: { _type: "peerUser", user_id: 420 }, peer_key: "user:420" };
      const message = { _type: "message", id, ...peer, from_id: 420,
        date, message: `Notice ${id}`, out: false, reactions: [], mentioned: false };
      const update = { _type: "updateNewMessage", pts: ++phone.telegram.pts, date, message };
      for (const send of phone.telegram.listeners) send(update);
    };
    await vi.waitFor(() => expect(phone.telegram.listeners.size).toBeGreaterThan(0));
    incoming(10);
    await vi.waitFor(async () => expect((await alpha.runtime.runPromise(TelegramStore.use((store) => store.get()))).historyByPeer.get("user:420")?.at(-1)?.id).toBe(10));
    expect(tray.posted()).toEqual([]);
    await clickButton("Enable Telegram notifications");
    await untilArea(alpha, alpha.runtime, Notices.Machine, (state) => state.notifyAllowed);
    incoming(21, true);
    await vi.waitFor(() => expect(tray.posted().map((entry) => entry.body)).toEqual(["Notice 21"]));
    expect(tray.tap(tray.posted()[0].token)).toBe(true);
    await vi.waitFor(() => expect(tray.pending()).toBeUndefined());
    expect((await alpha.runtime.runPromise(Conversation.Machine.use((machine) => machine.get()))).chat).toBe(0);
    incoming(11);
    await vi.waitFor(() => expect(tray.posted().map((entry) => entry.body)).toEqual(["Notice 11"]));
    const delivery = tray.posted()[0];
    expect(delivery.target).toMatchObject({ provider: "telegram", peer: "user:420" });
    expect(JSON.stringify(delivery)).not.toContain(phone.telegram.sessionToken);
    expect(tray.tap(delivery.token)).toBe(true);
    await untilArea(alpha, alpha.runtime, Conversation.Machine, (state) => state.chat > 0 && state.newestLoaded);
    const tapped = await alpha.runtime.runPromise(Conversation.Machine.use((machine) => machine.get()));
    expect(await alpha.runtime.runPromise(TelegramStore.use((store) => store.peerKeyOf(tapped.chat)))).toBe("user:420");
    await vi.waitFor(() => expect(tray.pending()).toBeUndefined());
    expect(tray.tap(delivery.token)).toBe(false);
    await clickButton("Back to chats");
    await close();

    phone.voice.organizationId = "other-phone-owner";
    const other = await open(phone, mounts);
    await untilArea(other.alpha, home.runtime(other.alpha), Home.Machine, (s) => s.tiles.load.status === "Loaded");
    const previousView = await other.alpha.runtime.runPromise(Shell.Machine.use((m) => m.get()));
    if (previousView.trail.at(-1) !== "Telegram") await press("Telegram");
    await untilArea(other.alpha, other.alpha.runtime, Shell.Machine, (s) => s.trail.at(-1) === "Telegram");
    expect(findButton("Continue")).toBeDefined();
    expect(await other.alpha.runtime.runPromise(grants)).toEqual([]);
    await other.close();

    phone.voice.organizationId = originalOwner;
    const reopened = await open(phone, mounts);
    await untilArea(reopened.alpha, reopened.alpha.runtime, Auth.Machine, (s) => s.step === "Authenticated" && s.account === phone.telegram.user.id);
    expect(await reopened.alpha.runtime.runPromise(grants)).toEqual([TELEGRAM_SESSION_KEY]);
    await reopened.close();

    // spec/app/telegram/auth.md, "A restart drops in-flight authentication work and restores only a previously authenticated user account"
    for (const revoked of [false, true]) {
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      phone.telegram.revoked = revoked;
      phone.telegram.beforeMeReply = () => {
        phone.telegram.beforeMeReply = undefined;
        started.resolve();
        return release.promise;
      };
      const { alpha: restoring, close: stop } = await open(phone, mounts);
      await started.promise;
      phone.telegram.revoked = false;
      phone.telegram.user.id += 1;
      phone.telegram.sessionToken = `replacement-session-${phone.telegram.user.id}`;
      try {
        expect(await restoring.runtime.runPromise(Effect.flatMap(MessagingSessions, (sessions) =>
          sessions.set(TELEGRAM_SESSION_KEY, secretOf(phone.telegram.sessionToken)),
        ))).toBe(true);
      } finally {
        release.resolve();
      }
      await untilArea(restoring, restoring.runtime, Auth.Machine, (state) => state.step === "Authenticated");
      expect((await restoring.runtime.runPromise(Effect.flatMap(Auth.Machine, (machine) => machine.get()))).account).toBe(phone.telegram.user.id);
      expect(await restoring.runtime.runPromise(grants)).toEqual([TELEGRAM_SESSION_KEY]);
      await stop();
    }

    const offline = Promise.withResolvers<void>();
    phone.telegram.beforeMeReply = () => {
      offline.resolve();
      return Promise.reject(new Error("Telegram is offline"));
    };
    const { alpha: reconnecting } = await open(phone, mounts);
    await offline.promise;
    expect(await reconnecting.runtime.runPromise(grants)).toEqual([TELEGRAM_SESSION_KEY]);
    expect((await reconnecting.runtime.runPromise(Auth.Machine.use((machine) => machine.get()))).step).toBe("SignedOut");
    phone.telegram.beforeMeReply = undefined;
    await seen(false);
    await seen(true);
    await untilArea(reconnecting, reconnecting.runtime, Auth.Machine, (state) => state.step === "Authenticated" && state.account === phone.telegram.user.id);
    const rt = reconnecting.runtime;
    const bridge = await rt.runPromise(MessagingBridge);
    bridge.stageDraft({ id: "old-draft", platform: "Telegram", target: "Prior chat", targetId: "user:420", body: "Old account draft", revision: 1, status: "draft" });
    await drawn(() => rt.runPromise(bridge.openDraftInApp("old-draft")));
    await untilArea(reconnecting, rt, Conversation.Machine, (state) => state.chat > 0 && state.newestLoaded);
    await untilArea(reconnecting, rt, Composer.Machine, (state) => state.chat > 0 && state.canPost);
    await fillField("Message", "Private unsent text");
    const chat = (await rt.runPromise(Conversation.Machine.use((machine) => machine.get()))).chat;
    const proposal = await rt.runPromise(executeTelegramAgentRequest({ kind: "ProposeMutation", tool: "TelegramMuteChat", turn: 42, chat, message: 0 }));
    expect(proposal.ok).toBe(true);
    await untilArea(reconnecting, rt, AgentTelegram.Machine, (state) => state.review.showing);
    await vi.waitFor(() => expect(phone.telegram.listeners.size).toBeGreaterThan(0));
    const oldFeed = [...phone.telegram.listeners];

    await seen(false);
    await untilArea(reconnecting, rt, Notices.Machine, (state) => state.frontChat === 0);
    incoming(12);
    await vi.waitFor(() => expect(tray.posted().some((item) => item.body === "Notice 12")).toBe(true));
    const oldNotice = tray.posted().find((item) => item.body === "Notice 12")!;
    phone.telegram.user.id += 1;
    phone.telegram.sessionToken = "replaced-while-telegram-backgrounded";
    expect(await rt.runPromise(MessagingSessions.use((sessions) =>
      sessions.set(TELEGRAM_SESSION_KEY, secretOf(phone.telegram.sessionToken)),
    ))).toBe(true);
    expect(tray.tap(oldNotice.token)).toBe(true);
    for (const send of oldFeed) send({ _type: "updateSessionRevoked", pts: 2, date: 1_700_000_000 });
    expect(await rt.runPromise(telegramAmbientSnapshot)).toMatchObject({ available: false, sensitive: true });
    expect(await rt.runPromise(telegramHomeCard)).toMatchObject({ standing: "SignedOut", rows: [] });
    expect(await rt.runPromise(executeTelegramAgentRequest({ kind: "ApproveMutation", turn: 42, revision: proposal.revision! }))).toEqual({ ok: false });
    await rt.runPromise(bridge.sendDraft("old-draft"));
    expect(bridge.snapshot().drafts.find((draft) => draft.id === "old-draft")?.status).toBe("failed");
    expect(phone.telegram.messages).toEqual([]);

    await seen(true);
    await untilArea(reconnecting, rt, Auth.Machine, (state) => state.step === "Authenticated" && state.account === phone.telegram.user.id);
    await untilArea(reconnecting, rt, AgentTelegram.Machine, (state) => state.authenticated && !state.review.showing);
    expect(await rt.runPromise(TelegramStore.use((store) => Effect.map(store.get(), (snapshot) => snapshot.drafts.size)))).toBe(0);
    expect(bridge.snapshot().drafts).toEqual([]);
    expect(await rt.runPromise(executeTelegramAgentRequest({ kind: "TelegramDraftMessage", turn: 43, chat, text: "Old chat handle" }))).toEqual({ ok: false });
    expect(await rt.runPromise(grants)).toEqual([TELEGRAM_SESSION_KEY]);
    await vi.waitFor(() => expect(tray.pending()).toBeUndefined());
    expect((await rt.runPromise(Conversation.Machine.use((machine) => machine.get()))).chat).toBe(0);
    await untilArea(reconnecting, rt, Notices.Machine, (state) => state.notifyAllowed && state.since > 0);
    await vi.waitFor(() => expect([...phone.telegram.listeners].some((listener) => !oldFeed.includes(listener))).toBe(true));
    incoming(13);
    await vi.waitFor(() => expect(tray.posted().some((item) => item.body === "Notice 13")).toBe(true));
    phone.telegram.revoked = true;
    expect(tray.tap(tray.posted().find((item) => item.body === "Notice 13")!.token)).toBe(true);
    await untilArea(reconnecting, rt, Auth.Machine, (state) => state.step === "SessionExpired");
    expect((await rt.runPromise(Conversation.Machine.use((machine) => machine.get()))).chat).toBe(0);
    expect(await rt.runPromise(grants)).toEqual([]);
  });
});

it('reports sign-in flood waits, reads, replies and reconnects through Telegram MTProto (spec/app/telegram/auth.md, "Story: Sign in to my Telegram user account"; spec/app/telegram/conversation.md, "Story: Read and interact with a Telegram conversation"; spec/app/telegram/notices.md, "Story: Hear about new Telegram messages without noise")', async () => {
  const { BaseTelegramClient, MemoryStorage, TelegramClient, WebCryptoProvider, networkMiddlewares } = await import("@mtcute/web");
  const require = createRequire(import.meta.url);
  const wasm = createRequire(require.resolve("@mtcute/web")).resolve("@mtcute/wasm/mtcute.wasm");
  const peer = { _: "peerChat", chatId: 9 } as const;
  const chat = { _: "chat", id: 9, title: "Field team", participantsCount: 2, date: 1700000000, version: 1, photo: { _: "chatPhotoEmpty" } } as const;
  const sender = { _: "user", id: 77, firstName: "Ria" } as const;
  const state = { _: "updates.state", pts: 5, date: 1700000000, qts: 0, seq: 3, unreadCount: 0 };
  const line = (id: number, text: string) => ({ _: "message", id, peerId: peer, fromId: { _: "peerUser", userId: 77 }, date: 1700000000, message: text });
  const dialog = { _: "dialog", peer, topMessage: 2, readInboxMaxId: 1, readOutboxMaxId: 1, unreadCount: 1,
    unreadMentionsCount: 0, unreadReactionsCount: 0, unreadPollVotesCount: 0, notifySettings: { _: "peerNotifySettings" } };
  const sent = new Map<string, { id: number; text: string }>();
  let loginRequests = 0;
  function replyToRpc(request: tl.RpcMethod): unknown {
      switch (request._) {
        case "auth.sendCode":
          loginRequests++;
          if (loginRequests === 1) return { _: "mt_rpc_error", errorCode: 420, errorMessage: "FLOOD_WAIT_2" };
          return { _: "auth.sentCode", type: { _: "auth.sentCodeTypeApp", length: 5 }, phoneCodeHash: "local-retry" };
        case "users.getUsers": return { _: "mt_rpc_error", errorCode: 406, errorMessage: "AUTH_KEY_DUPLICATED" };
        case "updates.getState": return state;
        case "messages.getDialogs": return { _: "messages.dialogs", dialogs: request.offsetId ? [] : [dialog], messages: [line(2, "Meet at ten")], users: [sender], chats: [chat] };
        case "messages.getDialogFilters": return { _: "messages.dialogFilters", filters: [] };
        case "messages.getHistory": return { _: "messages.messagesSlice", count: 2, messages: [line(2, "Meet at ten"), line(1, "Hello")].filter((m) => !request.offsetId || m.id < request.offsetId).slice(0, request.limit), users: [sender], chats: [chat] };
        case "messages.sendMessage": {
          const key = request.randomId.toString();
          const saved = sent.get(key) ?? { id: 3 + sent.size, text: request.message };
          sent.set(key, saved);
          return { _: "updates", updates: [{ _: "updateNewMessage", message: line(saved.id, saved.text), pts: 6, ptsCount: 1 }], users: [sender], chats: [chat], date: state.date, seq: 4 };
        }
        case "updates.getDifference": return { _: "updates.difference", newMessages: [line(4, "Change of plan")], newEncryptedMessages: [], otherUpdates: [], users: [sender], chats: [chat], state: { ...state, pts: 7 } };
        default: throw new Error(`Unexpected Telegram RPC ${request._}`);
      }
  }
  const base = new BaseTelegramClient({ apiId: 1, apiHash: "local", storage: new MemoryStorage(), disableUpdates: true,
    crypto: new WebCryptoProvider({ wasmInput: await WebAssembly.compile(Uint8Array.from(await readFile(wasm))) }),
    network: { middlewares: [...telegramNetwork(networkMiddlewares), ({ request }) => Promise.resolve(replyToRpc(request))] },
  });
  vi.spyOn(base.mt.network, "connect").mockResolvedValue(undefined);
  const client = new TelegramClient({ client: base, disableUpdates: true });
  try {
    const sendCode = mtprotoRequest((abortSignal) => client.sendCode({ phone: "+9996621234", abortSignal }));
    expect(await Effect.runPromise(Effect.flip(sendCode))).toMatchObject({ _tag: "RateLimited", retryAfter: 2 });
    expect(loginRequests).toBe(1);
    const telegram = telegramMessages(() => Promise.resolve(client));
    const list = await Effect.runPromise(telegram.getDialogs("local-owner"));
    expect(list.dialogs[0]).toMatchObject({ peer_key: "chat:9", can_post: true });
    expect(list.chats[0]?.title).toBe("Field team");
    const first = await Effect.runPromise(telegram.getHistory("local-owner", "chat:9", { limit: 1 }));
    const older = await Effect.runPromise(telegram.getHistory("local-owner", "chat:9", { cursor: first.next_cursor, limit: 1 }));
    expect([first.messages[0]?.message, older.messages[0]?.message, older.has_more]).toEqual(["Meet at ten", "Hello", false]);
    const reply = { peer: "chat:9", message: "See you there", replyToMsgId: 2 };
    const once = await Effect.runPromise(telegram.sendMessage("local-owner", reply, "approved-reply"));
    const retry = await Effect.runPromise(telegram.sendMessage("local-owner", reply, "approved-reply"));
    expect([once.message.id, retry.message.id, sent.size]).toEqual([3, 3, 1]);
    const baseline = await Effect.runPromise(telegram.getDifference("local-owner", 0));
    const gap = await Effect.runPromise(telegram.getDifference("local-owner", baseline.state.pts));
    expect([gap.state.pts, gap.new_messages[0]?.message]).toEqual([7, "Change of plan"]);
    expect(await Effect.runPromise(Effect.flip(mtprotoRequest(() => client.getMe())))).toMatchObject({
      _tag: "AuthRevoked", code: "AUTH_KEY_DUPLICATED",
    });
  } finally {
    await client.destroy();
  }
});
