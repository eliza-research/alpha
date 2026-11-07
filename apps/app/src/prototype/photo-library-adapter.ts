/** Photos' agent bridge for the full permitted MediaStore library (issue 408, policy P-24).
 * Native reads go through AlphaPhotoLibrary; rules live in runtime/photo-library.ts. Reads return
 * identity-only rows; select, filter, open, album and share requests and every review act on the
 * main Photos Library the owner sees (camera-adapter registers it with setMainLibraryHost).
 * Nothing is copied or uploaded. */
import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '../platform-plugins';
import {
  LibraryRevisions, parsePage, parseScope, parseValidation, parseItem, prepareReview, modelItem, modelSearchResult, LIBRARY_LIMITS,
  type LibraryReview, type LibraryScopeState, type LibraryItem, type LibraryChange, type LibraryAgentOperation, type LibraryAgentResult,
} from '../runtime/photo-library';
import type { PhotosViewOperation, PhotosViewResult } from '../runtime/photos-view-contract';

type Bag = Record<string, any>;
type Items = { items: { id: string; revision: string }[] };
export type PhotoLibraryPort = {
  scope(): Promise<unknown>;
  page(options: { before?: string; limit?: number; thumbnails?: boolean; thumbnailSize?: number; kind?: string; from?: number; to?: number; favorites?: boolean }): Promise<unknown>;
  inspect(options: { id: string; size?: number; pixels?: boolean }): Promise<unknown>;
  validate(options: Items): Promise<unknown>;
  requestChange(options: Items & { operation: LibraryChange }): Promise<{ status: string; operation?: string; outcomes?: { id: string; status: string }[] }>;
  share(options: Items): Promise<{ status: string; count: number }>;
};
const nativePort = registerPlugin<PhotoLibraryPort>('AlphaPhotoLibrary');
const CHANGED_OUTCOMES = ['favorited', 'unfavorited', 'trashed', 'restored', 'unchanged'];
/** Owner-facing summary of a native batch change result (never reports an unverified item as changed). */
export function describeLibraryChange(result: { status: string; outcomes?: { id: string; status: string }[] }, requested: number) {
  const outcomes = Array.isArray(result.outcomes) ? result.outcomes : [];
  const verified = outcomes.filter(row => CHANGED_OUTCOMES.includes(row.status)).length, stale = outcomes.filter(row => row.status === 'stale').length;
  if (result.status === 'complete' && verified === requested) return `${verified} ${verified === 1 ? 'item' : 'items'} changed and verified.`;
  return `${verified} of ${requested} changes verified${stale ? `; ${stale} changed elsewhere and ${stale === 1 ? 'was' : 'were'} skipped` : ''}.`;
}
export const deviceLibraryAvailable = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('AlphaPhotoLibrary');
const revisionSession = () => { try { return Array.from(crypto.getRandomValues(new Uint8Array(6)), byte => byte.toString(36).padStart(2, '0')).join('').slice(0, 12); } catch { return Date.now().toString(36).slice(-8); } };

/** A refusal the agent executor reports as a failed action with this owner-facing text. */
export class LibraryAgentRefusal extends Error { override readonly name = 'LibraryAgentRefusal'; }
type LibraryAgent = {
  run(operation: LibraryAgentOperation, signal: AbortSignal): Promise<LibraryAgentResult>;
  /** photos_filter / photos_open / photos_album_create / photos_share (photos.view.v1). */
  runView(operation: PhotosViewOperation, signal: AbortSignal): Promise<PhotosViewResult>;
};
let mountedAgent: LibraryAgent | undefined;
/** The mounted Photos agent bridge, for approved agent operations; undefined when Photos is not installed. */
export const deviceLibraryAgent = () => mountedAgent;

/** The main Photos Library (camera-adapter) once it is mounted: select, filter, open, album and share
 * requests act on the grid the owner sees, and reviews open over it. */
export type HostOperation = Extract<LibraryAgentOperation, { type: 'photo_library_select' }> | PhotosViewOperation;
export type MainLibraryHost = {
  visible(): boolean;
  /** The host's own album or share review is waiting for the owner. */
  reviewOpen(): boolean;
  run(operation: HostOperation, signal: AbortSignal): Promise<LibraryAgentResult | PhotosViewResult>;
  /** Re-render after the review card opens, changes or closes. */
  reviewChanged(): void;
  /** Items moved to Recently deleted by a confirmed review; the host offers Undo. */
  trashed(ids: string[]): void;
};
let mainHost: MainLibraryHost | undefined;
export function setMainLibraryHost(host: MainLibraryHost | undefined) { mainHost = host; return () => { if (mainHost === host) mainHost = undefined; }; }

