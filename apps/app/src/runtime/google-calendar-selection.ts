import type { CloudEnvironment } from './cloud-protocol.ts';

export interface GoogleCalendarAccountKey { environment: CloudEnvironment; userId: string; organizationId: string }
export interface GoogleCalendarSelection { connectionId: string; sourceId: string; providerCalendarId: string; name: string; account: string }
export type GoogleCalendarSelectionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/** Fired when Google Calendar display preferences (or the legacy linked-sync choice) change. */
export const GOOGLE_CALENDAR_SELECTION_CHANGED = 'alpha:google-calendar-selection-changed';
export const GOOGLE_CALENDAR_PREFS_CHANGED = GOOGLE_CALENDAR_SELECTION_CHANGED;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (value: unknown, limit: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value);
function ownerKey(owner: GoogleCalendarAccountKey): string | null {
  if (!owner || !['production', 'staging'].includes(owner.environment) || !uuid.test(owner.userId) || !uuid.test(owner.organizationId)) return null;
  return JSON.stringify([owner.environment, owner.userId, owner.organizationId]);
}
function slot(owner: GoogleCalendarAccountKey): string | null {
  const key = ownerKey(owner);
  return key === null ? null : `alpha.google-calendar-selection.v1:${key}`;
}
function storageOrDefault(storage?: GoogleCalendarSelectionStorage): GoogleCalendarSelectionStorage | null {
  if (storage) return storage;
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
function selection(value: unknown): GoogleCalendarSelection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.connectionId !== 'string' || !uuid.test(row.connectionId)
    || !clean(row.providerCalendarId, 1024) || !clean(row.sourceId, 8192)
    || !clean(row.name, 512) || !clean(row.account, 320)) return null;
  try {
    if (row.sourceId !== `google:${encodeURIComponent(row.connectionId)}:${encodeURIComponent(row.providerCalendarId)}`) return null;
  } catch { return null; }
  // Copy only this nonsecret preference schema, even if a caller supplies a richer source object.
  return { connectionId: row.connectionId, sourceId: row.sourceId, providerCalendarId: row.providerCalendarId, name: row.name, account: row.account };
}
function changed(owner: GoogleCalendarAccountKey): void {
  if (typeof globalThis.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
    globalThis.dispatchEvent(new CustomEvent(GOOGLE_CALENDAR_SELECTION_CHANGED, { detail: { environment: owner.environment, userId: owner.userId, organizationId: owner.organizationId } }));
  }
}
/** Legacy single choice (v1). Only the device-calendar linked sync still reads it as its Google
 * target; it is never a visibility rule for the Calendar view, which uses the v2 preferences below.
 * Restores a preference, never event content or evidence that its source remains connected.
 * Callers must revalidate the connection/source before fetching or displaying any rows. */
export function readGoogleCalendarSelection(owner: GoogleCalendarAccountKey, storage?: GoogleCalendarSelectionStorage): GoogleCalendarSelection | null {
  const key = slot(owner), target = storageOrDefault(storage);
  if (!key || !target) return null;
  try {
    const raw = target.getItem(key);
    if (!raw || raw.length > 16384) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (row.version !== 1 || row.owner !== ownerKey(owner)) return null;
    return selection(row.selection);
  } catch { return null; }
}
/** False means unavailable storage, invalid input, or a failed write. It never falls back
 * to another account slot or overwrites a previous preference after an invalid input. */
export function saveGoogleCalendarSelection(owner: GoogleCalendarAccountKey, source: GoogleCalendarSelection | null, storage?: GoogleCalendarSelectionStorage): boolean {
  const key = slot(owner), target = storageOrDefault(storage);
  if (!key || !target) return false;
  const next = source === null ? null : selection(source);
  if (source !== null && !next) return false;
  try {
    if (next === null) target.removeItem(key);
    else target.setItem(key, JSON.stringify({ version: 1, owner: ownerKey(owner), selection: next }));
  } catch { return false; }
  changed(owner);
  return true;
}
/** Legacy v1 clear. Call only after confirmed disconnect. A different selected connection is retained. */
function clearLegacySelectionForConnection(owner: GoogleCalendarAccountKey, connectionId: string, storage?: GoogleCalendarSelectionStorage): boolean {
  if (!uuid.test(connectionId)) return false;
  const selected = readGoogleCalendarSelection(owner, storage);
  if (!selected || selected.connectionId !== connectionId) return false;
  return saveGoogleCalendarSelection(owner, null, storage);
}

/** Per-calendar display preference. `hidden` is set only by the owner (true hides, false shows a
 * calendar Google itself hides); `color` is a palette token or #rrggbb. */
