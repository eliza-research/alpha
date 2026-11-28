import type { ServerResponse } from "node:http";
import {
  type FaultRule,
  type ParsedRequest,
  type ProviderContext,
  type ProviderOptions,
  type RunningProvider,
  asBoolean,
  asNumber,
  asString,
  asStringArray,
  bearerToken,
  createProviderServer,
  escapeHtml,
  ownGet,
  paginateSlice,
  pruneRecordCap,
  randomToken,
  sendHtml,
  sendJson,
  sendRedirect,
  verifyPkceS256,
} from "./shared.ts";

/** Slack workspace user profile record. */
export interface SlackUser {
  readonly id: string;
  readonly team_id: string;
  readonly name: string;
  readonly real_name: string;
  readonly display_name: string;
  readonly is_owner: boolean;
  readonly is_bot: boolean;
  readonly deleted: boolean;
  readonly presence: "active" | "away";
}

/** Slack message reaction aggregate. */
export interface SlackReaction {
  readonly name: string;
  users: string[];
  count: number;
}

/** Slack stored message record. */
export interface SlackMessage {
  readonly type: "message";
  readonly ts: string;
  readonly user: string;
  text: string;
  readonly thread_ts?: string;
  readonly reply_broadcast?: boolean;
  reply_count?: number;
  reply_users_count?: number;
  reply_users?: string[];
  latest_reply?: string;
  reactions: SlackReaction[];
  edited?: { readonly user: string; readonly ts: string };
  readonly subtype?: string;
}

/** Slack conversation (public/private channel, DM, or MPIM). */
export interface SlackChannel {
  readonly id: string;
  readonly name: string;
  readonly is_channel: boolean;
  readonly is_group: boolean;
  readonly is_im: boolean;
  readonly is_mpim: boolean;
  readonly is_private: boolean;
  readonly is_archived: boolean;
  readonly user?: string;
  readonly members: string[];
  readonly topic: { readonly value: string };
  readonly purpose: { readonly value: string };
  last_read: string;
  is_muted: boolean;
  messages: SlackMessage[];
}

/** Slack workspace container holding isolated users, channels, and messages. */
export interface SlackWorkspace {
  readonly id: string;
  readonly name: string;
  readonly domain: string;
  readonly url: string;
  readonly ownerId: string;
  readonly users: Record<string, SlackUser>;
  readonly channels: Record<string, SlackChannel>;
}

interface SlackAuthCode {
  readonly code: string;
  readonly client_id: string;
  readonly user_scope: string;
  readonly redirect_uri: string;
  readonly state: string;
  readonly team_id: string;
  readonly code_challenge?: string;
  readonly code_challenge_method?: string;
  used: boolean;
}

interface SlackUserToken {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly team_id: string;
  readonly user_id: string;
  readonly scope: string;
  revoked: boolean;
}

interface SlackState {
  eventSeq: number;
  tsCounter: number;
  readonly workspaces: Record<string, SlackWorkspace>;
  readonly authCodes: Record<string, SlackAuthCode>;
  readonly tokens: Record<string, SlackUserToken>;
  readonly idempotency: Record<string, { readonly channel: string; readonly ts: string; readonly message: SlackMessage }>;
}

interface ResolvedAuth {
  readonly workspace: SlackWorkspace;
  readonly userId: string;
  readonly token: SlackUserToken;
}

const DEFAULT_USER_SCOPES = [
  "channels:read",
  "channels:history",
  "groups:read",
  "groups:history",
  "im:read",
  "im:history",
  "im:write",
  "mpim:read",
  "mpim:history",
  "mpim:write",
  "chat:write",
  "reactions:read",
  "reactions:write",
  "search:read",
  "users:read",
  "team:read",
].join(",");

const APP_ID = "A01ALPHA";
const MAX_IDEMPOTENCY = 500;
const MAX_AUTH_CODES = 500;

function makeMessage(
  ts: string,
  user: string,
  text: string,
  extra?: Partial<Pick<SlackMessage, "thread_ts" | "reply_broadcast" | "reactions" | "edited" | "subtype">>,
): SlackMessage {
  return {
    type: "message",
    ts,
    user,
    text,
    reactions: extra?.reactions ?? [],
    ...(extra?.thread_ts !== undefined ? { thread_ts: extra.thread_ts } : {}),
    ...(extra?.reply_broadcast !== undefined ? { reply_broadcast: extra.reply_broadcast } : {}),
    ...(extra?.edited !== undefined ? { edited: extra.edited } : {}),
    ...(extra?.subtype !== undefined ? { subtype: extra.subtype } : {}),
  };
}

function makeUser(
  id: string,
  teamId: string,
  name: string,
  realName: string,
  isOwner = false,
): SlackUser {
  return {
    id,
    team_id: teamId,
    name,
    real_name: realName,
    display_name: name,
    is_owner: isOwner,
    is_bot: false,
    deleted: false,
    presence: "active",
  };
}

function recomputeThreadStats(channel: SlackChannel, threadTs: string): void {
  const parent = channel.messages.find((item) => item.ts === threadTs);
  if (!parent) return;
  const replies = channel.messages.filter((item) => item.thread_ts === threadTs && item.ts !== threadTs);
  if (replies.length === 0) {
    delete parent.reply_count;
    delete parent.reply_users_count;
    delete parent.reply_users;
    delete parent.latest_reply;
    return;
  }
  const uniqueUsers = [...new Set(replies.map((item) => item.user))];
  parent.reply_count = replies.length;
  parent.reply_users = uniqueUsers;
  parent.reply_users_count = uniqueUsers.length;
  parent.latest_reply = replies[replies.length - 1].ts;
}

