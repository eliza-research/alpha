# 9. Gap pass: connection-ui.tsx, native connection, local agent, delegation

Single-pass findings from a second auditor covering files the first pass read only in part. Not adversarially verified; each is re-verified before a fix.

**Scope.** All five TS files were read in full (connection-ui.tsx 1–2855), plus the three specs. No "earlier unverified claims" list was included in the task text, so there are no per-claim verdicts; everything below was verified by reading. Abbreviations: CU = connection-ui.tsx, NC = native-connection.ts, LA = local-agent.ts, CD = cloud-delegation-ui.tsx, CS = cloud-sign-in-ui.tsx (all under `apps/app/src/runtime/`).

## A. Model-vs-code discrepancies

1. **Outage admission (ServiceAuthorization).** The spec drops snapshot/credit admission on a refresh outage (`refreshOutage` :47-57; `creditRefreshFailureTest` :113, `snapshotWithoutExpiryTest` :110). The code keeps or re-admits from a 7-day localStorage record for any status, including `credit-funded` and billing-limits (CU:226, 241-247, 809-811, 836-837, 844). The record is not bound to the signed entitlement's lifetime, so `ExpiryHonest` (:89) has no code analogue.
2. **Binding states (ResidentRuntime).** The spec has provider ∈ {none, cloud, unconfirmed} (:91). The code has `residentBinding` ∈ {cloud, unbound, kept, unknown, null} (CU:329). `kept` is unmodeled and surfaces as `residentInference: 'unknown'` ("Connecting…" / "Status unconfirmed") (CU:993, 1806, 2737).
3. **Bind ordering.** The spec's `beginBinding` requires `phase == "ready"` (:33-36). The code binds before start: stop → `configureCloudProvider` → start (LA:379-385; CU:949-954).
4. **Epoch fence.** `inference` requires `bindingEpoch == epoch` (:43-47). `residentBinding` carries no epoch and is not reset by `retire()` (CU:509-525), yet drives rebind decisions (CU:902-903, 2210).
5. **Start during recovery.** The spec allows `start` only from `stopped` (:25-28). Only `startLocal` and auto-retry check `residentRecoveryReason` (CU:1978, 630); `ensureResident`, `queueResidentRebind` and `recheckResidentPlan` attempt starts in recovery (CU:651-656, 687-702, 898).
6. **IdentitySession gaps.**
   - Google → MFA and MFA resume after restart are unmodeled; the spec's `callback` goes straight to `exchange` (:28-34) versus CU:461-465, 2127-2136.
   - Resend re-begins from `code` (CU:2080-2082); the spec's `begin` excludes `code` (:17).
   - There is no MFA wrong-code or expiry bound in the spec; the UI never enforces `expiresAt` (CS:81-89).
   - The JS has no `exhausted` state: a wrong code keeps the step indefinitely (CU:2111).
7. **Cancel after key commit.** The spec says cancel after the key is written cannot undo it (:79-85). The browser login path removes the just-written key on abort, after the old key was already replaced (NC:209-213; cloud-protocol.ts:523).
8. **Post-issue key deletion** (CU:482-485, 1502) has no spec transition.
9. **Sign-out.** The spec's `signOut` is atomic (:96-100). The code runs about six steps with partial-failure states (CU:2270-2296); ServiceAuthorization has no sign-out at all.
10. **Vacuous invariants.** `LocalIndependent = s.localReady` never changes (:13, :92); `failures` (:52) guards nothing; ResidentRuntime's `history == 1`, `packaged` and `profile` guard nothing (:89, :18-21).

## B. Unmodeled state machines

1. **Operation mutex** (CU:271-274, 604-622).
   - States: idle; `work()`; background recheck (operation set, `busy` false; CU:899); truncate (CU:2333); voice-prepare (CU:2355).
   - Queued events: `residentRebindQueued`, `queuedSignInReturn`.
   - Invariant at risk: every release drains the queues, and operation set implies busy shown.
2. **Resident presence, P-43** (CU:126, 626-670).
   - States: starting / recovering / resident, plus `residentRecoveryReason`, auto-retry count (0–4) and `residentStarting`.
   - Invariant at risk: no session implies a start is in flight, a retry is scheduled, or the owner has been asked.
3. **Sign-in view** (CU:138-143, 430-435, 563-580).
   - States: choose / google / code / mfa, × `signInPending`, × `methodsRefresh`, × `inAppReturnToStart`.
   - Invariants at risk: a pending step is sent at most once, and a refused MFA method cannot dead-end.
   - Email-path passkey sets `mfa` then immediately resets to `choose` (CU:2100-2102, 2111), so the passkey branch at CS:83 is reachable only via Google.
