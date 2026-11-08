import type {DefaultApp, InstalledApp} from '../native';
import {createKeyedListFocus} from './keyed-list-focus.ts';
type Bag = Record<string, any>;

type LaunchTarget = {packageName: string; activityName?: string; user?: string};
/** The installed-app bridge the drawer needs; DeviceApps on Android, BrowserDevice on the web. */
export interface LauncherBridge {
  list(options?: {icons?: boolean}): Promise<{apps: InstalledApp[]}>;
  launch(options: LaunchTarget): Promise<void>;
  resolveDefault?(options: {role: 'dial'}): Promise<DefaultApp>;
  openDefault?(options: {role: 'dial'}): Promise<void>;
  /** `appsChanged`: a package was added, removed or changed, or a profile was paused/unlocked. */
  addListener?(event: 'appsChanged', listener: (change: Bag) => void): unknown;
}
/** Ordered favorite keys, kept on this device only. `write` throws when storage refuses. */
export interface FavoritesStore { read(): string[] | null; write(keys: string[]): void; /** v1 only controlled installed shortcuts, not product Home apps. */ legacy?(): boolean; /** Old v2 wrote every installed app as the default. */ legacyHomeDefaults?(): boolean }
export type LauncherStatus = 'idle' | 'loading' | 'ready' | 'failed';
export interface LauncherSnapshot {
  status: LauncherStatus;
  apps: InstalledApp[];
  dial: DefaultApp | null;
  /** Entry currently being opened; repeated taps are ignored until it settles. */
  launching: string | null;
  /** Last open failure, shown inline until the next search, load or launch. */
  launchError: string | null;
  /** Saved favorite keys in the user's order. May name entries that are not installed now. */
  favorites: string[];
}

export const FAVORITES_KEY = 'alpha.launcher.favorites.v1';
export const MAX_FAVORITES = 4096;
const PROFILES = ['work', 'private', 'clone', 'other'];
const PROFILE_LABEL: Record<string, string> = {work: 'Work', private: 'Private', clone: 'Clone', other: 'Other profile'};

/** Identity of one launcher entry: package, then exact activity, then profile. Labels never identify. */
export function appKey(app: LaunchTarget): string {
  return app.packageName + (app.activityName ? `/${app.activityName}` : '') + (app.user ? `#${app.user}` : '');
}

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
/** Label (then package) match, ignoring case and accents; prefix matches sort first. */
export function filterLauncherApps(apps: InstalledApp[], query: string): InstalledApp[] {
  const needle = fold(query.trim());
  const collator = new Intl.Collator(undefined, {sensitivity: 'base', numeric: true});
  const sorted = [...apps].sort((a, b) => collator.compare(a.label, b.label) || a.packageName.localeCompare(b.packageName) || appKey(a).localeCompare(appKey(b)));
  if (!needle) return sorted;
  const score = (app: InstalledApp) => { const label = fold(app.label); return label.startsWith(needle) ? 0 : label.includes(needle) ? 1 : fold(app.packageName).includes(needle) ? 2 : -1; };
  return sorted.map(app => [app, score(app)] as const).filter(([, rank]) => rank >= 0).sort((a, b) => a[1] - b[1]).map(([app]) => app);
}

/** Secondary text per entry key. Entries that share a label in the same profile are told apart by
 * package, by activity inside one package, and by profile number when two profiles of one kind hold
 * the same component; another profile's entries always name the profile. No two entries read alike. */
