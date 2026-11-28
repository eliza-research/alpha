// spec/kit/read.md, "Story: Read from outside"; spec/kit/attempt.md, "Story: Do something outside, once"
import { type Route, feed, readJsonBody } from "./routes.ts";

import type { HttpOptions } from "@capacitor/core";
import deployments from "@repo/deployment/deployments.json" with { type: "json" };
import type { Faked } from "./phone.ts";
import type { MessagingNoticeFilter, MessagingNoticeTarget } from "../../src/platform/messaging-notices.vibe";
import type { ProviderName } from "../../src/platform/messaging.vibe";

/** Android's private posted-notification tray, permission settings and single-use activity returns. */
export function messagingNoticePhone() {
  type Entry = { readonly token: string; readonly target: MessagingNoticeTarget; readonly title: string; readonly body: string };
  const enabled = new Set<ProviderName>();
  const entries = new Map<string, Entry>();
  const visible = new Map<ProviderName, MessagingNoticeTarget>();
  let pending: Entry | undefined;
  let signal = () => {};
  const matches = (target: MessagingNoticeTarget, filter: MessagingNoticeFilter) =>
    Object.entries(filter).every(([key, value]) => Reflect.get(target, key) === value);
  const withdraw = (filter: MessagingNoticeFilter) => {
    for (const [token, item] of entries) if (matches(item.target, filter)) entries.delete(token);
    if (pending !== undefined && matches(pending.target, filter)) pending = undefined;
  };
  const setAllowed = (provider: ProviderName, allowed: boolean) => {
    if (allowed) enabled.add(provider);
    else {
      enabled.delete(provider);
      withdraw({ provider });
    }
    signal();
  };
  const plugins: Readonly<Record<string, Faked>> = {
    AlphaMessagingNotices: (emit, onUnplug) => {
      signal = () => emit("messagingNoticesChanged", {});
      onUnplug?.(() => { signal = () => {}; visible.clear(); });
      return {
        status: ({ provider }: { provider: ProviderName }) => ({ allowed: enabled.has(provider) }),
        configure: ({ provider }: { provider: ProviderName }) => setAllowed(provider, true),
        front({ provider, target }: { provider: ProviderName; target?: MessagingNoticeTarget }) {
          if (target === undefined) visible.delete(provider);
          else if (provider === target.provider) visible.set(provider, target);
        },
        post({ target, title, body }: Omit<Entry, "token">) {
          const current = visible.get(target.provider);
          if (!enabled.has(target.provider) || current !== undefined && matches(current, target)) return { posted: false };
          for (const [token, item] of entries) if (matches(item.target, target)) entries.delete(token);
          const token = crypto.randomUUID();
          entries.set(token, { target, title, body, token });
          return { posted: true };
        },
        withdraw,
        pendingTap: ({ provider }: { provider: ProviderName }) => pending?.target.provider === provider ? { token: pending.token, target: pending.target } : {},
        consumeTap({ token }: { token: string }) {
          if (pending?.token === token) pending = undefined;
        },
      };
    },
  };
  return {
    plugins, setAllowed, posted: () => [...entries.values()], pending: () => pending?.token,
    tap(token: string) {
      const selected = entries.get(token);
      if (selected === undefined) return false;
      entries.delete(token);
      pending = selected;
      signal();
      return true;
    },
  };
}

