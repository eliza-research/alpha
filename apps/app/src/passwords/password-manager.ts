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
 * Settings → Passwords over the shared plugin-native-passwords vault.
 *
 * Secrets boundary: the renderer only ever holds a password the user is typing for this form
 * (module memory, cleared on save, leave, lock and background). Native responses are metadata,
 * revalidated by the shared client. Nothing here is written to view state, storage, the agent
 * context, logs or toasts. While any password page is open the agent observation is paused
 * (see passwordSurfaceOpen in agent-adapter.ts).
 */
type Bag = Record<string, any>;
type Draft = { id?: string; label: string; username: string; website: string; keep: PasswordBinding[]; password: string; generate: boolean; length: number; confirmDelete: boolean; error: string };
export const PASSWORD_PAGES: readonly string[] = ['password-provider', 'password-entry'];
export const passwordSurfaceOpen = (settings: Bag | undefined | null) => PASSWORD_PAGES.includes(String(settings?.page || ''));

let client: PasswordsClient | null | undefined;
let resolving: Promise<PasswordsClient | null> | undefined;
let status: PasswordsStatus | null = null, entries: PasswordEntrySummary[] | null = null;
let query = '', busy = '', notice = '', draft: Draft | null = null, generation = 0, active = false;
// The vault key was lost or invalidated (for example, the screen lock was removed): the records
// can never be decrypted, and the only action is a confirmed, freshly unlocked reset.
let damaged = false, confirmReset = false;
let expiry: ReturnType<typeof setTimeout> | undefined;
// Whether Alpha's browser can attest which site owns a login field (WebView capability only).
let browserFill: { available: boolean } | null = null;
let notify: () => void = () => {};

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
/** Leaving the entry page forgets its draft, typed password included; the vault stays as it is. */
export function clearPasswordDraft() { clearSecrets(); }
/** Whether an entry draft (which may hold a typed password) is held in memory. */
export const passwordDraftHeld = () => draft !== null;
function locked(message = '') {
  entries = null; clearSecrets(); if (status) status = { ...status, locked: true, unlockRemainingMs: 0 };
  if (expiry) clearTimeout(expiry); expiry = undefined; notice = message;
}

/** Native browser capability; no tab, page or credential data crosses this call. */
async function refreshBrowserFill() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const result = await registerPlugin<{ loginFillStatus(): Promise<{ available?: unknown }> }>('AlphaBrowser').loginFillStatus();
    browserFill = { available: result?.available === true };
  } catch { browserFill = null; }
}

async function refresh() {
  void refreshBrowserFill().then(() => notify());
  const token = ++generation, vault = await resolveClient();
  if (!vault || token !== generation) { notify(); return; }
  try {
    const next = await vault.status();
    if (token !== generation) return;
    status = next;
    if (next.locked) locked(notice);
    else {
      const list = await vault.list();
      if (token !== generation) return;
      entries = list;
      if (expiry) clearTimeout(expiry);
      // Reflect the native unlock window; native code enforces it independently.
      expiry = setTimeout(() => { locked('Locked after inactivity.'); notify(); }, Math.max(1000, next.unlockRemainingMs));
    }
  } catch (error) {
    if (token !== generation) return;
    const failure = passwordsError(error);
    if (failure.code === 'locked') locked('Locked after inactivity.');
    else { if (failure.code === 'key-invalidated') { damaged = true; locked(); } notice = failure.message; }
  }
  notify();
}

async function run(name: string, task: (vault: PasswordsClient) => Promise<void>) {
  const vault = await resolveClient();
  if (!vault || busy) return;
  busy = name; notice = ''; notify();
  try { await task(vault); }
  catch (error) {
    const failure = passwordsError(error);
    if (failure.code === 'locked') locked('Locked after inactivity.');
    else if (failure.code === 'key-invalidated') { damaged = true; locked(failure.message); }
    else if (draft && (name === 'save' || name === 'remove')) draft.error = failure.message;
    else notice = failure.message;
    // Transfer can stop after changing the selected file or vault. Never lose
    // this warning when the generic vault mapper replaces native error text.
    if (name === 'export') notice = 'Export did not complete. The selected file may contain passwords; delete it if you do not need it.';
    else if (name === 'import') notice = 'Import did not complete. Check saved passwords before trying again.';
  } finally { busy = ''; notify(); }
}

