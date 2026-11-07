# #678 Owner per-view approval and Seeker review of the MVP rows (H-38)

Owner preparation for [#678](https://github.com/eliza-research/alphaphone/issues/678) and
[human action](../human-actions.md) H-38. Agents prepared a report and a cross-check; they did not
set, and must never set, `items[].userApproval`. The Seeker column (`items[].seeker`) is filled from
the installed build with the device operator. Neither column is changed on this branch.

Prepared on this branch:

- `node scripts/owner/qa-approval-report.mjs [--json] [--out <file>]` reads
  `docs/app-qa-checklist.json` and `docs/app-qa-checklist.md` and prints the report below.
- `test/owner-qa-approval-report.test.mjs` checks that the report's counts equal the H-38 line of
  `npm run human:status`, on the committed checklist.

## Read-only findings (2026-10-28)

1. `npm run human:status` prints for H-38: "0 of 169 MVP rows approved by the owner; 135 still have
   no Seeker result". The report rebuilds both numbers from the JSON with the same predicates, and
   they agree. 169 MVP rows of 174 (1 deferred by the user, 3 AOSP only, 1 excluded).
2. human:status counts a row as having no Seeker result only when the Seeker value **starts with**
   "Pending". Seven more rows say the Seeker result is pending, unproven or not attempted without
   starting with "Pending" (`inbox-agent-mailbox`, `calendar-06`, `calendar-11`, `calendar-16`,
   `calendar-18`, `settings-google-account-controls`, `platform-native-google-broker`); human:status
   counts them as having a result. Read literally, 142 rows still lack a Seeker result.
3. The JSON has no separate `implemented` or `tested` field. The agent-filled columns are
   `implementation` (17 of 169 filled; 152 read "Needs review against current source") and
   `preview`, the preview QA column (65 filled, 104 "Pending…").
4. The Markdown page disagrees with the JSON on 18 rows (preview or Seeker cell), so an owner reading
   the page sees older values than human:status reads. The JSON is the record; regenerate the page
   or review from this report.
5. One row links prompt-proof evidence that is missing: `calendar-17` names
   `LATEST-CALENDAR-APPROVAL-STATUS.json`, which is not in the repository. Only 15 rows carry any
   evidence file and 8 a prompt-proof file; the rest have no per-row proof to open.
6. There is one preview for every row: `http://127.0.0.1:5209/`, a loopback address that exists only
   on the machine serving it, recorded at product `f0c7a79a7` on 2026-10-17. Before a review session,
   start the preview from the release candidate and note its commit; the checklist's preview cells
   describe the October 17 build.
7. human:status counts a row approved only when `userApproval` starts with "Approved". The issue
   allows "approved (or a filed defect)", but a row whose value names a defect keeps H-38 open (see
   Decisions).

## Review procedure per row

In the order the checklist gives, for each MVP row:

1. **Latest preview.** Open the preview at the candidate commit and the row's view; check light and
   dark, compact portrait, landscape, large text, keyboard and safe area, Back, reload and
   background, and the empty, loading, offline, error and denied states that apply.
2. **Deployed backend and prompt proof.** Open the row's evidence files in the report (where none is
   listed, there is no recorded prompt proof for that row; ask for one or record its absence).
3. **Installed build on the Seeker**, with the device operator: the exact installed APK SHA-256,
   gesture navigation and smoothness on the current Android build. The operator writes the result
   into `items[].seeker` (and the page), starting with "Pending" if it is not complete.
4. **Your approval.** Only you write `items[].userApproval`. Write `Approved <yyyy-mm-dd> at <commit>`
   for a row you personally accepted, or `Defect #<issue>` for a filed defect.

After each session: commit the JSON and the regenerated page together in a reviewed change, then run
`npm run human:status` and `node scripts/owner/qa-approval-report.mjs` and check that both counts
moved as expected.

## Decisions for the owner

