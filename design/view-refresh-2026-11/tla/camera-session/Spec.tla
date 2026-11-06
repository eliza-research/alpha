---- MODULE Spec ----
(***************************************************************************)
(* Alpha Phone Camera view: session lifecycle, capture and agent capture.  *)
(*                                                                         *)
(* Code modelled (repo /home/shaw/Work/alphaphone):                        *)
(*  CA = apps/app/src/prototype/camera-adapter.ts                          *)
(*  CP = vendor/eliza/plugins/plugin-native-camera/.../CameraPlugin.kt     *)
(*                                                                         *)
(* Proposal: design/view-refresh-2026-11/PLAN.md section 1.                *)
(*                                                                         *)
(* Fix* = FALSE models the code as written; TRUE models the proposed       *)
(* design. AsBuilt_*.cfg turn one fix off each, to reproduce that defect;  *)
(* Design.cfg turns every fix on and must pass.                            *)
(*                                                                         *)
(* Abstractions:                                                           *)
(*  - epoch counts sessions (CA `epoch`); it is bounded by MaxEpoch so the *)
(*    state space is finite. That is a model bound, not product behaviour. *)
(*  - media counts items committed to MediaStore. thumb is the count the   *)
(*    last-capture tile reflects; Photos lists exactly `media`.            *)
(*  - zoom has two values: "one" (valid on every lens) and "half"          *)
(*    (ultra-wide, back lens only).                                        *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS FixFocus,       \* tap-to-focus never blocks the shutter (CA:668,811)
          FixLeave,       \* leaving settles an in-flight photo (CP:372,518)
          FixLens,        \* flip resets settings first; flash hidden on front (CP:439, CA:807)
          FixAgentQueue,  \* agent capture during start waits for ready (CA:593,702)
          MaxEpoch, MaxMedia

VARIABLES view,       \* "away" | "camera"
          phase,      \* "off" | "starting" | "ready" | "error"
          perm,       \* "unknown" | "granted" | "denied"
          capture,    \* "idle" | "photo" | "recording"
          focusBusy,
          lens, flash, zoom,
          agent,      \* "none" | "queued" | "capturing" | "done" | "failed" | "cancelled" | "refused"
          epoch,
          inflight,   \* set of epochs with a photo still being written natively
          media, thumb,
          dropped,    \* ghost: a shutter press was silently ignored
          flipFailed  \* ghost: the native layer rejected a lens switch

vars == <<view, phase, perm, capture, focusBusy, lens, flash, zoom, agent,
          epoch, inflight, media, thumb, dropped, flipFailed>>

TypeOK ==
  /\ view \in {"away", "camera"}
  /\ phase \in {"off", "starting", "ready", "error"}
  /\ perm \in {"unknown", "granted", "denied"}
  /\ capture \in {"idle", "photo", "recording"}
  /\ focusBusy \in BOOLEAN /\ flash \in BOOLEAN
  /\ lens \in {"back", "front"} /\ zoom \in {"one", "half"}
  /\ agent \in {"none", "queued", "capturing", "done", "failed", "cancelled", "refused"}
  /\ epoch \in 0..MaxEpoch /\ inflight \subseteq 0..MaxEpoch
  /\ media \in Nat /\ thumb \in Nat
  /\ dropped \in BOOLEAN /\ flipFailed \in BOOLEAN

Init ==
  /\ view = "away" /\ phase = "off" /\ perm = "unknown" /\ capture = "idle"
  /\ focusBusy = FALSE /\ lens = "back" /\ flash = FALSE /\ zoom = "one"
  /\ agent = "none" /\ epoch = 0 /\ inflight = {} /\ media = 0 /\ thumb = 0
  /\ dropped = FALSE /\ flipFailed = FALSE

Room == media + Cardinality(inflight) < MaxMedia
Ready == view = "camera" /\ phase = "ready"

----------------------------------------------------------------------------
(* User and system events *)

Open ==
  /\ view = "away" /\ epoch < MaxEpoch
  /\ view' = "camera" /\ phase' = "starting" /\ epoch' = epoch + 1
  /\ UNCHANGED <<perm, capture, focusBusy, lens, flash, zoom, agent, inflight, media, thumb, dropped, flipFailed>>

\* Every start checks access (CP:186-198). A denial may since have been reversed in
\* Android settings; a first-time prompt may be answered either way.
PermissionResult ==
  /\ phase = "starting" /\ perm # "granted"
  /\ perm' \in {"granted", "denied"}
  /\ phase' = IF perm' = "denied" THEN "error" ELSE "starting"
  /\ agent' = IF perm' = "denied" /\ agent = "queued" THEN "failed" ELSE agent
  /\ UNCHANGED <<view, capture, focusBusy, lens, flash, zoom, epoch, inflight, media, thumb, dropped, flipFailed>>

FirstFrame ==
  /\ view = "camera" /\ phase = "starting" /\ perm = "granted"
  /\ phase' = "ready"
  /\ UNCHANGED <<view, perm, capture, focusBusy, lens, flash, zoom, agent, epoch, inflight, media, thumb, dropped, flipFailed>>

StartFail ==
  /\ view = "camera" /\ phase = "starting" /\ perm = "granted"
  /\ phase' = "error"
  /\ agent' = IF agent = "queued" THEN "failed" ELSE agent
  /\ UNCHANGED <<view, perm, capture, focusBusy, lens, flash, zoom, epoch, inflight, media, thumb, dropped, flipFailed>>

\* Back, Home, backgrounding and pagehide all stop the session (CA:585,823,959,992).
\* A recording is finalized and saved. A photo the native layer is still writing is
\* saved too, but as written the executor that delivers its result is shut down,
\* so the adapter's `capturing` flag is never cleared.
Leave ==
  /\ view = "camera"
  /\ view' = "away" /\ phase' = "off" /\ focusBusy' = FALSE
  /\ LET rec == IF capture = "recording" THEN 1 ELSE 0
         saved == media + rec + Cardinality(inflight)
     IN /\ media' = saved
        /\ thumb' = saved
  /\ inflight' = {}
  /\ capture' = IF capture = "recording" THEN "idle"
                ELSE IF capture = "photo" /\ ~FixLeave THEN "photo"
                ELSE "idle"
  /\ agent' = IF agent \in {"queued", "capturing"} THEN "cancelled" ELSE agent
  /\ UNCHANGED <<perm, lens, flash, zoom, epoch, dropped, flipFailed>>

Shutter ==
  /\ Ready /\ Room /\ capture = "idle"
  /\ IF focusBusy /\ ~FixFocus
       THEN /\ dropped' = TRUE
            /\ UNCHANGED <<capture, inflight, focusBusy>>
       ELSE /\ capture' = "photo" /\ inflight' = inflight \cup {epoch}
            /\ focusBusy' = FALSE
            /\ UNCHANGED dropped
  /\ UNCHANGED <<view, phase, perm, lens, flash, zoom, agent, epoch, media, thumb, flipFailed>>

CaptureDone(e) ==
  /\ e \in inflight
  /\ inflight' = inflight \ {e}
  /\ media' = media + 1 /\ thumb' = media + 1
  /\ capture' = IF e = epoch /\ view = "camera" THEN "idle" ELSE capture
  /\ agent' = IF agent = "capturing" /\ e = epoch THEN "done" ELSE agent
  /\ UNCHANGED <<view, phase, perm, focusBusy, lens, flash, zoom, epoch, dropped, flipFailed>>

RecStart ==
  /\ Ready /\ Room /\ capture = "idle"
  /\ IF focusBusy /\ ~FixFocus
       THEN /\ dropped' = TRUE /\ UNCHANGED <<capture, focusBusy>>
       ELSE /\ capture' = "recording" /\ focusBusy' = FALSE /\ UNCHANGED dropped
  \* Design rule found by this model: a queued agent capture would otherwise wait for
  \* as long as the user records. Starting a recording refuses it visibly instead.
  /\ agent' = IF agent = "queued" /\ capture' = "recording" THEN "refused" ELSE agent
  /\ UNCHANGED <<view, phase, perm, lens, flash, zoom, epoch, inflight, media, thumb, flipFailed>>

RecStop ==   \* user Stop, or the native size/duration limit
  /\ Ready /\ capture = "recording"
  /\ capture' = "idle" /\ media' = media + 1 /\ thumb' = media + 1
  /\ UNCHANGED <<view, phase, perm, focusBusy, lens, flash, zoom, agent, epoch, inflight, dropped, flipFailed>>

Focus ==
  /\ Ready /\ ~focusBusy /\ capture = "idle"
  /\ focusBusy' = TRUE
  /\ UNCHANGED <<view, phase, perm, capture, lens, flash, zoom, agent, epoch, inflight, media, thumb, dropped, flipFailed>>

FocusDone ==
  /\ focusBusy /\ focusBusy' = FALSE
  /\ UNCHANGED <<view, phase, perm, capture, lens, flash, zoom, agent, epoch, inflight, media, thumb, dropped, flipFailed>>

\* As written, JS resets flash and zoom only after the native switch succeeds, and the
\* native layer validates the old settings against the new lens and rejects.
Flip ==
  /\ Ready /\ capture = "idle"
  /\ IF ~FixLens /\ (flash \/ zoom = "half")
       THEN /\ flipFailed' = TRUE /\ UNCHANGED <<lens, flash, zoom>>
       ELSE /\ lens' = IF lens = "back" THEN "front" ELSE "back"
            /\ flash' = FALSE /\ zoom' = "one"
            /\ UNCHANGED flipFailed
  /\ UNCHANGED <<view, phase, perm, capture, focusBusy, agent, epoch, inflight, media, thumb, dropped>>

\* As written the Flash button is shown on every lens (CA:807).
SetFlash ==
  /\ Ready /\ (FixLens => lens = "back")
  /\ flash' = ~flash
  /\ UNCHANGED <<view, phase, perm, capture, focusBusy, lens, zoom, agent, epoch, inflight, media, thumb, dropped, flipFailed>>

SetZoom ==
  /\ Ready /\ lens = "back"
  /\ zoom' \in {"one", "half"} /\ zoom' # zoom
  /\ UNCHANGED <<view, phase, perm, capture, focusBusy, lens, flash, agent, epoch, inflight, media, thumb, dropped, flipFailed>>

\* camera_capture_photo, while Camera is open (agent-adapter.ts:631).
AgentCapture ==
  /\ view = "camera" /\ agent = "none"
  /\ CASE phase = "ready" /\ capture = "idle" ->
            /\ agent' = "capturing" /\ capture' = "photo"
            /\ inflight' = inflight \cup {epoch} /\ focusBusy' = FALSE
       [] phase = "starting" /\ FixAgentQueue ->
            /\ agent' = "queued" /\ UNCHANGED <<capture, inflight, focusBusy>>
       [] phase = "ready" ->     \* user capture in progress: visible refusal
            /\ agent' = "refused" /\ UNCHANGED <<capture, inflight, focusBusy>>
       [] OTHER ->
            /\ agent' = "failed" /\ UNCHANGED <<capture, inflight, focusBusy>>
  /\ UNCHANGED <<view, phase, perm, lens, flash, zoom, epoch, media, thumb, dropped, flipFailed>>

AgentRun ==
  /\ agent = "queued" /\ Ready /\ capture = "idle"
  /\ agent' = "capturing" /\ capture' = "photo"
  /\ inflight' = inflight \cup {epoch} /\ focusBusy' = FALSE
  /\ UNCHANGED <<view, phase, perm, lens, flash, zoom, epoch, media, thumb, dropped, flipFailed>>

System == PermissionResult \/ FirstFrame \/ StartFail \/ FocusDone \/ AgentRun
          \/ \E e \in inflight : CaptureDone(e)
User   == Open \/ Leave \/ Shutter \/ RecStart \/ RecStop \/ Focus \/ Flip
          \/ SetFlash \/ SetZoom \/ AgentCapture

Next == System \/ User

Spec == Init /\ [][Next]_vars
          /\ WF_vars(PermissionResult) /\ WF_vars(FirstFrame \/ StartFail)
          /\ WF_vars(FocusDone) /\ SF_vars(AgentRun)
          /\ \A e \in 0..MaxEpoch : WF_vars(CaptureDone(e))

----------------------------------------------------------------------------
(* Properties *)

NoLostShutter      == ~dropped
\* With the camera ready and nothing being written, the shutter is usable.
NoStuckCapture     == (Ready /\ inflight = {}) => capture \in {"idle", "recording"}
NoOrphanRecording  == capture = "recording" => Ready
LensSettingsValid  == lens = "front" => (~flash /\ zoom = "one")
FlipNeverRejected  == ~flipFailed
\* The last-capture tile and Photos agree with what was committed, once nothing is in flight.
SavedIsShown       == inflight = {} => thumb = media
\* An agent capture fails only for a real cause the user can see.
AgentFailsOnlyForCause ==
  [][(agent' = "failed" /\ agent # "failed") => (perm' = "denied" \/ phase' = "error")]_vars

OpenReachesPreviewOrError ==
  (view = "camera" /\ phase = "starting") ~> (phase \in {"ready", "error"} \/ view = "away")
AgentCaptureSettles ==
  (agent \in {"queued", "capturing"}) ~> (agent \in {"done", "cancelled", "failed", "refused"})
====
