// spec/agent/index.md, "Story: Run Alpha's agent on the phone"; spec/app/control/index.md, "Story: Control a third-party app within an owner-approved lease"; spec/app/control/index.md, "Story: Enforce formal safety guarantees over external app control"
import { turnNotes } from "@elizaos/agent-host";
import { Effect, Option } from "effect";
import {
  type AgentAction, type AgentProvider, type AgentRoute,
  asRecord, readBoolean, readNumber, readRawString, readString,
} from "./types.ts";

/** Action name exposed to the model for bounded external app control. */
export const CONTROL_ACTION_NAME = "DEVICE_CONTROL";

/** Maximum operations allowed under one owner-approved control lease. */
export const MAX_LEASE_OPS = 12;

/** Maximum lease duration in milliseconds (five minutes). */
export const MAX_LEASE_DURATION_MS = 300_000;

/** Minimum lease duration in milliseconds. */
export const MIN_LEASE_DURATION_MS = 1_000;

/** Maximum UI nodes accepted in one foreground observation. */
export const MAX_OBSERVED_NODES = 250;

/** Maximum text length accepted for a UI text entry operation. */
export const MAX_SET_TEXT_LENGTH = 4_096;

/** Maximum URL length accepted for an app_open_url operation. */
export const MAX_URL_LENGTH = 4_096;

/** Capability tier reported by the native Android control service. */
export type ControlTier = "TierNone" | "TierAccessibility" | "TierPrivileged";

/** Foreground target classification matching spec/app/control/index.md. */
export type TargetKind = "AllowedApp" | "BlockedApp" | "NoTarget";

/** Foreground screen protection classification matching spec/app/control/index.md. */
export type ScreenProtection = "ScreenClear" | "ScreenLocked" | "SecureFlag" | "PrivateTab" | "SensitiveView";

/** Lease lifecycle status matching spec/app/control/index.md. */
export type LeaseStatus = "LeaseInactive" | "LeaseActive" | "LeaseRevoked";

/** Execution outcome matching spec/app/control/index.md. */
export type ExecutionOutcome = "done" | "refused" | "preempted";

/** Allowlisted hardware/navigation keycodes permitted for ui_key_event. */
export const ALLOWLISTED_KEY_CODES = [
  "ENTER", "DEL", "TAB", "ESCAPE", "SPACE", "BACK", "SEARCH",
  "DPAD_UP", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT", "DPAD_CENTER",
] as const;

/** Keycode union permitted for ui_key_event. */
export type ControlKeyCode = (typeof ALLOWLISTED_KEY_CODES)[number];

/** Allowlisted scroll directions for ui_scroll. */
export const SCROLL_DIRECTIONS = ["up", "down", "left", "right"] as const;

/** Scroll direction union. */
export type ScrollDirection = (typeof SCROLL_DIRECTIONS)[number];

/** Allowlisted gesture kinds for ui_gesture. */
export const GESTURE_KINDS = ["tap", "swipe", "long_press"] as const;

/** Gesture kind union. */
export type GestureKind = (typeof GESTURE_KINDS)[number];

/** Allowlisted global system actions for ui_global_action. */
export const GLOBAL_ACTIONS = ["back", "home", "recents", "notifications", "dismiss_shade"] as const;

/** Global action union. */
export type GlobalActionKind = (typeof GLOBAL_ACTIONS)[number];

/** Packages hard-blocked from agent observation actuation to prevent self-approval and security tampering. */
export const BLOCKED_PACKAGES: ReadonlySet<string> = new Set([
  "com.android.permissioncontroller",
  "com.google.android.permissioncontroller",
  "com.android.packageinstaller",
  "com.google.android.packageinstaller",
  "com.android.systemui",
  "com.android.settings",
  "com.google.android.apps.walletnfcrel",
  "proton.android.pass",
  "com.x8bit.bitwarden",
  "com.onepassword.android",
  "com.agilebits.onepassword",
  "keepass2android.keepass2android",
  "com.google.android.apps.authenticator2",
  "com.authy.authy",
  "ai.alphacompute.alphaphone",
  "ai.alphacompute.settings",
  "ai.alphacompute.wallet",
  "ai.alphacompute.passwords",
]);

/** Sensitive activity substrings blocked within otherwise installable packages such as Play Store and GMS. */
export const BLOCKED_ACTIVITY_SUBSTRINGS: ReadonlyMap<string, readonly string[]> = new Map([
  ["com.android.vending", ["PurchaseActivity", "BillingActivity", "FinskyBilling", "AuthActivity", "VerifyApps"]],
  ["com.google.android.gms", ["Auth", "Account", "Credential", "Wallet", "TapAndPay", "Fido", "Security", "Lockscreen"]],
]);

/** Discriminated union of the twelve closed external-app control operations. */
export type ControlOpPayload =
  | { readonly type: "app_launch_package"; readonly packageName: string }
  | { readonly type: "app_open_url"; readonly url: string; readonly packageName?: string }
  | { readonly type: "ui_read_tree"; readonly includeNonInteractive?: boolean; readonly maxNodes?: number }
  | { readonly type: "ui_capture_screen"; readonly maxWidth?: number; readonly quality?: number }
  | {
    readonly type: "ui_click";
    readonly snapshotId: number;
    readonly expectedPackage: string;
    readonly nodeId?: string;
    readonly x?: number;
    readonly y?: number;
    readonly longClick?: boolean;
  }
  | {
    readonly type: "ui_set_text";
    readonly snapshotId: number;
    readonly expectedPackage: string;
    readonly nodeId: string;
    readonly text: string;
    readonly submit?: boolean;
  }
  | {
    readonly type: "ui_scroll";
    readonly snapshotId: number;
    readonly expectedPackage: string;
    readonly nodeId?: string;
    readonly direction: ScrollDirection;
    readonly distanceRatio?: number;
  }
  | {
    readonly type: "ui_key_event";
    readonly snapshotId: number;
    readonly expectedPackage: string;
    readonly keyCode: ControlKeyCode;
  }
  | {
    readonly type: "ui_gesture";
    readonly snapshotId: number;
    readonly expectedPackage: string;
    readonly kind: GestureKind;
    readonly startX: number;
    readonly startY: number;
    readonly endX?: number;
    readonly endY?: number;
    readonly durationMs: number;
  }
  | {
    readonly type: "ui_global_action";
    readonly snapshotId: number;
    readonly expectedPackage: string;
    readonly action: GlobalActionKind;
  }
  | { readonly type: "app_functions_discover"; readonly packageName?: string }
  | {
    readonly type: "app_function_execute";
    readonly snapshotId: number;
    readonly expectedPackage: string;
    readonly functionId: string;
    readonly parameters: Readonly<Record<string, string | number | boolean>>;
  };

