# External app control

How the resident agent observes and acts inside third-party Android apps
such as Firefox without bypassing the owner's consent or screen security.
The owner grants a bounded lease for one target app at a time; at most one
operation runs at once; every UI operation binds the live observation
snapshot and foreground app; protected screens and blocked security packages
are always refused; and the kill-switch halts actuation and revokes the
lease immediately.

## Story: Control a third-party app within an owner-approved lease

> As the owner, I want to approve Alpha to work inside an app like Firefox
> for a bounded number of steps, and know it cannot act on locked, private,
> or security screens, act on stale screens, or keep going after I tap Stop.

### The control state tracks the active capability tier, latest foreground observation, bounded lease, single in-flight operation, and kill-switch

```quint
type Actor = Owner | Agent | Phone
type TargetKind = AllowedApp | BlockedApp | NoTarget
type ScreenProtection = ScreenClear | ScreenLocked | SecureFlag | PrivateTab | SensitiveView
type LeaseStatus = LeaseInactive | LeaseActive | LeaseRevoked
type ControlTier = TierNone | TierAccessibility | TierPrivileged
type ExecutionOutcome = OutcomeDone | OutcomeRefused | OutcomePreempted
type ControlOp =
  OpLaunchPackage | OpOpenUrl | OpReadTree | OpCaptureScreen
  | OpClick | OpSetText | OpScroll | OpKeyEvent | OpGesture | OpGlobalAction
  | OpFunctionsDiscover | OpFunctionExecute

type Snapshot = { snapId: int, appId: int, targetKind: TargetKind, protection: ScreenProtection }
type ControlLease = { leaseId: int, appId: int, maxOps: int, usedOps: int, expiresAt: int, status: LeaseStatus }
type PendingOp = { pendingId: int, op: ControlOp, boundSnapId: int, boundAppId: int, active: bool }
type ControlEffect =
  | DispatchOp({ opId: int, op: ControlOp, snapId: int, appId: int })
  | HaltBridge({ reason: str })
  | ClearOverlay

type ControlState = {
  tier: ControlTier,
  foreground: Snapshot,
  lease: ControlLease,
  pending: PendingOp,
  lastResult: ExecutionOutcome,
  lastOpId: int,
  killed: bool,
}
type ControlMoved = { state: ControlState, out: List[ControlEffect] }

pure val maxLeaseOps = 12

pure val initial: ControlState = {
  tier: TierNone,
  foreground: { snapId: 0, appId: 0, targetKind: NoTarget, protection: ScreenClear },
  lease: { leaseId: 0, appId: 0, maxOps: 0, usedOps: 0, expiresAt: 0, status: LeaseInactive },
  pending: { pendingId: 0, op: OpReadTree, boundSnapId: 0, boundAppId: 0, active: false },
  lastResult: OutcomeDone,
  lastOpId: 0,
  killed: false,
}

pure def screenProtected(p: ScreenProtection): bool = p != ScreenClear

pure def requiresSnapshot(op: ControlOp): bool =
  op != OpLaunchPackage and op != OpOpenUrl and op != OpFunctionsDiscover

pure def leaseUsable(l: ControlLease, appId: int, now: int): bool =
  l.status == LeaseActive and l.appId == appId and l.usedOps < l.maxOps and now < l.expiresAt

pure val tierValues = Set(TierNone, TierAccessibility, TierPrivileged)
pure val snapIdValues = Set(0, 1, 2)
pure val appIdValues = Set(0, 1, 2)
pure val leaseIdValues = Set(1, 2)
pure val opIdValues = Set(1, 2)
pure val maxOpsValues = Set(1, 2)
pure val nowValues = Set(1, 5)
pure val expiresAtValues = Set(4, 8)
pure val weight_setTier = 10
pure val weight_observe = 15
pure val weight_grantLease = 15
pure val weight_dispatch = 25
pure val weight_finish = 15
pure val weight_killSwitch = 10
```

### The phone reports its native control tier, and losing access immediately revokes any active lease and halts pending work

```quint
pure def canSetTier(c: ControlState, tier: ControlTier, by: Actor): bool =
  by == Phone and tier != c.tier

pure def setTier(c: ControlState, tier: ControlTier, by: Actor): ControlMoved =
  if (tier == TierNone) {
    state: {
      ...c,
      tier: TierNone,
      lease: if (c.lease.status == LeaseActive) { ...c.lease, status: LeaseRevoked } else c.lease,
      pending: { ...c.pending, active: false },
    },
    out: if (c.pending.active) List(HaltBridge({ reason: "tier_disabled" }), ClearOverlay) else List(ClearOverlay),
  } else {
    state: { ...c, tier: tier },
    out: List(),
  }
```

