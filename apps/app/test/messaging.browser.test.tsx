import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { afterEach, describe, expect, inject, it } from "vitest";
import { commands, page } from "vitest/browser";

declare module "vitest/browser" {
  interface BrowserCommands { approveSlackWorkspace(): Promise<void> }
}
import { homeOrder } from "../gen/app__home__tiles.effect.vibe";
import * as Shell from "../gen/app__shell.effect.vibe";
import * as SlackWorkspaces from "../gen/app__slack.effect.vibe";
import * as SlackAuth from "../gen/app__slack__auth.effect.vibe";
import * as SlackConversation from "../gen/app__slack__conversation.effect.vibe";
import * as SlackNotices from "../gen/app__slack__notices.effect.vibe";
import * as TelegramList from "../gen/app__telegram.effect.vibe";
import * as TelegramAuth from "../gen/app__telegram__auth.effect.vibe";
import * as TelegramConversation from "../gen/app__telegram__conversation.effect.vibe";
import * as TelegramNotices from "../gen/app__telegram__notices.effect.vibe";
import { savedKey, written } from "../src/home/saved.vibe";
import { MessagingBridge, type MessagingDraftProposal } from "../src/messaging/bridge.vibe";
import { browserSlackHttp } from "../src/platform/slack-oauth.vibe";
import { messagingSessions } from "../src/platform/messaging.vibe";
import { telegramAt } from "../src/platform/telegram.vibe";
import type { Alpha } from "../src/runtime/area.tsx";
import { SlackLedger } from "../src/slack/ledger.vibe";
import { closeAll, coverLifted, later, only, openOver, until } from "./alpha.tsx";
import { scene } from "./fakes/scene.ts";
import { fakeWorld } from "./fakes/world.vibe";
import { slackAt } from "../src/platform/slack.vibe";
import "../src/main.css";

const slackOrigin = inject("slackOrigin");
const telegramOrigin = inject("telegramOrigin");
const messagingMounts = only("home", "assistant", "notice", "view:Telegram", "view:Slack", "view:Settings");

afterEach(closeAll);

async function controlJson(origin: string, route: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${origin}${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await response.json()) as Record<string, unknown>;
}

/**
 * Alpha with its default Home tiles, including Telegram and Slack
 * (spec/app/home/tiles.md, "Home's defaults use the product's Home order, and Home holds at most 4096 tiles").
 */
/** Stage `draft` as the agent does, raise Ask Alpha in full, and send it from there once it shows. */
async function sendStagedDraft(alpha: Alpha, draft: MessagingDraftProposal) {
  await alpha.runtime.runPromise(Effect.flatMap(MessagingBridge, (bridge) => Effect.sync(() => bridge.stageDraft(draft))));
  await alpha.runtime.runPromise(Effect.flatMap(Shell.Machine, (m) => m.send({ type: "raise", detent: "Full" })));
  const askAlphaRegion = page.getByRole("region", { name: "Ask Alpha" });
  await expect.element(askAlphaRegion.getByText(draft.body)).toBeVisible();
  await askAlphaRegion.getByRole("button", { name: "Send" }).click();
  await expect.element(askAlphaRegion.getByText("Sent", { exact: true })).toBeVisible();
}

async function openMessagingAlpha() {
  localStorage.setItem(savedKey, written(homeOrder.map((view) => ({ tag: "Own" as const, view }))));
  const platform = fakeWorld(scene(), {
    slack: Layer.provide(slackAt(slackOrigin, slackOrigin, "browser"), browserSlackHttp),
    telegram: Layer.provide(telegramAt(telegramOrigin), FetchHttpClient.layer),
    sessions: messagingSessions,
  });
  const opened = await openOver(platform, messagingMounts);
  await coverLifted(opened.alpha);
  return opened;
}

