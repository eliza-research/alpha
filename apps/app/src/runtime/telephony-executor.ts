/**
 * Runs one agent-proposed telephony action on the verified Alpha image after the owner approved it
 * (shared contract: `@elizaos/contracts/telephony-actions`; models: PhoneCalls.qnt and
 * ContactsBook.qnt; MessageThreads.qnt for a draft placed in the open conversation). The agent names a contact by search text and never receives the address book:
 * the lookup happens here, the owner sees the exact name and number (or the before and after) on the
 * phone, and only then does anything call, send or write. Each path returns exactly what was
 * observed; nothing is retried, and a contact that changed since it was shown is `stale`.
 *
 * Everything the phone does goes through `ports`, so the decisions here are testable without one.
 */
import {
  smsComposeReceiptOutcome, telephonyActionReceiptOutcome, telephonyActionResultText,
  type ContactWriteOperation, type ContactWriteResult, type PhoneCallOperation, type PhoneCallResult, type SmsComposeOperation,
  type SmsComposeResult, type TelephonyActionOperation, type TelephonyActionResult,
} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/telephony-actions-contract.ts';
import {contactLookupMatches} from '../../../../.eliza/client-features/packages/contracts/src/phone-dial.ts';

export type ContactMatch = {id: string; name: string; number: string};
export type ContactRecord = {id: string; version: string; displayName: string; phoneNumbers: {number: string; type: string}[]; emailAddresses: {address: string; type: string}[]};
export type ContactDraft = Omit<ContactRecord, 'id' | 'version'>;
/** What the owner is shown on the phone before a telephony action takes effect. */
export type TelephonyReview =
  | {kind: 'call'; options: ContactMatch[]}
  | {kind: 'message'; options: ContactMatch[]; body: string}
  | {kind: 'contact-save'; options: {before: ContactRecord; after: ContactDraft}[]}
  | {kind: 'contact-delete'; options: ContactRecord[]};
export type TelephonyPorts = {
  /** Throws when the review is no longer current (hidden, locked, context or session changed). */
  current(): void;
  /** Shows the review and resolves with the chosen option's index, or null when dismissed. */
  ask(review: TelephonyReview, signal: AbortSignal): Promise<number | null>;
  normalize(number: string): string | null;
  searchContacts(query: string, limit: number): Promise<{id: string; displayName: string; phoneNumbers: string[]}[]>;
  placeCall(number: string): Promise<{status: 'placed' | 'emergency-handoff' | 'busy' | 'unavailable' | 'failed'}>;
  getContact(id: string): Promise<ContactRecord>;
  saveContact(draft: ContactDraft, target?: {id: string; version: string}): Promise<{status: 'saved' | 'stale' | 'not-found' | 'failed' | 'unknown'}>;
  removeContact(id: string, version: string): Promise<{status: 'deleted' | 'stale' | 'not-found' | 'failed' | 'unknown'}>;
  /** The native reviewed send of one SMS under `operationId`; a repeated id never sends twice. */
  sendSms(number: string, body: string, operationId: string, signal: AbortSignal): Promise<SmsComposeResult['status']>;
  /**
   * Puts a draft in the text field of the conversation the owner has open (only the one with exactly
   * `number`, when given). Nothing is sent: Send there stays the owner's tap.
   */
  draftInOpenThread(body: string, number?: string): 'drafted' | 'none-selected' | 'occupied' | 'unavailable';
  openThread(): {participant: string | null; messages: {direction: 'in' | 'out'; date: number; body: string}[]; truncated: boolean} | null;
  openVoicemail(): {caller: string | null; date: number; durationSeconds: number; transcriptState: 'ready' | 'pending' | 'unavailable' | 'failed'; engine: 'device' | 'cloud' | 'carrier' | null; transcript: string | null} | null;
  deleteOpenVoicemail(current: () => void, signal: AbortSignal): Promise<'deleted' | 'none-selected' | 'cancelled' | 'failed'>;
};
export type TelephonyExecution = {status: 'succeeded' | 'failed' | 'unknown'; summary: string; telephonyResult: TelephonyActionResult};

