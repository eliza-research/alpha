import type { CloudEnvironment } from './cloud-protocol.ts';

/** The Google calendar that device Calendar sync writes to, per Cloud account. Display never uses it:
 * Calendar is one merged view of the agent's feed. Chosen in the sync dialog, not in Google accounts. */
export interface GoogleCalendarAccountKey { environment: CloudEnvironment; userId: string; organizationId: string }
export interface GoogleCalendarSelection { connectionId: string; sourceId: string; providerCalendarId: string; name: string; account: string }
export type GoogleCalendarSelectionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const GOOGLE_CALENDAR_SELECTION_CHANGED = 'alpha:google-calendar-selection-changed';
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
/** Restores a preference, never event content or evidence that its source remains connected.
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
/** Call only after confirmed disconnect. A different selected connection is retained. */
export function clearGoogleCalendarSelectionForConnection(owner: GoogleCalendarAccountKey, connectionId: string, storage?: GoogleCalendarSelectionStorage): boolean {
  if (!uuid.test(connectionId)) return false;
  const selected = readGoogleCalendarSelection(owner, storage);
  if (!selected || selected.connectionId !== connectionId) return false;
  return saveGoogleCalendarSelection(owner, null, storage);
}