| Question | Options | Documented default / recommendation | What each choice changes |
| --- | --- | --- | --- |
| Does a filed defect close a row for H-38? | (a) only "Approved…" counts (current script); (b) "Defect #n" also counts as reviewed | (a) is what `scripts/human-actions.mjs` does today; the issue text allows (b) | (a) H-38 stays open until every defect is fixed and re-approved; (b) needs a change to the H-38 check and makes "done" mean "reviewed", not "accepted" |
| Should pending-wording Seeker cells count as pending? | (a) keep the prefix rule; (b) also match pending/unproven/not attempted | (a) current | (b) raises the pending count from 135 to 142 today and keeps the count honest when an operator writes free text |
| Which file is the record? | JSON only (page regenerated from it); or both edited by hand | human:status reads only the JSON | Hand-editing both caused the 18 disagreements; regenerating removes them |
| What "latest preview" means | the preview of the release candidate (#662 build commit); or any current preview | Not set | Approvals against an older preview do not describe the release build |
| Seeker review device and build | the Seeker with the current installed build; or wait for the release APK | The checklist reviews the installed Seeker build | Reviewing before #662 means re-checking the Seeker column after the release build is installed |

## Remaining human steps

1. Start the preview at the candidate commit; note the commit.
2. With the device operator, review each MVP row in checklist order (preview, backend and prompt
   proof, installed Seeker build with gesture navigation and smoothness), recording `seeker`.
3. Record your own `userApproval` for each row you personally accept, or file a defect.
4. Commit the JSON and regenerated page; `npm run human:status` shows H-38 done when all 169 rows
   start with "Approved".

## Draft decision entries

Drafts for `docs/decisions.md`; the owner assigns numbers and dates.

- **P-NN — H-38 ([#678](https://github.com/eliza-research/alphaphone/issues/678)):** A row counts as done for H-38 when `userApproval` is `<only "Approved…" | "Approved…" or "Defect #n">`; the Seeker column counts as pending when it `<starts with "Pending" | says pending, unproven or not attempted anywhere>`; `docs/app-qa-checklist.json` is the record and the page is regenerated from it.

## Report: MVP rows by surface

Generated by `node scripts/owner/qa-approval-report.mjs` from `docs/app-qa-checklist.json` (updated 2026-10-17T23:08:00Z, product f0c7a79a7). Regenerate before each review; do not edit the table by hand.

- MVP rows: 169; owner-approved: 0.
- Agent columns: implementation filled on 17, preview QA filled on 65. The JSON has no separate `implemented` or `tested` field; `implementation` and `preview` are the agent-filled columns.
- Seeker: 27 rows record a result; 135 start with "Pending" (what `npm run human:status` counts); 7 more say pending/unproven/not attempted without starting with "Pending" and are counted by human:status as having a result.
- Rows with any evidence file: 15; with a prompt-proof file: 8; evidence files named but missing: 1.
- Rows where docs/app-qa-checklist.md disagrees with the JSON (preview, Seeker or approval cell): 18. The JSON is the record human:status reads.
- Preview: http://127.0.0.1:5209/ (one loopback preview for every row; it exists only on the machine that serves it).

| Surface | MVP rows | Implementation filled | Preview QA filled | Seeker pending | Approved |
| --- | --- | --- | --- | --- | --- |
| [Shell and Home](../app-qa-checklist.md#shell-and-home) | 15 | 5 | 8 | 11 | 0 |
| [Inbox](../app-qa-checklist.md#inbox) | 24 | 3 | 14 | 17 | 0 |
| [Calendar](../app-qa-checklist.md#calendar) | 20 | 1 | 9 | 18 | 0 |
| [Browser](../app-qa-checklist.md#browser) | 10 | 0 | 1 | 10 | 0 |
| [Camera](../app-qa-checklist.md#camera) | 14 | 2 | 8 | 14 | 0 |
| [Photos](../app-qa-checklist.md#photos) | 16 | 3 | 9 | 7 | 0 |
| [Maps](../app-qa-checklist.md#maps) | 10 | 0 | 2 | 10 | 0 |
| [Notes](../app-qa-checklist.md#notes) | 9 | 0 | 4 | 9 | 0 |
| [Files](../app-qa-checklist.md#files) | 9 | 0 | 3 | 9 | 0 |
| [Workflows](../app-qa-checklist.md#workflows) | 9 | 0 | 1 | 9 | 0 |
| [Settings](../app-qa-checklist.md#settings) | 19 | 1 | 2 | 17 | 0 |
| [Platform and release](../app-qa-checklist.md#platform-and-release) | 14 | 2 | 4 | 11 | 0 |

### Report: Shell and Home

| ID | View / flow | Impl. | Preview QA | Seeker | Approval | Prompt proof / evidence | Page agrees |
| --- | --- | --- | --- | --- | --- | --- | --- |
| shell-and-home-01 | Cold launch and saved connection restoration | no | yes | recorded | Pending | none | yes |
| shell-and-home-02 | Home cards and current calendar summary | no | yes | pending | Pending | none | yes |
| shell-and-home-03 | App grid and All apps search | yes | yes | recorded | Pending | [seeker-home-models-readonly-20261017.json](../evidence/seeker-home-models-readonly-20261017.json) | no (seeker) |
| shell-and-home-04 | Full-height layout and chat-pill clearance | no | yes | pending | Pending | none | yes |
| shell-and-home-05 | Back gesture and cross-app return | yes | yes | recorded | Pending | none | no (preview) |
| shell-and-home-06 | Chat pill, half sheet and full conversation | yes | yes | pending | Pending | none | no (preview) |
| shell-and-home-07 | Conversation history after reload | no | yes | pending | Pending | none | yes |
| shell-and-home-08 | Prompt cancellation and stale approval refusal | no | no | pending | Pending | none | yes |
| shell-and-home-09 | Voice start, interrupt, mute and stop | no | no | pending | Pending | none | yes |
| shell-and-home-10 | Keyboard opening, dismissal and focus | no | no | pending | Pending | none | yes |
| shell-and-home-11 | Notifications shade and ongoing activity | no | no | pending | Pending | none | yes |
| shell-and-home-12 | Lock, background, resume and secure camera | no | no | pending | Pending | none | yes |
| shell-and-home-13 | Loading, offline, denied, empty and recovery states | no | no | pending | Pending | none | yes |
| shell-ipc-recovery-review | Retained startup recovery records without resetting app data | yes | no | recorded | Pending | none | no (seeker) |
| shell-agent-app-navigation | Agent switches to every Home app | yes | yes | pending | Pending | `test/home-agent-navigation.test.mjs`, `test/native-view-fallback-installation.test.mjs` | no (preview) |

### Report: Inbox

| ID | View / flow | Impl. | Preview QA | Seeker | Approval | Prompt proof / evidence | Page agrees |
| --- | --- | --- | --- | --- | --- | --- | --- |
| inbox-01 | Inbox and unread rows | no | yes | recorded | Pending | none | yes |
| inbox-02 | Account and folder switching | no | no | pending | Pending | none | yes |
| inbox-03 | Search on Enter and mobile keyboard | no | yes | recorded | Pending | none | no (preview) |
| inbox-04 | Themed folder menu and removal of More/Search clutter | no | yes | recorded | Pending | none | yes |
| inbox-05 | Sender images in list and detail | no | yes | recorded | Pending | none | yes |
| inbox-06 | Preview apostrophes, entities and charset decoding | no | yes | pending | Pending | none | yes |
| inbox-07 | HTML email and default image loading | no | yes | pending | Pending | none | yes |
| inbox-08 | Image-loading preference | no | no | pending | Pending | none | yes |
| inbox-09 | Long email scrolling and no repeated link chips | no | no | pending | Pending | none | yes |
| inbox-10 | Sender address disclosure: From/To/Cc/Reply-to/date | no | yes | pending | Pending | none | yes |
| inbox-11 | Thread reading and attachments | no | no | pending | Pending | none | yes |
| inbox-12 | New compose alongside unfinished drafts | no | yes | pending | Pending | none | yes |
| inbox-13 | Reply, Reply all and Forward | no | yes | pending | Pending | none | yes |
| inbox-14 | Resume, discard and recover local drafts | no | no | pending | Pending | none | yes |
| inbox-15 | Provider drafts and attachments | no | no | pending | Pending | none | yes |
| inbox-16 | Spam, Archive, Sent, Starred and Trash reads | no | yes | pending | Pending | none | yes |
| inbox-17 | Read/unread, star, archive, trash and restore writes | no | no | pending | Pending | none | yes |
| inbox-18 | Agent list/search/read full email | no | yes | recorded | Pending | [seeker-a569-native-update-20261016.json](../evidence/seeker-a569-native-update-20261016.json), [integrated-preview-20261017.json](../evidence/integrated-preview-20261017.json) | no (preview, seeker) |
| inbox-19 | Agent self-addressed send and delivery readback | yes | yes | recorded | Pending | [gmail-prompt-send-20261016.json](../evidence/gmail-prompt-send-20261016.json), [seeker-cloud-read-20261017.json](../evidence/seeker-cloud-read-20261017.json) | no (preview, seeker) |
| inbox-20 | Send approval, cancellation, duplicate and uncertain outcome | no | no | pending | Pending | none | yes |
| inbox-21 | Account-scoped persistent cache and background refresh | no | yes | recorded | Pending | none | yes |
| inbox-22 | Disconnect/reconnect without cross-account data | no | no | pending | Pending | none | yes |
| inbox-agent-mailbox | Agent archive, trash and read-state changes | yes | yes | pending-wording | Pending | `scripts/gmail-agent-mailbox-host.ts`, `test/gmail-agent-read-host.test.mjs`, `backend/native-google-agent-host.ts`, `test/native-google-agent-host.test.mjs` | yes |
| inbox-agent-threaded-send | Agent threaded reply and forward | yes | no | pending | Pending | none | yes |

### Report: Calendar

| ID | View / flow | Impl. | Preview QA | Seeker | Approval | Prompt proof / evidence | Page agrees |
| --- | --- | --- | --- | --- | --- | --- | --- |
| calendar-01 | Agenda, day/week and month switching | no | no | pending | Pending | none | yes |
| calendar-02 | Today, date picker and month header | no | no | pending | Pending | none | yes |
| calendar-03 | Event detail and location links | no | no | pending | Pending | none | yes |
| calendar-04 | Create local event | no | no | recorded | Pending | [seeker-native-calendar-undo-20261016.json](../evidence/seeker-native-calendar-undo-20261016.json) | yes |
| calendar-05 | Edit local event and recurrence | no | no | pending | Pending | none | yes |
| calendar-06 | Delete local event and Undo | no | no | pending-wording | Pending | [seeker-native-calendar-undo-20261016.json](../evidence/seeker-native-calendar-undo-20261016.json) | yes |
| calendar-07 | Reminders, alerts and notification delivery | no | no | pending | Pending | none | yes |
| calendar-08 | Google accounts and permissions in Settings | no | yes | recorded | Pending | none | yes |
| calendar-09 | Google calendars list and selected source | no | no | pending | Pending | none | yes |
| calendar-10 | Local-first use before Google connection | no | no | pending | Pending | none | yes |
| calendar-11 | Google linked sync enable, destination and status | no | yes | pending-wording | Pending | none | yes |
| calendar-12 | Persistent cache and background reconciliation | no | yes | pending | Pending | none | yes |
| calendar-13 | Agent calendar sources and agenda read | no | yes | pending | Pending | none | yes |
| calendar-14 | Agent Google event create and readback | no | yes | pending | Pending | none | yes |
| calendar-15 | Agent Google event update and replay protection | no | yes | pending | Pending | none | yes |
| calendar-16 | Agent Google event deletion and provider readback | yes | yes | pending-wording | Pending | [calendar-prompt-lifecycle-20261016.json](../evidence/calendar-prompt-lifecycle-20261016.json) | no (preview, seeker) |
| calendar-17 | Uncertain deletion reconciliation without duplicate write | no | yes | pending | Pending | `LATEST-CALENDAR-APPROVAL-STATUS.json` (missing: LATEST-CALENDAR-APPROVAL-STATUS.json) | yes |
| calendar-18 | Native consent and CalendarProvider writes | no | yes | pending-wording | Pending | none | yes |
| calendar-19 | Native linked sync, restart recovery and Undo | no | no | pending | Pending | none | yes |
| calendar-20 | Account switch, expired consent and offline recovery | no | no | pending | Pending | none | yes |

### Report: Browser

| ID | View / flow | Impl. | Preview QA | Seeker | Approval | Prompt proof / evidence | Page agrees |
| --- | --- | --- | --- | --- | --- | --- | --- |
| browser-01 | Blank/new tab and address search | no | no | pending | Pending | none | yes |
| browser-02 | Real website rendering and navigation | no | yes | pending | Pending | none | yes |
| browser-03 | Back, Forward and same-URL reload | no | no | pending | Pending | none | yes |
| browser-04 | Tabs create, switch and close | no | no | pending | Pending | none | yes |
| browser-05 | Bookmarks and history | no | no | pending | Pending | none | yes |
| browser-06 | Downloads and selected-file handoff | no | no | pending | Pending | none | yes |
| browser-07 | Share page, selection and Ask Alpha | no | no | pending | Pending | none | yes |
| browser-08 | Permissions, popups, errors and recovery | no | no | pending | Pending | none | yes |
| browser-09 | Autofill and password-provider handoff | no | no | pending | Pending | none | yes |
| browser-10 | Read aloud and speech lifecycle | no | no | pending | Pending | none | yes |

### Report: Camera

| ID | View / flow | Impl. | Preview QA | Seeker | Approval | Prompt proof / evidence | Page agrees |
| --- | --- | --- | --- | --- | --- | --- | --- |
| camera-01 | Photo mode and actual capture | no | yes | pending | Pending | none | yes |
| camera-02 | Video mode, recording clock and stop | no | yes | pending | Pending | none | yes |
| camera-03 | Mode switching, front/back and zoom | no | yes | pending | Pending | none | yes |
| camera-04 | Focus, exposure and supported flash controls | no | yes | pending | Pending | none | yes |
| camera-05 | Permission denied, device busy and track termination | no | yes | pending | Pending | none | yes |
| camera-06 | Transient toast timeout and centered logo | no | no | pending | Pending | none | yes |
| camera-07 | Capture review and session gallery | no | no | pending | Pending | none | yes |
| camera-08 | Scan capture, add/reorder/remove pages | no | no | pending | Pending | none | yes |
| camera-09 | Scan draft save, load and explicit removal | no | no | pending | Pending | none | yes |
| camera-10 | Image PDF and searchable PDF export | no | no | pending | Pending | none | yes |
| camera-11 | Compact Ask Alpha review and OCR | no | yes | pending | Pending | none | yes |
| camera-12 | Exit/background recording and save behavior | no | no | pending | Pending | none | yes |
| camera-agent-capture | Agent takes and saves one requested photo | yes | yes | pending | Pending | prompt named in text, no file | no (preview, seeker) |
| camera-13 | Agent takes one photo from Home or visible Camera | yes | yes | pending | Pending | prompt named in text, no file | no (preview, seeker) |

### Report: Photos

| ID | View / flow | Impl. | Preview QA | Seeker | Approval | Prompt proof / evidence | Page agrees |
| --- | --- | --- | --- | --- | --- | --- | --- |
| photos-01 | Library groups and thumbnail loading | no | yes | pending | Pending | none | yes |
| photos-02 | Stable top-bar layout across Photos/Albums | no | yes | recorded | Pending | none | yes |
| photos-03 | Albums list, contents, selection and batch actions | no | yes | recorded | Pending | none | yes |
| photos-04 | Search, favorites and empty results | no | no | pending | Pending | none | yes |
| photos-05 | Photo viewer, zoom and previous/next | no | no | recorded | Pending | none | yes |
| photos-06 | Video playback and controls | no | no | pending | Pending | none | yes |
| photos-07 | Photo edits save as copy | no | no | pending | Pending | none | yes |
| photos-08 | Video trim timeline, rotate, crop and preview | yes | yes | recorded | Pending | [native-video-component-20261017.json](../evidence/native-video-component-20261017.json), [native-video-callback-20261017.json](../evidence/native-video-callback-20261017.json), [seeker-paused-video-editor-20261017.json](../evidence/seeker-paused-video-editor-20261017.json) | no (seeker) |
| photos-09 | Edited-video audio, original preservation and save-copy | yes | yes | recorded | Pending | [native-video-component-20261017.json](../evidence/native-video-component-20261017.json), [native-video-callback-20261017.json](../evidence/native-video-callback-20261017.json), [seeker-video-save-failure-20261017.json](../evidence/seeker-video-save-failure-20261017.json), [native-video-pending-custody-20261017.json](../evidence/native-video-pending-custody-20261017.json), [native-video-exporter-1d29-20261017.json](../evidence/native-video-exporter-1d29-20261017.json), [native-video-library-observer-20261017.json](../evidence/native-video-library-observer-20261017.json), [native-video-owner-preservation-source-20261017.json](../evidence/native-video-owner-preservation-source-20261017.json), [native-video-bff09-seeker-seal-failure-20261017.json](../evidence/native-video-bff09-seeker-seal-failure-20261017.json), [native-video-preservation-bd0e-seeker-20261017.json](../evidence/native-video-preservation-bd0e-seeker-20261017.json) | no (seeker) |
| photos-10 | Info and metadata | no | no | pending | Pending | none | yes |
| photos-11 | Share/export actual result | no | no | pending | Pending | none | yes |
| photos-12 | Recently Deleted opens preview on tap | no | yes | recorded | Pending | none | no (preview) |
| photos-13 | Recover one or selected items | no | yes | recorded | Pending | none | yes |
| photos-14 | Permanently delete only explicit selected items | no | yes | recorded | Pending | none | yes |
| photos-15 | Selection cancel, empty selection and toolbar states | no | no | pending | Pending | none | yes |
| photos-16 | Native permitted library and consent updates | yes | yes | recorded | Pending | [photo-access-settings-native-20261016.json](../evidence/photo-access-settings-native-20261016.json) | no (preview, seeker) |

### Report: Maps

| ID | View / flow | Impl. | Preview QA | Seeker | Approval | Prompt proof / evidence | Page agrees |
| --- | --- | --- | --- | --- | --- | --- | --- |
| maps-01 | Real map tiles and rendering | no | yes | pending | Pending | none | yes |
| maps-02 | Location consent, fix and retry | no | yes | pending | Pending | none | yes |
| maps-03 | Manual origin and coordinate entry | no | no | pending | Pending | none | yes |
| maps-04 | Place search, results and empty state | no | no | pending | Pending | none | yes |
| maps-05 | Place details and saved places | no | no | pending | Pending | none | yes |
| maps-06 | Directions preview and mode selection | no | no | pending | Pending | none | yes |
| maps-07 | Navigation start, progress, arrival and stop | no | no | pending | Pending | none | yes |
| maps-08 | Location expiry, offline and provider errors | no | no | pending | Pending | none | yes |
| maps-09 | Theme, large text, landscape and regional renderer | no | no | pending | Pending | none | yes |
| maps-10 | Agent route request and allowance handling | no | no | pending | Pending | none | yes |

### Report: Notes

| ID | View / flow | Impl. | Preview QA | Seeker | Approval | Prompt proof / evidence | Page agrees |
| --- | --- | --- | --- | --- | --- | --- | --- |
| notes-01 | List, pinned notes and search | no | yes | pending | Pending | none | yes |
| notes-02 | Create, edit and save text note | no | yes | pending | Pending | none | yes |
| notes-03 | Checklist conversion and item editing | no | no | pending | Pending | none | yes |
| notes-04 | Reload/restart persistence | no | yes | pending | Pending | none | yes |
| notes-05 | Recoverable trash and explicit restore | no | yes | pending | Pending | none | yes |
| notes-06 | Recording, dictation and interruption | no | no | pending | Pending | none | yes |
| notes-07 | Voice playback, transcript and summary | no | no | pending | Pending | none | yes |
| notes-08 | Share and selected note Ask Alpha | no | no | pending | Pending | none | yes |
| notes-09 | Conflict, full storage and retained damaged data | no | no | pending | Pending | none | yes |

### Report: Files

| ID | View / flow | Impl. | Preview QA | Seeker | Approval | Prompt proof / evidence | Page agrees |
| --- | --- | --- | --- | --- | --- | --- | --- |
| files-01 | Root and actual storage usage | no | yes | pending | Pending | none | yes |
| files-02 | Folder create, open, rename and reload | no | yes | pending | Pending | none | yes |
| files-03 | Search, sorting and grid/list | no | no | pending | Pending | none | yes |
| files-04 | Native folder grant and revoked permission | no | no | pending | Pending | none | yes |
| files-05 | Selection and disabled empty-selection actions | no | yes | pending | Pending | none | yes |
| files-06 | Document, image, audio and video preview | no | no | pending | Pending | none | yes |
| files-07 | Rename, share and export | no | no | pending | Pending | none | yes |
| files-08 | Selected-file Ask Alpha and cancellation | no | no | pending | Pending | none | yes |
| files-09 | Empty, busy, unsupported, offline and error states | no | no | pending | Pending | none | yes |

### Report: Workflows

| ID | View / flow | Impl. | Preview QA | Seeker | Approval | Prompt proof / evidence | Page agrees |
| --- | --- | --- | --- | --- | --- | --- | --- |
| workflows-01 | List and enabled/disabled states | no | no | pending | Pending | none | yes |
| workflows-02 | Detail and trigger/action graph | no | no | pending | Pending | none | yes |
| workflows-03 | Create and edit workflow | no | no | pending | Pending | none | yes |
| workflows-04 | Reviewed activation and permission scope | no | no | pending | Pending | none | yes |
| workflows-05 | Run, cancel and duplicate prevention | no | no | pending | Pending | none | yes |
| workflows-06 | Run history, failed steps and retry | no | no | pending | Pending | none | yes |
| workflows-07 | Reminder list refresh and completion | no | yes | pending | Pending | none | yes |
| workflows-08 | Schedule timing and restart recovery | no | no | pending | Pending | none | yes |
| workflows-09 | Agent workflow creation and selected-run context | no | no | pending | Pending | none | yes |

### Report: Settings

| ID | View / flow | Impl. | Preview QA | Seeker | Approval | Prompt proof / evidence | Page agrees |
| --- | --- | --- | --- | --- | --- | --- | --- |
| settings-01 | Top-level row alignment and text wrapping | no | no | pending | Pending | none | yes |
| settings-02 | Character and assistant preferences | no | no | pending | Pending | none | yes |
| settings-03 | Accounts and Google consent | no | yes | recorded | Pending | none | yes |
| settings-04 | Connections and exact access labels | no | no | pending | Pending | none | yes |
| settings-05 | Gmail image-loading preference | no | no | pending | Pending | none | yes |
| settings-06 | Calendar sync settings and status | no | no | pending | Pending | none | yes |
| settings-07 | Privacy, permissions and activity | no | no | pending | Pending | none | yes |
| settings-08 | Password provider and autofill | no | no | pending | Pending | none | yes |
| settings-09 | Display, theme and text size | no | no | pending | Pending | none | yes |
| settings-10 | Sound, vibration and Do Not Disturb | no | no | pending | Pending | none | yes |
| settings-11 | Notifications and channels | no | no | pending | Pending | none | yes |
| settings-12 | Wi-Fi, Bluetooth and mobile settings handoff | no | no | pending | Pending | none | yes |
| settings-13 | Battery and unavailable capability presentation | no | no | pending | Pending | none | yes |
| settings-14 | Models and local speech readiness | no | yes | recorded | Pending | [seeker-home-models-readonly-20261017.json](../evidence/seeker-home-models-readonly-20261017.json) | no (preview, seeker) |
| settings-15 | Subscription/plan and service status | no | no | pending | Pending | none | yes |
| settings-16 | Problems, diagnostics and licenses | no | no | pending | Pending | none | yes |
| settings-17 | About and actual installed version | no | no | pending | Pending | none | yes |
| settings-18 | Reset Alpha data scoped to disposable native qualification | no | no | pending | Pending | none | yes |
| settings-google-account-controls | Google account card (no calendar picker: Calendar is one merged view), theme and Back | yes | no | pending-wording | Pending | none | yes |

### Report: Platform and release

| ID | View / flow | Impl. | Preview QA | Seeker | Approval | Prompt proof / evidence | Page agrees |
| --- | --- | --- | --- | --- | --- | --- | --- |
| platform-and-release-01 | Standalone Android capability boundaries | no | no | pending | Pending | none | yes |
| platform-and-release-02 | Seeker signed update preserving app data | no | no | pending | Pending | none | yes |
| platform-and-release-03 | Native Calendar consent/sync/write/Undo acceptance | no | no | pending | Pending | none | yes |
| platform-and-release-04 | Native Gmail prompt read/send and delivery | no | no | recorded | Pending | [seeker-native-startup-20261017.json](../evidence/seeker-native-startup-20261017.json), [seeker-cloud-read-20261017.json](../evidence/seeker-cloud-read-20261017.json) | no (seeker) |
| platform-and-release-05 | Native Camera/Photos and permitted media | no | no | pending | Pending | none | yes |
| platform-and-release-06 | Native Maps/location and navigation | no | no | pending | Pending | none | yes |
| platform-and-release-07 | Native voice and lifecycle | no | no | pending | Pending | none | yes |
| platform-and-release-12 | Latest source/runtime/build/installed provenance | no | yes | recorded | Pending | none | yes |
| platform-and-release-13 | Host verification and production bundle audit | no | yes | pending | Pending | none | yes |
| platform-and-release-14 | Hosted CI at published head | no | yes | pending | Pending | none | no (preview) |
| platform-and-release-15 | Commits, upstream pins and PR reconciliation | no | no | pending | Pending | none | yes |
| platform-and-release-16 | Human per-view approval and final acceptance | no | no | pending | Pending | none | yes |
| platform-native-google-broker | Native managed Google broker and account binding | yes | yes | pending-wording | Pending | `backend/native-google-agent-host.ts`, `backend/native-google-cloud-port.ts`, `scripts/native-google-host-artifact.mjs`, `test/native-google-agent-host.test.mjs` | yes |
| platform-google-oauth-callback | Native Google OAuth completion page and independent grant readback | yes | no | recorded | Pending | none | yes |
