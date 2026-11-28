// spec/app/control/index.md, "Story: Control a third-party app within an owner-approved lease"; spec/app/control/index.md, "The kill-switch immediately revokes any active lease, clears any in-flight operation, and signals the native bridge and overlay"
import { Banner, Button, StatusDot } from "@repo/ui";
import type { ManagedRuntime } from "effect";
import { useSyncExternalStore } from "react";
import type { Machine as ControlMachine } from "../../gen/app__control.effect.vibe";
import { useMachine } from "../../gen/app__control.react.ts";
import type { Alpha } from "../runtime/ui.tsx";
import {
  type ControlLeaseRequests,
  ControlLeaseRequests as LeaseRequestsService,
  type ExternalControl,
  type LeaseRequest,
  approvePendingLeaseRequest,
  dismissPendingLeaseRequest,
  externalControl,
  triggerControlKillSwitch,
} from "./control.vibe";

export interface ControlBannerProps {
  /** Runtime providing the external-app control machine and resident agent control client. */
  readonly runtime: ManagedRuntime.ManagedRuntime<ControlMachine | ExternalControl | ControlLeaseRequests, unknown>;
}

type LeaseRequestStore = {
  readonly get: () => LeaseRequest | undefined;
  readonly subscribe: (notify: () => void) => () => void;
};

const requestStores = new WeakMap<object, LeaseRequestStore>();

function leaseRequestStoreFor(
  runtime: ManagedRuntime.ManagedRuntime<ControlMachine | ExternalControl | ControlLeaseRequests, unknown>,
): LeaseRequestStore {
  const existing = requestStores.get(runtime);
  if (existing !== undefined) return existing;
  let current: LeaseRequest | undefined;
  const listeners = new Set<() => void>();
  let active: object | undefined;
  let stopInner: (() => void) | undefined;
  const notify = (next: LeaseRequest | undefined) => {
    if (Object.is(current, next)) return;
    current = next;
    for (const listener of [...listeners]) listener();
  };
  const store: LeaseRequestStore = {
    get: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      if (active === undefined) {
        const token = {};
        active = token;
        void runtime.runPromise(LeaseRequestsService).then((requests) => {
          if (active !== token) return;
          notify(requests.snapshot());
          stopInner = requests.subscribe(() => {
            if (active === token) notify(requests.snapshot());
          });
        }, () => undefined);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          active = undefined;
          stopInner?.();
          stopInner = undefined;
          current = undefined;
        }
      };
    },
  };
  requestStores.set(runtime, store);
  return store;
}

/**
 * Compact system-overlay banner showing pending owner control lease approvals and active
 * third-party app control leases with an immediate Stop kill-switch.
 * @model spec/app/control/index.md
 */
export function ControlBanner({ runtime }: ControlBannerProps) {
  const { state, can } = useMachine(runtime);
  const requestStore = leaseRequestStoreFor(runtime);
  const pendingRequest = useSyncExternalStore(requestStore.subscribe, requestStore.get, requestStore.get);
  if (state === undefined) return null;
  if (state.lease.status !== "LeaseActive" && !state.pending.active) {
    if (pendingRequest === undefined) return null;
    const approve = () => {
      void runtime.runPromise(approvePendingLeaseRequest());
    };
    const dismiss = () => {
      void runtime.runPromise(dismissPendingLeaseRequest());
    };
    return (
      <Banner
        data-alpha-control-lease-request=""
        variant="info"
        aria-label="Approve external app control"
        action={
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={dismiss}>Dismiss</Button>
            <Button variant="primary" size="sm" onClick={approve}>Approve</Button>
          </div>
        }
      >
        <div className="flex items-center gap-2">
          <StatusDot status="busy" label="Approval requested" />
          <span className="truncate text-sm font-medium text-foreground">
            Allow Alpha in {pendingRequest.packageName}
          </span>
        </div>
      </Banner>
    );
  }
  const busy = state.pending.active;
  const canStop = can({ type: "killSwitch" }, "Owner");
  const steps = `${state.lease.usedOps}/${state.lease.maxOps}`;
  const stop = () => {
    void runtime.runPromise(triggerControlKillSwitch("kill_switch"));
  };
  return (
    <Banner
      data-alpha-control-banner=""
      variant="info"
      aria-label="External app control"
      action={canStop ? <Button variant="destructive" size="sm" onClick={stop}>Stop</Button> : null}
    >
      <div className="flex items-center gap-2">
        <StatusDot status={busy ? "busy" : "ok"} label={busy ? "Acting" : "Active"} />
        <span className="truncate text-sm font-medium text-foreground">
          {busy ? "Alpha acting in app" : "Alpha control active"}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">{steps}</span>
      </div>
    </Banner>
  );
}

const controlRuntimes = new WeakMap<Alpha, ManagedRuntime.ManagedRuntime<ControlMachine | ExternalControl | ControlLeaseRequests, unknown>>();

function controlRuntimeFor(alpha: Alpha) {
  const existing = controlRuntimes.get(alpha);
  if (existing !== undefined) return existing;
  const created = alpha.over(externalControl);
  controlRuntimes.set(alpha, created);
  return created;
}

/** Overlay-scoped host that lazily binds the external-app control runtime over `alpha` and mounts `ControlBanner`. */
export function OverlayControlBanner({ alpha }: { readonly alpha: Alpha }) {
  return <ControlBanner runtime={controlRuntimeFor(alpha)} />;
}
