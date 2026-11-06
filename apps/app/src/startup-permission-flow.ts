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
export const nativeStartupPermissionKeys = [...startupPermissionKeys, 'calendar', 'photos'] as const;
export type StartupPermissionKey = typeof startupPermissionKeys[number];
export type NativeStartupPermissionKey = typeof nativeStartupPermissionKeys[number];
export type StartupPermissionBridge = PermissionStepBridge;
export type StartupPermissionState = PermissionStepState;

/** A selected-photo grant is useful access, never described as the whole library. */
export function startupPhotoAccess(value: unknown) {
  const {granted, enabled, description} = photoLibraryAccess(value);
  return {granted, enabled, description};
}

/** Permission metadata only: approximate access is usable without claiming a precise fix. */
export function startupLocationAccess(value: unknown) {
  const {granted, enabled, description} = locationAccess(value);
  return {granted, enabled, description};
}

/** Installed names: the "Not now" dismissal and which OS prompts were already shown. */
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