function createAlphaWorkspace(): SlackWorkspace {
  const teamId = "T01ALPHA";
  const general: SlackChannel = {
    id: "C01GENERAL",
    name: "general",
    is_channel: true,
    is_group: false,
    is_im: false,
    is_mpim: false,
    is_private: false,
    is_archived: false,
    members: ["U01OWNER", "U02MAYA", "U03DEVON", "U04PRIYA"],
    topic: { value: "Alpha Phone team announcements" },
    purpose: { value: "Company-wide updates and milestones" },
    last_read: "1730000100.000100",
    is_muted: false,
    messages: [
      makeMessage("1730000100.000100", "U02MAYA", "Sprint review kicks off at 2pm today.", {
        reactions: [{ name: "rocket", users: ["U03DEVON"], count: 1 }],
      }),
      makeMessage("1730000120.000200", "U03DEVON", "I will share the latency benchmarks right before.", {
        thread_ts: "1730000100.000100",
      }),
      makeMessage("1730000130.000300", "U04PRIYA", "Design slides are linked in the doc.", {
        thread_ts: "1730000100.000100",
      }),
    ],
  };
  recomputeThreadStats(general, "1730000100.000100");

  const engineering: SlackChannel = {
    id: "C02ENG",
    name: "engineering",
    is_channel: true,
    is_group: false,
    is_im: false,
    is_mpim: false,
    is_private: false,
    is_archived: false,
    members: ["U01OWNER", "U02MAYA", "U03DEVON"],
    topic: { value: "Core platform and runtime" },
    purpose: { value: "Engineering coordination" },
    last_read: "1730000200.000100",
    is_muted: false,
    messages: [
      makeMessage("1730000200.000100", "U01OWNER", "Shipping the new HTTP client layer today."),
      makeMessage("1730000250.000200", "U03DEVON", "<@U01OWNER> can you review the retry backoff PR?"),
    ],
  };

  const launchPrep: SlackChannel = {
    id: "G01LAUNCH",
    name: "launch-prep",
    is_channel: false,
    is_group: true,
    is_im: false,
    is_mpim: false,
    is_private: true,
    is_archived: false,
    members: ["U01OWNER", "U02MAYA", "U04PRIYA"],
    topic: { value: "Private launch readiness" },
    purpose: { value: "Release checklist" },
    last_read: "1730000300.000100",
    is_muted: false,
    messages: [
      makeMessage("1730000300.000100", "U04PRIYA", "Checklist is 90% green for Friday."),
    ],
  };

  const dmMaya: SlackChannel = {
    id: "D01MAYA",
    name: "D01MAYA",
    is_channel: false,
    is_group: false,
    is_im: true,
    is_mpim: false,
    is_private: true,
    is_archived: false,
    user: "U02MAYA",
    members: ["U01OWNER", "U02MAYA"],
    topic: { value: "" },
    purpose: { value: "" },
    last_read: "1730000350.000100",
    is_muted: false,
    messages: [
      makeMessage("1730000350.000100", "U01OWNER", "Hey Maya, ready for the demo?"),
      makeMessage("1730000360.000200", "U02MAYA", "Yes! Grabbing coffee and joining in 5."),
    ],
  };

  const mpim: SlackChannel = {
    id: "G02MPIM",
    name: "mpdm-owner--maya--devon-1",
    is_channel: false,
    is_group: true,
    is_im: false,
    is_mpim: true,
    is_private: true,
    is_archived: false,
    members: ["U01OWNER", "U02MAYA", "U03DEVON"],
    topic: { value: "" },
    purpose: { value: "Group direct message" },
    last_read: "1730000400.000100",
    is_muted: false,
    messages: [
      makeMessage("1730000400.000100", "U02MAYA", "Let us align on the messaging rollout."),
    ],
  };

  return {
    id: teamId,
    name: "Alpha Team",
    domain: "alpha-team",
    url: "https://alpha-team.slack.com/",
    ownerId: "U01OWNER",
    users: {
      U01OWNER: makeUser("U01OWNER", teamId, "owner", "Alex Rivera", true),
      U02MAYA: makeUser("U02MAYA", teamId, "maya", "Maya Chen"),
      U03DEVON: makeUser("U03DEVON", teamId, "devon", "Devon Brooks"),
      U04PRIYA: makeUser("U04PRIYA", teamId, "priya", "Priya Nair"),
    },
    channels: {
      C01GENERAL: general,
      C02ENG: engineering,
      G01LAUNCH: launchPrep,
      D01MAYA: dmMaya,
      G02MPIM: mpim,
    },
  };
}

function createDesignWorkspace(): SlackWorkspace {
  const teamId = "T02DESIGN";
  const critique: SlackChannel = {
    id: "C11CRITIQUE",
    name: "critique",
    is_channel: true,
    is_group: false,
    is_im: false,
    is_mpim: false,
    is_private: false,
    is_archived: false,
    members: ["U11OWNER", "U12SORA", "U13LIAM"],
    topic: { value: "Daily design reviews" },
    purpose: { value: "Share mocks and feedback" },
    last_read: "1730000500.000100",
    is_muted: false,
    messages: [
      makeMessage("1730000500.000100", "U12SORA", "Posted the updated typography tokens."),
      makeMessage("1730000520.000200", "U13LIAM", "<@U11OWNER> curious what you think of the compact spacing."),
    ],
  };

  const dmSora: SlackChannel = {
    id: "D11SORA",
    name: "D11SORA",
    is_channel: false,
    is_group: false,
    is_im: true,
    is_mpim: false,
    is_private: true,
    is_archived: false,
    user: "U12SORA",
    members: ["U11OWNER", "U12SORA"],
    topic: { value: "" },
    purpose: { value: "" },
    last_read: "1730000530.000100",
    is_muted: false,
    messages: [
      makeMessage("1730000530.000100", "U12SORA", "Thanks for the feedback on the icon set!"),
    ],
  };

  return {
    id: teamId,
    name: "Design Guild",
    domain: "design-guild",
    url: "https://design-guild.slack.com/",
    ownerId: "U11OWNER",
    users: {
      U11OWNER: makeUser("U11OWNER", teamId, "owner", "Alex Rivera", true),
      U12SORA: makeUser("U12SORA", teamId, "sora", "Sora Takahashi"),
      U13LIAM: makeUser("U13LIAM", teamId, "liam", "Liam O'Connor"),
    },
    channels: {
      C11CRITIQUE: critique,
      D11SORA: dmSora,
    },
  };
}

function createInitialSlackState(): SlackState {
  const alpha = createAlphaWorkspace();
  const design = createDesignWorkspace();
  const alphaToken = "xoxp-alpha-team-owner-initial";
  const designToken = "xoxp-design-guild-owner-initial";
  return {
    eventSeq: 0,
    tsCounter: 1000,
    workspaces: {
      [alpha.id]: alpha,
      [design.id]: design,
    },
    authCodes: {},
    tokens: {
      [alphaToken]: {
        access_token: alphaToken,
        refresh_token: "xoxe-1-alpha-team-initial",
        team_id: alpha.id,
        user_id: alpha.ownerId,
        scope: DEFAULT_USER_SCOPES,
        revoked: false,
      },
      [designToken]: {
        access_token: designToken,
        refresh_token: "xoxe-1-design-guild-initial",
        team_id: design.id,
        user_id: design.ownerId,
        scope: DEFAULT_USER_SCOPES,
        revoked: false,
      },
    },
    idempotency: {},
  };
}