const LOOKUP_LIMIT = 10;
const finish = (result: TelephonyActionResult): TelephonyExecution => {
  const outcome = result.kind === 'sms-compose' ? smsComposeReceiptOutcome(result) : telephonyActionReceiptOutcome(result);
  return {status: outcome === 'applied' ? 'succeeded' : outcome === 'unknown' ? 'unknown' : 'failed', summary: telephonyActionResultText(result), telephonyResult: result};
};
/** Every dialable number of every matching contact, one option per number. */
async function numbers(query: string, ports: TelephonyPorts): Promise<ContactMatch[]> {
  const rows = await ports.searchContacts(query, LOOKUP_LIMIT);
  return contactLookupMatches(rows, value => ports.normalize(value)).flatMap(match => match.phoneNumbers.map(number => ({id: match.id, name: match.displayName, number})));
}

async function call(operation: PhoneCallOperation, ports: TelephonyPorts, signal: AbortSignal): Promise<PhoneCallResult> {
  const contact = operation.target.kind === 'contact';
  let number: string;
  if (operation.target.kind === 'number') number = operation.target.number;
  else {
    let options: ContactMatch[];
    try { options = await numbers(operation.target.query, ports); } catch { return {kind: 'phone-call', status: 'unavailable', contact: false}; }
    ports.current();
    if (!options.length) return {kind: 'phone-call', status: 'not-found', contact: false};
    // A name is never called unseen: the owner confirms or chooses the exact number, even for one match.
    const choice = await ports.ask({kind: 'call', options}, signal);
    if (choice === null || !options[choice]) return {kind: 'phone-call', status: 'cancelled', contact: false};
    number = options[choice].number;
  }
  ports.current();
  // A lost native reply may follow an accepted call; the coordinator keeps that outcome unknown.
  return {kind: 'phone-call', status: (await ports.placeCall(number)).status, contact};
}

async function compose(operation: SmsComposeOperation, operationId: string, ports: TelephonyPorts, signal: AbortSignal): Promise<SmsComposeResult> {
  let options: ContactMatch[];
  try { options = await numbers(operation.query, ports); } catch { return {kind: 'sms-compose', status: 'unavailable'}; }
  ports.current();
  if (!options.length) return {kind: 'sms-compose', status: 'not-found'};
  // One number goes straight to the native review, which shows it with the text; several are chosen first.
  let choice: number | null = 0;
  if (options.length > 1) choice = await ports.ask({kind: 'message', options, body: operation.body}, signal);
  if (choice === null || !options[choice]) return {kind: 'sms-compose', status: 'cancelled'};
  ports.current();
  // When that person's conversation is already open, the draft goes into its text field, where the
  // owner can edit it; the separate review is for a conversation that is not on screen.
  if (ports.draftInOpenThread(operation.body, options[choice].number) === 'drafted') return {kind: 'sms-compose', status: 'drafted'};
  // After the native review opens, a lost answer is unknown: the radio may have taken the message.
  try { return {kind: 'sms-compose', status: await ports.sendSms(options[choice].number, operation.body, operationId, signal)}; }
  catch (error) { return {kind: 'sms-compose', status: (error as {code?: string})?.code === 'not-sent' ? 'failed' : 'unknown'}; }
}

