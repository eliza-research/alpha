# Voice

Talking with Alpha, and speaking instead of typing. The owner holds a
spoken conversation with Alpha in Ask Alpha, or dictates into a field with
the [recorder](./dictation.md). Both use the one microphone, so this
machine holds the conversation, the recorder, the microphone permission and
[where speech goes](./route.md). Reading aloud is [speech out
loud](./output.md); the always-on listener of an Alpha image is
[the listener](./listener.md). The shell owns navigation and how far Ask
Alpha is raised; voice asks it to move and hears where it went.

## Story: Hold a spoken conversation

> As the owner, I want to talk with Alpha hands-free: it listens, sends what
> I said when I finish, answers aloud, and listens again.

### Voice holds the conversation's phase, its session and turn, the microphone, what was heard, the reply being spoken, and the recorder, permission and route it shares

The conversation is idle, starting, listening, transcribing, thinking,
speaking, stopping, or failed. A session counts conversations and a
turn counts what was said in one; every answer from the voice service names
them, and an answer to an earlier one is refused. The microphone is off,
asked for, opening, on or closing. Voice also tracks whether the speech
pipeline has been prewarmed for the current foreground and account, whether
the native speech engine is held open for the active conversation, and
whether an agent action is waiting for the owner's review in chat while
voice keeps listening.

```quint
import dictation as D from "./dictation"
import route as R from "./route"
import permission as P from "../../kit/permission"

type Phase = Idle | Starting | Listening | Transcribing | Thinking | Speaking | Stopping | Failed
type CallNotice = NoCallNotice | AwaitingCallCause | CallNoticeOnReturn
type Mic = Off | Asking | Opening | On | Closing
type Output = SpeakerUnknown | SpeakerChecking | SpeakerUnavailable | SpeakerOn | SpeakerMuting | SpeakerOff | SpeakerUnmuting

type Voice = {
  phase: Phase, session: int, turn: int, sent: int, mic: Mic, muted: bool, heard: bool,
  speaker: Output, speakerTicket: int,
  network: bool, disclosing: bool, retries: int, retryAt: int,
  queued: int, played: int, replied: bool, playing: int,
  failure: D::Failure, latched: bool, claim: int, claimRoute: int, followed: int,
  warmed: bool, engineHeld: bool, reviewPending: bool, callNotice: CallNotice,
  prompting: bool, recorder: D::Recorder, permission: P::Permission, route: R::Route,
}

pure val initial: Voice = {
  phase: Idle, session: 0, turn: 0, sent: 0, mic: Off, muted: false, heard: false,
  speaker: SpeakerUnknown, speakerTicket: 0,
  network: false, disclosing: false, retries: 0, retryAt: 0,
  queued: 0, played: 0, replied: false, playing: 0,
  failure: D::NoFailure, latched: false, claim: 0, claimRoute: 0, followed: 0,
  warmed: false, engineHeld: false, reviewPending: false, callNotice: NoCallNotice,
  prompting: false, recorder: D::initial, permission: P::unasked, route: R::signedOut,
}

pure val sessionValues = Set(1, 2, 3, 4, 5)
pure val speakerTicketValues = Set(1, 2, 3, 4)
pure val turnValues = Set(1, 2, 3, 4, 5)
pure val playedValues = Set(0, 1, 2)
pure val placeValues = Set(1, 2)
pure val sourceRouteValues = Set(0, 1, 2)
pure val arrivedRouteValues = Set(1, 2, 3)
pure val keyValues = Set(0, 1, 2)
pure val nowValues = Set(0, 30000, 90000, 700000)
pure val waitValues = Set(0, 20000, 120000)
pure val weight_micOpened = 15
pure val weight_speechHeard = 10
pure val weight_turnEnded = 10
pure val weight_micClosed = 15
pure val weight_sentence = 10
pure val weight_sentencePlayed = 8
pure val weight_replyEnds = 8
pure val weight_stopped = 6
pure val weight_answerPrompt = 10
pure val weight_startTalking = 6
pure val weight_prewarm = 6
pure val weight_returned = 4
pure val weight_reviewSettled = 8
pure val weight_claimReleased = 4
pure val weight_speechFailed = 4
pure val weight_retryDue = 6
pure val weight_startRecording = 5
pure val weight_recordingStarted = 8
pure val weight_stopRecording = 6
pure val weight_transcribed = 8
pure val weight_agentNavigates = 6
pure val weight_refusedForFunds = 4
pure val weight_answerDisclosure = 5
pure val weight_openRecorder = 3
```

### What voice asks the phone and the voice service to do

Prewarm speech output and status without opening the microphone, hold or
release the native speech engine across an active conversation, ask for the
microphone, open app settings, listen or record, close the microphone, send
a turn, play a sentence of the reply, set the speaker output, hush the reply,
shut the conversation down, ask again after a while whether a stop that
could not be confirmed has gone quiet, open a screen, transcribe a clip, abandon a
recording, or fill a field with dictated text.

```quint
type Effect =
  | Prewarm({ network: bool })
  | HoldEngine
  | ReleaseEngineHold
  | AskMicrophone
  | OpenSettings
  | Listen({ session: int, network: bool })
  | CloseMicrophone({ session: int })
  | Send({ session: int, turn: int, network: bool })
  | Play({ session: int, turn: int })
  | SetSpeakerOutput({ session: int, speakerTicket: int, muted: bool })
  | Hush({ turn: int })
  | Shut({ session: int, keyboard: bool })
  | Release({ afterMs: int })
  | Navigate({ session: int, turn: int, place: int, sourceRoute: int })
  | CheckDictation({ ticket: int })
  | Record({ ticket: int })
  | Transcribe({ ticket: int, network: bool, automatic: bool })
  | Abandon({ recording: int })
  | Fill({ field: D::Field, filling: int })

type Change = { state: Voice, out: List[Effect] }

pure def quiet(v: Voice): bool = v.phase == Idle or v.phase == Failed

pure def talking(v: Voice): bool = not(quiet(v)) and v.phase != Stopping

pure def opened(m: Mic): bool = m == Opening or m == On

pure def alphaResponds(v: Voice): bool = v.phase == Transcribing or v.phase == Thinking or v.phase == Speaking

pure def hearsOverAlpha(v: Voice): bool = not(v.network)

pure def mayListen(v: Voice): bool = v.phase == Listening or (v.phase == Speaking and hearsOverAlpha(v))

pure def closedMic(m: Mic): Mic = if (opened(m)) Closing else if (m == Asking) Off else m

pure def closeOut(v: Voice): List[Effect] =
  if (opened(v.mic)) List(CloseMicrophone({ session: v.session })) else List()

pure def holdOut(v: Voice): List[Effect] =
  if (v.engineHeld) List() else List(HoldEngine)

pure def releaseOut(v: Voice): List[Effect] =
  if (v.engineHeld) List(ReleaseEngineHold) else List()

pure def onNetwork(r: R::Route, now: int): bool = R::way(r, now) != R::OnPhone
```

### On-device Talk audio stays in the current owner's native capture and resident recognizer

When Talk asks to open the microphone on the phone's speech route, Android
checks that its native speech engine and resident route are available.
An unavailable route ends the start quietly without opening the microphone.
The native worker binds the capture to the calling phone's signed-in owner
and to the resident's current launch epoch. The resident reports its
actual owner and engine readiness before the worker sends any audio. Every batch and receipt must
still belong to that account and launch. Only the transcript returns to
the conversation. Stop discards or drains the worker's outstanding audio
under the same authority, and a stopped or replaced owner gets no late
transcript. The on-device speech route needs no network. The transcript
is still sent to the agent as a text turn using its configured backend.

```quint
pure def alwaysIdleVoiceHoldsNoMicrophone(v: Voice): bool =
  v.phase == Idle implies v.mic == Off

pure def nativeCaptureAdmitted(
  engineReady: bool, residentRouteReady: bool, sameOwner: bool, sameEpoch: bool, captureActive: bool
): bool =
  engineReady and residentRouteReady and sameOwner and sameEpoch and captureActive

pure def nativeTranscriptAdmitted(sameOwner: bool, sameEpoch: bool, captureActive: bool): bool =
  sameOwner and sameEpoch and captureActive

pure def lawNativeTalkRequiresCurrentOwnerEpochAndReadiness(
  engineReady: bool, residentRouteReady: bool, sameOwner: bool, sameEpoch: bool, captureActive: bool
): bool =
  (not(engineReady) or not(residentRouteReady) or not(sameOwner) or not(sameEpoch) or not(captureActive))
    implies not(nativeCaptureAdmitted(engineReady, residentRouteReady, sameOwner, sameEpoch, captureActive))
```

### The speech pipeline warms on startup, foreground return and account readiness without opening the microphone

Warming prepares on-device speech output and cached status probes, and the
network route when consented, without prompting for or opening the
microphone. On a phone with the Cloud speech relay, warming the network
route also has the relay open its connection to Cloud speech, so the first
conversation starts on a warm connection; like the rest of the warm-up it
shows nothing and its failure is ignored. Warming is of speech only: the
agent's model, which a spoken turn of the enrolled phone plans with as a
typed one does, is
warmed by Ask Alpha's warm-up alone ([assistant](../assistant/index.md)),
with this phone's headers and only while the agent can answer, so speech
never asks the agent for a warm-up of its own. Once warm, redundant prewarm requests are refused until Alpha
returns to the foreground or the account changes. A local reply waits up
to ten seconds for any speech readiness probe already in flight, so
warming cannot win the speaker request slot from its first sentence.
Microphone capture and Cloud playback do not wait for the local probe.
After the wait only the current session and turn may play, at the
speaker's current gain.