### Each phone observation advances the snapshot id, preempts in-flight work if the screen turns protected, blocked, or leaves the bound app, and revokes any lease on screen lock

```quint
pure def canObserve(c: ControlState, snapId: int, appId: int, targetKind: TargetKind, protection: ScreenProtection, by: Actor): bool =
  by == Phone and snapId > c.foreground.snapId and appId >= 0

pure def observe(c: ControlState, snapId: int, appId: int, targetKind: TargetKind, protection: ScreenProtection, by: Actor): ControlMoved =
  val nextSnap: Snapshot = { snapId: snapId, appId: appId, targetKind: targetKind, protection: protection }
  val preempt = c.pending.active and (
    screenProtected(protection) or targetKind == BlockedApp
      or (requiresSnapshot(c.pending.op) and (appId != c.pending.boundAppId or targetKind != AllowedApp))
  )
  val revoke = protection == ScreenLocked and c.lease.status == LeaseActive
  {
    state: {
      ...c,
      foreground: nextSnap,
      lease: if (revoke) { ...c.lease, status: LeaseRevoked } else c.lease,
      pending: if (preempt) { ...c.pending, active: false } else c.pending,
      lastResult: if (preempt) OutcomePreempted else c.lastResult,
    },
    out: if (preempt) List(HaltBridge({ reason: "screen_changed" })) else List(),
  }
```

### Only the owner may grant a bounded lease for a target app while the screen is clear, unblocked, idle, and backed by an active tier

```quint
pure def canGrantLease(c: ControlState, leaseId: int, appId: int, maxOps: int, expiresAt: int, now: int, by: Actor): bool =
  by == Owner and c.tier != TierNone and leaseId > c.lease.leaseId and appId > 0
    and maxOps >= 1 and maxOps <= maxLeaseOps and expiresAt > now
    and not(c.pending.active) and c.foreground.targetKind != BlockedApp and not(screenProtected(c.foreground.protection))

pure def grantLease(c: ControlState, leaseId: int, appId: int, maxOps: int, expiresAt: int, now: int, by: Actor): ControlMoved =
  {
    state: {
      ...c,
      lease: { leaseId: leaseId, appId: appId, maxOps: maxOps, usedOps: 0, expiresAt: expiresAt, status: LeaseActive },
      killed: false,
    },
    out: List(),
  }
```

### The agent dispatches one operation at a time only under an active lease on a clear unblocked screen, binding the exact live snapshot for every UI operation

Launching an app, opening an HTTPS URL, or discovering AppFunctions may run
before the target app is foregrounded, provided the current screen is clear
and unblocked; every UI observation or actuation operation binds the exact
foreground app and live snapshot id.

```quint
pure def canDispatch(c: ControlState, opId: int, op: ControlOp, snapId: int, appId: int, now: int, by: Actor): bool =
  by == Agent and c.tier != TierNone and not(c.killed) and not(c.pending.active)
    and opId > c.lastOpId and not(screenProtected(c.foreground.protection))
    and c.foreground.targetKind != BlockedApp and leaseUsable(c.lease, appId, now)
    and (requiresSnapshot(op) implies (
      c.foreground.targetKind == AllowedApp and c.foreground.appId == appId
        and snapId > 0 and snapId == c.foreground.snapId
    ))

pure def dispatch(c: ControlState, opId: int, op: ControlOp, snapId: int, appId: int, now: int, by: Actor): ControlMoved =
  {
    state: {
      ...c,
      lease: { ...c.lease, usedOps: c.lease.usedOps + 1 },
      pending: { pendingId: opId, op: op, boundSnapId: snapId, boundAppId: appId, active: true },
      lastOpId: opId,
    },
    out: List(DispatchOp({ opId: opId, op: op, snapId: snapId, appId: appId })),
  }
```

### The phone reports when the in-flight operation finishes, and physical preemption revokes the lease and engages the kill-switch