/** Normalized UI node reported by the native accessibility service. */
export interface ObservedUiNode {
  readonly nodeId: string;
  readonly role: string;
  readonly resourceId?: string;
  readonly text?: string;
  readonly contentDescription?: string;
  readonly hintText?: string;
  readonly bounds: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
  readonly clickable: boolean;
  readonly editable: boolean;
  readonly scrollable: boolean;
  readonly sensitive: boolean;
}

/** Foreground snapshot held by the control coordinator. */
export interface ForegroundObservation {
  readonly snapId: number;
  readonly packageName: string;
  readonly activityName: string;
  readonly webUri: string | null;
  readonly targetKind: TargetKind;
  readonly protection: ScreenProtection;
  readonly windowCount: number;
  readonly nodes: readonly ObservedUiNode[];
  readonly screenshotBase64: string | null;
  readonly screenshotWidth: number | null;
  readonly screenshotHeight: number | null;
  readonly observedAtMs: number;
}

/** Active or historical owner-approved control lease. */
export interface ActiveControlLease {
  readonly leaseId: number;
  readonly packageName: string;
  readonly maxOps: number;
  readonly usedOps: number;
  readonly expiresAtMs: number;
  readonly status: LeaseStatus;
}

/** Single in-flight external control operation awaiting native execution. */
export interface PendingControlOp {
  readonly opId: number;
  readonly leaseId: number;
  readonly boundSnapId: number;
  readonly expectedPackage: string;
  readonly op: ControlOpPayload;
  readonly createdAtMs: number;
}

/** Recorded receipt of a finished external control operation. */
export interface ControlReceiptRecord {
  readonly opId: number;
  readonly leaseId: number;
  readonly snapshotId: number;
  readonly outcome: ExecutionOutcome;
  readonly refusalCode?: string;
  readonly postSnapshotId?: number;
  readonly result?: Record<string, unknown>;
  readonly receivedAtMs: number;
}

/** Pending owner-approval lease prompt surfaced after a LEASE_REQUIRED dispatch refusal. */
export interface ControlLeaseRequest {
  readonly packageName: string;
  readonly requestedOp: ControlOpPayload["type"];
  readonly requestedAt: number;
}

/** Public control snapshot returned to the overlay and agent provider. */
export interface ControlCoordinatorState {
  readonly tier: ControlTier;
  readonly capabilities: readonly string[];
  readonly foreground: ForegroundObservation;
  readonly lease: ActiveControlLease;
  readonly leaseRequest: ControlLeaseRequest | null;
  readonly pending: PendingControlOp | null;
  readonly lastResult: ExecutionOutcome;
  readonly killed: boolean;
  readonly recentReceipts: readonly ControlReceiptRecord[];
}

const PACKAGE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
const NODE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const FUNCTION_ID_PATTERN = /^[A-Za-z0-9_.:/-]{1,160}$/;
const CAPABILITY_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const TIER_SET: ReadonlySet<string> = new Set(["TierNone", "TierAccessibility", "TierPrivileged"]);
const PROTECTION_SET: ReadonlySet<string> = new Set(["ScreenClear", "ScreenLocked", "SecureFlag", "PrivateTab", "SensitiveView"]);
const KEY_CODE_SET: ReadonlySet<string> = new Set(ALLOWLISTED_KEY_CODES);
const DIRECTION_SET: ReadonlySet<string> = new Set(SCROLL_DIRECTIONS);
const GESTURE_SET: ReadonlySet<string> = new Set(GESTURE_KINDS);
const GLOBAL_ACTION_SET: ReadonlySet<string> = new Set(GLOBAL_ACTIONS);

/** Whether `value` is a syntactically valid Android application package name. */
export function isValidPackageName(value: string): boolean {
  return value.length <= 160 && PACKAGE_PATTERN.test(value);
}

/** Whether `packageName` (optionally with `activityName`) is hard-blocked from agent actuation. */
export function isBlockedTarget(packageName: string, activityName?: string): boolean {
  const pkg = packageName.trim();
  if (pkg === "" || BLOCKED_PACKAGES.has(pkg)) return true;
  const restrictedActivities = BLOCKED_ACTIVITY_SUBSTRINGS.get(pkg);
  if (restrictedActivities === undefined) return false;
  const activity = (activityName ?? "").trim();
  if (activity === "") return false;
  return restrictedActivities.some((marker) => activity.includes(marker));
}

/** Whether `op` requires a live matching foreground snapshot before dispatch. */
export function opRequiresSnapshot(op: ControlOpPayload): boolean {
  return op.type !== "app_launch_package" && op.type !== "app_open_url" && op.type !== "app_functions_discover";
}

function parsePositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function parseIntInRange(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
}

function parseHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_URL_LENGTH || trimmed.includes("\0")) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
}

function parsePrimitiveParameters(input: unknown): Readonly<Record<string, string | number | boolean>> | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > 32) return undefined;
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of entries) {
    if (key.length === 0 || key.length > 80) return undefined;
    if (typeof value === "string") {
      if (value.length > 1024 || value.includes("\0")) return undefined;
      result[key] = value;
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) return undefined;
      result[key] = value;
    } else if (typeof value === "boolean") {
      result[key] = value;
    } else {
      return undefined;
    }
  }
  return result;
}