```quint
pure def canPrewarm(v: Voice, now: int): bool = not(v.warmed) and not(v.latched) and not(v.prompting)

pure def prewarm(v: Voice, now: int): Change =
  { state: { ...v, warmed: true }, out: List(Prewarm({ network: onNetwork(v.route, now) })) }

pure def canReturned(v: Voice): bool = (quiet(v) and (v.warmed or v.latched)) or v.callNotice != NoCallNotice

pure def returned(v: Voice): Change =
  { state: { ...v, warmed: if (quiet(v)) false else v.warmed, callNotice: NoCallNotice },
    out: if (v.latched) List(Release({ afterMs: 0 })) else List() }

pure def stepPrewarmNeverOpensTheMicrophone(before: Voice, via: str, after: Voice, out: List[Effect]): bool =
  via == "prewarm" implies (after.mic == before.mic and after.prompting == before.prompting and after.phase == before.phase)

pure def sometimesWarmedBeforeTalking(v: Voice): bool = quiet(v) and v.warmed and v.mic == Off
```

### Starting asks for the microphone the first time, opens it once it is allowed, and holds the speech engine while talking

A conversation starts only when no other voice is running: the recorder is
closed, no stop is left unconfirmed, and Android's prompt is not showing.
Each start is a new session and a new turn. A conversation that starts over
while muted listens with the microphone off until the owner unmutes. Holding
the speech engine while talking keeps models warm across turns until the
conversation stops or fails.

```quint
pure def begin(network: bool, v: Voice): Change =
  if (v.muted)
    { state: { ...v, phase: Listening, network: network, mic: Off, engineHeld: true }, out: holdOut(v) }
  else if (P::allows(v.permission))
    { state: { ...v, network: network, mic: Opening, engineHeld: true },
      out: holdOut(v).concat(List(Listen({ session: v.session, network: network }))) }
  else if (P::canAsk(v.permission))
    { state: { ...v, network: network, mic: Asking, prompting: true, permission: P::ask(v.permission) }, out: List(AskMicrophone) }
  else
    { state: { ...v, phase: Failed, failure: D::Denied, network: false, mic: Off, speaker: SpeakerUnknown, engineHeld: false, reviewPending: false, claim: 0, claimRoute: 0 },
      out: releaseOut(v) }

pure def canStartTalking(v: Voice, now: int): bool =
  quiet(v) and v.recorder.stage == D::Closed and not(v.latched) and not(v.prompting) and v.callNotice == NoCallNotice

pure def startTalking(v: Voice, now: int): Change =
  val fresh = { ...v, phase: Starting, session: v.session + 1, turn: v.turn + 1, heard: false, muted: false,
    failure: D::NoFailure, retries: 0, retryAt: 0, followed: 0, network: false, reviewPending: false }
  if (R::asksConsent(v.route, now)) { state: { ...fresh, disclosing: true }, out: List() }
  else begin(onNetwork(v.route, now), fresh)

pure def alwaysEngineHeldOnlyWhileTalking(v: Voice): bool =
  v.engineHeld implies talking(v)

pure def stepEngineHoldIsBalanced(before: Voice, via: str, after: Voice, out: List[Effect]): bool =
  out.every(e => match e {
    | HoldEngine => not(before.engineHeld) and after.engineHeld
    | ReleaseEngineHold => before.engineHeld and not(after.engineHeld)
    | _ => true
  })
    and ((not(before.engineHeld) and after.engineHeld) implies out.includes(HoldEngine))
    and ((before.engineHeld and not(after.engineHeld) and via != "restart") implies out.includes(ReleaseEngineHold))

pure def sometimesEngineHeldWhileListening(v: Voice): bool = v.phase == Listening and v.engineHeld and v.mic == On
```

### Talk started from the bar or the pill stays there with speech on the phone; with Cloud speech or while typing it brings up the sheet

As in Alpha's Sunday demo build, the bar and the pill draw Talk's small
controls while speech runs on the phone. An open sheet or full view stays
as it is. A hold on a communications bar brings up the sheet before Talk
starts.

```quint
pure def talkRaisesTheSheet(typing: bool, resting: bool, network: bool): bool = typing or (resting and network)

pure def lawSpeechOnThePhoneKeepsTheBar(typing: bool): bool = talkRaisesTheSheet(typing, true, false) == typing
```

### Before audio first leaves the phone, the owner is shown what is sent and where, and decides

Agreeing uses the network service; declining keeps this conversation, and
later ones on that account, on the phone. An Alpha Cloud account has
answered when it signed in, so only an account that has not is asked here.

```quint
pure def canAnswerDisclosure(v: Voice, agree: bool, now: int): bool = v.disclosing and v.phase == Starting

pure def answerDisclosure(v: Voice, agree: bool, now: int): Change =
  val route = R::decide(v.route, agree)
  begin(onNetwork(route, now), { ...v, disclosing: false, route: route })
```

### Android's answer to the prompt opens the microphone, or ends the start quietly when it was denied

The prompt is answered for whichever is waiting on it: the conversation or
the recorder.

```quint
pure def canAnswerPrompt(v: Voice, granted: bool): bool = v.prompting

pure def answerPrompt(v: Voice, granted: bool): Change =
  val base = { ...v, prompting: false, permission: P::observe(v.permission, if (granted) P::Granted else P::Denied) }
  if (v.mic == Asking)
    (if (granted)
      { state: { ...base, mic: Opening, engineHeld: true },
        out: holdOut(v).concat(List(Listen({ session: v.session, network: v.network }))) }
     else
      { state: { ...base, phase: Failed, failure: D::Denied, network: false, mic: Off, speaker: SpeakerUnknown, engineHeld: false, reviewPending: false },
        out: releaseOut(v) })
  else if (v.recorder.stage == D::Starting)
    (if (granted) { state: base, out: List(Record({ ticket: v.recorder.ticket })) }
     else { state: { ...base, recorder: D::recordingFailed(v.recorder, v.recorder.ticket, D::Denied) }, out: List() })
  else { state: base, out: List() }

pure def canPermissionChanged(v: Voice, grant: P::Grant): bool = not(v.prompting)

pure def permissionChanged(v: Voice, grant: P::Grant): Voice = { ...v, permission: P::observe(v.permission, grant) }
```

### The prompt hiding Alpha does not end a start that waits on it

Discovered in the existing app: the first grant of the microphone could
fail, because the pause the prompt causes cancelled the start. Hiding
Alpha otherwise ends the conversation.

```quint
pure def canPageHidden(v: Voice): bool = talking(v)

pure def pageHidden(v: Voice): Change =
  if (v.mic == Asking) { state: v, out: List() }
  else shutDown(D::NoFailure, false, { ...v, callNotice: AwaitingCallCause })

pure def stepThePromptSurvivesHiding(before: Voice, via: str, after: Voice): bool =
  (via == "pageHidden" and before.mic == Asking) implies after == before

pure def sometimesListeningAfterTheFirstGrant(v: Voice): bool =
  v.phase == Listening and v.mic == On and v.permission.asked and v.permission.grant == P::Granted
```

### The microphone opens for the current session only, and a microphone that cannot open fails the conversation

```quint
pure def canMicOpened(v: Voice, session: int): bool = v.mic == Opening and session == v.session and talking(v)

pure def micOpened(v: Voice, session: int): Change =
  val listening = { ...v, mic: On, phase: if (v.phase == Starting) Listening else v.phase }
  val ticket = v.speakerTicket + 1
  if (v.speaker != SpeakerUnknown) { state: listening, out: List() }
  else
    { state: { ...listening, speaker: SpeakerChecking, speakerTicket: ticket },
      out: List(SetSpeakerOutput({ session: session, speakerTicket: ticket, muted: false })) }

pure def canMicFailed(v: Voice, session: int): bool = v.mic == Opening and session == v.session and talking(v)

pure def micFailed(v: Voice, session: int): Change =
  if (v.phase == Starting)
    { state: { ...v, phase: Failed, failure: D::NoMicrophone, network: false, mic: Off, speaker: SpeakerUnknown, engineHeld: false, reviewPending: false },
      out: releaseOut(v) }
  else shutDown(D::NoMicrophone, false, v)
```

### What the owner says is shown as it is heard

In the open conversation, the listening microphone can show the current
capture's interim words as “Heard so far, not sent”. The words come from
that capture's admitted relay or resident stream. On-device previews are
displayed only for the current utterance and follow its event sequence.
The final reported by the microphone still controls sending. The preview
stays out of drafts and history. It clears when the capture, owner, chat
or screen context changes, the microphone is muted, or Talk leaves
Listening.

```quint
pure def canSpeechHeard(v: Voice, session: int): bool = v.phase == Listening and v.mic == On and session == v.session

pure def speechHeard(v: Voice, session: int): Voice = { ...v, heard: true }
```

### When the owner finishes speaking, the microphone closes, and only then is the turn sent, once and automatically