```quint
pure def canFinish(c: ControlState, opId: int, verdict: ExecutionOutcome, by: Actor): bool =
  by == Phone and c.pending.active and c.pending.pendingId == opId

pure def finish(c: ControlState, opId: int, verdict: ExecutionOutcome, by: Actor): ControlMoved =
  val preempted = verdict == OutcomePreempted
  {
    state: {
      ...c,
      lease: if (preempted and c.lease.status == LeaseActive) { ...c.lease, status: LeaseRevoked } else c.lease,
      pending: { ...c.pending, active: false },
      lastResult: verdict,
      killed: if (preempted) true else c.killed,
    },
    out: if (preempted) List(HaltBridge({ reason: "preempted" })) else List(),
  }
```

### An expired lease is revoked and halts any in-flight operation

```quint
pure def canExpireLease(c: ControlState, now: int, by: Actor): bool =
  by == Phone and c.lease.status == LeaseActive and now >= c.lease.expiresAt

pure def expireLease(c: ControlState, now: int, by: Actor): ControlMoved =
  {
    state: {
      ...c,
      lease: { ...c.lease, status: LeaseRevoked },
      pending: { ...c.pending, active: false },
    },
    out: if (c.pending.active) List(HaltBridge({ reason: "lease_expired" })) else List(),
  }
```

### The kill-switch immediately revokes any active lease, clears any in-flight operation, and signals the native bridge and overlay

```quint
pure def canKillSwitch(c: ControlState, by: Actor): bool =
  (by == Owner or by == Phone) and (c.lease.status == LeaseActive or c.pending.active or not(c.killed))

pure def killSwitch(c: ControlState, by: Actor): ControlMoved =
  {
    state: {
      ...c,
      lease: if (c.lease.status == LeaseActive) { ...c.lease, status: LeaseRevoked } else c.lease,
      pending: { ...c.pending, active: false },
      killed: true,
    },
    out: List(HaltBridge({ reason: "kill_switch" }), ClearOverlay),
  }
```

## Story: Enforce formal safety guarantees over external app control

> As the owner, I want hard guarantees that no agent action runs on a
> protected or blocked screen, on a stale snapshot, past its lease budget,
> or after the kill-switch is pressed.

### No operation is ever active on a protected screen, while killed, or without a live control tier

```quint
pure def alwaysNoActionOnProtectedScreen(c: ControlState): bool =
  c.pending.active implies (not(screenProtected(c.foreground.protection)) and not(c.killed) and c.tier != TierNone)
```

### No operation is ever active over a blocked package, and snapshot-bound operations only run over an allowed foreground app

```quint
pure def alwaysBlockedPackagesProtected(c: ControlState): bool =
  c.pending.active implies (
    c.foreground.targetKind != BlockedApp
      and (requiresSnapshot(c.pending.op) implies c.foreground.targetKind == AllowedApp)
  )
```

### Every active snapshot-bound operation matches the foreground app and carries a positive snapshot id no newer than the current observation

```quint
pure def alwaysNoStaleSnapshotActuation(c: ControlState): bool =
  (c.pending.active and requiresSnapshot(c.pending.op)) implies (
    c.pending.boundAppId == c.foreground.appId
      and c.pending.boundSnapId > 0
      and c.pending.boundSnapId <= c.foreground.snapId
  )
```

### Every lease stays within its operation budget, and any active operation belongs to the active lease

```quint
pure def alwaysLeaseBounded(c: ControlState): bool =
  c.foreground.snapId >= 0 and c.lease.leaseId >= 0 and c.lastOpId >= 0
    and c.lease.maxOps >= 0 and c.lease.maxOps <= maxLeaseOps
    and c.lease.usedOps >= 0 and c.lease.usedOps <= c.lease.maxOps
    and (c.pending.active implies (
      c.lease.status == LeaseActive and c.lease.appId == c.pending.boundAppId and c.lease.usedOps > 0
    ))
```

### The kill-switch halts immediately, and every dispatched effect honors exact live snapshot, lease, and screen safety

```quint
pure def stepKillSwitchHaltsImmediately(before: ControlState, via: str, after: ControlState, out: List[ControlEffect]): bool =
  (via == "killSwitch" implies (
    after.killed and not(after.pending.active) and after.lease.status != LeaseActive
      and out.some(e => match e { | HaltBridge(_) => true | _ => false })
  ))
    and out.every(e => match e {
      | DispatchOp(d) =>
        via == "dispatch"
          and not(screenProtected(before.foreground.protection))
          and before.foreground.targetKind != BlockedApp
          and before.lease.status == LeaseActive
          and before.lease.usedOps < before.lease.maxOps
          and d.appId == before.lease.appId
          and (requiresSnapshot(d.op) implies (
            before.foreground.targetKind == AllowedApp
              and d.appId == before.foreground.appId
              and d.snapId == before.foreground.snapId
          ))
      | _ => true
    })
```

