import { externalVoiceInvocationEnabled } from '../runtime/voice-entry-policy';
import {residentRecoveryCopy} from '../runtime/resident-recovery';
import {cloudServiceName} from '../runtime/cloud-protocol';
import {browserDevProfile as devProfileQuery,developerTools} from '../browser/dev-profile';
import {cloudRuntimeEnabled,testMocksEnabled,devSurfacesEnabled} from '../build-flags';
import {openCalendarRecovery} from '../browser/calendar-recovery';
import {openNotificationRecovery} from '../browser/notification-recovery';
import {openAlertSoundRecovery,openDevicePreferencesRecovery,openDeviceRolesRecovery} from '../browser/preference-recovery';
import {notificationDocument} from '../browser/notification-store';
import {alertSoundDocument,deviceRolesDocument} from '../browser/preference-documents';
import {cachedDevicePreferences,initializeDevicePreferences,editDevicePreferences,readDevicePreferences} from '../browser/device-preferences';
import { registerPlugin } from '../platform-plugins';
import { broaderPageNotice, switchValue } from './native-adapter';
import { Capacitor } from '@capacitor/core';
import { DailyApps } from '../daily';
import { connectionController } from '../runtime/connection-ui';
import {googleConnectionController} from '../runtime/google-connection-ui';
import {GOOGLE_ACCOUNTS_CHANGED,googleDisconnectConfirmation,googleDisconnectMessage} from '../runtime/google-accounts';
import { browserLocalAgentEnabled, modelLabel } from '../runtime/local-agent';
import {developmentCartesiaVoiceEnabled} from '../runtime/development-cartesia-conversation';
import type { GmailAccount } from '../runtime/cloud-protocol';
import { disconnectGmailAccount, disconnectMessage, GMAIL_ACCOUNTS_CHANGED } from '../runtime/gmail-mailbox';
import { retireGmailBackground } from '../runtime/gmail-background';
import { gmailGrantLabel, googleAccountAccessLabel } from '../runtime/gmail-grants';
import { clearCrashLog, describeCrashEntry, readCrashLog, recordCloudInferenceFailure, type CrashLog } from '../runtime/crash-log';
import { buildDiagnostics, diagnosticsFileName, diagnosticsText } from '../runtime/diagnostics-export';
import {planAdmission} from '../runtime/subscription-entitlement';
import { exportVoiceTiming, exportRealtimeVoiceTiming, voiceStartupTiming } from '../runtime/voice-timing';
import { readNativeVoiceTiming } from '../runtime/native-voice-turn';
import { readNativeCloudStreamTiming } from '../runtime/cloud-voice';
import { listenerStatus, openListenerSettings, pauseListener, turnOffListener, wakeListeningStopUnconfirmed, type ListenerStatus } from '../runtime/always-on-listener';
import { reviewDataReset, type DataResetPlugin } from '@elizaos/capacitor-system/reset';
import { androidRoleLabel, parseRoleStatuses } from '@elizaos/capacitor-system/settings';
import { leavePasswordManager, passwordEntryPage, passwordManagerGroups, passwordManagerLifecycle, refreshPasswordManager, PASSWORD_PAGES } from '../passwords/password-manager';

type Bag = Record<string, any>;
type PhotoAccess = {scope:'full'|'partial'|'selected'|'denied';images:string;videos:string};
const photoLibrary = registerPlugin<{libraryAccess():Promise<PhotoAccess>;requestLibraryAccess():Promise<PhotoAccess>;openLibrarySettings():Promise<void>}>('AlphaPhotos');
declare const __APP_VERSION__: string;
const browserDevProfile = devSurfacesEnabled && devProfileQuery;
/** Build version injected at build time from app.config.json or ELIZAOS_VERSION_NAME. */
export const buildVersion = typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : 'Unavailable';
export type LicenseNotice = { name: string; version: string; license: string; source: string; text: string; flags?: unknown; obligations?: unknown };
/** Labels for the flags scripts/licence-policy.mjs writes into the shipped notices. An unlisted flag is shown as written. */
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
  checkForUpdate(): Promise<{ manifest?: string }>;
  installUpdate(input: Pick<AppUpdate, 'apkUrl' | 'sha256' | 'sizeBytes' | 'versionCode'>): Promise<void>;
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
  return androidRoleLabel(row, { packageName: 'ai.elizaresearch.alphaphone', appName: 'Alpha Phone' });
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
export const UPDATE_MAX_BYTES = 1024 * 1024 * 1024;
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
type AppUpdate = {versionCode: number; versionName: string; apkUrl: string; sha256: string; sizeBytes: number; notes: string};
/**
 * The update a manifest offers this install, or null unless it is complete and HTTPS, newer than the
 * installed versionCode, and for this flavor and signer. Android refuses another signer after the whole
 * download, and the other flavor would silently change what the phone admits (HOME, Phone, SMS).
 */
export function parseUpdateManifest(value: unknown, installed: {versionCode: unknown; launcher: unknown; signerSha256: unknown}): AppUpdate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  let offer = value as Record<string, unknown>;
  // One canonical feed can serve distinct APK flavors and installed signing families.
  // Select an exact pair only; never fall back to another signer or an ambiguous offer.
  if (offer.schema === 'alpha-update/index-v1') {
    if (!Array.isArray(offer.releases) || offer.releases.length < 1 || offer.releases.length > 16) return null;
    const pairs = new Set<string>();
    let selected: Record<string, unknown> | undefined;
    for (const entry of offer.releases) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const row = entry as Record<string, unknown>;
      if (row.schema !== UPDATE_SCHEMA || (row.variant !== 'launcher' && row.variant !== 'standalone') || typeof row.signerSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(row.signerSha256)) return null;
      const pair = row.variant + ':' + row.signerSha256;
      if (pairs.has(pair)) return null;
      pairs.add(pair);
      if (typeof installed.launcher === 'boolean' && row.variant === (installed.launcher ? 'launcher' : 'standalone') && row.signerSha256 === installed.signerSha256) selected = row;
    }
    if (!selected) return null;
    offer = selected;
  }
  const {schema, versionCode, versionName, variant, signerSha256, apkUrl, sha256, sizeBytes, notes} = offer;
  if (schema !== UPDATE_SCHEMA || !Number.isSafeInteger(installed.versionCode) || !Number.isSafeInteger(versionCode) || (versionCode as number) <= (installed.versionCode as number)) return null;
  if (typeof installed.launcher !== 'boolean' || variant !== (installed.launcher ? 'launcher' : 'standalone') || typeof signerSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(signerSha256) || signerSha256 !== installed.signerSha256) return null;
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256) || !Number.isSafeInteger(sizeBytes) || (sizeBytes as number) <= 0 || (sizeBytes as number) > UPDATE_MAX_BYTES || typeof apkUrl !== 'string' || apkUrl.length > 2048) return null;
  try { const url = new URL(apkUrl); if (url.protocol !== 'https:' || url.username || url.password) return null; } catch { return null; }
  return {versionCode: versionCode as number, versionName: typeof versionName === 'string' && /^[^\u0000-\u001f\u007f]{1,64}$/.test(versionName) ? versionName : '', apkUrl, sha256, sizeBytes: sizeBytes as number, notes: typeof notes === 'string' && notes.length <= 500 ? notes : ''};
}
/** A day after the last answered check, or at once when that time is unknown or in the future. */
export function updateCheckDue(checkedAt: number, now: number): boolean {
  return !(now >= checkedAt && now - checkedAt < UPDATE_CHECK_INTERVAL_MS);
}
/** Cloud QA profile facts replace prototype navigation, not device settings links. */
export function cloudPrivacyRow(label: string): [string, string] | null {
  if (label === 'Leaves this device') return ['Shared with Cloud', 'Messages and selected content when you use AI'];
  if (label === 'On-device model') return ['Voice', 'Recordings for transcription and text for playback, when used'];
  return null;
}
/** A stale or direct Developer selection cannot open the page in a product build. */
export function settingsPage(page: string | null | undefined, developerSurfaces: boolean): string | null | undefined {
  return (page === 'developer' || page === 'character') && !developerSurfaces ? null : page;
}
/** Support diagnostics remain in About; Developer navigation is an explicit development surface. */
export function settingsNavigationRows<T extends { label?: string; lbl?: string }>(rows: T[], developerSurfaces: boolean): T[] {
  return developerSurfaces ? rows : rows.filter(row => row.label !== 'Developer' && row.lbl !== 'Developer');
}
// settings-facts:end
/** Saved appearance choice. 'system' follows prefers-color-scheme, which Android WebView also reports. */
export type AppearanceChoice = 'system' | 'light' | 'dark';
export const APPEARANCE_KEY = 'alpha.appearance.v1';
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
/** The last manifest a check was answered with, and when, so a restart offers it without checking again; and the check in flight. */
let lastUpdate: {checkedAt: number; manifest: unknown} | undefined, updateCheck: Promise<void> | undefined;
function savedUpdate() {
  if (lastUpdate) return lastUpdate;
  try {
    const value = JSON.parse(localStorage.getItem(UPDATE_KEY) ?? 'null');
    if (value && typeof value === 'object' && Number.isFinite(value.checkedAt)) return lastUpdate = {checkedAt: value.checkedAt, manifest: value.manifest};
  } catch { /* Unreadable storage only means the next check is due. */ }
  return lastUpdate = {checkedAt: Number.NaN, manifest: null};
}
/**
 * At most one automatic check a day (app start and resume) and one at a time; `force` is the owner's
 * Check for updates. Only an answer is kept: a 404 withdraws the offer, and a failed check is quiet and
 * leaves the next start or resume due. Undefined when no check runs.
 */
function checkForUpdate(force: boolean): Promise<void> | undefined {
  if (!updateCheck && Capacitor.isNativePlatform() && (force || updateCheckDue(savedUpdate().checkedAt, Date.now())))
    updateCheck = device.checkForUpdate().then(({ manifest }) => {
      lastUpdate = { checkedAt: Date.now(), manifest: typeof manifest === 'string' ? JSON.parse(manifest) : null };
      try { localStorage.setItem(UPDATE_KEY, JSON.stringify(lastUpdate)); } catch { /* Kept for this session. */ }
    }).catch(() => { /* Quiet: the next start, resume or tap checks again. */ }).finally(() => { updateCheck = undefined; });
  return updateCheck;
}

