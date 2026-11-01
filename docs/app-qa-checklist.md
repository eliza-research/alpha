# Alpha app QA and approval checklist

Live preview: <http://127.0.0.1:5209/>. Product `f0c7a79a7` (microphone lifecycle hotfix), runtime `623b3f8d6d`, SDK `985322b5`. The controlled update retained the Cloud account, 14 rooms and 233 message hashes. A read-only EC7 navigation pass covered Home, Settings, Connections, Inbox, Calendar, Photos/Albums, Files, Notes, Workflows, Browser, Maps and All apps. Current sensor, provider-write, voice and Seeker acceptance remain separate. Updated October 17, 2026.

The JSON companion tracks 174 flows across 12 areas and all14 registered view modules. Implementation, preview QA, Seeker QA and your approval are separate. Only you mark approval.

For each applicable flow check light/dark, compact portrait, landscape, large text, keyboard and safe areas, Back, reload/resume, empty/loading/offline/error/denied states. Add discovered branches before closing coverage.

Review order: latest preview → deployed backend/prompt proof → installed Seeker → your per-view approval. Labels/categories remain deferred; Phone/Messages/Contacts require AOSP; Wallet is excluded.

Latest installed Seeker evidence: `2446a567`, signed APK `06df1c83…36572fb`, existing certificate, UID10250 and original install date preserved. Normal SDK/product verification, four variants, lint and APK checks passed. The valid saved credential now commits a provider binding; resident is now running with Cloud inference and connected Google permissions after all eight retired IPC directories were archived intact. One known-QA Gmail read prompt failed at Cloud text HTTP400; no Gmail tool/provider result was observed. Native send and Calendar write were not attempted. See [native read evidence](evidence/seeker-cloud-read-20261017.json). Prior row evidence stays labeled by its observed build; human approval remains separate.

Prepared camera successor: the SDK remains `985322b5`; the separate runtime candidate is `e52c019f`. The corrected foreground capture flow passes 12 browser cases, including encoded-photo persistence, Home navigation, old-request refusal and ask-first. Realtime completion/navigation ordering passes 14 source tests. The prior baseline passed 1,624 of 1,626 checks with 2 skips, and 49 cross-view layout cases passed. Five production review cases also pass. Final combined verification, a real camera prompt and Seeker acceptance remain pending.

## Shell and Home

| ID | View / flow | Preview evidence | Seeker | Your approval |
| --- | --- | --- | --- | --- |
| shell-and-home-01 | Cold launch and saved connection restoration | Installed574 launches and resident reconnects; existing account retained. Human startup QA pending. | Exact installed APK hash verified; running resident visible. | Pending |
| shell-and-home-02 | Home cards and current calendar summary | EC7 live Home checked: current calendar card has no This app or Read-time clutter. | Pending | Pending |
| shell-and-home-03 | App grid and All apps search | EC7 live Home and All apps opened; all 10 shipped app entries present. | Integrated native retest pending | Pending |
| shell-and-home-04 | Full-height layout and chat-pill clearance | EC7 live Home labels and Settings bottom rows clear the dock. Other viewport combinations pending. | Pending | Pending |
| shell-and-home-05 | Back gesture and cross-app return | Current source tests cover modal/popover Back; latest preview visual QA pending. | Google panel Back closes to Accounts; folder popup Back keeps Inbox open at574. | Pending |
| shell-and-home-06 | Chat pill, half sheet and full conversation | Pending | Pending | Pending |
| shell-and-home-07 | Conversation history after reload | EC7/623b controlled transition preserved 14 rooms and 233 message hashes. Selected UI conversation replay remains unverified. | Pending | Pending |
| shell-and-home-08 | Prompt cancellation and stale approval refusal | Pending | Pending | Pending |
| shell-and-home-09 | Voice start, interrupt, mute and stop | Pending | Pending | Pending |
| shell-and-home-10 | Keyboard opening, dismissal and focus | Pending | Pending | Pending |
| shell-and-home-11 | Notifications shade and ongoing activity | Pending | Pending | Pending |
| shell-and-home-12 | Lock, background, resume and secure camera | Pending | Pending | Pending |
| shell-and-home-13 | Loading, offline, denied, empty and recovery states | Pending | Pending | Pending |
| shell-ipc-recovery-review | Retained startup recovery records without resetting app data | Pending visible QA | Eight Oct8/9 retired IPC directories archived intact; live IPC unchanged; resident started. | Pending |