/** Decode and strictly validate any of the twelve closed external-app control operations. */
export function parseControlOp(input: unknown): ControlOpPayload | undefined {
  const rec = asRecord(input);
  const type = readString(rec, "type");
  if (type === undefined) return undefined;
  switch (type) {
    case "app_launch_package": {
      const packageName = readString(rec, "packageName");
      return packageName !== undefined && isValidPackageName(packageName) ? { type, packageName } : undefined;
    }
    case "app_open_url": {
      const url = parseHttpsUrl(rec.url);
      if (url === undefined) return undefined;
      const packageName = readString(rec, "packageName");
      if (rec.packageName !== undefined && (packageName === undefined || !isValidPackageName(packageName))) return undefined;
      return packageName === undefined ? { type, url } : { type, url, packageName };
    }
    case "ui_read_tree": {
      const includeNonInteractive = readBoolean(rec, "includeNonInteractive");
      if (rec.includeNonInteractive !== undefined && includeNonInteractive === undefined) return undefined;
      const maxNodes = rec.maxNodes === undefined ? undefined : parseIntInRange(rec.maxNodes, 1, MAX_OBSERVED_NODES);
      if (rec.maxNodes !== undefined && maxNodes === undefined) return undefined;
      return {
        type,
        ...(includeNonInteractive === undefined ? {} : { includeNonInteractive }),
        ...(maxNodes === undefined ? {} : { maxNodes }),
      };
    }
    case "ui_capture_screen": {
      const maxWidth = rec.maxWidth === undefined ? undefined : parseIntInRange(rec.maxWidth, 360, 1440);
      if (rec.maxWidth !== undefined && maxWidth === undefined) return undefined;
      const quality = rec.quality === undefined ? undefined : parseIntInRange(rec.quality, 40, 85);
      if (rec.quality !== undefined && quality === undefined) return undefined;
      return {
        type,
        ...(maxWidth === undefined ? {} : { maxWidth }),
        ...(quality === undefined ? {} : { quality }),
      };
    }
    case "ui_click": {
      const snapshotId = parsePositiveInt(rec.snapshotId);
      const expectedPackage = readString(rec, "expectedPackage");
      if (snapshotId === undefined || expectedPackage === undefined || !isValidPackageName(expectedPackage)) return undefined;
      const nodeId = readString(rec, "nodeId");
      if (rec.nodeId !== undefined && (nodeId === undefined || !NODE_ID_PATTERN.test(nodeId))) return undefined;
      const x = rec.x === undefined ? undefined : parseIntInRange(rec.x, 0, 10_000);
      const y = rec.y === undefined ? undefined : parseIntInRange(rec.y, 0, 10_000);
      if ((rec.x !== undefined && x === undefined) || (rec.y !== undefined && y === undefined)) return undefined;
      const hasCoords = x !== undefined && y !== undefined;
      if ((x !== undefined) !== (y !== undefined)) return undefined;
      if (nodeId === undefined && !hasCoords) return undefined;
      const longClick = readBoolean(rec, "longClick");
      if (rec.longClick !== undefined && longClick === undefined) return undefined;
      return {
        type, snapshotId, expectedPackage,
        ...(nodeId === undefined ? {} : { nodeId }),
        ...(hasCoords ? { x, y } : {}),
        ...(longClick === undefined ? {} : { longClick }),
      };
    }
    case "ui_set_text": {
      const snapshotId = parsePositiveInt(rec.snapshotId);
      const expectedPackage = readString(rec, "expectedPackage");
      const nodeId = readString(rec, "nodeId");
      const text = readRawString(rec, "text");
      if (
        snapshotId === undefined || expectedPackage === undefined || !isValidPackageName(expectedPackage)
        || nodeId === undefined || !NODE_ID_PATTERN.test(nodeId)
        || text === undefined || text.length > MAX_SET_TEXT_LENGTH || text.includes("\0")
      ) return undefined;
      const submit = readBoolean(rec, "submit");
      if (rec.submit !== undefined && submit === undefined) return undefined;
      return { type, snapshotId, expectedPackage, nodeId, text, ...(submit === undefined ? {} : { submit }) };
    }
    case "ui_scroll": {
      const snapshotId = parsePositiveInt(rec.snapshotId);
      const expectedPackage = readString(rec, "expectedPackage");
      const direction = readString(rec, "direction");
      if (
        snapshotId === undefined || expectedPackage === undefined || !isValidPackageName(expectedPackage)
        || direction === undefined || !DIRECTION_SET.has(direction)
      ) return undefined;
      const nodeId = readString(rec, "nodeId");
      if (rec.nodeId !== undefined && (nodeId === undefined || !NODE_ID_PATTERN.test(nodeId))) return undefined;
      const distanceRatio = readNumber(rec, "distanceRatio");
      if (rec.distanceRatio !== undefined && (distanceRatio === undefined || distanceRatio < 0.1 || distanceRatio > 0.9)) return undefined;
      return {
        type, snapshotId, expectedPackage, direction: direction as ScrollDirection,
        ...(nodeId === undefined ? {} : { nodeId }),
        ...(distanceRatio === undefined ? {} : { distanceRatio }),
      };
    }
    case "ui_key_event": {
      const snapshotId = parsePositiveInt(rec.snapshotId);
      const expectedPackage = readString(rec, "expectedPackage");
      const keyCode = readString(rec, "keyCode");
      if (
        snapshotId === undefined || expectedPackage === undefined || !isValidPackageName(expectedPackage)
        || keyCode === undefined || !KEY_CODE_SET.has(keyCode)
      ) return undefined;
      return { type, snapshotId, expectedPackage, keyCode: keyCode as ControlKeyCode };
    }
    case "ui_gesture": {
      const snapshotId = parsePositiveInt(rec.snapshotId);
      const expectedPackage = readString(rec, "expectedPackage");
      const kind = readString(rec, "kind");
      const startX = parseIntInRange(rec.startX, 0, 10_000);
      const startY = parseIntInRange(rec.startY, 0, 10_000);
      const durationMs = parseIntInRange(rec.durationMs, 50, 2_000);
      if (
        snapshotId === undefined || expectedPackage === undefined || !isValidPackageName(expectedPackage)
        || kind === undefined || !GESTURE_SET.has(kind)
        || startX === undefined || startY === undefined || durationMs === undefined
      ) return undefined;
      const endX = rec.endX === undefined ? undefined : parseIntInRange(rec.endX, 0, 10_000);
      const endY = rec.endY === undefined ? undefined : parseIntInRange(rec.endY, 0, 10_000);
      if ((rec.endX !== undefined && endX === undefined) || (rec.endY !== undefined && endY === undefined)) return undefined;
      if (kind === "swipe" && (endX === undefined || endY === undefined)) return undefined;
      return {
        type, snapshotId, expectedPackage, kind: kind as GestureKind, startX, startY, durationMs,
        ...(endX === undefined ? {} : { endX }),
        ...(endY === undefined ? {} : { endY }),
      };
    }
    case "ui_global_action": {
      const snapshotId = parsePositiveInt(rec.snapshotId);
      const expectedPackage = readString(rec, "expectedPackage");
      const action = readString(rec, "action");
      if (
        snapshotId === undefined || expectedPackage === undefined || !isValidPackageName(expectedPackage)
        || action === undefined || !GLOBAL_ACTION_SET.has(action)
      ) return undefined;
      return { type, snapshotId, expectedPackage, action: action as GlobalActionKind };
    }
    case "app_functions_discover": {
      const packageName = readString(rec, "packageName");
      if (rec.packageName !== undefined && (packageName === undefined || !isValidPackageName(packageName))) return undefined;
      return packageName === undefined ? { type } : { type, packageName };
    }
    case "app_function_execute": {
      const snapshotId = parsePositiveInt(rec.snapshotId);
      const expectedPackage = readString(rec, "expectedPackage");
      const functionId = readString(rec, "functionId");
      const parameters = parsePrimitiveParameters(rec.parameters ?? {});
      if (
        snapshotId === undefined || expectedPackage === undefined || !isValidPackageName(expectedPackage)
        || functionId === undefined || !FUNCTION_ID_PATTERN.test(functionId) || parameters === undefined
      ) return undefined;
      return { type, snapshotId, expectedPackage, functionId, parameters };
    }
    default:
      return undefined;
  }
}

