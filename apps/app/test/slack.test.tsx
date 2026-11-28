// @vitest-environment happy-dom
// spec/app/slack/index.md, "Story: Switch workspaces and browse Slack conversations with strict isolation"; spec/app/slack/auth.md, "Story: Connect and manage my Slack workspaces with user tokens only"; spec/app/slack/conversation.md, "Story: Read Slack channels and threaded replies accurately"; spec/app/slack/composer.md, "Story: Draft and send Slack messages and thread replies safely"; spec/app/slack/agent.md, "Story: Let Alpha help across my Slack workspaces safely"; spec/app/slack/notices.md, "Story: Hear about Slack DMs, mentions and thread replies per workspace"
import { type RunningProvider, startSlackProvider } from "@repo/eliza-harness";
import { Effect, Layer, ManagedRuntime, Option, Stream } from "effect";
import { FetchHttpClient } from "effect/http";
import type * as KeyValueStore from "effect/persistence/KeyValueStore";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as Shell from "../gen/app__shell.effect.vibe";
import * as Preferences from "../gen/app__settings__preferences.effect.vibe";
import { Machine as WorkspacesMachine, attention } from "../gen/app__slack.effect.vibe";
import { Machine as AgentMachine } from "../gen/app__slack__agent.effect.vibe";
import { Machine as AuthMachine, sensitive } from "../gen/app__slack__auth.effect.vibe";
import { Machine as ComposerMachine } from "../gen/app__slack__composer.effect.vibe";
import { Machine as ConversationMachine } from "../gen/app__slack__conversation.effect.vibe";
import { Machine as NoticesMachine } from "../gen/app__slack__notices.effect.vibe";
import { agentAt } from "../src/platform/agent.vibe";
import { cloudAt } from "../src/platform/cloud.vibe";
import { MessagingNotices } from "../src/platform/messaging-notices.vibe";
import { MessagingSessions, messagingSessions, tokenValue } from "../src/platform/messaging.vibe";
import { slackAt } from "../src/platform/slack.vibe";
import { slackPhone } from "./fakes/messaging.ts";
import { plugIn } from "./fakes/phone.ts";
import { plugins } from "./fakes/plugins.ts";
import { scene, services, type Scene } from "./fakes/scene.ts";
import { pagePlatform, phonePlatform } from "../src/platform/platform.vibe";
import { type Slack, assertSlackUserToken } from "../src/platform/slack.vibe";
import { together, whole } from "../src/runtime/reactor.vibe";
import { SlackScreen } from "../src/slack/Slack.tsx";
import { type PendingOAuth, SlackLedger, runWorkspaceCall, slackSessionKey, tokenForWorkspace } from "../src/slack/ledger.vibe";
import { executeSlackAgentRequest, slackAmbientSnapshot, slackBack, slackHomeCard, slackResident } from "../src/slack/resident.vibe";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SlackTestServices =
  | Shell.Machine
  | Preferences.Machine
  | AuthMachine
  | WorkspacesMachine
  | ConversationMachine
  | ComposerMachine
  | AgentMachine
  | NoticesMachine
  | SlackLedger
  | MessagingSessions
  | MessagingNotices
  | Slack
  | KeyValueStore.KeyValueStore;

interface MountedSlack {
  readonly runtime: ManagedRuntime.ManagedRuntime<SlackTestServices, unknown>;
  readonly host: HTMLDivElement;
  readonly close: () => Promise<void>;
}

let provider: RunningProvider;
const mounted: MountedSlack[] = [];

async function underAct(work: () => Promise<void> | void): Promise<void> {
  await act(async () => {
    await work();
  });
}

async function mountSlack(origin: string, phone?: Scene, options?: Parameters<typeof slackPhone>[1], openFrom: "Home" | "Slack" = "Slack"): Promise<MountedSlack> {
  const unplug = phone && plugIn({ ...plugins(phone, services(phone)), ...slackPhone(origin, options) });
  const slackLayer = Layer.provide(slackAt(origin), FetchHttpClient.layer);
  const platform = phone ? phonePlatform() : pagePlatform(
    Layer.provide(agentAt(origin), FetchHttpClient.layer),
    Layer.provide(cloudAt(origin), FetchHttpClient.layer),
    { slack: slackLayer, sessions: messagingSessions },
  );
  const appLayer = Layer.provideMerge(whole(together(slackResident, Preferences.machine(), Shell.machine())), platform);
  const runtime = ManagedRuntime.make(appLayer) as unknown as MountedSlack["runtime"];
  const host = document.body.appendChild(document.createElement("div"));
  const root: Root = createRoot(host);
  await underAct(async () => {
    root.render(<SlackScreen runtime={runtime as unknown as Parameters<typeof SlackScreen>[0]["runtime"]} />);
    if (openFrom === "Slack") await runtime.runPromise(Shell.Machine.use((m) => m.send({ type: "openView", view: "Slack" })));
    else await runtime.runPromise(Effect.void);
  });
  const handle: MountedSlack = {
    runtime,
    host,
    close: async () => {
      await underAct(() => {
        root.unmount();
      });
      host.remove();
      await runtime.dispose();
      unplug?.();
      const index = mounted.indexOf(handle);
      if (index >= 0) mounted.splice(index, 1);
    },
  };
  mounted.push(handle);
  return handle;
}

async function waitFor<S>(
  runtime: MountedSlack["runtime"],
  changes: Effect.Effect<Stream.Stream<S>, never, SlackTestServices>,
  predicate: (state: S) => boolean,
): Promise<S> {
  let matched!: S;
  await underAct(async () => {
    const found = await runtime.runPromise(
      Effect.flatMap(changes, (stream) => Stream.runHead(Stream.filter(stream, predicate))),
    );
    if (Option.isNone(found)) throw new Error("Stream ended before predicate matched");
    matched = found.value;
  });
  return matched;
}

function findButton(host: HTMLElement, label: string): HTMLButtonElement {
  const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
  const found = buttons.find((b) =>
    b.getAttribute("aria-label") === label || b.textContent?.trim() === label || b.textContent?.includes(label));
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}

