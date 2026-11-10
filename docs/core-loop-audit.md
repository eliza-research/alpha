# Core loop audit (round 4, refreshed through the MVP completion integration)

**Current state (2026-10-12, branch `claude/mvp-completion`, upstream pin `13c9857598`).** The
per-loop tables below are current: each row names the source and pin of its evidence, and
`test/core-loop-audit-consistency.test.mjs` recomputes the summary table and every Count line
from them. Class E rows rest on emulator runs of developer APKs (unpackaged resident runtime,
never distributable): round 8 at `2961bd9e`/`9a1ca161` (pin `13c9857598`) and, where a row says
so, round 7 at `6dcdde34` (pin `40dbe96bd1`). No distribution APK, AOSP image, real integration
or device result exists. The rest of this introduction, the "Finding" paragraph and the round 4
and round 5 prose are history and are kept as written.

Independent audit of the round-3 claim that each of the ten core MVP loops (completion
plan journeys A–F, flow audit J01–J05) completes end to end in the browser build. Audited
source: branch `claude/r4-audit`, based on `claude/r3-integration` at `5f52c23d`.

**Finding (round 4, history).** The narrow claim holds: all ten journey specs pass at this source (16 tests,
run in this audit), and each drives its loop through rendered controls. The claim does not
extend further than that sentence. Every journey runs the development profile; 9 of the 10
depend on a development-only agent, mailbox, vault, scheduler or device control that is
absent from the flag-off build, and when the audit was written no native instrumentation
result was bound to its source (rounds 7 and 8 have since run part of the instrumentation on
developer APKs; see the dated paragraphs under the table). Measured against the governing
requirement text, the loops are between 82% and 100% evidenced as the table stands after the
round 8 emulator run (47% to 88% when this audit was written, 47% to 100% after the round 5
merge) among the steps this repository, an emulator or CI can close, and 36 further
steps wait on a person or a phone.

Evidence classes follow [verification](verification.md): source/test (S), APK build (B),
emulator (E), AOSP image, real integration, physical device (D). The audit itself (round 4)
and round 5 produced nothing above class S: no APK was built and no emulator was started for
them. The class E results that rounds 7 and 8 added are cited from the dated sections of
[verification](verification.md) wherever a row uses them; they were obtained on developer
APKs (no packaged resident runtime, unqualified speech runtime) on SDK emulators. Nothing in
this document is APK-build evidence for a distributable build, AOSP image, real-integration or
device evidence, and no hosted CI job named here has run.

## How to read the tables

Each loop's governing requirement text was split into atomic steps and negative cases.
Each step has exactly one class:

- **EVIDENCED**: a test on this branch exercises the step through the shipped renderer
  logic, and the step names nothing that only a native component, provider or device can
  show. The cell says where the evidence is weak (a fixture standing in for the thing
  under test, state written or read through `page.evaluate`, or evidence that sits in
  another spec and not in the journey). Since round 7 a step that only native code can show
  is also EVIDENCED when its named instrumentation passed in a recorded emulator run; the
  cell then names the dated section of [verification](verification.md), which is class E
  for the developer APKs and the source of that run and for nothing later.
- **SOFTWARE**: can be implemented or tested from this repository now.
- **EMULATOR**: needs a disposable-emulator run of the named instrumentation. "No run"
  in a cell was written in round 4 or 5, when the last recorded class-E result was six
  journal/photo cases at `d3dc9977`; where a later run exists the same cell goes on to cite it.
- **CI**: needs a GitHub-hosted runner. `scripts/ci/pending-recovery-ui.py` and
  `scripts/ci/resident-native.py` refuse to run anywhere else, and the second requires an
  x86_64 emulator. This host is arm64.
- **HUMAN**: sign-in, key, account or owner decision.
- **DEVICE**: physical hardware.
- **UPSTREAM**: needs an elizaOS change.

A step blocked by more than one thing is classed by the first blocker.

**Percentage** = EVIDENCED ÷ (EVIDENCED + SOFTWARE + EMULATOR + CI). HUMAN, DEVICE and
UPSTREAM steps are counted separately and are not in the denominator. A percentage here
measures class-S evidence against closable steps. It is not a completion percentage for
the product on a phone.

| Loop | Steps | Evidenced | SOFTWARE | EMULATOR | CI | Closable total | Percentage | HUMAN | DEVICE | UPSTREAM |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 31 | 18 | 0 | 1 | 2 | 21 | 86% | 6 | 4 | 0 |
| B | 28 | 23 | 0 | 0 | 0 | 23 | 100% | 3 | 2 | 0 |
| C | 15 | 9 | 0 | 0 | 1 | 10 | 90% | 2 | 3 | 0 |
| D | 23 | 17 | 0 | 1 | 1 | 19 | 89% | 3 | 1 | 0 |
| E | 27 | 13 | 0 | 10 | 0 | 23 | 57% | 3 | 1 | 0 |
| F | 22 | 18 | 0 | 0 | 1 | 19 | 95% | 3 | 0 | 0 |
| J01 | 10 | 9 | 0 | 0 | 0 | 9 | 100% | 0 | 1 | 0 |
| J03 | 11 | 9 | 0 | 0 | 0 | 9 | 100% | 2 | 0 | 0 |
| J04 | 10 | 8 | 0 | 0 | 0 | 8 | 100% | 1 | 1 | 0 |
| J05 | 9 | 7 | 0 | 1 | 0 | 8 | 88% | 1 | 0 | 0 |
| All | 186 | 131 | 0 | 13 | 5 | 149 | 88% | 24 | 13 | 0 |

**Pin move to `bc71e21f3b` (2026-10-13).** D-23 moved from UPSTREAM to EMULATOR: the pinned agent now registers the dossier route, so no step waits for an elizaOS change. Nothing else in the table changed; no step ran at the new pin.