/** One instance per Photos module mount. */
export function createDeviceLibrary(port: PhotoLibraryPort = nativePort, available = deviceLibraryAvailable) {
  const modelRevisions = new LibraryRevisions(revisionSession());
  let status = '', review: LibraryReview | undefined, acting = false, epoch = 0, disposed = false;

  async function readScope(): Promise<LibraryScopeState | undefined> {
    const token = epoch;
    if (!available()) return undefined;
    try { const fresh = parseScope(await port.scope()); return token !== epoch || disposed ? undefined : fresh; }
    catch { return undefined; }
  }

  /** Every reviewed item still exists, untrashed, at the reviewed revision (NoActionOnStaleRev). */
  async function validCurrent(items: { id: string; revision: string }[]): Promise<boolean> {
    for (let at = 0; at < items.length; at += LIBRARY_LIMITS.validate) {
      const batch = items.slice(at, at + LIBRARY_LIMITS.validate), rows = parseValidation(await port.validate({ items: batch }));
      if (rows.length !== batch.length || rows.some(row => row.status !== 'current')) return false;
    }
    return true;
  }
  const changed = () => { if (!disposed) mainHost?.reviewChanged(); };

  /** Runs only from the owner's in-app confirmation, then Android's own dialog or chooser. */
  async function confirmReview() {
    const pending = review;
    if (!pending || acting) return;
    let current = false;
    try { current = await validCurrent(pending.items); } catch { current = false; }
    if (review !== pending) return;
    if (!current) { review = undefined; status = 'The reviewed items changed. Review them again.'; changed(); return; }
    acting = true; review = undefined; changed();
    try {
      if (pending.action === 'share') {
        const result = await port.share({ items: pending.items });
        status = result.status === 'opened' ? '' : 'Sharing did not open.';
      } else {
        // Native (PermittedMediaReview) resolves only after Android approved: {status:'complete'|'partial',
        // outcomes:[{status:'favorited'|'unfavorited'|'trashed'|'restored'|'unchanged'|'stale'|'unverified'}]}.
        // A cancelled review rejects with LIBRARY_DECLINED and a revision changed before review with LIBRARY_STALE.
        const result = await port.requestChange({ operation: pending.action, items: pending.items });
        const trashed = (result.outcomes || []).filter(row => row.status === 'trashed').map(row => row.id);
        // A confirmed trash is reported by the host's Undo toast; anything else gets one line.
        status = pending.action === 'trash' && trashed.length === pending.items.length ? '' : describeLibraryChange(result, pending.items.length);
        if (pending.action === 'trash') mainHost?.trashed(trashed);
      }
    } catch (failure) {
      const code = (failure as { code?: string })?.code;
      if (code === 'LIBRARY_DECLINED') status = 'Nothing changed.';
      else if (code === 'LIBRARY_STALE') status = 'An item changed. Nothing changed; review again.';
      else status = 'The action could not be completed.';
    } finally { acting = false; changed(); }
  }

  /** The host the agent may act on: Photos is open and showing. */
  const visibleHost = () => {
    const host = mainHost;
    if (!host || disposed || !host.visible()) throw new LibraryAgentRefusal('Open Photos, then ask again.');
    return host;
  };

  /** Approved agent operations (issue 408). Reads stay local and return identity-only rows with
   * opaque revisions; select, view requests and reviews act only on the owner-visible Library. */
  const agent: LibraryAgent = {
    async run(operation, signal) {
      if (!available() || disposed) throw new LibraryAgentRefusal('The device library is available only in the Android app.');
      const current = await readScope();
      signal.throwIfAborted();
      if (!current || current.scope === 'denied') throw new LibraryAgentRefusal('Alpha is not allowed to read the photo library. Nothing was shared.');
      if (current.locked) throw new LibraryAgentRefusal('Unlock the phone to use the device library. Nothing was shared.');
      if (operation.type === 'photo_library_search') {
        const limit = operation.limit ?? 20;
        const page = parsePage(await port.page({ limit, thumbnails: false, kind: operation.kind ?? 'all', ...(operation.from !== undefined ? { from: operation.from } : {}), ...(operation.to !== undefined ? { to: operation.to } : {}), ...(operation.favorites ? { favorites: true } : {}) }));
        signal.throwIfAborted();
        return { kind: operation.type, ...modelSearchResult(page, modelRevisions, limit) } as LibraryAgentResult;
      }
      if (operation.type === 'photo_library_inspect') {
        let row: LibraryItem;
        try { row = parseItem(await port.inspect({ id: operation.id, size: 64, pixels: false })); }
        catch (failure) { if ((failure as { code?: string })?.code === 'LIBRARY_MISSING') throw new LibraryAgentRefusal('That item is no longer in the library.'); throw failure; }
        signal.throwIfAborted();
        return { kind: operation.type, item: modelItem(row, modelRevisions) };
      }
      const host = visibleHost();
      // One review at a time over the Library (specs/photos-library: a single pending review).
      if (acting || review || host.reviewOpen()) throw new LibraryAgentRefusal('Finish the open review first.');
      if (operation.type === 'photo_library_select') return host.run(operation, signal) as Promise<LibraryAgentResult>;
      const items = operation.items.map(entry => ({ id: entry.id, revision: modelRevisions.native(entry.id, entry.revision) ?? '' }));
      if (items.some(entry => !entry.revision)) throw new LibraryAgentRefusal('An item changed since the assistant read it. Nothing changed; ask again.');
      const prepared = prepareReview(operation.action, items);
      // The review binds the exact revisions the assistant read; the provider confirms they are still current.
      if (!await validCurrent(prepared.items)) throw new LibraryAgentRefusal('An item changed or left the library. Nothing changed; ask again.');
      signal.throwIfAborted();
      review = prepared; status = ''; host.reviewChanged();
      return { kind: 'photo_library_review', status: 'review_opened', action: operation.action, count: items.length };
    },
    async runView(operation, signal) {
      const host = visibleHost();
      // The filter is read-only and works on whatever Photos shows, including Alpha's own captures.
      if (operation.type !== 'photos_filter' && (acting || review)) throw new LibraryAgentRefusal('Finish the open review first.');
      return host.run(operation, signal) as Promise<PhotosViewResult>;
    },
  };
  mountedAgent = agent;

  return {
    /** The agent's open review, shown over the main Library grid. */
    reviewCard() {
      if (!review) return undefined;
      return { title: review.title, detail: review.detail, busy: acting, confirm: () => { void confirmReview(); }, cancel: () => { review = undefined; status = ''; changed(); } };
    },
    /** One short line after a confirmed review, for the host's toast. */
    takeStatus() { const value = status; status = ''; return value; },
    agent,
    leave() { review = undefined; status = ''; epoch++; },
    dispose() { disposed = true; epoch++; if (mountedAgent === agent) mountedAgent = undefined; },
  };
}