/** Keep the reference settings components; never present fixture device facts. */
export function installSettingsAdapter(Component: any, views: Bag) {
  const definition = views.settings, render = definition.render, p = Component.prototype;
  const mount = p.componentDidMount, unmount = p.componentWillUnmount, openView = p.openView, update = p.componentDidUpdate;
  let owner: any, facts: Bag = {}, controls: Bag = {}, delivery: Bag = {}, generation = 0,scaleGeneration=0, cross:Bag={}, choices:Bag[]|null=null, history:Bag[]|null=null, notificationBusy=false;
  let passwordOpening=false,photoAccessBusy=false;
  let photoAccess:PhotoAccess|null=null;
  let recovery: RecoveryDomain[] = [];
  let capabilityAbort: AbortController | null = null;
  let inferenceAbort:AbortController|null=null;
  let gmailAccounts: GmailAccount[] = [], gmailBusy = '', settingsApi: Bag | undefined;
  let roles: Record<string, RoleRow> | null = null, launcher: boolean | null = null, roleBusy = false;
  let crashLog: CrashLog | null = null, crashBusy = false, diagnosticsBusy = false;
  let updateBusy: '' | 'check' | 'install' = '';
  let gmail = 'Not checked';
  let inferenceProvider = 'Not reported by agent';
  // The AOSP image's always-on listener (#424): status, Pause and Turn off only. Turning listening on
  // or resuming happens in the listener's own consent screen, never here.
  let listener: ListenerStatus = { available: false }, listenerBusy = false, listenerSequence = 0;
  async function listenerAction(api: Bag, action: 'pause' | 'turnOff') {
    if (listenerBusy) return;
    listenerBusy = true; changed();
    const instance = owner, sequence = ++listenerSequence;
    try {
      const next = await (action === 'pause' ? pauseListener() : turnOffListener());
      if (owner !== instance || sequence !== listenerSequence) return;
      listener = next;
      if (!next.available) api.toast('The listener did not respond. Use its notification or Quick Settings tile to stop listening.');
      else if (next.listening) api.toast('Listening has not stopped. Use the listener notification to stop it.');
    } finally { listenerBusy = false; if (owner === instance) changed(); }
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
      capabilityAbort=null;gmailAccounts=[];gmail='Not checked';inferenceProvider='Not reported by agent';return;
    }
    const abort = capabilityAbort = new AbortController();
    const cloud = connectionController.getCloudClient(), instance = owner;
    gmail = cloud ? 'Checking authorization…' : 'Cloud sign-in required'; gmailAccounts = [];
    inferenceProvider = 'Not reported by agent';
    changed();
    const timeout = setTimeout(() => { abort.abort(); if (owner === instance && capabilityAbort === abort) { if (gmail === 'Checking authorization…') gmail = 'Authorization not verified'; changed(); } }, 10000);
    try {
      await Promise.allSettled([
        (async () => {
          // A status read older than a Pause or Turn off never replaces that action's result.
          if (!externalVoiceInvocationEnabled) return;
          const sequence = ++listenerSequence, status = await listenerStatus();
          if (owner === instance && capabilityAbort === abort && sequence === listenerSequence) listener = status;
        })(),
        (async () => {
          if (!browserLocalAgentEnabled) return;
          const agent = connectionController.getBrowserSpeechAgent();
          if (!agent) return;
          try {
            const status = await agent.request('/api/status', undefined, abort.signal);
            if (abort.signal.aborted || owner !== instance || capabilityAbort !== abort || connectionController.getBrowserSpeechAgent() !== agent) return;
            // This field reports the provider, not a specific model or a Cloud account.
            inferenceProvider = status.state === 'running' && status.model === 'cerebras' ? 'Cerebras' : 'Not reported by agent';
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
  /** Explicit, confirmed disconnect followed by a read-back; never retried automatically. */
  async function disconnectGmail(account: GmailAccount) {
    const cloud = connectionController.getCloudClient(), instance = owner;
    if (!cloud || !account.connectionId || gmailBusy) return;
    if (!window.confirm(googleDisconnectConfirmation(account.label,cloudServiceName(cloud.client.environment)))) return;
    gmailBusy = account.connectionId; changed();
    // Native background state is retired alongside the revoke; it never gates it.
    const retirement = retireGmailBackground(account.connectionId);
    try {
      const result = await disconnectGmailAccount(cloud.client, account.connectionId, new AbortController().signal);
      if (owner !== instance || connectionController.getCloudClient()?.sessionId !== cloud.sessionId) return;
      if (result.accounts) { gmailAccounts = result.accounts; gmail = gmailGrantLabel(result.accounts); }
      else gmail = 'Authorization not verified';
      settingsApi?.toast(googleDisconnectMessage(result.outcome, account.label,cloudServiceName(cloud.client.environment)));
      window.dispatchEvent(new CustomEvent(GMAIL_ACCOUNTS_CHANGED, { detail: { source: 'settings' } }));
      window.dispatchEvent(new Event(GOOGLE_ACCOUNTS_CHANGED));
    } catch { if (owner === instance) { settingsApi?.toast(disconnectMessage('unconfirmed', account.label)); gmail = 'Authorization not verified'; } }
    finally { await retirement.settled(); gmailBusy = ''; if (owner === instance) changed(); }
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
    } catch { if (owner === instance) api.toast('Android did not confirm a Home app change.'); }
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
        if (owner === instance) api.toast('Choose where to share the diagnostics. They contain no notes, keys or account IDs.');
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = diagnosticsFileName(report); link.hidden = true;
        document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
        if (owner === instance) api.toast('Diagnostics saved. They contain no notes, keys or account IDs.');
      }
    } catch { if (owner === instance) api.toast('Diagnostics could not be exported.'); }
    finally { diagnosticsBusy = false; if (owner === instance) changed(); }
  }
  async function clearProblems(api: Bag) {
    if (crashBusy || !window.confirm('Clear the local problem log?')) return;
    inferenceAbort?.abort();inferenceAbort=null;
    const instance = owner; crashBusy = true; changed();
    try { await clearCrashLog(); crashLog = await readCrashLog(); }
    catch { if (owner === instance) api.toast('The problem log could not be cleared.'); }
    finally { crashBusy = false; if (owner === instance) changed(); }
  }
  /** Software update is quiet: only the busy label changes while a check or install runs. */
  async function updateAction(busy: 'check' | 'install', run: () => Promise<void> | undefined) {
    if (updateBusy) return;
    updateBusy = busy; changed();
    try { await run(); } finally { updateBusy = ''; changed(); }
  }
  async function refresh() {
    const instance = owner, token = ++generation;
    if (!instance) return;
    const native = Capacitor.isNativePlatform();
    const [state, settings, noticeState, crossState, metadata, roleState, build, problems, photos] = await Promise.allSettled([device.snapshot(), system.getDeviceSettings(), notifications.status(), notifications.crossAppStatus(), history===null?Promise.resolve(null):notifications.notificationHistory(),
      // Browsers have no Android roles: the web plugin rejects, so nothing is shown there.
      native ? system.getStatus() : Promise.reject(Error('No device roles')), native && launcher === null ? system.getBuildInfo() : Promise.resolve(null), readCrashLog(), native ? photoLibrary.libraryAccess() : Promise.resolve(null), native ? connectionController.refreshProviderStatus() : Promise.resolve()]);
    if (owner !== instance || generation !== token) return;
    roles = roleState.status === 'fulfilled' ? readRoles(roleState.value) : null;
    if (build.status === 'fulfilled' && build.value) launcher = build.value.launcher === true;
    crashLog = problems.status === 'fulfilled' ? problems.value : null;
    photoAccess = photos.status === 'fulfilled' ? photos.value : null;
    facts = state.status === 'fulfilled' ? state.value : {};
    controls = settings.status === 'fulfilled' ? settings.value : {};
    delivery = noticeState.status === 'fulfilled' ? noticeState.value : {};
    cross = crossState.status === 'fulfilled' ? crossState.value : {};
    if(metadata.status==='fulfilled'&&metadata.value!==null)history=metadata.value.items;
    // Browser-only stores, probed only for the Developer gate's recovery rows; native Android data has its own platform recovery.
    if(developerTools&&!Capacitor.isNativePlatform()){const next=await recoveryNeeded().catch(()=>[] as RecoveryDomain[]);if(owner!==instance||generation!==token)return;recovery=next;}
    instance.vset('settings', { nativeReadAt: Date.now() });
    refreshPasswordManager();
  }
  p.componentDidMount = function () {
    mount.call(this); owner = this;
    this.mailImagePreferenceChanged=changed;
    this.settingsNavigation=(event:Event)=>{const page=(event as CustomEvent).detail?.page;if(typeof page!=='string'||!new Set(['display','sound','notifications','privacy','settings-account','settings-apps','settings-general','calendar','app-settings-workflows']).has(page))return;event.preventDefault();activeSettingsCategory=page==='privacy'?'settings-privacy':page==='settings-account'?'settings-account':['settings-apps','calendar','app-settings-workflows'].includes(page)?'settings-apps':'settings-general';this.openView('settings');this.vset('settings',{page});};
    window.addEventListener('alpha:settings-page',this.settingsNavigation);
    window.addEventListener('alpha:device-settings',this.mailImagePreferenceChanged);
    initializeDevicePreferences(); void refresh(); void refreshCapabilities(); void checkForUpdate(false)?.then(changed);
    this.passwordLifecycle = passwordManagerLifecycle(changed);
    if(!new URLSearchParams(location.search).has('theme')){
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
    this.deviceResume = DailyApps.addListener('appResumed', () => { void refresh(); void refreshCapabilities(); void checkForUpdate(false)?.then(changed); }).catch(() => null);
  };
  p.componentDidUpdate = function (previousProps: Bag, previousState: Bag) {
    update?.call(this, previousProps, previousState);
    // Switching away from Settings (Home, another view) locks and forgets the password manager.
    if (typeof this.S === 'function' && this.S().view !== 'settings') leavePasswordManager();
    const theme = this.state?.theme;
    // The marker travels with React state, so queued external reads cannot echo an older theme.
    const external=this.state?.appearanceStorageRead;
    const fromStorage=external!==previousState?.appearanceStorageRead&&external?.theme===theme;
    if (!fromStorage&&(theme === 'light' || theme === 'dark') && theme !== previousState?.theme) {
      try { localStorage.setItem(APPEARANCE_KEY, theme); }
      catch { this.toast('Theme changed for this session, but could not be saved.'); }
    }
  };
  p.componentWillUnmount = function () {
    if (owner === this) { capabilityAbort?.abort(); capabilityAbort = null; inferenceAbort?.abort();inferenceAbort=null; owner = null; ++generation; facts = {}; controls = {}; delivery = {}; cross={}; choices=null; history=null; roles=null; crashLog=null; }
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
  p.openView = function (key: string, ...args: any[]) {
    const result = openView.call(this, key, ...args);
    if (key === 'settings') { void refresh(); void refreshCapabilities(true); }
    return result;
  };
  const categoryNames:Record<string,string>={'settings-account':'Account','settings-general':'General','settings-privacy':'Privacy','settings-help':'About','settings-apps':'Apps'};
  let activeSettingsCategory:string|null=null;
  const settingsBack = definition.back;
  const settingsParents: Record<string,string> = {history:'agent-connection',problems:'about',licenses:'about','password-entry':'password-provider','settings-permissions':'settings-privacy','license-detail':'licenses'};
  definition.back = (state:Bag,api:Bag) => {
    if(!state.sheet&&((typeof state.page==='string'&&Object.hasOwn(categoryNames,state.page))||(!state.page&&activeSettingsCategory))){activeSettingsCategory=null;api.set({page:null});return true;}
    if(!state.sheet&&settingsParents[state.page]){api.set({page:settingsParents[state.page]});return true;}
    if(!state.sheet&&PASSWORD_PAGES.includes(state.page))leavePasswordManager();
    return settingsBack ? settingsBack(state,api) : false;
  };
  definition.render = (state: Bag, api: Bag) => {
    settingsApi = api;
    const permissionsPage=state.page==='settings-permissions'||state.page==='privacy';
    const appSettingsPage=typeof state.page==='string'&&state.page.startsWith('app-settings-')?state.page.slice(13):null;
    const categoryPage=typeof state.page==='string'&&Object.hasOwn(categoryNames,state.page)?state.page:!state.page?activeSettingsCategory:null;
    const out = render({ ...state, page: categoryPage||appSettingsPage||permissionsPage?null:settingsPage(state.page, developerTools), acct: null, adding: false, sheet: ['conn', 'voice', 'wipe', 'wifiPw', 'forget'].includes(state.sheet?.kind) ? null : state.sheet }, api);
    // Prototype personality values are mock-only until the agent reports them.
    out.persona = 'Voice & personality';
    const connection = connectionController.getSnapshot();
    const account = connection.cloudAccount;
    out.settingsVersion=buildVersion==='Unavailable'?'Development preview':'Version '+buildVersion;
    out.accountEmail=account?(account.email||'Signed in'):'Not signed in';
    out.openAccount=()=>{activeSettingsCategory='settings-account';api.set({page:'settings-account'});};
    const serviceName = cloudServiceName(connectionController.getCloudClient()?.client.environment ?? account?.environment ?? connection.signIn?.environment ?? 'production');
    const target = connection.session ? connection.name : 'Not connected';
    const runtimeLocation=!connection.session?'Not connected':connection.kind==='resident'?(Capacitor.isNativePlatform()?'On this device':'On this computer · development'):testMocksEnabled?'Remote agent':'Unsupported connection';
    // About and Models read the model the resident reports the same way, so the two pages agree.
    const residentProvider=connection.kind==='resident'&&connection.session?connection.providerStatus:null;
    const inferenceModel=residentProvider?.configured&&residentProvider.model?modelLabel(residentProvider.provider==='elizacloud'?serviceName:'Cerebras',residentProvider.model):'Not reported by agent';
    const cloudLabel = account ? account.email||`Account ${account.userId.slice(0, 8)}` : 'Not signed in';
    const manage = (page: string) => () => void device.openSettings({ page }).then(opened => { const notice = broaderPageNotice(page, opened); if (notice) api.toast(notice); }, () => api.toast('This Android settings page is unavailable.'));
    const info = (label: string, val: string): Bag => ({ kInfo: true, label, val, hasVal: true, noAB: true });
    const note = (label: string, sub: string): Bag => ({ kInfo: true, label, val: '', hasVal: false, hasSub: true, sub, noAB: true });
    const nav = (label: string, page: string): Bag => ({ kNav: true, label, lbl: label, chev: true, noAB: true, go: manage(page) });
    const group = (rows: Bag[]) => ({ css: 'background:var(--s2);padding:4px 0', rows });
    const run = async (task:()=>Promise<void>)=>{if(notificationBusy)return;notificationBusy=true;changed();const current=owner;try{await task();if(owner===current)await refresh();}catch{if(owner===current)api.toast('Notification settings changed or are unavailable. Refresh and try again.');}finally{notificationBusy=false;if(owner===current)changed();}};
    // Speech follows the explicit production runtime profile; developer routes stay separate.
    const speechRows = (): Bag[] => [
      info('Speech', connection.residentInference==='direct'?(connection.providerStatus?.voiceConfigured?'Cartesia · own API key':'Off · add a Cartesia key'):developmentCartesiaVoiceEnabled?'Cartesia · development':cloudRuntimeEnabled?`${serviceName} · Cartesia output (uses your plan)`:testMocksEnabled?`${serviceName} (counts toward your plan)`:'On this device'),
      ...(cloudRuntimeEnabled&&!developmentCartesiaVoiceEnabled&&connection.residentInference!=='direct'
        ? [note('Voice privacy', `Microphone audio and reply text go to ${serviceName}.`)]
        : []),
      ...(wakeListeningStopUnconfirmed() ? [note('Wake listening', 'Could not confirm listening is off. Turn it off in Android settings.')] : []),
    ];
    const action = (label: string, go: () => void): Bag => ({ kNav:true, label, lbl:label, chev:true, noAB:true, go });
    const listenerRows = (): Bag[] => {
      if (!externalVoiceInvocationEnabled) return [];
      if (!listener.available) return [info('Wake word', 'Not available')];
      const status = listener;
      return [
        info('Always-on listening', listenerBusy ? 'Updating…' : status.label),
        ...(status.listening || status.microphoneOpen ? [action('Pause listening', () => void listenerAction(api, 'pause'))] : []),
        ...(status.consented && status.state !== 'OFF' ? [action('Turn off listening', () => void listenerAction(api, 'turnOff'))] : []),
        action('Listening settings', () => void openListenerSettings().then(opened => { if (!opened) api.toast('The listener settings are unavailable.'); })),
      ];
    };
    const problemCount = crashLog ? crashLog.entries.length : null;
    const problemsRow = (): Bag => ({ kNav:true, label:'Problem log', lbl:'Problem log', val: problemCount === null ? 'Unavailable' : problemCount ? `${problemCount} recorded` : 'None recorded', hasVal:true, chev:true, noAB:true, go:()=>{ api.set({ page:'problems' }); void refresh(); void refreshResidentDiagnostics(); } });
    const diagnosticsRow = (): Bag => ({ kNav:true, label:'Export diagnostics', lbl: diagnosticsBusy ? 'Preparing diagnostics…' : 'Export diagnostics', chev:true, noAB:true, go:()=>void exportDiagnostics(api) });
    const licensesRow = (): Bag => ({ kNav:true, label:'Open source licenses', lbl:'Open source licenses', chev:true, noAB:true, go:()=>{ api.set({ page:'licenses',licenseQuery:'' }); void loadLicenses(changed); } });
    const percent = typeof facts.batteryPercent === 'number' ? `${facts.batteryPercent}%` : 'Unavailable';
    const active = (key: string) => typeof facts[key] === 'boolean' ? facts[key] ? 'Active connection' : 'Not active' : 'Unavailable';
    // System switches as Android reported them (AlphaDevice.snapshot). Alpha cannot change any of
    // them; a switch Android did not answer for keeps its earlier wording and is never shown as off.
    const wifiValue = switchValue(facts.wifiEnabled, active('wifiActive'), { on: facts.wifiActive === true ? 'On · connected' : 'On' });
    const bluetoothValue = switchValue(facts.bluetoothEnabled, Capacitor.isNativePlatform() ? 'Manage in Android' : active('bluetoothActive'));
    const mobileValue = facts.airplaneMode === true ? 'Airplane mode on' : switchValue(facts.mobileDataEnabled, active('cellularActive'), { on: facts.cellularActive === true ? 'On · in use' : 'On' });
    const reported = (value: unknown) => switchValue(value, 'Not reported by Android');
    const interruptionLabels:Bag={all:'Off',priority:'Priority only',alarms:'Alarms only',none:'On',unknown:'Not available'};
    const browserNotifications = delivery.scope === 'browser';
    const topValues: Bag = {
      'Wi-Fi': wifiValue, 'Bluetooth': bluetoothValue, 'Mobile data': mobileValue,
      'Accounts': account ? `${serviceName} connected` : 'Not signed in', 'Connections': gmail,
      'Battery': percent, 'Models': target, 'About': facts.appVersion || 'Unavailable',
      'Notifications': typeof delivery.appEnabled !== 'boolean' ? 'Unavailable' : !delivery.appEnabled || !delivery.permissionGranted ? (browserNotifications ? 'In-app alerts off' : 'App notifications off') : delivery.channels?.some((c:Bag)=>c.blocked||c.groupBlocked) ? (browserNotifications ? 'Some in-app alerts off' : 'Some channels blocked') : (browserNotifications ? 'On' : 'On'),
      'Sound & vibration': Capacitor.isNativePlatform()?'Android settings':'App sound settings',
    };
    for (const page of out.stack) {
      if (page.isTop) {
        page.groups = page.groups.map((group: Bag) => ({ ...group, rows: settingsNavigationRows(group.rows, developerTools) }));
        const native=Capacitor.isNativePlatform(), provider=facts.passwordProvider||{};
        const installation:Bag={installed:'Installed · publisher verified',disabled:'Installed but disabled',absent:'Not installed','unrecognized-publisher':'Installed · publisher not recognized',unknown:'Not checked'};
        const selection:Bag={proton:provider.installation==='installed'?'Proton Pass selected':provider.installation==='disabled'?'Proton Pass selected · app disabled':'Provider package selected · publisher not verified',other:'Another provider selected',none:'No provider selected',unknown:'Selection unavailable'};
        const passwordAction=(label:string,kind:string):Bag=>({kNav:true,label,lbl:passwordOpening?'Opening…':label,chev:true,noAB:true,go:async()=>{
          if(passwordOpening)return;passwordOpening=true;const instance=owner;changed();
          try{const result=await device.openPasswordProvider({action:kind});if(result?.status!=='opened')throw Error('Unconfirmed provider handoff');if(owner===instance&&result.destination!=='development')api.toast(result.destination==='system-settings'?'Opened Android settings. Search for passwords or autofill, then choose your provider.':'Opened provider setup. Complete or cancel there; no change is confirmed yet.');}
          catch{if(owner===instance)api.toast('Password provider setup is unavailable. No provider change is confirmed.');}
          finally{passwordOpening=false;if(owner===instance){changed();void refresh();}}
        }});
        const passwordGroup=group(browserDevProfile?[
          info('Provider',provider.installation==='installed'?'Development provider installed':'Not installed'),
          info('Selection',provider.selection==='proton'?'Development provider selected':'No provider selected'),
          info('Autofill','Sample sign-in in the development vault'),
          passwordAction('Choose password provider','settings'),
          provider.installation==='installed'?passwordAction('Open development vault','open'):passwordAction('Add development provider','install'),
        ]:[
          native?info('Proton Pass',installation[provider.installation]||'Status unavailable'):note('Proton Pass','Managed by your browser and operating system'),
          native?info('Selection',selection[provider.selection]||'Selection unavailable'):note('Selection','Native provider status is unavailable here'),
          native?info('Autofill',provider.support==='available'?'Available on this device':provider.support==='unavailable'?'Unavailable for this device or user':'Availability not checked'):note('Autofill','Use your browser’s password settings'),
          note('Vault','Confirm unlock, saved passwords and filling in your provider.'),
          note('Compatibility','Proton may show a browser warning. Check the website address before filling.'),
          ...(native?[passwordAction('Choose password provider in Android','settings'),...(provider.installation==='installed'?[passwordAction('Open Proton Pass','open')]:provider.installation==='absent'?[passwordAction('Get Proton Pass from Proton','install')]:[]),{kNav:true,label:'Refresh password provider status',lbl:'Refresh password provider status',chev:true,noAB:true,go:()=>void refresh()}]:[]),
        ]);
        if(native){
          const photoAction=(label:string,go:()=>void):Bag=>({kNav:true,label,lbl:label,chev:true,noAB:true,go});
          page.groups.push(group([photoAction('Photos',()=>{api.set({page:'photos'});void refresh();})]));
          if(state.page==='photos'){
            const status=photoAccess?.scope==='full'?'All photos and videos':photoAccess?.scope==='selected'?'Selected photos and videos':photoAccess?.scope==='partial'?`Photos: ${photoAccess.images}; videos: ${photoAccess.videos}`:photoAccess?.scope==='denied'?'Only photos and videos saved by Alpha':'Access could not be checked';
            const choose=async()=>{if(photoAccessBusy)return;photoAccessBusy=true;changed();const instance=owner;try{const access=await photoLibrary.requestLibraryAccess();if(owner===instance)photoAccess=access;}catch{if(owner===instance)api.toast('Photo access could not open. Review it in Android settings.');}finally{photoAccessBusy=false;if(owner===instance)changed();}};
            out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Photos',hasTitle:true,backLabel:'Back to Settings',back:()=>api.set({page:null}),hero:{},groups:[group([
              info('Library access',status),
              {...photoAction(photoAccessBusy?'Opening…':'Choose photo access',()=>void choose()),busy:photoAccessBusy},
              photoAction('Android photo permissions',()=>void photoLibrary.openLibrarySettings().catch(()=>api.toast('Android app settings could not open.'))),
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
          const googleStatus=checking?'Checking connection…':unavailable?'Connection unavailable':googleCalendars.length?(hasGoogleWrites?'Connected':'Finish connecting'):'Not connected';
          const groups:Bag[]=[group([{kNav:true,label:'Google Calendar',lbl:'Google Calendar',sub:googleStatus,hasSub:true,chev:true,noAB:true,go:()=>{const scope=owner?.calendarConnectionScope?.();if(scope)googleConnectionController.openCalendar(scope);}}])];
          const needsRecovery=['legacy','android-native','browser-local'].includes(authority)||model?.status==='transition-required'||model?.status==='legacy-recovery';
          if(needsRecovery){
            const recovery:Bag[]=[info('Saved events','Your earlier saved events are kept unchanged.')];
            if(calendarView?.canConfirmCalendarTransition)recovery.push({kNav:true,label:'Review saved events',lbl:'Review saved events',chev:true,noAB:true,go:calendarView.confirmCalendarTransition});
            if(model?.status==='legacy-recovery')recovery.push({kNav:true,label:'Recover saved events',lbl:'Recover saved events',chev:true,noAB:true,go:()=>openCalendarRecovery()});
            if(['legacy','android-native','browser-local'].includes(authority)){
              const useCalendar=calendarView?.calendarAuthorityChoices?.find((choice:Bag)=>choice.label==='Agent Calendar');
              if(useCalendar)recovery.push({kNav:true,label:'Return to Calendar',lbl:'Return to Calendar',chev:true,noAB:true,go:useCalendar.go});
            }
            groups.push({...group(recovery),cap:'Recovery',hasCap:true});
          }else if(['error','partial','unavailable'].includes(model?.status)||model?.status==='ready'&&calendarView?.nativeStatusLabel){
            const message=model?.status==='partial'||model?.status==='ready'?'Some events could not load. Try again.':'Calendar could not load. Try again.';
            groups.push(group([info('Calendar needs attention',message),{kNav:true,label:'Retry calendar',lbl:'Retry calendar',chev:true,noAB:true,go:calendarView?.nativeStatusRetry??display?.retry}]));
          }else if(display?.native&&!display.loading&&!display.ready){
            groups.push(group([{kNav:true,label:'Review calendar access',lbl:'Review calendar access',chev:true,noAB:true,go:display.connect??display.retry}]));
          }
          if(developerTools&&!Capacitor.isNativePlatform())groups.push({...group([{kNav:true,label:'Calendar backups',lbl:'Calendar backups',sub:'Events saved in this app',hasSub:true,chev:true,noAB:true,go:()=>openCalendarRecovery()}]),cap:'Saved data',hasCap:true});
          const calendarChannel=(delivery.channels||[]).find((c:Bag)=>c.id==='calendar');
          if(calendarChannel&&!Capacitor.isNativePlatform())groups.push(group([{kTog:true,label:'Show calendar alerts',aria:'Show calendar alerts',on:!calendarChannel.blocked,track:!calendarChannel.blocked?'background:var(--acc)':'background:var(--line)',kx:!calendarChannel.blocked?20:0,toggle:()=>void run(async()=>{await notifications.setAlertPreferences({channelId:calendarChannel.id,enabled:!!calendarChannel.blocked});})}]));
          out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Calendar',hasTitle:true,backLabel:'Back to Settings',back:()=>api.set({page:null}),hero:{},groups});

        }
        // calendar-settings:end
        page.groups.push(group([{
          kTog:true,label:'Review phone actions first',aria:'Review phone actions first',hasSub:true,
          sub:'Ask before Alpha creates notes, opens apps or uses your camera and photos.',
          on:cachedDevicePreferences()?.askBeforeAgentActions===true,
          track:cachedDevicePreferences()?.askBeforeAgentActions?'background:var(--acc)':'background:var(--line)',
          kx:cachedDevicePreferences()?.askBeforeAgentActions?20:0,
          toggle:async()=>{const saved=cachedDevicePreferences();if(!saved)return;try{await editDevicePreferences(value=>{value.askBeforeAgentActions=!saved.askBeforeAgentActions;});changed();}catch{api.toast('Could not save action preference. Try again.');}}
        }]));
        page.groups.push(group([{kNav:true,label:'Password manager',lbl:'Password manager',chev:true,noAB:true,go:()=>api.set({page:'password-provider'})}]));
        if(PASSWORD_PAGES.includes(state.page)){
          const helpers={info,group,toast:(message:string)=>api.toast(message),set:(patch:Bag)=>api.set(patch),ic:api.ic||{}};
          // Alpha's own vault first; Proton Pass stays available as another provider.
          out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Password manager',hasTitle:true,backLabel:'Back to Settings',back:()=>{leavePasswordManager();api.set({page:null});},hero:{},groups:[...passwordManagerGroups(helpers),{...passwordGroup,cap:'Other password providers',hasCap:true}]});
          const entry=state.page==='password-entry'?passwordEntryPage(helpers,()=>api.set({page:'password-provider'})):null;
          if(entry)out.stack.push(entry);else if(state.page==='password-entry')queueMicrotask(()=>api.set({page:'password-provider'}));
        }else leavePasswordManager();
        if(native){
          const home=roles?.home,canRequestHome=launcher===true&&!!home&&home.available&&!home.held;
          page.groups.push(group([info('Home app',roles?roleValue(home):'Unavailable'),info('Assistant app',roles?roleValue(roles.assistant):'Unavailable'),
            ...(canRequestHome?[{kNav:true,label:'Make Alpha your Home app',lbl:roleBusy?'Waiting for Android…':'Make Alpha your Home app',chev:true,noAB:true,go:()=>void requestHome(api)}]:[]),
            nav('Default apps in Android','default-apps')]));
          // Install update only for the version the last manifest offers this install, and an explicit check. No error or "up to date" claim.
          const update=parseUpdateManifest(savedUpdate().manifest,{versionCode:facts.appVersionCode,launcher,signerSha256:facts.appSigner});
          page.groups.push(group([
            ...(update?[{...action(updateBusy==='install'?'Downloading update…':'Install update',()=>void updateAction('install',()=>device.installUpdate({apkUrl:update.apkUrl,sha256:update.sha256,sizeBytes:update.sizeBytes,versionCode:update.versionCode}).catch(()=>{/* Quiet: the row stays and the next tap retries. */}))),val:update.versionName?versionLabel(update.versionName,update.versionCode):String(update.versionCode),hasVal:true,sub:update.notes,hasSub:!!update.notes,busy:!!updateBusy}]:[]),
            {...action(updateBusy==='check'?'Checking for updates…':'Check for updates',()=>void updateAction('check',()=>checkForUpdate(true))),busy:!!updateBusy}]));
        }
        page.groups.push(group([{kNav:true,label:'Scheduled digests',lbl:'Scheduled digests',chev:true,noAB:true,go:()=>window.dispatchEvent(new Event('alpha:hosted-digests'))}]));
        // Every Alpha Phone signs in to Eliza Cloud and holds a plan: account, plan and sign-in expiry.
        const plan=connectionController.residentPlanSettings();
        if(plan){
          const day=(at:number)=>new Date(at).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
          if(state.page==='cloud-plan'){
            // Runtime location and Cloud inference are separate facts.
            const rows:Bag[]=[info('Account',plan.account??(plan.offline?`${serviceName} unreachable`:'Not signed in')),...(plan.signedIn?[info('Plan',plan.plan)]:[]),info('AI connection',plan.inference)];
            if(plan.endsAt)rows.push(info(plan.status==='active'||plan.status==='trialing'||plan.status==='past_due'?'Plan runs until':'Plan ended',day(plan.endsAt)));
            // Plan state, not a balance: the allowance Cloud reports and the latest limit with its retry time.
            if(plan.allowance)rows.push(info('Plan allowance',plan.allowance));
            if(plan.limit)rows.push(info('AI requests',plan.limit));
            if(plan.keyExpiresAt)rows.push(info(plan.keyExpiring?'Sign-in expires soon':'Sign-in expires',day(plan.keyExpiresAt)));
            if(connection.busy)rows.push(info('Status',connection.message||'Please wait…'));
            const actions:Bag[]=connection.busy?[action('Cancel',()=>connectionController.cancel())]:plan.signedIn?[
              ...(plan.keyExpiring?[{kNav:true,label:'Approve this phone again',lbl:'Approve this phone again',chev:true,noAB:true,go:()=>void connectionController.residentCloudLogin()}]:[]),
              // A membership code grants subscription access without purchasing a recurring plan.
              {kNav:true,label:'Redeem code',lbl:'Redeem code',chev:true,noAB:true,go:()=>connectionController.openPlan({codeEntry:true})},
              {kNav:true,label:'Manage plan',lbl:'Manage plan',chev:true,noAB:true,go:()=>void connectionController.residentManagePlan()},
              {kNav:true,label:'Sign out',lbl:`Sign out of ${serviceName}`,chev:true,noAB:true,go:()=>{if(window.confirm(`Sign out of ${serviceName}? Your notes and chats will stay on this phone.`))void connectionController.cloudSignOut();}},
            ]:plan.offline?[{kNav:true,label:'Check plan again',lbl:'Check plan again',chev:true,noAB:true,go:()=>connectionController.recheckPlanOnReturn()}]
            :[{kNav:true,label:`Sign in with ${serviceName}`,lbl:`Sign in with ${serviceName}`,chev:true,noAB:true,go:()=>void connectionController.residentCloudLogin()}];
            out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Account & plan',hasTitle:true,backLabel:'Back to Settings',back:()=>api.set({page:null}),hero:{},groups:[group(rows),group(actions)]});
          }
        }
        page.groups.push(group([{kNav:true,label:'Agent connection',lbl:'Agent connection',val:connectionController.getSnapshot().name,hasVal:true,chev:true,noAB:true,go:()=>native&&!testMocksEnabled?api.set({page:'agent-connection'}):connectionController.open()},{kNav:true,label:'AI provider',lbl:'AI provider',val:connection.providerStatus?.selected&&connection.providerStatus.provider==='cerebras'?'Own API keys':connection.providerStatusError?'Status unavailable':'Cloud',hasVal:true,chev:true,noAB:true,go:()=>connectionController.openProviderSettings()}]));
        // Raw recovery reason, stage and record count are developer data: the product keeps the plain status.
        if(native&&developerTools&&state.page==='agent-recovery-details'){
          const reason=connection.residentRecoveryReason,recovery=connection.residentRecovery;
          const rows:Bag[]=[info('Status',reason?residentRecoveryCopy(reason,recovery):connection.session?'Alpha is running.':'Restart status is unavailable.')];
          if(reason)rows.push(info('Reason',reason));
          if(recovery)rows.push(info('Stage',recovery.step));
          if(recovery?.step==='review')rows.push(info('Startup records to keep',String(recovery.review.retainedCount)));
          out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Restart details',hasTitle:true,backLabel:'Back to Agent connection',back:()=>api.set({page:'agent-connection'}),hero:{},groups:[group(rows)]});
        }
        if(native&&!testMocksEnabled&&state.page==='agent-connection'){
          const agentRows=[info('Agent',connection.session?'Running on this device':connection.residentRecoveryReason?(connection.residentRecoveryReason==='ipc-recovery-retention-limit'?'Restart needed':'Needs attention'):connection.kind==='recovering'?'Not running':'Starting…'),info('AI',connection.residentInference==='direct'?'Cerebras · own API key':connection.residentInference==='cloud'?serviceName:!connection.cloudAccount&&connection.residentPlanNotice!=='offline'?'Sign in required':!connection.session&&connection.kind==='starting'&&!connection.residentRecoveryReason?'Starting…':'Not available')];
          if(connection.message)agentRows.push(info('Status',connection.message));
          if(connection.error)agentRows.push(info('Connection problem',connection.error));
          if(connection.residentRecoveryReason&&!connection.session){
            agentRows.push(info('Status',residentRecoveryCopy(connection.residentRecoveryReason,connection.residentRecovery)));
            if(connection.residentRecoveryReason==='ipc-recovery-retention-limit'&&!connection.busy)
              agentRows.push(action('Restart Alpha',()=>void connectionController.restartRecovery()));
            if(developerTools)agentRows.push(action('Details',()=>api.set({page:'agent-recovery-details'})));
          }else if(!connection.busy)agentRows.push(action(connection.session?'Reconnect agent':'Retry',()=>void connectionController.startLocal()));
          if(connection.busy){
            agentRows.push(info('Connection','Please wait…'));
            if(connection.residentRecovery?.step!=='archiving')agentRows.push(action('Cancel',()=>connectionController.cancel()));
          }
          const groups:Bag[]=[group(agentRows)];
          if(connection.session){
            const historyRows=[info('Conversation history','Load from this agent only. Restoring replaces the visible chat and draft; it does not run past actions.')];
            if(!connection.busy){
              historyRows.push(action('New conversation',()=>void connectionController.newConversation()),action('Load conversations',()=>void connectionController.listHistory()));
              for(const item of connection.conversations)historyRows.push(action(`Restore conversation: ${item.title}`,()=>void connectionController.restoreHistory(item.id)));
            }
            if(connection.historyError){historyRows.push(info('History',connection.historyError));if(!connection.busy)historyRows.push(action('Retry saved conversation',()=>void connectionController.retrySavedHistory()));}
            groups.push(group(historyRows));
          }
          if(connection.session&&connection.phoneActionsAvailable){
            const refreshRows=connection.busy?[info('Phone action history','Please wait…')]:[action('Refresh actions',()=>void connectionController.actionHistory()),action('Sync recorded receipts',()=>void connectionController.actionHistory(true))];
            groups.push(group(refreshRows));
            for(const item of connection.actionHistory){
              const rows=[info(item.title,item.outcome+(item.timestamp?` · ${item.timestamp}`:''))];
              if(item.detail)rows.push(info('Details',item.detail));
              if(!connection.busy){
                if(item.state==='pending')rows.push(action('Reject proposal',()=>void connectionController.rejectAction(item.id)));
                if(['executing','reconciliation_required'].includes(item.state))rows.push(info('Review','After checking this phone, confirm whether this exact action happened.'),action('I verified it happened',()=>void connectionController.reconcileAction(item.id,'applied')),action('I verified it did not happen',()=>void connectionController.reconcileAction(item.id,'not_applied')));
              }
              groups.push(group(rows));
            }
          }
          out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Connection help',hasTitle:true,backLabel:'Back to Settings',back:()=>api.set({page:null}),hero:{},groups});
        }
        if(native)page.groups.push(group([{kNav:true,label:'Reset Alpha data',lbl:'Reset Alpha data',sub:'Erase local Alpha data · device unlock required',hasSub:true,chev:true,noAB:true,go:async()=>{
          // Shared native review (@elizaos/capacitor-system/reset): only cancelled or unavailable reach here.
          api.toast((await reviewDataReset(registerPlugin<DataResetPlugin>('AlphaReset'))).message);
        }}]));
        if(developerTools)page.groups.push(group([{kNav:true,label:'Try mock mode',lbl:'Try mock mode',chev:true,noAB:true,go:()=>connectionController.mock()}]));
        if(developerTools&&recovery.length)page.groups.push(group([info('Saved data needs recovery','Back up before resetting'),...recovery.map(name=>({kNav:true,label:recoveryActions[name].label,lbl:recoveryActions[name].label,chev:true,noAB:true,go:()=>recoveryActions[name].open()}))]));
        if(state.page==='problems'){
          const rows=crashLog?[...crashLog.entries].reverse().map(entry=>{const line=describeCrashEntry(entry);return {kLog:true,time:new Date(entry.at).toLocaleString(),text:`${line.title} · ${line.detail}`};}):[];
          out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Problem log',hasTitle:true,backLabel:'Back to Settings',back:()=>api.set({page:null}),hero:{},groups:[
            group([info('Kept on this device','Failure classes only, 30 days, no content'),...(crashLog&&!crashLog.exitHistory&&native?[info('Android exit history','Needs Android 11 or newer')]:[])]),
            group(crashLog?(rows.length?rows:[info('No problems recorded','')]):[info('Problem log unavailable','Try again later')]),
            group([diagnosticsRow(),...(crashLog?.entries.length?[{kNav:true,label:'Clear problem log',lbl:crashBusy?'Clearing…':'Clear problem log',chev:true,noAB:true,go:()=>void clearProblems(api)}]:[])]),
          ]});
        }
        if(state.page==='licenses'){
          const query=typeof state.licenseQuery==='string'?state.licenseQuery:'';
          const matches=licenses.items.map((item,index)=>({item,index})).filter(({item})=>(item.name+' '+item.version+' '+item.license).toLowerCase().includes(query.trim().toLowerCase()));
          const rows=matches.map(({item,index})=>({...action(item.name,()=>api.set({page:'license-detail',licenseIndex:index})),lbl:item.name+' '+item.version,sub:item.version+' · '+item.license,hasSub:true,licenseComponent:true}));
          out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Open source licenses',hasTitle:true,backLabel:'Back to About',back:()=>api.set({page:'about'}),hero:{},groups:licenses.status==='ready'?[group([{kLicenseSearch:true,value:query,change:(event:Event)=>api.set({licenseQuery:(event.target as HTMLInputElement).value})}]),group(rows.length?rows:[info('No matching components','Try another name or license')])]:[group([info(licenses.status==='unavailable'?'License notices unavailable':'Loading license notices…',licenses.status==='unavailable'?'Reinstall or update the app to restore them':'')])]});
        }
        if(state.page==='license-detail'){
          const item=Number.isSafeInteger(state.licenseIndex)?licenses.items[state.licenseIndex]:null;
          out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'License details',hasTitle:true,backLabel:'Back to licenses',back:()=>api.set({page:'licenses'}),hero:{},groups:item?[group([info(item.name,item.version+' · '+item.license)]),...(item.source?[group([{kLegalText:true,label:'Source',text:item.source}])]:[]),...(licenseFlagRows(item).length?[group(licenseFlagRows(item))]:[]),group([{kLegalText:true,label:'License and notices',text:item.text||'License text is missing from this build. Redistribution permission has not been established by this notice.'}])]:[group([info('Notice unavailable','Return to the component list')])]});
        }

        if (owner?.props.systemShell === false) {
          const systemOnly = new Set(['Wi-Fi', 'Bluetooth', 'Mobile data', 'Battery', 'Sound & vibration']);
          page.groups = page.groups.map((g:Bag) => ({...g, rows:g.rows.filter((row:Bag) => !systemOnly.has(row.label))})).filter((g:Bag) => g.rows.length);
        }
        for (const g of page.groups) for (const row of g.rows) if (row.label in topValues) {
          row.sub = topValues[row.label]; row.hasSub = true; row.val = ''; row.hasVal = false;
        }
        continue;
      }
      if (page.title === 'Accounts') {
        const plan=connectionController.residentPlanSettings();
        page.groups = [group([{ kNav:true, label:`${serviceName} account & plan`, lbl:`${serviceName} account & plan`, sub:plan?.keyExpiring?'Sign-in expiring':cloudLabel, hasSub:true, chev:true, noAB:true, go:()=>plan?api.set({page:'cloud-plan'}):connectionController.openCloudAccount() }, ...(Capacitor.isNativePlatform()?[nav('Device accounts in Android', 'accounts')]:[])])];
      } else if (page.title === 'Connections') {
        page.groups = [group([{kNav:true,label:'Manage Google accounts',lbl:'Manage Google accounts',chev:true,noAB:true,go:()=>googleConnectionController.open()}])];
      } else if (state.page === 'character' && page.hero?.kChar === true) {
        // The reference character page deliberately has no visible title.
        page.groups = browserDevProfile?[group([
          info('Speech','Record and review in this app'),
          ...(externalVoiceInvocationEnabled ? [{kNav:true,label:'Wake assistant',lbl:'Wake assistant',chev:true,noAB:true,go:()=>void owner?.startVoice()}] : []),
          {kNav:true,label:'Open conversation',lbl:'Open conversation',chev:true,noAB:true,go:()=>api.composeContentQuestion('')},
          {kNav:true,label:'Agent connection',lbl:'Agent connection',chev:true,noAB:true,go:()=>connectionController.open()},
        ])]:[group([...speechRows(), ...listenerRows()])];
      } else if (page.title === 'Battery') {
        page.hero = { ...page.hero, big: percent, sub: typeof facts.charging === 'boolean' ? facts.charging ? 'Charging' : 'On battery' : 'Battery reading unavailable', hasMeter: typeof facts.batteryPercent === 'number', meter: facts.batteryPercent ?? 0 };
        page.groups = [group([info('Battery saver', typeof facts.powerSave === 'boolean' ? facts.powerSave ? 'On' : 'Off' : 'Unavailable'), nav('Manage battery in Android', 'battery')])];
      } else if (page.title === 'About') {
        const native=Capacitor.isNativePlatform();
        page.hero={kAlpha:true,version:native?versionLabel(facts.appVersion||buildVersion,facts.appVersionCode):buildVersion==='Unavailable'?'Development preview':'Version '+buildVersion};
        page.groups=[...(native&&facts.androidRelease?[group([info('Android version',facts.androidRelease)])]:[]),group([licensesRow()])];
      } else if (page.title === 'Wi-Fi') {
        page.hasHdrTog = false; page.hdrTog = null;
        page.hero = { ...page.hero, big: wifiValue, sub: 'Wi-Fi transport · network names stay in Android settings' };
        page.groups = [group([nav('Manage Wi-Fi networks', 'wifi')])];
      } else if (page.title === 'Bluetooth') {
        page.hasHdrTog = false; page.hdrTog = null;
        page.groups = [group([...(typeof facts.bluetoothEnabled === 'boolean' ? [info('Bluetooth', bluetoothValue)] : []), info('Device connections', 'Manage in Android'), nav('Pair or manage devices', 'bluetooth')])];
      } else if (page.title === 'Mobile data') {
        page.groups = [group([info('Mobile connection', active('cellularActive')),
          ...(Capacitor.isNativePlatform() ? [info('Mobile data', reported(facts.mobileDataEnabled)), info('Airplane mode', reported(facts.airplaneMode))] : []),
          nav('Manage mobile networks', 'mobile'), ...(Capacitor.isNativePlatform() ? [nav('Airplane mode in Android', 'airplane')] : [])])];
      } else if (page.title === 'Models') {
        const native=Capacitor.isNativePlatform();
        page.hero = { ...page.hero, big: target, sub: native&&connection.residentInference==='direct'?'Cerebras · own key':cloudRuntimeEnabled?'':native?'Conversation uses the selected agent. Voice runs on this device.':developmentCartesiaVoiceEnabled?'Direct Cerebras and Cartesia · development':`Conversation uses the selected agent. Voice uses ${serviceName}.` };
        page.groups = [group([info('Connection', runtimeLocation), ...(native?[info('Inference provider',residentProvider?residentProvider.configured?(residentProvider.provider==='elizacloud'?serviceName:'Cerebras'):'Not configured':'Status unavailable')]:browserLocalAgentEnabled ? [info('Inference provider', inferenceProvider)] : []), info('Inference model', inferenceModel), info('Voice', native&&connection.residentInference==='direct'?(connection.providerStatus?.voiceConfigured?'Cartesia · own API key':'Off · add a Cartesia key'):cloudRuntimeEnabled?(account?`${serviceName} · Cartesia output`:'Cloud sign-in required'):native?'On this device':developmentCartesiaVoiceEnabled?'Cartesia · development':account ? serviceName : 'Sign-in required'), { kNav:true, label:`${serviceName} account`, lbl:`${serviceName} account`, chev:true, noAB:true, go:()=>connectionController.openCloudAccount() }])];
      } else if (page.title === 'Developer') {
        page.groups = [group([info('App version', facts.appVersion || buildVersion), info('Agent memory', connection.session?'Usage not reported by agent':'Not connected')]), group([problemsRow(), diagnosticsRow()]), group([nav('Android developer settings', 'developer')])];
      } else if (page.title === 'Notifications') {
        const custom = (label:string,go:()=>void):Bag=>({kNav:true,label,lbl:label,chev:true,noAB:true,busy:notificationBusy,hasVal:notificationBusy,val:'Working…',go:()=>{if(!notificationBusy)go();}});
        const policy = (changes:Bag)=>void run(async()=>{await notifications.setNotificationPolicy({expectedRevision:cross.revision,...changes});if(changes.history===false)history=[];});
        const selected:Bag[]=cross.apps||[];
        const showCrossAppNotifications = Capacitor.isNativePlatform() || devSurfacesEnabled;
        const crossRows:Bag[]=showCrossAppNotifications ? [info('Other apps',typeof cross.accessGranted!=='boolean'?'Unavailable':!cross.enabled?'Collection off':cross.paused?(testMocksEnabled?'Paused after mock mode':'Paused · resume to collect'):!cross.accessGranted?'Android access not granted':!cross.connected?'Waiting for Android listener':'Selected apps connected'),info('Notification privacy',Capacitor.isNativePlatform()?'Android grants broad access. Alpha reads only selected apps; previews and history are separate choices.':(devSurfacesEnabled?'Preview events are stored in this app. ':'Notification events are stored in this app. ')+'Previews and metadata history are separate choices.'),info('Agent access','Notification content is not sent to your agent')] : [];
        if(showCrossAppNotifications && cross.revision){
          crossRows.push(custom(cross.enabled?'Turn off other-app collection':'Enable selected-app collection',()=>{
            if(Capacitor.isNativePlatform()&&!cross.enabled&&!window.confirm('Enable collection for your selected apps? Android grants broad notification access. Alpha filters to your selection before reading text. Previews and local metadata history remain separate choices.'))return;
            policy({enabled:!cross.enabled});
          }),custom(Capacitor.isNativePlatform()?'Manage notification access in Android':'Manage development notification access',()=>void run(async()=>{await notifications.openNotificationAccess();})),custom(choices?'Hide app choices':'Choose notification apps',()=>{
            if(choices){choices=null;owner?.vset('settings',{notificationChanged:Date.now()});return;}
            void run(async()=>{const next=await notifications.notificationApps();choices=next.apps;});
          }));
          if(cross.paused)crossRows.push(custom('Resume selected-app collection',()=>void run(async()=>{if(window.confirm('Resume collection of notifications from your selected apps?'))await notifications.resumeCrossApp({expectedRevision:cross.revision});})));
          for(const app of selected)crossRows.push(info(app.label,app.available===false?'App changed: remove and select again':app.preview?'Current title and text allowed':'Content hidden'),custom(`Remove ${app.label}`,()=>policy({apps:selected.filter(a=>a.packageName!==app.packageName).map(({packageName,preview})=>({packageName,preview}))})),custom(`${app.preview?'Hide':'Allow'} previews: ${app.label}`,()=>{
            if(Capacitor.isNativePlatform()&&!app.preview&&!window.confirm(`Allow current notification titles and text from ${app.label} while unlocked? They stay on this phone and are not stored in history or sent to the agent.`))return;
            policy({apps:selected.map(a=>({packageName:a.packageName,preview:a.packageName===app.packageName?!app.preview:a.preview}))});
          }));
          for(const app of choices||[])if(!selected.some(a=>a.packageName===app.packageName))crossRows.push(custom(`Select ${app.label} (${app.packageName})`,()=>policy({apps:[...selected.map(({packageName,preview})=>({packageName,preview})),{packageName:app.packageName,preview:false}]})));
          crossRows.push(info('Local metadata history',cross.historyUnavailable?'Unavailable; clear local history to reset':cross.history?'On · 100 events, 24 hours · no message text':'Off'),custom(cross.history?'Turn off local metadata history':'Enable local metadata history',()=>{
            if(Capacitor.isNativePlatform()&&!cross.history&&!window.confirm('Keep up to 100 redacted notification events for 24 hours in encrypted storage on this phone? Only selected app identity, event times and status are saved. No title or message text is stored.'))return;
            policy({history:!cross.history});
          }),custom('View local metadata history',()=>{if(notificationBusy)return;notificationBusy=true;const current=owner;void notifications.notificationHistory().then(result=>{if(owner===current){history=result.items;owner?.vset('settings',{notificationChanged:Date.now()});}}).catch(()=>api.toast('Local notification history is unavailable.')).finally(()=>{notificationBusy=false;});}),custom('Clear local metadata history',()=>{if(window.confirm('Permanently clear local notification metadata history?'))void run(async()=>{await notifications.clearNotificationHistory();history=[];});}));
          if(history!==null){if(!history.length)crossRows.push(info('History','No retained events'));for(const row of history)crossRows.push(info(row.appLabel,`${row.state} · ${new Date(row.at).toLocaleString()} · no action available`));}
        }
        page.groups = [group(Capacitor.isNativePlatform()?[info('Alpha notifications',topValues.Notifications),info('Do Not Disturb',interruptionLabels[delivery.interruption]||'Not available'),nav('Manage Alpha notifications','notifications')]:[{kTog:true,label:'Allow alerts',aria:'Allow alerts',on:delivery.appEnabled===true,track:delivery.appEnabled?'background:var(--acc)':'background:var(--line)',kx:delivery.appEnabled?20:0,toggle:()=>void run(async()=>{await notifications.setAlertPreferences({appEnabled:delivery.appEnabled!==true});})}]),
          ...(Capacitor.isNativePlatform()?(delivery.channels||[]).map((channel:Bag)=>group([{kNav:true,label:channel.name,lbl:channel.name,chev:true,noAB:true,go:()=>void notifications.openChannelSettings({id:channel.id})}])):[]),...(crossRows.length?[group(crossRows)]:[])];
      } else if (page.title === 'Privacy & data') {
        if (cloudRuntimeEnabled) page.groups = page.groups.map((g: Bag) => ({ ...g, rows: g.rows.map((row: Bag) => {
          const fact = cloudPrivacyRow(row.label);
          return fact ? info(...fact) : row;
        }) }));
        // Alpha declares no Contacts permission; Calendar is the fourth runtime grant it uses.
        const permissionLabels=new Set(['Microphone','Location','Camera','Calendar']);
        const permissionValue=(label:string)=>{
          if(!Capacitor.isNativePlatform())return ({granted:'Granted for this app',prompt:'Ask when used',denied:'Blocked by your system',unknown:'Managed by your system'} as Bag)[facts.permissionStates?.[label]]??'Managed by your system';
          if(typeof facts.permissions?.[label]!=='boolean')return 'Unavailable';
          if(label==='Location')return facts.locationAccess==='precise'?'Precise location allowed':facts.locationAccess==='approximate'?'Approximate location allowed':'Not allowed';
          return facts.permissions[label]?'Allowed for Alpha':'Not allowed';
        };
        // Keep connection privacy and Activity; replace only prototype permission rows.
        page.groups=page.groups.map((g:Bag)=>{
          if(!g.rows.some((row:Bag)=>permissionLabels.has(row.label)||row.label==='Contacts'))return g;
          const rows=g.rows.filter((row:Bag)=>row.label!=='Contacts').map((row:Bag)=>permissionLabels.has(row.label)?info(row.label,permissionValue(row.label)):row);
          if(!rows.some((row:Bag)=>row.label==='Calendar'))rows.push(info('Calendar',permissionValue('Calendar')));
          return {...g,rows};
        });
        page.groups.push(group([...(Capacitor.isNativePlatform()?[info('Device location',reported(facts.locationEnabled)),nav('Location in Android','location')]:[]),nav('Manage Alpha permissions','privacy')]));
      } else if (page.title === 'Sound & vibration') {
        const volume = (label: string, stream: string) => {
          const value = controls.volumes?.find((v: Bag) => v.stream === stream);
          return info(label, value && value.max > 0 ? `${Math.round(value.current * 100 / value.max)}%` : 'Unavailable');
        };
        page.groups = [group([volume('Media', 'music'), volume('Ring', 'ring'), volume('Alarm', 'alarm')]), group([...(Capacitor.isNativePlatform() ? [info('Do Not Disturb', interruptionLabels[delivery.interruption ?? facts.interruptionFilter] || 'Unavailable'), nav('Do Not Disturb in Android', 'dnd')] : []), nav('Manage sound in Android', 'sound')])];
      } else if (page.title === 'Display') {
        page.hero={...page.hero,sub:Capacitor.isNativePlatform()?'Alpha app text · Android accessibility scale also applies':'Alpha app text size',subCss:'font-size:13px;color:var(--fg)'};
        for (const g of page.groups) g.rows = g.rows.map((row: Bag) => {
          if(row.label==='Theme'&&row.kSeg){
            // A voice command or a ?theme preview can draw an explicit theme the saved choice does not.
            const stored=readAppearanceChoice(),choice:AppearanceChoice=resolveAppearance(stored)===api.theme?stored:api.theme==='dark'?'dark':'light';
            const pick=(next:AppearanceChoice)=>()=>{
              const theme=resolveAppearance(next);
              try{localStorage.setItem(APPEARANCE_KEY,next);}
              catch{api.toast('Theme changed for this session, but could not be saved.');}
              // The choice is already saved, so the theme change carries the storage marker.
              owner?.setState({theme,appearanceStorageRead:{theme}});
            };
            return {...row,opts:([['system','System'],['light','Light'],['dark','Dark']] as Array<[AppearanceChoice,string]>).map(([value,label])=>{const on=value===choice;return {label,on,aria:`Theme: ${label}`,css:on?'background:var(--acc);color:#fff':'color:var(--mut)',pick:pick(value)};})};
          }
          if(row.label==='Brightness')return {...nav('Manage brightness in Android','display'),...(typeof facts.adaptiveBrightness==='boolean'?{val:facts.adaptiveBrightness?'Adaptive brightness on':'Adaptive brightness off',hasVal:true}:{})};
          if(row.label!=='Text size')return row;
          if(!Number.isInteger(facts.textScalePercent))return info('Text size','Native setting unavailable');
          const percent=facts.textScalePercent;
          return {...row,valueLabel:`${percent}%`,v:percent<=100?(percent-75)*2:percent-50,set:(event:Event)=>{
            const value=Number((event.target as HTMLInputElement).value),requested=Math.round(value<=50?75+value/2:value+50),token=++scaleGeneration,instance=owner;
            ++generation;void device.setTextScale({percent:requested}).then(result=>{if(owner===instance&&token===scaleGeneration){facts={...facts,...result};instance?.vset('settings',{nativeReadAt:Date.now()});}}).catch(()=>{if(owner===instance&&token===scaleGeneration)api.toast('Text size could not be saved.');});
          }};
        });
        page.groups=page.groups.map((g:Bag)=>({...g,rows:g.rows.filter((row:Bag)=>row.label!=='Text size'&&(Capacitor.isNativePlatform()||row.label!=='Manage brightness in Android'))})).filter((g:Bag)=>g.rows.length);
        const percent=Number.isInteger(facts.textScalePercent)?facts.textScalePercent:100;
        page.groups.push({...group(([['Small',75],['Default',100],['Large',115],['Larger',130],['Largest',150]] as const).map(([label,value])=>({kNav:true,isTextSize:true,textSizePreviewCss:`font-size:${Math.round(value*.16)}px`,sizeSelected:percent===value,label,lbl:`Text size: ${label}${percent===value?', selected':''}`,val:'',hasVal:false,noAB:true,go:async()=>{const token=++scaleGeneration,instance=owner;++generation;try{const result=await device.setTextScale({percent:value});if(owner===instance&&token===scaleGeneration){facts={...facts,...result};instance?.vset('settings',{nativeReadAt:Date.now()});}}catch{if(owner===instance&&token===scaleGeneration)api.toast('Text size could not be saved.');}}}))),cap:'Text size',hasCap:true});
      }
    }
    const settingsTop = out.stack.find((page: Bag) => page.isTop);
    if (settingsTop) {
      const rows = new Map<string, Bag>();
      for (const section of settingsTop.groups) {
        for (const row of section.rows) if (!rows.has(row.label)) rows.set(row.label, row);
      }
      const labels: Record<string, string> = {
        'Accounts': 'Account & plan',
        'Connections': 'Google & email',
        'AI provider': 'AI connection',
        'Agent connection': 'Connection help',
        'Set up Alpha access': 'App permissions',
        'Scheduled digests': 'Scheduled summaries',
        'Review phone actions first': 'Ask before taking actions',
      };
      const sections = [
        ['Account', ['Accounts', 'Connections', 'AI provider']],
        ['Preferences', ['Display', 'Notifications']],
        ['Privacy', ['Set up Alpha access', 'Review phone actions first']],
        ['Apps', ['Calendar', 'Scheduled digests', 'Password manager', 'Photos']],
        ['Help', ['About']],
      ] as const;
      rows.delete('Models');
      rows.delete('Agent connection');
      rows.delete('Privacy & data');
      settingsTop.groups = sections.map(([caption, names]) => {
        const selected = names.flatMap(name => {
          const row = rows.get(name);
          if (!row) return [];
          rows.delete(name);
          const label = labels[name] || name;
          return [{...row, label, lbl: label, ...(row.aria ? {aria: label} : {}),
            ...(name === 'Accounts' ? {go:()=>connectionController.residentPlanSettings()?api.set({page:'cloud-plan'}):connectionController.openCloudAccount()} : {}),
            ...(name === 'Set up Alpha access' ? {go:()=>{activeSettingsCategory='settings-privacy';api.set({page:'settings-permissions'});}} : {}),
            ...(name === 'Connections' ? {go:()=>googleConnectionController.open(),...(!account?{sub:'Sign in to connect Google'}:{})} : {}),
            ...(name === 'About' ? {hasVal:false, hasSub:false, sub:'', val:''} : {})}];
        });
        return {...group(selected), cap:caption, hasCap:true};
      }).filter(section => section.rows.length);
      if (rows.size) settingsTop.groups.splice(2, 0, {...group([...rows.values()]), cap:'Device', hasCap:true});
      for (const page of out.stack) {
        if (page.title === 'Accounts') page.title = 'Account & plan';
        if (page.title === 'Connections') page.title = 'Google & email';
      }
    }
    if(settingsTop){
      const detailGroups=settingsTop.groups;
      const categories=[['settings-account','Account',['Account']],['settings-general','General',['Preferences','Device']],['settings-privacy','Privacy',['Privacy']],['settings-apps','Apps',['Apps']],['settings-help','About',['Help']]] as const;
      settingsTop.groups=categories.filter(([key])=>key!=='settings-account').map(([key,title])=>group([{kNav:true,label:title,lbl:title,chev:true,noAB:true,go:()=>{activeSettingsCategory=key==='settings-help'?null:key;api.set({page:key==='settings-help'?'about':key});}}]));
      const appSettingsRows=detailGroups.filter((section:Bag)=>section.cap==='Apps').flatMap((section:Bag)=>section.rows);
      const appCatalog=[['Browser','browser'],['Calendar','calendar'],['Camera','camera'],['Files','files'],['Inbox','inbox'],['Maps','maps'],['Notes','notes'],['Passwords','passwords'],['Photos','photos'],['Workflows','workflows']] as const;
      const existingAppRow=(id:string)=>appSettingsRows.find((row:Bag)=>row.label===(id==='calendar'?'Calendar':id==='photos'?'Photos':id==='passwords'?'Password manager':id==='workflows'?'Scheduled summaries':''));
      const selected=categories.find(([key])=>key===categoryPage);
      if(selected){
        const [key,title,captions]=selected;
        let groups=detailGroups.filter((section:Bag)=>(captions as readonly string[]).includes(section.cap)).map((section:Bag)=>({...section,hasCap:false,cap:undefined}));
        if(key==='settings-apps')groups=[group(appCatalog.map(([label,id])=>({kNav:true,label,lbl:label,chev:true,noAB:true,go:()=>{activeSettingsCategory='settings-apps';const existing=existingAppRow(id);if(existing&&id!=='workflows')existing.go();else api.set({page:'app-settings-'+id});}})))];
        out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title,hasTitle:true,backLabel:'Back to Settings',back:()=>{activeSettingsCategory=null;api.set({page:null});},hero:{},groups});
      }
    }
    if(appSettingsPage){
      const names:Record<string,string>={browser:'Browser',calendar:'Calendar',camera:'Camera',files:'Files',inbox:'Inbox',maps:'Maps',notes:'Notes',passwords:'Passwords',photos:'Photos',workflows:'Workflows'};
      const rows:Bag[]=[];
      if(appSettingsPage==='inbox')rows.push({kNav:true,label:'Google & email',lbl:'Google & email',chev:true,noAB:true,go:()=>googleConnectionController.open()});
      if(appSettingsPage==='workflows'){rows.push({kNav:true,label:'Scheduled summaries',lbl:'Scheduled summaries',chev:true,noAB:true,go:()=>window.dispatchEvent(new Event('alpha:hosted-digests'))});const channel=(delivery.channels||[]).find((c:Bag)=>c.id==='reminders');if(channel&&!Capacitor.isNativePlatform())rows.push({kTog:true,label:'Show alerts',aria:'Show alerts',on:!channel.blocked,track:!channel.blocked?'background:var(--acc)':'background:var(--line)',kx:!channel.blocked?20:0,toggle:()=>void run(async()=>{await notifications.setAlertPreferences({channelId:channel.id,enabled:!!channel.blocked});})});}
      const permissions:Record<string,string[]>={camera:['Camera','Microphone'],maps:['Location'],notes:['Microphone']};
      for(const label of permissions[appSettingsPage]||[])rows.push(info(label,typeof facts.permissions?.[label]==='boolean'?(facts.permissions[label]?'Allowed for Alpha':'Not allowed'):'Managed by your system'));
      if(appSettingsPage==='photos')rows.push(info('Photo access','Photos you choose'));
      if(appSettingsPage==='files')rows.push(info('File access','Files and folders you choose'));
      if(appSettingsPage==='browser')rows.push(info('Website permissions','Managed per website'));
      out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:names[appSettingsPage]||'App settings',hasTitle:true,backLabel:'Back to Apps',back:()=>{activeSettingsCategory='settings-apps';api.set({page:'settings-apps'});},hero:{},groups:rows.length?[group(rows)]:[group([info('Settings','No additional options')])]});
    }
    if(permissionsPage){
      const native=Capacitor.isNativePlatform();
      const status=(label:string)=>native?(typeof facts.permissions?.[label]==='boolean'?(facts.permissions[label]?'Allowed':'Not allowed'):'Not checked'):({granted:'Allowed',prompt:'Ask when used',denied:'Blocked',unknown:'Managed by your browser'} as Bag)[facts.permissionStates?.[label]]||'Managed by your browser';
      const rows=['Camera','Microphone','Location',...(native?['Calendar']:[])].map(label=>native?{...action(label,manage('privacy')),val:status(label),hasVal:true}:info(label,status(label)));
      const photos=native?(photoAccess?.scope==='full'?'All photos and videos':photoAccess?.scope==='selected'?'Selected photos and videos':photoAccess?.scope==='partial'?'Limited access':photoAccess?.scope==='denied'?'Saved by Alpha only':'Not checked'):'Photos you choose';
      rows.push(native?{...action('Photos',()=>void photoLibrary.openLibrarySettings().catch(()=>api.toast('Photo settings could not open.'))),val:photos,hasVal:true}:info('Photos',photos));
      rows.push(info('Files','Files and folders you choose'));
      rows.push({...action('Notifications',()=>api.set({page:'notifications'})),val:typeof delivery.appEnabled==='boolean'?(delivery.appEnabled&&delivery.permissionGranted?'Allowed':'Off'):'Not checked',hasVal:true});
      out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'App permissions',backLabel:'Back to Privacy',back:()=>api.set({page:'settings-privacy'}),hero:{},groups:[group(rows)]});
    }
    if(activeSettingsCategory&&!categoryPage)for(const page of out.stack)if(!page.isTop&&page.backLabel==='Back to Settings')page.backLabel='Back to '+categoryNames[activeSettingsCategory];
    const nestedParents:Record<string,[string,string]>={licenses:['about','About'],problems:['about','About'],history:['agent-connection','Connection help'],'license-detail':['licenses','licenses']};
    if(nestedParents[state.page]){const [parent,label]=nestedParents[state.page];const page=out.stack[out.stack.length-1];if(page&&!page.isTop){page.backLabel='Back to '+label;page.back=()=>api.set({page:parent});}}
    const settingsIcons:Record<string,string>={General:'settings',Privacy:'shield',Apps:'layout-grid',Help:'info',About:'info',Browser:'globe',Calendar:'calendar-days',Camera:'camera',Files:'folder',Inbox:'mail',Maps:'map-pin',Notes:'notebook-text',Passwords:'lock-keyhole',Photos:'images',Workflows:'workflow','Account & plan':'user-round','Google & email':'link','AI connection':'cpu',Display:'sun',Notifications:'bell','Privacy & data':'shield','App permissions':'fingerprint-pattern','Scheduled summaries':'clock'};
    for(const page of out.stack)for(const section of page.groups||[])for(const row of section.rows||[])if(row.kNav){row.lucideIcon='/icons/lucide/'+(row.licenseComponent?'file-text':settingsIcons[row.label]||'sliders-horizontal')+'.svg';row.hasLucideIcon=!row.isTextSize;row.hasIcon=false;row.hasTile=false;}
    // Stable identities keep focused controls attached while async groups change.
    for(const page of out.stack){
      const groups=new Map<string,number>();
      for(const section of page.groups||[]){
        const name=String(section.id??section.cap??section.rows?.[0]?.label??section.rows?.[0]?.lbl??'group');
        const occurrence=groups.get(name)??0;groups.set(name,occurrence+1);section.id=JSON.stringify([page.title||'Settings',name,occurrence]);
        const rows=new Map<string,number>();
        section.rows=(section.rows||[]).map((row:Bag)=>{if(row.kNav&&row.hasVal&&String(row.val||'').length>24)row={...row,sub:[...new Set([row.hasSub?row.sub:'',row.val].filter(Boolean))].join(' · '),hasSub:true,hasVal:false};const identity=String(row.id??row.aria??row.label??row.lbl??row.time??'')+String(row.text??'');const n=rows.get(identity)??0;rows.set(identity,n+1);return {...row,id:JSON.stringify([identity,n])};});
      }
    }
    if(!Capacitor.isNativePlatform()) {
      const browserLabels=(value:any):any=>{if(typeof value==='string')return value.replaceAll('Manage brightness in Android','Brightness').replaceAll('Manage sound in Android','Sound settings').replaceAll('Manage in Android','App settings').replaceAll('Device accounts in Android','System accounts').replaceAll('Wi-Fi transport · network names stay in Android settings','Network names stay in system settings').replaceAll('in Android','in system settings').replaceAll('Android settings','System settings').replaceAll('Android Calendar','App calendar').replaceAll('Android device information','System information').replaceAll('Android developer settings','App development settings').replaceAll('On this phone','In this app').replaceAll('on this phone','in this app').replaceAll('Android access not granted','Development event access off').replaceAll('Waiting for Android listener','Waiting for local events').replaceAll('Selected apps connected','Selected development apps connected').replaceAll('Native setting unavailable','Managed by your system');if(Array.isArray(value))return value.map(browserLabels);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,browserLabels(v)]));return value;};
      return browserLabels(out);
    }
    return out;
  };
}
