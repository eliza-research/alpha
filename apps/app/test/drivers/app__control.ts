// spec/app/control/index.md, "Story: Control a third-party app within an owner-approved lease"; spec/app/control/index.md, "Story: Enforce formal safety guarantees over external app control"
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Driver, Options } from "../../gen/app__control.conformance.ts";
import type {
  ControlEffect, ControlOp, ControlState, ControlTier, ExecutionOutcome, ScreenProtection, TargetKind,
} from "../../gen/app__control.ts";

interface CoordinatorSnapshot {
  readonly tier: ControlTier;
  readonly foreground: {
    readonly snapId: number;
    readonly packageName: string;
    readonly targetKind: TargetKind;
    readonly protection: ScreenProtection;
  };
  readonly lease: {
    readonly leaseId: number;
    readonly packageName: string;
    readonly maxOps: number;
    readonly usedOps: number;
    readonly expiresAtMs: number;
    readonly status: "LeaseInactive" | "LeaseActive" | "LeaseRevoked";
  };
  readonly pending: {
    readonly opId: number;
    readonly boundSnapId: number;
    readonly expectedPackage: string;
    readonly op: { readonly type: string };
  } | null;
  readonly lastResult: "done" | "refused" | "preempted";
  readonly killed: boolean;
}

interface CoordinatorLike {
  readState(): CoordinatorSnapshot;
  currentLastOpId(): number;
  canKillSwitch(): boolean;
  setTier(tier: ControlTier, nowMs?: number): { readonly ok: true; readonly effects: readonly ControlEffect[] } | { readonly ok: false };
  observe(
    input: Record<string, unknown>,
    nowMs: number,
  ): { readonly ok: true; readonly effects: readonly ControlEffect[] } | { readonly ok: false };
  grantLease(
    input: { readonly leaseId?: number; readonly packageName: string; readonly maxOps: number; readonly durationMs: number },
    nowMs: number,
  ): { readonly ok: true } | { readonly ok: false };
  dispatch(
    op: Record<string, unknown>,
    nowMs: number,
    overrides?: { readonly opId?: number; readonly snapshotId?: number; readonly expectedPackage?: string },
  ): { readonly ok: true; readonly pending: { readonly opId: number; readonly boundSnapId: number } } | { readonly ok: false };
  recordReceipt(
    input: Record<string, unknown>,
    nowMs: number,
  ): { readonly ok: true; readonly effects: readonly ControlEffect[] } | { readonly ok: false };
  expireLease(nowMs: number): { readonly ok: true; readonly effects: readonly ControlEffect[] } | { readonly ok: false };
  stop(reason: string, nowMs: number): CoordinatorSnapshot;
}

interface ControlModuleLike {
  readonly AlphaControlCoordinator: new () => CoordinatorLike;
}

const TIME_SCALE_MS = 1_000;

const ALLOWED_PACKAGES: Readonly<Record<number, string>> = {
  0: "org.example.app0",
  1: "org.mozilla.firefox",
  2: "com.android.chrome",
};

const BLOCKED_PACKAGES_BY_ID: Readonly<Record<number, string>> = {
  0: "com.android.systemui",
  1: "com.android.settings",
  2: "com.android.permissioncontroller",
};

const PACKAGE_TO_APP_ID: Readonly<Record<string, number>> = {
  "": 0,
  "org.example.app0": 0,
  "org.mozilla.firefox": 1,
  "com.android.chrome": 2,
  "com.android.systemui": 0,
  "com.android.settings": 1,
  "com.android.permissioncontroller": 2,
};

const OP_TYPE_TO_SPEC: Readonly<Record<string, ControlOp>> = {
  app_launch_package: "OpLaunchPackage",
  app_open_url: "OpOpenUrl",
  ui_read_tree: "OpReadTree",
  ui_capture_screen: "OpCaptureScreen",
  ui_click: "OpClick",
  ui_set_text: "OpSetText",
  ui_scroll: "OpScroll",
  ui_key_event: "OpKeyEvent",
  ui_gesture: "OpGesture",
  ui_global_action: "OpGlobalAction",
  app_functions_discover: "OpFunctionsDiscover",
  app_function_execute: "OpFunctionExecute",
};

const OUTCOME_TO_WIRE: Readonly<Record<ExecutionOutcome, "done" | "refused" | "preempted">> = {
  OutcomeDone: "done",
  OutcomeRefused: "refused",
  OutcomePreempted: "preempted",
};

const OUTCOME_FROM_WIRE: Readonly<Record<"done" | "refused" | "preempted", ExecutionOutcome>> = {
  done: "OutcomeDone",
  refused: "OutcomeRefused",
  preempted: "OutcomePreempted",
};

