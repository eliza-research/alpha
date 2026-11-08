# Current permission coordinator refinement

The adapter runs `StartupPermissions`, the staged shared permission-step flow,
Alpha's versioned progress store and the browser permission provider. Android
uses seven ordered steps. Browser builds use four. Progress, skipped choices and
completion markers describe installation UI intent. Every feature still reads
current platform access.

## State correspondence

The model has 36 state fields. The adapter also checks derived visibility, busy
state, the displayed permission and the primary button's disabled state against
actual DOM/ref observations.

- The caller prop, connection snapshot, Google-panel snapshot and React state
  provide the visibility and ownership inputs. `setupReady` records whether the
  source setup revision is present.
- React state/refs provide active, ready, reopened, review, progress, choices,
  selected target, permission states, skip availability, notices and disclosure
  descriptions. The two description refs retain the actual location-accuracy and
  photo-access wording.
- The actual progress reader and stored document provide durable position,
  optional durable choices, completion and historical-version classification.
  A failed write may advance the current UI while leaving the stored position
  behind. Remount then resumes the stored position.
- A read-only build-time observer captures the component's local request ticket,
  key and starting state. A second observer reads the shared flow's real pending
  ownership. The observer adds no await or change to a return value or guard.
- `operations` records platform requests that have started and have not settled
  for the current component instance. `flowTickets` separately records whether
  the shared step still owns that call. Cancelling a flow does not manufacture
  platform cancellation. Old-instance returns are observed after remount.
- Native calls, persisted attempt markers, dismissal memory and the real
  `launcher-home` event provide request, attempt, dismissal and Home counters.

## Source repair

Credential, environment, enabled-prop and setup-revision changes invalidate UI
ownership during the layout-effect commit and release its busy state. A live
connection-snapshot check also fences completions before React commits the new
identity. Completion, catch and finally require the captured generation and
current context. An old operation cannot advance another owner's setup or clear
its newer operation's busy state.

The source keeps the current session usable if progress storage fails. The model
preserves that behavior, the explicit 20-second skip, read-only reviews of
completed installations and the four historical native progress versions.
Account-created completion presentation can recur on component remount while
the controller retains `accountCreated` and `setupRevision`. This is recorded
source behavior. No once-per-account display property is claimed.

## Current validation

The source suite passes 44 traces and 254 checkpoints with all 36 modeled state
fields and four derived observations checked. Source and driver hashes remain
unchanged. Schedules include immediate and deferred-effect owner changes,
setup-revision and environment changes, direct-provider setup without a Cloud account,
disabled owners, rejection, outstanding old calls,
same-key rechecking after cancellation, read-only reviews, failed/dropped
progress writes, legacy completion, and late browser media cleanup.

The current coordinator test and 47 adjacent permission tests pass. The model
retains separate native and browser initializers. Simulation and symbolic runs
record their bounds in the run evidence, independently of the source trace
checks.

## Remaining boundaries

The source observer runs React and DOM in JSDOM with controlled native/browser
ports. Arbitrary provider failures, every browser timeout/query-failure branch,
real OS dialogs, and native/device acceptance remain separate obligations.
Attempt-marker storage succeeds in these coordinator traces. Its failure is
covered by the separate `StartupPermissions` flow contract. These bounded
observations do not establish universal implementation refinement.
