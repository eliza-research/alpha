# Local qualification — 2026-10-12

This run follows issues #377, #378 and #381. It does not close their physical,
live-account, production-signing or owner-acceptance requirements. The issue tracker changed during this run: #394–#425 now record approved
implementation requirements, published in PR #427. Policy approval is not delivery.
Existing campaign results qualify their original behavior only; they do not establish
acceptance of newly required local-only speech, reset, subscriptions or other changes.

## Source and APK identity

The initial app build used Alpha `f3ccefd382bd40b29b06117c97da366c1e9b75a7` and upstream
`13c98575987a121decc45b161b0c8a4ee698554e`. The upstream checkout was not edited.
The build worktree had an explicitly installed **unqualified speech candidate**;
its manifest diff and candidate origin are retained with build provenance.

The developer build completed standalone and launcher debug/release, both
instrumentation APKs, lint (0 errors, 81 warnings) and APK audits. Test mocks were
off. These APKs have **no packaged resident-agent runtime**. Release APKs are
unsigned and non-distributable. An APK build is not resident runtime execution,
speech qualification, image boot or physical-device acceptance.

| APK | SHA-256 |
| --- | --- |
| standalone debug | `1564ab89059f3232dfb4241106935df098ae469e1b5bfb319ab52c4e5d8d5156` |
| standalone release | `838eb2ab538385778f492f40fc1abf6c6323126f741308479637826a9307d653` |
| launcher debug | `13b7b73e75dbfc1d5bd7f04728ccec9d0535c3f9298f8d273b5931e032d235e7` |
| launcher release | `73fdd8b4c9a8b265ab7ebaacf33604a26b9a83fdb55c0b3895ad01b0b5ee3d9a` |

The immutable local build archive is
`/home/shaw/.codex/worktrees/review-open-prs-2432/alphaphone/test-results/current-source-build/flag-off-verified-build`.
Its `apk-manifest.json` SHA-256 is
`4f9d4bc23689f59b041551fc4587aaa654e8e3db9fc805aa679986369a69e718`.
The sibling `flag-off-campaign-archive` contains admitted developer campaign inputs;
it is not a qualified distribution archive. A separate test-mocks build also completed
all four APKs and both instrumentation APKs; its sibling `test-mocks-verified-build`
and `test-mocks-campaign-archive` retain those inputs separately. The build restored
production web/assets flags afterward. `archive-sha256.json` hashes the retained
build evidence files.

## Rebuilt product APKs

The latest product archive used for accessibility and granted-notification checks
is `assistant-group-build`, product source `7011c8ba`. It includes rotation, cookies,
secure-store patching and the assistant semantic group. Both debug/release variants,
instrumentation, lint and authenticated APK patch receipts passed. The same
unqualified speech/runtime/signing limits stated above apply.

| APK | SHA-256 |
| --- | --- |
| standalone debug | `1e13b5266c2a092b3fb71f29eb9e1fc6692b51a31ed3fe0659553bacb3ad703e` |
| standalone release | `e2f06c295df38b63c46ab05ae76e593c20a398480e415b3d4eab6efd954774df` |
| launcher debug | `c640a81f2d202ea38cee39615c0056abf252c47479ede0cab658613668dbce16` |
| launcher release | `be60a7ba8620c3c667642699301969bbb2264f93005f87d9224503c87e3ac583` |

The `notes-heap-fixture-build` archive retains identical app bytes and only replaces
instrumentation with the corrected snapshot fixture (`142623df`). Each native run
records the exact app and instrumentation hashes independently.

The subsequent `secure-store-streamed-build` (`7a1c367f`) has the final streamed
secure-store fix. Its developer artifacts retain the same distribution limitations.

| APK | SHA-256 |
| --- | --- |
| standalone debug | `53392b770088e33b2c3f44aa7c3410d94835375f9a89557bc9859520f52bbda5` |
| standalone release | `cb7b20515e9b5ebc2df502368187a698a41434f67308b81ab57ea7130f2831ef` |
| launcher debug | `761a325c609379fce19b2b60223bd6df3da910538d47204693dfbf27783aec13` |
| launcher release | `b304c9d9b50037b697d1cda082806cf6ff85f258158c6cb9731819a52dde838e` |

## Source verification