export function describeLauncherApps(apps: InstalledApp[]): Map<string, string[]> {
  const groups = new Map<string, InstalledApp[]>();
  for (const app of apps) { const id = `${fold(app.label)}\n${app.profile || ''}`; groups.set(id, [...(groups.get(id) || []), app]); }
  const short = (app: InstalledApp) => app.activityName ? app.activityName.slice(app.activityName.lastIndexOf('.') + 1) || app.activityName : '';
  const details = new Map<string, string[]>();
  for (const group of groups.values()) {
    for (const app of group) {
      const parts: string[] = [];
      if (app.profile) parts.push(PROFILE_LABEL[app.profile] + (app.locked ? ' · locked' : ''));
      if (group.length > 1) {
        const packageLabel = app.packageName.startsWith('alpha:') ? 'Alpha Phone' : app.packageName;
        const siblings = group.filter(other => other.packageName === app.packageName);
        const before = parts.length;
        if (siblings.length < group.length) parts.push(packageLabel);
        if (siblings.length > 1 && app.activityName) {
          parts.push(siblings.filter(other => short(other) === short(app)).length === 1 ? short(app) : app.activityName);
          if (app.user && siblings.filter(other => other.activityName === app.activityName).length > 1) parts.push(`profile ${app.user}`);
        }
        if (parts.length === before) parts.push(packageLabel);
      }
      details.set(appKey(app), parts);
    }
  }
  // Last resort for shapes the rules above do not separate (a profile entry without an activity,
  // an activity whose short name reads like a profile): rows that still read the same get their
  // full identity, so two different entries are never presented as one.
  const shown = new Map<string, InstalledApp[]>();
  for (const app of apps) { const id = `${fold(app.label)}\n${(details.get(appKey(app)) || []).join('\n')}`; shown.set(id, [...(shown.get(id) || []), app]); }
  for (const same of shown.values()) {
    if (new Set(same.map(appKey)).size < 2) continue;
    for (const app of same) {
      const parts = details.get(appKey(app)) || [];
      for (const part of [app.packageName, app.activityName, app.user ? `profile ${app.user}` : '']) if (part && !parts.includes(part)) parts.push(part);
    }
  }
  return details;
}

const valid = (value: unknown): value is InstalledApp => !!value && typeof value === 'object'
  && typeof (value as Bag).packageName === 'string' && !!(value as Bag).packageName
  && typeof (value as Bag).label === 'string'
  && ((value as Bag).icon === undefined || (typeof (value as Bag).icon === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test((value as Bag).icon)))
  && ((value as Bag).activityName === undefined || (typeof (value as Bag).activityName === 'string' && !!(value as Bag).activityName))
  && ((value as Bag).user === undefined || (typeof (value as Bag).user === 'string' && /^\d{1,19}$/.test((value as Bag).user)))
  && ((value as Bag).profile === undefined || PROFILES.includes((value as Bag).profile))
  && ((value as Bag).locked === undefined || typeof (value as Bag).locked === 'boolean');

const cleanKeys = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((key): key is string => typeof key === 'string' && !!key && key.length <= 512 && !seen.has(key) && !!seen.add(key)).slice(0, MAX_FAVORITES);
};
/** Favorites in this origin's localStorage. A missing setting is distinct from an explicitly empty list; malformed data preserves an empty choice. */
export function localFavorites(storage: () => Storage = () => globalThis.localStorage): FavoritesStore {
  const legacyDefaults = (): string[] | null => {
    try {
      const saved = JSON.parse(storage().getItem(FAVORITES_KEY) || 'null');
      return saved?.version === 2 && Object.keys(saved).sort().join(',') === 'keys,version'
        && Array.isArray(saved.keys) && saved.keys.length <= MAX_FAVORITES
        && cleanKeys(saved.keys).length === saved.keys.length ? saved.keys : null;
    } catch { return null; }
  };
  return {
    read() { try { const raw = storage().getItem(FAVORITES_KEY); if (raw === null) return null; const saved = JSON.parse(raw); return (saved?.version === 1 || saved?.version === 2) ? cleanKeys(saved.keys) : []; } catch { return []; } },
    legacy() { try { return JSON.parse(storage().getItem(FAVORITES_KEY) || 'null')?.version === 1; } catch { return false; } },
    legacyHomeDefaults: () => legacyDefaults() !== null,
    write(keys) {
      const original = legacyDefaults();
      let previousDefaults: string[] | null = null;
      try { const saved = JSON.parse(storage().getItem(FAVORITES_KEY) || 'null'); if (Array.isArray(saved?.previousDefaults)) previousDefaults = cleanKeys(saved.previousDefaults); } catch { /* Keep the existing explicit write behavior. */ }
      // Retain the old default's choices once; this is migration evidence, not a second live list.
      storage().setItem(FAVORITES_KEY, JSON.stringify({version: 2, keys, defaultPolicy: 'alpha-apps', ...((previousDefaults || original) ? {previousDefaults: previousDefaults || original} : {})}));
    },
  };
}

