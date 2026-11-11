/**
 * Settings → General → Phone, on the verified Alpha image only: the SIM, carrier, own number and
 * network of each line, and which apps hold the phone and SMS roles. Everything comes from one
 * bounded foreground read (`phoneInfo`, shared telephony profile) kept in memory while the page is
 * open; nothing is stored, logged or given to the agent.
 *
 * The image's launcher is deliberately nonprivileged, so Android does not let it read the IMEI or SIM
 * serial. Those rows appear only if the read returns them; otherwise the page links to Android's own
 * device status screen, which shows them.
 */
import type {PhoneInfo, PhoneLine, TelephonyStatus} from '../../../../.eliza/client-features/packages/contracts/src/native-telephony.ts';
import {displayNumber} from './telephony-presenters.ts';

export type PhoneInfoRow = {label: string; value: string};
export type PhoneInfoSection = {caption: string; rows: PhoneInfoRow[]};
const NETWORK: Record<PhoneLine['networkType'], string> = {none: 'No service', '2g': '2G', '3g': '3G', '4g': '4G', '5g': '5G', 'wifi-calling': 'Wi-Fi calling', unknown: 'Unknown'};
const SIGNAL = ['None', 'Poor', 'Fair', 'Good', 'Excellent'];
const app = (value: string | null, held: boolean) => held ? 'Alpha' : value || 'None';

/** One section per line; a caption only when there is more than one SIM to tell apart. */
export function phoneLineSections(info: PhoneInfo): PhoneInfoSection[] {
  return info.lines.map(line => {
    const rows: PhoneInfoRow[] = [];
    const carrier = line.carrierName || line.displayName;
    if (carrier) rows.push({label: 'Carrier', value: carrier});
    if (line.displayName && line.displayName !== carrier) rows.push({label: 'SIM name', value: line.displayName});
    if (line.number) rows.push({label: 'Number', value: displayNumber(line.number)});
    rows.push({label: 'Network', value: `${NETWORK[line.networkType]}${line.roaming ? ' · Roaming' : ''}`});
    if (line.signalLevel !== null && line.networkType !== 'none') rows.push({label: 'Signal', value: SIGNAL[line.signalLevel]});
    rows.push({label: 'SIM', value: line.embedded ? 'eSIM' : `Slot ${line.slot + 1}`});
    if (line.imei) rows.push({label: 'IMEI', value: line.imei});
    if (line.iccid) rows.push({label: 'SIM serial', value: line.iccid});
    return {caption: info.lines.length > 1 ? `SIM ${line.slot + 1}` : '', rows};
  });
}
/** Which apps Android uses for calls and texts, and whether the carrier's voicemail is set up. */
export function phoneDefaultRows(status: TelephonyStatus, voicemail: 'ready' | 'unconfigured' | 'unsupported' | null): PhoneInfoRow[] {
  const rows = [
    {label: 'Phone app', value: app(status.defaultDialer, status.roles.dialer.held)},
    {label: 'Messages app', value: app(status.defaultSms, status.roles.sms.held)},
  ];
  if (voicemail) rows.push({label: 'Voicemail', value: voicemail === 'ready' ? 'On' : voicemail === 'unconfigured' ? 'Not set up' : 'Not available'});
  return rows;
}
/** True when the read returned no device identifiers, so Android's own status screen is the place to see them. */
export const identifiersElsewhere = (info: PhoneInfo) => !info.lines.some(line => line.imei);

export type PhoneInfoClient = {
  status(): Promise<TelephonyStatus>;
  phoneInfo(): Promise<PhoneInfo>;
  voicemailStatus(): Promise<{access: boolean; state: 'ready' | 'unconfigured' | 'unsupported' | null}>;
  requestAccess(access: 'phoneState'): Promise<TelephonyStatus>;
};
export type PhoneInfoState =
  | {phase: 'idle' | 'loading' | 'failed'}
  | {phase: 'ready'; info: PhoneInfo; status: TelephonyStatus; voicemail: 'ready' | 'unconfigured' | 'unsupported' | null};
/**
 * Reads while the page is open and forgets when it closes. A reply that arrives after the page
 * closed, or after a newer read began, is dropped.
 */
export function createPhoneInfoLoader(client: PhoneInfoClient, onChange: () => void) {
  let state: PhoneInfoState = {phase: 'idle'}, epoch = 0, open = false;
  async function load(request = false) {
    const token = ++epoch;
    state = {phase: 'loading'}; onChange();
    try {
      const status = request ? await client.requestAccess('phoneState') : await client.status();
      if (token !== epoch || !open) return;
      const info = await client.phoneInfo();
      if (token !== epoch || !open) return;
      // Voicemail is optional: a phone that cannot answer simply shows no voicemail row.
      const voicemail = await client.voicemailStatus().then(value => value.state, () => null);
      if (token !== epoch || !open) return;
      state = {phase: 'ready', info, status, voicemail};
    } catch { if (token !== epoch || !open) return; state = {phase: 'failed'}; }
    onChange();
  }
  return {
    get state() { return state; },
    /** Called on every render with whether the page is the one in front. */
    sync(next: boolean) {
      if (next === open) return;
      open = next; epoch++;
      if (next) void load(); else state = {phase: 'idle'};
    },
    refresh: () => { if (open) void load(); },
    allow: () => { if (open) void load(true); },
  };
}
