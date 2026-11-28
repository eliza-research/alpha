// spec/agent/index.md, "Story: Run Alpha's agent on the phone"
import type { AgentPlugin, ModuleContext, ModuleFactory } from "@elizaos/agent-host";
import { Effect } from "effect";
import { clockActions, clockProvider, clockRoutes } from "./clock.ts";
import { AlphaControlCoordinator, controlActions, controlProvider, controlRoutes } from "./control.ts";
import { type CloudAccount, importLegacyStoreForRuntime, type LegacyStoreOpener, parseEarlierOwner } from "./legacy-import.ts";
import { AlphaLocalLlmController, localLlmRoutes, registerLocalLlmModels } from "./local-llm.ts";
import { remindersAction, remindersProvider, remindersRoutes } from "./reminders.ts";
import { AlphaAppsStore } from "./store.ts";
import type { AgentRuntimeLike } from "./types.ts";

/** Product plugin name registered with eliza's resident agent. */
export const alphaAppsPluginName = "alpha-apps";

/** Build the Alpha product plugin backed by `store` (or a new store in `stateDirectory`). */
export function createAlphaAppsPlugin(options: {
  readonly stateDirectory?: string;
  readonly timeZone?: string;
  readonly runtime?: AgentRuntimeLike;
  readonly store?: AlphaAppsStore;
  readonly control?: AlphaControlCoordinator;
  readonly localLlm?: AlphaLocalLlmController;
  readonly launchBackend?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly controlWaitTimeoutMs?: number;
  readonly earlierImport?: {
    readonly legacyStoreDir?: string;
    readonly owner?: CloudAccount;
    readonly account?: CloudAccount;
    readonly conversationWorldId?: string;
    readonly openLegacyStore?: LegacyStoreOpener;
  };
} = {}): {
  readonly plugin: AgentPlugin;
  readonly store: AlphaAppsStore;
  readonly control: AlphaControlCoordinator;
  readonly localLlm: AlphaLocalLlmController;
} {
  const store = options.store ?? new AlphaAppsStore({ stateDirectory: options.stateDirectory });
  const control = options.control ?? new AlphaControlCoordinator();
  const localLlm = options.localLlm ?? new AlphaLocalLlmController({
    stateDirectory: options.stateDirectory,
    launchBackend: options.launchBackend,
    environment: options.environment,
  });
  const timeZone = options.timeZone ?? "UTC";
  const plugin: AgentPlugin = {
    name: alphaAppsPluginName,
    description: "Alpha first-party Clock, Reminders, Local LLM, and bounded Device Control actions, providers, and HTTP routes.",
    init: async (_config, runtime) => {
      registerLocalLlmModels(runtime, localLlm);
      const contexts = (runtime as { contexts?: { tryRegister?: (ctx: unknown) => void } } | undefined)?.contexts;
      contexts?.tryRegister?.({
        id: "clock",
        label: "Clock",
        description: "Alarms, countdown timers, and world clock.",
        descriptionCompressed: "Alarms, timers, and world clock.",
        sensitivity: "personal",
        cacheScope: "agent",
      });
      if (options.earlierImport?.openLegacyStore !== undefined) {
        await importLegacyStoreForRuntime({
          legacyStoreDir: options.earlierImport.legacyStoreDir,
          owner: options.earlierImport.owner,
          account: options.earlierImport.account,
          stateDirectory: options.stateDirectory,
          runtime,
          conversationWorldId: options.earlierImport.conversationWorldId,
          openLegacyStore: options.earlierImport.openLegacyStore,
        });
      }
    },
    actions: [...clockActions(store, timeZone), remindersAction(store, timeZone), ...controlActions(control, () => Date.now(), options.controlWaitTimeoutMs)],
    providers: [clockProvider(store, timeZone), remindersProvider(store, timeZone), controlProvider(control)],
    routes: [
      ...clockRoutes(store, timeZone),
      ...remindersRoutes(store, options.runtime, timeZone),
      ...controlRoutes(control),
      ...localLlmRoutes(localLlm),
    ],
  };
  return { plugin, store, control, localLlm };
}

/**
 * Hosted module factory builder for `runAgentCli`'s `hostModules`, binding the Alpha product plugin
 * to the agent's state directory and timezone, and the earlier store the phone passes to the account
 * the launch names, so it is brought in only for its owner.
 * @public
 */
export function alphaAppsModuleWith(options: { readonly openLegacyStore?: LegacyStoreOpener } = {}): ModuleFactory<never> {
  return (context: ModuleContext) => {
    const environment = context.launch.environment;
    const launch = context.launch as { readonly model?: { readonly backend?: string } } | undefined;
    const { plugin } = createAlphaAppsPlugin({
      stateDirectory: context.stateDirectory,
      timeZone: context.timeZone,
      runtime: context.runtime,
      launchBackend: launch?.model?.backend,
      environment,
      earlierImport: {
        legacyStoreDir: environment?.ALPHA_LEGACY_STORE_DIR,
        owner: parseEarlierOwner(environment?.ALPHA_LEGACY_OWNER),
        account: context.launch.account,
        conversationWorldId: context.conversationOwner?.world,
        openLegacyStore: options.openLegacyStore,
      },
    });
    return Effect.succeed({ name: alphaAppsPluginName, plugin });
  };
}

/**
 * Hosted module factory for `runAgentCli`'s `hostModules`, binding the Alpha product plugin to the agent's state directory and timezone.
 * @public
 */
export const alphaAppsModule: ModuleFactory<never> = alphaAppsModuleWith();

export { AlphaAppsStore } from "./store.ts";
export {
  AlphaControlCoordinator, CONTROL_ACTION_NAME, MAX_LEASE_OPS, isBlockedTarget, parseControlOp,
} from "./control.ts";
export { AlphaLocalLlmController } from "./local-llm.ts";
/** @public main.vibe imports it by name in the generated host entry. */
export { makeNativeNotesCleanup } from "./notes-cleanup.vibe";

/** @public Used by the generated host entry with the local inference engine. */
export { notesTranscriptionRoutes } from "./notes-transcription.ts";
