import { externalVoiceInvocationEnabled } from '../runtime/voice-entry-policy';
import {BrowserReviews} from '../browser/review';
import {residentRecoveryCopy} from '../runtime/resident-recovery';
import {cloudServiceName} from '../runtime/cloud-protocol';
import {browserDevProfile as devProfileQuery,developerTools} from '../browser/dev-profile';
import {testMocksEnabled,devSurfacesEnabled} from '../build-flags';
import {speechRoute,type SpeechRoute} from '../runtime/voice-selection';
import {openCalendarRecovery} from '../browser/calendar-recovery';
import {openNotificationRecovery} from '../browser/notification-recovery';
import {openAlertSoundRecovery,openDevicePreferencesRecovery,openDeviceRolesRecovery} from '../browser/preference-recovery';
import {notificationDocument} from '../browser/notification-store';
import {alertSoundDocument,deviceRolesDocument} from '../browser/preference-documents';
import {cachedDevicePreferences,devicePreferencesStatus,initializeDevicePreferences,editDevicePreferences,readDevicePreferences} from '../browser/device-preferences';
import { registerPlugin } from '../platform-plugins';
import {aospImage} from '../runtime/aosp-image';
import {telephonyProfile} from '../../../../.eliza/client-features/packages/contracts/src/native-telephony.ts';
import {createPhoneInfoLoader,identifiersElsewhere,phoneDefaultRows,phoneLineSections} from './phone-info-page';
import { broaderPageNotice, switchValue } from './native-adapter';
import { Capacitor } from '@capacitor/core';
import { DailyApps } from '../daily';
import { agentPendingText, connectionController } from '../runtime/connection-ui';
import {googleConnectionController} from '../runtime/google-connection-ui';
import {GOOGLE_ACCOUNTS_CHANGED} from '../runtime/google-accounts';
import { browserLocalAgentEnabled, modelLabel } from '../runtime/local-agent';
import {developmentCartesiaVoiceEnabled} from '../runtime/development-cartesia-conversation';
import type { GmailAccount } from '../runtime/cloud-protocol';
import { gmailGrantLabel } from '../runtime/gmail-grants';
import { clearCrashLog, describeCrashEntry, readCrashLog, recordCloudInferenceFailure, type CrashLog } from '../runtime/crash-log';
import { buildDiagnostics, diagnosticsFileName, diagnosticsText } from '../runtime/diagnostics-export';
import {planAdmission} from '../runtime/subscription-entitlement';
import { exportVoiceTiming, exportRealtimeVoiceTiming, voiceStartupTiming } from '../runtime/voice-timing';
import { readNativeVoiceTiming } from '../runtime/native-voice-turn';
import { readNativeCloudStreamTiming } from '../runtime/cloud-voice';
import { listenerStatus, openListenerSettings, pauseListener, turnOffListener, wakeListeningStopUnconfirmed, type ListenerStatus } from '../runtime/always-on-listener';
import { reviewDataReset, type DataResetPlugin } from '@elizaos/capacitor-system/reset';
import { androidRoleLabel, parseRoleStatuses } from '@elizaos/capacitor-system/settings';
import {createAppUpdateScheduler} from '../../../../.eliza/client-features/packages/ui/src/state/app-update-gate';
import { leavePasswordEntry, leavePasswordManager, passwordEntryPage, passwordManagerGroups, passwordManagerLifecycle, refreshPasswordManager, PASSWORD_PAGES } from '../passwords/password-manager';
import {errorNotice,ERROR_TOAST} from '../runtime/error-notice';

type Bag = Record<string, any>;
type PhotoAccess = {scope:'full'|'partial'|'selected'|'denied';images:string;videos:string};
const photoLibrary = registerPlugin<{libraryAccess():Promise<PhotoAccess>;requestLibraryAccess():Promise<PhotoAccess>;openLibrarySettings():Promise<void>}>('AlphaPhotos');
/** Shared-storage access as Android reports it; `settings` opens Android's page without a prompt. */
const fileStorage = registerPlugin<{storageState():Promise<{access?:unknown}>;storageRequestAccess(options?:{settings?:boolean}):Promise<unknown>}>('AlphaFiles');
// The prover (specs/lemma) cannot read a constant without a value; no proved function uses it.
//@ skip
declare const __APP_VERSION__: string;
const browserDevProfile = devSurfacesEnabled && devProfileQuery;
/** Build version injected at build time from app.config.json or ELIZAOS_VERSION_NAME. */
export const buildVersion = typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : 'Unavailable';
export type LicenseNotice = { name: string; version: string; license: string; source: string; text: string; flags?: unknown; obligations?: unknown };
/** Labels for the flags scripts/licence-policy.ts writes into the shipped notices. An unlisted flag is shown as written. */
const LICENSE_FLAG_LABELS: Record<string, string> = {
  'copyleft-strong': 'Copyleft (GPL family)', 'network-copyleft': 'Network copyleft (AGPL)', 'copyleft-weak': 'Weak copyleft (LGPL, MPL, EPL)',
  'share-alike-data': 'Share-alike data', 'unknown-licence': 'Unknown license', 'licence-text-missing-from-package': 'No license file in package',
  unverified: 'License unverified', 'permissive-not-previously-listed': 'Permissive, newly listed', 'non-open-source-terms': 'Not open-source terms',
  'proprietary-licence-held-outside-repo': 'Proprietary, license held by owner', 'proprietary-no-licence-recorded': 'Proprietary, no license recorded',
};
/** Rows for an entry's flags and what each obliges; none for an unflagged entry. */
function licenseFlagRows(item: LicenseNotice): Bag[] {
  const flags = Array.isArray(item.flags) ? item.flags.filter((flag): flag is string => typeof flag === 'string' && !!flag) : [];
  if (!flags.length) return [];
  const notes = (Array.isArray(item.obligations) ? item.obligations : []).filter((row): row is { flag: string; note: string } => !!row && typeof row === 'object' && typeof (row as Bag).flag === 'string' && typeof (row as Bag).note === 'string' && !!(row as Bag).note);
  return [{ kLog: true, time: 'Flagged', text: flags.map(flag => LICENSE_FLAG_LABELS[flag] ?? flag).join(' · ') }, ...notes.map(row => ({ kLog: true, time: 'Obligation', text: row.note }))];
}
let licenses: { status: 'idle' | 'loading' | 'ready' | 'unavailable'; items: LicenseNotice[] } = { status: 'idle', items: [] };
/** Reads the generated notice file shipped with the app; never a remote source. */
async function loadLicenses(changed: () => void) {
  if (licenses.status === 'loading' || licenses.status === 'ready') return;
  licenses = { status: 'loading', items: [] }; changed();
  try {
    const response = await fetch('licenses/third-party-notices.json', { cache: 'no-cache' });
    if (!response.ok) throw Error('License notices unavailable');
    const value: unknown = await response.json();
    if (!Array.isArray(value)) throw Error('License notices unavailable');
    const items = value.filter((item): item is LicenseNotice => !!item && typeof item === 'object' && ['name', 'version', 'license'].every(key => typeof (item as Bag)[key] === 'string'));
    licenses = { status: items.length ? 'ready' : 'unavailable', items };
  } catch { licenses = { status: 'unavailable', items: [] }; }
  changed();
}
/** Native reset results that only echo the owner's own cancel (DataResetCopy); nothing else is hidden. */
const RESET_CANCEL_TEXTS = new Set(['Reset review closed. Nothing reset.', 'Nothing reset.', 'Reset cancelled. Nothing reset.']);
type RecoveryDomain = 'notifications' | 'device settings' | 'device roles' | 'alert sound history';
const recoveryActions: Record<RecoveryDomain, { label: string; open: () => void }> = {
  notifications: { label: 'Recover notification data', open: openNotificationRecovery },
  'device settings': { label: 'Recover device settings', open: openDevicePreferencesRecovery },
  'device roles': { label: 'Recover device roles', open: openDeviceRolesRecovery },
  'alert sound history': { label: 'Recover notification sounds', open: openAlertSoundRecovery },
};
/** Browser stores report recovery when saved bytes or their metadata cannot be read normally. */
async function recoveryNeeded(): Promise<RecoveryDomain[]> {
  const probe = async (domain: { capture(signal?: AbortSignal): Promise<{ format: string; legacyChanged: boolean }>; readRaw(signal?: AbortSignal): Promise<string | null> }, validate?: () => Promise<unknown>) => {
    try {
      const captured = await domain.capture();
      if (captured.format === 'unrecognized' || captured.legacyChanged) return true;
      const raw = await domain.readRaw();
      if (raw !== null) JSON.parse(raw);
      if (validate) await validate();
      return false;
    } catch { return true; }
  };
  const checks: Array<[RecoveryDomain, Promise<boolean>]> = [
    ['notifications', probe(notificationDocument)],
    ['device settings', probe({ capture: signal => readDevicePreferences(signal).then(() => ({ format: 'domain', legacyChanged: false })), readRaw: async () => null })],
    // Simulated device roles exist only in test-mocks builds; production browsers have none to recover.
    ...(testMocksEnabled ? [['device roles', probe(deviceRolesDocument)] as [RecoveryDomain, Promise<boolean>]] : []),
    ['alert sound history', probe(alertSoundDocument)],
  ];
  const results = await Promise.all(checks.map(async ([name, check]) => [name, await check] as const));
  return results.filter(([, needed]) => needed).map(([name]) => name);
}
const device = registerPlugin<{
  snapshot(): Promise<Bag>;
  openPasswordProvider(input:{action:string}):Promise<{status:string;destination?:string}>;
  openSettings(input: { page: string }): Promise<{ status: string }>;
  setTextScale(input:{percent:number}):Promise<{textScalePercent:number;effectiveTextZoom:number}>;
  diagnosticsFacts(): Promise<Bag>;
  shareDiagnostics(input: { text: string }): Promise<{ status: string }>;
  checkForUpdate(): Promise<{manifest?: string; manifestSha256?: string}>;
  openUpdatePermissionSettings(): Promise<{status: 'opened' | 'unsupported'}>;
  updateState(): Promise<{pending?: boolean}>;
  installUpdate(input: Pick<AppUpdate, 'apkUrl' | 'sha256' | 'sizeBytes' | 'versionCode'> &
    ({automatic: true; manifestSha256: string} | {automatic?: never; manifestSha256?: never})): Promise<{status?: string; manifest?: string}>;
}>('AlphaDevice');
const notifications = registerPlugin<{status():Promise<Bag>;setAlertPreferences(input:{appEnabled?:boolean;channelId?:string;enabled?:boolean}):Promise<Bag>;openAppSettings():Promise<Bag>;openChannelSettings(input:{id:string}):Promise<{status:string}>;crossAppStatus():Promise<Bag>;notificationApps():Promise<{apps:Bag[]}>;setNotificationPolicy(input:Bag):Promise<Bag>;resumeCrossApp(input:{expectedRevision:string}):Promise<Bag>;openNotificationAccess():Promise<Bag>;notificationHistory():Promise<{items:Bag[]}>;clearNotificationHistory():Promise<void>}>('AlphaNotifications');
const system = registerPlugin<{ getDeviceSettings(): Promise<Bag>; getStatus(): Promise<{ roles?: Bag[] }>; requestRole(input: { role: string }): Promise<{ role: string; held: boolean; resultCode: number }>; getBuildInfo(): Promise<{ launcher?: boolean; version?: string }> }>('ElizaSystem');
type RoleRow = { role: string; held: boolean; available: boolean; holders: string[] };
/** Android role state exactly as ElizaSystem.getStatus() reports it (shared parser); malformed rows are dropped. */
export function readRoles(status: unknown): Record<string, RoleRow> {
  return Object.fromEntries(parseRoleStatuses(status).map(row => [row.role, row]));
}
/** Shared truthful wording: an empty holder lookup never claims that no app holds the role. */
export function roleValue(row: RoleRow | undefined): string {
  return androidRoleLabel(row, { packageName: 'ai.alphacompute.alphaphone', appName: 'Alpha Phone' });
}

// settings-facts:begin (dependency-free; exercised by test/settings-truth.test.mjs)
/** Version as packaged, with Android's version code when it is a real positive integer. */
export function versionLabel(version: unknown, code: unknown): string {
  const name = typeof version === 'string' && version ? version : 'Unavailable';
  return Number.isSafeInteger(code) && (code as number) > 0 && name !== 'Unavailable' ? `${name} (${code})` : name;
}
/** Only the install time Android recorded. */
export function installedRows(updatedAt: unknown, format: (at: number) => string = at => new Date(at).toLocaleDateString()): Array<[string, string]> {
  return Number.isSafeInteger(updatedAt) && (updatedAt as number) > 0 ? [['Installed or last updated', format(updatedAt as number)]] : [];
}
/**
 * Software update manifest (app.config.json updateManifestUrl, fetched by AlphaDevice.checkForUpdate):
 * {schema: "alpha-update/v1", versionCode, versionName (optional; shown only as 1 to 64 characters without
 * control characters), variant ("launcher" or "standalone"), signerSha256 (the original certificate of the
 * signing lineage, AlphaDevice appSigner, which APK Signature Scheme v3 key rotation never changes), apkUrl
 * (HTTPS), sha256 (64 lowercase hex), sizeBytes, notes (optional; shown only as a string of at most 500
 * characters)}.
 */
export const UPDATE_SCHEMA = 'alpha-update/v1';
/** AlphaDevicePlugin.UPDATE_MAX_BYTES, which the native download enforces, is the same bound. */
export const UPDATE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;
type AppUpdate = {versionCode: number; versionName: string; apkUrl: string; sha256: string; sizeBytes: number; notes: string};
/** The bounded index admits unique variant and signer pairs. A single offer has the same row shape. */
function updateManifestRows(value: unknown): Array<Record<string, unknown>> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const document = value as Record<string, unknown>;
  if (document.schema !== 'alpha-update/index-v1') return [document];
  if (!Array.isArray(document.releases) || document.releases.length < 1 || document.releases.length > 16) return null;
  const pairs = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];
  for (const entry of document.releases) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    if (row.schema !== UPDATE_SCHEMA || (row.variant !== 'launcher' && row.variant !== 'standalone') || typeof row.signerSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(row.signerSha256)) return null;
    const pair = row.variant + ':' + row.signerSha256;
    if (pairs.has(pair)) return null;
    pairs.add(pair);
    rows.push(row);
  }
  return rows;
}
/**
 * The update a manifest offers this install, or null unless it is complete and HTTPS, newer than the
 * installed versionCode, and for this flavor and signer. Android refuses another signer after the whole
 * download, and the other flavor would silently change what the phone admits (HOME, Phone, SMS).
 */
