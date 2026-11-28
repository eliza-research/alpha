import { randomInt } from "node:crypto";
import type { ServerResponse } from "node:http";
import {
  type FaultRule,
  type ParsedRequest,
  type ProviderContext,
  type ProviderOptions,
  type RunningProvider,
  type SseEnvelope,
  asBoolean,
  asNumber,
  asNumberArray,
  asRecord,
  asString,
  bearerToken,
  createProviderServer,
  ownGet,
  paginateSlice,
  pruneRecordCap,
  randomToken,
  sendJson,
} from "./shared.ts";

/** MTProto-shaped peer identifier. */
export type TelegramPeer =
  | { readonly _type: "peerUser"; readonly user_id: number }
  | { readonly _type: "peerChat"; readonly chat_id: number }
  | { readonly _type: "peerChannel"; readonly channel_id: number };

/** Telegram user profile record. */
export interface TelegramUser {
  readonly _type: "user";
  readonly id: number;
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
  readonly phone?: string;
  readonly self?: boolean;
  readonly online?: boolean;
}

/** Telegram group, supergroup, or broadcast channel metadata. */
export interface TelegramChat {
  readonly _type: "chat" | "channel";
  readonly id: number;
  readonly title: string;
  readonly username?: string;
  readonly megagroup?: boolean;
  readonly broadcast?: boolean;
  readonly participants_count: number;
}

/** Telegram chat folder descriptor. */
export interface TelegramFolder {
  readonly id: number;
  readonly title: string;
}

/** Reaction tally on a Telegram message. */
export interface TelegramReactionCount {
  readonly emoticon: string;
  count: number;
  chosen: boolean;
}

/** Stored Telegram message record. */
export interface TelegramMessage {
  readonly _type: "message";
  readonly id: number;
  readonly peer_id: TelegramPeer;
  readonly peer_key: string;
  readonly from_id: number;
  readonly date: number;
  message: string;
  readonly out: boolean;
  readonly reply_to_msg_id?: number;
  edit_date?: number;
  reactions: TelegramReactionCount[];
  readonly mentioned: boolean;
}

/** Stored Telegram dialog entry (DM, group, supergroup, or broadcast channel). */
export interface TelegramDialog {
  readonly peer: TelegramPeer;
  readonly peer_key: string;
  readonly folder_id: number;
  pinned: boolean;
  archived: boolean;
  readonly can_post: boolean;
  read_inbox_max_id: number;
  read_outbox_max_id: number;
  notify_settings: { mute_until: number };
}

/** Ordered MTProto-shaped update event stored for `updates.getDifference` and SSE replay. */
export interface TelegramUpdate {
  readonly _type:
    | "updateNewMessage"
    | "updateEditMessage"
    | "updateDeleteMessages"
    | "updateMessageReactions"
    | "updateReadHistoryInbox"
    | "updateSessionRevoked";
  readonly pts: number;
  readonly date: number;
  readonly peer?: TelegramPeer;
  readonly peer_key?: string;
  readonly message?: TelegramMessage;
  readonly messages?: readonly number[];
  readonly msg_id?: number;
  readonly reactions?: readonly TelegramReactionCount[];
  readonly max_id?: number;
  readonly session_token?: string;
}

interface PendingCode {
  readonly phone_number: string;
  readonly phone_code_hash: string;
  readonly code: string;
  readonly expiresAt: number;
  expired: boolean;
  consumed: boolean;
  attempts?: number;
}

interface PendingPassword {
  readonly pending_auth_id: string;
  readonly phone_number: string;
  readonly password: string;
  readonly hint: string;
  attempts?: number;
}

interface QrLoginToken {
  readonly token: string;
  readonly expires: number;
  readonly login_url: string;
  approved: boolean;
  consumed?: boolean;
  session_token?: string;
  phone_number?: string;
}

interface TelegramSession {
  readonly session_token: string;
  readonly phone_number: string;
  readonly user_id: number;
  revoked: boolean;
}

interface AccountSecurity {
  password?: string;
  hint?: string;
}

interface TelegramState {
  pts: number;
  nextMessageId: number;
  readonly owner: TelegramUser;
  readonly users: Record<number, TelegramUser>;
  readonly chats: Record<string, TelegramChat>;
  readonly folders: readonly TelegramFolder[];
  readonly dialogs: Record<string, TelegramDialog>;
  readonly messages: Record<string, TelegramMessage[]>;
  readonly updates: TelegramUpdate[];
  readonly pendingCodes: Record<string, PendingCode>;
  readonly pendingPasswords: Record<string, PendingPassword>;
  readonly qrTokens: Record<string, QrLoginToken>;
  readonly sessions: Record<string, TelegramSession>;
  readonly securityByPhone: Record<string, AccountSecurity>;
  readonly idempotency: Record<string, TelegramMessage>;
}

const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
const TEST_DC_PATTERN = /^\+99966(\d)\d{4}$/;
const BOT_TOKEN_PATTERN = /^(?:bot\d+:|(?:\d{5,}:[A-Za-z0-9_-]{10,}))/;
const TWO_FACTOR_TEST_PHONE = "+15550109999";
const MAX_UPDATES = 1000;
const MAX_TRANSIENT = 500;
const MAX_AUTH_ATTEMPTS = 5;

function peerKey(peer: TelegramPeer): string {
  switch (peer._type) {
    case "peerUser":
      return `user:${peer.user_id}`;
    case "peerChat":
      return `chat:${peer.chat_id}`;
    case "peerChannel":
      return `channel:${peer.channel_id}`;
  }
}