The integrated `npm run verify` at `d8313c5f` passed: 737 tests, 733 passing, four existing
TODOs and no failures, followed by Notes query flow, production build and the
395-file flag-off bundle audit. The first combined attempt retained one Calendar
runner subprocess timeout during host memory pressure (728 passing, one failure,
four TODOs). It was not hidden or counted as a pass; the complete rerun passed once
the Android builds finished. Logs are in the integration worktree's
`test-results/local-acceptance/integrated-verify{,-rerun}.log` and
`integrated-notice-fix-verify.log`. The later full fixture verification is retained in
`integrated-fixture-verify.log`.

The later complete `npm run verify` at `4e2e24e8` passed 749 tests: 745 passing,
four TODOs, zero failures, followed by Notes flow, production build and the
395-file bundle audit. The earlier patched-store attempt failed because diagnostic
capture used the wrong accessibility connection and scanners could not resolve the
staged native module; both defects were corrected. Its Inbox child-suite failure
could not be decoded from Node test IPC output. A separately reproduced fixture race
used timer ticks before WebCrypto completed; the fixture now waits for actual digest
work and child failures retain readable output. Original failed logs remain retained.
The complete verification with those corrections at `246944e6` also passed: 749 tests,
745 passing, four TODOs, followed by Notes flow and the 395-file production audit
(`integrated-final-fixtures-verify.log`). The subsequent Android-compatible snapshot
reader change is covered by the same focused JVM fixture and instrumentation compile.

## Controlled renderer and host recovery

At test commit `41542dc20cc6b24078d52de2a8f8e4b4dff3460e`, all 13 voice/navigation
probes passed. They use the real voice coordinator, send path and navigation
handshake with synthetic media and Cloud transport ports. Coverage includes empty
ASR, explicit retry after billing failure, late ASR after Stop/account change,
held claim/ACK retirement, and stale capture-stop callbacks. They do not contact a
real Cloud account, record a microphone, or establish audible latency. The complete 43-case browser recovery inventory also passed across retained runs,
covering account isolation, workflow interruption/unknown outcomes, voice-note save
ownership and digest scheduling, including a repeated daylight-saving hour. The
follow-up media-driver readiness assertion at `ea11eadd9280b5cfe770ef73c23599f97afceffe`
passed its targeted rerun.

Host SIGKILL digest recovery passed with the pinned prepared source unchanged.
The same unknown-outcome run survived interruption, duplicate occurrence admission
did not replay inference, and an overdue schedule produced one missed occurrence
and a future next occurrence. This is a host process test with synthetic state,
not proof of execution on a powered-off phone or hosted delivery.

Receipts and hashes are in
`/home/shaw/.codex/worktrees/app-local-qualification/alphaphone/artifacts/app-local-qualification-20261012/evidence.json`.
Resource-related page-load timeouts are retained as incomplete runs. They are not
counted as behavior passes or failures.

## Existing Cuttlefish image, read-only

The new `scripts/verify-cuttlefish-launcher.ts` passed on the already booted image:
`Alpha/alpha_cf_x86_64_phone/vsoc_x86_64_only:Baklava/CP2A.260605.016/eng.shaw:userdebug/test-keys`.
The checked system APK hash was
`1312001d90af337185432fa3fa744819851301e0e4ceb4735e67dbd82c8231cf`, which differs
from this run's new APKs. It is therefore **older-image installation evidence only**.

The check established enforcing SELinux, foreground/unlocked user 0, exact staged
system APK bytes, Alpha HOME, a real alternate system launcher, Clock handlers and
WebView presence. Settings FallbackHome alone is rejected as a recovery launcher.
Certificate identity is inherited from the independently retained staging descriptor
through identical APK bytes, not freshly extracted from the installed signature.
No install, role change, alarm or runtime request was made.

The retained report is
`/home/shaw/.codex/worktrees/local-acceptance-integration/alphaphone/test-results/local-acceptance/existing-cuttlefish-postboot-final.json`.
It does not prove current-source image integration, physical boot, resident-agent
execution, alarm ringing, WebView security freshness, signing or OTA rollback.

## Offline native speech on x86_64