/** Reads installed apps on each open and whenever Android reports a change (installs and removals
 * happen outside Alpha), and launches only from an explicit tap. Failures stay visible; nothing is
 * retried automatically. */
export function createLauncher(bridge: LauncherBridge, changed: () => void, options: {icons?: boolean; favorites?: FavoritesStore; aliases?: Record<string, string>} = {}) {
  const store = options.favorites;
  const rawSaved = store ? store.read() : [];
  const saved = rawSaved === null ? null : cleanKeys(rawSaved.map(key => options.aliases?.[key] || key));
  let migrationPending = !!store?.legacy?.();
  let legacyHomeDefaultsPending = !!store?.legacyHomeDefaults?.();
  let defaultsPending = saved === null;
  let builtins: InstalledApp[] = [];
  let state: LauncherSnapshot = {status: 'idle', apps: [], dial: null, launching: null, launchError: null, favorites: saved || []};
  let generation = 0;
  const update = (patch: Partial<LauncherSnapshot>) => { state = {...state, ...patch}; changed(); };
  const message = (error: unknown) => error instanceof Error && error.message ? error.message : String(error || 'Unavailable');
  const saveFavorites = (favorites: string[]) => {
    if (!store) { update({launchError: 'Favorites cannot be saved on this device.'}); return; }
    try { store.write(favorites); defaultsPending = false; migrationPending = false; legacyHomeDefaultsPending = false; update({favorites, launchError: null}); }
    catch { update({launchError: 'Favorites could not be saved. Nothing changed.'}); }
  };
  const installed = (key: string) => state.apps.some(app => appKey(app) === key);
  async function load(mode: {quiet?: boolean} = {}) {
    const current = ++generation;
    // A quiet refresh keeps the visible list and any launch error until the new read lands.
    update(mode.quiet && state.status !== 'idle' ? {} : {status: 'loading', launchError: null});
    const [listed, dial] = await Promise.allSettled([
      bridge.list(options.icons ? {icons: true} : undefined),
      bridge.resolveDefault ? bridge.resolveDefault({role: 'dial'}) : Promise.reject(Error('Unsupported')),
    ]);
    if (current !== generation) return;
    const dialApp = dial.status === 'fulfilled' && dial.value && dial.value.available === true ? dial.value : null;
    // A failed read never leaves an older inventory on screen as if it were current.
    if (listed.status === 'rejected' || !Array.isArray(listed.value?.apps)) { update({status: 'failed', apps: [...builtins], dial: dialApp}); return; }
    const seen = new Set<string>();
    const apps = [...builtins, ...listed.value.apps.filter(valid).filter(app => !options.aliases?.[appKey(app)])].filter(app => !seen.has(appKey(app)) && !!seen.add(appKey(app)));
    if (defaultsPending || migrationPending || legacyHomeDefaultsPending) {
      const liveSaved = store ? store.read() : [];
      const unchanged = rawSaved === null ? liveSaved === null : liveSaved !== null && rawSaved.length === liveSaved.length && rawSaved.every((key, index) => key === liveSaved[index]);
      if (!unchanged || (legacyHomeDefaultsPending && !store?.legacyHomeDefaults?.()) || (migrationPending && !store?.legacy?.())) {
        // An explicit choice made while the inventory read was pending wins.
        defaultsPending = migrationPending = legacyHomeDefaultsPending = false;
        update({status: 'ready', apps, dial: dialApp, favorites: cleanKeys((liveSaved || []).map(key => options.aliases?.[key] || key))});
        return;
      }
      let favorites = defaultsPending ? (builtins.length ? builtins : apps).map(appKey) : state.favorites;
      if (legacyHomeDefaultsPending && builtins.length) {
        const currentKeys = apps.map(appKey), current = new Set(currentKeys), product = new Set(builtins.map(appKey));
        const visible = favorites.filter(key => current.has(key));
        if (visible.length === currentKeys.length && visible.every((key, index) => key === currentKeys[index]))
          favorites = favorites.filter(key => product.has(key) || !current.has(key));
      }
      try { store?.write(favorites); defaultsPending = false; migrationPending = false; legacyHomeDefaultsPending = false; state = {...state, favorites}; }
      catch { state = {...state, favorites, launchError: 'Favorites could not be saved.'}; }
    }
    update({status: 'ready', apps, dial: dialApp});
  }
  return {
    snapshot: () => state,
    /** Product apps already passed the shell's capability policy. Never dispatch these to Android. */
    setBuiltins(apps: InstalledApp[]) {
      const old = new Set(builtins.map(appKey));
      builtins = apps;
      state = {...state, apps: [...builtins, ...state.apps.filter(app => !old.has(appKey(app))) ]};
      if (defaultsPending) state = {...state, favorites: (builtins.length ? builtins : state.apps).map(appKey)};
      else if (migrationPending) state = {...state, favorites: cleanKeys([...state.favorites, ...builtins.map(appKey)])};
    },
    load,
    /** Re-reads after an outside change. Does nothing before the first open; never shows the loading state over a list. */
    async refresh() { if (state.status !== 'idle') await load({quiet: true}); },
    async launch(app: InstalledApp) {
      if (state.launching) return;
      const key = appKey(app);
      // Only an entry from the current read can be opened; a removed one is never sent to Android.
      if (!installed(key)) { update({launchError: `${app.label} is no longer installed.`}); return; }
      update({launching: key, launchError: null});
      const target: LaunchTarget = {packageName: app.packageName};
      if (app.activityName) target.activityName = app.activityName;
      if (app.user) target.user = app.user;
      try { await bridge.launch(target); update({launching: null}); }
      catch (error) {
        update({launching: null, launchError: `${app.label} could not be opened. ${message(error)}`});
        // The entry may be gone, disabled or locked now: show the device's current list. This is a
        // full read, so one it overtakes (the drawer was still opening) cannot strand the loading state.
        await load({quiet: true});
      }
    },
    async openDial() {
      if (state.launching || !state.dial || !bridge.openDefault) return;
      const label = state.dial.label || 'Phone';
      update({launching: 'dial', launchError: null});
      try { await bridge.openDefault({role: 'dial'}); update({launching: null}); }
      catch (error) {
        update({launching: null, launchError: `${label} could not be opened. ${message(error)}`});
        // The handler may have been removed or disabled: re-resolve it so a dead shortcut does not stay.
        await load({quiet: true});
      }
    },
    isFavorite: (app: InstalledApp) => state.favorites.includes(appKey(app)),
    /** Installed favorites in the saved order. A saved favorite that is not installed is not shown. */
    favoriteApps(): InstalledApp[] {
      const byKey = new Map(state.apps.map(app => [appKey(app), app] as const));
      return state.favorites.map(key => byKey.get(key)).filter((app): app is InstalledApp => !!app);
    },
    toggleFavorite(app: InstalledApp) {
      const key = appKey(app);
      if (state.favorites.includes(key)) { saveFavorites(state.favorites.filter(item => item !== key)); return; }
      if (!installed(key)) return;
      // Room is made from favorites that are no longer installed before refusing a new one.
      let kept = state.favorites;
      if (kept.length >= MAX_FAVORITES) kept = kept.filter(installed);
      if (kept.length >= MAX_FAVORITES) { update({launchError: `You can keep ${MAX_FAVORITES} favorites. Remove one to add ${app.label}.`}); return; }
      saveFavorites([...kept, key]);
    },
    /** Moves a favorite one place among the installed favorites; uninstalled ones keep their slots. */
    moveFavorite(app: InstalledApp, direction: -1 | 1) {
      const key = appKey(app), visible = state.favorites.filter(installed), at = visible.indexOf(key), other = visible[at + direction];
      if (at < 0 || !other) return;
      const next = [...state.favorites], a = next.indexOf(key), b = next.indexOf(other);
      next[a] = other; next[b] = key;
      saveFavorites(next);
    },
    /** Drops a stale launch error (new search or reopened drawer). An in-flight read keeps its
     * generation, so typing while apps load never strands the drawer in its loading state. */
    clearError() { if (state.launchError) state = {...state, launchError: null}; },
  };
}
export type Launcher = ReturnType<typeof createLauncher>;