async function waitForPendingOAuth(app: MountedSlack, nonce: number): Promise<PendingOAuth> {
  const ledger = await app.runtime.runPromise(Effect.flatMap(SlackLedger, (l) => Effect.succeed(l)));
  const immediate = ledger.pendingOAuth();
  if (immediate && immediate.nonce === nonce) return immediate;
  return new Promise<PendingOAuth>((resolve) => {
    const off = ledger.subscribe(() => {
      const next = ledger.pendingOAuth();
      if (next && next.nonce === nonce) {
        off();
        resolve(next);
      }
    });
  });
}

/** The ledger's number for the channel Slack calls `channel` in workspace `ws`. */
const channelNum = (app: MountedSlack, ws: number, channel: string) =>
  app.runtime.runPromise(Effect.flatMap(SlackLedger, (l) => Effect.sync(() => l.channelNum(ws, channel))));

/** Open public channel `channel` of workspace `ws` in front. */
const openChannel = (app: MountedSlack, ws: number, channel: number) => underAct(async () => {
  await app.runtime.runPromise(Effect.flatMap(ConversationMachine, (m) => m.send({ type: "openChannel", workspace: ws, channel, kind: "PublicChannel", front: true })));
});

/** Open public channel `channel` of workspace `ws` in front with the composer aimed at it, and wait for its newest messages. */
async function composeIn(app: MountedSlack, ws: number, channel: number) {
  await underAct(async () => {
    await app.runtime.runPromise(Effect.flatMap(ConversationMachine, (m) => m.send({ type: "openChannel", workspace: ws, channel, kind: "PublicChannel", front: true })));
    await app.runtime.runPromise(Effect.flatMap(ComposerMachine, (m) => m.send({ type: "openTarget", workspace: ws, channel, threadTs: 0 }, "Owner")));
  });
  await waitFor(app.runtime, Effect.map(ConversationMachine, (m) => m.changes), (s) => s.channel === channel && s.newestLoaded);
}

/** Mute `channel`. */
const muteChannel = (app: MountedSlack, channel: number) => underAct(async () => {
  await app.runtime.runPromise(Effect.flatMap(WorkspacesMachine, (m) => m.send({ type: "toggleMute", channel, muted: true })));
});

async function returnWorkspaceConsent(app: MountedSlack, teamId: string): Promise<void> {
  await underAct(async () => {
    await app.runtime.runPromise(Effect.flatMap(SlackLedger, (ledger) => Effect.sync(() => ledger.setPendingTeam(teamId))));
    await app.runtime.runPromise(Effect.flatMap(AuthMachine, (m) => m.send({ type: "startConnect" })));
  });
  expect(app.host.textContent).toContain("Review Slack user scopes");
  expect(app.host.textContent).toContain("User account · no bot token");
  const authBeforeApprove = await app.runtime.runPromise(Effect.flatMap(AuthMachine, (m) => m.get()));
  expect(sensitive(authBeforeApprove)).toBe(true);

  await underAct(() => {
    findButton(app.host, "Approve & connect").click();
  });
  const browserAuth = await waitFor(app.runtime, Effect.map(AuthMachine, (m) => m.changes), (s) => s.step === "BrowserOAuth");
  const pending = await waitForPendingOAuth(app, browserAuth.nonce);
  expect(pending.authorizeUrl).toContain("user_scope=");
  expect(pending.authorizeUrl).not.toContain("&scope=");
  expect(pending.authorizeUrl).toContain("code_challenge_method=S256");

  const authRes = await fetch(`${pending.authorizeUrl}&auto_approve=1`, { redirect: "manual" });
  expect(authRes.status).toBe(302);
  const location = authRes.headers.get("location") ?? "";
  const callbackUrl = new URL(location);
  const code = callbackUrl.searchParams.get("code") ?? "";
  const state = callbackUrl.searchParams.get("state") ?? "";
  expect(code).not.toBe("");
  expect(state).toBe(pending.state);

  await underAct(() => {
    const channel = new BroadcastChannel("alpha-slack-oauth");
    channel.postMessage({ state, code, error: "" });
    channel.close();
  });
}

async function connectWorkspaceViaPkce(app: MountedSlack, teamId: string): Promise<number> {
  await returnWorkspaceConsent(app, teamId);
  const authAfter = await waitFor(
    app.runtime,
    Effect.map(AuthMachine, (m) => m.changes),
    (s) => s.step === "Idle" && s.connected.length > 0 && s.trouble === "Fine",
  );
  const meta = await app.runtime.runPromise(Effect.flatMap(SlackLedger, (ledger) => Effect.sync(() => ledger.workspaceByTeamId(teamId))));
  expect(meta).toBeDefined();
  const wsNum = meta?.num ?? 0;
  expect(authAfter.connected.some((w) => w.workspace === wsNum && w.tokenKind === "UserToken")).toBe(true);
  await waitFor(
    app.runtime,
    Effect.map(WorkspacesMachine, (m) => m.changes),
    (s) => s.connected.some((w) => w.workspace === wsNum) && s.list.status === "Loaded",
  );
  return wsNum;
}

