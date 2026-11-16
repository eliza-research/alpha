/**
 * The on-phone confirmation of an agent-proposed call, text or contact change (telephony-executor.ts).
 * It shows exactly what will happen: the contact's name and the number that will be called or
 * texted, or a contact's fields before and after. One tap on a row chooses it; "Not now", leaving
 * the app or a cancelled request chooses nothing. The rows render inside the chat card whose
 * approval is running (AP-16 D8: the proposal card is the one approval surface, never a modal).
 */
import type {ContactDraft, ContactRecord, TelephonyReview} from '../runtime/telephony-executor';
import {displayNumber, initials} from './telephony-presenters';

type Pending = {review: TelephonyReview; settle: (choice: number | null) => void};
let pending: Pending | null = null, repaint: () => void = () => {};
const ICON = {
  call: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z',
  message: 'M12 19V5M6 11l6-6 6 6', dismiss: 'M6 6l12 12M18 6L6 18', save: 'M5 12l5 5 9-10', delete: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
};
/** Shows the review and resolves with the chosen option's index, or null when nothing was chosen. */
export function askTelephonyReview(review: TelephonyReview, signal: AbortSignal): Promise<number | null> {
  return new Promise(resolve => {
    pending?.settle(null);
    if (signal.aborted || (typeof document !== 'undefined' && document.hidden) || !review.options.length) { resolve(null); return; }
    const abort = () => entry.settle(null);
    const entry: Pending = {review, settle: choice => { if (pending !== entry) return; pending = null; signal.removeEventListener('abort', abort); repaint(); resolve(choice); }};
    pending = entry; signal.addEventListener('abort', abort, {once: true}); repaint();
  });
}
/** A contact's fields as lines; a line the change removes is struck, a line it adds is strong. */
export function contactChangeLines(before: ContactRecord, after: ContactDraft): {text: string; struck: boolean; added: boolean}[] {
  const was = [...before.phoneNumbers.map(row => displayNumber(row.number)), ...before.emailAddresses.map(row => row.address)];
  const will = [...after.phoneNumbers.map(row => displayNumber(row.number)), ...after.emailAddresses.map(row => row.address)];
  return [...was.filter(text => !will.includes(text)).map(text => ({text, struck: true, added: false})),
    ...will.map(text => ({text, struck: false, added: !was.includes(text)}))];
}
/** Template values of the sheet for the review that is open, or `{open: false}`. */
export function presentTelephonyReview(entry: Pending | null) {
  if (!entry) return {open: false, rows: [] as never[], dismiss: () => {}};
  const {review, settle} = entry;
  const style = (lines: {text: string; struck: boolean; added: boolean}[]) => lines.map(line => ({text: line.text, decoration: line.struck ? 'line-through' : 'none', color: line.struck ? 'var(--mut)' : 'var(--fg)', weight: line.added ? 600 : 400}));
  const plain = (text: string) => [{text, struck: false, added: false}];
  const rows = review.options.map((option, index) => {
    const choose = () => settle(index);
    if (review.kind === 'call' || review.kind === 'message') { const match = option as {name: string; number: string};
      return {ini: initials(match.name), name: match.name, lines: style(plain(displayNumber(match.number))), choose, icon: ICON[review.kind],
        bg: review.kind === 'call' ? 'var(--alpha-call-green)' : 'var(--acc)', label: `${review.kind === 'call' ? 'Call' : 'Message'} ${match.name} ${displayNumber(match.number)}`}; }
    if (review.kind === 'contact-save') { const change = option as {before: ContactRecord; after: ContactDraft}, renamed = change.after.displayName !== change.before.displayName;
      return {ini: initials(change.after.displayName || change.before.displayName), name: change.after.displayName || change.before.displayName,
        lines: style([...(renamed ? [{text: change.before.displayName, struck: true, added: false}] : []), ...contactChangeLines(change.before, change.after)]), choose, icon: ICON.save, bg: 'var(--acc)',
        label: `Save changes to ${change.before.displayName}`}; }
    const contact = option as ContactRecord;
    return {ini: initials(contact.displayName), name: contact.displayName, lines: style([...contact.phoneNumbers.map(row => displayNumber(row.number)), ...contact.emailAddresses.map(row => row.address)].slice(0, 2).flatMap(plain)),
      choose, icon: ICON.delete, bg: 'var(--alpha-call-red)', label: `Delete ${contact.displayName}`};
  });
  return {open: true, rows, body: review.kind === 'message' ? review.body : '', hasBody: review.kind === 'message', dismiss: () => settle(null)};
}
type Review = ReturnType<typeof presentTelephonyReview>;
type Row = {id?: unknown; c?: {proposalId?: unknown} & Record<string, unknown>; cProposal?: boolean; cDigest?: boolean; [key: string]: unknown};
/**
 * Puts an open review into the chat card being approved (`approving` is its proposal id), or, when
 * that card is not in the transcript window, into the newest card that carries a proposal. A
 * proposal card shows the rows instead of its button; an action digest shows them as its rows.
 * Null when no card can show it: the caller then dismisses the review, so nothing is chosen unseen.
 */
export function placeTelephonyReview(msgs: Row[], review: Review, approving: unknown): Row[] | null {
  if (!review.open) return msgs;
  const carries = (m: Row) => !!m.c && typeof m.c.proposalId === 'string' && !!(m.cProposal || m.cDigest);
  let at = msgs.findIndex(m => carries(m) && m.c!.proposalId === approving);
  if (at < 0) at = msgs.map(carries).lastIndexOf(true);
  if (at < 0) return null;
  return msgs.map((m, index) => {
    if (index !== at) return m;
    if (m.cProposal) return {...m, c: {...m.c, reviewing: review}, proposalAsk: false};
    return {...m, rows: [...review.rows.map(row => ({ini: row.ini, who: row.name, text: row.lines.map(line => line.text).join(' · '), icon: row.icon, open: row.choose, label: row.label})),
      {ini: '', who: 'Not now', text: 'Nothing is called, sent or changed.', icon: ICON.dismiss, open: review.dismiss}]};
  });
}
/** Adds `telephonyReview` to the shell's template values, shows it in its chat card, and dismisses it when the app is hidden. */
export function installTelephonyReview(Component: any) {
  const p = Component.prototype, render = p.renderVals, mount = p.componentDidMount, unmount = p.componentWillUnmount;
  p.renderVals = function () {
    const out = render.call(this), telephonyReview = presentTelephonyReview(pending);
    if (!telephonyReview.open) return {...out, telephonyReview};
    const msgs = placeTelephonyReview(out.msgs || [], telephonyReview, this.pendingActionApprovalProposalId);
    if (!msgs) { const entry = pending; queueMicrotask(() => { if (pending === entry) entry?.settle(null); }); return {...out, telephonyReview: presentTelephonyReview(null)}; }
    return {...out, msgs, telephonyReview};
  };
  p.componentDidMount = function () {
    mount?.call(this);
    repaint = () => this.setState({telephonyReviewRevision: Date.now()});
    this.telephonyReviewHide = () => { if (document.hidden) pending?.settle(null); };
    document.addEventListener('visibilitychange', this.telephonyReviewHide);
  };
  p.componentWillUnmount = function () {
    document.removeEventListener('visibilitychange', this.telephonyReviewHide); pending?.settle(null); repaint = () => {};
    unmount?.call(this);
  };
}
