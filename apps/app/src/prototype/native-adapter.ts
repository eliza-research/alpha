import {browserDevProfile} from '../browser/dev-profile';
import { DailyApps, type Action, type NativeResult } from '../daily';
import { askAboutCapture } from './camera-adapter';
import { broaderPageNotice, handoffGate, switchValue, SYSTEM_TILE_SETTINGS_PAGES, tileAccessibleName, tileFactsFromSystemFacts, tileStateText, type SystemTileFacts, type SystemTileKey } from '@elizaos/capacitor-system/settings';
import { captureQuestion, locationMimeTypes } from './context-selection';

type Bag = Record<string, any>;
type Callback = (...args: any[]) => any;
export type PrototypeNativeOptions = {
  /** A picker capability is process-scoped. Do not persist its URI as read authority. */
  onSelection?: (module: string, result: NativeResult, api: Bag) => void;
};
const installed = new WeakSet<object>();
const externalModules = new Set(['phone', 'messages', 'inbox', 'browser', 'camera', 'photos', 'maps', 'calendar', 'contacts', 'files', 'settings', 'wallet', 'workflows']);
const text = (value: unknown) => typeof value === 'string' ? value : '';

// tile-facts:begin (Alpha's tile labels and theme over the shared truthful presentation; test/shade-tile-facts.test.mjs)
/** Only directly observed native facts. A missing key means unknown: no on/off is shown. */
export type TileKey = SystemTileKey;
export type TileFacts = SystemTileFacts;
/** Alpha's tile labels; state, wording and handoff pages are the shared @elizaos/capacitor-system/settings. */
export const tileKeys: Record<string, TileKey> = { 'Wi-Fi': 'wifi', 'Bluetooth': 'bt', 'Do not disturb': 'dnd', 'Agent can listen': 'mic', 'Location': 'loc', 'Airplane mode': 'plane', 'Flashlight': 'torch' };
/** Settings page each tile hands off to (AlphaDevice.openSettings). The flashlight is a direct control. */
export const tileSettingsPages: Partial<Record<TileKey, string>> = SYSTEM_TILE_SETTINGS_PAGES;
/** Android system switches as AlphaDevice.snapshot() read them (the shared SystemFacts keys). */
export const tileFactsFromSnapshot: (snapshot: unknown, torch?: boolean) => TileFacts = tileFactsFromSystemFacts;
export { broaderPageNotice, handoffGate, switchValue, tileAccessibleName, tileStateText };
/** `on` colours the tile; `aria` is its accessible name and `pressed` its toggle state (toggles only). */
export type ShadeTile = { label: string; on?: boolean; aria?: string; pressed?: boolean; css?: string; toggle?: () => void; stateText?: string; [key: string]: unknown };
/** Present tiles with state only from native facts. Hide the flashlight without a native control.
 * Every tile except the flashlight only opens its Android page: Alpha cannot change these switches. */
export function honestTiles(tiles: ShadeTile[], facts: TileFacts, options: { flashlight: boolean; act: (key: TileKey | null, tile: ShadeTile) => void }): ShadeTile[] {
  return tiles.filter(tile => tileKeys[tile.label] !== 'torch' || options.flashlight).map(tile => {
    const key = tileKeys[tile.label] ?? null, fact = key ? facts[key] : undefined;
    const on = typeof fact === 'boolean' ? fact : undefined;
    return { ...tile, on, aria: tileAccessibleName(tile.label, key, on), pressed: key === 'torch' ? on : undefined, stateText: tileStateText(key, on), css: (on ? 'background:var(--acc);color:#fff' : 'background:var(--s2);color:var(--fg)') + ';flex-direction:column;gap:3px', toggle: () => options.act(key, tile) };
  });
}
// tile-facts:end
/** Run each time the owner comes back to the app or its window regains focus (returning from an
 * Android page, or closing Android's own quick settings), so a changed switch is read again. */
export function watchReturnToApp(run: () => void): () => void {
  const check = () => { if (!document.hidden) run(); };
  document.addEventListener('visibilitychange', check); window.addEventListener('focus', check);
  const handle = DailyApps.addListener('appResumed', check).catch(() => null);
  return () => { document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check); void handle.then(listener => listener?.remove()); };
}
/** Keep the prototype's render tree and local navigation; replace simulated effects.
 * Install once before mounting. Component is accepted for the extraction seam but
 * no component internals are patched. Agent/voice/notes persistence are separate.
 */