/** Android's browser and HTTP transport talking to the local Slack provider, with the phone's registered return address. */
export function slackPhone(origin: string, options: { readonly beforeReturn?: () => void; readonly initialExpirySeconds?: number; readonly beforeReply?: (path: string, body: string) => Promise<void> } = {}): Readonly<Record<string, Faked>> {
  return {
    AlphaSlackOAuth: () => ({
      async authorize({ url }: { url: string }) {
        const authorize = new URL(url);
        if (authorize.origin !== "https://slack.com" || authorize.pathname !== "/oauth/v2/authorize") throw new Error("Unexpected consent address");
        const consent = new URL(authorize.pathname + authorize.search, origin);
        consent.searchParams.set("auto_approve", "1");
        const answer = await fetch(consent, { redirect: "manual" });
        const returned = new URL(answer.headers.get("location") ?? "");
        if (returned.protocol !== "alphaphone:" || returned.host !== "slack" || returned.pathname !== "/oauth/callback") throw new Error("Unexpected phone callback");
        options.beforeReturn?.();
        return { state: returned.searchParams.get("state"), code: returned.searchParams.get("code"), error: "" };
      },
      async request(request: Omit<HttpOptions, "data"> & { data?: string }) {
        const url = new URL(request.url);
        if (url.pathname === "/.well-known/alpha-slack") {
          if (url.origin !== deployments.production.cloud || request.headers?.authorization) throw new Error("Unexpected registration request");
        } else if (url.pathname === "/api/slack/oauth" || url.pathname === "/api/slack/events/read") {
          if (url.origin !== deployments.production.cloud || request.method !== "POST") throw new Error("Unexpected cloud mailbox request");
        } else if (url.origin !== "https://slack.com") throw new Error("Unexpected Slack host");
        if (["/api/oauth.v2.access", "/api/slack/oauth"].includes(url.pathname) && !request.headers?.["content-type"]?.startsWith("application/x-www-form-urlencoded"))
          throw new Error("Slack only accepts form fields at its OAuth endpoint");
        const answer = await fetch(new URL(url.pathname + url.search, origin), {
          method: request.method, headers: request.headers, body: request.data,
        });
        let data = await answer.text();
        await options.beforeReply?.(url.pathname, data);
        if (options.initialExpirySeconds !== undefined && ["/api/oauth.v2.access", "/api/slack/oauth"].includes(url.pathname) && new URLSearchParams(request.data).has("code")) {
          const grant: unknown = JSON.parse(data);
          if (grant && typeof grant === "object" && "authed_user" in grant && grant.authed_user && typeof grant.authed_user === "object")
            data = JSON.stringify({ ...grant, authed_user: { ...grant.authed_user, expires_in: options.initialExpirySeconds } });
        }
        return { status: answer.status, headers: Object.fromEntries(answer.headers), data };
      },
    }),
  };
}

export interface SlackScene {
  teamId: string;
  teamName: string;
  userId: string;
  userName: string;
  token: string;
  revoked: boolean;
  readonly channels: Array<{ id: string; name: string; is_private?: boolean; is_im?: boolean; is_muted?: boolean; messages: Array<{ ts: string; user: string; text: string; thread_ts?: string }> }>;
  readonly posted: Array<{ channel: string; text: string; ts: string; thread_ts?: string }>;
  readonly listeners: Set<(event: unknown) => void>;
}

export function slackScene(): SlackScene {
  return {
    teamId: "T-ALPHA",
    teamName: "Alpha Workspace",
    userId: "U-OWNER",
    userName: "owner",
    token: "xoxp-fake-user-token",
    revoked: false,
    channels: [{ id: "C-GENERAL", name: "general", messages: [] }],
    posted: [],
    listeners: new Set(),
  };
}

