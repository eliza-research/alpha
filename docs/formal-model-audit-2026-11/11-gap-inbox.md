# 11. Gap pass: Inbox

Single-pass findings from a second auditor covering files the first pass read only in part. Not adversarially verified; each is re-verified before a fix.

## A. Model-vs-code discrepancies (specs/quint/services/InboxDelivery.qnt)

1. **`UnknownCannotRearm` / `AtMostOneDispatch` do not hold in code.** The model keeps a `prepared` reply in `dispatching` (qnt:49) and has no path from `observed` back to `review`. The code has one: `observe()` at inbox-operation.ts:182 maps a `prepared` receipt to `'review'` whenever `record.phase !== 'dispatching'`, which includes `observed`. `refresh()` (184-186) is callable in any phase.
2. **The model covers one operation ever.** `prepare` requires `dispatches == 0` (qnt:29) and nothing returns `observed` to `empty`. The code's `clear()` (190-194) deletes a succeeded/rejected record, and `followup()` chains clear then prepare (inbox-provider-controls.ts:79). Only `send` is modelled; archive, trash, draft-create/replace/delete and undo are not.
3. **`confirm` grant guard.** The model requires `s.modify, s.read` (qnt:40). The code's `confirm()` (171-178) and `canConfirm` (controls:94) check no capability; `gmailInboxAllows` runs only in `prepare` (controls:63).
4. **Withdrawal is not atomic.** The model's `withdrawModify`/`withdrawRead` empty the review at once (qnt:69-74). The code detects withdrawal only in `refreshAccounts` by comparing against the in-memory previous account (inbox-cloud-adapter.ts:375-379). After a restart `before.account` is undefined, so `withdrawn = []` (gmail-grants.ts:78-79) and the persisted review survives.
5. **`switchOwner` vs code.** The model flips owner and grant together and empties the review (qnt:77-83). In code the record is keyed by (owner, grant) (inbox-operation.ts:99); `selectAccount` only rebinds, so the review survives and reloads on return (controls:43-44).
6. **Review binding.** The model compares revision and attachment counters (qnt:42). The code compares draft id plus content with four outcomes, `bound/edited/other/absent` (inbox-operation.ts:29-33), and skips the check entirely for non-composer kinds (173).
7. **`CacheBound`.** In the model `cacheVisible` needs a live `read` and only `cacheRead` sets it (qnt:17-19, 92). The code makes the cache visible from disk in `restoreMailbox` with no grant read (see claim 6). `restart` (qnt:54) does not touch the cache.
8. **`draftExists` is one boolean.** The code has four copies (open composer, retained, saved slot, shelf) plus the `earlierThanSent` label (inbox-drafts.ts:92-126). `SuccessfulCleanup` says nothing about which copies may be removed.

## B. Unmodeled state machines

1. **Local draft copies** (inbox-drafts.ts). States per draft id: open, retained, saved, shelved, earlier-than-sent, pending-edits. Events: begin, edit, save, discard, setAside, openShelved, editProvider, transfer, settleSent, bind/reset. Invariants at risk: no copy is destroyed without an explicit discard or a confirmed send of identical content; at most one copy per id is editable; every open draft is retainable.
2. **Retained-edit controller** (inbox-unsaved.ts, assistant-draft-controller.ts:54-63). States: opening, ready, failed/conflict, consuming, invalid. Invariant at risk: stored text equals the last edit, or the UI says it does not.
3. **Withdrawal deferral** (controls:17, 35, 55, 73-77). States: none, pending-while-busy, applying. Events: withdrawn, run settle, reset, bind. Invariant: an unsent review under a withdrawn grant is never confirmable.
4. **Shared read cache** (service-read-cache.ts). One document per owner, with Calendar and Inbox as writers. Events: put, clear, epoch bump, eviction. Invariant at risk: one service's invalidation does not erase another's entries.
5. **Mailbox list/reader** (inbox-cloud-adapter.ts). States: `phase` idle/scheduled/busy/ready/error crossed with `generation`, `cachedListShown`, `failure`. Invariant: content shown belongs to the current `readKey()`.
6. **Read-state marks** (adapter:514-539; gmail-mailbox.ts:117-132). Sets `readStateInFlight` and `readStateUnconfirmed`. Invariant: an automatic mark-read is sent at most once per message per session.