## Inbox

| ID | View / flow | Preview evidence | Seeker | Your approval |
| --- | --- | --- | --- | --- |
| inbox-01 | Inbox and unread rows | EC7 live Inbox rendered 25 real rows and account connection. No message was opened or marked read during this pass. | Real native Gmail rows loaded;10 cached rows visible on574. | Pending |
| inbox-02 | Account and folder switching | Pending | Pending | Pending |
| inbox-03 | Search on Enter and mobile keyboard | Search implementation retained; latest browser visual QA pending. | Enter returned10 matching Coinbase rows at4d; no separate Search Gmail button. | Pending |
| inbox-04 | Themed folder menu and removal of More/Search clutter | Custom themed folder menu implemented; browser visual QA pending. | Themed popup visibly verified; Android Back corrected and verified at574. | Pending |
| inbox-05 | Sender images in list and detail | Sender avatars implemented; latest browser QA pending. | LinkedIn/Google/Robinhood logos visibly loaded; unavailable logos use initials. | Pending |
| inbox-06 | Preview apostrophes, entities and charset decoding | Prior preview pass; latest retest pending | Pending | Pending |
| inbox-07 | HTML email and default image loading | Prior preview pass; latest retest pending | Pending | Pending |
| inbox-08 | Image-loading preference | Pending | Pending | Pending |
| inbox-09 | Long email scrolling and no repeated link chips | Pending | Pending | Pending |
| inbox-10 | Sender address disclosure: From/To/Cc/Reply-to/date | Prior preview pass; latest retest pending | Pending | Pending |
| inbox-11 | Thread reading and attachments | Pending | Pending | Pending |
| inbox-12 | New compose alongside unfinished drafts | Prior preview pass; latest retest pending | Pending | Pending |
| inbox-13 | Reply, Reply all and Forward | Prior preview pass; latest retest pending | Pending | Pending |
| inbox-14 | Resume, discard and recover local drafts | Pending | Pending | Pending |
| inbox-15 | Provider drafts and attachments | Pending | Pending | Pending |
| inbox-16 | Spam, Archive, Sent, Starred and Trash reads | Prior preview pass; latest retest pending | Pending | Pending |
| inbox-17 | Read/unread, star, archive, trash and restore writes | Pending | Pending | Pending |
| inbox-18 | Agent list/search/read full email | Real agent list/search/full-message reads passed atShared33a6; installed Seeker proof pending | Pending | Pending |
| inbox-19 | Agent self-addressed send and delivery readback | Verified: exact draft → plain Yes → Gmail succeeded receipt → same message in Inbox → exact full body → agent search/read. Earlier uncertain send untouched. | 2446 running and Google connected. One known-QA read failed at Cloud text HTTP400; native send remains unproven. | Pending |
| inbox-20 | Send approval, cancellation, duplicate and uncertain outcome | Pending | Pending | Pending |
| inbox-21 | Account-scoped persistent cache and background refresh | Account-scoped cache implemented and source-tested. | Warm re-entry showed10 mail rows without connection loading at first UI observation (2.727s including inspection overhead). | Pending |
| inbox-22 | Disconnect/reconnect without cross-account data | Pending | Pending | Pending |
| inbox-23 | Labels/categories | Outside current standalone QA | Not applicable | Scope recorded |
| inbox-agent-mailbox | Agent archive, trash and read-state changes | Wired on latest preview; live provider proof pending backend and modify consent | Native host wiring implemented and source-tested; installed provider proof pending | Pending |
| inbox-agent-threaded-send | Agent threaded reply and forward | Pending | Pending | Pending |

## Calendar