On the owned Android 35/x86_64 emulator, all four `LocalSpeechInstrumentedTest`
methods across standalone and launcher passed against the exact flag-off APKs
listed above. Networking was disabled and host audio output was disabled. The tests
exercised prerecorded recognition, synthesis/recognition round-trip, and model-holder
reuse, release and reopen. The bridge and sentence-cancellation classes added four
more passing methods across both variants. These are eight native method passes,
not end-to-end Cloud voice or physical audio acceptance.

The first secondary-user attempt failed while creating the fixture evidence directory,
before model execution. Its failure and successful cleanup remain retained. The
passing rerun used the dedicated emulator's clean primary user with the same APKs;
no source or model bytes were changed to obtain the pass. Original network flags
were restored with readback before subsequent UI campaigns.

Receipts are under
`/home/shaw/.codex/worktrees/native-qualification/alphaphone/test-results/native-qualification/`:
`speech-owner-001` holds the model/holder JSON measurements and `speech-bridge-001`
the bridge/cancellation results. Installed SDK emulator images on this host are
x86_64 only. No current ARM64 execution result is claimed, and attached physical
phones were not modified. The candidate remains unqualified for distribution.

## Approval-notice capture race found and fixed

The original native process-death campaign found that one OS-owned tap could be
queued more than once while the worker had persisted its capture but the main
thread had not yet cleared the Intent. That changed its pending order from one to
two. The app-owned fix retains the actual Intent/token through that gap, releases
queue rejection for retry, and keeps failed persistence drainable. New Intent
objects remain admissible. This is an in-process duplicate-queue fix, not a new
exactly-once guarantee across process recreation.

The fix has a JVM regression covering identity, stale-token release, retry and
capacity. It was built as `261f05f1` with the same explicitly unqualified speech
candidate; all four flag-off variants, both instrumentation APKs and lint passed.
New archives and hashes are in
`/home/shaw/.codex/worktrees/review-open-prs-2432/alphaphone/test-results/notice-intent-dedup-build/`.
The original archives were preserved. Both variants then passed all four
approval-notice process-death/owner-change recovery methods, with disposable users
removed and the original HOME restored. This proves those synthetic emulator
scenarios under the then-current behavior only. Approved #425 now requires quiet
restoration after owner return; that separate implementation is not qualified by this result.

## Rotation defect and fixture corrections

The native rotation test found that Android WebView 124 reported an expanded
863×1757 viewport after returning to a roughly 412×839 portrait content area.
The renderer fed those expanded measurements back into its canvas, clipping controls.
The fix measures the fitted root client box and bounds visual viewport height to it,
while preserving a smaller keyboard viewport. Both controlled regression cases
failed on the original code; all five native-insets browser cases passed after the
fix at `6ad88d88`. Both variants then passed the actual native Rotation test using the rebuilt
`e03b8875` app APKs (`rotation-cookies-stock-001` in the native evidence directory).

Other fixture corrections select the exact assistant Activity, wait for the Android
share chooser to acquire focus before pressing Back, refresh accessibility nodes
without retrying clicks, and clip accessibility bounds to actual ancestor scrollports.
The original failures remain retained. The Notes capacity fixture now uses bounded
records and a small edit against the same 32 MiB collection limit; Android execution
then exposed native Java heap exhaustion. An explicit upstream patch preserves the
format, AES/GCM/AAD, JSON validation and byte limits while bounding ciphertext
readback allocation and ending decrypt-buffer lifetimes before JSON parsing.
The independent real 32 MiB write/read/CAS host regression passed at a 192 MiB heap,
including malformed authenticated JSON and committed-byte corruption guards.
All four developer APK variants subsequently built with this patch at `47e4b138`;
APK audits verify the embedded source-patch receipt. Native capacity testing then
reached a second heap failure while Capacitor serialized the collection. The fixture
retained an extra 32 MiB expected String; a private digest/file snapshot now releases
that copy before opening the renderer. The corrected standalone rerun still exhausted the 192 MiB Java heap, now in
Android Keystore authenticated decryption (`notes-snapshot-fixed-001`). A further
product memory fix was required; that intermediate build is not counted as passing.

The follow-up at `cf3c282a` streams the same v1 ciphertext into AES/GCM in
16 KiB chunks and serializes renderer storage work through response serialization.
Authentication, format, limits and CAS semantics remain unchanged. Independent
host checks passed with a real 32 MiB record plus 24 MiB additional live allocation
under a 192 MiB heap. The complete source verification passed 751 tests: 747 passing,
four TODOs, followed by Notes flow and the 395-file production audit
(`integrated-streamed-store-verify.log`).

