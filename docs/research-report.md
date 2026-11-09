> Current design correction: the authoritative UI is https://alpha-phone-prototype.pages.dev/ and its extracted fourteen-app presentation. The earlier seventeen-route renderer discussed below is historical. For current adapter behavior and remaining real-flow gaps, use [current capability status](mvp-current-status.md) and [screen inventory](prototype-screen-inventory.md). No full-flow completion is claimed.

# Alpha Phone — consolidated flow and platform research

Research date: 2026-09-29. (Superseded by decision P-15: the hardware target is Pixel 10a, codename stallion, on Android 17.) Product target correction at the time: Pixel 10 or similar **phone**, not tablet; the closest installed Pixel 9 definition is the emulator test profile. Physical Pixel 10 acceptance remains separate. This report consolidates source inspection, flow requirements and native-platform research. It is not a claim that all requested integrations are built, tested or working. Test evidence must name the actual APK/commit, device and provider used.

## Findings

Alpha Phone can own a coherent, branded daily-task interface while reusing Android for secure and hardware-dependent interaction. The correct split is product-owned navigation, editing, context, approval and result presentation; native-owned permissions, credential dialogs, pickers, audio/camera and application handoff; cloud Eliza-owned agent execution, account connectors and durable workflow orchestration; AOSP-owned provisioning, system roles, browser packaging and updates.

The active renderer now uses the extracted fourteen-app prototype. Product adapters provide real native browser documents, CameraX still capture and app-owned photo browsing, CalendarProvider events and Home agenda routing, Android contacts, selected files, local notes and native reminders. The debug transport runs pinned Eliza with a real remote model and can propose approved note creation, reminder creation and view navigation. Production pairing, mailbox sync, actual workflow execution, full browser credentials and image/document understanding remain incomplete. Opening another Android app establishes only a handoff; installing a provider establishes neither account setup nor integration. Use [verification gates](verification.md) and revision-bound test reports to establish tested scope.

Every product view must expose contextual assistance without sending secrets or arbitrary device data. A context contract needs owner/account identity, selected object and revision, allowed capabilities, sensitivity and return destination. The client boundary supports explicit connection/cancellation/proposal handling, and the debug-only service path supports real-provider development calls. An approved, registered Alpha auth client and real owner-scoped endpoint are still required before production connected-agent claims. Its renderer interface cannot substitute for durable backend receipts, origin validation and account isolation.

Existing native plugins substantially reduce implementation work, but directory names are insufficient evidence of Android support. The inspected native calendar API is Apple-oriented, the reminders package exposes macOS policy, and the filesystem package is an agent runtime service rather than a standalone Android picker. Native camera, talkmode, location, contacts and browser source exists; each needs an explicit consumer dependency and registration audit, build and on-device test.

The largest immediate risks are data integrity and lifecycle behavior: stale asynchronous results overwriting new drafts, results arriving after route/account changes, lost native callbacks during recreation, misleading handoff success labels, and a UI declaring a native handler absent or available from stale information. Address those before multiplying screens.

## Deliverables and how to use them

| Document | Purpose |
| --- | --- |
| [Flow audit and detailed PRD](flow-audit-and-prd.md) | Source-grounded baseline, nineteen flow families, ten cross-app journeys, accessibility and universal context/action rules |
| [Native capability research](native-capability-research.md) | Inspected plugin inventory, Android/AOSP ownership, official API/provider references, browser/credentials findings and native unknowns |
| [Flow implementation plan](flow-implementation-plan.md) | PRD coverage ledger, fourteen upstream/native work packages, dependency-ordered delivery and full-flow test matrix |
| [Agent integration contract](agent-integration.md) | Current transport boundary, upstream authentication limitations, lifecycle/approval semantics and real-integration acceptance |
| [Existing architecture](architecture.md) | Independent product boundary, immutable baseline, pinned upstream source and distribution model |
| [Verification guide](verification.md) | Required gates and rules for revision-bound evidence |

The PRD specifies the target. The implementation plan distinguishes the source-present subset from missing/provider-blocked work. Only revision-bound test reports establish what actually passed. None should be used as a substitute for the others.

