#!/usr/bin/env node
/**
 * Install both distribution variants with their instrumentation APKs on an owned,
 * disposable emulator and run a named class list or the whole androidTest suite.
 *
 *   npm run test:android:instrumentation -- --owned-emulator --avd <name> \
 *     [--serial emulator-5554] [--classes NoMockProduct,Shell,StartupReadiness | --all] \
 *     [--variants standalone,launcher] [--test-mocks] [--apk-dir artifacts] \
 *     [--output test-results/android-instrumentation/<run>] [--timeout-ms 900000] \
 *     [--clock-exclusive] [--home-role] [--live-network]
 *
 * --live-network passes each class's `liveArgs` gate (BrowserFlow's browserFlowLive=1): the methods
 * that load a public third-party page run only when the emulator has network and this is asked for.
 *
 * Variants share one package id and replace each other, so they run one after the
 * other: install app + test APK, check the installed bytes, run every class in its
 * own `am instrument` process after clearing the app's data, uninstall. Only packages this run installed are
 * removed; an existing Alpha installation is refused, never replaced.
 *
 * --home-role (launcher variant only) is the one phase that changes a device role: it records
 * the emulator's HOME holder, runs the classes that request the role themselves, selects the
 * launcher APK as HOME, cold-starts it with the HOME key, runs the classes that need Alpha to be
 * HOME, and always puts the original HOME back. If that cannot be proven the run fails, the
 * installed packages are left in place and the emulator must not be reused until it is recovered.
 *
 * Classes that assert a disposable secondary Android user (HostedProcessRestart,
 * HostedBackgroundWorker) run in their own phase per variant: the runner creates a fresh user
 * with the upstream lifecycle helper the other campaigns use, makes the two installed packages
 * available to it, runs each class there, removes the packages from that user and lets the
 * helper switch back to the owner and remove the user. A user that cannot be removed fails the run.
 *
 * Results: <output>/results.json via scripts/instrumentation-result.mjs, bound to
 * the source commit and every installed APK's SHA-256, with raw output per class.
 * This is emulator-class evidence (class E). It is not physical-device, AOSP image,
 * real-integration or user acceptance.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { instrumentationClassResults, listedInstrumentationTests, writeInstrumentationRecord } from "./instrumentation-result.mjs";

export const PACKAGE = "ai.elizaresearch.alphaphone";
const RUNNER = "androidx.test.runner.AndroidJUnitRunner";

/**
 * Known classes and how to run them. `args` are the class's explicit opt-in gates.
 * `phases` run methods in order, each in a new instrumentation process.
 * `campaign` classes need orchestration this runner does not perform (process
 * kills mid-test, permission changes, provider credential fixtures); they are
 * refused here and named with the campaign that runs them.
 * `liveArgs` are passed only with --live-network (a default run never depends on a public page).
 * `flagOffOnly` classes check a policy a test-mocks build relaxes by design; --test-mocks refuses them.
 * `testMocks` classes are compiled only into the test-mocks instrumentation APK;
 * `requiresTestMocksBuild` classes are in every instrumentation APK but assume a
 * test-mocks app build, so they are refused without --test-mocks instead of skipping.
 * `homeRole` classes run only on the launcher variant inside the --home-role phase:
 * "requests" before Alpha is selected (the class asks for the role in Android's own
 * dialog and restores what it found), "held" while Alpha is the selected HOME app.
 */