**MVP completion integration (2026-10-12).** The table above was recomputed from the per-loop tables, which `test/core-loop-audit-consistency.test.mjs` now checks. A-29 and E-14 moved back to EMULATOR (A-29 ran only on developer APKs; E-14's runs never used the integrated vault), D-21, D-22 and E-22 to E-27 were added, and D-23 was added as the first UPSTREAM step (the pinned agent has no dossier route). The B and J01 Count lines, which still read 22 of 23 and 7 of 9 after round 8, now match their tables. The only open EMULATOR step of the pilot journeys (MVP-49) is J05-2.

**Round 7 (2026-10-10).** The table above was recomputed after the first emulator runs that
count: 23 steps moved from EMULATOR to EVIDENCED, each because its named instrumentation passed
on both flavors (A-1 on the launcher flavor, the only one it exists on) in the run recorded in
[verification](verification.md) under "Emulator results at 6dcdde34". That evidence is class E,
on developer-override APKs (no packaged resident runtime, unqualified speech runtime), on
SDK emulators: it is not distributable-build, AOSP image, real-integration or device evidence,
and it does not carry forward to later source. Seven steps stay EMULATOR: E-8, E-9 and J05-2
(no WebView provider with isolated-world injection on this machine), E-3 (the class fails on its
live-search method), B-25 and J01-7 (WorkflowPhoneNative not run) and J01-6 (no runner passes
`calendarOptions=1`). The percentages below this paragraph that describe rounds 4 and 5 are history.

**Round 8 emulator run (2026-10-11, `claude/r8-finish`).** The integration of round 8 with
round 9 ran part of the campaign on developer APKs at pin `13c98575987a` ([verification](verification.md), "Emulator results at 2961bd9e").
Class E, developer builds with an unpackaged runtime, one SDK emulator: not distributable-build
or device evidence, and it does not carry forward to later source. Three steps moved from
EMULATOR to EVIDENCED and the table above was recomputed (131 of 140). J01-6: both methods of
`CalendarAgentCrudInstrumentedTest`, including the one gated by `calendarOptions`, passed on
both flavors. B-25 and J01-7: the workflow campaign passed 14 of 14 cases, with
`WorkflowPhoneNativeInstrumentedTest.deniedCalendarGrantReturnsNoEvents` on both flavors. A-1
stays EVIDENCED at the new source: with the product's one-instance hand-off,
`SettingsRolesInstrumentedTest` and `LauncherHomeInstrumentedTest` passed on the final APKs
after two unawaited conditions in the test were found and awaited. Four steps stay EMULATOR:
E-3 (BrowserFlow fails on its live-search method) and E-8, E-9 and J05-2 (no WebView with
isolated-world injection on this machine; the hosted job was not dispatched). The two
paragraphs below were written before that run and describe each package as it was pushed.

**Which source each class-E row rests on (ledger refresh of 2026-10-11).** The product source of
main `2560eead` is the source of the final app APKs of the round 8 run (`9a1ca161`; the commits
after it change documents only). Of the 131 EVIDENCED steps, 26 rest on an emulator run. Sixteen
of them have a passing run at that source and pin `13c98575987a`: A-1, A-29, B-12 (the
restart campaign; NotesSecureStorage was not repeated), B-15, B-25,
B-26, C-3, E-5, E-14 and E-16 (PasswordBrowserFill; BrowserAutofill was not repeated), F-7,
F-17 (the `channels` half; `notice-denied` was not repeated), J01-6, J01-7, J01-10 and J03-7
(standalone only; the launcher half was not repeated). Ten rest only on the round 7 run at source
`6dcdde34` and pin `40dbe96bd1`, which round 8 did not repeat: A-6, A-30, B-20, B-22, C-4, D-14,
E-4, E-10, E-11 and F-15. Verification says of every such run that it is not evidence for later
source; these rows are counted because nothing recorded since contradicts them, and the
commands in "EMULATOR and CI campaigns" repeat them. Counted only on runs at the current pin
the table would read 121 of 140 (86%). D-8 is the one other row whose run predates the pin
(host runtime, last run at `40dbe96b`). B-9 and B-10 are EVIDENCED on browser tests (class S);
their native classes also passed in the round 8 run.

**Round 8 (2026-10-11, `claude/r8-ui-defects`).** No step changed class and the table was
unchanged by the package. The four behaviours round 7 recorded as "Observed and left open" were changed in
source: the Inbox Cloud panel offers the saved sign-in, Alpha's notifications open only from a
handle on Home ([gesture zones](gesture-zones.md)), Home and the tile grids hold at 200% text,
and the launcher flavor keeps one `MainActivity` when the HOME role is granted (A-1; see
[Android and AOSP](android-and-aosp.md#one-live-mainactivity-on-the-launcher-flavor)). The
browser evidence is class S ([verification](verification.md), "Round 8 follow-up"). The
instrumented tests that would show the native behaviour (`SettingsRoles`, `LauncherHome`,
`Accessibility`, the `inbox` restart campaign) were extended and compiled but not run, so A-1 and
the other rows that rest on the round-7 emulator run rest on APKs that predate these changes.

**Round 8 (2026-10-11, `claude/r8-runner-ci`).** No step moved: round 8 wrote and compiled, and ran no emulator and
dispatched no workflow. Each of the seven EMULATOR steps and the five CI steps now has a command
that produces its evidence ("EMULATOR and CI campaigns"): the Calendar runner passes
`calendarOptions=1` (J01-6); `scripts/developer-archive.ts` gives the existing
WorkflowPhoneNative campaign the archive it reads from developer APKs (B-25, J01-7);
`android-emulator.yml` (dispatch only) runs the reading and page-question classes on the pinned
WebView 157 (E-8, E-9, J05-2) and the default classes (E-3) on a hosted x86_64 emulator; and
`resident-android.yml` covers the five CI steps. The table is unchanged until those runs are
recorded with their commit.

The A, B, D, F, J03, J04 and All rows were recomputed in the round 5 review from the per-loop
tables below, on the merge of `main` (rounds 3 and 4), the loop package and the runner package.
The loop package (see "Round 5 changes") closed the rows marked "round 5" in B, F and J03. The
runner package (see "Round 5: native-runner gaps") moved A-6 from SOFTWARE to EMULATOR and D-8
from SOFTWARE to EVIDENCED on one recorded host-runtime run made at the previous upstream pin;
nothing moved to EVIDENCED on the strength of instrumentation, because none of it has been
run. The round 4 hand-offs on `main` closed B-28, F-20, J04-7 and J04-10 (see "Round 5 review
and merge"). No SOFTWARE row remains; that is a statement about this table's steps, not about
the product: when that was written (round 5) 35 closable steps still needed an emulator or CI
run that had not been made; after rounds 7 and 8 it is 9 (4 EMULATOR and 5 CI).

UPSTREAM was zero until the MVP completion integration added D-23 (the pinned agent registered
no dossier route), and is zero again since the pin move to `bc71e21f3b` registered it. Round 4 history: UPSTREAM was zero because this audit established no step that certainly needs an elizaOS
change. Two failures could turn out to be upstream once someone runs them: the on-device
speech functional failure on arm64 (B-7) and the integrated password manager's native
flow, which was recorded at `d3dc9977` as failing before save/unlock (E-14). That second one
did not: `PasswordBrowserFillInstrumentedTest` and `BrowserAutofillInstrumentedTest` passed on
an emulator in round 7 and the first again in round 8 (class E, developer APKs; see E-14).

## What a production Android user gets today

The persona is a flag-off Android build, signed in to Eliza Cloud with credits, with the
resident agent. Checked on the flag-off bundle with the Android bridge stubbed
(`test/browser/journey-core-loops.production.spec.ts`, 11 tests, added in this audit) and
by reading the adapters. The stub is not the native plugins.

| Loop | Development-only parts the journey depends on | Flag-off path |
| --- | --- | --- |
| A | Development agent profile, scripted reply, "Load conversations → Restore conversation". | Real path. The Welcome dialog signs in to Eliza Cloud; a funded account configures and starts the resident agent; chat streams over native IPC; Stop is honest and one check follows; the saved conversation is restored automatically after a restart. Cloud agent selection, provisioning and remote pairing are not offered on Android (A-16; pairing is retired). The flag-off web build cannot sign in to Cloud and says so; it offers remote pairing and offline use. |
| B | Development agent and "Action JSON" proposals, Cloud transcription fixture, speech fixture. | Real path for each part, never exercised together: the native recorder with Cloud transcription and playback (P-07; signed out it says "Sign in to Eliza Cloud to use voice" and captures nothing), encrypted native Notes, Android CalendarProvider and native reminders. Agent proposals need a real model to make them. |
| C | The alarm list, "Alarm saved.", ringing, snooze and dismiss in the journey belong to the browser build's own Clock. | Different product. On Android every request is a reviewed handoff to the installed Clock app: one `clockHandoff`, then "Check Clock; Alpha cannot confirm an alarm was changed." No alarm list, no ringing screen. With no Clock app the native message is shown and nothing is claimed. The browser Clock is not development-only: the flag-off web build has it. |
| D | The whole journey: development scheduler, typed snapshot, scripted output. | Real path that depends on the resident runtime advertising digest support. The panel says "Your agent runs schedules on this phone. It cannot run while the phone is off." Hosted execution while the phone is off does not exist (A-09). Signed out, the panel names the missing agent and offers no schedule controls. |
| E | Development vault, development "Proton Pass · development" provider, sample sign-in, speech fixture. | Browsing is real (isolated native WebView on Android, sandboxed frames in the web build). The password manager is the native integrated vault; the flag-off web build says "Saved passwords: Available in the Android app" and offers no vault. A website fill from the integrated vault is refused without native per-field origins; the vault's own Autofill path has instrumented tests that have not run. Native save and fill failed before save/unlock in the one run recorded at `d3dc9977` (historical). On developer APKs `PasswordBrowserFillInstrumentedTest` has since passed on an emulator in rounds 7 and 8 (class E, synthetic credentials; E-14); no release-signed build or device has run it. |
| F | Development mailbox (test 1); a synthetic provider injected at the Cloud client boundary on the flag-on server (tests 2–4); development "Device controls" shade (test 5). | Blocked for a real user: Gmail needs a Google grant through Eliza Cloud and the code exchange returns 401. Without a grant the Android Inbox says "Gmail access was revoked or needs authorization again" and offers Connect Gmail; signed out it says "Connect Eliza Cloud to use Gmail" and Compose says "Connect a Gmail account first." Notifications use the native plugins. |
| J01 | None. The development profile is incidental. | Real path. The whole loop passes on the flag-off web bundle with a synthetic camera. On Android the camera and CalendarProvider are native. |
| J03 | Development incoming-email simulator and development agent. | The attachment half is blocked with F. Files, the reviewed question and the source-linked note are real; with no agent the question is not sent and nothing is saved. |
| J04 | Synthetic Maps provider; development "Device controls → Back". | Honest unavailable state. No Maps provider is configured in a flag-off build, so the address reaches Maps and the user reads "Connect a Maps provider to search places and plan routes." No route can be produced. |
| J05 | Development agent. | Real path up to Send. The page review works flag-off; without an agent the draft is kept and the connection choices open. On Android the excerpt comes from the native WebView; `BrowserPageQuestionInstrumentedTest` (round 5) covers that path up to Send. In round 7 (`6dcdde34`) one of its four methods passed on both flavors and three stopped at the missing isolated world; CI-2 has not been dispatched. Where the isolated world is unavailable, the review opens for pasted text. `BrowserPageQuestionInstrumentedTest` (round 5) covers that path up to Send; in its one recorded run (round 7) one of its four methods passed and three stopped for want of a WebView with isolated-world injection (J05-2). |

## Per-loop step tables

### A. Boot, authenticate and keep a conversation

Governing text: Completion plan journey A (1–5); flow audit F01, F03; runbook rows "Boot and design", "Resident startup and chat", "Lifecycle and recovery", "Distribution has no mock surfaces", "Test-mocks isolation"; AP-01, AP-02, AP-05.

Journey spec: `test/browser/journey-a-conversation.spec.ts` (passed in this audit).

| # | Required step or negative case | Evidence on this branch | Class |
| --- | --- | --- | --- |
| A-1 | Alpha is the HOME app and HOME returns to it (launcher variant) | `LauncherHomeInstrumentedTest` (drawer, Settings, stock dialer, three installed apps with HOME returning each time, Settings and the default-Home chooser still reachable), `SettingsRolesInstrumentedTest` (role removed, declined and accepted in Android's dialog), `ShellInstrumentedTest`. Round 5 added the runner's `--home-role` phase, which selects the launcher APK as HOME, requires a cold start through the HOME key and restores the original holder; without it both classes are refused, so they can no longer skip. `npm run test:android:instrumentation -- --owned-emulator --avd <avd> --serial emulator-NNNN --variants launcher --home-role --classes SettingsRoles,LauncherHome`. No run recorded. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): LauncherHome 4 of 4 and SettingsRoles 2 of 2 passed in the `--home-role` phase with the original HOME holder restored; Shell passed on both flavors. Launcher flavor only, as the step is. Round 8 changed the product (one live `MainActivity`, hand-off of the HOME start) and extended both classes. At that source, class E on developer APKs ([verification](verification.md), "Emulator results at 2961bd9e"): SettingsRoles first passed in 2 of 7 runs; the failures were two conditions the test did not await (window focus before a HOME key, and its own navigation helper), not the hand-off. With both awaited, and every HOME press required to reach the page, SettingsRoles passed in 8 of 8 runs and both classes in 3 of 3 on the final APKs, with the original HOME holder read back each time. LauncherHome passed in 21 of 22 runs before the final APKs; the one failure was a process crash from a problem-log call that reached a stopped worker, a product defect fixed in `a326b8dd` before the final APKs were built. | EVIDENCED |
| A-2 | Cold boot of the target phone image into Alpha HOME | None. No SKU is chosen (A-01) and no image has been booted. | DEVICE |
| A-3 | First usable screen has an accessible Talk control and typed entry | Journey A step 1. Flag-off Android: `journey-core-loops.production.spec.ts` loop A. | EVIDENCED |
| A-4 | A configured returning user can speak without passing setup (record, review, user sends; P-01) | `chat-voice-mode.spec.ts` ("ongoing Cloud conversation … sends only new speech"). Round 5: journey A ("a spoken request is transcribed, sent once, answered once and read back"): an oscillator microphone through the real recorder and voice-activity detection, the closed transcription fixture, the development agent and recorded speech. | EVIDENCED |
| A-5 | Signed-out and unavailable-voice states offer recovery and typing and capture nothing | `production-surface.spec.ts` ("signed-out voice stays on-device with no capture, upload or Cloud route"), `voice-entry-context.spec.ts`. | EVIDENCED |
| A-6 | Denied microphone permission offers Settings recovery and typing | `VoicePermissionDeniedInstrumentedTest` (denied state, Open app settings and back, no capture file, typing in the composer) through `node scripts/test-native-permissions.ts voice APP.apk TEST.apk NEW_OUTPUT`, which revokes RECORD_AUDIO in a temporary user before the app starts. Revoked while recording and granted again: `VoicePermissionRevokeInstrumentedTest` through `… voice-revoke …`. Both added in round 5; runner wiring is tested against a scripted adb. No run recorded. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): the `voice` and `voice-revoke` campaigns passed on both flavors after the missing "Open app settings" control was restored; the denied case signs in through the closed synthetic Cloud transport. Evidenced at `6dcdde34` (pin `40dbe96bd1`) only: round 8 did not run the permission campaigns other than `channels`. | EVIDENCED |
| A-7 | Stock recovery and emergency routes stay reachable | None. | DEVICE |
| A-8 | Sign in to Eliza Cloud with the intended account | Renderer only, against a stubbed bridge: `production-surface.spec.ts` resident billing onboarding (7 modes). No real sign-in has been exercised. | HUMAN |
| A-9 | Select an existing Cloud agent | `dev-cloud-*.spec.ts` against the development Cloud fixture. Flag-off Android offers no Cloud agent (A-16); the flag-off web build cannot sign in at all. | HUMAN |
| A-10 | Provision a new agent explicitly; a lost provisioning response creates no duplicate agent | `cloud-personal-onboarding.spec.ts`, `dev-cloud-setup.spec.ts` (fixture). Not reachable flag-off. | HUMAN |
| A-11 | Pair a private remote host as a second route | Flag-off web: `connection-boundaries.production.spec.ts` (refusals, revocation, expiry). Flag-off Android: pairing is retired and the same spec asserts it never pairs. `RemoteAgentInstrumentedTest` needs a test-mocks build. | HUMAN |
| A-12 | Local-development mode is a diagnostic path and is absent from distribution | Journey A (development profile); `production-surface.spec.ts`. | EVIDENCED |
| A-13 | Type a request and get exactly one reply | Journey A (scripted development agent). Flag-off Android: `journey-core-loops.production.spec.ts` loop A (stubbed resident IPC, real streaming client). | EVIDENCED |
| A-14 | A typed request answered by the packaged resident runtime with real inference | `ResidentServiceInstrumentedTest` through `scripts/android-resident-instrumentation.ts` (arm64 emulator and an owner-only Cerebras key file). No run recorded. | HUMAN |
| A-15 | Switch Notes, Calendar and Browser and keep the conversation | Journey A. Flag-off Android: `journey-core-loops.production.spec.ts` loop A switches Notes, Calendar and Browser and sends one message from Notes and one from Browser; all four streams use the same conversation id (MVP completion integration). Stubbed Android bridge, class S. | EVIDENCED |
| A-16 | Each request carries its source screen as context | `journey-core-loops.production.spec.ts` loop A (the posted turn names view home, then calendar); `all-view-context.production.spec.ts` (MVP completion integration) asserts the context of 11 views and that the password page pauses observation and sends nothing. Flag-off bundle, stubbed bridge, class S. Journey A does not assert it. `AllViewAgentContextInstrumentedTest` has no runner. | EVIDENCED |
| A-17 | The connected agent and where it runs are shown, with no credential rendered | `journey-core-loops.production.spec.ts` loop A (agent name, "runs on this phone", no key in the page). Journey A shows only the development label. | EVIDENCED |
| A-18 | Cancel a stream: honest state, no blind resend, one later check | Journey A (the reply is held by the harness taking a Web Lock through `page.evaluate`); `chat-continuity.spec.ts` (controlled transport); `journey-core-loops.production.spec.ts` loop A. | EVIDENCED |
| A-19 | Cancel (decline) a pending action; nothing runs | `chat-decline.production.spec.ts`. Round 5: journey A and journey C each press Decline on a proposal and read back that nothing ran, across a reload; `calendar-proposal-review.production.spec.ts` declines a calendar proposal flag-off. | EVIDENCED |
| A-20 | Offline or rate-limited before the message is posted: the text is kept and a later send posts once | `chat-continuity.spec.ts` (offline, rate limit, double Send). | EVIDENCED |
| A-21 | A physical network switch during a request still yields one result | None. | DEVICE |
| A-22 | Reload restores the saved conversation with one result per accepted request | Journey A, only after the user presses Load conversations → Restore conversation (the development profile does not restore by itself). Flag-off Android restores automatically: `journey-core-loops.production.spec.ts` loop A. | EVIDENCED |
| A-23 | Kill the app process and the resident runtime; recover each admitted result once | `ResidentWorkflowCrash`, `ResidentStreamTransport`, `PrivateResidentSocket` through `scripts/ci/resident-native.py`, which refuses to run outside a GitHub-hosted x86_64 runner. No passing run is recorded. `CombinedAgentRestartInstrumentedTest` is compiled into both instrumentation APKs with the rest of the androidTest source and has never been executed (no runner can run it). Round 8: `gh workflow run resident-android.yml --ref <branch>`, job `native`; read `test-results/resident-ci-native/result.json` in the `resident-native-evidence-<run>` artifact (CI-1). Not dispatched. | CI |
| A-24 | Token revoked or expired: the stated outcome is the one that happened, the key is removed, nothing reconnects | `connection-boundaries.production.spec.ts` (nine sign-out outcomes; revoked remote session). | EVIDENCED |
| A-25 | Real Eliza Cloud session expiry and revocation | None. | HUMAN |
| A-26 | No old-owner output after an account change | `production-surface.spec.ts` ("replaced"), `chat-continuity.spec.ts` ("disconnecting the agent mid-reply…"), `privacy-per-connection.spec.ts`. | EVIDENCED |
| A-27 | Native credential slots are isolated per owner | `ConnectionInstrumentedTest` through `scripts/ci/pending-recovery-ui.py` (hosted runner only). No passing run recorded. Round 8: `gh workflow run resident-android.yml --ref <branch>`, job `recovery-ui` (three ConnectionInstrumentedTest methods); read `test-results/pending-recovery-ui-native/result.json` in the `pending-recovery-ui-evidence-<run>` artifact (CI-1). Not dispatched. | CI |
| A-28 | The distribution bundle has no mock choice or entry point | `production-surface.spec.ts`; `scripts/audit-production-bundle.ts` (passed on the bundle built for this audit). | EVIDENCED |
| A-29 | The installed distribution APK has no mock surface | `NoMockProductInstrumentedTest` (runner default); `scripts/verify-apks.ts`. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): NoMockProduct passed on both flavors. Round 8 ([verification](verification.md), "Emulator results at 2961bd9e"): passed on both flavors again, with app APKs A and B. Every run was on debug developer APKs with an unpackaged runtime, never a distribution APK, so the step is not evidenced: it needs a distribution build (MVP-08) and then this class on it. Round 8, same class and kind of APK ([verification](verification.md), "Emulator results at 2961bd9e"): NoMockProduct passed on both flavors, on the first and on the final APKs. The hosted repeat (CI-3) was not dispatched. | EMULATOR |
| A-30 | Test-mocks APK: enter mock mode, cause no native or provider effect, exit to a deliberate state | `mock-background-admission.spec.ts` (browser). `ConnectionChooserInstrumentedTest` needs a test-mocks APK; registered in round 5 and refused without `--test-mocks`: `npm run test:android:instrumentation -- --owned-emulator --avd <avd> --serial emulator-NNNN --test-mocks --classes ConnectionChooser`. No run recorded. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): ConnectionChooser passed on both flavors of the test-mocks pair. Evidenced at `6dcdde34` (pin `40dbe96bd1`) only: round 8 built no test-mocks pair. | EVIDENCED |
| A-31 | Lock/unlock, reboot and explicit runtime stop | `local-agent-stop.spec.ts` covers the stop read-back in the renderer. Lock and reboot: none. | DEVICE |

Count: 18 evidenced, 0 SOFTWARE, 1 EMULATOR, 2 CI; separately 6 HUMAN, 4 DEVICE, 0 UPSTREAM. **18 of 21 = 86%.** (MVP completion integration: A-29 moved back to EMULATOR, because only developer APKs ran it. Round 5: 15 of 21 = 71%; round 7 moved A-1, A-6, A-29 and A-30 on class-E runs.)

### B. Voice to note to calendar event or reminder (also J02)

Governing text: Completion plan journey B; flow audit F07, F12, F13, J02; runbook rows "Speech and Notes", "Calendar", "Reminders"; AP-03, AP-06, AP-09.

Journey spec: `test/browser/journey-b-voice-note-actions.spec.ts` (passed in this audit).

| # | Required step or negative case | Evidence on this branch | Class |
| --- | --- | --- | --- |
| B-1 | Record a note: real recorder and retained audio | Journey B (the microphone is a Web Audio oscillator); `notes-audio-journey.spec.ts`. | EVIDENCED |
| B-2 | A physically spoken note captured by the phone microphone | None. | DEVICE |
| B-3 | Transcribe with the selected service | Journey B uses the closed Cloud transcription fixture (a fixed string). Real Cloud transcription needs a signed-in account; none has been exercised. | HUMAN |
| B-4 | Review and correct the transcript, save, reopen after reload | Journey B. | EVIDENCED |
| B-5 | Read aloud and stop | Journey B (speech output is a recording fixture); `note-read-aloud.spec.ts`. | EVIDENCED |
| B-6 | Audible read-aloud on the device speaker | `VoiceNoteReadAloudInstrumentedTest` (gate `localSpeech=1`); on-device speech failed its functional acceptance. | DEVICE |
| B-7 | On-device speech recognition and synthesis without network | The retired Sherpa engine's `LocalSpeechInstrumentedTest` was recorded as 1 of 2 failed on arm64-v8a. Decision P-42 replaces it with libelizainference ([fused speech](fused-speech.md)); no acceptance has run on the new engine. P-07 makes Cloud the default; whether on-device speech is still required is A-24. | HUMAN |
| B-8 | Edit and delete the selected note; it reaches Trash; restore it | `notes-trash.spec.ts` (seven tests). Not part of journey B. | EVIDENCED |
| B-9 | Trash empties automatically after 3 days | `notes-trash.spec.ts` ("purges exactly three days after deletion"). Native backstop `NotesTrashBackstopInstrumentedTest`: recorded as passed on both flavors in the emulator campaigns at `73b973a5` and `6dcdde34` ([verification](verification.md), class E, developer-override APKs), when the class had two of its present nine cases. All nine passed on both flavors at the round 8 source ([verification](verification.md), "Emulator results at 2961bd9e"), after one of round 9's cases was corrected: it wrote text that is not JSON into a slot, which the secure store refuses. | EVIDENCED |
| B-10 | Full storage is refused without losing data | `notes-save-failure.spec.ts` covers failed writes. Round 5: `notes-trash-full.spec.ts` fills Trash to its entry limit through the Delete control (the served policy module has only the limit lowered) and deletes one more note: refused, the note and Trash unchanged across a reload, and the deletion goes through once room is made. Since the merge with PR 388 (MVP-15) the refusal is the "Trash is full" dialog, and the spec requires that dialog and declines it; `notes-trash-recovery.spec.ts` covers its choices. Round 9 added the byte limit to the same spec ("a deletion that would push Trash past its byte limit is refused"). Weak point: the native slot cap is raised by no browser test. Native `NotesStorageDurabilityInstrumentedTest` is recorded as passed on both flavors at `73b973a5` and, after one first-run failure on one flavor that did not recur, at `6dcdde34` (class E, developer-override APKs), and passed on both flavors at the round 8 source ([verification](verification.md), "Emulator results at 2961bd9e"). | EVIDENCED |
| B-11 | Interrupted save keeps the unsaved text | `notes-save-failure.spec.ts`, `voice-save-ownership.spec.ts`. | EVIDENCED |
| B-12 | Native encrypted Notes storage survives a process restart | `NotesSecureStorageInstrumentedTest` (registered in round 5 with its `notesSecureStorage=1` gate: `--classes NotesSecureStorage`; its legacy-layout migration now has a restart phase, `node scripts/test-native-restart.ts notes-secure-migration`, not yet run); `node scripts/test-native-restart.ts notes`. No run at this source. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): NotesSecureStorage passed on both flavors (migration method still skipped) and the `notes` restart campaign passed on both (launcher on its second run). Round 8 ([verification](verification.md), "Emulator results at 2961bd9e"): the `notes` restart campaign passed 3 of 3 on the launcher flavor and 1 of 1 on standalone; NotesSecureStorage was not repeated. | EVIDENCED |
| B-13 | The agent proposes a calendar event; the review shows account, time zone and attendees before confirming | Round 5: the browser review now states the calendar and account, the times in the event's zone, the zone against the phone's, the all-day state and what happens to attendees (`apps/app/src/browser/calendar-agent-review.ts`, `test/calendar-agent-review.test.mjs`). Journey B proposes an event in a zone that is not the phone's and asserts every line; a second journey B test covers a proposal for another source revision (never offered for approval) and a review abandoned with Back. Flag-off Android: `calendar-proposal-review.production.spec.ts` asserts the proposal card and one exact native hand-off. Weak points: the proposal is still authored through "Action JSON"; the agent contract carries no attendees or all-day flag, so the review states that none are added rather than listing any; on Android the second review is the pinned Calendar plugin's native dialog, which names the calendar and the time but not the account or attendees (see UPSTREAM note below), and no emulator run exists. | EVIDENCED |
| B-14 | A real agent decides to propose the event or reminder | `LiveAgentInstrumentedTest` (gate `liveAgent=true`, real provider). No runner. | HUMAN |
| B-15 | Read the actual provider state after create, edit and delete (Android CalendarProvider) | `CalendarCrudInstrumentedTest`, `CalendarAgentCrudInstrumentedTest` through `scripts/test-calendar-regression.ts`. No run at this source. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): CalendarCrud and CalendarAgentCrud passed on both flavors through `scripts/test-calendar-regression.ts`. Round 8 ([verification](verification.md), "Emulator results at 2961bd9e"): CalendarCrud (2 tests) and both methods of CalendarAgentCrud passed on both flavors at pin `13c98575987a`. | EVIDENCED |
| B-16 | Edit and delete the same event through the agent | `dev-calendar-assistant.spec.ts` (one case per mode). Journey B never edits or deletes the agent-created event; it edits and deletes the hand-off event through Calendar controls. | EVIDENCED |
| B-17 | Create, edit and delete an event through the direct UI | Journey B steps 7a/7b. Flag-off web: `journey-core-loops.production.spec.ts` (B, C, J04). | EVIDENCED |
| B-18 | Add a reminder or to-do | Journey B (note hand-off and agent path). | EVIDENCED |
| B-19 | Edit its time | Journey B ("Start later", persisted after reload). | EVIDENCED |
| B-20 | The reminder is delivered by the OS | `dev-calendar-alerts.spec.ts` uses the simulated shade. Native: `ReminderOneOffInstrumentedTest` through `scripts/test-reminder-one-off.ts`. No run at this source. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): the reminder one-off campaign passed on both flavors. | EVIDENCED |
| B-21 | Snooze, complete, reopen and cancel | `reminder-lifecycle.spec.ts`, `reminder-decision-review.spec.ts`, `reminder-timing-review.spec.ts`. Journey B only cancels. | EVIDENCED |
| B-22 | Reboot re-arms the reminder | `ReminderRecoveryInstrumentedTest` through `scripts/test-reminder-recovery.ts` (the runner really reboots the emulator). No run at this source. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): the reminder recovery campaign, with a real emulator reboot, passed on both flavors. | EVIDENCED |
| B-23 | A concurrent change invalidates a stale proposal instead of editing another object | `calendar-agent-transaction-cancel.spec.ts`, `dev-calendar-assistant.spec.ts`, `reminder-refusal-ui.spec.ts`. Not part of journey B. | EVIDENCED |
| B-24 | Reads and destructive changes need the intended scope, not a cached approval | `reminder-delete-review.spec.ts`, `reminder-create-review.spec.ts`, `notes-review.spec.ts`. | EVIDENCED |
| B-25 | Denied calendar permission or write access revoked during review | `CalendarCrudInstrumentedTest.revokedCalendarWriteAccessDuringReviewCannotDelete`, `WorkflowPhoneNativeInstrumentedTest.deniedCalendarGrantReturnsNoEvents`. No run at this source. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): CalendarCrud (including the revoked-write case) passed on both flavors; `WorkflowPhoneNativeInstrumentedTest` was not run, so the step stays here. Round 8: both halves have a command and neither was run. CalendarCrud is campaign 7; `WorkflowPhoneNativeInstrumentedTest.deniedCalendarGrantReturnsNoEvents` runs in campaign 15 (`scripts/android-workflow-native.ts`, which existed but read an archive only the strict build could make; `scripts/developer-archive.ts` now makes it from developer APKs). Run ([verification](verification.md), "Emulator results at 2961bd9e"): CalendarCrud passed on both flavors again. The WorkflowPhoneNative campaign first failed at its first case, whose cleanup asked the page's secure-storage bridge to remove a native-only journal slot and asserted success; with the test asserting the refusal instead, the campaign passed 14 of 14 and `deniedCalendarGrantReturnsNoEvents` passed on both flavors. | EVIDENCED |
| B-26 | Notifications disabled: the reminder is saved and the state says delivery is off (J02 failure case) | `settings-truth.production.spec.ts` reads a blocked channel back from a stub. Native: `node scripts/test-native-permissions.ts channels`. No run at this source. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): the `channels` campaign passed on both flavors. Round 8 ([verification](verification.md), "Emulator results at 2961bd9e"): the campaign first failed twice on both flavors because its test clicked Home's new "Notifications" handle instead of the Settings row (a test defect round 8 introduced); with the selector corrected (`f87850fa`) it passed on both. | EVIDENCED |
| B-27 | Audio interrupted or transcription failed keeps the recording (J02 failure cases) | `note-audio-lifecycle.spec.ts`, `voice-save-ownership.spec.ts`, `notes-audio-journey.spec.ts`. | EVIDENCED |
| B-28 | A saved voice note can start a calendar event directly, and created records link back to the note | Merged from `main` (round 4 hand-offs): `note-calendar-handoff.spec.ts` (four tests): "Review event draft" on a saved note writes nothing until Save, the saved event and a reminder from a note link to exactly that note, the open-note action fails closed for a deleted or replaced note and says when it was edited, and a double activation or a reload mid hand-off saves once. Weak point: browser build only. On Android the reminder's note link is written to the native slot `note-origins:v1:device`, which the native compare-and-exchange refused until the MVP completion integration admitted it (`AlphaConnectionPlugin`); `NoteOriginInstrumentedTest` reads it back at storage level and is compiled, not run. An event in the Android device calendar carries no link back, and the event draft says so before Save. | EVIDENCED |