Over Cloud streaming speech, the owner has finished speaking once 400 ms
pass after the relay's final words with no new speech, as the Sunday demo
build timed a Cloud turn (v119, apps/app/src/prototype/voice-adapter.ts:987,
and its voice session's long gap). Speech that starts again within them
continues the same turn: its words join the ones before, so a pause inside
a sentence never sends half of it. Speech on the phone keeps its own timing.

Mute pressed within that gap shuts the microphone at once, and the words
already heard are still sent when the gap ends, as the Sunday demo build's
voice session closed the capture on Mute and then still sent the utterance
waiting on its long gap (v119, .eliza/client-features/packages/voice/src/
voice-assistant-session.ts:596-611). Mute pressed while the owner is still
speaking keeps what they said up to then: the relay's final words for it
still arrive as the microphone shuts, and are sent once the gap after them
ends, as that session's Mute finalized the speech up to then and sent it
(voice-assistant-session.ts:593-611). Unmute pressed within the gap opens
the microphone again and keeps those words and their gap: speech that
starts on the reopened microphone joins them, and they are sent once, when
the gap ends, as that session kept the utterance and its timer across the
capture Unmute opened (voice-assistant-session.ts:612-622 and 722-735).
Mute pressed again while that microphone is still opening keeps them too:
they are still sent once, when the gap ends, as that session's Mute kept the
utterance whether or not its capture had opened (voice-assistant-session.ts:
593-622). A
gap that ends while the reopened microphone is still closing ends the turn
as it closes, and one that ends while it is still opening ends the turn as
soon as it is open. Stop, or the relay's capture ending,
within the gap sends nothing, as that session dropped an utterance not yet
sent (voice-assistant-session.ts:574-575 and 786-797).

```quint
pure def canTurnEnded(v: Voice, session: int): bool =
  v.phase == Listening and v.heard and session == v.session
    and (v.mic == On or (v.network and (v.muted or v.mic == Closing)))

pure def turnEndWaits(v: Voice, session: int): bool =
  v.phase == Listening and v.heard and session == v.session and v.network and not(v.muted) and v.mic == Opening

pure def turnEnded(v: Voice, session: int): Change =
  if (v.mic == On)
    { state: { ...v, phase: Transcribing, mic: Closing }, out: List(CloseMicrophone({ session: v.session })) }
  else if (v.mic == Closing) { state: { ...v, phase: Transcribing }, out: List() }
  else
    { state: { ...v, phase: Thinking, sent: v.turn, heard: false },
      out: List(Send({ session: v.session, turn: v.turn, network: v.network })) }

pure def canMicClosed(v: Voice, session: int): bool = v.mic == Closing and session == v.session and talking(v)

pure def micClosed(v: Voice, session: int): Change =
  if (v.phase == Transcribing)
    { state: { ...v, phase: Thinking, mic: Off, sent: v.turn, heard: false },
      out: List(Send({ session: v.session, turn: v.turn, network: v.network })) }
  else if (mayListen(v) and not(v.muted))
    { state: { ...v, mic: Opening }, out: List(Listen({ session: v.session, network: v.network })) }
  else { state: { ...v, mic: Off }, out: List() }

pure def stepATurnIsSentOnlyOnceTheMicrophoneHasClosed(before: Voice, via: str, after: Voice, out: List[Effect]): bool =
  out.every(e => match e {
    | Send(x) => ((via == "micClosed" and before.phase == Transcribing)
        or (via == "turnEnded" and before.phase == Listening and before.muted and before.network and before.mic == Off))
        and after.mic == Off and out.length() == 1
        and x.session == before.session and x.turn == before.turn and after.sent == before.turn
    | _ => true
  })

pure def lawAGapThatEndsWhileTheMicrophoneOpensEndsTheTurnOnceItIsOpen(session: int): bool =
  val reopening = { ...initial, phase: Listening, session: session, turn: 1, heard: true, network: true, mic: Opening }
  turnEndWaits(reopening, session) and not(canTurnEnded(reopening, session))
    and canTurnEnded(micOpened(reopening, session).state, session)

pure def lawAGapThatEndsWhileTheMicrophoneClosesEndsTheTurnAsItCloses(session: int): bool =
  val closing = { ...initial, phase: Listening, session: session, turn: 1, heard: true, network: true, mic: Closing }
  val ended = turnEnded(closing, session).state
  canTurnEnded(closing, session) and ended.phase == Transcribing
    and micClosed(ended, session).out == List(Send({ session: session, turn: 1, network: true }))
```

### What the owner said shows at once as their message, with Alpha's working dots and then its reply under it, until the conversation records it

When the owner finishes speaking, the words heard for that turn stay in the
open conversation as the owner's own message, and three dots under it show
Alpha at work, as the Sunday demo build did (v119,
apps/app/src/prototype/template.html:4721-4726). They show while that turn
is transcribed and thought about, and while an acknowledgment is said:
the acknowledgment is only spoken, never written there, as the Sunday demo
build only spoke it in Talk (v119, apps/app/src/prototype/voice-adapter.ts:778,
and model.js:6443 drew the dots until reply text came). The reply's text
takes the dots' place in the same moment it is queued to be spoken, as the
Sunday demo build set the spoken text and the chat text together (v119,
apps/app/src/prototype/agent-adapter.ts:2253-2254). Words and reply go the
moment the recorded message and reply take their place, the turn ends
unsent, or Talk leaves it. They are not a draft and not history: only the
recorded rows are kept.

```quint
pure def showsWhatWasSaid(v: Voice, session: int, turn: int): bool =
  alphaResponds(v) and session == v.session and turn == v.turn
```

### A microphone that cannot be closed sends nothing, and shuts the conversation down

```quint
pure def canMicCloseFailed(v: Voice, session: int): bool = v.mic == Closing and session == v.session and talking(v)

pure def micCloseFailed(v: Voice, session: int): Change = shutDown(D::NoMicrophone, false, v)
```

### Alpha's reply is spoken a sentence at a time, sentences streamed before the reply is complete included, and only for the current turn

Hearing Alpha speak shows the voice service works again, so the quiet
retries start over. A sentence is said without the agent's turn tag
([reply](../assistant/reply.md), "The agent's turn tag is never drawn,
copied, quoted, emailed or spoken, and a reply still being written holds
back what may become one"), and a streamed reply that ends in what may
become one is not said past it until the next words decide.

On the phone's own recognizer the first sentence opens the microphone
again, so the owner speaking over Alpha interrupts it, as the Sunday demo
build kept the phone's microphone open through the reply (v119
apps/app/src/prototype/voice-adapter.ts:885-889). On the Cloud speech
relay the microphone stays closed until the whole reply has been heard, as
v119 held its Cloud streaming input closed through the reply
(voice-adapter.ts:889 and 984-986): the relay has no way to interrupt Alpha,
so nothing the owner says over the reply leaves the phone.

```quint
pure def canSentence(v: Voice, session: int, turn: int): bool =
  (v.phase == Thinking or v.phase == Speaking) and session == v.session and turn == v.turn and not(v.replied)

pure def sentence(v: Voice, session: int, turn: int): Change =
  val reopen = not(v.muted) and v.mic == Off and hearsOverAlpha(v)
  { state: { ...v, phase: Speaking, queued: v.queued + 1, playing: v.turn, retries: 0, mic: if (reopen) Opening else v.mic },
    out: List(Play({ session: v.session, turn: v.turn }))
      .concat(if (reopen) List(Listen({ session: v.session, network: v.network })) else List()) }

pure def stepPlaybackFollowsTheCurrentTurn(before: Voice, after: Voice, out: List[Effect]): bool =
  out.every(e => match e { | Play(p) => p.session == after.session and p.turn == after.turn | _ => true })
```

### A spoken reply says a written date, clock time, range and percentage in words

A capitalised weekday and month, in full or shortened ("Mon", "Sept."),
with a day of the month is said in full with the day as an ordinal: "Mon,
Nov 23" is "Monday, November twenty-third". A clock time is said in words:
"3:30 pm" is "three thirty P M", "9:05" is "nine oh five", "7:00" is "seven
o'clock" and "14:30" is "two thirty P M"; twelve with no minutes is "noon"
in the afternoon and "midnight" in the morning ("12 pm", "0:00"). A range
of clock times or short numbers joins its ends with "to" ("2-3 p.m.",
"09:05–10:00", "5–10 minutes"), at the end of a sentence too ("Pages
10-20."), and "%" is "percent". A range never joins two lines: a time or
number that ends one line and a list item that starts the next with a dash
stay apart. A line that ends in a
colon, such as the Calendar heading "Sun, Nov 22:", ends a sentence, and a
colon after a word inside a line is a pause. Digits in an ISO date, a phone
number or an offset such as "UTC+01:00" keep their groups, and a month name
written in lower case ("you may 3") is left as written. Only what is said
changes: the reply written in the chat is never changed.

```quint
type Meridiem = NoMeridiem | Morning | Afternoon
type ClockWords = NoonWord | MidnightWord | HourAndMinutes | HourOClock | HourAlone

pure def meridiemOf(hour: int, written: Meridiem): Meridiem =
  if (written != NoMeridiem) written else if (hour >= 13) Afternoon else if (hour == 0) Morning else NoMeridiem

pure def twelveHour(hour: int): int = if (hour % 12 == 0) 12 else hour % 12

pure def clockWords(hour: int, minute: int, written: Meridiem, minutesWritten: bool): ClockWords =
  if (minute == 0 and twelveHour(hour) == 12 and meridiemOf(hour, written) == Afternoon) NoonWord
  else if (minute == 0 and twelveHour(hour) == 12 and meridiemOf(hour, written) == Morning) MidnightWord
  else if (minute != 0) HourAndMinutes
  else if (minutesWritten and meridiemOf(hour, written) == NoMeridiem) HourOClock
  else HourAlone

pure val hourValues = Set(0, 1, 9, 11, 12, 13, 23)
pure val minuteValues = Set(0, 5, 30)
pure val writtenValues = Set(NoMeridiem, Morning, Afternoon)

pure def lawTwelveInTheAfternoonIsNoon(minutesWritten: bool): bool = clockWords(12, 0, Afternoon, minutesWritten) == NoonWord

pure def lawTwelveInTheMorningIsMidnight(minutesWritten: bool): bool =
  clockWords(12, 0, Morning, minutesWritten) == MidnightWord and clockWords(0, 0, NoMeridiem, minutesWritten) == MidnightWord

pure def lawALateClockIsAfternoon(hour: int): bool = (hour >= 13 and hour <= 23) implies meridiemOf(hour, NoMeridiem) == Afternoon

pure def lawTheHourIsSaidOnATwelveHourClock(hour: int): bool = (hour >= 0 and hour <= 23) implies (twelveHour(hour) >= 1 and twelveHour(hour) <= 12)

pure def lawMinutesAreAlwaysSaid(hour: int, minute: int, written: Meridiem): bool =
  minute != 0 implies clockWords(hour, minute, written, true) == HourAndMinutes
```

### When the whole reply has been heard, Alpha listens for the next turn

On the Cloud speech relay, the microphone reopens on the conversation's own
relay stream under the same owner, for every turn of the conversation.

```quint
pure def nextTurn(heard: bool, v: Voice): Change =
  val reopen = not(v.muted) and v.mic == Off
  { state: { ...v, phase: Listening, turn: v.turn + 1, heard: heard, queued: 0, played: 0, replied: false, playing: 0,
      mic: if (reopen) Opening else v.mic },
    out: if (reopen) List(Listen({ session: v.session, network: v.network })) else List() }

pure def canSentencePlayed(v: Voice, session: int, turn: int): bool =
  v.phase == Speaking and session == v.session and turn == v.turn and v.played < v.queued

pure def sentencePlayed(v: Voice, session: int, turn: int): Change =
  val heardOne = { ...v, played: v.played + 1 }
  if (v.replied and heardOne.played == v.queued) nextTurn(false, heardOne) else { state: heardOne, out: List() }
```

### A reply that needs the owner's review in chat keeps voice listening with the microphone open

Talk takes a proposal from the agent's completed action result and the
phone's matching current enrollment, request and review target. An
admitted review shows in Ask Alpha. If Talk is on the bar, it brings up
the sheet for the review. The reply's prose creates no review. The owner
reviews and decides in chat. Any pre-review reply speech is hushed, and
Talk returns to listening with the microphone open when unmuted. Its
notice follows the last matching review still shown, including while the
decision is being confirmed. When that review settles or leaves this
chat, the notice clears without stopping Talk. A turn that asked Files
directly and ran its Files step says that step's result even beside the
page's card it shows ([Files](../files/index.md)), as v119 never hushed a
direct turn: the result is said in full, Talk then listens, and the notice
still follows that card.

Nothing the owner says decides a review, and the owner's words are never
matched against a phrase. The review stays shown with its Send and Decline
while Talk listens, and the owner decides it there by touch, as typed chat
does. Silence decides nothing. The owner's next words are a turn for the
agent like any other, and the model reads what they mean. When the agent's
reply to them names that same pending text again, unchanged, its review is
shown again for that turn, with its Send and Decline; otherwise it leaves.

Whether a spoken turn asks for a text is the model's to read: Talk matches
nothing in the owner's words to route a turn, and a text review names the
recipient the agent proposed, for the owner to check before Send: by the
contact's name with its number where Messages names that number, as v119's
review did, and by its number otherwise. A spoken
turn from another screen such as Messages keeps the session's capabilities
and non-Files review cards even when direct Files actions are allowed, and
a direct Files result from Messages is still spoken aloud.

What Talk says of a reply that claims a phone step follows what that step
did, never what the reply says of it. A reply claims a step when it
proposed a text to send for review or a step to run at once; any other
reply, one with a review card Talk did not show included, is said as
before. A step that ran here, a direct Files filter or open or a page the
owner asked for, lets the reply be said, and a direct Files step says its
own result. A review shown as a card is decided there, so the reply beside
it is not said. A claimed step Talk neither showed as a card nor ran, such
as a text whose review Talk cannot show, from a Messages chat or off
Messages, or a step the agent marked to run at once that nothing here
runs, means the reply speaks of something that did not happen: the turn
ends quietly without setting the review notice, any queued speech is
hushed, and Talk says nothing of its own about it. The chat still shows
the reply as written.

```quint
pure def canReplyEnds(v: Voice, session: int, turn: int, asks: bool, says: bool): bool =
  (v.phase == Thinking or v.phase == Speaking) and session == v.session and turn == v.turn and not(v.replied)

pure def replyEnds(v: Voice, session: int, turn: int, asks: bool, says: bool): Change =
  val kept = { ...v, reviewPending: v.reviewPending or asks }
  val listening = nextTurn(false, kept)
  if (not(says))
    { state: listening.state, out: List(Hush({ turn: v.turn })).concat(listening.out) }
  else if (v.queued == v.played) listening
  else { state: { ...kept, replied: true }, out: List() }

pure def lawAReviewSaidBesideIsNeverHushed(session: int, played: int): bool =
  val ended = replyEnds({ ...initial, phase: Speaking, mic: Off, session: session, turn: 1, queued: 2, played: played }, session, 1, true, true)
  ended.out.every(e => match e { | Hush(_) => false | _ => true }) and ended.state.reviewPending

pure def lawAQuietEndingHushesWithoutAReviewNotice(session: int, played: int): bool =
  val ended = replyEnds({ ...initial, phase: Speaking, mic: Off, session: session, turn: 1, queued: 2, played: played }, session, 1, false, false)
  ended.out.includes(Hush({ turn: 1 })) and not(ended.state.reviewPending) and ended.state.phase == Listening

pure def replySaid(claimed: bool, shown: bool, ran: bool, reported: bool): bool =
  reported or (not(shown) and (not(claimed) or ran))

pure def lawAStepThatNeitherShowedNorRanIsNeverClaimed(reported: bool): bool =
  replySaid(true, false, false, reported) == reported

pure def lawAReplyWithNoClaimOrAStepThatRanIsSaid(claimed: bool, ran: bool): bool =
  (not(claimed) or ran) implies replySaid(claimed, false, ran, false)

pure def lawAShownReviewSaysOnlyAStepResult(claimed: bool, ran: bool, reported: bool): bool =
  replySaid(claimed, true, ran, reported) == reported

pure def canReviewSettled(v: Voice): bool = talking(v) and v.reviewPending

pure def reviewSettled(v: Voice): Voice = { ...v, reviewPending: false }

pure def stepReviewKeepsVoiceAndMicrophoneOpen(before: Voice, via: str, after: Voice, out: List[Effect]): bool =
  ((via == "replyEnds" and after.reviewPending and not(after.replied)) implies
    (after.phase == Listening and talking(after)
      and out.every(e => match e { | CloseMicrophone(_) => false | Shut(_) => false | _ => true })
      and (not(after.muted) implies (opened(after.mic) or after.mic == Closing))))
    and (via == "reviewSettled" implies (talking(after) and after.phase == before.phase and after.mic == before.mic and not(after.reviewPending)))
```

### A turn Cloud refuses because the account is out of funds ends voice quietly, as Stop does

Cloud's own code for an account with no plan allowance and no credits
left decides it, never the owner's words, whether Cloud refuses a spoken
turn or the start or stream of real-time Talk. Nothing of the turn is
spoken, voice shows no text of its own about it, and it does not listen
again or fall back to another route: the conversation shuts down as Stop
shuts it. The only word of it is the conversation's one fixed line for
out of funds, with Manage plan, left once in the conversation showing as
for a refused reply, with Ask Alpha raised to its sheet when it was lower;
the next turn there clears it.

```quint
pure def canRefusedForFunds(v: Voice, session: int, turn: int): bool =
  talking(v) and v.mic != Asking and not(v.disclosing) and session == v.session and turn == v.turn and not(v.replied)

pure def refusedForFunds(v: Voice, session: int, turn: int): Change = shutDown(D::NoFailure, false, v)

pure def stepAFundingRefusalEndsVoiceQuietly(before: Voice, via: str, after: Voice, out: List[Effect]): bool =
  via == "refusedForFunds" implies
    (after.phase == Stopping and after.failure == D::NoFailure and after.queued == 0
      and out.every(e => match e { | Play(_) => false | Listen(_) => false | Send(_) => false | _ => true }))
```

### The conversation can be answered aloud, keep listening while review is pending, and listen again

```quint
pure def sometimesSpeaking(v: Voice): bool = v.phase == Speaking and v.mic == On

pure def sometimesListeningWithReviewPending(v: Voice): bool = v.phase == Listening and v.reviewPending and v.mic == On and v.sent >= 1

pure def sometimesListeningAgain(v: Voice): bool = v.phase == Listening and v.sent >= 1
```

### The microphone is off while Alpha transcribes, thinks or is stopping

```quint
pure def alwaysTheMicrophoneIsClosedWhileAlphaWorks(v: Voice): bool =
  (v.phase == Transcribing or v.phase == Thinking or v.phase == Stopping)
    implies not(opened(v.mic) or v.mic == Asking)
```

### Only the conversation's own start waits on Android's prompt

```quint
pure def alwaysTheMicrophoneIsAskedForOnlyWhileStarting(v: Voice): bool =
  (v.mic == Asking implies (v.phase == Starting and not(v.disclosing)))
    and (v.disclosing implies (v.phase == Starting and v.mic == Off))
    and (talking(v) implies (v.prompting == (v.mic == Asking)))
    and (opened(v.mic) implies (v.phase == Starting or v.phase == Listening or v.phase == Speaking))
```

### A quiet or stopping conversation holds nothing: no disclosure, no speech, no engine hold, no review notice and no claim, and a quiet one no microphone

```quint
pure def alwaysAQuietConversationHoldsNothing(v: Voice): bool =
  (quiet(v) implies v.mic == Off)
    and ((quiet(v) or v.phase == Stopping) implies
      (not(v.disclosing) and v.retryAt == 0 and v.queued == 0 and v.playing == 0 and v.claim == 0
        and not(v.engineHeld) and not(v.reviewPending)))
```

### Talk keeps what it sends in the selected Ask Alpha conversation

Starting Talk leaves the selected conversation and typed draft alone. A
first accepted utterance uses the owner's selected conversation. From a
blank chat, the first utterance may ask Chats to make one conversation
while the editor is empty and no other send is in hand. An unsent draft
keeps its own slot. Typed and spoken turns take the same exclusive posting
place while either may still reach the agent. The recorded user and reply
rows appear under the identities the agent confirms, on the latest page
of that conversation. Opening older history keeps its place.

```quint
pure def alwaysSentTurnsBelongToASession(v: Voice): bool =
  (v.sent > 0 or v.turn > 0 or talking(v)) implies v.session > 0

pure def talkCreatesBlankConversation(
  hasSelectedChat: bool, editorEmpty: bool, sendInFlight: bool
): bool =
  not(hasSelectedChat) and editorEmpty and not(sendInFlight)

pure def talkTurnCanPost(sendInFlight: bool): bool = not(sendInFlight)

pure def lawTalkRespectsSelectedChatAndExclusivePostSlot(
  hasSelectedChat: bool, editorEmpty: bool, sendInFlight: bool
): bool =
  (hasSelectedChat implies not(talkCreatesBlankConversation(hasSelectedChat, editorEmpty, sendInFlight)))
    and (sendInFlight implies not(talkTurnCanPost(sendInFlight)))
```

### A heard turn waits for the send in hand, is sent once after it, and is given up quietly only after 30 s

What the owner finished saying is never dropped because another send
still holds the posting place: a typed message on its way to the agent,
its attachments still being stored included, a typed message waiting for
the conversation Chats is making for it, a request about a subject, or the
turn the owner spoke over or stopped still letting go of the agent. The
heard turn takes the posting place only once none of these is in hand, so
the send it waited for is never refused because of it, and it is then sent
once, after that send, in the selected conversation. Only a send still in
hand 30 s after the owner's turn ended gives the turn up, and then quietly,
as a turn that ends unsent: nothing is said or shown, the turn is never
sent later, and Alpha listens again. A turn that has taken the posting
place is no longer given up for the wait: making its conversation and
asking for its reply go on as any turn's do.

```quint
pure val spokenTurnWaitMs = 30000

pure val waitedMsValues = Set(0, 29999, 30000, 60000)

pure def heardTurnPosts(sendInHand: bool, decided: bool): bool = talkTurnCanPost(sendInHand) and not(decided)

pure def heardTurnWaits(sendInHand: bool, waitedMs: int, decided: bool): bool =
  sendInHand and waitedMs < spokenTurnWaitMs and not(decided)

pure def heardTurnGivenUp(sendInHand: bool, waitedMs: int, decided: bool): bool =
  sendInHand and waitedMs >= spokenTurnWaitMs and not(decided)

pure def lawAHeardTurnIsPostedOnceAfterTheSendInHandOrGivenUpOnlyAfterTheWait(sendInHand: bool, waitedMs: int, decided: bool): bool =
  val posts = heardTurnPosts(sendInHand, decided)
  val waits = heardTurnWaits(sendInHand, waitedMs, decided)
  val givenUp = heardTurnGivenUp(sendInHand, waitedMs, decided)
  (decided implies not(posts or waits or givenUp))
    and (not(decided) implies (posts or waits or givenUp))
    and not(posts and waits) and not(posts and givenUp) and not(waits and givenUp)
    and (posts implies not(sendInHand))
    and (givenUp implies waitedMs >= spokenTurnWaitMs)
```

### What was heard but not sent is never counted as sent

The owner sees it as "Heard so far, not sent". A turn still being heard,
transcribed has not been sent.

```quint
pure def alwaysHeardSpeechIsNotSent(v: Voice): bool =
  v.sent <= v.turn and (v.heard implies v.sent < v.turn) and v.session >= 0 and v.turn >= 0
    and ((v.phase == Starting or v.phase == Listening or v.phase == Transcribing) implies v.sent < v.turn)

pure def sometimesHeardButNotSent(v: Voice): bool = v.phase == Idle and v.heard
```

### Alpha is speaking exactly while sentences of the current turn are queued

So what Alpha is saying, streamed or not, is always known while it speaks.

```quint
pure def alwaysPlaybackIsTheCurrentTurns(v: Voice): bool =
  (v.phase == Speaking iff v.queued > 0)
    and (v.playing != 0 implies (v.playing == v.turn and v.phase == Speaking))
    and (v.phase == Speaking implies v.playing == v.turn)
    and 0 <= v.played and v.played <= v.queued
    and (v.replied implies v.phase == Speaking)
```

## Story: Mute, interrupt and stop

> As the owner, I want to mute the microphone, cut Alpha off when it is
> talking, and end the conversation at any time.

### Mute turns the microphone off, and unmuting opens it again only where Alpha listens

The microphone control acts while Alpha listens, and whenever the
microphone is open while Alpha answers. While Talk connects it waits,
dimmed and unconfirmed. While Alpha answers a turn (transcribing, thinking
or speaking) with the microphone really closed, it waits, dimmed, and shows
the microphone paused, as the Sunday demo build held it ("Microphone paused
while Alpha responds" only while its input was held closed, v119
apps/app/src/prototype/voice-adapter.ts:1116-1118 and 1631-1633,
phone.css:920; demo frames v89-064, v89-072, v89-076). On the Cloud speech
relay that is the whole reply. Where the phone's own recognizer opens the
microphone again while Alpha speaks, so that speaking over Alpha interrupts
it, the control shows it open and mutes it, as v119 kept the phone's
microphone open through the reply and offered Mute there
(voice-adapter.ts:885-889, 1117 and 1631). The control never shows the
microphone paused or off while it is open, and an open microphone can
always be shut without ending Talk.
Stop and the speaker stay available.

```quint
pure def canMute(v: Voice): bool =
  talking(v) and not(v.muted) and v.mic != Asking and (v.phase == Listening or (alphaResponds(v) and opened(v.mic)))

pure def micHeld(v: Voice): bool = alphaResponds(v) and not(v.muted) and (v.mic == Off or v.mic == Closing)

pure def mute(v: Voice): Change = { state: { ...v, muted: true, mic: closedMic(v.mic) }, out: closeOut(v) }

pure def canUnmute(v: Voice): bool = talking(v) and v.muted

pure def unmute(v: Voice): Change =
  if (mayListen(v) and v.mic == Off)
    { state: { ...v, muted: false, mic: Opening }, out: List(Listen({ session: v.session, network: v.network })) }
  else { state: { ...v, muted: false }, out: List() }

pure def alwaysMutedMeansTheMicrophoneIsOff(v: Voice): bool = v.muted implies (v.mic == Off or v.mic == Closing)

pure def sometimesMutedWhileListening(v: Voice): bool = v.muted and v.phase == Listening

pure def alwaysAnOpenMicrophoneCanBeShut(v: Voice): bool =
  (alphaResponds(v) and not(v.muted) and opened(v.mic)) implies (canMute(v) and not(micHeld(v)))

pure def alwaysTheRelayMicrophoneIsClosedWhileAlphaSpeaks(v: Voice): bool =
  (v.phase == Speaking and not(hearsOverAlpha(v))) implies not(opened(v.mic) or v.mic == Asking)
```

### Speaker mute is offered after the current speech bridge confirms gain control

The owner can silence Alpha without changing the microphone or interrupting
the answer. The button waits for a receipt owned by the current session and
request. While Talk connects and while that first receipt is awaited, the
speaker control stands in its place, dimmed, as the Sunday demo build drew it
(v119 apps/app/src/prototype/voice-adapter.ts:1121, the control disabled
while starting or pending). The receipt says which gain the bridge confirmed. The phone retires
its Talk gain before another conversation or reading can use local playback.

```quint
pure def canSetSpeakerMuted(v: Voice, muted: bool): bool =
  talking(v)
    and (if (muted) v.speaker == SpeakerOn else v.speaker == SpeakerOff)

pure def setSpeakerMuted(v: Voice, muted: bool): Change =
  val ticket = v.speakerTicket + 1
  { state: { ...v, speaker: if (muted) SpeakerMuting else SpeakerUnmuting, speakerTicket: ticket },
    out: List(SetSpeakerOutput({ session: v.session, speakerTicket: ticket, muted: muted })) }

pure def canSpeakerSet(v: Voice, session: int, speakerTicket: int, muted: bool, confirmed: bool): bool =
  talking(v) and v.session == session and v.speakerTicket == speakerTicket
    and (if (muted) v.speaker == SpeakerMuting else v.speaker == SpeakerUnmuting or v.speaker == SpeakerChecking)

pure def speakerSet(v: Voice, session: int, speakerTicket: int, muted: bool, confirmed: bool): Voice =
  { ...v, speaker: if (not(confirmed)) SpeakerUnavailable else if (muted) SpeakerOff else SpeakerOn }

pure def alwaysSpeakerControlsBelongToTalk(v: Voice): bool =
  v.speaker == SpeakerUnknown or talking(v)

pure def stepChangingOutputKeepsTheMicrophone(before: Voice, via: str, after: Voice, out: List[Effect]): bool =
  (via == "setSpeakerMuted" or via == "speakerSet") implies (before.mic == after.mic and before.muted == after.muted)
```

### The owner speaking over Alpha interrupts it and starts the next turn, but Alpha's own voice never does

Everything Alpha is saying, streamed sentences included, is the reference
the voice service compares what it hears with. Discovered in the existing
app: during streamed playback that reference was empty, so Alpha's own
reply could interrupt it.

```quint
pure def canBargeIn(v: Voice, session: int, echo: bool): bool =
  v.phase == Speaking and v.mic == On and not(v.muted) and not(echo) and session == v.session and v.queued > 0

pure def bargeIn(v: Voice, session: int, echo: bool): Change =
  val n = nextTurn(true, v)
  { state: n.state, out: List(Hush({ turn: v.turn })).concat(n.out) }

pure def lawAlphasOwnVoiceNeverInterruptsIt(session: int): bool =
  not(canBargeIn({ ...initial, phase: Speaking, mic: On, session: session, turn: 1, queued: 1, playing: 1 }, session, true))

pure def sometimesInterruptedBySpeech(v: Voice): bool = v.phase == Listening and v.heard and v.sent >= 1 and v.mic == On
```

### Interrupt stops Alpha speaking and listens for the next turn

```quint
pure def canInterrupt(v: Voice): bool = v.phase == Speaking

pure def interrupt(v: Voice): Change =
  val n = nextTurn(false, v)
  { state: n.state, out: List(Hush({ turn: v.turn })).concat(n.out) }
```

### Stop shuts the conversation down, and a stop asked for the keyboard then hands it over

A stop is settled once the microphone and speech are confirmed off. Only
what could go on listening or making sound counts: the agent acknowledging
that it closed its side of the speech session, a Cloud speech session the
relay was never asked to start or refused to start, and the speaker's volume
being set back do not. Talk's
controls offer Stop and no keyboard switch. Both are as in Alpha's Sunday
demo build.

```quint
pure def shutDown(failure: D::Failure, keyboard: bool, v: Voice): Change =
  { state: { ...v, phase: Stopping, failure: failure, mic: closedMic(v.mic), disclosing: false, retryAt: 0,
      queued: 0, played: 0, replied: false, playing: 0, claim: 0, claimRoute: 0, engineHeld: false, reviewPending: false, speaker: SpeakerUnknown },
    out: List(Shut({ session: v.session, keyboard: keyboard })).concat(releaseOut(v)) }

pure def canStop(v: Voice, keyboard: bool): bool = talking(v)

pure def stop(v: Voice, keyboard: bool): Change = shutDown(D::NoFailure, keyboard, v)

pure def canStopped(v: Voice, confirmed: bool): bool = v.phase == Stopping

pure def stopped(v: Voice, confirmed: bool): Change =
  { state: { ...v, phase: if (v.failure == D::NoFailure) Idle else Failed, mic: Off, network: false, latched: v.latched or not(confirmed) },
    out: if (confirmed) List() else List(Release({ afterMs: releaseAgainMs })) }

pure val fair_stopped = "weak"

pure def leadsToAStopSettles(v: Voice, later: Voice): bool = v.phase == Stopping implies later.phase != Stopping

pure def canDismiss(v: Voice): bool = v.phase == Failed

pure def dismiss(v: Voice): Voice = { ...v, phase: Idle, failure: D::NoFailure }
```

### A stop that could not be confirmed keeps voice closed until the microphone and speech are confirmed off

The microphone or speech may still be running, so neither a conversation
nor dictation starts, and no words are shown. Alpha asks again whether they
are off two seconds after the stop, then, while they are still not, after
twice as long each time, up to every thirty seconds, and at once each time
it returns to the foreground; once they are, voice opens again and Talk is
offered, with no restart.

```quint
pure val releaseAgainMs = 2000

pure val releaseAgainMostMs = 30000

pure val afterMsValues = Set(0, 2000, 16000, 30000)

pure def againAfter(afterMs: int): int =
  if (afterMs < releaseAgainMs) releaseAgainMs
  else if (afterMs * 2 > releaseAgainMostMs) releaseAgainMostMs
  else afterMs * 2

pure def alwaysAnUnconfirmedStopKeepsVoiceClosed(v: Voice): bool =
  v.latched implies (quiet(v) and v.recorder.stage == D::Closed)

pure def canReleased(v: Voice, confirmed: bool, afterMs: int): bool = v.latched

pure def released(v: Voice, confirmed: bool, afterMs: int): Change =
  { state: { ...v, latched: not(confirmed) },
    out: if (confirmed) List() else List(Release({ afterMs: againAfter(afterMs) })) }

pure def stepAnUnconfirmedStopIsAskedAgain(before: Voice, via: str, after: Voice, out: List[Effect]): bool =
  ((after.latched and not(before.latched)) implies out.includes(Release({ afterMs: releaseAgainMs })))
    and ((via == "released" and after.latched) implies not(out.every(e => match e { | Release(_) => false | _ => true })))

pure def sometimesStopUnconfirmed(v: Voice): bool = v.latched
```

### A failed conversation ends quietly: why it failed is kept only until voice returns to idle, and nothing is shown

As in the existing app, a conversation that could not start or went on
failing shows no words: voice returns to idle at once, and Talk is offered
again. Talk asked for during a call or while speech is unavailable, from
Ask Alpha or the communications bar, does nothing and shows no words, and
speech that cannot be played ends the turn the same way, with no words.

```quint
pure def alwaysAFailureIsKeptOnlyOnceStopped(v: Voice): bool =
  (v.phase == Failed implies v.failure != D::NoFailure)
    and (v.failure != D::NoFailure implies (v.phase == Failed or v.phase == Stopping))
    and (v.failure == D::NoFailure or v.failure == D::Denied or v.failure == D::NoMicrophone or v.failure == D::Recognition)

pure def canOpenSettings(v: Voice): bool = v.failure == D::Denied or D::offersSettings(v.recorder)

pure def openSettings(v: Voice): Change = { state: v, out: List(OpenSettings) }

pure def sometimesDenied(v: Voice): bool = v.phase == Failed and v.failure == D::Denied
```

## Story: Pause for a phone call

> As the owner, I want a call to end Talk and release the microphone and
> speaker. After the call, I can choose to start Talk again.

### A phone call ends Talk quietly, and only the owner starts it again

Talk releases its audio and retires its in-flight turn under the normal
confirmed stop, and shows no words: no toast, popup, banner or status
line, then or when Alpha shows again. A call reported by the phone or a
matching native speech request can identify this stop. If the activity
hid during Talk, remember whether a call was observed until Alpha shows
again; a plain app switch clears the pending cause the same way. Only an
explicit Talk request starts a new conversation after the call. A call
state the phone has not told is not a call, and does not keep Talk from
starting.

```quint
pure def canCallInterrupted(v: Voice, session: int, foreground: bool): bool =
  session == v.session and (talking(v) or v.callNotice == AwaitingCallCause)

pure def callInterrupted(v: Voice, session: int, foreground: bool): Change =
  val ended = if (talking(v)) shutDown(D::NoFailure, false, v) else { state: v, out: List() }
  { state: { ...ended.state, callNotice: if (foreground) NoCallNotice else CallNoticeOnReturn }, out: ended.out }

pure def stepACallStopsTalk(before: Voice, via: str, after: Voice, out: List[Effect]): bool =
  (via == "callInterrupted") implies (not(talking(after)) and
    out.every(e => match e { | Listen(_) => false | _ => true }))

pure def sometimesCallNoticeOnReturn(v: Voice): bool = v.callNotice == CallNoticeOnReturn
```

## Story: Keep talking when speech fails

> As the owner, I want a failing network service not to end my
> conversation: carry on on the phone, wait out a brief refusal, and only
> tell me when nothing works.

### A network failure before Alpha has spoken moves the conversation to the phone at once, and the failed turn is not sent again

The phone's speech must be ready; the route then holds the network off. A
failure with the phone's speech unavailable holds nothing.

```quint
pure def canSpeechFailed(v: Voice, session: int, fault: R::Fault, wait: int, deviceReady: bool, now: int): bool =
  talking(v) and session == v.session and v.mic != Asking and not(v.disclosing) and v.retryAt == 0
    and now >= 0

pure def speechFailed(v: Voice, session: int, fault: R::Fault, wait: int, deviceReady: bool, now: int): Change =
  val route = if (deviceReady) R::noteFailure(v.route, fault, wait, now) else R::clearHold(v.route)
  val transient = fault == R::Brief or fault == R::RateLimited
  val base = { ...v, route: route, queued: 0, played: 0, replied: false, playing: 0, claim: 0, claimRoute: 0, speaker: SpeakerUnknown }
  val shut = List(Shut({ session: v.session, keyboard: false }))
  val onPhone = begin(false, { ...base, phase: Starting, session: v.session + 1, turn: v.turn + 1, heard: false, mic: Off })
  if (v.network and R::fallsBack(fault) and v.played == 0 and v.queued == 0 and deviceReady)
    { state: onPhone.state, out: shut.concat(onPhone.out) }
  else if (transient and v.retries < 2 and wait <= 30000)
    { state: { ...base, phase: Starting, mic: Off, turn: v.turn + 1, heard: false, retries: v.retries + 1,
        retryAt: now + (if (wait > 0) wait else 2000) }, out: shut }
  else shutDown(if (transient) D::NoFailure else D::Recognition, false, { ...v, route: route })

pure def sometimesFellBackToThePhone(v: Voice): bool = v.phase == Listening and not(v.network) and v.route.holdUntil > 0 and v.session >= 2
```

### A brief refusal is retried quietly after the server's wait, at most twice; a long wait or a third refusal ends voice calmly

Discovered by the proof: the time of a retry is never before the start of
time, so a conversation with no retry waiting holds none.

```quint
pure def canRetryDue(v: Voice, now: int): bool = v.phase == Starting and v.retryAt > 0 and now >= v.retryAt

pure def retryDue(v: Voice, now: int): Change =
  begin(onNetwork(v.route, now), { ...v, session: v.session + 1, retryAt: 0 })

pure def alwaysAtMostTwoQuietRetries(v: Voice): bool =
  0 <= v.retries and v.retries <= 2 and v.retryAt >= 0
    and (v.retryAt > 0 implies (v.phase == Starting and v.retries > 0 and v.mic == Off and not(v.disclosing)))

pure def sometimesSecondQuietRetry(v: Voice): bool = v.retries == 2 and v.retryAt > 0
```

## Story: Go where the conversation takes me

> As the owner, I want Alpha to open the screen it is talking about and
> keep talking there, and to stop talking when I go somewhere else myself.

### An active voice conversation may ask the shell to open Home or any admitted screen

Place 1 names Home and every higher place names an admitted app. A
completed reply moves the shell only by what its actions prepared, a view or
a page, never by the words of the reply. A streaming preview cannot move the
shell. An admitted navigation
belongs to the current voice turn and the source route that it was sent
from. Once admitted, its claim remains until the shell's route is observed
or the shell declines to move.

```quint
pure def canAgentNavigates(v: Voice, session: int, turn: int, place: int, sourceRoute: int): bool =
  canSentence(v, session, turn) and v.claim == 0 and place > 0 and sourceRoute >= 0

pure def agentNavigates(v: Voice, session: int, turn: int, place: int, sourceRoute: int): Change =
  { state: { ...v, claim: place, claimRoute: sourceRoute + 1 }, out: List(Navigate({ session: session, turn: turn, place: place, sourceRoute: sourceRoute })) }

pure def stepNavigationBelongsToItsTurn(before: Voice, after: Voice, out: List[Effect]): bool =
  out.every(e => match e {
    | Navigate(n) => before.claim == 0 and after.claim == n.place and after.claimRoute == n.sourceRoute + 1
      and canSentence(before, n.session, n.turn)
    | _ => true
  })
```

### An exact spoken Files request may follow its own leased navigation once

After its reply finishes, the agent's one direct filter, or open by path,
can open Files from another screen when the same voice turn, source and
direct-action permission still hold; the turn keeps its words for the
phone's result only once the agent proposes a Files action. A result
position only refers to an existing Files listing. It uses the same spoken
navigation claim. Stop and the owner's navigation can retire the request
before the file action.

```quint
pure def alwaysNavigationClaimRequiresTalking(v: Voice): bool =
  v.claim != 0 implies talking(v)

pure def spokenFilesNavigationAdmitted(
  sameVoiceTurn: bool, sameSourceScreen: bool, directActionPermitted: bool,
  retiredByOwnerOrStop: bool, alreadyFollowed: bool
): bool =
  sameVoiceTurn and sameSourceScreen and directActionPermitted
    and not(retiredByOwnerOrStop) and not(alreadyFollowed)

pure def lawSpokenFilesNavigationRunsAtMostOnceWhileActive(
  sameVoiceTurn: bool, sameSourceScreen: bool, directActionPermitted: bool
): bool =
  not(spokenFilesNavigationAdmitted(sameVoiceTurn, sameSourceScreen, directActionPermitted, true, false))
    and not(spokenFilesNavigationAdmitted(sameVoiceTurn, sameSourceScreen, directActionPermitted, false, true))
```

### A navigation claim is released when the shell does not open its destination

```quint
pure def canClaimReleased(v: Voice, session: int): bool =
  talking(v) and session == v.session and v.claim != 0

pure def claimReleased(v: Voice, session: int): Voice =
  { ...v, claim: 0, claimRoute: 0 }
```

### Voice keeps talking after a navigation only when it is the one the conversation asked for; any other ends it

The shell names the exact route and whether Talk wrote it. Arriving manually
at the requested destination still ends Talk.

```quint
pure def canNavigated(v: Voice, place: int, arrivedRoute: int, spoken: bool): bool =
  place > 0 and arrivedRoute > 0

pure def navigated(v: Voice, place: int, arrivedRoute: int, spoken: bool): Change =
  if (not(talking(v))) { state: v, out: List() }
  else if (spoken and v.claim != 0 and place == v.claim and v.claimRoute == arrivedRoute)
    { state: { ...v, claim: 0, claimRoute: 0, followed: place }, out: List() }
  else shutDown(D::NoFailure, false, v)

pure def stepVoiceFollowsOnlyItsOwnNavigation(before: Voice, via: str, after: Voice): bool =
  (via == "navigated" and talking(before) and talking(after)) implies (before.claim != 0 and after.followed == before.claim)

pure def alwaysAClaimBelongsToAnActiveConversation(v: Voice): bool =
  (v.claim != 0 implies (v.phase == Listening or v.phase == Transcribing or v.phase == Thinking or v.phase == Speaking))
    and v.claim >= 0 and v.claimRoute >= 0 and ((v.claim == 0) == (v.claimRoute == 0))

pure def sometimesFollowedItsNavigation(v: Voice): bool = v.followed != 0 and talking(v)

pure val eval_witness_sometimesFollowedItsNavigation = (
  ("startTalking", 0), ("answerPrompt", true), ("micOpened", 1), ("speechHeard", 1),
  ("turnEnded", 1), ("micClosed", 1), ("agentNavigates", 1, 1, 1, 0), ("navigated", 1, 1, true)
)

pure def sometimesFollowedAgentNavigationWhileListening(v: Voice): bool = v.phase == Listening and v.followed != 0 and v.mic == On

pure val eval_witness_sometimesFollowedAgentNavigationWhileListening = (
  ("startTalking", 0), ("answerPrompt", true), ("micOpened", 1), ("speechHeard", 1),
  ("turnEnded", 1), ("micClosed", 1), ("agentNavigates", 1, 1, 1, 0), ("navigated", 1, 1, true),
  ("replyEnds", 1, 1, false, false), ("micOpened", 1)
)
```

## Story: Choose where my speech goes

> As the owner, I want my account, its limits and my answer to the
> disclosure to decide where speech is processed.

### Signing in, out or to another account changes the route, invalidates warmup, and ends a running conversation

An account or provider key is told with its key, and signing out with none.
Signing in to Alpha Cloud is the owner's agreement to have speech processed
there, as it was in the existing app: Talk asks nothing more.

```quint
pure def canAccountChanged(v: Voice, account: R::Account, key: int): bool =
  if (account == R::SignedOut) key == 0 else key > 0

pure def accountChanged(v: Voice, account: R::Account, key: int): Change =
  val changed = R::changeAccount(v.route, account, key)
  val signedIn = { ...v, warmed: false, route: if (account == R::CloudAccount) R::decide(changed, true) else changed }
  if (talking(v)) shutDown(D::NoFailure, false, signedIn) else { state: signedIn, out: List() }
```

### Cloud's plan and rate limits are recorded on the route

```quint
pure def canLimitChanged(v: Voice, limited: bool): bool = v.route.limited != limited

pure def limitChanged(v: Voice, limited: bool): Voice = { ...v, route: R::limit(v.route, limited) }
```

### The owner can agree to network speech, or withdraw, in Settings while no conversation runs

```quint
pure def canChooseNetworkSpeech(v: Voice, agree: bool): bool = not(talking(v))

pure def chooseNetworkSpeech(v: Voice, agree: bool): Voice = { ...v, route: R::decide(v.route, agree) }
```

### Audio leaves the phone only on a route the owner agreed to

```quint
pure def stepAudioLeavesOnlyWithConsent(before: Voice, after: Voice, out: List[Effect]): bool =
  out.every(e => match e {
    | Prewarm(x) => x.network implies after.route.consent
    | Listen(x) => x.network implies after.route.consent
    | Send(x) => x.network implies after.route.consent
    | Transcribe(x) => x.network implies after.route.consent
    | _ => true
  })

pure def alwaysANetworkConversationHasConsent(v: Voice): bool =
  (talking(v) and v.network) implies v.route.consent

pure def sometimesTalkingOverTheNetwork(v: Voice): bool = v.phase == Listening and v.network and v.mic == On

pure def sometimesDisclosureShown(v: Voice): bool = v.disclosing
```

### A page served by Alpha's development server talks through that server's own Cloud speech relay, and a page that names none offers no Talk

Talk in such a page uses the browser's microphone and the relay at the
server's own /cloud path, whose server holds the account's key: the page
never holds one. A page that names no relay, or any path but /cloud, offers
no Talk.

```quint
pure val pageSpeechPath = "/cloud"

pure def relaysPageSpeech(named: str): bool = named == pageSpeechPath

pure def lawOnlyTheOwnRelayCarriesPageSpeech(named: str): bool = relaysPageSpeech(named) iff named == "/cloud"
```

### After a restart only the account and the owner's answer to the disclosure remain

Holds, latches and anything in flight are gone; the permission is Android's.

```quint
pure def restart(v: Voice): Voice = { ...initial, permission: v.permission, route: R::clearHold(v.route) }

pure def stepARestartKeepsOnlyWhatIsStored(before: Voice, via: str, after: Voice): bool =
  via == "restart" implies
    (after.route.consent == before.route.consent and after.route.account == before.route.account
      and after.route.holdUntil == 0 and quiet(after) and not(after.latched))
```

## Story: Dictate into a field

> As the owner, I want to dictate into Notes, the composer or a messaging
> bar with the same recorder, and get text I edit and send myself.

### The recorder opens only while no conversation is running, and a conversation starts only while the recorder is closed

So the microphone serves one of them at a time.

```quint
pure def canOpenRecorder(v: Voice, target: D::Field): bool =
  quiet(v) and not(v.latched) and D::canOpenRecorder(v.recorder)

pure def openRecorder(v: Voice, target: D::Field): Change =
  val opened = D::openRecorder(v.recorder, target)
  { state: { ...v, recorder: opened },
    out: if (target == D::ComposerField) List(CheckDictation({ ticket: opened.ticket })) else List() }

pure def alwaysOneVoiceAtATime(v: Voice): bool = v.recorder.stage != D::Closed implies quiet(v)
```

### Only the current Ask Alpha recorder takes the answer to its recognition check

```quint
pure def canRecognitionChecked(v: Voice, ticket: int, ready: bool): bool = D::canRecognitionChecked(v.recorder, ticket, ready)

pure def recognitionChecked(v: Voice, ticket: int, ready: bool): Voice =
  { ...v, recorder: D::recognitionChecked(v.recorder, ticket, ready) }
```

### Recording asks for the microphone the first time, like a conversation

```quint
pure def canStartRecording(v: Voice): bool = not(v.prompting) and D::canStartRecording(v.recorder)

pure def startRecording(v: Voice): Change =
  val r = D::startRecording(v.recorder)
  if (P::allows(v.permission)) { state: { ...v, recorder: r }, out: List(Record({ ticket: r.ticket })) }
  else if (P::canAsk(v.permission))
    { state: { ...v, recorder: r, prompting: true, permission: P::ask(v.permission) }, out: List(AskMicrophone) }
  else { state: { ...v, recorder: D::recordingFailed(r, r.ticket, D::Denied) }, out: List() }

pure def canRecordingStarted(v: Voice, ticket: int): bool = not(v.prompting) and D::canRecordingStarted(v.recorder, ticket)

pure def recordingStarted(v: Voice, ticket: int): Voice = { ...v, recorder: D::recordingStarted(v.recorder, ticket) }

pure def canRecordingFailed(v: Voice, ticket: int, failure: D::Failure): bool =
  not(v.prompting) and D::canRecordingFailed(v.recorder, ticket, failure)

pure def recordingFailed(v: Voice, ticket: int, failure: D::Failure): Voice =
  { ...v, recorder: D::recordingFailed(v.recorder, ticket, failure) }
```

### A clip is transcribed on the route speech takes now

When Android finalizes the current recording, the recorder takes that exact
clip as stopped. Automatic transcription runs while the phone and its
recording's screen are in front. Otherwise the finished clip waits for the
owner to retry. An unconfirmed manual stop has no clip to transcribe or
retry. Late answers and duplicate stops have no effect.

```quint
pure def canStopRecording(v: Voice, now: int): bool = D::canStopRecording(v.recorder)

pure def transcribingDictation(now: int, automatic: bool, v: Voice): Change =
  { state: { ...v, recorder: D::stopRecording(v.recorder) },
    out: List(Transcribe({ ticket: v.recorder.ticket, network: onNetwork(v.route, now), automatic: automatic })) }

pure def stopRecording(v: Voice, now: int): Change = transcribingDictation(now, false, v)

pure def canRecordingStopped(v: Voice, ticket: int, showing: bool, now: int): bool =
  not(v.prompting) and D::acceptsNativeStop(v.recorder, ticket)

pure def recordingStopped(v: Voice, ticket: int, showing: bool, now: int): Change =
  if (showing) transcribingDictation(now, true, v)
  else { state: { ...v, recorder: D::transcribed(D::stopRecording(v.recorder), ticket, D::AgentUnavailable) }, out: List() }

pure def canTranscribed(v: Voice, ticket: int, failure: D::Failure): bool = D::canTranscribed(v.recorder, ticket, failure)

pure def transcribed(v: Voice, ticket: int, failure: D::Failure): Voice =
  { ...v, recorder: D::transcribed(v.recorder, ticket, failure) }

pure def canClipLost(v: Voice, ticket: int): bool = D::canClipLost(v.recorder, ticket)

pure def clipLost(v: Voice, ticket: int): Voice = { ...v, recorder: D::clipLost(v.recorder, ticket) }

pure def stepHiddenNativeStopKeepsTheClipWithoutAsking(before: Voice, via: str, after: Voice, out: List[Effect]): bool =
  (via == "recordingStopped" and after.recorder.stage == D::Recorded) implies
    (out == List() and after.recorder.clip and after.recorder.ticket == before.recorder.ticket)

pure def stepMissingClipOffersNoRetry(before: Voice, via: str, after: Voice): bool =
  via == "clipLost" implies (after.recorder.stage == D::Ready and not(D::canTranscribeAgain(after.recorder)))

pure def canTranscribeAgain(v: Voice, now: int): bool = D::canTranscribeAgain(v.recorder)

pure def transcribeAgain(v: Voice, now: int): Change =
  val r = D::transcribeAgain(v.recorder)
  { state: { ...v, recorder: r }, out: List(Transcribe({ ticket: r.ticket, network: onNetwork(v.route, now), automatic: false })) }

pure def canRecordAgain(v: Voice): bool = D::canRecordAgain(v.recorder)

pure def recordAgain(v: Voice): Change =
  { state: { ...v, recorder: D::recordAgain(v.recorder) }, out: List(Abandon({ recording: v.recorder.ticket })) }

pure def canEdit(v: Voice, words: bool): bool = D::canEdit(v.recorder, words)

pure def edit(v: Voice, words: bool): Voice = { ...v, recorder: D::edit(v.recorder, words) }
```

### Ask Alpha can review typed words for the clip that recognition could not transcribe

```quint
pure def canTypeTranscript(v: Voice, ticket: int): bool = D::canTypeTranscript(v.recorder, ticket)

pure def typeTranscript(v: Voice, ticket: int): Voice = { ...v, recorder: D::typeTranscript(v.recorder, ticket) }
```

### Using the transcript fills the field dictation started in, and dictation never sends

A messaging bar's dictation fills that bar, never Ask Alpha. The fill names
its own number, so a late delivery cannot fill the field of a newer recording.
Dictation asked for on a phone without speech does not start, and shows
no words. A transcript goes into the field whole, as Sunday's v119 put it
there, even past the longest text the phone sends: the owner shortens the
text before it can be sent, and nothing dictated is lost. A call state the phone has not told does not keep dictation from
starting. A messaging bar's recorder shows no words: its stage, a failed
transcription included, is said only to a screen reader, and its retry,
discard and stop controls stay.
In a Messages conversation, stopping a recording puts a successful transcript
straight into that conversation's editable draft. Leaving the conversation
before it arrives discards it.

```quint
pure def canFill(v: Voice): bool = D::canFill(v.recorder)

pure def fill(v: Voice): Change =
  val filled = D::fill(v.recorder)
  { state: { ...v, recorder: filled }, out: List(Fill({ field: v.recorder.field, filling: filled.filled }), Abandon({ recording: v.recorder.ticket })) }

pure def stepDictationFillsItsOwnField(before: Voice, after: Voice, out: List[Effect]): bool =
  out.every(e => match e { | Fill(f) => f.field == before.recorder.field and before.recorder.stage == D::Review and f.filling == after.recorder.filled and f.filling == before.recorder.filled + 1 | _ => true })
```

### Closing the recorder abandons any recording or transcription it was waiting for

A clip kept for a recognition retry or review is also discarded when the recorder closes.
Switch to keyboard does the same for Ask Alpha dictation. While the recorder
has starting, live or kept audio, the keyboard waits for their cancellation
to settle. Focus returns to the same draft only if it still owns that field.

```quint
pure def canCloseRecorder(v: Voice): bool = D::canCloseRecorder(v.recorder)

pure def closeRecorder(v: Voice): Change =
  val busy = v.recorder.stage == D::Starting or v.recorder.stage == D::Recording or v.recorder.clip
  { state: { ...v, recorder: D::closeRecorder(v.recorder) },
    out: if (busy) List(Abandon({ recording: v.recorder.ticket })) else List() }
```

### The recorder Voice holds keeps the recorder's own rules

```quint
pure def alwaysTheRecorderKeepsItsRules(v: Voice): bool =
  D::alwaysAClipIsKeptOnlyAfterRecording(v.recorder) and D::alwaysWordsOnlyInReview(v.recorder)
    and D::alwaysAFailureWaitsInItsStage(v.recorder) and D::alwaysTicketsAreCounted(v.recorder)

pure def sometimesDictationUnderReview(v: Voice): bool = v.recorder.stage == D::Review and v.recorder.field == D::PhoneBar

pure def sometimesRecordingAfterTheFirstGrant(v: Voice): bool =
  v.recorder.stage == D::Recording and v.permission.asked and v.permission.grant == P::Granted
```