## C. Defects

**Earlier claims**

1. **Send re-armed after dispatch: PARTLY confirmed.** While the phase is `dispatching`, a `prepared` reply stays `dispatching` (182), so the literal 182 then 172-176 path is refuted. Once the phase is `observed` it is real: dispatch returns `dispatched` or `outcome-unknown`, the phase becomes `observed`, the user taps Check (controls:94 `check`), the server answers `prepared`, and line 182 yields `'review'` with a `prepared` receipt. `confirm()` line 172 then passes and dispatches a second time with the same request id. The same holds from `observed/succeeded`. It needs a regressed server answer. Confidence medium. Fix: at 182 keep `record.phase` when it is `dispatching` or `observed`.
2. **Every keystroke re-serialises the draft with attachments: CONFIRMED** (high). `edit()` (inbox-drafts.ts:201) calls `persist()` (78), which runs `structuredClone(draft)`, then `encodeInboxUnsaved` (inbox-unsaved-record.ts:16: `JSON.stringify` plus a full `readInboxUnsaved` encode and parse). `controller.edit` then queues one store save per keystroke with no debounce or coalescing (assistant-draft-controller.ts:54-63). Each save re-validates and re-stringifies (inbox-unsaved.ts:22) and sends expected plus value across the secure-store CAS. With a 5 MiB attachment that is about 7 MB of work several times per character, with an unbounded queue. Fix: debounce and keep only the latest queued text.
3. **Shelved earlier-version draft never retained: CONFIRMED** (high). Line 111 writes `earlierThanSent:true` into shelf rows. `openShelved` (72) clones the row without stripping it, unlike `fromSaved` (132). `persist()` strips only `forward`. `readInboxUnsaved`'s key allow-list (inbox-unsaved-record.ts:8) rejects `earlierThanSent`, so `edit()` catches and sets `invalid` (inbox-unsaved.ts:33). Result: no recovery copy for any edit, and the status wrongly says the edits are "too large to retain". Saving also carries the flag into `saved` (`valid()` allows it, line 32), so new content is labelled an earlier version. Fix: strip the flag in `openShelved`.
4. **`editProvider` overwrites an unrelated saved draft: CONFIRMED** (high). With no open draft and no retained copy, `editProvider` (261) checks nothing about `saved`. It builds a new draft and calls `update()`, whose CAS at 193-194 replaces the saved slot. `begin()` refuses in the same situation (154). Scenario: a saved local draft exists, the user opens a Gmail draft from Drafts (adapter:455), and the local draft is gone. Fix: return false, or `setAside()`, when `saved` exists and is not the open draft.
5. **Calendar `cache.clear()` wipes Inbox's offline cache: CONFIRMED** (high). Both adapters open the same owner tuple (calendar:134; adapter:207-208), giving one slot and one cached instance (service-read-cache-store.ts:9-13). `clear()` writes `null` over the whole document and bumps the shared epoch (service-read-cache.ts:35). Calendar calls it with no calendar-read account (148), on a lost calendar grant (174) and on accounts-changed (293). Scenario: a Gmail-only user opens Calendar; `gmail:mailbox` and the Home preview are erased and in-flight Inbox puts are dropped. The reverse also holds: Inbox `purgeOffline` (adapter:236, 340, 349) erases Calendar's entries. Fix: delete by key prefix instead of `clear()`.
6. **Offline cache shown before any grant check: CONFIRMED** (high on the code path). `restoreMailbox` (adapter:237-250) checks only the local owner identity and `gmailReadable` on the cached account rows (244). It then sets `accountsChecked=true`, publishes lists and bodies up to 30 days old, and binds provider and drafts (248). `openMailbox` (251) calls `refreshAccounts` afterwards, and not at all when the cached list is under 60 s old. Line 246 also re-keys cached lists to the new session, against the "new session starts from nothing" contract in gmail-grants.ts:62-64. Fix: always run `refreshAccounts`, and mark the list as saved until it returns.