## Original native and product decisions

This table records the research baseline. Consult [current capability status](mvp-current-status.md) for implementation and remaining acceptance; this table is not a current status ledger.

| Area | Working choice | What is still required |
| --- | --- | --- |
| Maps | Product destination entry; installed native map app first | Actual available map handler; licensed tiles/geocoding/routing if embedding; no invented ETA |
| Camera | Native capture or upstream camera plugin | Actual capture URI/pixels, review/retake and lifecycle; hardware verification separate |
| Photos/files | Scoped selection, photo preview, opaque native selected-file capability, 64-KiB UTF-8 text/JSON/XML read and native viewer open | Native tests pending; export/share/directory editing incomplete; process death deliberately requires reselection |
| Notes/voice | Local editing and drafts; native audio/recognition; cloud service explicitly disclosed when used | Recording/playback, actual transcription, correction, retention and interruption tests |
| Calendar | Native event handoff now; proper Android/provider adapter for read/write data | Account/calendar IDs, recurrence/timezone and authoritative readback |
| Reminders | Implemented source: persisted one-shot inexact AlarmManager records, permission/channel checks, cancel, boot/package-update restore and notification post/history | Actual native delivery evidence pending; recurrence, snooze/complete, exact timing and explicit timezone-change rules incomplete |
| Notifications | Implemented source: local-reminder channel, private lock-screen rendering, tap event and posted history | Actual post/tap/cold-start native tests pending; remote push and cross-app summaries incomplete |
| Workflows | Keep manual checklist labeled; use Eliza backend for actual automation | Trigger/run/approval/cancel/history and unknown-outcome reconciliation |
| Email/inbox | Native compose/open now; official OAuth and backend connector for complete inbox | Real account read/write scopes, attachment safety and send reconciliation |
| Settings | Product preferences; Android settings for native device controls | Actual status readback and refresh; no simulated Wi-Fi/battery/security controls |
| Browser | Native Chromium-based browser with qualified upstream observation/action bridge | Exact signed browser package, Alpha native-host identity, origin/frame/revision validation and update chain |
| Passwords | Provider-owned vault/autofill; branded Alpha setup and guidance | Provider package distribution, user enablement, real browser fill/passkey verification |
| Wallet | Deferred; optionally a truthful installed-wallet handoff | Separate provider/custody/payment/hardware architecture and acceptance |

## Browser, credentials and styling

AOSP/WebView is not itself a complete agent-controlled browser. Upstream has owned Chromium component/native-messaging work and a native browser-surface plugin with explicit package/certificate constraints. Its current canonical host identity must be adapted through a reviewed upstream consumer contract for Alpha's package. Third-party pages must never inherit the privileged Capacitor bridge.

The chosen working password candidate is unmodified Proton Pass with native Android provider enablement. Research supports its Android autofill/passkey workflows, not an embedded SDK that gives Alpha vault contents. Alpha may style its own setup/status/help and supported browser chrome; restyling provider secure UI needs supported options or a separately maintained, legally and operationally qualified fork. A proposed default installation does not establish redistribution/update terms or the ability to force provider enablement. See official references and alternatives in the [native research](native-capability-research.md).

The agent should receive only the credential task state and a fresh sanitized post-login observation. Vault passwords, OTPs, recovery material and passkey secrets remain outside its context. Provider/secure screens pause capture and action. A selected native default-provider setting alone does not prove fill works in the selected browser.

## Final source update and honest stopping points

`ReminderStore.java` stores device-local records and arms inexact `AlarmManager.setAndAllowWhileIdle` alarms. `ReminderReceiver.java` delivers through Android notifications and restores scheduled records after boot/package replacement. The UI lists scheduled/posted/cancelled/permission-denied state and can cancel a reminder. A notification being **posted** is not proof the user saw it or that it fired at an exact promised instant. Recurrence, snooze/complete, location triggers and full timezone-travel semantics remain target work. Native tests are not promoted to passing by this report.