function parseObservedNode(input: unknown): ObservedUiNode | undefined {
  const rec = asRecord(input);
  const nodeId = readString(rec, "nodeId");
  const role = readString(rec, "role");
  const boundsRec = asRecord(rec.bounds);
  const left = parseIntInRange(boundsRec.left, -10_000, 10_000);
  const top = parseIntInRange(boundsRec.top, -10_000, 10_000);
  const right = parseIntInRange(boundsRec.right, -10_000, 10_000);
  const bottom = parseIntInRange(boundsRec.bottom, -10_000, 10_000);
  if (nodeId === undefined || !NODE_ID_PATTERN.test(nodeId) || role === undefined) return undefined;
  if (left === undefined || top === undefined || right === undefined || bottom === undefined) return undefined;
  const sensitive = readBoolean(rec, "sensitive") ?? false;
  const rawText = readRawString(rec, "text");
  const rawDesc = readRawString(rec, "contentDescription");
  const rawHint = readRawString(rec, "hintText");
  const resourceId = readString(rec, "resourceId");
  return {
    nodeId,
    role: role.slice(0, 64),
    ...(resourceId === undefined ? {} : { resourceId: resourceId.slice(0, 160) }),
    ...(rawText === undefined ? {} : { text: sensitive ? "[REDACTED]" : rawText.slice(0, 256) }),
    ...(rawDesc === undefined ? {} : { contentDescription: sensitive ? "[REDACTED]" : rawDesc.slice(0, 256) }),
    ...(rawHint === undefined ? {} : { hintText: sensitive ? "[REDACTED]" : rawHint.slice(0, 128) }),
    bounds: { left, top, right, bottom },
    clickable: readBoolean(rec, "clickable") ?? false,
    editable: readBoolean(rec, "editable") ?? false,
    scrollable: readBoolean(rec, "scrollable") ?? false,
    sensitive,
  };
}

function opTargetPackage(op: ControlOpPayload, foregroundPackage: string, activeLeasePackage: string): string {
  switch (op.type) {
    case "app_launch_package":
      return op.packageName;
    case "app_open_url":
      return op.packageName ?? (activeLeasePackage !== "" ? activeLeasePackage : foregroundPackage);
    case "app_functions_discover":
      return op.packageName ?? (foregroundPackage !== "" ? foregroundPackage : activeLeasePackage);
    case "ui_read_tree":
    case "ui_capture_screen":
      return foregroundPackage;
    case "ui_click":
    case "ui_set_text":
    case "ui_scroll":
    case "ui_key_event":
    case "ui_gesture":
    case "ui_global_action":
    case "app_function_execute":
      return op.expectedPackage;
  }
}

function opSnapshotId(op: ControlOpPayload, currentSnapId: number): number {
  switch (op.type) {
    case "ui_click":
    case "ui_set_text":
    case "ui_scroll":
    case "ui_key_event":
    case "ui_gesture":
    case "ui_global_action":
    case "app_function_execute":
      return op.snapshotId;
    case "ui_read_tree":
    case "ui_capture_screen":
      return currentSnapId;
    case "app_launch_package":
    case "app_open_url":
    case "app_functions_discover":
      return 0;
  }
}

/** Control effect emitted by coordinator transitions, matching spec/app/control/index.md. */
export type CoordinatorEffect =
  | { readonly tag: "HaltBridge"; readonly reason: string }
  | { readonly tag: "ClearOverlay" };

/**
 * In-memory coordinator enforcing `spec/app/control/index.md` invariants across the
 * resident agent's overlay routes, native control bridge routes, and `DEVICE_CONTROL` action.
 */
export class AlphaControlCoordinator {
  private tier: ControlTier = "TierNone";
  private capabilities: readonly string[] = [];
  private foreground: ForegroundObservation = {
    snapId: 0,
    packageName: "",
    activityName: "",
    webUri: null,
    targetKind: "NoTarget",
    protection: "ScreenClear",
    windowCount: 0,
    nodes: [],
    screenshotBase64: null,
    screenshotWidth: null,
    screenshotHeight: null,
    observedAtMs: 0,
  };
  private lease: ActiveControlLease = {
    leaseId: 0,
    packageName: "",
    maxOps: 0,
    usedOps: 0,
    expiresAtMs: 0,
    status: "LeaseInactive",
  };
  private leaseRequest: ControlLeaseRequest | null = null;
  private pending: PendingControlOp | null = null;
  private lastResult: ExecutionOutcome = "done";
  private lastOpId = 0;
  private killed = false;
  private readonly recentReceipts: ControlReceiptRecord[] = [];
  private readonly waiters = new Map<number, (receipt: ControlReceiptRecord) => void>();

  /** Read the current control state without advancing clock expiry. */
  readState(): ControlCoordinatorState {
    return {
      tier: this.tier,
      capabilities: [...this.capabilities],
      foreground: this.foreground,
      lease: this.lease,
      leaseRequest: this.leaseRequest,
      pending: this.pending,
      lastResult: this.lastResult,
      killed: this.killed,
      recentReceipts: [...this.recentReceipts],
    };
  }

  /** Return the highest monotonically assigned operation id. */
  currentLastOpId(): number {
    return this.lastOpId;
  }

  /** Whether engaging the kill-switch would change control state. */
  canKillSwitch(): boolean {
    return this.lease.status === "LeaseActive" || this.pending !== null || !this.killed;
  }

  /** Read the current control state, revoking any expired lease first. */
  snapshot(nowMs: number): ControlCoordinatorState {
    this.expireIfDue(nowMs);
    return this.readState();
  }

