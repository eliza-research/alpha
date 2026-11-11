# 13. Gap pass: Remaining native Java

Single-pass findings from a second auditor covering files the first pass read only in part. Not adversarially verified; each is re-verified before a fix.

Paths: `J/` = `android/app/src/main/java/ai/alphacompute/alphaphone/`, `Q/` = `specs/quint/`. Everything below was read, not run. Quint line numbers are given only where I had them; otherwise the action or invariant is named.

**Coverage limits**
- Not audited: the notification-listener and password-vault implementations (`ai.eliza.plugins.notifications.NotificationMirror*`, `ai.eliza.plugins.passwords.*`, `JsonCredentialSlots`, `KeystoreTextFrame`). They are upstream and not tracked outside `vendor/`. Only the Alpha wrappers were read (`AlphaNotificationListener`, `NotificationAccess`, `AlphaNotificationsPlugin`, `PasswordProviderSupport`, `AlphaCredentialStore`, `BrowserSessionStore`).
- Not audited: reminders (upstream `ReminderEngine`), so the reminder half of `DeviceActions.qnt` is unchecked.
- `AlphaBrowserPlugin.java` was read only at lines 160-180, 270-282, 360-382, 400-420, 455-475, 500-660.
- No list of "earlier unverified claims" was in the task text. Verdicts below are on the task's own premises.

**Premise verdicts**
- "The two browser models map only to Java": confirmed (`BrowserDownloads.java`, `AlphaBrowserPlugin.java`, `BrowserSessionStore.java`).
- Manifest receivers are safely declared: confirmed.
  - `ReminderReceiver` and `ResidentScheduleReceiver` are `exported="false"`, system actions only (`android/app/src/main/AndroidManifest.xml:90-96`).
  - `AlphaSmsSendReceiver` is not exported, launcher flavor only, and gates on image capability, operation pattern and index (`android/app/src/launcher/AndroidManifest.xml:29`, `J/AlphaSmsSendReceiver.java:19-23`).
  - The sense `ListenerActionReceiver` is not exported.
  - Exported services are guarded by BIND permissions; exported providers by DUMP, signature and STATUS_BAR_SERVICE.
- `NativeCredentialMutation.qnt` matches code: confirmed in substance. The exact stop acknowledgement, 15 s timeout, epoch supersede and re-read before commit are all present (`J/AlphaLocalAgentPlugin.java:117-139`, `J/AlphaCredentialStore.java:85-116`).
- HTTP auth stays manual (`StandardHttpAuthManual`): confirmed. `authEngine` is `STANDARD_WEBVIEW`, so the binding is always null and the autofill path is inert (`J/AlphaBrowserPlugin.java:502, 630-635`).

## A. Model-vs-code discrepancies

1. **Capture exclusivity is not enforced natively.** `SpeechResources.acquireCapture` requires `captureOwner == "none"`. `startRecording` (`J/AlphaVoiceCloudPlugin.java:73-82`) and `startLiveCapture` (`:409-417`) never check each other. `MainActivity.java:249-279` registers the plugins for `AlphaAssistActivity` too, so two plugin instances exist per process.
2. **Call start does not stop capture below API 31.** The model's `callBegins` always clears capture; `watchCalls` returns early on `SDK_INT < S` (`J/AlphaSpeechAudioFocus.java:76`), and minSdk is 29.
3. **Focus is acquired at play, not at request.** The model's `requestSpeech(focusGranted)` opens the stream only with focus. Code publishes and queues chunks first and calls `focus.acquire()` in `playStream` (`AlphaVoiceCloudPlugin.java:338-340`), so "stream open, focus idle" is reachable.
4. **Failure vocabulary differs in `StreamingPlayback`.** The model has `playback-drain-timeout`, `output-write`, `interrupted`. Code collapses the first two to `playback-failed` (`J/StreamingSpeechPlayback.java:172`) and adds `playback-interrupted` and `synthesis-failed` (`AlphaVoiceCloudPlugin.java:286`). The 30 s offer timeout (`StreamingSpeechPlayback.java:53`) has no model action.
5. **SMS review does not survive pause in code.** In `DeviceActions.pause` (`Q/native/DeviceActions.qnt:39-42`) the phase stays "reviewed". Code cancels the review on pause and journals a terminal "cancelled" (`J/AlphaTelephonyPlugin.java:89-90, 414-419, 489`).
6. **Cancelled/denied records are unmodeled.** They occupy journal slots and are pruned to tombstones without any dispatch (`J/SmsSendJournal.java:201-207, 324-341`). `RetiredIdNeverForgotten` (`DeviceActions.qnt:139`) asserts `dispatches == 1`.
7. **The model has one recipient; code has up to 5 × 10 parts.** Status aggregation and per-recipient provider rows are unmodeled (`SmsSendJournal.java:80-92`).
8. **`BrowserSiteState.hide` cancels a "runtime" prompt, but Android always pauses the app for that dialog.** The code's `current` guard deliberately omits `paused` and also omits tab selection (`AlphaBrowserPlugin.java:547`), unlike the download guard (`:461`). A tab deselected during the Android dialog still gets the grant.
9. **Navigation stop reasons.** The model has notification, refused, destroyed, task-removed. The same listener also emits `app`, `replaced` and `renderer-closed` (`J/AlphaNavigationService.java:96-105`, `J/AlphaMapsTransportPlugin.java:67, 80, 84, 96, 103`). Process death delivers no stop at all.
10. **A cancelled signed-in download can still leave a published file.** Cancel can land after the copy loop finishes, so the file stays with no entry (`J/BrowserDownloads.java:214-218`). The model's `cancel` clears `pendingFile` and never publishes.