| ID | View / flow | Preview evidence | Seeker | Your approval |
| --- | --- | --- | --- | --- |
| calendar-01 | Agenda, day/week and month switching | Pending | Pending | Pending |
| calendar-02 | Today, date picker and month header | Pending | Pending | Pending |
| calendar-03 | Event detail and location links | Pending | Pending | Pending |
| calendar-04 | Create local event | Pending | Installedef36: disposable event saved to Alpha Phone local calendar; exact title/time/source provider readback verified. | Pending |
| calendar-05 | Edit local event and recurrence | Pending | Pending | Pending |
| calendar-06 | Delete local event and Undo | Pending | Installedef36: native scoped deletion review, ten-second Undo and original-field readback passed. Separate QA cleanup absence confirmed after app resume. Stale native row refresh fixed in source; new APK retest pending. | Pending |
| calendar-07 | Reminders, alerts and notification delivery | Pending | Pending | Pending |
| calendar-08 | Google accounts and permissions in Settings | Google connection manager retained; latest browser QA pending. | Native read/send and Calendar read/edit grants independently verified after approved Mac Chrome consent. | Pending |
| calendar-09 | Google calendars list and selected source | Pending | Pending | Pending |
| calendar-10 | Local-first use before Google connection | Pending | Pending | Pending |
| calendar-11 | Google linked sync enable, destination and status | Sync review implemented; live sync acceptance pending. | Settings entry reachable at4d; configured-destination review refused context; no enable/write. Latest574 error-guide retest pending. | Pending |
| calendar-12 | Persistent cache and background reconciliation | Prior preview pass; latest retest pending | Pending | Pending |
| calendar-13 | Agent calendar sources and agenda read | Prior preview pass; latest retest pending | Pending | Pending |
| calendar-14 | Agent Google event create and readback | Prior preview pass; latest retest pending | Pending | Pending |
| calendar-15 | Agent Google event update and replay protection | Prior preview pass; latest retest pending | Pending | Pending |
| calendar-16 | Agent Google event deletion and provider readback | Verified: disposable create/read → saved delete review → approve → provider accepted → exact event absent → agent read-only confirmation. Original uncertain deletion untouched. | Native routing-fix APK and prompt retest pending | Pending |
| calendar-17 | Uncertain deletion reconciliation without duplicate write | Latest canonical read: original approval still executing | Pending | Pending |
| calendar-18 | Native consent and CalendarProvider writes | Native consent bridge and current-main write guard implemented. | Device access already allowed; exact native consent guard tests passed. Live write/Undo acceptance pending. | Pending |
| calendar-19 | Native linked sync, restart recovery and Undo | Pending | Pending | Pending |
| calendar-20 | Account switch, expired consent and offline recovery | Pending | Pending | Pending |

## Browser

| ID | View / flow | Preview evidence | Seeker | Your approval |
| --- | --- | --- | --- | --- |
| browser-01 | Blank/new tab and address search | Pending | Pending | Pending |
| browser-02 | Real website rendering and navigation | Prior preview pass; latest retest pending | Pending | Pending |
| browser-03 | Back, Forward and same-URL reload | Pending | Pending | Pending |
| browser-04 | Tabs create, switch and close | Pending | Pending | Pending |
| browser-05 | Bookmarks and history | Pending | Pending | Pending |
| browser-06 | Downloads and selected-file handoff | Pending | Pending | Pending |
| browser-07 | Share page, selection and Ask Alpha | Pending | Pending | Pending |
| browser-08 | Permissions, popups, errors and recovery | Pending | Pending | Pending |
| browser-09 | Autofill and password-provider handoff | Pending | Pending | Pending |
| browser-10 | Read aloud and speech lifecycle | Pending | Pending | Pending |

## Camera