/** Fake Slack Web API at the network boundary so tests never contact https://slack.com. */
export function slackRoutes(scene: SlackScene, now: () => number): Route[] {
  let seq = 0;
  const nextTs = () => `${Math.floor(now() / 1000)}.${String(++seq).padStart(6, "0")}`;
  const authed = (request: Request) => {
    const header = request.headers.get("authorization") ?? "";
    if (scene.revoked || !header.startsWith("Bearer ")) return Response.json({ ok: false, error: "invalid_auth" }, { status: 200 });
    return undefined;
  };
  const channelShape = (ch: SlackScene["channels"][number]) => ({
    id: ch.id, name: ch.name, is_channel: !ch.is_im, is_group: false, is_im: ch.is_im === true, is_mpim: false,
    is_private: ch.is_private === true, is_archived: false, is_muted: ch.is_muted === true,
  });
  return [
    (request, url) => request.method === "GET" && url.pathname === "/.well-known/alpha-slack" ? Response.json({ clientId: "123.456" }) : undefined,
    (request, url) => {
      if (request.method !== "POST" || url.pathname !== "/api/oauth.v2.access") return;
      return Response.json({
        ok: true,
        app_id: "A-ALPHA",
        team: { id: scene.teamId, name: scene.teamName },
        authed_user: { id: scene.userId, scope: "channels:read,chat:write", access_token: scene.token, token_type: "user" },
      });
    },
    (request, url) => {
      if (!url.pathname.startsWith("/api/") && url.pathname !== "/alpha/slack/events") return;
      const denied = authed(request);
      if (denied !== undefined) return denied;
      if (request.method === "GET" && url.pathname === "/alpha/slack/events") {
        return feed((send) => {
          scene.listeners.add(send);
          return () => { scene.listeners.delete(send); };
        });
      }
      if (request.method === "POST" && url.pathname === "/api/auth.test") {
        return Response.json({ ok: true, url: "https://alpha.slack.test/", team: scene.teamName, user: scene.userName, team_id: scene.teamId, user_id: scene.userId });
      }
      if (request.method === "POST" && url.pathname === "/api/auth.revoke") {
        scene.revoked = true;
        return Response.json({ ok: true, revoked: true });
      }
      if (request.method === "GET" && url.pathname === "/api/users.conversations") {
        return Response.json({
          ok: true,
          channels: scene.channels.map((ch) => ({ ...channelShape(ch), unread_count: 0 })),
          response_metadata: { next_cursor: "" },
        });
      }
      if (request.method === "GET" && (url.pathname === "/api/conversations.info" || url.pathname === "/api/conversations.history" || url.pathname === "/api/conversations.replies")) {
        const ch = scene.channels.find((one) => one.id === url.searchParams.get("channel"));
        if (!ch) return Response.json({ ok: false, error: "channel_not_found" });
        if (url.pathname === "/api/conversations.info") {
          return Response.json({ ok: true, channel: channelShape(ch) });
        }
        return Response.json({
          ok: true,
          messages: ch.messages.map((m) => ({ type: "message", ...m })),
          has_more: false,
          response_metadata: { next_cursor: "" },
        });
      }
      if (request.method === "GET" && url.pathname === "/api/search.messages") {
        const query = url.searchParams.get("query") ?? "";
        const needle = query.toLowerCase();
        const matches = scene.channels.flatMap((ch) => ch.messages.filter((m) => m.text.toLowerCase().includes(needle)).map((m) => ({
          type: "message", ts: m.ts, user: m.user, username: scene.userName, text: m.text,
          channel: { id: ch.id, name: ch.name }, permalink: `https://alpha.slack.test/archives/${ch.id}/p${m.ts.replace(".", "")}`,
        })));
        return Response.json({ ok: true, query, messages: { total: matches.length, pagination: { total_count: matches.length, page: 1, per_page: 20, page_count: 1 }, matches } });
      }
      if (request.method === "GET" && url.pathname === "/api/users.list") {
        return Response.json({ ok: true, members: [{ id: scene.userId, team_id: scene.teamId, name: scene.userName, real_name: "Owner", display_name: "Owner", is_owner: true, is_bot: false, deleted: false, presence: "active" }], response_metadata: { next_cursor: "" } });
      }
      if (request.method === "GET" && url.pathname === "/api/users.info") {
        return Response.json({ ok: true, user: { id: url.searchParams.get("user") ?? scene.userId, team_id: scene.teamId, name: scene.userName, real_name: "Owner", display_name: "Owner", is_owner: true, is_bot: false, deleted: false, presence: "active" } });
      }
      if (request.method !== "POST") return;
      return readJsonBody(request).then((body) => {
        if (url.pathname === "/api/chat.postMessage") {
          const channel = typeof body.channel === "string" ? body.channel : "C-GENERAL";
          const text = typeof body.text === "string" ? body.text : "";
          const ts = nextTs();
          const threadTs = typeof body.thread_ts === "string" ? body.thread_ts : undefined;
          const message = { type: "message" as const, ts, user: scene.userId, text, ...(threadTs === undefined ? {} : { thread_ts: threadTs }) };
          const ch = scene.channels.find((one) => one.id === channel);
          if (ch) ch.messages.push({ ts, user: scene.userId, text, ...(threadTs === undefined ? {} : { thread_ts: threadTs }) });
          scene.posted.push({ channel, text, ts, ...(threadTs === undefined ? {} : { thread_ts: threadTs }) });
          return Response.json({ ok: true, channel, ts, message });
        }
        if (url.pathname === "/api/chat.update") {
          const channel = typeof body.channel === "string" ? body.channel : "";
          const ts = typeof body.ts === "string" ? body.ts : "";
          const text = typeof body.text === "string" ? body.text : "";
          const ch = scene.channels.find((one) => one.id === channel);
          const msg = ch?.messages.find((m) => m.ts === ts);
          if (msg) msg.text = text;
          return Response.json({ ok: true, channel, ts, text });
        }
        if (url.pathname === "/api/chat.delete") {
          const channel = typeof body.channel === "string" ? body.channel : "";
          const ts = typeof body.ts === "string" ? body.ts : "";
          const ch = scene.channels.find((one) => one.id === channel);
          if (ch) {
            const idx = ch.messages.findIndex((m) => m.ts === ts);
            if (idx >= 0) ch.messages.splice(idx, 1);
          }
          return Response.json({ ok: true, channel, ts });
        }
        if (url.pathname === "/api/conversations.open") {
          const ch = scene.channels[0] ?? { id: "D-DM", name: "dm", is_im: true, messages: [] };
          return Response.json({ ok: true, already_open: true, channel: { id: ch.id, name: ch.name, is_channel: false, is_group: false, is_im: true, is_mpim: false, is_private: true, is_archived: false } });
        }
        if (url.pathname === "/api/conversations.mark" || url.pathname === "/api/reactions.add" || url.pathname === "/api/reactions.remove") {
          return Response.json({ ok: true });
        }
        return Response.json({ ok: false, error: "unknown_method" }, { status: 404 });
      });
    },
  ];
}

