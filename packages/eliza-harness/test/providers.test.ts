import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@effect/vitest";
import { type RunningProvider, scratch, startSlackProvider, startTelegramProvider } from "../src/index.ts";

interface SseEvent {
  readonly id?: string;
  readonly event?: string;
  readonly data: unknown;
}

async function openSse(url: string, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const response = await fetch(url, { headers, signal: controller.signal });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const queue: SseEvent[] = [];

  async function nextEvent(): Promise<SseEvent> {
    while (queue.length === 0) {
      const { value, done } = await reader.read();
      if (done) throw new Error("SSE stream closed before event arrived");
      buffer += decoder.decode(value, { stream: true });
      let split = buffer.indexOf("\n\n");
      while (split >= 0) {
        const chunk = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        split = buffer.indexOf("\n\n");
        const lines = chunk.split("\n").filter((line) => line.length > 0 && !line.startsWith(":"));
        if (lines.length === 0) continue;
        let id: string | undefined;
        let event: string | undefined;
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith("id:")) id = line.slice(3).trim();
          else if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length > 0) {
          queue.push({ id, event, data: JSON.parse(dataLines.join("\n")) as unknown });
        }
      }
    }
    return queue.shift()!;
  }

  return {
    nextEvent,
    close: () => {
      controller.abort();
      void reader.cancel().catch(() => undefined);
    },
  };
}

async function postJson<T>(url: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; headers: Headers; json: T }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, headers: response.headers, json: (await response.json()) as T };
}