/** Leaving the password pages, unmounting or backgrounding locks and forgets everything. */
export function leavePasswordManager() {
  if (!active) return;
  active = false; ++generation; query = ''; notice = ''; damaged = false; confirmReset = false; locked();
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

const nav = (label: string, go: () => void, extra: Bag = {}): Bag => ({ kNav: true, label, lbl: extra.aria || label, chev: !extra.val, noAB: true, go, hasSub: !!extra.sub, sub: extra.sub || '', hasVal: !!extra.val, val: extra.val || '', busy: !!busy });
const button = (label: string, go: () => void, primary = false, disabled = false): Bag => ({ kBtn: true, label, go, dis: disabled || !!busy, noAB: true, css: primary && !disabled ? 'background:var(--acc);color:#fff' : 'background:var(--s2)' });
const input = (ic: Bag, label: string, placeholder: string, type: string, value: string, change: (value: string) => void, icon = 'lock'): Bag => ({ kInput: true, label, ph: placeholder, type, value, d: ic[icon] || ic.lock, hasIcon: true, noAB: true, change: (event: Event) => change((event.target as HTMLInputElement).value) });
const captioned = (helpers: Helpers, cap: string, rows: Bag[], plain = false): Bag => ({ ...helpers.group(rows), ...(plain ? { css: 'display:flex;flex-direction:column;gap:10px' } : {}), cap, hasCap: !!cap });
const bindingText = (entry: PasswordEntrySummary) => entry.bindings.map(binding => binding.display).join(', ') || 'No website';

function openEntry(helpers: Helpers, entry: PasswordEntrySummary | null) {
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
  if (!websites.length && !current.keep.length) { current.error = 'Add at least one website.'; notify(); return; }
  if (!current.id && !current.generate && !current.password) { current.error = 'Enter or generate a password.'; notify(); return; }
  const secret = current.generate ? undefined : current.password || undefined;
  current.password = '';
  void run('save', async vault => {
    const result = await vault.save({ ...(current.id ? { id: current.id } : {}), label: current.label.trim(), username: current.username, websites, keepBindings: current.keep.map(binding => binding.facet), ...(current.generate ? { generate: { length: current.length } } : secret ? { password: secret } : {}) });
    if (draft !== current) return;
    draft = null;
    notice = result.generated ? `Saved with a new ${result.length}-character password.` : 'Password saved.';
    helpers.set({ page: 'password-provider' });
    await refresh();
  });
}

/** Rows for Settings → Passwords, placed above the other-provider (Proton) section. */
export function passwordManagerGroups(helpers: Helpers): Bag[] {
  if (!active) { active = true; notice = ''; void refresh(); }
  const vault = client;
  if (vault === undefined) return [captioned(helpers, 'Alpha Phone passwords', [helpers.info('Saved passwords', 'Checking…')])];
  if (vault === null) return [captioned(helpers, 'Alpha Phone passwords', [helpers.info('Saved passwords', 'Available in the Android app')])];
  const groups: Bag[] = [];
  const head: Bag[] = [];
  if (!status) head.push(helpers.info('Saved passwords', notice || 'Checking…'));
  else if (!status.available) head.push(helpers.info('Saved passwords', status.reason === 'no-screen-lock' ? 'Set a screen lock first' : 'Unavailable on this device'));
  else if (damaged) {
    head.push(helpers.info('Vault', 'Cannot be decrypted on this phone'));
    head.push(nav(busy === 'reset' ? 'Deleting…' : confirmReset ? 'Tap again to delete all saved passwords' : 'Delete saved passwords and start over', () => {
      if (!confirmReset) { confirmReset = true; notify(); return; }
      void run('reset', async v => { await v.unlock(); await v.reset(); damaged = false; confirmReset = false; notice = 'Saved passwords were deleted. You can add new ones.'; await refresh(); });
    }, { sub: 'Their key is gone, so they cannot be recovered' }));
  }
  else if (status.locked || !entries) {
    head.push(helpers.info('Vault', 'Locked'));
    head.push(nav(busy === 'unlock' ? 'Unlocking…' : 'Unlock passwords', () => void run('unlock', async v => { await v.unlock(); await refresh(); }), { sub: status.biometric ? 'Fingerprint, face or screen lock' : 'Screen lock' }));
  } else {
    head.push(helpers.info('Vault', `Unlocked · locks after ${status.unlockSeconds || 60} s or when you leave`));
    head.push(nav('Lock passwords', () => void run('lock', async v => { await v.lock(); locked(); })));
  }
  if (notice) head.push(helpers.info('Status', notice));
  groups.push(captioned(helpers, 'Alpha Phone passwords', head));
  if (status && !status.locked && entries) {
    groups.push(captioned(helpers, '', [input(helpers.ic, 'Search passwords', 'Search passwords', 'search', query, value => { query = value; notify(); }, 'search'), button('Add password', () => openEntry(helpers, null), true)], true));
    const shown = filterEntries(entries, query);
    groups.push(helpers.group(shown.length ? shown.map(entry => nav(entry.label, () => openEntry(helpers, entry), { sub: `${entry.username || 'No username'} · ${bindingText(entry)}`, aria: `Open ${entry.label}` })) : [helpers.info(entries.length ? 'No matching passwords' : 'No saved passwords', '')]));
    const move = transferClient();
    if (move) groups.push(captioned(helpers, 'Move passwords', [
      nav(busy === 'import' ? 'Importing…' : 'Import passwords', () => void run('import', async () => {
        try {
          const result = await move.importVault();
          notice = result.imported ? `Imported ${result.imported} ${result.imported === 1 ? 'password' : 'passwords'}${result.skipped ? `, ${result.skipped} not imported` : ''}.` : 'No passwords were imported.';
        } finally { await refresh(); }
      }), { sub: 'From a CSV file. You review each website first.' }),
      nav(busy === 'export' ? 'Exporting…' : 'Export passwords', () => void run('export', async () => {
        // Native export locks the vault before its fresh authentication, so the list is
        // refreshed after a cancelled or failed export too.
        try {
          const result = await move.exportVault();
          notice = `Exported ${result.exported} ${result.exported === 1 ? 'password' : 'passwords'}. The file is not encrypted; delete it when you are done.`;
        } finally { await refresh(); }
      }), { sub: 'Unencrypted CSV file. Asks for your screen lock.' }),
    ]));
  }
  if (status) {
    const selection = { 'this-app': 'Alpha Phone passwords', other: 'Another provider', none: 'None selected', unknown: 'Not checked' }[status.autofill.selected];
    groups.push(captioned(helpers, 'Autofill', [
      helpers.info('Browser autofill', browserFillText()),
      helpers.info('Autofill service', status.autofill.supported === false ? 'Unavailable for this device or user' : selection),
      ...(status.autofill.supported === false ? [] : [nav(busy === 'autofill' ? 'Opening…' : 'Set as autofill service', () => void run('autofill', async v => {
        const result = await v.openAutofillSettings();
        helpers.toast(result.destination === 'autofill-picker' ? 'Confirm Alpha Phone passwords in Android, then return here.' : 'Opened Android settings. Search for autofill to choose a provider.');
      }), { sub: 'Android asks you to confirm' })]),
      nav('Refresh autofill status', () => void refresh()),
    ]));
  }
  return groups;
}

function browserFillText() {
  if (!browserFill) return 'Unavailable in this browser. Use Show or Copy for website passwords.';
  return browserFill.available
    ? 'Supported by this WebView for the site shown in Alpha\'s browser, never for another site embedded in the page. Filling depends on your autofill service.'
    : 'Off: this Android System WebView cannot report which site owns a sign-in field. Update Android System WebView, or use Show or Copy.';
}

/** The add/edit page, or null when no entry is open. */
export function passwordEntryPage(helpers: Helpers, back: () => void): Bag | null {
  const current = draft;
  if (!current || !entries) return null;
  const set = (patch: Partial<Draft>) => { Object.assign(current, patch, { error: '' }); notify(); };
  const groups: Bag[] = [
    captioned(helpers, '', [
      input(helpers.ic, 'Name', 'Name', 'text', current.label, value => set({ label: value }), 'user'),
      input(helpers.ic, 'Username', 'Username or email', 'text', current.username, value => set({ username: value }), 'mail'),
    ], true),
    captioned(helpers, 'Websites and apps', [
      ...current.keep.map(binding => nav(binding.display, () => set({ keep: current.keep.filter(item => item.facet !== binding.facet) }), { sub: binding.kind === 'android' ? 'App · verified publisher' : 'Website', val: 'Remove', aria: `Remove ${binding.display}` })),
      input(helpers.ic, 'Add website', 'example.com', 'url', current.website, value => set({ website: value }), 'globe'),
    ]),
    captioned(helpers, 'Password', current.generate ? [
      helpers.info('New password', `${current.length} characters, generated on this phone when you save`),
      { kSeg: true, label: 'Length', noAB: true, opts: [16, 20, 32].map(length => ({ label: String(length), on: current.length === length, aria: `Length: ${length}`, css: current.length === length ? 'background:var(--acc);color:#fff' : 'color:var(--mut)', pick: () => set({ length }) })) },
      nav('Type a password instead', () => set({ generate: false })),
    ] : [
      input(helpers.ic, 'Password', current.id ? 'Leave empty to keep the current password' : 'Password', 'password', current.password, value => set({ password: value })),
      nav('Generate a strong password', () => set({ generate: true, password: '' })),
    ]),
  ];
  if (current.id) {
    const id = current.id;
    groups.push(helpers.group([
      nav('Show password', () => void run('reveal', async v => { await v.reveal(id); }), { sub: 'Shown by Android, hidden after 30 s' }),
      nav('Copy password', () => void run('copy', async v => { const r = await v.copy(id); helpers.toast(`Copied. We try to clear it after ${Math.round(r.clearsAfterMs / 1000)} s, or when you return to the app.`); })),
    ]));
  }
  const actions: Bag[] = [];
  if (current.error) actions.push(helpers.info('Not saved', current.error));
  actions.push(button(busy === 'save' ? 'Saving…' : 'Save', () => save(helpers), true));
  if (current.id) {
    const id = current.id;
    actions.push(button(current.confirmDelete ? 'Tap again to delete' : 'Delete password', () => {
      if (!current.confirmDelete) { set({ confirmDelete: true }); return; }
      void run('remove', async v => { await v.remove(id); if (draft === current) draft = null; notice = 'Password deleted.'; helpers.set({ page: 'password-provider' }); await refresh(); });
    }));
  }
  groups.push(captioned(helpers, '', actions, true));
  return { isTop: false, notTop: true, cls: 'enter', z: 5, title: current.id ? 'Edit password' : 'New password', hasTitle: true, backLabel: 'Back to Passwords', back: () => { clearSecrets(); back(); }, hero: {}, groups };
}