interface ObservedPendingActive {
  readonly active: true;
  readonly pendingId: number;
  readonly op: ControlOp;
  readonly boundSnapId: number;
  readonly boundAppId: number;
}

interface ObservedPendingIdle {
  readonly active: false;
}

/** Observable projection shared by the Quint oracle and AlphaControlCoordinator. */
export interface ObservedControlView {
  readonly tier: ControlTier;
  readonly foreground: {
    readonly snapId: number;
    readonly appId: number;
    readonly targetKind: TargetKind;
    readonly protection: ScreenProtection;
  };
  readonly lease: ControlState["lease"];
  readonly pending: ObservedPendingActive | ObservedPendingIdle;
  readonly lastResult: ExecutionOutcome;
  readonly lastOpId: number;
  readonly killed: boolean;
}

function packageFor(appId: number, targetKind: TargetKind): string {
  if (targetKind === "NoTarget") return "";
  if (targetKind === "BlockedApp") return BLOCKED_PACKAGES_BY_ID[appId] ?? "com.android.settings";
  return ALLOWED_PACKAGES[appId] ?? `org.example.app${appId}`;
}

function appIdFor(packageName: string): number {
  const known = PACKAGE_TO_APP_ID[packageName];
  if (known !== undefined) return known;
  const suffix = /^org\.example\.app(\d+)$/u.exec(packageName);
  return suffix ? Number(suffix[1]) : 0;
}

function payloadFor(op: ControlOp, snapId: number, expectedPackage: string): Record<string, unknown> {
  switch (op) {
    case "OpLaunchPackage":
      return { type: "app_launch_package", packageName: expectedPackage };
    case "OpOpenUrl":
      return { type: "app_open_url", url: "https://example.org", packageName: expectedPackage };
    case "OpReadTree":
      return { type: "ui_read_tree", includeNonInteractive: false, maxNodes: 80 };
    case "OpCaptureScreen":
      return { type: "ui_capture_screen", maxWidth: 720, quality: 70 };
    case "OpClick":
      return { type: "ui_click", snapshotId: snapId, expectedPackage, nodeId: "n1" };
    case "OpSetText":
      return { type: "ui_set_text", snapshotId: snapId, expectedPackage, nodeId: "n1", text: "alpha" };
    case "OpScroll":
      return { type: "ui_scroll", snapshotId: snapId, expectedPackage, direction: "down" };
    case "OpKeyEvent":
      return { type: "ui_key_event", snapshotId: snapId, expectedPackage, keyCode: "ENTER" };
    case "OpGesture":
      return { type: "ui_gesture", snapshotId: snapId, expectedPackage, kind: "tap", startX: 100, startY: 200, durationMs: 80 };
    case "OpGlobalAction":
      return { type: "ui_global_action", snapshotId: snapId, expectedPackage, action: "back" };
    case "OpFunctionsDiscover":
      return { type: "app_functions_discover", packageName: expectedPackage };
    case "OpFunctionExecute":
      return { type: "app_function_execute", snapshotId: snapId, expectedPackage, functionId: "browser.openTab", parameters: {} };
  }
}

function isControlModule(value: unknown): value is ControlModuleLike {
  return typeof value === "object"
    && value !== null
    && "AlphaControlCoordinator" in value
    && typeof (value as { readonly AlphaControlCoordinator: unknown }).AlphaControlCoordinator === "function";
}

const controlModuleUrl = pathToFileURL(path.resolve(import.meta.dirname, "../../../agent/src/plugins/control.ts")).href;
const loaded: unknown = await import(controlModuleUrl);
if (!isControlModule(loaded)) {
  throw new Error(`Expected AlphaControlCoordinator export at ${controlModuleUrl}`);
}
const { AlphaControlCoordinator } = loaded;

interface Entry {
  readonly coordinator: CoordinatorLike;
  out: ControlEffect[];
}

const entries = new Map<string, Entry>();

function entryFor(key: string): Entry {
  const existing = entries.get(key);
  if (existing !== undefined) return existing;
  const fresh: Entry = { coordinator: new AlphaControlCoordinator(), out: [] };
  entries.set(key, fresh);
  return fresh;
}

function projectState(state: ControlState): ObservedControlView {
  return {
    tier: state.tier,
    foreground: {
      snapId: state.foreground.snapId,
      appId: state.foreground.targetKind === "NoTarget" ? 0 : state.foreground.appId,
      targetKind: state.foreground.targetKind,
      protection: state.foreground.protection,
    },
    lease: state.lease,
    pending: state.pending.active
      ? {
        active: true,
        pendingId: state.pending.pendingId,
        op: state.pending.op,
        boundSnapId: state.pending.boundSnapId,
        boundAppId: state.pending.boundAppId,
      }
      : { active: false },
    lastResult: state.lastResult,
    lastOpId: state.lastOpId,
    killed: state.killed,
  };
}