function parsePeer(raw: unknown): TelegramPeer | undefined {
  if (typeof raw === "string") {
    const [kind, idRaw] = raw.split(":");
    const id = Number(idRaw);
    if (!Number.isInteger(id)) return undefined;
    if (kind === "user") return { _type: "peerUser", user_id: id };
    if (kind === "chat") return { _type: "peerChat", chat_id: id };
    if (kind === "channel") return { _type: "peerChannel", channel_id: id };
    return undefined;
  }
  const rec = asRecord(raw);
  if (!rec) return undefined;
  const kind = asString(rec._type);
  const userId = asNumber(rec.user_id);
  const chatId = asNumber(rec.chat_id);
  const channelId = asNumber(rec.channel_id);
  if (kind === "peerUser" && userId !== undefined) return { _type: "peerUser", user_id: userId };
  if (kind === "peerChat" && chatId !== undefined) return { _type: "peerChat", chat_id: chatId };
  if (kind === "peerChannel" && channelId !== undefined) return { _type: "peerChannel", channel_id: channelId };
  if (userId !== undefined) return { _type: "peerUser", user_id: userId };
  if (chatId !== undefined) return { _type: "peerChat", chat_id: chatId };
  if (channelId !== undefined) return { _type: "peerChannel", channel_id: channelId };
  return undefined;
}

function tgError(res: ServerResponse, status: number, message: string, extra?: Readonly<Record<string, unknown>>): void {
  sendJson(res, status, {
    ok: false,
    error_code: status,
    error_message: message,
    ...extra,
  });
}

function seedMessage(
  id: number,
  peer: TelegramPeer,
  fromId: number,
  date: number,
  text: string,
  out: boolean,
  extra?: Partial<Pick<TelegramMessage, "reply_to_msg_id" | "mentioned" | "reactions">>,
): TelegramMessage {
  return {
    _type: "message",
    id,
    peer_id: peer,
    peer_key: peerKey(peer),
    from_id: fromId,
    date,
    message: text,
    out,
    reactions: extra?.reactions ?? [],
    mentioned: extra?.mentioned ?? false,
    ...(extra?.reply_to_msg_id !== undefined ? { reply_to_msg_id: extra.reply_to_msg_id } : {}),
  };
}

function createInitialTelegramState(): TelegramState {
  const owner: TelegramUser = {
    _type: "user",
    id: 1001,
    first_name: "Alex",
    last_name: "Rivera",
    username: "alexrivera",
    phone: "+15550101234",
    self: true,
    online: true,
  };
  const peerMaya: TelegramPeer = { _type: "peerUser", user_id: 2001 };
  const peerSamira: TelegramPeer = { _type: "peerUser", user_id: 2002 };
  const peerCore: TelegramPeer = { _type: "peerChat", chat_id: 3001 };
  const peerBuilders: TelegramPeer = { _type: "peerChannel", channel_id: 4001 };
  const peerReleases: TelegramPeer = { _type: "peerChannel", channel_id: 4002 };

  const initialSession = "tg-sess-initial-owner";

  return {
    pts: 10,
    nextMessageId: 110,
    owner,
    users: {
      1001: owner,
      2001: { _type: "user", id: 2001, first_name: "Maya", last_name: "Chen", username: "mayachen", online: true },
      2002: { _type: "user", id: 2002, first_name: "Samira", last_name: "Patel", username: "samirap", online: false },
      2003: { _type: "user", id: 2003, first_name: "Devon", last_name: "Brooks", username: "devonb", online: true },
    },
    chats: {
      "chat:3001": { _type: "chat", id: 3001, title: "Alpha Core", participants_count: 4 },
      "channel:4001": {
        _type: "channel",
        id: 4001,
        title: "Vibestack Builders",
        username: "vibestack_builders",
        megagroup: true,
        broadcast: false,
        participants_count: 142,
      },
      "channel:4002": {
        _type: "channel",
        id: 4002,
        title: "Alpha Release Notes",
        username: "alpha_releases",
        megagroup: false,
        broadcast: true,
        participants_count: 2840,
      },
    },
    folders: [
      { id: 0, title: "All Chats" },
      { id: 1, title: "Archived" },
      { id: 2, title: "Work" },
      { id: 3, title: "Friends" },
    ],
    dialogs: {
      "user:2001": {
        peer: peerMaya,
        peer_key: "user:2001",
        folder_id: 3,
        pinned: true,
        archived: false,
        can_post: true,
        read_inbox_max_id: 101,
        read_outbox_max_id: 101,
        notify_settings: { mute_until: 0 },
      },
      "chat:3001": {
        peer: peerCore,
        peer_key: "chat:3001",
        folder_id: 2,
        pinned: false,
        archived: false,
        can_post: true,
        read_inbox_max_id: 103,
        read_outbox_max_id: 103,
        notify_settings: { mute_until: 0 },
      },
      "channel:4001": {
        peer: peerBuilders,
        peer_key: "channel:4001",
        folder_id: 2,
        pinned: false,
        archived: false,
        can_post: true,
        read_inbox_max_id: 106,
        read_outbox_max_id: 106,
        notify_settings: { mute_until: 0 },
      },
      "channel:4002": {
        peer: peerReleases,
        peer_key: "channel:4002",
        folder_id: 0,
        pinned: false,
        archived: false,
        can_post: false,
        read_inbox_max_id: 106,
        read_outbox_max_id: 106,
        notify_settings: { mute_until: 2_147_483_647 },
      },
      "user:2002": {
        peer: peerSamira,
        peer_key: "user:2002",
        folder_id: 1,
        pinned: false,
        archived: true,
        can_post: true,
        read_inbox_max_id: 107,
        read_outbox_max_id: 107,
        notify_settings: { mute_until: 0 },
      },
    },
    messages: {
      "user:2001": [
        seedMessage(101, peerMaya, 1001, 1730001000, "Are we still on for lunch?", true),
        seedMessage(102, peerMaya, 2001, 1730001060, "Yes, see you at noon!", false, {
          reply_to_msg_id: 101,
          reactions: [{ emoticon: "👍", count: 1, chosen: false }],
        }),
      ],
      "chat:3001": [
        seedMessage(103, peerCore, 1001, 1730002000, "Pushed the Telegram user spec draft.", true),
        seedMessage(104, peerCore, 2003, 1730002050, "@alexrivera please check the 2FA states.", false, { mentioned: true }),
        seedMessage(105, peerCore, 2001, 1730002090, "Looks clean from my side.", false),
      ],
      "channel:4001": [
        seedMessage(106, peerBuilders, 2003, 1730003000, "Welcome to the Vibestack Builders supergroup.", false),
      ],
      "channel:4002": [
        seedMessage(107, peerReleases, 4002, 1730004000, "Alpha OS 2.1 release notes are live.", false),
      ],
      "user:2002": [
        seedMessage(108, peerSamira, 2002, 1730005000, "Catching up next month!", false),
      ],
    },
    updates: [],
    pendingCodes: {},
    pendingPasswords: {},
    qrTokens: {},
    sessions: {
      [initialSession]: {
        session_token: initialSession,
        phone_number: owner.phone ?? "+15550101234",
        user_id: owner.id,
        revoked: false,
      },
    },
    securityByPhone: {
      [TWO_FACTOR_TEST_PHONE]: { password: "alpha-2fa", hint: "codename" },
    },
    idempotency: {},
  };
}