Count: 23 evidenced, 0 SOFTWARE, 0 EMULATOR, 0 CI; separately 3 HUMAN, 2 DEVICE, 0 UPSTREAM. **23 of 23 = 100%.** (Round 8 moved B-25 on the workflow campaign at `9a1ca161`. Of the 23, B-12, B-15, B-20, B-22 and B-26 rest on round 7 runs at `6dcdde34` or round 8 runs at `2961bd9e`, all on developer APKs.) (Round 5: 17 of 23 = 74%; round 7 moved B-12, B-15, B-20, B-22 and B-26 on class-E runs.) (Round 4: 14 of 23 = 61%; round 5 closed B-10 and B-13; the round 4 hand-offs closed B-28.)

### C. Alarms

Governing text: Completion plan journey C; runbook row "Clock"; pending decision A-11; AP-09.

Journey spec: `test/browser/journey-c-alarms.spec.ts` (passed in this audit).

| # | Required step or negative case | Evidence on this branch | Class |
| --- | --- | --- | --- |
| C-1 | A set request is reviewed with its exact content and nothing runs before approval | Journey C (proposal authored through "Action JSON"); `agent-clock-handoff.spec.ts`; flag-off Android: `journey-core-loops.production.spec.ts` loop C. | EVIDENCED |
| C-2 | One approval is one handoff; the record says only that the handoff opened | Journey C; `journey-core-loops.production.spec.ts` loop C (one `DailyApps.clockHandoff`, "Alpha cannot confirm an alarm was changed"). Round 5: the same spec sends one reviewed snooze and one reviewed dismiss request on the stubbed Android path. | EVIDENCED |
| C-3 | Android builds the correct Clock intents for set, show, snooze and dismiss | `ClockHandoffInstrumentedTest` (intents intercepted), `ClockRepeatDaysInstrumentedTest`. Neither had a runner entry before this audit; no run recorded. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): ClockHandoff and ClockRepeatDays passed on both flavors, and again in round 8 ("Emulator results at 2961bd9e"). Round 8 ([verification](verification.md), "Emulator results at 2961bd9e"): both passed on both flavors again at pin `13c9857598`. Until the MVP completion integration Alpha advertised only `clock.handoff.v1`, so the repeat days ClockRepeatDays covers could not reach Clock from an agent; Alpha now adds `clock.handoff.v2` on Android when the agent offers it and the native surface reports `clockRepeatDaysVersion` 1 (class S, not run on an emulator). | EVIDENCED |
| C-4 | A real alarm is created, rings, snoozes and is dismissed in the installed Clock | `RealClockInstrumentedTest` (runner registry, needs `--clock-exclusive`). No run recorded. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): RealClock passed on both flavors on an API 35 emulator (the fixture is qualified for API 35 only). Its last run is that one, at `6dcdde34` (pin `40dbe96bd1`): round 8 had only an API 36 image and did not run it. | EVIDENCED |
| C-5 | Audible ringing, vibration and Do Not Disturb behaviour | None. | DEVICE |
| C-6 | No Clock handler: the request reports that and claims nothing | `journey-core-loops.production.spec.ts` loop C ("unavailable" outcome: one request, native message shown, no saved-alarm wording). | EVIDENCED |
| C-7 | Denied access | `ClockAgentReviewInstrumentedTest` injects a denied delivery (through `scripts/ci/pending-recovery-ui.py`, hosted runner only). No passing run recorded. Round 8: `gh workflow run resident-android.yml --ref <branch>`, job `recovery-ui`, method `journalBoundOwnerReviewManualSelectionCancellationAndRecreation` (CI-1). Not dispatched. | CI |
| C-8 | The phone image has no Clock app at all | No test runs on such an image. Whether the image ships a Clock app or Alpha owns alarms is A-11. | HUMAN |
| C-9 | Reboot: the alarm persists | Owned by Android Clock under the current handoff. None. | DEVICE |
| C-10 | Time-zone change between review and confirmation retires the request | `journey-core-loops.production.spec.ts` loop C (added in this audit; the adapter branch had no test). | EVIDENCED |
| C-11 | A repeated request after an unknown result is preceded by a warning, across a restart | `journey-core-loops.production.spec.ts` loop C (added in this audit). | EVIDENCED |
| C-12 | Late delivery and DST behaviour of a set alarm | Owned by Android Clock. None. | DEVICE |
| C-13 | Cancelling the review sends nothing | `journey-core-loops.production.spec.ts` loop C (added in this audit). Round 5: journey C declines an alarm proposal and reads back no alarm, no journal entry and no receipt, past the alarm time and a reload. | EVIDENCED |
| C-14 | Reminder delivery is never presented as an alarm-clock guarantee | Journey C (no "will ring", "confirmed" wording); `journey-core-loops.production.spec.ts` loop C (no "Alarm saved", "Ringing"). | EVIDENCED |
| C-15 | Who owns alarms | Undecided: A-11. | HUMAN |

Count: 9 evidenced, 0 SOFTWARE, 0 EMULATOR, 1 CI; separately 2 HUMAN, 3 DEVICE, 0 UPSTREAM. **9 of 10 = 90%.** (Round 5: 7 of 10; round 7 moved C-3 and C-4 on class-E runs.)

### D. Two scheduled digests

Governing text: Completion plan journey D; flow audit F15; runbook row "Workflows and results"; open decision A-09; AP-07.

Journey spec: `test/browser/journey-d-digests.spec.ts` (passed in this audit).

