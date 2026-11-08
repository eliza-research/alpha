/** Photos > Device library: the full permitted MediaStore library (issue 408, policy P-24).
 * Native reads go through AlphaPhotoLibrary; rules live in runtime/photo-library.ts.
 * The library is paged only while this album is open; nothing is copied or uploaded. */
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { registerPlugin } from '../platform-plugins';
import { createCaptureRevisions } from './context-selection';
import {
  LibraryCatalog, LibraryRevisions, LibrarySelection, parsePage, parseScope, parseValidation, parseItem, prepareReview, reviewCurrent, scopePresentation,
  modelItem, modelSearchResult, LIBRARY_LIMITS, type LibraryAction, type LibraryReview, type LibraryScopeState, type LibraryItem, type LibraryChange,
  type LibraryAgentOperation, type LibraryAgentResult,
} from '../runtime/photo-library';

type Bag = Record<string, any>;
type Items = { items: { id: string; revision: string }[] };
export type PhotoLibraryPort = {
  scope(): Promise<unknown>;
  requestAccess(): Promise<unknown>;
  page(options: { before?: string; limit?: number; thumbnails?: boolean; thumbnailSize?: number; kind?: string; from?: number; to?: number; favorites?: boolean }): Promise<unknown>;
  inspect(options: { id: string; size?: number; pixels?: boolean }): Promise<unknown>;
  validate(options: Items): Promise<unknown>;
  requestChange(options: Items & { operation: LibraryChange }): Promise<{ status: string; operation?: string; outcomes?: { id: string; status: string }[] }>;
  share(options: Items): Promise<{ status: string; count: number }>;
  /** Native MediaStore observer, registered only while the device library album is open. */
  watch(options: { active: boolean }): Promise<unknown>;
  addListener(event: 'libraryChanged' | 'scopeChanged', listener: (value: Bag) => void): Promise<PluginListenerHandle>;
};
const nativePort = registerPlugin<PhotoLibraryPort>('AlphaPhotoLibrary');
const CHANGED_OUTCOMES = ['favorited', 'unfavorited', 'trashed', 'restored', 'unchanged'];
/** Owner-facing summary of a native batch change result (never reports an unverified item as changed). */
export function describeLibraryChange(result: { status: string; outcomes?: { id: string; status: string }[] }, requested: number) {
  const outcomes = Array.isArray(result.outcomes) ? result.outcomes : [];
  const verified = outcomes.filter(row => CHANGED_OUTCOMES.includes(row.status)).length, stale = outcomes.filter(row => row.status === 'stale').length;
  if (result.status === 'complete' && verified === requested) return `${verified} ${verified === 1 ? 'item' : 'items'} changed and verified.`;
  return `${verified} of ${requested} changes verified${stale ? `; ${stale} changed elsewhere and ${stale === 1 ? 'was' : 'were'} skipped` : ''}. Reload to see the current library.`;
}
const device = registerPlugin<{ openSettings(options: { page: 'privacy' }): Promise<{ status: string }> }>('AlphaDevice');
export const deviceLibraryAvailable = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('AlphaPhotoLibrary');

const PAGE = LIBRARY_LIMITS.thumbnailRows - 6;
const background = (item: LibraryItem) => item.image ? `url("${item.image}") center / cover no-repeat` : 'var(--s2)';
const duration = (seconds: number) => seconds ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '';
/** Same grant and lock state. Android publishes a new version on every resume, so the version alone is not an access change. */
const sameAccess = (a: LibraryScopeState | undefined, b: LibraryScopeState) => !!a && a.scope === b.scope && a.images === b.images && a.videos === b.videos
  && a.imageAccess === b.imageAccess && a.videoAccess === b.videoAccess && a.locked === b.locked;
const revisionSession = () => { try { return Array.from(crypto.getRandomValues(new Uint8Array(6)), byte => byte.toString(36).padStart(2, '0')).join('').slice(0, 12); } catch { return Date.now().toString(36).slice(-8); } };