| ID | View / flow | Preview evidence | Seeker | Your approval |
| --- | --- | --- | --- | --- |
| camera-01 | Photo mode and actual capture | Current Chromium: real encoded synthetic frame persists and reloads; failed storage creates no photo. Physical sensor pending. | Pending | Pending |
| camera-02 | Video mode, recording clock and stop | Browser MediaRecorder and edit-copy cases passed with synthetic video/audio; native recording pending. | Pending | Pending |
| camera-03 | Mode switching, front/back and zoom | Current browser camera control tests pass for zoomed pixels, front mirroring and switching reset. | Pending | Pending |
| camera-04 | Focus, exposure and supported flash controls | Current browser control tests pass for focus/zoom and confirmed torch capability; physical hardware pending. | Pending | Pending |
| camera-05 | Permission denied, device busy and track termination | Prior preview pass; latest retest pending | Pending | Pending |
| camera-06 | Transient toast timeout and centered logo | Pending | Pending | Pending |
| camera-07 | Capture review and session gallery | Pending | Pending | Pending |
| camera-08 | Scan capture, add/reorder/remove pages | Pending | Pending | Pending |
| camera-09 | Scan draft save, load and explicit removal | Pending | Pending | Pending |
| camera-10 | Image PDF and searchable PDF export | Pending | Pending | Pending |
| camera-11 | Compact Ask Alpha review and OCR | Compact image/content review tests pass at150% text in light and dark; device/OCR acceptance remains separate. | Pending | Pending |
| camera-12 | Exit/background recording and save behavior | Pending | Pending | Pending |

| camera-13 | Agent takes one photo from Home or visible Camera | Isolated successor: 4 rendered synthetic tests and 16 focused tests pass; real sensor/provider prompt pending. | Pending | Pending |

## Photos

| ID | View / flow | Preview evidence | Seeker | Your approval |
| --- | --- | --- | --- | --- |
| photos-01 | Library groups and thumbnail loading | Browser encoded-photo persistence/reload passes with synthetic camera. Native library acceptance remains pending. | Pending | Pending |
| photos-02 | Stable top-bar layout across Photos/Albums | EC7 live empty Photos and Albums checked: stable toolbar and Select present. | Search/select x-positions stayed943/1101 between Photos and Albums at4d. Mode accessibility names need review. | Pending |
| photos-03 | Albums list, contents, selection and batch actions | Albums list/contents implemented; selection and batch-action review pending. | Native Albums list opened. Current Select photos action targets library; native custom-album selection remains open. | Pending |
| photos-04 | Search, favorites and empty results | Pending | Pending | Pending |
| photos-05 | Photo viewer, zoom and previous/next | Pending | Opened the newly captured960x1280 QA photo on574; local viewer controls rendered. | Pending |
| photos-06 | Video playback and controls | Pending | Pending | Pending |
| photos-07 | Photo edits save as copy | Pending | Pending | Pending |
| photos-08 | Video trim timeline, rotate, crop and preview | 33 current browser video/storage regressions pass; native UI/gesture qualification is separate. | Exact production exporter component passes real trim/clockwise rotate/crop and timestamps. Full Alpha editor UI has not yet been installed/qualified. | Pending |
| photos-09 | Edited-video audio, original preservation and save-copy | 33 video/storage regressions, TypeScript and20 static integration checks pass. Browser checks do not establish Android hardware behavior. | Two actual offline Seeker component tests pass: decoded audio, original bytes/revision, physical trim samples, publish-receipt recovery, no duplicate, changed binding/source refusal and background cancellation. Full Alpha UI/revocation/process-death qualification remains pending. | Pending |
| photos-10 | Info and metadata | Pending | Pending | Pending |
| photos-11 | Share/export actual result | Pending | Pending | Pending |
| photos-12 | Recently Deleted opens preview on tap | Prior preview pass; latest retest pending | Passed574: tapping the deleted QA item opened Deleted photo preview; no restore occurred. | Pending |
| photos-13 | Recover one or selected items | Prior preview pass; latest retest pending | Passed574: explicit Recover restored the sole QA item; trashcount returned0. | Pending |
| photos-14 | Permanently delete only explicit selected items | Prior preview pass; latest retest pending | Passed574: selected only the new QA photo; expired review refused; fresh one-item review permanently deleted it; trashcount0. | Pending |
| photos-15 | Selection cancel, empty selection and toolbar states | Pending | Pending | Pending |
| photos-16 | Native permitted library and consent updates | Four current-candidate permission regressions pass: Settings controls, selected access, denied request/approval, and revocation. New manual preview observation unavailable while browser controls are disabled. | Installeda569f79c: fresh Settings > Photos readback and Android permissions navigation passed; existing grant unchanged. Denied access retains explicit request. | Pending |

## Maps

