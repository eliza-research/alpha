/**
 * Presentation of Phone, Messages and Contacts rows on the Alpha image. Pure: it formats what the
 * shared telephony profile already read and reads nothing itself. Names come from the address book
 * the owner granted; a number with no contact is shown as the number.
 */
import {formatMonthDay, formatTime, weekdayName} from './locale-time.ts';

const MINUTE = 60_000, DAY = 86_400_000;
/** "now", "5m", "9:41", "Mon", "Oct 3": the shortest label that still places the time. */
export function shortWhen(at: number, now: number): string {
  if (!Number.isFinite(at)) return '';
  const age = now - at, date = new Date(at), today = new Date(now);
  if (age >= 0 && age < MINUTE) return 'now';
  if (age >= 0 && age < 60 * MINUTE) return `${Math.floor(age / MINUTE)}m`;
  if (date.toDateString() === today.toDateString()) return formatTime(date);
  if (age >= 0 && age < 6 * DAY) return weekdayName(date, 'short');
  return formatMonthDay(date, date.getFullYear() !== today.getFullYear());
}
/** "0:24" for a call or voicemail length. */
export function clockLength(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
/** Up to two initials; "#" for a bare number or an empty name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(word => /^\p{L}/u.test(word));
  return words.length ? (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase() : '#';
}
/** Compare the full number, treating the NANP country code and local form as equivalent. */
export function numberKey(number: string): string {
  const normalized = number.trim().replace(/[\s().-]/g, '');
  if (!/^\+?\d{2,20}$/.test(normalized)) return '';
  return /^\+?1[2-9]\d{9}$/.test(normalized) ? normalized.replace(/^\+?1/, '') : normalized;
}
/** "(415) 555-0132" for ten or eleven (leading 1) digits; anything else unchanged. */
export function displayNumber(number: string): string {
  const digits = number.replace(/\D/g, ''), local = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
  return local.length === 10 && !/^\+(?!1)/.test(number.trim()) ? `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}` : number;
}
export type Names = ReadonlyMap<string, string>;
export const nameOf = (number: string, names: Names) => names.get(numberKey(number)) || displayNumber(number);
/** One line naming everyone in a thread. */
export function threadTitle(addresses: readonly string[], names: Names): string {
  return addresses.length ? addresses.map(address => nameOf(address, names)).join(', ') : 'Unknown';
}

export type CallKind = 'in' | 'out' | 'missed';
/** How a call-log type is drawn: an arrow direction, and red for a call the owner did not take. */
export function callKind(type: string): CallKind {
  return type === 'outgoing' ? 'out' : type === 'missed' || type === 'rejected' || type === 'blocked' ? 'missed' : 'in';
}
const CALL_WORD: Record<CallKind, string> = {in: 'incoming', out: 'outgoing', missed: 'missed'};
export function callRow(call: {id: string; number: string; cachedName: string | null; date: number; type: string; isNew: boolean}, names: Names, now: number) {
  const kind = callKind(call.type), name = call.number ? names.get(numberKey(call.number)) || call.cachedName || displayNumber(call.number) : 'Unknown';
  return {id: call.id, name, ini: initials(name), kind, missed: kind === 'missed', out: kind === 'out', when: shortWhen(call.date, now), number: call.number,
    canCall: !!call.number, label: `${call.number ? 'Call ' : ''}${name}, ${CALL_WORD[kind]} ${shortWhen(call.date, now)}`};
}

export type AttentionRow = {title: string; detail: string};
export type AttentionCard = {count: string; rows: AttentionRow[]; status: string; label: string};
const CARD_ROWS = 2;
/** The Home Messages card: unread threads, newest first. Null when there is nothing unread. */
export function messagesCard(threads: readonly {date: number; snippet: string; unread: boolean; addresses: readonly string[]}[], names: Names, now: number): AttentionCard | null {
  const unread = threads.filter(thread => thread.unread).sort((a, b) => b.date - a.date);
  if (!unread.length) return null;
  return {count: String(unread.length), status: shortWhen(unread[0].date, now), label: `Open Messages, ${unread.length} unread`,
    rows: unread.slice(0, CARD_ROWS).map(thread => ({title: threadTitle(thread.addresses, names), detail: thread.snippet}))};
}
/**
 * The Home Phone card: new missed calls grouped by caller, then new voicemail, newest first. Null
 * when there is neither.
 */
export function phoneCard(calls: readonly {number: string; cachedName: string | null; date: number; type: string; isNew: boolean}[],
  voicemail: readonly {number: string; cachedName: string | null; date: number; durationSeconds: number; isNew: boolean}[], names: Names, now: number): AttentionCard | null {
  const missed = calls.filter(call => call.isNew && call.type === 'missed'), fresh = voicemail.filter(item => item.isNew);
  if (!missed.length && !fresh.length) return null;
  const who = (item: {number: string; cachedName: string | null}) => item.number ? names.get(numberKey(item.number)) || item.cachedName || displayNumber(item.number) : 'Unknown';
  const groups = new Map<string, {title: string; count: number; date: number}>();
  for (const call of missed) {
    const key = numberKey(call.number) || `unknown:${call.date}`, group = groups.get(key);
    if (group) { group.count++; group.date = Math.max(group.date, call.date); } else groups.set(key, {title: who(call), count: 1, date: call.date});
  }
  const rows = [
    ...[...groups.values()].map(group => ({date: group.date, title: group.title, detail: group.count > 1 ? `Missed · ${group.count}` : 'Missed'})),
    ...fresh.map(item => ({date: item.date, title: who(item), detail: `Voicemail · ${clockLength(item.durationSeconds)}`})),
  ].sort((a, b) => b.date - a.date);
  const parts = [missed.length ? `${missed.length} missed ${missed.length === 1 ? 'call' : 'calls'}` : '', fresh.length ? `${fresh.length} voicemail` : ''].filter(Boolean);
  return {count: String(missed.length + fresh.length), status: shortWhen(rows[0].date, now), label: `Open Phone, ${parts.join(', ')}`,
    rows: rows.slice(0, CARD_ROWS).map(({title, detail}) => ({title, detail}))};
}
/** Where the Phone card leads: Recents while a missed call is new, otherwise Voicemail. */
export function phoneCardTarget(missed: number): 'recents' | 'voicemail' {
  return missed > 0 ? 'recents' : 'voicemail';
}

type Thread = {id: string; date: number; snippet: string; unread: boolean; addresses: string[]};
type Call = {number: string; cachedName: string | null; date: number; type: string; isNew: boolean};
type Voicemail = {number: string; cachedName: string | null; date: number; durationSeconds: number; isNew: boolean};
/** What Home's cards are drawn from. A source that was not read is null, which is never "nothing new". */
export type TelephonyAttention = {threads: Thread[] | null; calls: Call[] | null; voicemail: Voicemail[] | null; names: Map<string, string>};
export const emptyTelephonyAttention = (): TelephonyAttention => ({threads: null, calls: null, voicemail: null, names: new Map()});

/** The two cards and where each leads, from one read. */
export function presentTelephonyAttention(read: TelephonyAttention, now: number): {
  messages: AttentionCard | null; messagesThread: string | null; phone: AttentionCard | null; phoneTab: 'recents' | 'voicemail';
} {
  const unread = (read.threads || []).filter(thread => thread.unread);
  const missed = (read.calls || []).filter(call => call.isNew && call.type === 'missed').length;
  return {
    messages: read.threads ? messagesCard(read.threads, read.names, now) : null,
    // One unread thread opens that thread; several open the list.
    messagesThread: unread.length === 1 ? unread[0].id : null,
    // Calls and voicemail are separate sources: either one alone can show the card.
    phone: read.calls || read.voicemail ? phoneCard(read.calls || [], read.voicemail || [], read.names, now) : null,
    phoneTab: phoneCardTarget(missed),
  };
}