export function parseUpdateManifest(value: unknown, installed: {versionCode: unknown; launcher: unknown; signerSha256: unknown}): AppUpdate | null {
  // One canonical feed can serve distinct APK flavors and installed signing families.
  // Select an exact pair only; never fall back to another signer or an ambiguous offer.
  if (typeof installed.launcher !== 'boolean') return null;
  const offer = updateManifestRows(value)?.find(row => row.variant === (installed.launcher ? 'launcher' : 'standalone') && row.signerSha256 === installed.signerSha256);
  if (!offer) return null;
  const {schema, versionCode, versionName, signerSha256, apkUrl, sha256, sizeBytes, notes} = offer;
  if (schema !== UPDATE_SCHEMA || !Number.isSafeInteger(installed.versionCode) || !Number.isSafeInteger(versionCode) || (versionCode as number) <= (installed.versionCode as number)) return null;
  if (typeof signerSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(signerSha256)) return null;
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256) || !Number.isSafeInteger(sizeBytes) || (sizeBytes as number) <= 0 || (sizeBytes as number) > UPDATE_MAX_BYTES || typeof apkUrl !== 'string' || apkUrl.length > 2048) return null;
  try { const url = new URL(apkUrl); if (url.protocol !== 'https:' || url.username || url.password) return null; } catch { return null; }
  return {versionCode: versionCode as number, versionName: typeof versionName === 'string' && /^[^\u0000-\u001f\u007f]{1,64}$/.test(versionName) ? versionName : '', apkUrl, sha256, sizeBytes: sizeBytes as number, notes: typeof notes === 'string' && notes.length <= 500 ? notes : ''};
}
/** Only a complete feed can replace or evict the saved manual offer. */
function parseCompleteUpdateManifest(manifest: unknown): unknown {
  if (typeof manifest !== 'string') return null;
  try {
    const value: unknown = JSON.parse(manifest);
    const rows = updateManifestRows(value);
    if (rows?.every(row => parseUpdateManifest(row, {versionCode: 0,
      launcher: row.variant === 'launcher', signerSha256: row.signerSha256}))) return value;
  } catch { /* Invalid JSON cannot replace a saved offer. */ }
  return null;
}
/** Fifteen minutes after the last answer, or at once for an unknown/future clock. */
export function updateCheckDue(checkedAt: number, now: number): boolean {
  //@ verify
  //@ ensures \result <==> now < checkedAt || now - checkedAt >= UPDATE_CHECK_INTERVAL_MS
  //@ ensures now < checkedAt ==> \result
  //@ ensures !\result ==> 0 <= now - checkedAt && now - checkedAt < UPDATE_CHECK_INTERVAL_MS
  return !(now >= checkedAt && now - checkedAt < UPDATE_CHECK_INTERVAL_MS);
}
/** What automaticUpdateIdle reads from the shell, the connection and the page, as plain facts. */
export type UpdateIdleFacts = {
  voiceInactive: boolean; home: boolean; view: boolean; voiceOff: boolean; typing: boolean; chatResting: boolean;
  drawer: boolean; shade: boolean; homeEdit: boolean; homeAdd: boolean; drawerMenu: boolean;
  busy: boolean; open: boolean; editor: boolean;
};
/** The idle decision on plain facts (proved in specs/lemma): any one foreground activity blocks an update. */
export function updateIdle(facts: UpdateIdleFacts): boolean {
  //@ verify
  //@ ensures \result ==> facts.voiceInactive && facts.voiceOff
  //@ ensures \result ==> facts.home && !facts.view
  //@ ensures \result ==> !facts.typing && facts.chatResting && !facts.editor
  //@ ensures \result ==> !facts.drawer && !facts.shade && !facts.drawerMenu
  //@ ensures \result ==> !facts.homeEdit && !facts.homeAdd
  //@ ensures \result ==> !facts.busy && !facts.open
  //@ ensures facts.voiceInactive && facts.voiceOff && facts.home && !facts.view && !facts.typing && facts.chatResting && !facts.editor && !facts.drawer && !facts.shade && !facts.drawerMenu && !facts.homeEdit && !facts.homeAdd && !facts.busy && !facts.open ==> \result
  return facts.voiceInactive && facts.home && !facts.view && facts.voiceOff && !facts.typing &&
    facts.chatResting && !facts.drawer && !facts.shade &&
    !facts.homeEdit && !facts.homeAdd && !facts.drawerMenu &&
    !facts.busy && !facts.open && !facts.editor;
}
/** Field updates wait for Home, outside voice, edits and foreground reviews. */
export function automaticUpdateIdle(shell: {screen?:unknown;view?:unknown;voice?:unknown;typing?:unknown;chat?:unknown;drawer?:unknown;shade?:unknown;homeEdit?:unknown;homeAdd?:unknown;drawerMenu?:unknown}, connection: {busy?:unknown;open?:unknown}, editor: boolean, voiceActive: boolean): boolean {
  return updateIdle({
    voiceInactive: voiceActive === false, home: shell.screen === 'home', view: !!shell.view, voiceOff: shell.voice === 'off',
    typing: !!shell.typing, chatResting: shell.chat === 'input' || shell.chat === 'hidden', drawer: !!shell.drawer, shade: !!shell.shade,
    homeEdit: !!shell.homeEdit, homeAdd: !!shell.homeAdd, drawerMenu: !!shell.drawerMenu,
    busy: !!connection.busy, open: !!connection.open, editor: !!editor,
  });
}
/** The Privacy page's voice fact: the speech route in use now (voice-selection.ts) and what it sends.
 * It replaces the prototype's on-device model row; device settings links are untouched. */
export function voicePrivacyRow(label: string, route: SpeechRoute, serviceName = 'Cloud'): [string, string] | null {
  if (label !== 'On-device model') return null;
  if (route === 'cloud') return ['Voice', `Recordings, replies → ${serviceName}`];
  if (route === 'direct') return ['Voice', 'Recordings, replies → Cartesia'];
  return ['Voice', 'On this phone'];
}
/** A stale or direct Developer selection cannot open the page in a product build. */
export function settingsPage(page: string | null | undefined, developerSurfaces: boolean): string | null | undefined {
  //@ verify
  //@ ensures !developerSurfaces ==> \result !== 'developer' && \result !== 'character'
  //@ ensures developerSurfaces ==> \result === page
  //@ ensures page !== 'developer' && page !== 'character' ==> \result === page
  //@ ensures !developerSurfaces && (page === 'developer' || page === 'character') ==> \result === null
  return (page === 'developer' || page === 'character') && !developerSurfaces ? null : page;
}
/** The two label fields a Settings navigation row can carry. */
export type NavigationRow = { label?: string; lbl?: string };
/** Support diagnostics remain in About; Developer navigation is an explicit development surface. */
export function settingsNavigationRows<T extends NavigationRow>(rows: T[], developerSurfaces: boolean): T[] {
  //@ verify
  //@ ensures developerSurfaces ==> \result === rows
  //@ ensures !developerSurfaces ==> forall(k, 0 <= k && k < \result.length ==> \result[k].label !== 'Developer' && \result[k].lbl !== 'Developer')
  return developerSurfaces ? rows : rows.filter(row => row.label !== 'Developer' && row.lbl !== 'Developer');
}
/** Sections another surface may open directly (alpha:settings-page), with the category whose page
 * Back returns to. Developer, password and credential pages are never addressable this way. */
const SETTINGS_SECTIONS: Record<string, string | null> = {
  display: 'settings-general', sound: 'settings-general', notifications: 'settings-general', battery: 'settings-general', 'settings-general': 'settings-general',
  privacy: 'settings-privacy', 'settings-permissions': 'settings-privacy', 'settings-privacy': 'settings-privacy',
  'settings-account': 'settings-account',
  'settings-apps': 'settings-apps', calendar: 'settings-apps', 'app-settings-workflows': 'settings-apps', 'app-settings-inbox': 'settings-apps',
  about: null,
};
/** The view-state patch that opens a section, or null for anything outside the allowlist. */
export function settingsSectionPatch(section: unknown): { page: string; settingsCategory: string | null } | null {
  return typeof section === 'string' && Object.hasOwn(SETTINGS_SECTIONS, section) ? { page: section, settingsCategory: SETTINGS_SECTIONS[section] } : null;
}
// settings-facts:end
/** Saved appearance choice. 'system' follows prefers-color-scheme, which Android WebView also reports. */
export type AppearanceChoice = 'system' | 'light' | 'dark';
export const APPEARANCE_KEY = 'alpha.appearance.v1';
export function hasAppearancePreview(query: URLSearchParams): boolean {
  return testMocksEnabled && query.has('theme');
}
export function readAppearanceChoice(): AppearanceChoice {
  try { const value = localStorage.getItem(APPEARANCE_KEY); return value === 'dark' || value === 'system' ? value : 'light'; }
  catch { return 'light'; }
}
const systemScheme = () => { try { return matchMedia('(prefers-color-scheme: dark)'); } catch { return null; } };
/** The theme a choice draws now; an unreadable system preference draws light. */
export function resolveAppearance(choice: AppearanceChoice): 'light' | 'dark' {
  return choice === 'system' ? (systemScheme()?.matches ? 'dark' : 'light') : choice;
}

const UPDATE_KEY = 'alpha.app-update.v1';
type SavedUpdate = {checkedAt: number; manifest: unknown; manifestSha256?: string};
let lastUpdate: SavedUpdate | undefined, updateCheck: Promise<boolean> | undefined;
function isManifestSha256(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && /^[0-9a-f]{64}$/.test(value);
}
function savedUpdate(): SavedUpdate {
  if (lastUpdate) return lastUpdate;
  try {
    const value = JSON.parse(localStorage.getItem(UPDATE_KEY) ?? 'null');
    if (value && typeof value === 'object' && Number.isFinite(value.checkedAt)) {
      return lastUpdate = {checkedAt: value.checkedAt, manifest: value.manifest,
        manifestSha256: isManifestSha256(value.manifestSha256) ? value.manifestSha256 : undefined};
    }
  } catch { /* Unreadable storage only means the next check is due. */ }
  return lastUpdate = {checkedAt: Number.NaN, manifest: null};
}
function retainUpdate(value: SavedUpdate) {
  lastUpdate = value;
  try { localStorage.setItem(UPDATE_KEY, JSON.stringify(value)); } catch { /* Kept for this session. */ }
}
function retireUpdate(used: SavedUpdate, changed: boolean): boolean {
  if (lastUpdate !== used) return false;
  lastUpdate = changed ? {checkedAt: Number.NaN, manifest: null} : {checkedAt: used.checkedAt, manifest: used.manifest};
  try {
    if (localStorage.getItem(UPDATE_KEY) === JSON.stringify(used)) {
      if (changed) localStorage.removeItem(UPDATE_KEY);
      else localStorage.setItem(UPDATE_KEY, JSON.stringify(lastUpdate));
    }
  } catch { /* Automatic authority is retired for this session. */ }
  return true;
}
/**
 * At most one check at a time. An automatic poll refreshes an offer saved by an older
 * renderer, and a 404 withdraws it. A failed read keeps the manual row and retires
 * its automatic authority until the next successful check.
 */
function checkForUpdate(force: boolean, automatic = false): Promise<boolean> | undefined {
  if (updateCheck || !Capacitor.isNativePlatform()) return updateCheck;
  const saved = savedUpdate();
  const needsDigest = automatic && saved.manifest != null && !saved.manifestSha256;
  if (!force && !needsDigest && !updateCheckDue(saved.checkedAt, Date.now())) return;
  updateCheck = device.checkForUpdate().then(({manifest, manifestSha256}) => {
    if (manifest === undefined && manifestSha256 === undefined) {
      retainUpdate({checkedAt: Date.now(), manifest: null});
      return true;
    }
    if (typeof manifest !== 'string' || (manifestSha256 !== undefined && !isManifestSha256(manifestSha256)))
      throw Error('Malformed update check reply');
    const parsed = parseCompleteUpdateManifest(manifest);
    if (!parsed) throw Error('Malformed update manifest');
    retainUpdate({checkedAt: Date.now(), manifest: parsed, manifestSha256});
    return true;
  }).catch(() => {
    const cached = savedUpdate();
    if (cached.manifestSha256) retainUpdate({checkedAt: cached.checkedAt, manifest: cached.manifest});
    return false;
  }).finally(() => { updateCheck = undefined; });
  return updateCheck;
}

// settings-reads:begin (dependency-free; exercised by test/comms-settings.test.mjs)
/** Orders listener status reads against Pause and Turn off. No read starts while an action runs, a read
 * already in flight is dropped once an action starts, and the action's own result is always applied. */
export function listenerReadGate() {
  let busy = false, sequence = 0;
  return {
    busy: () => busy,
    beginAction(): boolean { if (busy) return false; busy = true; sequence++; return true; },
    endAction() { busy = false; },
    beginRead(): number | null { return busy ? null : ++sequence; },
    readApplies(token: number): boolean { return !busy && token === sequence; },
  };
}
/** What a return to the app does to Settings: read the device now when Settings is in front, otherwise
 * remember that its facts are stale so they are read when Settings is next shown. */
export function settingsResumeRead(view: unknown): 'now' | 'on-show' { return view === 'settings' ? 'now' : 'on-show'; }
// settings-reads:end
/** Which text-size result the page shows. The device applies requests in the order they were issued and
 * their results arrive in any order. The newest request's result is shown. An older request's result is
 * held while a newer one is in flight and shown once the newest fails, because it is then the size the
 * device holds. */
export function textScaleSettlement() {
  let held: Record<string, any> | null = null, latest = 0, failed = 0;
  return {
    /** The result to show for a request that succeeded, or null to keep what is shown. */
    applied(token: number, newest: number, result: Record<string, any>): Record<string, any> | null {
      if (token <= latest) return null;
      latest = token;
      if (token === newest || failed === newest) { held = null; return result; }
      held = result;
      return null;
    },
    /** A request that failed: whether it was the newest, and the held result to show in its place. */
    rejected(token: number, newest: number): { newest: boolean; show: Record<string, any> | null } {
      if (token !== newest) return { newest: false, show: null };
      const show = held;
      failed = token; held = null;
      return { newest: true, show };
    },
  };
}
/** Device facts after a read. A read that overlapped a text-size change may predate it, so the
 * text size already shown is kept; every other fact comes from the read. */