export const CLASS_REGISTRY = {
  NoMockProduct: {},
  BrowserInstalledResolver: { note: "Real installed generic HTTPS filter visibility only; no external launch or network request" },
  Shell: {},
  StartupReadiness: { args: { startupReadiness: "1" } },
  TextScale: { note: "textScaleProcessRestartPhase is skipped here; run node scripts/test-native-restart.mjs text-scale" },
  CloudSignInCallback: { args: { cloudSignInNative: "1" }, note: "Synthetic in-app sign-in returns through MainActivity; a matching return is never delivered, so nothing reaches Steward or Cloud. Not App Link verification (adb shell pm get-app-links) or real-account sign-in" },
  BrowserExternalHandoff: { note: "Synthetic committed HTTPS child and resolver fixture; intercepts chooser dispatch, no external page is opened" },
  ResetPolicy: { note: "Non-destructive cancellation, migration refusal and isolated marker checks; not a system reset proof" },
  BrowserCookiePolicy: { note: "Synthetic intercepted HTTPS origins; private method requires scoped WebView deletion support" },
  BrowserSignins: { note: "signinProcessRestartPhase is skipped here; run node scripts/test-native-restart.mjs signin" },
  BrowserFlow: { liveArgs: { browserFlowLive: "1" }, note: "loopback fixture methods need --test-mocks; by default the search method asserts the submitted www.google.com/search URL and the javascript: refusal offline; only --live-network (browserFlowLive=1) needs live HTTPS to www.google.com and records INSTRUMENTATION_STATUS browserFlowSearch=results or provider-check (the provider's own check page for that exact search)" },
  BrowserContinuity: { note: "bookmarkProcessRestartPhase is skipped here; run node scripts/test-native-restart.mjs bookmark" },
  BrowserDownload: { note: "needs --test-mocks (loopback HTTP fixtures); skipped on any other build, so it is not a default class" },
  // src/testMocks/androidTest: compiled only into the test-mocks instrumentation APK.
  BrowserAutofill: { testMocks: true },
  // Both hosted classes serve results from a loopback HTTP fixture, which HostedTransport accepts
  // only in a test-mocks app build (any other build answers "HTTPS required").
  HostedProcessRestart: {
    secondaryUser: true, requiresTestMocksBuild: true,
    args: { alphaHostedProcessRestartFixture: "true" },
    phases: ["prepareCommittedResultWithLostAck", "resumeAfterProcessDeathRecoversAckOnce", "verifySecondRestartAndCleanup"],
  },
  RealClock: { args: { realClock: "1", clockExclusive: "1" }, requires: "--clock-exclusive", grantOther: { "com.android.deskclock": ["POST_NOTIFICATIONS"] },
    note: "fixture qualified for API 35 only (it asserts the SDK level); the runner grants AOSP Clock its notification permission, which the class requires for real firing evidence" },
  Accessibility: { note: "a flag-off build signed out of Eliza Cloud runs requiredCloudSignInAtDoubleFontScale (P-43's sign-in page); the test-mocks pair runs the Home, shade and Settings journey" },
  // PRD AP-15 coverage across views; the views need the test-mocks pair (a flag-off emulator build is signed out, P-43).
  AccessibilityViews: { requiresTestMocksBuild: true, note: "every retained view and Apps at 200% font: ATF, TalkBack order and focus after opening; not TalkBack itself or a device" },
  AccessibilityLifecycle: { requiresTestMocksBuild: true, note: "repeated HOME with relaunch and rotation across every view at 200% font; processRestartPhase is skipped here; run node scripts/test-native-restart.mjs accessibility" },
  AccessibilityHomeRole: { homeRole: "held", requiresTestMocksBuild: true, note: "launcher variant with Alpha selected as HOME by --home-role: HOME from every view at 200% font lands on an accessible Alpha Home; not boot-time HOME or device acceptance" },
  ContactsCatalog: { note: "Owned disposable-profile ContactsProvider fixture only; no image admission or contacts activity" },
  ImageCapabilities: { note: "ordinary APK denial only; no AOSP image or real telephony acceptance" },
  SettingsSystemFacts: { note: "read-only comparison with this image's settings; not device acceptance of the Settings handoffs" },
  Rotation: {},
  // Core-loop classes (docs/core-loop-audit.md). Registered so their opt-in gates are passed; none
  // has a recorded run through this runner yet. An unmet device assumption reports "skipped".
  // Decision P-43 replaced LocalAgentOfflineApps (the retired "without AI" path); written, no recorded run.
  ResidentAlwaysPresent: { flagOffOnly: true, note: "signed out with the network off and a legacy local-apps selection: the resident starts, the required Eliza Cloud sign-in dialog opens over Home with the agent state and cannot be dismissed; not a device or full-image run" },
  LauncherHome: { homeRole: "held", note: "launcher variant with Alpha selected as HOME by --home-role; not boot-time HOME or device acceptance" },
  SettingsRoles: { homeRole: "requests", note: "removes, declines and accepts the HOME role in Android's dialog and restores the previous holder; --home-role proves the restoration" },
  NotesTrashBackstop: {},
  // Added by the round-2 integration (PR 388); no recorded run.
  AssistantResidentReuse: { note: "synthetic runtime observation, enrollment and streams; not evidence that a live resident stream survives" },
  LauncherApps: { note: "upstream SystemLauncherApps through Alpha's identity; resolves against this image's package manager only; two methods skip when the image has no other launchable app" },
  NotesDocument: { note: "Production migration refusal and unchanged Notes; test-mocks builds exercise SAF migration. Restart phase requires the explicit notes development campaign." },
  NotesStorageDurability: { args: { notesStorage: "1" } },
  CloudDeploymentStorage: {},
  CloudSignInAuthorization: { note: "Actual native Authorize/Cancel gate with an isolated plugin and no session; not live authentication or remote key issuance" },
  DailyApps: {},
  ReminderNoticeQuestion: { requiresTestMocksBuild: true, note: "own reminder notice's Ask Alpha action without a selected agent; the review method needs a selected agent (-e noticeQuestion 1) and skips here (MVP-13, #676)" },
  ReminderLifecycle: { note: "the re-post method skips unless notifications are enabled for the app" },
  ClockHandoff: { args: { clockHandoff: "1" }, note: "Clock intents are intercepted; not ringing evidence" },
  ClockRepeatDays: {},
  HostedResultNotice: { note: "builders only here; the posted and denied notices need the notification permission set first: node scripts/test-native-permissions.mjs notice|notice-denied APP.apk TEST.apk OUTPUT" },
  HostedBackgroundWorker: { secondaryUser: true, requiresTestMocksBuild: true, args: { alphaHostedBackgroundFixture: "true" } },
  WorkflowApprovalNotice: { args: { workflowApprovalNotice: "1" }, grant: ["POST_NOTIFICATIONS"], note: "the runner grants the notification permission the class requires after clearing app data" },
  // The reading classes below give the product a synthetic loopback HTTP speech route. Only a
  // test-mocks app build admits that route; any other build answers "Select an available speech
  // route before reading" first, which is the correct refusal for a phone without an HTTPS route.
  BrowserReading: { args: { browserReading: "1" }, requiresTestMocksBuild: true, note: "needs a WebView provider with isolated-world injection" },
  BrowserSensitiveReading: { args: { browserSensitiveReading: "1" }, requiresTestMocksBuild: true },
  BrowserIsolatedReading: { args: { browserIsolatedReading: "1" }, requiresTestMocksBuild: true, note: "needs a WebView provider with isolated-world injection" },
  BrowserReadingNavigation: { args: { browserIsolatedReading: "1" }, note: "one method per provider: the stale-document method needs isolated-world injection; without it only the reading-unavailable method runs and the other is listed as skipped (INSTRUMENTATION_STATUS browserReadingProvider says which)" },
  PasswordBrowserFill: {},
  InboxOperationJournal: { args: { inboxOperationNative: "1" } },
  MailAttachment: { args: { mailAttachmentNative: "1" } },
  // Both drive Home, which a production Android build covers with the Eliza Cloud sign-in gate;
  // only a test-mocks build offers "Continue offline" to reach it without an account. SystemShade's
  // outcome and permission methods also run on a flag-off build; its Home method is skipped there.
  Notifications: { requiresTestMocksBuild: true, note: "opens Android's own shade with Android's global action on both flavors and taps the notice on its own row (Android 15 bundles two notices into a collapsed automatic group first); Alpha draws no shade (#416)" },
  SystemShade: { note: "homeAsksAndroidForItsShadeOnTheLauncherOnly needs --test-mocks (skipped otherwise). Launcher Home asks Android for its shade (EXPAND_STATUS_BAR); standalone never does (#416, #417). Not AOSP-image or device acceptance" },
  CameraScan: {},
  CameraLatency: { args: { cameraLatency: "1" }, note: "cold/warm first frame (PreviewView STREAMING, also traced as alpha.camera.firstFrame) and shutter-to-thumbnail, reported as cameraLatency.* status; -e cameraLatencyAssert 1 fails on a missed Pixel 10a target; emulator numbers are not device evidence" },
  FilesTree: {},
  FilesFolderQuestion: { note: "real DocumentsUI tree grant; the folder question reviews entry names only, and a delete or revoked grant during review adds nothing (MVP-13)" },
  // J05-2: native page excerpt -> reviewed question -> composer; a note's web source across recreation.
  BrowserPageQuestion: { args: { browserPageQuestion: "1" }, note: "offline: every page is served from memory to the tab's WebView (the first tab opens on https://reading.invalid/start, which never resolves); needs a WebView provider with isolated-world injection; the agent's answer and the summary-note save that follows it need a connected agent and are not covered" },
  // Mock mode and loopback fixtures exist only in a test-mocks app build.
  ConnectionChooser: { requiresTestMocksBuild: true },
  BrowserDialogLifecycle: { requiresTestMocksBuild: true },
  BrowserWebFeatures: { requiresTestMocksBuild: true },
  CloudVoice: { requiresTestMocksBuild: true },
  DevelopmentAgent: { requiresTestMocksBuild: true },
  PairedAsr: { requiresTestMocksBuild: true },
  PairedVoice: { requiresTestMocksBuild: true },
  ScopedVoicePlayback: { requiresTestMocksBuild: true },
  IsolatedPdf: { args: { isolatedPdfNative: "1" }, requiresTestMocksBuild: true },
  // Round-9 additions (WP2). None has a recorded run; each is compiled into both instrumentation APKs.
  RendererRecovery: { note: "ends the host WebView renderer (WebViewRenderProcess.terminate, else chrome://crash in a debuggable build); LauncherHome repeats it while Alpha is HOME" },
  ConnectionRoutes: { flagOffOnly: true, note: "flag-off ConnectionRoutes policy inside the APK; a test-mocks build admits every origin by design, so --test-mocks refuses this class" },
  ChatContinuity: { note: "real soft keyboard, KEYCODE_BACK and HOME through UiAutomation; HOME is delivered to Alpha only when it holds the role, otherwise the app is backgrounded and resumed" },
  SelectedDocument: { note: "documentProcessRestartPhase is skipped here; run node scripts/test-native-restart.mjs document" },
  PasswordVaultSettings: { args: { passwordVault: "1" }, note: "sets and clears a fixture screen-lock PIN: an owned emulator with no screen lock of its own; the inactivity step waits out the 60 s unlock window" },
  PasswordVaultFill: { args: { passwordVaultFill: "1" }, note: "sets and clears a fixture screen-lock PIN and selects Alpha as the Autofill service, restoring the previous service; the other package is Alpha's own (the instrumentation APK holds one package)" },
  // Round-9 journeys and links (WP2, second pass). Compiled into both instrumentation APKs; no recorded run.
  PosterCalendarJourney: { args: { posterJourney: "1" }, note: "J01: a picked poster PNG through DocumentsUI, on-device OCR, the event draft, the Calendar form and Save into the real CalendarProvider (Alpha's own local calendar), then the Home card; the cancel method leaves no row. Calendar access is granted by the class" },
  JourneyJ05: { args: { journeyJ05: "1" }, flagOffOnly: true, note: "J05 on the flag-off pair, offline: page -> Ask about page -> native review -> composer -> Send while inference is unavailable (resident present, P-43; nothing dispatched) -> a source note for that page across recreation; needs a WebView provider with isolated-world injection; no agent answer" },
  NoteOrigin: { note: "storage level: a reminder's note link in note-origins:v1:device, read back exactly and across recreation; needs the slot admitted for compare-and-exchange (WP1). The Calendar 'From note' line is not driven" },
  Maps: { args: { mapsEventReturn: "1" }, note: "calendarLocationReturnsToTheSameEventAndFailsClosed owns a local calendar and grants itself Calendar access; explicitRecenterUsesInjectedNativeLocationAndStopsWatch is skipped without host GPS injection (mapsLatitude/mapsLongitude)" },
  // Self-contained classes with an explicit gate. Registered so the gate is passed.
  BrowserShare: { args: { browserShareLive: "1" }, note: "opens a public HTTPS page and Android's chooser; the emulator needs network" },
  BrowserUnsupportedReading: { args: { browserUnsupportedReading: "1" }, requiresTestMocksBuild: true, note: "the negative flow: needs a WebView provider WITHOUT isolated-world injection" },
  LargeInboxAttachment: { args: { largeInboxAttachmentNative: "1" } },
  NoteAudioMetadataEncrypted: { args: { notesAudioEncryption: "1" } },
  NotesSecureStorage: { args: { notesSecureStorage: "1" }, note: "the legacy-layout migration runs across a process restart in node scripts/test-native-restart.mjs notes-secure-migration; its in-process variant (notesSecureMigration=1) is skipped here" },
  PdfViewer: { args: { isolatedPdfNative: "1" } },
  PhotosBatch: { args: { photosBatch: "1" } },
  PhotoLibrary: { args: { photoLibrary: "1" }, note: "grants READ_MEDIA_IMAGES/VIDEO (Android 13+), creates and deletes only its own uniquely named fixtures; permission revoke, selected-only grants and reboot need separate campaigns" },
  PhotosForeignLibrary: { args: {}, note: "requires an explicit disposable user, separate-UID synthetic ledger and expected permission scope; no implicit media access" },
  PhotosLibrary: { args: { photosLibrary: "1" }, note: "requires an owned disposable secondary user; synthetic generation fence only, not foreign-media permission acceptance" },
  UiDispatch: { args: { uiDispatch: "1" } },
  LocalSpeech: { args: { localSpeech: "1" }, note: "needs the staged on-device voice outputs (assets/paradee-voice/v1: Paradee, misaki, the Phonon-2 ASR slot) and the recorded libelizainference engine; no device qualification is recorded yet" },
  LocalSpeechBridge: { args: { localSpeechBridge: "1" }, note: "needs the staged on-device voice outputs including the ASR slot pair" },
  VoiceNoteReadAloud: { args: { localSpeech: "1" }, note: "needs the packaged voice bundle; not audible-speaker evidence" },
  SpeechNoNetwork: { args: { localSpeech: "1" }, note: "needs the packaged voice bundle with the ASR slot and the native engine, and an ACTIVE validated network (unlike the other speech classes, which run with networking off) so an egress attempt is observable; skips as inconclusive if the app process is not network-quiet while idle" },
  LiveVoiceVad: { args: { localSpeech: "1" }, note: "Silero VAD in the app process on the packaged bundle with the app JNI bridge; no microphone, no agent call" },
  SpeechSentenceCancellation: { args: { speechSentenceCancellation: "1" }, note: "needs the staged on-device voice outputs (Paradee)" },
  // Classes with no opt-in gate and no host, account or permission precondition.
  ActionJournal: {},
  ActivityInstanceSelection: {},
  Assistant: {},
  FilesTreeBatch: {},
  Flow: {},
  HostedResultsLifecycle: {},
  LocalAgentProvider: {},
  PhotoEdit: {},
  PhotoFilter: {},
  PhotosMultiShare: {},
  PhotosTrash: {},
  ReminderDeletionJournal: {},
  CalendarDeletionReview: { secondaryUser: true, args: { calendarDeletionReview: "1" }, grant: ["READ_CALENDAR", "WRITE_CALENDAR"], note: "Actual native review, Cancel, Undo and expiry against an owned disposable Calendar" },
  CalendarSyncProvider: { secondaryUser: true, args: { calendarSyncProvider: "1" }, grant: ["READ_CALENDAR", "WRITE_CALENDAR"], note: "Exact rich-event CalendarProvider CAS in a fresh disposable user; no Google or agent traffic" },
  ScopedCalendarDeletion: { secondaryUser: true, args: { scopedCalendarDeletion: "1" }, grant: ["READ_CALENDAR", "WRITE_CALENDAR"], note: "Exact synthetic provider rows in a fresh owned secondary user; no real account integration" },
  ReminderCapacity: {},
  ReminderHeadsUp: { note: "skips unless notifications are enabled for the app and Do Not Disturb is off" },
  ReminderStale: {},
  SettingsFlow: { note: "themeProcessRestartPhase is skipped here; run node scripts/test-native-restart.mjs theme" },
  Video: {},
  VoiceWorkerSettlement: {},
  ResidentEgressRedaction: { campaign: "ALPHA_RESIDENT_DISPOSABLE_EMULATOR=1 node scripts/android-resident-instrumentation.mjs <app.apk> <androidTest.apk> (owner-only provider key fixture, ARM64)" },
  ReminderTapProcessDeath: { campaign: "python3 scripts/ci/pending-recovery-ui.py (external process death)" },
  WorkflowNoticeProcessDeath: { campaign: "python3 scripts/ci/pending-recovery-ui.py (external process death)" },
  WorkflowApprovalNoticeProcessDeath: { campaign: "ALPHA_BUILD_ARCHIVE=<archive> node scripts/android-workflow-native.mjs --phase=approval-notice-recovery (kills the main process from the WorkflowNoticeProcessRunner helper process, in an owned secondary user)" },
  NotificationChannels: { campaign: "node scripts/test-native-permissions.mjs channels APP.apk TEST.apk OUTPUT (permission-restoring runner)" },
  VoicePermissionDenied: { campaign: "node scripts/test-native-permissions.mjs voice APP.apk TEST.apk OUTPUT (RECORD_AUDIO revoked before the app starts)" },
  VoicePermissionRevoke: { campaign: "node scripts/test-native-permissions.mjs voice-revoke APP.apk TEST.apk OUTPUT (RECORD_AUDIO revoked while recording; the process is killed)" },
  LocalVoiceRecordingLimit: { campaign: "node scripts/test-native-permissions.mjs voice-limit APP.apk TEST.apk OUTPUT (RECORD_AUDIO granted before the app starts)" },
  WorkflowLegacyReminderUpgrade: { campaign: "node scripts/test-installed-upgrade.mjs (installed-upgrade campaign; runs upgradedLegacyOneOffReminderIsIncludedInNativeDigest after the candidate verify phase)" },
  SettingsCrashLog: { campaign: "node scripts/test-native-restart.mjs crash-log APP.apk TEST.apk OUTPUT (the crash phase kills the process; readback in a new one)" },
  NativeVoiceLatency: { campaign: "node scripts/native-voice-latency-emulator.mjs --serial <owned emulator> --avd <name> --python <grpc venv python> --wav <speech.wav> --out <dir> (issue #395; injects speech into the virtual microphone while the harness runs)" },
  HomeCalendarCard: { campaign: "node scripts/test-calendar-regression.mjs --case=HomeCalendarCardInstrumentedTest (granted, then with calendar access revoked before the process starts)" },
};