## B. Unmodeled state machines

- **Assist invocation** (`J/AssistInvocation.java`, `J/AlphaAssistActivity.java:20-65`). States: origin {listener, assist} × fresh/expired × lockedAtArrival × consumed. Events: onCreate (fresh or recreated), onNewIntent with or without caller, take, 5 s expiry. Invariant at risk: at most one listener voice turn per launch, never from a locked or stale arrival.
- **Workflow tap capture** (`J/WorkflowNoticeIntentDedup.java`, `J/AlphaNotificationsPlugin.java:32-61`). States: unseen, retained, queued, captured, cleared. Events: load, newIntent, resume, poll, capture ok/unknown/fail, executor reject. Invariant at risk: each OS Intent is queued once and never dropped while uncaptured. `retain` returns false both for a duplicate and at the 512 cap.
- **Voice cancel drain** (`AlphaVoiceCloudPlugin.java:86-104`). States: draining flag, waiters. Events: cancel, barrier, 120 s timeout, capture failure. Invariant at risk: draining eventually clears.
- **Live capture admission** (`J/LiveCaptureAdmission.java` plus epoch and permission tickets).
- **Audio-focus stack entry** (requested vs held), in `AlphaSpeechAudioFocus` and `SpeechAudioFocusPolicy`.
- **SMS journal bound** (records, tombstones, Bloom filter, `prunedThrough`).
- **Process-wide singletons with two bridges**: `AlphaSms.listener`, navigation owner, per-instance `BrowserSessionStore`.

## C. Defects

1. **Audio focus is never abandoned after a transient loss (logic; high on the code path, medium on platform effect).**
   - Evidence: `SpeechAudioFocusPolicy.changed` sets IDLE before returning STOP (`J/SpeechAudioFocusPolicy.java:44`). `release()` then abandons only `if(held)` (`J/AlphaSpeechAudioFocus.java:67-70`).
   - Scenario: music is ducked by Alpha speech, then an alarm or call takes transient focus. Alpha stops but stays in the focus stack, so the music never gets its gain back until Alpha's next utterance.
   - Fix: track "requested" separately and always call `abandonAudioFocusRequest` in `release()`.

2. **The static SMS send listener is clobbered by the second bridge (functional; high).**
   - Evidence: single slot at `J/AlphaSms.java:48-51`; set in `AlphaTelephonyPlugin.load` (`:77`), cleared in `handleOnDestroy` (`:557`).
   - Scenario: opening the assistant replaces the launcher's listener; closing it nulls the slot. The launcher's Messages view then gets no `smsSendUpdated` until its bridge reloads.
   - Fix: use a `CopyOnWriteArraySet` of listeners.

3. **First-time microphone grant for live capture always rejects (functional; medium-high).**
   - Evidence: the permission dialog pauses the activity. `handleOnPause` (`AlphaVoiceCloudPlugin.java:461`) calls `stopLiveCapture()`, which runs `liveAdmission.cancelAll()`, and bumps `epoch` because only `permissionEpochs` is consulted. `liveMicrophonePermission` (`:418`) then sees a stale ticket and rejects with "Recording cancelled".
   - Fix: skip the cancel and epoch bump while `livePermissionEpochs` is non-empty, mirroring the `startRecording` guard.

4. **One over-bound row makes a whole Messages page unreadable (functional; medium).**
   - Evidence: `AlphaSms.java:103, 119, 133, 238` throw for a thread with more than 20 addresses, a missing canonical address, or SMS/MMS text over 2000 chars. `readSms` turns that into a generic failure (`AlphaTelephonyPlugin.java:327`).
   - Scenario: a thread page containing one long MMS never loads, so nothing on that page can be read. The same applies to the thread list.
   - Fix: return the row flagged `incomplete` instead of throwing.