function nextSlackTs(state: SlackState): string {
  state.tsCounter += 1;
  const seconds = Math.floor(Date.now() / 1000);
  return `${seconds}.${String(state.tsCounter).padStart(6, "0")}`;
}

function parseTsParts(ts: string): readonly [number, number] | undefined {
  const [secRaw, seqRaw = "0"] = ts.split(".");
  if (secRaw === undefined || !/^\d+$/.test(secRaw) || !/^\d+$/.test(seqRaw)) return undefined;
  return [Number(secRaw), Number(seqRaw)];
}

function compareTs(a: string, b: string): number {
  const parsedA = parseTsParts(a);
  const parsedB = parseTsParts(b);
  if (parsedA !== undefined && parsedB !== undefined) {
    if (parsedA[0] !== parsedB[0]) return parsedA[0] - parsedB[0];
    if (parsedA[1] !== parsedB[1]) return parsedA[1] - parsedB[1];
  }
  return a.localeCompare(b);
}

function canAccessChannel(channel: SlackChannel, userId: string): boolean {
  return !channel.is_private || channel.members.includes(userId);
}

function visibleTimelineMessages(channel: SlackChannel): SlackMessage[] {
  return channel.messages.filter(
    (msg) => msg.thread_ts === undefined || msg.thread_ts === msg.ts || msg.reply_broadcast === true,
  );
}

function computeChannelSummary(channel: SlackChannel, ownerId: string): Record<string, unknown> {
  const timeline = visibleTimelineMessages(channel);
  const unread = timeline.filter(
    (msg) => msg.user !== ownerId && compareTs(msg.ts, channel.last_read) > 0,
  ).length;
  const latest = timeline[timeline.length - 1];
  return {
    id: channel.id,
    name: channel.name,
    is_channel: channel.is_channel,
    is_group: channel.is_group,
    is_im: channel.is_im,
    is_mpim: channel.is_mpim,
    is_private: channel.is_private,
    is_archived: channel.is_archived,
    ...(channel.user !== undefined ? { user: channel.user } : {}),
    members: channel.members,
    topic: channel.topic,
    purpose: channel.purpose,
    last_read: channel.last_read,
    is_muted: channel.is_muted,
    unread_count: unread,
    unread_count_display: unread,
    ...(latest !== undefined ? { latest } : {}),
  };
}

interface LocalSlackEvent {
  readonly sequence: number;
  readonly team: string;
  readonly envelope: Readonly<Record<string, unknown>>;
}

const receiverEvents = new WeakMap<SlackState, LocalSlackEvent[]>();

function pushSlackEvent(
  ctx: ProviderContext<SlackState>,
  teamId: string,
  event: Record<string, unknown>,
): void {
  const state = ctx.getState();
  state.eventSeq += 1;
  const envelope = {
    type: "event_callback",
    team_id: teamId,
    api_app_id: APP_ID,
    event_id: `Ev${String(state.eventSeq).padStart(8, "0")}`,
    event_time: Math.floor(Date.now() / 1000),
    event,
  };
  const events = receiverEvents.get(state) ?? [];
  events.push({ sequence: state.eventSeq, team: teamId, envelope });
  if (events.length > 300) events.shift();
  receiverEvents.set(state, events);
  ctx.sse.broadcast({
    id: envelope.event_id,
    event: "event_callback",
    channel: teamId,
    data: envelope,
  });
}

function resolveSlackAuth(req: ParsedRequest, res: ServerResponse, state: SlackState): ResolvedAuth | undefined {
  const raw = bearerToken(req.headers) ?? asString(req.params.token);
  if (!raw) {
    sendJson(res, 200, { ok: false, error: "not_authed" });
    return undefined;
  }
  if (raw.startsWith("xoxb-") || raw.startsWith("xapp-")) {
    sendJson(res, 200, { ok: false, error: "bot_token_not_allowed" });
    return undefined;
  }
  const token = ownGet(state.tokens, raw);
  if (!token) {
    sendJson(res, 200, { ok: false, error: "invalid_auth" });
    return undefined;
  }
  if (token.revoked) {
    sendJson(res, 200, { ok: false, error: "token_revoked" });
    return undefined;
  }
  const workspace = ownGet(state.workspaces, token.team_id);
  if (!workspace) {
    sendJson(res, 200, { ok: false, error: "team_not_found" });
    return undefined;
  }
  return { workspace, userId: token.user_id, token };
}

function parseAllowedRedirectUri(raw: string): URL | undefined {
  const target = URL.parse(raw);
  if (target === null) return undefined;
  if (target.protocol === "https:" || target.protocol === "alphaphone:") return target;
  if (target.protocol === "http:" && (target.hostname === "127.0.0.1" || target.hostname === "localhost" || target.hostname === "[::1]")) {
    return target;
  }
  return undefined;
}

function redirectWithParams(target: URL, entries: Readonly<Record<string, string>>): string {
  const next = new URL(target.href);
  for (const [key, value] of Object.entries(entries)) {
    if (value !== "") next.searchParams.set(key, value);
  }
  return next.toString();
}