async function connectSlackWorkspace(
  alpha: Awaited<ReturnType<typeof openMessagingAlpha>>["alpha"],
  teamId: string,
): Promise<number> {
  await alpha.runtime.runPromise(
    Effect.flatMap(SlackLedger, (ledger) => Effect.sync(() => { ledger.setPendingTeam(teamId); })),
  );
  await alpha.runtime.runPromise(
    Effect.flatMap(SlackAuth.Machine, (m) => m.send({ type: "startConnect" })),
  );
  await expect.element(page.getByText("Review Slack user scopes")).toBeVisible();
  await expect.element(page.getByText("User account · no bot token")).toBeVisible();
  await page.getByRole("button", { name: "Approve & connect" }).click();
  await until(alpha, alpha.runtime, SlackAuth.Machine, (s) => s.step === "BrowserOAuth");
  const link = page.getByRole("link", { name: "Open Slack in your browser" });
  await expect.element(link).toBeVisible();
  await commands.approveSlackWorkspace();
  await until(alpha, alpha.runtime, SlackAuth.Machine, (s) => s.step === "Idle" && s.trouble === "Fine");
  const meta = await alpha.runtime.runPromise(
    Effect.flatMap(SlackLedger, (ledger) => Effect.sync(() => ledger.workspaceByTeamId(teamId))),
  );
  expect(meta).toBeDefined();
  const wsNum = meta?.num ?? 0;
  await until(
    alpha,
    alpha.runtime,
    SlackWorkspaces.Machine,
    (s) => s.connected.some((w) => w.workspace === wsNum) && s.list.status === "Loaded",
  );
  return wsNum;
}

