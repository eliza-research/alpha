# #660 Confirm or override the default product choices (H-37)

Owner prep for [#660](https://github.com/eliza-research/alphaphone/issues/660): the membership sheet
wording and credit display, and Notes storage. Both were taken by default on 2026-10-28
([human actions](../human-actions.md) H-37). This page is a decision brief. It changes no product
code, test or decision record. The P- entries below are drafts: an agent copies the chosen one into
`docs/decisions.md` with the next free number (the highest recorded today is P-56) after the owner
answers on the issue.

Evidence class: source reading at `main` 94676c82 (pin `1f2a922f86`). Nothing here was run in a
browser, an APK, an emulator, an image or on a device.

## Current state (read-only findings)

- **Guard.** `residentCloudFlow()` (`apps/app/src/runtime/connection-ui.tsx` line 228) is true on
  production Android, in browser Cloud-resident development and in resident QA. Two render branches
  show the **"Membership & credits"** sheet (`data-alpha-membership-sheet`):
  - Line 3003 (plan entry): when `purpose==='plan'` off the resident flow, **or whenever the
    signed-in account's membership balance is `zero` (funding required), on either flow**.
  - Line 3004 (cloud-account entry): `if(snapshot.purpose==='cloud-account')` has **no
    `residentCloudFlow()` guard**. For **any signed-in account, at any balance and on either flow**,
    it renders the dialog with h1 "Membership & credits" (line 3005). Signed out, it is the sign-in
    screen. `connectionController.openCloudAccount()` (line 2034) sets this purpose. It is reached
    from Settings > Accounts > "Manage Cloud account" (`apps/app/src/prototype/settings-adapter.ts`
    line 663), Inbox "Connect Eliza Cloud" (`inbox-cloud-adapter.ts` lines 300 and 709), the voice
    adapter (`voice-adapter.ts` lines 300 and 644) and `apps/app/src/runtime/cloud-voice.ts` line 96.
    Specs that expect it: `test/browser/browser-cloud-dev.spec.ts` lines 56-58 and 90-91, and
    `test/browser/cloud-account-panel.spec.ts` (`membershipSheet`, lines 9 and 57).

  Otherwise (the plan entry on the resident flow with a nonzero or unavailable balance) the
  resident flow renders the dialog titled "Your agent", "Eliza Cloud account" (credits plan view)
  or "Eliza Cloud account & plan", with the same `CloudMembershipControls` inside it
  (`planShownByHost`). So a resident user with a funded balance sees the sheet from Settings >
  Manage Cloud account and the plan panel from the plan entry.
- **Where the sheet's content lives.** `apps/app/src/runtime/cloud-membership-ui.tsx`
  (`CloudMembershipControls`): exact credit value (`creditLabel`), **Add funds** (opens Cloud
  billing after the billing-account review), Redeem code, the plan allowance and the last service
  limit with its retry time.
- **Policy tension to note.** P-26 says "subscription billing ... rather than a user-facing credit
  top-up/per-token meter". The default shows an exact credit balance and Add funds. The
  "October 16: existing Cloud credit billing" entry in `docs/decisions.md` admits organization
  credits as a legacy billing mode while the signed entitlement route is absent; it says "shows
  Cloud credits rather than an active plan". It does not say whether Add funds may be offered.
  Confirming the default should record which entry permits Add funds. If no entry permits it, the
  default needs a P-26 exception.
- **H-37 status.** `npm run human:status` (read-only, `scripts/human-actions.mjs`) prints
  `H-37 external  Confirm or override the default product choices`. H-37 has no repository check, so
  the status can never read **done**, and the issue's "human:status shows H-37 done" cannot happen
  as written. A check is drafted below.
- **Notes storage.** `docs/architecture.md` (Notes section): agent notes and the device-local
  **Older notes** collection both render through Alpha's own Notes view; agent notes are saved
  through the shared canonical Notes client. `runtime/notes-trash.ts`, `runtime/browser-note-documents.ts` and
  `runtime/deleted-note-origin.ts` stay Alpha's until `plugin-notes` has a storage and
  document-picker port. Note-origin links point only at Older notes voice recordings.

## Decisions for the owner

### 1. Membership sheet title and credit display

| | Option A (default): "Membership & credits" | Option B: "Eliza Cloud account & plan" (P-26 / #410) |
| --- | --- | --- |
| Source | NubsCarson collector `7a44d7038` | P-26, #410 signed entitlements |
| Title | "Membership & credits" | `${serviceName} account & plan` ("Eliza Cloud account & plan") |
| Credit value | exact organization credit balance | not shown; plan state from signed entitlements only |
| Add funds | shown (opens Cloud billing after review) | removed; "Manage plan in Eliza Cloud" only |
| Plan allowance, limit retry | shown | shown |
| Policy check | needs the Oct 16 credit-billing entry or a P-26 exception to cover Add funds | matches P-26 as written |

**Recommendation:** the documented default is A. Either choice is consistent with the resident
guard. **Do not loosen** the guard in either case (#659).

**What A changes (confirm):**
- Code: none. Optional: name the Oct 16 entry in the `cloud-membership-ui.tsx` header comment.
- Tests: reconcile `test/browser/native-cloud-subscription.spec.ts` with the guard. Every case
  boots the resident flow (see the #659 reviewer table,
  `node scripts/owner/subscription-spec-map.mjs`). Cases that wait for the resident panel keep
  `accountPanel`; a case that reaches a zero balance must expect the sheet, and a case that opens
  the account through the cloud-account entry (Settings > Manage Cloud account, Inbox Connect,
  voice) must expect the sheet at any signed-in balance.
- Decision record: draft entry A below.

**What B changes (override):**
- `apps/app/src/runtime/connection-ui.tsx`: the sheet `<h1>` at lines 3003 and 3005
  ("Membership &amp; credits") becomes `${serviceName} account & plan`. Line 3005 is the
  cloud-account branch (Settings > Manage Cloud account, Inbox Connect, voice), which shows this
  title for any signed-in account, so B renames that entry too. The close label "Close membership
  settings" changes to match.
- `apps/app/src/runtime/cloud-membership-ui.tsx`: remove `creditLabel` display and the Add funds
  button (`onAddFunds`). The balance support line no longer says "Add funds or use a membership
  code"; it keeps Redeem code and the plan allowance.
- `apps/app/src/runtime/subscription-entitlement.ts` line 50 comment ("shown in the approved
  Membership & credits sheet").
- Tests that assert the wording or Add funds: `test/agent-always-local.test.mjs`,
  `test/connection-presentation-state.test.mjs`, `test/subscription-entitlement.test.mjs`,
  `test/browser/browser-cloud-dev.spec.ts`, `test/browser/cloud-account-panel.spec.ts`,
  `test/browser/native-cloud-subscription.spec.ts`, `test/browser/production-surface.spec.ts`,
  `test/browser/resident-failures.production.spec.ts`.
- Docs: `docs/eliza-cloud-subscription-entitlement-contract.md`.
- The `fundingRequired` branch (zero balance) has no "Add funds" action under B. Decide what a
  zero-balance account sees: the plan panel with Redeem code and Manage plan is the natural fit.

### 2. Notes storage

| | Option A (default): canonical Eliza records, rewrite the older specs | Option B: canonical records, retire the older specs | Option C: keep device-local Notes as the product store |
| --- | --- | --- | --- |
| Store | canonical Eliza records (#621) | canonical Eliza records | Alpha's device-local Older notes |
| Older notes collection | stays until migrated; specs rewritten for canonical records | removed after a reviewed migration or a confirmed reset | stays authoritative |
| Reopens P-? | no | no | yes: undoes #621's direction (AP-10) |

**Recommendation:** the documented default is A.

**What A changes (confirm):** rewrite these specifications for canonical records, keeping their
guarantees (Trash, recovery, capacity, voice recording deletion, documents). Candidates found by
grep for device-local Notes markers (`Older notes`, `notes-trash:v1`, `AlphaNoteDocuments`,
`browser-note-documents`, device-local):
- Browser specs: `test/browser/notes-document-storage.spec.ts`, `test/browser/notes-trash.spec.ts`,
  `test/browser/notes-trash-recovery.spec.ts`, `test/browser/note-calendar-handoff.spec.ts`,
  `test/browser/notes-permanent-delete-backstop.spec.ts`, `test/browser/notes-named-review.spec.ts`,
  `test/browser/journey-j05-web-research-note.spec.ts`.
- Node and flow checks: `test/notes-view-defaults.test.mjs`,
  `scripts/test-notes-documents-browser.mjs`, `scripts/test-notes-store-flow.ts` and
  `scripts/test-notes-trash-flow.ts` (both drive the device-local `apps/app/src/runtime/notes-store.ts`
  `NotesStore`, including its legacy-key migration).
- Android instrumentation (emulator evidence class):
  `NotesStorageDurabilityInstrumentedTest`, `NotesSecureStorageInstrumentedTest`,
  `NotesTrashBackstopInstrumentedTest`, `NotesDocumentInstrumentedTest`, `NotesCapacityFixture`,
  `NotesSecureFixture`, `NoteOriginInstrumentedTest` (`android/app/src/androidTest/java/ai/elizaresearch/alphaphone/`).
- Docs: `docs/browser-storage.md` ("Notes and audio deletion", "Notes Trash"),
  `docs/notes-document-flows.md`, the Notes section of `docs/architecture.md`, the AP-10 "Notes,
  Calendar and Reminders" row in `docs/requirements.json`.
- Code follow-up already named in architecture.md: a `plugin-notes` storage and document-picker port
  upstream, so the three Alpha Notes files can move. Then canonical note-origin links.

**What B changes:** the same files are deleted, not rewritten, after a reviewed one-time migration
of Older notes into canonical records (or a confirmed reset). Coverage for Trash, capacity and
recording deletion must exist on the canonical path before deletion.

**What C changes:** reverts the #621 integration for Notes. The Notes view reads only the
device-local store and the agent's Notes actions are bridged to it. This needs a new P- entry that
supersedes the AP-10 direction. Not recommended.

## Draft decision entries

Copy one entry per item into `docs/decisions.md` with the next free number and the owner's date.

- **P-__ (A, membership)** — H-37/#660 (owner, 2026-__-__): the Settings membership sheet is titled
  "Membership & credits" (collector `7a44d7038`). It shows the exact organization credit balance
  and Add funds, which opens Eliza Cloud billing after the billing-account review, plus the plan
  allowance and the last limit with its retry time. This is the organization-credit mode of the
  October 16 entry. P-26 still holds for subscription plans: no per-turn billing round trip, and
  Alpha shows no price. Settings > Accounts > "Manage Cloud account" and the other cloud-account
  entries (Inbox Connect, voice) open this sheet for any signed-in account at any balance, on the
  resident agent too. On the resident agent the plan entry (plan notice, Settings plan panel) opens
  the "Eliza Cloud account & plan" panel with the same controls, and the sheet replaces it there
  only for a zero balance.
- **P-__ (B, membership)** — H-37/#660 (owner, 2026-__-__): the Settings plan surface is titled
  "Eliza Cloud account & plan" on every flow (P-26/#410). Plan state comes from signed
  entitlements. Alpha shows no credit amount and no Add funds; Manage plan opens Eliza Cloud.
- **P-__ (A, Notes)** — H-37/#660 (owner, 2026-__-__): Notes are canonical Eliza records (#621).
  The older Notes-storage specifications are rewritten for canonical records, keeping their Trash,
  recovery, capacity, document and recording-deletion guarantees. They are not retired.
- **P-__ (B, Notes)** — H-37/#660 (owner, 2026-__-__): Notes are canonical Eliza records. The
  device-local Older notes collection and its specifications are retired after a reviewed
  migration into canonical records.

## Draft H-37 status check (for `scripts/human-actions.mjs`)

Today H-37 always prints `external`. A repository check, added to the `checks` map, would print
`done` once both entries exist:

```js
"H-37": root => {
  const decisions = fs.readFileSync(path.join(root, "docs/decisions.md"), "utf8");
  const entry = pattern => decisions.split("\n").some(line => /\*\*P-\d+\*\*|\*\*P-\d+ —/.test(line) && /H-37|#660/.test(line) && pattern.test(line));
  const membership = entry(/membership|account & plan/i), notes = entry(/Notes/);
  return membership && notes ? { state: "done", detail: "decisions.md records the membership and Notes entries (H-37)" }
    : { state: "open", detail: `missing: ${[!membership && "membership sheet", !notes && "Notes storage"].filter(Boolean).join(", ")}` };
},
```

This check is a draft. It was not added here, because other work may be editing
`scripts/human-actions.mjs`.

## Remaining human steps

1. Reply on #660 with "confirm" or the override for item 1 (membership) and item 2 (Notes).
2. If item 1 is confirmed, also say which entry permits Add funds: the October 16 credit-billing
   entry, or a P-26 exception.
3. An agent then records the dated P- entries, makes the code and test changes listed for the
   chosen options, and adds the H-37 status check.