describe("Slack user-account HTTP+SSE provider", () => {
  let slack: RunningProvider;

  beforeAll(async () => {
    slack = await startSlackProvider();
  });

  afterAll(async () => {
    await slack.stop();
  });

  beforeEach(async () => {
    const reset = await postJson<{ ok: boolean }>(`${slack.origin}/__control/reset`);
    expect(reset.json.ok).toBe(true);
  });

  it("handles CORS preflight, OAuth2 PKCE user tokens, refresh, bot-token rejection, and multi-workspace isolation", async () => {
    const headers = { "access-control-request-headers": "authorization, content-type, idempotency-key" };
    const preflight = await fetch(`${slack.origin}/api/users.conversations`, { method: "OPTIONS", headers });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-headers")).toBe("x-slack-version-ts");
    const mailbox = await fetch(`${slack.origin}/api/slack/events/read`, { method: "OPTIONS", headers });
    expect(mailbox.headers.get("access-control-allow-headers")).toContain("authorization");

    const botAuthz = await fetch(`${slack.origin}/oauth/v2/authorize?client_id=alpha&scope=chat:write`);
    expect(botAuthz.status).toBe(400);
    expect(await botAuthz.json()).toEqual({ ok: false, error: "bot_tokens_not_supported" });

    const consentHtml = await (await fetch(`${slack.origin}/oauth/v2/authorize?client_id=alpha&user_scope=channels:read,chat:write&redirect_uri=http://127.0.0.1/cb&state=s1`)).text();
    expect(consentHtml).toContain("Alpha Team");
    expect(consentHtml).toContain("Design Guild");
    expect(consentHtml).toContain("xoxp-");

    const verifier = "pkce-verifier-slack-user-flow-1234567890";
    const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
    const redirectRes = await fetch(
      `${slack.origin}/oauth/v2/authorize?client_id=alpha&user_scope=channels:read,chat:write&redirect_uri=http://127.0.0.1/cb&state=st42&code_challenge=${challenge}&code_challenge_method=S256&team=T01ALPHA&auto_approve=1`,
      { redirect: "manual" },
    );
    expect(redirectRes.status).toBe(302);
    const location = new URL(redirectRes.headers.get("location")!);
    const code = location.searchParams.get("code")!;
    expect(location.searchParams.get("state")).toBe("st42");

    const badPkce = await postJson<{ ok: boolean; error?: string }>(`${slack.origin}/api/oauth.v2.access`, {
      code,
      client_id: "alpha",
      redirect_uri: "http://127.0.0.1/cb",
      code_verifier: "wrong-verifier",
    });
    expect(badPkce.json).toEqual({ ok: false, error: "invalid_code_verifier" });

    // spec/app/messages/index.md, "Story: Give Alpha my messages and contacts"
    expect((await postJson<{ ok: boolean; error?: string }>(`${slack.origin}/api/oauth.v2.access`, { code, client_id: "alpha", code_verifier: verifier })).json).toEqual({
      ok: false,
      error: "bad_redirect_uri",
    });

    const formBody = new URLSearchParams({
      code,
      client_id: "alpha",
      redirect_uri: "http://127.0.0.1/cb",
      code_verifier: verifier,
    });
    const accessRes = await fetch(`${slack.origin}/api/oauth.v2.access`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody.toString(),
    });
    const access = (await accessRes.json()) as {
      ok: boolean;
      team: { id: string; name: string };
      authed_user: { id: string; access_token: string; token_type: string; refresh_token: string };
    };
    expect(access.ok).toBe(true);
    expect(access.team).toEqual({ id: "T01ALPHA", name: "Alpha Team" });
    expect(access.authed_user.token_type).toBe("user");
    expect(access.authed_user.access_token.startsWith("xoxe.xoxp-")).toBe(true);

    const replay = await postJson<{ ok: boolean; error?: string }>(`${slack.origin}/api/oauth.v2.access`, {
      code,
      code_verifier: verifier,
    });
    expect(replay.json).toEqual({ ok: false, error: "code_already_used" });

    const refreshed = await postJson<{ ok: boolean; access_token: string }>(
      `${slack.origin}/api/oauth.v2.access`,
      { grant_type: "refresh_token", refresh_token: access.authed_user.refresh_token },
    );
    expect(refreshed.json.ok).toBe(true);
    expect(refreshed.json.access_token.startsWith("xoxe.xoxp-")).toBe(true);

    const botCall = await postJson<{ ok: boolean; error?: string }>(
      `${slack.origin}/api/auth.test`,
      {},
      { authorization: "Bearer xoxb-123456-bot-token" },
    );
    expect(botCall.json).toEqual({ ok: false, error: "bot_token_not_allowed" });

    const designAuthz = await fetch(
      `${slack.origin}/oauth/v2/authorize?client_id=alpha&user_scope=channels:read&team=T02DESIGN&auto_approve=1`,
    );
    const { code: designCode } = (await designAuthz.json()) as { code: string };
    const designAccess = await postJson<{ ok: boolean; authed_user: { access_token: string } }>(
      `${slack.origin}/api/oauth.v2.access`,
      { code: designCode, client_id: "alpha" },
    );
    const designToken = designAccess.json.authed_user.access_token;

    const crossWs = await postJson<{ ok: boolean; error?: string }>(
      `${slack.origin}/api/conversations.info`,
      { channel: "C01GENERAL" },
      { authorization: `Bearer ${designToken}` },
    );
    expect(crossWs.json).toEqual({ ok: false, error: "channel_not_found" });

    const designList = await postJson<{ ok: boolean; channels: { id: string }[] }>(
      `${slack.origin}/api/users.conversations`,
      {},
      { authorization: `Bearer ${designToken}` },
    );
    expect(designList.json.channels.map((c) => c.id)).toEqual(["C11CRITIQUE", "D11SORA"]);
  });

  it("supports conversations, history, threads, idempotent posting, edit/delete checks, reactions, search, SSE injection, faults, and revocation", async () => {
    const authHeader = { authorization: "Bearer xoxp-alpha-team-owner-initial" };

    const authTest = await postJson<{ ok: boolean; team_id: string; user_id: string }>(
      `${slack.origin}/api/auth.test`,
      {},
      authHeader,
    );
    expect(authTest.json).toMatchObject({ ok: true, team_id: "T01ALPHA", user_id: "U01OWNER" });

    const page1 = await (await fetch(`${slack.origin}/api/users.conversations?limit=2`, { headers: authHeader })).json() as {
      ok: boolean;
      channels: { id: string; unread_count: number }[];
      response_metadata: { next_cursor: string };
    };
    expect(page1.ok).toBe(true);
    expect(page1.channels).toHaveLength(2);
    expect(page1.response_metadata.next_cursor).not.toBe("");

    const openedDm = await postJson<{ ok: boolean; already_open: boolean; channel: { id: string } }>(
      `${slack.origin}/api/conversations.open`,
      { users: "U02MAYA" },
      authHeader,
    );
    expect(openedDm.json.already_open).toBe(true);
    expect(openedDm.json.channel.id).toBe("D01MAYA");

    const newDm = await postJson<{ ok: boolean; already_open: boolean; channel: { id: string; is_im: boolean } }>(
      `${slack.origin}/api/conversations.open`,
      { users: "U04PRIYA" },
      authHeader,
    );
    expect(newDm.json.already_open).toBe(false);
    expect(newDm.json.channel.is_im).toBe(true);

    const sse = await openSse(`${slack.origin}/alpha/slack/events`, authHeader);
    try {
      const posted1 = await postJson<{ ok: boolean; ts: string; message: { text: string } }>(
        `${slack.origin}/api/chat.postMessage`,
        { channel: "C02ENG", text: "Deploying build 42" },
        { ...authHeader, "idempotency-key": "idem-slack-1" },
      );
      const posted2 = await postJson<{ ok: boolean; ts: string }>(
        `${slack.origin}/api/chat.postMessage`,
        { channel: "C02ENG", text: "Deploying build 42" },
        { ...authHeader, "idempotency-key": "idem-slack-1" },
      );
      expect(posted1.json.ok).toBe(true);
      expect(posted2.json.ts).toBe(posted1.json.ts);

      const postEvent = await sse.nextEvent();
      expect(postEvent.event).toBe("event_callback");
      expect(postEvent.data).toMatchObject({ team_id: "T01ALPHA", event: { type: "message", ts: posted1.json.ts } });

      const threadReply = await postJson<{ ok: boolean; ts: string }>(
        `${slack.origin}/api/chat.postMessage`,
        { channel: "C02ENG", text: "Broadcasted thread note", thread_ts: posted1.json.ts, reply_broadcast: true },
        authHeader,
      );
      expect(threadReply.json.ok).toBe(true);
      await sse.nextEvent();

      const replies = await postJson<{ ok: boolean; messages: { ts: string; reply_count?: number }[] }>(
        `${slack.origin}/api/conversations.replies`,
        { channel: "C02ENG", ts: posted1.json.ts },
        authHeader,
      );
      expect(replies.json.messages).toHaveLength(2);
      expect(replies.json.messages[0]?.reply_count).toBe(1);

      const peerEditDenied = await postJson<{ ok: boolean; error?: string }>(
        `${slack.origin}/api/chat.update`,
        { channel: "C02ENG", ts: "1730000250.000200", text: "hijack" },
        authHeader,
      );
      expect(peerEditDenied.json).toEqual({ ok: false, error: "cant_update_message" });

      const ownEdit = await postJson<{ ok: boolean; message: { text: string; edited?: unknown } }>(
        `${slack.origin}/api/chat.update`,
        { channel: "C02ENG", ts: posted1.json.ts, text: "Deploying build 43" },
        authHeader,
      );
      expect(ownEdit.json.message.text).toBe("Deploying build 43");
      expect(ownEdit.json.message.edited).toBeDefined();
      await sse.nextEvent();

      const reactAdd = await postJson<{ ok: boolean }>(
        `${slack.origin}/api/reactions.add`,
        { channel: "C02ENG", timestamp: posted1.json.ts, name: "tada" },
        authHeader,
      );
      expect(reactAdd.json.ok).toBe(true);
      await sse.nextEvent();

      const reactDup = await postJson<{ ok: boolean; error?: string }>(
        `${slack.origin}/api/reactions.add`,
        { channel: "C02ENG", timestamp: posted1.json.ts, name: "tada" },
        authHeader,
      );
      expect(reactDup.json).toEqual({ ok: false, error: "already_reacted" });

      const reactRemove = await postJson<{ ok: boolean }>(
        `${slack.origin}/api/reactions.remove`,
        { channel: "C02ENG", timestamp: posted1.json.ts, name: "tada" },
        authHeader,
      );
      expect(reactRemove.json.ok).toBe(true);
      await sse.nextEvent();

      const search = await postJson<{ ok: boolean; messages: { total: number; matches: { text: string }[] } }>(
        `${slack.origin}/api/search.messages`,
        { query: "in:#engineering from:@devon backoff" },
        authHeader,
      );
      expect(search.json.messages.total).toBe(1);
      expect(search.json.messages.matches[0]?.text).toContain("retry backoff PR");

      const injected = await postJson<{ ok: boolean; ts: string }>(`${slack.origin}/__control/inject`, {
        team_id: "T01ALPHA",
        channel: "C02ENG",
        user: "U02MAYA",
        text: "<@U01OWNER> hotfix merged!",
      });
      const injectedEvent = await sse.nextEvent();
      expect(injectedEvent.data).toMatchObject({
        event: { type: "message", channel: "C02ENG", ts: injected.json.ts },
      });

      const beforeMark = await postJson<{ ok: boolean; channel: { unread_count: number } }>(
        `${slack.origin}/api/conversations.info`,
        { channel: "C02ENG" },
        authHeader,
      );
      expect(beforeMark.json.channel.unread_count).toBeGreaterThan(0);

      await postJson(`${slack.origin}/api/conversations.mark`, { channel: "C02ENG", ts: injected.json.ts }, authHeader);
      await sse.nextEvent();

      const afterMark = await postJson<{ ok: boolean; channel: { unread_count: number } }>(
        `${slack.origin}/api/conversations.info`,
        { channel: "C02ENG" },
        authHeader,
      );
      expect(afterMark.json.channel.unread_count).toBe(0);

      const delOwn = await postJson<{ ok: boolean }>(
        `${slack.origin}/api/chat.delete`,
        { channel: "C02ENG", ts: threadReply.json.ts },
        authHeader,
      );
      expect(delOwn.json.ok).toBe(true);
      await sse.nextEvent();
    } finally {
      sse.close();
    }

    await postJson(`${slack.origin}/__control/fault`, {
      path: "/api/chat.postMessage",
      status: 429,
      retryAfter: 7,
      remaining: 1,
    });
    const rateLimited = await postJson<{ ok: boolean; error: string }>(
      `${slack.origin}/api/chat.postMessage`,
      { channel: "C01GENERAL", text: "Should hit 429" },
      authHeader,
    );
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.headers.get("retry-after")).toBe("7");
    expect(rateLimited.json).toEqual({ ok: false, error: "ratelimited" });

    const reqLog = await (await fetch(`${slack.origin}/__control/requests?path=/api/chat.postMessage`)).json() as {
      ok: boolean;
      requests: unknown[];
    };
    expect(reqLog.ok).toBe(true);
    expect(reqLog.requests.length).toBeGreaterThan(0);

    await postJson(`${slack.origin}/__control/revoke`, { team_id: "T01ALPHA" });
    const afterRevoke = await postJson<{ ok: boolean; error?: string }>(
      `${slack.origin}/api/auth.test`,
      {},
      authHeader,
    );
    expect(afterRevoke.json).toEqual({ ok: false, error: "token_revoked" });
  });

  it("blocks prototype-key auth bypass, OAuth open redirects and redirect_uri/client_id omissions, and disconnects revoked SSE streams", async () => {
    for (const protoKey of ["toString", "constructor", "valueOf", "hasOwnProperty"]) {
      const res = await postJson<{ ok: boolean; error?: string }>(
        `${slack.origin}/api/auth.test`,
        {},
        { authorization: `Bearer ${protoKey}` },
      );
      expect(res.json).toEqual({ ok: false, error: "invalid_auth" });
    }

    for (const badRedirect of ["javascript:alert(1)", "http://evil.example/cb", "not-a-valid-url"]) {
      const badAuthz = await fetch(
        `${slack.origin}/oauth/v2/authorize?client_id=alpha&user_scope=channels:read&redirect_uri=${encodeURIComponent(badRedirect)}&auto_approve=1`,
        { redirect: "manual" },
      );
      expect(badAuthz.status).toBe(400);
      expect(await badAuthz.json()).toEqual({ ok: false, error: "bad_redirect_uri" });
    }

    const plainPkce = await fetch(
      `${slack.origin}/oauth/v2/authorize?client_id=alpha&user_scope=channels:read&redirect_uri=http://127.0.0.1/cb&code_challenge=abc&code_challenge_method=plain&auto_approve=1`,
      { redirect: "manual" },
    );
    expect(plainPkce.status).toBe(400);
    expect(await plainPkce.json()).toEqual({ ok: false, error: "invalid_code_challenge_method" });

    const verifier = "pkce-verifier-regression-check-9876543210";
    const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
    const redirectRes = await fetch(
      `${slack.origin}/oauth/v2/authorize?client_id=alpha&user_scope=channels:read&redirect_uri=http://127.0.0.1/cb&code_challenge=${challenge}&code_challenge_method=S256&team=T01ALPHA&auto_approve=1`,
      { redirect: "manual" },
    );
    const code = new URL(redirectRes.headers.get("location")!).searchParams.get("code")!;

    const missingRedirect = await postJson<{ ok: boolean; error?: string }>(`${slack.origin}/api/oauth.v2.access`, {
      code,
      client_id: "alpha",
      code_verifier: verifier,
    });
    expect(missingRedirect.json).toEqual({ ok: false, error: "bad_redirect_uri" });

    const wrongClient = await postJson<{ ok: boolean; error?: string }>(`${slack.origin}/api/oauth.v2.access`, {
      code,
      client_id: "other-client",
      redirect_uri: "http://127.0.0.1/cb",
      code_verifier: verifier,
    });
    expect(wrongClient.json).toEqual({ ok: false, error: "invalid_client_id" });

    const authHeader = { authorization: "Bearer xoxp-alpha-team-owner-initial" };
    const sse = await openSse(`${slack.origin}/alpha/slack/events`, authHeader);
    try {
      await postJson(`${slack.origin}/api/auth.revoke`, {}, authHeader);
      const revokedEvent = await sse.nextEvent();
      expect(revokedEvent.data).toMatchObject({ event: { type: "tokens_revoked" } });
      await expect(sse.nextEvent()).rejects.toThrow("SSE stream closed before event arrived");
    } finally {
      sse.close();
    }

    await postJson(`${slack.origin}/__control/reset`);
    await postJson(`${slack.origin}/__control/fault`, { path: "/api/auth.test", status: 503, remaining: 0 });
    const unaffected = await postJson<{ ok: boolean }>(`${slack.origin}/api/auth.test`, {}, authHeader);
    expect(unaffected.status).toBe(200);
    expect(unaffected.json.ok).toBe(true);
  });
});

