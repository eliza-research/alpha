import { externalVoiceInvocationEnabled } from '../runtime/voice-entry-policy';
import {residentRecoveryCopy} from '../runtime/resident-recovery';
import {cloudServiceName} from '../runtime/cloud-protocol';
import {browserDevProfile as devProfileQuery,developerTools} from '../browser/dev-profile';
import {cloudRuntimeEnabled,testMocksEnabled,devSurfacesEnabled,updateChannelCheckEnabled} from '../build-flags';
import {openCalendarRecovery} from '../browser/calendar-recovery';
import {openNotificationRecovery} from '../browser/notification-recovery';
import {openAlertSoundRecovery,openDevicePreferencesRecovery,openDeviceRolesRecovery} from '../browser/preference-recovery';
import {notificationDocument} from '../browser/notification-store';
import {alertSoundDocument,deviceRolesDocument} from '../browser/preference-documents';
import {cachedDevicePreferences,initializeDevicePreferences,editDevicePreferences,readDevicePreferences} from '../browser/device-preferences';
import { registerPlugin } from '../platform-plugins';
import { broaderPageNotice } from './native-adapter';
import { Capacitor } from '@capacitor/core';
import { DailyApps } from '../daily';
import { connectionController } from '../runtime/connection-ui';
import {googleConnectionController} from '../runtime/google-connection-ui';
import {GOOGLE_ACCOUNTS_CHANGED} from '../runtime/google-accounts';
import {gmailGrantLabel} from '../runtime/gmail-grants';
import { browserLocalAgentEnabled, modelLabel } from '../runtime/local-agent';
import {developmentCartesiaVoiceEnabled} from '../runtime/development-cartesia-conversation';
import type { GmailAccount } from '../runtime/cloud-protocol';
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
const notifications = registerPlugin<{status():Promise<Bag>;openAppSettings():Promise<Bag>;openChannelSettings(input:{id:string}):Promise<{status:string}>;crossAppStatus():Promise<Bag>;notificationApps():Promise<{apps:Bag[]}>;setNotificationPolicy(input:Bag):Promise<Bag>;resumeCrossApp(input:{expectedRevision:string}):Promise<Bag>;openNotificationAccess():Promise<Bag>;notificationHistory():Promise<{items:Bag[]}>;clearNotificationHistory():Promise<void>}>('AlphaNotifications');
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
  const {schema, versionCode, versionName, variant, signerSha256, apkUrl, sha256, sizeBytes, notes} = value as Record<string, unknown>;
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
/** Settings pages (docs/ui-refresh-2026-11, tla/SettingsNav.tla). Pages that only repeated Android
 * facts or another flow are gone; a stale or direct route to one opens the top level. */
