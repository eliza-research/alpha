import { externalVoiceInvocationEnabled } from '../runtime/voice-entry-policy';
import {residentRecoveryCopy} from '../runtime/resident-recovery';
import {cloudServiceName} from '../runtime/cloud-protocol';
import {browserDevProfile as devProfileQuery,developerTools} from '../browser/dev-profile';
import {testMocksEnabled,devSurfacesEnabled,updateChannelCheckEnabled} from '../build-flags';
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
import { browserLocalAgentEnabled } from '../runtime/local-agent';
import type { GmailAccount } from '../runtime/cloud-protocol';
import { gmailGrantLabel } from '../runtime/gmail-grants';
import { clearCrashLog, describeCrashEntry, readCrashLog, recordCloudInferenceFailure, type CrashLog } from '../runtime/crash-log';
import { buildDiagnostics, diagnosticsFileName, diagnosticsText } from '../runtime/diagnostics-export';
import {planAdmission} from '../runtime/subscription-entitlement';
import { exportVoiceTiming, exportRealtimeVoiceTiming } from '../runtime/voice-timing';
import { readNativeVoiceTiming } from '../runtime/native-voice-turn';
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
/**
 * Settings pages (docs/ui-refresh-2026-11, tla/SettingsNav.tla). Pages that only repeated Android facts
 * or another flow are gone; a stale or direct route to one, and Developer outside the Developer gate,
 * opens the top level.
 */
export const SETTINGS_PAGES: readonly string[] = ['cloud-plan', 'agent-connection', 'agent-recovery-details', 'history', 'listening', 'calendar', 'calendar-google', 'password-provider', 'password-entry', 'cross', 'about', 'problems', 'licenses'];
export function settingsPage(page: string | null | undefined, developerSurfaces: boolean): string | null {
  if (page === 'developer') return developerSurfaces ? page : null;
  return typeof page === 'string' && SETTINGS_PAGES.includes(page) ? page : null;
}
/** Android Back pops one level, to the same parent as each page's own back control. */
export const SETTINGS_PARENT: Readonly<Record<string, string>> = { history: 'agent-connection', 'agent-recovery-details': 'agent-connection', problems: 'about', licenses: 'about', 'password-entry': 'password-provider' };
/** The plan facts ConnectionController.residentPlanSettings() reports. */
export type PlanFacts = { signedIn: boolean; offline: boolean; account: string | null; plan: string; status: string | null; endsAt: number | null; allowance: string | null; limit: string | null; keyExpiresAt: number | null; keyExpiring: boolean; inference: string };
export type CloudAction = { label: string; go: () => void; aria?: string };
/**
 * The Eliza Cloud page: the plan facts Cloud reports, then what can be done. Redeem code is always
 * offered while signed in (a membership code grants access without a recurring plan); Sign out asks first.
 */