| ID | View / flow | Preview evidence | Seeker | Your approval |
| --- | --- | --- | --- | --- |
| maps-01 | Real map tiles and rendering | Prior preview pass; latest retest pending | Pending | Pending |
| maps-02 | Location consent, fix and retry | Prior preview pass; latest retest pending | Pending | Pending |
| maps-03 | Manual origin and coordinate entry | Pending | Pending | Pending |
| maps-04 | Place search, results and empty state | Pending | Pending | Pending |
| maps-05 | Place details and saved places | Pending | Pending | Pending |
| maps-06 | Directions preview and mode selection | Pending | Pending | Pending |
| maps-07 | Navigation start, progress, arrival and stop | Pending | Pending | Pending |
| maps-08 | Location expiry, offline and provider errors | Pending | Pending | Pending |
| maps-09 | Theme, large text, landscape and regional renderer | Pending | Pending | Pending |
| maps-10 | Agent route request and allowance handling | Pending | Pending | Pending |

## Notes

| ID | View / flow | Preview evidence | Seeker | Your approval |
| --- | --- | --- | --- | --- |
| notes-01 | List, pinned notes and search | Prior preview pass; latest retest pending | Pending | Pending |
| notes-02 | Create, edit and save text note | Prior preview pass; latest retest pending | Pending | Pending |
| notes-03 | Checklist conversion and item editing | Pending | Pending | Pending |
| notes-04 | Reload/restart persistence | Prior preview pass; latest retest pending | Pending | Pending |
| notes-05 | Recoverable trash and explicit restore | Prior preview pass; latest retest pending | Pending | Pending |
| notes-06 | Recording, dictation and interruption | Pending | Pending | Pending |
| notes-07 | Voice playback, transcript and summary | Pending | Pending | Pending |
| notes-08 | Share and selected note Ask Alpha | Pending | Pending | Pending |
| notes-09 | Conflict, full storage and retained damaged data | Pending | Pending | Pending |

## Files

| ID | View / flow | Preview evidence | Seeker | Your approval |
| --- | --- | --- | --- | --- |
| files-01 | Root and actual storage usage | Prior preview pass; latest retest pending | Pending | Pending |
| files-02 | Folder create, open, rename and reload | Prior preview pass; latest retest pending | Pending | Pending |
| files-03 | Search, sorting and grid/list | Pending | Pending | Pending |
| files-04 | Native folder grant and revoked permission | Pending | Pending | Pending |
| files-05 | Selection and disabled empty-selection actions | Prior preview pass; latest retest pending | Pending | Pending |
| files-06 | Document, image, audio and video preview | Pending | Pending | Pending |
| files-07 | Rename, share and export | Pending | Pending | Pending |
| files-08 | Selected-file Ask Alpha and cancellation | Pending | Pending | Pending |
| files-09 | Empty, busy, unsupported, offline and error states | Pending | Pending | Pending |

## Workflows

| ID | View / flow | Preview evidence | Seeker | Your approval |
| --- | --- | --- | --- | --- |
| workflows-01 | List and enabled/disabled states | Pending | Pending | Pending |
| workflows-02 | Detail and trigger/action graph | Pending | Pending | Pending |
| workflows-03 | Create and edit workflow | Pending | Pending | Pending |
| workflows-04 | Reviewed activation and permission scope | Pending | Pending | Pending |
| workflows-05 | Run, cancel and duplicate prevention | Pending | Pending | Pending |
| workflows-06 | Run history, failed steps and retry | Pending | Pending | Pending |
| workflows-07 | Reminder list refresh and completion | Prior preview pass; latest retest pending | Pending | Pending |
| workflows-08 | Schedule timing and restart recovery | Pending | Pending | Pending |
| workflows-09 | Agent workflow creation and selected-run context | Pending | Pending | Pending |

## Settings