5. **Journal I/O and SMS dispatch run on the UI thread (performance; high).**
   - Evidence: the Send click handler calls `AlphaSms.dispatch` inline (`AlphaTelephonyPlugin.java:495-503`). `reviewSmsOnMain` loads the journal (`:464`) and `decide` saves it (`:521-523`).
   - Each `save()` re-serializes and re-encrypts every record, tombstone and the 128 KiB filter (`SmsSendJournal.java:458-465`), under a lock shared with the `WORK` thread.
   - Fix: move dispatch and decide to `AlphaSms.WORK` and resolve the call from there.

6. **Every sent/delivery broadcast does a full journal rewrite plus a full reconcile (performance; medium).**
   - Evidence: `AlphaSmsSendReceiver.java:31-32`, `AlphaSms.reconcile` (`:335-365`).
   - Scenario: a 5-recipient × 10-part send produces up to 100 broadcasts. Each one queues one to three saves, plus a provider query per open record and recipient, on a single thread while holding `goAsync`.
   - Fix: debounce reconcile, and persist the filter and tombstones separately from the records.

7. **The Downloads dialog polls providers on the main thread at 1 Hz (performance; high it exists, moderate impact).**
   - Evidence: `BrowserDownloads.java:300` re-renders every second. Each of up to 50 entries does a synchronous `DownloadManager.query` or `ContentResolver.query` (`:307, 319`).
   - Related: blob chunk decode and write (`:387-389`) and `data:` decode and write (`:168-170`) also run on main.
   - Fix: query on `io` and post a snapshot back.

8. **Wake-phrase launch can silently degrade to "assist" (functional; low-medium).**
   - Evidence: the 5 s window (`AssistInvocation.java:19`) starts in `onCreate` before the bridge and WebView exist (`AlphaAssistActivity.java:23, 61`). On API 34, `onNewIntent` has no caller, so a warm wake is always "assist" (`:28-39`).
   - Fix: start the window at first renderer readiness; document the API 35 requirement.

9. **Voice cancellation can stay closed forever (logic; low).**
   - Evidence: `finishDrain(false, …)` leaves `draining` true when `capture.cancel()` throws or the worker rejects the barrier (`AlphaVoiceCloudPlugin.java:100-102`). Every later voice call is then refused.
   - Fix: clear `draining` on those paths, or retry the barrier.

10. **`replace:false` is not honoured against a playing stream on paired and browser-reading synthesis (logic; low).**
    - Evidence: the main-thread check tests only `playbackFile` (`AlphaVoiceCloudPlugin.java:332`); the local path tests both (`:250`).
    - Fix: add `|| streamPlayback != null`.

## D. Modeling opportunities

**New Quint modules or invariants**
- `AudioFocusStack`: add `requested` and assert `utteranceEnded ⇒ not requested`. This catches C1.
- `MultiBridge`: two plugin instances over process singletons, asserting "a live bridge keeps its subscription". This catches C2 and covers navigation ownership.
- `LiveCapturePermission`: pause during the permission prompt, with liveness "grant ⇒ capture starts or an explicit denial". This catches C3.
- `SpeechResources`: make the owner a set and assert cardinality ≤ 1; add an API-level flag to `callBegins`.
- `DeviceActions`: add recipients, the cancelled/denied decision phases and pause-cancels-review; weaken `RetiredIdNeverForgotten` to `dispatches ≤ 1`.
- `SmsJournalBound`: prune, tombstone and filter monotonicity ("an ID once seen is refused forever", "a dispatching record is never pruned").
- `AssistInvocation` and `WorkflowTapCapture`, per section B.

**Pure functions suited to pre/postcondition checks**
- `AssistInvocation.take` and `origin`.
- `SpeechAudioFocusPolicy.changed`.
- `SmsPageCursor.predicate` against `compare`/`admits`: the page union must equal the rows strictly after the cursor across the sms/mms seconds-vs-milliseconds boundary.
- `SmsSendJournal`: `Record.status`, `open`, `encode`/`decode` round-trip, `bindingText` against `JSON.stringify`, `ProviderMatch`.
- `SmsRecords.smsStatus` and `smsDeliveryReport`.
- `CloudSignInFlow`: `parseCallback` (SUCCESS only from a fragment with exactly `{code, state}`), `Pending.serialize`/`parse` round-trip, `ackBackoffMs`, `failureForStatus`.
- `BrowserDownloads.cookieAllowed`.
- `AlphaCredentialStore.requireCapacity`: the length/3 shortcut is sound, but its comment is wrong.
- `SpeechPcmQueue`: `queued ≤ capacity`, or a single oversize chunk.
- `LiveCaptureAdmission`.
