/** Mailbox helpers shared by Inbox and Settings come from @elizaos/plugin-inbox/mailbox. No provider content is stored here. */
export {
  attachmentReadFailure,
  classifyGmailFailure,
  disconnectGmailAccount,
  disconnectMessage,
  type GmailDisconnectOutcome,
  type GmailFailure,
  type GmailFailureKind,
} from '../../../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/failures.ts';
export { gmailReadable } from '../../../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/grants.ts';
export { MailReadStateGuard, mailReadStateMessage, setGmailReadState } from '../../../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/read-state.ts';

/** Fired after a Gmail account is disconnected anywhere in the app so other surfaces re-check. */
export const GMAIL_ACCOUNTS_CHANGED = 'alpha:gmail-accounts-changed';

//@ skip
const measured = new WeakMap<object, number>();
/** UTF-8 size of a cached value as JSON, measured once per object. Cached values are replaced, never
 * edited in place, so the first measurement stays true. */
export function cachedJsonBytes(value: object): number {
  let bytes = measured.get(value);
  if (bytes === undefined) { bytes = new TextEncoder().encode(JSON.stringify(value)).length; measured.set(value, bytes); }
  return bytes;
}
/** The newest rows whose bodies fit `maximumBytes` together, in their original (oldest first) order. */
export function newestMailBodies<T extends { body: object }>(rows: readonly T[], maximumBytes: number): T[] {
  return rows.slice(newestWithinBudget(rows, maximumBytes, row => cachedJsonBytes(row.body)));
}
/** The index where the newest rows that fit `maximum` together start: rows are added newest first
 * until the next one would pass the budget. Each row is measured at most once, newest first. */
export function newestWithinBudget<T>(rows: readonly T[], maximum: number, size: (row: T) => number): number {
  //@ verify
  //@ ensures 0 <= \result && \result <= rows.length
  //@ ensures maximum >= 0 ==> sizeFrom(rows, \result, size) <= maximum
  //@ ensures \result === 0 || sizeFrom(rows, \result - 1, size) > maximum || maximum < 0
  //@ ensures \result === 0 || maximum < 0 || size(rows[\result - 1]) + sizeFrom(rows, \result, size) > maximum
  let total = 0, from = rows.length;
  while (from > 0) {
    //@ invariant 0 <= from && from <= rows.length
    //@ invariant total === sizeFrom(rows, from, size)
    //@ invariant maximum >= 0 ==> total <= maximum
    //@ decreases from
    const next = total + size(rows[from - 1]);
    if (next > maximum) break;
    total = next;
    from--;
  }
  return from;
}
/** Total size of `rows` from index `from` on: the quantity newestWithinBudget budgets.
 * Proof vocabulary; the app does not call it. */
export function sizeFrom<T>(rows: readonly T[], from: number, size: (row: T) => number): number {
  //@ verify
  //@ requires 0 <= from && from <= rows.length
  //@ decreases rows.length - from
  if (from === rows.length) return 0;
  return size(rows[from]) + sizeFrom(rows, from + 1, size);
}