/**
 * Other scripts that run instrumentation classes by name. A class named in one of
 * them counts as reachable; test/android-instrumentation-runner.test.mjs checks it.
 */
export const CAMPAIGN_RUNNERS = [
  "scripts/test-native-calendar-deletion-restart.mjs",
  "scripts/test-native-permissions.mjs", "scripts/test-native-restart.mjs", "scripts/test-calendar-regression.mjs",
  "scripts/test-installed-upgrade.mjs", "scripts/test-reminder-one-off.mjs", "scripts/test-reminder-recurrence.mjs",
  "scripts/reminder-recovery-fixture.mjs", "scripts/test-cross-app-notifications.mjs", "scripts/test-cross-app-notifications-restart.mjs",
  "scripts/android-workflow-native.mjs", "scripts/android-resident-instrumentation.mjs", "scripts/android-browser-reading-live.mjs",
  "scripts/android-paired-asr-live.mjs", "scripts/android-paired-voice-live.mjs", "scripts/maps/test-native-navigation.mjs",
  "scripts/maps/test-native-recovery.mjs", "scripts/ci/pending-recovery-ui.py", "scripts/ci/resident-native.py",
  // Added on main while the reachability check was being written: BrowserStorageFormat.
  "scripts/test-browser-storage-format.mjs",
];