### Protected screens, blocked apps, stale snapshots, exhausted leases, and engaged kill-switches always refuse dispatch

```quint
pure def lawProtectedScreenRefusesDispatch(c: ControlState, opId: int, op: ControlOp, snapId: int, appId: int, now: int, by: Actor): bool =
  screenProtected(c.foreground.protection) implies not(canDispatch(c, opId, op, snapId, appId, now, by))

pure def lawBlockedAppRefusesDispatch(c: ControlState, opId: int, op: ControlOp, snapId: int, appId: int, now: int, by: Actor): bool =
  c.foreground.targetKind == BlockedApp implies not(canDispatch(c, opId, op, snapId, appId, now, by))

pure def lawStaleSnapshotRefusesDispatch(c: ControlState, opId: int, op: ControlOp, snapId: int, appId: int, now: int, by: Actor): bool =
  (requiresSnapshot(op) and snapId != c.foreground.snapId) implies not(canDispatch(c, opId, op, snapId, appId, now, by))

pure def lawExhaustedLeaseRefusesDispatch(c: ControlState, opId: int, op: ControlOp, snapId: int, appId: int, now: int, by: Actor): bool =
  (c.lease.usedOps >= c.lease.maxOps or now >= c.lease.expiresAt) implies not(canDispatch(c, opId, op, snapId, appId, now, by))

pure def lawKilledStateRefusesDispatch(c: ControlState, opId: int, op: ControlOp, snapId: int, appId: int, now: int, by: Actor): bool =
  c.killed implies not(canDispatch(c, opId, op, snapId, appId, now, by))
```

### The model can dispatch a UI click, launch an app before foregrounding, exhaust a lease, and halt on the kill-switch

```quint
pure def sometimesOpDispatched(c: ControlState): bool =
  c.pending.active and c.pending.op == OpClick

pure def sometimesLaunchBeforeForeground(c: ControlState): bool =
  c.pending.active and c.pending.op == OpLaunchPackage and c.foreground.appId != c.pending.boundAppId

pure def sometimesLeaseExhausted(c: ControlState): bool =
  c.lease.status == LeaseActive and c.lease.maxOps > 0 and c.lease.usedOps == c.lease.maxOps

pure def sometimesKillSwitchStopped(c: ControlState): bool =
  c.killed and c.lease.status == LeaseRevoked

pure val eval_witness_sometimesOpDispatched = (
  ("setTier", TierPrivileged, Phone),
  ("observe", 1, 1, AllowedApp, ScreenClear, Phone),
  ("grantLease", 1, 1, 2, 8, 1, Owner),
  ("dispatch", 1, OpClick, 1, 1, 1, Agent),
)
pure val eval_witness_sometimesLaunchBeforeForeground = (
  ("setTier", TierPrivileged, Phone),
  ("grantLease", 1, 1, 2, 8, 1, Owner),
  ("dispatch", 1, OpLaunchPackage, 0, 1, 1, Agent),
)
pure val eval_witness_sometimesLeaseExhausted = (
  ("setTier", TierPrivileged, Phone),
  ("observe", 1, 1, AllowedApp, ScreenClear, Phone),
  ("grantLease", 1, 1, 1, 8, 1, Owner),
  ("dispatch", 1, OpClick, 1, 1, 1, Agent),
)
pure val eval_witness_sometimesKillSwitchStopped = (
  ("setTier", TierPrivileged, Phone),
  ("grantLease", 1, 1, 1, 8, 1, Owner),
  ("killSwitch", Owner),
)
pure val eval_witness_canFinish = (
  ("setTier", TierPrivileged, Phone),
  ("observe", 1, 1, AllowedApp, ScreenClear, Phone),
  ("grantLease", 1, 1, 2, 8, 1, Owner),
  ("dispatch", 1, OpClick, 1, 1, 1, Agent),
  ("finish", 1, OutcomeDone, Phone),
)
pure val eval_witness_canExpireLease = (
  ("setTier", TierPrivileged, Phone),
  ("grantLease", 1, 1, 1, 4, 1, Owner),
  ("expireLease", 5, Phone),
)
```