export function mergeDeviceFacts(read: Record<string, any>, shown: Record<string, any>, textScaleChanged: boolean): Record<string, any> {
  if (!textScaleChanged) return read;
  const next = { ...read };
  for (const key of ['textScalePercent', 'effectiveTextZoom']) if (key in shown) next[key] = shown[key];
  return next;
}
/** Keep the reference settings components; never present fixture device facts. */
export function installSettingsAdapter(Component: any, views: Bag) {
  const definition = views.settings, render = definition.render, p = Component.prototype;
  definition.state={...definition.state,settingsCategory:null};
  const mount = p.componentDidMount, unmount = p.componentWillUnmount, openView = p.openView, update = p.componentDidUpdate;
  // Android Back on New or Edit password returns to the unlocked list, like the page's own Back.
  const back = definition.back;
  definition.back = (st: Bag, api: Bag) => {
    if (st.page === 'password-entry' && !st.sheet) { leavePasswordEntry(); api.set({ page: 'password-provider' }); return true; }
    return back?.(st, api) ?? false;
  };
  let owner: any, facts: Bag = {}, controls: Bag = {}, delivery: Bag = {}, generation = 0,scaleGeneration=0,scaleVersion=0,scalePending=false,scaleResults=textScaleSettlement(), cross:Bag={}, choices:Bag[]|null=null, history:Bag[]|null=null, notificationBusy=false;
  let passwordOpening=false,photoAccessBusy=false,protonOpen=false;
  let photoAccess:PhotoAccess|null=null;
  let fileAccess:'granted'|'denied'|null=null;
  let recovery: RecoveryDomain[] = [];
  let capabilityAbort: AbortController | null = null;
  let inferenceAbort:AbortController|null=null;
  let gmailAccounts: GmailAccount[] = [];
  let roles: Record<string, RoleRow> | null = null, launcher: boolean | null = null, roleBusy = false;
  let crashLog: CrashLog | null = null, crashBusy = false, diagnosticsBusy = false;
  let updateBusy: '' | 'check' | 'install' = '', updateResult='';
  const reviews=new BrowserReviews();
  async function review(id:string,title:string,details:string,label:string,guard:()=>boolean=()=>true){
    const instance=owner,page=owner?.vget('settings').page,session=connectionController.getSnapshot().session,cloud=connectionController.getCloudClient()?.sessionId;
    const current=()=>owner===instance&&owner?.S().view==='settings'&&owner.vget('settings').page===page&&connectionController.getSnapshot().session===session&&connectionController.getCloudClient()?.sessionId===cloud&&guard();
    return await reviews.confirm(id,title,details,label,{current})&&current();
  }
  let automaticUpdates: ReturnType<typeof createAppUpdateScheduler> | undefined;
  const automaticUpdateActive = () => automaticUpdates?.setActive(!document.hidden);
  async function pollAutomaticUpdate(current: () => boolean) {
    if (await checkForUpdate(false, true) === false) throw Error('Update check unavailable');
    if (!current()) return;
    changed();
    const idle = () => automaticUpdateIdle(owner?.S?.() ?? {},connectionController.getSnapshot(),
      !!document.querySelector('input:focus,textarea:focus,[contenteditable="true"]:focus,[data-alpha-chat-recorder],[data-alpha-subview="notes-recorder"]'),
      owner?.voiceConversationActive?.() !== false);
    if (updateBusy || !idle())
      throw Error('Current activity must finish');
    const [installed, build, pending] = await Promise.all([device.snapshot(), system.getBuildInfo(), device.updateState()]);
    if (!current()) return;
    if (updateBusy || !idle()) throw Error('Current activity must finish');
    if (pending.pending) return;
    if (installed.appAutomaticUpdates === 'starting') throw Error('Android is still starting');
    if (installed.appAutomaticUpdates !== 'supported') return;
    const saved = savedUpdate();
    const update = parseUpdateManifest(saved.manifest, {versionCode: installed.appVersionCode,
      launcher: build.launcher, signerSha256: installed.appSigner});
    if (!update) return;
    if (!saved.manifestSha256) throw Error('Update offer requires a fresh check');
    // Native admission repeats the package/signer/version checks and requires every
    // renderer's saved-draft receipt before stopping the resident or committing.
    const result = await device.installUpdate({apkUrl:update.apkUrl,sha256:update.sha256,
      sizeBytes:update.sizeBytes,versionCode:update.versionCode,automatic:true,manifestSha256:saved.manifestSha256});
    if (result?.status === 'offer-unavailable' || result?.status === 'offer-withdrawn' || result?.status === 'offer-response-changed') {
      const withdrawn = result.status === 'offer-withdrawn' ||
        (result.status === 'offer-response-changed' && Boolean(parseCompleteUpdateManifest(result.manifest)));
      if (retireUpdate(saved, withdrawn) && current()) changed();
      throw Error('Update offer unavailable');
    }
    if (result?.status === 'starting') throw Error('Android is still starting');
    if (result?.status === 'permission-required' || result?.status === 'unsupported') return;
  }
  let gmail = 'Not checked';
  let inferenceProvider = 'Not reported';
  // The AOSP image's always-on listener (#424): status, Pause and Turn off only. Turning listening on
  // or resuming happens in the listener's own consent screen, never here.
  let listener: ListenerStatus = { available: false };
  const listenerReads = listenerReadGate();
  // Set when the app resumed behind another view; Settings reads the device when it is next shown.
  let resumedUnread = false;
  async function listenerAction(api: Bag, action: 'pause' | 'turnOff') {
    if (!listenerReads.beginAction()) return;
    changed();
    const instance = owner;
    try {
      const next = await (action === 'pause' ? pauseListener() : turnOffListener());
      if (owner !== instance) return;
      listener = next;
      if (!next.available) api.toast('Not responding · Use notification');
      else if (next.listening) api.toast('Still listening · Use notification');
    } finally { listenerReads.endAction(); if (owner === instance) changed(); }
  }
  const changed = () => owner?.vset('settings', { capabilityReadAt: Date.now() });
  /** Only the existing authenticated local status; no provider/capability refresh. */
  async function refreshResidentDiagnostics(){
    inferenceAbort?.abort();const abort=inferenceAbort=new AbortController(),instance=owner;
    const timer=setTimeout(()=>abort.abort(),10000);
    try{
      const status=await connectionController.readResidentDiagnostics(abort.signal);
      if(abort.signal.aborted||owner!==instance||inferenceAbort!==abort)return;
      if(recordCloudInferenceFailure(status?.cloudInferenceFailure)){const problems=await readCrashLog();if(!abort.signal.aborted&&owner===instance&&inferenceAbort===abort){crashLog=problems;changed();}}
      if(!abort.signal.aborted&&owner===instance&&inferenceAbort===abort)return status;
    }catch{/* Support diagnostics never replace the original inference failure. */}
    finally{clearTimeout(timer);if(inferenceAbort===abort)inferenceAbort=null;}
  }
  async function refreshCapabilities(enteringSettings=false) {
    capabilityAbort?.abort();
    // Hidden Settings must not turn a Home cache restore or account switch into remote discovery.
    if(!enteringSettings&&owner?.S?.().view!=='settings'){
      capabilityAbort=null;gmailAccounts=[];gmail='Not checked';inferenceProvider='Not reported';return;
    }
    const abort = capabilityAbort = new AbortController();
    const cloud = connectionController.getCloudClient(), instance = owner;
    gmail = cloud ? 'Checking authorization…' : 'Cloud sign-in required'; gmailAccounts = [];
    inferenceProvider = 'Not reported';
    changed();
    const timeout = setTimeout(() => { abort.abort(); if (owner === instance && capabilityAbort === abort) { if (gmail === 'Checking authorization…') gmail = 'Authorization not verified'; changed(); } }, 10000);
    try {
      await Promise.allSettled([
        (async () => {
          // A status read never replaces a Pause or Turn off result: none starts during the action, and an older one is dropped.
          if (!externalVoiceInvocationEnabled) return;
          const read = listenerReads.beginRead();
          if (read === null) return;
          const status = await listenerStatus();
          if (owner === instance && capabilityAbort === abort && listenerReads.readApplies(read)) listener = status;
        })(),
        (async () => {
          if (!browserLocalAgentEnabled) return;
          const agent = connectionController.getBrowserSpeechAgent();
          if (!agent) return;
          try {
            const status = await agent.request('/api/status', undefined, abort.signal);
            if (abort.signal.aborted || owner !== instance || capabilityAbort !== abort || connectionController.getBrowserSpeechAgent() !== agent) return;
            // This field reports the provider, not a specific model or a Cloud account.
            inferenceProvider = status.state === 'running' && status.model === 'cerebras' ? 'Cerebras' : 'Not reported';
          } catch { /* Keep unverified runtime information explicitly unknown. */ }
        })(),
        (async () => {
          if (!cloud) return;
          try {
            const accounts = await cloud.client.gmailAccounts(abort.signal);
            if (abort.signal.aborted || owner !== instance || capabilityAbort !== abort || connectionController.getCloudClient()?.sessionId !== cloud.sessionId) return;
            gmailAccounts = accounts;
            gmail = gmailGrantLabel(accounts);
          } catch { if (owner === instance && capabilityAbort === abort) gmail = 'Authorization not verified'; }
        })(),
      ]);
    } finally { clearTimeout(timeout); if (owner === instance && capabilityAbort === abort) changed(); }
  }
  /** Android shows its own role dialog; the result is read back from getStatus, never assumed. */
  async function requestHome(api: Bag) {
    if (roleBusy) return;
    const instance = owner; roleBusy = true; changed();
    try {
      await system.requestRole({ role: 'home' });
      const next = readRoles(await system.getStatus());
      if (owner !== instance) return;
      roles = next;
    } catch { if (owner === instance) api.toast('Not changed'); }
    finally { roleBusy = false; if (owner === instance) { changed(); void refresh(); } }
  }
  /** Redacted by construction (diagnostics-export.ts). Shared through Android's chooser or saved as a file. */
  async function exportDiagnostics(api: Bag) {
    if (diagnosticsBusy) return;
    const instance = owner, native = Capacitor.isNativePlatform(); diagnosticsBusy = true; changed();
    try {
      const session=connectionController.getSnapshot().session;
      const diagnostic=await refreshResidentDiagnostics();
      const [buildFacts, problems, roleState, nativeTiming, nativeCloudTiming] = await Promise.allSettled([native ? device.diagnosticsFacts() : Promise.resolve({}), readCrashLog(), native ? system.getStatus() : Promise.resolve({ roles: [] }), readNativeVoiceTiming(), readNativeCloudStreamTiming()]);
      const value: Bag = buildFacts.status === 'fulfilled' ? buildFacts.value : {};
      const connection = connectionController.getSnapshot();
      const subscription = connection.residentSubscription;
      const report = buildDiagnostics({
        platform: native ? 'android' : 'web',
        app: native ? { version: value.appVersion, versionCode: value.versionCode, variant: value.variant, buildType: value.buildType, testMocks: value.testMocks } : { version: buildVersion, testMocks: testMocksEnabled },
        os: native ? { androidRelease: value.androidRelease, securityPatch: value.securityPatch, sdkInt: value.sdkInt } : {},
        upstreamPin: value.upstreamPin, runtimeHashes: value.runtimeHashes,
        permissions: { ...(facts.permissions || {}), ...(typeof delivery.appEnabled === 'boolean' ? { Notifications: delivery.appEnabled && delivery.permissionGranted === true } : {}) },
        roles: roleState.status === 'fulfilled' ? Object.values(readRoles(roleState.value)) : [],
        crashes: problems.status === 'fulfilled' ? problems.value.entries : [],
        connection: { kind: connection.kind, connected: !!connection.session },
        cloudPlan: subscription ? {
          view: subscription.kind, admission: planAdmission(subscription),
          source: 'source' in subscription ? subscription.source : undefined,
          status: 'status' in subscription ? subscription.status : undefined,
          reason: subscription.kind === 'unavailable' ? subscription.reason : undefined,
        } : undefined,
        // Per-turn voice latency kept on this device; buildDiagnostics copies timing fields only.
        realtimeVoiceTiming: exportRealtimeVoiceTiming(),
        voiceStartup: voiceStartupTiming(),
        voiceTiming: (() => { try { return JSON.parse(exportVoiceTiming()); } catch { return null; } })(),
        // Native audio-clock voice latency (issue #395): timings, turn ids and hashes only.
        nativeVoiceTiming: nativeTiming.status === 'fulfilled' ? nativeTiming.value : null,
        nativeCloudStreamTiming: nativeCloudTiming.status === 'fulfilled' ? nativeCloudTiming.value : null,
        nativeInferenceTiming: connection.session===session ? diagnostic?.nativeInferenceTiming : undefined,
        nativeInferenceVoiceJoin: connection.session===session ? diagnostic?.nativeInferenceVoiceJoin : undefined,
      });
      const text = diagnosticsText(report);
      if (native) {
        const result = await device.shareDiagnostics({ text });
        if (result?.status !== 'opened') throw Error('Share unconfirmed');
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = diagnosticsFileName(report); link.hidden = true;
        document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
        if (owner === instance) api.toast('Diagnostics saved');
      }
    } catch { if (owner === instance) api.toast('Export failed'); }
    finally { diagnosticsBusy = false; if (owner === instance) changed(); }
  }
  async function clearProblems(api: Bag) {
    if (crashBusy || !await review('clear-problems','Clear problem log?','','Clear')||crashBusy) return;
    inferenceAbort?.abort();inferenceAbort=null;
    const instance = owner; crashBusy = true; changed();
    try { await clearCrashLog(); crashLog = await readCrashLog(); }
    catch { if (owner === instance) api.toast('Couldn’t clear'); }
    finally { crashBusy = false; if (owner === instance) changed(); }
  }
  /** Background checks stay quiet; the owner's explicit check keeps its result in Settings. */
  async function updateAction(busy: 'check' | 'install', run: () => Promise<unknown> | undefined) {
    if (updateBusy) return;
    const instance=owner;
    updateBusy = busy; if(busy==='check')updateResult=''; changed();
    try {
      const answered=await run();
      if(owner===instance&&busy==='check')updateResult=answered===false?'Couldn’t check for updates. Try again.':parseUpdateManifest(savedUpdate().manifest,{versionCode:facts.appVersionCode,launcher,signerSha256:facts.appSigner})?'A compatible update is ready below.':'No compatible update was offered.';
    } finally { if(owner===instance){updateBusy = ''; changed();} }
  }
  // Show a text-size result on the instance that requested it.
  const showTextScale=(instance:any,result:Bag|null)=>{if(result&&owner===instance){facts={...facts,...result};instance?.vset('settings',{nativeReadAt:Date.now()});}};
  async function refresh() {
    const instance = owner, token = ++generation, scaleAtRead = scaleVersion;
    if (!instance) return;
    resumedUnread = false;
    const native = Capacitor.isNativePlatform();
    const [state, settings, noticeState, crossState, metadata, roleState, build, problems, photos, storage] = await Promise.allSettled([device.snapshot(), system.getDeviceSettings(), notifications.status(), notifications.crossAppStatus(), history===null?Promise.resolve(null):notifications.notificationHistory(),
      // Browsers have no Android roles: the web plugin rejects, so nothing is shown there.
      native ? system.getStatus() : Promise.reject(Error('No device roles')), native && launcher === null ? system.getBuildInfo() : Promise.resolve(null), readCrashLog(), native ? photoLibrary.libraryAccess() : Promise.resolve(null), native ? fileStorage.storageState() : Promise.resolve(null), native ? connectionController.refreshProviderStatus() : Promise.resolve()]);
    if (owner !== instance || generation !== token) return;
    roles = roleState.status === 'fulfilled' ? readRoles(roleState.value) : null;
    if (build.status === 'fulfilled' && build.value) launcher = build.value.launcher === true;
    crashLog = problems.status === 'fulfilled' ? problems.value : null;
    photoAccess = photos.status === 'fulfilled' ? photos.value : null;
    fileAccess = storage.status === 'fulfilled' && (storage.value?.access === 'granted' || storage.value?.access === 'denied') ? storage.value.access : null;
    const previousFacts = facts;
    facts = state.status === 'fulfilled' ? {...state.value} : {};
    // A device snapshot can predate a text-size write. Keep that write's fields,
    // while still publishing unrelated facts from the same pending refresh.
    if (scalePending || scaleAtRead !== scaleVersion) for (const key of ['textScalePercent','effectiveTextZoom']) {
      if (Object.hasOwn(previousFacts,key)) facts[key]=previousFacts[key];
      else delete facts[key];
    }
    controls = settings.status === 'fulfilled' ? settings.value : {};
    delivery = noticeState.status === 'fulfilled' ? noticeState.value : {};
    cross = crossState.status === 'fulfilled' ? crossState.value : {};
    if(metadata.status==='fulfilled'&&metadata.value!==null)history=metadata.value.items;
    // Browser-only stores, probed only for the Developer gate's recovery rows; native Android data has its own platform recovery.
    if(developerTools&&!Capacitor.isNativePlatform()){const next=await recoveryNeeded().catch(()=>[] as RecoveryDomain[]);if(owner!==instance||generation!==token)return;recovery=next;}
    instance.vset('settings', { nativeReadAt: Date.now() });
    refreshPasswordManager();
  }
  async function changeTextScale(percent:number, api:Bag) {
    const instance=owner, token=++scaleGeneration;
    if (!instance) return;
    scalePending=true;
    try {
      const result=await device.setTextScale({percent});
      if(owner!==instance)return;
      if(token===scaleGeneration){scalePending=false;++scaleVersion;}
      const shown=scaleResults.applied(token,scaleGeneration,result);
      if(shown){if(token!==scaleGeneration)++scaleVersion;showTextScale(instance,shown);}
    } catch {
      if(owner!==instance)return;
      const failure=scaleResults.rejected(token,scaleGeneration);
      if(!failure.newest)return;
      scalePending=false;++scaleVersion;
      showTextScale(instance,failure.show);
      api.toast('Text size could not be saved.');
      void refresh();
    }
  }
  p.componentDidMount = function () {
    mount.call(this); owner = this;
    this.mailImagePreferenceChanged=changed;
    this.settingsNavigation=(event:Event)=>{const patch=settingsSectionPatch((event as CustomEvent).detail?.page);if(!patch)return;event.preventDefault();this.openView('settings');this.vset('settings',patch);};
    window.addEventListener('alpha:settings-page',this.settingsNavigation);
    window.addEventListener('alpha:device-settings',this.mailImagePreferenceChanged);
    initializeDevicePreferences(); void refresh(); void refreshCapabilities(); void checkForUpdate(false)?.then(changed);
    if (Capacitor.isNativePlatform() && !testMocksEnabled) {
      automaticUpdates = createAppUpdateScheduler({run:pollAutomaticUpdate,intervalMs:UPDATE_CHECK_INTERVAL_MS});
      document.addEventListener('visibilitychange',automaticUpdateActive);
      automaticUpdateActive();
    }
    this.phoneInfoVisibility=()=>{if(document.hidden)phoneInfo?.sync(false);else changed();};
    document.addEventListener('visibilitychange',this.phoneInfoVisibility);
    this.passwordLifecycle = passwordManagerLifecycle(changed);
    if(!hasAppearancePreview(new URLSearchParams(location.search))){
      // A read from storage or the system scheme carries a marker, so componentDidUpdate never writes it back.
      const apply=()=>{const theme=resolveAppearance(readAppearanceChoice());this.setState({theme,appearanceStorageRead:{theme}});};
      if(!Capacitor.isNativePlatform()){
        this.appearanceStorageListener=(event:StorageEvent)=>{if(event.key===APPEARANCE_KEY||event.key===null)apply();};
        this.appearanceResumeListener=apply;
        window.addEventListener('storage',this.appearanceStorageListener);
        window.addEventListener('pageshow',apply);
        apply();
      }
      this.appearanceScheme=systemScheme();
      this.appearanceSchemeListener=()=>{if(readAppearanceChoice()==='system')apply();};
      this.appearanceScheme?.addEventListener?.('change',this.appearanceSchemeListener);
    }

    let lastBinding = JSON.stringify([connectionController.getSnapshot().session?.sessionId, connectionController.getCloudClient()?.sessionId]);
    this.settingsConnectionUnsubscribe = connectionController.subscribe(() => {
      this.vset('settings', { connectionReadAt: Date.now() });
      const next = JSON.stringify([connectionController.getSnapshot().session?.sessionId, connectionController.getCloudClient()?.sessionId]);
      if (next !== lastBinding) { lastBinding = next; void refreshCapabilities(); }
    });
    this.googleAccountsChanged=()=>void refreshCapabilities();
    window.addEventListener(GOOGLE_ACCOUNTS_CHANGED,this.googleAccountsChanged);
    this.deviceResume = DailyApps.addListener('appResumed', () => {
      void checkForUpdate(false)?.then(changed); automaticUpdateActive();
      if (settingsResumeRead(this.S?.().view) === 'now') { void refresh(); void refreshCapabilities(); return; }
      // Behind another view only the provider status is read; the device facts wait until Settings is shown.
      resumedUnread = true; void refreshCapabilities();
      if (Capacitor.isNativePlatform()) void connectionController.refreshProviderStatus();
    }).catch(() => null);
  };
  p.componentDidUpdate = function (previousProps: Bag, previousState: Bag) {
    update?.call(this, previousProps, previousState);
    // Switching away from Settings (Home, another view) locks and forgets the password manager.
    if (typeof this.S === 'function' && this.S().view !== 'settings') { leavePasswordManager(); reviews.cancelAll(); phoneInfo?.sync(false); }
    const theme = this.state?.theme;
    // The marker travels with React state, so queued external reads cannot echo an older theme.
    const external=this.state?.appearanceStorageRead;
    const fromStorage=external!==previousState?.appearanceStorageRead&&external?.theme===theme;
    if (!fromStorage&&(theme === 'light' || theme === 'dark') && theme !== previousState?.theme) {
      try { localStorage.setItem(APPEARANCE_KEY, theme); }
      catch { this.toast('Theme not saved'); }
    }
  };
  p.componentWillUnmount = function () {
    reviews.cancelAll();
    phoneInfo?.sync(false); phoneInfo=null;
    document.removeEventListener('visibilitychange',this.phoneInfoVisibility);
    automaticUpdates?.dispose(); automaticUpdates = undefined;
    document.removeEventListener('visibilitychange',automaticUpdateActive);
    if (owner === this) { capabilityAbort?.abort(); capabilityAbort = null; inferenceAbort?.abort();inferenceAbort=null; owner = null; ++generation; ++scaleGeneration; ++scaleVersion; scalePending=false; scaleResults=textScaleSettlement(); updateBusy=''; updateResult=''; facts = {}; controls = {}; delivery = {}; cross={}; choices=null; history=null; roles=null; crashLog=null; photoAccess=null; fileAccess=null; }
    window.removeEventListener('alpha:settings-page',this.settingsNavigation);
    window.removeEventListener('alpha:device-settings',this.mailImagePreferenceChanged);
    window.removeEventListener('storage',this.appearanceStorageListener);
    window.removeEventListener('pageshow',this.appearanceResumeListener);
    this.appearanceScheme?.removeEventListener?.('change',this.appearanceSchemeListener);
    this.settingsConnectionUnsubscribe?.();
    window.removeEventListener(GOOGLE_ACCOUNTS_CHANGED,this.googleAccountsChanged);
    this.passwordLifecycle?.();
    void this.deviceResume?.then((listener: any) => listener?.remove()); unmount.call(this);
  };
  // Settings shown again after a resume behind another view reads the device facts it skipped.
  const appearanceUpdate = p.componentDidUpdate;
  p.componentDidUpdate = function (...args: any[]) {
    appearanceUpdate.apply(this, args);
    if (resumedUnread && owner === this && this.S?.().view === 'settings') { void refresh(); void refreshCapabilities(); }
  };
  p.openView = function (key: string, ...args: any[]) {
    if (key === 'settings') resumedUnread = false;
    const result = openView.call(this, key, ...args);
    if (key === 'settings') { void refresh(); void refreshCapabilities(true); }
    return result;
  };
  const categoryNames:Record<string,string>={'settings-account':'Account','settings-general':'General','settings-privacy':'Privacy','settings-help':'About','settings-apps':'Apps'};
  /* Settings → General → Phone exists only on the verified Alpha image, through the shared telephony profile. */
  let phoneInfo:ReturnType<typeof createPhoneInfoLoader>|null=null;
  const phoneLoader=()=>{const client=aospImage?telephonyProfile():null;return client?phoneInfo??=createPhoneInfoLoader(client,changed):null;};
  const settingsBack = definition.back;
  const settingsParents: Record<string,string> = {'agent-connection':'about',problems:'developer',licenses:'about','password-entry':'password-provider','settings-permissions':'settings-privacy','license-detail':'licenses','phone-info':'settings-general'};
  definition.back = (state:Bag,api:Bag) => {
    if(!state.sheet&&((typeof state.page==='string'&&Object.hasOwn(categoryNames,state.page))||(!state.page&&state.settingsCategory))){api.set({page:null,settingsCategory:null});return true;}
    if(!state.sheet&&settingsParents[state.page]){if(state.page==='password-entry')leavePasswordEntry();api.set({page:settingsParents[state.page]});return true;}
    if(!state.sheet&&PASSWORD_PAGES.includes(state.page))leavePasswordManager();
    return settingsBack ? settingsBack(state,api) : false;
  };
  definition.render = (state: Bag, api: Bag) => {
    const activeSettingsCategory=typeof state.settingsCategory==='string'&&Object.hasOwn(categoryNames,state.settingsCategory)?state.settingsCategory:null;
    const permissionsPage=state.page==='settings-permissions'||state.page==='privacy';
    const appSettingsPage=typeof state.page==='string'&&state.page.startsWith('app-settings-')?state.page.slice(13):null;
    const categoryPage=typeof state.page==='string'&&Object.hasOwn(categoryNames,state.page)?state.page:!state.page?activeSettingsCategory:null;
    const phonePage=state.page==='phone-info'&&!!phoneLoader();
    phoneInfo?.sync(phonePage&&!document.hidden);
    const out = render({ ...state, page: categoryPage||appSettingsPage||permissionsPage||phonePage?null:settingsPage(state.page, developerTools), acct: null, adding: false, sheet: ['conn', 'voice', 'wipe', 'wifiPw', 'forget'].includes(state.sheet?.kind) ? null : state.sheet }, api);
    // Prototype personality values are mock-only until the agent reports them.
    out.persona = 'Voice & personality';
    const connection = connectionController.getSnapshot();
    const account = connection.cloudAccount;
    out.settingsVersion=buildVersion==='Unavailable'?'Development preview':buildVersion;
    out.accountEmail=account?(account.email||'Signed in'):'Signed out';out.accountDot=account?'ok':'off';
    out.openAccount=()=>connectionController.openPlan();
    const serviceName = cloudServiceName(connectionController.getCloudClient()?.client.environment ?? account?.environment ?? connection.signIn?.environment ?? 'production');
    // The always-present resident is starting or recovering, never "not connected" (P-43).
    const pending = agentPendingText(connection, 'Not connected');
    const target = connection.session ? connection.name : pending;
    const runtimeLocation=!connection.session?pending:connection.kind==='resident'?(Capacitor.isNativePlatform()?'This phone':'This computer · dev'):testMocksEnabled?'Remote':'Unsupported';
    // About and Models read the model the resident reports the same way, so the two pages agree.
    const residentProvider=connection.kind==='resident'&&connection.session?connection.providerStatus:null;
    const inferenceModel=residentProvider?.configured&&residentProvider.model?modelLabel(residentProvider.provider==='elizacloud'?serviceName:'Cerebras',residentProvider.model):'Not reported';
    const cloudLabel = account ? account.email||`Account ${account.userId.slice(0, 8)}` : 'Not signed in';
    const manage = (page: string) => () => void device.openSettings({ page }).then(opened => { const notice = broaderPageNotice(page, opened); if (notice) api.toast(notice); }, () => api.toast('Unavailable'));
    const info = (label: string, val: string, id = label): Bag => ({ id, kInfo: true, label, val, hasVal: true, noAB: true });
    const note = (label: string, sub: string): Bag => ({ kInfo: true, label, val: '', hasVal: false, hasSub: true, sub, noAB: true });
    // Permission state: one word beside a dot (never colour alone).
    const permissionDot = (val: string) => val === 'Allowed' || val === 'All' || val === 'Precise' ? 'ok' : val === 'Ask' || val === 'Selected' || val === 'Limited' || val === 'Approx.' || val === 'Chosen files' || val === 'Alpha only' ? 'warn' : 'off';
    const permissionInfo = (label: string, val: string): Bag => ({ ...info(label, val), hasDot: val !== '—' && val !== 'Unavailable', dot: permissionDot(val) });
    // Listening could not be confirmed off: a red row at the top that opens the listener's settings.
    const micMayBeOn = (): Bag => ({ kNav:true, label:'Microphone', lbl:'Microphone may be on, open listener settings', val:'Mic may be on', hasVal:true, hasDot:true, dot:'err', valCss:'color:var(--fg)', lucide:'mic-off', hasExt:true, chev:false, noAB:true, go:()=>void openListenerSettings().then(opened => { if (!opened) api.toast('Unavailable'); }) });
    // Android hand-offs: a short label and an external-link mark; the accessible name keeps the destination.
    const nav = (label: string, page: string, aria = label): Bag => ({ kNav: true, label, lbl: aria, chev: false, hasExt: true, noAB: true, go: manage(page) });
    const group = (rows: Bag[], id?: string) => ({ ...(id ? {id} : {}), css: 'background:var(--s2);padding:4px 0', rows });
    const run = async (task:()=>Promise<void>)=>{if(notificationBusy)return;notificationBusy=true;changed();const current=owner;try{await task();if(owner===current)await refresh();}catch{if(owner===current)api.toast('Couldn’t update');}finally{notificationBusy=false;if(owner===current)changed();}};
    // Speech follows the run-time route (voice-selection.ts): the row names the route in use now.
    // Developer routes stay separate.
    const voiceRoute = speechRoute();
    const speechRows = (): Bag[] => [
      // Data leaving the phone stays at the Speech row (≤4 words).
      {...info('Speech', voiceRoute==='direct'?'Cartesia':testMocksEnabled&&connection.residentInference==='direct'?'Off':developmentCartesiaVoiceEnabled?'Cartesia':voiceRoute==='cloud'||testMocksEnabled?serviceName:'On this device'),
        ...(voiceRoute==='cloud'&&!developmentCartesiaVoiceEnabled?{hasSub:true,sub:`Audio → ${serviceName}`}:{})},
      ...(wakeListeningStopUnconfirmed() ? [micMayBeOn()] : []),
    ];
    const action = (label: string, go: () => void, id = label): Bag => ({ id, kNav:true, label, lbl:label, chev:true, noAB:true, go });
    const listenerRows = (): Bag[] => {
      if (!externalVoiceInvocationEnabled) return [];
      if (!listener.available) return [];
      const status = listener, on = !!status.consented && status.state !== 'OFF';
      const settings = () => void openListenerSettings().then(opened => { if (!opened) api.toast('Unavailable'); });
      // One Listening switch: off goes through the listener; on (and resume) only in its own consent screen.
      return [
        {kTog:true, label:'Listening', aria:'Listening', hasSub:true, sub:listenerReads.busy()?'':status.label, on, track:on?'background:var(--acc)':'background:var(--line)', kx:on?20:0, dis:listenerReads.busy(), toggle:()=>on?void listenerAction(api, 'turnOff'):settings()},
        ...(status.listening || status.microphoneOpen ? [{...action('Pause', () => void listenerAction(api, 'pause')), lbl:'Pause listening', busy:listenerReads.busy(), hasSpin:listenerReads.busy()}] : []),
        {...action('Listening settings', settings), hasExt:true, chev:false},
      ];
    };
    const problemCount = crashLog ? crashLog.entries.length : null;
    const problemsRow = (): Bag => ({ kNav:true, label:'Problem log', lbl:problemCount?`Problem log, ${problemCount}`:'Problem log', val: problemCount === null ? 'Unavailable' : problemCount ? String(problemCount) : '', hasVal:problemCount !== 0, valCss:problemCount?'padding:2px 9px;border-radius:11px;background:var(--bg);color:var(--fg);font-variant-numeric:tabular-nums':'', chev:true, noAB:true, go:()=>{ api.set({ page:'problems' }); void refresh(); void refreshResidentDiagnostics(); } });
    const diagnosticsRow = (): Bag => ({ kNav:true, label:'Export diagnostics', lbl:'Export diagnostics', hasSpin:diagnosticsBusy, chev:!diagnosticsBusy, noAB:true, go:()=>void exportDiagnostics(api) });
    const connectionHelpRow = (): Bag => ({kNav:true,label:'Status',lbl:'Status',val:connection.name,hasVal:true,chev:true,noAB:true,go:()=>Capacitor.isNativePlatform()&&!testMocksEnabled?api.set({page:'agent-connection'}):connectionController.open()});
    const licensesRow = (): Bag => ({ kNav:true, label:'Licenses', lbl:'Licenses', chev:true, noAB:true, go:()=>{ api.set({ page:'licenses',licenseQuery:'' }); void loadLicenses(changed); } });
    const percent = typeof facts.batteryPercent === 'number' ? `${facts.batteryPercent}%` : 'Unavailable';
    const active = (key: string) => typeof facts[key] === 'boolean' ? facts[key] ? 'Active' : 'Inactive' : 'Unavailable';
    // System switches as Android reported them (AlphaDevice.snapshot). Alpha cannot change any of
    // them; a switch Android did not answer for keeps its earlier wording and is never shown as off.
    const wifiValue = switchValue(facts.wifiEnabled, active('wifiActive'), { on: facts.wifiActive === true ? 'Connected' : 'On' });
    const bluetoothValue = switchValue(facts.bluetoothEnabled, Capacitor.isNativePlatform() ? '' : active('bluetoothActive'));
    const mobileValue = facts.airplaneMode === true ? 'Airplane mode' : switchValue(facts.mobileDataEnabled, active('cellularActive'), { on: facts.cellularActive === true ? 'In use' : 'On' });
    const reported = (value: unknown) => switchValue(value, '—');
    const interruptionLabels:Bag={all:'Off',priority:'Priority only',alarms:'Alarms only',none:'On',unknown:'Not available'};
    const browserNotifications = delivery.scope === 'browser';
    const topValues: Bag = {
      'Wi-Fi': wifiValue, 'Bluetooth': bluetoothValue, 'Mobile data': mobileValue,
      'Accounts': account ? 'Connected' : 'Signed out', 'Connections': gmail,
      'Battery': percent, 'Models': target, 'About': facts.appVersion || 'Unavailable',
      'Notifications': typeof delivery.appEnabled !== 'boolean' ? 'Unavailable' : !delivery.appEnabled || !delivery.permissionGranted ? 'Off' : delivery.channels?.some((c:Bag)=>c.blocked||c.groupBlocked) ? 'Some off' : 'On',
      'Sound & vibration': '',
    };
    for (const page of out.stack) {
      if (page.isTop) {
        page.groups = page.groups.map((group: Bag) => ({ ...group, rows: settingsNavigationRows(group.rows, developerTools) }));
        const native=Capacitor.isNativePlatform(), provider=facts.passwordProvider||{};
        const installation:Bag={installed:['Verified','ok'],disabled:['Disabled','warn'],absent:['Not installed','off'],'unrecognized-publisher':['Unrecognized','err'],unknown:['—','off']};
        const selection:Bag={proton:provider.installation==='installed'?['Selected','ok']:provider.installation==='disabled'?['Disabled','warn']:['Unverified','err'],other:['Other','off'],none:['None','off'],unknown:['—','off']};
        const dotted=(row:Bag,[word,dot]:string[]):Bag=>({...row,val:word,hasDot:true,dot});
        const passwordAction=(label:string,kind:string):Bag=>({kNav:true,label,lbl:passwordOpening?'Opening…':label,chev:true,noAB:true,go:async()=>{
          if(passwordOpening)return;passwordOpening=true;const instance=owner;changed();
          try{const result=await device.openPasswordProvider({action:kind});if(result?.status!=='opened')throw Error('Unconfirmed provider handoff');}
          catch{if(owner===instance)api.toast('Unavailable');}
          finally{passwordOpening=false;if(owner===instance){changed();void refresh();}}
        }});
        const passwordGroup=group(browserDevProfile?[
          info('Provider',provider.installation==='installed'?'Development provider installed':'Not installed'),
          info('Selection',provider.selection==='proton'?'Development provider selected':'No provider selected'),
          info('Autofill','Sample sign-in in the development vault'),
          passwordAction('Choose password provider','settings'),
          provider.installation==='installed'?passwordAction('Open development vault','open'):passwordAction('Add development provider','install'),
        ]:[
          // One Proton Pass row (status dot + word); its choices open beneath it.
          native?{...dotted({kNav:true,label:'Proton Pass',lbl:'Proton Pass',hasVal:true,chev:true,noAB:true,go:()=>{protonOpen=!protonOpen;changed();}},installation[provider.installation]||['—','off']),'aria-expanded':protonOpen}:info('Proton Pass','Browser'),
          ...(native&&protonOpen?[
            dotted(info('Selection',''),selection[provider.selection]||['—','off']),
            dotted(info('Autofill',''),provider.support==='available'?['Available','ok']:provider.support==='unavailable'?['Unavailable','off']:['—','off']),
            {...passwordAction('Choose provider','settings'),hasExt:true,chev:false},
            ...(provider.installation==='installed'?[passwordAction('Open Proton Pass','open')]:provider.installation==='absent'?[{...passwordAction('Get Proton Pass','install'),hasExt:true,chev:false}]:[]),
            {kNav:true,label:'Refresh',lbl:'Refresh password provider status',lucide:'rotate-cw',chev:false,noAB:true,go:()=>void refresh()},
          ]:[]),
        ]);
        if(native){
          const photoAction=(label:string,go:()=>void):Bag=>({kNav:true,label,lbl:label,chev:true,noAB:true,go});
          page.groups.push(group([photoAction('Photos',()=>{api.set({page:'photos'});void refresh();})]));
          if(state.page==='photos'){
            const status=photoAccess?.scope==='full'?'All':photoAccess?.scope==='selected'?'Selected':photoAccess?.scope==='partial'?'Limited':photoAccess?.scope==='denied'?'Alpha only':'—';
            const choose=async()=>{if(photoAccessBusy)return;photoAccessBusy=true;changed();const instance=owner;try{const access=await photoLibrary.requestLibraryAccess();if(owner===instance)photoAccess=access;}catch{if(owner===instance)api.toast('Couldn’t open');}finally{photoAccessBusy=false;if(owner===instance)changed();}};
            out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Photos',hasTitle:true,backLabel:'Back to Settings',back:()=>api.set({page:null}),hero:{},groups:[group([
              {...photoAction('Library access',()=>void choose()),lbl:'Change photo access',val:status,hasVal:true,busy:photoAccessBusy,hasSpin:photoAccessBusy,chev:false,hasExt:!photoAccessBusy},
              {...photoAction('Android photo permissions',()=>void photoLibrary.openLibrarySettings().catch(()=>api.toast('Couldn’t open'))),label:'Permissions',hasExt:true,chev:false},
            ])]});
          }
        }
        // calendar-settings:begin
        page.groups.push(group([{kNav:true,label:'Calendar',lbl:'Calendar',chev:true,noAB:true,go:()=>api.set({page:'calendar'})}]));
        if(state.page==='calendar'||state.page==='calendar-google'){
          const display=views.calendar.displaySources?.(),calendarView=owner?views.calendar.render(owner.vget('calendar'),owner.api('calendar')):null;
          const model=owner?.agentCalendar?.state,authority=owner?.vget('calendar').calendarAuthority;
          const googleCalendars=gmailAccounts.filter(account=>account.connected&&account.connectionId&&account.grantedCapabilities.includes('google.calendar.read'));
          const hasGoogleWrites=googleCalendars.some(account=>account.grantedCapabilities.includes('google.calendar.write'));
          const checking=gmail==='Checking authorization…',unavailable=gmail==='Authorization not verified';
          const googleStatus:[string,string]=checking?['','off']:unavailable?['Couldn’t check','err']:googleCalendars.length?(hasGoogleWrites?['Connected','ok']:['Finish setup','warn']):['Not connected','off'];
          const groups:Bag[]=[group([{kNav:true,label:'Google Calendar',lbl:'Google Calendar',sub:googleStatus[0],hasSub:!checking,hasSubDot:!checking,dot:googleStatus[1],hasSpin:checking,lucide:'calendar-days',chev:true,noAB:true,go:()=>{const scope=owner?.calendarConnectionScope?.();if(scope)googleConnectionController.openCalendar(scope);}}])];
          const needsRecovery=['legacy','android-native','browser-local'].includes(authority)||model?.status==='transition-required'||model?.status==='legacy-recovery';
          if(needsRecovery){
            const recovery:Bag[]=[];
            if(calendarView?.canConfirmCalendarTransition)recovery.push({kNav:true,label:'Review',lbl:'Review saved events',chev:true,noAB:true,go:calendarView.confirmCalendarTransition});
            if(model?.status==='legacy-recovery')recovery.push({kNav:true,label:'Recover',lbl:'Recover saved events',chev:true,noAB:true,go:()=>openCalendarRecovery()});
            if(['legacy','android-native','browser-local'].includes(authority)){
              const useCalendar=calendarView?.calendarAuthorityChoices?.find((choice:Bag)=>choice.label==='Agent Calendar');
              if(useCalendar)recovery.push({kNav:true,label:'Use Calendar',lbl:'Return to Calendar',chev:true,noAB:true,go:useCalendar.go});
            }
            if(recovery.length)groups.push({...group(recovery),cap:'Recovery',hasCap:true});
          }else if(['error','partial','unavailable'].includes(model?.status)||model?.status==='ready'&&calendarView?.nativeStatusLabel){
            groups.push(group([{kNav:true,label:'Calendar',lbl:'Retry calendar',val:model?.status==='partial'||model?.status==='ready'?'Partly loaded':'Not loaded',hasVal:true,hasDot:true,dot:'warn',lucide:'rotate-cw',chev:false,noAB:true,go:calendarView?.nativeStatusRetry??display?.retry}]));
          }else if(display?.native&&!display.loading&&!display.ready){
            groups.push(group([{kNav:true,label:'Allow access',lbl:'Review calendar access',chev:true,noAB:true,go:display.connect??display.retry}]));
          }
          if(developerTools&&!Capacitor.isNativePlatform())groups.push({...group([{kNav:true,label:'Calendar backups',lbl:'Calendar backups',sub:'Events saved in this app',hasSub:true,chev:true,noAB:true,go:()=>openCalendarRecovery()}]),cap:'Saved data',hasCap:true});
          const calendarChannel=(delivery.channels||[]).find((c:Bag)=>c.id==='calendar');
          if(calendarChannel&&!Capacitor.isNativePlatform())groups.push(group([{kTog:true,label:'Alerts',aria:'Calendar alerts',on:!calendarChannel.blocked,track:!calendarChannel.blocked?'background:var(--acc)':'background:var(--line)',kx:!calendarChannel.blocked?20:0,toggle:()=>void run(async()=>{await notifications.setAlertPreferences({channelId:calendarChannel.id,enabled:!!calendarChannel.blocked});})}]));
          out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Calendar',hasTitle:true,backLabel:'Back to Settings',back:()=>api.set({page:null}),hero:{},groups});

        }
        // calendar-settings:end
        // Only performRequested reads this preference: canonical Notes writes and in-app navigation are
        // not reviewed (owner decision, November 6). Unreadable preferences never draw as Off.
        const preferences=devicePreferencesStatus();
        page.groups.push(group([{
          // Scope as chips; unreadable preferences stay locked on (Alpha asks before every action).
          kTog:true,label:'Ask before Alpha acts',aria:'Ask before Alpha acts',hasSub:false,
          hasTags:preferences==='ready',tags:[{label:'Web'},{label:'Camera'},{label:'Photos'}],
          hasIcon:preferences==='unavailable',d:api.ic?.lock,
          on:preferences!=='ready'||cachedDevicePreferences()?.askBeforeAgentActions!==false,
          track:preferences!=='ready'||cachedDevicePreferences()?.askBeforeAgentActions!==false?'background:var(--acc)':'background:var(--line)',
          kx:preferences!=='ready'||cachedDevicePreferences()?.askBeforeAgentActions!==false?20:0,
          dis:preferences!=='ready',
          toggle:async()=>{const saved=cachedDevicePreferences();if(!saved){if(devicePreferencesStatus()==='unavailable')api.toast('Couldn’t load');return;}try{await editDevicePreferences(value=>{value.askBeforeAgentActions=!saved.askBeforeAgentActions;});changed();}catch{api.toast('Not saved');}}
        },...(preferences==='unavailable'?[{kNav:true,label:'Recover device settings',lbl:'Recover device settings',hasSub:true,sub:'Back up first',chev:true,noAB:true,go:()=>openDevicePreferencesRecovery()}]:[])]));
        page.groups.push(group([{kNav:true,label:'Password manager',lbl:'Password manager',chev:true,noAB:true,go:()=>api.set({page:'password-provider'})}]));
        if(PASSWORD_PAGES.includes(state.page)){
          const helpers={info,group,toast:(message:string)=>api.toast(message),set:(patch:Bag)=>api.set(patch),ic:api.ic||{}};
          // Alpha's own vault first; Proton Pass stays available as another provider.
          out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Password manager',hasTitle:true,backLabel:'Back to Settings',back:()=>{leavePasswordManager();api.set({page:null});},hero:{},groups:[...passwordManagerGroups(helpers),{...passwordGroup,cap:'Other',hasCap:true}]});
          const entry=state.page==='password-entry'?passwordEntryPage(helpers,()=>api.set({page:'password-provider'})):null;
          if(entry)out.stack.push(entry);else if(state.page==='password-entry')queueMicrotask(()=>api.set({page:'password-provider'}));
        }else leavePasswordManager();
        if(native){
          const home=roles?.home,canRequestHome=launcher===true&&!!home&&home.available&&!home.held;
          const role=(label:string,row:RoleRow|undefined)=>({...info(label,roles?roleValue(row):'Unavailable'),hasDot:!!row?.held,dot:'ok'});
          page.groups.push(group([role('Home app',home),role('Assistant app',roles?.assistant),
            ...(canRequestHome?[{kNav:true,label:'Set as Home',lbl:'Make Alpha your Home app',busy:roleBusy,hasSpin:roleBusy,chev:!roleBusy,noAB:true,go:()=>void requestHome(api)}]:[]),
            nav('Default apps','default-apps','Default apps in Android')]));
          const updatePermission = facts.appAutomaticUpdates;
          // Install update only for the version the last manifest offers this install, and an explicit check whose answer stays below it.
          const update=parseUpdateManifest(savedUpdate().manifest,{versionCode:facts.appVersionCode,launcher,signerSha256:facts.appSigner});
          page.groups.push(group([
            ...(updatePermission === 'permission-required' ? [{
              ...action('Allow automatic updates', () => void device.openUpdatePermissionSettings()
                .then(result => { if (result.status !== 'opened') api.toast('Couldn’t open Android settings'); },
                  () => api.toast('Couldn’t open Android settings')), 'update-permission'),
              lucide: 'shield',
            }] : updatePermission === 'supported' ? [info('Automatic updates', 'Allowed')]
              : updatePermission === 'starting' ? [info('Automatic updates', 'Starting')] : []),
            ...(update?[{...action('Update',()=>void updateAction('install',()=>device.installUpdate({apkUrl:update.apkUrl,sha256:update.sha256,sizeBytes:update.sizeBytes,versionCode:update.versionCode}).catch(()=>{/* Quiet: the row stays and the next tap retries. */}))),lbl:updateBusy==='install'?'Downloading update':'Install update',lucide:'download',val:update.versionName?versionLabel(update.versionName,update.versionCode):String(update.versionCode),hasVal:true,busy:!!updateBusy,hasSpin:updateBusy==='install',chev:false,id:'update-install'}]:[]),
            {...action('Check',()=>void updateAction('check',()=>checkForUpdate(true)),'update-check'),lbl:updateBusy==='check'?'Checking for updates':'Check for updates',lucide:'rotate-cw',busy:!!updateBusy,hasSpin:updateBusy==='check',chev:false},
            ...(updateResult?[{...info('Update check',updateResult),role:'status',live:'polite'}]:[])]));
        }
        // Every Alpha Phone signs in to Eliza Cloud and holds a plan: account, plan and sign-in expiry.
        const plan=connectionController.residentPlanSettings();
        if(plan){
          const day=(at:number)=>new Date(at).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
          if(state.page==='cloud-plan')out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Account',hasTitle:true,backLabel:'Back to Settings',back:()=>api.set({page:null}),hero:{},groups:[group([{kNav:true,label:'Open account',lbl:'Open account',chev:true,noAB:true,go:()=>connectionController.openPlan()}])]});
        }

        page.groups.push(group([{...connectionHelpRow(),label:'Agent connection',lbl:'Agent connection',val:connection.session?'Running':pending,hasDot:true,dot:connection.session?'ok':connection.residentRecoveryReason?'err':'warn'},{kNav:true,label:'AI provider',lbl:'AI provider',val:connection.providerStatus?.selected&&connection.providerStatus.provider==='cerebras'?'Own key':connection.providerStatusError?'—':'Cloud',hasVal:true,chev:true,noAB:true,go:()=>connectionController.openProviderSettings()}]));
        // Raw recovery reason, stage and record count are developer data: the product keeps the plain status.
        if(native&&developerTools&&state.page==='agent-recovery-details'){
          const reason=connection.residentRecoveryReason,recovery=connection.residentRecovery;
          const rows:Bag[]=[info('Status',reason?residentRecoveryCopy(reason,recovery):connection.session?'Running':'—')];
          if(reason)rows.push(info('Reason',reason));
          if(recovery)rows.push(info('Stage',recovery.step));
          if(recovery?.step==='review')rows.push(info('Kept items',String(recovery.review.retainedCount)));
          out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Restart details',hasTitle:true,backLabel:'Back to Agent connection',back:()=>api.set({page:'agent-connection'}),hero:{},groups:[group(rows)]});
        }
        if(native&&!testMocksEnabled&&state.page==='agent-connection'){
          const agentStatus:[string,string] = connection.session ? (connection.kind==='resident'?['Running','ok']:[runtimeLocation,'ok']) : connection.residentRecoveryReason ? (connection.residentRecoveryReason==='ipc-recovery-retention-limit'?['Restart','warn']:['Error','err']) : connection.kind==='recovering'?['Off','off']:['Starting','warn'];
          const ai=connection.residentInference==='direct'?'Cerebras':connection.residentInference==='cloud'?serviceName:'';
          // Data leaving the phone: the AI row names where prompts go.
          const agentRows:Bag[]=[{...info('Agent',agentStatus[0]),hasDot:true,dot:agentStatus[1]},{...info('AI',ai||(!connection.cloudAccount&&connection.residentPlanNotice!=='offline'?'Sign in':!connection.session&&connection.kind==='starting'&&!connection.residentRecoveryReason?'Starting':'—')),hasDot:true,dot:ai?'ok':'off',...(ai?{hasSub:true,sub:`Sends prompts to ${ai}`}:{})}];
          if(connection.message)agentRows.push(info('Status',connection.message));
          if(connection.error)agentRows.push({...info('Problem',connection.error),hasDot:true,dot:'err'});
          if(connection.residentRecoveryReason&&!connection.session){
            // Kept (S233 adapted): the recovery copy is the only instruction when no button can help.
            agentRows.push(info('Status',residentRecoveryCopy(connection.residentRecoveryReason,connection.residentRecovery)));
            if(connection.residentRecoveryReason==='ipc-recovery-retention-limit'&&!connection.busy)
              agentRows.push(action('Restart Alpha',()=>void connectionController.restartRecovery()));
            else if(connection.residentRecoveryReason==='runtime-identity-unavailable'&&!connection.busy)
              agentRows.push(action('Try again',()=>void connectionController.retryStartup()));
            if(connection.residentRecoveryReason!=='ipc-recovery-retention-limit')
              agentRows.push(diagnosticsRow());
            if(developerTools)agentRows.push(action('Details',()=>api.set({page:'agent-recovery-details'})));
          }else if(!connection.busy)agentRows.push({...action(connection.session?'Reconnect':'Retry',()=>void connectionController.startLocal()),lbl:connection.session?'Reconnect agent':'Retry',lucide:'rotate-cw',chev:false});
          if(connection.busy){
            agentRows.push({kNav:true,label:'Connection',lbl:'Connecting',busy:true,hasSpin:true,noAB:true,go:()=>{}});
            if(connection.residentRecovery?.step!=='archiving')agentRows.push(action('Cancel',()=>connectionController.cancel()));
          }
          const groups:Bag[]=[group(agentRows)];
          if(connection.session){
            const historyRows:Bag[]=[];
            if(!connection.busy){
              historyRows.push({...action('New',()=>void connectionController.newConversation()),lbl:'New conversation',lucide:'plus',chev:false},{...action('History',()=>void connectionController.listHistory()),lbl:'Load conversations',lucide:'clock'});
              for(const item of connection.conversations)historyRows.push({...action(item.title,()=>void connectionController.restoreHistory(item.id),`conversation:${item.id}`),lbl:`Restore conversation: ${item.title}`,lucide:'undo-2',chev:false});
            }
            if(connection.historyError){historyRows.push(info('History',connection.historyError));if(!connection.busy)historyRows.push({...action('Retry',()=>void connectionController.retrySavedHistory()),lbl:'Retry saved conversation',lucide:'rotate-cw',chev:false});}
            groups.push(group(historyRows));
          }
          if(connection.session&&connection.phoneActionsAvailable){
            const refreshRows=[{...action('Phone actions',()=>void connectionController.actionHistory(true)),lbl:connection.busy?'Loading phone actions':'Refresh actions',busy:!!connection.busy,hasSpin:!!connection.busy,lucide:'rotate-cw',chev:false}];
            groups.push(group(refreshRows));
            for(const item of connection.actionHistory){
              const rows:Bag[]=[{...info(item.title,item.outcome+(item.timestamp?` · ${item.timestamp}`:''),`action:${item.id}:status`),hasDot:true,dot:item.state==='pending'?'warn':['executing','reconciliation_required'].includes(item.state)?'warn':item.state==='failed'||item.state==='rejected'?'off':'ok'}];
              if(item.detail)rows.push(info('Details',item.detail,`action:${item.id}:detail`));
              if(!connection.busy){
                if(item.state==='pending')rows.push({...action('Decline',()=>void connectionController.rejectAction(item.id),`action:${item.id}:reject`),lbl:'Reject proposal'});
                if(['executing','reconciliation_required'].includes(item.state))rows.push({...action('Happened',()=>void connectionController.reconcileAction(item.id,'applied'),`action:${item.id}:applied`),lbl:'I verified it happened',lucide:'check',chev:false},{...action('Didn’t',()=>void connectionController.reconcileAction(item.id,'not_applied'),`action:${item.id}:not-applied`),lbl:'I verified it did not happen',lucide:'x',chev:false});
              }
              groups.push(group(rows,`agent-action:${item.id}`));
            }
          }
          out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Status',hasTitle:true,backLabel:'Back to Settings',back:()=>api.set({page:null}),hero:{},groups});
        }
        if(native)page.groups.push(group([{kNav:true,label:'Erase all data',lbl:'Reset Alpha data',labCss:'color:#d93025',lucide:'trash-2',chev:true,noAB:true,go:async()=>{
          // Shared native review (@elizaos/capacitor-system/reset): only cancelled or unavailable reach here.
          // A plain cancel needs no toast; an expired review or missing authentication still says so.
          const result=await reviewDataReset(registerPlugin<DataResetPlugin>('AlphaReset'));
          if(result.status!=='cancelled'||!RESET_CANCEL_TEXTS.has(result.message))api.toast(errorNotice(result.message,'Reset isn’t available right now. Nothing was erased.'),ERROR_TOAST);
        }}]));
        if(developerTools)page.groups.push(group([{kNav:true,label:'Try mock mode',lbl:'Try mock mode',chev:true,noAB:true,go:()=>connectionController.mock()}]));
        if(developerTools&&recovery.length)page.groups.push(group([info('Saved data needs recovery','Back up before resetting'),...recovery.map(name=>({kNav:true,label:recoveryActions[name].label,lbl:recoveryActions[name].label,chev:true,noAB:true,go:()=>recoveryActions[name].open()}))]));
        if(state.page==='problems'){
          const rows=crashLog?[...crashLog.entries].reverse().map(entry=>{const line=describeCrashEntry(entry);return {id:`problem:${JSON.stringify([entry.at,entry.source,line.title,line.detail])}`,kLog:true,time:new Date(entry.at).toLocaleString(),text:`${line.title} · ${line.detail}`};}):[];
          out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Problem log',hasTitle:true,backLabel:'Back to Settings',back:()=>api.set({page:null}),hero:{},groups:[
            group(crashLog?(rows.length?rows:[{...info('No problems','None'),hasDot:true,dot:'ok'}]):[{kNav:true,label:'Unavailable',lbl:'Problem log unavailable, retry',lucide:'rotate-cw',chev:false,noAB:true,go:()=>void refresh()}]),
            group([{...diagnosticsRow(),label:'Export',lucide:'share-2'},...(crashLog?.entries.length?[{kNav:true,label:'Clear',lbl:crashBusy?'Clearing problem log':'Clear problem log',lucide:'trash-2',busy:crashBusy,hasSpin:crashBusy,chev:false,noAB:true,go:()=>void clearProblems(api)}]:[])]),
          ]});
        }
        if(state.page==='licenses'){
          const query=typeof state.licenseQuery==='string'?state.licenseQuery:'';
          const matches=licenses.items.map((item,index)=>({item,index})).filter(({item})=>(item.name+' '+item.version+' '+item.license).toLowerCase().includes(query.trim().toLowerCase()));
          const rows=matches.map(({item,index})=>({...action(item.name,()=>api.set({page:'license-detail',licenseIndex:index}),`license:${JSON.stringify([item.name,item.version,item.source])}`),lbl:item.name+' '+item.version,sub:item.version+' · '+item.license,hasSub:true,licenseComponent:true}));
          out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Licenses',hasTitle:true,backLabel:'Back to About',back:()=>api.set({page:'about'}),hero:{},groups:licenses.status==='ready'?[group([{kLicenseSearch:true,value:query,change:(event:Event)=>api.set({licenseQuery:(event.target as HTMLInputElement).value})}]),group(rows.length?rows:[info('No matches','')])]:[group([licenses.status==='unavailable'?info('Unavailable',''):{kNav:true,label:'Licenses',lbl:'Loading license notices',busy:true,hasSpin:true,noAB:true,go:()=>{}}])]});
        }
        if(state.page==='license-detail'){
          const item=Number.isSafeInteger(state.licenseIndex)?licenses.items[state.licenseIndex]:null;
          out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'License details',hasTitle:true,backLabel:'Back to licenses',back:()=>api.set({page:'licenses'}),hero:{},groups:item?[group([info(item.name,item.version+' · '+item.license)]),...(item.source?[group([{kLegalText:true,label:'Source',text:item.source}])]:[]),...(licenseFlagRows(item).length?[group(licenseFlagRows(item))]:[]),group([{kLegalText:true,label:'License and notices',text:item.text||'License text missing'}])]:[group([info('Unavailable','')])]});
        }

        if (owner?.props.systemShell === false) {
          const systemOnly = new Set(['Wi-Fi', 'Bluetooth', 'Mobile data', 'Battery', 'Sound & vibration']);
          page.groups = page.groups.map((g:Bag) => ({...g, rows:g.rows.filter((row:Bag) => !systemOnly.has(row.label))})).filter((g:Bag) => g.rows.length);
        }
        // Status words carry a dot; Android-only hand-off pages open Android directly.
        const topDots: Bag = { Accounts: account ? 'ok' : 'off', Notifications: topValues.Notifications === 'On' ? 'ok' : topValues.Notifications === 'Some off' ? 'warn' : 'off' };
        const handoffs: Bag = Capacitor.isNativePlatform() ? { 'Wi-Fi': 'wifi', 'Bluetooth': 'bluetooth', 'Sound & vibration': 'sound' } : {};
        for (const g of page.groups) for (const row of g.rows) if (row.label in topValues) {
          row.sub = topValues[row.label]; row.hasSub = !!row.sub; row.val = ''; row.hasVal = false;
          if (row.label in topDots && row.sub !== 'Unavailable') { row.hasSubDot = true; row.dot = topDots[row.label]; }
          if (row.label in handoffs) { row.go = manage(handoffs[row.label]); row.hasExt = true; row.chev = false; }
        }
        continue;
      }
      if (page.title === 'Accounts') {
        const plan=connectionController.residentPlanSettings();
        const expires=plan?.keyExpiring&&typeof plan.keyExpiresAt==='number'?new Date(plan.keyExpiresAt).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';
        // A single destination opens directly (owner decision): no intermediate Account page.
        page.groups = [group([{ kNav:true, label:'Account & plan', lbl:`${serviceName} account & plan`, sub:plan?.keyExpiring?(expires?`Expires ${expires}`:'Expiring'):cloudLabel, hasSub:true, hasSubDot:!!plan?.keyExpiring, dot:'warn', chev:true, noAB:true, go:()=>plan?connectionController.openPlan():connectionController.openCloudAccount() }, ...(Capacitor.isNativePlatform()?[nav('Device accounts', 'accounts', 'Device accounts in Android')]:[])])];
      } else if (page.title === 'Connections') {
        page.groups = [group([{kNav:true,label:'Google accounts',lbl:'Manage Google accounts',chev:true,noAB:true,go:()=>googleConnectionController.open()}])];
      } else if (state.page === 'character' && page.hero?.kChar === true) {
        // The reference character page deliberately has no visible title.
        page.groups = browserDevProfile?[group([
          ...(externalVoiceInvocationEnabled ? [{kNav:true,label:'Wake assistant',lbl:'Wake assistant',chev:true,noAB:true,go:()=>void owner?.startVoice()}] : []),
          {kNav:true,label:'Open conversation',lbl:'Open conversation',chev:true,noAB:true,go:()=>api.composeContentQuestion('')},
          {kNav:true,label:'Agent connection',lbl:'Agent connection',chev:true,noAB:true,go:()=>connectionController.open()},
        ])]:[group([...speechRows(), ...listenerRows()])];
      } else if (page.title === 'Battery') {
        page.hero = { ...page.hero, big: percent, sub: facts.charging === true ? 'Charging' : '', hasMeter: typeof facts.batteryPercent === 'number', meter: facts.batteryPercent ?? 0 };
        page.groups = [group([info('Battery saver', typeof facts.powerSave === 'boolean' ? facts.powerSave ? 'On' : 'Off' : 'Unavailable'), nav('Battery', 'battery', 'Manage battery in Android')])];
      } else if (page.title === 'About') {
        const native=Capacitor.isNativePlatform();
        page.hero={kAlpha:true,version:native?versionLabel(facts.appVersion||buildVersion,facts.appVersionCode):buildVersion==='Unavailable'?'Development preview':'Version '+buildVersion};
        page.groups=[...(native&&facts.androidRelease?[group([info('Android version',facts.androidRelease)])]:[]),group([connectionHelpRow(),licensesRow()])];
      } else if (page.title === 'Wi-Fi') {
        page.hasHdrTog = false; page.hdrTog = null;
        page.hero = { ...page.hero, big: wifiValue, sub: '' };
        page.groups = [group([nav('Networks', 'wifi', 'Manage Wi-Fi networks')])];
      } else if (page.title === 'Bluetooth') {
        page.hasHdrTog = false; page.hdrTog = null;
        page.groups = [group([...(typeof facts.bluetoothEnabled === 'boolean' ? [info('Bluetooth', bluetoothValue)] : []), nav('Devices', 'bluetooth', 'Pair or manage devices')])];
      } else if (page.title === 'Mobile data') {
        page.groups = [group([info('Mobile connection', active('cellularActive')),
          ...(Capacitor.isNativePlatform() ? [info('Mobile data', reported(facts.mobileDataEnabled)), info('Airplane mode', reported(facts.airplaneMode))] : []),
          nav('Networks', 'mobile', 'Manage mobile networks'), ...(Capacitor.isNativePlatform() ? [nav('Airplane mode', 'airplane', 'Airplane mode in Android')] : [])])];
      } else if (page.title === 'Models') {
        const native=Capacitor.isNativePlatform();
        page.hero = { ...page.hero, big: target, sub: '' };
        page.groups = [group([info('Connection', runtimeLocation), ...(native?[info('Inference provider',residentProvider?residentProvider.configured?(residentProvider.provider==='elizacloud'?serviceName:'Cerebras'):'Off':'—')]:browserLocalAgentEnabled ? [info('Inference provider', inferenceProvider)] : []), info('Inference model', inferenceModel), info('Voice', native&&voiceRoute==='direct'?'Cartesia':testMocksEnabled&&connection.residentInference==='direct'?'Off':native&&voiceRoute==='cloud'?serviceName:native?'On this device':developmentCartesiaVoiceEnabled?'Cartesia':account ? serviceName : 'Sign in'), { kNav:true, label:`${serviceName} account`, lbl:`${serviceName} account`, chev:true, noAB:true, go:()=>connectionController.openCloudAccount() }])];
      } else if (page.title === 'Developer') {
        page.groups = [group([info('App version', facts.appVersion || buildVersion), info('Agent memory', connection.session?'Not reported':pending)]), group([problemsRow(), diagnosticsRow()]), group([nav('Android developer settings', 'developer')])];
      } else if (page.title === 'Notifications') {
        const custom = (label:string,go:()=>void,id=label):Bag=>({id,kNav:true,label,lbl:label,chev:!notificationBusy,noAB:true,busy:notificationBusy,hasSpin:notificationBusy,go:()=>{if(!notificationBusy)go();}});
        const toggleRow = (label:string,aria:string,on:boolean,toggle:()=>void,extra:Bag={}):Bag=>({kTog:true,label,aria,on,track:on?'background:var(--acc)':'background:var(--line)',kx:on?20:0,dis:notificationBusy,toggle:()=>{if(!notificationBusy)toggle();},...extra});
        const policyRevision=cross.revision;
        const policy = (changes:Bag)=>void run(async()=>{await notifications.setNotificationPolicy({expectedRevision:policyRevision,...changes});if(changes.history===false)history=[];});
        const selected:Bag[]=cross.apps||[];
        const showCrossAppNotifications = Capacitor.isNativePlatform() || devSurfacesEnabled;
        // Other apps: one switch with a status word; notification content never reaches the agent (4 words at the switch).
        const crossState:[string,string]=typeof cross.accessGranted!=='boolean'?['Unavailable','off']:!cross.enabled?['Off','off']:cross.paused?['Paused','warn']:!cross.accessGranted?['No access','err']:!cross.connected?['Waiting','warn']:['On','ok'];
        const crossRows:Bag[]=showCrossAppNotifications&&!cross.revision ? [{...info('Other apps',crossState[0]),hasDot:true,dot:crossState[1],hasSub:true,sub:'Not shared with agent'}] : [];
        if(showCrossAppNotifications && cross.revision){
          crossRows.push(toggleRow('Other apps',cross.enabled?'Turn off other-app collection':'Enable selected-app collection',!!cross.enabled,async()=>{
            if(Capacitor.isNativePlatform()&&!cross.enabled&&!await review('notification-collection','Collect selected-app notifications?','Reads selected apps only.','Turn on',()=>cross.revision===policyRevision))return;
            policy({enabled:!cross.enabled});
          },{hasSub:true,sub:'Not shared with agent',hasBadge:crossState[0]!=='On'&&crossState[0]!=='Off',badge:crossState[0]}),{...custom('Android access',()=>void run(async()=>{await notifications.openNotificationAccess();})),lbl:Capacitor.isNativePlatform()?'Manage notification access in Android':'Manage development notification access',hasExt:!notificationBusy,chev:false});
          if(cross.paused)crossRows.push({...custom('Resume',async()=>{if(await review('notification-resume','Resume notification collection?','','Resume',()=>cross.revision===policyRevision))void run(async()=>{await notifications.resumeCrossApp({expectedRevision:policyRevision});});}),lbl:'Resume selected-app collection',lucide:'play'});
          // Per-app chips: name, preview (eye) and remove; a changed app is outlined amber.
          const apps=(chips:Bag[])=>({id:'notification-apps',kAppChips:true,label:'Notification apps',chips});
          if(selected.length)crossRows.push(apps(selected.map(app=>({id:app.packageName,label:app.label,warn:app.available===false,busy:notificationBusy,canPreview:app.available!==false,preview:!!app.preview,previewIcon:'eye',previewAria:`${app.preview?'Hide':'Allow'} previews: ${app.label}`,
            togglePreview:async()=>{
              if(notificationBusy)return;
              if(Capacitor.isNativePlatform()&&!app.preview&&!await review('notification-preview:'+app.packageName,'Allow notification previews?',`Show ${app.label} previews?`,'Allow',()=>cross.revision===policyRevision))return;
              policy({apps:selected.map(a=>({packageName:a.packageName,preview:a.packageName===app.packageName?!app.preview:a.preview}))});
            },actionIcon:'x',actionAria:`Remove ${app.label}`,action:()=>{if(!notificationBusy)policy({apps:selected.filter(a=>a.packageName!==app.packageName).map(({packageName,preview})=>({packageName,preview}))});}}))));
          crossRows.push({...custom('Choose apps',()=>{
            if(choices){choices=null;owner?.vset('settings',{notificationChanged:Date.now()});return;}
            void run(async()=>{const next=await notifications.notificationApps();choices=next.apps;});
          }),lbl:choices?'Hide app choices':'Choose notification apps',lucide:choices?'chevron-up':'plus',chev:false});
          const choosable=(choices||[]).filter(app=>!selected.some(a=>a.packageName===app.packageName));
          if(choosable.length)crossRows.push({...apps(choosable.map(app=>({id:app.packageName,label:app.label,busy:notificationBusy,canPreview:false,actionIcon:'plus',actionAria:`Select ${app.label} (${app.packageName})`,action:()=>{if(!notificationBusy)policy({apps:[...selected.map(({packageName,preview})=>({packageName,preview})),{packageName:app.packageName,preview:false}]});}}))),id:'notification-app-choices',label:'Choose notification apps'});
          crossRows.push(toggleRow('History',cross.history?'Turn off local metadata history':'Enable local metadata history',!!cross.history,async()=>{
            if(Capacitor.isNativePlatform()&&!cross.history&&!await review('notification-history','Keep notification history?','100 events · 24 h · no text','Turn on',()=>cross.revision===policyRevision))return;
            policy({history:!cross.history});
          },{hasSub:true,sub:cross.historyUnavailable?'Unavailable':'24 h · no message text',hasBadge:history!==null&&history.length>0,badge:history?String(history.length):''}),{...custom('View',()=>{if(notificationBusy)return;notificationBusy=true;const current=owner;void notifications.notificationHistory().then(result=>{if(owner===current){history=result.items;owner?.vset('settings',{notificationChanged:Date.now()});}}).catch(()=>api.toast('Unavailable')).finally(()=>{notificationBusy=false;});}),lbl:'View local metadata history'},{...custom('Clear',async()=>{if(await review('notification-clear-history','Clear notification history?','Can’t be undone.','Clear',()=>cross.revision===policyRevision))void run(async()=>{await notifications.clearNotificationHistory();history=[];});}),lbl:'Clear local metadata history',lucide:'trash-2',chev:false});
          if(history!==null){if(!history.length)crossRows.push(info('History','None'));for(const row of history)crossRows.push(info(row.appLabel,`${row.state} · ${new Date(row.at).toLocaleString()}`,`notice:${row.id??JSON.stringify([row.packageName,row.at,row.state])}`));}
        }
        const alerts=topValues.Notifications;
        page.groups = [group(Capacitor.isNativePlatform()?[{...info('Alpha notifications',alerts),hasDot:alerts!=='Unavailable',dot:alerts==='On'?'ok':alerts==='Some off'?'warn':'off'},info('Do Not Disturb',interruptionLabels[delivery.interruption]||'Not available'),nav('Notifications','notifications','Manage Alpha notifications')]:[{kTog:true,label:'Alerts',aria:'Allow alerts',on:delivery.appEnabled===true,track:delivery.appEnabled?'background:var(--acc)':'background:var(--line)',kx:delivery.appEnabled?20:0,toggle:()=>void run(async()=>{await notifications.setAlertPreferences({appEnabled:delivery.appEnabled!==true});})}]),
          ...(Capacitor.isNativePlatform()?(delivery.channels||[]).map((channel:Bag)=>group([{id:`notification-channel:${channel.id}`,kNav:true,label:channel.name,lbl:channel.name,chev:true,noAB:true,go:()=>void notifications.openChannelSettings({id:channel.id})}],`notification-channel:${channel.id}`)):[]),...(crossRows.length?[group(crossRows)]:[])];
      } else if (page.title === 'Privacy & data') {
        page.groups = page.groups.map((g: Bag) => ({ ...g, rows: g.rows.map((row: Bag) => {
          const fact = voicePrivacyRow(row.label, voiceRoute, serviceName);
          return fact ? info(...fact) : row;
        }) }));
        // Alpha declares no Contacts permission; Calendar is the fourth runtime grant it uses.
        const permissionLabels=new Set(['Microphone','Location','Camera','Calendar']);
        const permissionValue=(label:string)=>{
          if(!Capacitor.isNativePlatform())return ({granted:'Allowed',prompt:'Ask',denied:'Off',unknown:'—'} as Bag)[facts.permissionStates?.[label]]??'—';
          if(typeof facts.permissions?.[label]!=='boolean')return 'Unavailable';
          if(label==='Location')return facts.locationAccess==='precise'?'Precise':facts.locationAccess==='approximate'?'Approx.':'Off';
          return facts.permissions[label]?'Allowed':'Off';
        };
        const permissionRow=(label:string)=>permissionInfo(label,permissionValue(label));
        // Keep connection privacy and Activity; replace only prototype permission rows.
        page.groups=page.groups.map((g:Bag)=>{
          if(!g.rows.some((row:Bag)=>permissionLabels.has(row.label)||row.label==='Contacts'))return g;
          const rows=g.rows.filter((row:Bag)=>row.label!=='Contacts').map((row:Bag)=>permissionLabels.has(row.label)?permissionRow(row.label):row);
          if(!rows.some((row:Bag)=>row.label==='Calendar'))rows.push(permissionRow('Calendar'));
          return {...g,rows};
        });
        page.groups.push(group([...(Capacitor.isNativePlatform()?[info('Device location',reported(facts.locationEnabled)),nav('Location','location','Location in Android')]:[]),nav('Permissions','privacy','Manage Alpha permissions')]));
      } else if (page.title === 'Sound & vibration') {
        const volume = (label: string, stream: string) => {
          const value = controls.volumes?.find((v: Bag) => v.stream === stream);
          return info(label, value && value.max > 0 ? `${Math.round(value.current * 100 / value.max)}%` : 'Unavailable');
        };
        page.groups = [group([volume('Media', 'music'), volume('Ring', 'ring'), volume('Alarm', 'alarm')]), group([...(Capacitor.isNativePlatform() ? [info('Do Not Disturb', interruptionLabels[delivery.interruption ?? facts.interruptionFilter] || 'Unavailable'), nav('Do Not Disturb', 'dnd', 'Do Not Disturb in Android')] : []), nav('Sound', 'sound', 'Manage sound in Android')])];
      } else if (page.title === 'Display') {
        page.hero={...page.hero,sub:''};
        for (const g of page.groups) g.rows = g.rows.map((row: Bag) => {
          if(row.label==='Theme'&&row.kSeg){
            // A voice command or a ?theme preview can draw an explicit theme the saved choice does not.
            const stored=readAppearanceChoice(),choice:AppearanceChoice=resolveAppearance(stored)===api.theme?stored:api.theme==='dark'?'dark':'light';
            const pick=(next:AppearanceChoice)=>()=>{
              const theme=resolveAppearance(next);
              try{localStorage.setItem(APPEARANCE_KEY,next);}
              catch{api.toast('Theme not saved');}
              // The choice is already saved, so the theme change carries the storage marker.
              owner?.setState({theme,appearanceStorageRead:{theme}});
            };
            return {...row,opts:([['system','System'],['light','Light'],['dark','Dark']] as Array<[AppearanceChoice,string]>).map(([value,label])=>{const on=value===choice;return {label,on,aria:`Theme: ${label}`,css:on?'background:var(--acc);color:#fff':'color:var(--mut)',pick:pick(value)};})};
          }
          if(row.label==='Brightness')return {...nav('Brightness','display','Manage brightness in Android'),...(facts.adaptiveBrightness===true?{val:'Auto',hasVal:true}:{})};
          if(row.label!=='Text size')return row;
          if(!Number.isInteger(facts.textScalePercent))return info('Text size','—');
          const percent=facts.textScalePercent;
          return {...row,valueLabel:`${percent}%`,v:percent<=100?(percent-75)*2:percent-50,set:(event:Event)=>{
            const value=Number((event.target as HTMLInputElement).value),requested=Math.round(value<=50?75+value/2:value+50);
            void changeTextScale(requested,api);
          }};
        });
        page.groups=page.groups.map((g:Bag)=>({...g,rows:g.rows.filter((row:Bag)=>row.label!=='Text size'&&(Capacitor.isNativePlatform()||row.lbl!=='Manage brightness in Android'))})).filter((g:Bag)=>g.rows.length);
        const percent=Number.isInteger(facts.textScalePercent)?facts.textScalePercent:100;
        // Five Aa samples in one row; each sample is drawn at its own size.
        page.groups.push({...group([{id:'text-size',kAa:true,label:'Text size',sizes:([['Small',75],['Default',100],['Large',115],['Larger',130],['Largest',150]] as const).map(([label,value])=>({on:percent===value,css:`font-size:${Math.round(value*.16)}px`,lbl:`Text size: ${label}${percent===value?', selected':''}`,go:()=>void changeTextScale(value,api)}))}]),cap:'Text size',hasCap:true});
      }
    }
    const settingsTop = out.stack.find((page: Bag) => page.isTop);
    if (settingsTop) {
      const rows = new Map<string, Bag>();
      for (const section of settingsTop.groups) {
        for (const row of section.rows) if (!rows.has(row.label)) rows.set(row.label, row);
      }
      const labels: Record<string, string> = {
        'Accounts': 'Account',
        'Connections': 'Google & email',
        'AI provider': 'AI',
        'Agent connection': 'Agent',
        'Set up Alpha access': 'Permissions',
      };
      const sections = [
        ['Account', ['Accounts', 'Connections', 'AI provider']],
        ['Preferences', ['Display', 'Notifications']],
        ['Privacy', ['Set up Alpha access', 'Ask before Alpha acts']],
        ['Apps', ['Calendar', 'Password manager', 'Photos']],
        ['Help', ['About', 'Agent connection']],
      ] as const;
      rows.delete('Models');
      rows.delete('Privacy & data');
      settingsTop.groups = sections.map(([caption, names]) => {
        const selected = names.flatMap(name => {
          const row = rows.get(name);
          if (!row) return [];
          rows.delete(name);
          const label = labels[name] || name;
          return [{...row, label, lbl: label, ...(row.aria ? {aria: label} : {}),
            ...(name === 'Accounts' ? {go:()=>connectionController.openPlan()} : {}),
            ...(name === 'Set up Alpha access' ? {go:()=>{api.set({page:'settings-permissions',settingsCategory:'settings-privacy'});}} : {}),
            ...(name === 'Connections' ? {go:()=>googleConnectionController.open(),...(!account?{lucide:'lock-keyhole',lbl:'Google & email, sign in first'}:{})} : {}),
            ...(name === 'About' ? {hasVal:false, hasSub:false, sub:'', val:''} : {})}];
        });
        return {...group(selected), cap:caption, hasCap:true};
      }).filter(section => section.rows.length);
      // General: network hand-offs, the device, updates, then the destructive reset alone and last.
      const take = (names: string[]) => names.flatMap(name => { const row = rows.get(name); rows.delete(name); return row ? [row] : []; });
      const network = take(['Wi-Fi', 'Bluetooth', 'Mobile data']);
      const updates = take(['Allow automatic updates', 'Automatic updates', 'Update', 'Check', 'Update check']);
      const reset = take(['Erase all data']);
      settingsTop.groups.splice(2, 0, ...[['Network', network], ['Device', [...rows.values()]], ['Updates', updates], ['Reset', reset]]
        .filter(([, list]) => (list as Bag[]).length).map(([cap, list]) => ({...group(list as Bag[]), cap, hasCap:true})));
      for (const page of out.stack) {
        if (page.title === 'Accounts') page.title = 'Account & plan';
        if (page.title === 'Connections') page.title = 'Google & email';
      }
    }
    if(settingsTop){
      const detailGroups=settingsTop.groups;
      const categories=[['settings-account','Account',['Account']],['settings-general','General',['Preferences','Network','Device','Updates','Reset']],['settings-privacy','Privacy',['Privacy']],['settings-apps','Apps',['Apps']],['settings-help','About',['Help']]] as const;
      settingsTop.groups=categories.filter(([key])=>key!=='settings-account').map(([key,title])=>group([{kNav:true,label:title,lbl:title,chev:true,noAB:true,go:()=>{api.set({page:key==='settings-help'?'about':key,settingsCategory:key==='settings-help'?null:key});}}]));
      if(wakeListeningStopUnconfirmed())settingsTop.groups.unshift(group([micMayBeOn()],'wake-stop-unconfirmed'));
      const appSettingsRows=detailGroups.filter((section:Bag)=>section.cap==='Apps').flatMap((section:Bag)=>section.rows);
      const appCatalog=[['Browser','browser'],['Calendar','calendar'],['Camera','camera'],['Files','files'],['Inbox','inbox'],['Maps','maps'],['Notes','notes'],['Passwords','passwords'],['Photos','photos'],['Workflows','workflows']] as const;
      const existingAppRow=(id:string)=>appSettingsRows.find((row:Bag)=>row.label===(id==='calendar'?'Calendar':id==='photos'?'Photos':id==='passwords'?'Password manager':''));
      const selected=categories.find(([key])=>key===categoryPage);
      if(selected){
        const [key,title,captions]=selected;
        let groups=detailGroups.filter((section:Bag)=>(captions as readonly string[]).includes(section.cap)).map((section:Bag)=>({...section,hasCap:false,cap:undefined}));
        // An app with nothing to set here opens the app itself (owner decision: no one-row pages).
        const direct=new Set(['browser','files',...(Capacitor.isNativePlatform()?[]:['photos'])]);
        if(key==='settings-apps')groups=[group(appCatalog.map(([label,id])=>({kNav:true,label,lbl:label,chev:true,noAB:true,go:()=>{const existing=existingAppRow(id);if(existing&&id!=='workflows'){api.set({settingsCategory:'settings-apps'});existing.go();}else if(direct.has(id)){api.set({settingsCategory:'settings-apps'});owner?.openView(id);}else api.set({page:'app-settings-'+id,settingsCategory:'settings-apps'});}})))];
        if(key==='settings-general'&&phoneLoader())groups.push(group([{kNav:true,label:'Phone',lbl:'Phone',chev:true,noAB:true,go:()=>api.set({page:'phone-info',settingsCategory:'settings-general'})}]));
        out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title,hasTitle:true,backLabel:'Back to Settings',back:()=>{api.set({page:null,settingsCategory:null});},hero:{},groups});
      }
    }
    if(appSettingsPage){
      const names:Record<string,string>={browser:'Browser',calendar:'Calendar',camera:'Camera',files:'Files',inbox:'Inbox',maps:'Maps',notes:'Notes',passwords:'Passwords',photos:'Photos',workflows:'Workflows'};
      const rows:Bag[]=[];
      if(appSettingsPage==='inbox')rows.push({kNav:true,label:'Google & email',lbl:'Google & email',chev:true,noAB:true,go:()=>googleConnectionController.open()});
      if(appSettingsPage==='inbox'){
        const preferences=devicePreferencesStatus(),images=cachedDevicePreferences()?.autoLoadMailImages===true;
        rows.push({kTog:true,label:'Load images',aria:'Load images in email',hasSub:false,
          on:images,track:images?'background:var(--acc)':'background:var(--line)',kx:images?20:0,dis:preferences!=='ready',
          toggle:async()=>{if(devicePreferencesStatus()!=='ready')return;try{await editDevicePreferences(value=>{value.autoLoadMailImages=!value.autoLoadMailImages;});changed();}catch{api.toast('Not saved');}}});
        if(preferences==='unavailable')rows.push({kNav:true,label:'Recover device settings',lbl:'Recover device settings',hasSub:true,sub:'Back up first',chev:true,noAB:true,go:()=>openDevicePreferencesRecovery()});
      }
      if(appSettingsPage==='workflows'){const channel=(delivery.channels||[]).find((c:Bag)=>c.id==='reminders');if(channel&&!Capacitor.isNativePlatform())rows.push({kTog:true,label:'Alerts',aria:'Show alerts',on:!channel.blocked,track:!channel.blocked?'background:var(--acc)':'background:var(--line)',kx:!channel.blocked?20:0,toggle:()=>void run(async()=>{await notifications.setAlertPreferences({channelId:channel.id,enabled:!!channel.blocked});})});}
      const permissions:Record<string,string[]>={camera:['Camera','Microphone'],maps:['Location'],notes:['Microphone']};
      for(const label of permissions[appSettingsPage]||[]){const val=typeof facts.permissions?.[label]==='boolean'?(facts.permissions[label]?'Allowed':'Off'):'—';rows.push(Capacitor.isNativePlatform()?{...action(label,manage('privacy')),val,hasVal:true,hasDot:val!=='—',dot:permissionDot(val),hasExt:true,chev:false}:permissionInfo(label,val));}
      out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:names[appSettingsPage]||'App settings',hasTitle:true,backLabel:'Back to Apps',back:()=>{api.set({page:'settings-apps',settingsCategory:'settings-apps'});},hero:{},groups:rows.length?[group(rows)]:[]});
    }
    if(phonePage){
      const loader=phoneInfo!,value=loader.state,groups:Bag[]=[];
      if(value.phase==='ready'){
        // Without phone-state access the SIM list is unread, which is never shown as "no SIM".
        if(!value.info.access.phoneState)groups.push(group([action('Allow',()=>loader.allow(),'phone-allow')]));
        else if(!value.info.lines.length)groups.push(group([info('SIM','None')]));
        for(const section of phoneLineSections(value.info))groups.push({...group(section.rows.map(row=>info(row.label,row.value))),...(section.caption?{cap:section.caption,hasCap:true}:{})});
        groups.push(group(phoneDefaultRows(value.status,value.voicemail).map(row=>info(row.label,row.value))));
        // The nonprivileged launcher cannot read the IMEI; Android's own status screen shows it.
        groups.push(group([...(identifiersElsewhere(value.info)?[nav('IMEI','about')]:[]),nav('Mobile network','mobile')]));
      }else if(value.phase==='failed')groups.push(group([action('Try again',()=>loader.refresh(),'phone-retry')]));
      out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Phone',hasTitle:true,backLabel:'Back to General',back:()=>api.set({page:'settings-general',settingsCategory:'settings-general'}),hero:{},groups});
    }
    if(permissionsPage){
      const native=Capacitor.isNativePlatform();
      const status=(label:string)=>native?(typeof facts.permissions?.[label]==='boolean'?(facts.permissions[label]?'Allowed':'Off'):'—'):({granted:'Allowed',prompt:'Ask',denied:'Off',unknown:'—'} as Bag)[facts.permissionStates?.[label]]||'—';
      const valued=(row:Bag,val:string)=>({...row,val,hasVal:true,hasDot:val!=='—',dot:permissionDot(val)});
      const rows=['Camera','Microphone','Location',...(native?['Calendar']:[])].map(label=>native?valued(action(label,manage('privacy')),status(label)):permissionInfo(label,status(label)));
      const photos=native?(photoAccess?.scope==='full'?'All':photoAccess?.scope==='selected'?'Selected':photoAccess?.scope==='partial'?'Limited':photoAccess?.scope==='denied'?'Alpha only':'—'):'Selected';
      rows.push(native?valued(action('Photos',()=>void photoLibrary.openLibrarySettings().catch(()=>api.toast('Unavailable'))),photos):permissionInfo('Photos',photos));
      // Shared storage as Android reports it now (all-files access on Android 11+); the row opens Android's page.
      rows.push(native?valued(action('Files',()=>void fileStorage.storageRequestAccess({settings:true}).then(()=>refresh(),()=>api.toast('Unavailable'))),fileAccess==='granted'?'All':fileAccess==='denied'?'Off':'—'):permissionInfo('Files','Chosen files'));
      rows.push(valued(action('Notifications',()=>api.set({page:'notifications'})),typeof delivery.appEnabled==='boolean'?(delivery.appEnabled&&delivery.permissionGranted?'Allowed':'Off'):'—'));
      out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'App permissions',backLabel:'Back to Privacy',back:()=>api.set({page:'settings-privacy'}),hero:{},groups:[group(rows)]});
    }
    if(activeSettingsCategory&&!categoryPage)for(const page of out.stack)if(!page.isTop&&page.backLabel==='Back to Settings')page.backLabel='Back to '+categoryNames[activeSettingsCategory];
    const nestedParents:Record<string,[string,string]>={'agent-connection':['about','About'],licenses:['about','About'],problems:['developer','Developer'],'license-detail':['licenses','licenses']};
    if(nestedParents[state.page]){const [parent,label]=nestedParents[state.page];const page=out.stack[out.stack.length-1];if(page&&!page.isTop){page.backLabel='Back to '+label;page.back=()=>api.set({page:parent});}}
    const settingsIcons:Record<string,string>={General:'settings',Phone:'phone',IMEI:'info','Mobile network':'signal',Privacy:'shield',Apps:'layout-grid',Help:'info',About:'info',Browser:'globe',Calendar:'calendar-days',Camera:'camera',Files:'folder',Inbox:'mail',Maps:'map-pin',Notes:'notebook-text',Passwords:'lock-keyhole',Photos:'images',Workflows:'workflow','Account & plan':'user-round','Google & email':'link','AI connection':'cpu',Display:'sun',Notifications:'bell','Privacy & data':'shield','App permissions':'fingerprint-pattern','Redeem code':'gift','Manage plan':'credit-card','Sign out':'log-out'};
    for(const page of out.stack)for(const section of page.groups||[])for(const row of section.rows||[]){if(row.kBtn)row.btnAria=row.aria||row.label;if(row.kNav){row.lucideIcon='/icons/lucide/'+(row.licenseComponent?'file-text':row.lucide||settingsIcons[row.label]||'sliders-horizontal')+'.svg';row.hasLucideIcon=!row.isTextSize;row.hasIcon=false;row.hasTile=false;}}
    // Stable identities keep focused controls attached while async groups change.
    for(const page of out.stack){
      const groups=new Map<string,number>();
      for(const section of page.groups||[]){
        const name=String(section.id??section.cap??section.rows?.[0]?.id??section.rows?.[0]?.label??section.rows?.[0]?.lbl??'group');
        const occurrence=groups.get(name)??0;groups.set(name,occurrence+1);section.id=JSON.stringify([page.title||'Settings',name,occurrence]);
        const rows=new Map<string,number>();
        section.rows=(section.rows||[]).map((row:Bag)=>{const identity=row.id??JSON.stringify([row.aria??row.label??row.lbl??row.time??'',row.text??'']);const n=rows.get(identity)??0;rows.set(identity,n+1);return {...row,id:JSON.stringify([identity,n])};});
      }
    }
    if(!Capacitor.isNativePlatform()) {
      const browserLabels=(value:any):any=>{if(typeof value==='string')return value.replaceAll('Manage brightness in Android','Brightness').replaceAll('Manage sound in Android','Sound settings').replaceAll('Manage in Android','App settings').replaceAll('Device accounts in Android','System accounts').replaceAll('Wi-Fi transport · network names stay in Android settings','System').replaceAll('in Android','in system settings').replaceAll('Android settings','System settings').replaceAll('Android Calendar','App calendar').replaceAll('Android device information','System information').replaceAll('Android developer settings','App development settings').replaceAll('On this phone','In this app').replaceAll('on this phone','in this app').replaceAll('Native setting unavailable','Managed by your system');if(Array.isArray(value))return value.map(browserLabels);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,browserLabels(v)]));return value;};
      return browserLabels(out);
    }
    return out;
  };
}