/**
 * @Test classes that no runner in this repository can run, each with the reason. A class
 * stays here only while that reason is true: the runner test fails for an entry that has
 * gained a registry entry or a campaign, and for any new class that has neither.
 */
export const NOT_RUN_BY_A_RUNNER = {
  LocalServerSocketRelease: "platform probe for an upstream resident defect (docs/on-device-speech-2026-11-05.md, defect 4): it measures Android, not Alpha, and is run by hand when that defect is revisited",
  ResetExternalFixture: "requires an external host controller, disposable non-owner user, synthetic device credential and separate companion/media sentinels; reset kills instrumentation, so phases cannot run as a single generic campaign (see docs/evidence/reset-native-2026-10-12.json)",
  AllViewAgentContext: "needs a real local agent with inference and a forwarding observer on the host (agentContext=true); its runner was removed with the smoke suites in 49b1bf4c",
  CombinedAgent: "needs the combined host runtime with a provider key at 10.0.2.2:47859 (scripts/start-combined-agent.mjs); no Android runner starts or pairs it",
  CombinedAgentRestart: "same combined host runtime, in prepare/verify/cleanup phases around a host restart; compiled, never executed",
  ContactsFlow: "@Ignore: Contacts is deferred from the MVP and the campaign mutates the ContactsProvider",
  DeviceAction: "needs the device-action backend host and adb reverse (deviceActions=true); its runner was removed in 49b1bf4c",
  LiveAgent: "needs a running loopback host with a real provider key, adb reverse and a provisioned bearer (liveAgent=true)",
  PairedMaps: "needs a real paired host and an external Maps fixture (pairedMaps=1); no runner pairs one",
  PairedReminder: "needs a real paired host (pairedReminder=1); no runner pairs one",
  PhotosFixtureRecovery: "operator tool that inventories or deletes stranded test-owned media (alphaPhotoRecovery=inventory|delete); never part of a campaign",
  VideoCopyClosedFailureReview: "native-only preservation operator for one existing closed failed copy; requires the exact operation, reviewed record SHA, owner UID and explicit main-process lifecycle approval. Never a generic or bulk campaign; the signed entry is admitted separately after fixture qualification",
  PrototypeFlow: "needs the same live provider host as LiveAgent (liveAgent=true)",
  PublicCloudTransportProbe: "probes the public Eliza Cloud endpoint with an owned account (publicCloudProbe=1, ownedCloudRead=1); a human sign-in step",
  RemoteAgent: "needs the real local Eliza app host at 10.0.2.2:47839 and a pairing-code file (localRemote=true); its runner was removed in 49b1bf4c",
  ResidentAgent: "needs the packaged ARM64 resident runtime and a run id; scripts/android-resident-instrumentation.mjs runs ResidentService and ResidentEgressRedaction, not this class",
  ResidentModelResponseContractTest: "plain contract test without the InstrumentedTest suffix; it runs under --all or by its full dotted name and needs no registry entry",
  SpeechPipelineTrace: "diagnostic acquisition for the on-device speech failure, explicitly not acceptance evidence",
  VoiceFloatPathDiagnostic: "root-cause diagnostic for the on-device speech round trip, explicitly not acceptance evidence",
};

