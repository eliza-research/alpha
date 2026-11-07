# Dynamic list focus identity

The Settings failure was reproduced by holding the browser permission query, focusing About, then releasing the query. The same focused DOM button became Finish setup when the Privacy group appeared. Enter opened Notifications. The renderer keyed every `sc-for` item by its array position.

The fix adds an optional semantic key to `sc-for`. Missing keys retain positional reconciliation. Settings supplies stable identities for its top-level groups and rows, including a deployment-independent Cloud account row identity. Its existing subpages keep their previous fallback behavior where no identity is supplied.

The Chromium regression executes the real renderer and Settings adapter. A source-derived trace checks the focused About identity before and after the late insertion, then checks the activated About page against `ShellNavigation`. The model covers the two representative identities `about` and `setup`, insertion, reordering, removal, and activation. The browser trace covers insertion and activation. The renderer unit test covers keyed insertion, reordering and removal, plus unkeyed and missing-key compatibility.

## Remaining mutable-list review

A structural scan of the shared template found 144 `sc-for` loops enclosing interactive controls, including nested enclosing loops. Two now declare a semantic key. This count includes static option lists. It does not establish that every remaining loop can reorder or that every loop has a demonstrated defect.

The following source-backed mutable families still use positional rendering. They need stable source identities and focused-node schedules before they can receive the same guarantee.

| Family | Mutable bindings | Source identity and transition to review |
| --- | --- | --- |
| Inbox | `inbox.rows`, `inbox.d.threadRows`, attachment and recipient suggestions | Message IDs survive mailbox refresh, deletion and sorting. A focused row must keep its message when another message arrives or leaves. |
| Calendar | search, day-column events, agenda, schedule and month rows | Provider event and occurrence IDs survive refresh. Nested day and event loops need identities at both levels. |
| Notes | `notes.colL`, `notes.colR`, trash and pending audio-deletion rows | Note IDs survive save, sort, deletion, undo and restoration. Column rebalancing can move the selected item between parents. |
| Files | Recent, results, folder items and destination rows | `files-tree-adapter` already exposes Recent IDs. Folder and selection identities must survive listing replacement and revocation. |
| Browser | `browser.tabCards`, saved-library and suggestion rows | Tab source state has a stable `tab.id`, but the rendered `tabCards` projection omits it. Closing an earlier tab can retarget the focused tab control. |
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
