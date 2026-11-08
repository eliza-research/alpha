# Provider-draft and forward refinement

`InboxProviderDrafts` imports three independently retained `InboxDelivery`
instances. They represent separately reviewed create, replacement and deletion
requests. A completed request keeps its history when the next request starts.
The model preserves the existing `InboxDelivery` and `InboxCoordinator` APIs.

The source runner executes the product `inboxProviderControls`, `inboxDrafts`,
`InboxOperation`, `inboxUnsaved` and `AssistantDraftController` implementations.
It uses controlled Gmail and atomic storage ports. The provider port follows the
pinned upstream Inbox provider contract for metadata snapshots and explicitly
non-atomic replacement. It does not execute Gmail or the upstream provider itself.

## Source mapping

| Source boundary | Model state |
| --- | --- |
| `inboxDrafts.render().c.saveProvider` and `InboxOperation.prepare` | One durable proposal per request, exact local content and selected forward parts |
| `inboxProviderControls.confirm` and `InboxOperation.confirm` | Current capabilities, local CAS, one dispatch and unknown outcomes |
| `inboxProviderControls.editSavedDraft` | Captured account/epoch and fresh provider digest read |
| `inboxDrafts.editProvider`, `update`, `persist` | Current, saved and retained content and provider-reference identities |
| `InboxOperation.clear`, provider follow-up actions | Receipt retirement, its partial failure and the next separately reviewed request |
| `inboxDrafts.bind`, `inboxUnsaved.resume` | Restart, saved reference restoration and retained forward text without original parts |

The observation map reads durable operation records, saved drafts and parsed
retained records. It also reads the actual composer proposal and confirmation
eligibility. The provider port exposes its controlled remote state. Opaque digest,
body and source-history values map to small identity classes. Forward part IDs
remain distinct set elements.

Private UI fields and every member of the imported operation records are not
individually observed. Derived selected-owner observations provide bounded
component evidence for the named source schedules. They do not establish a
universal refinement of every model field.

## Source corrections

The actual `CloudProtocol.gmailDraft` response contains `messageId` alongside its
draft ID and digest. `editProvider` previously saved the entire response as a
replacement reference. The retained-draft parser permits only the ID and digest,
so a later small edit failed retention. New references now select those two
fields. Retention also normalizes older saved references while preserving their
draft ID and digest.

Provider-draft editing previously discarded forwarded original parts. The editor
now receives the saved exact review, checks its source and ordered part IDs, and
retains the part metadata. It compares all currently composed content before
adopting a provider reference, including forward identity and attachment bytes.
Current forward capability gates both preparing and confirming an operation
that includes original parts.

## Timing and limits

Provider metadata is captured before a held review reply. A later source change
does not replace the prepared byte snapshot. A new review of a changed source
history is rejected. The upstream contract checks a replacement digest while
preparing the operation and explicitly permits a later non-atomic replacement.
The model includes this overwrite possibility after review.

Local reference persistence precedes retirement of the old provider receipt.
The source schedules expose failure before a write, durable commit followed by
lost acknowledgement, account replacement while a read or save is pending, and
an old provider callback whose effect remains uncertain locally.

The finite model admits one provider-draft lifecycle with three requests, a
second owner for rejection schedules, two content/source classes and three
provider revisions. One adoption transaction is pending at a time. Arbitrary
repeated replacements, multiple simultaneous adoption transactions, installed
secure storage and real Gmail behavior remain separate obligations. Native
attachment-byte mismatch is exercised in the source runner and represented through
an explicit read-compatibility input.

```sh
node --test test/quint-inbox-provider-drafts.test.mjs
node specs/quint/refinement/services/inbox-provider-drafts.mjs
```

## Validation on the retained source branch

With upstream `b25d8aef2916385c571f4367e099809254fde0bb`, all 25 source schedules
and 203 checkpoints pass, together with the 27 existing Inbox source schedules.
The 13 model scenarios, 1,000 simulations of 80 steps with seed 123, and Apalache
0.62.4 safety checking through four transitions pass. TypeScript checks, the 26
existing cleanup tests, eight draft/grant tests and Inbox attention/grant fixtures
also pass. Receipts are in `test-results/quint-inbox-provider/final`.

The retargeted main branch moves the review controller and journal upstream.
These old-pin results require a source-owner-aware port and a new campaign on
that branch before they can serve as main-branch implementation evidence.

## Main-based shared-controller port

All25 source schedules and203 checkpoints also pass against upstream475a with
the authenticated `inbox-state-client.patch`. Alpha wrappers inject account,
attachment and retained-draft ports into the actual shared controllers. The
current model preserves all three retained operations across later reviews.
Patch manifests, preparers and effective staged source hashes are captured
before driver execution. Current output is under
`test-results/quint-main-services`. The b25 record above remains historical.