**Additional**

7. **Permanent per-account lockout** (medium; depends on the server expiring prepared receipts). `confirm` saves `dispatching` (175), then the dispatch throws offline before reaching Cloud. Every refresh answers `prepared`, so the phase stays `dispatching` (182). `clear()` refuses (192) and `prepare()` refuses while a record exists (136). Send, archive, trash and drafts are blocked for that account. Fix: an explicit, confirmed abandon for `dispatching` with a `prepared` receipt, or a server cancel.
8. **Confirm ignores withdrawn grants after restart** (medium; see A3, A4). The server is the only guard. Fix: require `gmailInboxAllows(caps, kind)` in `canConfirm` and `confirm`.
9. **Render-path deep copies** (medium, performance). `provider.render()` runs on every publish. It calls `snapshot()` (a `JSON.parse(JSON.stringify(record))`, inbox-operation.ts:95) at least three times (controls:26, 86, 87), plus `composerContent` twice including attachments (inbox-operation.ts:23, 32). A sent receipt with attachments stays until closed. Fix: memoise the snapshot per record.
10. **Body cache accounting** (medium, performance). `rememberBody` re-encodes all cached bodies on each insert (adapter:196) and calls `persistMailbox` each time; `loadThread` does this per message (581). `ServiceReadCache.put` re-encodes the whole document per eviction step (service-read-cache.ts:30), silently drops anything over 4 MiB (22), and evicts Calendar entries to fit mail (28-30).
11. **Misleading messages** (low). Non-canonical base64 reports "Attachment exceeds 5 MiB" (inbox-operation.ts:72). An invalid Cc address reports "Draft is too large or contains an invalid subject" (inbox-drafts.ts:192, 286).

## D. Modeling opportunities

**Quint**

- Extend InboxDelivery with `refresh(state)` in every phase, `clear`, multiple sequential operations and non-composer kinds. Add an invariant that after the first dispatch the phase is never `review` or `preparing` for the same request id. Add a liveness property that a blocked record is eventually clearable.
- New `InboxDraftCopies`: the four copies keyed by draft id. Invariants: no silent loss (a copy disappears only by discard or settle with equal content), every open draft is retainable, and `earlierThanSent` appears only on saved or shelf copies.
- New `SharedReadCache`: two services, one document. Invariant: a service's clear removes only its own keys.
- Extend `CacheBound` with `restoreFromDisk`, `restart` and a `grantVerified` flag.
- `GrantWithdrawal`: withdrawal crossed with busy/reset/restart; a review is never confirmable under a withdrawn grant.

**Pure TS functions suited to pre/postcondition checks**

- An extracted `nextPhase(phase, receiptState)` from inbox-operation.ts:182.
- `reviewBinding`, `composerContent`, `checkOutgoingAttachments`, `attachmentBytes` (should equal the `atob` length for canonical input).
- `gmailGrantChange`, `gmailReadCacheKey`, `gmailActionGrant`, `gmailGrantTier` (gmail-grants.ts).
- `classifyGmailFailure` (total over error crossed with context).
- `readInboxUnsaved`/`encodeInboxUnsaved`: the property "every draft accepted by `valid()` minus `forward` encodes" would have caught C3.
- `ServiceReadCache.decode/put` (bounds, owner).
- `linkifyMailText`, `linkTextMismatch`, `decodeMailPreview`.
- `sentContent` and `valid` (inbox-drafts.ts:32, 86), if exported.

No Java was in scope; the `AlphaMailAttachments` native side was not read.
