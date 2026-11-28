# Recording a voice note

The recorder: its levels, pause, stop and discard, from Notes or from the
recording's notification; the audio written in short segments as it is
recorded; and keeping the recording as a voice note in the owner's store.
[The microphone](./microphone.md) says whether Alpha may record. Once kept,
the voice note is [listened to and transcribed](./voice.md) like any other,
and it is otherwise a note in [Notes](./index.md).

Nothing is transcribed while recording: the transcript is made from the
kept voice note, segment by segment, and catches up with all of its audio
([Voice note](./voice.md), "The transcript catches up with the audio,
unless it fails, is cancelled, or the note is let go of"). This is a
decision: a crash during a recording keeps every segment written, and the
transcript of them follows once the recording is kept.

## Story: Record a voice note

> As the owner, I want to record a voice note for as long as I like, see
> that it is hearing me, pause and go on, and stop it to keep it, with
> nothing I said lost to a crash, a call or an error.

Voice note shows the elapsed time, recent microphone levels, and the
recording status. Pause and Stop recording sit below the waveform.
While paused, Resume takes the place of Pause.

As in the existing app, the status is one word: Starting…, Recording,
Paused or Saving…. A call pauses the recording quietly: the status reads
Paused, the levels dim, and Resume waits for the call to end, with no
words about the call. A recording picked up after a crash, or one an
error stopped, is told to a screen reader only.

### The recorder holds one recording, the audio written so far, what is waiting to be written, and the keeping of it as a voice note

A recording has a number, and while the microphone is on, a capture under
its own number. The audio is written to the phone in segments; `kept`
counts those written, and `unsaved` the seconds recorded since the last one.
Keeping the recording as a voice note is one attempt, and the note the
store made is numbered apart from the recording. A recording the phone found
damaged after a crash can only be discarded. Discarding is written down
before the recording is erased.

```quint
import attempt as A from "../../kit/attempt"
import read as R from "../../kit/read"
import note.* from "./note"

type Phase = Idle | Recording | Paused | Stopping | Keeping | Kept | Failed | Discarding
type Ask = NoAsk | AskDiscard
type Command = Pause | Resume | End
type Admission = { allowed: bool, free: bool, front: bool, silent: bool }
type Recorder = {
  owner: int, phase: Phase, take: int, capture: int, issued: int, folder: int,
  kept: int, unsaved: int, level: int, recovered: bool, damaged: bool, found: int, ask: Ask, calling: bool,
  keeping: A::Attempt, look: R::Read, missing: bool, note: int,
  erasing: A::Attempt, pending: bool, doomed: int, doomedFor: int,
}

pure val initial: Recorder = {
  owner: 0, phase: Idle, take: 0, capture: 0, issued: 0, folder: 0,
  kept: 0, unsaved: 0, level: 0, recovered: false, damaged: false, found: 0, ask: NoAsk, calling: false,
  keeping: A::plan(0), look: R::unread, missing: false, note: 0,
  erasing: A::plan(0), pending: false, doomed: 0, doomedFor: 0,
}

pure def unfinished(r: Recorder): bool = r.phase != Idle and r.phase != Kept
pure def live(r: Recorder): bool = r.phase == Recording or r.phase == Paused or r.phase == Stopping
```

### A segment holds at most thirty seconds

So a crash loses at most the last thirty seconds of what was said.

```quint
pure val segmentLimit = 30
```

### What the recorder asks of the phone

To capture, to pause, go on or end a capture (ending writes the last
segment and frees the microphone), to keep the recording as a voice note in
the owner's store, to look up whether the store holds it, to write down a
discard, and to erase a recording.

```quint
type Effect =
  | Captures({ take: int, capture: int })
  | Tells({ capture: int, command: Command })
  | Finishes({ ticket: int, owner: int, take: int, segments: int, folder: int })
  | Looks({ ticket: int, owner: int, take: int })
  | WritesDown({ ticket: int, owner: int, take: int, capture: int })
  | Erases({ ticket: int, owner: int, take: int })
type Moved = { state: Recorder, out: List[Effect] }

pure def told(out: List[Effect], capture: int, command: Command): bool =
  out.some(e => match e { | Tells(t) => t.capture == capture and t.command == command | _ => false })
```

### What the simulator tries

```quint
pure val roomValues = Set(
  { allowed: true, free: true, front: true, silent: true }, { allowed: false, free: true, front: true, silent: true },
  { allowed: true, free: false, front: true, silent: true }, { allowed: true, free: true, front: false, silent: true },
  { allowed: true, free: true, front: true, silent: false },
)
pure val captureValues = Set(1, 2, 3, 4, 5, 6, 7, 8)
pure val takeValues = Set(1, 2, 3)
pure val captureReadyValues = Set(false, true)
pure val ticketValues = Set(1, 2, 3, 4, 5, 6, 7, 8)
pure val segmentValues = Set(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
pure val segmentsValues = Set(1, 2)
pure val foundValues = Set(0, 1, 2)
pure val secondsValues = Set(10, 30)
pure val levelValues = Set(0, 3)
pure val noteValues = Set(0, 9)
pure val folderValues = Set(0, 2)
pure val ownerValues = Set(0, 1, 2)
pure val weight_tick = 4
pure val weight_segmentKept = 4
pure val weight_finished = 3
```

### Capture starts or goes on only while the microphone is allowed and free, nothing of Notes plays, the phone is in no call, and Notes is in front

The microphone says whether it is allowed, the phone whether another app
holds it and whether Notes is in front, and the voice note whether its
playback was confirmed stopped ([Voice note](./voice.md), "Playing stops
only when the phone confirms it, and a stop it could not confirm is told and
can be asked again"). Android lets a recording begun in front
go on behind, under its notification, but never begin there.

```quint
pure def admits(room: Admission): bool = room.allowed and room.free and room.front and room.silent
```

### A new recording starts only when no recording is unfinished, and is made in the folder the list is narrowed to

Nothing may be held but a voice note already kept: a recording that was
paused, cut off by a crash, stopped by an error, damaged, being discarded,
or is still being kept, is kept or discarded first. The agent's notes must
be available (Notes, "Nothing new can be made while the notes are
unavailable or storage has failed"), and nothing else of Notes open.

```quint
pure def canStart(r: Recorder, room: Admission, available: bool, folder: int, covered: bool, by: Actor): bool =
  mayOpen(covered, by) and isOwner(r.owner) and available and admits(room) and not(r.calling) and not(unfinished(r))
    and folder >= 0 and not(A::inFlight(r.erasing) and r.doomedFor == r.owner)

pure def start(r: Recorder, room: Admission, available: bool, folder: int, covered: bool, by: Actor): Moved =
  val n = r.issued + 1
  { state: { ...r, phase: Recording, take: n, capture: n, issued: n, folder: folder, kept: 0, unsaved: 0, level: 0,
      recovered: false, damaged: false, found: 0, ask: NoAsk, note: 0, missing: false, keeping: A::plan(r.keeping.id) },
    out: List(Captures({ take: n, capture: n })) }
```

### While recording, the phone reports the level and the seconds heard, and a segment the phone failed to cut stops the recording

```quint
pure def halted(capture: int, r: Recorder): Moved =
  val out = if (capture != 0) List(Tells({ capture: capture, command: End })) else List()
  if (r.kept > 0) { state: { ...r, phase: Failed, capture: 0, unsaved: 0, level: 0 }, out: out }
  else { state: { ...r, phase: Idle, capture: 0, unsaved: 0, level: 0, ask: NoAsk, recovered: false, found: 0 }, out: out }

pure def canTick(r: Recorder, capture: int, seconds: int, by: Actor): bool =
  by == Phone and r.phase == Recording and capture == r.capture and capture != 0 and seconds > 0

pure def tick(r: Recorder, capture: int, seconds: int, level: int, by: Actor): Moved =
  if (r.unsaved + seconds > segmentLimit) halted(r.capture, r)
  else { state: { ...r, unsaved: r.unsaved + seconds, level: level }, out: List() }
```

### Each segment is written to the phone as it ends, in order, and one that cannot be written stops the recording

A segment ends every thirty seconds, and when the owner pauses or stops.
Its answer names the capture, which segment it is and the seconds it holds;
only the next segment of the current capture counts, and a duplicate or one
out of order is refused. Stopping finishes when its last segment is
written; the recording is then kept as a voice note. A new saved note names
that capture in the recording identity and the audio record. Recovery can
also find a voice note saved by the earlier format with a flat audio handle.

```quint
pure def keepIt(segments: int, r: Recorder): Moved =
  val attempt = A::dispatch(A::record(A::plan(r.keeping.id + 1)))
  { state: { ...r, phase: Keeping, capture: 0, unsaved: 0, level: 0, recovered: false, missing: false, keeping: attempt },
    out: List(Finishes({ ticket: attempt.id, owner: r.owner, take: r.take, segments: segments, folder: r.folder })) }

pure def canSegmentKept(r: Recorder, capture: int, segment: int, seconds: int, by: Actor): bool =
  by == Phone and capture == r.capture and capture != 0 and segment == r.kept + 1 and seconds > 0 and seconds <= r.unsaved

pure def segmentKept(r: Recorder, capture: int, segment: int, seconds: int, ok: bool, by: Actor): Moved =
  val more = { ...r, kept: r.kept + 1, unsaved: r.unsaved - seconds }
  if (not(ok)) halted(r.capture, r)
  else if (r.phase == Stopping and more.unsaved == 0) keepIt(more.kept, more)
  else { state: more, out: List() }
```

### A microphone error, or the microphone taken away, stops the recording and keeps every segment already written

```quint
pure def canBroke(r: Recorder, capture: int, by: Actor): bool = by == Phone and capture == r.capture and capture != 0

pure def broke(r: Recorder, capture: int, by: Actor): Moved = halted(r.capture, r)
```

### The owner pauses and goes on, from Notes or from the notification, and a call pauses the recording

Each control names the recording it was shown for, so one from an old
notification changes nothing. Pausing writes the segment so far. An
interrupted recording goes on under a new capture. When Android reports that
the owner has already paused or resumed the matching recording from its
notification, Notes adopts the reported phase without issuing another command.

```quint
pure def canPause(r: Recorder, take: int, by: Actor): bool = by == Owner and r.phase == Recording and take == r.take

pure def pause(r: Recorder, take: int, by: Actor): Moved =
  { state: { ...r, phase: Paused, level: 0 }, out: List(Tells({ capture: r.capture, command: Pause })) }

pure def canPhonePaused(r: Recorder, take: int, by: Actor): bool =
  by == Phone and take == r.take and r.phase == Recording

pure def phonePaused(r: Recorder, take: int, by: Actor): Recorder = { ...r, phase: Paused, level: 0 }

pure def canCallStarted(r: Recorder, by: Actor): bool = by == Phone and not(r.calling)

pure def callStarted(r: Recorder, by: Actor): Moved =
  if (r.phase == Recording)
    { state: { ...r, calling: true, phase: Paused, level: 0 }, out: List(Tells({ capture: r.capture, command: Pause })) }
  else { state: { ...r, calling: true }, out: List() }

pure def canCallEnded(r: Recorder, by: Actor): bool = by == Phone and r.calling

pure def callEnded(r: Recorder, by: Actor): Recorder = { ...r, calling: false }

pure def canResume(r: Recorder, take: int, room: Admission, by: Actor): bool =
  by == Owner and r.phase == Paused and take == r.take and admits(room) and not(r.calling)

pure def resume(r: Recorder, take: int, room: Admission, by: Actor): Moved =
  val n = r.issued + 1
  if (r.capture != 0) { state: { ...r, phase: Recording }, out: List(Tells({ capture: r.capture, command: Resume })) }
  else { state: { ...r, phase: Recording, capture: n, issued: n, recovered: false },
    out: List(Captures({ take: r.take, capture: n })) }

pure def canPhoneResumed(r: Recorder, take: int, room: Admission, by: Actor): bool =
  by == Phone and canResume(r, take, room, Owner)

pure def phoneResumed(r: Recorder, take: int, room: Admission, by: Actor): Recorder =
  resume(r, take, room, Owner).state
```

### Stopping ends the capture and keeps what was recorded as a voice note, and a recording with nothing in it leaves nothing

```quint
pure def canStop(r: Recorder, take: int, by: Actor): bool =
  by == Owner and (r.phase == Recording or r.phase == Paused) and take == r.take

pure def stop(r: Recorder, take: int, by: Actor): Moved =
  val ending = if (r.capture != 0) List(Tells({ capture: r.capture, command: End })) else List()
  val closing = { ...r, ask: NoAsk }
  val save = keepIt(closing.kept, closing)
  if (closing.unsaved > 0) { state: { ...closing, phase: Stopping, level: 0 }, out: ending }
  else if (closing.kept > 0) { state: save.state, out: ending.concat(save.out) }
  else { state: { ...closing, phase: Idle, capture: 0, level: 0, recovered: false, found: 0 }, out: ending }
```

### A recording has no length limit: it stops only when the owner pauses, stops or confirms discarding it, for a call or a recording error, on restart, or for another owner

```quint
pure def stepNoLengthLimit(before: Recorder, via: str, after: Recorder): bool =
  (before.phase == Recording and after.phase != Recording)
    implies (via == "pause" or via == "phonePaused" or via == "stop" or via == "callStarted" or via == "broke" or via == "tick"
      or via == "segmentKept" or via == "restart" or via == "ownerChanged" or via == "confirmDiscard")
```

### Keeping the recording ends as the store says: kept, refused, or unknown

The store keeps at most one voice note per recording, so a keeping repeated
is never a second voice note.

```quint
pure def canFinished(r: Recorder, ticket: int, ok: bool, known: bool, note: int, by: Actor): bool =
  by == Phone and A::canConclude(r.keeping, ticket) and ((ok and known) iff note > 0)

pure def finished(r: Recorder, ticket: int, ok: bool, known: bool, note: int, by: Actor): Recorder =
  val keeping = A::conclude(r.keeping, ok, known)
  if (keeping.outcome == A::Confirmed) { ...r, keeping: keeping, phase: Kept, note: note }
  else if (keeping.outcome == A::Refused) { ...r, keeping: keeping, phase: Failed }
  else { ...r, keeping: keeping }
```

### A keeping whose outcome is unknown is settled by looking up what the store holds, never by keeping it again

The owner's Check again, or the phone on its own, asks the store whether
it holds the voice note of this recording; only the answer to the newest
lookup counts. Found, the recording is kept; not found, it waits for the
owner to keep or discard it.

```quint
pure def canLookUp(r: Recorder, by: Actor): bool =
  by != Agent and r.phase == Keeping and r.keeping.outcome == A::Unknown and r.look.status != R::Loading

pure def lookUp(r: Recorder, by: Actor): Moved =
  val look = R::ask(r.look)
  { state: { ...r, look: look }, out: List(Looks({ ticket: look.ticket, owner: r.owner, take: r.take })) }

pure def canNoteFound(r: Recorder, ticket: int, ok: bool, note: int, by: Actor): bool =
  by == Phone and r.phase == Keeping and R::canAnswer(r.look, ticket) and note >= 0

pure def noteFound(r: Recorder, ticket: int, ok: bool, note: int, by: Actor): Recorder =
  val look = R::answer(r.look, ok)
  if (not(ok)) { ...r, look: look }
  else if (note > 0) { ...r, look: look, phase: Kept, note: note }
  else { ...r, look: look, phase: Failed, missing: true }
```

### What an error or a refused or missing keeping left is kept as a voice note when the owner says so, unless the recording is damaged

```quint
pure def canKeepPartial(r: Recorder, by: Actor): bool =
  by == Owner and r.phase == Failed and r.ask == NoAsk and not(r.damaged)
    and (r.keeping.outcome != A::Unknown or r.missing)

pure def keepPartial(r: Recorder, by: Actor): Moved = keepIt(r.kept, r)
```

### The audio written is never lost but by the owner's discarding

Only a discard written down lets go of what was written before it is kept;
once the store confirms the voice note, a new recording may follow. Another
owner taking the phone leaves it on the phone for its owner. Nothing
written is ever unwritten.

```quint
pure def stepWrittenAudioStays(before: Recorder, via: str, after: Recorder): bool =
  (before.kept > 0 and before.phase != Kept and (after.take != before.take or after.kept < before.kept))
    implies (via == "writtenDown" or via == "ownerChanged")
```

### Never more than a segment's worth of audio waits to be written, and only while the microphone is on

```quint
pure def alwaysLittleIsAtRisk(r: Recorder): bool =
  r.unsaved >= 0 and r.unsaved <= segmentLimit and (r.unsaved > 0 implies r.capture != 0)
```

### The microphone is on only while recording, paused or stopping, always while recording or stopping, and never records during a call

```quint
pure def alwaysTheMicrophoneFollowsTheRecorder(r: Recorder): bool =
  (r.capture != 0 implies live(r))
    and ((r.phase == Recording or r.phase == Stopping) implies r.capture != 0)
    and (r.phase == Recording implies not(r.calling))
```

### The phone is told to pause before a recording pauses, and to end or write down a discard before it lets go of a capture

While recording, a pause action issued from Notes or following a call tells
the phone to pause. Android can also report that its own notification already
paused the recorder. Either notification control changes only the observed
phase and issues no command back to the device. Restart ends every capture,
and the last segment can arrive after the phone was told to end.

```quint
pure def stepTheMicrophoneIsToldFirst(before: Recorder, via: str, after: Recorder, out: List[Effect]): bool =
  and {
    (via == "phonePaused" or via == "phoneResumed") implies out.length() == 0,
    (before.phase == Recording and after.phase == Paused and via != "restart" and via != "phonePaused") implies told(out, before.capture, Pause),
    (after.phase == Stopping and before.phase != Stopping) implies told(out, before.capture, End),
    (before.capture != 0 and after.capture == 0 and via != "restart" and before.phase != Stopping)
      implies (told(out, before.capture, End) or (via == "confirmDiscard" and out.some(fx => match fx {
        | WritesDown(w) => w.capture == before.capture
        | _ => false
      }))),
  }
```

### A recording being kept, or kept, or that an error stopped, holds some audio, and a kept voice note is one the store confirmed or was found to hold

A keeping on its way is the recording's only state then. Discovered by the
proof: a recording still being made has no keeping yet, one that failed or
is being discarded has none that went through or is unaccounted for, and a lookup runs only over a
keeping whose outcome is unknown; without these a recording could be kept
twice.

```quint
pure def alwaysAKeptRecordingHoldsAudio(r: Recorder): bool =
  ((r.phase == Keeping or r.phase == Kept or r.phase == Failed) implies r.kept > 0)
    and ((r.phase == Kept) iff (r.note > 0))
    and (r.phase == Kept implies (r.keeping.outcome == A::Confirmed or r.keeping.outcome == A::Unknown))
    and (r.phase == Keeping implies (r.keeping.outcome == A::Sent or r.keeping.outcome == A::Unknown))
    and (r.phase == Idle implies (r.kept == 0 and r.capture == 0 and not(r.recovered) and not(r.damaged)))
    and (r.keeping.outcome == A::Sent implies r.phase == Keeping)
    and (r.missing implies r.keeping.outcome == A::Unknown)
    and (live(r) implies r.keeping.outcome == A::Planned)
    and ((r.phase == Failed or r.phase == Discarding) implies (r.keeping.outcome == A::Planned or r.keeping.outcome == A::Refused or r.missing))
    and (r.look.status == R::Loading implies (r.phase == Keeping and r.keeping.outcome == A::Unknown))
```

### Keeping a recording sends what was written, for the owner it was recorded for, once, into its folder, and never a damaged one or one whose keeping is unknown or done

```quint
pure def stepKeptOnce(before: Recorder, via: str, after: Recorder, out: List[Effect]): bool =
  out.every(e => match e {
    | Finishes(f) => f.ticket == before.keeping.id + 1 and f.take == before.take and f.owner == before.owner
        and f.segments > 0 and f.folder == before.folder and isOwner(f.owner)
        and before.phase != Keeping and before.phase != Kept and before.phase != Discarding and not(before.damaged)
        and before.keeping.outcome != A::Confirmed and (before.keeping.outcome == A::Unknown implies before.missing)
    | Looks(l) => before.phase == Keeping and before.keeping.outcome == A::Unknown and l.take == before.take
    | _ => true
  })
```

### A recording can be paused by the owner or a call, go on long, stop by an error, be kept, fail to be kept, be kept with its outcome unknown, and be found kept or missing

```quint
pure def sometimesPausedByTheOwner(r: Recorder): bool = r.phase == Paused and not(r.recovered) and r.capture != 0 and not(r.calling)

pure def sometimesPausedByACall(r: Recorder): bool = r.phase == Paused and r.calling and r.kept > 0

pure def sometimesALongRecording(r: Recorder): bool = r.phase == Recording and r.kept >= 3

pure def sometimesStopping(r: Recorder): bool = r.phase == Stopping and r.kept > 0

pure def sometimesFailedKeepingAudio(r: Recorder): bool = r.phase == Failed and r.kept > 1

pure def sometimesKept(r: Recorder): bool = r.phase == Kept and r.kept > 1 and r.take > 1 and r.folder > 0

pure def sometimesKeepingRefused(r: Recorder): bool = r.phase == Failed and r.keeping.outcome == A::Refused

pure def sometimesKeepingUnknown(r: Recorder): bool = r.phase == Keeping and r.keeping.outcome == A::Unknown

pure def sometimesFoundKept(r: Recorder): bool = r.phase == Kept and r.keeping.outcome == A::Unknown

pure def sometimesFoundMissing(r: Recorder): bool = r.phase == Failed and r.missing
```

### Stopping ends, keeping ends, and a lookup ends

```quint
pure def leadsToStoppingEnds(r: Recorder, later: Recorder): bool = r.phase == Stopping implies later.phase != Stopping

pure def leadsToKeepingEnds(r: Recorder, later: Recorder): bool =
  (r.keeping.outcome == A::Sent implies later.keeping.outcome != A::Sent)
    and (r.look.status == R::Loading implies later.look.status != R::Loading)

pure val fair_segmentKept = "weak"
pure val fair_finished = "weak"
pure val fair_noteFound = "weak"
```

## Story: Discard a recording

> As the owner, I want to throw away a recording I do not want, but only
> after saying so twice, and never to have it come back half erased.

The question appears above the recorder controls. Keep closes it without
interrupting the recording. Pause and Resume still control the recording
under review. Stop closes the question and saves.

### The owner reviews the current take before discarding it

The owner can review a live capture as soon as the device reports its
recording identity, even while the timer is at zero. The shown time is
rounded down and gives no authority to erase audio without confirmation.

```quint
pure def canAskDiscard(r: Recorder, take: int, captureReady: bool, by: Actor): bool =
  by == Owner and take == r.take and r.ask == NoAsk and
    (r.phase == Paused or r.phase == Failed or (r.phase == Recording and captureReady))

pure def askDiscard(r: Recorder, take: int, captureReady: bool, by: Actor): Recorder = { ...r, ask: AskDiscard }

pure def canCancelDiscard(r: Recorder, take: int, by: Actor): bool = by == Owner and take == r.take and r.ask == AskDiscard

pure def cancelDiscard(r: Recorder, take: int, by: Actor): Recorder = { ...r, ask: NoAsk }
```

### Only the owner confirms the exact take; the phone stops it and writes down its recording identity before erasing it

The phone remembers the selected device recording under the discard
attempt. A delayed or repeated erase uses that recording identity every
time, and a new recording for that owner waits until erasure settles.

```quint
pure def canConfirmDiscard(r: Recorder, take: int, by: Actor): bool =
  by == Owner and take == r.take and r.ask == AskDiscard and not(A::inFlight(r.erasing))

pure def confirmDiscard(r: Recorder, take: int, by: Actor): Moved =
  val attempt = A::record(A::plan(r.erasing.id + 1))
  { state: { ...r, phase: Discarding, capture: 0, unsaved: 0, level: 0, recovered: false, ask: NoAsk,
      erasing: attempt, pending: true, doomed: r.take, doomedFor: r.owner },
    out: List(WritesDown({ ticket: attempt.id, owner: r.owner, take: r.take, capture: r.capture })) }

pure def canWrittenDown(r: Recorder, ticket: int, ok: bool, by: Actor): bool =
  by == Phone and A::canDispatch(r.erasing) and r.pending and ticket == r.erasing.id

pure def writtenDown(r: Recorder, ticket: int, ok: bool, by: Actor): Moved =
  val gone = if (r.phase == Discarding)
    { ...r, phase: Idle, kept: 0, found: 0, damaged: false, missing: false, note: 0 } else r
  val failed = if (r.phase != Discarding) r else if (r.kept > 0) { ...r, phase: Failed }
    else { ...r, phase: Idle, damaged: false, found: 0, missing: false }
  if (ok) { state: { ...gone, erasing: A::dispatch(r.erasing), pending: false },
    out: List(Erases({ ticket: r.erasing.id, owner: r.doomedFor, take: r.doomed })) }
  else { state: { ...failed, erasing: A::plan(r.erasing.id), pending: false }, out: List() }

pure def canResumeDiscard(r: Recorder, by: Actor): bool = by == Phone and r.erasing.outcome == A::Recorded and not(r.pending)

pure def resumeDiscard(r: Recorder, by: Actor): Moved =
  { state: { ...r, pending: true }, out: List(WritesDown({ ticket: r.erasing.id, owner: r.doomedFor, take: r.doomed, capture: 0 })) }

pure def canErased(r: Recorder, ticket: int, by: Actor): bool = by == Phone and A::canConclude(r.erasing, ticket)

pure def erased(r: Recorder, ticket: int, ok: bool, known: bool, by: Actor): Recorder =
  { ...r, erasing: A::conclude(r.erasing, ok, known) }
```

### The question is about an unfinished recording, and a discard written down is about the recording it names

```quint
pure def alwaysTheQuestionIsAboutAnUnfinishedRecording(r: Recorder): bool =
  (r.ask == AskDiscard implies (r.phase == Recording or r.phase == Paused or r.phase == Failed))
    and (r.phase == Discarding implies (r.erasing.outcome == A::Recorded and r.doomed == r.take and r.doomedFor == r.owner))
    and (A::inFlight(r.erasing) implies (r.doomed > 0 and isOwner(r.doomedFor)))
    and (r.pending implies r.erasing.outcome == A::Recorded)
```

### A recording is erased only once its discard is written down, for the owner who confirmed it, and only once

```quint
pure def stepErasedOnlyWhenWrittenDown(before: Recorder, via: str, after: Recorder, out: List[Effect]): bool =
  out.every(e => match e {
    | WritesDown(w) => (via == "confirmDiscard" and before.ask == AskDiscard and w.take == before.take
          and w.owner == before.owner and w.ticket == before.erasing.id + 1 and w.capture == before.capture and not(A::inFlight(before.erasing)))
        or (via == "resumeDiscard" and before.erasing.outcome == A::Recorded and w.ticket == before.erasing.id
          and w.take == before.doomed and w.owner == before.doomedFor and w.capture == 0)
    | Erases(x) => via == "writtenDown" and before.erasing.outcome == A::Recorded and x.ticket == before.erasing.id
        and x.take == before.doomed and x.owner == before.doomedFor
    | _ => true
  })
```

### The owner can be asked to discard, a discard can wait to be written down or fail to be, and an erasure can end unknown

```quint
pure def sometimesAskingToDiscard(r: Recorder): bool = r.ask == AskDiscard and r.phase == Failed

pure def sometimesAskingWhileRecording(r: Recorder): bool = r.ask == AskDiscard and r.phase == Recording and r.unsaved > 0

pure def sometimesAskingBeforeTheFirstSecond(r: Recorder): bool =
  r.ask == AskDiscard and r.phase == Recording and r.kept == 0 and r.unsaved == 0

pure def sometimesDiscarding(r: Recorder): bool = r.phase == Discarding and not(r.pending)

pure def sometimesDiscardNotWrittenDown(r: Recorder): bool = r.phase == Failed and r.erasing.outcome == A::Planned and r.erasing.id > 0

pure def sometimesErasureUnknown(r: Recorder): bool = r.erasing.outcome == A::Unknown and r.phase == Idle
```

## Story: Pick up a recording a crash cut off

The browser saves the audio and its elapsed time as the recorder sends each
part. After a reload, it offers the saved parts only under the same Notes
connection. A recording already bound to a canonical note uses that same
note on retry.

Alpha can also stop while the phone goes on: closing Alpha leaves the
recording under its notification, which keeps the microphone on and writes
a segment every 27 seconds. As in the existing app, Alpha shows such a
recording as the phone has it when it opens again.

> As the owner, I want a recording the phone lost in the middle to be
> waiting for me, with everything written, before I can start another, and
> never offered as whole when the phone cannot find all of it.

### Only the phone restarts the recorder: a restart keeps every segment written and those the phone wrote since, takes up a recording the phone still holds open as the phone has it, offers a recording cut off as paused only when the phone found it whole, and leaves a keeping cut off unknown

Whatever was asked of the phone and not answered is dropped, and its late
answer is refused. The phone says whether it holds the recording, how many
of its segments it has written, and whether it is still recording. A
recording the phone still records, or holds with no segment yet, goes on
under a new capture, recording or paused as the phone has it; otherwise the
microphone is off and a recording with segments is cut off. Segments the
phone wrote while Alpha was away are the recording's own; a recording whose
journal is damaged or whose segments are not all there is damaged, and can
only be discarded. A recording the phone does not hold and with nothing
written leaves nothing. A discard written down is written down again.

```quint
pure def canRestart(r: Recorder, intact: bool, found: int, going: bool, by: Actor): bool = by == Phone and found >= 0

pure def restart(r: Recorder, intact: bool, found: int, going: bool, by: Actor): Recorder =
  val calm = { ...r, capture: 0, unsaved: 0, level: 0, ask: NoAsk, calling: false, pending: false,
    keeping: A::cutOff(r.keeping), look: R::drop(r.look), erasing: if (r.erasing.outcome == A::Recorded) r.erasing else A::cutOff(r.erasing) }
  val whole = intact and found >= r.kept and not(r.damaged)
  val n = r.issued + 1
  if (live(r) and whole and (going or found == 0))
    { ...calm, phase: if (going) Recording else Paused, capture: n, issued: n, kept: found, recovered: false, found: found }
  else if (live(r) and whole) { ...calm, phase: Paused, kept: found, recovered: true, found: found }
  else if (r.phase == Failed and whole) { ...calm, kept: found, recovered: false, found: found }
  else if ((live(r) or r.phase == Failed) and r.kept > 0) { ...calm, phase: Failed, recovered: false, damaged: true, found: found }
  else if (live(r)) { ...calm, phase: Idle, recovered: false, found: 0 }
  else calm
```

### A restart keeps the audio, adds what the phone wrote since, and takes no late answer

```quint
pure def stepACrashKeepsTheAudio(before: Recorder, via: str, after: Recorder): bool =
  via == "restart" implies and {
    after.kept >= before.kept, after.take == before.take,
    after.capture == 0 or after.capture > before.issued,
    after.keeping.outcome != A::Sent, after.erasing.outcome != A::Sent, after.look.status != R::Loading,
  }
```

### A recording cut off waits, paused and without the microphone, holding exactly the segments the phone found, until the owner goes on, keeps or discards it

```quint
pure def alwaysARecoveredRecordingIsWhole(r: Recorder): bool =
  (r.recovered implies (r.kept > 0 and r.phase == Paused and r.capture == 0 and r.found == r.kept and not(r.damaged)))
    and (r.damaged implies (r.phase == Failed or r.phase == Discarding))
```

### A capture starts only for a new recording when none is unfinished, or to go on with the paused one

```quint
pure def stepRecoveryBeforeCapture(before: Recorder, via: str, after: Recorder, out: List[Effect]): bool =
  out.every(e => match e {
    | Captures(c) => before.capture == 0 and c.capture > before.issued and (
        (via == "start" and not(unfinished(before)))
        or (via == "resume" and before.phase == Paused and c.take == before.take))
    | _ => true
  })
```

### A recording can be recovered after a crash, and can be found damaged

```quint
pure def sometimesRecovered(r: Recorder): bool = r.recovered and r.kept > 0 and r.phase == Paused

pure def sometimesDamaged(r: Recorder): bool = r.damaged and r.phase == Failed and r.found < r.kept
```

## Story: Leave Notes while recording

> As the owner, I want to leave Notes, turn the screen off or take a call
> without losing the recording, and to control it from its notification.

### Back closes the question to discard, and leaving Notes closes it too; the recording goes on under its notification

```quint
pure def canBack(r: Recorder): bool = r.ask != NoAsk

pure def back(r: Recorder): Recorder = { ...r, ask: NoAsk }

pure def left(r: Recorder): Recorder = { ...r, ask: NoAsk }

pure def stepLeavingKeepsTheRecording(before: Recorder, via: str, after: Recorder): bool =
  (via == "back" or via == "left") implies (after.phase == before.phase and after.capture == before.capture and after.ask == NoAsk)
```

### Numbers given to the phone are never given again

Every number in flight was issued, so a late answer never matches a new one;
segments are counted from none.

```quint
pure def alwaysNumbersWereIssued(r: Recorder): bool =
  r.issued >= 0 and r.capture <= r.issued and r.take <= r.issued and r.capture >= 0 and r.take >= 0 and r.kept >= 0
    and r.found >= 0 and r.doomed <= r.issued and r.folder >= 0

pure def stepNumbersOnlyGrow(before: Recorder, via: str, after: Recorder): bool =
  after.issued >= before.issued and after.keeping.id >= before.keeping.id and after.erasing.id >= before.erasing.id
```

## Story: Another owner never hears my recording

> As the owner, I want a recording I left unfinished kept for me, and never
> shown to or kept for whoever uses the phone after me.

### When another owner takes the phone, the recorder ends any capture, leaves an unfinished recording on the phone for its owner, and lets go of everything

A keeping on its way is cut off and becomes unknown; a discard written down
is still carried out, for the owner who confirmed it.

```quint
pure def canOwnerChanged(r: Recorder, owner: int, by: Actor): bool = by == Phone and owner != r.owner and owner >= 0

pure def ownerChanged(r: Recorder, owner: int, by: Actor): Moved =
  val ending = if (r.capture != 0) List(Tells({ capture: r.capture, command: End })) else List()
  { state: { ...r, owner: owner, phase: Idle, take: 0, capture: 0, folder: 0, kept: 0, unsaved: 0, level: 0,
      recovered: false, damaged: false, found: 0, ask: NoAsk, note: 0, missing: false,
      keeping: A::cutOff(r.keeping), look: R::drop(r.look), erasing: if (r.erasing.outcome == A::Recorded) r.erasing else A::cutOff(r.erasing) },
    out: ending }
```

### The phone offers an owner the recording it kept for them: one already handed to the store as a keeping to look up, one found whole as a recording cut off, and any other as damaged

```quint
pure def canTakeFound(r: Recorder, take: int, segments: int, intact: bool, handed: bool, by: Actor): bool =
  by == Phone and isOwner(r.owner) and not(unfinished(r)) and take > 0 and segments > 0

pure def takeFound(r: Recorder, take: int, segments: int, intact: bool, handed: bool, by: Actor): Recorder =
  val held = { ...r, take: take, issued: if (take > r.issued) take else r.issued, kept: segments, capture: 0, unsaved: 0, level: 0, ask: NoAsk, note: 0, folder: 0,
    missing: false, recovered: false, damaged: false, found: 0, keeping: A::plan(r.keeping.id) }
  if (handed) { ...held, phase: Keeping, keeping: A::conclude(A::dispatch(A::record(A::plan(r.keeping.id + 1))), false, false) }
  else if (intact) { ...held, phase: Paused, recovered: true, found: segments }
  else { ...held, phase: Failed, damaged: true }
```

### Nothing is kept or looked up for an owner but the one the phone has now

```quint
pure def stepNothingForAFormerOwner(before: Recorder, via: str, after: Recorder, out: List[Effect]): bool =
  out.every(e => match e {
    | Finishes(f) => f.owner == before.owner
    | Looks(l) => l.owner == before.owner
    | _ => true
  }) and (via == "ownerChanged" implies (after.keeping.outcome != A::Sent and after.look.status != R::Loading))
```

### A recording is held only for an owner, under its take

Discovered by the proof: without it, a recording could be kept for nobody,
or a discard could name no recording.

```quint
pure def alwaysARecordingIsTheOwners(r: Recorder): bool = unfinished(r) implies (isOwner(r.owner) and r.take > 0)
```

### A recording kept for its owner can come back, cut off, damaged, or handed to the store

```quint
pure def sometimesARecordingCameBack(r: Recorder): bool = r.recovered and r.owner == 2 and r.kept == 2

pure def sometimesAHandedRecordingCameBack(r: Recorder): bool = r.phase == Keeping and r.keeping.outcome == A::Unknown and r.owner == 2
```