describe("Messaging E2E", () => {
  // spec/app/home/tiles.md, "Story: Keep my apps on Home"; spec/app/settings/preferences.md, "Story: Decide whether Alpha asks before it acts"
  it("Home tiles and Privacy switches", async () => {
    await controlJson(telegramOrigin, "/__control/reset", {});
    await controlJson(slackOrigin, "/__control/reset", {});
    await openMessagingAlpha();

    await expect.element(page.getByRole("button", { name: "Telegram" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Slack" })).toBeVisible();

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: /Privacy/i }).click();
    await expect.element(page.getByText("Telegram screen")).toBeVisible();
    await expect.element(page.getByText("Slack screen")).toBeVisible();
    const telegramSwitch = page.getByRole("switch", { name: /Telegram screen/i });
    const slackSwitch = page.getByRole("switch", { name: /Slack screen/i });
    await expect.element(telegramSwitch).toHaveAttribute("aria-checked", "true");
    await expect.element(slackSwitch).toHaveAttribute("aria-checked", "true");
    await page.getByText("Telegram screen").click();
    await expect.element(telegramSwitch).toHaveAttribute("aria-checked", "false");
    await page.getByText("Telegram screen").click();
    await expect.element(telegramSwitch).toHaveAttribute("aria-checked", "true");
  });

  // spec/app/telegram/auth.md, "Story: Sign in to my Telegram user account"; spec/app/telegram/index.md, "Story: Browse and search my Telegram chats"; spec/app/telegram/composer.md, "Story: Draft and send Telegram messages under my sole authority"; spec/app/telegram/notices.md, "Story: Hear about new Telegram messages without noise"
  it("Telegram full UI E2E", async () => {
    await controlJson(telegramOrigin, "/__control/reset", {});
    const { alpha } = await openMessagingAlpha();

    await page.getByRole("button", { name: /^Telegram/ }).first().click();
    await expect.element(page.getByText("Sign in to Telegram")).toBeVisible();
    await expect.element(page.getByText("User account · no bot token")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabelText("Phone number").fill("+15550109999");
    await page.getByRole("button", { name: "Send code" }).click();
    await until(alpha, alpha.runtime, TelegramAuth.Machine, (s) => s.step === "CodePending");

    const codeInfo = await controlJson(telegramOrigin, `/__control/last-code?phone=${encodeURIComponent("+15550109999")}`);
    const otp = typeof codeInfo.code === "string" ? codeInfo.code : "";
    expect(otp.length).toBeGreaterThan(0);
    await page.getByLabelText("Verification code").fill(otp);
    await page.getByRole("button", { name: "Verify code" }).click();
    await until(alpha, alpha.runtime, TelegramAuth.Machine, (s) => s.step === "TwoFactorRequired");

    await page.getByPlaceholder("Cloud password").fill("alpha-2fa");
    await page.getByRole("button", { name: "Unlock account" }).click();
    await until(alpha, alpha.runtime, TelegramAuth.Machine, (s) => s.step === "Authenticated");
    await until(alpha, alpha.runtime, TelegramList.Machine, (s) => s.list.status === "Loaded" && s.pages > 0);
    const mayaChat = page.getByLabelText("Telegram chats").getByText("Maya Chen");
    await expect.element(mayaChat).toBeVisible();

    await mayaChat.click();
    await until(alpha, alpha.runtime, TelegramConversation.Machine, (s) => s.chat > 0 && s.read.status === "Loaded");
    await page.getByLabelText("Message").fill("Hello from Chromium E2E");
    await page.getByRole("button", { name: "Send" }).first().click();
    await expect.element(page.getByRole("log", { name: "Telegram messages" }).getByText("Hello from Chromium E2E")).toBeVisible();

    const tgRequests = await controlJson(telegramOrigin, "/__control/requests?path=/rpc/messages.sendMessage");
    const sentCalls = (tgRequests.requests ?? []) as ReadonlyArray<unknown>;
    expect(sentCalls.length).toBeGreaterThanOrEqual(1);

    await sendStagedDraft(alpha, {
      id: "tg-browser-draft-1",
      platform: "Telegram",
      target: "Maya Chen",
      targetId: "user:2001",
      body: "Alpha Chromium Telegram draft",
      revision: 1,
      status: "draft",
    });

    await alpha.runtime.runPromise(Effect.flatMap(Shell.Machine, (m) => m.send({ type: "goHome" })));
    await expect.element(page.getByText(/Telegram/i).first()).toBeVisible();
    const cardState = await alpha.runtime.runPromise(
      Effect.flatMap(MessagingBridge, (bridge) => Effect.sync(() => bridge.snapshot().cards.Telegram)),
    );
    expect(cardState.connected).toBe(true);

    await until(alpha, alpha.runtime, TelegramNotices.Machine, (s) => s.since > 0);
    await controlJson(telegramOrigin, "/__control/inject", {
      kind: "message",
      peer: "chat:3001",
      from_id: 2001,
      message: "Live SSE ping from browser test",
    });
    await until(alpha, alpha.runtime, TelegramNotices.Machine, (s) => s.posts > 0);
    await page.getByRole("button", { name: /Live SSE ping from browser test/ }).click();
    await expect.element(page.getByRole("log", { name: "Telegram messages" }).getByText("Live SSE ping from browser test")).toBeVisible();
    await page.getByRole("button", { name: "Back to chats" }).click();
    await page.getByRole("button", { name: "Account options" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect.element(page.getByText("Sign out of Telegram?")).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await until(alpha, alpha.runtime, TelegramAuth.Machine, (s) => s.step === "SignedOut");
    const logoutReqs = await controlJson(telegramOrigin, "/__control/requests?path=/rpc/auth.logOut");
    expect(((logoutReqs.requests ?? []) as ReadonlyArray<unknown>).length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  // spec/app/slack/auth.md, "Story: Connect and manage my Slack workspaces with user tokens only"; spec/app/slack/index.md, "Story: Switch workspaces and browse Slack conversations with strict isolation"; spec/app/slack/conversation.md, "Story: Read Slack channels and threaded replies accurately"; spec/app/slack/notices.md, "Story: Hear about Slack DMs, mentions and thread replies per workspace"
  it("Slack full UI E2E", async () => {
    await controlJson(slackOrigin, "/__control/reset", {});
    const { alpha } = await openMessagingAlpha();

    await page.getByRole("button", { name: /^Slack/ }).first().click();
    await expect.element(page.getByText("Connect Slack")).toBeVisible();

    const alphaWs = await connectSlackWorkspace(alpha, "T01ALPHA");
    await expect.element(page.getByText("Alpha Team")).toBeVisible();
    await expect.element(page.getByText("general", { exact: true })).toBeVisible();

    const designWs = await connectSlackWorkspace(alpha, "T02DESIGN");
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await expect.element(page.getByText("Slack workspaces")).toBeVisible();
    await page.getByText("Design Guild").click();
    await until(
      alpha,
      alpha.runtime,
      SlackWorkspaces.Machine,
      (s) => s.selected.workspace === designWs && s.list.status === "Loaded",
    );
    await expect.element(page.getByText("critique", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByText("Alpha Team").click();
    await until(
      alpha,
      alpha.runtime,
      SlackWorkspaces.Machine,
      (s) => s.selected.workspace === alphaWs && s.list.status === "Loaded",
    );
    await page.getByText("general", { exact: true }).click();
    await until(alpha, alpha.runtime, SlackConversation.Machine, (s) => s.channel > 0 && s.channelRead.status === "Loaded");

    const draftText = "Alpha Chromium Slack draft & + = 👋";
    const threadTs = "1730000100.000100";
    const slackDraft: MessagingDraftProposal = {
      id: "sl-browser-draft-1",
      platform: "Slack",
      target: "Alpha Team · #general",
      targetId: "C01GENERAL",
      workspaceId: "T01ALPHA",
      threadTs,
      body: draftText,
      revision: 1,
      status: "draft",
    };
    await sendStagedDraft(alpha, slackDraft);
    await alpha.runtime.runPromise(Effect.flatMap(Shell.Machine, (m) => m.send({ type: "goBack" })));
    await sendStagedDraft(alpha, slackDraft);

    expect(new URL(slackOrigin).origin).not.toBe(location.origin);
    const slackPosts = await controlJson(slackOrigin, "/__control/requests?path=/api/chat.postMessage");
    const posts = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({
      method: Schema.String, query: Schema.Record(Schema.String, Schema.String),
      body: Schema.Struct({ channel: Schema.String, text: Schema.String, thread_ts: Schema.String, client_msg_id: Schema.String.check(Schema.isUUID(5)) }),
    })))(slackPosts.requests);
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
    expect(posts[0]?.query).toEqual({});
    expect(posts[0]).toMatchObject({ method: "POST", body: { channel: "C01GENERAL", text: draftText, thread_ts: threadTs } });

    await alpha.runtime.runPromise(Effect.flatMap(Shell.Machine, (m) => m.send({ type: "goHome" })));
    await page.getByRole("button", { name: /^Slack/ }).first().click();
    await expect.element(page.getByRole("button", { name: "Back to conversations" })).toBeVisible();
    await page.getByRole("article", { name: /^Maya Chen at / }).filter({ has: page.getByText("Sprint review kicks off at 2pm today.", { exact: true }) }).getByRole("button", { name: /3 replies/ }).click();
    await expect.element(page.getByText("Sprint review kicks off at 2pm today.", { exact: true })).toBeVisible();
    const sentDraft = page.getByRole("article", { name: /^Alex Rivera at / }).getByText(draftText, { exact: true });
    await expect.element(sentDraft).toBeVisible();
    expect(page.getByRole("article").getByText(draftText, { exact: true }).elements()).toHaveLength(1);
    await alpha.runtime.runPromise(Effect.flatMap(Shell.Machine, (m) => m.send({ type: "goHome" })));
    await until(alpha, alpha.runtime, SlackNotices.Machine, (s) => (s.watermarks[alphaWs] ?? 0) > 0 && (s.watermarks[designWs] ?? 0) > 0);
    await controlJson(slackOrigin, "/__control/inject", {
      kind: "message",
      team_id: "T01ALPHA",
      channel: "C02ENG",
      user: "U02MAYA",
      thread_ts: "1730000200.000100",
      text: "Hey <@U01OWNER> check the Chromium Slack mention",
    });
    await later(alpha, 5_000);
    await until(alpha, alpha.runtime, SlackNotices.Machine, (s) => s.posts > 0);
    await page.getByRole("button", { name: /Alpha Team · engineering.*Maya Chen:.*Chromium Slack mention/ }).click();
    await until(alpha, alpha.runtime, SlackConversation.Machine, (s) => s.workspace === alphaWs && s.threadTs > 0 && s.threadLoaded);
    await expect.element(page.getByText("Shipping the new HTTP client layer today.")).toBeVisible();
    await expect.element(page.getByText(/check the Chromium Slack mention/)).toBeVisible();
    await page.getByRole("button", { name: "Back to channel" }).click();

    await controlJson(slackOrigin, "/__control/revoke", { team_id: "T02DESIGN" });
    await later(alpha, 5_000);
    await until(
      alpha,
      alpha.runtime,
      SlackAuth.Machine,
      (s) => !s.connected.some((w) => w.workspace === designWs) && s.connected.some((w) => w.workspace === alphaWs),
    );
    await page.getByRole("button", { name: "Back to conversations" }).click();
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await expect.element(page.getByText("Design Guild")).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Sign out Alpha Team" }).click();
    await expect.element(page.getByText("Sign out of Alpha Team?")).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await until(alpha, alpha.runtime, SlackAuth.Machine, (s) => s.connected.length === 0);
    const revokeReqs = await controlJson(slackOrigin, "/__control/requests?path=/api/auth.revoke");
    expect(((revokeReqs.requests ?? []) as ReadonlyArray<unknown>).length).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