| # | Required step or negative case | Evidence on this branch | Class |
| --- | --- | --- | --- |
| D-1 | Morning and evening schedules created after review, each with owner, source, IANA zone and local time | Journey D (development scheduler); `dev-digest-schedule.spec.ts`. | EVIDENCED |
| D-2 | Schedule identity: template version and enabled revision survive replay and lost acknowledgements | `dev-digest-schedule.spec.ts` ("digest mutation replay, lost acknowledgements, revocation and account retirement retain exact identities"). Journey D does not assert a version. | EVIDENCED |
| D-3 | Input is an identified snapshot with its freshness | Journey D (a typed snapshot reviewed in the panel); `digest-source-renewal.spec.ts`. | EVIDENCED |
| D-4 | Real provider sources (mail, calendar, tasks) feed a digest | None. Needs a Google grant; the Google code exchange currently returns 401. | HUMAN |
| D-5 | The phone is powered off before admission and two server runs complete while it is off | Not coverable. The resident agent cannot run on a powered-off phone; A-09 is open. | HUMAN |
| D-6 | Each occurrence runs once with a distinct run ID, scheduled instant and retained output | Journey D (development scheduler; the output is the scripted reply). | EVIDENCED |
| D-7 | A restart inside the scheduled minute does not admit the occurrence twice (renderer) | Journey D (page reload inside the minute). | EVIDENCED |
| D-8 | A resident worker killed at an admission or execution boundary creates no duplicate result | `npm run agent:test-digest-restart`, run in round 5 at upstream `352d7a08`: exit 0. The interrupted run stays `outcome-unknown` with no result and no second inference, duplicate admissions return the same run ID, and a never-admitted overdue occurrence yields one explicit `missed` result. This is host-runtime evidence with a synthetic model (class S), not Android, and it is one recorded manual run made before `main` moved the upstream pin to `40dbe96b`; it was not repeated at the merged source: the check needs a 6 GB prepared source and is in no automated lane. Preparation and the recorded result: `docs/local-agent-development.md`, "Isolated digest process-recovery check". Round 8 repeated it at pin `40dbe96bd1` (2026-10-11, source `dc0baed4`); it has not been repeated at `13c9857598`, the pin since round 9. The MVP completion integration added a dispatch-only lane for it (`.github/workflows/digest-restart.yml`), which has not been dispatched. That run: exit 0, one model call in the admit phase and none after, `recovered.json` and `overdue-result.json` as in round 5. Still host-runtime evidence with a synthetic model, still in no automated lane. | EVIDENCED |
| D-9 | Revoke a source | `dev-digest-schedule.spec.ts` ("a clock set back, a paused schedule and a revoked source never settle an occurrence twice or late"). | EVIDENCED |
| D-10 | Edit and disable a schedule | `dev-digest-schedule.spec.ts` ("an edited time runs once at its new time"; paused schedule). | EVIDENCED |
| D-11 | Overlap and missed time leave explicit records and no backlog replay | Journey D; `dev-digest-schedule.spec.ts`; `test/digest-occurrence-delivery.test.mjs`. | EVIDENCED |
| D-12 | DST gap skipped; repeated local time admitted once at the earlier offset | `dev-digest-schedule.spec.ts` (repeated and skipped clock-time scenarios). | EVIDENCED |
| D-13 | On reconnect each exact output is shown once and acknowledgements survive another restart (renderer) | Journey D (reload); `dev-hosted-results.spec.ts`. | EVIDENCED |
| D-14 | The native result inbox recovers a committed result with a lost acknowledgement once across process death | `HostedProcessRestartInstrumentedTest` (three phases, in a disposable secondary user on a test-mocks app build: `--test-mocks --classes HostedProcessRestart`; it is not a default class because it needs the test-mocks build). Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): HostedProcessRestart passed its three phases on both flavors of the test-mocks pair, in a disposable secondary user the runner now creates. Evidenced at `6dcdde34` (pin `40dbe96bd1`) only: round 8 built no test-mocks pair. | EVIDENCED |
| D-15 | A result notice delivered in the background and tapped after a process restart reaches the exact result | `dev-hosted-journey.spec.ts` needs a local-agent build and its own server. Native: `WorkflowNoticeProcessDeathInstrumentedTest` through `scripts/ci/pending-recovery-ui.py` (hosted runner only). Round 8: `gh workflow run resident-android.yml --ref <branch>`, job `recovery-ui`, `WorkflowNoticeProcessDeathInstrumentedTest#originalNoticeLaunchesAbsentMainAfterOrdinaryProcessDeath` (CI-1). Not dispatched. | CI |
| D-16 | Actions that could not run stay waiting or expired and never gain a success receipt | `workflow-outcome-unknown.spec.ts`, `workflow-interruption-recovery.spec.ts`. | EVIDENCED |
| D-17 | Home shows the last real brief and never a missed record | `test/home-cards.test.mjs`. Round 5: journey D asserts the rendered Home card at each stage (no brief before a run, the morning brief after a restart, the evening brief kept when the next occurrence is missed, no brief when the only record is a missed one); the development profile now reads the same `latestRetainedDigest` source as the product profile. Since the merge with PR 388 (MVP-19) Home also has a dedicated "Latest brief" card in both profiles, and journey D asserts it beside the workflows tile: absent with no brief or only a missed record, present with the retained brief. In the product profile `workflow-adapter.ts` and `automations-adapter.ts` still overwrite the workflows tile with the workflow list, so there the brief is read from the dedicated card only (`home-daily-overview.spec.ts` and its production spec, synthetic retained results). Round 9 added `home-brief-result.production.spec.ts`: on the flag-off build with the Android bridge stubbed, a digest result in the agent's wire shape enters through the native result inbox and, separately, through the renderer's result page, and reaches the Home brief card; an occurrence that did not run never replaces it. The rows are synthetic and no digest ran (class S). `home-attention.spec.ts` has no brief case. | EVIDENCED |
| D-18 | The flag-off Android panel says schedules run on the phone and cannot run while it is off | `journey-core-loops.production.spec.ts` loops D and F on Android (added in this audit). | EVIDENCED |
| D-19 | Morning and evening flows run on the resident runtime with real model output on a phone | None. | HUMAN |
| D-20 | Delivery under battery saver, Doze and lock | None. | DEVICE |
| D-21 | Phone sources (calendars on the phone) feed a digest only after consent, within the bounds, and can be revoked and renewed | `digest-native-sources.production.spec.ts` (MVP completion integration, flag-off bundle, stubbed bridge): the 16-calendar cap and the 1–168 h expiry bounds, the consent summary text, confirm and revoke, renewal arm and clear, the renew tap rebinding the bound loop, and no evening controls without the agent's advertisement. `test/native-digest-sources.test.mjs` (host JVM). No emulator run of the native source path. | EVIDENCED |
| D-22 | A dossier request is offered only with native phone sources on the resident agent, and Cancel dispatches nothing | `digest-native-sources.production.spec.ts` (Cancel dispatches nothing); `test/digest-route-registration.test.mjs` reads the pinned upstream route table and requires `POST /api/workflow/hosted/dossier` to be registered (elizaOS/eliza#35906, at the pin `bc71e21f3b`), and `test/digest-capabilities.test.mjs` requires the button to be gated on native sources on the resident agent, which is staged from that pin. Class S. | EVIDENCED |
| D-23 | A dossier runs on the pinned agent | The pin `bc71e21f3b` registers `POST /api/workflow/hosted/dossier` with the handler's 2000-byte body cap (elizaOS/eliza#35906; `test/digest-route-registration.test.mjs`, class S). No dossier has run: that needs the resident agent on an emulator with native phone sources and an inference route. Until the pin move this step was UPSTREAM. | EMULATOR |

Count: 17 evidenced, 0 SOFTWARE, 1 EMULATOR, 1 CI; separately 3 HUMAN, 1 DEVICE, 0 UPSTREAM. **17 of 19 = 89%.** (Pin move to `bc71e21f3b`: D-23 moved from UPSTREAM to EMULATOR when the dossier route was registered upstream. MVP completion integration: added D-21 and D-22 (evidenced, class S) and D-23 (UPSTREAM). Two counted rows are not at the current pin: D-8 last ran at `40dbe96bd1` (host runtime) and D-14 at `6dcdde34` (pin `40dbe96bd1`). Counted only at the current pin, D is 15 of 18 = 83%. Round 5: 14 of 16; round 7 moved D-14 on a class-E run.)

### E. Browser and credentials

Governing text: Completion plan journey E; flow audit F08, F09, J08; runbook row "Browser and passwords"; P-04, P-05; AP-11.

Journey spec: `test/browser/journey-e-browser-credentials.spec.ts` (passed in this audit).

| # | Required step or negative case | Evidence on this branch | Class |
| --- | --- | --- | --- |
| E-1 | Navigate, search, Back and Forward | Journey E (local HTTP pages; the search result is fulfilled by the test); `browser-navigation.spec.ts`; flag-off web: `journey-core-loops.production.spec.ts` (E, J05). | EVIDENCED |
| E-2 | Open and switch tabs | Journey E. | EVIDENCED |
| E-3 | Upload a test-owned file | Not in the journey and no browser-build spec. Native: `BrowserFlowInstrumentedTest` (runner default). No run at this source. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): the upload method passed on both flavors of the test-mocks pair, but BrowserFlow as a class failed on its live Google search method (environment), so the step stays here. Round 8: no change to the class. CI-3 repeats the default run on a hosted runner, where the live-search method has a different network; campaign 4 keeps the upload method on the test-mocks pair. Round 8 ([verification](verification.md), "Emulator results at 2961bd9e"): the default run failed on the live-search method again. The MVP completion integration made the default search method offline (it asserts the submitted `www.google.com/search` address and the `javascript:` refusal) and moved the live page behind `--live-network`; not run since. In the browser build, `browser-navigation.spec.ts` now uploads a file into a framed page and checks that it reaches only that page (class S); the step is native, so it stays here. Round 8 run ("Emulator results at 2961bd9e"): the flag-off default run failed on the same live-search method on both flavors; the test-mocks pair was not built, so the upload method did not run, and CI-3 was not dispatched. | EMULATOR |
| E-4 | Download a test-owned file | Not in the journey. Native: `BrowserDownloadInstrumentedTest` (needs `--test-mocks`). The last recorded pass is "Build47, 2026-09-30", with no commit. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): BrowserDownload passed on both flavors of the test-mocks pair. Evidenced at `6dcdde34` (pin `40dbe96bd1`) only: round 8 built no test-mocks pair. | EVIDENCED |
| E-5 | Return from an external handoff | `BrowserSigninsInstrumentedTest` (tel links, app links). No run at this source. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): BrowserSignins passed 5 of 6 on both flavors (the restart phase is E-10). Round 8 ("Emulator results at 2961bd9e"): BrowserSignins passed on both flavors in the default run. | EVIDENCED |
| E-6 | Only reviewed page text reaches speech | Journey E (it replaces `BrowserVoice.prototype.synthesizeLocal` through `page.evaluate` and the call ends in a thrown "Fixture terminal"); `reading-review.spec.ts`. | EVIDENCED |
| E-7 | Navigating during approval rejects the old target (renderer) | `web-summary-note.spec.ts` ("a changed native-style document identity retires the pending page excerpt"), `browser-navigation.spec.ts`. Round 5: journey E, where a page that navigates by itself while its excerpt is under review retires the review and nothing of the old page is read. | EVIDENCED |
| E-8 | Native reading binds to the reviewed document and rejects replay and stale documents | `BrowserReading`, `BrowserReadingNavigation`, `BrowserIsolatedReading` instrumentation. None had a runner entry before this audit; no run recorded. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): environment limit: no WebView provider on the machine reports isolated-world injection (133 and 145.0.7632.218 tried; CI uses 157). The classes also need the test-mocks build. Round 8: CI-2 (`gh workflow run android-emulator.yml --ref <branch> -f suite=browser-reading`) runs the three classes plus BrowserSensitiveReading on the pinned Chromium 157 WebView, each on the build it needs. Not dispatched. Round 8 run ("Emulator results at 2961bd9e"): BrowserReadingNavigation failed on both flavors for the same reason (WebView 133 reports no isolated-world injection); the test-mocks classes did not run. | EMULATOR |
| E-9 | Malicious page content cannot reach the privileged bridge or authorize an action | Journey E checks only that an inline script did not run in the host document. The bridge boundary itself is native: `BrowserIsolatedReadingInstrumentedTest`. No run recorded. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): environment limit as E-8. Round 8: CI-2, as E-8. | EMULATOR |
| E-10 | A sign-in in a normal tab survives an app restart (P-04) | Not coverable in the browser build. `BrowserSigninsInstrumentedTest.signinProcessRestartPhase` named a runner case that did not exist; it was added in this audit. No run recorded. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): the `signin` restart campaign passed on both flavors. Evidenced at `6dcdde34` (pin `40dbe96bd1`) only: round 8 did not run the `signin` campaign. | EVIDENCED |
| E-11 | Nothing from a private tab persists after it closes | Journey E covers the tab list and history only. Cookies and storage: the same native phase. No run recorded. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): the same `signin` restart campaign passed on both flavors. Evidenced at `6dcdde34` (pin `40dbe96bd1`) only, as E-10. | EVIDENCED |
| E-12 | Vault, OTP and recovery pages with secrets in plain text never reach reading or the agent | `reading-sensitive.spec.ts` (credential prose, sensitive addresses, API-key URLs). Journey E covers a password input only. | EVIDENCED |
| E-13 | Integrated password manager: unlock, add, lock (renderer against a stubbed native vault) | `password-manager.spec.ts` ("native vault: Android unlock, app bindings, copy and autofill picker with status readback"). Journey E uses the development vault and development provider, which do not exist flag-off. | EVIDENCED |
| E-14 | Integrated vault on Android: Keystore, device unlock, save, and fill through the Android Autofill service | `BrowserAutofillInstrumentedTest` (test-mocks APK only; the runner entry named a class that does not exist and was corrected in this audit), `PasswordBrowserFillInstrumentedTest`. When this audit was written the only recorded run of the native flow (at `d3dc9977`) had failed before save/unlock. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): BrowserAutofill (test-mocks pair) passed on both flavors; PasswordBrowserFill passed on the launcher flavor and on standalone in three of four runs (one run failed its tap-geometry precondition and was not reproduced). Reclassified in the MVP completion integration: none of these runs saves to or fills from the integrated vault. A website fill inside Alpha's browser is refused without native per-field origins, which is current behaviour, so what those classes show is the refusal and the provider boundary. The integrated vault's own path is `PasswordVaultSettingsInstrumentedTest` and `PasswordVaultFillInstrumentedTest` (Autofill into a fixture activity), registered with `--classes PasswordVaultSettings,PasswordVaultFill` and not run. Round 8 ("Emulator results at 2961bd9e"): with the tap wait of round 8, PasswordBrowserFill passed 4 of 4 on standalone and 1 of 1 on launcher; four runs do not prove the race closed. BrowserAutofill (test-mocks pair) was not repeated. | EMULATOR |
| E-15 | Cancel the picker; disable and re-enable the provider | `password-provider-setup.spec.ts` (stubbed bridge). | EVIDENCED |
| E-16 | Wrong-origin rejection and iframe boundaries | `PasswordBrowserFillInstrumentedTest` (cross-origin frame never offered), `BrowserAutofillInstrumentedTest`. No run recorded. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): PasswordBrowserFill and BrowserAutofill as in E-14, including the round 8 repeat of PasswordBrowserFill. Round 8 ([verification](verification.md), "Emulator results at 2961bd9e"): PasswordBrowserFill passed on both flavors at pin `13c9857598` (standalone 4 of 4, launcher 1 of 1); BrowserAutofill needs a test-mocks pair and did not run. What is shown is that a cross-origin frame is never offered a fill, not that the integrated vault fills a site. | EVIDENCED |
| E-17 | Multi-tab transitions, process death and provider or browser update | None. | DEVICE |
| E-18 | Proton Pass: real provider sign-in, save and fill | None. | HUMAN |
| E-19 | Passkeys | Not implemented; A-12. | HUMAN |
| E-20 | Qualification on a release-signed device | None; no release signer exists (A-06). | HUMAN |
| E-21 | The flag-off web build shows an honest password page and no development vault | `journey-core-loops.production.spec.ts` (E, J05); `password-manager.spec.ts` ("browser build without the development profile offers no simulated vault"). | EVIDENCED |
| E-22 | Find in page, fullscreen and HTTP authentication in the native browser | `BrowserWebFeaturesInstrumentedTest` (needs a test-mocks pair: `npm run test:android:instrumentation -- --owned-emulator --avd <avd> --serial emulator-NNNN --test-mocks --classes BrowserWebFeatures`). Find in page is native-only; the web build has no Find control (`browser-web-find.production.spec.ts`, class S). No recorded run. | EMULATOR |
| E-23 | Share a page through Android's chooser | `BrowserShareInstrumentedTest` (`--classes BrowserShare`; opens a public HTTPS page, so the emulator needs network). No recorded run. | EMULATOR |
| E-24 | Page dialogs (alert, confirm, prompt) follow the page's lifecycle | `BrowserDialogLifecycleInstrumentedTest` (`--test-mocks --classes BrowserDialogLifecycle`). No recorded run. | EMULATOR |
| E-25 | A WebView without isolated-world injection refuses reading and says so | `BrowserUnsupportedReadingInstrumentedTest` (`--test-mocks --classes BrowserUnsupportedReading`; needs a WebView provider without isolated-world injection, such as the API 36 image's WebView 133). No recorded run. | EMULATOR |
| E-26 | Browser storage written by an earlier build keeps its format | `BrowserStorageFormatInstrumentedTest` through `node scripts/test-browser-storage-format.ts`. No recorded run. | EMULATOR |
| E-27 | Reading a live public page end to end | `BrowserReadingLiveInstrumentedTest` through `node scripts/android-browser-reading-live.ts` (live network and a WebView with isolated-world injection). No recorded run. | EMULATOR |

Count: 13 evidenced, 0 SOFTWARE, 10 EMULATOR, 0 CI; separately 3 HUMAN, 1 DEVICE, 0 UPSTREAM. **13 of 23 = 57%.** (MVP completion integration: E-14 moved back to EMULATOR and E-22 to E-27 were added, each with no recorded run. E-4, E-10 and E-11 are evidenced at `6dcdde34`, pin `40dbe96bd1`, only.) Earlier: 14 of 17 = 82%. (Round 5: 8 of 17; round 7 moved E-4, E-5, E-10, E-11, E-14 and E-16 on class-E runs; E-3, E-8 and E-9 stay.)

### F. Email and reconnect notifications

Governing text: Completion plan journey F; flow audit F06, F14; runbook rows "Email", "Settings and notifications"; P-02; AP-08, AP-12.

Journey spec: `test/browser/journey-f-email-notifications.spec.ts` (passed in this audit).

| # | Required step or negative case | Evidence on this branch | Class |
| --- | --- | --- | --- |
| F-1 | Authorize only the required managed scopes and select an account | The synthetic provider starts with one connected account. The real Google code exchange returns 401 (`docs/cloud-production-validation.md`). | HUMAN |
| F-2 | Fetch full thread context | Journey F (a one-message thread); `gmail-mvp-scope.spec.ts`, `inbox-folders-drafts.spec.ts`. | EVIDENCED |
| F-3 | Explicitly open a permitted attachment | `inbox-save-attachment.spec.ts` (closed provider fixture). | EVIDENCED |
| F-4 | A local draft is kept independently of provider draft state | Journey F tests 1 and 2. | EVIDENCED |
| F-5 | Review exact From, To, Cc, Bcc, body and attachments before send | Round 5: `journey-f-reviewed-send.spec.ts` composes with Cc, Bcc and one attached file through the file chooser and asserts every header line, the attachment's name, type, size and SHA-256 and the body; the synthetic provider records the request text, and the dispatched request equals the prepared one byte for byte under the reviewed digest. A forward lists its original attachments (the review used to say "No attachments."). Flag-off Android: `mail-review.production.spec.ts` (Cc, Bcc, real protocol validation; no attachment, which is a native picker there). | EVIDENCED |
| F-6 | The same mutation identity is used across app recreation (renderer) | Journey F (reload: one prepare, one dispatch). The secure slot store is replaced with test storage through `page.evaluate`. | EVIDENCED |
| F-7 | The native encrypted operation journal survives recreation and process restart | `InboxOperationJournalInstrumentedTest` (no runner entry before this audit); `node scripts/test-native-restart.ts inbox`. No run at this source. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): InboxOperationJournal passed on both flavors and the `inbox` restart campaign passed on both. Round 8 ([verification](verification.md), "Emulator results at 2961bd9e"): both passed on both flavors again at pin `13c9857598`. Round 8 ("Emulator results at 2961bd9e"): both passed on both flavors again; the campaign now also asserts the saved sign-in offer in Inbox after the restart. | EVIDENCED |
| F-8 | A lost response is unknown and never resent automatically | Journey F test 3. | EVIDENCED |
| F-9 | Grant revocation | `gmail-grant-recovery.spec.ts`; flag-off Android without a grant: `journey-core-loops.production.spec.ts` loops D and F. | EVIDENCED |
| F-10 | A draft changed after review invalidates the review | Round 5: it did not hold. Send after an edit reopened the earlier review with its Send button. A send or draft review now records the local draft it was made from and is confirmable only while the composer holds that draft with exactly the reviewed content (`runtime/inbox-operation.ts` `confirm`, checked before the durable `dispatching` write; `inbox-provider-controls.ts`). An edited or different email discards the review without dispatch and is reviewed under a new request ID; with no email open (after a reload, or once the email was moved to another From account, sent there or discarded) the saved review reopens without a Send control. `journey-f-reviewed-send.spec.ts`: edit after closing the review, edit while the review is still being prepared, removal of a forwarded attachment, a reload between the edit and the discard, and an email moved to a second account and sent there; the first digest is never dispatched. `scripts/test-inbox-sent-cleanup.ts` covers each reviewed field at the `confirm` boundary. Flag-off Android: `mail-review.production.spec.ts`. The new cases fail with the fix reverted (checked in the round 5 review). | EVIDENCED |
| F-11 | An incorrect returned provider ID is refused | Journey F, new test in this audit: a reply naming another request is not confirmed and is never sent again. The review previously showed the internal text "Unexpected operation receipt"; that wording was replaced. | EVIDENCED |
| F-12 | Pagination revision changes | `gmail-mvp-scope.spec.ts` pages with Load more and drops a failed cursor. Round 5: a later page that repeats a loaded message (new mail arrived) is joined without the repeat, as before, and the list now says that newer mail is not shown and keeps a "Load newer mail" control until it is read again from the first page; a cursor the provider refuses keeps the loaded page, says so and reloads only on Retry (`journey-f-reviewed-send.spec.ts`, three cases). Weak point: the search contract carries no mailbox revision, so when a message is removed between pages a provider that keeps serving the old cursor skips one row and the renderer cannot tell; the spec asserts only that nothing is duplicated and that Refresh shows the exact mailbox (see UPSTREAM note below). | EVIDENCED |
| F-13 | Archive, trash and undo | Archive is reviewed and a stale review discarded (`gmail-mvp-scope.spec.ts`); Trash lists (`inbox-folders-drafts.spec.ts`). Round 5: `journey-f-reviewed-send.spec.ts` moves a message to Trash through the reviewed operation, undoes it through a second reviewed operation bound to the message as Trash left it, and drives a lost Trash reply as an unknown outcome (no second confirmation, Retry only reads the receipt, no second operation, reconciled by an explicit check). A double tap on Confirm used to land on the Undo control that replaced it; fixed. | EVIDENCED |
| F-14 | A real external send to an authorized recipient | None. | HUMAN |
| F-15 | A result or reminder is delivered while the app is in the background | `HostedBackgroundWorkerInstrumentedTest` (no runner entry before this audit), `ReminderOneOffInstrumentedTest`. No run at this source. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): HostedBackgroundWorker (test-mocks pair, secondary user), the reminder one-off campaign and the `notice` campaign passed on both flavors. Round 7 evidence at `6dcdde34` (pin `40dbe96bd1`) only: round 8 built no test-mocks pair and did not run the reminder one-off or `notice` campaigns. | EVIDENCED |
| F-16 | A notice tapped after a process restart reaches exactly its own result or task | Journey F test 5 uses the development "Device controls → Notifications" shade and a page reload. Native: `ReminderTapProcessDeath`, `WorkflowNoticeProcessDeath` through `scripts/ci/pending-recovery-ui.py` (hosted runner only). No passing run recorded. Round 8: `gh workflow run resident-android.yml --ref <branch>`, job `recovery-ui`, `ReminderTapProcessDeathInstrumentedTest#capturedReminderTapSurvivesMainDeathWithoutAnotherNotificationIntent` and the D-15 method (CI-1). Not dispatched. The work is an emulator run, but `scripts/ci/pending-recovery-ui.py` runs only on a GitHub-hosted runner, so both classes apply and the step is counted under CI. It has never passed anywhere. | CI |
| F-17 | With the channel disabled, in-app history still receives the result | `settings-truth.production.spec.ts` (stub). Native: `HostedResultNoticeInstrumentedTest.deniedNotificationRetainsEncryptedHistory` through `node scripts/test-native-permissions.ts notice-denied APP.apk TEST.apk NEW_OUTPUT` (round 5: POST_NOTIFICATIONS revoked before start, gate `hostedNoticeDenied=1`; the result is read back from encrypted history, no notice is posted or pending), and `… channels …`. The test reads the stored result through the bridge; it does not open the in-app history screen. No run recorded. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): the `notice-denied` and `channels` campaigns passed on both flavors. Round 8 ([verification](verification.md), "Emulator results at 2961bd9e"): `channels` passed on both flavors at pin `13c9857598`; `notice-denied` was not run there, so that half is evidenced at `6dcdde34` (pin `40dbe96bd1`) only. Round 8 repeated `channels` only (passed on both flavors after a test selector was corrected; see B-26). | EVIDENCED |
| F-18 | A notification seen or dismissed is distinct from a completed task | `dev-hosted-results.spec.ts`, `notification-action-lifecycle.spec.ts`. | EVIDENCED |
| F-19 | Source-account isolation | `inbox-owner-fence.spec.ts`. | EVIDENCED |
| F-20 | After a confirmed send the retained local copy is not offered for sending again | Merged from `main` (round 4 hand-offs): a provider-confirmed send removes the open composer, the retained copy and the saved draft of exactly the draft it came from; unknown and rejected outcomes keep them. `journey-f-email-notifications.spec.ts` asserts that no "Restore local draft", "Resume unsaved email" or "Continue draft" is offered after a confirmed send and that the copy stays while the outcome is unknown; `scripts/test-inbox-sent-cleanup.ts` (24 cases, wired as the adapter wires them) covers identity, edits made while the request is in flight, reload, another window and another account. | EVIDENCED |
| F-21 | New-mail notifications | Not implemented; A-05. | HUMAN |
| F-22 | Flag-off builds have no development mailbox and say which account is missing | `journey-core-loops.production.spec.ts` (D and F in the web build; D and F on Android). | EVIDENCED |