function recordUpdate(ctx: ProviderContext<TelegramState>, partial: Omit<TelegramUpdate, "pts" | "date">): TelegramUpdate {
  const state = ctx.getState();
  state.pts += 1;
  const update: TelegramUpdate = {
    ...partial,
    pts: state.pts,
    date: Math.floor(Date.now() / 1000),
  };
  state.updates.push(update);
  if (state.updates.length > MAX_UPDATES) {
    state.updates.splice(0, state.updates.length - MAX_UPDATES);
  }
  ctx.sse.broadcast({
    id: String(update.pts),
    event: update._type,
    ...(partial.session_token !== undefined ? { channel: partial.session_token } : {}),
    data: update,
  });
  return update;
}

function resolveTelegramSession(
  req: ParsedRequest,
  res: ServerResponse,
  state: TelegramState,
): TelegramSession | undefined {
  const token = bearerToken(req.headers) ?? asString(req.params.token);
  if (!token) {
    tgError(res, 401, "AUTH_KEY_UNREGISTERED");
    return undefined;
  }
  if (BOT_TOKEN_PATTERN.test(token)) {
    tgError(res, 401, "BOT_TOKENS_NOT_SUPPORTED");
    return undefined;
  }
  const session = ownGet(state.sessions, token);
  if (!session || session.revoked) {
    tgError(res, 401, "AUTH_KEY_UNREGISTERED");
    return undefined;
  }
  return session;
}

function issueSession(state: TelegramState, phone: string): { readonly session_token: string; readonly user: TelegramUser } {
  const sessionToken = randomToken("tg-sess-", 20);
  const user: TelegramUser = { ...state.owner, phone };
  state.sessions[sessionToken] = {
    session_token: sessionToken,
    phone_number: phone,
    user_id: user.id,
    revoked: false,
  };
  return { session_token: sessionToken, user };
}

function computeDialogSummary(state: TelegramState, dialog: TelegramDialog): Record<string, unknown> {
  const list = ownGet(state.messages, dialog.peer_key) ?? [];
  const top = list[list.length - 1];
  const unread = list.filter((msg) => !msg.out && msg.id > dialog.read_inbox_max_id);
  const mentions = unread.filter((msg) => msg.mentioned).length;
  return {
    peer: dialog.peer,
    peer_key: dialog.peer_key,
    top_message: top?.id ?? 0,
    read_inbox_max_id: dialog.read_inbox_max_id,
    read_outbox_max_id: dialog.read_outbox_max_id,
    unread_count: unread.length,
    unread_mentions_count: mentions,
    pinned: dialog.pinned,
    archived: dialog.archived,
    folder_id: dialog.folder_id,
    can_post: dialog.can_post,
    notify_settings: { ...dialog.notify_settings },
    ...(top !== undefined ? { top_date: top.date } : { top_date: 0 }),
  };
}

function requirePassword(ctx: ProviderContext<TelegramState>, res: ServerResponse, phone: string): boolean {
  const state = ctx.getState();
  const security = ownGet(state.securityByPhone, phone);
  if (!security?.password) return false;
  const pendingAuthId = randomToken("p2fa_", 14);
  const hint = security.hint ?? "";
  state.pendingPasswords[pendingAuthId] = {
    pending_auth_id: pendingAuthId, phone_number: phone, password: security.password, hint, attempts: 0,
  };
  pruneRecordCap(state.pendingPasswords, MAX_TRANSIENT);
  ctx.save();
  tgError(res, 401, "SESSION_PASSWORD_NEEDED", { hint, pending_auth_id: pendingAuthId });
  return true;
}