/**
 * What a run without --classes executes. Every one of these has at least one method that runs on a
 * flag-off build, so a default run can pass. BrowserDownload is not listed: its only
 * method needs a test-mocks app build, so on the default build the class could only be recorded
 * "skipped", which fails the run. It runs with `--test-mocks --classes BrowserDownload`.
 */
export const DEFAULT_CLASSES = [
  "NoMockProduct", "Shell", "StartupReadiness", "TextScale", "BrowserSignins", "BrowserFlow",
  "BrowserContinuity",
];

const short = name => name.replace(new RegExp(`^${PACKAGE.replace(/\./g, "\\.")}\\.`), "").replace(/InstrumentedTest$/, "");
export const qualifiedClass = name => {
  if (!/^[A-Za-z][A-Za-z0-9_.]*$/.test(name)) throw new Error(`Invalid class ${JSON.stringify(name)}`);
  if (name.includes(".")) return name;
  return `${PACKAGE}.${name.endsWith("InstrumentedTest") ? name : `${name}InstrumentedTest`}`;
};

export function parseInstrumentationArgs(argv) {
  const options = { classes: null, all: false, variants: ["standalone", "launcher"], testMocks: false, apkDir: null, output: null,
    serial: null, avd: null, ownedEmulator: false, timeoutMs: 900_000, clockExclusive: false, homeRole: false, liveNetwork: false };
  const value = (arg, index) => {
    if (arg.includes("=")) return [arg.slice(arg.indexOf("=") + 1), index];
    if (argv[index + 1] === undefined) throw new Error(`${arg} needs a value`);
    return [argv[index + 1], index + 1];
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const name = arg.split("=")[0];
    let v;
    switch (name) {
      case "--all": options.all = true; break;
      case "--test-mocks": options.testMocks = true; break;
      case "--owned-emulator": options.ownedEmulator = true; break;
      case "--clock-exclusive": options.clockExclusive = true; break;
      case "--home-role": options.homeRole = true; break;
      case "--live-network": options.liveNetwork = true; break;
      case "--classes": [v, index] = value(arg, index); options.classes = v.split(",").map(s => s.trim()).filter(Boolean); break;
      case "--variants": [v, index] = value(arg, index); options.variants = v.split(",").map(s => s.trim()).filter(Boolean); break;
      case "--apk-dir": [v, index] = value(arg, index); options.apkDir = v; break;
      case "--output": [v, index] = value(arg, index); options.output = v; break;
      case "--serial": [v, index] = value(arg, index); options.serial = v; break;
      case "--avd": [v, index] = value(arg, index); options.avd = v; break;
      case "--timeout-ms": [v, index] = value(arg, index); options.timeoutMs = Number(v); break;
      default: throw new Error(`Unknown option ${arg}`);
    }
  }
  if (options.all && options.classes) throw new Error("Choose --classes or --all, not both");
  if (!options.variants.length || options.variants.some(v => !["standalone", "launcher"].includes(v)) || new Set(options.variants).size !== options.variants.length)
    throw new Error("--variants must list standalone and/or launcher once each");
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 10_000) throw new Error("--timeout-ms must be at least 10000");
  options.apkDir ??= options.testMocks ? "artifacts/test-mocks" : "artifacts";
  if (!options.all) {
    const requested = (options.classes ?? DEFAULT_CLASSES).map(qualifiedClass);
    if (new Set(requested).size !== requested.length) throw new Error("Duplicate class");
    for (const cls of requested) {
      const spec = CLASS_REGISTRY[short(cls)] ?? {};
      if (spec.campaign) throw new Error(`${short(cls)} needs its own campaign: ${spec.campaign}`);
      // These classes assert a disposable secondary Android user, which the runner creates and removes.
      if (spec.secondaryUser && !options.ownedEmulator) throw new Error(`${short(cls)} runs in a disposable secondary Android user; it requires --owned-emulator`);
      if (spec.requires === "--clock-exclusive" && !options.clockExclusive)
        throw new Error(`${short(cls)} changes real alarms; pass --clock-exclusive only on an exclusive, unlocked emulator with no other timers`);
      if (spec.testMocks && !options.testMocks) throw new Error(`${short(cls)} runs only on the --test-mocks variant`);
      if (spec.requiresTestMocksBuild && !options.testMocks) throw new Error(`${short(cls)} needs a test-mocks app build; pass --test-mocks (artifacts/test-mocks)`);
      if (spec.flagOffOnly && options.testMocks) throw new Error(`${short(cls)} checks the flag-off policy, which a test-mocks app build relaxes by design; run it without --test-mocks`);
      if (spec.homeRole && !options.homeRole)
        throw new Error(`${short(cls)} needs the HOME role phase; pass --home-role on an owned emulator (the runner selects the launcher APK as HOME and restores the original)`);
      if (spec.homeRole && !options.variants.includes("launcher")) throw new Error(`${short(cls)} runs only on the launcher variant`);
    }
    options.classes = requested;
  }
  if (options.homeRole) {
    if (options.all) throw new Error("--home-role runs named classes; it cannot be combined with --all");
    if (!options.ownedEmulator) throw new Error("--home-role changes the HOME role; it requires --owned-emulator");
    if (!options.variants.includes("launcher")) throw new Error("--home-role needs the launcher variant");
    if (!options.classes.some(cls => CLASS_REGISTRY[short(cls)]?.homeRole)) throw new Error("--home-role was given but no requested class uses the HOME role (LauncherHome, SettingsRoles)");
  }
  return options;
}

/** `am instrument` arguments for one class (or one phase method), never through a shell. */
export function instrumentArgs(cls, { method, log = false, user, live = false } = {}) {
  const spec = CLASS_REGISTRY[short(cls)] ?? {};
  const extras = Object.entries({ ...spec.args, ...(live ? spec.liveArgs : {}) }).flatMap(([key, val]) => ["-e", key, val]);
  return ["shell", "am", "instrument", ...(user === undefined ? [] : ["--user", String(user)]), "-w", "-r", ...(log ? ["-e", "log", "true"] : []), ...extras,
    "-e", "class", method ? `${cls}#${method}` : cls, `${PACKAGE}.test/${RUNNER}`];
}

/**
 * adb commands run before each named class, so it starts as a fresh install does. Classes share
 * one install per variant; without this an earlier class's app data (a dismissed sign-in panel,
 * granted permissions, a saved draft) or a left-open Android shade
 * decided whether a later class passed. Phases of one class keep their data.
 */
export function classIsolationCommands(user) {
  return [
    ["shell", "cmd", "statusbar", "collapse"],
    ["shell", "pm", "clear", ...(user === undefined ? [] : ["--user", String(user)]), PACKAGE],
  ];
}

/**
 * Creates the disposable secondary user for one variant's secondary-user classes with the upstream
 * lifecycle helper (the one the permission, restart and Calendar campaigns use): fresh user, stock
 * HOME, foreground switch, and afterwards owner restored, user stopped and removed. `lease` is this
 * run's device lease, which the helper requires.
 */