  /** Update the native control tier reported by the phone, revoking active work when dropping to TierNone. */
  setTier(tier: ControlTier, nowMs = 0):
    | { readonly ok: true; readonly effects: readonly CoordinatorEffect[] }
    | { readonly ok: false; readonly code: string; readonly status: number } {
    if (!TIER_SET.has(tier) || tier === this.tier) {
      return { ok: false, code: "TIER_UNCHANGED", status: 409 };
    }
    this.tier = tier;
    if (tier === "TierNone") {
      const hadPending = this.pending !== null;
      if (this.lease.status === "LeaseActive") {
        this.lease = { ...this.lease, status: "LeaseRevoked" };
      }
      if (hadPending) {
        this.settlePreempted("tier_disabled", nowMs, false);
      }
      this.leaseRequest = null;
      return {
        ok: true,
        effects: hadPending
          ? [{ tag: "HaltBridge", reason: "tier_disabled" }, { tag: "ClearOverlay" }]
          : [{ tag: "ClearOverlay" }],
      };
    }
    return { ok: true, effects: [] };
  }

  /** Revoke an expired active lease and halt any in-flight operation. */
  expireLease(nowMs: number):
    | { readonly ok: true; readonly effects: readonly CoordinatorEffect[] }
    | { readonly ok: false; readonly code: string; readonly status: number } {
    if (this.lease.status !== "LeaseActive" || nowMs < this.lease.expiresAtMs) {
      return { ok: false, code: "LEASE_NOT_EXPIRED", status: 409 };
    }
    const hadPending = this.pending !== null;
    this.lease = { ...this.lease, status: "LeaseRevoked" };
    if (hadPending) {
      this.settlePreempted("lease_expired", nowMs, false);
    }
    return {
      ok: true,
      effects: hadPending ? [{ tag: "HaltBridge", reason: "lease_expired" }] : [],
    };
  }

  /** Apply an owner-approved bounded lease for one non-blocked target package. */
  grantLease(
    input: { readonly leaseId?: number; readonly packageName: string; readonly maxOps: number; readonly durationMs: number },
    nowMs: number,
  ): { readonly ok: true; readonly lease: ActiveControlLease } | { readonly ok: false; readonly code: string; readonly status: number } {
    if (this.tier === "TierNone") return { ok: false, code: "CONTROL_TIER_UNAVAILABLE", status: 409 };
    if (this.pending !== null) return { ok: false, code: "OPERATION_IN_FLIGHT", status: 409 };
    if (this.foreground.protection !== "ScreenClear") return { ok: false, code: "PROTECTED_SCREEN", status: 409 };
    if (this.foreground.targetKind === "BlockedApp") return { ok: false, code: "BLOCKED_FOREGROUND", status: 403 };
    if (!isValidPackageName(input.packageName) || isBlockedTarget(input.packageName)) {
      return { ok: false, code: "BLOCKED_PACKAGE", status: 403 };
    }
    if (!Number.isSafeInteger(input.maxOps) || input.maxOps < 1 || input.maxOps > MAX_LEASE_OPS) {
      return { ok: false, code: "INVALID_MAX_OPS", status: 400 };
    }
    if (!Number.isSafeInteger(input.durationMs) || input.durationMs < MIN_LEASE_DURATION_MS || input.durationMs > MAX_LEASE_DURATION_MS) {
      return { ok: false, code: "INVALID_DURATION", status: 400 };
    }
    if (input.leaseId !== undefined && (!Number.isSafeInteger(input.leaseId) || input.leaseId <= this.lease.leaseId)) {
      return { ok: false, code: "INVALID_LEASE_ID", status: 409 };
    }
    this.lease = {
      leaseId: input.leaseId ?? this.lease.leaseId + 1,
      packageName: input.packageName,
      maxOps: input.maxOps,
      usedOps: 0,
      expiresAtMs: nowMs + input.durationMs,
      status: "LeaseActive",
    };
    this.leaseRequest = null;
    this.killed = false;
    return { ok: true, lease: this.lease };
  }

  /** Engage the kill-switch immediately, revoking any active lease and preempting in-flight work. */
  stop(reason: string, nowMs: number): ControlCoordinatorState {
    if (this.lease.status === "LeaseActive") {
      this.lease = { ...this.lease, status: "LeaseRevoked" };
    }
    if (this.pending !== null) {
      this.settlePreempted(reason || "kill_switch", nowMs, false);
    }
    this.leaseRequest = null;
    this.killed = true;
    return this.readState();
  }

  /** Record a fresh native observation from AlphaAccessibilityService. */
  observe(input: Record<string, unknown>, nowMs: number):
    | {
      readonly ok: true;
      readonly snapshotId: number;
      readonly lease: ActiveControlLease;
      readonly pendingOp: PendingControlOp | null;
      readonly effects: readonly CoordinatorEffect[];
    }
    | { readonly ok: false; readonly code: string; readonly status: number } {
    const tierRaw = readString(input, "tier");
    if (tierRaw === undefined || !TIER_SET.has(tierRaw)) return { ok: false, code: "INVALID_TIER", status: 400 };
    const tier = tierRaw as ControlTier;
    const protectionRaw = readString(input, "protection") ?? "ScreenClear";
    if (!PROTECTION_SET.has(protectionRaw)) return { ok: false, code: "INVALID_PROTECTION", status: 400 };
    const protection = protectionRaw as ScreenProtection;
    const explicitSnapId = input.snapshotId === undefined ? undefined : parsePositiveInt(input.snapshotId);
    if (input.snapshotId !== undefined && (explicitSnapId === undefined || explicitSnapId <= this.foreground.snapId)) {
      return { ok: false, code: "STALE_SNAPSHOT_ID", status: 409 };
    }
    const packageName = readRawString(input, "packageName")?.trim() ?? "";
    const activityName = readRawString(input, "activityName")?.trim() ?? "";
    const rawCaps = Array.isArray(input.capabilities) ? input.capabilities : [];
    const capabilities = rawCaps.filter((item): item is string => typeof item === "string" && CAPABILITY_PATTERN.test(item)).slice(0, 16);
    const webUri = parseHttpsUrl(input.webUri) ?? null;
    const windowCount = parseIntInRange(input.windowCount ?? 1, 0, 64) ?? 1;
    const targetKind: TargetKind = packageName === ""
      ? "NoTarget"
      : isBlockedTarget(packageName, activityName)
        ? "BlockedApp"
        : "AllowedApp";
    const suppressContent = protection !== "ScreenClear" || targetKind !== "AllowedApp";
    const rawNodes = !suppressContent && Array.isArray(input.nodes) ? input.nodes : [];
    const nodes: ObservedUiNode[] = [];
    for (const candidate of rawNodes.slice(0, MAX_OBSERVED_NODES)) {
      const parsed = parseObservedNode(candidate);
      if (parsed !== undefined) nodes.push(parsed);
    }
    const rawShot = !suppressContent ? readRawString(input, "screenshotBase64") : undefined;
    const screenshotBase64 = rawShot !== undefined && rawShot.length > 0 && rawShot.length <= 1_400_000 ? rawShot : null;
    const screenshotWidth = screenshotBase64 === null ? null : (parseIntInRange(input.screenshotWidth, 1, 4096) ?? null);
    const screenshotHeight = screenshotBase64 === null ? null : (parseIntInRange(input.screenshotHeight, 1, 4096) ?? null);

    this.tier = tier;
    this.capabilities = capabilities;
    if (tier === "TierNone") {
      if (this.lease.status === "LeaseActive") this.lease = { ...this.lease, status: "LeaseRevoked" };
      if (this.pending !== null) this.settlePreempted("tier_disabled", nowMs, false);
      this.leaseRequest = null;
    }
    if (protection !== "ScreenClear" || targetKind === "BlockedApp") {
      this.leaseRequest = null;
    }
    const nextSnapId = explicitSnapId ?? (this.foreground.snapId + 1);
    this.foreground = {
      snapId: nextSnapId,
      packageName,
      activityName,
      webUri: suppressContent ? null : webUri,
      targetKind,
      protection,
      windowCount,
      nodes,
      screenshotBase64,
      screenshotWidth,
      screenshotHeight,
      observedAtMs: nowMs,
    };
    const mustPreempt = this.pending !== null && (
      protection !== "ScreenClear"
      || targetKind === "BlockedApp"
      || (opRequiresSnapshot(this.pending.op) && (packageName !== this.pending.expectedPackage || targetKind !== "AllowedApp"))
    );
    if (mustPreempt) {
      this.settlePreempted("screen_changed", nowMs, true);
    }
    if (protection === "ScreenLocked" && this.lease.status === "LeaseActive") {
      this.lease = { ...this.lease, status: "LeaseRevoked" };
    }
    return {
      ok: true,
      snapshotId: nextSnapId,
      lease: this.lease,
      pendingOp: this.pending,
      effects: mustPreempt ? [{ tag: "HaltBridge", reason: "screen_changed" }] : [],
    };
  }

