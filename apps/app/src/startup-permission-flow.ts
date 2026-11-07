export const startupPermissionKeys = ['notifications', 'microphone', 'camera', 'location'] as const;
export const nativeStartupPermissionKeys = [...startupPermissionKeys, 'calendar', 'photos'] as const;
export type StartupPermissionKey = typeof startupPermissionKeys[number];
export type NativeStartupPermissionKey = typeof nativeStartupPermissionKeys[number];
export type StartupPermissionBridge = {status(): Promise<{granted:boolean;enabled:boolean;requestable?:boolean;denied?:boolean}>;request():Promise<unknown>;openSettings():Promise<unknown>};

export type StartupPermissionState = 'checking' | 'request' | 'settings' | 'ready' | 'unavailable';

/** A selected-photo grant is useful access, never described as the whole library. `limited` marks
 * the only case setup mentions: full access needs no status line. */
export function startupPhotoAccess(value: unknown) {
  const row = value as {scope?: unknown; locked?: unknown} | null;
  if (!row || typeof row.scope !== 'string' || !['full', 'partial', 'selected', 'denied'].includes(row.scope) || typeof row.locked !== 'boolean' || row.locked) throw Error('Photo access unavailable');
  return {granted: row.scope !== 'denied', enabled: row.scope !== 'denied', limited: row.scope === 'selected' || row.scope === 'partial', description: row.scope === 'full' ? 'All photos and videos allowed' : row.scope === 'selected' || row.scope === 'partial' ? 'Selected photos only' : 'Not allowed'};
}

/** Permission metadata only: approximate access is usable without claiming a precise fix. */
export function startupLocationAccess(value: unknown) {
  const row = value as {location?: unknown; accuracy?: unknown} | null;
  if (!row || typeof row.location !== 'string' || !['granted', 'denied', 'prompt', 'prompt-with-rationale'].includes(row.location)) throw Error('Location access unavailable');
  const granted = row.location === 'granted';
  if (granted ? typeof row.accuracy !== 'string' || !['precise', 'approximate'].includes(row.accuracy) : row.accuracy !== 'none') throw Error('Location accuracy unavailable');
  return {granted, enabled: granted, limited: granted && row.accuracy === 'approximate', description: granted ? row.accuracy === 'precise' ? 'Precise location allowed' : 'Approximate location' : 'Not allowed'};
}

/** Connected identity alone does not establish Gmail or Calendar permission. */
export function startupGoogleAccess(accounts: readonly {connected: boolean; connectionId?: string | null; grantedCapabilities: readonly string[]}[]) {
  const connected = accounts.filter(account => account.connected === true && !!account.connectionId);
  return {gmail: connected.some(account => account.grantedCapabilities.includes('google.gmail.triage')), calendar: connected.some(account => account.grantedCapabilities.includes('google.calendar.read'))};
}

/** Nonsecret startup-access memory: the "Not now" dismissal and which OS prompts were already
 * shown, so a chooser close or a cold start neither reopens the panel nor re-prompts. */
export const STARTUP_PERMISSIONS_KEY = 'alpha.startup-permissions.v1';
export const STARTUP_PERMISSIONS_REOPEN = 'alpha:startup-permissions-reopen';
export interface StartupPermissionMemory { dismissed: boolean; attempted: Record<string, true> }
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const defaultStore = (): Store | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };
export function readStartupPermissionMemory(store: Store | null = defaultStore()): StartupPermissionMemory {
  try {
    const value = JSON.parse(store?.getItem(STARTUP_PERMISSIONS_KEY) || 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {dismissed: false, attempted: {}};
    const attempted: Record<string, true> = {};
    if (value.attempted && typeof value.attempted === 'object') for (const [key, flag] of Object.entries(value.attempted)) if (flag === true && /^[a-z]{1,32}$/.test(key)) attempted[key] = true;
    return {dismissed: value.dismissed === true, attempted};
  } catch { return {dismissed: false, attempted: {}}; }
}
/** Best effort: unavailable storage keeps the in-memory behavior for this session. */
export function writeStartupPermissionMemory(patch: Partial<StartupPermissionMemory>, store: Store | null = defaultStore()) {
  const current = readStartupPermissionMemory(store);
  const next = {dismissed: patch.dismissed ?? current.dismissed, attempted: {...current.attempted, ...(patch.attempted || {})}};
  try { store?.setItem(STARTUP_PERMISSIONS_KEY, JSON.stringify(next)); return true; } catch { return false; }
}
/** Settings → "Set up Alpha access" calls this to show the panel again. Prompts already denied
 * stay on the Android-settings path; nothing is requested until the user taps. */
export function reopenStartupPermissions(store: Store | null = defaultStore()) {
  writeStartupPermissionMemory({dismissed: false}, store);
  try { globalThis.dispatchEvent?.(new Event(STARTUP_PERMISSIONS_REOPEN)); } catch { /* No window in tests. */ }
}

/** Requests occur only from an explicit tap; a denial never schedules another prompt, including
 * after a restart when `key` names the persisted attempt. */
export function createStartupPermissionFlow(bridge: {
  status(): Promise<{granted: boolean; enabled: boolean; denied?: boolean; requestable?:boolean}>;
  request(): Promise<unknown>;
  openSettings(): Promise<unknown>;
}, options: {key?: string; store?: Store | null} = {}) {
  const store = options.store === undefined ? defaultStore() : options.store;
  let attempted = !!options.key && readStartupPermissionMemory(store).attempted[options.key] === true;
  let pending = false;
  let state: StartupPermissionState = 'checking';
  let generation = 0;
  async function check(current: number): Promise<StartupPermissionState | null> {
    try {
      const access = await bridge.status();
      if (current !== generation) return null;
      if (typeof access.granted !== 'boolean' || typeof access.enabled !== 'boolean' || access.requestable !== undefined && typeof access.requestable !== 'boolean') throw Error('Unavailable');
      state = access.granted && access.enabled ? 'ready'
        : attempted || access.granted || access.denied || access.requestable === false ? 'settings' : 'request';
    } catch {
      if (current !== generation) return null;
      state = 'unavailable';
    }
    return state;
  }
  return {
    // The owned prompt/settings transaction reads back access when it settles.
    // A resume check during that transaction must not retire its final read.
    refresh: () => pending ? Promise.resolve(null) : check(++generation),
    async enable(): Promise<StartupPermissionState | null> {
      if (pending) return null;
      pending = true;
      const current = ++generation;
      try {
        // Recheck before acting: access may have changed while this panel was open.
        if (await check(current) === null || current !== generation) return null;
        if (state === 'request') {
          attempted = true;
          if (options.key) writeStartupPermissionMemory({attempted: {[options.key]: true}}, store);
          await bridge.request();
        }
        else if (state === 'settings') await bridge.openSettings();
        if (current !== generation) return null;
        return await check(current);
      } catch { return current === generation ? state = 'unavailable' : null; }
      finally { pending = false; }
    },
  };
}
/** Ready's AI line while the account has no plan; names the deployment's Cloud service. */
export function startupPlanNotice(serviceName: string): string { return `AI comes with ${/^[aeiou]/i.test(serviceName) ? 'an' : 'a'} ${serviceName} plan.`; }