export function installPrototypeNativeAdapters(
  _Component: unknown,
  views: Record<string, Bag>,
  options: PrototypeNativeOptions = {},
): () => void {
  if (installed.has(views)) return () => {};
  installed.add(views);
  const restore: Array<() => void> = [];
  const busy = new Set<string>();
  const notify = (api: Bag, message: string) => api.toast(message);
  const unavailable = (api: Bag, message = 'This action needs a connected native provider. Nothing has been changed.') => () => notify(api, message);
  async function perform(module: string, api: Bag, action: Action, payload: Bag = {}) {
    if (busy.has(module)) return;
    busy.add(module);
    try {
      const result = await DailyApps.perform({ action, ...payload });
      if (result.status === 'selected') {
        options.onSelection?.(module, result, api);
      } else if (result.status !== 'opened' && result.status !== 'cancelled') {
        notify(api, result.message || 'No installed app can complete this action.');
      }
    } catch {
      notify(api, 'Native action unavailable. Use the installed Android app.');
    } finally { busy.delete(module); }
  }
  function browser(module: string, api: Bag, value: unknown) {
    const raw = text(value).trim();
    let url: URL;
    try {
      if (!raw || /\s/.test(raw)) throw new Error();
      // Never reinterpret javascript:, data:, file:, intent: or credentials as search.
      url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : 'https://' + raw);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error();
      if (url.hostname === 'example.com' || url.hostname.endsWith('.example') || url.hostname === 'search.example') {
        notify(api, 'This is a prototype address. Enter a real website to open it.'); return;
      }
    } catch { notify(api, 'Enter a valid HTTP or HTTPS website without credentials.'); return; }
    return perform(module, api, 'browser', { url: url.href });
  }
  const currentUrl = (st: Bag) => {
    const tab = (st.tabs || []).find((t: Bag) => t.id === st.cur);
    return st.addr || tab?.hist?.[tab.pos] || '';
  };
  const smsPayload = (st: Bag) => ({
    // Only explicit user-entered recipients; seeded people never become real recipients.
    query: typeof st.thread === 'string' && st.thread.startsWith('n:') ? st.thread.slice(2) : '',
    body: text(st.text),
  });
  function mailPayload(st: Bag) {
    const draft = typeof st.compose === 'object' && st.compose ? st.compose : {};
    const recipients = Array.isArray(draft.to) ? draft.to : [draft.to];
    const entered = recipients.concat(st.toQ || '').filter((v: unknown) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && !v.endsWith('.example'));
    return { query: entered.length === 1 ? entered[0] : '', title: text(draft.subject), body: text(draft.body) };
  }
  function calendarPayload(st: Bag) {
    const f = st.form || {};
    const date = new Date(); date.setHours(0, 0, 0, 0);
    const offset = Number(f.off || 0), hour = Number(f.t), duration = Number(f.d);
    if (!text(f.title).trim() || !Number.isFinite(offset) || !Number.isFinite(hour) || !Number.isFinite(duration) || duration <= 0) return null;
    date.setDate(date.getDate() + offset); date.setMinutes(Math.round(hour * 60));
    return { title: text(f.title), body: [text(f.notes), text(f.where)].filter(Boolean).join('\n'), startTime: date.getTime(), endTime: date.getTime() + duration * 3600000 };
  }
  function replacement(module: string, key: string, path: string, row: Bag, st: Bag, api: Bag, original: Callback): Callback | undefined {
    if(browserDevProfile&&['photos','files'].includes(module)&&['askQ','askSearch'].includes(key))return ()=>{
      const query=text(api.get(module).q).trim();if(query)api.composeContentQuestion(module==='files'?'Find the file '+query:query);
    };
    // Camera and Photos questions go to the reviewed local flow with the exact subject: the
    // live frame, or the one saved item that is open. A typed library search names no
    // capture, so it stays visibly unavailable below instead of reaching a capture review.
    const capture = captureQuestion(module, key, path, st);
    if (capture?.kind === 'frame') return () => { if (!askAboutCapture()) notify(api, 'Start the camera, or finish the current capture, then ask again. Nothing has been sent.'); };
    if (capture?.kind === 'item') return () => {
      // Read the open item when pressed: the render that built this control may be stale.
      const open = api.get(module).open;
      if (open !== capture.id || !askAboutCapture({ id: capture.id })) notify(api, 'Open a saved photo or video, then ask again. Nothing has been sent.');
    };
    if (['camera', 'photos', 'files'].includes(module) && ['ask', 'askQ', 'askSearch'].includes(key)) return unavailable(api, 'Content analysis is not connected. No photo or document content has been sent.');
    if (module === 'workflows' && ['run', 'again', 'toggle', 'save'].includes(key)) return unavailable(api, 'Workflow execution is not connected. No automation has been activated or run.');
    const native = (action: Action, payload: Bag = {}) => () => perform(module, api, action, payload);
    if (module === 'phone') {
      if (key === 'dialCall') return () => perform(module, api, 'phone', { query: text(api.get('phone').dial) });
      if (key === 'call' || key === 'play') return native('phone');
      if (['accept', 'decline', 'endCall', 'endScreen', 'alphaAnswer', 'del'].includes(key) || path.includes('controls.') || path.includes('dkeys.')) return unavailable(api, 'Manage calls and voicemail in the Android phone app.');
      if (key === 'send') return native('messages', { body: text(row.text) });
    }
    if (module === 'messages') {
      if (key === 'send' || (key === 'go' && path.includes('.smart.'))) return () => perform(module, api, 'messages', smsPayload(api.get(module)));
      if (key === 'onKey' && path.startsWith('t.')) return (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); void perform(module, api, 'messages', smsPayload(api.get(module))); } };
      if (key === 'call') return native('phone');
      if (key === 'camera') return native('camera');
      if (key === 'pick' && path.includes('.photos.')) return native('photos');
    }
    if (module === 'inbox') {
      if (key === 'send') return () => perform(module, api, 'email', mailPayload(api.get(module)));
      if (['archive', 'del'].includes(key)) return native('inbox');
      if (key === 'addAcct') return native('settings');
    }
    if (module === 'calendar') {
      if (key === 'save') return () => { if (api.get(module).form?.id) { void perform(module, api, 'calendar'); return; } const payload = calendarPayload(api.get(module)); if (payload) void perform(module, api, 'calendar-create', payload); else notify(api, 'Enter a title and valid event time.'); };
      if (key === 'del' || (key === 'go' && /rsvp|responses|invite/i.test(path))) return native('calendar');
      if (key === 'join') return unavailable(api, 'Open a real meeting link in your calendar app.');
    }
    if (module === 'browser') {
      if (key === 'onAddrKey') return (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); void browser(module, api, (e.target as HTMLInputElement)?.value); } else original(e); };
      if (key === 'go' && !path.startsWith('people.')) return () => browser(module, api, row.url || row.host);
      if (['openNews', 'openEnc', 'openBook'].includes(key)) return unavailable(api, 'This page is a visual prototype. Enter a real website in the address field.');
      if (['bookNow', 'cfOk'].includes(key)) return unavailable(api, 'Booking is not connected. No reservation or payment has been made.');
      if (key === 'readAloud') return unavailable(api, 'Read-aloud is not connected.');
      if (key === 'copyLink') return async () => { try { const value = currentUrl(st); if (!value || value === 'newtab') throw new Error(); await navigator.clipboard.writeText(value); notify(api, 'Link copied'); } catch { notify(api, 'Clipboard unavailable'); } };
    }
    if (module === 'camera') {
      if (key === 'vfUp') return () => {}; // The camera adapter supplies real tap-to-focus.
      if (key === 'openLast') return native('photos');
      if (key === 'shutter') return native('camera');
      if (['flip', 'toggleFlash'].includes(key)) return native('camera');
    }
    if (module === 'photos') {
      if (key === 'selStart') return native('photos');
      if (['save', 'del', 'selDel', 'emptyNow', 'play', 'rotate', 'crop', 'fav', 'selFav'].includes(key)) return native('photos');
      if (key === 'send' || key === 'selShare') return unavailable(api, 'Choose and share the real photo in your Android photo app.');
    }
    if (module === 'maps') {
      // Search, Start and Directions belong to maps-adapter; its 'Open in maps app' is the only Maps handoff.
      if (key === 'call') return native('phone');
      if (key === 'web') return unavailable(api, 'Open the real place website from the Android map app.');
      if (['shareEta', 'voice', 'end'].includes(key)) return unavailable(api, 'Live navigation and ETA are managed by the Android map app.');
    }
    if (module === 'contacts') {
      if (key === 'go' && path.startsWith('d.acts.')) {
        if (text(row.label).startsWith('Call ')) return native('phone');
        if (text(row.label).startsWith('Message ')) return native('messages');
        if (text(row.label).startsWith('Email ')) return native('email');
      }
      if (['save', 'del', 'toggleFav'].includes(key)) return native('contacts');
    }
    if (module === 'files') {
      // Photos opens Alpha Photos; each location opens a picker filtered to its kind of file.
      if (key === 'go' && path.startsWith('locs.')) return row.name === 'Photos' ? () => api.open('photos') : native('files', (types => types ? { mime: types } : {})(locationMimeTypes(text(row.name))));
      if (key === 'tap' && row.isFile) return native('files');
      if (key === 'rnKey') return (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); void perform(module, api, 'files'); } };
      if (key === 'go' && path.startsWith('moveTo.')) return native('files');
      if (['play', 'del', 'saveRn', 'selDel', 'move', 'selMove', 'transcribe'].includes(key)) return native('files');
      if (['shareMsg', 'shareMail', 'selShare'].includes(key)) return unavailable(api, 'Choose and share the real file in the Android Files app.');
    }
    if (module === 'wallet') {
      if (key === 'addCal') return native('calendar');
      if (['onNum', 'onCvv', 'onExp', 'onCode', 'onName'].includes(key)) return unavailable(api, 'Payment credentials are not collected by this app.');
      if (['pay', 'auth', 'verify', 'next', 'scan', 'reload', 'remove', 'setDef', 'startPay'].includes(key)) return unavailable(api, 'Wallet payments and verification are not connected. Nothing has been charged or verified.');
    }
    return undefined;
  }
  function walk(value: any, module: string, st: Bag, api: Bag, path = ''): any {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((v, i) => walk(v, module, st, api, path + i + '.'));
    const result: Bag = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = typeof child === 'function'
        ? replacement(module, key, path + key, value, st, api, child as Callback) || child
        : walk(child, module, st, api, path + key + '.');
    }
    return result;
  }
  /** Runs after every later settings adapter: a group left without rows is not drawn. */
  function dropEmptyGroups(out: Bag): Bag {
    if (!out || !Array.isArray(out.stack)) return out;
    for (const page of out.stack) if (page && Array.isArray(page.groups)) page.groups = page.groups.filter((group: Bag) => !Array.isArray(group?.rows) || group.rows.length);
    return out;
  }
  for (const [module, definition] of Object.entries(views)) {
    if (!externalModules.has(module) || typeof definition.render !== 'function') continue;
    const render = definition.render, actions = definition.actions, leave = definition.onLeave, ongoing = definition.ongoing;
    definition.render = (state: Bag, api: Bag) => {
      // Rendering cannot start a fake phone call, navigation timer, capture or booking.
      const renderingApi = ['phone', 'browser', 'camera', 'maps'].includes(module)
        ? { ...api, later: () => {}, laterBg: () => {}, every: () => {}, everyBg: () => {} } : api;
      return walk(render(state, renderingApi), module, state, api);
    };
    if (actions) definition.actions = Object.fromEntries(Object.keys(actions).map(key => [key, (_card: Bag, api: Bag) => notify(api, 'Use the visible app controls to review and complete this action.')]));
    if (['phone', 'camera', 'maps', 'workflows'].includes(module)) definition.ongoing = () => null;
    if (leave && ['phone', 'camera', 'maps'].includes(module)) definition.onLeave = () => {};
    restore.push(() => { definition.render = render; definition.actions = actions; definition.onLeave = leave; definition.ongoing = ongoing; });
  }
  const settings = views.settings;
  if (settings && typeof settings.render === 'function') {
    // Later adapters replace settings.render; keep this pass outermost.
    const finalize = (next: any) => typeof next === 'function' ? (state: Bag, api: Bag) => dropEmptyGroups(next(state, api)) : next;
    let exposed = finalize(settings.render);
    Object.defineProperty(settings, 'render', { configurable: true, enumerable: true, get: () => exposed, set: next => { exposed = finalize(next); } });
    restore.unshift(() => { delete settings.render; settings.render = exposed; });
  }
  return () => { for (const reset of restore) reset(); installed.delete(views); };
}