  /** Validate and enqueue one typed operation if every safety invariant permits it. */
  dispatch(
    op: ControlOpPayload,
    nowMs: number,
    overrides?: { readonly opId?: number; readonly snapshotId?: number; readonly expectedPackage?: string },
  ):
    | { readonly ok: true; readonly pending: PendingControlOp }
    | { readonly ok: false; readonly code: string; readonly status: number } {
    if (this.tier === "TierNone") return { ok: false, code: "CONTROL_TIER_UNAVAILABLE", status: 409 };
    if (this.killed) return { ok: false, code: "KILL_SWITCH_ACTIVE", status: 409 };
    if (this.pending !== null) return { ok: false, code: "OPERATION_IN_FLIGHT", status: 409 };
    if (this.foreground.protection !== "ScreenClear") return { ok: false, code: "PROTECTED_SCREEN", status: 409 };
    if (this.foreground.targetKind === "BlockedApp") return { ok: false, code: "BLOCKED_PACKAGE", status: 403 };
    if (overrides?.opId !== undefined && (!Number.isSafeInteger(overrides.opId) || overrides.opId <= this.lastOpId)) {
      return { ok: false, code: "INVALID_OP_ID", status: 409 };
    }
    const activeLeasePackage = this.lease.status === "LeaseActive" ? this.lease.packageName : "";
    const targetPackage = overrides?.expectedPackage ?? opTargetPackage(op, this.foreground.packageName, activeLeasePackage);
    if (!isValidPackageName(targetPackage) || isBlockedTarget(targetPackage)) {
      return { ok: false, code: "BLOCKED_PACKAGE", status: 403 };
    }
    if (this.lease.status !== "LeaseActive" || this.lease.packageName !== targetPackage) {
      this.leaseRequest = { packageName: targetPackage, requestedOp: op.type, requestedAt: nowMs };
      return { ok: false, code: "LEASE_REQUIRED", status: 403 };
    }
    if (this.lease.usedOps >= this.lease.maxOps || nowMs >= this.lease.expiresAtMs) {
      return { ok: false, code: "LEASE_EXHAUSTED", status: 403 };
    }
    const boundSnapId = overrides?.snapshotId ?? opSnapshotId(op, this.foreground.snapId);
    if (opRequiresSnapshot(op)) {
      if (
        this.foreground.targetKind !== "AllowedApp"
        || this.foreground.packageName !== targetPackage
        || boundSnapId <= 0
        || boundSnapId !== this.foreground.snapId
      ) {
        return { ok: false, code: "STALE_SNAPSHOT", status: 409 };
      }
      if ("nodeId" in op && op.nodeId !== undefined) {
        const targetNode = this.foreground.nodes.find((node) => node.nodeId === op.nodeId);
        if (targetNode?.sensitive === true) {
          return { ok: false, code: "SENSITIVE_VIEW", status: 403 };
        }
      }
    }
    const resolvedOp: ControlOpPayload = op.type === "app_open_url" && op.packageName === undefined
      ? { ...op, packageName: targetPackage }
      : op;
    this.lastOpId = overrides?.opId ?? (this.lastOpId + 1);
    this.lease = { ...this.lease, usedOps: this.lease.usedOps + 1 };
    const pending: PendingControlOp = {
      opId: this.lastOpId,
      leaseId: this.lease.leaseId,
      boundSnapId,
      expectedPackage: targetPackage,
      op: resolvedOp,
      createdAtMs: nowMs,
    };
    this.pending = pending;
    return { ok: true, pending };
  }

  /** Return the current pending operation for the native executor, or null if idle/expired. */
  nextPending(nowMs: number): PendingControlOp | null {
    this.expireIfDue(nowMs);
    return this.pending;
  }