/** Home's All-apps drawer. Shell state (open, query) lives in the model so Back and Home close
 * it; the installed list lives here. */
export function installHomeLauncher(Component: any, bridge: LauncherBridge, options: {icons?: boolean; favorites?: FavoritesStore; /** Exact browser device mirrors only; never infer aliases from labels. */ aliases?: Record<string, string>; /** False when the bridge cannot report package changes; the drawer still re-reads on open and on resume. */ follow?: boolean} = {}) {
  const p = Component.prototype, mount = p.componentDidMount, unmount = p.componentWillUnmount, render = p.renderVals;
  let owner: any = null;
  const builtinRows = new Map<string, Bag>();
  const listFocus = createKeyedListFocus('data-launcher-focus');
  const launcherBridge: LauncherBridge = {...bridge,
    list: options => bridge.list(options),
    launch: target => { const app = builtinRows.get(appKey(target)); if (app) { app.open(); return Promise.resolve(); } return bridge.launch(target); },
    resolveDefault: bridge.resolveDefault ? options => bridge.resolveDefault!(options) : undefined,
    openDefault: bridge.openDefault ? options => bridge.openDefault!(options) : undefined,
  };
  const launcher = createLauncher(launcherBridge, () => owner?.setState({launcherRevision: Date.now()}), {...options, favorites: options.favorites || localFavorites()});
  // Home and the drawer follow package changes and anything that happened while Alpha was away.
  // Android reports one install or update as several changes; they are read once, shortly after.
  let pending: ReturnType<typeof setTimeout> | null = null;
  const refresh = () => {
    if (pending || !owner) return;
    pending = setTimeout(() => { pending = null; if (owner) void launcher.refresh(); }, 120);
  };
  const visible = () => { if (!document.hidden) refresh(); };
  let subscription: unknown = null;
  p.componentDidMount = function (...args: any[]) {
    owner = this;
    document.addEventListener('visibilitychange', visible); document.addEventListener('resume', refresh);
    try { subscription = options.follow !== false && bridge.addListener ? Promise.resolve(bridge.addListener('appsChanged', refresh)).catch(() => null) : null; } catch { subscription = null; }
    const result = mount?.apply(this, args);
    // Alpha's built-ins need no package scan. Read native entries only for saved shortcuts;
    // the drawer already performs its own current read when explicitly opened.
    if (launcher.snapshot().favorites.some(key => !key.startsWith('alpha:'))) void launcher.load();
    return result;
  };
  p.componentWillUnmount = function (...args: any[]) {
    document.removeEventListener('visibilitychange', visible); document.removeEventListener('resume', refresh);
    if (pending) { clearTimeout(pending); pending = null; }
    void Promise.resolve(subscription).then((handle: any) => handle?.remove?.()).catch(() => {});
    subscription = null; if (owner === this) owner = null;
    return unmount?.apply(this, args);
  };
  p.openAllApps = function () { this.setState({drawer: true, drawerQ: ''}); void launcher.load(); };
  p.renderVals = function () {
    const snapshot = typeof document === 'undefined' ? null : listFocus.capture();
    const out = render.call(this), S = this.S(), self = this;
    builtinRows.clear();
    const builtins = (out.apps || []).map((app: Bag) => {
      const key = `alpha:${app.key}`;
      builtinRows.set(key, app);
      return {packageName: key, label: app.label};
    });
    launcher.setBuiltins(builtins);
    const snap = launcher.snapshot(), query = String(S.drawerQ || '');
    const details = describeLauncherApps(snap.apps);
    const row = (app: InstalledApp) => {
      const key = appKey(app), parts = details.get(key) || [], name = parts.length ? `${app.label} (${parts.join(', ')})` : app.label, favorite = snap.favorites.includes(key);
      return {
        key, openKey: key + ':open', favoriteKey: key + ':favorite', d: builtinRows.get(key)?.d || out.ic?.grid || '', label: app.label, sub: parts.join(' · '), hasSub: parts.length > 0, aria: `Open ${name}`, hasIcon: !!app.icon, noIcon: !app.icon, icon: app.icon || '',
        busy: snap.launching === key, disabled: !!snap.launching,
        open: () => void launcher.launch(app),
        favorite, favoriteAria: favorite ? `Remove ${name} from favorites` : `Add ${name} to favorites`, favoriteFill: favorite ? 'currentColor' : 'none', favoriteColor: favorite ? 'var(--fg)' : 'var(--mut)',
        toggleFavorite: () => launcher.toggleFavorite(app),
      };
    };
    const matching = filterLauncherApps(snap.apps, query);
    const pinned = query.trim() ? [] : launcher.favoriteApps();
    const pinnedKeys = new Set(pinned.map(appKey));
    // Favorites already appear above the inventory. Search returns all matches;
    // an unfiltered drawer shows every entry once, with its existing controls.
    const rows = matching.filter(app => !pinnedKeys.has(appKey(app))).map(row);
    const favorites = pinned.map((app, index) => {
      const base = row(app), name = base.aria.slice('Open '.length);
      return {...base, earlierKey: base.key + ':earlier', laterKey: base.key + ':later', earlierAria: `Move ${name} earlier`, laterAria: `Move ${name} later`, first: index === 0, last: index === pinned.length - 1,
        earlier: () => launcher.moveFavorite(app, -1), later: () => launcher.moveFavorite(app, 1)};
    });
    const dial = snap.dial && !query.trim() ? {
      label: 'Phone', aria: snap.dial.label ? `Open Phone (${snap.dial.label})` : 'Open Phone', sub: snap.dial.label || 'Choose a phone app',
      hasIcon: !!snap.dial.icon, noIcon: !snap.dial.icon, icon: snap.dial.icon || '', disabled: !!snap.launching,
      open: () => void launcher.openDial(),
    } : null;
    const status = snap.status === 'loading' || snap.status === 'idle' ? 'Reading installed apps…'
      : snap.status === 'failed' ? 'Installed apps could not be read.'
      : !query.trim() && !snap.apps.some(app => !builtinRows.has(appKey(app))) ? 'No other apps are installed.'
      : !matching.length ? `No apps match “${query.trim()}”.` : '';
    const homeApps = launcher.favoriteApps().map(app => {
      const builtin = builtinRows.get(appKey(app));
      return builtin ? {...builtin, hasIcon: false, noIcon: true} : {...row(app), badge: false};
    });
    return {...out, apps: homeApps, drawerOpen: !!S.drawer && !!out.isOn && !out.isView, launcher: {
      listFocus: listFocus.ref(snapshot),
      open: () => self.openAllApps(), close: () => self.setState({drawer: false, drawerQ: ''}),
      query, onQuery: (event: any) => { launcher.clearError(); self.setState({drawerQ: event.target.value}); },
      rows, hasRows: rows.length > 0, favorites, hasFavorites: favorites.length > 0,
      dial, hasDial: !!dial, status, hasStatus: !!status, failed: snap.status === 'failed',
      retry: () => void launcher.load(), launchError: snap.launchError || '', hasLaunchError: !!snap.launchError,
      count: snap.status === 'ready' ? `${matching.length} ${matching.length === 1 ? 'app' : 'apps'}` : '',
    }};
  };
  return launcher;
}
