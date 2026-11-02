/** Display only. Stored messages, proposals and journal receipts are never rewritten. */
type Message = Record<string, any>;
const REVIEW_TEXT = 'Review this request on your phone before it can run.';
export function browserNavigationSummary(url: string): string {
  const destination = new URL(url);
  if (destination.protocol !== 'https:') throw Error('Expected an HTTPS destination');
  return `Opened ${destination.host}.`;
}
function browserCardUrl(description: unknown): string | undefined {
  const prefix = 'Open browser destination ';
  if (typeof description !== 'string' || !description.startsWith(prefix)) return;
  const url = description.slice(prefix.length);
  try { if (new URL(url).protocol === 'https:') return url; } catch { /* Keep unrecognized content intact. */ }
}
/** The destination of a browser proposal whose receipt succeeded with exactly the Browser summary
 * (no pending server receipt or other note), else undefined. */
export function succeededBrowserDestination(card: {description: string} | null | undefined, receipt: {status: string; summary: string}): string | undefined {
  const url = browserCardUrl(card?.description);
  if (url && receipt.status === 'succeeded' && receipt.summary === browserNavigationSummary(url)) return url;
}
function cardDestination(message: Message): string | undefined {
  if (message.from === 'agent' && message.card?.proposalId) return browserCardUrl(message.text);
}
export function projectActionMessages(rendered: Message[], source: Message[]): Message[] {
  const byId = new Map(source.map(message => [message.id, message]));
  const hidden = new Set<string>();
  const renderedIds = new Set(rendered.map(message => message.id));
  const completedResults = new Map<string, string>();
  for (const message of source) {
    if (renderedIds.has(message.id) && message.from === 'agent' && message.card?.proposalId && message.card.done && typeof message.card.sub === 'string' && message.card.sub.trim()) {
      completedResults.set(`device-receipt:${message.card.proposalId}`, message.card.sub);
    }
  }
  for (const message of source) {
    // A queued proposal may precede the request and its receipt may follow the reply. Collapse
    // only the same result already shown by that exact proposal in the current rendered history.
    if (message.from === 'agent' && message.deviceReceipt === true && !message.card && completedResults.has(message.id) && completedResults.get(message.id) === message.text) hidden.add(message.id);
  }
  let turn: Message[] = [];
  const finish = () => {
    const actions = turn.filter(message => message.from === 'agent' && (message.card?.proposalId || message.deviceReceipt));
    if (!actions.length) return;
    for (const message of turn) if (message.from === 'agent' && message.text === REVIEW_TEXT) hidden.add(message.id);
    // A shown agent reply already answers a requested Browser open. Only a succeeded browser receipt
    // carries browserDestination; failures and other device receipts stay visible.
    if (!turn.some(message => renderedIds.has(message.id) && message.from === 'agent' && !message.deviceReceipt && !message.card && !message.interrupted && message.text !== REVIEW_TEXT && typeof message.text === 'string' && message.text.trim())) return;
    for (const message of turn) if (message.from === 'agent' && message.deviceReceipt === true && !message.card && message.browserDestination) hidden.add(message.id);
  };
  for (const message of source) { if (message.from === 'user') { finish(); turn = []; } turn.push(message); } finish();
  return rendered.filter(message => !hidden.has(message.id)).map(message => {
    const stored = byId.get(message.id);
    if (!stored || stored.from !== 'agent') return message;
    const destination = cardDestination(stored);
    if (stored.card?.proposalId && stored.card.done) {
      const displayText = destination && stored.card.title === 'Completed' ? browserNavigationSummary(destination) : stored.card.sub;
      if (typeof displayText !== 'string' || !displayText.trim()) return message;
      return {...message, cGeneric:false, cDigest:false, displayText, hasCalendarText:true};
    }
    if (stored.deviceReceipt && stored.browserDestination) {
      try { return {...message, displayText:browserNavigationSummary(stored.browserDestination), hasCalendarText:true}; } catch { return message; }
    }
    if (destination && message.cDigest && message.rows?.length) {
      return {...message,hasCalendarText:false,rows:message.rows.map((row:Message,index:number)=>index===0?{...row,who:`Open ${new URL(destination).host}?`,text:'Open in Browser.'}:row)};
    }
    return message;
  });
}

/*
 * Upstream escalation notices in Alpha's chat.
 *
 * The agent's escalation service posts a system notice into client chat when the same error
 * repeats (`packages/agent/src/runtime/error-escalation.ts`), and re-posts it on every agent start
 * and retry, each as a new stored message (`client-chat-sender.ts`). Conversation history returns
 * those rows as ordinary assistant text, so the text equal to pinned `systemNoticeText()`
 * (`packages/core/src/types/system-notice.ts`) is the only marker a runtime-error row carries.
 *
 * At most the latest notice is shown, and only until an ordinary agent reply follows it. A
 * runtime-error notice uses Alpha's words, not the upstream host-operator copy ("Check the
 * connected host's diagnostics"): it says a reply may not arrive only when it arrived while the
 * owner's latest message was unanswered; otherwise it says calmly that part of the agent is down.
 */