  /** Record a native execution receipt for the currently in-flight operation. */
  recordReceipt(input: Record<string, unknown>, nowMs: number):
    | { readonly ok: true; readonly receipt: ControlReceiptRecord; readonly effects: readonly CoordinatorEffect[] }
    | { readonly ok: false; readonly code: string; readonly status: number } {
    const opId = parsePositiveInt(input.opId);
    const outcomeRaw = readString(input, "outcome");
    if (opId === undefined || (outcomeRaw !== "done" && outcomeRaw !== "refused" && outcomeRaw !== "preempted")) {
      return { ok: false, code: "INVALID_RECEIPT", status: 400 };
    }
    if (this.pending === null || this.pending.opId !== opId) {
      return { ok: false, code: "NO_MATCHING_OPERATION", status: 409 };
    }
    const refusalCode = readString(input, "refusalCode");
    const postSnapshotId = parsePositiveInt(input.postSnapshotId);
    const result = typeof input.result === "object" && input.result !== null && !Array.isArray(input.result)
      ? (input.result as Record<string, unknown>)
      : undefined;
    const record: ControlReceiptRecord = {
      opId,
      leaseId: this.pending.leaseId,
      snapshotId: this.pending.boundSnapId,
      outcome: outcomeRaw,
      ...(refusalCode === undefined ? {} : { refusalCode }),
      ...(postSnapshotId === undefined ? {} : { postSnapshotId }),
      ...(result === undefined ? {} : { result }),
      receivedAtMs: nowMs,
    };
    this.pending = null;
    this.lastResult = outcomeRaw;
    if (outcomeRaw === "preempted") {
      if (this.lease.status === "LeaseActive") this.lease = { ...this.lease, status: "LeaseRevoked" };
      this.killed = true;
    }
    this.pushReceipt(record);
    return {
      ok: true,
      receipt: record,
      effects: outcomeRaw === "preempted" ? [{ tag: "HaltBridge", reason: "preempted" }] : [],
    };
  }

  /** Handle an immediate native interrupt such as physical touch preemption or screen lock. */
  interrupt(reason: string, packageName: string | undefined, nowMs: number): ControlCoordinatorState {
    if (this.lease.status === "LeaseActive") {
      this.lease = { ...this.lease, status: "LeaseRevoked" };
    }
    if (this.pending !== null) {
      this.settlePreempted(reason, nowMs, true);
    }
    this.leaseRequest = null;
    this.killed = true;
    if (packageName !== undefined && isValidPackageName(packageName) && isBlockedTarget(packageName)) {
      this.foreground = {
        ...this.foreground,
        snapId: this.foreground.snapId + 1,
        packageName,
        targetKind: "BlockedApp",
        nodes: [],
        webUri: null,
        screenshotBase64: null,
        observedAtMs: nowMs,
      };
    }
    return this.snapshot(nowMs);
  }

  /** Wait up to `timeoutMs` for the native executor to report a receipt for `opId`. */
  waitForReceipt(opId: number, timeoutMs: number): Promise<ControlReceiptRecord | undefined> {
    const existing = this.recentReceipts.find((entry) => entry.opId === opId);
    if (existing !== undefined) return Promise.resolve(existing);
    if (this.pending?.opId !== opId) return Promise.resolve(undefined);
    const awaited = Effect.callback<ControlReceiptRecord>((resume) => {
      this.waiters.set(opId, (receipt) => {
        resume(Effect.succeed(receipt));
      });
      return Effect.sync(() => {
        this.waiters.delete(opId);
      });
    });
    return Effect.runPromise(
      Effect.map(Effect.timeoutOption(awaited, timeoutMs), (found) => Option.getOrUndefined(found)),
    );
  }

  private expireIfDue(nowMs: number): void {
    if (this.lease.status === "LeaseActive" && nowMs >= this.lease.expiresAtMs) {
      this.expireLease(nowMs);
    }
  }

  private settlePreempted(reason: string, nowMs: number, updateLastResult: boolean): void {
    const active = this.pending;
    if (active === null) return;
    this.pending = null;
    if (updateLastResult) {
      this.lastResult = "preempted";
    }
    this.pushReceipt({
      opId: active.opId,
      leaseId: active.leaseId,
      snapshotId: active.boundSnapId,
      outcome: "preempted",
      refusalCode: reason,
      receivedAtMs: nowMs,
    });
  }

  private pushReceipt(record: ControlReceiptRecord): void {
    this.recentReceipts.push(record);
    if (this.recentReceipts.length > 20) this.recentReceipts.shift();
    const waiter = this.waiters.get(record.opId);
    if (waiter !== undefined) {
      this.waiters.delete(record.opId);
      waiter(record);
    }
  }
}

function formatControlContext(state: ControlCoordinatorState): string {
  if (state.tier === "TierNone") {
    return "External app control: unavailable (accessibility control service disconnected).";
  }
  if (state.foreground.protection !== "ScreenClear") {
    return `External app control: screen protected (${state.foreground.protection}); observation withheld.`;
  }
  if (state.foreground.targetKind === "BlockedApp") {
    return `External app control: foreground package ${state.foreground.packageName} is blocked from automation.`;
  }
  const remaining = state.lease.status === "LeaseActive" ? state.lease.maxOps - state.lease.usedOps : 0;
  const lines: string[] = [
    `External app control: tier=${state.tier}, package=${state.foreground.packageName || "none"}, snapshotId=${state.foreground.snapId}`,
    `Lease: status=${state.lease.status}, target=${state.lease.packageName || "none"}, remainingOps=${remaining}, killed=${state.killed}`,
  ];
  if (state.foreground.webUri !== null) {
    lines.push(`Active web URL: ${state.foreground.webUri}`);
  }
  const interactive = state.foreground.nodes.filter((node) => node.clickable || node.editable || node.scrollable).slice(0, 20);
  if (interactive.length > 0) {
    lines.push("Visible interactive elements:");
    for (const node of interactive) {
      const label = node.text ?? node.contentDescription ?? node.hintText ?? node.resourceId ?? node.role;
      lines.push(`- ${node.nodeId} [${node.role}] "${label}" (${node.bounds.left},${node.bounds.top},${node.bounds.right},${node.bounds.bottom})`);
    }
  }
  return lines.join("\n");
}

/** Provider exposing live foreground context and active lease state to the resident agent. */
export function controlProvider(
  coordinator: AlphaControlCoordinator,
  now: () => number = () => Date.now(),
): AgentProvider {
  return {
    name: "alpha_device_control",
    description: "Foreground Android app summary, active browser URL, snapshot id, and external control lease state.",
    get: () => Promise.resolve({ text: formatControlContext(coordinator.snapshot(now())) }),
  };
}

function controlRefusalMessage(code: string, packageName?: string): string {
  switch (code) {
    case "INVALID_OPERATION":
      return "Invalid external app control operation payload.";
    case "CONTROL_TIER_UNAVAILABLE":
      return "External app control is unavailable while the accessibility service is disconnected.";
    case "KILL_SWITCH_ACTIVE":
      return "External app control is halted by the kill-switch.";
    case "OPERATION_IN_FLIGHT":
      return "Another external app control operation is already running.";
    case "PROTECTED_SCREEN":
      return "External app control is refused on a locked, private, or protected screen.";
    case "BLOCKED_PACKAGE":
      return "External app control is blocked for that application.";
    case "LEASE_REQUIRED":
      return packageName
        ? `Owner lease approval is required before operating ${packageName}.`
        : "Owner lease approval is required before operating that application.";
    case "LEASE_EXHAUSTED":
      return "The active external app control lease has reached its limit or expired.";
    case "STALE_SNAPSHOT":
      return "The target UI snapshot is no longer current; observe the foreground screen again.";
    case "SENSITIVE_VIEW":
      return "External app control is refused on a password or sensitive field.";
    default:
      return `External app control refused (${code}).`;
  }
}

