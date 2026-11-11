import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '../platform-plugins';
import { devSurfacesEnabled, testMocksEnabled } from '../build-flags';
import { browserDevProfile } from '../browser/dev-profile';
// Flag-off builds resolve this to an inert stub (vite.config.ts disabledModuleSource).
import { createDevelopmentVault } from './dev-vault';
import { createPasswordsClient, passwordsError, type PasswordsClient } from '../../../../vendor/eliza/plugins/plugin-native-passwords/src/client.ts';
import { createTransferClient, type ElizaPasswordTransferPlugin, type PasswordTransferClient } from '../../../../vendor/eliza/plugins/plugin-native-passwords/src/transfer.ts';
import { filterEntries, normalizeWebsite } from '../../../../vendor/eliza/plugins/plugin-native-passwords/src/bindings.ts';
import type { ElizaPasswordsPlugin, PasswordBinding, PasswordEntrySummary, PasswordsStatus } from '../../../../vendor/eliza/plugins/plugin-native-passwords/src/definitions.ts';

/**
 * Settings → Password manager over the shared plugin-native-passwords vault.
 *
 * Secrets boundary: the renderer only ever holds a password the user is typing for this form
 * (module memory, cleared once saved, and on leave, lock, unlock expiry and background). An edit
 * draft's name, username and websites outlive an unlock expiry in module memory, hidden until a
 * fresh unlock. Native responses are metadata,
 * revalidated by the shared client. Nothing here is written to view state, storage, the agent
 * context, logs or toasts. While any password page is open the agent observation is paused
 * (see passwordSurfaceOpen in agent-adapter.ts).
 */
type Bag = Record<string, any>;
type Draft = { id?: string; label: string; username: string; website: string; keep: PasswordBinding[]; password: string; passwordDropped?: boolean; generate: boolean; length: number; confirmDelete: boolean; error: string };
export const PASSWORD_PAGES: readonly string[] = ['password-provider', 'password-entry'];
export const passwordSurfaceOpen = (settings: Bag | undefined | null) => PASSWORD_PAGES.includes(String(settings?.page || ''));

let client: PasswordsClient | null | undefined;
let resolving: Promise<PasswordsClient | null> | undefined;
let status: PasswordsStatus | null = null, entries: PasswordEntrySummary[] | null = null;
let query = '', busy = '', notice = '', draft: Draft | null = null, generation = 0, lifetime = 0, operation = 0, active = false;
// The vault key was lost or invalidated (for example, the screen lock was removed): the records
// can never be decrypted, and the only action is a confirmed, freshly unlocked reset.
let damaged = false, confirmReset: number | null = null;
let expiry: ReturnType<typeof setTimeout> | undefined;
// Whether Alpha's browser can attest which site owns a login field (WebView capability only).
let browserFill: { available: boolean } | null = null;
let notify: () => void = () => {};
// Outcome notices surface once as a toast, not as a row.
let toast: (message: string) => void = () => {};

/** Native vault on Android; the flag-only development vault in the browser dev profile; else none. */
function resolveClient(): Promise<PasswordsClient | null> {
  if (client !== undefined) return Promise.resolve(client);
  resolving ||= (async () => {
    if (Capacitor.isNativePlatform()) client = createPasswordsClient(registerPlugin<ElizaPasswordsPlugin>('ElizaPasswords'));
    else if (devSurfacesEnabled && browserDevProfile) client = createPasswordsClient(createDevelopmentVault());
    else client = null;
    return client;
  })();
  return resolving;
}

/** Transfers run natively and expose only counts validated by the shared client. */
let transfer: PasswordTransferClient | null | undefined;
function transferClient(): PasswordTransferClient | null {
  if (transfer !== undefined) return transfer;
  if (!testMocksEnabled || !Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('ElizaPasswordTransfer')) return transfer = null;
  return transfer = createTransferClient(registerPlugin<ElizaPasswordTransferPlugin>('ElizaPasswordTransfer'));
}

function clearSecrets() { if (draft) draft.password = ''; draft = null; }
function lockState(message: string) {
  ++generation; confirmReset = null;
  entries = null; if (status) status = { ...status, locked: true, unlockRemainingMs: 0 };
  if (expiry) clearTimeout(expiry); expiry = undefined; notice = message;
}
/** Leave, background, explicit Lock and a damaged vault forget everything, the open draft included. */
function locked(message = '') { clearSecrets(); lockState(message); }
/** The unlock window ended: drop the typed password but keep the draft, hidden until a fresh unlock. */
function expired(message: string) {
  if (draft) { if (draft.password) draft.passwordDropped = true; draft.password = ''; draft.confirmDelete = false; }
  lockState(message);
}

