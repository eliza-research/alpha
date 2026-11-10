# Develop state review, November 10, 2026

The working branch starts at develop `c39ecaddada46db57053af9d824d857a8880cf75`
and SDK `00edc8ce2e8b9bd47ad5cce33e1dff66c2fe47c0`. Its initial registry
contains 259 models across application, service, native and historical families.
Existing models were checked before selecting these additions.

| Boundary | Existing coverage | Work in this change |
| --- | --- | --- |
| Prepared workflow worker | `WorkflowWorkerStaging` checks artifact verification and destination publication. `PreparedSourceStamp` covers source admission. | Execute preparation and exact reuse, source/lock drift during a held producer, corrupt output, failure before output, and interrupted output followed by a fresh-directory retry. |
| Browser Notes recording journal | `NotesRecorderMediaAdmission` checks capture admission. | Execute clip and manifest persistence, text-preserving retry, exact owner/folder binding, reads and retirement using closed document ports. |
| Scheduled snooze | `ScheduledTaskControls` checks the renderer's fixed ten-minute command. | Execute recurrence-relative time calculation and exact protocol admission, including saved time zones, DST, existing deferrals and stale responses. |
| Cloud keyboard dictation | `KeyboardDictation` checks native policy decisions. | Execute route/provider snapshot validation, cancellation, PCM disposal, connection cleanup and transcript acceptance with closed transport. |

Source replays retain hashes, concrete observations and model transition names.
They check finite schedules and their declared projections. They do not establish
application-wide state completeness, actual providers, installed Android behavior
or unrestricted concurrent execution. The new coverage must be registered in the
normal family runner and rechecked after integration.

The current AGENTS.md requires README.md and docs/prd.md. The former
architecture and implementation-plan documents were removed from develop.
Shared code changes require an upstream commit and reviewed source pin.


The four additions bring the registry to 263 models. Integrated source replays
cover 88 traces and 421 checkpoints. All fields in their selected projections
are observed. The worker and snooze models passed depth-eight symbolic checks.
Notes and keyboard attempts could not start Apalache within the startup deadline.
Their scenario and simulation checks passed.

Android local build preparation refuses the current pin because its checked-in
voice qualification record names SDK `75b44015561368fc8ca982b70b8bafbdf1672a7b`.
It does not admit the current SDK pin. No APK or device result is established.


Review added complete worker-artifact verification and independent tree digests.
The replay rechecks preserved incomplete output after switching to a fresh
build directory. It covers required-file corruption, extra files and malformed
manifests. Snooze coverage includes repeated deferrals in the device-local zone.
The autumn repeated-hour trace records the current recurrence clamp. A saved
first-hour deferral may move to the second occurrence of the scheduled local
time. The replay establishes this behavior, while its intended policy remains
an explicit review question.