export type SystemNoticeKind = 'model-unavailable' | 'runtime-error' | 'model-and-runtime-error';

/** Byte-equal to pinned upstream `systemNoticeText()` (test/system-notice-collapse.test.mjs). These
 * recognise stored notice rows only; they are never shown, since they name the shared runtime and
 * a host operator's step. */
export const UPSTREAM_MODEL_UNAVAILABLE_NOTICE = 'Eliza cannot respond yet. Configure a model provider on the connected host in Settings.';
export const UPSTREAM_RUNTIME_ERROR_NOTICE = 'Eliza needs attention. Check the connected host\'s diagnostics before trying again.';
const UPSTREAM_COMBINED_NOTICE = `${UPSTREAM_MODEL_UNAVAILABLE_NOTICE}\n---\n${UPSTREAM_RUNTIME_ERROR_NOTICE}`;

/** A runtime-error notice that arrived while the owner's latest message was unanswered. */
/** A model-unavailable notice in Alpha's words: the owner's own recovery step. */
export const MODEL_UNAVAILABLE_NOTICE = 'Your agent cannot reply yet. Choose an AI provider in Settings, then send your message again.';
export const RUNTIME_ERROR_NOTICE = 'Part of your agent stopped working, so this reply may not arrive. Nothing was resent. Send your message again in a moment.';
/** A runtime-error notice that arrived with nothing waiting (a service failing at start, for example). */
export const RUNTIME_ERROR_BACKGROUND_NOTICE = 'Part of your agent stopped working. Chat can still answer, but some features may not work until it recovers.';

/** The upstream notice a stored assistant text is, if any. */
export function systemNoticeKind(text: unknown): SystemNoticeKind | undefined {
  if (typeof text !== 'string') return undefined;
  const value = text.trim();
  return value === UPSTREAM_MODEL_UNAVAILABLE_NOTICE ? 'model-unavailable'
    : value === UPSTREAM_RUNTIME_ERROR_NOTICE ? 'runtime-error'
    : value === UPSTREAM_COMBINED_NOTICE ? 'model-and-runtime-error'
    : undefined;
}

/** The owner-facing text of a stored notice row, always in Alpha's words;
 * the combined form keeps both halves. `waiting`: it arrived while the owner's message was unanswered. */
export function systemNoticeDisplayText(kind: SystemNoticeKind, waiting = false): string {
  const runtime = waiting ? RUNTIME_ERROR_NOTICE : RUNTIME_ERROR_BACKGROUND_NOTICE;
  return kind === 'runtime-error' ? runtime
    : kind === 'model-and-runtime-error' ? `${MODEL_UNAVAILABLE_NOTICE}\n${runtime}`
    : MODEL_UNAVAILABLE_NOTICE;
}

type ChatRow = { from?: unknown; text?: unknown; systemNotice?: unknown; interrupted?: unknown; unfinished?: unknown; streaming?: unknown; card?: unknown; deviceReceipt?: unknown };

/** An agent row that proves the chat answered: a settled text reply, not a notice, a failed or
 * restored-unfinished reply, a stream still in progress, a client-made card (proposals) or a phone
 * action receipt, which records what the phone did, not that chat answered. */
function ordinaryReply(message: ChatRow): boolean {
  return message.from === 'agent' && !message.systemNotice && message.interrupted !== true && message.unfinished !== true
    && message.streaming !== true && !message.card && !message.deviceReceipt && typeof message.text === 'string' && message.text.trim() !== '';
}

/**
 * Collapse upstream notices: keep at most the latest one, drop it once an ordinary reply follows,
 * and word a runtime-error notice for whether it arrived while the owner's latest message was
 * unanswered. Returns the same array when nothing changes, so callers can skip a render.
 */
export function collapseSystemNotices<T extends ChatRow>(messages: T[]): T[] {
  let latest = -1, lastReply = -1, lastUser = -1;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.systemNotice) latest = index;
    else if (ordinaryReply(message)) lastReply = index;
    else if (message.from === 'user') lastUser = index;
  }
  const keep = latest > lastReply ? latest : -1;
  let changed = false;
  const result: T[] = [];
  messages.forEach((message, index) => {
    if (!message.systemNotice) { result.push(message); return; }
    if (index !== keep) { changed = true; return; }
    const kind = message.systemNotice as SystemNoticeKind;
    const text = systemNoticeDisplayText(kind, lastUser > lastReply && keep > lastUser);
    if (message.text === text) { result.push(message); return; }
    changed = true; result.push({ ...message, text });
  });
  return changed ? result : messages;
}
