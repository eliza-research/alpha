// spec/app/account/index.md, "Story: Have the agent running"; spec/app/account/session.md, "Story: Hold the account signed in"; spec/app/account/provider.md, "Story: See where my requests go"
import { Effect, Exit, type Layer, type ManagedRuntime } from "effect";
import { useSyncExternalStore } from "react";
import {
  AI_MODE_KEY,
  type AiMode,
  DEFAULT_LOCAL_MODEL_ID,
  LOCAL_MODEL_KEY,
  type LocalLlmCatalogSnapshot,
  type LocalLlmDownloadProgress,
  type LocalLlmDownloadResult,
  PINNED_LOCAL_MODELS,
  activateLocalModel,
  cancelLocalModelDownload,
  deleteLocalModel,
  downloadLocalModel,
  readLocalLlmCatalog,
  subscribeLocalLlmProgress,
  subscribeSharedPreferences,
  unloadLocalModel,
} from "../platform/index.vibe";
import { stamped, Time } from "../runtime/index.vibe";
import type { Resident } from "../runtime/ui.tsx";
import type { accountMachines } from "./account.vibe";
import {
  type AccountDetailsSnapshot,
  AccountShelf,
  emptyAccountDetailsSnapshot,
} from "./bridge.vibe";

/** Runtime type available to every Account UI component. */
export type AccountRuntime = ManagedRuntime.ManagedRuntime<Layer.Success<typeof accountMachines> | Resident, unknown>;

/** Reads the current time in whole Unix milliseconds from Alpha's Time service without throwing on cold runtimes. */
export function currentMillis(runtime: AccountRuntime): number {
  const result = runtime.runSyncExit(Time.use((time) => time.latest()));
  return Exit.isSuccess(result) ? result.value : 0;
}

/**
 * Wraps a generated `useMachine` hook so `can` checks evaluate at the account machines'
 * millisecond clock.
 */
export function useAccountTimed<M extends { readonly state: unknown; readonly can: (event: never, ...by: never[]) => boolean }>(
  runtime: AccountRuntime,
  use: (runtime: AccountRuntime) => M,
): M {
  const hook = use(runtime);
  if (hook.state === undefined) return hook;
  const nowMs = currentMillis(runtime);
  const check = hook.can as (event: unknown, ...args: unknown[]) => boolean;
  return {
    ...hook,
    can(event: unknown, ...args: unknown[]) {
      return check(stamped(event, nowMs), ...args);
    },
  };
}

interface ShelfStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly snapshot: () => AccountDetailsSnapshot;
}

const shelfStores = new WeakMap<AccountRuntime, ShelfStore>();