function handleAuthRpc(
  req: ParsedRequest,
  res: ServerResponse,
  ctx: ProviderContext<TelegramState>,
): boolean {
  const state = ctx.getState();

  if (req.pathname === "/rpc/auth.sendCode") {
    const phone = (asString(req.params.phone_number) ?? "").trim();
    if (!E164_PATTERN.test(phone)) {
      tgError(res, 400, "PHONE_NUMBER_INVALID");
      return true;
    }
    const dcMatch = TEST_DC_PATTERN.exec(phone);
    const code = dcMatch ? dcMatch[1].repeat(5) : String(randomInt(10000, 100000));
    const hash = randomToken("pch_", 12);
    state.pendingCodes[hash] = {
      phone_number: phone,
      phone_code_hash: hash,
      code,
      expiresAt: Date.now() + 60_000,
      expired: false,
      consumed: false,
      attempts: 0,
    };
    pruneRecordCap(state.pendingCodes, MAX_TRANSIENT);
    ctx.save();
    sendJson(res, 200, {
      ok: true,
      _type: "auth.sentCode",
      phone_code_hash: hash,
      type: { _type: "auth.sentCodeTypeApp", length: 5 },
      timeout: 60,
    });
    return true;
  }

  if (req.pathname === "/rpc/auth.signIn") {
    const phone = (asString(req.params.phone_number) ?? "").trim();
    const hash = asString(req.params.phone_code_hash) ?? "";
    const code = (asString(req.params.phone_code) ?? "").trim();
    const pending = ownGet(state.pendingCodes, hash);
    if (!pending || pending.consumed || pending.phone_number !== phone) {
      tgError(res, 400, "PHONE_CODE_INVALID");
      return true;
    }
    if (pending.expired || Date.now() > pending.expiresAt) {
      tgError(res, 400, "PHONE_CODE_EXPIRED");
      return true;
    }
    if (pending.code !== code) {
      pending.attempts = (pending.attempts ?? 0) + 1;
      if (pending.attempts >= MAX_AUTH_ATTEMPTS) pending.consumed = true;
      ctx.save();
      tgError(res, 400, "PHONE_CODE_INVALID");
      return true;
    }
    pending.consumed = true;
    if (requirePassword(ctx, res, phone)) return true;
    const auth = issueSession(state, phone);
    ctx.save();
    sendJson(res, 200, { ok: true, _type: "auth.authorization", ...auth });
    return true;
  }

  if (req.pathname === "/rpc/account.getPassword") {
    const pendingId = asString(req.params.pending_auth_id);
    if (pendingId) {
      const pending = ownGet(state.pendingPasswords, pendingId);
      if (!pending) {
        tgError(res, 400, "PASSWORD_SESSION_INVALID");
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        _type: "account.password",
        has_password: true,
        hint: pending.hint,
        srp_id: "1",
        current_algo: { _type: "passwordKdfAlgoSHA256SHA256PBKDF2HMACSHA512iter100000SHA256ModPow" },
      });
      return true;
    }
    const session = resolveTelegramSession(req, res, state);
    if (!session) return true;
    const sec = ownGet(state.securityByPhone, session.phone_number);
    sendJson(res, 200, {
      ok: true,
      _type: "account.password",
      has_password: Boolean(sec?.password),
      hint: sec?.hint ?? "",
      srp_id: "1",
      current_algo: { _type: "passwordKdfAlgoSHA256SHA256PBKDF2HMACSHA512iter100000SHA256ModPow" },
    });
    return true;
  }

  if (req.pathname === "/rpc/auth.checkPassword") {
    const pendingId = asString(req.params.pending_auth_id) ?? "";
    const provided = asString(req.params.password) ?? asString(req.params.password_hash) ?? "";
    const pending = ownGet(state.pendingPasswords, pendingId);
    if (!pending) {
      tgError(res, 400, "PASSWORD_HASH_INVALID");
      return true;
    }
    if (pending.password !== provided) {
      pending.attempts = (pending.attempts ?? 0) + 1;
      if (pending.attempts >= MAX_AUTH_ATTEMPTS) delete state.pendingPasswords[pendingId];
      ctx.save();
      tgError(res, 400, "PASSWORD_HASH_INVALID");
      return true;
    }
    delete state.pendingPasswords[pendingId];
    const auth = issueSession(state, pending.phone_number);
    ctx.save();
    sendJson(res, 200, { ok: true, _type: "auth.authorization", ...auth });
    return true;
  }

  if (req.pathname === "/rpc/auth.exportLoginToken") {
    const existingToken = asString(req.params.token);
    if (existingToken) {
      const record = ownGet(state.qrTokens, existingToken);
      if (!record || record.consumed === true || record.expires < Math.floor(Date.now() / 1000)) {
        tgError(res, 400, "AUTH_TOKEN_EXPIRED");
        return true;
      }
      if (record.approved && !record.session_token && record.phone_number) {
        record.consumed = true;
        if (requirePassword(ctx, res, record.phone_number)) return true;
        record.session_token = issueSession(state, record.phone_number).session_token;
      }
      if (record.approved && record.session_token) {
        const sessionToken = record.session_token;
        record.consumed = true;
        delete record.session_token;
        ctx.save();
        const user: TelegramUser = { ...state.owner, phone: record.phone_number ?? state.owner.phone };
        sendJson(res, 200, {
          ok: true,
          _type: "auth.loginTokenSuccess",
          authorization: {
            _type: "auth.authorization",
            session_token: sessionToken,
            user,
          },
        });
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        _type: "auth.loginToken",
        token: record.token,
        expires: record.expires,
        login_url: record.login_url,
      });
      return true;
    }
    const token = randomToken("tgqr_", 18);
    const expires = Math.floor(Date.now() / 1000) + 60;
    const loginUrl = `tg://login?token=${token}`;
    state.qrTokens[token] = { token, expires, login_url: loginUrl, approved: false, consumed: false };
    pruneRecordCap(state.qrTokens, MAX_TRANSIENT);
    ctx.save();
    sendJson(res, 200, { ok: true, _type: "auth.loginToken", token, expires, login_url: loginUrl });
    return true;
  }

  if (req.pathname === "/rpc/auth.acceptLoginToken") {
    const session = resolveTelegramSession(req, res, state);
    if (!session) return true;
    const qrToken = asString(req.params.token) ?? "";
    const record = ownGet(state.qrTokens, qrToken);
    if (!record || record.consumed === true || record.expires < Math.floor(Date.now() / 1000)) {
      tgError(res, 400, "AUTH_TOKEN_EXPIRED");
      return true;
    }
    if (record.approved) {
      tgError(res, 400, "AUTH_TOKEN_ALREADY_ACCEPTED");
      return true;
    }
    const issued = issueSession(state, session.phone_number);
    record.approved = true;
    record.session_token = issued.session_token;
    record.phone_number = session.phone_number;
    ctx.save();
    sendJson(res, 200, { ok: true, _type: "authorization", ...issued });
    return true;
  }

  return false;
}