4. **Plan admission and refresher** (CU:788-867, 872-907, 2203-2222).
   - Events: visibility / online / refusal / redeem.
   - Invariant at risk: bounded rebinds per event, and no rebind while a turn is in flight.
5. **Cloud delegation** (CD:19-25).
   - States: none / waiting / finishing (+code), × native retained callback, × `locked`.
   - Invariants at risk: a retained callback is eventually consumed or cleared, and `finishing` cannot be stuck.
6. **Stopped-reply reconciliation** (CU:1226-1267): single timer, cancel attempt, one read.
7. **Modal ownership.** On production Android `open` is derived on every `update()` from the error string and the wall clock (CU:504, 2490-2500).
8. **Personal setup intent**, test-mocks only (CU:356-406, 1434-1456).

## C. Defects

1. **Native start cancellation is dead code — high.**
   - `nativeBridge` is `start:()=>native.start()` with no `cancelStart` (LA:36); `connect()` generates a `requestId` and calls `bridge.cancelStart?.` (LA:121-129).
   - Native implements both (AlphaLocalAgentPlugin.java:506-513, 589-597).
   - Scenario: the owner cancels "Starting…"; the native launch continues unowned.
   - Fix: `start:input=>native.start(input), cancelStart:input=>native.cancelStart(input)`.
2. **Background plan recheck blocks sends and swallows taps — high.**
   - `recheckResidentPlan` sets `operation` without `busy` (CU:899), on every foreground/online event when the binding is not `cloud` (CU:2210, 2573).
   - Meanwhile `send()` throws "Finish the connection…" (CU:2363), `work()` returns silently (CU:605), and redeem returns false (CU:2176) with buttons still enabled.
   - Fix: use a separate recheck controller, not `operation`.
3. **Any 401 is treated as Cloud sign-in expiry — medium.**
   - `expired()` and `errorMessage` are source-agnostic (CU:534-537, 597); auth-page visibility keys on that string (CU:2491).
   - Scenario: a 401 from the on-device agent during send (CU:2471-2473) retires the resident with no restart scheduled, and forces the full-screen Cloud sign-in.
   - Fix: map only `CloudProtocolError` 401s to sign-in expiry; for the resident, set `recovering` and call `ensureResident()`.
4. **Saved-sign-in wait loop restarts everything; offline cold start locks the launcher — high for the churn, medium on intent.**
   - Every 4–60 s, and on online/visibility, it calls `startLocal()` (CU:2534-2543), which retires and fully reconnects (CU:1978): device re-registration, up to 10 history pages (CU:1000, 1314-1340), and `clearLocalProvider` when no recent admission exists (CU:811, 932).
   - `productionCloudSignInRequired` ignores `residentPlanNotice === 'offline'` (CU:2491), so an offline cold start with a saved key shows the inert auth page (CU:2617-2618, 2674-2679).
   - This contradicts CU:213, 255 and 1807.
   - Fix: exclude offline-with-saved-credential from the gate; retry admission only.
5. **Stale `planEndsAt` is re-persisted — medium.**
   - `endsAt` falls back to the old record or in-memory value (CU:846, 863).
   - Scenario: after a renewal in a long-lived process, the past date is rewritten, so `recentPlanAdmission` returns null (CU:245). Offline grace is lost, the next outage unbinds and restarts, and the UI shows "Plan runs until <past>" (CU:2741).
   - Fix: discard `endsAt <= now`.
6. **Credential read failure prevents the agent starting — medium.**
   - `cloudCredentialStore.read` (CU:794) sits outside any try and can throw on a keystore error or `JSON.parse` (NC:189-191).
   - `connectResident` then throws before `client.connect`; after four retries the agent stays down, contradicting CU:783-787.
   - Fix: catch it and return unbound with a notice.
7. **`retire()` never disconnects the resident client — high on fact, low-to-medium impact.**
   - CU:509-525 never calls `LocalAgentProtocol.disconnect()`.
   - Old voice subscriptions keep passing their guard (LA:97) and stream controllers leak (LA:225) across every rebind.
   - Fix: `if(active?.kind==='resident')void active.remote.disconnect()`.
8. **Queued work is stranded — medium.**
   - `truncateMessage` and `prepareVoiceConversation` clear `operation` (CU:2345, 2358) without `runQueuedResidentRebind`, `runQueuedSignInReturn` or `holdOperation` (compare CU:621).
   - A plan-ended unbind or Google return that arrives then waits for an unrelated later `work()`.
   - Fix: one shared release helper.
