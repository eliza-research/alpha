/**
 * Upstream escalation notices in Alpha's chat.
 *
 * The agent's escalation service posts a system notice into client chat when the same error
 * repeats (`packages/agent/src/runtime/error-escalation.ts`), and re-posts it on every agent start
 * and retry, each as a new stored message (`client-chat-sender.ts`). Conversation history returns
 * those rows as ordinary assistant text, so the text equal to pinned `systemNoticeText()`
 * (`packages/core/src/types/system-notice.ts`) is the only marker a runtime-error row carries.
 *
 * A notice is shown at most once, as the latest one, and only while it can still be true:
 * - any later ordinary agent reply proves chat works, so earlier notices are dropped;
 * - a runtime-error notice (a background service failing, such as Notes at start) is shown only
 *   while the owner's latest message is unanswered, in Alpha's own words. The upstream copy is
 *   aimed at a host operator ("Check the connected host's diagnostics").
 */
export type SystemNoticeKind = 'model-unavailable' | 'runtime-error' | 'model-and-runtime-error';

/** Byte-equal to pinned upstream `systemNoticeText()` (test/system-notice-collapse.test.mjs). */
export const UPSTREAM_MODEL_UNAVAILABLE_NOTICE = 'Eliza cannot respond yet. Configure a model provider on the connected host in Settings.';
export const UPSTREAM_RUNTIME_ERROR_NOTICE = 'Eliza needs attention. Check the connected host\'s diagnostics before trying again.';
const UPSTREAM_COMBINED_NOTICE = `${UPSTREAM_MODEL_UNAVAILABLE_NOTICE}\n---\n${UPSTREAM_RUNTIME_ERROR_NOTICE}`;

/** Shown instead of the upstream runtime-error text, only while the owner's last message is unanswered. */
export const RUNTIME_ERROR_NOTICE = 'Part of your agent stopped working, so this reply may not arrive. Nothing was resent. Send your message again in a moment.';

/** The upstream notice a stored assistant text is, if any. */
export function systemNoticeKind(text: unknown): SystemNoticeKind | undefined {
  if (typeof text !== 'string') return undefined;
  const value = text.trim();
  return value === UPSTREAM_MODEL_UNAVAILABLE_NOTICE ? 'model-unavailable'
    : value === UPSTREAM_RUNTIME_ERROR_NOTICE ? 'runtime-error'
    : value === UPSTREAM_COMBINED_NOTICE ? 'model-and-runtime-error'
    : undefined;
}

type ChatRow = { from?: unknown; text?: unknown; systemNotice?: unknown; interrupted?: unknown };

/** An agent row that proves the chat answered: not a notice and not a failed or empty reply. */
function ordinaryReply(message: ChatRow): boolean {
  return message.from === 'agent' && !message.systemNotice && message.interrupted !== true && typeof message.text === 'string' && message.text.trim() !== '';
}

/**
 * Collapse upstream notices: keep at most the latest one, drop it once an ordinary reply follows,
 * and drop a runtime-error notice unless the owner's latest message is still unanswered. Returns
 * the same array when nothing changes, so callers can skip a render.
 */
export function collapseSystemNotices<T extends ChatRow>(messages: T[]): T[] {
  let latest = -1, lastReply = -1, lastUser = -1;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.systemNotice) latest = index;
    else if (ordinaryReply(message)) lastReply = index;
    else if (message.from === 'user') lastUser = index;
  }
  let keep = latest > lastReply ? latest : -1;
  if (keep >= 0 && messages[keep].systemNotice === 'runtime-error' && !(lastUser > lastReply)) keep = -1;
  let changed = false;
  const result = messages.filter((message, index) => {
    const retained = !message.systemNotice || index === keep;
    if (!retained) changed = true;
    return retained;
  });
  return changed ? result : messages;
}

/** The owner-facing text of a stored notice row. Model-unavailable keeps its upstream recovery step. */
export function systemNoticeDisplayText(kind: SystemNoticeKind): string {
  return kind === 'runtime-error' ? RUNTIME_ERROR_NOTICE : UPSTREAM_MODEL_UNAVAILABLE_NOTICE;
}