async function controlPost(path: string, body: Record<string, unknown> = {}): Promise<unknown> {
  const res = await fetch(`${provider.origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function controlRequests(path: string): Promise<ReadonlyArray<{ readonly path: string; readonly method: string; readonly headers: Record<string, string>; readonly body?: unknown }>> {
  const res = await fetch(`${provider.origin}/__control/requests?path=${encodeURIComponent(path)}`);
  const json = await res.json() as { readonly requests: ReadonlyArray<{ readonly path: string; readonly method: string; readonly headers: Record<string, string>; readonly body?: unknown }> };
  return json.requests;
}

beforeAll(async () => {
  provider = await startSlackProvider();
});

afterEach(async () => {
  for (const app of mounted.splice(0)) await app.close();
  localStorage.clear();
  await controlPost("/__control/reset");
});

afterAll(async () => {
  await provider.stop();
});

describe("Slack user-account client over live HTTP provider", () => {
  // spec/app/slack/auth.md, "Adding a workspace presents scope consent first, then opens PKCE OAuth with a fresh state nonce"; spec/app/slack/auth.md, "OAuth callback verifies the state nonce and exchanges the secret code and PKCE verifier; only user tokens (`UserToken`) are admitted"; spec/app/slack/auth.md, "Bot tokens are never admitted into connected workspaces, and per-workspace sign-out preserves all other workspaces"
  it("completes scope consent and real PKCE OAuth2 user flow for two workspaces and strictly rejects bot tokens", async () => {
    const app = await mountSlack(provider.origin);
    expect(app.host.textContent).toContain("Connect Slack");
    expect(app.host.textContent).toContain("User account · no bot token");

    const alphaWs = await connectWorkspaceViaPkce(app, "T01ALPHA");
    const designWs = await connectWorkspaceViaPkce(app, "T02DESIGN");
    expect(alphaWs).not.toBe(designWs);

    const alphaSecret = await app.runtime.runPromise(Effect.flatMap(MessagingSessions, (s) => s.get(slackSessionKey("T01ALPHA"))));
    const designSecret = await app.runtime.runPromise(Effect.flatMap(MessagingSessions, (s) => s.get(slackSessionKey("T02DESIGN"))));
    expect(Option.isSome(alphaSecret)).toBe(true);
    expect(Option.isSome(designSecret)).toBe(true);
    expect(JSON.stringify(localStorage)).not.toContain("xoxp-");

    const botCheck = await app.runtime.runPromiseExit(assertSlackUserToken("xoxb-disallowed-bot-token"));
    expect(botCheck._tag).toBe("Failure");
    const botScopeRes = await fetch(`${provider.origin}/oauth/v2/authorize?client_id=alpha&scope=chat:write&redirect_uri=alphaphone://cb&state=s1`);
    expect(botScopeRes.status).toBe(400);

    await controlPost("/__control/fault", { path: "/api/slack/oauth", status: 200, remaining: 1, body: {
      ok: true, app_id: "A1", team: { id: "T01ALPHA", name: "Alpha" },
      authed_user: { id: "U1", scope: "chat:write", token_type: "bot", access_token: "xoxb-disallowed-bot-token" },
    } });
    await returnWorkspaceConsent(app, "T01ALPHA");
    const authAfterBot = await waitFor(app.runtime, AuthMachine.use((m) => Effect.succeed(m.changes)), (s) => s.step === "Idle" && s.trouble === "BotTokenRejected");
    expect(authAfterBot.trouble).toBe("BotTokenRejected");
    expect(authAfterBot.connected.length).toBe(2);
    expect(authAfterBot.connected.every((w) => w.tokenKind === "UserToken")).toBe(true);
  });

  it('links a workspace through the phone browser, renews its grant and reads a channel (spec/app/slack/auth.md, "Story: Connect and manage my Slack workspaces with user tokens only")', async () => {
    const phone = { ...scene(), phone: true };
    const app = await mountSlack(provider.origin, phone, { initialExpirySeconds: 1 });
    await underAct(() => findButton(app.host, "Connect workspace").click());
    await underAct(() => findButton(app.host, "Approve & connect").click());
    const workspace = await waitFor(app.runtime, WorkspacesMachine.use((m) => Effect.succeed(m.changes)), (s) => s.list.status === "Loaded");
    const key = slackSessionKey("T01ALPHA");
    const general = await channelNum(app, workspace.selected.workspace, "C01GENERAL");
    await controlPost("/__control/fault", { path: "/api/conversations.history", status: 200, remaining: 1, body: {
      ok: true, messages: [{ type: "message", subtype: "bot_message", bot_id: "B1", username: "Release bot", ts: "1730000123.100000", text: "Release passed" }],
    } });
    await composeIn(app, workspace.selected.workspace, general);
    const after = await app.runtime.runPromise(MessagingSessions.use((s) => s.get(key)));
    if (Option.isNone(after)) throw new Error("No renewed Slack user");
    const grants = (await controlRequests("/api/slack/oauth")).map((request) => request.body);
    expect(grants).toHaveLength(2);
    expect(grants[0]).toHaveProperty("code_verifier");
    expect(grants[1]).toMatchObject({ grant_type: "refresh_token" });
    expect(after.value.workspace?.teamId).toBe("T01ALPHA");
    expect(app.host.textContent).toContain("Release bot");
    expect(app.host.textContent).toContain("Release passed");
    expect(app.host.textContent).toContain("general");
    const ownerOrganization = phone.voice.organizationId;
    phone.voice.organizationId = "different-live-org";
    await underAct(() => phone.voice.signedInHere?.());
    await waitFor(app.runtime, AuthMachine.use((m) => Effect.succeed(m.changes)), (s) => s.connected.length === 0);
    await vi.waitFor(() => expect(app.host.textContent).not.toContain("general"));
    phone.voice.organizationId = ownerOrganization;
    await underAct(() => phone.voice.signedInHere?.());
    await waitFor(app.runtime, WorkspacesMachine.use((m) => Effect.succeed(m.changes)), (s) => s.list.status === "Loaded" && s.selected.workspace !== workspace.selected.workspace);
    await app.close();

    phone.voice.organizationId = "other-owner-org";
    const other = await mountSlack(provider.origin, phone, { initialExpirySeconds: 1 });
    expect(await other.runtime.runPromise(MessagingSessions.use((s) => s.keys()))).toEqual([]);
    expect((await other.runtime.runPromise(AuthMachine.use((m) => m.get()))).connected).toEqual([]);
    await controlPost("/__control/fault", { path: "/.well-known/alpha-slack", status: 200, remaining: 1, body: { clientId: "123.456" } });
    await underAct(() => findButton(other.host, "Connect workspace").click());
    await underAct(() => findButton(other.host, "Approve & connect").click());
    await waitFor(other.runtime, WorkspacesMachine.use((m) => Effect.succeed(m.changes)), (s) => s.list.status === "Loaded");
    const direct = await other.runtime.runPromise(MessagingSessions.use((s) => s.get(key)));
    expect(Option.map(direct, (grant) => grant.workspace?.brokered)).toEqual(Option.some(false));
    const directGrants = (await controlRequests("/api/oauth.v2.access")).map((request) => request.body);
    expect(directGrants).toHaveLength(2);
    expect(directGrants[0]).toHaveProperty("code_verifier");
    expect(directGrants[1]).toMatchObject({ grant_type: "refresh_token" });
    await other.close();

    phone.voice.organizationId = ownerOrganization;
    const reopened = await mountSlack(provider.origin, phone);
    const restored = await waitFor(reopened.runtime, WorkspacesMachine.use((m) => Effect.succeed(m.changes)), (s) => s.list.status === "Loaded");
    expect(restored.selected.workspace).toBeGreaterThan(0);
    const reopenedSecret = await reopened.runtime.runPromise(MessagingSessions.use((s) => s.get(key)));
    expect(Option.map(reopenedSecret, tokenValue)).toEqual(Option.some(tokenValue(after.value)));
    expect(reopened.host.textContent).toContain("general");
    await reopened.close();

    phone.voice.organizationId = "pending-owner";
    const switched = await mountSlack(provider.origin, phone, { beforeReturn: () => { phone.voice.organizationId = "cancelled-owner-org"; } });
    await underAct(() => findButton(switched.host, "Connect workspace").click());
    await underAct(() => findButton(switched.host, "Approve & connect").click());
    const refused = await waitFor(switched.runtime, AuthMachine.use((m) => Effect.succeed(m.changes)), (s) => s.step === "Idle" && s.trouble === "ExchangeFailed");
    expect(refused.connected).toEqual([]);
    expect(await switched.runtime.runPromise(MessagingSessions.use((s) => s.keys()))).toEqual([]);
    expect((await controlRequests("/api/slack/oauth")).length).toBe(grants.length);
  });

  it('opens the exact Slack thread from the Android tray after a cold start and keeps syncing without permission (spec/app/slack/notices.md, "Story: Hear about Slack DMs, mentions and thread replies per workspace")', async () => {
    const phone = { ...scene(), phone: true };
    const app = await mountSlack(provider.origin, phone);
    await underAct(() => findButton(app.host, "Connect workspace").click());
    await underAct(() => findButton(app.host, "Approve & connect").click());
    const ready = await waitFor(app.runtime, WorkspacesMachine.use((m) => Effect.succeed(m.changes)), (s) => s.list.status === "Loaded");
    const workspace = ready.selected.workspace;
    const notices = NoticesMachine.use((m) => Effect.succeed(m.changes));
    const baseline = await waitFor(app.runtime, notices, (s) => (s.watermarks[workspace] ?? 0) > 0);
    expect(baseline.notifyAllowed).toBe(false);
    const channel = await channelNum(app, workspace, "C01GENERAL");
    const ledger = await app.runtime.runPromise(SlackLedger);
    const incoming = { team_id: "T01ALPHA", channel: "C01GENERAL", user: "U02MAYA" };
    const denied = "<@U01OWNER> while notices are off";
    await controlPost("/__control/inject", { ...incoming, text: denied });
    await waitFor(app.runtime, notices, (s) => s.watermarks[workspace] > baseline.watermarks[workspace]);
    expect(ledger.channelMessagesOf(workspace, channel).some((message) => message.text === denied)).toBe(true);
    expect(phone.messagingNotices.posted()).toEqual([]);

    await underAct(() => findButton(app.host, "Enable Slack notifications").click());
    await waitFor(app.runtime, notices, (s) => s.notifyAllowed);
    await controlPost("/__control/inject", { ...incoming, channel: "G01LAUNCH", text: "<@U01OWNER> from a former private channel" });
    const thread = "1730000100.000100";
    await controlPost("/__control/inject", { ...incoming, thread_ts: thread, text: "<@U01OWNER> please review this thread" });
    await waitFor(app.runtime, notices, (s) => s.up.length === 2);
    await vi.waitFor(() => expect(phone.messagingNotices.posted()).toHaveLength(2));
    const deniedChannel = phone.messagingNotices.posted().find((item) => item.target.provider === "slack" && item.target.channel === "G01LAUNCH");
    if (!deniedChannel) throw new Error("Missing private-channel notice");
    await controlPost("/__control/fault", { path: "/api/conversations.info", status: 200, remaining: 1, body: { ok: false, error: "channel_not_found" } });
    await underAct(() => { expect(phone.messagingNotices.tap(deniedChannel.token)).toBe(true); });
    await vi.waitFor(() => expect(phone.messagingNotices.pending()).toBeUndefined());
    expect((await app.runtime.runPromise(ConversationMachine.use((m) => m.get()))).channel).toBe(0);
    expect(ledger.noticesList().some((notice) => notice.destination.channel === "G01LAUNCH")).toBe(false);
    const [posted] = phone.messagingNotices.posted();
    expect(posted.target.scope).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(posted.target).toMatchObject({ provider: "slack", workspace: "T01ALPHA", channel: "C01GENERAL", thread });
    expect(posted.body).toContain("please review this thread");
    await app.close();
    expect(phone.messagingNotices.tap(posted.token)).toBe(true);
    const reopened = await mountSlack(provider.origin, phone, undefined, "Home");
    const view = await waitFor(reopened.runtime, ConversationMachine.use((m) => Effect.succeed(m.changes)), (s) => s.threadTs > 0 && s.threadRead.status === "Loaded");
    expect(Shell.showing(await reopened.runtime.runPromise(Shell.Machine.use((m) => m.get())), "Slack")).toBe(true);
    const restored = await reopened.runtime.runPromise(SlackLedger);
    expect(restored.workspaceMeta(view.workspace)?.teamId).toBe("T01ALPHA");
    expect(restored.channelId(view.workspace, view.channel)).toBe("C01GENERAL");
    expect(restored.tsStr(view.workspace, view.channel, view.threadTs)).toBe(thread);
    expect(reopened.host.textContent).toContain("please review this thread");
    expect(phone.messagingNotices.pending()).toBeUndefined();
    expect(phone.messagingNotices.tap(posted.token)).toBe(false);
    const matching = MessagingNotices.use((host) => host.post(posted.target, posted.title, posted.body));
    expect(await reopened.runtime.runPromise(matching)).toBe(false);
    await underAct(async () => { await reopened.runtime.runPromise(Shell.Machine.use((m) => m.send({ type: "goHome" }))); });
    await waitFor(reopened.runtime, notices, (s) => s.front.workspace === 0);
    await vi.waitFor(async () => expect(await reopened.runtime.runPromise(matching)).toBe(true));
    await reopened.runtime.runPromise(MessagingNotices.use((host) => host.withdraw(posted.target)));

    await waitFor(reopened.runtime, notices, (s) => (s.watermarks[view.workspace] ?? 0) > 0);
    await controlPost("/__control/inject", { ...incoming, channel: "C02ENG", text: "<@U01OWNER> former account only" });
    await vi.waitFor(() => expect(phone.messagingNotices.posted()).toHaveLength(1), { timeout: 8000 });
    const [former] = phone.messagingNotices.posted();
    expect(former.body).toContain("former account only");
    const engineering = await channelNum(reopened, view.workspace, "C02ENG");
    const earlier = restored.channelMessagesOf(view.workspace, engineering).find((message) => message.text.includes("former account only"));
    if (!earlier) throw new Error("The private update did not reach the first Slack session");
    await reopened.close();
    const currentMessage = "Updated engineering announcement";
    expect(await controlPost("/__control/inject", { ...incoming, channel: "C02ENG", kind: "edit", ts: earlier.ts, text: currentMessage })).toMatchObject({ ok: true, message: { ts: earlier.ts, text: currentMessage } });
    const sibling = await mountSlack(provider.origin, { ...phone, messagingNotices: scene().messagingNotices });
    const before = await waitFor(sibling.runtime, AuthMachine.use((m) => Effect.succeed(m.changes)), (s) => s.connected.length === 1);
    await underAct(async () => { await sibling.runtime.runPromise(AuthMachine.use((m) => m.send({ type: "startConnect" }))); });
    await underAct(() => findButton(sibling.host, "Approve & connect").click());
    await waitFor(sibling.runtime, AuthMachine.use((m) => Effect.succeed(m.changes)), (s) => s.connected[0]?.credentialRev > before.connected[0].credentialRev);
    await waitFor(sibling.runtime, WorkspacesMachine.use((m) => Effect.succeed(m.changes)), (s) => s.list.status === "Loaded" && s.connected[0]?.credentialRev > before.connected[0].credentialRev);
    await sibling.close();
    expect(phone.messagingNotices.tap(former.token)).toBe(true);
    const reauthorized = await mountSlack(provider.origin, phone, undefined, "Home");
    await vi.waitFor(() => expect(phone.messagingNotices.pending()).toBeUndefined());
    expect((await reauthorized.runtime.runPromise(ConversationMachine.use((m) => m.get()))).channel).toBe(0);
    expect(Shell.showing(await reauthorized.runtime.runPromise(Shell.Machine.use((m) => m.get())), "Slack")).toBe(false);
    await waitFor(reauthorized.runtime, WorkspacesMachine.use((m) => Effect.succeed(m.changes)), (s) => s.list.status === "Loaded");
    await vi.waitFor(() => expect(reauthorized.host.textContent).toContain(currentMessage));
    expect(reauthorized.host.textContent).not.toContain("former account only");
  }, 40_000);

  it('keeps a workspace connected across two phone runtimes when an old grant is refused during renewal (spec/app/slack/auth.md, "Story: Connect and manage my Slack workspaces with user tokens only")', async () => {
    const phone = { ...scene(), phone: true };
    const first = await mountSlack(provider.origin, phone);
    await underAct(() => findButton(first.host, "Connect workspace").click());
    await underAct(() => findButton(first.host, "Approve & connect").click());
    await waitFor(first.runtime, WorkspacesMachine.use((m) => Effect.succeed(m.changes)), (s) => s.list.status === "Loaded");
    const delayed = Promise.withResolvers<void>();
    const deliver = Promise.withResolvers<void>();
    const rotating = Promise.withResolvers<void>();
    const rotated = Promise.withResolvers<void>();
    const second = await mountSlack(provider.origin, phone, { beforeReply: async (path, body) => {
      if (path === "/api/auth.test" && body.includes("token_revoked")) {
        delayed.resolve();
        await deliver.promise;
      }
      if (path === "/api/slack/oauth" && body.includes("access_token")) {
        rotating.resolve();
        await rotated.promise;
      }
    } });
    try {
      const state = await waitFor(second.runtime, WorkspacesMachine.use((m) => Effect.succeed(m.changes)), (s) => s.list.status === "Loaded");
      const workspace = state.selected.workspace;
      const key = slackSessionKey("T01ALPHA");
      const grant = await first.runtime.runPromise(MessagingSessions.use((sessions) => sessions.get(key)));
      if (Option.isNone(grant)) throw new Error("No Slack user grant");
      const old = tokenValue(grant.value);
      await controlPost("/__control/fault", { path: "/api/auth.test", status: 401, remaining: 1, body: { ok: false, error: "token_revoked" } });
      const stale = first.runtime.runPromise(runWorkspaceCall(workspace, (client, token) => client.authTest(token)));
      await delayed.promise;
      const renewal = first.runtime.runPromise(tokenForWorkspace(workspace, old));
      await rotating.promise;
      const concurrent = second.runtime.runPromise(tokenForWorkspace(workspace, old));
      rotated.resolve();
      const [one, two] = await Promise.all([renewal, concurrent]);
      deliver.resolve();
      expect(one).toBeTruthy();
      expect(one).toEqual(two);
      expect(one).not.toBe(old);
      expect(await stale).toMatchObject({ ok: false, failure: "Unreachable" });
      const grants = await controlRequests("/api/slack/oauth");
      expect(grants.filter((request) => request.body !== null && typeof request.body === "object" && "grant_type" in request.body && request.body.grant_type === "refresh_token")).toHaveLength(1);
      const current = await first.runtime.runPromise(MessagingSessions.use((sessions) => sessions.get(key)));
      expect(Option.map(current, tokenValue)).toEqual(Option.some(one));
      await controlPost("/__control/fault", { path: "/api/auth.test", status: 401, remaining: 1, body: { ok: false, error: "token_expired" } });
      const accessible = await second.runtime.runPromise(runWorkspaceCall(workspace, (client, token) => client.authTest(token)));
      expect(accessible).toMatchObject({ ok: true, value: { team_id: "T01ALPHA" } });
      expect((await controlRequests("/api/slack/oauth")).length).toBe(grants.length + 1);
      expect((await first.runtime.runPromise(AuthMachine.use((m) => m.get()))).connected).toHaveLength(1);
    } finally {
      rotated.resolve();
      deliver.resolve();
      await second.close();
    }
  });

  // spec/app/slack/index.md, "Switching workspace, choosing a section, searching or refreshing reads the first page under a new ticket"; spec/app/slack/conversation.md, "Opening a channel reads its newest history; opening a thread drawer pins its parent and reads thread replies independently"; spec/app/slack/conversation.md, "Edit, reviewed delete and emoji reactions execute one attempt at a time with honest outcomes"; spec/app/slack/composer.md, "Only the owner's tap sends; Unknown outcomes reconcile via read-back only"
  it("switches workspaces with strict isolation, searches, opens threads with broadcast send, edits, deletes with review, reacts, marks read, and mutes", async () => {
    const app = await mountSlack(provider.origin);
    const alphaWs = await connectWorkspaceViaPkce(app, "T01ALPHA");
    const designWs = await connectWorkspaceViaPkce(app, "T02DESIGN");

    expect(app.host.textContent).toContain("general");
    expect(app.host.textContent).toContain("engineering");
    expect(app.host.textContent).toContain("Maya Chen");
    expect(app.host.textContent).not.toContain("critique");

    await underAct(async () => {
      await app.runtime.runPromise(Effect.flatMap(WorkspacesMachine, (m) => m.send({ type: "switchWorkspace", workspace: designWs })));
    });
    await waitFor(app.runtime, Effect.map(WorkspacesMachine, (m) => m.changes), (s) => s.selected.workspace === designWs && s.list.status === "Loaded");
    expect(app.host.textContent).toContain("critique");
    expect(app.host.textContent).toContain("Sora Takahashi");
    expect(app.host.textContent).not.toContain("engineering");

    await underAct(async () => {
      await app.runtime.runPromise(Effect.flatMap(WorkspacesMachine, (m) => m.send({ type: "switchWorkspace", workspace: alphaWs })));
    });
    await waitFor(app.runtime, Effect.map(WorkspacesMachine, (m) => m.changes), (s) => s.selected.workspace === alphaWs && s.list.status === "Loaded");

    await underAct(async () => {
      await app.runtime.runPromise(Effect.flatMap(WorkspacesMachine, (m) => m.send({ type: "search", query: "in:#engineering backoff" })));
    });
    await waitFor(app.runtime, Effect.map(WorkspacesMachine, (m) => m.changes), (s) => s.selected.query === "in:#engineering backoff" && s.list.status === "Loaded");
    expect(app.host.textContent).toContain("retry backoff PR");

    await underAct(async () => {
      await app.runtime.runPromise(Effect.flatMap(WorkspacesMachine, (m) => m.send({ type: "search", query: "from:@maya" })));
    });
    await waitFor(app.runtime, Effect.map(WorkspacesMachine, (m) => m.changes), (s) => s.selected.query === "from:@maya" && s.list.status === "Loaded");
    expect(app.host.textContent).toContain("Sprint review kicks off");

    await underAct(async () => {
      await app.runtime.runPromise(Effect.flatMap(WorkspacesMachine, (m) => m.send({ type: "chooseSection", section: "AllConversations" })));
    });
    await waitFor(app.runtime, Effect.map(WorkspacesMachine, (m) => m.changes), (s) => s.selected.query === "" && s.list.status === "Loaded");

    const generalNum = await channelNum(app, alphaWs, "C01GENERAL");
    const engNum = await channelNum(app, alphaWs, "C02ENG");

    await composeIn(app, alphaWs, generalNum);
    expect(app.host.textContent).toContain("Sprint review kicks off at 2pm today.");
    expect(app.host.textContent).toContain("2 replies");

    await underAct(() => {
      findButton(app.host, "2 replies").click();
    });
    await waitFor(app.runtime, Effect.map(ConversationMachine, (m) => m.changes), (s) => s.threadTs > 0 && s.threadLoaded);
    expect(app.host.textContent).toContain("I will share the latency benchmarks right before.");
    expect(app.host.textContent).toContain("Design slides are linked in the doc.");

    const convInThread = await app.runtime.runPromise(Effect.flatMap(ConversationMachine, (m) => m.get()));
    await waitFor(app.runtime, Effect.map(ComposerMachine, (m) => m.changes), (s) => s.active.threadTs === convInThread.threadTs);
    await underAct(async () => {
      await app.runtime.runPromise(Effect.flatMap(ComposerMachine, (m) => m.send({ type: "toggleBroadcast", on: true }, "Owner")));
      await app.runtime.runPromise(Effect.flatMap(SlackLedger, (l) => Effect.sync(() => l.setDraftText({ workspace: alphaWs, channel: generalNum, threadTs: convInThread.threadTs }, "Joining with updated metrics!"))));
      await app.runtime.runPromise(Effect.flatMap(ComposerMachine, (m) => m.send({ type: "typeDraft", empty: false }, "Owner")));
      await app.runtime.runPromise(Effect.flatMap(ComposerMachine, (m) => m.send({ type: "send" }, "Owner")));
    });
    await waitFor(app.runtime, Effect.map(ComposerMachine, (m) => m.changes), (s) => s.sendOp.outcome === "Confirmed");
    const postReqs = await controlRequests("/api/chat.postMessage");
    expect(postReqs.length).toBeGreaterThanOrEqual(1);
    const lastPost = postReqs.at(-1);
    expect(lastPost?.headers["idempotency-key"]).toBeTruthy();
    expect(lastPost?.body).toMatchObject({ channel: "C01GENERAL", text: "Joining with updated metrics!", reply_broadcast: true });

    await underAct(async () => {
      expect(await app.runtime.runPromise(slackBack)).toBe(true);
      expect(await app.runtime.runPromise(slackBack)).toBe(true);
    });
    await waitFor(app.runtime, Effect.map(ConversationMachine, (m) => m.changes), (s) => s.channel === 0 && s.threadTs === 0);

    await openChannel(app, alphaWs, engNum);
    await waitFor(app.runtime, Effect.map(ConversationMachine, (m) => m.changes), (s) => s.channel === engNum && s.newestLoaded);
    const markReqs = await controlRequests("/api/conversations.mark");
    expect(markReqs.some((r) => (r.body as { readonly channel?: string } | undefined)?.channel === "C02ENG")).toBe(true);

    const ownTsNum = await app.runtime.runPromise(Effect.flatMap(SlackLedger, (l) => Effect.sync(() => l.tsNum(alphaWs, engNum, "1730000200.000100"))));
    await underAct(async () => {
      await app.runtime.runPromise(Effect.flatMap(SlackLedger, (l) => Effect.sync(() => l.setPendingEdit(alphaWs, engNum, ownTsNum, "Shipping the new HTTP client layer today (updated)."))));
      await app.runtime.runPromise(Effect.flatMap(ConversationMachine, (m) => m.send({ type: "startEdit", ts: ownTsNum })));
    });
    await waitFor(app.runtime, Effect.map(ConversationMachine, (m) => m.changes), (s) => s.opKind === "EditMsg" && s.op.outcome === "Confirmed");
    expect(app.host.textContent).toContain("Shipping the new HTTP client layer today (updated).");
    expect(app.host.textContent).toContain("edited");

    await underAct(async () => {
      await app.runtime.runPromise(Effect.flatMap(ConversationMachine, (m) => m.send({ type: "toggleReact", ts: ownTsNum, emoji: "thumbsup", add: true })));
    });
    await waitFor(app.runtime, Effect.map(ConversationMachine, (m) => m.changes), (s) => s.opKind === "ToggleReact" && s.op.outcome === "Confirmed");
    expect((await controlRequests("/api/reactions.add")).length).toBe(1);

    await underAct(async () => {
      await app.runtime.runPromise(Effect.flatMap(ConversationMachine, (m) => m.send({ type: "askDelete", ts: ownTsNum })));
    });
    await waitFor(app.runtime, Effect.map(ConversationMachine, (m) => m.changes), (s) => s.deleteReview.showing);
    expect((await controlRequests("/api/chat.delete")).length).toBe(0);
    await underAct(async () => {
      await app.runtime.runPromise(Effect.flatMap(ConversationMachine, (m) => m.send({ type: "confirmDelete" })));
    });
    await waitFor(app.runtime, Effect.map(ConversationMachine, (m) => m.changes), (s) => s.opKind === "DeleteMsg" && s.op.outcome === "Confirmed");
    expect((await controlRequests("/api/chat.delete")).length).toBe(1);
    expect(app.host.textContent).not.toContain("Shipping the new HTTP client layer today (updated).");

    await muteChannel(app, engNum);
    await waitFor(app.runtime, Effect.map(WorkspacesMachine, (m) => m.changes), (s) => s.mutedChannels.includes(engNum));
    expect(findButton(app.host, "Unmute Alpha notifications")).toBeDefined();
  });

  // spec/app/slack/agent.md, "Ambient context is emitted ONLY for a connected workspace when non-sensitive and allowed by `SlackContext`, bounded to 15 messages and 6000 characters, with zero secrets"; spec/app/slack/agent.md, "Workspace-scoped direct reads and staged drafts never mutate state or send"; spec/app/slack/notices.md, "Own, muted and currently visible front target messages are suppressed; DMs, channel mentions and participated thread replies trigger"
  it("gates Ask Alpha ambient context, stages drafts without sending, handles 429 Retry-After, and reads live notices with mute suppression", async () => {
    const app = await mountSlack(provider.origin);
    expect(await app.runtime.runPromise(slackAmbientSnapshot)).toBeUndefined();

    const alphaWs = await connectWorkspaceViaPkce(app, "T01ALPHA");
    const generalNum = await channelNum(app, alphaWs, "C01GENERAL");
    const engNum = await channelNum(app, alphaWs, "C02ENG");

    await composeIn(app, alphaWs, generalNum);

    await waitFor(app.runtime, Effect.map(AgentMachine, (m) => m.changes), (s) => s.pane === "ChannelPane" && !s.shareAllowed);
    expect(await app.runtime.runPromise(slackAmbientSnapshot)).toBeUndefined();

    await underAct(async () => {
      await app.runtime.runPromise(Effect.flatMap(Preferences.Machine, (m) => m.send({ type: "start", at: 1, kept: "Light", keptLegible: false, readable: true, look: "LightLook" }, "Phone")));
      const prefState = await app.runtime.runPromise(Effect.flatMap(Preferences.Machine, (m) => m.get()));
      await app.runtime.runPromise(Effect.flatMap(Preferences.Machine, (m) => m.send({
        type: "documentRead",
        docRead: prefState.document.read.ticket,
        readable: true,
        askFirst: false,
        images: true,
        shares: ["SlackContext"],
      }, "Phone")));
    });
    await waitFor(app.runtime, Effect.map(AgentMachine, (m) => m.changes), (s) => s.pane === "ChannelPane" && s.shareAllowed);
    const ambient = await app.runtime.runPromise(slackAmbientSnapshot);
    expect(ambient).toBeDefined();
    expect(ambient?.workspaceId).toBe("T01ALPHA");
    expect(ambient?.channelId).toBe("C01GENERAL");
    expect(ambient?.messages.length).toBeLessThanOrEqual(15);
    expect(ambient?.charCount).toBeLessThanOrEqual(6000);
    expect(JSON.stringify(ambient)).not.toContain("xoxp-");

    const wsRead = await app.runtime.runPromise(executeSlackAgentRequest({ type: "SlackListWorkspaces" }));
    expect(wsRead.ok).toBe(true);

    const postsBeforeDraft = (await controlRequests("/api/chat.postMessage")).length;
    await underAct(async () => {
      const staged = await app.runtime.runPromise(executeSlackAgentRequest({
        type: "SlackDraftMessage",
        turn: 1,
        workspace: alphaWs,
        channel: generalNum,
        text: "Drafted by Alpha — ready for your review.",
      }));
      expect(staged).toMatchObject({ ok: true, kind: "draft-staged" });
    });
    await waitFor(app.runtime, Effect.map(ComposerMachine, (m) => m.changes), (s) => s.slot.author === "AlphaWrote");
    expect(app.host.textContent).toContain("Alpha's draft · not sent");
    expect(app.host.textContent).toContain("Drafted by Alpha — ready for your review.");
    expect((await controlRequests("/api/chat.postMessage")).length).toBe(postsBeforeDraft);

    await underAct(() => {
      findButton(app.host, "Send").click();
    });
    await waitFor(app.runtime, Effect.map(ComposerMachine, (m) => m.changes), (s) => s.sendOp.outcome === "Confirmed");
    const postReqs = await controlRequests("/api/chat.postMessage");
    expect(postReqs.length).toBe(postsBeforeDraft + 1);
    expect(postReqs.at(-1)?.headers["idempotency-key"]).toBeTruthy();

    await controlPost("/__control/fault", { path: "/api/conversations.history", status: 429, retryAfter: 7, remaining: 1 });
    await openChannel(app, alphaWs, engNum);
    await waitFor(app.runtime, Effect.map(ConversationMachine, (m) => m.changes), (s) => s.channel === engNum && s.channelRead.status === "Failed");
    expect(app.host.textContent).toContain("Rate limited — retry after 7s");

    await muteChannel(app, engNum);
    await waitFor(app.runtime, Effect.map(NoticesMachine, (m) => m.changes), (s) => s.mutedChannels.includes(engNum) && (s.watermarks[alphaWs] ?? 0) > 0);

    await controlPost("/__control/inject", {
      team_id: "T01ALPHA",
      channel: "C02ENG",
      user: "U03DEVON",
      text: "<@U01OWNER> muted channel ping",
    });
    await controlPost("/__control/inject", {
      team_id: "T01ALPHA",
      channel: "C01GENERAL",
      user: "U02MAYA",
      text: "<@U01OWNER> live mention in general!",
    });
    const noticed = await waitFor(
      app.runtime,
      Effect.map(NoticesMachine, (m) => m.changes),
      (s) => s.up.some((p) => p.target.workspace === alphaWs && p.target.channel === generalNum),
    );
    expect(noticed.up.some((p) => p.target.channel === engNum)).toBe(false);
    expect(noticed.up.some((p) => p.target.channel === generalNum)).toBe(true);
    await vi.waitFor(() => expect(findButton(app.host, "live mention in general!")).toBeDefined());
    await underAct(() => findButton(app.host, "live mention in general!").click());
    await waitFor(app.runtime, Effect.map(ConversationMachine, (m) => m.changes), (s) => s.workspace === alphaWs && s.channel === generalNum && s.threadTs === 0 && s.newestLoaded);
    await vi.waitFor(() => expect([...app.host.querySelectorAll("button")].some((button) => button.textContent?.includes("live mention in general!"))).toBe(false));


    const card = await app.runtime.runPromise(slackHomeCard);
    expect(card.standing).toBe("Ready");
  });

  // spec/app/slack/auth.md, "Revoking or signing out one workspace wipes only that workspace and leaves other workspaces connected"; spec/app/slack/notices.md, "Per-workspace isolation, baseline gating, withdrawal on visible read and isolated workspace revocation"
  it("isolates per-workspace revocation to the revoked workspace and calls auth.revoke on explicit sign-out", async () => {
    const app = await mountSlack(provider.origin);
    const alphaWs = await connectWorkspaceViaPkce(app, "T01ALPHA");
    const designWs = await connectWorkspaceViaPkce(app, "T02DESIGN");

    await waitFor(
      app.runtime,
      Effect.map(NoticesMachine, (m) => m.changes),
      (s) => s.connected.includes(alphaWs) && s.connected.includes(designWs) && (s.watermarks[alphaWs] ?? 0) > 0,
    );

    const generalNum = await channelNum(app, alphaWs, "C01GENERAL");
    await underAct(async () => {
      await app.runtime.runPromise(Effect.flatMap(SlackLedger, (l) => Effect.sync(() => l.setDraftText({ workspace: alphaWs, channel: generalNum, threadTs: 0 }, "alpha secret draft"))));
    });

    await controlPost("/__control/revoke", { team_id: "T01ALPHA" });
    await waitFor(
      app.runtime,
      Effect.map(AuthMachine, (m) => m.changes),
      (s) => !s.connected.some((w) => w.workspace === alphaWs) && s.connected.some((w) => w.workspace === designWs),
    );
    await waitFor(
      app.runtime,
      Effect.map(WorkspacesMachine, (m) => m.changes),
      (s) => !s.connected.some((w) => w.workspace === alphaWs) && s.selected.workspace === designWs && s.list.status === "Loaded",
    );

    const alphaSessionAfter = await app.runtime.runPromise(Effect.flatMap(MessagingSessions, (s) => s.get(slackSessionKey("T01ALPHA"))));
    const designSessionAfter = await app.runtime.runPromise(Effect.flatMap(MessagingSessions, (s) => s.get(slackSessionKey("T02DESIGN"))));
    expect(Option.isNone(alphaSessionAfter)).toBe(true);
    expect(Option.isSome(designSessionAfter)).toBe(true);
    const alphaDraftAfter = await app.runtime.runPromise(Effect.flatMap(SlackLedger, (l) => Effect.sync(() => l.draftText({ workspace: alphaWs, channel: generalNum, threadTs: 0 }))));
    expect(alphaDraftAfter).toBe("");
    expect(app.host.textContent).toContain("critique");

    await underAct(async () => {
      await app.runtime.runPromise(Effect.flatMap(AuthMachine, (m) => m.send({ type: "signOutWorkspace", workspace: designWs })));
    });
    await waitFor(app.runtime, Effect.map(AuthMachine, (m) => m.changes), (s) => s.connected.length === 0);
    await waitFor(app.runtime, Effect.map(WorkspacesMachine, (m) => m.changes), (s) => s.connected.length === 0);

    const revokeReqs = await controlRequests("/api/auth.revoke");
    expect(revokeReqs.length).toBeGreaterThanOrEqual(1);
    const designSessionFinal = await app.runtime.runPromise(Effect.flatMap(MessagingSessions, (s) => s.get(slackSessionKey("T02DESIGN"))));
    expect(Option.isNone(designSessionFinal)).toBe(true);
    const finalWs = await app.runtime.runPromise(Effect.flatMap(WorkspacesMachine, (m) => m.get()));
    expect(attention(finalWs).standing).toBe("SignedOut");
    expect(app.host.textContent).toContain("Connect Slack");
  });
});