/** Native browser capability; no tab, page or credential data crosses this call. */
async function refreshBrowserFill(current: () => boolean) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const result = await registerPlugin<{ loginFillStatus(): Promise<{ available?: unknown }> }>('AlphaBrowser').loginFillStatus();
    if (current()) browserFill = { available: result?.available === true };
  } catch { if (current()) browserFill = null; }
}

async function refresh() {
  if (!active || document.hidden) return;
  confirmReset = null;
  const token = ++generation, visit = lifetime;
  const current = () => active && !document.hidden && token === generation && visit === lifetime;
  void refreshBrowserFill(current).then(() => { if (current()) notify(); });
  const vault = await resolveClient();
  if (!current()) return;
  if (!vault) { notify(); return; }
  try {
    const next = await vault.status();
    if (!current()) return;
    status = next;
    if (next.locked) { expired(notice); notify(); return; }
    else {
      const list = await vault.list();
      if (!current()) return;
      entries = list;
      if (expiry) clearTimeout(expiry);
      // Reflect the native unlock window; native code enforces it independently.
      expiry = setTimeout(() => { expired('Locked'); notify(); }, Math.max(1000, next.unlockRemainingMs));
    }
  } catch (error) {
    if (!current()) return;
    const failure = passwordsError(error);
    if (failure.code === 'locked') expired('Locked.');
    else { if (failure.code === 'key-invalidated') { damaged = true; locked(); } notice = failure.message; }
  }
  notify();
}

async function run(name: string, task: (vault: PasswordsClient, current: () => boolean) => Promise<void>, fail?: (message: string) => void) {
  const visit = lifetime, current = () => active && !document.hidden && visit === lifetime;
  if (!current() || busy) return;
  const vault = await resolveClient();
  if (!vault || !current() || busy) return;
  const ticket = ++operation;
  busy = name; notice = ''; notify();
  try { await task(vault, current); }
  catch (error) {
    if (!current()) return;
    confirmReset = null;
    const failure = passwordsError(error);
    if (failure.code === 'locked') expired('Locked.');
    else if (failure.code === 'key-invalidated') { damaged = true; locked(failure.message); }
    else if (draft && (name === 'save' || name === 'remove')) draft.error = failure.message;
    else if (fail) fail(failure.message);
    else notice = failure.message;
    // Transfer can stop after changing the selected file or vault. Never lose
    // this warning when the generic vault mapper replaces native error text.
    if (name === 'export') notice = 'Export failed · delete file';
    else if (name === 'import') notice = 'Import failed';
  } finally { if (ticket === operation) { busy = ''; if (active && !document.hidden) notify(); } }
}

/** Leaving New or Edit password for the list forgets the typed password; the list stays unlocked. */
export function leavePasswordEntry() { clearSecrets(); }

/** Leaving the password pages, unmounting or backgrounding locks and forgets everything. */
export function leavePasswordManager() {
  if (!active) return;
  active = false; ++lifetime; ++operation; busy = ''; query = ''; notice = ''; damaged = false; locked();
  void resolveClient().then(vault => vault?.lock()).catch(() => {});
}

export function passwordManagerLifecycle(changed: () => void) {
  notify = changed;
  const hidden = () => { if (document.hidden) { leavePasswordManager(); notify(); } };
  document.addEventListener('visibilitychange', hidden);
  window.addEventListener('pagehide', leavePasswordManager);
  return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', leavePasswordManager); leavePasswordManager(); };
}

/** True while the password pages hold an unlocked listing (metadata only). */
export const passwordManagerHoldsEntries = () => active && entries !== null;

/** Called by the Settings refresh (open, resume, explicit refresh) while the page is shown. */
export function refreshPasswordManager() { if (active) void refresh(); }

interface Helpers { info(label: string, val: string): Bag; group(rows: Bag[]): Bag; toast(message: string): void; set(patch: Bag): void; ic: Bag }