export function secondaryUserLifecycle({ serial, lease, avd, adb, env = process.env }) {
  return async ({ name, record, run }) => {
    const { withIsolatedAndroidUser } = await import("../vendor/eliza/packages/app/scripts/lib/isolated-android-user.mjs");
    return withIsolatedAndroidUser({ serial, deviceLease: lease, env, expectedAvdName: avd, homePackage: env.ALPHA_TEST_HOME_PACKAGE ?? "com.android.launcher3",
      name, record, run, execute: args => adb(args) });
  };
}

/** Locate a variant's app/test APK pair and bind the app to the verify-apks manifest. */
export function admitApks(apkDir, variant, { testMocks }) {
  const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const manifestFile = path.join(apkDir, "apk-manifest.json");
  if (!fs.existsSync(manifestFile)) throw new Error(`${manifestFile} is missing; build and verify the APKs first`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (manifest.testMocks !== testMocks) throw new Error(`${manifestFile} records testMocks=${manifest.testMocks}; expected ${testMocks}`);
  const app = path.join(apkDir, `${variant}-debug.apk`);
  const test = testMocks ? path.join(apkDir, `${variant}-androidTest.apk`) : path.join(apkDir, "instrumentation", `${variant}-androidTest.apk`);
  for (const file of [app, test]) if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  const appSha256 = sha(app), testSha256 = sha(test);
  const row = manifest.results?.find(entry => entry.variant === variant && entry.mode === "debug");
  if (!row || row.sha256 !== appSha256) throw new Error(`${app} does not match the verified ${manifestFile} row`);
  // verify-apks records the instrumentation APK built with this app; an unrecorded one is not bound to it.
  const recordedTest = manifest.instrumentation?.[variant]?.sha256;
  if (recordedTest !== testSha256) throw new Error(`${test} does not match the instrumentation APK recorded in ${manifestFile}; rebuild and re-verify`);
  return [
    { variant, role: "app", file: app, sha256: appSha256, versionCode: row.versionCode, testMocks },
    { variant, role: "test", file: test, sha256: testSha256, testMocks },
  ];
}

const HOME_ROLE = "android.app.role.HOME";
const HOME_COMPONENT = `${PACKAGE}/.MainActivity`;

/** The user's HOME role holder(s) and the activity Android resolves for the HOME key. */
export function readHome(adb, user) {
  const holders = adb(["shell", "cmd", "role", "get-role-holders", "--user", user, HOME_ROLE]).trim().split(/[;\s]+/).filter(Boolean).sort();
  const activity = adb(["shell", "cmd", "package", "resolve-activity", "--user", user, "--brief", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.HOME"])
    .trim().split(/\r?\n/).at(-1)?.trim() ?? "";
  return { holders, activity };
}
const sameHome = (a, b) => a.activity === b.activity && JSON.stringify(a.holders) === JSON.stringify(b.holders);

/** Admission for --home-role: one stock HOME app holds the role and Alpha is not installed yet. */
export function admitHome(adb) {
  const user = adb(["shell", "am", "get-current-user"]).trim();
  if (user !== "0") throw new Error(`--home-role needs the primary user in the foreground (current user ${JSON.stringify(user)})`);
  const original = readHome(adb, user);
  if (original.holders.length !== 1 || original.holders[0] === PACKAGE || !original.activity.startsWith(`${original.holders[0]}/`))
    throw new Error(`--home-role needs one stock HOME app holding the role before the run (holders ${JSON.stringify(original.holders)}, HOME activity ${JSON.stringify(original.activity)}); finish the emulator's setup first`);
  return { user, original, selected: false, coldHome: null, restoration: null };
}

/** Select the installed launcher APK as HOME and prove a cold start through the HOME key lands in it. */
export function selectAlphaHome(adb, home, { sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms), attempts = 60 } = {}) {
  // A class that requests the role itself must have put back what it found.
  const before = readHome(adb, home.user);
  if (!sameHome(before, home.original)) throw new Error(`HOME changed before selection (holders ${JSON.stringify(before.holders)}); a role-requesting class did not restore it`);
  home.selected = true; // From here the original must be restored, even if selection only partly applied.
  adb(["shell", "cmd", "package", "set-home-activity", "--user", home.user, HOME_COMPONENT]);
  const held = readHome(adb, home.user);
  if (held.holders.length !== 1 || held.holders[0] !== PACKAGE || held.activity !== HOME_COMPONENT)
    throw new Error(`Alpha was not selected as HOME (holders ${JSON.stringify(held.holders)}, HOME activity ${JSON.stringify(held.activity)})`);
  // Cold launch: no Alpha process, then the HOME key.
  adb(["shell", "am", "force-stop", PACKAGE]);
  adb(["shell", "input", "keyevent", "KEYCODE_HOME"]);
  let resumed = false;
  for (let attempt = 0; attempt < attempts && !resumed; attempt++) {
    resumed = adb(["shell", "dumpsys", "activity", "activities"]).split("\n").some(line => /mResumedActivity|topResumedActivity/.test(line) && line.includes(`${PACKAGE}/`));
    if (!resumed) sleep(500);
  }
  home.coldHome = { resumed };
  if (!resumed) throw new Error("The HOME key did not bring Alpha to the foreground after a cold start");
}

/** Put the original HOME back and read it back. Never throws: an unproven restoration is reported. */
export function restoreHome(adb, home, { sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms), attempts = 20 } = {}) {
  const errors = [];
  const attempt = args => { try { adb(args); } catch (error) { errors.push(error.message); } };
  let changed = home.selected;
  // Also when this run never selected Alpha: a class that requested the role may have left it changed.
  if (!changed) try { changed = !sameHome(readHome(adb, home.user), home.original); } catch (error) { errors.push(error.message); changed = true; }
  if (changed) {
    // HOME is exclusive: adding the original holder replaces Alpha.
    attempt(["shell", "cmd", "role", "add-role-holder", "--user", home.user, HOME_ROLE, home.original.holders[0]]);
    attempt(["shell", "cmd", "package", "set-home-activity", "--user", home.user, home.original.activity]);
  }
  let after = null;
  for (let index = 0; index < attempts; index++) {
    try { after = readHome(adb, home.user); } catch (error) { errors.push(error.message); after = null; }
    if (after && sameHome(after, home.original)) break;
    sleep(500);
  }
  home.restoration = { restored: Boolean(after && sameHome(after, home.original)), after, ...(errors.length ? { errors } : {}) };
  return home.restoration;
}

function sourceCommit() {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim() !== "";
  return { commit, dirty };
}

async function main() {
  const options = parseInstrumentationArgs(process.argv.slice(2));
  const serial = options.serial ?? process.env.ANDROID_SERIAL;
  if (!options.ownedEmulator) throw new Error("Pass --owned-emulator to confirm the emulator is disposable and owned by this run");
  if (!/^emulator-\d+$/.test(serial ?? "")) throw new Error("An emulator serial (emulator-NNNN) is required; physical devices are refused");
  if (!/^[A-Za-z0-9_.-]+$/.test(options.avd ?? "")) throw new Error("--avd <name> of the owned emulator is required");
  const { androidEnv } = await import("./toolchain.mjs");
  const env = androidEnv();
  const adbPath = path.join(env.ANDROID_HOME, "platform-tools/adb");
  const adb = (args, { timeout = 120_000, allowFailure = false } = {}) => {
    const result = spawnSync(adbPath, ["-s", serial, ...args], { encoding: "utf8", env, timeout, maxBuffer: 64 << 20 });
    if (!allowFailure && (result.error || result.status !== 0))
      throw new Error(`adb ${args.slice(0, 3).join(" ")} failed: ${result.error?.message ?? result.stderr}`);
    return `${result.stdout ?? ""}${allowFailure ? result.stderr ?? "" : ""}`;
  };

  // The shared device lease is held before the emulator is inspected, so another
  // runner cannot install between the admission checks and this run's installs.
  const { acquireDeviceLease, deviceLeaseStateDir } = await import("../vendor/eliza/packages/app/scripts/lib/device-lease.ts");
  const lease = await acquireDeviceLease(`android:${serial}`, { waitMs: 0, ttlMs: Number.MAX_SAFE_INTEGER, stateDir: deviceLeaseStateDir(process.env) });
  try { process.exitCode = (await runLeased({ options, serial, adb, withSecondaryUser: secondaryUserLifecycle({ serial, lease, avd: options.avd, adb }) })).passed ? 0 : 1; } finally { lease.release(); }
}

/** One leased run. `timing` only shortens the HOME role polling in tests. */
export async function runLeased({ options, serial, adb, timing = {}, withSecondaryUser }) {
  // Admission before any installation.
  const avd = adb(["emu", "avd", "name"]).split(/\r?\n/)[0].trim();
  if (avd !== options.avd) throw new Error(`Serial ${serial} runs AVD ${JSON.stringify(avd)}, not ${options.avd}`);
  const prop = name => adb(["shell", "getprop", name]).trim();
  if (prop("ro.kernel.qemu") !== "1" && prop("ro.boot.qemu") !== "1") throw new Error("Not an emulator");
  if (prop("sys.boot_completed") !== "1") throw new Error("Emulator has not finished booting");
  const packages = adb(["shell", "pm", "list", "packages", "-u", "--user", "all"]).split(/\r?\n/).map(s => s.trim());
  if (packages.some(row => row === `package:${PACKAGE}` || row === `package:${PACKAGE}.test`))
    throw new Error("Alpha Phone or its test package is already installed; use a fresh emulator (never replaced)");
  const apks = options.variants.flatMap(variant => admitApks(options.apkDir, variant, options));
  const home = options.homeRole ? admitHome(adb) : null;
  const inSecondaryUser = cls => CLASS_REGISTRY[short(cls)]?.secondaryUser === true;
  if (!options.all && options.classes.some(inSecondaryUser) && typeof withSecondaryUser !== "function") throw new Error("Secondary-user classes need the disposable user lifecycle");
  const secondaryUsers = [];
  const { commit, dirty } = sourceCommit();
  const runId = randomUUID();
  const output = path.resolve(options.output ?? path.join("test-results/android-instrumentation", `${new Date().toISOString().replace(/[:.]/g, "-")}-${runId.slice(0, 8)}`));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(output); // Fresh directory: never mix with older evidence.

  const classes = [];
  const installed = [];
  const emulator = { avd, abi: prop("ro.product.cpu.abi"), sdk: prop("ro.build.version.sdk"), serialSha256: createHash("sha256").update(serial).digest("hex") };
  const fingerprint = (pkg, expected) => {
    const apkPath = /^package:(\/\S+\.apk)$/m.exec(adb(["shell", "pm", "path", pkg]))?.[1];
    const actual = apkPath && adb(["shell", "sha256sum", apkPath]).trim().split(/\s+/)[0];
    if (actual !== expected) throw new Error(`Installed ${pkg} bytes do not match the admitted APK`);
  };
  try {
    for (const variant of options.variants) {
      const [app, test] = apks.filter(apk => apk.variant === variant);
      adb(["install", "-t", app.file], { timeout: 600_000 }); installed.push(PACKAGE);
      adb(["install", "-t", test.file], { timeout: 600_000 }); installed.push(`${PACKAGE}.test`);
      fingerprint(PACKAGE, app.sha256);
      fingerprint(`${PACKAGE}.test`, test.sha256);
      const dir = path.join(output, variant);
      fs.mkdirSync(dir);
      const record = (cls, parsed, extra = {}) => classes.push({ variant, ...parsed, class: cls, ...extra });
      if (options.all) {
        const raw = adb(["shell", "am", "instrument", "-w", "-r", `${PACKAGE}.test/${RUNNER}`], { timeout: options.timeoutMs * 20, allowFailure: true });
        fs.writeFileSync(path.join(dir, "all.txt"), raw);
        for (const row of instrumentationClassResults(raw).results) record(row.class, row);
      } else {
        const runClass = (cls, { user } = {}) => {
          const spec = CLASS_REGISTRY[short(cls)] ?? {};
          const inUser = user === undefined ? {} : { user: "secondary" };
          for (const command of classIsolationCommands(user)) adb(command, { allowFailure: true });
          for (const permission of spec.grant ?? []) adb(["shell", "pm", "grant", ...(user === undefined ? [] : ["--user", user]), PACKAGE, `android.permission.${permission}`]);
          // A grant to another package the class needs (owned, disposable emulator only): never revoked here.
          for (const [pkg, permissions] of Object.entries(spec.grantOther ?? {})) for (const permission of permissions) adb(["shell", "pm", "grant", pkg, `android.permission.${permission}`], { allowFailure: true });
          // A listing that names no test is retried once and kept: three classes that exist were
          // reported "missing" on a loaded emulator with nothing recorded to say why.
          const live = options.liveNetwork;
          let listing = adb(instrumentArgs(cls, { log: true, user, live }), { allowFailure: true });
          let listed = listedInstrumentationTests(listing);
          if (!listed.length) { listing = adb(instrumentArgs(cls, { log: true, user, live }), { allowFailure: true }); listed = listedInstrumentationTests(listing); }
          if (!listed.length) {
            fs.writeFileSync(path.join(dir, `${short(cls)}-listing.txt`), listing);
            record(cls, { started: 0, passed: 0, failed: [], ignored: [], status: "missing" }, inUser); return;
          }
          const runs = spec.phases ? spec.phases : [null];
          let merged = { started: 0, passed: 0, failed: [], ignored: [], status: "passed" };
          for (const method of runs) {
            const raw = adb(instrumentArgs(cls, { method, user, live }), { timeout: options.timeoutMs, allowFailure: true });
            fs.writeFileSync(path.join(dir, `${short(cls)}${method ? `-${method}` : ""}.txt`), raw);
            const row = instrumentationClassResults(raw, [cls]).results.find(entry => entry.class === cls);
            merged = { started: merged.started + row.started, passed: merged.passed + row.passed,
              failed: [...merged.failed, ...row.failed], ignored: [...merged.ignored, ...row.ignored],
              // A phase that did not run (missing) or only skipped fails the phased class. A class
              // without phases keeps its own status: one whose every method was skipped by its
              // gate is "skipped", as documented.
              status: merged.status !== "passed" ? merged.status : row.status === "passed" ? "passed" : spec.phases ? "failed" : row.status };
            if (row.status !== "passed") break; // Later phases depend on earlier ones.
          }
          record(cls, merged, { listed: listed.length, ...inUser, ...(spec.note ? { note: spec.note } : {}) });
        };
        const phase = cls => CLASS_REGISTRY[short(cls)]?.homeRole;
        // HOME-role classes exist for the launcher variant only; elsewhere they are not run at all.
        for (const cls of options.classes.filter(cls => !phase(cls) && !inSecondaryUser(cls))) runClass(cls);
        // Secondary-user phase: one fresh user per variant, removed again before anything else runs.
        const secondary = options.classes.filter(inSecondaryUser);
        if (secondary.length) {
          const lifecycle = { variant, user: null, ownerRestored: false, removed: false };
          secondaryUsers.push(lifecycle);
          try {
            const report = await withSecondaryUser({ name: `instrumentation-${variant}-${Date.now()}`, record: state => { Object.assign(lifecycle, state, { variant }); },
              run: async ({ user }) => {
                const id = String(user);
                for (const pkg of [PACKAGE, `${PACKAGE}.test`]) adb(["shell", "cmd", "package", "install-existing", "--user", id, pkg]);
                try { for (const cls of secondary) runClass(cls, { user: id }); }
                finally { for (const pkg of [`${PACKAGE}.test`, PACKAGE]) adb(["shell", "pm", "uninstall", "--user", id, pkg], { allowFailure: true }); }
                // The helper removes the user only with proof that it holds none of this run's packages.
                const left = adb(["shell", "pm", "list", "packages", "--user", id]).split(/\r?\n/).map(row => row.trim());
                return { cleaned: !left.some(row => row === `package:${PACKAGE}` || row === `package:${PACKAGE}.test`) };
              } });
            Object.assign(lifecycle, { user: report.user, ownerRestored: report.ownerRestored, removed: report.removed });
          } catch (error) {
            lifecycle.error = error.message;
            for (const cls of secondary.filter(cls => !classes.some(row => row.variant === variant && row.class === cls)))
              record(cls, { started: 0, passed: 0, failed: [], ignored: [], status: "missing" }, { user: "secondary", note: `secondary user phase failed: ${error.message}` });
          }
          // An unremoved user keeps this run's state on the emulator: stop, and keep the packages for recovery.
          if (!lifecycle.removed) break;
        }
        if (home && variant === "launcher") {
          for (const cls of options.classes.filter(cls => phase(cls) === "requests")) runClass(cls);
          const held = options.classes.filter(cls => phase(cls) === "held");
          try {
            selectAlphaHome(adb, home, timing);
            for (const cls of held) runClass(cls);
          } catch (error) {
            // Selection or the cold HOME start failed: the classes that need HOME did not run.
            home.error = error.message;
            for (const cls of held.filter(cls => !classes.some(row => row.variant === variant && row.class === cls)))
              record(cls, { started: 0, passed: 0, failed: [], ignored: [], status: "missing" }, { note: `HOME role phase failed: ${error.message}` });
          }
          // Restore while Alpha is still installed, so the role is given back and not merely lost with the package.
          if (!restoreHome(adb, home, timing).restored) break;
        }
      }
      adb(["uninstall", `${PACKAGE}.test`], { allowFailure: true }); installed.splice(installed.indexOf(`${PACKAGE}.test`), 1);
      adb(["uninstall", PACKAGE], { allowFailure: true }); installed.splice(installed.indexOf(PACKAGE), 1);
    }
  } finally {
    // Always prove the original HOME, also after a failure part-way through the phase.
    if (home && !home.restoration) restoreHome(adb, home, timing);
    if (secondaryUsers.some(row => !row.removed)) {
      const kept = secondaryUsers.find(row => !row.removed);
      console.error(`Secondary user ${kept.user ?? "(not created)"} of the ${kept.variant} variant was NOT proven removed on ${serial}${kept.error ? `: ${kept.error}` : ""}. Recover it before reusing this emulator:\n  adb -s ${serial} shell am switch-user 0 && adb -s ${serial} shell pm remove-user ${kept.user ?? "<id>"}`);
    }
    if (home && !home.restoration.restored) {
      // Unproven restoration: keep the installation for recovery and say exactly what to do.
      const recovery = { serial, user: home.user, original: home.original, observed: home.restoration.after, retainedPackages: [...new Set(installed)],
        recover: `adb -s ${serial} shell cmd role add-role-holder --user ${home.user} ${HOME_ROLE} ${home.original.holders[0]}` };
      fs.writeFileSync(path.join(output, "home-role-recovery.json"), `${JSON.stringify(recovery, null, 2)}\n`);
      console.error(`HOME role restoration is NOT proven on ${serial}. Installed packages were left in place; do not reuse or delete this emulator until it is recovered:\n  ${recovery.recover}\n  see ${path.relative(process.cwd(), path.join(output, "home-role-recovery.json"))}`);
    } else {
      // Remove only what this run installed.
      for (const pkg of [...new Set(installed)].reverse()) adb(["uninstall", pkg], { allowFailure: true });
    }
  }
  const result = writeInstrumentationRecord(path.join(output, "results.json"), {
    runId, createdAt: new Date().toISOString(), commit, dirty, testMocks: options.testMocks, emulator,
    apks: apks.map(({ file, ...apk }) => ({ ...apk, file: path.relative(process.cwd(), path.resolve(file)) })),
    mode: options.all ? "all" : "classes",
    ...(options.liveNetwork ? { liveNetwork: true } : {}),
    ...(home ? { homeRole: { user: home.user, original: home.original, selected: home.selected, coldHome: home.coldHome, restored: home.restoration.restored, after: home.restoration.after,
      ...(home.error ? { error: home.error } : {}), ...(home.restoration.errors ? { errors: home.restoration.errors } : {}) } } : {}),
    ...(secondaryUsers.length ? { secondaryUsers } : {}),
    classes,
  });
  for (const row of classes) console.log(`${row.status.padEnd(8)} ${row.variant.padEnd(10)} ${short(row.class)}${row.user ? " (secondary user)" : ""}${row.ignored.length ? ` (skipped by assumption: ${row.ignored.join(", ")})` : ""}`);
  console.log(`${result.passed ? "PASSED" : "FAILED"}: ${path.relative(process.cwd(), path.join(output, "results.json"))} (emulator class E evidence only; not device acceptance)`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