export function cloudAccountPage(input: { plan: PlanFacts; busy: boolean; message: string; serviceName: string; runtimeLocation: string; day: (at: number) => string; confirm: (text: string) => boolean;
  actions: { cancel(): void; approve(): void; redeem(): void; manage(): void; signOut(): void; recheck(): void; signIn(): void } }): { rows: Array<{ label: string; value: string }>; actions: CloudAction[] } {
  const { plan, serviceName, day, actions } = input;
  const info = (label: string, value: string) => ({ label, value });
  // Runtime location and Cloud inference are separate facts.
  const rows = [info('Account', plan.account ?? (plan.offline ? `${serviceName} unreachable` : 'Not signed in')), info('Plan', plan.plan), info('Agent execution', input.runtimeLocation), info('AI replies', plan.inference)];
  if (plan.endsAt) rows.push(info(plan.status === 'active' || plan.status === 'trialing' || plan.status === 'past_due' ? 'Plan runs until' : 'Plan ended', day(plan.endsAt)));
  // Plan state, not a balance: the allowance Cloud reports and the latest limit with its retry time.
  if(plan.allowance)rows.push(info('Plan allowance',plan.allowance));
  if(plan.limit)rows.push(info('AI requests',plan.limit));
  if (plan.keyExpiresAt) rows.push(info(plan.keyExpiring ? 'Sign-in expires soon' : 'Sign-in expires', day(plan.keyExpiresAt)));
  if (input.busy) return { rows: [...rows, info('Status', input.message || 'Please wait…')], actions: [{ label: 'Cancel', go: actions.cancel }] };
  if (!plan.signedIn) return { rows, actions: [plan.offline ? { label: 'Check plan again', go: actions.recheck } : { label: `Sign in with ${serviceName}`, go: actions.signIn }] };
  return { rows, actions: [
    ...(plan.keyExpiring ? [{ label: 'Approve this phone again', go: actions.approve }] : []),
    { label: 'Redeem code', go: actions.redeem },
    { label: 'Manage plan', go: actions.manage },
    { label: 'Sign out', aria: `Sign out of ${serviceName}`, go: () => { if (input.confirm(`Sign out of ${serviceName}? AI replies stop until you sign in again. Your notes and chats stay on this phone.`)) actions.signOut(); } },
  ] };
}
/** The short value beside "App permissions": how many of Alpha's runtime grants Android reports off. */
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
  async function refreshInferenceFailure(){
    inferenceAbort?.abort();const abort=inferenceAbort=new AbortController(),instance=owner;
    const timer=setTimeout(()=>abort.abort(),10000);
    try{
      const failure=await connectionController.readCloudInferenceFailure(abort.signal);
      if(abort.signal.aborted||owner!==instance||inferenceAbort!==abort)return;
      if(recordCloudInferenceFailure(failure)){const problems=await readCrashLog();if(!abort.signal.aborted&&owner===instance&&inferenceAbort===abort){crashLog=problems;changed();}}
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
      await refreshInferenceFailure();
      const [buildFacts, problems, roleState, nativeTiming] = await Promise.allSettled([native ? device.diagnosticsFacts() : Promise.resolve({}), readCrashLog(), native ? system.getStatus() : Promise.resolve({ roles: [] }), readNativeVoiceTiming()]);
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
        voiceTiming: (() => { try { return JSON.parse(exportVoiceTiming()); } catch { return null; } })(),
        // Native audio-clock voice latency (issue #395): timings, turn ids and hashes only.
        nativeVoiceTiming: nativeTiming.status === 'fulfilled' ? nativeTiming.value : null,
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
  const back = definition.back;
  definition.back = (state: Bag, api: Bag) => {
    const parent = state.sheet ? undefined : SETTINGS_PARENT[state.page];
    if (parent) { api.set({ page: parent }); return true; }
    return back ? back(state, api) : false;
  };
  definition.render = (state: Bag, api: Bag) => {
    const current = settingsPage(state.page, developerTools);
    // The reference renderer supplies the page frame, the agent name and its sheets. Its prototype pages
    // are not used: every page below is built from real device and agent state (docs/ui-refresh-2026-11).
    const out = render({ ...state, page: current === 'developer' ? 'developer' : null, acct: null, adding: false, sheet: ['conn', 'voice', 'wipe', 'wifiPw', 'forget'].includes(state.sheet?.kind) ? null : state.sheet }, api);
    const native = Capacitor.isNativePlatform();
    const connection = connectionController.getSnapshot();
    const account = connection.cloudAccount;
    const serviceName = cloudServiceName(connectionController.getCloudClient()?.client.environment ?? account?.environment ?? connection.signIn?.environment ?? 'production');
    const runtimeLocation=!connection.session?'Not connected':connection.kind==='resident'?(Capacitor.isNativePlatform()?'On this device':'On this computer · development'):testMocksEnabled?'Remote agent':'Unsupported connection';
    const manage = (page: string) => () => void device.openSettings({ page }).then(opened => { const notice = broaderPageNotice(page, opened); if (notice) api.toast(notice); }, () => api.toast('This Android settings page is unavailable.'));
    const info = (label: string, val: string): Bag => ({ kInfo: true, label, val, hasVal: !!val, noAB: true });
    const action = (label: string, go: () => void): Bag => ({ kNav:true, label, lbl:label, chev:true, noAB:true, go });
    /** A row is a label, optionally one short value at the right. */
    const row = (label: string, go: () => void, val = '', extra: Bag = {}): Bag => ({ kNav: true, label, lbl: label, val, hasVal: !!val, chev: true, noAB: true, go, ...extra });
    const toggle = (label: string, on: boolean, change: () => void): Bag => ({ kTog: true, label, aria: label, on, track: on ? 'background:var(--acc)' : 'background:var(--line)', kx: on ? 20 : 0, toggle: change });
    const log = (time: string, text: string): Bag => ({ kLog: true, time, text });
    const group = (rows: Bag[], cap = ''): Bag => ({ css: 'background:var(--s2);padding:4px 0', rows, ...(cap ? { cap, hasCap: true } : {}) });
    const present = (rows: Array<Bag | null | false | undefined>) => rows.filter((value): value is Bag => !!value);
    const subpage = (title: string, groups: Bag[], options: Bag = {}): Bag => ({ isTop: false, notTop: true, cls: 'enter', z: options.z ?? 4, title, hasTitle: true, backLabel: options.backLabel ?? 'Back to Settings', back: options.back ?? (() => api.set({ page: null })), hero: {}, groups: groups.filter(g => g.rows.length) });
    const go = (page: string) => () => api.set({ page });
    const developer = current === 'developer' ? out.stack.find((page: Bag) => page.title === 'Developer') : null;
    const top = out.stack[0], page = top;
    out.stack = [top];

    // Account
    const plan = connectionController.residentPlanSettings();
    const day = (at: number) => new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const cloudRow = plan ? row(serviceName, go('cloud-plan'), plan.keyExpiring ? 'Sign-in expiring' : plan.signedIn ? plan.plan : plan.offline ? 'Offline' : 'Sign in')
      : row(serviceName, () => connectionController.openCloudAccount(), account ? 'Signed in' : 'Sign in');
    const googleCount = gmailAccounts.filter(a => a.connected && a.connectionId).length;
    const googleRow = row('Google', () => googleConnectionController.open(), googleCount ? `${googleCount} account${googleCount === 1 ? '' : 's'}` : connectionController.getCloudClient() ? 'Connect' : '');

    // Assistant. An unreadable preference document fails closed: switches show off and change nothing.
    const preferences = cachedDevicePreferences(), preferenceUnavailable = 'Preference unavailable. Reopen Settings to try again.';
    const askRow = toggle('Ask before acting', preferences?.askBeforeAgentActions === true, async () => {
      const saved = cachedDevicePreferences(); if (!saved) { api.toast(preferenceUnavailable); return; }
      try { await editDevicePreferences(value => { value.askBeforeAgentActions = !saved.askBeforeAgentActions; }); changed(); } catch { api.toast('Could not save action preference. Try again.'); }
    });
    const agentStatus = connection.session ? 'Running' : connection.residentRecoveryReason ? 'Needs attention' : connection.kind === 'recovering' && !connection.busy ? 'Not running' : 'Starting…';
    const agentRow = row('Agent connection', native && !testMocksEnabled ? go('agent-connection') : () => connectionController.open(), native && !testMocksEnabled ? agentStatus : connection.name);
    const aiRow = row('AI', () => connectionController.openProviderSettings(), connection.providerStatus?.selected && connection.providerStatus.provider === 'cerebras' ? 'Own API keys' : connection.providerStatusError ? 'Status unavailable' : 'Cloud');
    const listeningRow = externalVoiceInvocationEnabled && listener.available ? row('Listening', go('listening'), listenerBusy ? 'Updating…' : listener.label) : null;
    // A failed stop of an earlier wake listener stays visible: hiding the entry never proves capture stopped.
    const wakeRow = wakeListeningStopUnconfirmed() ? info('Wake listening', 'Could not confirm listening is off. Turn it off in Android settings.') : null;
    const digestsRow = {kNav:true,label:'Scheduled digests',lbl:'Scheduled digests',chev:true,noAB:true,go:()=>window.dispatchEvent(new Event('alpha:hosted-digests'))};

    // Apps
    const photoScope = photoAccess?.scope === 'full' ? 'All' : photoAccess?.scope === 'selected' || photoAccess?.scope === 'partial' ? 'Selected' : photoAccess?.scope === 'denied' ? 'Not allowed' : '';
    const photosRow = native ? row('Photos access', async () => {
      if (photoAccessBusy) return; photoAccessBusy = true; changed(); const instance = owner;
      try { const access = await photoLibrary.requestLibraryAccess(); if (owner === instance) photoAccess = access; }
      catch { if (owner === instance) api.toast('Photo access could not open. Review it in Android settings.'); }
      finally { photoAccessBusy = false; if (owner === instance) changed(); }
    }, photoAccessBusy ? 'Opening…' : photoScope, { busy: photoAccessBusy }) : null;
    const mailImagesRow = toggle('Load images in email', preferences?.autoLoadMailImages === true, async () => {
      const saved = cachedDevicePreferences(); if (!saved) { api.toast(preferenceUnavailable); return; }
      if (mailImagesSaving) return;
      mailImagesSaving = true; changed();
      try { await editDevicePreferences(value => { value.autoLoadMailImages = !saved.autoLoadMailImages; }); }
      catch { api.toast('Email image preference could not be saved. Try again.'); }
      finally { mailImagesSaving = false; changed(); }
    });
    const home = roles?.home, canRequestHome = native && launcher === true && !!home && home.available && !home.held;
    const homeRow = canRequestHome ? row('Make Alpha your Home app', () => void requestHome(api), roleBusy ? 'Waiting for Android…' : '') : null;

    // Appearance. A voice command or a ?theme preview can draw an explicit theme the saved choice does not.
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
    const textRow: Bag | null = Number.isInteger(scale) ? { kSlider: true, noAB: true, label: 'Text size', valueLabel: `${scale}%`, v: scale <= 100 ? (scale - 75) * 2 : scale - 50, set: (event: Event) => {
      const value = Number((event.target as HTMLInputElement).value), requested = Math.round(value <= 50 ? 75 + value / 2 : value + 50), token = ++scaleGeneration, instance = owner;
      ++generation; void device.setTextScale({ percent: requested }).then(result => { if (owner === instance && token === scaleGeneration) { facts = { ...facts, ...result }; instance?.vset('settings', { nativeReadAt: Date.now() }); } }).catch(() => { if (owner === instance && token === scaleGeneration) api.toast('Text size could not be saved.'); });
    } } : null;

    // Notifications. Android's page for Alpha lists every channel; the browser opens its in-app alert settings.
    const deliveryValue = typeof delivery.appEnabled !== 'boolean' ? '' : !delivery.appEnabled || !delivery.permissionGranted ? 'Off' : delivery.channels?.some((c: Bag) => c.blocked || c.groupBlocked) ? 'Some off' : 'On';
    const notificationsRow = native ? row('Notifications', manage('notifications'), deliveryValue)
      : row('Notifications', () => void notifications.openAppSettings().then(() => refresh(), () => api.toast('Notification settings are unavailable.')), deliveryValue);
    const crossAvailable = (native || devSurfacesEnabled) && !!cross.revision;
    const selectedApps: Bag[] = cross.apps || [];
    const crossValue = typeof cross.accessGranted !== 'boolean' ? '' : !cross.enabled ? 'Off' : cross.paused ? 'Paused' : !cross.accessGranted ? 'Needs access' : `${selectedApps.length} app${selectedApps.length === 1 ? '' : 's'}`;
    const crossRow = crossAvailable ? row('Notifications from other apps', go('cross'), crossValue) : null;

    // Privacy. Finish setup only while a startup grant Android or the browser reports is still missing.
    const permissionsRow = native ? row('App permissions', manage('privacy'), permissionSummary(facts.permissions)) : null;
    const missing = native ? Object.values(facts.permissions || {}).some(value => value === false) || delivery.permissionGranted === false
      : Object.values(facts.permissionStates || {}).some(value => value === 'prompt' || value === 'denied');
    const setupRow = api.reopenStartupAccess && missing ? row('Finish setup', api.reopenStartupAccess) : null;

    // System. Install update appears only for the version the last manifest offers this install; no error or "up to date" claim.
    const androidRow = native && launcher === true ? row('Android settings', manage('system')) : null;
    const update = native ? parseUpdateManifest(savedUpdate().manifest, { versionCode: facts.appVersionCode, launcher, signerSha256: facts.appSigner }) : null;
    const installRow = update ? row(updateBusy === 'install' ? 'Downloading update…' : 'Install update', () => void updateAction('install', () => device.installUpdate({ apkUrl: update.apkUrl, sha256: update.sha256, sizeBytes: update.sizeBytes, versionCode: update.versionCode }).catch(() => { /* Quiet: the row stays and the next tap retries. */ })),
      update.versionName ? versionLabel(update.versionName, update.versionCode) : String(update.versionCode), { label: 'Install update', sub: update.notes, hasSub: !!update.notes, busy: !!updateBusy }) : null;
    const version = versionLabel(facts.appVersion || buildVersion, facts.appVersionCode);
    const aboutRow = row('About', () => { api.set({ page: 'about' }); void refresh(); }, version);
    const developerRow = developerTools ? row('Developer', go('developer')) : null;
    const resetRow = native ? row('Reset Alpha data', async () => {
      // Shared native review (@elizaos/capacitor-system/reset): only cancelled or unavailable reach here.
      api.toast((await reviewDataReset(registerPlugin<DataResetPlugin>('AlphaReset'))).message);
    }) : null;
    top.groups = [
      group([cloudRow, googleRow], 'Account'),
      group(present([askRow, agentRow, aiRow, listeningRow, wakeRow, digestsRow]), 'Assistant'),
      group(present([row('Calendars', go('calendar')), row('Passwords', go('password-provider')), photosRow, mailImagesRow, homeRow]), 'Apps'),
      group(present([themeRow, textRow]), 'Appearance'),
      group(present([notificationsRow, crossRow]), 'Notifications'),
      group(present([permissionsRow, setupRow]), 'Privacy'),
      group(present([androidRow, installRow, aboutRow, developerRow]), 'System'),
      group(present([resetRow])),
    ].filter(g => g.rows.length);
    if(developerTools)page.groups.push(group([{kNav:true,label:'Try mock mode',lbl:'Try mock mode',chev:true,noAB:true,go:()=>connectionController.mock()}]));
    if(developerTools&&recovery.length)page.groups.push(group([info('Saved data needs recovery','Back up before resetting'),...recovery.map(name=>({kNav:true,label:recoveryActions[name].label,lbl:recoveryActions[name].label,chev:true,noAB:true,go:()=>recoveryActions[name].open()}))]));

    // Eliza Cloud. Every Alpha Phone signs in to Eliza Cloud and holds a plan.
    if (current === 'cloud-plan' && plan) {
      const cloudPage = cloudAccountPage({ plan, busy: connection.busy, message: connection.message || '', serviceName, runtimeLocation, day, confirm: text => window.confirm(text),
        actions: { cancel: () => connectionController.cancel(), approve: () => void connectionController.residentCloudLogin(), redeem: () => connectionController.openPlan({ codeEntry: true }), manage: () => void connectionController.residentManagePlan(),
          signOut: () => void connectionController.cloudSignOut(), recheck: () => connectionController.recheckPlanOnReturn(), signIn: () => void connectionController.residentCloudLogin() } });
      out.stack.push(subpage(`${serviceName} account & plan`, [group(cloudPage.rows.map(fact => info(fact.label, fact.value))), group(cloudPage.actions.map(item => row(item.label, item.go, '', item.aria ? { lbl: item.aria } : {})))]));
    }

    // Agent connection. Raw recovery reason, stage and record count are developer data: the product keeps the plain status.
    if(native&&developerTools&&state.page==='agent-recovery-details'){
      const reason=connection.residentRecoveryReason,recovery=connection.residentRecovery;
      const rows:Bag[]=[info('Status',reason?residentRecoveryCopy(reason,recovery):connection.session?'Alpha is running.':'Restart status is unavailable.')];
      if(reason)rows.push(info('Reason',reason));
      if(recovery)rows.push(info('Stage',recovery.step));
      if(recovery?.step==='review')rows.push(info('Startup records to keep',String(recovery.review.retainedCount)));
      out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Restart details',hasTitle:true,backLabel:'Back to Agent connection',back:()=>api.set({page:'agent-connection'}),hero:{},groups:[group(rows)]});
    }
    if(native&&!testMocksEnabled&&(current==='agent-connection'||current==='history')){
      const agentRows=[info('Agent',connection.session?'Running on this device':connection.residentRecoveryReason?(connection.residentRecoveryReason==='ipc-recovery-retention-limit'?'Restart needed':'Needs attention'):connection.kind==='recovering'?'Not running':'Starting…'),info('AI',connection.residentInference==='direct'?'Cerebras · own API key':connection.residentInference==='cloud'?serviceName:!connection.cloudAccount&&connection.residentPlanNotice!=='offline'?'Sign in required':!connection.session&&connection.kind==='starting'&&!connection.residentRecoveryReason?'Starting…':'Not available')];
      if(connection.message)agentRows.push(info('Status',connection.message));
      if(connection.error)agentRows.push(log('Problem',connection.error));
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
      if(connection.session&&!connection.busy)groups.push(group([action('New conversation',()=>void connectionController.newConversation()),action('Earlier conversations',()=>{api.set({page:'history'});void connectionController.listHistory();})]));
      if(connection.session&&connection.phoneActionsAvailable){
        // Actions to confirm: a proposal to reject, or an action whose outcome only the owner can check.
        const review:Bag[]=[];
        for(const item of connection.actionHistory)if(['pending','executing','reconciliation_required'].includes(item.state)){
          review.push(log(item.title,item.outcome+(item.timestamp?` · ${item.timestamp}`:'')));
          if(!connection.busy){
            if(item.state==='pending')review.push(action('Reject proposal',()=>void connectionController.rejectAction(item.id)));
            else review.push(action('I verified it happened',()=>void connectionController.reconcileAction(item.id,'applied')),action('I verified it did not happen',()=>void connectionController.reconcileAction(item.id,'not_applied')));
          }
        }
        const refresh=connection.busy?[info('Phone action history','Please wait…')]:[action('Refresh actions',()=>void connectionController.actionHistory()),action('Sync recorded receipts',()=>void connectionController.actionHistory(true))];
        if(review.length)groups.push(group(review,'Actions to confirm'));
        groups.push(group(refresh));
      }
      out.stack.push(subpage('Agent connection',groups));
      if(current==='history'){
        const rows:Bag[]=connection.busy?[]:connection.conversations.map((item:Bag)=>action(`Restore conversation: ${item.title}`,()=>void connectionController.restoreHistory(item.id)));
        if(connection.historyError){rows.push(log('Problem',connection.historyError));if(!connection.busy)rows.push(action('Retry saved conversation',()=>void connectionController.retrySavedHistory()));}
        if(!rows.length)rows.push(info(connection.busy?'Loading…':'No earlier conversations',''));
        out.stack.push(subpage('Earlier conversations',[group(rows)],{z:6,back:go('agent-connection'),backLabel:'Back to Agent connection'}));
      }
    }

    // Listening: the AOSP image's always-on listener (#424). Turning listening on or resuming happens in
    // the listener's own consent screen, never here.
    if (current === 'listening' && externalVoiceInvocationEnabled && listener.available) {
      const status = listener;
      out.stack.push(subpage('Listening', [group([info(listenerBusy ? 'Updating…' : status.label, '')]), group(present([
        (status.listening || status.microphoneOpen) && action('Pause listening', () => void listenerAction(api, 'pause')),
        status.consented && status.state !== 'OFF' && action('Turn off listening', () => void listenerAction(api, 'turnOff')),
        action('Listening settings', () => void openListenerSettings().then(opened => { if (!opened) api.toast('The listener settings are unavailable.'); })),
      ]))]));
    }

    // calendar-settings:begin
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
      out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Calendars',hasTitle:true,backLabel:'Back to Settings',back:()=>api.set({page:null}),hero:{},groups});
    }
    // calendar-settings:end

    // Passwords: Alpha's own vault first; another provider stays available.
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
      out.stack.push(subpage('Passwords', [...passwordManagerGroups(helpers), group(others, 'Other password providers')], { back: () => { leavePasswordManager(); api.set({ page: null }); } }));
      const entry = current === 'password-entry' ? passwordEntryPage(helpers, () => api.set({ page: 'password-provider' })) : null;
      if (entry) out.stack.push(entry); else if (current === 'password-entry') queueMicrotask(() => api.set({ page: 'password-provider' }));
    } else leavePasswordManager();

    // Notifications from other apps: Alpha reads only the apps chosen here; previews and history are separate choices.
    if (current === 'cross' && crossAvailable) {
      const busyRow = (label: string, act: () => void, val = ''): Bag => row(label, () => { if (!notificationBusy) act(); }, notificationBusy ? 'Working…' : val, { busy: notificationBusy });
      const run = async (task: () => Promise<void>) => { if (notificationBusy) return; notificationBusy = true; changed(); const instance = owner; try { await task(); if (owner === instance) await refresh(); } catch { if (owner === instance) api.toast('Notification settings changed or are unavailable. Refresh and try again.'); } finally { notificationBusy = false; if (owner === instance) changed(); } };
      const policy = (change: Bag) => void run(async () => { await notifications.setNotificationPolicy({ expectedRevision: cross.revision, ...change }); if (change.history === false) history = []; });
      const keep = (apps: Bag[]) => apps.map(({ packageName, preview }) => ({ packageName, preview }));
      const collect = toggle('Collect from selected apps', !!cross.enabled, () => {
        if (native && !cross.enabled && !window.confirm('Collect notifications from the apps you select? Android grants broad access; Alpha reads only the apps you choose.')) return;
        policy({ enabled: !cross.enabled });
      });
      const appRows: Bag[] = [];
      for (const app of selectedApps) {
        appRows.push(toggle(app.available === false ? `${app.label} (changed)` : app.label, true, () => policy({ apps: keep(selectedApps.filter(a => a.packageName !== app.packageName)) })));
        appRows.push(toggle(`Show previews: ${app.label}`, !!app.preview, () => {
          if (native && !app.preview && !window.confirm(`Show notification text from ${app.label} while unlocked? It is not stored or sent to your agent.`)) return;
          policy({ apps: selectedApps.map(a => ({ packageName: a.packageName, preview: a.packageName === app.packageName ? !app.preview : a.preview })) });
        }));
      }
      for (const app of choices || []) if (!selectedApps.some(a => a.packageName === app.packageName)) appRows.push(toggle(app.label, false, () => policy({ apps: [...keep(selectedApps), { packageName: app.packageName, preview: false }] })));
      appRows.push(busyRow(choices ? 'Done adding apps' : 'Add apps', () => { if (choices) { choices = null; changed(); return; } void run(async () => { choices = (await notifications.notificationApps()).apps; }); }));
      const historyRows: Bag[] = [toggle('Keep history', !!cross.history, () => {
        if (native && !cross.history && !window.confirm('Keep up to 100 notification events for 24 hours on this phone? Only the app and time are saved, never the text.')) return;
        policy({ history: !cross.history });
      })];
      if (cross.history || history?.length) {
        if (history === null) historyRows.push(busyRow('Show history', () => { notificationBusy = true; const instance = owner; void notifications.notificationHistory().then(result => { if (owner === instance) history = result.items; }).catch(() => api.toast('Local notification history is unavailable.')).finally(() => { notificationBusy = false; changed(); }); }));
        else if (!history.length) historyRows.push(info('No events kept', ''));
        else for (const item of history) historyRows.push(log(new Date(item.at).toLocaleString(), `${item.appLabel} · ${item.state}`));
        historyRows.push(busyRow('Clear history', () => { if (window.confirm('Permanently clear local notification history?')) void run(async () => { await notifications.clearNotificationHistory(); history = []; }); }));
      }
      out.stack.push(subpage('Other apps', [
        group(present([collect, cross.paused && busyRow('Resume collection', () => void run(async () => { if (window.confirm('Resume collection of notifications from your selected apps?')) await notifications.resumeCrossApp({ expectedRevision: cross.revision }); }))])),
        group(appRows, 'Apps'), group(historyRows, 'History'),
        group([busyRow(native ? 'Notification access' : 'Development notification access', () => void run(async () => { await notifications.openNotificationAccess(); }), cross.accessGranted === false ? 'Off' : '')]),
      ]));
    }

    // About: the version, support diagnostics and licenses.
    const problemCount = crashLog ? crashLog.entries.length : null;
    if (current === 'about' || current === 'problems' || current === 'licenses') {
      out.stack.push(subpage('About', [
        group([info('Alpha Phone', version), ...installedRows(facts.appUpdatedAt).map(([label, val]) => info(label, val)), ...(developerTools?[info('Update channel (development)',updateChannelCheckEnabled?'Read-only check on · never downloads or installs':'Off')]:[])]),
        group([
          row('Problem log', () => { api.set({ page: 'problems' }); void refresh(); void refreshInferenceFailure(); }, problemCount === null ? '' : problemCount ? String(problemCount) : 'None'),
          row(diagnosticsBusy ? 'Preparing diagnostics…' : 'Export diagnostics', () => void exportDiagnostics(api), '', { label: 'Export diagnostics' }),
          row('Open source licenses', () => { api.set({ page: 'licenses' }); void loadLicenses(changed); }),
        ]),
        group(present([installRow, native && row(updateBusy === 'check' ? 'Checking for updates…' : 'Check for updates', () => void updateAction('check', () => checkForUpdate(true)), '', { label: 'Check for updates', busy: !!updateBusy })])),
      ]));
      const toAbout = { z: 6, back: go('about'), backLabel: 'Back to About' };
      if (current === 'problems') {
        const entries = crashLog ? [...crashLog.entries].reverse().map(entry => { const line = describeCrashEntry(entry); return log(new Date(entry.at).toLocaleString(), `${line.title} · ${line.detail}`); }) : [];
        out.stack.push(subpage('Problem log', [group(crashLog ? entries.length ? entries : [info('No problems recorded', '')] : [info('Problem log unavailable', '')]),
          group(crashLog?.entries.length ? [row(crashBusy ? 'Clearing…' : 'Clear problem log', () => void clearProblems(api), '', { label: 'Clear problem log' })] : [])], toAbout));
      }
      if (current === 'licenses') out.stack.push(subpage('Open source licenses', licenses.status === 'ready' ? licenses.items.map(item => group([info(item.name, `${item.version} · ${item.license}`), ...licenseFlagRows(item), ...(typeof item.source === 'string' && item.source ? [log('Source', item.source)] : []), ...(typeof item.text === 'string' && item.text ? [log('License', item.text)] : [])]))
        : [group([info(licenses.status === 'unavailable' ? 'License notices unavailable' : 'Loading license notices…', '')])], toAbout));
    }
    if (developer) out.stack.push({ ...developer, groups: [group([info('App version', facts.appVersion || buildVersion), info('Agent memory', connection.session ? 'Usage not reported by agent' : 'Not connected')]), group(present([native && row('Android developer settings', manage('developer'))]))] });
    return out;
  };
}
