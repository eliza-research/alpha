# Browser implementation review

The product renderer lives in `apps/app`; shared platform code comes from the
reviewed `vendor/eliza` pin. The primary agent runs on Android, with a local host
for browser development. Hosted inference is separate from local orchestration.
See [architecture](architecture.md), [MVP scope](mvp-scope-and-gap-report.md) and
[current requirement status](mvp-current-status.md) for product boundaries.

This document has two parts. The sections up to
[Historical checkpoints](#historical-checkpoints) describe the browser build as it is
on main and were reconciled with source on 2026-10-10. Everything under Historical
checkpoints is a dated record of an earlier source revision, kept as written. Neither
part claims that any feature, or the current main revision, has passed acceptance.

## Reconciliation with main — 2026-10-10

Compared on 2026-10-10 with main `dfacccb3` (upstream pin `40dbe96bd1` in
`upstream.lock.json`): product source, the tests in `test/`, the workflow files, and the
evidence recorded in [current status](mvp-current-status.md#current-qualification-evidence).
The checkpoints below are dated October 5 and 6 and were written at consumer revisions
up to `72783b3f`; main is 733 commits past that revision. The consumer revisions checked
(`72783b3f`, `ffa72bcc`, `c5e11759`, `07d52639`, `7d3e91e9`, `f633e490`, `31fc1fb0`,
`b021874f`, `978694b0`, `4145e3a9` and `e2f62059`) are ancestors of main, so their results
are results for their own source, and none of them qualifies the current head.

### Evidence at the current source

Evidence classes are those of [current status](mvp-current-status.md#qualification):
S source/test, B APK build, E emulator, I AOSP image, R real integration, D device/user.
A browser result is class S whatever it drives.

| Class | What exists for main `dfacccb3` | What it does not show |
| --- | --- | --- |
| S, local | `npm run verify` exited 0 on 2026-10-10 at `53b53a0a` on branch `claude/r9-status-docs-reconcile`, which is main `dfacccb3` plus this reconciliation's documentation changes; later commits on that branch change these two documents and the MVP-07 ledger entry only: 643 tests, 639 passed, 0 failed, 0 skipped, 4 TODO; typecheck, the flag-off build and the production bundle audit passed (395 files, `testMocks=false`). A run started on `dfacccb3` before the documents were edited gave the same counts and exit 0. The independent review ran it again at `e0204c94` (its corrections to these documents; the commit after it only adds this sentence): exit 0, the same counts and the same audit result. | Anything outside the repository's own tests and the flag-off web bundle. |
| S, local Playwright | Two runs on 2026-10-10, each on `dfacccb3` with only documentation changes in the tree, 4 workers. First run (the reconciliation): the whole `production` project gave 174 passed and 1 failed (`accessibility-sweep.production.spec.ts`, "production landscape keeps every control on screen: live Calendar new event", a 30-second timeout on a Tab key press); that spec run again by itself passed 78 of 78. The same run reported 595 passed for the Chromium list below; that list has 592 cases, so the figure is not reproduced and is not relied on. Second run (the independent review of this reconciliation, at `c039780d` plus its documentation corrections): Chromium, 21 specs (the owning specs named in the feature sections below, `privacy-per-connection`, `accessibility-audit`, `accessibility-sweep`, `chat-voice-mode` and journeys A to F except `journey-f-hosted-result`): 592 cases, 591 passed, 0 failed, 1 skipped (`browser-host-disclosure.spec.ts`, which skips itself without `VITE_LOCAL_AGENT=1`). The whole `production` project: 175 passed, 0 failed. The timeout of the first run was not reproduced and its cause is not established; other work was using the same host both times. Both results of the full lane stand as recorded: one run with a failure and one without. | The other Chromium specs, Firefox and WebKit, which were not run for this reconciliation; a real agent, account or provider. |
| S, hosted | Browser MVP run `38107877246` on pull request #390 at `7e70ec01`, whose tree is identical to main `dfacccb3` (`git rev-parse` of both trees): Repository verification, Chromium shards 1/3, 2/3 and 3/3 and the flag-off production surface job concluded `success`; the Firefox/WebKit storage job was skipped, because `browser.yml` runs it only on a manual dispatch with the cross-browser input. The push run `38109307907` at `dfacccb3` itself ran only Repository verification (`success`); its shard and production jobs were skipped because `browser.yml` does not run them on a push, and its storage job for the same reason as above. Job conclusions were read through the GitHub API on 2026-10-10; test counts, logs and skipped cases inside the shards were not inspected. | Cross-engine storage at this source. Which cases a shard skipped. |
| B, hosted | Android foundation run `38109307871` at `dfacccb3`: the `build` job concluded `success`, including "Build flag-off distribution APKs" (`npm run android:build -- --allow-unpackaged-runtime --skip-instrumentation`) and "Require test-mock-free distribution" (four manifest rows, each with the flag-off bundle audit passed). It installs the speech runtime as explicitly unqualified and stages no resident runtime, so its releases are `distributable: false`. Step conclusions were read through the GitHub API; logs and artifacts were not inspected, and the artifacts expire after 3 days. [Current status](mvp-current-status.md) does not record this run. | A distributable build, a signed build, installation, or any behavior of an installed APK. |
| E, I, R, D | None at the current source. | — |

### What the code has overtaken

Each row names a statement that appears in a historical checkpoint below, or that stood in
the undated sections before this reconciliation, and what is true on main.

| Statement in the earlier text | On main `dfacccb3` | Source |
| --- | --- | --- |
| "Consolidated current checkpoint" at consumer `72783b3f`, resident runtime `3cca1ee4` | Not current. The pin is `40dbe96bd1`, identical to elizaOS `develop` when recorded on 2026-10-10. Results at pins `3cca1ee4`, `19afed28`, `cc682e9a` and `95924e90` are historical. | `upstream.lock.json`, `scripts/ci/upstream-reachability.json` |
| References to runtime patches ("no new runtime patch") | The product carries no local source patch; the `patches` directory is gone. | repository tree |
| 689 (and 631 to 674) repository tests; a 245-file bundle audit | Counts of their own revisions. The count at the current source is in the table above. | `npm run verify` |
| Whisper and Kokoro on the development host as the speech evidence | Flag-off builds select Eliza Cloud speech for chat voice, Notes transcription and read-aloud, and a signed-out user gets no voice. The explicit on-device and manual routes are selectable only in test-mocks builds (`selectVoiceRoute`). The host campaigns below are development-host results at old pins. Which route is the product policy is pending (see below). | `apps/app/src/runtime/voice-selection.ts`, `test/browser/production-surface.spec.ts` |
| "Optional Cloud/remote sessions" in the surface table | Flag-off Android always runs the resident agent (P-43) and offers Cloud sign-in for its inference credits; it refuses remote pairing and offers no Cloud agent. The flag-off web build offers remote pairing over HTTPS, says it needs the local agent (no offline mode, A-27) and states that Cloud sign-in is unavailable. Cloud agent selection exists only in the development Cloud fixture. | `apps/app/src/runtime/connection-ui.tsx`, `ConnectionRoutes.java`, `test/browser/connection-boundaries.production.spec.ts` |
| "Device development controls" as part of Home and settings | Present only in test-mocks builds; the flag-off bundle audit and production lane check their absence. | `scripts/audit-production-bundle.mjs`, `test/browser/production-surface.spec.ts` |
| Inbox: "disclosed local draft/attachment simulator" | Inbox has provider-cursor paging, a Sent view, reviewed send, archive, Trash and undo, read state where the server advertises it, attachment open and save, a From switcher and unsaved-edit recovery, all against a synthetic provider. Local development messages exist only in test-mocks builds. | `apps/app/src/prototype/inbox-cloud-adapter.ts`, `inbox-unsaved.ts`, `test/browser/journey-f-reviewed-send.spec.ts` |
| Workflows and digests: "schedules" | Phone-authored typed workflows have manual triggers only and are never scheduled. Scheduled execution exists for digests; a time that passes while the host is not running is recorded once as missed and never run later. | `apps/app/src/runtime/phone-workflow-authoring.ts`, `test/digest-occurrence-delivery.test.mjs` |
| Notes: no Trash mentioned | Deleted text, checklist, link and voice notes go to a Trash that empties after 3 days (P-06). | `apps/app/src/prototype/notes-trash-adapter.ts` |
| Browser: per-tab behavior without persistent sign-ins | Native tabs keep sign-ins in one persistent profile with an ephemeral private tab (P-04); an integrated password manager with an Android Autofill provider exists (P-05). The browser build renders sandboxed iframes and states that Autofill is unavailable. | [current status](mvp-current-status.md), `test/browser/journey-e-browser-credentials.spec.ts` |
| Maps: a provider is assumed | No flag-off build has a Maps provider; the user reads "Connect a Maps provider to search places and plan routes." (A-23). | `apps/app/src/maps/regional-provider.ts` (provider configuration), `test/browser/journey-core-loops.production.spec.ts` (the sentence, which comes from the pinned Maps plugin) |
| "Explicit agreement on ... messaging scope"; "Telegram/Discord scope conflicts require product disposition" | Decided on October 7 (P-02): Gmail/Email is in scope; Telegram and Discord are deferred. Powered-off scheduling (A-09) is still pending. | [decisions](decisions.md#october-7-owner-product-decisions) |
| Axe-core 4.14.0 scans of 20, 86 and 102 states | axe-core is not a dependency of this repository (`git log -S axe-core -- package.json` finds no commit that added it), so those scans cannot be repeated from a clean checkout. The automated checks on main are the dependency-free rules in `test/browser/accessibility-audit.ts` and the accessibility specs that use them. | `test/browser/accessibility-audit.ts`, `accessibility-sweep.spec.ts`, `accessibility-sweep.production.spec.ts` |
| "PR 317 remains unqualified", "the separate unmerged runtime upgrade in PR 317" | PR 317 merged on 2026-10-06 as `c5e11759`. The pin it adopted has since been replaced. | GitHub, `git log` |
| "Still running", "pending", "in progress", "remains a separate gate" for a named run | Every such run reached a terminal state that a later checkpoint records, or belongs to a revision that is no longer current. None is waiting now. | the later checkpoints |
| "No local Android build was run" | True of those browser campaigns. Developer APKs were built later at `1de85a13` and `d3dc9977` (historical), and a hosted build exists at the current source (class B above). | [current status](mvp-current-status.md#current-qualification-evidence) |
| `npm run android:build` as the build to run | The chained build is `npm run android:build:local`; plain `npm run android:build` stops before Gradle when an input is missing. | `package.json` |
| Evidence paths under `artifacts/` and `test-results/` in the "primary", "verification", "qualification", `alpha-live-settings-review` and `alpha-album-documents` checkouts | Both directories are ignored by Git. Those files were never committed, they are not in this repository, and they were not available to this reconciliation. The paths are kept as the record of where each result was written. | `.gitignore` |
| Development host on ports 47849 and 5317 | Still the defaults of `npm run dev`. The prepared runtime directory named after `3cca1ee4` is an old pin's. | `scripts/dev-local.mjs` |

### Pending: voice

The wording about voice in this document is not final. P-01 records that voice does not
auto-send; P-07 records Eliza Cloud as the current default route; the [PRD](prd.md) row
AP-06 says local first with Cloud as a disclosed opt-in; the code sends each new spoken
turn of an ongoing Cloud conversation (`test/browser/chat-voice-mode.spec.ts`). Which of
these is the policy is inventory item MVP-01, with A-04, A-10 and A-24. The Voice row of
the surface inventory states what the code does and takes no position; the six-second
latency target and its method (A-10) have no measurement of any kind.

## Surface inventory

Reconciled on 2026-10-10. "On main" is implementation with class S tests only. The table
that stood here described the October 5 source; its rows are replaced, and the differences
are listed under [What the code has overtaken](#what-the-code-has-overtaken).

| Surface | On main | Remaining acceptance |
| --- | --- | --- |
| Home and settings | Branded Home with clock, agenda cards and the grid of enabled views, an All-apps drawer with search, themes, the assistant dock and a landscape layout for Home, the composer and the docked conversation. Settings shows the states Android reports and hands off to Android pages. Device development controls exist only in test-mocks builds. | Native boot, lock, HOME role and actual system controls; whether rotation ships is A-22. |
| Connection and assistant | Flag-off web build: remote pairing over HTTPS, no offline mode (A-27); Cloud sign-in is stated as unavailable. Flag-off Android: the resident agent always runs (P-43); the "Your agent" dialog shows its state and offers Cloud sign-in for inference. Conversation history, reviewed proposals and receipts, Stop with one cancel request, conversation-bound drafts. The local development host and the Cloud fixture exist only in test-mocks builds. | Real owner/provider authorization, revoke, process recovery and complete task journeys; A-02, A-16 and A-26. |
| Voice | Flag-off: Eliza Cloud route for chat voice, Notes transcription and read-aloud; signed out, voice asks for Cloud sign-in and captures nothing. Editable transcript review, owned playback and cancellation. An ongoing Cloud conversation sends each new spoken turn. Explicit on-device and manual routes are selectable only in test-mocks builds. | Policy pending (MVP-01, A-04, A-24). Then real Cloud speech with a signed-in account, transcript quality, the latency method and target (A-10), physical microphone/speaker/Bluetooth and lifecycle. |
| Inbox | Account-bound Gmail adapter and operation journal with paging, Sent, reviewed send, archive, Trash and undo, read state, attachments, local drafts and unsaved-edit recovery; synthetic provider only. | Real provider grants (the Google code exchange returns 401), approved read/send journeys, account isolation and uncertain-outcome recovery; A-07 and A-15. |
| Calendar | Web build: browser-local persistent events, zoned/all-day dates, recurring series and overrides, preferences, local guest/meeting UI, alerts, backup and reviewed reset, one review step before deletion. Android shows only calendars held by CalendarProvider; calendars connected through Eliza Cloud are not shown. | Transactional storage below; provider read-back instrumentation, real invitations/conferencing; deletion recovery is A-25. |
| Reminders and Clock | Shared native reminder engine, browser reminders, Done/Snooze/repeats, foreground alarm ownership and a reviewed native Clock handoff whose receipt is a dispatch receipt. | Physical audibility, Doze/OEM delivery, reboot, DND and hardware time-zone changes; alarm ownership is A-11. |
| Browser | Browser build: sandboxed frames, bookmarks, navigation, downloads, reviewed reading. Native: isolated browser surface with a persistent sign-in profile, an ephemeral private tab and the integrated password manager. | Cross-origin access limits, sign-in/private-tab/pop-up/app-link and fill instrumentation, release WebView lifecycle; passkeys are not implemented (A-12). |
| Camera and Scan | Capture/import, local OCR (English), reviewed text/links/calendar suggestions, multipage drafts, perspective correction, page-edge suggestions and searchable PDF. | Physical camera/torch/permissions, OCR photo quality, edge quality and interrupted capture. |
| Photos | Browser build: IndexedDB library, stable pagination, albums, batch actions, edit-as-copy and video editing. Android shows only media Alpha captured (A-18). | Physical capture, catalog scale and interrupted saves; clearing site data removes browser media. |
| Notes and Files | Browser-local text/audio/documents, reviewed selected content, exact-byte import/export, Notes Trash with 3-day emptying; native secure Notes and SAF. | Native provider differences, interrupted writes, Trash expiry on a device, cross-app attachments and physical audio; no Notes sync is promised. |
| Workflows and digests | Manual-trigger typed workflows with authoring, approval, cancellation and receipts/results; digest schedules with an explicit missed record; reviewed upstream worker/runtime. | Resident scheduling on a phone, interruption/restart, result delivery and real account sources; a powered-off phone cannot execute locally (A-09). |
| Notifications | Owner-bound notices, receipt recovery and Calendar/reminder integration. | Native background/channel behavior and physical delivery; new-mail notifications are not implemented (A-05). |
| Maps | Shared map renderer; a selected event location enters Maps once. The emulator gateway exists only in test-mocks builds; flag-off builds have no provider (`VITE_MAPS_BASE_URL` is unset) and say so. | A production provider and its licence (A-23), then endpoint/TLS, data coverage, location permissions and physical navigation. |
| Phone/SMS/Contacts and Wallet | Disabled shipping routes (`apps/app/src/prototype/mvp-features.ts`); simulators only on the development server. | Scope disposition before enabling production routes; simulations do not establish telecom, payment or external-message acceptance. |

## Browser storage

### Connected host disclosure

State on 2026-10-10: this describes the development-host connection, which exists only in
test-mocks builds; `test/browser/browser-host-disclosure.spec.ts` and
`test/browser/privacy-per-connection.spec.ts` are the owning specs on main. Flag-off disclosure is per connection and no connection claims that data stays local
([current status](mvp-current-status.md), Privacy and outbound context).

An earlier live-browser review (date and source revision not recorded here) found that connected agent memory was still labeled
"Not connected" and browser About omitted agent location. Privacy and Developer
now distinguish an absent connection from unreported memory usage. Browser About
shows the current agent and execution location; browser Models describes speech
on the development computer. For the resident browser connection, Privacy states
that prompts and selected context go to the development host and its configured
inference provider. Unreported provider/model and redaction details remain unknown;
this does not enable swaps or claim that requests stay local.

Historical result (source revision not recorded): the authenticated browser-host fixture and all
ten then-existing per-connection privacy cases passed, along with type checking. The
settled host Privacy screenshot was inspected at 412 × 915. Evidence was written to the
`alpha-live-settings-review` checkout under `artifacts/settings-review/` (not in Git).
On main the host regression (`browser-host-disclosure.spec.ts`) is run by the
"Exercise synthetic local-agent speech profile" step of `browser.yml`, on the first shard
and only when the change gate selects the speech profile; without `VITE_LOCAL_AGENT=1` the
spec skips itself, so an ordinary Chromium run does not exercise it. The step's transport is
synthetic and cannot contact a real inference provider. Physical/native acceptance
remains separate.

The [storage ownership map](browser-storage.md) defines each canonical domain,
its recovery boundary, independent preference contracts and native
Clock handoff history. Shared IndexedDB
transactions bind changes to receipts and revisions. Initialization must use the
same serialization boundary as edits and preserve an existing revision.

Recovery retains exact older bytes, refuses observed changes from retired stores,
and requires a reviewed revision before reset. Tombstones prevent old data from
returning. Cancellation and account/navigation retirement still apply after every
asynchronous read. Clearing delivery records does not cancel schedules or undo
external effects; reconcile uncertain operations before creating replacements.
Browser data remains local and unencrypted. Qualification of one domain does not
establish the safety of another domain or of the real agent's runtime database.

## Design and accessibility

State on 2026-10-10: the first and last paragraphs of this section are standing
requirements. The paragraphs between them are historical results of October 5 at consumer
`4145e3a9` and of the root-state audit that followed; their counts, captures and axe-core
scans belong to that source. On main the automated checks are the dependency-free rules of
`test/browser/accessibility-audit.ts`, used by `accessibility-audit.spec.ts`,
`accessibility-sweep.spec.ts` and `accessibility-sweep.production.spec.ts`, with the
per-surface accessibility specs beside them. They are class S. No screen reader, physical
device or user has assessed any view, and no complete design approval exists.

Keep Alpha's product identity, light/dark tokens, display/text typography, phone
geometry and icons independent of the upstream app UI. The supplied references
remain requirements data, including deferred states; they do not authorize
activating disabled routes.

On October 5, 102 rendered reference-state captures from consumer `4145e3a9`
were inspected as five contact sheets. Coverage includes light and dark Inbox,
Calendar, Browser, Camera, Photos, Maps, Notes, Files, Workflows, Settings and
shell/conversation states. The captures retain consistent Alpha typography,
accent, navigation and phone composition; no additional gross layout break was
identified in this visual pass. Full-size captures remain under the qualification
checkout's `test-results/browser/design-*` directories; contact sheets are in the
primary checkout's `artifacts/calendar-form-review/design-audit-1.png` through
`design-audit-5.png`.

These are labeled mock reference states, not a complete live-product design
approval. In particular, their sample accounts, model/privacy summaries, booking
forms, route maps and workflow results are simulated. The boot capture is a
transition frame and proves neither native startup nor a completed boot animation.
Contact-sheet inspection does not measure contrast, touch targets or focus order.
The production-surface lane, live empty/error states, compact/large-text owning
tests and real journeys must supply their own evidence. Physical accessibility
and user task acceptance remain open.

The root-state audit found that the previous suite explicitly accepted missing
landmarks and alert roles as known gaps. Those exceptions have been removed:
active app views and the notification shade now have named regions; browser
storage access denial has an alert in the active surface; Calendar's empty
timeline accepts keyboard focus and scrolling; Browser has a visible new-tab
heading and a named page region. Calendar names its empty visible schedule explicitly,
without claiming that hidden calendars contain no events.
Files already had truthful empty copy, so its assertion now checks that copy.
The storage alert checks API access, not available quota, every record schema or
the success of future writes; domain recovery remains necessary.

The 97 root-state/keyboard cases and five existing empty-runtime/large-text cases
passed (102 total), with type checking. A final Browser region correction passed
all eight Browser root cases; the final visible-schedule copy passed four Calendar/
Reminders empty-state cases. Axe-core 4.14.0 audited ten fresh-profile app roots in
both themes with WCAG 2 A/AA and 2.1 AA rules. After correcting the Calendar scroll
region and Browser's formerly unnamed-role viewport, no automated violations or
unresolved checks remain in those 20 root states. Normal Calendar, Browser and
blocked-storage Calendar screenshots were visually inspected at 412 × 915.
This is not a full subview, screen-reader, physical-device or user acceptance audit.
Evidence in the `alpha-album-documents` checkout is under
`artifacts/pr317-browser/`: `root-accessibility-browser.log`,
`root-accessibility-types.log`, `root-accessibility-audit-after.json`,
`browser-region-followup.log`, `browser-region-axe.json` and `accessibility-*.png`.

Review compact portrait/landscape layouts, large text, keyboard focus, scrolling,
visible save/cancel controls and assistant-toolbar clearance. Calendar draft
controls have a named focusable Event details region and 52 CSS-pixel minimum
control height; rendered targets must remain at least 44 pixels in the fitted
preview. Save and Back must stay reachable while fields scroll. Preserve empty,
loading, unavailable, failed and uncertain-write states as distinct outcomes.

## Qualification and evidence

Run `npm run verify` and the owning Playwright cases for changed browser paths.
The suite can select Chromium, Firefox or WebKit with `--project`; the `production`
project runs the flag-off build. Use explicit fixture profiles and inspect relevant
screenshots. Preserve terminal failures and source identities alongside results in
`test-results/` (ignored by Git; a result that must outlive the checkout has to be
recorded in a committed document with its commit). A passing focused run does not replace
full current-source hosted qualification.

APK assembly, emulator bridge/HOME tests, full AOSP image boots, real provider
integrations, physical-device behavior and user acceptance are separate gates.
Both standalone and launcher distributions require qualification (`npm run
android:build:local`). Do not infer physical capture, speech quality, external delivery or
provider consent from synthetic browser fixtures.

Current operating guides and requirements:

- [Browser development capabilities](browser-dev-parity.md) and [native method inventory](browser-native-method-inventory.md)
- [Local agent setup](local-agent-development.md) and [resident execution plan](on-device-agent-plan.md)
- [Calendar/reminder contracts](calendar-reminder-contract.md) and [regional Maps setup](maps-regional-validation.md)
- [Local OCR](local-ocr.md), [browser autofill](browser-autofill-integration.md) and [Notes documents](notes-document-flows.md)
- [MVP completion plan](mvp-completion-plan.md), [scope and gaps](mvp-scope-and-gap-report.md) and [pilot acceptance](pilot-acceptance-runbook.md)
- [Current status](mvp-current-status.md), the [remaining-work inventory](mvp-remaining-work-2026-10-09.md) and [owner actions](mvp-owner-actions.md)

Production provider/TLS/data-license/coverage checks, release signing and rollback,
four physical units and user acceptance remain explicit gates. Telegram and Discord are
deferred (P-02). Fully offline language-model operation is unqualified and is not an
established requirement. The decisions that are still open are listed under
[pending owner decisions](decisions.md#pending-owner-decisions). The build counts,
source migrations and failed-attempt narratives under
[Historical checkpoints](#historical-checkpoints) are records of their own revisions, not
current setup instructions.

## Browser calendar backup restore

State on 2026-10-10: implemented on main in `apps/app/src/browser/calendar-recovery.ts`,
with `test/browser/calendar-backup-restore.spec.ts` as the owning spec (class S). The
qualification paragraphs at the end of this section are historical results at their own
source revisions.

Calendar recovery accepts a selected Alpha calendar backup (domain bytes or a
recognized document envelope), validates the complete event set and previews the
count and titles before a separate replacement confirmation. It restores local
event copies with new identities and revisions, preserving recurrence, exclusions
and edited occurrences. Alerts are off; invitations are not sent. Preferences and
creation/action receipts are not imported. This avoids treating historical effect
records as new instructions. The current calendar can be downloaded first.

Replacement uses the captured document revision and older-copy bytes; newer edits
or legacy writes invalidate approval. Closing or retiring the dialog aborts a queued
write. The exact legacy copy remains available. Strict restore still rejects a
partly damaged file by default. An explicit recovery checkbox can preview valid
independent events and recurring-series groups, including the skipped count and
record positions, before the same separate replacement confirmation. Duplicate
identities are ambiguous and skipped. A damaged linked exception skips its whole
series group so it cannot silently return as an original occurrence. Recovery
connects both explicit series references and generated occurrence identities:
missing, malformed or inconsistent references cannot detach an exception and
revive its parent occurrence. Inconsistent links exclude every connected series;
cyclic references terminate and are rejected. Strict import also rejects a
generated occurrence identity whose present parent disagrees with its reference. Malformed
JSON, oversized input and a file with no recoverable group remain rejected.
Changing the selected file or recovery mode clears the prior confirmation.
Keep the original backup: recovery does not reconstruct missing or invalid data.
This is Alpha browser backup recovery, not ICS/provider import or native Calendar
restoration.

Partial-recovery qualification: 18 backup validation cases and 24 restore browser
cases across Chromium, Firefox and WebKit passed, along with type checking. The
rendered confirmation preview was inspected. Logs are in the primary checkout at
`artifacts/calendar-form-review/partial-backup-unit.log`,
`partial-backup-browser.log` and `partial-backup-typecheck.log`.
No Android build or native Calendar restoration was performed.

The damaged-reference follow-up reproduced the old defect (parent series restored,
broken exception skipped) and passed 21 backup unit tests and all 27 restore cases
across Chromium, Firefox and WebKit, plus type checking. Evidence is
`artifacts/calendar-form-review/series-links-unit.log`, `series-links-browser.log`
and `series-links-types.log` in the primary checkout.

Calendar restore qualification: all 36 owning restore/recovery checks passed across
Chromium, Firefox and WebKit, including reviewed replacement, invalid files, stale
approval, queued cancellation and access from a healthy calendar. The 26 parser
and domain-document unit checks passed, including strict guest-response admission.
`npm run verify` passed all 644 tests, type checking, the production build and the
bundle audit before the final strict-response guard. That guard then passed the
owning unit/browser suites and type checking; the expensive unrelated runner
suite was not repeated. These results do not qualify native/device behavior or
unrelated MVP acceptance.

## Assistant draft restart recovery

State on 2026-10-10: implemented on main (`apps/app/src/prototype/assistant-draft-controller.ts`);
the owning specs are `test/browser/assistant-draft-recovery.spec.ts`,
`assistant-draft-storage.spec.ts`, `assistant-draft-review.spec.ts` and
`assistant-draft-dispatch.spec.ts` (class S). The qualification paragraphs below are
historical results at `ba3eed32` and `5f4534ee`. The Android paths have no recorded run.

Both assistant composers support bounded multiline review and IME-safe sending.
Unsent text is saved to the selected owner/agent/conversation, with offline text kept
separate. Restored drafts have no retained selected-source authority and never send
automatically. Revision conflicts show both copies; failed writes retain editable
text. Browser damaged-record recovery backs up stored bytes and current text before
confirmed reset. Android also offers backup and confirmed reset for readable records with invalid
draft schemas. Reset compares the exact captured secure-slot bytes; backup uses the
existing reviewed Android document picker with exact-byte readback. Decryption or
native read failures leave the record untouched. Physical restart/IME, encrypted-store
execution and document-provider acceptance remain open. Calendar and Reminder form recovery is tracked separately below.

Assistant draft qualification: consumer `ba3eed32` passed `npm run verify` (657
tests, type checking, production build and bundle audit), 11 production-surface
browser tests and 13 selected-source summary tests. A subsequent conversation-choice
fix passed type checking and all 81 owning draft/storage/conversation browser checks
across Chromium, Firefox and WebKit. It pins the current tab's observed choice,
including an empty choice, so another tab's saved restart preference cannot move an
unsent draft before its first send. These remain local results, not hosted CI or
native/device qualification.

Native assistant draft recovery qualification: consumer `5f4534ee` passed
`npm run verify` (657 tests, type checking, production build and a 245-file
flag-off bundle audit). All 57 affected browser checks passed across Chromium,
Firefox and WebKit. Native adapter tests used explicit bridge-contract doubles;
these results do not prove encrypted Android storage or file-provider execution.

## Unsaved Calendar and Reminder creation forms

State on 2026-10-10: implemented on main (`apps/app/src/prototype/calendar-form-draft-adapter.ts`);
the owning spec is `test/browser/calendar-form-draft.spec.ts` (class S). The paragraph
about PR #317 and the qualification paragraph are historical: PR #317 merged on 2026-10-06
as `c5e11759`, and browser development no longer uses upstream `95924e90`.

New event and reminder forms now retain their editable fields and original creation
identities in the transactional draft store. Browser app and development profiles
use separate bindings; Android selects the existing encrypted slot adapter. Recovery
is explicit through **Resume unsaved calendar form** and never saves an item.
Civil dates are stored independently of relative day offsets, including when an
open form crosses midnight. Changing time zones prompts a review of the restored
time. Separate-creation consent is not restored. Existing pending-write journals
and provider revision checks remain authoritative for uncertain outcomes.

Competing tabs require Restore or Replace, and creating a new form requires review
before replacing a retained one. Discard requires confirmation and refuses stale
receipts, without creating or deleting events. Confirmed saves clear only the matching retained
form. Storage failure leaves current text available and exposes recovery.

Creation forms and inline existing-event/reminder edit forms retain drafts in separate
slots. The separate recurring/all-day Calendar editor also retains per-event drafts,
with explicit recovery when the event is reopened for editing.
Inbox now also retains unsaved edits separately from explicitly saved drafts. Android execution and physical
process-death acceptance remain separate from browser qualification.

Runtime update PR #317 remains unqualified at `e2f62059`: hosted test-mocks
instrumentation ran 191 tests per variant, with one standalone video-playback
failure and two launcher failures (video playback and returning from the system
share chooser). These are actual assertion failures, distinct from the cancelled
browser/distribution jobs. The preserved hosted evidence was inspected without
running another Android build. Browser development remains on upstream `95924e90`.

Creation-form qualification: three record-contract tests and type checking pass.
The 92-case creation/save campaign passed across Chromium, Firefox and WebKit;
after the discard addition, all 39 form-specific cases passed across those engines.
Cases cover date rollover, cross-tab conflict, uncertain event/reminder outcomes,
explicit replacement/discard, oversized edits and damaged-form recovery without
changing saved events. The restored form was inspected at 412 × 915. The primary-checkout repository run finished with 658 of 660 tests passing: an
untracked ownership audit links to removed patches, and its previously staged Android
payload does not match the current source pin. Those historical failures remain distinguished from the clean-worktree integrated
result: consumer `baa41362` passed all 663 tests, type checking, production build
and the 245-file flag-off bundle audit. The ownership links were repaired in
PR #325; the old staged Android payload was preserved. No Android build or native
execution is claimed.

## Unsaved inline Calendar and Reminder edits

State on 2026-10-10: implemented on main (`apps/app/src/prototype/calendar-edit-draft-adapter.ts`);
the owning spec is `test/browser/calendar-edit-draft.spec.ts` (class S). The qualification
paragraph is a historical result.

Existing-item edits retain the original Calendar expected fields/revision or exact
Reminder target separately from editable values. Restoring never creates a new item
or restores an in-memory mutation attempt. Provider revision checks and the pending
action journal still govern Save. Civil dates and the original reminder schedule
rebase together, so a title-only change after midnight does not reschedule it.
Confirmed saves clear only the matching retained form. Explicit discard cannot
erase a newer draft from another tab and leaves saved items unchanged.

Inline-editor qualification: all 63 creation/edit draft cases passed across
Chromium, Firefox and WebKit, plus 42 existing Calendar save and Reminder
edit/timing cases in Chromium. The full 663-test integrated result above includes
this implementation. Native encrypted storage and process-death remain unqualified.

## Recurring and all-day Calendar editor recovery

State on 2026-10-10: on main, with `test/browser/calendar-modal-draft.spec.ts` as the
owning spec (class S). The second paragraph is a historical result; the "combined root
verification" it defers has since run many times on later sources and is not pending.

The separate browser editor retains per-event text, selected dates/time zone,
all-day presentation, recurrence, alerts, attendees and local meeting preference.
Reopening the event offers explicit Restore or Discard; it does not apply old edits
automatically. Retained edits keep their original event revision, so restoring an
older version cannot overwrite a newer event. Cross-tab writes require explicit
conflict review. Oversized edits remain visible, and a confirmed event save whose
draft cleanup fails disables another save and reports the cleanup failure.

The final typecheck passed. All 26 final recovery/accessibility browser cases passed
across Chromium, Firefox and WebKit, following 14 initial editor/recurrence/
accessibility regressions and 21 recovery cases before the compact-layout adjustment.
The corrected 360 × 360 restored editor was visually inspected. The earlier full
663-test result predates this modal change; its combined root verification is
deferred to the next implementation batch. No Android build was run. Inbox recovery is tracked below.

## Unsent Inbox edit recovery

State on 2026-10-10: implemented on main (`apps/app/src/prototype/inbox-unsaved.ts`); the
owning spec is `test/browser/inbox-unsaved-recovery.spec.ts` (class S, synthetic provider).
The qualification paragraph is a historical result, and its "combined root verification
... is pending" is no longer true of any current run.

Unsent edits now have a separate recovery copy bound to the exact Cloud
environment, owner, organization and Gmail connection. It retains partial
recipient input, editable text, reviewed attachment bytes and the original saved
draft revision. Resume is explicit and never prepares or sends provider mail.
A newer saved draft refuses a stale replacement; competing windows require
Restore or Replace. Failed recovery cleanup after an explicit local save is
reported without claiming the copy was removed. Damaged recovery storage can
be reset without deleting the explicitly saved draft. Browser and native
storage use the existing transactional document and encrypted-slot adapters.

Inbox qualification: all 33 browser checks passed, including the owning adapter,
account-switch/read-cancellation regressions and recovery cases across Chromium,
Firefox and WebKit. Three record validation tests and type checking also passed.
Combined root verification with the Calendar modal changes is pending. Physical-device
process recreation, native encrypted-store execution and real Gmail authorization
and provider outcomes remain unqualified by these browser fixtures.

## Historical checkpoints

Everything below this heading is a dated record, kept as it was written at the time. A
sentence that says "current", "now", "pending", "still running" or "remains" speaks for its
own date and source revision, not for main. Test counts, durations, run numbers and commit
identities belong to those revisions. The evidence files it names were written to ignored
directories of local checkouts and are not in this repository. Where code has overtaken a
statement, the correction is in [What the code has overtaken](#what-the-code-has-overtaken);
the historical text itself is not edited, apart from the "(historical)" marker added to
each heading on 2026-10-10 and one removal: the October 5 surface table that closed
"Integrated source checkpoint" was replaced by the reconciled
[surface inventory](#surface-inventory), as that checkpoint notes. Checkpoints are in the order they stood in before, newest
first for the most part.

## Consolidated current checkpoint — 2026-10-06 (historical)

The integrated consumer is `72783b3f9b6ad99ef284fe428b6c4bfaf834ce36`, with
resident runtime `3cca1ee4f1f1e4cd417de7272ba5195263dcb63b`. The implementation
and six speech-test setup cases are merged. No local Android build was run in
this browser-focused campaign. The complete MVP is still not accepted: the
remaining provider, native, physical, release and scope gates below are real
requirements, not work implied complete by passing browser tests.

| Qualification | Current evidence | Boundary |
| --- | --- | --- |
| Consumer source/build | Full `npm run verify` exited 0 at `ffa72bcc`: 689 tests, no failures/skips, type checking, production build and 245-file bundle audit; test phase 350.0 seconds. The later `72783b3f` delta is the six-case speech test readiness fix and documentation. Hosted Chromium shard 3 also completed `npm run verify` at exact `72783b3f`, with 689 tests passed, none failed or skipped (544.1 seconds for tests). | Source/build evidence at both stated revisions; all hosted browser jobs subsequently completed successfully at `72783b3f`. |
| Resident runtime | Admitted source and frozen host install; 52 native-host tests and 21 resident-agent tests / 82 assertions passed. | Host runtime contracts, not Android IPC or device acceptance. |
| Speech | Six browser recording/speech cases passed on `3cca1ee4`, including actual synthetic audio through Whisper/Kokoro, playback completion, Stop and disconnect. The identical Kokoro source passed three fresh-worker trials at `cc682e9a` in 1,117 / 1,065 / 1,057 ms, plus cancellation/recovery. | Synthetic host audio; no physical microphone, Bluetooth, device latency or evicted-cache claim. |
| Default development setup | The main checkout now contains its own admitted `artifacts/local-agent-resident-3cca1ee4f1f1e4cd417de7272ba5195263dcb63b` and frozen host dependencies. Plain `npm run dev`, without a source override, starts that runtime on 47849 and Vite on 5317. First-request playback passed; owner, agent and all 18 conversation IDs matched before/after. | Generated runtime/dependencies remain local ignored artifacts. Profile snapshots compare identities, not every message byte. |
| Real workflow and persistence | An isolated host executed the arithmetic-only Smithers fixture, persisted `56`, and returned the same result again. A second campaign restarted into a distinct host PID: owner, execution identity, status and exact output survived, and the execution list still contained exactly one run. | Graceful host restart of a completed, paused workflow. No interrupted-write, powered-off scheduling or device-trigger claim. |
| Outbound privacy | On `3cca1ee4`, six synthetic credential cases passed with contact restoration. Streamed replies and restart recovery passed; all 10 observed provider requests excluded the synthetic raw credentials and contact values. | Explicit redaction-on isolated profile; the user's development host remains at its existing redaction-off configuration. Not Android or universal secret-detection acceptance. |
| Design | The 86-state light/dark audit and manual inspection of all 40 incomplete-contrast captures remain the design evidence. Since that renderer revision, the only renderer change is Reminder Save's active-mutation disabled state, covered by the 48-case creation/recovery suite. | Fixture design review and scoped behavior checks, not full WCAG, physical screen-reader or user signoff. |
| Hosted browser checks | [Run `37497023709`](https://github.com/AlphaCompute/alphaphone/actions/runs/37497023709) completed successfully at exact main `72783b3f`. Production surface and all four WebKit/Firefox storage shards passed (184 tests each; 736 total). Chromium shards passed 649 / 656 / 660 tests (1,965 total) in 41.4 / 40.9 / 37.4 minutes. | The main Chromium lane had 16 conditional skips, reconciled below; no Android or real-provider acceptance is implied. |

The 16 conditional Chromium skips are accounted for separately: ten synthetic
local-agent speech/disclosure cases passed in the hosted companion lane (35.0
seconds); four `host-reminder-recovery.spec.ts` cases passed locally against the
real development storage bridge in an isolated private directory (3.4 seconds,
no skips, no model or user-profile access); and the actual local-host capture and
first-request Kokoro playback cases passed in the six-case local speech campaign
above. These are distinct campaigns, not a claim that the main lane had no skips.
The initial isolated storage attempt failed before tests because its temporary
configuration used the wrong working directory; correcting that test configuration
produced the four-case pass. Both logs are retained.

Workflow routes became available about 1.2 seconds after chat readiness in the
initial isolated check. The first attempt's 404 occurred before workflow creation;
the successful campaign waited on the read-only workflow list before submitting
once. It never retried a creation or run request. Chat readiness alone must not
be treated as proof that every deferred plugin route is available.

The remaining work is enumerated in [current status](mvp-current-status.md) and
the [pilot acceptance runbook](pilot-acceptance-runbook.md): real Gmail grants
and authorized sends/recovery; password-provider behavior (passkeys are deferred under #402); licensed
HTTPS Maps and navigation; native installed-data, permissions, lifecycle and
interrupted-workflow qualification; physical speech, latency, accessibility,
battery and pilot journeys; controlled signing, App Links, signed update/rollback;
and explicit agreement on powered-off scheduling and messaging scope. Existing
runbooks and fixtures prepare these gates but do not supply their missing results.

Evidence in the verification checkout is
`artifacts/final-failure-review/runtime-3cca-verify.log` and
`runtime-3cca-agent-tests.log`. Primary-checkout evidence is under
`artifacts/kokoro-startup-fix/`: `browser-3cca-recheck.log`,
`default-source-prepare.log`, `default-source-install.log`, `default-dev.log`,
`default-browser.log`, the `default-profile-*.json` snapshots,
`redaction-3cca.log`, `workflow-3cca-readiness.log`,
`workflow-3cca-restart.log`, `host-reminder-recovery-recheck.log`, and
`main-72783-*.log`.
Failed attempts remain preserved alongside the successful qualifications.

## Final runtime pin and browser speech setup — 2026-10-06 (historical)

PR 351 merged as `ffa72bcc22ae7990d98bcfd16434db834e0e3c38`, adopting
`3cca1ee4f1f1e4cd417de7272ba5195263dcb63b`. Its six-file upstream delta adds
approved-draft spend accounting and account-bound invoice projection, plus an
upstream Home fixture correction. Alpha's renderer, shared Files/Maps/Notes
sources and Kokoro worker/service are unchanged. The reviewed pin and notices
are synchronized in both checkouts.

The admitted prepared source passed its frozen dependency installation, all
**52 native-host tests**, and **21 resident-agent tests / 82 assertions**. The
compiler test passed in 13.0 seconds. Before the upgrade, the unchanged compiler
on `cc682e9a` also passed its scoped retry in 15.5 seconds, and both previously
timed-out native-runner checks passed their retry. These results do not erase
the earlier failed full verification under load.

The live browser dev host on port 5317 now runs `3cca1ee4`. A fresh-start browser
campaign exposed a setup race: the real recording journey connected before the
agent was running, whereas the first-playback journey already awaited agent
readiness. Both now use the same bounded readiness check before connecting,
without querying TTS status or changing speech deadlines. After another fresh
host restart, all six recording/speech tests passed, including actual synthetic
recording, Whisper transcription, Kokoro playback, Stop and disconnect. Owner,
agent and all 18 conversation IDs matched the pre-restart snapshot.

Evidence: `artifacts/final-failure-review/runtime-3cca-agent-tests.log` in the
verification checkout and `artifacts/kokoro-startup-fix/browser-3cca-recheck.log`
plus profile snapshots in the primary checkout. The original setup failure is
retained in `browser-3cca.log`. Full consumer verification is still running at
the frozen `ffa72bcc` source; hosted browser run `37496422496` is also pending
completion. No Android build or physical-device acceptance was performed.

## Audio CI and reminder creation follow-up — 2026-10-06 (historical)

PR 347 merged as `f628f222`, and PR 348 merged as `cf8f07f4`. The latter
exposes the existing reminder mutation lock in Save's disabled state for both
creation and edits. Both active checkouts were fast-forwarded to that main
revision with clean tracked state; the development server remained available.

On PR 347 head `d385cff36168cc87a14174de9c9b1479a1462c31`, hosted run
`37487494364` passed both WebKit storage shards. Shard 2 passed 184 tests,
including real Notes recording, retained audio, reload, playback and restore
(the recording journey took 8.7 seconds). Firefox shard 2 also passed all 184
tests, including that journey (16.9 seconds). The macOS WebKit runner and Linux
Firefox PulseAudio environment repair are therefore qualified for this journey.
Other jobs were still active at this checkpoint; this is not an all-green claim.
The primary checkout retains `audio-fix-webkit2.log` and `audio-fix-firefox2.log`
under `artifacts/final-browser-31fc/`.

Combined-main run `37488535523` then found a stale duplicate-creation test:
it tried an ordinary click on the correctly disabled Save control introduced
by PR 348. WebKit shard 2 recorded 183 passes and that one failure. The test
now asserts disabled state, explicitly dispatches the second event to test
the handler's independent guard, and requires exactly one provider call.
All 48 creation/recovery cases passed locally across Chromium, Firefox and
WebKit; evidence is `artifacts/final-failure-review/reminder-create.log` in
the verification checkout. No production code or timeout was changed.

The isolated real host using runtime `19afed28` was also stopped gracefully
and restarted. Its one synthetic conversation retained both the question and
correct answer without another send. Evidence in the primary checkout is
`artifacts/final-browser-31fc/runtime-19af-chat-restart-result.json`. This is
graceful host process recovery, not abrupt-death or Android qualification.

## Runtime upgrade and integrated verification — 2026-10-06 (historical)

Main `c5e11759bea895893a91bc6926c78c7282f842a8` incorporates PR 317 and pins
upstream `19afed2899a2cb72993ca2819481f5fa9d2fb00a`. On that exact source,
`npm run verify` exited 0: **689 passed, zero failed or skipped**, followed by
type checking, production build and the 245-file flag-off bundle audit. The test
phase took 814.6 seconds. Evidence in the verification checkout:
`artifacts/final-failure-review/runtime-integrated-verify.log`.

The new prepared source passed its admission check, frozen dependency install
and `npm run agent:test` (21 tests, 82 assertions). Three fresh Kokoro workers
synthesized valid WAV output in 2,115, 1,684 and 1,902 milliseconds without status
probes; cancellation during cold startup and recovery in a fresh worker passed.
Actual first-request browser playback and the synthetic recording → Whisper
transcript → Kokoro playback journey both passed, including Stop and disconnect.
These are fresh-process host/browser results, not disk-cache eviction or device
latency measurements. The browser test totals include agent startup.

Dev on port 5317 now uses this runtime. Before/after snapshots show the same
owner, agent and 18 conversation identities after restart and voice qualification;
these snapshots do not hash every existing message. A separate fresh private
profile passed actual streamed hosted inference, correct synthetic arithmetic,
owner restoration and exact two-message history after page reload. Its first
attempt failed at connection before any message; the second attempt passed after
host startup. This does not establish host process-restart recovery. The isolated
host was stopped afterward. Evidence remains in the primary checkout under
`artifacts/final-browser-31fc/runtime-19af-*`.

Hosted run `37485009012` exposed a Linux WebKit environment limitation:
`notes-audio-journey.spec.ts` failed because `MediaRecorder` is absent, before
recording. The WebKit storage job is moved to `macos-15`, retaining the complete
storage inventory and real recording journey. Firefox and Chromium retain Linux
runners. The unchanged Notes journey passed locally in macOS WebKit (one test,
15.4 seconds including startup); evidence is `artifacts/final-failure-review/webkit-recorder.log`.
This runner change needs its own terminal hosted result; the earlier
run's passing lanes do not qualify the changed workflow. Other lanes were still
running at this checkpoint. Firefox shard 2 then failed in the same journey:
its Web Audio context remained suspended despite the user gesture. The Linux
Firefox jobs now provision PulseAudio with a null output sink so headless audio
has an actual server; recording still uses the real MediaRecorder. This is a
candidate environment repair pending the hosted test, not a proven diagnosis.
No Android build or device acceptance was performed.

The requirement-by-requirement remaining acceptance and external prerequisites
in [current status](mvp-current-status.md) remain open. Neither these checks nor an
empty PR queue establish full MVP completion.

## Earlier integrated verification checkpoint — 2026-10-06 (historical)

`npm run verify` passed at `07d5263982662367516ccc87681c2a76efd8c767`:
674 tests passed, zero failures or skips, type checking, the production build,
and the 245-file flag-off bundle audit. The test phase took 712.3 seconds.
This includes the merged reminder refresh-order fix, Notes audio test coverage,
Photos deletion/overlay changes, map labels and earlier accessibility work.
The remaining changes in this report update are documentation only. Evidence:
`artifacts/final-failure-review/integrated-verify.log` in the verification checkout.

The separate full Chromium campaign terminated at its frozen source
`31fc1fb0918de0107dbf1673a7fec2f63d1c4eec`: **1,928 passed, 32 failed,
16 skipped, four runner errors**, exit 1, reported duration 14.0 hours. The four
runner errors are duplicate 300-second shutdown-timeout reports for two workers.
The prolonged execution's cause is not established. Failed traces and the full
log remain in the primary checkout's `artifacts/final-browser-31fc/`.

An exact comparison of final failed file/title pairs confirms that all 32 are
the same cases rechecked successfully at `f633e490` (32 passed, 2.7 minutes).
Later changes have the owning checks recorded below. This neither turns the
original failed run green nor establishes a full current-head browser pass.
The outcome and comparison are recorded in
`artifacts/final-failure-review/full-browser-summary.json`.

The primary checkout was then fast-forwarded to main `7d3e91e9`; browser dev on
port 5317 returned HTTP 200. Hosted main run `37481107767` was cancelled after
its production-surface job passed; cancelled Chromium/storage lanes remain
unqualified. PR 345's run `37481994845` was still active at this checkpoint.
Earlier pending-run statements below are historical checkpoints superseded by
this terminal record.

Remaining work is explicit in [the current requirement matrix](mvp-current-status.md):
current integrated cross-engine/hosted qualification, the separate unmerged
runtime upgrade in PR 317, real provider grants and interruption recovery,
production Maps, native/physical lifecycle and accessibility, release signing,
installed upgrades and pilot acceptance. Powered-off scheduling remains an
unresolved scope amendment. No local Android build was performed in this
browser-focused campaign; host runner fixtures are not device acceptance.

## Integrated design review — 2026-10-06 (historical)

At `7d3e91e9771611effbfc85b89cd70fee35fff5d9`, the refreshed accessibility
scan covered 86 fixture states (43 root/subviews in light and dark themes) at
412 × 915. It reported zero automated violations. Forty states retained
`color-contrast` incomplete results: the checker could not determine backgrounds
across gradients, photographs, overlap or short glyph/count content. These are
not automatic passes or confirmed defects.

All 40 corresponding current-source screenshots were then inspected, covering
Inbox message detail, Calendar event/invitation, Browser booking/agent overlay,
Camera photo/video/scan, Photos root/viewer/albums/search, Maps root/search/place/
route/navigation, Notes and Workflows success/failure. No new visible contrast
defect was identified in those captures. The dark-backed Camera controls, Photos
badges/viewer controls and illustrated-map label fixes were present. Their owning
rendered-color checks provide additional measured evidence; visual inspection
does not establish every pixel's contrast or arbitrary third-party image/page
readability. Off-screen content, physical screen-reader use and device/user
acceptance remain separate requirements.

Evidence in the verification checkout: `artifacts/final-failure-review/`
contains `design-audit.json`, `design-summary.json`, `capture-incomplete.log`,
40 `incomplete-*.png` captures and ten labelled `contact-*.png` sheets. These
are mock fixture captures and do not demonstrate real account/provider actions.

## Photos image-overlay contrast — 2026-10-06 (historical)

Photos duration labels and favorite badges now have a translucent dark backing,
and unselected batch-selection rings use the same backing in both the live
adapter and fixture. Play and Pause controls also have sufficient backing over
bright frames. Viewer header/footer gradients remain dark beneath their controls,
including compact layouts where the image fills the entire viewer.

All 12 owning Chromium cases passed: four light/dark contrast and compact-player
journeys plus eight existing batch and pagination/recovery cases. The tests
measure rendered foreground/background contrast composited over a white image
(at least 4.5:1), exercise Play/Pause/Back and preserve the existing batch-storage
checks. Type checking and five documentation checks passed. The dark thumbnail capture and compact white-frame viewer were visually
inspected. Evidence in the verification checkout:
`artifacts/final-failure-review/photo-badges.log` and `photo-results/`.
This is browser rendering evidence, not native video decoding or device acceptance.

## Notes audio persistence and failure rechecks — 2026-10-06 (historical)

The Notes audio journey now waits for its edited title, transcript and audio
reference to reach the durable Notes document before reloading. The earlier
hosted failure on PR 317 showed the original “Voice note” title after a reload
that raced asynchronous autosave. Waiting for the actual saved record strengthens
the test's persistence boundary; it does not change the app or weaken interrupted
save checks. The complete recording/review/save/reload/play/restore journey passed
in Chromium, Firefox and WebKit. Quota and concurrent-edit failure cases also
passed in all three engines (nine total cases). The audio journey is now included
in the standard cross-browser storage inventory, rather than only Chromium.
Evidence in the clean verification checkout:
`artifacts/final-failure-review/notes.log` and `notes-cross.log`.

All 32 failures collected so far from the frozen `31fc1fb0` Chromium campaign
passed a serial recheck at `f633e490` (2.7 minutes), including the Calendar modal
assertions fixed by PR 343. The original campaign remains running and retains
its failed traces; this recheck neither makes that run green nor proves there
will be no later failures. Evidence: `artifacts/final-failure-review/recheck.log`
and `failed-cases.json`. The hosted `31fc1fb0` browser failure was limited to the
three month-picker assertions. The cancelled current-main browser run was retried
once at `f633e490`; its terminal outcome remains a separate gate.

## Reminder save refresh ordering — 2026-10-06 (historical)

After a confirmed reminder edit, the editor now stays visible until refreshed
records and the mutation lock settle. It then closes only if the same editor,
owner and draft still own the operation. A newer draft or navigation is preserved.
This extracts the consumer fix from PR 317 without adopting its runtime upgrade.
The delayed-refresh regression proves the edited record is committed while the
form remains present, then checks completion against the refreshed occurrence.

All 51 owning reminder/Calendar Chromium cases passed in a single-worker run
(5.2 minutes), plus five focused cases covering the regression and Calendar
preferences in the modal month picker. The latter now uses Close/Escape and
checks opener focus return instead of operating the covered background control.
Type checking and five documentation checks passed.

The earlier 51-case run had 32 passes, 19 failures and three runner errors across
7.1 hours, including unusually long delays and browser-launch failures. Preserve
that failed evidence; the subsequent 51-case run is the successful qualification,
not an erasure or reinterpretation of the earlier result. Evidence in the clean
verification checkout: `artifacts/settings-review/reminder-refresh-browser.log`,
`reminder-serial.log`, `reminder-focused.log`, `reminder-refresh-types.log` and
`reminder-refresh-docs.log`. The separate full Chromium campaign remains on its
unchanged source and cannot qualify this later fix.

## Integrated browser checkpoint — 2026-10-06 (historical)

`npm run verify` finished successfully at
`79cd5c734f4db3d92fe4421b4255a17185b7f796`: all 674 tests passed, zero
failures or skips, with type checking, production build and the 245-file
flag-off bundle audit. The run took 1,112.7 seconds. Its log is
`artifacts/settings-review/core-subview-integrated-verify.log` in the clean
verification checkout. This result includes the five-view accessibility and
Camera contrast changes; it predates the Photos deletion/map-label follow-up
and the reminder refresh-order change. Those have separate owning evidence.

The full 1,976-case Chromium campaign at
`31fc1fb0918de0107dbf1673a7fec2f63d1c4eec` is still running. Its source is
frozen in the primary checkout. Logs and retained traces live in
`artifacts/final-browser-31fc/`. It has already exposed obsolete Calendar
month-picker assertions, which attempted to operate the covered button rather
than the modal's Close control. Its unusually long timeout and browser-launch
failures remain failures requiring explicit rechecks; they are not passing
acceptance evidence. Do not substitute this in-progress run for a terminal
whole-suite result.

## Photos deletion review and illustrated-map labels — 2026-10-05 (historical)

Photos' permanent-deletion review previously appeared as a sheet without modal
semantics or keyboard ownership. It now has a named dialog, initial Cancel focus,
contained Tab/Shift+Tab navigation, Escape/Back cancellation and focus return.
The covered album controls are inert and the assistant dock is hidden. Its
bounded scroll area keeps actions reachable on a 420px-high viewport. The
existing prepared-deletion identity and explicit confirmation remain unchanged.

All 14 owning Chromium checks passed: the four new light/dark and compact/full
height deletion journeys, plus the existing capture, album-management and batch
mutation/recovery cases. Only fresh test-created images were deleted. The compact
dark review was visually inspected. Type checking passed. Evidence:
`artifacts/design-final-review/photo-review.log` and `types.log`.

The illustrated map's small labels were faint in both themes. They now use a
higher-contrast foreground and an opaque terrain-colored backing so intersecting
roads cannot change their text background. Six root/route/navigation checks
passed in light and dark themes, measuring at least 4.5:1 from rendered colors;
both root captures were inspected. This qualifies the app-owned illustration,
not external map tiles, licensed provider data or physical navigation. Evidence:
`artifacts/design-final-review/maps.log`.

The manual review also inspected Photos album/search, Calendar invitation,
Browser article and failed-workflow captures. These observations do not establish
complete contrast or screen-reader acceptance; the unresolved automated findings
and external requirements in the current status matrix remain open.

## Cold Kokoro startup follow-up — 2026-10-06 (historical)

At consumer `9cd8f018`, the pinned runtime `cc682e9a` retains upstream
`4f28daecf2f`, which removes premature retirement of a worker during cold
initialization while retaining caller cancellation and synthesis/transport bounds.
The existing development process still used `19afed28`; it was stopped and
restarted on the admitted `cc682e9a` source at `http://127.0.0.1:5317/`.
No new runtime patch or timeout increase was necessary, and no current cold
startup failure reproduced.

Three fresh workers returned valid WAV audio in **1,117, 1,065 and 1,057 ms**,
without an initialization/status probe. Cancellation during startup followed by
a successful fresh-worker retry also passed. On the restarted development host,
the first-request browser playback check passed, followed by real synthetic
recording → Whisper transcription → Kokoro playback, Stop and disconnect.
Ten speech startup, lifecycle, configuration and bridge contract tests passed.
Hashed before/after profile snapshots matched: the same owner, agent and all
18 conversation IDs were retained.

Evidence is in `artifacts/kokoro-startup-fix/`: `cold-baseline.log`,
`browser-first.log`, `browser-voice.log`, `contracts.log`, `dev.log`, and the
profile snapshots. This is fresh-process host/browser evidence, not an evicted
disk cache, a latency guarantee under CPU contention, or Android/device
qualification. Earlier loaded-host results and broader test failures remain
separate evidence; this follow-up does not mark the entire MVP complete.

## Cold Kokoro requalification — 2026-10-05 (historical)

The former worker startup retirement failure is resolved in the currently pinned
upstream `95924e90`, which includes `4f28daecf2f`. Cold initialization is owned by
the requesting lifecycle; it no longer has an independent worker-retirement timer.
The existing synthesis/transport bounds and cancellation remain enforced. No new
runtime patch or timeout increase was needed for this requalification.

The `agent:test-cold-kokoro` check (retired with Kokoro; its script and npm entry were deleted on 2026-10-14) verified the admitted source and
installed assets, starts three fresh workers without initialization/status probes,
and checks actual WAV output. They passed in 2,517, 2,119 and 1,579 milliseconds.
Cancellation during cold initialization followed by successful synthesis in a new
worker also passed. These are fresh-process results, not an evicted OS disk cache
or device latency qualification.

After restarting the real development host, the opt-in browser regression made
its first TTS request without a speech-status probe and verified actual playback
and completion (5.5 seconds including runner startup). Agent startup is awaited
separately. Two initial runner attempts arrived before agent/UI startup and failed
before sending any speech request; the final check waits for those prerequisites.
Hashed before/after snapshots preserve the owner, agent and 18 conversation IDs.
Eight speech startup, worker lifecycle and bridge contract tests passed. Evidence:
`artifacts/kokoro-cold-review/` and `test-results/cold-kokoro/result.json`.
This is host/browser evidence; no Android build or device acceptance was run.

## Local speech restart checkpoint — 2026-10-05 (historical)

The browser dev launcher now reads owner-only `local-speech.json` defaults from
its private agent profile, so restarting without the original shell environment
retains the installed Whisper/Kokoro assets. Explicit environment overrides still
win. Unsupported settings, credentials, symlinks and shared-access files fail
closed; existing asset admission and cold-start warmup remain in place.

Qualified on consumer base `15f9338f` with upstream `95924e90`: all 631 repository
tests, type checking, production build and bundle audit passed. A plain `npm run
dev` cold process start reported Whisper and Kokoro ready. The actual browser
capture/transcription/synthesis journey passed in 15.3 seconds, including playback
completion, stop and disconnect. The owner, agent and 18 conversation IDs were
unchanged across that test. This is host/browser evidence; no Android build or
physical-device acceptance was performed for this change. See
[local development](local-agent-development.md) for persistent settings.

The current-main restart at `978694b04a3196ed4e2bfe4afcc67c3aa5a3f890`
again reported both providers ready and passed the real capture/transcription/
playback, Stop and disconnect journey in 13.4 seconds including runner startup.
Hashed snapshots retained the owner, agent and all 18 conversation identifiers.
Evidence is in `artifacts/calendar-form-review/latest-preview-speech.log`,
`latest-preview-before.json` and `latest-preview-after.json`. This is total journey
time, not first-audio latency or physical-device acceptance.

## Covered subviews and review focus — 2026-10-05 (historical)

Inbox message/composer and Workflow detail/run/builder screens now remove their
covered layers from keyboard and accessibility navigation. Opening a subview
focuses its first control; closing returns to its surviving opener. Inbox email
sharing, attachment and provider-operation reviews own focus, support Escape,
and hide the covered assistant dock. The inline modal helper restores focus after
the renderer releases its own inert flags, preventing attachment exit from
stranding focus on the page body. This uses the existing review actions; it does
not add provider writes or automatic retries.

All 77 owning Chromium cases passed, including both themes, compact attachment
reviews, sharing/provider review focus, retained Inbox edits, account switches,
workflow authoring/focus behavior, and Calendar/Clock/Files dialog dismissal.
Type checking and five documentation checks passed. An earlier four-case
attachment campaign failed the new return-focus assertion; the deferred restore
fix passed those cases and the final batch. The three older owner-fence assertions
were corrected to inspect the active new-account receipt instead of the covered
mailbox button; stale-operation/no-dispatch assertions remain unchanged.
Evidence is `artifacts/kokoro-cold-review/subview-final.log`, `subview-types.log`
and `subview-docs.log`. The dark 150-percent-text attachment screenshot was
visually inspected with exit controls visible and the assistant dock hidden.

The earlier integrated checkpoint at `1d73a298925702a179d497e49b32c86399799cb1`
completed `npm run verify`: 674 tests passed, no failures or skips, type checking,
production build and 245-file flag-off bundle audit passed. It predates this
subview change and PRs 337–338. Evidence:
`artifacts/settings-review/accessibility-integrated-verify.log` in the clean
verification checkout.

The follow-up axe-core 4.14.0 scan covers 86 light/dark reference states: zero
automated violations, with color-contrast results still incomplete in 56 states
(previously 64). This is not complete contrast or accessibility acceptance.
Remaining covered-control candidates include Calendar event/forms, Browser tabs,
Photos viewer, Notes editor/recording and Files folder/preview. They require the
same keyboard/accessibility inspection rather than interpreting incomplete
contrast results as success. Camera/photo backgrounds and truncated text also
need visual contrast review. Evidence: `artifacts/kokoro-cold-review/subviews-audit.json`.

## Remaining core subviews and Camera contrast — 2026-10-05 (historical)

Calendar event/forms, Browser tabs/library, Photos album/viewer/edit, Notes
editor/voice/link/recording and Files folder/preview now retire their covered
controls from keyboard and accessibility navigation. Entering a layer focuses
its first control. Returning restores its opener; an asynchronous Files refresh
can replace the original button, so focus is captured before replacement and
restored only to a unique equivalent control in the original surviving layer.
The template renderer now forwards focus-capture events. Calendar Clock and
month dialogs retain their separate modal ownership; Notes storage status stays
outside the covered list.

Camera zoom and scan overlays now use darker backgrounds. Computed foreground
and background colors, composited over pure white camera pixels, meet 4.5:1 for
the four zoom controls and two scan actions. The stable scan capture was visually
inspected. This does not assess arbitrary text in photographed documents.

All 36 owning Chromium checks passed, including light/dark layers, nested Files
focus return, Inbox/Workflow regressions and Camera contrast. Earlier iterations
exposed the asynchronous opener replacement and a missing renderer event mapping;
both are fixed in the final run. Another 28 affected-flow checks passed for
photo editing/albums, Camera pixels/video, Calendar month/Clock dialogs and Notes
storage-status layouts. Type checking and five documentation checks passed.
Evidence is `artifacts/subview-completion/final-owning.log`, `final-flows.log`,
`final-types.log` and `final-docs.log`. A wider pre-final campaign passed
107 cases with one Files focus failure, subsequently covered by the final run.
The 86-state axe scan after layer isolation reported zero automated violations
and 40 states with incomplete contrast results. That scan predates the final
Camera opacity and focus-capture changes. Photos/Notes/Browser/Camera captures
were inspected; images, gradients and overlapping/truncated text still require
manual review. No complete accessibility or physical-device acceptance is claimed.

The merged checkpoint `364522d95f36ac85e9a651a435d6984c0875e6fb`
completed `npm run verify`: 674 tests, zero failures or skips, type checking,
production build and 245-file production audit passed. This includes PRs 337–339,
but predates the five-view/Camera changes above. Evidence is
`artifacts/settings-review/subview-integrated-verify.log` in the clean verification
checkout. Android builds remain excluded from this browser development campaign.

## Integrated source checkpoint — 2026-10-05 (historical)

Merged consumer `4145e3a930a736d97da463fc89237bb02ad4bbbb`, with upstream
`95924e90a75ec2b14f5835fa5f07d81115ccdb15`, passed `npm run verify`: 666 tests,
zero failures or skips, type checking, production build and the 245-file production
bundle audit. This combines Calendar creation, inline edits and modal editor
retention with account-bound Inbox unsaved recovery. Their owning browser campaigns
are recorded below; the completed older browser campaign is detailed below.
That campaign exposed outdated native fixtures without draft compare-and-exchange
and old single-line composer selectors. Updating the fixtures to retain exact
expected-value conflicts and select the visible textbox passed all 144 affected
Chromium cases, type checking and five documentation checks. These corrections
do not change production storage or relax draft admission. Evidence is
`artifacts/calendar-form-review/native-fixture-retention-final.log` in the primary
checkout. The broad run on the earlier frozen source remains a separate result.

On the same runtime pin, a fresh plain development restart passed actual browser
capture, Whisper transcription and Kokoro playback, completion, Stop and disconnect
in 13.6 seconds including runner startup. Hashed snapshots retained the same owner,
agent and 18 conversation identifiers. This is not a synthesis latency measurement.

A separate isolated real-Cerebras redaction campaign passed all six synthetic
contact/credential formats, streamed restoration and distinct-process restart.
All ten captured provider-bound request checks excluded the raw synthetic contact
and credential strings. The normal development profile was not changed. Approved
device actions, wider categories/models and Android remain separate qualification;
this bounded pass does not enable redaction by default on the development host.

Evidence is retained in the qualification checkout under
`artifacts/pr317-browser/`: `calendar-inbox-full-verify.log`,
`kokoro-current-browser.log`, hashed `kokoro-current-before.json` and
`kokoro-current-after.json`, and `current-redaction-qualification.log`.
The redaction summary is `test-results/local-redaction/result.json`.
No Android build was run for this integrated checkpoint.

Additional terminal browser evidence on October 5:

| Source and lane | Result | Scope |
| --- | --- | --- |
| `4d8d09097c4c89ce3f336950903e798f45f0051c`, Firefox and WebKit storage | 726 passed, zero failed (13.4 minutes) | Both configured cross-engine storage suites, including retained drafts and recovery; not every app journey in those engines |
| `af098a113b5173db9ba2edc9c924e3989a99f82f`, production surface | 11 passed, zero failed (13.7 seconds) | Flag-off build, real/empty entry points, absent developer surfaces and CSP behavior |

Logs are `artifacts/calendar-form-review/integrated-storage.log` and
`integrated-production.log` in the primary checkout. The broad Chromium campaign
on `4145e3a9` finished with 1,831 passed, 74 failed and 14 skipped (44.1 minutes).
Its failures use the older native draft fixtures, composer selectors and text
expectations corrected by PRs 328, 331 and 334. This is a failed campaign, not a
green integration result. Its Calendar guest failure used an ambiguous status
selector after editor-draft retention; selected-file and image-question expectations
still described the old input's discarded newlines. The corrected exact save-status
and multiline assertions passed all nine owning cases, including local OCR and
cancelled recognition (`artifacts/settings-review/remaining-browser.log` in the
`alpha-live-settings-review` checkout). No product behavior was weakened to satisfy
these assertions. These later focused passes do not relabel the earlier campaign
as green.

The normal-app selected-file review also now asserts preserved paragraph breaks
between the question, source name and edited excerpt. Both light/dark cases passed
while asserting zero sends from the review step
(`artifacts/calendar-form-review/selected-file-multiline.log`). The old assertion
expected the removed single-line input's newline stripping.

Subsequent repository verification passed at `978694b0` (671 tests) and
`b021874ffe1085e2ad1f850cbd1d772ee6215043` (674 tests), both with zero failures
or skips, type checking, production build and the 245-file bundle audit. Logs are
`artifacts/settings-review/latest-main-verify.log` and `final-integrated-verify.log`
in the `alpha-live-settings-review` checkout. A fresh full Chromium campaign on
`b021874f` remains in progress. These checkpoints predate the accessibility
follow-up below and do not qualify that later source.

The surface table that followed this checkpoint was replaced on 2026-10-10 by the
reconciled [surface inventory](#surface-inventory); its October 5 text is in Git history
(`docs/mvp-browser-review.md` at main `dfacccb3`).

## Subview accessibility follow-up — October 5 (historical)

An axe-core 4.14.0 scan of 86 light/dark reference app states found low-contrast
Calendar event details and adjacent-month dates, faint document-preview labels,
and dimmed paused-workflow descriptions. Workflow step icons also used labels on
plain spans without an image role. Event details now retain more foreground
contrast, adjacent-month dates use the muted text token, preview labels use a
readable gray, paused descriptions retain full opacity, and step icons have the
appropriate role. The fixture document preview is not a claim about imported PDF
accessibility or real document content.

All 22 reference-state rendering tests passed, along with type checking. The
repeated 86-state audit reported zero automated violations. It still returned
contrast items requiring manual review in 64 states, primarily because overlays,
images and partial overlaps prevent automatic background determination; these are
not passing contrast measurements. Calendar month and document preview captures
were inspected. Source and evidence are in the `alpha-album-documents` checkout,
under `artifacts/pr317-browser/subview-*` and
`test-results/root-accessibility-followup/design-*`. Broad screen-reader,
keyboard traversal of overlapping subviews and physical accessibility remain open.

The full Chromium campaign at `b021874ffe1085e2ad1f850cbd1d772ee6215043`
finished with 1,909 passed, 15 skipped and zero failures (31.6 minutes). The log is
`artifacts/calendar-form-review/current-main-chromium.log` in the primary checkout.
Its host-only skipped cases require separate profiles, and it predates PR 335 and
this subview follow-up. It must not be used as full-suite evidence for later code.

## Calendar month-picker focus ownership (historical)

The month dropdown previously covered day controls without removing them from
keyboard or screen-reader navigation. It now has a named modal dialog, its own
month navigation and close control, contained Tab/Shift+Tab focus, Escape/Back
handling and focus return. Covered phone controls become inert, and the assistant
dock stops painting over the picker. Picking a date, closing, or returning Home
releases ownership; the retired picker cannot consume Back in another app.
The calendar grid and controls scroll inside the bounded compact-height dialog.

All 103 owning Chromium root-state, Calendar draft and picker checks passed, plus
type checking. The final dock-visibility correction passed all four picker cases
(light/dark at 915px and 420px heights); its compact dark screenshot was inspected.
Evidence in the primary checkout is `artifacts/calendar-form-review/month-focus-*`
and the `test-results/browser/calendar-month-focus-*` captures. Other overlapping
subviews and native screen-reader/device behavior retain separate acceptance.