| ID | View / flow | Preview evidence | Seeker | Your approval |
| --- | --- | --- | --- | --- |
| settings-01 | Top-level row alignment and text wrapping | Pending | Pending | Pending |
| settings-02 | Character and assistant preferences | Pending | Pending | Pending |
| settings-03 | Accounts and Google consent | Google consent UI implemented. | Read/send + Calendar read/edit approved in nubsontopgang Mac Chrome and confirmed in native UI; optional modify unrequested. | Pending |
| settings-04 | Connections and exact access labels | Pending | Pending | Pending |
| settings-05 | Gmail image-loading preference | Pending | Pending | Pending |
| settings-06 | Calendar sync settings and status | Pending | Pending | Pending |
| settings-07 | Privacy, permissions and activity | Pending | Pending | Pending |
| settings-08 | Password provider and autofill | Pending | Pending | Pending |
| settings-09 | Display, theme and text size | Pending | Pending | Pending |
| settings-10 | Sound, vibration and Do Not Disturb | Pending | Pending | Pending |
| settings-11 | Notifications and channels | Pending | Pending | Pending |
| settings-12 | Wi-Fi, Bluetooth and mobile settings handoff | Pending | Pending | Pending |
| settings-13 | Battery and unavailable capability presentation | Pending | Pending | Pending |
| settings-14 | Models and local speech readiness | Pending | Pending | Pending |
| settings-15 | Subscription/plan and service status | Pending | Pending | Pending |
| settings-16 | Problems, diagnostics and licenses | Pending | Pending | Pending |
| settings-17 | About and actual installed version | Pending | Pending | Pending |
| settings-18 | Reset Alpha data scoped to disposable native qualification | Pending | Pending | Pending |
| settings-google-account-controls | Google account card (no calendar picker: Calendar is one merged view), theme and Back | Pending visible QA | Readable one-column card and named radio controls verified at574; Back returns to Accounts. Dark visual check pending. | Pending |

## Platform and release

| ID | View / flow | Preview evidence | Seeker | Your approval |
| --- | --- | --- | --- | --- |
| platform-and-release-01 | Standalone Android capability boundaries | Pending | Pending | Pending |
| platform-and-release-02 | Seeker signed update preserving app data | Pending | Pending | Pending |
| platform-and-release-03 | Native Calendar consent/sync/write/Undo acceptance | Pending | Pending | Pending |
| platform-and-release-04 | Native Gmail prompt read/send and delivery | Pending | Pending | Pending |
| platform-and-release-05 | Native Camera/Photos and permitted media | Pending | Pending | Pending |
| platform-and-release-06 | Native Maps/location and navigation | Pending | Pending | Pending |
| platform-and-release-07 | Native voice and lifecycle | Pending | Pending | Pending |
| platform-and-release-08 | AOSP-only Phone views | Outside current standalone QA | Not applicable | Scope recorded |
| platform-and-release-09 | AOSP-only Messages views | Outside current standalone QA | Not applicable | Scope recorded |
| platform-and-release-10 | AOSP-only Contacts views | Outside current standalone QA | Not applicable | Scope recorded |
| platform-and-release-11 | Wallet excluded from MVP | Outside current standalone QA | Not applicable | Scope recorded |
| platform-and-release-12 | Latest source/runtime/build/installed provenance | Current main c23 integrated; source574 pushed; full verification passed. | Signed installed574 APK hash matches; same appId and original install time; no reset. | Pending |
| platform-and-release-13 | Host verification and production bundle audit | Full product verify:1450passed,2existing skips; production build and404-file audit passed at58c03084 | Pending | Pending |
| platform-and-release-14 | Hosted CI at published head | Pending | Pending | Pending |
| platform-and-release-15 | Commits, upstream pins and PR reconciliation | Pending | Pending | Pending |
| platform-and-release-16 | Human per-view approval and final acceptance | Pending | Pending | Pending |
| platform-native-google-broker | Native managed Google broker and account binding | Common browser/native host implemented; source and packaging verified. | Full resident/Google/voice payload packaged and resident connected; actual native Google-agent prompts pending active plan. | Pending |
| platform-google-oauth-callback | Native Google OAuth completion page and independent grant readback | Pending visible QA | Chrome auth/success says connection unverified; native connection/grant readback succeeds. | Pending |

## Current integration gaps

Latest native component proof: `bd0e622a` built both fixture APKs and passed all **11 real Seeker methods (0 failures, 0 skips)** in a separate app UID. Coverage includes preservation/collision/refusal/concurrency checks and hardware trim/rotate/crop/audio/timestamps/recovery/idempotency/cancellation. All14 old fixture entries and retained failure files, main2446/processes, source639 and pending640/failed record stayed unchanged. The original640 byte archive, packaged current main and full Alpha UI SaveCopy remain open. See [current component evidence](evidence/native-video-preservation-bd0e-seeker-20261017.json).