describe("Telegram user-account RPC+SSE provider", () => {
  let telegram: RunningProvider;

  beforeAll(async () => {
    telegram = await startTelegramProvider();
  });

  afterAll(async () => {
    await telegram.stop();
  });

  beforeEach(async () => {
    const reset = await postJson<{ ok: boolean }>(`${telegram.origin}/__control/reset`);
    expect(reset.json.ok).toBe(true);
  });

  it("supports phone/OTP (Test DC + expiry), 2FA password, QR login, bot-token rejection, and logout", async () => {
    const badPhone = await postJson<{ ok: boolean; error_message: string }>(`${telegram.origin}/rpc/auth.sendCode`, {
      phone_number: "not-e164",
    });
    expect(badPhone.status).toBe(400);
    expect(badPhone.json.error_message).toBe("PHONE_NUMBER_INVALID");

    const sentDc = await postJson<{ ok: boolean; phone_code_hash: string }>(`${telegram.origin}/rpc/auth.sendCode`, {
      phone_number: "+9996621234",
    });
    expect(sentDc.json.ok).toBe(true);

    const lastCode = await (await fetch(`${telegram.origin}/__control/last-code?phone=${encodeURIComponent("+9996621234")}`)).json() as {
      ok: boolean;
      code: string;
    };
    expect(lastCode.code).toBe("22222");

    const badCode = await postJson<{ ok: boolean; error_message: string }>(`${telegram.origin}/rpc/auth.signIn`, {
      phone_number: "+9996621234",
      phone_code_hash: sentDc.json.phone_code_hash,
      phone_code: "99999",
    });
    expect(badCode.status).toBe(400);
    expect(badCode.json.error_message).toBe("PHONE_CODE_INVALID");

    await postJson(`${telegram.origin}/__control/expire-code`, { phone_code_hash: sentDc.json.phone_code_hash });
    const expiredSignIn = await postJson<{ ok: boolean; error_message: string }>(`${telegram.origin}/rpc/auth.signIn`, {
      phone_number: "+9996621234",
      phone_code_hash: sentDc.json.phone_code_hash,
      phone_code: "22222",
    });
    expect(expiredSignIn.status).toBe(400);
    expect(expiredSignIn.json.error_message).toBe("PHONE_CODE_EXPIRED");

    const sentDc2 = await postJson<{ ok: boolean; phone_code_hash: string }>(`${telegram.origin}/rpc/auth.sendCode`, {
      phone_number: "+9996635678",
    });
    const signedDc = await postJson<{ ok: boolean; session_token: string; user: { phone: string } }>(
      `${telegram.origin}/rpc/auth.signIn`,
      {
        phone_number: "+9996635678",
        phone_code_hash: sentDc2.json.phone_code_hash,
        phone_code: "33333",
      },
    );
    expect(signedDc.json.ok).toBe(true);
    expect(signedDc.json.session_token.startsWith("tg-sess-")).toBe(true);

    const sent2fa = await postJson<{ ok: boolean; phone_code_hash: string }>(`${telegram.origin}/rpc/auth.sendCode`, {
      phone_number: "+15550109999",
    });
    const code2fa = await (await fetch(`${telegram.origin}/__control/last-code?phone=${encodeURIComponent("+15550109999")}`)).json() as {
      code: string;
    };
    const needPass = await postJson<{ ok: boolean; error_message: string; hint: string; pending_auth_id: string }>(
      `${telegram.origin}/rpc/auth.signIn`,
      {
        phone_number: "+15550109999",
        phone_code_hash: sent2fa.json.phone_code_hash,
        phone_code: code2fa.code,
      },
    );
    expect(needPass.status).toBe(401);
    expect(needPass.json.error_message).toBe("SESSION_PASSWORD_NEEDED");
    expect(needPass.json.hint).toBe("codename");

    const pwdInfo = await postJson<{ ok: boolean; has_password: boolean; hint: string }>(
      `${telegram.origin}/rpc/account.getPassword`,
      { pending_auth_id: needPass.json.pending_auth_id },
    );
    expect(pwdInfo.json).toMatchObject({ ok: true, has_password: true, hint: "codename" });

    const wrongPass = await postJson<{ ok: boolean; error_message: string }>(
      `${telegram.origin}/rpc/auth.checkPassword`,
      { pending_auth_id: needPass.json.pending_auth_id, password: "wrong" },
    );
    expect(wrongPass.status).toBe(400);
    expect(wrongPass.json.error_message).toBe("PASSWORD_HASH_INVALID");

    const authed2fa = await postJson<{ ok: boolean; session_token: string }>(
      `${telegram.origin}/rpc/auth.checkPassword`,
      { pending_auth_id: needPass.json.pending_auth_id, password: "alpha-2fa" },
    );
    expect(authed2fa.json.ok).toBe(true);
    expect(authed2fa.json.session_token.startsWith("tg-sess-")).toBe(true);

    const qrStart = await postJson<{ ok: boolean; _type: string; token: string; login_url: string }>(
      `${telegram.origin}/rpc/auth.exportLoginToken`,
      {},
    );
    expect(qrStart.json._type).toBe("auth.loginToken");
    expect(qrStart.json.login_url).toBe(`tg://login?token=${qrStart.json.token}`);

    await postJson(`${telegram.origin}/__control/approve-qr`, { token: qrStart.json.token });
    const qrSuccess = await postJson<{ ok: boolean; _type: string; authorization: { session_token: string } }>(
      `${telegram.origin}/rpc/auth.exportLoginToken`,
      { token: qrStart.json.token },
    );
    expect(qrSuccess.json._type).toBe("auth.loginTokenSuccess");
    expect(qrSuccess.json.authorization.session_token.startsWith("tg-sess-")).toBe(true);

    const botAttempt = await postJson<{ ok: boolean; error_message: string }>(
      `${telegram.origin}/rpc/users.getMe`,
      {},
      { authorization: "Bearer 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" },
    );
    expect(botAttempt.status).toBe(401);
    expect(botAttempt.json.error_message).toBe("BOT_TOKENS_NOT_SUPPORTED");

    const loggedOut = await postJson<{ ok: boolean }>(
      `${telegram.origin}/rpc/auth.logOut`,
      {},
      { authorization: `Bearer ${signedDc.json.session_token}` },
    );
    expect(loggedOut.json.ok).toBe(true);

    const afterLogout = await postJson<{ ok: boolean; error_message: string }>(
      `${telegram.origin}/rpc/users.getMe`,
      {},
      { authorization: `Bearer ${signedDc.json.session_token}` },
    );
    expect(afterLogout.status).toBe(401);
    expect(afterLogout.json.error_message).toBe("AUTH_KEY_UNREGISTERED");
  });

  it("supports dialogs, history, idempotent sends, broadcast guard, edit/delete, reactions, readHistory, search, SSE updates, FLOOD_WAIT, and revoke", async () => {
    const authHeader = { authorization: "Bearer tg-sess-initial-owner" };

    const dialogs = await postJson<{
      ok: boolean;
      pts: number;
      dialogs: { peer_key: string; can_post: boolean; unread_count: number; unread_mentions_count: number; pinned: boolean }[];
    }>(`${telegram.origin}/rpc/messages.getDialogs`, {}, authHeader);
    expect(dialogs.json.ok).toBe(true);
    expect(dialogs.json.dialogs[0]?.peer_key).toBe("user:2001");
    expect(dialogs.json.dialogs[0]?.pinned).toBe(true);
    const broadcast = dialogs.json.dialogs.find((d) => d.peer_key === "channel:4002");
    expect(broadcast?.can_post).toBe(false);

    const archived = await postJson<{ ok: boolean; dialogs: { peer_key: string }[] }>(
      `${telegram.origin}/rpc/messages.getDialogs`,
      { archived: true },
      authHeader,
    );
    expect(archived.json.dialogs.map((d) => d.peer_key)).toEqual(["user:2002"]);

    // spec/app/messages/index.md, "Story: See my conversations"
    const allChats = await postJson<{ ok: boolean; dialogs: { peer_key: string; archived: boolean }[] }>(
      `${telegram.origin}/rpc/messages.getDialogs`,
      { folder_id: 0 },
      authHeader,
    );
    expect(allChats.json.dialogs.some((d) => d.archived)).toBe(false);
    expect(allChats.json.dialogs.map((d) => d.peer_key)).not.toContain("user:2002");

    const broadcastWrite = await postJson<{ ok: boolean; error_message: string }>(
      `${telegram.origin}/rpc/messages.sendMessage`,
      { peer: "channel:4002", message: "Cannot post here" },
      authHeader,
    );
    expect(broadcastWrite.status).toBe(403);
    expect(broadcastWrite.json.error_message).toBe("CHAT_WRITE_FORBIDDEN");

    const sse = await openSse(`${telegram.origin}/rpc/updates.stream?pts=${dialogs.json.pts}`, authHeader);
    try {
      const sent1 = await postJson<{ ok: boolean; pts: number; message: { id: number; reply_to_msg_id?: number } }>(
        `${telegram.origin}/rpc/messages.sendMessage`,
        { peer: { _type: "peerUser", user_id: 2001 }, message: "See you there!", reply_to_msg_id: 102, random_id: 9001 },
        authHeader,
      );
      const sent2 = await postJson<{ ok: boolean; message: { id: number } }>(
        `${telegram.origin}/rpc/messages.sendMessage`,
        { peer: { _type: "peerUser", user_id: 2001 }, message: "See you there!", random_id: 9001 },
        authHeader,
      );
      expect(sent1.json.message.id).toBe(sent2.json.message.id);
      expect(sent1.json.message.reply_to_msg_id).toBe(102);

      const newEvt = await sse.nextEvent();
      expect(newEvt.event).toBe("updateNewMessage");

      const peerEditDenied = await postJson<{ ok: boolean; error_message: string }>(
        `${telegram.origin}/rpc/messages.editMessage`,
        { peer: "user:2001", id: 102, message: "tamper" },
        authHeader,
      );
      expect(peerEditDenied.status).toBe(403);
      expect(peerEditDenied.json.error_message).toBe("MESSAGE_AUTHOR_REQUIRED");

      const ownEdit = await postJson<{ ok: boolean; message: { message: string; edit_date?: number } }>(
        `${telegram.origin}/rpc/messages.editMessage`,
        { peer: "user:2001", id: sent1.json.message.id, message: "See you at 12:15!" },
        authHeader,
      );
      expect(ownEdit.json.message.message).toBe("See you at 12:15!");
      expect(ownEdit.json.message.edit_date).toBeGreaterThan(0);
      expect((await sse.nextEvent()).event).toBe("updateEditMessage");

      const reacted = await postJson<{ ok: boolean; message: { reactions: { emoticon: string; chosen: boolean }[] } }>(
        `${telegram.origin}/rpc/messages.sendReaction`,
        { peer: "user:2001", msg_id: 102, reaction: "🔥" },
        authHeader,
      );
      expect(reacted.json.message.reactions.some((r) => r.emoticon === "🔥" && r.chosen)).toBe(true);
      expect((await sse.nextEvent()).event).toBe("updateMessageReactions");

      const readRes = await postJson<{ ok: boolean; unread_count: number }>(
        `${telegram.origin}/rpc/messages.readHistory`,
        { peer: "chat:3001", max_id: 105 },
        authHeader,
      );
      expect(readRes.json.unread_count).toBe(0);
      expect((await sse.nextEvent()).event).toBe("updateReadHistoryInbox");

      const muted = await postJson<{ ok: boolean; notify_settings: { mute_until: number } }>(
        `${telegram.origin}/rpc/account.updateNotifySettings`,
        { peer: "chat:3001", mute_until: 2_147_483_647 },
        authHeader,
      );
      expect(muted.json.notify_settings.mute_until).toBe(2_147_483_647);

      const injected = await postJson<{ ok: boolean; message: { id: number; mentioned: boolean } }>(
        `${telegram.origin}/__control/inject`,
        { peer: "chat:3001", message: "@alexrivera urgent review needed" },
      );
      expect(injected.json.message.mentioned).toBe(true);
      expect((await sse.nextEvent()).event).toBe("updateNewMessage");

      const search = await postJson<{ ok: boolean; messages: { id: number }[] }>(
        `${telegram.origin}/rpc/messages.searchGlobal`,
        { q: "urgent review" },
        authHeader,
      );
      expect(search.json.messages.map((m) => m.id)).toContain(injected.json.message.id);

      const deleted = await postJson<{ ok: boolean; deleted_ids: number[] }>(
        `${telegram.origin}/rpc/messages.deleteMessages`,
        { peer: "user:2001", id: [sent1.json.message.id], revoke: true },
        authHeader,
      );
      expect(deleted.json.deleted_ids).toEqual([sent1.json.message.id]);
      expect((await sse.nextEvent()).event).toBe("updateDeleteMessages");

      const diff = await postJson<{ ok: boolean; new_messages: unknown[]; other_updates: unknown[] }>(
        `${telegram.origin}/rpc/updates.getDifference`,
        { pts: dialogs.json.pts },
        authHeader,
      );
      expect(diff.json.new_messages.length).toBeGreaterThanOrEqual(2);
      expect(diff.json.other_updates.length).toBeGreaterThanOrEqual(4);

      await postJson(`${telegram.origin}/__control/revoke`, { session_token: "tg-sess-initial-owner" });
      expect((await sse.nextEvent()).event).toBe("updateSessionRevoked");
    } finally {
      sse.close();
    }

    await postJson(`${telegram.origin}/__control/fault`, {
      path: "/rpc/messages.getDialogs",
      status: 429,
      retryAfter: 12,
    });
    const flood = await postJson<{ ok: boolean; error_code: number; error_message: string }>(
      `${telegram.origin}/rpc/messages.getDialogs`,
      {},
      authHeader,
    );
    expect(flood.status).toBe(429);
    expect(flood.headers.get("retry-after")).toBe("12");
    expect(flood.json).toEqual({ ok: false, error_code: 429, error_message: "FLOOD_WAIT_12" });
  });

  it("blocks prototype-key auth bypass, QR replay and double approval, broadcast/peer delete, and disconnects SSE on logout/revoke", async () => {
    for (const protoKey of ["toString", "constructor", "valueOf", "hasOwnProperty"]) {
      const me = await postJson<{ ok: boolean; error_message: string }>(
        `${telegram.origin}/rpc/users.getMe`,
        {},
        { authorization: `Bearer ${protoKey}` },
      );
      expect(me.status).toBe(401);
      expect(me.json.error_message).toBe("AUTH_KEY_UNREGISTERED");
      const logout = await postJson<{ ok: boolean; error_message: string }>(
        `${telegram.origin}/rpc/auth.logOut`,
        {},
        { authorization: `Bearer ${protoKey}` },
      );
      expect(logout.status).toBe(401);
      expect((Object.prototype.toString as unknown as { revoked?: boolean }).revoked).toBeUndefined();
    }

    const qr = await postJson<{ ok: boolean; token: string }>(`${telegram.origin}/rpc/auth.exportLoginToken`, {});
    const approved1 = await postJson<{ ok: boolean }>(`${telegram.origin}/__control/approve-qr`, { token: qr.json.token });
    expect(approved1.status).toBe(200);
    const approved2 = await postJson<{ ok: boolean; error?: string }>(`${telegram.origin}/__control/approve-qr`, { token: qr.json.token });
    expect(approved2.status).toBe(409);

    const claim1 = await postJson<{ ok: boolean; _type: string }>(`${telegram.origin}/rpc/auth.exportLoginToken`, { token: qr.json.token });
    expect(claim1.status).toBe(200);
    expect(claim1.json._type).toBe("auth.loginTokenSuccess");

    const claim2 = await postJson<{ ok: boolean; error_message: string }>(`${telegram.origin}/rpc/auth.exportLoginToken`, { token: qr.json.token });
    expect(claim2.status).toBe(400);
    expect(claim2.json.error_message).toBe("AUTH_TOKEN_EXPIRED");

    const authHeader = { authorization: "Bearer tg-sess-initial-owner" };
    const broadcastDelete = await postJson<{ ok: boolean; error_message: string }>(
      `${telegram.origin}/rpc/messages.deleteMessages`,
      { peer: "channel:4002", id: [107] },
      authHeader,
    );
    expect(broadcastDelete.status).toBe(403);
    expect(broadcastDelete.json.error_message).toBe("CHAT_WRITE_FORBIDDEN");

    const peerDelete = await postJson<{ ok: boolean; error_message: string }>(
      `${telegram.origin}/rpc/messages.deleteMessages`,
      { peer: "user:2001", id: [102] },
      authHeader,
    );
    expect(peerDelete.status).toBe(403);
    expect(peerDelete.json.error_message).toBe("MESSAGE_DELETE_FORBIDDEN");

    const sse = await openSse(`${telegram.origin}/rpc/updates.stream`, authHeader);
    try {
      const out = await postJson<{ ok: boolean }>(`${telegram.origin}/rpc/auth.logOut`, {}, authHeader);
      expect(out.json.ok).toBe(true);
      await expect(sse.nextEvent()).rejects.toThrow("SSE stream closed before event arrived");
    } finally {
      sse.close();
    }
  });
});