// `lucide` names the row icon (public/icons/lucide); `trail` is an inline trailing glyph path.
const nav = (label: string, go: () => void, extra: Bag = {}): Bag => ({ kNav: true, label, lbl: extra.aria || label, chev: !extra.val && !extra.trail, noAB: true, go, hasSub: !!extra.sub, sub: extra.sub || '', hasVal: !!extra.val, val: extra.val || '', busy: !!busy, ...(extra.lucide ? { lucide: extra.lucide } : {}), ...(extra.trail ? { hasTrail: true, trail: extra.trail, trailCss: extra.trailCss || 'color:var(--mut)' } : {}), ...(extra.labCss ? { labCss: extra.labCss } : {}) });
const button = (label: string, go: () => void, primary = false, disabled = false, icon = ''): Bag => ({ kBtn: true, label, go, dis: disabled || !!busy, noAB: true, css: primary && !disabled ? 'background:var(--acc);color:#fff' : 'background:var(--s2)', ...(icon ? { hasIcon: true, d: icon } : {}) });
const iconInfo = (helpers: Helpers, label: string, val: string, icon: string): Bag => ({ ...helpers.info(label, val), ...(helpers.ic[icon] ? { hasIcon: true, d: helpers.ic[icon] } : {}) });
const input = (ic: Bag, label: string, placeholder: string, type: string, value: string, change: (value: string) => void, icon = 'lock'): Bag => ({ kInput: true, label, ph: placeholder, type, value, d: ic[icon] || ic.lock, hasIcon: true, noAB: true, change: (event: Event) => change((event.target as HTMLInputElement).value) });
const captioned = (helpers: Helpers, cap: string, rows: Bag[], plain = false): Bag => ({ ...helpers.group(rows), ...(plain ? { css: 'display:flex;flex-direction:column;gap:10px' } : {}), cap, hasCap: !!cap });

function openEntry(helpers: Helpers, entry: PasswordEntrySummary | null) {
  if (!active || document.hidden) return;
  clearSecrets();
  draft = { id: entry?.id, label: entry?.label || '', username: entry?.username || '', website: '', keep: entry ? [...entry.bindings] : [], password: '', generate: false, length: 20, confirmDelete: false, error: '' };
  helpers.set({ page: 'password-entry' });
}

function save(helpers: Helpers) {
  const current = draft; if (!current) return;
  current.error = '';
  let websites: string[];
  try { websites = current.website.split(/[\s,]+/).filter(Boolean).map(normalizeWebsite); }
  catch (error) { current.error = (error as Error).message; notify(); return; }
  if (!current.label.trim()) { current.error = 'Enter a name.'; notify(); return; }
  if (!websites.length && !current.keep.length) { current.error = 'Add a website'; notify(); return; }
  // An empty field after expiry dropped a typed password must not quietly keep the old one.
  if (current.passwordDropped && !current.generate && !current.password) { current.error = 'Type the new password again.'; notify(); return; }
  if (!current.id && !current.generate && !current.password) { current.error = 'Password needed'; notify(); return; }
  const secret = current.generate ? undefined : current.password || undefined;
  // The typed password stays in the draft until the vault accepts it, so a retry sends it again.
  void run('save', async (vault, currentRun) => {
    await vault.save({ ...(current.id ? { id: current.id } : {}), label: current.label.trim(), username: current.username, websites, keepBindings: current.keep.map(binding => binding.facet), ...(current.generate ? { generate: { length: current.length } } : secret ? { password: secret } : {}) });
    current.password = '';
    if (!currentRun() || draft !== current) return;
    draft = null;
    notice = 'Saved';
    helpers.set({ page: 'password-provider' });
    await refresh();
  });
}