function renderConsentHtml(state: SlackState, fields: Readonly<Record<string, string>>): string {
  const teamOptions = Object.values(state.workspaces)
    .map((ws) => {
      const selected = ws.id === fields.team ? " selected" : "";
      return `<option value="${escapeHtml(ws.id)}"${selected}>${escapeHtml(ws.name)} (${escapeHtml(ws.id)})</option>`;
    })
    .join("");
  const scopes = fields.user_scope
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`)
    .join("");
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><title>Slack User OAuth2 Consent</title></head><body>',
    "<h1>Authorize Alpha Phone (Slack User Account)</h1>",
    "<p><strong>User account access only (<code>xoxp-</code> user token; bot tokens are not issued).</strong></p>",
    '<form method="POST" action="/oauth/v2/authorize">',
    `<label for="team">Workspace:</label><select id="team" name="team">${teamOptions}</select>`,
    `<input type="hidden" name="client_id" value="${escapeHtml(fields.client_id)}">`,
    `<input type="hidden" name="user_scope" value="${escapeHtml(fields.user_scope)}">`,
    `<input type="hidden" name="redirect_uri" value="${escapeHtml(fields.redirect_uri)}">`,
    `<input type="hidden" name="state" value="${escapeHtml(fields.state)}">`,
    `<input type="hidden" name="code_challenge" value="${escapeHtml(fields.code_challenge)}">`,
    `<input type="hidden" name="code_challenge_method" value="${escapeHtml(fields.code_challenge_method)}">`,
    `<ul>${scopes}</ul>`,
    '<button type="submit" name="decision" value="approve">Allow</button>',
    '<button type="submit" name="decision" value="deny">Cancel</button>',
    "</form></body></html>",
  ].join("");
}

function handleAuthorize(req: ParsedRequest, res: ServerResponse, ctx: ProviderContext<SlackState>): void {
  const state = ctx.getState();
  const botScope = asString(req.params.scope) ?? "";
  const userScope = asString(req.params.user_scope) ?? "";
  const tokenType = asString(req.params.token_type) ?? "";
  if (tokenType === "bot" || (botScope.trim() !== "" && userScope.trim() === "")) {
    sendJson(res, 400, { ok: false, error: "bot_tokens_not_supported" });
    return;
  }
  const teamId = asString(req.params.team) ?? "T01ALPHA";
  if (!ownGet(state.workspaces, teamId)) {
    sendJson(res, 400, { ok: false, error: "team_not_found" });
    return;
  }
  const fields: Record<string, string> = {
    client_id: asString(req.params.client_id) ?? "alpha-phone",
    user_scope: userScope.trim() !== "" ? userScope : DEFAULT_USER_SCOPES,
    redirect_uri: asString(req.params.redirect_uri) ?? "",
    state: asString(req.params.state) ?? "",
    code_challenge: asString(req.params.code_challenge) ?? "",
    code_challenge_method: asString(req.params.code_challenge_method) ?? "",
    team: teamId,
  };
  let parsedRedirect: URL | undefined;
  if (fields.redirect_uri !== "") {
    parsedRedirect = parseAllowedRedirectUri(fields.redirect_uri);
    if (parsedRedirect === undefined) {
      sendJson(res, 400, { ok: false, error: "bad_redirect_uri" });
      return;
    }
  }
  if (fields.code_challenge !== "" && fields.code_challenge_method !== "S256") {
    sendJson(res, 400, { ok: false, error: "invalid_code_challenge_method" });
    return;
  }
  const decision = asString(req.params.decision);
  if (req.method === "POST" && decision === "deny") {
    if (parsedRedirect) {
      sendRedirect(res, redirectWithParams(parsedRedirect, { error: "access_denied", state: fields.state }));
      return;
    }
    sendJson(res, 200, { ok: false, error: "access_denied", state: fields.state });
    return;
  }
  const shouldApprove = req.method === "POST" || asBoolean(req.params.auto_approve) === true;
  if (!shouldApprove) {
    sendHtml(res, 200, renderConsentHtml(state, fields));
    return;
  }
  const code = randomToken("slkcode_", 16);
  state.authCodes[code] = {
    code,
    client_id: fields.client_id,
    user_scope: fields.user_scope,
    redirect_uri: fields.redirect_uri,
    state: fields.state,
    team_id: teamId,
    ...(fields.code_challenge ? { code_challenge: fields.code_challenge } : {}),
    ...(fields.code_challenge_method ? { code_challenge_method: fields.code_challenge_method } : {}),
    used: false,
  };
  pruneRecordCap(state.authCodes, MAX_AUTH_CODES);
  ctx.save();
  if (parsedRedirect) {
    sendRedirect(res, redirectWithParams(parsedRedirect, { code, state: fields.state }));
    return;
  }
  sendJson(res, 200, { ok: true, code, state: fields.state, team_id: teamId });
}

function mintAndRespondOAuth(
  res: ServerResponse,
  ctx: ProviderContext<SlackState>,
  workspace: SlackWorkspace,
  userId: string,
  scope: string,
  rotated = false,
): void {
  const minted: SlackUserToken = {
    access_token: randomToken("xoxe.xoxp-", 20),
    refresh_token: randomToken("xoxe-1-", 20),
    team_id: workspace.id,
    user_id: userId,
    scope,
    revoked: false,
  };
  ctx.getState().tokens[minted.access_token] = minted;
  ctx.save();
  if (rotated) {
    sendJson(res, 200, { ok: true, access_token: minted.access_token, refresh_token: minted.refresh_token, token_type: "user", expires_in: 43200 });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    app_id: APP_ID,
    team: { id: workspace.id, name: workspace.name },
    authed_user: {
      id: minted.user_id,
      scope: minted.scope,
      access_token: minted.access_token,
      token_type: "user",
      refresh_token: minted.refresh_token,
      expires_in: 43200,
    },
  });
}

function handleOAuthAccess(req: ParsedRequest, res: ServerResponse, ctx: ProviderContext<SlackState>): void {
  const state = ctx.getState();
  const grantType = asString(req.params.grant_type);
  if (grantType === "refresh_token") {
    const refresh = asString(req.params.refresh_token);
    const existing = refresh
      ? Object.values(state.tokens).find((item) => item.refresh_token === refresh && !item.revoked)
      : undefined;
    if (!existing) {
      sendJson(res, 200, { ok: false, error: "invalid_refresh_token" });
      return;
    }
    const workspace = ownGet(state.workspaces, existing.team_id);
    if (!workspace) {
      sendJson(res, 200, { ok: false, error: "team_not_found" });
      return;
    }
    existing.revoked = true;
    mintAndRespondOAuth(res, ctx, workspace, existing.user_id, existing.scope, true);
    return;
  }

  const code = asString(req.params.code);
  const record = ownGet(state.authCodes, code);
  if (!record) {
    sendJson(res, 200, { ok: false, error: "invalid_code" });
    return;
  }
  if (record.used) {
    sendJson(res, 200, { ok: false, error: "code_already_used" });
    return;
  }
  const clientId = asString(req.params.client_id);
  if (clientId !== record.client_id) {
    sendJson(res, 200, { ok: false, error: "invalid_client_id" });
    return;
  }
  const redirectUri = asString(req.params.redirect_uri);
  if (record.redirect_uri !== "" && redirectUri !== record.redirect_uri) {
    sendJson(res, 200, { ok: false, error: "bad_redirect_uri" });
    return;
  }
  if (record.code_challenge) {
    const verifier = asString(req.params.code_verifier);
    if (record.code_challenge_method !== "S256" || !verifier || !verifyPkceS256(verifier, record.code_challenge)) {
      sendJson(res, 200, { ok: false, error: "invalid_code_verifier" });
      return;
    }
  }
  const workspace = ownGet(state.workspaces, record.team_id);
  if (!workspace) {
    sendJson(res, 200, { ok: false, error: "team_not_found" });
    return;
  }
  record.used = true;
  mintAndRespondOAuth(res, ctx, workspace, workspace.ownerId, record.user_scope);
}

function requireChannel(req: ParsedRequest, res: ServerResponse, auth: ResolvedAuth): SlackChannel | undefined {
  const channelId = asString(req.params.channel);
  const channel = ownGet(auth.workspace.channels, channelId);
  if (!channel || !canAccessChannel(channel, auth.userId)) {
    sendJson(res, 200, { ok: false, error: "channel_not_found" });
    return undefined;
  }
  return channel;
}

function appendSlackMessage(
  ctx: ProviderContext<SlackState>,
  workspace: SlackWorkspace,
  channel: SlackChannel,
  userId: string,
  text: string,
  threadTs: string | undefined,
  replyBroadcast: boolean | undefined,
  advanceRead: boolean,
): SlackMessage {
  const state = ctx.getState();
  const ts = nextSlackTs(state);
  const message = makeMessage(ts, userId, text, {
    ...(threadTs ? { thread_ts: threadTs } : {}),
    ...(threadTs && replyBroadcast ? { reply_broadcast: true } : {}),
  });
  channel.messages.push(message);
  if (threadTs) {
    recomputeThreadStats(channel, threadTs);
  } else if (advanceRead) {
    channel.last_read = ts;
  }
  ctx.save();
  pushSlackEvent(ctx, workspace.id, {
    type: "message",
    channel: channel.id,
    user: userId,
    text,
    ts,
    ...(threadTs ? { thread_ts: threadTs } : {}),
    ...(threadTs && replyBroadcast ? { reply_broadcast: true } : {}),
  });
  return message;
}

function applySlackEdit(
  ctx: ProviderContext<SlackState>,
  workspace: SlackWorkspace,
  channel: SlackChannel,
  target: SlackMessage,
  editorId: string,
  text: string,
): void {
  target.text = text;
  target.edited = { user: editorId, ts: nextSlackTs(ctx.getState()) };
  ctx.save();
  pushSlackEvent(ctx, workspace.id, {
    type: "message",
    subtype: "message_changed",
    channel: channel.id,
    ts: target.ts,
    message: target,
  });
}

function applySlackDelete(
  ctx: ProviderContext<SlackState>,
  workspace: SlackWorkspace,
  channel: SlackChannel,
  index: number,
): SlackMessage {
  const [removed] = channel.messages.splice(index, 1);
  if (removed.thread_ts && removed.thread_ts !== removed.ts) {
    recomputeThreadStats(channel, removed.thread_ts);
  }
  ctx.save();
  pushSlackEvent(ctx, workspace.id, {
    type: "message",
    subtype: "message_deleted",
    channel: channel.id,
    deleted_ts: removed.ts,
    ts: nextSlackTs(ctx.getState()),
  });
  return removed;
}

function matchesConversationTypes(channel: SlackChannel, types: ReadonlySet<string>): boolean {
  if (channel.is_im) return types.has("im");
  if (channel.is_mpim) return types.has("mpim");
  if (channel.is_private) return types.has("private_channel");
  return types.has("public_channel");
}

function handleUsersConversations(req: ParsedRequest, res: ServerResponse, auth: ResolvedAuth): void {
  const rawTypes = asString(req.params.types) ?? "public_channel,private_channel,mpim,im";
  const typeSet = new Set(rawTypes.split(",").map((item) => item.trim()).filter(Boolean));
  const excludeArchived = asBoolean(req.params.exclude_archived) ?? false;
  const matching = Object.values(auth.workspace.channels)
    .filter((ch) => canAccessChannel(ch, auth.userId) && matchesConversationTypes(ch, typeSet) && (!excludeArchived || !ch.is_archived))
    .map((ch) => computeChannelSummary(ch, auth.userId));
  const page = paginateSlice(matching, asString(req.params.cursor), asNumber(req.params.limit) ?? 100);
  sendJson(res, 200, {
    ok: true,
    channels: page.items,
    response_metadata: { next_cursor: page.nextCursor },
  });
}

function handleConversationsOpen(
  req: ParsedRequest,
  res: ServerResponse,
  auth: ResolvedAuth,
  ctx: ProviderContext<SlackState>,
): void {
  const rawUsers = asString(req.params.users);
  const arrayUsers = asStringArray(req.params.users);
  const requested = rawUsers
    ? rawUsers.split(",").map((u) => u.trim()).filter(Boolean)
    : (arrayUsers ?? []);
  if (requested.length === 0) {
    sendJson(res, 200, { ok: false, error: "invalid_arguments" });
    return;
  }
  for (const uid of requested) {
    if (!ownGet(auth.workspace.users, uid)) {
      sendJson(res, 200, { ok: false, error: "user_not_found" });
      return;
    }
  }
  const memberSet = [...new Set([auth.userId, ...requested])].sort();
  const existing = Object.values(auth.workspace.channels).find((ch) => {
    if (!ch.is_im && !ch.is_mpim) return false;
    const sorted = [...ch.members].sort();
    return sorted.length === memberSet.length && sorted.every((item, idx) => item === memberSet[idx]);
  });
  if (existing) {
    sendJson(res, 200, {
      ok: true,
      already_open: true,
      channel: computeChannelSummary(existing, auth.userId),
    });
    return;
  }
  const isIm = memberSet.length <= 2;
  const otherUser = requested.find((u) => u !== auth.userId) ?? auth.userId;
  const id = isIm
    ? `D${String(Object.keys(auth.workspace.channels).length + 1).padStart(2, "0")}${otherUser.slice(1)}`
    : `G${String(Object.keys(auth.workspace.channels).length + 1).padStart(2, "0")}MPIM`;
  const created: SlackChannel = {
    id,
    name: isIm ? id : `mpdm-${memberSet.map((u) => ownGet(auth.workspace.users, u)?.name ?? u).join("--")}`,
    is_channel: false,
    is_group: !isIm,
    is_im: isIm,
    is_mpim: !isIm,
    is_private: true,
    is_archived: false,
    ...(isIm ? { user: otherUser } : {}),
    members: memberSet,
    topic: { value: "" },
    purpose: { value: isIm ? "" : "Group direct message" },
    last_read: "0",
    is_muted: false,
    messages: [],
  };
  auth.workspace.channels[id] = created;
  ctx.save();
  sendJson(res, 200, {
    ok: true,
    already_open: false,
    channel: computeChannelSummary(created, auth.userId),
  });
}

function sendPagedMessages(res: ServerResponse, req: ParsedRequest, items: readonly SlackMessage[]): void {
  const page = paginateSlice(items, asString(req.params.cursor), asNumber(req.params.limit) ?? 50);
  sendJson(res, 200, {
    ok: true,
    messages: page.items,
    has_more: page.hasMore,
    response_metadata: { next_cursor: page.nextCursor },
  });
}

function inTimeRange(req: ParsedRequest): (message: SlackMessage) => boolean {
  const oldest = asString(req.params.oldest);
  const latest = asString(req.params.latest);
  const inclusive = asBoolean(req.params.inclusive) ?? false;
  return (message: SlackMessage) => {
    const after = oldest ? compareTs(message.ts, oldest) : 1;
    const before = latest ? compareTs(message.ts, latest) : -1;
    return inclusive ? after >= 0 && before <= 0 : after > 0 && before < 0;
  };
}

function handleConversationsHistory(req: ParsedRequest, res: ServerResponse, auth: ResolvedAuth): void {
  const channel = requireChannel(req, res, auth);
  if (!channel) return;
  const filtered = visibleTimelineMessages(channel)
    .filter(inTimeRange(req))
    .sort((a, b) => compareTs(b.ts, a.ts));
  sendPagedMessages(res, req, filtered);
}

function handleConversationsReplies(req: ParsedRequest, res: ServerResponse, auth: ResolvedAuth): void {
  const channel = requireChannel(req, res, auth);
  if (!channel) return;
  const ts = asString(req.params.ts);
  const parent = ts ? channel.messages.find((msg) => msg.ts === ts) : undefined;
  if (!parent || !ts) {
    sendJson(res, 200, { ok: false, error: "thread_not_found" });
    return;
  }
  const replies = channel.messages
    .filter((msg) => msg.thread_ts === ts && msg.ts !== ts)
    .filter(inTimeRange(req))
    .sort((a, b) => compareTs(a.ts, b.ts));
  sendPagedMessages(res, req, [parent, ...replies]);
}

function handlePostMessage(
  req: ParsedRequest,
  res: ServerResponse,
  auth: ResolvedAuth,
  ctx: ProviderContext<SlackState>,
): void {
  const state = ctx.getState();
  const channel = requireChannel(req, res, auth);
  if (!channel) return;
  const text = asString(req.params.text);
  if (text === undefined || text.trim() === "") {
    sendJson(res, 200, { ok: false, error: "no_text" });
    return;
  }
  const idemKey = asString(req.params.client_msg_id) ?? req.headers["idempotency-key"];
  const scopedIdem = idemKey ? `${auth.workspace.id}:${auth.userId}:${channel.id}:${idemKey}` : undefined;
  const cached = ownGet(state.idempotency, scopedIdem);
  if (cached) {
    sendJson(res, 200, { ok: true, channel: cached.channel, ts: cached.ts, message: structuredClone(cached.message) });
    return;
  }
  const threadTs = asString(req.params.thread_ts);
  const replyBroadcast = asBoolean(req.params.reply_broadcast);
  if (threadTs && !channel.messages.some((item) => item.ts === threadTs)) {
    sendJson(res, 200, { ok: false, error: "thread_not_found" });
    return;
  }
  const message = appendSlackMessage(ctx, auth.workspace, channel, auth.userId, text, threadTs, replyBroadcast, true);
  if (scopedIdem) {
    state.idempotency[scopedIdem] = { channel: channel.id, ts: message.ts, message: structuredClone(message) };
    pruneRecordCap(state.idempotency, MAX_IDEMPOTENCY);
    ctx.save();
  }
  sendJson(res, 200, { ok: true, channel: channel.id, ts: message.ts, message });
}

function handleUpdateOrDeleteMessage(
  req: ParsedRequest,
  res: ServerResponse,
  auth: ResolvedAuth,
  ctx: ProviderContext<SlackState>,
  mode: "update" | "delete",
): void {
  const channel = requireChannel(req, res, auth);
  if (!channel) return;
  const ts = asString(req.params.ts);
  const index = ts ? channel.messages.findIndex((item) => item.ts === ts) : -1;
  if (index < 0) {
    sendJson(res, 200, { ok: false, error: "message_not_found" });
    return;
  }
  const target = channel.messages[index];
  if (target.user !== auth.userId) {
    sendJson(res, 200, { ok: false, error: mode === "update" ? "cant_update_message" : "cant_delete_message" });
    return;
  }
  if (mode === "update") {
    const text = asString(req.params.text);
    if (text === undefined || text.trim() === "") {
      sendJson(res, 200, { ok: false, error: "no_text" });
      return;
    }
    applySlackEdit(ctx, auth.workspace, channel, target, auth.userId, text);
    sendJson(res, 200, { ok: true, channel: channel.id, ts: target.ts, text: target.text, message: target });
    return;
  }
  applySlackDelete(ctx, auth.workspace, channel, index);
  sendJson(res, 200, { ok: true, channel: channel.id, ts: target.ts });
}

function mutateReaction(
  channel: SlackChannel,
  ts: string,
  name: string,
  userId: string,
  mode: "add" | "remove",
): { readonly ok: true } | { readonly ok: false; readonly error: string } {
  const message = channel.messages.find((item) => item.ts === ts);
  if (!message) return { ok: false, error: "message_not_found" };
  const existing = message.reactions.find((item) => item.name === name);
  if (mode === "add") {
    if (existing) {
      if (existing.users.includes(userId)) return { ok: false, error: "already_reacted" };
      existing.users.push(userId);
      existing.count = existing.users.length;
    } else {
      message.reactions.push({ name, users: [userId], count: 1 });
    }
    return { ok: true };
  }
  if (!existing || !existing.users.includes(userId)) {
    return { ok: false, error: "no_reaction" };
  }
  existing.users = existing.users.filter((item) => item !== userId);
  existing.count = existing.users.length;
  if (existing.count === 0) {
    message.reactions = message.reactions.filter((item) => item.name !== name);
  }
  return { ok: true };
}

function handleReaction(
  req: ParsedRequest,
  res: ServerResponse,
  auth: ResolvedAuth,
  ctx: ProviderContext<SlackState>,
  mode: "add" | "remove",
): void {
  const channel = requireChannel(req, res, auth);
  if (!channel) return;
  const ts = asString(req.params.timestamp);
  const name = asString(req.params.name);
  if (!ts || !name) {
    sendJson(res, 200, { ok: false, error: "invalid_arguments" });
    return;
  }
  const result = mutateReaction(channel, ts, name, auth.userId, mode);
  if (!result.ok) {
    sendJson(res, 200, result);
    return;
  }
  ctx.save();
  pushSlackEvent(ctx, auth.workspace.id, {
    type: mode === "add" ? "reaction_added" : "reaction_removed",
    user: auth.userId,
    reaction: name,
    item: { type: "message", channel: channel.id, ts },
  });
  sendJson(res, 200, { ok: true });
}

function handleSearchMessages(req: ParsedRequest, res: ServerResponse, auth: ResolvedAuth): void {
  const rawQuery = (asString(req.params.query) ?? "").trim();
  const tokens = rawQuery.split(/\s+/).filter(Boolean);
  let channelFilter: string | undefined;
  let userFilter: string | undefined;
  const textTerms: string[] = [];
  for (const tok of tokens) {
    if (tok.toLowerCase().startsWith("in:")) {
      channelFilter = tok.slice(3).replace(/^#/, "").toLowerCase();
    } else if (tok.toLowerCase().startsWith("from:")) {
      userFilter = tok.slice(5).replace(/^@/, "").toLowerCase();
    } else {
      textTerms.push(tok.toLowerCase());
    }
  }
  const matches: Record<string, unknown>[] = [];
  for (const channel of Object.values(auth.workspace.channels)) {
    if (!canAccessChannel(channel, auth.userId)) continue;
    if (
      channelFilter &&
      channel.name.toLowerCase() !== channelFilter &&
      channel.id.toLowerCase() !== channelFilter
    ) {
      continue;
    }
    for (const msg of channel.messages) {
      const author = ownGet(auth.workspace.users, msg.user);
      if (
        userFilter &&
        msg.user.toLowerCase() !== userFilter &&
        (author?.name.toLowerCase() ?? "") !== userFilter
      ) {
        continue;
      }
      const lower = msg.text.toLowerCase();
      if (!textTerms.every((term) => lower.includes(term))) continue;
      matches.push({
        type: "message",
        ts: msg.ts,
        user: msg.user,
        username: author?.name ?? msg.user,
        text: msg.text,
        channel: { id: channel.id, name: channel.name },
        permalink: `${auth.workspace.url}archives/${channel.id}/p${msg.ts.replace(".", "")}`,
        ...(msg.thread_ts ? { thread_ts: msg.thread_ts } : {}),
      });
    }
  }
  matches.sort((a, b) => compareTs(String(b.ts), String(a.ts)));
  const count = Math.max(1, Math.min(asNumber(req.params.count) ?? 20, 100));
  const page = Math.max(1, asNumber(req.params.page) ?? 1);
  const start = (page - 1) * count;
  const sliced = matches.slice(start, start + count);
  sendJson(res, 200, {
    ok: true,
    query: rawQuery,
    messages: {
      total: matches.length,
      pagination: {
        total_count: matches.length,
        page,
        per_page: count,
        page_count: Math.max(1, Math.ceil(matches.length / count)),
      },
      matches: sliced,
    },
  });
}

function handleSlackControl(
  req: ParsedRequest,
  res: ServerResponse,
  ctx: ProviderContext<SlackState>,
): boolean {
  const state = ctx.getState();
  if (req.pathname === "/__control/revoke" && req.method === "POST") {
    const specificToken = asString(req.params.token);
    const teamId = asString(req.params.team_id);
    let revoked = 0;
    const affectedTeams = new Set<string>();
    const revokedTokens = new Set<string>();
    for (const item of Object.values(state.tokens)) {
      if (item.revoked) continue;
      if (specificToken && item.access_token !== specificToken) continue;
      if (teamId && item.team_id !== teamId) continue;
      item.revoked = true;
      revoked += 1;
      affectedTeams.add(item.team_id);
      revokedTokens.add(item.access_token);
    }
    ctx.save();
    for (const tid of affectedTeams) {
      pushSlackEvent(ctx, tid, { type: "tokens_revoked", tokens: { oauth: [tid] } });
    }
    ctx.sse.closeWhere((meta) => meta?.token !== undefined && revokedTokens.has(meta.token));
    sendJson(res, 200, { ok: true, revoked });
    return true;
  }

  if (req.pathname === "/__control/inject" && req.method === "POST") {
    const teamId = asString(req.params.team_id) ?? "T01ALPHA";
    const workspace = ownGet(state.workspaces, teamId);
    if (!workspace) {
      sendJson(res, 404, { ok: false, error: "team_not_found" });
      return true;
    }
    const channelId = asString(req.params.channel) ?? Object.keys(workspace.channels)[0];
    const channel = ownGet(workspace.channels, channelId);
    if (!channel) {
      sendJson(res, 404, { ok: false, error: "channel_not_found" });
      return true;
    }
    const peerDefault = Object.values(workspace.users).find((u) => u.id !== workspace.ownerId)?.id ?? workspace.ownerId;
    const userId = asString(req.params.user) ?? peerDefault;
    const kind = asString(req.params.kind) ?? "message";

    if (kind === "message") {
      const text = asString(req.params.text) ?? "Injected peer message";
      const msg = appendSlackMessage(
        ctx,
        workspace,
        channel,
        userId,
        text,
        asString(req.params.thread_ts),
        asBoolean(req.params.reply_broadcast),
        false,
      );
      sendJson(res, 200, { ok: true, team_id: workspace.id, channel: channel.id, ts: msg.ts, message: msg });
      return true;
    }

    if (kind === "reaction_added" || kind === "reaction_removed") {
      const ts = asString(req.params.ts) ?? channel.messages[channel.messages.length - 1]?.ts ?? "";
      const name = asString(req.params.name) ?? "thumbsup";
      const result = mutateReaction(channel, ts, name, userId, kind === "reaction_added" ? "add" : "remove");
      if (!result.ok) {
        sendJson(res, 400, result);
        return true;
      }
      ctx.save();
      pushSlackEvent(ctx, workspace.id, {
        type: kind,
        user: userId,
        reaction: name,
        item: { type: "message", channel: channel.id, ts },
      });
      sendJson(res, 200, { ok: true, team_id: workspace.id, channel: channel.id, ts, name });
      return true;
    }

    if (kind === "edit") {
      const ts = asString(req.params.ts) ?? channel.messages[channel.messages.length - 1]?.ts ?? "";
      const target = channel.messages.find((item) => item.ts === ts);
      if (!target) {
        sendJson(res, 404, { ok: false, error: "message_not_found" });
        return true;
      }
      applySlackEdit(ctx, workspace, channel, target, userId, asString(req.params.text) ?? target.text);
      sendJson(res, 200, { ok: true, team_id: workspace.id, channel: channel.id, ts: target.ts, message: target });
      return true;
    }

    if (kind === "delete") {
      const ts = asString(req.params.ts) ?? channel.messages[channel.messages.length - 1]?.ts ?? "";
      const idx = channel.messages.findIndex((item) => item.ts === ts);
      if (idx < 0) {
        sendJson(res, 404, { ok: false, error: "message_not_found" });
        return true;
      }
      applySlackDelete(ctx, workspace, channel, idx);
      sendJson(res, 200, { ok: true, team_id: workspace.id, channel: channel.id, deleted_ts: ts });
      return true;
    }

    sendJson(res, 400, { ok: false, error: "unknown_inject_kind" });
    return true;
  }

  return false;
}

function handleSlackApi(req: ParsedRequest, res: ServerResponse, ctx: ProviderContext<SlackState>): void {
  if (req.pathname === "/.well-known/alpha-slack" && req.method === "GET") {
    sendJson(res, 200, { clientId: "123.456", notifications: true });
    return;
  }
  if (req.pathname === "/oauth/v2/authorize") {
    handleAuthorize(req, res, ctx);
    return;
  }
  if (req.pathname === "/api/apps.event.authorizations.list" && req.method === "POST") {
    if (req.headers.authorization !== "Bearer xapp-local-receiver" || req.params.event_context !== "EC-local-direct") {
      sendJson(res, 200, { ok: false, error: "invalid_auth" });
      return;
    }
    const team = ctx.getState().workspaces["T01ALPHA"];
    const second = req.params.cursor === "next";
    const authorization = { enterprise_id: null, team_id: team.id, user_id: team.ownerId, is_bot: !second, is_enterprise_install: false };
    sendJson(res, 200, { ok: true, authorizations: [authorization], response_metadata: { next_cursor: second ? "" : "next" } });
    return;
  }
  if ((req.pathname === "/api/oauth.v2.access" || req.pathname === "/api/slack/oauth") && req.method === "POST") {
    handleOAuthAccess(req, res, ctx);
    return;
  }

  const state = ctx.getState();
  const auth = resolveSlackAuth(req, res, state);
  if (!auth) return;

  switch (req.pathname) {
    case "/api/slack/events/read": {
      const cursor = asNumber(req.params.cursor) ?? state.eventSeq;
      const events = (receiverEvents.get(state) ?? []).filter((row) => row.team === auth.workspace.id && row.sequence > cursor);
      sendJson(res, 200, { cursor: state.eventSeq, events: events.map((row) => row.envelope) });
      return;
    }
    case "/api/auth.test": {
      const user = ownGet(auth.workspace.users, auth.userId);
      sendJson(res, 200, {
        ok: true,
        url: auth.workspace.url,
        team: auth.workspace.name,
        user: user?.name ?? auth.userId,
        team_id: auth.workspace.id,
        user_id: auth.userId,
        is_enterprise_install: false,
      });
      return;
    }
    case "/api/auth.revoke": {
      auth.token.revoked = true;
      ctx.save();
      pushSlackEvent(ctx, auth.workspace.id, { type: "tokens_revoked", tokens: { oauth: [auth.workspace.id] } });
      ctx.sse.closeWhere((meta) => meta?.token === auth.token.access_token);
      sendJson(res, 200, { ok: true, revoked: true });
      return;
    }
    case "/api/team.info": {
      sendJson(res, 200, {
        ok: true,
        team: {
          id: auth.workspace.id,
          name: auth.workspace.name,
          domain: auth.workspace.domain,
          url: auth.workspace.url,
        },
      });
      return;
    }
    case "/api/users.conversations":
      handleUsersConversations(req, res, auth);
      return;
    case "/api/conversations.info": {
      const channel = requireChannel(req, res, auth);
      if (!channel) return;
      sendJson(res, 200, { ok: true, channel: computeChannelSummary(channel, auth.userId) });
      return;
    }
    case "/api/conversations.open":
      handleConversationsOpen(req, res, auth, ctx);
      return;
    case "/api/conversations.history":
      handleConversationsHistory(req, res, auth);
      return;
    case "/api/conversations.replies":
      handleConversationsReplies(req, res, auth);
      return;
    case "/api/conversations.mark": {
      const channel = requireChannel(req, res, auth);
      if (!channel) return;
      const ts = asString(req.params.ts);
      if (!ts) {
        sendJson(res, 200, { ok: false, error: "invalid_timestamp" });
        return;
      }
      channel.last_read = ts;
      ctx.save();
      pushSlackEvent(ctx, auth.workspace.id, { type: "channel_marked", channel: channel.id, ts });
      sendJson(res, 200, { ok: true });
      return;
    }
    case "/api/chat.postMessage":
      handlePostMessage(req, res, auth, ctx);
      return;
    case "/api/chat.update":
      handleUpdateOrDeleteMessage(req, res, auth, ctx, "update");
      return;
    case "/api/chat.delete":
      handleUpdateOrDeleteMessage(req, res, auth, ctx, "delete");
      return;
    case "/api/reactions.add":
      handleReaction(req, res, auth, ctx, "add");
      return;
    case "/api/reactions.remove":
      handleReaction(req, res, auth, ctx, "remove");
      return;
    case "/api/search.messages":
      handleSearchMessages(req, res, auth);
      return;
    case "/api/users.list": {
      const members = Object.values(auth.workspace.users);
      const page = paginateSlice(members, asString(req.params.cursor), asNumber(req.params.limit) ?? 100);
      sendJson(res, 200, { ok: true, members: page.items, response_metadata: { next_cursor: page.nextCursor } });
      return;
    }
    case "/api/users.info": {
      const uid = asString(req.params.user);
      const found = ownGet(auth.workspace.users, uid);
      if (!found) {
        sendJson(res, 200, { ok: false, error: "user_not_found" });
        return;
      }
      sendJson(res, 200, { ok: true, user: found });
      return;
    }
    case "/alpha/slack/events": {
      ctx.sse.connect(res, {
        filter: (envelope) => envelope.channel === auth.workspace.id,
        meta: { token: auth.token.access_token, team_id: auth.workspace.id },
      });
      return;
    }
    default:
      sendJson(res, 404, { ok: false, error: "unknown_method" });
  }
}

function defaultSlackFaultBody(fault: FaultRule): unknown {
  if (fault.status === 429) return { ok: false, error: "ratelimited" };
  return { ok: false, error: `http_${fault.status}` };
}

/** Start a stateful, wire-faithful Slack OAuth2 v2 User Token (`xoxp-`) + Web API + SSE provider server. */
export async function startSlackProvider(options?: ProviderOptions): Promise<RunningProvider> {
  return createProviderServer<SlackState>({
    options,
    createInitial: createInitialSlackState,
    preflightHeaders: (path) => /^\/api\/[a-zA-Z]+\.[a-zA-Z.]+$/.test(path) ? "x-slack-version-ts" : undefined,
    defaultFaultBody: defaultSlackFaultBody,
    onControl: handleSlackControl,
    onRequest: handleSlackApi,
  });
}