function handleGetDialogs(req: ParsedRequest, res: ServerResponse, state: TelegramState): void {
  const folderId = asNumber(req.params.folder_id);
  const archived = asBoolean(req.params.archived);
  const pinnedOnly = asBoolean(req.params.pinned_only) ?? false;
  const unreadOnly = asBoolean(req.params.unread_only) ?? false;
  const offsetDate = asNumber(req.params.offset_date);

  const summaries = Object.values(state.dialogs)
    .map((dialog) => ({ dialog, summary: computeDialogSummary(state, dialog) }))
    .filter(({ dialog, summary }) => {
      if (folderId !== undefined && folderId !== 0 && dialog.folder_id !== folderId) return false;
      if (archived !== undefined && dialog.archived !== archived) return false;
      if (archived === undefined && (folderId === undefined || folderId === 0) && dialog.archived) return false;
      if (pinnedOnly && !dialog.pinned) return false;
      if (unreadOnly && Number(summary.unread_count) === 0) return false;
      if (offsetDate !== undefined && Number(summary.top_date) >= offsetDate) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.dialog.pinned !== b.dialog.pinned) return a.dialog.pinned ? -1 : 1;
      return Number(b.summary.top_date) - Number(a.summary.top_date);
    });

  const page = paginateSlice(summaries, asString(req.params.cursor), asNumber(req.params.limit) ?? 50);
  const dialogsOut = page.items.map((entry) => entry.summary);
  const topMessages = page.items
    .map((entry) => {
      const list = ownGet(state.messages, entry.dialog.peer_key) ?? [];
      return list[list.length - 1];
    })
    .filter((item): item is TelegramMessage => item !== undefined);

  sendJson(res, 200, {
    ok: true,
    dialogs: dialogsOut,
    chats: Object.values(state.chats),
    users: Object.values(state.users),
    messages: topMessages,
    folders: state.folders,
    next_cursor: page.nextCursor,
    has_more: page.hasMore,
    pts: state.pts,
  });
}

function requireDialog(
  req: ParsedRequest,
  res: ServerResponse,
  state: TelegramState,
): { readonly peer: TelegramPeer; readonly key: string; readonly dialog: TelegramDialog } | undefined {
  const peer = parsePeer(req.params.peer);
  if (!peer) {
    tgError(res, 400, "PEER_ID_INVALID");
    return undefined;
  }
  const key = peerKey(peer);
  const dialog = ownGet(state.dialogs, key);
  if (!dialog) {
    tgError(res, 404, "PEER_ID_INVALID");
    return undefined;
  }
  return { peer, key, dialog };
}

function applyTelegramEdit(
  ctx: ProviderContext<TelegramState>,
  peer: TelegramPeer,
  key: string,
  target: TelegramMessage,
  text: string,
): TelegramUpdate {
  target.message = text;
  target.edit_date = Math.floor(Date.now() / 1000);
  const update = recordUpdate(ctx, { _type: "updateEditMessage", peer, peer_key: key, message: target });
  ctx.save();
  return update;
}

function applyTelegramDelete(
  ctx: ProviderContext<TelegramState>,
  peer: TelegramPeer,
  key: string,
  ids: readonly number[],
): { readonly deleted: number[]; readonly update: TelegramUpdate } {
  const state = ctx.getState();
  const list = ownGet(state.messages, key) ?? [];
  const idSet = new Set(ids);
  const deleted: number[] = [];
  state.messages[key] = list.filter((msg) => {
    if (idSet.has(msg.id)) {
      deleted.push(msg.id);
      return false;
    }
    return true;
  });
  const update = recordUpdate(ctx, { _type: "updateDeleteMessages", peer, peer_key: key, messages: deleted });
  ctx.save();
  return { deleted, update };
}

function applyTelegramReaction(
  ctx: ProviderContext<TelegramState>,
  peer: TelegramPeer,
  key: string,
  target: TelegramMessage,
  emoticon: string | undefined,
  fromSelf: boolean,
): TelegramUpdate {
  toggleTelegramReaction(target, emoticon, fromSelf);
  const update = recordUpdate(ctx, {
    _type: "updateMessageReactions",
    peer,
    peer_key: key,
    msg_id: target.id,
    reactions: target.reactions,
  });
  ctx.save();
  return update;
}

function handleGetHistory(req: ParsedRequest, res: ServerResponse, state: TelegramState): void {
  const resolved = requireDialog(req, res, state);
  if (!resolved) return;
  const offsetId = asNumber(req.params.offset_id);
  const all = [...(ownGet(state.messages, resolved.key) ?? [])]
    .filter((msg) => (offsetId !== undefined && offsetId > 0 ? msg.id < offsetId : true))
    .sort((a, b) => b.id - a.id);
  const page = paginateSlice(all, asString(req.params.cursor), asNumber(req.params.limit) ?? 50);
  sendJson(res, 200, {
    ok: true,
    messages: page.items,
    count: all.length,
    next_cursor: page.nextCursor,
    has_more: page.hasMore,
    pts: state.pts,
  });
}

function withDialog(
  req: ParsedRequest,
  res: ServerResponse,
  ctx: ProviderContext<TelegramState>,
  handler: (resolved: { readonly peer: TelegramPeer; readonly key: string; readonly dialog: TelegramDialog }, state: TelegramState) => void,
): void {
  const state = ctx.getState();
  const resolved = requireDialog(req, res, state);
  if (!resolved) return;
  handler(resolved, state);
}

function handleSendMessage(req: ParsedRequest, res: ServerResponse, ctx: ProviderContext<TelegramState>): void {
  withDialog(req, res, ctx, ({ peer, key, dialog }, state) => {
    if (!dialog.can_post) {
      tgError(res, 403, "CHAT_WRITE_FORBIDDEN");
      return;
    }
    const text = asString(req.params.message);
    if (text === undefined || text.trim() === "") {
      tgError(res, 400, "MESSAGE_EMPTY");
      return;
    }
    const randomId = asString(req.params.random_id) ?? (asNumber(req.params.random_id) !== undefined ? String(asNumber(req.params.random_id)) : undefined);
    const dedupeToken = req.headers["idempotency-key"] ?? randomId;
    const scopedKey = dedupeToken ? `${key}:${dedupeToken}` : undefined;
    const cached = ownGet(state.idempotency, scopedKey);
    if (cached) {
      sendJson(res, 200, { ok: true, message: structuredClone(cached), pts: state.pts });
      return;
    }
    const replyTo = asNumber(req.params.reply_to_msg_id);
    const id = ++state.nextMessageId;
    const msg = seedMessage(id, peer, state.owner.id, Math.floor(Date.now() / 1000), text, true, {
      ...(replyTo !== undefined ? { reply_to_msg_id: replyTo } : {}),
    });
    const list = ownGet(state.messages, key) ?? (state.messages[key] = []);
    list.push(msg);
    dialog.read_outbox_max_id = id;
    if (scopedKey) {
      state.idempotency[scopedKey] = structuredClone(msg);
      pruneRecordCap(state.idempotency, MAX_TRANSIENT);
    }
    const update = recordUpdate(ctx, { _type: "updateNewMessage", peer, peer_key: key, message: msg });
    ctx.save();
    sendJson(res, 200, { ok: true, message: msg, pts: update.pts });
  });
}