/** A refusal the agent executor reports as a failed action with this owner-facing text. */
export class LibraryAgentRefusal extends Error { override readonly name = 'LibraryAgentRefusal'; }
type LibraryAgent = { run(operation: LibraryAgentOperation, signal: AbortSignal): Promise<LibraryAgentResult> };
let mountedAgent: LibraryAgent | undefined;
/** The mounted Photos device library, for approved agent operations; undefined when Photos is not installed. */
export const deviceLibraryAgent = () => mountedAgent;

/** One instance per Photos module mount. */
export function createDeviceLibrary(port: PhotoLibraryPort = nativePort, available = deviceLibraryAvailable) {
  const catalog = new LibraryCatalog(), selection = new LibrarySelection(), revisions = createCaptureRevisions(), modelRevisions = new LibraryRevisions(revisionSession());
  let scope: LibraryScopeState | undefined, deniedAgain = false, scopeRequested = false, loadRequested = false, busy = false, error = '', status = '', review: LibraryReview | undefined, acting = false, epoch = 0, disposed = false;
  /** reloadOnOpen: the next visit must start from a fresh first page (Photos was left, or Android resumed or
   * changed access). watching is undefined after a resume: Android turned its observer off, so the next render asks again. */
  let reloadOnOpen = false, watching: boolean | undefined = false;
  /** How many items the last completed load showed: a reload reads on no further than this, even after a failed attempt. */
  let reach = 0;
  let api: Bag | undefined;
  const listeners: Promise<PluginListenerHandle>[] = [];
  const visible = () => !!api && api.isActive?.() !== false && api.get?.('photos')?.album === 'device';
  const refresh = () => { if (api && !disposed) api.set({ nativeLibraryRevision: Date.now(), nativeLibrarySelection: focused() }); };
  /** Exactly one selected item becomes the assistant's selected object: identity only. */
  const focused = () => {
    if (selection.size !== 1 || !visible()) return null;
    const [chosen] = selection.items(), item = catalog.items.find(row => row.id === chosen.id);
    return item ? revisions({ kind: item.kind, id: item.id, revision: item.revision }) : null;
  };

  async function readScope(): Promise<LibraryScopeState | undefined> {
    const token = epoch;
    if (!available()) { scope = undefined; return undefined; }
    try {
      const before = scope, fresh = parseScope(await port.scope());
      if (token !== epoch || disposed) return undefined;
      // A new version alone clears the catalog (its cursors are gone) but not the selection; load() checks it.
      scope = fresh; if (catalog.observeScope(scope) && !sameAccess(before, scope)) selection.clear();
    }
    catch { if (token !== epoch || disposed) return undefined; error = 'Library access could not be read.'; }
    return scope;
  }

  async function load(more = false) {
    if (busy || disposed || !available()) return;
    const token = ++epoch, loaded = Math.max(reach, catalog.items.length); busy = true; error = ''; refresh();
    try {
      const current = await readScope();
      if (token !== epoch) return;
      if (!current || current.scope === 'denied' || current.locked) { catalog.reset(); selection.clear(); return; }
      // A fresh first page keeps the selected and reviewed items Android still reports as current.
      const kept = new Set<string>(), wanted = more ? [] : [...new Map([...selection.items(), ...(review?.items ?? [])].map(row => [row.id, row])).values()];
      if (wanted.length) {
        for (const row of parseValidation(await port.validate({ items: wanted }))) if (row.status === 'current') kept.add(row.id);
        if (token !== epoch) return;
      }
      const read = async (before: string) => parsePage(await port.page({ before, limit: PAGE, thumbnails: true, thumbnailSize: 240 }));
      const page = await read(more ? catalog.next : '');
      if (token !== epoch) return;
      scope = page.scope; catalog.apply(page, !more); if (!more) reloadOnOpen = false;
      // Native cursors do not survive a resume: read on, no further than before, until those items are loaded again.
      const missing = () => [...kept].some(id => !catalog.items.some(row => row.id === id));
      while (missing() && catalog.next && catalog.items.length < loaded) {
        const next = await read(catalog.next);
        if (token !== epoch) return;
        scope = next.scope; catalog.apply(next, false);
      }
      const dropped = selection.reconcile(catalog);
      if (dropped.dropped || dropped.changed) status = 'Some selected items changed or left the library and were unselected.';
      if (review && !reviewCurrent(review, catalog)) { review = undefined; status = 'The reviewed items changed. Review them again.'; }
      reach = catalog.items.length;
    } catch (failure) {
      if (token !== epoch) return;
      error = (failure as { code?: string })?.code === 'LIBRARY_DENIED' ? '' : 'The device library could not be loaded. Try again.';
      if ((failure as { code?: string })?.code === 'LIBRARY_DENIED') { catalog.reset(); selection.clear(); await readScope(); }
    } finally { if (token === epoch) { busy = false; refresh(); } }
  }

  /** External edits, deletes, reboots and grant changes. Native changes() always answers reset (one
   * bounded page refresh, no incremental index), so this reloads and keeps what is still current. */
  async function revalidate() {
    if (busy || disposed || !available() || !catalog.loaded) return;
    await load();
  }

  /** Android answers a request denied again without a dialog; access then changes only in Android Settings. */
  const presentationOf = (value: typeof scope) => scopePresentation(value && deniedAgain && value.scope === 'denied' ? { ...value, settingsRequired: true } : value);
  async function requestAccess() {
    if (!scope || acting) return;
    const presentation = presentationOf(scope);
    if (presentation.actionKind === 'settings') {
      try { await device.openSettings({ page: 'privacy' }); status = 'Change Photos and videos access in Android Settings, then return to Alpha.'; }
      catch { status = 'Open Android Settings > Apps > Alpha Phone > Permissions to change access.'; }
      refresh(); return;
    }
    acting = true; refresh();
    try { const before = scope.scope; await port.requestAccess(); scope = parseScope(await port.scope()); deniedAgain = before === 'denied' && scope.scope === 'denied'; if (catalog.observeScope(scope)) selection.clear(); }
    catch { error = 'Android did not open the access dialog.'; }
    finally { acting = false; }
    await load();
  }

  function startReview(action: LibraryAction) {
    if (acting || !selection.size) return;
    try { review = prepareReview(action, selection.items()); status = ''; }
    catch (failure) { status = (failure as Error).message; }
    refresh();
  }

  /** Runs only from the owner's in-app confirmation, then Android's own dialog or chooser. */
  async function confirmReview() {
    const pending = review;
    if (!pending || acting) return;
    if (!reviewCurrent(pending, catalog)) { review = undefined; status = 'The reviewed items changed. Review them again.'; refresh(); return; }
    acting = true; review = undefined; refresh();
    try {
      if (pending.action === 'share') {
        const result = await port.share({ items: pending.items });
        status = result.status === 'opened' ? `Android share sheet opened for ${result.count} ${result.count === 1 ? 'item' : 'items'}. Nothing is sent until you pick an app.` : 'Sharing did not open.';
      } else {
        // Native (PermittedMediaReview) resolves only after Android approved: {status:'complete'|'partial',
        // outcomes:[{status:'favorited'|'unfavorited'|'trashed'|'restored'|'unchanged'|'stale'|'unverified'}]}.
        // A cancelled review rejects with LIBRARY_DECLINED and a revision changed before review with LIBRARY_STALE.
        const result = await port.requestChange({ operation: pending.action, items: pending.items });
        status = describeLibraryChange(result, pending.items.length);
        selection.clear(); await revalidate();
      }
    } catch (failure) {
      const code = (failure as { code?: string })?.code;
      if (code === 'LIBRARY_DECLINED') status = 'Android review was cancelled. Nothing changed.';
      else if (code === 'LIBRARY_STALE') { status = 'An item changed before Android review. Nothing changed; review again.'; try { await revalidate(); } catch { /* status already asks for a new review */ } }
      else status = 'The action could not be completed. Reload the library before retrying.';
    } finally { acting = false; refresh(); }
  }

  /** The native observer runs only while the device library album is visible and readable. */
  function watch(active: boolean) {
    if (!available() || watching === active) return;
    watching = active;
    void port.watch({ active }).catch(() => { watching = false; });
  }

  function attach() {
    if (!available() || listeners.length) return;
    listeners.push(port.addListener('libraryChanged', () => { if (visible()) void revalidate(); }));
    listeners.push(port.addListener('scopeChanged', value => {
      // Retire reads begun under the previous grant before clearing or loading the catalog.
      epoch++; busy = false; watching = undefined;
      try {
        const fresh = parseScope(value);
        if (!sameAccess(scope, fresh) && catalog.observeScope(fresh)) { selection.clear(); review = undefined; status = 'Library access changed in Android.'; }
        scope = fresh;
      } catch { /* read again on next render */ }
      // Every resume and any change, including a widened grant, needs a fresh first page (native cursors are gone);
      // a narrowing already cleared the catalog, and an unchanged grant keeps what still validates.
      reloadOnOpen = true;
      if (visible()) void load(); else refresh();
    }));
  }

  /** Approved agent operations (issue 408). Reads stay local and return identity-only rows with
   * opaque revisions; select and review act only on the owner-visible device library. */
  const agent: LibraryAgent = {
    async run(operation, signal) {
      if (!available() || disposed) throw new LibraryAgentRefusal('The device library is available only in the Android app.');
      // Its own read: a load or resume in progress must not turn into a false refusal.
      let current: LibraryScopeState;
      try { current = parseScope(await port.scope()); }
      catch { throw new LibraryAgentRefusal('Library access could not be read. Nothing was shared.'); }
      signal.throwIfAborted();
      if (current.scope === 'denied') throw new LibraryAgentRefusal('Alpha is not allowed to read the photo library. Nothing was shared.');
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
      // Selection and review act on what the owner sees in Photos > Device library.
      if (!visible()) throw new LibraryAgentRefusal('Open Photos > Device library to review this action.');
      if (operation.type === 'photo_library_select') {
        if (acting || review) throw new LibraryAgentRefusal('Finish the open library review first.');
        selection.clear();
        let selected = 0;
        for (const id of operation.ids) { const item = catalog.items.find(row => row.id === id); if (item) { selection.toggle(item); selected++; } }
        status = selected ? `The assistant selected ${selected} ${selected === 1 ? 'item' : 'items'}. Nothing was changed or shared.` : '';
        refresh();
        return { kind: operation.type, selected, missing: operation.ids.length - selected };
      }
      if (acting || review) throw new LibraryAgentRefusal('Finish the open library review first.');
      const items = operation.items.map(entry => ({ id: entry.id, revision: modelRevisions.native(entry.id, entry.revision) ?? '' }));
      if (items.some(entry => !entry.revision)) throw new LibraryAgentRefusal('An item changed since the assistant read it. Nothing changed; ask again.');
      const prepared = prepareReview(operation.action, items);
      if (!reviewCurrent(prepared, catalog)) throw new LibraryAgentRefusal('An item changed or is not loaded in Photos > Device library. Nothing changed; reload and ask again.');
      review = prepared; status = 'The assistant asked for this review. Nothing changes until you confirm here and in Android.';
      refresh();
      return { kind: operation.type, status: 'review_opened', action: operation.action, count: items.length };
    },
  };
  mountedAgent = agent;

  return {
    /** The album tile for Photos' album row. */
    tile(currentApi: Bag) {
      api = currentApi;
      if (!available()) return undefined;
      // One automatic scope read per Photos entry; a failure shows its error instead of retrying every render.
      if (!scope && !scopeRequested) { scopeRequested = true; queueMicrotask(() => { void readScope().then(refresh); }); }
      attach();
      return {
        name: 'Device library', count: scope ? scopePresentation(scope).label : '…', bg: catalog.items[0]?.image ? background(catalog.items[0]) : 'var(--s2)', tf: '', flt: '',
        open: () => { currentApi.set({ album: 'device', open: null, nativePhotoSelection: null }); void (catalog.loaded && !reloadOnOpen ? revalidate() : load()); },
      };
    },
    /** The album view data when Photos shows the device library. */
    album(st: Bag, currentApi: Bag) {
      api = currentApi;
      if ((!catalog.loaded || reloadOnOpen) && !loadRequested) { loadRequested = true; queueMicrotask(() => { void load(); }); }
      watch(!!scope && scope.scope !== 'denied' && !scope.locked);
      const presentation = presentationOf(scope);
      const message = [error, status, presentation.detail, selection.size ? `${selection.size} selected${selection.size === 1 ? ' · the assistant can see this item\'s identity only' : ''}` : ''].filter(Boolean).join(' ');
      const reviewOpen = !!review;
      return {
        title: 'Device library', isTrash: false, notTrash: true, isCustom: false, isDevice: true, count: presentation.label,
        empty: catalog.loaded && !catalog.items.length && !busy, close: () => { selection.clear(); review = undefined; watch(false); currentApi.set({ album: null, nativeLibrarySelection: null }); },
        status: busy && !catalog.items.length ? 'Loading…' : message,
        more: !!catalog.next || !!error || catalog.loaded, moreLabel: error ? 'Retry' : busy ? 'Loading…' : catalog.next ? 'Load more' : 'Reload', loadMore: () => { void load(!error && !!catalog.next); },
        dev: {
          accessLabel: presentation.action, hasAccess: presentation.actionKind !== 'none' && !acting, access: () => { void requestAccess(); },
          canAct: selection.size > 0 && !acting && !reviewOpen, canEdit: selection.size > 0 && !acting && !reviewOpen && !!scope?.canEditOthers,
          share: () => startReview('share'), favorite: () => startReview('favorite'), trash: () => startReview('trash'),
          clear: () => { selection.clear(); refresh(); },
          reviewing: reviewOpen, reviewTitle: review?.title || '', reviewDetail: review?.detail || '',
          confirm: () => { void confirmReview(); }, cancel: () => { review = undefined; status = 'Review cancelled. Nothing changed.'; refresh(); },
        },
        items: catalog.items.map(item => ({
          nativeMediaId: item.id, bg: background(item), tf: '', flt: '', vid: item.kind === 'video', dur: duration(item.duration), dim: acting ? 'opacity:.35;pointer-events:none' : '',
          selecting: true, on: selection.has(item.id), selCss: selection.has(item.id) ? 'background:var(--acc);box-shadow:0 0 0 2px #ffffff' : 'background:rgba(0,0,0,.7);box-shadow:inset 0 0 0 2px #ffffff',
          alt: `${selection.has(item.id) ? 'Unselect' : 'Select'} ${item.kind === 'video' ? 'video' : 'photo'} from ${new Date(item.takenAt).toLocaleDateString()}`,
          tap: () => { if (acting || review) return; try { selection.toggle(item); status = ''; } catch (failure) { status = (failure as Error).message; } refresh(); },
          pd: () => {}, pu: () => {},
        })),
      };
    },
    selected: focused,
    agent,
    leave() { selection.clear(); review = undefined; status = ''; error = ''; epoch++; busy = false; scopeRequested = false; loadRequested = false; reloadOnOpen = true; watch(false); },
    dispose() { disposed = true; epoch++; watch(false); if (mountedAgent === agent) mountedAgent = undefined; for (const handle of listeners.splice(0)) void handle.then(value => value.remove()).catch(() => {}); },
  };
}