/** Rows for Settings → Password manager, placed above the other-provider (Proton) section. */
export function passwordManagerGroups(helpers: Helpers): Bag[] {
  if (document.hidden) return [];
  if (!active) { active = true; notice = ''; void refresh(); }
  toast = helpers.toast;
  const vault = client;
  if (vault === undefined) return [helpers.group([helpers.info('Saved passwords', 'Checking…')])];
  if (vault === null) return [];
  const groups: Bag[] = [];
  const head: Bag[] = [];
  if (!status) head.push(helpers.info('Saved passwords', notice || 'Checking…'));
  else if (!status.available) head.push(iconInfo(helpers, 'Saved passwords', status.reason === 'no-screen-lock' ? 'Needs screen lock' : 'Unavailable', 'lock'));
  else if (damaged) {
    head.push(iconInfo(helpers, 'Vault', 'Damaged', 'info'));
    // Irreversible: the confirm keeps a one-line consequence.
    head.push(nav(busy === 'reset' ? 'Resetting…' : confirmReset !== null ? 'Confirm reset' : 'Reset vault', () => {
      if (confirmReset === null) { confirmReset = generation; notify(); return; }
      const reviewed = confirmReset;
      void run('reset', async (v, current) => {
        const reviewedNow = () => current() && damaged && confirmReset === reviewed && generation === reviewed;
        if (!reviewedNow()) return;
        await v.unlock(); if (!reviewedNow()) return;
        await v.reset(); if (!current()) return;
        damaged = false; confirmReset = null; notice = 'Vault reset'; await refresh();
      });
    }, { sub: confirmReset !== null && busy !== 'reset' ? 'Can’t be undone.' : '', aria: confirmReset !== null ? 'Confirm reset vault' : 'Reset vault', labCss: 'color:var(--warn)', lucide: 'trash-2' }));
  }
  else if (status.locked || !entries) {
    head.push(nav(busy === 'unlock' ? 'Unlocking…' : 'Unlock', () => void run('unlock', async (v, current) => { await v.unlock(); if (current()) await refresh(); }), { aria: 'Unlock passwords', lucide: status.biometric ? 'fingerprint-pattern' : 'lock-keyhole' }));
  } else {
    head.push(iconInfo(helpers, `Locks in ${status.unlockSeconds || 60}s`, '', 'lock'));
    head.push(nav('Lock', () => void run('lock', async (v, current) => { await v.lock(); if (current()) locked(); }), { aria: 'Lock passwords', lucide: 'lock-keyhole' }));
  }
  // Outcome notices show once as a toast; a notice while the vault status is unknown stays in the row above.
  if (notice && status) { const message = notice; notice = ''; queueMicrotask(() => toast(message)); }
  groups.push(helpers.group(head));
  if (status && !status.locked && entries) {
    groups.push(captioned(helpers, '', [input(helpers.ic, 'Search passwords', 'Search passwords', 'search', query, value => { query = value; notify(); }, 'search'), button('Add password', () => openEntry(helpers, null), true)], true));
    const shown = filterEntries(entries, query);
    groups.push(helpers.group(shown.length ? shown.map(entry => nav(entry.label, () => openEntry(helpers, entry), { sub: entry.username, aria: `Open ${entry.label}`, lucide: 'globe' })) : [helpers.info(entries.length ? 'No matching passwords' : 'No saved passwords', '')]));
    const move = transferClient();
    if (move) groups.push(helpers.group([
      nav(busy === 'import' ? 'Importing…' : 'Import passwords', () => void run('import', async (_vault, current) => {
        try {
          const result = await move.importVault();
          if (!current()) return;
          notice = result.imported ? `Imported ${result.imported} ${result.imported === 1 ? 'password' : 'passwords'}${result.skipped ? `, ${result.skipped} not imported` : ''}.` : 'No passwords were imported.';
        } finally { if (current()) await refresh(); }
      }), { lucide: 'download' }),
      nav(busy === 'export' ? 'Exporting…' : 'Export passwords', () => void run('export', async (_vault, current) => {
        // Native export locks the vault before its fresh authentication, so the list is
        // refreshed after a cancelled or failed export too.
        try {
          const result = await move.exportVault();
          if (!current()) return;
          notice = `Exported ${result.exported}`;
        } finally { if (current()) await refresh(); }
      }), { aria: 'Export passwords, unencrypted file', lucide: 'share-2', trail: helpers.ic.info || '', trailCss: 'color:var(--warn)' }),
    ]));
  }
  if (status) {
    const selection = { 'this-app': 'Alpha', other: 'Other', none: 'None', unknown: '—' }[status.autofill.selected];
    groups.push(captioned(helpers, 'Autofill', [
      helpers.info('Browser autofill', browserFill ? browserFill.available ? 'On' : 'Off' : 'Unavailable'),
      helpers.info('Autofill service', status.autofill.supported === false ? 'Unavailable' : selection),
      // Android's confirmation finishes at once for the selected service, so it is offered only to select Alpha.
      ...(status.autofill.supported === false || status.autofill.selected === 'this-app' ? [] : [nav(busy === 'autofill' ? 'Opening…' : 'Use for autofill', () => void run('autofill', async v => {
        await v.openAutofillSettings();
      }), { lucide: 'external-link' })]),
      nav('Refresh', () => void refresh(), { aria: 'Refresh autofill status', lucide: 'rotate-cw' }),
    ]));
  }
  return groups;
}