function resolveMessageTarget(
  req: ParsedRequest,
  res: ServerResponse,
  state: TelegramState,
  idField: "id" | "msg_id",
): { readonly peer: TelegramPeer; readonly key: string; readonly target: TelegramMessage } | undefined {
  const peer = parsePeer(req.params.peer);
  const id = asNumber(req.params[idField]);
  if (!peer || id === undefined) {
    tgError(res, 400, "MESSAGE_ID_INVALID");
    return undefined;
  }
  const key = peerKey(peer);
  const target = (ownGet(state.messages, key) ?? []).find((msg) => msg.id === id);
  if (!target) {
    tgError(res, 404, "MESSAGE_ID_INVALID");
    return undefined;
  }
  return { peer, key, target };
}

function handleEditMessage(
  req: ParsedRequest,
  res: ServerResponse,
  ctx: ProviderContext<TelegramState>,
): void {
  const state = ctx.getState();
  const resolved = resolveMessageTarget(req, res, state, "id");
  if (!resolved) return;
  const { peer, key, target } = resolved;
  const text = asString(req.params.message);
  if (!target.out) {
    tgError(res, 403, "MESSAGE_AUTHOR_REQUIRED");
    return;
  }
  if (text === undefined || text.trim() === "") {
    tgError(res, 400, "MESSAGE_EMPTY");
    return;
  }
  const update = applyTelegramEdit(ctx, peer, key, target, text);
  sendJson(res, 200, { ok: true, message: target, pts: update.pts });
}

function handleDeleteMessages(
  req: ParsedRequest,
  res: ServerResponse,
  ctx: ProviderContext<TelegramState>,
): void {
  const state = ctx.getState();
  const ids = asNumberArray(req.params.id);
  if (!ids || ids.length === 0) {
    tgError(res, 400, "MESSAGE_ID_INVALID");
    return;
  }
  const resolved = requireDialog(req, res, state);
  if (!resolved) return;
  if (!resolved.dialog.can_post) {
    tgError(res, 403, "CHAT_WRITE_FORBIDDEN");
    return;
  }
  const list = ownGet(state.messages, resolved.key);
  if (!list) {
    tgError(res, 404, "PEER_ID_INVALID");
    return;
  }
  const idSet = new Set(ids);
  if (list.some((msg) => idSet.has(msg.id) && !msg.out)) {
    tgError(res, 403, "MESSAGE_DELETE_FORBIDDEN");
    return;
  }
  const { deleted, update } = applyTelegramDelete(ctx, resolved.peer, resolved.key, ids);
  sendJson(res, 200, { ok: true, pts: update.pts, pts_count: deleted.length, deleted_ids: deleted });
}

function toggleTelegramReaction(msg: TelegramMessage, emoticon: string | undefined, fromSelf: boolean): void {
  if (!emoticon) {
    if (!fromSelf) return;
    for (const item of msg.reactions) {
      if (item.chosen) {
        item.chosen = false;
        item.count = Math.max(0, item.count - 1);
      }
    }
    msg.reactions = msg.reactions.filter((item) => item.count > 0);
    return;
  }
  const existing = msg.reactions.find((item) => item.emoticon === emoticon);
  if (fromSelf) {
    if (existing?.chosen) {
      existing.chosen = false;
      existing.count = Math.max(0, existing.count - 1);
      msg.reactions = msg.reactions.filter((item) => item.count > 0);
      return;
    }
    if (existing) {
      existing.chosen = true;
      existing.count += 1;
    } else {
      msg.reactions.push({ emoticon, count: 1, chosen: true });
    }
    return;
  }
  if (existing) {
    existing.count += 1;
  } else {
    msg.reactions.push({ emoticon, count: 1, chosen: false });
  }
}

function handleSendReaction(
  req: ParsedRequest,
  res: ServerResponse,
  ctx: ProviderContext<TelegramState>,
): void {
  const state = ctx.getState();
  const resolved = resolveMessageTarget(req, res, state, "msg_id");
  if (!resolved) return;
  const { peer, key, target } = resolved;
  const rawReaction = asString(req.params.reaction);
  const update = applyTelegramReaction(
    ctx,
    peer,
    key,
    target,
    rawReaction && rawReaction.trim() !== "" ? rawReaction.trim() : undefined,
    true,
  );
  sendJson(res, 200, { ok: true, message: target, pts: update.pts });
}

function handleReadHistory(req: ParsedRequest, res: ServerResponse, ctx: ProviderContext<TelegramState>): void {
  withDialog(req, res, ctx, ({ peer, key, dialog }, state) => {
    const list = ownGet(state.messages, key) ?? [];
    const topId = list[list.length - 1]?.id ?? dialog.read_inbox_max_id;
    const requestedMax = asNumber(req.params.max_id) ?? topId;
    const maxId = requestedMax === 0 ? topId : requestedMax;
    if (maxId > dialog.read_inbox_max_id) {
      dialog.read_inbox_max_id = maxId;
    }
    const update = recordUpdate(ctx, {
      _type: "updateReadHistoryInbox",
      peer,
      peer_key: key,
      max_id: dialog.read_inbox_max_id,
    });
    ctx.save();
    const summary = computeDialogSummary(state, dialog);
    sendJson(res, 200, {
      ok: true,
      pts: update.pts,
      read_inbox_max_id: dialog.read_inbox_max_id,
      unread_count: summary.unread_count,
    });
  });
}

