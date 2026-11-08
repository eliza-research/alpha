# Dynamic list focus identity

The Settings failure was reproduced by holding the browser permission query, focusing About, then releasing the query. The same focused DOM button became Finish setup when the Privacy group appeared. Enter opened Notifications. The renderer keyed every `sc-for` item by its array position.

The fix adds an optional semantic key to `sc-for`. Missing keys retain positional reconciliation. Settings supplies stable identities for its top-level groups and rows, including a deployment-independent Cloud account row identity. Its existing subpages keep their previous fallback behavior where no identity is supplied.

The Chromium regression executes the real renderer and Settings adapter. A source-derived trace checks the focused About identity before and after the late insertion, then checks the activated About page against `ShellNavigation`. The model covers the two representative identities `about` and `setup`, insertion, reordering, removal, and activation. The browser trace covers insertion and activation. The renderer unit test covers keyed insertion, reordering and removal, plus unkeyed and missing-key compatibility.

## Remaining mutable-list review

A structural scan of the shared template found 144 `sc-for` loops enclosing interactive controls, including nested enclosing loops. The initial Settings fix added semantic keys to two of those loops. This count includes static option lists. It does not establish that every remaining loop can reorder or that every loop has a demonstrated defect.

The following source-backed mutable families still use positional rendering. They need stable source identities and focused-node schedules before they can receive the same guarantee.

| Family | Mutable bindings | Source identity and transition to review |
| --- | --- | --- |
| Inbox | `inbox.rows`, `inbox.d.threadRows`, attachment and recipient suggestions | Message IDs survive mailbox refresh, deletion and sorting. A focused row must keep its message when another message arrives or leaves. |
| Calendar | search, day-column events, agenda, schedule and month rows | Provider event and occurrence IDs survive refresh. Nested day and event loops need identities at both levels. |
| Notes | `notes.colL`, `notes.colR`, trash and pending audio-deletion rows | Note IDs survive save, sort, deletion, undo and restoration. Column rebalancing can move the selected item between parents. |
| Files | Recent, results, folder items and destination rows | File, Recent, location, menu and destination rows now carry stable identities. Legacy duplicate metadata and broader listing replacement/revocation schedules remain follow-up coverage. |
| Browser | `browser.tabCards`, saved-library and suggestion rows | Tab cards now retain source `tab.id`, and saved-library rows retain their canonical URL identity. Search and suggestion rows remain in the broader review. |
| Photos | groups, group items, albums and album items | Library asset and album identities must survive provider refresh, deletion and changed permissions. Nested group keys alone do not preserve items moved between groups. |
| Maps | saved rows, search results and pins | Provider place identity must survive asynchronous result replacement and sorting. |
| Workflows | cards, management cards, approvals and builder steps | Workflow, run, approval and step identities must survive asynchronous refresh, insertion and deletion. |
| AOSP communication | native message threads, Contacts groups and rows, Phone recents | Provider record identity must survive refresh. These need separate AOSP admission and device evidence. |
| Launcher | favorites and application rows | Package/activity identity must survive installation, removal and sorting. |
| Conversation | messages and nested review/action rows | Message, proposal and review identity must survive streaming, history replacement and owner changes. |

Camera zoom and mode options, fixed day/repeat choices, and other immutable option lists do not require a new identity solely because they use `sc-for`. The review above leaves the mutable families open. No application-wide focus guarantee is claimed.

The renderer and all listed bindings are in the shared template. The most immediate follow-up is Browser tab cards because the source already retains the required tab identity. [Renderer](../../../../apps/app/src/prototype/dc-lite.js), [template](../../../../apps/app/src/prototype/template.html), [Browser adapter](../../../../apps/app/src/prototype/browser-adapter.ts), [Files adapter](../../../../apps/app/src/prototype/files-tree-adapter.ts)

## Validation on 2026-11-07

- Eighteen focused Node tests passed, including the three renderer identity and fallback tests, Settings wording/navigation tests, and accessibility source checks.
- Three Chromium cases passed in the isolated worktree. The delayed-permission regression includes one source-to-Quint trace with five observation checkpoints. Its receipt records unchanged input hashes and a bound driver snapshot.
- All six `ShellNavigation` scenarios passed. Seed `20261107` completed 1,000 simulations of 80 steps without a safety violation.
- Apalache 0.62.4 completed bounded symbolic safety checking through depth 4 without a violation. This is a bounded result, not an unbounded refinement proof.
- No Android build or device accessibility acceptance was run for this focused change.

## Browser tab and library follow-up

Tab cards now carry their source tab ID through both live and fixture projections. Saved-library rows use their canonical URL, and the recovery row has a separate fixed identity. The template keys both collections explicitly.

The tab regression creates three real renderer tabs, focuses the middle one, runs the preceding tab's actual close handler without moving focus, and activates the retained control. Its source trace checks the focused identity and resulting active tab against `BrowserSession`. A separate browser test removes an earlier bookmark and verifies that the retained focused link still opens its original URL.

The model represents three normal tabs and one private tab. It also models closing a selected or preceding tab and clearing focus when its row is removed. Remaining search and suggestion collections are outside these two tests.

Browser validation passed both focused Chromium cases and seven existing navigation cases. The source-helper receipt contains two traces and eight checkpoints, including retained order and saved active-tab selection. The rendered tab-focus receipt contains one trace and nine checkpoints. Seven model scenarios, 1,000 seeded 80-step simulations, and bounded symbolic safety checking through depth 4 passed. Blank/invalid URL filtering remains outside the persistence-eligible snapshot abstraction.

## Files follow-up

Eight Files template loops now use source identities for locations, Recent/search rows, folder entries, menu choices and move destinations. The Recent insertion test imports real browser files, records their actual selection handles, prepends another record, and opens the originally focused selection. The folder test executes the real sort callback and then opens the retained entry.

Both source-to-Quint traces passed five checkpoints each, with unchanged source and driver hashes. The added `FilesTree` fields model presentation identity only. Rendering or activating a row grants no native tree capability. Native provider validation and mutation outcomes retain their existing independent guards.

Validation passed both focused Chromium tests, three existing browser file tests, eleven index/picker unit tests, all eight model scenarios, 1,000 seeded 80-step simulations, and bounded symbolic safety checking through depth 4.

## Legacy duplicate records

Bookmark and Recent readers accept repeated stored identities. The renderer now deduplicates bookmark URLs and displays the newest Recent record for each key. Stored values remain available to their existing readers. Two legacy-data browser tests verify both unique rendered rows and retained stored values. The six Browser/Files/legacy focus cases passed together after this adjustment.