Count: 18 evidenced, 0 SOFTWARE, 0 EMULATOR, 1 CI; separately 3 HUMAN, 0 DEVICE, 0 UPSTREAM. **18 of 19 = 95%.** (Round 7 moved F-7, F-15 and F-17 on class-E runs.) (Round 4: 10 of 19 = 53%; round 5 closed F-5, F-10, F-12 and F-13; the round 4 hand-offs closed F-20.)

### J01. Poster to calendar

Governing text: Flow audit J01 and F10, F07; P-08.

Journey spec: `test/browser/journey-j01-poster-calendar.spec.ts` (passed in this audit).

| # | Required step or negative case | Evidence on this branch | Class |
| --- | --- | --- | --- |
| J01-1 | Capture a poster and recognize its text (English) | Journey J01 (the camera is a canvas stream; OCR is the real local engine). Flag-off web: `journey-core-loops.production.spec.ts` loop J01. | EVIDENCED |
| J01-2 | A physical camera capture of a printed poster | None. | DEVICE |
| J01-3 | An uncertain or impossible date is caught at review | `scan-event.spec.ts` ("rejects nonexistent DST time and can be corrected before handoff"). Journey J01 overwrites the recognized text with the exact poster text before drafting. | EVIDENCED |
| J01-4 | Edit the event draft | Journey J01. | EVIDENCED |
| J01-5 | Cancel at review or leave the Calendar form: nothing is saved | Journey J01. | EVIDENCED |
| J01-6 | Select the destination calendar and read the provider back | Journey J01 saves only to the in-app calendar. Android: `CalendarAgentCrudInstrumentedTest` (gate `calendarOptions=1`). No run at this source. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): CalendarAgentCrud's reviewed create/read/update/delete method passed on both flavors, but `directSaveReadsBackAllDayChosenZoneAndRrule` (gate `calendarOptions=1`) is passed by no runner and did not run. Round 8: `scripts/test-calendar-regression.ts --case=CalendarAgentCrudInstrumentedTest` now also runs that method with `calendarOptions=1` (campaign 7). Checked against a synthetic `adb`. Then run, class E on developer APKs ([verification](verification.md), "Emulator results at 2961bd9e"): after a stale expectation in the test was corrected (`DURATION` is `PT3600S`, as the shared module writes it), both methods passed on both flavors. This is the calendar API read back from CalendarProvider, not the composed poster-to-calendar loop on Android; `PosterCalendarJourneyInstrumentedTest` drove that loop through the Camera Scan mode and picker the view refresh removed (59badc34ca); no runner takes it until it is rewritten to the agent scan path, so the composed loop has no runnable native test. | EVIDENCED |
| J01-7 | Calendar scope denied | None in the browser build. Native: `CalendarCrudInstrumentedTest`, `WorkflowPhoneNativeInstrumentedTest`. No run at this source. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): CalendarCrud passed on both flavors; `WorkflowPhoneNativeInstrumentedTest` was not run. Round 8: campaign 15 runs it (see B-25). Run ([verification](verification.md), "Emulator results at 2961bd9e"): CalendarCrud passed on both flavors and, after a stale cleanup assertion in the campaign's first case was corrected, the workflow campaign passed 14 of 14, with `deniedCalendarGrantReturnsNoEvents` on both flavors. | EVIDENCED |
| J01-8 | Save creates exactly one event that survives reload | Journey J01; `journey-core-loops.production.spec.ts` loop J01. | EVIDENCED |
| J01-9 | The Home agenda card shows it and opens the same event | Journey J01; flag-off: `journey-core-loops.production.spec.ts` loop J01 (the Home card opens the same event). Browser build only; `HomeCalendarCardInstrumentedTest` (`node scripts/test-calendar-regression.ts --case=HomeCalendarCardInstrumentedTest`) is compiled, not run. | EVIDENCED |
| J01-10 | The native scan path publishes nothing to Photos unless kept | `CameraScanInstrumentedTest` (no runner entry before this audit). No run recorded. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): CameraScan passed 2 of 2 on both flavors after the scan model packaging fix, and passed on both flavors again in round 8 ("Emulator results at 2961bd9e"). | EVIDENCED |

Count: 9 evidenced, 0 SOFTWARE, 0 EMULATOR, 0 CI; separately 0 HUMAN, 1 DEVICE, 0 UPSTREAM. **9 of 9 = 100%.** (Round 8 moved J01-6 and J01-7 on runs at `2961bd9e`/`9a1ca161`. Round 5: 6 of 9; round 7 moved J01-10 on a class-E run.)

### J03. Email attachment to notes

Governing text: Flow audit J03 and F06, F16, F12.

Journey spec: `test/browser/journey-j03-document-analysis.spec.ts` (passed in this audit).

| # | Required step or negative case | Evidence on this branch | Class |
| --- | --- | --- | --- |
| J03-1 | Select an attachment in an Inbox thread and save it to Files | Journey J03 uses the development incoming-email simulator, which does not exist flag-off. Provider path: `inbox-save-attachment.spec.ts` (closed fixture). | EVIDENCED |
| J03-2 | A real mailbox attachment | None; blocked with loop F on the Google grant. | HUMAN |
| J03-3 | Preview the file in Files | Journey J03. | EVIDENCED |
| J03-4 | Only the reviewed excerpt reaches the agent | Journey J03 (asserted on the development agent's stored messages). | EVIDENCED |
| J03-5 | Save a reviewed note with a source link and reopen it after reload | Journey J03. | EVIDENCED |
| J03-6 | A changed or deleted source fails closed | Journey J03 (the bytes are rewritten directly in IndexedDB through `page.evaluate`; no rendered control edits stored bytes); `source-reference-integrity.spec.ts`. | EVIDENCED |
| J03-7 | A native document grant is restored and revoked across a process restart (expired URI) | `node scripts/test-native-restart.ts document`; `SelectedDocumentInstrumentedTest`. No run at this source. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): the `document` restart campaign (SelectedDocumentInstrumentedTest) passed on both flavors. Round 8 ([verification](verification.md), "Emulator results at 2961bd9e"): the `document` campaign passed on standalone only (launcher not run) at pin `13c9857598`. It covers the selected-document grant only, not a note's `a1:` source reference; the Android save of a reviewed summary and its source-reference method are untested, and `test-native-restart.ts` has a source-reference phase that has not run. A reference unused for 3 days releases its grant (see [agent integration](agent-integration.md#accepted-limits-and-gates-recorded-at-the-mvp-completion-integration)). Round 8 ("Emulator results at 2961bd9e"): passed on standalone with the visibility-aware receipts; the launcher flavor was not run. | EVIDENCED |
| J03-8 | A malicious attachment (active content, wrong type, oversized) | `inbox-save-attachment.spec.ts` rejects a mismatched digest; `MailAttachmentInstrumentedTest` bounds bytes. Round 5: `inbox-hostile-attachment.spec.ts` drives an HTML file with script, an SVG with script, bytes that do not match a declared PNG, JPEG, PDF or text type, an oversized file, an understated size, swapped bytes and a traversal name through the rendered controls and the product's own response validation: nothing executes, navigates or loads, a refused file is never saved, the email shared with an agent excludes attachments, and an unpreviewed type is saved as exact bytes (that save failed in the browser build before). Weak points: a refused file is reported as "Gmail is unavailable right now"; Android's attachment plugin and viewer handoff are not exercised. | EVIDENCED |
| J03-9 | The account is revoked | `gmail-grant-recovery.spec.ts` (read availability cleared). | EVIDENCED |
| J03-10 | Flag-off without an agent: the document question is not sent and nothing is saved | `journey-core-loops.production.spec.ts` loop J03. | EVIDENCED |
| J03-11 | A real agent answers from the reviewed excerpt | None. `document-summary-note.production.spec.ts` (MVP completion integration) drives the flag-off review, Send, Save and reopen with a stubbed agent stream; no real agent or model has answered (class R). | HUMAN |

Count: 9 evidenced, 0 SOFTWARE, 0 EMULATOR, 0 CI; separately 2 HUMAN, 0 DEVICE, 0 UPSTREAM. **9 of 9 = 100%.** (MVP completion integration: added J03-11, HUMAN. J03-7 rests on round 7 at `6dcdde34` for both flavors and round 8 at `2961bd9e` for standalone only. Round 7 moved J03-7 on a class-E run.) (Round 4: 7 of 9 = 78%; round 5 closed J03-8.)

### J04. Schedule to travel

Governing text: Flow audit J04 and F07; Maps row of the flow-audit product decisions.

Journey spec: `test/browser/journey-j04-schedule-travel.spec.ts` (passed in this audit).

| # | Required step or negative case | Evidence on this branch | Class |
| --- | --- | --- | --- |
| J04-1 | Create an event with an address | Journey J04; `journey-core-loops.production.spec.ts` (B, C, J04). | EVIDENCED |
| J04-2 | The selected address is handed to Maps exactly once | Journey J04 (synthetic Maps provider installed through `page.evaluate`); `calendar-maps-handoff.spec.ts`. | EVIDENCED |
| J04-3 | Several candidate addresses: nothing is selected or routed until the user chooses | Journey J04. "Multiple addresses" in the flow audit is read as several search candidates for one location, which is what the journey drives. | EVIDENCED |
| J04-4 | No Maps provider: the address is kept and no destination is invented | `calendar-maps-handoff.spec.ts`; flag-off web: `journey-core-loops.production.spec.ts` (B, C, J04). | EVIDENCED |
| J04-5 | No location permission: a manual origin is offered | Journey J04 ("Start" reports the missing permission). Native: `node scripts/maps/test-native-recovery.ts permission`, last recorded as Build59 (historical class E, not at pin `13c9857598`). Flag-off Android: `journey-j04-android.production.spec.ts` asserts the permission message (class S). | EVIDENCED |
| J04-6 | A route for a production user | The flag-off build has no Maps provider: `VITE_MAPS_BASE_URL` is unset and the emulator gateway exists only in test-mocks builds (`apps/app/src/maps/regional-provider.ts`). A production user gets "Connect a Maps provider to search places and plan routes." Choosing and licensing a provider is pending decision A-23 (recorded in the October 10 ledger refresh). | HUMAN |
| J04-7 | Return to the same event | Merged from `main` (round 4 hand-offs): `maps-event-return.spec.ts` (three tests): "Back to event" returns to exactly the originating event from every Maps layer, once and without a new search; a deleted or moved event fails closed; a reload in Maps drops the return. | EVIDENCED |
| J04-8 | Reload does not replay the hand-off | Journey J04. | EVIDENCED |
| J04-9 | GPS navigation and turn-by-turn | `MapsRegionalInstrumentedTest`, `MapsBackgroundNavigationInstrumentedTest` (regional fixture gateway), last recorded as Build59 (historical class E, not at pin `13c9857598`). Physical navigation: none. | DEVICE |
| J04-10 | The selected travel mode is exposed to assistive technology | Merged from `main` (round 4 hand-offs): the mode buttons carry `aria-pressed`; `journey-j04-schedule-travel.spec.ts` asserts it for all four modes before and after a change. | EVIDENCED |