describe("Provider persistence and standalone CLI", () => {
  it("persists state across provider restarts when stateFile is configured", async () => {
    const dir = scratch();
    const slackFile = path.join(dir, "slack.json");
    const tgFile = path.join(dir, "telegram.json");
    try {
      const s1 = await startSlackProvider({ stateFile: slackFile });
      const posted = await postJson<{ ok: boolean; ts: string }>(
        `${s1.origin}/api/chat.postMessage`,
        { channel: "C01GENERAL", text: "Persisted across restart" },
        { authorization: "Bearer xoxp-alpha-team-owner-initial" },
      );
      await s1.stop();

      const s2 = await startSlackProvider({ stateFile: slackFile });
      try {
        const hist = await postJson<{ ok: boolean; messages: { ts: string; text: string }[] }>(
          `${s2.origin}/api/conversations.history`,
          { channel: "C01GENERAL" },
          { authorization: "Bearer xoxp-alpha-team-owner-initial" },
        );
        expect(hist.json.messages.some((m) => m.ts === posted.json.ts && m.text === "Persisted across restart")).toBe(true);
      } finally {
        await s2.stop();
      }

      const t1 = await startTelegramProvider({ stateFile: tgFile });
      const sent = await postJson<{ ok: boolean; message: { id: number } }>(
        `${t1.origin}/rpc/messages.sendMessage`,
        { peer: "user:2001", message: "Persisted Telegram note" },
        { authorization: "Bearer tg-sess-initial-owner" },
      );
      await t1.stop();

      const t2 = await startTelegramProvider({ stateFile: tgFile });
      try {
        const hist = await postJson<{ ok: boolean; messages: { id: number; message: string }[] }>(
          `${t2.origin}/rpc/messages.getHistory`,
          { peer: "user:2001" },
          { authorization: "Bearer tg-sess-initial-owner" },
        );
        expect(hist.json.messages.some((m) => m.id === sent.json.message.id && m.message === "Persisted Telegram note")).toBe(true);
      } finally {
        await t2.stop();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("launches both providers via standalone CLI and shuts down cleanly on SIGTERM", async () => {
    const dir = scratch();
    const cliPath = path.join(import.meta.dirname, "../src/providers/cli.ts");
    const child = spawn(process.execPath, [cliPath, "--slack-port", "0", "--telegram-port", "0", "--state-dir", dir], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const ready = await new Promise<{ slackOrigin: string; telegramOrigin: string }>((resolve, reject) => {
        let out = "";
        child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
          out += chunk;
          const nl = out.indexOf("\n");
          if (nl >= 0) resolve(JSON.parse(out.slice(0, nl)) as { slackOrigin: string; telegramOrigin: string });
        });
        child.once("error", reject);
        child.once("exit", (code) => reject(new Error(`CLI exited early with ${code}`)));
      });
      const slackCheck = await postJson<{ ok: boolean }>(
        `${ready.slackOrigin}/api/auth.test`,
        {},
        { authorization: "Bearer xoxp-alpha-team-owner-initial" },
      );
      const tgCheck = await postJson<{ ok: boolean }>(
        `${ready.telegramOrigin}/rpc/users.getMe`,
        {},
        { authorization: "Bearer tg-sess-initial-owner" },
      );
      expect(slackCheck.json.ok).toBe(true);
      expect(tgCheck.json.ok).toBe(true);

      const exitCode = await new Promise<number | null>((resolve) => {
        child.once("exit", resolve);
        child.kill("SIGTERM");
      });
      expect(exitCode).toBe(0);
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