function handleSearchGlobal(req: ParsedRequest, res: ServerResponse, state: TelegramState): void {
  const q = (asString(req.params.q) ?? "").trim().toLowerCase();
  const peerFilter = req.params.peer !== undefined ? parsePeer(req.params.peer) : undefined;
  const keyFilter = peerFilter ? peerKey(peerFilter) : undefined;
  const offsetId = asNumber(req.params.offset_id);

  const matched: TelegramMessage[] = [];
  for (const [key, list] of Object.entries(state.messages)) {
    if (keyFilter && key !== keyFilter) continue;
    for (const msg of list) {
      if (offsetId !== undefined && offsetId > 0 && msg.id >= offsetId) continue;
      if (q === "" || msg.message.toLowerCase().includes(q)) {
        matched.push(msg);
      }
    }
  }
  matched.sort((a, b) => b.id - a.id);
  const page = paginateSlice(matched, asString(req.params.cursor), asNumber(req.params.limit) ?? 30);
  sendJson(res, 200, {
    ok: true,
    messages: page.items,
    chats: Object.values(state.chats),
    users: Object.values(state.users),
    count: matched.length,
    next_cursor: page.nextCursor,
    has_more: page.hasMore,
  });
}

function handleTelegramControl(
  req: ParsedRequest,
  res: ServerResponse,
  ctx: ProviderContext<TelegramState>,
): boolean {
  const state = ctx.getState();

  if (req.pathname === "/__control/last-code" && req.method === "GET") {
    const phone = req.query.phone;
    const candidates = Object.values(state.pendingCodes).filter((item) => !phone || item.phone_number === phone);
    const latest = candidates[candidates.length - 1];
    if (!latest) {
      sendJson(res, 404, { ok: false, error: "no_pending_code" });
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      phone: latest.phone_number,
      code: latest.code,
      phone_code_hash: latest.phone_code_hash,
      expired: latest.expired || Date.now() > latest.expiresAt,
    });
    return true;
  }

  if (req.pathname === "/__control/expire-code" && req.method === "POST") {
    const phone = asString(req.params.phone);
    const hash = asString(req.params.phone_code_hash);
    let expiredCount = 0;
    for (const item of Object.values(state.pendingCodes)) {
      if (hash && item.phone_code_hash !== hash) continue;
      if (phone && item.phone_number !== phone) continue;
      item.expired = true;
      expiredCount += 1;
    }
    ctx.save();
    sendJson(res, 200, { ok: true, expired: expiredCount });
    return true;
  }

  if (req.pathname === "/__control/approve-qr" && req.method === "POST") {
    const token = asString(req.params.token) ?? "";
    const record = ownGet(state.qrTokens, token);
    if (!record) {
      sendJson(res, 404, { ok: false, error: "qr_token_not_found" });
      return true;
    }
    if (record.approved || record.consumed === true) {
      sendJson(res, 409, { ok: false, error: "qr_token_already_approved" });
      return true;
    }
    if (record.expires < Math.floor(Date.now() / 1000)) {
      sendJson(res, 400, { ok: false, error: "qr_token_expired" });
      return true;
    }
    const phone = asString(req.params.phone) ?? state.owner.phone ?? "+15550101234";
    record.approved = true;
    record.phone_number = phone;
    if (ownGet(state.securityByPhone, phone)?.password) {
      ctx.save();
      sendJson(res, 200, { ok: true, token });
      return true;
    }
    const issued = issueSession(state, phone);
    record.session_token = issued.session_token;
    ctx.save();
    sendJson(res, 200, { ok: true, token, session_token: issued.session_token, user: issued.user });
    return true;
  }

  if (req.pathname === "/__control/revoke" && req.method === "POST") {
    const specific = asString(req.params.session_token);
    let revoked = 0;
    const revokedTokens = new Set<string>();
    for (const item of Object.values(state.sessions)) {
      if (item.revoked) continue;
      if (specific && item.session_token !== specific) continue;
      item.revoked = true;
      revoked += 1;
      revokedTokens.add(item.session_token);
      recordUpdate(ctx, { _type: "updateSessionRevoked", session_token: item.session_token });
    }
    ctx.save();
    ctx.sse.closeWhere((meta) => meta?.session_token !== undefined && revokedTokens.has(meta.session_token));
    sendJson(res, 200, { ok: true, revoked });
    return true;
  }

  if (req.pathname === "/__control/inject" && req.method === "POST") {
    const peer = parsePeer(req.params.peer) ?? { _type: "peerUser", user_id: 2001 };
    const key = peerKey(peer);
    const dialog = ownGet(state.dialogs, key);
    if (!dialog) {
      sendJson(res, 404, { ok: false, error: "peer_not_found" });
      return true;
    }
    const kind = asString(req.params.kind) ?? "message";
    const list = ownGet(state.messages, key) ?? (state.messages[key] = []);

    if (kind === "message") {
      const text = asString(req.params.message) ?? asString(req.params.text) ?? "Injected Telegram message";
      const fromId = asNumber(req.params.from_id) ?? (peer._type === "peerUser" ? peer.user_id : 2001);
      const mentioned = asBoolean(req.params.mentioned) ?? text.includes(`@${state.owner.username ?? ""}`);
      const replyTo = asNumber(req.params.reply_to_msg_id);
      const id = ++state.nextMessageId;
      const msg = seedMessage(id, peer, fromId, Math.floor(Date.now() / 1000), text, false, {
        mentioned,
        ...(replyTo !== undefined ? { reply_to_msg_id: replyTo } : {}),
      });
      list.push(msg);
      const update = recordUpdate(ctx, { _type: "updateNewMessage", peer, peer_key: key, message: msg });
      ctx.save();
      sendJson(res, 200, { ok: true, message: msg, pts: update.pts });
      return true;
    }

    if (kind === "edit" || kind === "reaction") {
      const id = asNumber(req.params.msg_id) ?? asNumber(req.params.id) ?? list[list.length - 1]?.id;
      const target = list.find((item) => item.id === id);
      if (!target) {
        sendJson(res, 404, { ok: false, error: "message_not_found" });
        return true;
      }
      const update =
        kind === "edit"
          ? applyTelegramEdit(ctx, peer, key, target, asString(req.params.message) ?? asString(req.params.text) ?? target.message)
          : applyTelegramReaction(ctx, peer, key, target, asString(req.params.reaction) ?? "🔥", false);
      sendJson(res, 200, { ok: true, message: target, pts: update.pts });
      return true;
    }

    if (kind === "delete") {
      const fallbackId = list[list.length - 1]?.id;
      const ids = asNumberArray(req.params.id) ?? (fallbackId !== undefined ? [fallbackId] : []);
      const { deleted, update } = applyTelegramDelete(ctx, peer, key, ids);
      sendJson(res, 200, { ok: true, deleted_ids: deleted, pts: update.pts });
      return true;
    }

    if (kind === "read") {
      const maxId = asNumber(req.params.max_id) ?? list[list.length - 1]?.id ?? dialog.read_inbox_max_id;
      dialog.read_inbox_max_id = Math.max(dialog.read_inbox_max_id, maxId);
      const update = recordUpdate(ctx, {
        _type: "updateReadHistoryInbox",
        peer,
        peer_key: key,
        max_id: dialog.read_inbox_max_id,
      });
      ctx.save();
      sendJson(res, 200, { ok: true, max_id: dialog.read_inbox_max_id, pts: update.pts });
      return true;
    }

    sendJson(res, 400, { ok: false, error: "unknown_inject_kind" });
    return true;
  }

  return false;
}