Count: 8 evidenced, 0 SOFTWARE, 0 EMULATOR, 0 CI; separately 1 HUMAN, 1 DEVICE, 0 UPSTREAM. **8 of 8 = 100%.** The 8 exclude the production route (J04-6, HUMAN: no Maps provider, A-23). J04-4 and J04-7 are browser-build evidence only. The installed-map hand-off ('Open in maps app' on tap, the event's exact location text once per tap, only when DailyApps reports a maps action; never in the web build) landed in the MVP completion integration with a flag-off spec (`journey-j04-android.production.spec.ts`, class S); `MapsInstrumentedTest`'s event-return method (`--classes Maps`) is compiled, not run. (Round 4: 6 of 8 = 75%; the round 4 hand-offs closed J04-7 and J04-10.)

### J05. Web research to note

Governing text: Flow audit J05 and F08, F12.

Journey spec: `test/browser/journey-j05-web-research-note.spec.ts` (passed in this audit).

| # | Required step or negative case | Evidence on this branch | Class |
| --- | --- | --- | --- |
| J05-1 | Bounded review of a page excerpt | Journey J05 (page fulfilled by the test); flag-off web: `journey-core-loops.production.spec.ts` (E, J05). | EVIDENCED |
| J05-2 | Native WebView excerpt extraction bound to the page revision | `BrowserPageQuestionInstrumentedTest` (round 5): `AlphaBrowser.reviewQuestion` refuses another address, origin, session or navigation number; frame, form and hidden content is not extracted; a navigation between extraction and approval retires the excerpt and the old request cannot be replayed; sensitive addresses and content yield no excerpt; Menu → Ask about page → native review → question editor → composer shares nothing before Send, and Send with no agent dispatches nothing; a note with a web source keeps it across recreation and reopens that address. The agent's answer and the summary-note save after it are not covered (no agent on a distribution emulator build); the note in the last method is stored in the shape that save writes. `npm run test:android:instrumentation -- --owned-emulator --avd <avd> --serial emulator-NNNN --classes BrowserPageQuestion`. Round 7, class E on developer-override APKs ([verification](verification.md), "Emulator results at 6dcdde34"): environment limit as E-8: three of four methods need the isolated world; one passed on both flavors. Round 8: CI-2 runs the class on the flag-off pair with the pinned Chromium 157 WebView. Not dispatched. The MVP completion integration made the class offline (every page served from memory) and added `JourneyJ05InstrumentedTest` (`--classes JourneyJ05`, flag-off pair only, also needs isolated-world injection); neither has run. On Android, when the isolated world is unavailable the review now opens with an empty excerpt for pasted text (`browser-paste-fallback.production.spec.ts`, class S). | EMULATOR |
| J05-3 | The agent answers from the excerpt | Journey J05 (scripted reply). | EVIDENCED |
| J05-4 | Explicit save creates exactly one source-linked note that reopens after reload | Journey J05. | EVIDENCED |
| J05-5 | Observation unavailable (cross-origin denied): pasted text is reviewed instead | Journey J05 second test. | EVIDENCED |
| J05-6 | Cross-origin navigation or stale context retires the excerpt | `web-summary-note.spec.ts` ("a changed native-style document identity retires…", "HOME while fetching retires the page question"). Not in journey J05. | EVIDENCED |
| J05-7 | A sensitive page is refused before any editor opens | `web-summary-note.spec.ts`; journey E. | EVIDENCED |
| J05-8 | Flag-off without an agent: the question is not sent and the draft is kept | `journey-core-loops.production.spec.ts` (E, J05). | EVIDENCED |
| J05-9 | A real agent answers from the reviewed excerpt | None. | HUMAN |

Count: 7 evidenced, 0 SOFTWARE, 1 EMULATOR, 0 CI; separately 1 HUMAN, 0 DEVICE, 0 UPSTREAM. **7 of 8 = 88%.** (J05-2 stays EMULATOR: no WebView with isolated-world injection on the machines used, and the hosted job was not dispatched.)

## How the journey specs fall short of their loops

These are properties of the specs, not failures: every one passes.

- **Fixtures in place of the thing under test.** The agent in A, B, C, D, J03 and J05 is a
  scripted reply; no model output is evidence. Every agent proposal (B, C) is typed into
  the "Action JSON" development control. Transcription (B) is a fixed string. Speech (B,
  E) is a recording fixture; in E the speech call is replaced through `page.evaluate` and
  ends in a thrown error. Mail in F tests 2–4 is a provider object injected at
  `connectionController.getCloudClient`, with the secure slot store replaced by test
  storage, on the flag-on development server at `/`. That is the product renderer, not the
  production bundle.
- **State changed outside rendered controls.** A holds the development agent's Web Lock to
  create a pending reply. B reads the calendar source ID and revision from the phone
  context to build its proposal. J03 rewrites stored file bytes in IndexedDB. J04 and F
  install provider fixtures after every load. D moves the clock and models "app closed"
  by navigating to `about:blank`.
- **Results read from storage, not the screen.** B, C, D and J03 assert most
  exactly-once results through read-only `page.evaluate` views of persisted documents.
  D asserted Home's brief only as the value Home would read; since round 5 it asserts the
  rendered card as well.
- **Steps the loop requires that the journey never takes.** A: no automatic restore (a
  spoken request and a declined action were added in round 5). B: no Trash, restore or
  3-day emptying, no delivery, snooze or completion, no agent edit or delete of the event
  it created (a stale-source proposal was added in round 5). C: show is the only handoff
  besides set in the journey; Decline is pressed since round 5, and snooze and dismiss are
  requested on the stubbed Android path in the production spec. D: no source revocation,
  schedule edit or disable. E: no upload, download or external handoff (navigation during
  approval was added in round 5). F: no revocation, no hosted-result tap in
  `journey-f-email-notifications.spec.ts`; Cc, Bcc, attachments, an edit after review,
  Trash, undo and paging are in `journey-f-reviewed-send.spec.ts` since round 5.
- **Development controls standing in for the system.** F's notification tap uses the
  development "Device controls → Notifications" list; J04's return to the event uses
  "Device controls → Back".
- **The journey for C tests a different product from the Android one** (see the flag-off
  table).

## SOFTWARE work orders, in priority order

Fixed in this audit (each with a test; see "Changes made"): the dead `PasswordAutofillOffer`
runner entry, the missing runner entries for core-loop classes, the missing `signin`
restart case, the raw "Unexpected operation receipt" text, and the missing flag-off
journey assertions.

1. **Confirmed send keeps a resendable copy (F-20).** *Done on `main` (round 4 hand-offs).* After "Provider confirmed this
   operation", remove the retained unsaved composer record; keep it for an unknown outcome.
   Files: `apps/app/src/prototype/inbox-unsaved.ts`, `inbox-cloud-adapter.ts`, receipt copy
   in the review. Acceptance: journey F asserts "Resume unsaved email" is absent after a
   confirmed send and present after an unknown outcome; `docs/inbox-local-drafts.md`
   updated. Belongs to the Inbox owner; it changes documented behaviour.
2. **Calendar proposal review content (B-13).** *Done in round 5.* Assert, and add if missing, the destination
   calendar or account, the time zone and attendees in "Review calendar change". Files:
   `test/browser/journey-b-voice-note-actions.spec.ts`, `apps/app/src/prototype/calendar-adapter.ts`.
   Acceptance: a proposal with a non-device time zone and one attendee shows all three
   before Confirm, and a changed source revision refuses.
3. **Send review shows Cc, Bcc and attachments (F-5).** *Done in round 5.* Extend journey F's synthetic
   provider with Cc, Bcc and one attachment. Acceptance: each appears in "Review mail
   operation" before "Send this email"; the dispatched proposal equals the reviewed one.
4. **Draft changed after review (F-10).** *Done in round 5; it did not hold and was fixed.* New case in `inbox-folders-drafts.spec.ts` or
   journey F: open the review, close it, edit the body, Send. Acceptance: a second prepare
   with a new digest; the first digest is never dispatched.
5. **Note to event hand-off and back-link (B-28).** *Done on `main` (round 4 hand-offs), browser build.* A "Review event draft" control on a
   saved voice note (`voice-adapter.ts`, `template.html`), and a `noteSource` reference
   (note ID and revision) on reminders and events created from a note, with "Open source
   note" in the event detail that fails closed when the note is in Trash. Acceptance:
   journey B uses the control and opens the note back after reload.
6. **Return from Maps to the event (J04-7).** *Done on `main` (round 4 hand-offs).* An in-app "Back to event" control when Maps
   was opened from Calendar (`maps-adapter.ts`, `template.html`). Acceptance: journey J04
   returns without the development Back control and without a new provider request.
7. **Denied-microphone campaign (A-6). Done in round 5** (`voice` and `voice-revoke`
   scenarios; see "Round 5: native-runner gaps"). Original order: add a `voice` scenario to
   `scripts/test-native-permissions.ts` that revokes RECORD_AUDIO for the temporary user,
   runs `VoicePermissionDeniedInstrumentedTest` with `-e voicePermissionDenied 1` and
   restores the permission. Acceptance: runner-wiring test in
   `test/android-instrumentation-runner.test.mjs`; then an emulator run.
8. **Runner gaps for existing classes. Done in round 5**, except that (d) stops at Send:
   the summary-note save needs an agent reply. Original order: (a) Select and restore the HOME role on the owned
   emulator so `LauncherHomeInstrumentedTest` does not skip (A-1). (b) A denied-notification
   scenario that passes `hostedNoticeDenied=1` (F-17). (c) A registry entry for
   `ConnectionChooserInstrumentedTest` on the test-mocks pair (A-30). (d) Write a native
   test that takes a page excerpt through `AlphaBrowser.reviewQuestion` to a saved note
   and retires the token on navigation (J05-2); none exists.
9. **Resident digest restart test has no lane (D-8). Documented and run in round 5** (passed);
   it is still in no workflow, which is the CI owner's decision. Original order: `npm run agent:test-digest-restart`
   needs `ALPHA_ELIZA_SOURCE` with dependencies and is run by nothing. Document the exact
   preparation in `docs/verification.md`, run it once at this source and record the
   result; add it to a workflow only through the CI owner.
10. **Trash-full refusal (B-10).** *Done in round 5 (see the B-10 row for the wording on the merged source).* Case in `notes-trash.spec.ts`: fill Trash to its limit,
    delete another note. Acceptance: "Trash is full. Empty Trash in Notes…" is shown, the
    note is not deleted and nothing is lost. (Notes Trash is the round-2 MVP-15 area.)
11. **Malicious attachment (J03-8).** *Done in round 5.* Provider-fixture case with an HTML attachment
    containing a script and an oversized attachment. Acceptance: the review shows inert
    text or refuses, Save to Files stores exact bytes, nothing executes and no request
    leaves the page.
12. **Mailbox mutation coverage (F-12, F-13).** *Done in round 5; undo exists and is tested.* A page-two response under a changed
    mailbox revision reloads the list instead of mixing pages; provider Trash is a
    reviewed operation; undo either exists and is tested or is recorded under A-15.
13. **Travel-mode state for assistive technology (J04-10).** *Done on `main` (round 4 hand-offs).* `aria-pressed` on the four
    mode buttons in `template.html` and an assertion in journey J04. Belongs to the
    accessibility package.
14. **Journey hardening.** *Done in round 5, with product changes where the step did not hold (see "Round 5 changes").* A: a spoken request and a declined proposal. C: press Decline;
    assert snooze and dismiss requests on the stubbed Android path. D: assert the rendered
    Home card. E: navigation during approval. None of these changes product code.
15. **`scripts/test-clock-handoff-flow.ts` is referenced by no npm script, workflow or
    document.** Wire it into `npm test` or remove it. **Not an orphan (round 5):** it is one
    of the scripts `test/adapter-contracts.test.mjs` runs, so `npm test` already runs it as
    "adapter contract: test-clock-handoff-flow.ts". It tests the current
    `clock-adapter.ts` against a controlled native boundary and passes. Nothing to wire or
    remove.

## EMULATOR and CI campaigns

Round 7 ran campaigns 1 to 14 on developer-override APKs; results and the steps they closed are
in [verification](verification.md) ("Emulator results at 6dcdde34") and the per-loop tables.
Campaign 1's default list no longer contains HostedProcessRestart (it needs `--test-mocks` and
runs in the runner's secondary-user phase), campaign 2's reading classes need `--test-mocks` and
an isolated-world WebView, and campaign 3 needs an API 35 image. Round 8 ran campaign 1 (flag-off pair), campaign 2 (with BrowserReadingNavigation failing for want of that WebView), 7, 11 and 15 and parts of 6 (`notes`, `inbox`, and `document` on standalone) and 9 (`channels`) at pin `13c98575987a` ([verification](verification.md), "Emulator results at 2961bd9e"); campaigns 3, 4, 5, 8, 10, 12, 13, 14 and 16 were not run there. CI-1 to CI-4 have no result: no hosted job has been dispatched.
`npm run android:build -- --test-mocks` for the test-mocks pair. Use an owned, disposable
emulator; this host can run arm64 images only.

Round 8 changed rows 1, 4 and 7 and added rows 15, 16 and CI-2 to CI-4. The package that wrote
them (`claude/r8-runner-ci`) ran nothing on an emulator and dispatched nothing: the runner changes are checked against synthetic `adb`
fixtures (`test/calendar-regression-runner.test.mjs`, `test/native-campaign-evidence.test.mjs`,
`test/developer-archive.test.mjs`, `test/ci-emulator-evidence.test.mjs`) and the Java was compiled
for both flavors with and without test mocks. Three intermittent failures and the
CalendarTruncation failure of round 7 have a named cause and a fix; "Repeat runs" below gives the
commands that would show each fix holds, and what the integration's emulator run then showed.

| # | Closes | Command |
| --- | --- | --- |
| 1 | A-29, E-3 | `npm run test:android:instrumentation -- --owned-emulator --avd <avd> --serial emulator-NNNN` (default classes: NoMockProduct, Shell, StartupReadiness, TextScale, BrowserSignins, BrowserFlow, BrowserContinuity; HostedProcessRestart left the defaults in round 7 and BrowserDownload in round 8, because neither can run on a build without test mocks and a skipped class fails the run: both are in campaign 4, which is where E-5 gets its result). Hosted equivalent: CI-3 |
| 2 | B-9 backstop, B-10 native, C-3, E-8 (navigation class), E-16, F-7, F-15 (reminder half), J01-10 | `npm run test:android:instrumentation -- --owned-emulator --avd <avd> --serial emulator-NNNN --classes LocalAgentOfflineApps,NotesTrashBackstop,NotesStorageDurability,DailyApps,ReminderLifecycle,ClockHandoff,ClockRepeatDays,HostedResultNotice,WorkflowApprovalNotice,BrowserReadingNavigation,PasswordBrowserFill,InboxOperationJournal,MailAttachment,Notifications,CameraScan` (entries added in this audit; first run. LauncherHome moved to campaign 11; HostedResultNotice runs only its builder method here, its notices are campaigns 9 and 13) |
| 3 | C-4 | `npm run test:android:instrumentation -- --owned-emulator --avd <avd> --serial emulator-NNNN --classes RealClock --clock-exclusive` (the image must have a Clock app) |
| 4 | E-4, E-5, E-14, A-30, and on a test-mocks app build only D-14, E-8, E-9, F-15 (hosted half) | `npm run test:android:instrumentation -- --owned-emulator --avd <avd> --serial emulator-NNNN --test-mocks --classes BrowserAutofill,BrowserDownload,BrowserFlow,ConnectionChooser,HostedProcessRestart,HostedBackgroundWorker,BrowserReading,BrowserSensitiveReading,BrowserIsolatedReading` (the hosted and reading classes use loopback HTTP fixtures that only a test-mocks app build admits, so the runner refuses them without `--test-mocks`; the two hosted classes run in a disposable secondary user the runner creates and removes) |
| 5 | E-10, E-11 | `ANDROID_SERIAL=emulator-NNNN ALPHA_NATIVE_TEST_AVD=<avd> ALPHA_NATIVE_TEST_ABI=arm64-v8a ALPHA_TEST_HOME_PACKAGE=<stock launcher> node scripts/test-native-restart.ts signin APP.apk TEST.apk NEW_OUTPUT` (case added in this audit; the page is `https://example.com`, so the emulator needs network) |
| 6 | B-12, F-7, J03-7 | same environment: `node scripts/test-native-restart.ts notes APP.apk TEST.apk NEW_OUTPUT`, then `inbox`, then `document` |
| 7 | B-15, J01-6, and the CalendarCrud half of B-25 and J01-7 | `ALPHA_CALENDAR_TEST_SERIAL=emulator-NNNN ALPHA_CALENDAR_TEST_AVD=<avd> ALPHA_CALENDAR_TEST_ABI=arm64-v8a node scripts/test-calendar-regression.ts --case=CalendarCrudInstrumentedTest`, then `--case=CalendarAgentCrudInstrumentedTest`. Since round 8 the second command runs two cases, each in its own secondary user and result folder: `reviewedNativeCreateReadUpdateDeleteAndStaleRevision` (gate `calendarAgent`) and `directSaveReadsBackAllDayChosenZoneAndRrule` (gate `calendarOptions=1`, J01-6; `--case='CalendarAgentCrudInstrumentedTest#directSaveReadsBackAllDayChosenZoneAndRrule'` runs it alone). Also new there: `--case=CalendarAvailabilityInstrumentedTest` (four methods, both calendar permissions granted first; MVP-12, no core-loop step) and, after the product fix below, `--case=CalendarTruncationInstrumentedTest` |
| 8 | B-20, B-22, F-15 | `node scripts/test-reminder-one-off.ts APP.apk TEST.apk NEW_OUTPUT`; `node scripts/test-reminder-recovery.ts APP.apk TEST.apk NEW_OUTPUT` (reboots the emulator) |
| 9 | B-26, F-17 | `node scripts/test-native-permissions.ts channels APP.apk TEST.apk NEW_OUTPUT`, then `notice-denied` (round 5) with a new output directory |
| 10 | J05-2 | `npm run test:android:instrumentation -- --owned-emulator --avd <avd> --serial emulator-NNNN --classes BrowserPageQuestion` (round 5; the emulator needs network for the first tab and a WebView provider with isolated-world injection, as the BrowserReading classes do) |
| 11 | A-1 | `npm run test:android:instrumentation -- --owned-emulator --avd <avd> --serial emulator-NNNN --variants launcher --home-role --classes SettingsRoles,LauncherHome` (round 5; changes and restores the emulator's HOME role, primary user only; a failed restoration leaves the packages installed and writes `home-role-recovery.json`) |
| 12 | A-6 | `node scripts/test-native-permissions.ts voice APP.apk TEST.apk NEW_OUTPUT`, then `voice-revoke` with a new output directory (round 5; same environment as campaign 5; `voice-revoke` records a few seconds from the emulator microphone and discards them) |
| 13 | F-15 (posted notice) | `node scripts/test-native-permissions.ts notice APP.apk TEST.apk NEW_OUTPUT` (round 5; the posted, redacted and tapped result notice needs POST_NOTIFICATIONS granted first, which the plain runner cannot do) |
| 14 | B-12 | `npm run test:android:instrumentation -- --owned-emulator --avd <avd> --serial emulator-NNNN --classes NotesSecureStorage` (round 5 registry entry) |
| 15 | the WorkflowPhoneNative half of B-25 and J01-7 | `node scripts/developer-archive.ts test-results/<new-archive>` (round 8: copies the verified developer APK pairs of `artifacts/` under the names the campaign reads, with their hashes; `scripts/build-archive.ts` needs the strict build), then `ANDROID_SERIAL=emulator-NNNN ALPHA_WORKFLOW_TEST_AVD=<avd> ALPHA_WORKFLOW_TEST_ABI=arm64-v8a ALPHA_BUILD_ARCHIVE=test-results/<new-archive> ALPHA_CAMPAIGN_OUTPUT=test-results/<new-output> node scripts/android-workflow-native.ts`. Fourteen cases, seven per distribution, each in a fresh secondary user: four WorkflowPhoneNative methods (three with Calendar granted and gate `workflowPhoneNative`; `deniedCalendarGrantReturnsNoEvents` with both permissions revoked and gate `workflowPhoneDenied`), WorkflowDraftNative, and two WorkflowApprovalNotice methods. The first failure stops the run; `--variant=standalone\|launcher` and `--phase=workflow\|approval-notice` (round 8) run the rest, and such a run records `selectionPassed`, never `passed` |
| 16 | B-7, arm64-v8a half, only if A-24 keeps on-device speech | Retired with the Sherpa engine (P-42). Re-run B-7 on an owned arm64 emulator against the libelizainference voice host with `FusedSpeechInstrumentedTest` (`--classes FusedSpeech`), once a voice bundle is staged ([fused speech](fused-speech.md)); its ASR methods skip until a qualified ASR pair exists |
| CI-1 | A-23, A-27, C-7, D-15, F-16 | `gh workflow run resident-android.yml --ref <branch>` (the workflow takes no inputs; one dispatch runs `build`, then `native` and `recovery-ui` in parallel on the dispatched commit). Job `native` (`scripts/ci/resident-native.py`: PrivateResidentSocket, ResidentStreamTransport, two ResidentWorkflowCrash methods) is A-23. Job `recovery-ui` (`scripts/ci/pending-recovery-ui.py`, 16 methods) is A-27 (three ConnectionInstrumentedTest methods), C-7 (ClockAgentReview), D-15 (WorkflowNoticeProcessDeath) and F-16 (ReminderTapProcessDeath, WorkflowNoticeProcessDeath). Per-step table below. No passing run of either job is recorded. Subject to [CI cost policy](ci-cost-policy.md); not dispatched in round 8. |
| CI-2 | E-8, E-9, J05-2 | `gh workflow run android-emulator.yml --ref <branch> -f suite=browser-reading` (round 8). Job `browser-reading`: API 35 x86_64 image with the pinned Chromium 157.0.8083.0 WebView installed by `scripts/prepare-ci-webview.ts`, then BrowserReadingNavigation and BrowserPageQuestion on the flag-off pair and BrowserReading, BrowserSensitiveReading and BrowserIsolatedReading on the test-mocks pair. Whether that provider reports isolated-world injection at run time is what the run shows; version numbers do not establish it. Not dispatched. |
| CI-3 | A-29 and E-3 again, off this machine | `gh workflow run android-emulator.yml --ref <branch> -f suite=instrumentation` (round 8). Job `instrumentation`: campaign 1 on both distributions on a hosted API 35 x86_64 emulator. BrowserFlow's live-search method needs `www.google.com/search` from the runner. Not dispatched. |
| CI-4 | B-7, x86_64 half, only if A-24 keeps on-device speech | Retired with the Sherpa engine (P-42). Needs a qualified x86_64 libelizainference voice host and the Android voice-host emulator suite first ([fused speech](fused-speech.md)). Not dispatched. |

`-f suite=all` runs CI-2, CI-3 and CI-4 after one build.

The five CI steps, one by one. Each needs the same dispatch; the job, the method and the file
that holds the result differ. `RUN_ID` is the run the dispatch created
(`gh run list --workflow resident-android.yml --branch <branch> --limit 1`).

| Step | Command | Job and method | Evidence to read |
| --- | --- | --- | --- |
| A-23 | `gh workflow run resident-android.yml --ref <branch>` | `native`: `PrivateResidentSocketInstrumentedTest#ordinaryOtherUidCannotReachPrivateEndpoint`, `ResidentStreamTransportInstrumentedTest#splitFramesCancellationAndNoReplay`, `ResidentWorkflowCrashInstrumentedTest#trustedPackagedWorkerSurvivesResidentRestart` and `#lostParentModelRpcRemainsUnknownWithoutReplay`, both distributions, x86_64 | `gh run download RUN_ID -n resident-native-evidence-RUN_ID`, then `test-results/resident-ci-native/result.json` (`passed`, `variants`) and the per-phase logs beside it. `CombinedAgentRestartInstrumentedTest` is not part of it |
| A-27 | same dispatch | `recovery-ui`: `ConnectionInstrumentedTest#reservedNativeSlotsRejectEveryPublicStorageOperation`, `#encryptedCredentialsAndHttpSurviveRecreationWithCancellationAndRedirectRejection`, `#enabledViewProfileHttpPreservesAuthenticationAndConditionalRevision` | `gh run download RUN_ID -n pending-recovery-ui-evidence-RUN_ID`, then `test-results/pending-recovery-ui-native/result.json` (`passed`, `methods: 16`) |
| C-7 | same dispatch | `recovery-ui`: `ClockAgentReviewInstrumentedTest#journalBoundOwnerReviewManualSelectionCancellationAndRecreation` | same artifact and file |
| D-15 | same dispatch | `recovery-ui`: `WorkflowNoticeProcessDeathInstrumentedTest#originalNoticeLaunchesAbsentMainAfterOrdinaryProcessDeath` | same artifact and file |
| F-16 | same dispatch | `recovery-ui`: `ReminderTapProcessDeathInstrumentedTest#capturedReminderTapSurvivesMainDeathWithoutAnotherNotificationIntent` and the D-15 method | same artifact and file |

Both jobs write `result.json` only when every method of every phase passed on both
distributions, so a missing file is a failed run. The dispatch builds the PACKAGED archive
first (the `build` job is limited to 180 minutes, `native` to 100 and `recovery-ui` to 55; no
duration of a passing run is recorded); artifacts expire after three days.

### Repeat runs for the round 7 failures (round 8)

Each fix was written from the saved result files and the source and compiled. The round 8
integration then ran each on developer APKs ([verification](verification.md), "Emulator results
at 2961bd9e"), fewer times than the table asks: CalendarTruncation passed on both flavors (its
first launcher run), so the product fix holds on that image; PasswordBrowserFill passed 4 of 4
on standalone and 1 of 1 on launcher; the launcher `notes` restart passed 3 of 3 and standalone
1 of 1; FilesTree passed 4 of 4 on standalone and 1 of 1 on launcher. None of the three
intermittent failures recurred, and none was repeated ten times or deliberately under a
second build's load, so the races are not shown closed. A repeat run that passes every time is
what would show the race is closed. `ENV` is
`ANDROID_SERIAL=emulator-NNNN ALPHA_NATIVE_TEST_AVD=<avd> ALPHA_NATIVE_TEST_ABI=arm64-v8a ALPHA_TEST_HOME_PACKAGE=<stock launcher>`.

| Failure in round 7 | Cause | Fix | Repeat command and what it must show |
| --- | --- | --- | --- |
| CalendarTruncation, standalone, first run: "Calendar results incomplete" never appears | Product. Since the shared calendar plugin was adopted (`ab780d04`) `AlphaCalendar.list` returned every instance and always `truncated:false`; the product's own 2,000-instance bound was lost with its old method | `AlphaCalendarPlugin.list` reads through `CalendarRangeReader` again: 2,000 instances, and `truncated` when the provider held more. The test is unchanged | `ALPHA_CALENDAR_TEST_SERIAL=emulator-NNNN ALPHA_CALENDAR_TEST_AVD=<avd> ALPHA_CALENDAR_TEST_ABI=arm64-v8a node scripts/test-calendar-regression.ts --case=CalendarTruncationInstrumentedTest`: `passed: true` in `standalone-…/result.json` and `launcher-…/result.json` (first launcher run of this class) |
| PasswordBrowserFill, standalone, once in four: "Synthetic form tap stays inside the visible browser" | Test. After the keyboard opens the activity is padded first (the page is clipped), the host renderer resizes the native page on a 100 ms timer, and the page's document learns its height last; the field's rectangle was read in between | Taps wait until the page is wholly visible, its document height is the view's and the same point is read twice; the original check still runs immediately before the touch | `for i in 1 2 3 4 5 6 7 8 9 10; do npm run test:android:instrumentation -- --owned-emulator --avd <avd> --serial emulator-NNNN --variants standalone --classes PasswordBrowserFill --output test-results/android-instrumentation/r8-pbf-$i \|\| break; done`: ten `PASSED` lines. Run it once more under host load (a Gradle build beside it), since that is when the race was seen |
| `test-native-restart.ts notes`, launcher, once: timed out waiting for "Export saved and exact bytes verified." | Test and product. The receipt is a 1.9 s notice and the test read the page for it afterwards; the failed run's cleanup found the exported bytes verified. Android also returns the picker result before the app is shown again, so the 1.9 s could run while the page was hidden | The test records the rendered notice with an observer installed before the export. Document receipts now wait until the document is visible (`notes-document-adapter.ts`, `test/browser/notes-document-receipt.spec.ts`) | `for i in 1 2 3 4 5 6 7 8 9 10; do ENV node scripts/test-native-restart.ts notes artifacts/launcher-debug.apk artifacts/instrumentation/launcher-androidTest.apk test-results/r8-notes-launcher-$i \|\| break; done`: ten runs with `"passed": true` in `result.json` |
| FilesTree, standalone, twice under load: "Open Renamed destination" never appears, no dialog | Test. The rename dialog closes before the listing that follows has returned, and the adapter ignores Back while that listing is in flight; Back was dropped | The test waits for the folder title, which changes only when the listing is applied. The same wait precedes the rename menu and the revocation step | `for i in 1 2 3 4 5 6 7 8 9 10; do npm run test:android:instrumentation -- --owned-emulator --avd <avd> --serial emulator-NNNN --variants standalone --classes FilesTree --output test-results/android-instrumentation/r8-filestree-$i \|\| break; done`: ten `PASSED` lines, at least some under host load | Historical command retained from the round-8 plan. FilesTree has since retired; current volume coverage uses StorageCategories.

Observed while reading the Files adapter and left as it is: a tap on Back, Refresh or a row while
a folder operation is in flight is ignored without feedback. The controls are not disabled
during that time.


## HUMAN, DEVICE and UPSTREAM blockers

| Blocker | Steps | What the owner must do |
| --- | --- | --- |
| A-02 managed endpoint and pairing | A-8, A-11, A-25 | Provide a designated Eliza Cloud test account and sign in on a flag-off Android build; decide whether remote pairing remains a route on Android (it is retired today). |
| A-16 Cloud agent onboarding on Android | A-9, A-10 | Choose (a), (b) or (c). Journey A step 2 of the completion plan (select an existing agent, provision a new one) is unreachable on Android until this is decided; (a) would need the plan amended. |
| Inference credential (runbook "Cerebras key provisioning"; A-20) | A-14, B-14, D-19, J05-9 | Issue a pilot Cerebras key or fund the test Cloud account. For the resident campaign, place the key in the owner-only file `~/.config/alphaphone/cerebras-key` on a host with an arm64 emulator, then run `ALPHA_RESIDENT_DISPOSABLE_EMULATOR=1 ANDROID_SERIAL=emulator-NNNN node scripts/android-resident-instrumentation.ts <app.apk> <androidTest.apk>`. |
| A-04 voice provider and processing location, with A-24 | B-3, B-7 | Confirm Cloud speech as the product route (P-07 already makes it the default) and say whether on-device speech is still required (A-24). If it is, B-7 needs the hosted x86_64 run (CI-4), the arm64-v8a run of the same candidate (campaign 16) and a named reviewer's admission; none of the three has happened for a candidate at the current pin. |
| A-09 powered-off scheduling | D-5 | Choose (a) amend the DoD to resident missed-occurrence recovery, or (b) fund hosted loops. Journey D as written in the completion plan cannot pass under (a) without the amendment. |
| A-11 alarm ownership | C-8, C-15 | Choose (a), (b) or (c). Under (a) the image must ship a Clock app and C-4 is the acceptance run. |
| Gmail grant (A-07, A-15; runbook "Gmail OAuth") | D-4, F-1, F-14, J03-2 | An operator with access to the deployed Eliza Cloud Worker must find why the Google code exchange returns 401 (the client secret binding is the documented hypothesis) and fix it; then authorize a designated test Google account, choose the A-15 scope set, and authorize one exact recipient and message for a live send. |
| A-05 background notification policy | F-21 | Choose (a), (b) or (c); new-mail notifications are not implemented until then. |
| A-12 passkeys | E-19 | Choose (a), (b) or (c). |
| A-06 signing | E-20 | Name the signing owner and produce the release key; nothing can be qualified on a release-signed device before that. |
| Password provider account (runbook "Password provider real-site filling") | E-18 | Provide a Proton Pass test vault with synthetic credentials on a signed build. |
| Maps provider (A-23, recorded in the October 10 ledger refresh) | J04-6 | Choose the production Maps provider and its licence, then supply `VITE_MAPS_BASE_URL` for an HTTPS gateway. Until then J04 ends at an honest unavailable state for every production user. |
| A-01 phone and image | A-2, A-7 and every DEVICE row | Choose the SKU; build and boot the image. |

DEVICE rows (13): A-2, A-7, A-21, A-31, B-2, B-6, C-5, C-9, C-12, D-20, E-17, J01-2,
J04-9, plus the device halves of the runbook rows they belong to. They need the four
pilot units and [the runbook](pilot-acceptance-runbook.md); none has been run.

UPSTREAM: none established as a blocked step. E-14's emulator runs passed (rounds 7 and 8).
If a run of B-7 fails inside the pinned runtime, report the exact change then; do not patch
`vendor/eliza`.

Round 5 established two elizaOS changes that would strengthen rows already classed
EVIDENCED. Neither is counted as an UPSTREAM step and neither was made:

- **B-13, Android review text.** `plugins/plugin-native-calendar` `CalendarPlugin.executeAgent`
  builds its dialog from the calendar display name, title, time, location and description.
  NEEDS upstream: add the account the calendar belongs to and a line stating that no
  attendees are added or changed and no invitations are sent (the plugin already refuses
  events with attendee data or an all-day flag in `CalendarEventGuard.direct`).
  Done upstream in elizaOS/eliza#35913, at the pin `bc71e21f3b`: the review reads "Calendar:
  On this phone", "Account: Alpha Phone (this phone only)" and, for a change, "No attendees are
  invited, changed or notified." `CalendarAgentCrudInstrumentedTest` checks those lines before
  it presses Create or Update (compiled, not run).
- **F-12, removed messages between pages.** The managed Gmail search response
  (`packages/cloud/shared/.../agent-google-connector`, route `gmail/search`) returns
  `messages`, `syncedAt` and `nextPageToken` only. NEEDS upstream: a mailbox revision
  (Gmail `historyId`) in each page, or a refusal of a cursor cut from an older revision, so
  the client can detect a row removed between pages instead of silently skipping one.
  Done upstream in elizaOS/eliza#35908 (`mailboxHistoryId` on each page), at the pin
  `bc71e21f3b`: the Inbox keeps the first page's revision and treats a later page with another
  one as a changed list (Load newer mail), even when no row repeats
  (`scripts/test-inbox-cloud-flow.ts`, class S). It needs a deployed Eliza Cloud that includes
  the change; an older server sends no revision and the repeat check alone applies.

## Changes made in this audit

| Change | Files | Test |
| --- | --- | --- |
| Flag-off journey assertions for every loop (11 tests): resident chat, Stop, automatic restore, context and identity; Clock handoff with and without a Clock app, cancelled review, unknown result across restart, time-zone change; phone-bound schedules; mail without a grant; local calendar and alarms; Maps without a provider; digests and mail signed out; browsing, page question and password page; poster to event; document question | `test/browser/journey-core-loops.production.spec.ts` | itself, `--project=production` |
| The instrumentation runner registered `PasswordAutofillOffer`, which is not a class in the app's instrumentation sources; the test-mocks class is `BrowserAutofill` | `scripts/android-instrumentation.ts`, `docs/verification.md` | `test/android-instrumentation-runner.test.mjs` (every registry entry must exist in the sources and read the gates the runner passes) |
| 21 core-loop classes had no runner entry, so a named run skipped their gated methods | `scripts/android-instrumentation.ts` | same test |
| `BrowserSigninsInstrumentedTest` documents a `signinPhase` restart run that no runner supplied (the P-04 sign-in persistence evidence) | `scripts/test-native-restart.ts`, `docs/verification.md` | same test file ("restart runner keeps the bookmark phase wired") |
| A mail receipt for another request was refused with the internal text "Unexpected operation receipt" and had no test | `apps/app/src/runtime/inbox-operation.ts` | `test/browser/journey-f-email-notifications.spec.ts` (new test) |
| Stale lines in the round-3 status: the "development Clock" is the browser build's Clock; the digest wording item was already fixed; automatic restore on Android | `docs/core-loop-status.md` | — |

None of the runner changes has been executed on an emulator.

## Round 5: native-runner gaps

Package `claude/r5-runner-gaps`, on top of this audit branch. It closes the runner-side
SOFTWARE work orders (7, 8, 9, 15): the gaps that stopped existing or needed Android
instrumentation from being runnable at all. It wrote and compiled; it ran no emulator and
built no APK, so every Android row it touched is EMULATOR with the command that now runs it,
never EVIDENCED. The one exception is D-8, a host test that was run here.

| Change | Files | Check |
| --- | --- | --- |
| `voice`, `voice-revoke`, `voice-limit`, `notice` and `notice-denied` permission scenarios. `voice-revoke` starts a real capture, revokes RECORD_AUDIO from outside and requires Android to end that process mid-test, then verifies in a new process and after a re-grant | `scripts/test-native-permissions.ts`, `VoicePermissionRevokeInstrumentedTest.java` (new), `VoicePermissionDeniedInstrumentedTest.java`, `HostedResultNoticeInstrumentedTest.java` | `test/native-permission-runner.test.mjs` runs the real script against a scripted adb: order of grant, phases and revoke; one run id; no force-stop standing in for the kill; a surviving process, a stale marker, an early exit and a completed test all refused |
| `--home-role` phase: admit one stock HOME holder, run role-requesting classes, select the launcher APK, cold-start it with the HOME key, run HOME classes, restore and read back the original before uninstalling; keep the installation and write a recovery file if that cannot be proven | `scripts/android-instrumentation.ts`, `scripts/instrumentation-result.ts`, `LauncherHomeInstrumentedTest.java` (two new methods) | `test/android-instrumentation-runner.test.mjs`: exact command order, unproven restoration, failed selection, failed cold start, a class that leaves HOME changed, admission refusals |
| `BrowserPageQuestionInstrumentedTest`: native page excerpt to reviewed question (J05-2) | new class, registry entry | compiled for both flavors and with test mocks; registry-vs-source test |
| Registry entries for 39 more classes (ConnectionChooser and eight other test-mocks-build classes, twelve gated self-contained classes, seventeen ungated ones, SettingsRoles), three campaign refusals, and HostedResultNotice no longer passes a gate the plain runner cannot satisfy | `scripts/android-instrumentation.ts` | same test |
| Reachability check: every `@Test` class is in the registry, named by a campaign runner, or listed in `NOT_RUN_BY_A_RUNNER` (25 classes) with its reason; stale allowlist entries fail too | `scripts/android-instrumentation.ts`, `test/android-instrumentation-runner.test.mjs` | itself |
| Digest restart check: default prepared directory, exit 2 with the exact preparation when the input is missing, host-runtime labels in its result; preparation documented; run | `scripts/test-local-digest-restart.ts`, `docs/local-agent-development.md`, `test/digest-restart-input.test.mjs` | the run itself (below) |

### Every SOFTWARE row, accounted for

| Row | Where its fix lives | Status after round 5 |
| --- | --- | --- |
| A-6 | permission runner and androidTest | Done: EMULATOR, campaign 12. |
| D-8 | `scripts/test-local-digest-restart.ts` and docs | Done and run: EVIDENCED as host-runtime evidence. Still in no workflow (CI owner). |
| B-10 | `test/browser/notes-trash-full.spec.ts` (renderer); the native half, NotesStorageDurability, was registered in round 4 | Done in the loop package: EVIDENCED. |
| B-13 | `journey-b-voice-note-actions.spec.ts`, `browser/calendar-agent-review.ts` | Done in the loop package: EVIDENCED. |
| B-28 | `voice-adapter.ts`, `note-origin-adapter.ts`, `template.html` | Done on `main` (round 4 hand-offs): EVIDENCED. |
| F-5, F-10, F-12, F-13, F-20 | Inbox renderer and its Playwright specs | F-5, F-10, F-12 and F-13 done in the loop package, F-20 on `main` (round 4 hand-offs): EVIDENCED. |
| J03-8 | `inbox-hostile-attachment.spec.ts` | Done in the loop package: EVIDENCED. |
| J04-7, J04-10 | `maps-adapter.ts`, `template.html` | Done on `main` (round 4 hand-offs): EVIDENCED. |

When the runner package was written, none of the eleven SOFTWARE rows it left had a fix in `android/app/src/androidTest`,
`android/app/src/testMocks` or the runner scripts (the `test-*` and `android-*` files under `scripts`).

EMULATOR rows whose text named a runner gap, and what happened to it:

| Row | Gap named by the audit | Now |
| --- | --- | --- |
| A-1 | LauncherHome skips; the runner does not select HOME | `--home-role` phase, campaign 11. |
| A-30 | ConnectionChooser has no runner entry | Registered; campaign 4. |
| B-12 | NotesSecureStorage has no runner | Registered with its gate; campaign 14. Its legacy-layout migration has the `notes-secure-migration` restart phase (not yet run). |
| F-17 | No runner supplies `hostedNoticeDenied=1` | `notice-denied`, campaign 9. |
| F-15 | (found here) the registry passed `hostedNotice=1`, but the posted-notice method asserts notifications are enabled, which a plain install never has; it would have failed | `notice`, campaign 13; the plain runner now runs only the builder method. |
| J05-2 | No test exists | Written; campaign 10. Stops at Send. |
| A-16 | AllViewAgentContext has no runner | None added: it needs a real agent with inference on the host. Listed in `NOT_RUN_BY_A_RUNNER`. |
| B-14 | LiveAgent has no runner | None added: real provider key. Listed. |
| A-23 | CombinedAgentRestart never run (it is compiled with the androidTest source) | None added: combined host runtime with a provider key. Listed. |
| MVP-18 | WorkflowLegacyReminderUpgrade lacks runner coverage | None added: it belongs to the installed-upgrade campaign, which does not name it. Listed. |

### What is still not covered

- J05-2 after Send: the agent's answer and the "Review summary note" save. A distribution
  build on an emulator has no agent, the test-mocks emulator transport produces no summary
  card (it has no connection session), and the remaining routes need the real app host or
  resident runtime with a provider key (HUMAN). A synthetic app-host fixture on the host
  machine, checked against the browser build, would close it and was not built.
- `SettingsCrashLog` needs a two-phase crash runner, and `NotesSecureStorage`'s migration
  method a fresh-install campaign. Neither is a core-loop step. (Round 5 history: both now have
  campaigns, listed below.)

Classes and phases added in the MVP completion integration (2026-10-12). Each is compiled into
both instrumentation APKs or wired into a runner; none has run on an emulator:

- `RendererRecovery`: `npm run test:android:instrumentation -- --owned-emulator --avd <avd> --serial emulator-NNNN --classes RendererRecovery`; `LauncherHome` repeats it while Alpha is HOME (`--variants launcher --home-role --classes LauncherHome`).
- `ConnectionRoutes` (flag-off pair only): `--classes ConnectionRoutes`.
- `ChatContinuity` (soft keyboard, Back and HOME): `--classes ChatContinuity`.
- `SelectedDocument` source-reference phase: `node scripts/test-native-restart.ts document APP.apk TEST.apk NEW_OUTPUT`.
- `PasswordVaultSettings`, `PasswordVaultFill` (E-14): `--classes PasswordVaultSettings,PasswordVaultFill` on an owned emulator with no screen lock of its own.
- `PosterCalendarJourney` (J01): no runner takes it since the view refresh (59badc34ca) removed the Camera Scan mode and picker it drives; it is listed in NOT_RUN_BY_A_RUNNER until it is rewritten to the agent scan path. J01 has no runnable native test meanwhile.
- `JourneyJ05` (J05-2, flag-off pair, isolated-world WebView): `--classes JourneyJ05`.
- `NoteOrigin` (B-28, storage level): `--classes NoteOrigin`.
- `Maps` event return (J04): `--classes Maps`.
- `HomeCalendarCard`: `node scripts/test-calendar-regression.ts --case=HomeCalendarCardInstrumentedTest`.
- `NotesSecureStorage` legacy migration across a restart: `node scripts/test-native-restart.ts notes-secure-migration APP.apk TEST.apk NEW_OUTPUT`.
- `SettingsFlow` theme restart: `node scripts/test-native-restart.ts theme APP.apk TEST.apk NEW_OUTPUT`.
- `SettingsCrashLog`: `node scripts/test-native-restart.ts crash-log APP.apk TEST.apk NEW_OUTPUT`.
- `WorkflowLegacyReminderUpgrade`: `node scripts/test-installed-upgrade.ts` (after the candidate verify phase).
- `WorkflowNoticeProcessDeath` approval phase: `scripts/ci/pending-recovery-ui.py` phase `workflow-approval-process-death` (hosted runner only).
- `BrowserFlow` live search: `--live-network --classes BrowserFlow` (the default run is now offline).
- The six reviewed-workflow host classes (`Workflow`, `WorkflowApproval`, `WorkflowCancellation`, `WorkflowLifecycle`, `WorkflowMetadata`, `WorkflowSubmission`) were deleted in `8452394f`: their runners were gone and they could not run.
- Twenty-five classes in `NOT_RUN_BY_A_RUNNER` are unreachable from this repository for the
  reasons listed there; most lost their runners when the smoke suites were removed in
  `49b1bf4c` and need a host agent or a provider key.

### Commands run in round 5

| Command | Result |
| --- | --- |
| `ALPHA_RUNTIME_GIT_CACHE=$PWD/vendor/eliza npm run agent:prepare` | exit 0: `artifacts/local-agent-resident-352d7a08…` with dependencies, 5.8 GB (removed afterwards) |
| `ALPHA_ELIZA_SOURCE=$PWD/artifacts/local-agent-resident-352d7a08… npm run agent:test-digest-restart`, then `npm run agent:test-digest-restart` with the default directory | exit 0 both times (D-8; host-runtime evidence, not Android) |
| `node --test test/native-permission-runner.test.mjs test/android-instrumentation-runner.test.mjs test/digest-restart-input.test.mjs test/native-restart-runner.test.mjs test/native-campaign-evidence.test.mjs` | 77 passed |
| `./gradlew :app:compileStandaloneDebugJavaWithJavac :app:compileLauncherDebugJavaWithJavac :app:compileStandaloneDebugAndroidTestJavaWithJavac :app:compileLauncherDebugAndroidTestJavaWithJavac -x :local-speech:preBuild -x :app:stageLocalAgentSources -PELIZA_ALLOW_UNPACKAGED_RUNTIME=1 --offline` with `-PELIZA_DEV_ALLOW_TEST_MOCKS=0`, then `=1` (JDK 21, staged sources, compile-only speech AAR) | BUILD SUCCESSFUL both times. Compilation only: no APK was assembled and nothing ran on an emulator |
| `npm run verify` | exit 0: 515 tests, 511 passed, 0 failed, 4 TODO; bundle audit passed (395 files, testMocks=false), with the standing Denton licence release blocker (A-21) printed |

## Stale ledger statements

For the package that refreshes the ledgers. Each was checked against this branch. (Round 5 history. Every row below was corrected in the ledger refreshes of October 10 and 11 or in the MVP completion integration of October 12, including the AP-05 and AP-07 rows; the table is kept as the record of what was found.)

| File | Says | True at this source |
| --- | --- | --- |
| `docs/mvp-current-status.md` line 61 | Home has no all-apps drawer or search and cannot open third-party apps; landscape layout is not implemented | The drawer and search exist (`apps/app/src/prototype/home-launcher.ts`, `home-launcher.spec.ts`, `home-native-launcher.spec.ts`); a landscape layout exists and is tested (`home-landscape.spec.ts`, `RotationInstrumentedTest`). |
| `docs/mvp-current-status.md` lines 18 and 147–149 | "Current verification passes 454 tests", attributed to `d3dc9977` / upstream `945209d3` | That commit is 55 behind this branch and has a different upstream pin (`352d7a08` now). The count cannot describe this source; see "Commands run" for the current result. |
| `docs/mvp-current-status.md` line 82 | APK builds passed "at reviewed pin `945209d3`" | That pin is retired. When this table was written (round 5, pin `352d7a08`) no APK build was recorded at the pin. Since then developer APK builds without the resident runtime (not distributable) are recorded at `40dbe96bd1` and at the previous pin `13c9857598`; see [current status](mvp-current-status.md). No distribution APK build is recorded at any of them. |
| `docs/mvp-current-status.md` line 99 | AP-05 next gate is "S: composer draft survives every pre-dispatch failure" | Line 64 of the same file records it as implemented and tested (`chat-continuity.spec.ts`). |
| `docs/mvp-current-status.md` lines 139–162 | Evidence section | Does not mention the journey specs, `docs/core-loop-status.md`, or `npm run test:android:instrumentation`. |
| `docs/requirements.json` AP-01 | "Home has no all-apps drawer or search" | False; as above. |
| `docs/requirements.json` AP-02, AP-09 | The Android build fails at the pinned calendar plugin | Contradicts current status line 82. Not rebuilt here; one of the two is wrong. |
| `docs/requirements.json` AP-05 | Gate "S: composer draft survives every pre-dispatch failure" | Already met; the same entry lists `chat-continuity.spec.ts`. |
| `docs/requirements.json` AP-10 | "Native camera lacks image import and the multi-page scan builder" | Both are wired for native (`camera-adapter.ts`, `scan-document.ts`). Device behaviour is unverified. |
| `docs/requirements.json` AP-12 | "Quick-setting tiles show no native state and open generic Android Settings" | False: `AlphaDevicePlugin.java`, `settings-truth.production.spec.ts`, `test/shade-tile-facts.test.mjs`. |
| `docs/requirements.json` AP-15 | "No landscape layout" | False; as above. |
| `docs/requirements.json` AP-07 | Evidence lists only `dev-digest-schedule.spec.ts` | The missed-record coverage is also in `journey-d-digests.spec.ts` and `test/digest-occurrence-delivery.test.mjs`. |
| `docs/mvp-remaining-work-2026-10-09.md` line 7 and `.json` `upstream_pin` | Upstream pin `0d40aa6e…` | `upstream.lock.json` records `352d7a0855…`; MVP-08 in the same file says so. |
| same, MVP-07 | Current status "still describes no offline entry, no browser transport and early draft consumption" and cites patch 0039 | Only "no drawer" is still in the status file. |
| same, MVP-09 | Remove each patch when its replacement is consumed | The patch tooling and applied patches were removed in `9475074c`; only the unshipped `0060-password-transfer.patch` reference remains. |
| same, MVP-18 and MVP-20 | Workflow notice and launcher classes lack runner coverage | Still true for `WorkflowLegacyReminderUpgrade`. `WorkflowApprovalNotice` and `LauncherHome` now have registry entries (this audit), with no run. |
| same, MVP-38 | "Implement … resident missed-run recovery" | The explicit missed record is implemented and tested. A-09 itself is still open. |
| same, MVP-45, MVP-46 | Dependency paths, SBOM and ruleset read-back remain to do | `docs/dependency-audit.md`, `scripts/generate-sbom.ts`, `scripts/ci/read-required-checks.ts` and their tests exist and are not cited. |
| same, MVP-49 | J01–J05 "have source-level pieces" | Each has an end-to-end browser journey (class S) and a flag-off assertion. |
| same, MVP-50, MVP-51 | No provisioning or update tooling mentioned | `scripts/provision-unit.ts` and `scripts/pilot-update.ts` exist; rollback is still not offered. |
| `docs/decisions.md` A-22 | "the layout is portrait-only" | A landscape layout exists. |
| `docs/ci-cost-policy.md`, `README.md` | Emulator CI jobs were removed on October 8 | `.github/workflows/resident-android.yml` still has two emulator jobs (`native`, `recovery-ui`), inert unless dispatched or enabled by a repository variable. |
| `android/.../BrowserSigninsInstrumentedTest.java` comment | The restart phases run through `scripts/test-native-restart.ts` | True only since this audit. |
| `docs/core-loop-status.md` (round 3) | "development Clock"; digest wording open item | Corrected in this audit. |

## Commands run

| Command | Result |
| --- | --- |
| `npx playwright test test/browser/journey-{a,b,c,d,e,j01,j03,j04,j05}-*.spec.ts --project=chromium --workers=2` | 11 passed |
| `npx playwright test test/browser/journey-f-email-notifications.spec.ts --project=chromium --workers=2` | 5 passed (one test added here) |
| `npx playwright test test/browser/journey-core-loops.production.spec.ts --project=production --workers=2` | 11 passed on a fresh flag-off build; bundle audit passed (395 files, testMocks=false) |
| `node --test test/android-instrumentation-runner.test.mjs` | 8 passed |
| `npm run verify` | exit 0: 497 tests, 493 passed, 0 failed, 4 TODO; bundle audit passed, with the standing Denton licence release blocker (A-21) printed |

Browser runs used `ALPHA_BROWSER_TEST_PORT=6843`. No APK build, emulator run or CI run was made.

## Round 5 changes

Branch `claude/r5-loop-software`, based on `claude/r4-audit`. Renderer and test work orders
2, 3, 4, 10, 11, 12 and 14. Class S only: no APK was built and no emulator was started.
Work orders 1, 5, 6 and 13 (F-20, B-28, J04-7, J04-10) belong to `claude/r4-handoffs`, and
7, 8, 9 and 15 (A-6, D-8 and the runner gaps) to the instrumentation-runner package; their
rows are unchanged here.

| Change | Files | Test |
| --- | --- | --- |
| The agent calendar review printed the operation type, raw UTC timestamps and a bare zone name. It states the calendar and account, the times in the event's zone, the zone against the phone's, the all-day state and attendees. The proposal card says which calendar is written and that no attendees are added | `apps/app/src/browser/calendar-agent-review.ts`, `calendar.ts`, `runtime/device-record-presentation.ts` | `test/calendar-agent-review.test.mjs`; journey B (two tests); `calendar-proposal-review.production.spec.ts` |
| Send after editing a reviewed email reopened the earlier review with its Send button. An unsent review that no longer matches the composer is discarded without dispatch | `prototype/inbox-provider-controls.ts`, `inbox-drafts.ts` (one added method), `inbox-cloud-adapter.ts` (one added line) | `journey-f-reviewed-send.spec.ts`; `mail-review.production.spec.ts` |
| A forward's original attachments were missing from the review ("No attachments."); attachment lines ran together | `inbox-provider-controls.ts`, `template.html` (one line) | `journey-f-reviewed-send.spec.ts` |
| A double tap on Confirm landed on the Undo control that replaced it (three taps trashed, reviewed the undo and confirmed it) | `inbox-provider-controls.ts` | `journey-f-reviewed-send.spec.ts` (F-13) |
| An unknown mailbox change was described as a message send; a confirmed undo left the restored message off the list | `inbox-provider-controls.ts`, `inbox-cloud-adapter.ts` | same |
| A later page repeating a loaded message was joined silently although it shows that newer mail is missing from the list; a failed later page did not say the loaded messages were kept. The list now says so and offers "Load newer mail" | `inbox-cloud-adapter.ts` | `journey-f-reviewed-send.spec.ts` (F-12); `scripts/test-inbox-cloud-flow.ts` still passes unchanged |
| "No preview · Save to Files" failed in the browser build with "Save not confirmed" because the save ran the previewable-type check | `apps/app/src/browser/mail-attachments.ts` | `inbox-hostile-attachment.spec.ts` |
| The development agent returned no message identities, so every spoken turn with the development profile stopped with "Check your connection and conversation history" | `apps/app/src/browser/development-connection.ts` | journey A (spoken request) |
| The development profile registered no Home brief source, so its Home never showed a brief | `apps/app/src/main.tsx` | journey D |
| Read aloud on a page whose address the host no longer knows was refused behind the open menu | `prototype/browser-adapter.ts` | journey E |
| A full Notes Trash had no test | — | `notes-trash-full.spec.ts` |
| Declined proposals, snooze and dismiss on the Android path | — | journeys A and C; `journey-core-loops.production.spec.ts` |

Not done in round 5, with the reason:

- The native Android review dialog for an agent calendar change (B-13) and a mailbox
  revision in search pages (F-12) need elizaOS changes; see the UPSTREAM note above.
- B-10 and D-17 were written before PR 388 merged. On the merged source the full-Trash
  refusal is the "Trash is full" dialog (`notes-trash-full.spec.ts` now requires it) and the
  dedicated "Latest brief" card exists in both profiles (journey D now asserts it). The test
  then still open for D-17, from an agent digest result to the card in the product profile,
  came with round 9 (`home-brief-result.production.spec.ts`).
- J03-8 wording: a refused attachment reads "Gmail is unavailable right now"; a message that
  names the file as not matching its type was not added.

## Round 5 review and merge

An independent review of the loop package on the merge of `main` (rounds 3 and 4, upstream
pin `40dbe96b`) and the runner package. Class S only.

| Finding | Change | Test |
| --- | --- | --- |
| The F-10 fix compared content only, in the review controls. A saved review reopened with its Send button after a reload (the edit was in the retained copy, not in the composer), and after the email was moved to another From account and sent there, so the earlier text or a second copy could be sent | The review records the local draft it was made from; `InboxOperation.confirm` refuses, before any write, unless the composer holds that draft with the reviewed content | `scripts/test-inbox-sent-cleanup.ts` (eight added cases), `journey-f-reviewed-send.spec.ts` (two added tests, two changed reload steps) |
| The sent-copy cleanup tests from round 4 ran without the composer wired to the review controls, and the merged controls did not load in that harness at all. Three of their cases edited or replaced the draft between review and Confirm, which the merged product no longer sends | The harness is wired as `inbox-cloud-adapter.ts` wires it; those cases make the edit while the request is in flight, which is the only time a sent email can differ from its local copy | same script, 24 cases |
| A message the provider lists twice within one page was shown twice | Each listed message is shown once | `journey-f-reviewed-send.spec.ts` (F-12, added) |
| An agent update to an all-day event was saved with whatever instants it named, while the review showed whole dates | Instants that are not whole UTC dates are refused before review | `calendar-agent-all-day-review.spec.ts`, `test/calendar-agent-review.test.mjs` (daylight-saving and all-day cases added) |
| `main` added `BrowserStorageFormatInstrumentedTest` with its own campaign runner while the runner package added the check that every `@Test` class is reachable; merged, that check failed | `scripts/test-browser-storage-format.ts` is listed in `CAMPAIGN_RUNNERS` | `test/android-instrumentation-runner.test.mjs` |
| No test put a file that passes the type check but is also a web page through the preview | None needed: the preview is one fully sandboxed frame showing a blob typed as the checked image | `inbox-hostile-attachment.spec.ts` (polyglot and URL-like names, added) |

Checked and left as they are:

- The development agent now returns message identities. The product path requires both and
  fails closed without them (`agent-adapter.ts`); the pinned upstream conversation route
  returns both (`vendor/eliza/packages/agent/src/api/conversation-routes.ts`). That is a
  reading of source, not a run against a real agent.
- The proposal card's "the calendar kept on this phone. No account calendar is changed."
  holds for the pinned native plugin, which accepts only its own local-account calendar
  (`CalendarEventGuard.sourceRevision`). Not run on a device.
- "Newer mail arrived" is shown when a later page repeats a loaded message. A provider
  that overlaps pages for any other reason would produce the same notice.
- D-8 is the one EVIDENCED row whose evidence is not a test run at the merged source: its
  single manual run was made at the previous upstream pin and the check is in no automated
  lane. Counted only on runs at the merged source it would be SOFTWARE: D 13 of 16 (81%) and
  All 104 of 140 (74%).
- An attachment name may contain bidirectional-override characters; names are only ever
  shown as text and nothing is executed, but the displayed name can mislead.