export const SETTINGS_PAGES: readonly string[] = ['account', 'agent-connection', 'history', 'listening', 'calendar', 'password-provider', 'password-entry', 'cross', 'about', 'problems', 'licenses'];
export function settingsPage(page: string | null | undefined, developerSurfaces: boolean): string | null {
  if (page === 'cloud-plan') return 'account';
  if (page === 'developer') return developerSurfaces ? page : null;
  return typeof page === 'string' && SETTINGS_PAGES.includes(page) ? page : null;
}
type PlanFacts = { signedIn: boolean; offline: boolean; offerRedeem: boolean; account: string | null; plan: string; status: string | null; endsAt: number | null; keyExpiresAt: number | null; keyExpiring: boolean };
type Act = { label: string; go: () => void; danger?: boolean };
/** The Eliza Cloud page: one status line, then what can be done. Sign out asks first. */
export function cloudAccountPage(input: { plan: PlanFacts; busy: boolean; message: string; serviceName: string; day: (at: number) => string; confirm: (text: string) => boolean;
  actions: { cancel(): void; approve(): void; redeem(): void; manage(): void; signOut(): void; recheck(): void; signIn(): void } }): { status: string; detail: string; actions: Act[] } {
  const { plan, busy, serviceName, day, actions } = input;
  const ends = plan.endsAt ? `Access until ${day(plan.endsAt)}` : '';
  const status = busy ? input.message || 'Please wait…' : plan.keyExpiring ? 'Sign-in expiring' : [plan.plan, ends].filter(Boolean).join(' · ');
  const detail = plan.account ?? (plan.offline ? `${serviceName} unreachable` : '');
  if (busy) return { status, detail, actions: [{ label: 'Cancel', go: actions.cancel }] };
  if (plan.offline && !plan.signedIn) return { status, detail, actions: [{ label: 'Check again', go: actions.recheck }] };
  if (!plan.signedIn) return { status, detail, actions: [{ label: `Sign in with ${serviceName}`, go: actions.signIn }] };
  return { status, detail, actions: [
    ...(plan.keyExpiring ? [{ label: 'Sign in again', go: actions.approve }] : []),
    { label: 'Redeem code', go: actions.redeem },
    { label: 'Manage plan', go: actions.manage },
    { label: 'Sign out', danger: true, go: () => { if (input.confirm(`Sign out of ${serviceName}? Your notes and chats stay on this phone.`)) actions.signOut(); } },
  ] };
}
/** The short value beside "App permissions": how many of Alpha's runtime grants are off. */
export function permissionSummary(permissions: Record<string, unknown> | null | undefined): string {
  const values = Object.values(permissions || {}).filter((value): value is boolean => typeof value === 'boolean');
  if (!values.length) return '';
  const off = values.filter(value => !value).length;
  return off ? `${off} not allowed` : 'All allowed';
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
  let passwordOpening=false,mailImagesSaving=false,photoAccessBusy=false;
  let photoAccess:PhotoAccess|null=null;
  let recovery: RecoveryDomain[] = [];
  let capabilityAbort: AbortController | null = null;
  let inferenceAbort:AbortController|null=null;
  let gmailAccounts: GmailAccount[] = [];
  let roles: Record<string, RoleRow> | null = null, launcher: boolean | null = null, roleBusy = false, roleNotice = '';
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
          if (!cloud) { gmailAccounts = []; return; }
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
      roleNotice = next.home?.held ? 'Alpha Phone is your Home app' : 'Home app not changed';
    } catch { if (owner === instance) { roleNotice = 'Home app change is unconfirmed'; api.toast('Android did not confirm a Home app change.'); } }
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
  // Android Back pops one level, the same parent as each page's on-screen back (tla/SettingsNav.tla).
  const SETTINGS_PARENT: Record<string, string> = { history: 'agent-connection', problems: 'about', licenses: 'about', 'password-entry': 'password-provider' };
  const back = definition.back;
  definition.back = (state: Bag, api: Bag) => {
    if (!state.sheet && SETTINGS_PARENT[state.page]) { api.set({ page: SETTINGS_PARENT[state.page] }); return true; }
    if (!state.sheet && PASSWORD_PAGES.includes(state.page)) leavePasswordManager();
    return back ? back(state, api) : false;
  };
  definition.render = (state: Bag, api: Bag) => {
    const current = settingsPage(state.page, developerTools);
    // The reference renderer supplies the page frame, the agent name and its sheets. Its prototype
    // pages are not used: every page below is built here from real device and agent state.
    const out = render({ ...state, page: current === 'developer' ? 'developer' : null, acct: null, adding: false, sheet: ['conn', 'voice', 'wipe', 'wifiPw', 'forget'].includes(state.sheet?.kind) ? null : state.sheet }, api);
    const native = Capacitor.isNativePlatform();
    const connection = connectionController.getSnapshot();
    const account = connection.cloudAccount;
    const serviceName = cloudServiceName(connectionController.getCloudClient()?.client.environment ?? account?.environment ?? connection.signIn?.environment ?? 'production');
    const manage = (page: string) => () => void device.openSettings({ page }).then(opened => { const notice = broaderPageNotice(page, opened); if (notice) api.toast(notice); }, () => api.toast('This Android settings page is unavailable.'));
    const info = (label: string, val: string): Bag => ({ id: `info:${label}`, kInfo: true, label, val, hasVal: !!val, noAB: true });
    const row = (label: string, go: () => void, val = '', extra: Bag = {}): Bag => ({ id: `row:${label}`, kNav: true, label, lbl: label, val, hasVal: !!val, chev: true, noAB: true, go, ...extra });
    const toggle = (label: string, on: boolean, change: () => void, id = `toggle:${label}`): Bag => ({ id, kTog: true, label, aria: label, on, track: on ? 'background:var(--acc)' : 'background:var(--line)', kx: on ? 20 : 0, toggle: change });
    const log = (time: string, text: string, id = `log:${time}:${text}`): Bag => ({ id, kLog: true, time, text });
    const group = (rows: Bag[], cap = '', id = cap || String(rows[0]?.id ?? rows[0]?.label ?? 'empty')): Bag => ({
      id: `group:${id}`, css: 'background:var(--s2);padding:4px 0',
      rows: rows.map(value => ({ ...value, id: value.id ?? `row:${value.aria ?? value.label ?? value.time ?? ''}` })),
      ...(cap ? { cap, hasCap: true } : {}),
    });
    const back = () => api.set({ page: null });
    const subpage = (title: string, groups: Bag[], options: Bag = {}): Bag => ({ isTop: false, notTop: true, cls: 'enter', z: options.z ?? 4, title, hasTitle: true, backLabel: options.backLabel ?? 'Back to Settings', back: options.back ?? back, hero: {}, groups: groups.filter(g => g.rows.length) });
    const day = (at: number) => new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const go = (page: string) => () => api.set({ page });
    const top = out.stack[0];
    const stack: Bag[] = [top];

    // ---- Account
    const plan = connectionController.residentPlanSettings();
    const cloudPage = plan ? cloudAccountPage({ plan, busy: connection.busy, message: connection.message || '', serviceName, day, confirm: text => window.confirm(text),
      actions: { cancel: () => connectionController.cancel(), approve: () => void connectionController.residentCloudLogin(), redeem: () => connectionController.openPlan({codeEntry:true}), manage: () => void connectionController.residentManagePlan(),
        signOut: () => void connectionController.cloudSignOut(), recheck: () => connectionController.recheckPlanOnReturn(), signIn: () => void connectionController.residentCloudLogin() } }) : null;
    const cloudRow = cloudPage ? row(serviceName, go('account'), plan!.keyExpiring ? 'Sign-in expiring' : plan!.signedIn ? plan!.plan : 'Sign in')
      : row(serviceName, () => connectionController.openCloudAccount(), account ? 'Signed in' : 'Sign in');
    cloudRow.id = 'cloud-account';
    const googleCount = gmailAccounts.filter(a => a.connected && a.connectionId).length;
    const googleRow = row('Google', () => googleConnectionController.open(), googleCount ? `${googleCount} account${googleCount === 1 ? '' : 's'}` : connectionController.getCloudClient() ? 'Connect' : '');

    // ---- Assistant
    // An unreadable preference document fails closed: switches show off and change nothing.
    const preferences = cachedDevicePreferences(), preferenceUnavailable = 'Preference unavailable. Reopen Settings to try again.';
    const askRow = toggle('Ask before acting', preferences?.askBeforeAgentActions === true, async () => {
      const saved = cachedDevicePreferences(); if (!saved) { api.toast(preferenceUnavailable); return; }
      try { await editDevicePreferences(value => { value.askBeforeAgentActions = !saved.askBeforeAgentActions; }); changed(); } catch { api.toast('Could not save. Try again.'); }
    });
    const agentStatus = connection.session ? connection.kind === 'resident' ? 'Running' : testMocksEnabled ? 'Remote agent' : 'Unsupported connection' : connection.residentRecoveryReason ? 'Needs review' : connection.busy || connection.kind !== 'recovering' ? 'Starting…' : 'Not running';
    const agentRow = row('Agent', native && !testMocksEnabled ? go('agent-connection') : () => connectionController.open(), native && !testMocksEnabled ? agentStatus : connection.session ? connection.name : 'Not connected');
    const digestsRow = row('Scheduled digests', () => window.dispatchEvent(new Event('alpha:hosted-digests')));
    const listeningRow = listener.available ? row('Listening', go('listening'), listenerBusy ? 'Updating…' : listener.label) : null;
    const listeningWarning = wakeListeningStopUnconfirmed()
      ? info('Wake listening', 'Could not confirm listening is off. Turn it off in Android settings.') : null;

    // ---- Apps
    const photoScope = photoAccess?.scope === 'full' ? 'All' : photoAccess?.scope === 'selected' || photoAccess?.scope === 'partial' ? 'Selected' : photoAccess?.scope === 'denied' ? 'Not allowed' : '';
    const photosRow = native ? row('Photos access', async () => {
      if (photoAccessBusy) return; photoAccessBusy = true; changed(); const instance = owner;
      try { const access = await photoLibrary.requestLibraryAccess(); if (owner === instance) photoAccess = access; }
      catch { if (owner === instance) api.toast('Photo access could not open.'); }
      finally { photoAccessBusy = false; if (owner === instance) changed(); }
    }, photoAccessBusy ? 'Opening…' : photoScope) : null;
    const mailImagesRow = toggle('Load images in email', preferences?.autoLoadMailImages === true, async () => {
      const saved = cachedDevicePreferences(); if (!saved) { api.toast(preferenceUnavailable); return; }
      if (mailImagesSaving) return;
      mailImagesSaving = true; changed();
      try { await editDevicePreferences(value => { value.autoLoadMailImages = !saved.autoLoadMailImages; }); }
      catch { api.toast('Could not save. Try again.'); }
      finally { mailImagesSaving = false; changed(); }
    });
    const home = roles?.home, canRequestHome = native && launcher === true && !!home && home.available && !home.held;
    const homeRow = canRequestHome ? row('Make Alpha your Home app', () => void requestHome(api), roleBusy ? 'Waiting for Android…' : '') : null;

    // ---- Appearance
    const stored = readAppearanceChoice(), choice: AppearanceChoice = resolveAppearance(stored) === api.theme ? stored : api.theme === 'dark' ? 'dark' : 'light';
    const themeRow: Bag = { kSeg: true, label: 'Theme', noAB: true, opts: ([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']] as Array<[AppearanceChoice, string]>).map(([value, label]) => {
      const on = value === choice;
      return { label, on, aria: `Theme: ${label}`, css: on ? 'background:var(--acc);color:#fff' : 'color:var(--mut)', pick: () => {
        const theme = resolveAppearance(value);
        try { localStorage.setItem(APPEARANCE_KEY, value); } catch { api.toast('Theme changed for this session, but could not be saved.'); }
        // The choice is already saved, so the theme change carries the storage marker.
        owner?.setState({ theme, appearanceStorageRead: { theme } });
      } };
    }) };
    const scale = facts.textScalePercent;
    const textRow: Bag | null = (native || browserDevProfile) && Number.isInteger(scale) ? { kSlider: true, noAB: true, label: 'Text size', valueLabel: `${scale}%`, v: scale <= 100 ? (scale - 75) * 2 : scale - 50, set: (event: Event) => {
      const value = Number((event.target as HTMLInputElement).value), requested = Math.round(value <= 50 ? 75 + value / 2 : value + 50), token = ++scaleGeneration, instance = owner;
      ++generation; void device.setTextScale({ percent: requested }).then(result => { if (owner === instance && token === scaleGeneration) { facts = { ...facts, ...result }; instance?.vset('settings', { nativeReadAt: Date.now() }); } }).catch(() => { if (owner === instance && token === scaleGeneration) api.toast('Text size could not be saved.'); });
    } } : null;

    // ---- Notifications
    const browserNotifications = delivery.scope === 'browser';
    const deliveryValue = typeof delivery.appEnabled !== 'boolean' ? '' : !delivery.appEnabled || !delivery.permissionGranted ? 'Off' : delivery.channels?.some((c: Bag) => c.blocked || c.groupBlocked) ? 'Some off' : 'On';
    const notificationsRow = native ? row('Notifications', manage('notifications'), deliveryValue)
      : row(browserNotifications ? 'In-app alerts' : 'Notifications', () => void notifications.openAppSettings().then(() => refresh(), () => api.toast('Notification settings are unavailable.')), deliveryValue);
    const crossAvailable = (native || devSurfacesEnabled) && !!cross.revision;
    const crossValue = typeof cross.accessGranted !== 'boolean' ? '' : !cross.enabled ? 'Off' : cross.paused ? 'Paused' : !cross.accessGranted ? 'Needs access' : `${(cross.apps || []).length} app${(cross.apps || []).length === 1 ? '' : 's'}`;
    const crossRow = crossAvailable ? row('Notifications from other apps', go('cross'), crossValue) : null;

    // ---- Privacy and system
    const permissionsValue = permissionSummary(facts.permissions);
    const permissionsRow = native ? row('App permissions', manage('privacy'), permissionsValue) : null;
    const missing = native ? Object.values(facts.permissions || {}).some(value => value === false) || delivery.permissionGranted === false
      : Object.values(facts.permissionStates || {}).some(value => value === 'prompt' || value === 'denied');
    const setupRow = api.reopenStartupAccess && missing ? row('Finish setup', api.reopenStartupAccess) : null;
    const androidRow = native && launcher === true ? row('Android settings', manage('system')) : null;
    const aboutRow = row('About', () => { api.set({ page: 'about' }); void refresh(); }, versionLabel(facts.appVersion || buildVersion, facts.appVersionCode));
    const developerRow = developerTools ? row('Developer', go('developer')) : null;
    const resetRow = native ? row('Reset Alpha data', async () => {
      api.toast((await reviewDataReset(registerPlugin<DataResetPlugin>('AlphaReset'))).message);
    }, '', { labCss: 'color:var(--fg);font-weight:600' }) : null;
    const present = (rows: Array<Bag | null>) => rows.filter((value): value is Bag => !!value);
    top.groups = [
      group([cloudRow, googleRow], 'Account'),
      group(present([askRow, agentRow, row('AI provider', () => connectionController.openProviderSettings(), connection.providerStatus?.selected && connection.providerStatus.provider === 'cerebras' ? 'Own API keys' : 'Cloud'), listeningRow, listeningWarning, digestsRow]), 'Assistant'),
      group(present([row('Calendars', go('calendar')), native || browserDevProfile ? row('Passwords', go('password-provider')) : null, photosRow, mailImagesRow, homeRow]), 'Apps'),
      group(present([themeRow, textRow]), 'Appearance'),
      group(present([notificationsRow, crossRow]), 'Notifications'),
      group(present([permissionsRow, setupRow]), 'Privacy'),
      group(present([androidRow, aboutRow, developerRow]), '', 'system'),
      group(present([resetRow]), '', 'reset'),
      ...(developerTools ? [group([row('Try mock mode', () => connectionController.mock())], '', 'development')] : []),
      ...(developerTools && !native && recovery.length ? [group(recovery.map(name => row(recoveryActions[name].label, () => recoveryActions[name].open(), '', { id: `recovery:${name}` })), 'Saved data needs recovery')] : []),
    ].filter(g => g.rows.length);

    // ---- Pages
    if (current === 'account' && cloudPage && plan) {
      const rows = [info(cloudPage.status, cloudPage.detail)];
      if(plan.allowance)rows.push(info('Plan allowance',plan.allowance));
      if(plan.limit)rows.push(info('AI requests',plan.limit));
      stack.push(subpage(serviceName, [group(rows, '', 'account-status'), group(cloudPage.actions.map(action => row(action.label, action.go, '', action.danger ? { labCss: 'color:var(--fg);font-weight:600' } : {})), '', 'account-actions')]));
    }
    if ((current === 'agent-connection' || current === 'history') && native && !testMocksEnabled) {
      const rows: Bag[] = [info(connection.session ? connection.kind === 'resident' ? 'Running on this device' : testMocksEnabled ? 'Remote agent' : 'Unsupported connection' : agentStatus, connection.residentInference === 'direct' ? 'AI: Cerebras · own API keys' : connection.residentInference === 'cloud' ? `AI: ${serviceName}` : connection.residentInference === 'unknown' ? 'AI status unconfirmed' : connection.cloudAccount && !connection.session && connection.kind === 'starting' && !connection.residentRecoveryReason ? 'AI starting…' : connection.cloudAccount ? 'AI unavailable' : 'Sign in for AI')];
      if (connection.error) rows.push(log('Problem', connection.error));
      const actions: Bag[] = [];
      if (connection.busy) { if (connection.residentRecovery?.step !== 'archiving') actions.push(row('Cancel', () => connectionController.cancel())); }
      else if (connection.residentRecoveryReason && !connection.session) {
        const recoveryState = connection.residentRecovery;
        if (connection.residentRecoveryReason === 'ipc-recovery-retention-limit' && recoveryState?.step === 'review') {
          rows.push(log('Review', `Alpha will keep ${recoveryState.review.retainedCount} old startup records, then restart your agent. Notes, chats and sign-in stay unchanged.`));
          actions.push(row('Keep records and restart', () => void connectionController.confirmRecovery()), row('Cancel', () => connectionController.cancelRecoveryReview()));
        } else if (connection.residentRecoveryReason === 'ipc-recovery-retention-limit') {
          if (recoveryState?.step === 'unavailable') rows.push(log('Recovery', 'Could not be checked. Your records were kept.'));
          if (recoveryState?.step === 'partial') rows.push(log('Recovery', 'Did not finish. Your records were kept.'));
          actions.push(row('Review recovery', () => void connectionController.reviewRecovery()));
        }
      } else actions.push(row(connection.session ? 'Restart agent' : 'Start agent', () => void connectionController.startLocal()));
      if (connection.session && !connection.busy) actions.push(row('New conversation', () => void connectionController.newConversation()), row('Earlier conversations', () => { api.set({ page: 'history' }); void connectionController.listHistory(); }));
      const review: Bag[] = [];
      if (connection.session && connection.phoneActionsAvailable) {
        for (const item of connection.actionHistory) if (['pending', 'executing', 'reconciliation_required'].includes(item.state)) {
          review.push(log(item.title, item.outcome + (item.timestamp ? ` · ${item.timestamp}` : ''), `action:${item.id}:status`));
          if (!connection.busy) {
            if (item.state === 'pending') review.push(row('Reject', () => void connectionController.rejectAction(item.id), '', { id: `action:${item.id}:reject` }));
            else review.push(row('It happened', () => void connectionController.reconcileAction(item.id, 'applied'), '', { id: `action:${item.id}:applied` }), row('It did not happen', () => void connectionController.reconcileAction(item.id, 'not_applied'), '', { id: `action:${item.id}:not-applied` }));
          }
        }
        if (!connection.busy) review.push(row('Check recorded actions', () => void connectionController.actionHistory(true)));
      }
      stack.push(subpage('Agent', [group(rows, '', 'agent-status'), group(actions, '', 'agent-actions'), group(review, review.length > 1 ? 'Actions to confirm' : '', 'agent-review')]));
      if (current === 'history') {
        const history: Bag[] = connection.conversations.map((item: Bag) => row(item.title, () => void connectionController.restoreHistory(item.id), '', { id: `conversation:${item.id}` }));
        if (connection.historyError) history.push(log('Problem', connection.historyError), row('Try again', () => void connectionController.retrySavedHistory()));
        if (!history.length) history.push(info(connection.busy ? 'Loading…' : 'No earlier conversations', ''));
        stack.push(subpage('Earlier conversations', [group(history, '', 'conversations')], { z: 6, back: go('agent-connection'), backLabel: 'Back to Agent' }));
      }
    }
    if (current === 'listening' && listener.available) {
      const status = listener;
      stack.push(subpage('Listening', [group([info(listenerBusy ? 'Updating…' : status.label, '')]), group(present([
        status.listening || status.microphoneOpen ? row('Pause', () => void listenerAction(api, 'pause')) : null,
        status.consented && status.state !== 'OFF' ? row('Turn off', () => void listenerAction(api, 'turnOff')) : null,
        row('Listener settings', () => void openListenerSettings().then(opened => { if (!opened) api.toast('Listener settings are unavailable.'); })),
      ]))]));
    }
    // calendar-settings:begin
    if (current === 'calendar') {
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
      stack.push(subpage('Calendars', groups));
    }
    // calendar-settings:end
    if (PASSWORD_PAGES.includes(current || '')) {
      const helpers = { info, group, toast: (message: string) => api.toast(message), set: (patch: Bag) => api.set(patch), ic: api.ic || {} };
      const provider = facts.passwordProvider || {};
      const passwordAction = (label: string, kind: string, val = ''): Bag => row(label, async () => {
        if (passwordOpening) return; passwordOpening = true; const instance = owner; changed();
        try { const result = await device.openPasswordProvider({ action: kind }); if (result?.status !== 'opened') throw Error('Unconfirmed provider handoff'); if (owner === instance && result.destination !== 'development') api.toast(result.destination === 'system-settings' ? 'Opened Android settings. Search for passwords or autofill, then choose your provider.' : 'Opened provider setup. Complete or cancel there; no change is confirmed yet.'); }
        catch { if (owner === instance) api.toast('Password provider setup is unavailable. No provider change is confirmed.'); }
        finally { passwordOpening = false; if (owner === instance) { changed(); void refresh(); } }
      }, passwordOpening ? 'Opening…' : val);
      // The selection Android reports; a provider whose publisher is not verified is never named Proton Pass.
      const selection: Bag = { proton: provider.installation === 'installed' ? 'Proton Pass selected' : provider.installation === 'disabled' ? 'Proton Pass selected · app disabled' : 'Provider package selected · publisher not verified', other: 'Another provider selected', none: 'No provider selected', unknown: 'Selection unavailable' };
      const providerValue = provider.support === 'unavailable' ? 'Autofill unavailable for this device or user' : selection[provider.selection] || 'Selection unavailable';
      const others = browserDevProfile ? [passwordAction('Password provider', 'settings', provider.selection === 'proton' ? 'Development provider selected' : 'No provider selected'), provider.installation === 'installed' ? passwordAction('Open development vault', 'open') : passwordAction('Add development provider', 'install')]
        : native ? [passwordAction('Password provider', 'settings', providerValue), ...(provider.installation === 'installed' ? [passwordAction('Open Proton Pass', 'open')] : provider.installation === 'absent' ? [passwordAction('Get Proton Pass from Proton', 'install')] : [])] : [];
      // Alpha's own vault first; another provider stays available.
      stack.push(subpage('Passwords', [...passwordManagerGroups(helpers), group(others, 'Other providers')], { back: () => { leavePasswordManager(); back(); } }));
      const entry = current === 'password-entry' ? passwordEntryPage(helpers, () => api.set({ page: 'password-provider' })) : null;
      if (entry) stack.push(entry); else if (current === 'password-entry') queueMicrotask(() => api.set({ page: 'password-provider' }));
    } else leavePasswordManager();
    if (current === 'cross' && crossAvailable) {
      const busyRow = (label: string, act: () => void, val = ''): Bag => row(label, () => { if (!notificationBusy) act(); }, notificationBusy ? 'Working…' : val, { busy: notificationBusy });
      const run = async (task: () => Promise<void>) => { if (notificationBusy) return; notificationBusy = true; changed(); const instance = owner; try { await task(); if (owner === instance) await refresh(); } catch { if (owner === instance) api.toast('That change did not save. Try again.'); } finally { notificationBusy = false; if (owner === instance) changed(); } };
      const policy = (change: Bag) => void run(async () => { await notifications.setNotificationPolicy({ expectedRevision: cross.revision, ...change }); if (change.history === false) history = []; });
      const selected: Bag[] = cross.apps || [];
      const keep = (apps: Bag[]) => apps.map(({ packageName, preview }) => ({ packageName, preview }));
      const collect = toggle('Collect from selected apps', !!cross.enabled, () => {
        if (native && !cross.enabled && !window.confirm('Collect notifications from the apps you select? Android grants broad access; Alpha reads only the apps you choose.')) return;
        policy({ enabled: !cross.enabled });
      });
      const appRows: Bag[] = [];
      for (const app of selected) {
        appRows.push(toggle(app.available === false ? `${app.label} (changed)` : app.label, true, () => policy({ apps: keep(selected.filter(a => a.packageName !== app.packageName)) }), `notification-app:${app.packageName}:collect`));
        appRows.push(toggle(`Show previews: ${app.label}`, !!app.preview, () => {
          if (native && !app.preview && !window.confirm(`Show notification text from ${app.label} while unlocked? It is not stored or sent to your agent.`)) return;
          policy({ apps: selected.map(a => ({ packageName: a.packageName, preview: a.packageName === app.packageName ? !app.preview : a.preview })) });
        }, `notification-app:${app.packageName}:preview`));
      }
      for (const app of choices || []) if (!selected.some(a => a.packageName === app.packageName)) appRows.push(toggle(app.label, false, () => policy({ apps: [...keep(selected), { packageName: app.packageName, preview: false }] }), `notification-app:${app.packageName}:collect`));
      appRows.push(busyRow(choices ? 'Done adding apps' : 'Add apps', () => { if (choices) { choices = null; changed(); return; } void run(async () => { choices = (await notifications.notificationApps()).apps; }); }));
      const historyRows: Bag[] = [toggle('Keep history', !!cross.history, () => {
        if (native && !cross.history && !window.confirm('Keep up to 100 notification events for 24 hours on this phone? Only the app and time are saved, never the text.')) return;
        policy({ history: !cross.history });
      })];
      if (cross.history || history?.length) {
        if (history === null) historyRows.push(busyRow('Show history', () => { notificationBusy = true; const instance = owner; void notifications.notificationHistory().then(result => { if (owner === instance) history = result.items; }).catch(() => api.toast('History is unavailable.')).finally(() => { notificationBusy = false; changed(); }); }));
        else for (const [index, item] of history.entries()) historyRows.push(log(new Date(item.at).toLocaleString(), `${item.appLabel} · ${item.state}`, `notice:${item.id ?? `${item.packageName}:${item.at}:${item.state}:${index}`}`));
        historyRows.push(busyRow('Clear history', () => { if (window.confirm('Clear notification history?')) void run(async () => { await notifications.clearNotificationHistory(); history = []; }); }));
      }
      stack.push(subpage('Other apps', [
        group(present([collect, cross.paused ? busyRow('Resume collection', () => void run(async () => { if (window.confirm('Resume collecting from your selected apps?')) await notifications.resumeCrossApp({ expectedRevision: cross.revision }); })) : null])),
        group(appRows, 'Apps'), group(historyRows, 'History'),
        group([busyRow(native ? 'Notification access' : 'Development notification access', () => void run(async () => { await notifications.openNotificationAccess(); }), cross.accessGranted === false ? 'Off' : '')]),
      ]));
    }
    const problemCount = crashLog ? crashLog.entries.length : null;
    if (current === 'about' || current === 'problems' || current === 'licenses') {
      const update = native ? parseUpdateManifest(savedUpdate().manifest, {
        versionCode: facts.appVersionCode, launcher, signerSha256: facts.appSigner,
      }) : null;
      const updateRows: Bag[] = native ? [
        ...(update ? [{
          ...row(updateBusy === 'install' ? 'Downloading update…' : 'Install update',
            () => void updateAction('install', () => device.installUpdate({
              apkUrl: update.apkUrl, sha256: update.sha256,
              sizeBytes: update.sizeBytes, versionCode: update.versionCode,
            }).catch(() => { /* Keep the offer available for an explicit retry. */ })),
            update.versionName ? versionLabel(update.versionName, update.versionCode) : String(update.versionCode), { id: 'update-install' }),
          sub: update.notes, hasSub: !!update.notes, busy: !!updateBusy,
        }] : []),
        row(updateBusy === 'check' ? 'Checking for updates…' : 'Check for updates',
          () => void updateAction('check', () => checkForUpdate(true)), '', { id: 'update-check', busy: !!updateBusy }),
      ] : [];
      stack.push(subpage('About', [group([info('Alpha Phone', versionLabel(facts.appVersion || buildVersion, facts.appVersionCode))]), group(updateRows, '', 'about-updates'), group([
        row('Problem log', () => { api.set({ page: 'problems' }); void refresh(); void refreshResidentDiagnostics(); }, problemCount === null ? '' : problemCount ? String(problemCount) : 'None'),
        row('Export diagnostics', () => void exportDiagnostics(api), diagnosticsBusy ? 'Preparing…' : ''),
        row('Open source licenses', () => { api.set({ page: 'licenses' }); void loadLicenses(changed); }),
      ])]));
      const toAbout = { z: 6, back: go('about'), backLabel: 'Back to About' };
      if (current === 'problems') {
        const entries = crashLog ? [...crashLog.entries].reverse().map((entry, index) => { const line = describeCrashEntry(entry); return log(new Date(entry.at).toLocaleString(), `${line.title} · ${line.detail}`, `problem:${entry.at}:${entry.source}:${index}`); }) : [];
        stack.push(subpage('Problem log', [group(crashLog ? entries.length ? entries : [info('No problems recorded', '')] : [info('Problem log unavailable', '')]),
          group(crashLog?.entries.length ? [row('Clear problem log', () => void clearProblems(api), crashBusy ? 'Clearing…' : '', { labCss: 'color:var(--fg);font-weight:600' })] : [])], toAbout));
      }
      if (current === 'licenses') stack.push(subpage('Open source licenses', licenses.status === 'ready' ? licenses.items.map(item => group([info(item.name, `${item.version} · ${item.license}`), ...licenseFlagRows(item), ...(typeof item.source === 'string' && item.source ? [log('Source', item.source)] : []), ...(typeof item.text === 'string' && item.text ? [log('License', item.text)] : [])], '', `license:${item.name}:${item.version}:${item.source ?? ''}`))
        : [group([info(licenses.status === 'unavailable' ? 'License notices unavailable' : 'Loading…', '')])], toAbout));
    }
    if (current === 'developer') {
      const developer = out.stack.find((page: Bag) => page.title === 'Developer');
      if (developer) stack.push({ ...developer, groups: [group([info('App version', facts.appVersion || buildVersion), info('Agent memory', connection.session ? 'Usage not reported by agent' : 'Not connected')]), group([row('Android developer settings', manage('developer'))])] });
    }
    out.stack = stack;
    return out;
  };
}