function handleTelegramRpc(req: ParsedRequest, res: ServerResponse, ctx: ProviderContext<TelegramState>): void {
  if (req.method === "POST" && handleAuthRpc(req, res, ctx)) return;

  const state = ctx.getState();
  const session = resolveTelegramSession(req, res, state);
  if (!session) return;

  if (req.pathname === "/rpc/updates.stream" && req.method === "GET") {
    const sincePts = asNumber(req.query.pts) ?? state.pts;
    const replay: SseEnvelope[] = state.updates
      .filter((item) => item.pts > sincePts && (item.session_token === undefined || item.session_token === session.session_token))
      .map((item) => ({
        id: String(item.pts),
        event: item._type,
        ...(item.session_token !== undefined ? { channel: item.session_token } : {}),
        data: item,
      }));
    ctx.sse.connect(res, {
      replay,
      filter: (envelope) => envelope.channel === undefined || envelope.channel === session.session_token,
      meta: { session_token: session.session_token },
    });
    return;
  }

  if (req.method !== "POST") {
    tgError(res, 405, "METHOD_NOT_ALLOWED");
    return;
  }

  switch (req.pathname) {
    case "/rpc/auth.logOut":
      session.revoked = true;
      ctx.save();
      ctx.sse.closeWhere((meta) => meta?.session_token === session.session_token);
      sendJson(res, 200, { ok: true, _type: "auth.loggedOut" });
      return;
    case "/rpc/users.getMe":
      sendJson(res, 200, { ok: true, user: { ...state.owner, phone: session.phone_number } });
      return;
    case "/rpc/messages.getDialogs":
      handleGetDialogs(req, res, state);
      return;
    case "/rpc/messages.getHistory":
      handleGetHistory(req, res, state);
      return;
    case "/rpc/messages.sendMessage":
      handleSendMessage(req, res, ctx);
      return;
    case "/rpc/messages.editMessage":
      handleEditMessage(req, res, ctx);
      return;
    case "/rpc/messages.deleteMessages":
      handleDeleteMessages(req, res, ctx);
      return;
    case "/rpc/messages.sendReaction":
      handleSendReaction(req, res, ctx);
      return;
    case "/rpc/messages.readHistory":
      handleReadHistory(req, res, ctx);
      return;
    case "/rpc/messages.searchGlobal":
      handleSearchGlobal(req, res, state);
      return;
    case "/rpc/account.updateNotifySettings": {
      const peer = parsePeer(req.params.peer);
      const muteUntil = asNumber(req.params.mute_until);
      if (!peer || muteUntil === undefined) {
        tgError(res, 400, "INPUT_CONSTRUCTOR_INVALID");
        return;
      }
      const key = peerKey(peer);
      const dialog = ownGet(state.dialogs, key);
      if (!dialog) {
        tgError(res, 404, "PEER_ID_INVALID");
        return;
      }
      dialog.notify_settings = { mute_until: muteUntil };
      ctx.save();
      sendJson(res, 200, { ok: true, peer, notify_settings: dialog.notify_settings });
      return;
    }
    case "/rpc/updates.getDifference": {
      const sincePts = asNumber(req.params.pts) ?? 0;
      const newer = state.updates.filter((item) => item.pts > sincePts);
      const newMessages = newer.flatMap((item) =>
        item._type === "updateNewMessage" && item.message !== undefined ? [item.message] : [],
      );
      const otherUpdates = newer.filter((item) => item._type !== "updateNewMessage");
      sendJson(res, 200, {
        ok: true,
        _type: "updates.difference",
        new_messages: newMessages,
        other_updates: otherUpdates,
        state: { pts: state.pts, date: Math.floor(Date.now() / 1000) },
      });
      return;
    }
    default:
      tgError(res, 404, "RPC_METHOD_NOT_FOUND");
  }
}

function defaultTelegramFaultBody(fault: FaultRule): unknown {
  if (fault.status === 429) {
    const wait = fault.retryAfter ?? 10;
    return { ok: false, error_code: 429, error_message: `FLOOD_WAIT_${wait}` };
  }
  if (fault.status === 401) {
    return { ok: false, error_code: 401, error_message: "AUTH_KEY_UNREGISTERED" };
  }
  return { ok: false, error_code: fault.status, error_message: `HTTP_${fault.status}` };
}

/** Start a stateful, wire-faithful Telegram User Client RPC (MTProto/TDLib method names & errors, NO bot tokens) + SSE provider server. */
export async function startTelegramProvider(options?: ProviderOptions): Promise<RunningProvider> {
  return createProviderServer<TelegramState>({
    options,
    createInitial: createInitialTelegramState,
    defaultFaultBody: defaultTelegramFaultBody,
    onReset: (params, ctx) => {
      const state = ctx.getState();
      const phone = asString(params.phone) ?? state.owner.phone ?? "+15550101234";
      const password = asString(params.twoFactorPassword);
      const hint = asString(params.twoFactorHint) ?? "";
      if (password !== undefined) {
        state.securityByPhone[phone] = password === "" ? {} : { password, hint };
      }
    },
    onControl: handleTelegramControl,
    onRequest: handleTelegramRpc,
  });
}