Hosted parent `a2786dd2` repository verification passed1495 tests with0 failures/2 skips and the404-file production audit; Android foundation and production-surface checks passed. The free/busy reader case passed there. These receipts do not retroactively turn the older remote-image three skipped cases into passes. Remaining browser shards and human per-view approval are separate.

Latest physical fixture result: source `bff09b90` passed both Java compiles and built both fixture APKs. The same-certificate fixture upgrade preserved its UID, original install date and all13 prior journal entries. The first preservation method failed at `complete/ErrnoException`; the remaining nine methods were not run. The new synthetic artifacts are retained; main Alpha2446, all three process identities, source639 and pending640/failed record stayed unchanged. A supported completion-publication protocol needs review before another qualified attempt. This is not full-app SaveCopy or native Gmail/Calendar acceptance. See [exact fixture failure](evidence/native-video-bff09-seeker-seal-failure-20261017.json).

- Browser ordinary Gmail self-send, independent Inbox delivery, exact full-body readback and agent search/read passed for a new QA fixture. Native acceptance is separate.
- Browser ordinary Google Calendar create/read/delete passed for a distinct QA event, with independent provider absence readback. Original uncertain operations remain fenced and were not replayed.
- Seeker now runs source2446/Shared6ef with its original identity/data, Cloud inference and Google read/send plus Calendar read/edit connected. Its one known-QA email read prompt failed at the Cloud text request with HTTP400. That exact request is handed off for correlation; no native send or Calendar write was attempted.
- Native Calendar consent/write/Undo has prior build evidence; current installed sync and prompt lifecycle acceptance remain open.
- Photo access controls are in Settings > Photos. Denied Photos still requires explicit Android permission choice; selected/full access does not show ongoing access controls in the grid. Four focused browser permission flows passed. On current Seeker2446, Settings visibly contains both access controls and the existing full grant, while Photos grid omits access controls; no grant was changed. Physical denied/selected/revoked transitions and human approval remain separate.
- Agent threaded reply/forward and optional Gmail mailbox-change consent remain open.
- Full packaged Camera/Photos editor UI, revocation, process-death recovery and remaining per-view native flows remain open; component exporter tests passed separately.
- Full app audio, held-out ASR quality and human acceptance remain separate from passed component/packaging tests.
- Hosted CI atab523907: repository, Android and production browser checks pass; three MVP browser shards remain running. Preview5209 returns HTTP200.

The dated entries below retain earlier build results and blockers; the current state above supersedes their blocker wording.

Current verification:1,455 tests passed, two existing skips; types, production build and404-file production audit passed. All four APK variants built/linted/verified. The installed standalone APK matches the locally signed candidate and retains the original app identity. This does not imply provider-write, full native or human acceptance.

Latest qualification: Android foundation and repository verification passed in hosted CI at a569. Production browser assertions are being updated for the current credit-backed contract; full browser acceptance remains open. Native packaging and Shared911 qualification are running separately.

October16 focused follow-up: 45 browser media checks passed (edit-copy recovery, video trim controls, albums/batch, photo-email review and scanning), plus10 Photos focus/contrast checks and4 search reachability checks at200% text. These are browser tests, not Android export or human acceptance. The protected Calendar event is still present with its original ETag after a fresh GET-only read; deletion remains unconfirmed.

Current CI follow-up: repository verification1462 pass/2 skip/0 fail; production browser271 pass. Stored-media Photos fixtures, collapsed-details audit, themed Drafts menu and current context/voice controls are corrected and focused-tested. Development Files/Inbox11 checks, Character wake and Photos share dismissal also pass. These results do not establish native providers or native video export; those gates stay open.

Seeker update: nativea569/shared911 passed all four packaging variants and installed with the original signer, UID and first installation date preserved. Credits are recognized and the resident runs. The first read-only Gmail prompt failed because the runtime attempted an absent local text model; native Cloud text inference wiring and prompt acceptance remain open. See `docs/evidence/seeker-a569-native-update-20261016.json`.