The matching developer build `7a1c367f` passed all four APK variants, instrumentation,
lint and APK receipt checks. **Both native variants then passed all four Notes
methods (eight total) on the original stock Google WebView 124 and 192 MiB Java
heap.** This includes real 32 MiB capacity refusal after a small edit, retained
recovery draft, unchanged saved collection and exact cleanup, plus draft recreation,
large bridge refusal and exact-cap/CAS/multibyte checks. Receipt:
`notes-streamed-stock-001`, with raw failures from earlier builds preserved. Installed
APKs were removed and the newer test provider restored afterward.

## Accessibility traversal

The Settings scroll content and floating assistant pill intentionally occupy separate
regions. The renderer now exposes the assistant controls as a named accessible group;
the native check validates geometric order within each region and requires the single
assistant group to follow main content. Browser focus/tap checks passed at normal and
200% sizing. Both native variants then passed the full 200% Home, repeated shade-click,
Settings and composer case using `7011c8ba` product APKs and `50b750f7` instrumentation.
Evidence: `accessibility-group-fixed-001` in the native archive. Screenshot diagnostics
preserve the accessibility-service connection flags used by the stand-in reader.

## Granted notification visibility

A published notification is not necessarily immediately observable through Android
NotificationManager. The fixture now waits up to ten seconds for visibility after
one publication, without retrying the write. Both variants passed real emulator
notification redaction, tap, Activity recreation, one-time consumption and withdrawal
with the `7011c8ba` apps and `50b750f7` instrumentation. Receipts are
`notice-visible-standalone-001` and `notice-visible-launcher-001`; disposable users
were removed and the original HOME restored.

## Normal-tab cookie policy

Approved #403 changes only child-browser WebView third-party cookie acceptance:
normal tabs allow it; private tabs retain blocking. Both variants passed the native
synthetic HTTPS cross-site iframe cookie test at `e03b8875`, including normal-profile
sharing and unchanged privileged-host policy/isolation. The private cases were
explicitly skipped on stock WebView 124 because scoped deletion is unavailable.
On the owned emulator with verified WebView `145.0.7632.218`, the rebuilt
`7011c8ba` apps passed all four normal/private cookie-policy methods and ten
sign-in storage methods across both variants, including tab close, popup profile
isolation and explicit Clear browsing data cancellation/confirmation. Dedicated
restart campaigns then passed prepare, real force-stop/new-PID verification and
cleanup for both variants: normal cookies/storage survived, and the exact previous
private profile was removed. The provider was explicitly installed into each owned
disposable user and its actual selection recorded before/after. Earlier runs that
fell back to stock 124 remain separately annotated and are not private-profile proof.

Receipts: `browser-webview145-001` and
`browser-signin-owned145-{standalone,launcher}-001`, including exact product and
`142623df` instrumentation hashes. These complete the local synthetic behavior
checks for #403. No live sign-in was performed. WebView 145 still lacked isolated-world
reading injection; supported-path reading checks were explicitly skipped, with the
unavailable path checked instead.

## Calendar large-text CI follow-up

The full Chromium shard at `a425759e` exposed two reproducible failures: the
24px half-hour Calendar block clipped its title at 200% text in portrait and
landscape. The timeline now scales event heights and positions, hour labels,
current-time line and total scroll height together using the measured text scale.
This preserves time alignment while giving short events room for the title.

The unchanged accessibility sweep reproduced both failures before the fix
(14 other selected cases passed). After the fix, all 40 Calendar view/subview
checks passed across light/dark, portrait/landscape and 200% text. Repository
verification passed 751 tests (747 pass, four existing TODOs), Notes query flow,
production build and 395-file bundle audit. Refreshed Android builds and CI are
pending; this renderer result does not replace the earlier APK-bound native proof.

## Pending results in this run

Further native UI, permissions, provider and restart campaigns are still running. No
completion claim is made for those campaigns here. Native model tests use generated/prerecorded audio and
an owned emulator with host audio disabled; they do not establish physical audio
acceptance. Final receipts will replace this section after the campaigns finish.
