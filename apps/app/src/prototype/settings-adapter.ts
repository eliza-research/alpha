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
import { exportVoiceTiming } from '../runtime/voice-timing';
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
/** Only the install time Android recorded; Alpha has no update check, so it shows no update row. */
export function installedRows(updatedAt: unknown, format: (at: number) => string = at => new Date(at).toLocaleDateString()): Array<[string, string]> {
  return Number.isSafeInteger(updatedAt) && (updatedAt as number) > 0 ? [['Installed or last updated', format(updatedAt as number)]] : [];
}
/** Cloud QA profile facts replace prototype navigation, not device settings links. */
export function cloudPrivacyRow(label: string): [string, string] | null {
  if (label === 'Leaves this device') return ['Shared with Cloud', 'Messages and selected content when you use AI'];
  if (label === 'On-device model') return ['Voice', 'Recordings for transcription and text for playback, when used'];
  return null;
}
/** A stale or direct Developer selection cannot open the page in a product build. */
export function settingsPage(page: string | null | undefined, developerSurfaces: boolean): string | null | undefined {
  return page === 'developer' && !developerSurfaces ? null : page;
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
  let gmailAccounts: GmailAccount[] = [], gmailBusy = '', settingsApi: Bag | undefined;
  let roles: Record<string, RoleRow> | null = null, launcher: boolean | null = null, roleBusy = false;
  let crashLog: CrashLog | null = null, crashBusy = false, diagnosticsBusy = false;
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
      api.toast(next.home?.held ? 'Alpha Phone is your Home app' : 'Home app not changed');
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
    try { await clearCrashLog(); crashLog = await readCrashLog(); if (owner === instance) api.toast('Problem log cleared'); }
    catch { if (owner === instance) api.toast('The problem log could not be cleared.'); }
    finally { crashBusy = false; if (owner === instance) changed(); }
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
    initializeDevicePreferences(); void refresh(); void refreshCapabilities();
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
    this.deviceResume = DailyApps.addListener('appResumed', () => { void refresh(); void refreshCapabilities(); }).catch(() => null);
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
  definition.render = (state: Bag, api: Bag) => {
    settingsApi = api;
    const out = render({ ...state, page: settingsPage(state.page, developerTools), acct: null, adding: false, sheet: ['conn', 'voice', 'wipe', 'wifiPw', 'forget'].includes(state.sheet?.kind) ? null : state.sheet }, api);
    // Prototype personality values are mock-only until the agent reports them.
    out.persona = 'Voice and agent settings';
    const connection = connectionController.getSnapshot();
    const account = connection.cloudAccount;
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
    // Speech follows the explicit production runtime profile; developer routes stay separate.
    const speechRows = (): Bag[] => [info('Speech', connection.residentInference==='direct'?(connection.providerStatus?.voiceConfigured?'Cartesia · own API key':'Off · add a Cartesia key'):developmentCartesiaVoiceEnabled?'Cartesia · development':cloudRuntimeEnabled?`${serviceName} · Cartesia output (uses your plan)`:testMocksEnabled?`${serviceName} (counts toward your plan)`:'On this device'), ...(wakeListeningStopUnconfirmed() ? [note('Wake listening', 'Could not confirm listening is off. Turn it off in Android settings.')] : [])];
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
    const problemsRow = (): Bag => ({ kNav:true, label:'Problem log', lbl:'Problem log', val: problemCount === null ? 'Unavailable' : problemCount ? `${problemCount} recorded` : 'None recorded', hasVal:true, chev:true, noAB:true, go:()=>{ api.set({ page:'problems' }); void refresh(); void refreshInferenceFailure(); } });
    const diagnosticsRow = (): Bag => ({ kNav:true, label:'Export diagnostics', lbl: diagnosticsBusy ? 'Preparing diagnostics…' : 'Export diagnostics', chev:true, noAB:true, go:()=>void exportDiagnostics(api) });
    const licensesRow = (): Bag => ({ kNav:true, label:'Open source licenses', lbl:'Open source licenses', chev:true, noAB:true, go:()=>{ api.set({ page:'licenses' }); void loadLicenses(changed); } });
    const percent = typeof facts.batteryPercent === 'number' ? `${facts.batteryPercent}%` : 'Unavailable';
    const active = (key: string) => typeof facts[key] === 'boolean' ? facts[key] ? 'Active connection' : 'Not active' : 'Unavailable';
    // System switches as Android reported them (AlphaDevice.snapshot). Alpha cannot change any of
    // them; a switch Android did not answer for keeps its earlier wording and is never shown as off.
    const wifiValue = switchValue(facts.wifiEnabled, active('wifiActive'), { on: facts.wifiActive === true ? 'On · connected' : 'On' });
    const bluetoothValue = switchValue(facts.bluetoothEnabled, Capacitor.isNativePlatform() ? 'Manage in Android' : active('bluetoothActive'));
    const mobileValue = facts.airplaneMode === true ? 'Airplane mode on' : switchValue(facts.mobileDataEnabled, active('cellularActive'), { on: facts.cellularActive === true ? 'On · in use' : 'On' });
    const reported = (value: unknown) => switchValue(value, 'Not reported by Android');
    const interruptionLabels:Bag={all:'No DND suppression reported',priority:'Priority interruptions only',alarms:'Alarms only',none:'Interruptions suppressed',unknown:'Unavailable'};
    const browserNotifications = delivery.scope === 'browser';
    const topValues: Bag = {
      'Wi-Fi': wifiValue, 'Bluetooth': bluetoothValue, 'Mobile data': mobileValue,
      'Accounts': account ? `${serviceName} connected` : 'Not signed in', 'Connections': gmail,
      'Battery': percent, 'Models': target, 'About': facts.appVersion || 'Unavailable',
      'Notifications': typeof delivery.appEnabled !== 'boolean' ? 'Unavailable' : !delivery.appEnabled || !delivery.permissionGranted ? (browserNotifications ? 'In-app alerts off' : 'App notifications off') : delivery.channels?.some((c:Bag)=>c.blocked||c.groupBlocked) ? (browserNotifications ? 'Some in-app alerts off' : 'Some channels blocked') : (browserNotifications ? 'In-app alerts enabled' : 'App notifications allowed'),
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
          out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Calendar',hasTitle:true,backLabel:'Back to Settings',back:()=>api.set({page:null}),hero:{},groups});

        }
        // calendar-settings:end
        page.groups.push(group([{
          kTog:true,label:'Ask before agent actions',aria:'Ask before agent actions',hasSub:true,
          sub:'Off: carry out simple local requests. On: review them first. Sends, deletions and calendar or reminder changes still require review.',
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
        }
        page.groups.push(group([{kNav:true,label:'Scheduled digests',lbl:'Scheduled digests',chev:true,noAB:true,go:()=>window.dispatchEvent(new Event('alpha:hosted-digests'))}]));
        // Every Alpha Phone signs in to Eliza Cloud and holds a plan: account, plan and sign-in expiry.
        const plan=connectionController.residentPlanSettings();
        if(plan){
          const day=(at:number)=>new Date(at).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
          page.groups.push(group([{kNav:true,label:`${serviceName} account & plan`,lbl:`${serviceName} account & plan`,val:plan.keyExpiring?'Sign-in expiring':plan.plan,hasVal:true,chev:true,noAB:true,go:()=>api.set({page:'cloud-plan'})}]));
          if(state.page==='cloud-plan'){
            // Runtime location and Cloud inference are separate facts.
            const rows:Bag[]=[info('Account',plan.account??(plan.offline?`${serviceName} unreachable`:'Not signed in')),info('Plan',plan.plan),info('Agent execution',runtimeLocation),info('AI replies',plan.inference)];
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
              {kNav:true,label:'Sign out',lbl:`Sign out of ${serviceName}`,chev:true,noAB:true,go:()=>void connectionController.cloudSignOut()},
            ]:plan.offline?[{kNav:true,label:'Check plan again',lbl:'Check plan again',chev:true,noAB:true,go:()=>connectionController.recheckPlanOnReturn()}]
            :[{kNav:true,label:`Sign in with ${serviceName}`,lbl:`Sign in with ${serviceName}`,chev:true,noAB:true,go:()=>void connectionController.residentCloudLogin()}];
            out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:`${serviceName} account & plan`,hasTitle:true,backLabel:'Back to Settings',back:()=>api.set({page:null}),hero:{},groups:[group(rows),group(actions)]});
          }
        }
        page.groups.push(group([{kNav:true,label:'Agent connection',lbl:'Agent connection',val:connectionController.getSnapshot().name,hasVal:true,chev:true,noAB:true,go:()=>native&&!testMocksEnabled?api.set({page:'agent-connection'}):connectionController.open()},{kNav:true,label:'AI provider',lbl:'AI provider',val:connection.providerStatus?.selected&&connection.providerStatus.provider==='cerebras'?'Own API keys':'Cloud',hasVal:true,chev:true,noAB:true,go:()=>connectionController.openProviderSettings()}]));
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
          const agentRows=[info('Agent',connection.session?'Running on this device':connection.residentRecoveryReason?(connection.residentRecoveryReason==='ipc-recovery-retention-limit'?'Restart needed':'Needs attention'):connection.kind==='recovering'?'Not running':'Starting…'),info('AI',connection.residentInference==='cloud'?serviceName:!connection.cloudAccount?'Sign in required':!connection.session&&connection.kind==='starting'&&!connection.residentRecoveryReason?'Starting…':'Not available')];
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
          out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Agent connection',hasTitle:true,backLabel:'Back to Settings',back:()=>api.set({page:null}),hero:{},groups});
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
        if(state.page==='licenses')out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Open source licenses',hasTitle:true,backLabel:'Back to Settings',back:()=>api.set({page:null}),hero:{},groups:licenses.status==='ready'?licenses.items.map(item=>group([info(item.name,`${item.version} · ${item.license}`),...licenseFlagRows(item),...(typeof item.source==='string'&&item.source?[{kLog:true,time:'Source',text:item.source}]:[]),...(typeof item.text==='string'&&item.text?[{kLog:true,time:'License',text:item.text}]:[])])):[group([info(licenses.status==='unavailable'?'License notices unavailable':'Loading license notices…',licenses.status==='unavailable'?'Reinstall or update the app to restore them':'')])]});
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
        page.groups = [group([info(serviceName, cloudLabel), { kNav:true, label:'Manage Cloud account', lbl:'Manage Cloud account', chev:true, noAB:true, go:()=>connectionController.openCloudAccount() }, {kNav:true,label:'Google accounts',lbl:'Google accounts',chev:true,noAB:true,go:()=>googleConnectionController.open()}, nav('Device accounts in Android', 'accounts')])];
      } else if (page.title === 'Connections') {
        const connected = gmailAccounts.filter(a => a.connected && a.connectionId);
        page.groups = [group([{ kNav:true,label:'Manage Google accounts',lbl:'Manage Google accounts',chev:true,noAB:true,go:()=>googleConnectionController.open() },info('Gmail', gmail),
          ...connected.map(a => ({...info(a.label, ''), hasSub:true, sub:googleAccountAccessLabel(a)})),
          { kNav:true, label:'Open Inbox', lbl:'Open Inbox', chev:true, noAB:true, go:()=>api.open('inbox') },
          ...connected.map(a => { const label = `Disconnect Google account ${a.label}`; return { kNav:true, label, lbl:gmailBusy === a.connectionId ? 'Disconnecting…' : label, chev:true, noAB:true, go:()=>void disconnectGmail(a) }; }),
          { kNav:true, label:'Check Gmail connection', lbl:'Check Gmail connection', chev:true, noAB:true, go:()=>{ void refreshCapabilities(); } }]),group([{
            kTog:true,label:'Automatically load email images',aria:'Automatically load email images',
            hasSub:true,sub:mailImagesSaving?'Saving…':cachedDevicePreferences()?'Load remote images when you open an email.':'Image preference unavailable. Reopen Settings to try again.',
            on:cachedDevicePreferences()?.autoLoadMailImages===true,
            track:cachedDevicePreferences()?.autoLoadMailImages?'background:var(--acc)':'background:var(--line)',
            kx:cachedDevicePreferences()?.autoLoadMailImages?20:0,
            toggle:async()=>{
              const saved=cachedDevicePreferences();if(!saved||mailImagesSaving)return;
              mailImagesSaving=true;changed();
              try{await editDevicePreferences(state=>{state.autoLoadMailImages=!saved.autoLoadMailImages;});}
              catch{api.toast('Email image preference could not be saved. Try again.');}
              finally{mailImagesSaving=false;changed();}
            }
          }])];
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
        page.hero = { ...page.hero, big: facts.model || 'This phone', sub: facts.manufacturer || 'Device information unavailable' };
        page.groups = [group([
          info('Alpha Phone', versionLabel(facts.appVersion || buildVersion, facts.appVersionCode)), ...installedRows(facts.appUpdatedAt).map(([label, val]) => info(label, val)), ...(developerTools?[info('Update channel (development)',updateChannelCheckEnabled?'Read-only check on · never downloads or installs':'Off')]:[]), info('Android', facts.androidRelease || 'Unavailable'),
          info('Build', facts.build || 'Unavailable'), info('Security patch', facts.securityPatch || 'Unavailable'),
          info('Agent execution', runtimeLocation), info('Agent', target), info('Inference model', inferenceModel),
        ]), group([problemsRow(), diagnosticsRow()]), group([nav('Android device information', 'about')]), group([licensesRow()])];
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
        page.hero = { ...page.hero, big: target, sub: cloudRuntimeEnabled?`Conversation uses ${serviceName}. Speech uploads recordings and reply text to your Cloud account and uses your plan allowance.`:native?'Conversation uses the selected agent. Voice runs on this device.':developmentCartesiaVoiceEnabled?'Direct Cerebras and Cartesia · development':`Conversation uses the selected agent. Voice uses ${serviceName}.` };
        page.groups = [group([info('Connection', runtimeLocation), ...(native?[info('Inference provider',residentProvider?residentProvider.configured?(residentProvider.provider==='elizacloud'?serviceName:'Cerebras'):'Not configured':'Status unavailable')]:browserLocalAgentEnabled ? [info('Inference provider', inferenceProvider)] : []), info('Inference model', inferenceModel), info('Voice', cloudRuntimeEnabled?(account?`${serviceName} · Cartesia output`:'Cloud sign-in required'):native?'On this device':developmentCartesiaVoiceEnabled?'Cartesia · development':account ? serviceName : 'Sign-in required'), { kNav:true, label:`${serviceName} account`, lbl:`${serviceName} account`, chev:true, noAB:true, go:()=>connectionController.openCloudAccount() }])];
      } else if (page.title === 'Developer') {
        page.groups = [group([info('App version', facts.appVersion || buildVersion), info('Agent memory', connection.session?'Usage not reported by agent':'Not connected')]), group([problemsRow(), diagnosticsRow()]), group([nav('Android developer settings', 'developer')])];
      } else if (page.title === 'Notifications') {
        const custom = (label:string,go:()=>void):Bag=>({kNav:true,label,lbl:label,chev:true,noAB:true,busy:notificationBusy,hasVal:notificationBusy,val:'Working…',go:()=>{if(!notificationBusy)go();}});
        const run = async (task:()=>Promise<void>)=>{if(notificationBusy)return;notificationBusy=true;changed();const current=owner;try{await task();if(owner===current)await refresh();}catch{if(owner===current)api.toast('Notification settings changed or are unavailable. Refresh and try again.');}finally{notificationBusy=false;if(owner===current)changed();}};
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
        page.groups = [group([info(browserNotifications ? 'In-app alerts' : 'Alpha notifications', topValues.Notifications),info('Do Not Disturb',interruptionLabels[delivery.interruption]||'Unavailable'),Capacitor.isNativePlatform()?nav('Manage Alpha notifications', 'notifications'):custom(browserNotifications ? 'Manage in-app alerts' : 'Manage Alpha notifications',()=>void run(async()=>{await notifications.openAppSettings();}))]),
          ...((delivery.channels||[]).map((channel:Bag)=>group([info(channel.name,browserNotifications ? (channel.blocked||channel.groupBlocked||!delivery.appEnabled||!delivery.permissionGranted ? 'In-app alert off' : 'In-app alert enabled') : channel.blocked?'Channel blocked':channel.groupBlocked?'Channel group blocked':!delivery.appEnabled||!delivery.permissionGranted?'App notifications off':channel.importance<=2?'Silent channel':'Channel allowed'),{kNav:true,label:`Manage ${channel.name}`,lbl:`Manage ${channel.name}`,chev:true,noAB:true,go:()=>void notifications.openChannelSettings({id:channel.id}).catch(()=>api.toast('This notification channel is unavailable.'))}]))),...(crossRows.length ? [group(crossRows)] : [])];
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
      }
    }
    if(!Capacitor.isNativePlatform()) {
      for(const page of out.stack){
        if(page.title==='About')page.groups=[group([info('Alpha Phone',buildVersion),...(developerTools?[info('Update channel (development)',updateChannelCheckEnabled?'Read-only check on · never downloads or installs':'Off')]:[]),info('Agent execution',runtimeLocation),info('Agent',target),info('Inference model',inferenceModel),info('Storage','App storage')]),group([problemsRow(),diagnosticsRow()]),group([licensesRow()])];
      }
      const browserLabels=(value:any):any=>{if(typeof value==='string')return value.replaceAll('Manage brightness in Android','Brightness').replaceAll('Manage sound in Android','Sound settings').replaceAll('Manage in Android','App settings').replaceAll('Device accounts in Android','System accounts').replaceAll('Wi-Fi transport · network names stay in Android settings','Network names stay in system settings').replaceAll('in Android','in system settings').replaceAll('Android settings','System settings').replaceAll('Android Calendar','App calendar').replaceAll('Android device information','System information').replaceAll('Android developer settings','App development settings').replaceAll('On this phone','In this app').replaceAll('on this phone','in this app').replaceAll('Android access not granted','Development event access off').replaceAll('Waiting for Android listener','Waiting for local events').replaceAll('Selected apps connected','Selected development apps connected').replaceAll('Native setting unavailable','Managed by your system');if(Array.isArray(value))return value.map(browserLabels);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,browserLabels(v)]));return value;};
      return browserLabels(out);
    }
    return out;
  };
}