export interface TelegramScene {
  beforeMeReply?: () => Promise<void>;
  enabled: boolean;
  sessionToken: string;
  revoked: boolean;
  pts: number;
  nextMessageId: number;
  readonly user: { id: number; first_name: string; username: string };
  readonly messages: Array<{ id: number; peerKey: string; text: string; date: number; out: boolean }>;
  readonly listeners: Set<(update: unknown) => void>;
}

export function telegramScene(): TelegramScene {
  return {
    enabled: false,
    sessionToken: "tg-fake-session-token",
    revoked: false,
    pts: 1,
    nextMessageId: 1,
    user: { id: 1001, first_name: "Owner", username: "owner" },
    messages: [],
    listeners: new Set(),
  };
}

/** Fake Telegram RPC server at the network boundary for dev server and tests. */
export function telegramRoutes(scene: TelegramScene, now: () => number): Route[] {
  const authed = (request: Request) => {
    const header = request.headers.get("authorization") ?? "";
    if (scene.revoked || header !== `Bearer ${scene.sessionToken}`) return Response.json({ ok: false, error: "AUTH_KEY_UNREGISTERED" }, { status: 401 });
    return undefined;
  };
  const selfUser = () => ({ _type: "user" as const, id: scene.user.id, first_name: scene.user.first_name, username: scene.user.username, self: true, online: true });
  const rpcMessage = (id: number, peerKey: string, date: number, text: string, edited?: number) => ({
    _type: "message" as const,
    id,
    peer_id: { _type: "peerUser" as const, user_id: scene.user.id },
    peer_key: peerKey,
    from_id: scene.user.id,
    date,
    ...(edited === undefined ? {} : { edit_date: edited }),
    message: text,
    out: true,
    reactions: [],
    mentioned: false,
  });
  return [
    (request, url) => {
      if (request.method === "GET" && url.pathname === "/rpc/updates.stream") {
        const denied = authed(request);
        if (denied !== undefined) return denied;
        return feed((send) => {
          scene.listeners.add(send);
          return () => { scene.listeners.delete(send); };
        });
      }
      if (request.method !== "POST" || !url.pathname.startsWith("/rpc/")) return;
      if (url.pathname === "/rpc/auth.sendCode") {
        return Response.json({ ok: true, _type: "auth.sentCode", phone_code_hash: "fake-code-hash", type: { _type: "auth.sentCodeTypeSms", length: 5 }, timeout: 60 });
      }
      if (url.pathname === "/rpc/auth.signIn" || url.pathname === "/rpc/auth.checkPassword") {
        scene.revoked = false;
        return Response.json({ ok: true, _type: "auth.authorization", session_token: scene.sessionToken, user: selfUser() });
      }
      if (url.pathname === "/rpc/auth.exportLoginToken") {
        return Response.json({ ok: true, _type: "auth.loginToken", token: "fake-qr-token", expires: Math.floor(now() / 1000) + 60, login_url: "tg://login?token=fake-qr-token" });
      }
      const denied = authed(request);
      if (url.pathname === "/rpc/users.getMe") {
        const reply = denied ?? Response.json({ ok: true, user: selfUser() });
        return scene.beforeMeReply ? scene.beforeMeReply().then(() => reply) : reply;
      }
      if (denied !== undefined) return denied;
      return readJsonBody(request).then((body) => {
        switch (url.pathname) {
          case "/rpc/auth.logOut":
            scene.revoked = true;
            return Response.json({ ok: true, _type: "auth.loggedOut" });
          case "/rpc/account.getPassword":
            return Response.json({ ok: true, _type: "account.password", has_password: false, hint: "", srp_id: "0", current_algo: { _type: "passwordKdfAlgoUnknown" } });
          case "/rpc/auth.acceptLoginToken":
            return Response.json({ ok: true, _type: "authorization", session_token: scene.sessionToken, user: selfUser() });
          case "/rpc/messages.getDialogs":
            return Response.json({ ok: true, dialogs: [], chats: [], users: [selfUser()], messages: [], folders: [], next_cursor: "", has_more: false, pts: scene.pts });
          case "/rpc/messages.getHistory":
            return Response.json({ ok: true, messages: [], count: 0, next_cursor: "", has_more: false, pts: scene.pts });
          case "/rpc/messages.sendMessage": {
            const id = scene.nextMessageId++;
            const date = Math.floor(now() / 1000);
            const peerKey = typeof body.peer === "string" ? body.peer : `user:${scene.user.id}`;
            const text = typeof body.message === "string" ? body.message : "";
            scene.pts += 1;
            scene.messages.push({ id, peerKey, text, date, out: true });
            return Response.json({ ok: true, pts: scene.pts, message: rpcMessage(id, peerKey, date, text) });
          }
          case "/rpc/messages.editMessage": {
            const id = typeof body.id === "number" ? body.id : 1;
            const text = typeof body.message === "string" ? body.message : "";
            const date = Math.floor(now() / 1000);
            scene.pts += 1;
            return Response.json({ ok: true, pts: scene.pts, message: rpcMessage(id, `user:${scene.user.id}`, date, text, date) });
          }
          case "/rpc/messages.deleteMessages": {
            const ids = Array.isArray(body.id) ? body.id.filter((one): one is number => typeof one === "number") : [];
            scene.pts += 1;
            return Response.json({ ok: true, pts: scene.pts, pts_count: ids.length, deleted_ids: ids });
          }
          case "/rpc/messages.sendReaction": {
            const id = typeof body.msg_id === "number" ? body.msg_id : 1;
            scene.pts += 1;
            return Response.json({ ok: true, pts: scene.pts, message: rpcMessage(id, `user:${scene.user.id}`, Math.floor(now() / 1000), "") });
          }
          case "/rpc/messages.readHistory":
            return Response.json({ ok: true, pts: scene.pts, max_id: typeof body.max_id === "number" ? body.max_id : 0 });
          case "/rpc/messages.searchGlobal":
            return Response.json({ ok: true, messages: [], count: 0, next_cursor: "", has_more: false });
          case "/rpc/account.updateNotifySettings":
            return Response.json({ ok: true, mute_until: typeof body.mute_until === "number" ? body.mute_until : 0 });
          case "/rpc/updates.getDifference":
            return Response.json({ ok: true, _type: "updates.difference", new_messages: [], other_updates: [], state: { pts: scene.pts, date: Math.floor(now() / 1000) } });
          default:
            return Response.json({ ok: false, error: "METHOD_INVALID" }, { status: 404 });
        }
      });
    },
  ];
}
