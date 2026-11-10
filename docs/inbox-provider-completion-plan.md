# Inbox provider completion

Email/Gmail is in MVP scope (owner decision [P-02](decisions.md#october-7-owner-product-decisions), October 7, 2026). This plan dates from September 30. The current boundary below records what the October 7 change implemented. It is still not acceptance evidence: real OAuth, Cloud deployment and a real mailbox remain open. The existing prototype remains the visual contract; offline encrypted local drafts must continue working independently of Cloud authentication.

## Current boundary (October 7)

The cloud adapter (`apps/app/src/prototype/inbox-cloud-adapter.ts`) and `runtime/cloud-protocol.ts` now provide the following against the managed owner connector:
- account-scoped search with the provider's opaque `nextPageToken` (Load more) and an `in:sent` Sent view;
- automatic load on open, plus Refresh;
- threads and single-message reads;
- reviewed send, provider draft, archive/trash/undo and attachment operations through `inbox-v1`, with durable receipts and no automatic re-send;
- `POST /api/v1/eliza/google/disconnect` behind a confirmation and a read-back (`runtime/gmail-mailbox.ts`), exposed in Inbox and Settings → Connections;
- classified offline, revoked-grant and stale (409) failures, each with an explicit Retry;
- Notes sharing into a prefilled local draft;
- a From switcher for more than one connected account.

The pinned upstream inbox-v1 implementation includes reviewed `mark-read`/`mark-unread`
operations, the `readState` capability and its receipt migration. The connector changes
merged in [elizaOS PR #34662](https://github.com/elizaOS/eliza/pull/34662); their local
patch copies are retired. Source integration does not establish Cloud deployment.
Until a deployed server advertises `readState`, opening a message does not mark it read.

## Shared connector capabilities

The implementation is in
[`inbox-provider.ts`](../vendor/eliza/packages/cloud/shared/src/lib/services/agent-google-connector/inbox-provider.ts)
and the managed Gmail routes at the pin in `upstream.lock.json`.

| Capability | Client use when a server advertises it |
| --- | --- |
| `links[]` from HTML message parts | Tappable link list under the body |
| Declared text charset decoding | Correct ISO-8859-1/Windows-1252 bodies |
| Attachment metadata and `searchTrash` | Paperclip on search rows; Trash folder |
| Draft listing and exact content, `draftsList` | Drafts folder and reviewed replacement |
| Opaque attachment copying and forwarding | Selected files and original forward attachments |

The client also:
- publishes a Home summary through `inboxAttention()` (`not-connected`, `loading`, `ready`, `error` or
  `stale`, with an unread count, the account label and a time) and `openInbox()`, without subjects,
  senders or bodies. Home consumes it (`apps/app/src/main.tsx`). The unread count reflects only Inbox
  data the user explicitly loaded: there is no background unread probe, and Home and resume fetch no
  Gmail metadata (`scripts/test-inbox-attention-flow.ts`). The count is unknown until a read happens; a
  stale summary keeps the last real count and time, and Home shows a dash when none exists. Leaving Inbox
  marks the summary stale. New-mail awareness remains blocked on A-05;
- turns plain-text `https` URLs in a body into the same link list (`inbox.d.links`). A link opens only in
  Alpha's Browser, only for HTTPS, and only after a confirmation that names the destination site and warns
  when the link text names a different site. Nothing is fetched to render a message. `template.html` renders the reviewed link buttons;
- shows today's mail with a time, offers Archive (`in:archive`) for every account, and offers Drafts and
  Trash only when the server advertises them;
- adds "Use in email" for agent text (`view.useInEmail`), which opens a local draft for the selected
  account, as a reply when a message is open. Nothing is sent; the normal composer and provider review
  apply. No control calls it yet: the agent reply UI (`agent-adapter.ts`/`template.html`, other packages)
  must add the button. The "Help me organize my inbox" suggestion is removed;
- adds `CloudProtocol.revokeSession()`, which uses Cloud's self-revocation route
  (`DELETE /api/v1/api-keys/current`) when the host transport allows `DELETE` and otherwise reports
  `{supported:false}`. The local credential is cleared either way. The Android transport admits this one
  `DELETE` (`ConnectionRoutes.cloudSelfRevocation`), so Android sign-out sends it once; the browser
  transports do not. No live Eliza Cloud revocation has been observed.

Known limit of provider draft editing: the editable content is the draft's text/plain part and literal recipient
addresses. A draft that also has a text/html alternative (Gmail's usual form) is offered for editing, and
replacing it after review keeps only the plain text and drops recipient display names. Reply drafts,
drafts with attachments and HTML-only drafts stay in Gmail.

The Alpha `runtime/gmail-mailbox.ts` helpers retain product error messages, disconnect
confirmation and reviewed read-state orchestration. Their generic contracts remain
candidates for further consolidation. Cloud deployment and real-account acceptance
remain separate.

The September 30 findings below are kept as written for their date.

## Verified boundary (September 30)

At that time `apps/app/src/prototype/inbox-cloud-adapter.ts` exposed bounded account-scoped search and single-message reading, plus encrypted local compose/reply drafts. Its archive/delete/forward actions deliberately did not mutate mail. `runtime/cloud-protocol.ts` consumed `/api/v1/eliza/google/accounts`, `/gmail/search` and `/gmail/read` under the managed owner connector. Current source in `~/v3/packages/cloud/api/v1/eliza/google/gmail/read/route.ts` authenticates the organization/user and delegates the selected grant to the managed connector. This route is not a thread, attachment or sending contract. Local source inspection does not establish the deployed Worker revision.

Gmail provides full-thread retrieval through [threads.get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/get). Its [draft resource](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts) has an immutable draft ID, replacement update, send, and permanent draft deletion. [messages.send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send) returns a Message on success and sends to the MIME recipient headers. The inspected send contract does not advertise an idempotency-key parameter. Therefore Alpha must not infer exactly-once delivery from its own request ID.

## Required implementation

1. Extend the managed Cloud connector through a reviewed upstream change, not a phone-side Google token store or an arbitrary URL proxy. Every endpoint derives organization/user from authentication and validates the selected grant and required capability. Keep Google refresh/access tokens server-side. Publish protocol capabilities so older deployments produce an explicit unavailable state.
2. Add a selected-thread endpoint returning ordered bounded messages, exact provider IDs, body representation and attachment metadata. Reuse the prototype's existing detail/attachment layout. Treat message bodies as inert text by default; do not execute HTML or fetch remote tracking images. Long threads need an explicit truncation/paging contract rather than silently dropping messages.
3. Add explicit attachment retrieval bound to grant, message and attachment ID. Check declared and actual byte limits and MIME type; generate an opaque short-lived reference. Download only after the user's selection. Native open/share uses a scoped content URI and reports handoff separately from consumption. Do not attach bytes to the agent automatically.
4. Preserve local drafts and add distinct provider-draft save/update/readback. Persist the returned draft ID and canonical content digest. Before replacing a remotely changed draft, require review; a preflight digest comparison is not a provider-wide atomic compare-and-swap guarantee. Do not silently overwrite an edit made concurrently in Gmail. Draft deletion is permanent at the provider and needs an explicit destructive confirmation; local discard must not imply remote deletion.
5. Implement compose, reply, reply-all and forward as reviewable drafts with explicit From account, To/Cc/Bcc, subject, body and attachment list. Bind reply headers and thread identity to the selected provider message. Reject header injection and invalid/ambiguous recipients. Preserve the exact reviewed MIME digest when creating the operation.
6. Give send and mailbox mutations durable owner/grant/request receipts with prepared, dispatched, succeeded, rejected and outcome-unknown states. Serialize one admitted operation per request ID, but never equate that with Gmail-side deduplication. After response loss or process death, query the exact operation and available provider evidence; never issue a second send automatically. A provider success receipt is not proof that a recipient read or received the email.
7. Archive removes INBOX; delete moves to Trash with an explicit undo path where supported. Permanent deletion is a separate confirmed operation. Return exact changed message IDs and read back affected labels. Reconcile partial results individually. Do not silently mutate an entire conversation from a selected-message action.
8. Attach selected message/thread context to the agent only through an explicit content review. Show the selected account and destination agent. Agent drafting may produce suggestions; it cannot bypass the same final recipient/content review and mutation receipt path.

## Verification sequence

Use a closed synthetic HTTP provider for actual Cloud route/database integration, with two owners and grants, real MIME parsing and controlled response loss. Then exercise the exact phone UI against that service in both distributions: account switch and revocation during fetch, multi-message thread, attachment cancel/open, local/provider draft distinction, stale remote draft, MIME recipient review, duplicate confirmation, lost send response, process restart and canonical receipt lookup. Require zero second send dispatches during recovery and no unselected content in agent context.

Real acceptance separately requires normal Cloud login and working Gmail OAuth, an explicitly authorized test mailbox/recipient, actual provider draft/readback and approved send/reply, label changes and recovery. The current Google code-exchange401 and pending Cloud organization-key approval remain external gates. Do not send real mail merely because the synthetic flow passed. Preserve existing local drafts if those gates remain unresolved.

## Use in email from the assistant (MVP-14, 2026-10-10)

A finished plain assistant reply offers "Use in email" in its message actions while Inbox is the app behind the conversation
(`apps/app/src/prototype/use-in-email-review.ts`). The review names the From account and the exact destination before anything
is inserted: the open local draft, a new reply to the open message, or a new email. `view.emailTarget()` returns that destination
with a renderer-only token covering the Cloud session, account owner, open message and its `historyId`, and the draft's identity
and current content; `view.useInEmail(text, {token, append})` refuses when any of them changed, and the review then shows the
current destination again. Text already in a draft is never replaced: the only offered action is adding the suggestion below it.
A saved local draft that is not open, retained edits, a message without a literal reply address, a reply longer than a draft, or
an open draft without room for the whole reply block the review with the reason; text is never cut short. A changed agent
session or an edited/removed reply closes the review without inserting. The review names the recipients the draft really gets,
literal address first: a reply to a message from the account's own address (for example one opened from Sent) has none.
One draft exists per account, so a draft whose composer was closed is still the destination: the review names it as an
unfinished draft that is not on screen and, when another message is open, says it is not a reply to that message. A reviewed
suggestion is inserted whole or not at all, and the review does not survive locking the phone.

Attachment policy (unchanged, now stated in the review): only the text is inserted. Files and Photos selected elsewhere are not
attached by a suggestion or by sharing; the composer's Attach picker remains the only way to add a file.

Nothing in this path prepares or dispatches a provider operation; sending still requires the composer and the provider review.
Evidence is source and browser tests with synthetic data only: `test/use-in-email-review.test.mjs`, sections 7 to 7e of
`scripts/test-inbox-attention-flow.ts`, `test/browser/use-in-email.spec.ts` (development lane, a synthetic Cloud client and
agent placed in the page) and `test/browser/use-in-email.production.spec.ts` (flag-off build with only the Android bridge
stubbed by `test/browser/flag-off-android.ts`). The flag-off spec drives the control from an agent reply that streams back over
the stubbed bridge, against a synthetic managed Gmail answered at the native HTTP boundary: review and insert into a reply draft
for the selected email; a draft that changed under the open review is refused, then appended after re-review; a Gmail account
that changed while the review was open is refused and no draft is stored for either account; a send review left pending is
discarded when a suggestion is added, and only the request reviewed afterwards is dispatched; outside Inbox no action is
offered. Real Gmail, a real agent reply and device acceptance for this control remain open.