/** Conformance driver exercising `AlphaControlCoordinator` against `spec/app/control/index.md`. */
export const driver: Driver<ObservedControlView> = {
  reset: () => {
    entries.clear();
  },
  dispatch: (key, event, by) => {
    const entry = entryFor(key);
    entry.out = [];
    const coordinator = entry.coordinator;
    switch (event.type) {
      case "setTier": {
        if (by !== "Phone") return "refused";
        const moved = coordinator.setTier(event.tier, 0);
        if (!moved.ok) return "refused";
        entry.out = [...moved.effects];
        return "accepted";
      }
      case "observe": {
        if (by !== "Phone" || event.appId < 0) return "refused";
        const current = coordinator.readState();
        const moved = coordinator.observe({
          tier: current.tier,
          snapshotId: event.snapId,
          packageName: packageFor(event.appId, event.targetKind),
          activityName: "",
          protection: event.protection,
          windowCount: 1,
          nodes: [],
        }, 0);
        if (!moved.ok) return "refused";
        entry.out = [...moved.effects];
        return "accepted";
      }
      case "grantLease": {
        if (by !== "Owner" || event.appId <= 0) return "refused";
        const durationMs = (event.expiresAt - event.now) * TIME_SCALE_MS;
        const moved = coordinator.grantLease({
          leaseId: event.leaseId,
          packageName: packageFor(event.appId, "AllowedApp"),
          maxOps: event.maxOps,
          durationMs,
        }, event.now * TIME_SCALE_MS);
        return moved.ok ? "accepted" : "refused";
      }
      case "dispatch": {
        if (by !== "Agent") return "refused";
        const expectedPackage = event.appId > 0 ? packageFor(event.appId, "AllowedApp") : "";
        const moved = coordinator.dispatch(
          payloadFor(event.op, event.snapId, expectedPackage),
          event.now * TIME_SCALE_MS,
          { opId: event.opId, snapshotId: event.snapId, expectedPackage },
        );
        if (!moved.ok) return "refused";
        entry.out = [{
          tag: "DispatchOp",
          opId: event.opId,
          op: event.op,
          snapId: event.snapId,
          appId: event.appId,
        }];
        return "accepted";
      }
      case "finish": {
        if (by !== "Phone") return "refused";
        const moved = coordinator.recordReceipt({
          opId: event.opId,
          outcome: OUTCOME_TO_WIRE[event.verdict],
        }, 0);
        if (!moved.ok) return "refused";
        entry.out = [...moved.effects];
        return "accepted";
      }
      case "expireLease": {
        if (by !== "Phone") return "refused";
        const moved = coordinator.expireLease(event.now * TIME_SCALE_MS);
        if (!moved.ok) return "refused";
        entry.out = [...moved.effects];
        return "accepted";
      }
      case "killSwitch": {
        if ((by !== "Owner" && by !== "Phone") || !coordinator.canKillSwitch()) return "refused";
        coordinator.stop("kill_switch", 0);
        entry.out = [{ tag: "HaltBridge", reason: "kill_switch" }, { tag: "ClearOverlay" }];
        return "accepted";
      }
    }
  },
  observe: (key) => {
    const coordinator = entryFor(key).coordinator;
    const state = coordinator.readState();
    const pendingOp = state.pending !== null ? OP_TYPE_TO_SPEC[state.pending.op.type] : undefined;
    return {
      tier: state.tier,
      foreground: {
        snapId: state.foreground.snapId,
        appId: state.foreground.targetKind === "NoTarget" ? 0 : appIdFor(state.foreground.packageName),
        targetKind: state.foreground.targetKind,
        protection: state.foreground.protection,
      },
      lease: {
        leaseId: state.lease.leaseId,
        appId: state.lease.packageName === "" ? 0 : appIdFor(state.lease.packageName),
        maxOps: state.lease.maxOps,
        usedOps: state.lease.usedOps,
        expiresAt: Math.trunc(state.lease.expiresAtMs / TIME_SCALE_MS),
        status: state.lease.status,
      },
      pending: state.pending !== null && pendingOp !== undefined
        ? {
          active: true,
          pendingId: state.pending.opId,
          op: pendingOp,
          boundSnapId: state.pending.boundSnapId,
          boundAppId: appIdFor(state.pending.expectedPackage),
        }
        : { active: false },
      lastResult: OUTCOME_FROM_WIRE[state.lastResult],
      lastOpId: coordinator.currentLastOpId(),
      killed: state.killed,
    };
  },
  observeOutput: (key) => entryFor(key).out,
};

/** Conformance options checking multi-key isolation across all journeys, transition paths, and random walks. */
export const options: Options<ObservedControlView> = {
  view: projectState,
  keys: ["a", "b"],
  walks: 150,
  steps: 25,
};