`SelectedDocumentAccess.java` mints opaque IDs only from successful picker selections. It bounds UTF-8 text/JSON/XML reads to 64 KiB, rejects unsupported/binary/oversized content and can open a selected document in a native viewer. IDs are process-local and intentionally require reselection after process death. The user can explicitly copy selected text into the request draft and review/send it; there is no automatic file upload. This supports genuine selected-file read/open and deliberate text assistance, not a full file manager. Unsaved note drafts now persist locally and recover after restart; other domain drafts still need process-death recovery.

The development session comprises [dev-agent.mjs](https://github.com/eliza-research/alphaphone/blob/f3b1db5cf17250472407fa2b125c48ac94dbb969/scripts/dev-agent.mjs), the test-mocks-only native `DevelopmentAgentPlugin.java` (`android/app/src/testMocks`, debug variant only when `ELIZA_DEV_ALLOW_TEST_MOCKS=1`), and `runtime/development-transport.ts`. It calls the configured real provider through a local host service, keeps its bearer out of renderer JavaScript, validates context-bound proposals and limits executable operations to `create_note` and `open_view`. Exact retained proposal text is reviewed and consumed before execution. Local note creation verifies persisted readback; navigation still respects unsaved-edit review. Release-mode production authentication and durable remote execution are distinct missing work. Real-provider source and a successful local effect must still be verified in the applicable test record.

The terminal external blockers are production Alpha registration/authentication, live authorized mail/calendar accounts, an available speech-recognition/ASR provider, the owned Chromium native-host/component build, and provider setup/physical-image acceptance. They do not explain away incomplete product work such as inbox data views, full media/recording, recurrence, true workflows or document export. Phone portrait/landscape replaces the earlier tablet-oriented test emphasis. The [per-flow stopping-point ledger](flow-implementation-plan.md) labels each separately. Official Organic Maps, Thunderbird, Proton Pass and development Chromium installation/provenance are recorded in [native app distribution](native-app-distribution.md); installed does not mean signed-in, configured or agent-integrated.

## Decisions still requiring real-world evidence

The following working decisions allow coding to proceed; the unknowns remain real release or integration gates.

| Unknown | Best current assumption | Evidence that closes it |
| --- | --- | --- |
| Exact supported hardware and OS image | Develop against the Pixel 9 phone emulator definition as the closest installed approximation to Pixel 10; record phone geometry | Named hardware/image source, boot, peripherals, update and rollback |
| Alpha account/agent deployment | Fixed approved origin and existing Eliza pairing protocol | Registered package/signer/callback, owned test account, live request/readback/revoke |
| Voice service availability | Press-to-record/recognize; typed fallback; no implied offline ASR | Installed service and real audio, language, privacy/retention tests |
| Inbox/calendar provider | Official account-scoped cloud connector with separate write consent | Owned mailbox/calendar end-to-end and rate-limit/revoke coverage |
| Background reliability without GMS | Durable backend history plus qualified native scheduling/transport | Sleep/doze/reboot/offline and actual delivery measurements |
| Maps availability | Native handler if installed, explicit unavailable state otherwise | Installed map package and real query/navigation result |
| Browser signer/host | Consumer-adapted owned Chromium preserving upstream checks | Signed browser/host handshake and adversarial origin tests |
| Credential provisioning | Unmodified provider and explicit native enablement | Package provenance, compatible browser, unlock/fill/passkey and recovery tests |
| Local content lifecycle | App-private local notes, scoped URI references, explicit sharing | Restart/revoke/corrupt-storage/export tests and documented retention |
| Production support ownership | Required before release | Named signing/update/support owner and exercised recovery process |

## Test strategy and truthfulness

Favor end-to-end flows and real result readback. First prove note persistence, dirty-navigation decisions, native handoff payloads, selection access and callback lifecycle. Then prove the real account/agent vertical slice before connecting every domain. Follow with actual calendar/mail writes, native background reminders, workflow runs and browser/provider integration.

Record independently: source verification; both APK builds; Android instrumentation; phone computer-use walkthrough; real-provider results; AOSP image boot; physical-device and user acceptance. A no-handler error-path test can pass while the requested native functionality is still unavailable. Fixture-driven UI tests are useful for failure contracts but must remain labeled fixtures. Never create real outbound messages or payments merely to make a test green.

## Computer-use tooling investigation

The available macOS CUA API targets applications by name, bundle identifier or app path. Its documented window-ID selection and listWindows capability apply to Linux/Windows, not macOS. The current CUA inventory did not expose the standalone Android emulator. A local process inspection found the running emulator GUI at the SDK's unbundled `qemu/darwin-aarch64/qemu-system-aarch64` path. Android Studio was not found in `/Applications`, `~/Applications` or Google application-support configuration during this inspection.

The supported app-container approach is Android Studio's embedded Running Devices tool window. Android documents the setting to launch in that tool window and distinguishes the separate-window option. Once installed and configured, CUA can target the real Android Studio app and operate the embedded emulator through visible state. This was researched, not installed or validated here. [Android emulator window setting](https://developer.android.com/studio/run/emulator-launch-separate-window), [Android emulator usage](https://developer.android.com/studio/run/emulator).

A subsequently authorized local packaging experiment succeeded in making the emulator targetable by CUA: a temporary standard `.app` bundle with its own identifier and a copy of the actual GUI executable under `Contents/MacOS`, preserving SDK resource/library paths. Apple documents the executable and Info.plist structure. A shell wrapper that launches the external SDK emulator may still leave the real GUI process outside the bundle; a symlink may likewise resolve to the original path. Therefore merely registering a wrapper is not evidence that CUA can target its emulator window. [Apple bundle structure](https://developer.apple.com/library/archive/documentation/CoreFoundation/Conceptual/CFBundles/BundleTypes/BundleTypes.html), [CFBundleExecutable](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleexecutable).

Read-only binary inspection found `ANDROID_EMULATOR_LAUNCHER_DIR` support and relative dynamic-library searches at `@executable_path/../../../lib64/qt/lib`, `@loader_path` and `@loader_path/lib64`. Any copied-executable experiment must preserve those dependencies and the original SDK's resources without editing the SDK. After explicit coordination, the disposable AVD was stopped using `adb emu kill` and relaunched through `/tmp/alpha-emulator-app/Alpha Tablet Emulator.app` with `open -a`, using its existing AVD and original flags. Bundle identifier: `ai.elizaresearch.alpha-tablet-emulator`. The copied qemu binary uses symlinked SDK library/resource directories and Info.plist launch environment; the SDK was not edited. CUA successfully bound that exact app path and returned the window title `Android Emulator - alpha_flow_tablet_20260929:5554`. A CUA screenshot showed the actual emulator startup window and native toolbar. This proves CUA targetability, not completed Android boot or any Alpha flow acceptance. Startup logs are `/tmp/alpha-emulator-app/stdout.log` and `stderr.log`. No app was downloaded. Only visible CUA interaction should count as the requested computer-use walkthrough; adb instrumentation remains a distinct evidence layer.

## Phone target correction

The user corrected the target to Pixel 10 or similar phone. Earlier tablet wrapper/inventory observations above are historical setup evidence only. Current acceptance must use the new `alpha_flow_pixel_20260929` phone AVD, Pixel 9 hardware profile, Android API 35 AOSP default ARM64 image. No installed Pixel 10 definition was available. The existing temporary wrapper retains its old display name solely to preserve CUA targeting; its window title identifies the actual phone AVD. Production support requires separate physical Pixel 10/device-image evidence.

The new phone AVD completed boot (`sys.boot_completed=1`) and accepted all four previously verified native app APKs with successful install results. CUA returned the exact phone window title `Android Emulator - alpha_flow_pixel_20260929:5554`. These are environment readiness results; final Alpha phone-flow tests remain separately recorded.

## Phone UX source-review follow-up

The independent source review identified local fixes that are separate from external provider gates: bind file previews and async reads to the selected file identity; bound the total assistant/history height with the phone keyboard open; provide a reviewable multiline request editor for copied note/file text; open the specific reminder identified by a notification; and invalidate note proposals on discard/revert as well as typing. These are findings from the inspected source snapshot, to recheck after subsequent changes, not additional native test passes. Detailed repro paths are in the implementation plan. No emulator interaction was performed for this review.