9. **Cloud delegation.**
   - (a) A callback event arriving while `locked` is dropped (CD:64, 180); `start()` holds the lock across `openConnectionBrowser` (CD:229), and "Check status" never re-reads the native callback (CD:79-84). Medium. Fix: set a queued flag and rerun after unlock.
   - (b) Mismatched or expired callbacks are never cleared (CD:128-133, 145-150). Medium.
   - (c) `finishing` disables Cancel (CD:291), so it is stuck if `complete` keeps failing. Low to medium.
   - (d) Slot `cloud-delegation:v1:` is rejected by the browser slot regex (CD:51; NC:52). High, web/dev only.
   - (e) `grantId` is not reset on scope change (CD:49, 186), and a throw from `refreshRevocations` after a successful revoke reports "not confirmed" (CD:314-326). Low.
10. **Unbounded rebind on binding mismatch — medium-low.**
    - With `residentBinding` at `unknown`, or `unbound` after a bind failure (CU:925-932), every foreground past 60 s queues a full rebind (CU:903).
    - That rebind calls `retire()`, aborting any in-flight turn (CU:520); only `recheckPlanAfterRefusal` guards `sending` (CU:2219).
    - Fix: skip while `sending`; add backoff.
11. **Sign-out not persisted in degraded web storage — medium-low, web only.**
    - A transient IndexedDB error flips `degraded` permanently, so removal hits the memory backend only (NC:122) and the key returns after reload.
    - Fix: do not degrade on writes or removes.
12. **`execute` caches rejected promises per proposal — medium-low.**
    - CU:1573-1584: a pre-dispatch failure (review cancelled, context changed) blocks re-approval for the whole session.
    - Fix: delete the entry on pre-`approve` failure.
13. **Fresh key deleted on any non-outage identity failure — low to medium.**
    - CU:482-485 with `cloudUnreachable` at CU:249-254: malformed responses and non-401/403 4xx count as refusal.
    - Fix: delete only on a 401/403 refusal.
14. **Sign-out blocked by background retirement failure — low.**
    - `cloudSignOut` does `await retire()` (CU:2280), so a retirement rejection aborts after the plan state is wiped but before key removal. Compare `void retire()` at CU:1919.
15. **Performance.**
    - Aborts are not propagated to native requests (LA:36, 112).
    - `stopLocalAgent` polls every 200 ms for up to 30 s, with a rejection escaping the loop (LA:390-395).
    - `abortTurn` lists conversations on each call (LA:285).
    - Keystore is rewritten on every connect (CU:981).
    - `expiresAt` silently replaces `timeoutMs` (NC:242).

Checked, not a defect: the un-awaited `captureConversationChoice` on Android (CU:1296, 1604) is synchronous there (conversation-selection.ts:24-27).

## D. Modeling opportunities

**New Quint modules**
- `ConnectionOperation`: mutex plus queues. Invariants: `ReleaseDrainsQueues`, `OperationImpliesBusyOrBackgroundSendAllowed`.
- `ResidentPresence`: `NoAgentlessQuiescence` (P-43), `RecoveryNeverAutoStarts`, `BoundedRebindsPerEvent`, `NoRebindWhileSending`.
- `PlanAdmissionCache`: grace record versus signed lifetime. Invariants: `EndsAtNotPast`, `GraceBoundToCredential`. This would reconcile A1.
- `CloudDelegation`: `CallbackEventuallyConsumed`, `CompleteAtMostOncePerTap`, `FinishingEscapable`.
- `SignInView`: `PendingSentOnce`, `KeyCommitSurvivesCancel` (catches A7), plus Google-MFA and resume.
- Extend ResidentRuntime with `kept`, bind-while-stopped and JS-side `cancelStart`; make `localReady` mutable in ServiceAuthorization.

**Pure functions suited to pre/postcondition checks**
- `recentPlanAdmission` (parameterise `now`), `cloudUnreachable`, `expired`
- `productionCloudSignInRequired`, `connectionChooserVisible`
- `selection()` migration table
- `restoredText` (round-trip with `phoneContextMessage`)
- `readConversation` paging merge: no duplicates, ordered, ≤ 2000
- `presentActionEntry`, `planAdmission`
- `browserConnectionSlot`, `modelLabel`, `parseProviderStatus`
- CS address classification (`submitAddress`), `normalizeSignInCode`
- CD `start()` authUrl validation
- Java: `cancelStart` ownership predicate