function shelfStoreFor(runtime: AccountRuntime): ShelfStore {
  let held = shelfStores.get(runtime);
  if (held !== undefined) return held;
  const listeners = new Set<() => void>();
  let current: AccountDetailsSnapshot = emptyAccountDetailsSnapshot;
  let unsubscribeService: (() => void) | undefined;
  let connecting = false;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const attach = (service: Effect.Success<typeof AccountShelf>) => {
    current = service.snapshot();
    unsubscribeService?.();
    unsubscribeService = service.subscribe(() => {
      current = service.snapshot();
      notify();
    });
    notify();
  };

  const syncService = runtime.runSyncExit(AccountShelf.use((service) => Effect.succeed(service)));
  if (Exit.isSuccess(syncService)) {
    attach(syncService.value);
  }

  const ensureConnected = () => {
    if (unsubscribeService !== undefined || connecting) return;
    connecting = true;
    void runtime.runPromise(AccountShelf.use((service) => Effect.succeed(service))).then(
      (service) => {
        connecting = false;
        attach(service);
      },
      () => {
        connecting = false;
      },
    );
  };

  held = {
    subscribe: (listener) => {
      listeners.add(listener);
      ensureConnected();
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => current,
  };
  shelfStores.set(runtime, held);
  return held;
}

/** Subscribes safely to non-machine display metadata held in AccountShelf without synchronous boot crashes. */
export function useAccountShelf(runtime: AccountRuntime): AccountDetailsSnapshot {
  const store = shelfStoreFor(runtime);
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}

/** Switches the persisted AI execution mode (`local`, `cloud`, or `own-key`) via AccountShelf. */
export function setAccountAiMode(runtime: AccountRuntime, mode: AiMode, localModel?: string): Promise<boolean> {
  return runtime.runPromise(AccountShelf.use((service) => service.setAiMode(mode, localModel))).catch(() => false);
}

/** Opens an external Cloud billing or invoice URL via AccountShelf. */
export function openAccountExternal(runtime: AccountRuntime, url: string): Promise<boolean> {
  return runtime.runPromise(AccountShelf.use((service) => service.openExternal(url))).catch(() => false);
}

interface LocalLlmActions {
  readonly dismissNotice: () => void;
  readonly refresh: () => void;
  readonly download: (modelId: string, allowMetered?: boolean) => Promise<LocalLlmDownloadResult>;
  readonly cancelDownload: (modelId: string) => Promise<boolean>;
  readonly activate: (modelId: string) => Promise<boolean>;
  readonly unload: () => Promise<boolean>;
  readonly remove: (modelId: string) => Promise<boolean>;
}

interface LocalLlmStoreState {
  readonly catalog: LocalLlmCatalogSnapshot;
  readonly loading: boolean;
  readonly busyModelId: string | undefined;
  readonly notice: string | undefined;
  readonly meteredPromptModelId: string | undefined;
}

/** Reactive view and command handle for on-device GGUF model management. */
export interface LocalLlmController extends LocalLlmStoreState, LocalLlmActions {}

interface LocalLlmStore extends LocalLlmActions {
  readonly subscribe: (listener: () => void) => () => void;
  readonly snapshot: () => LocalLlmStoreState;
}

const initialLocalLlmCatalog: LocalLlmCatalogSnapshot = {
  status: {
    mode: "cloud",
    activeModelId: DEFAULT_LOCAL_MODEL_ID,
    loaded: false,
    nativeAvailable: false,
    totalRamMb: 0,
    freeDiskMb: 0,
    metered: false,
  },
  models: PINNED_LOCAL_MODELS,
};

const localLlmStores = new WeakMap<AccountRuntime, LocalLlmStore>();

function applyProgress(
  catalog: LocalLlmCatalogSnapshot,
  progress: LocalLlmDownloadProgress,
): LocalLlmCatalogSnapshot {
  const models = catalog.models.map((model) => {
    if (model.id !== progress.modelId) return model;
    const downloaded = progress.phase === "installed" ? true : model.downloaded;
    return {
      ...model,
      downloaded,
      installPhase: progress.phase,
      downloadProgress: progress.percent,
      ...(progress.error !== undefined ? { lastError: progress.error } : {}),
    };
  });
  const activeDownload = progress.phase === "downloading" || progress.phase === "verifying";
  return {
    status: {
      ...catalog.status,
      ...(activeDownload ? { downloadingModelId: progress.modelId, downloadProgress: progress.percent } : {}),
    },
    models,
  };
}

function localLlmStoreFor(runtime: AccountRuntime): LocalLlmStore {
  let held = localLlmStores.get(runtime);
  if (held !== undefined) return held;
  const listeners = new Set<() => void>();
  let state: LocalLlmStoreState = {
    catalog: initialLocalLlmCatalog,
    loading: false,
    busyModelId: undefined,
    notice: undefined,
    meteredPromptModelId: undefined,
  };
  let hydrated = false;
  let stopProgress: (() => void) | undefined;
  let stopPrefs: (() => void) | undefined;

  const setState = (next: LocalLlmStoreState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const refresh = () => {
    setState({ ...state, loading: true });
    void runtime.runPromise(readLocalLlmCatalog()).then(
      (catalog) => {
        setState({ ...state, catalog, loading: false });
      },
      () => {
        setState({ ...state, loading: false });
      },
    );
  };

  const startListeners = () => {
    if (stopProgress === undefined) {
      stopProgress = subscribeLocalLlmProgress((progress) => {
        setState({
          ...state,
          catalog: applyProgress(state.catalog, progress),
          ...(progress.phase === "failed" && progress.error !== undefined ? { notice: progress.error } : {}),
        });
        if (progress.phase === "installed" || progress.phase === "failed" || progress.phase === "cancelled") {
          refresh();
        }
      });
    }
    if (stopPrefs === undefined) {
      stopPrefs = subscribeSharedPreferences((change) => {
        if (change.key === AI_MODE_KEY || change.key === LOCAL_MODEL_KEY) {
          refresh();
        }
      });
    }
  };

  const stopListeners = () => {
    stopProgress?.();
    stopProgress = undefined;
    stopPrefs?.();
    stopPrefs = undefined;
  };

  held = {
    subscribe: (listener) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        startListeners();
        if (!hydrated) {
          hydrated = true;
          refresh();
        }
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopListeners();
        }
      };
    },
    snapshot: () => state,
    refresh,
    dismissNotice: () => setState({ ...state, notice: undefined, meteredPromptModelId: undefined }),
    download: async (modelId, allowMetered = false) => {
      setState({ ...state, busyModelId: modelId, notice: undefined, meteredPromptModelId: undefined });
      const result = await runtime.runPromise(downloadLocalModel(modelId, allowMetered)).catch(
        (): LocalLlmDownloadResult => ({ ok: false, meteredRequired: false, error: "Download failed to start." }),
      );
      if (result.meteredRequired) {
        setState({
          ...state,
          busyModelId: undefined,
          meteredPromptModelId: modelId,
          notice: "You’re on a metered network. Connect to Wi-Fi or confirm downloading over cellular.",
        });
      } else if (!result.ok) {
        setState({
          ...state,
          busyModelId: undefined,
          notice: result.error ?? "Couldn’t start model download.",
        });
      } else {
        setState({ ...state, busyModelId: undefined });
        refresh();
      }
      return result;
    },
    cancelDownload: async (modelId) => {
      setState({ ...state, busyModelId: modelId });
      const ok = await runtime.runPromise(cancelLocalModelDownload(modelId)).catch(() => false);
      setState({ ...state, busyModelId: undefined });
      refresh();
      return ok;
    },
    activate: async (modelId) => {
      setState({ ...state, busyModelId: modelId, notice: undefined });
      const ok = await runtime.runPromise(activateLocalModel(modelId)).catch(() => false);
      setState({
        ...state,
        busyModelId: undefined,
        ...(ok ? {} : { notice: "Couldn’t activate that local model. Verify it is downloaded." }),
      });
      refresh();
      return ok;
    },
    unload: async () => {
      setState({ ...state, busyModelId: state.catalog.status.activeModelId });
      const ok = await runtime.runPromise(unloadLocalModel()).catch(() => false);
      setState({ ...state, busyModelId: undefined });
      refresh();
      return ok;
    },
    remove: async (modelId) => {
      setState({ ...state, busyModelId: modelId, notice: undefined });
      const ok = await runtime.runPromise(deleteLocalModel(modelId)).catch(() => false);
      setState({ ...state, busyModelId: undefined });
      refresh();
      return ok;
    },
  };
  localLlmStores.set(runtime, held);
  return held;
}

/** Subscribes to the on-device GGUF model catalog and exposes download/activation actions without `useEffect`. */
export function useLocalLlmCatalog(runtime: AccountRuntime): LocalLlmController {
  const store = localLlmStoreFor(runtime);
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  return {
    catalog: state.catalog,
    loading: state.loading,
    busyModelId: state.busyModelId,
    notice: state.notice,
    meteredPromptModelId: state.meteredPromptModelId,
    dismissNotice: store.dismissNotice,
    refresh: store.refresh,
    download: store.download,
    cancelDownload: store.cancelDownload,
    activate: store.activate,
    unload: store.unload,
    remove: store.remove,
  };
}