October17 video CI follow-up: callback-shutdown repair e530eb51 passes33 focused checks plus Android Java compilation/lint. Prior physical exporter evidence retains its exact source hashes; it does not prove the changed callbacks. Current-source physical rerun subsequently passed all3 tests in59.198s, including late callback shutdown/recovery; exact installed/source hashes are retained in docs/evidence/native-video-callback-20261017.json. Full packaged Alpha UI, grant revocation and process-death qualification remain open.

October17 native qualification: bb4d/9365 passed normal four-variant assembly, lint and packaged-runtime verification; exact signed APK5b0d1015 installed on Seeker with UID/first-install preserved. The first ordinary Gmail read prompt failed because the actual resident launched with Cloud inference disabled and no Google broker. Supported existing-account admission is pending; native Gmail sending and Google Calendar deletion remain unproven and were not attempted. See docs/evidence/seeker-native-startup-20261017.json.

Latest installed read-only Home/Models check:2446 Home shows the11 core navigation controls, while All apps reports84 apps and displays installed app rows. Models reports on-device connection/voice and Eliza Cloud qwen-3.8-27b (Cerebras) inference. No favorite/shortcut/provider/permission changes or model request. Custom-shortcut baseline, remote/offline transitions and full visual geometry acceptance remain open. See [scoped native evidence](evidence/seeker-home-models-readonly-20261017.json).

Current installed2446 paused-video editor passed trim, rotate, center crop and Android Back on one synthetic QA clip. Original bytes and revision unchanged; no playback or save-copy. See [native editor evidence](evidence/seeker-paused-video-editor-20261017.json). Export/audio output, process-death and human acceptance remain separate.

Current installed Save copy attempt failed once at pending-write/code0; source639 unchanged and pending output640/journal retained. Candidatef3b88d32 fixes separate pending lookup/custody/diagnostics defects and adds regression cases; native qualification is pending. See [exact failed operation](evidence/seeker-video-save-failure-20261017.json). No second Save or publication/deletion.

Pending-video custody correction1d29 now passes both Java compiles, fixture APK assembly/signature/source verification, and exactly3 real-provider Seeker regressions in0.286s. MainAlpha2446/resident, source639, pending640/failed8e43 and11 prior fixture journal records unchanged. This qualifies custody preservation only; originalwritecause and normalAlphaSaveCopy remain open. See [provider evidence](evidence/native-video-pending-custody-20261017.json).

Exact1d29 real synthetic exporter component passed11.291s on Seeker: trim/rotate/crop/audio and timestamp markers, lost-publication-receipt recovery, same-operation duplicate identity, changed-binding refusal and cancel-without-copy. MainAlpha2446/source639/pending640/8e43 and11 prior fixture journal records unchanged. This is component proof; original mainAlpha writecause and normal SaveCopy acceptance remain open. See [exporter evidence](evidence/native-video-exporter-1d29-20261017.json).

Observer coordination correctiond35dd318: renderer/native-bridge regression reproduced2libraryChanged notifications causing3nativecancellations duringpendingSave; fix keepsobserveractive and rechecks source/access while deferringvalidcatalogrefresh.8focusedbrowserchecks andnormalproduct1495pass/2existingskips/types/build/audit404pass. Nativequalification/install pending; mainSave remainsheldbyexact640preservationreview. Historical8e43cause is not proven bythe reproduction. See [observer evidence](evidence/native-video-library-observer-20261017.json).

## Explicit agent capability gaps

| ID | View / flow | Preview evidence | Seeker | Your approval |
| --- | --- | --- | --- | --- |
| shell-agent-app-navigation | Agent switches to every Home app | 11 route-delivery and 2 registry tests pass; merged live prompt sweep pending | Pending | Pending |
| camera-agent-capture | Agent takes and saves one requested photo | Foreground Camera source + journal/receipt fixtures pass; live capture and Home continuation remain open | Pending | Pending |

The separate 5219 voice trial reached server ready but produced no transcript or audio. Client state and microphone-resume fixes have local regression proof; they have not passed another live audio trial.