/** The add/edit page, or null when no entry is open. */
export function passwordEntryPage(helpers: Helpers, back: () => void): Bag | null {
  const current = draft;
  if (!current) return null;
  const title = current.id ? 'Edit password' : 'New password';
  const leave = () => { clearSecrets(); back(); };
  // Locked with a draft open: an edit draft holds vault metadata, so no field value is shown.
  if (!entries) return { isTop: false, notTop: true, cls: 'enter', z: 5, title, hasTitle: true, backLabel: 'Back to Password manager', back: leave, hero: {}, groups: [helpers.group([
    nav(busy === 'unlock' ? 'Unlocking…' : 'Unlock', () => void run('unlock', async (v, current) => { await v.unlock(); if (current()) await refresh(); }), { aria: 'Unlock passwords', lucide: 'lock-keyhole' }),
  ])] };
  const set = (patch: Partial<Draft>) => { if (!active || document.hidden || draft !== current) return; Object.assign(current, patch, { error: '' }, patch.password || patch.generate ? { passwordDropped: false } : {}); notify(); };
  const groups: Bag[] = [
    captioned(helpers, '', [
      input(helpers.ic, 'Name', 'Name', 'text', current.label, value => set({ label: value }), 'user'),
      input(helpers.ic, 'Username', 'Username or email', 'text', current.username, value => set({ username: value }), 'mail'),
    ], true),
    captioned(helpers, 'Sites', [
      ...current.keep.map(binding => nav(binding.display, () => set({ keep: current.keep.filter(item => item.facet !== binding.facet) }), { aria: `Remove ${binding.display}`, lucide: binding.kind === 'android' ? 'circle-check' : 'globe', trail: helpers.ic.x || '' })),
      input(helpers.ic, 'Add website', 'example.com', 'url', current.website, value => set({ website: value }), 'globe'),
    ]),
    captioned(helpers, 'Password', current.generate ? [
      helpers.info('New password', `${current.length} chars`),
      { kSeg: true, label: 'Length', noAB: true, opts: [16, 20, 32].map(length => ({ label: String(length), on: current.length === length, aria: `Length: ${length}`, css: current.length === length ? 'background:var(--acc);color:#fff' : 'color:var(--mut)', pick: () => set({ length }) })) },
      nav('Type instead', () => set({ generate: false }), { aria: 'Type a password instead', lucide: 'keyboard' }),
    ] : [
      input(helpers.ic, 'Password', current.passwordDropped ? 'Retype' : current.id ? 'Unchanged' : 'Password', 'password', current.password, value => set({ password: value })),
      nav('Generate', () => set({ generate: true, password: '' }), { aria: 'Generate a strong password', lucide: 'sparkles' }),
    ]),
  ];
  if (current.id) {
    const id = current.id;
    groups.push(helpers.group([
      nav('Show password', () => void run('reveal', async v => { await v.reveal(id); }, message => helpers.toast(message)), { lucide: 'eye' }),
      nav('Copy password', () => void run('copy', async (v, current) => { await v.copy(id); if (current()) helpers.toast('Copied'); }, message => helpers.toast(message)), { lucide: 'copy' }),
    ]));
  }
  const actions: Bag[] = [];
  if (current.error) actions.push(helpers.info('Not saved', current.error));
  actions.push(button(busy === 'save' ? 'Saving…' : 'Save', () => save(helpers), true));
  if (current.id) {
    const id = current.id;
    // Irreversible: the confirm keeps a one-line consequence.
    if (current.confirmDelete) actions.push(helpers.info('Can’t be undone.', ''));
    actions.push(button(current.confirmDelete ? 'Confirm delete' : 'Delete', () => {
      if (!current.confirmDelete) { set({ confirmDelete: true }); return; }
      void run('remove', async (v, currentRun) => { await v.remove(id); if (!currentRun()) return; if (draft === current) draft = null; notice = 'Password deleted.'; helpers.set({ page: 'password-provider' }); await refresh(); });
    }, false, false, helpers.ic.trash || ''));
  }
  groups.push(captioned(helpers, '', actions, true));
  return { isTop: false, notTop: true, cls: 'enter', z: 5, title, hasTitle: true, backLabel: 'Back to Password manager', back: leave, hero: {}, groups };
}
