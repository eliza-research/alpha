import {
  createPermissionStepFlow,
  locationAccess,
  photoLibraryAccess,
  walkthroughMemory,
  type PermissionStepBridge,
  type PermissionStepState,
  type WalkthroughMemory,
  type WalkthroughStore,
} from '../../../.eliza/client-features/packages/ui/src/components/permissions/permission-walkthrough.ts';

/**
 * Alpha's binding of the shared startup permission walkthrough (packages/ui permissions
 * permission-walkthrough): the ordered keys this build installs and Alpha's installed storage
 * names. Explicit-tap prompts, one prompt per step, denial-to-settings, the photo and location
 * readers and the reopen entry are upstream.
 */
export const startupPermissionKeys = ['notifications', 'microphone', 'camera', 'location'] as const;
export const nativeStartupPermissionKeys = [...startupPermissionKeys, 'calendar', 'photos', 'files'] as const;
export type StartupPermissionKey = typeof startupPermissionKeys[number];
export type NativeStartupPermissionKey = typeof nativeStartupPermissionKeys[number];
export type StartupPermissionBridge = PermissionStepBridge;
export type StartupPermissionState = PermissionStepState;

/** A selected-photo grant is useful access, never described as the whole library. */
export function startupPhotoAccess(value: unknown) {
  const {granted, enabled, description} = photoLibraryAccess(value);
  return {granted, enabled, description};
}

/** Files all-files access (decision F1). The step opens Android's "All files access" page, which
 * returns to Alpha; access is read back then. Android 10 (API 29) has no such access: native asks
 * for READ_/WRITE_EXTERNAL_STORAGE (legacy storage) and reports them as this access. */
export function startupFilesAccess(value: unknown) {
  const row = value as {access?: unknown} | null;
  if (!row || typeof row.access !== 'string' || !['granted', 'denied', 'unsupported'].includes(row.access)) throw Error('Files access unavailable');
  const granted = row.access !== 'denied';
  return {granted, enabled: granted, requestable: true};
}

/** Permission metadata only: approximate access is usable without claiming a precise fix. */
export function startupLocationAccess(value: unknown) {
  const {granted, enabled, description} = locationAccess(value);
  return {granted, enabled, description};
}

/** Installed names: which OS prompts were already shown, and the Settings reopen event. */
export const STARTUP_PERMISSIONS_KEY = 'alpha.startup-permissions.v1';
export const STARTUP_PERMISSIONS_REOPEN = 'alpha:startup-permissions-reopen';
export type StartupPermissionMemory = WalkthroughMemory;
type Store = WalkthroughStore;
const defaultStore = (): Store | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const memory = (store: Store | null) => walkthroughMemory(STARTUP_PERMISSIONS_KEY, STARTUP_PERMISSIONS_REOPEN, () => store);

export function readStartupPermissionMemory(store: Store | null = defaultStore()): StartupPermissionMemory {
  return memory(store).read();
}
/** Best effort: unavailable storage keeps the in-memory behavior for this session. */
export function writeStartupPermissionMemory(patch: Partial<StartupPermissionMemory>, store: Store | null = defaultStore()) {
  return memory(store).write(patch);
}
/** Access setup opens once an account (or saved own Cerebras keys) is in place. A foreground
 * connection operation holds it back; a resident start or a background rebind does not. */
export function startupPermissionsActive(connection: {cloudAccount?: unknown; setupRevision?: number; providerStatus?: {selected?: boolean; provider?: string} | null; busy: boolean; residentStarting?: boolean; backgroundWork?: boolean; signIn?: unknown}) {
  return startupPermissionsActiveCore({
    account: !!connection.cloudAccount, setup: !!connection.setupRevision,
    providerSelected: connection.providerStatus?.selected === true, provider: connection.providerStatus?.provider ?? '',
    busy: connection.busy, residentStarting: !!connection.residentStarting, backgroundWork: !!connection.backgroundWork, signIn: !!connection.signIn,
  });
}
export type StartupConnectionFacts = {account: boolean; setup: boolean; providerSelected: boolean; provider: string; busy: boolean; residentStarting: boolean; backgroundWork: boolean; signIn: boolean};
/** The decision core of `startupPermissionsActive` over plain flags. */
export function startupPermissionsActiveCore(facts: StartupConnectionFacts): boolean {
  //@ verify
  //@ ensures \result ==> (facts.account || (facts.setup && facts.providerSelected && facts.provider === 'cerebras'))
  //@ ensures facts.signIn ==> !\result
  //@ ensures (facts.busy && !facts.residentStarting && !facts.backgroundWork) ==> !\result
  //@ ensures ((facts.account || (facts.setup && facts.providerSelected && facts.provider === 'cerebras')) && !facts.signIn && (facts.residentStarting || facts.backgroundWork)) ==> \result
  //@ ensures ((facts.account || (facts.setup && facts.providerSelected && facts.provider === 'cerebras')) && !facts.signIn && !facts.busy) ==> \result
  const ready = facts.account || (facts.setup && facts.providerSelected && facts.provider === 'cerebras');
  return ready && !(facts.busy && !facts.residentStarting && !facts.backgroundWork) && !facts.signIn;
}
/** Settings → "Set up Alpha access" calls this to show the panel again. Prompts already denied
 * stay on the Android-settings path; nothing is requested until the user taps. */
export function reopenStartupPermissions(store: Store | null = defaultStore()) {
  memory(store).reopen();
}

/** Requests occur only from an explicit tap; a denial never schedules another prompt, including
 * after a restart when `key` names the persisted attempt. */
export function createStartupPermissionFlow(bridge: StartupPermissionBridge, options: {key?: string; store?: Store | null} = {}) {
  const store = options.store === undefined ? defaultStore() : options.store;
  return createPermissionStepFlow(bridge, {attemptKey: options.key, memory: memory(store)});
}

/**
 * A returning sign-in on completed setup opens no Ready card. A connection error or an unconfirmed
 * revocation of the earlier sign-in that arrives after it opens the card, so the owner still sees it.
 */
export type LateReadyInput = {silent: boolean; error?: string; message?: string};
export function lateReadyNotice(input: LateReadyInput): boolean {
  //@ verify
  //@ ensures !input.silent ==> !\result
  //@ ensures (input.silent && input.error !== undefined && input.error.length > 0) ==> \result
  //@ ensures (input.silent && input.message !== undefined && input.message.includes('did not confirm revoking')) ==> \result
  //@ ensures (input.error === undefined && input.message === undefined) ==> !\result
  //@ ensures (input.error !== undefined && input.error.length === 0 && input.message === undefined) ==> !\result
  return input.silent && (!!input.error || !!input.message?.includes('did not confirm revoking'));
}