/** `set` replaces a named field whole; a number or address already on the contact keeps its type. */
export function appliedContactChange(before: ContactRecord, set: Extract<ContactWriteOperation, {type: 'contact_update'}>['set'], normalize: (number: string) => string | null): ContactDraft {
  const key = (number: string) => normalize(number) || number;
  return {
    displayName: set.displayName ?? before.displayName,
    phoneNumbers: set.phoneNumbers ? set.phoneNumbers.map(number => ({number, type: before.phoneNumbers.find(row => key(row.number) === key(number))?.type || 'mobile'})) : before.phoneNumbers,
    emailAddresses: set.emailAddresses ? set.emailAddresses.map(address => ({address, type: before.emailAddresses.find(row => row.address.toLowerCase() === address.toLowerCase())?.type || 'home'})) : before.emailAddresses,
  };
}
async function records(query: string, ports: TelephonyPorts): Promise<ContactRecord[]> {
  const rows = await ports.searchContacts(query, LOOKUP_LIMIT), found: ContactRecord[] = [];
  // A contact the editor cannot read completely is not offered for an agent change.
  for (const row of rows) { try { found.push(await ports.getContact(row.id)); } catch { /* skipped */ } }
  return found;
}
async function write(operation: ContactWriteOperation, ports: TelephonyPorts, signal: AbortSignal): Promise<ContactWriteResult> {
  const result = (status: ContactWriteResult['status']): ContactWriteResult => ({kind: 'contact-write', status});
  let dispatched=false;
  try {
    if (operation.type === 'contact_create') {
      // The approval the owner already gave showed every field of the new contact.
      dispatched=true;
      const saved = await ports.saveContact({displayName: operation.contact.displayName,
        phoneNumbers: operation.contact.phoneNumbers.map(number => ({number, type: 'mobile'})), emailAddresses: operation.contact.emailAddresses.map(address => ({address, type: 'home'}))});
      return result(saved.status === 'saved' ? 'saved' : saved.status === 'unknown' ? 'unknown' : 'failed');
    }
    const found = await records(operation.query, ports);
    ports.current();
    if (!found.length) return result('not-found');
    if (operation.type === 'contact_update') {
      const options = found.map(before => ({before, after: appliedContactChange(before, operation.set, ports.normalize)}));
      const choice = await ports.ask({kind: 'contact-save', options}, signal);
      if (choice === null || !options[choice]) return result('cancelled');
      ports.current();
      // The write names the version the owner was shown; a contact that changed since is stale.
      dispatched=true;
      return result((await ports.saveContact(options[choice].after, {id: options[choice].before.id, version: options[choice].before.version})).status);
    }
    const choice = await ports.ask({kind: 'contact-delete', options: found}, signal);
    if (choice === null || !found[choice]) return result('cancelled');
    ports.current();
    dispatched=true;
    return result((await ports.removeContact(found[choice].id, found[choice].version)).status);
  } catch (error) {
    if (signal.aborted) throw error;
    return result(dispatched?'unknown':'unavailable');
  }
}

export async function executeTelephonyAction(operation: TelephonyActionOperation, operationId: string, ports: TelephonyPorts, signal: AbortSignal): Promise<TelephonyExecution> {
  signal.throwIfAborted(); ports.current();
  switch (operation.type) {
    case 'phone_call': return finish(await call(operation, ports, signal));
    case 'sms_compose': return finish(await compose(operation, operationId, ports, signal));
    case 'sms_reply_selected': return finish({kind: 'sms-reply', status: ports.draftInOpenThread(operation.body)});
    case 'contact_create': case 'contact_update': case 'contact_delete': return finish(await write(operation, ports, signal));
    case 'messages_read_selected': {
      const thread = ports.openThread();
      return finish(thread ? {kind: 'messages-read', status: 'read', ...thread} : {kind: 'messages-read', status: 'none-selected'});
    }
    case 'voicemail_read_selected': {
      const voicemail = ports.openVoicemail();
      return finish(voicemail ? {kind: 'voicemail-read', status: 'read', ...voicemail} : {kind: 'voicemail-read', status: 'none-selected'});
    }
    case 'voicemail_delete_selected': return finish({kind: 'voicemail-delete', status: await ports.deleteOpenVoicemail(() => ports.current(), signal)});
  }
}