/** Action allowing the resident agent to execute bounded external-app operations through the control coordinator. */
export function controlActions(
  coordinator: AlphaControlCoordinator,
  now: () => number = () => Date.now(),
  waitTimeoutMs = 10_000,
): readonly AgentAction[] {
  const action: AgentAction = {
    name: CONTROL_ACTION_NAME,
    description: "Observe or act inside an owner-approved third-party Android app using one of the twelve closed typed control operations.",
    similes: ["CONTROL_APP", "OPERATE_APP", "BROWSER_EXTERNAL_CONTROL"],
    parameters: [
      {
        name: "op",
        description: "Typed external control operation payload (app_launch_package, app_open_url, ui_read_tree, ui_capture_screen, ui_click, ui_set_text, ui_scroll, ui_key_event, ui_gesture, ui_global_action, app_functions_discover, app_function_execute).",
        required: true,
        schema: { type: "object" },
      },
    ],
    validate: () => Promise.resolve(true),
    handler: async (_runtime, _message, _state, options) => {
      const params = asRecord(asRecord(options).parameters);
      const parsed = parseControlOp(params.op ?? params);
      if (parsed === undefined) {
        const message = controlRefusalMessage("INVALID_OPERATION");
        return { success: false, text: message, error: message, data: { code: "INVALID_OPERATION" } };
      }
      const dispatched = coordinator.dispatch(parsed, now());
      if (!dispatched.ok) {
        const current = dispatched.code === "LEASE_REQUIRED" ? coordinator.snapshot(now()) : undefined;
        const message = controlRefusalMessage(dispatched.code, current?.leaseRequest?.packageName);
        return {
          success: false,
          text: message,
          error: message,
          data: {
            code: dispatched.code,
            ...(current?.leaseRequest !== null && current?.leaseRequest !== undefined
              ? { leaseRequest: current.leaseRequest }
              : {}),
          },
        };
      }
      const receipt = waitTimeoutMs > 0 ? await coordinator.waitForReceipt(dispatched.pending.opId, waitTimeoutMs) : undefined;
      if (receipt === undefined) {
        return {
          success: true,
          text: `Queued ${parsed.type} for ${dispatched.pending.expectedPackage}.`,
          data: { status: "queued", opId: dispatched.pending.opId, leaseId: dispatched.pending.leaseId },
        };
      }
      const succeeded = receipt.outcome === "done";
      const message = succeeded
        ? `Completed ${parsed.type} in ${dispatched.pending.expectedPackage}${receipt.postSnapshotId === undefined ? "." : ` (snapshot ${receipt.postSnapshotId}).`}`
        : controlRefusalMessage(receipt.refusalCode ?? receipt.outcome, dispatched.pending.expectedPackage);
      return {
        success: succeeded,
        text: message,
        ...(succeeded ? {} : { error: message }),
        data: {
          status: receipt.outcome,
          opId: receipt.opId,
          leaseId: receipt.leaseId,
          ...(receipt.refusalCode === undefined ? {} : { code: receipt.refusalCode }),
          ...(receipt.postSnapshotId === undefined ? {} : { postSnapshotId: receipt.postSnapshotId }),
          ...(receipt.result === undefined ? {} : { result: receipt.result }),
        },
      };
    },
  };
  turnNotes.set(action, () => {
    const state = coordinator.snapshot(now());
    return state.tier === "TierNone" ? undefined : formatControlContext(state);
  });
  return [action];
}

/** Overlay and native-channel HTTP routes wired onto the Alpha product plugin. */
export function controlRoutes(
  coordinator: AlphaControlCoordinator,
  now: () => number = () => Date.now(),
): readonly AgentRoute[] {
  return [
    {
      method: "GET",
      path: "/api/alpha/control/state",
      handler: () => Promise.resolve({ status: 200, body: { ...coordinator.snapshot(now()) } }),
    },
    {
      method: "POST",
      path: "/api/alpha/control/lease",
      maxBodyBytes: 4096,
      handler: ({ body }) => {
        const rec = asRecord(body);
        const packageName = readString(rec, "packageName") ?? "";
        const maxOps = readNumber(rec, "maxOps") ?? 0;
        const durationMs = readNumber(rec, "durationMs") ?? 0;
        const result = coordinator.grantLease({ packageName, maxOps, durationMs }, now());
        if (!result.ok) return Promise.resolve({ status: result.status, body: { error: result.code } });
        return Promise.resolve({ status: 200, body: { lease: result.lease } });
      },
    },
    {
      method: "POST",
      path: "/api/alpha/control/stop",
      maxBodyBytes: 1024,
      handler: ({ body }) => {
        const rec = asRecord(body);
        const reason = readString(rec, "reason") ?? "kill_switch";
        return Promise.resolve({ status: 200, body: { ...coordinator.stop(reason, now()) } });
      },
    },
    {
      method: "POST",
      path: "/api/alpha-control/observe",
      maxBodyBytes: 1_572_864,
      handler: ({ body }) => {
        const result = coordinator.observe(asRecord(body), now());
        if (!result.ok) return Promise.resolve({ status: result.status, body: { error: result.code } });
        return Promise.resolve({ status: 200, body: { snapshotId: result.snapshotId, lease: result.lease, pendingOp: result.pendingOp } });
      },
    },
    {
      method: "GET",
      path: "/api/alpha-control/next",
      handler: () => Promise.resolve({ status: 200, body: { op: coordinator.nextPending(now()) } }),
    },
    {
      method: "POST",
      path: "/api/alpha-control/receipt",
      maxBodyBytes: 65_536,
      handler: ({ body }) => {
        const result = coordinator.recordReceipt(asRecord(body), now());
        if (!result.ok) return Promise.resolve({ status: result.status, body: { error: result.code } });
        return Promise.resolve({ status: 200, body: { receipt: result.receipt } });
      },
    },
    {
      method: "POST",
      path: "/api/alpha-control/interrupt",
      maxBodyBytes: 2048,
      handler: ({ body }) => {
        const rec = asRecord(body);
        const reason = readString(rec, "reason") ?? "interrupted";
        const packageName = readString(rec, "packageName");
        return Promise.resolve({ status: 200, body: { ...coordinator.interrupt(reason, packageName, now()) } });
      },
    },
  ];
}