export interface GoogleCalendarPref { hidden?: boolean; color?: string }
export type GoogleCalendarPrefs = Record<string, GoogleCalendarPref>;
const PREFS_LIMIT = 500;
function prefsSlot(owner: GoogleCalendarAccountKey): string | null {
  const key = ownerKey(owner);
  return key === null ? null : `alpha.google-calendar-prefs.v2:${key}`;
}
/** `google:<connection uuid>:<encoded calendar id>`, exactly as the reader builds it. */
function validSourceId(value: unknown): value is string {
  if (!clean(value, 8192)) return false;
  const match = /^google:([0-9a-f-]{36}):(.+)$/i.exec(value);
  if (!match || !uuid.test(match[1])) return false;
  try { const calendar = decodeURIComponent(match[2]); return clean(calendar, 1024) && encodeURIComponent(calendar) === match[2]; } catch { return false; }
}
const validColor = (value: unknown): value is string => typeof value === 'string' && (/^[a-z][a-z0-9-]{0,31}$/.test(value) || /^#[0-9a-f]{6}$/i.test(value));
function prefsOf(value: unknown): GoogleCalendarPrefs {
  const out: GoogleCalendarPrefs = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [id, raw] of Object.entries(value as Record<string, unknown>).slice(0, PREFS_LIMIT)) {
    if (!validSourceId(id) || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>, pref: GoogleCalendarPref = {};
    if (typeof row.hidden === 'boolean') pref.hidden = row.hidden;
    if (validColor(row.color)) pref.color = row.color.toLowerCase();
    if (Object.keys(pref).length) out[id] = pref;
  }
  return out;
}
/** The owner's per-calendar display preferences for this Cloud account; empty when none are saved
 * or storage is unavailable. The old single choice (v1) is not read here. */
export function readGoogleCalendarPrefs(owner: GoogleCalendarAccountKey, storage?: GoogleCalendarSelectionStorage): GoogleCalendarPrefs {
  const key = prefsSlot(owner), target = storageOrDefault(storage);
  if (!key || !target) return {};
  try {
    const raw = target.getItem(key);
    if (!raw || raw.length > 262144) return {};
    const row: unknown = JSON.parse(raw);
    if (!row || typeof row !== 'object' || Array.isArray(row)) return {};
    const value = row as Record<string, unknown>;
    if (value.version !== 2 || value.owner !== ownerKey(owner)) return {};
    return prefsOf(value.calendars);
  } catch { return {}; }
}
/** Whether a calendar shows: the owner's choice when made, otherwise shown when Google shows it or it is primary. */
export function googleCalendarVisible(prefs: GoogleCalendarPrefs, calendar: { id: string; selected: boolean; primary: boolean }): boolean {
  const hidden = prefs[calendar.id]?.hidden;
  return hidden === undefined ? calendar.selected || calendar.primary : !hidden;
}
function editPrefs(owner: GoogleCalendarAccountKey, storage: GoogleCalendarSelectionStorage | undefined, edit: (prefs: GoogleCalendarPrefs) => boolean): boolean {
  const key = prefsSlot(owner), target = storageOrDefault(storage);
  if (!key || !target) return false;
  const prefs = readGoogleCalendarPrefs(owner, target);
  if (!edit(prefs)) return false;
  for (const [id, pref] of Object.entries(prefs)) if (!Object.keys(pref).length) delete prefs[id];
  if (Object.keys(prefs).length > PREFS_LIMIT) return false;
  try {
    if (!Object.keys(prefs).length) target.removeItem(key);
    else target.setItem(key, JSON.stringify({ version: 2, owner: ownerKey(owner), calendars: prefs }));
  } catch { return false; }
  changed(owner);
  return true;
}
/** Shows or hides one calendar. False means invalid input or a failed write; nothing else changes. */
export function setGoogleCalendarVisible(owner: GoogleCalendarAccountKey, sourceId: string, visible: boolean, storage?: GoogleCalendarSelectionStorage): boolean {
  if (!validSourceId(sourceId) || typeof visible !== 'boolean') return false;
  return editPrefs(owner, storage, prefs => { prefs[sourceId] = { ...prefs[sourceId], hidden: !visible }; return true; });
}
/** Sets one calendar's colour (palette token or #rrggbb); null returns it to Google's colour. */
export function setGoogleCalendarColor(owner: GoogleCalendarAccountKey, sourceId: string, color: string | null, storage?: GoogleCalendarSelectionStorage): boolean {
  if (!validSourceId(sourceId) || (color !== null && !validColor(color))) return false;
  return editPrefs(owner, storage, prefs => {
    const next = { ...prefs[sourceId] };
    if (color === null) delete next.color; else next.color = color.toLowerCase();
    prefs[sourceId] = next;
    return true;
  });
}
/** Call only after a confirmed disconnect: drops that connection's calendar preferences and the old
 * single choice when it named that connection. Other connections are kept. */
export function clearGoogleCalendarPrefsForConnection(owner: GoogleCalendarAccountKey, connectionId: string, storage?: GoogleCalendarSelectionStorage): boolean {
  if (!uuid.test(connectionId)) return false;
  const prefix = `google:${encodeURIComponent(connectionId)}:`;
  const legacy = clearLegacySelectionForConnection(owner, connectionId, storage);
  const had = Object.keys(readGoogleCalendarPrefs(owner, storage)).some(id => id.startsWith(prefix));
  const prefs = had && editPrefs(owner, storage, prefs => { for (const id of Object.keys(prefs)) if (id.startsWith(prefix)) delete prefs[id]; return true; });
  return legacy || prefs;
}
/** @deprecated Alias of clearGoogleCalendarPrefsForConnection, kept for one release. */
export const clearGoogleCalendarSelectionForConnection = clearGoogleCalendarPrefsForConnection;
