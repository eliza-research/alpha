# Account-bound local Gmail drafts

## Storage and account boundary

Use the exact Inbox composer and detail Reply controls for explicit local drafts.
No message-send/reply-send/provider-draft endpoint is called for local drafts. Send
and provider-draft actions require separately admitted capabilities and explicit
provider review. Unsupported capabilities do not create synthetic Sent entries.
Agent replies cannot invoke composer effects.

Existing `AlphaConnection.secureRead/secureWrite/secureRemove` stores AES-GCM data
in the app's no-backup directory with Android Keystore, per-slot authenticated
data, atomic writes/readback, a storage lock, and an 8 MiB ceiling for Inbox slots. Reuse this
boundary with an `inbox-drafts:v1:` namespace distinct from credential slots.
Derive the slot from verified Cloud environment + user ID + organization (when
present) + exact Gmail connection ID. Never use an email label, transient agent
identity, or just a renderer-selected account name as ownership authority.

A draft records a random ID, revision, owner/account binding, literal recipient
addresses, subject, body, and optional reply source message/thread IDs. It does
not persist bearer credentials, people suggestions, approval tokens or selection
handles. Explicitly forwarded text and reviewed attachment bytes may be included;
reading an unrelated message does not automatically copy it into a draft.
Use at most one local draft per Gmail connection;
explicit replacement/discard must not silently lose an existing draft. Bound
recipients/subject/body and serialized UTF-8 bytes below the native slot ceiling.

Create/reply displays the exact From account; reply copies only the explicitly
opened message's account, message ID, thread ID, sender address and subject.
Recipients remain editable literal email addresses with CR/LF rejection. Reply
binding is preserved independently of edited subject/recipients. No background
semantic extraction or content upload occurs.

Explicit Save draft awaits native persistence before showing Saved locally.
Restore reads/validates the exact current account's slot and updates the composer
only when account/session/generation still match. Discard asks for confirmation
when persisted or nonempty, removes only that account's slot, and awaits the
receipt. A separate account-bound recovery copy retains unsaved edits, including
incomplete recipients and the original saved-draft revision. Reopening offers
**More → Drafts**, then the **On this device** entry; recovery never sends or prepares a provider operation.
The recovery status distinguishes completed persistence from pending or failed
writes. Browser copies use the canonical transactional document store; Android
uses the existing encrypted Inbox slot namespace. Account
switch/sign-out hides the prior account's draft immediately; it must not write
that content into the next account's slot. Successful writes initiated before a
switch remain bound to their original slot, but cannot update the new UI.

UI controls should reuse existing compose header/body geometry. Save/restore/
discard affordances belong in existing action/chip surfaces and conditional
confirmation sheets, with narrow Inbox-only template changes if required. The
prototype's Send icon remains Send and is never relabeled into a misleading save.

## Verification

Use a fixed synthetic managed-provider fixture (never proxying to Gmail) with two
accounts and deterministic messages. Record all outbound HTTP methods/routes;
assert zero send, reply-send, or provider-draft calls for every local operation.
Native flow: compose with literal recipient, edit body, Save locally, close,
restore after Activity recreation and process restart, verify exact text;
reply preserves selected source binding; discard cancel preserves, confirmed
discard clears only that account. Inspect encrypted slot files to prove synthetic
plaintext absent without logging content or credentials.

Rendered race flows: delayed account-A load/write followed by account-B switch;
late completion must not populate/close B, dirty edits must not be overwritten by
hydration, repeated save/discard must serialize. Fixture unavailable storage must
show failure and keep edits; oversized values fail before a native write.
Mock reference screens remain fixture-only and make zero native draft calls.

Provider send idempotency, unknown-outcome reconciliation, attachments and remote
draft operations have separate implementation and acceptance records. Current
local backend source returning provider IDs is not proof of deployed behavior.

## Native process verification

`InboxDraftInstrumentedTest#processPhase` uses AndroidJUnitRunner with an
explicit `inboxPhase` and run UUID. `InboxFixtureScope` validates those inputs;
`InboxFixtureActivity` and `InboxFixtureConnection` substitute a closed synthetic
Cloud/Gmail transport before WebView creation. Storage delegates to the real
native credential-slot implementation. No provider network or mail send occurs.

Build a matching production app/instrumentation APK pair. The fixture exercises
the production sign-in control and account namespace through its closed synthetic
transport; it does not require a developer environment selector. Retain both APK
hashes in the archive's flat `apk-manifest.json`, then run against an owned
disposable emulator:

```sh
ANDROID_SERIAL=emulator-N ALPHA_NATIVE_TEST_AVD=owned-avd ALPHA_NATIVE_TEST_ABI=x86_64 \
node scripts/test-native-restart.ts inbox \
  test-results/inbox-archive/standalone-debug.apk \
  test-results/inbox-archive/standalone-androidTest.apk \
  test-results/inbox-standalone
```

Repeat with the matching launcher pair and a new output directory. The runner
leases the emulator, refuses existing package registrations and uses a fresh
secondary user. Set `ALPHA_TEST_HOME_PACKAGE` when the stock HOME package differs
from `com.android.launcher3`. Uncertain cleanup retains the user for recovery. The runner records prepare, restore and
cleanup phases, exact artifact hashes and process IDs. A different restore PID
is required. The retained report must prove cleanup as well as successful
save/restore; compilation alone does not qualify this flow. These are synthetic
provider tests, distinct from production Gmail, TLS, device and user acceptance.

## Unsaved-edit recovery

The explicitly saved draft and its recovery copy have separate compare-and-exchange
receipts. A restored copy retains its original saved revision; it cannot replace a
newer saved draft. The user may explicitly discard those edits and review the latest
saved copy. Competing recovery writes offer Restore or Replace. Saved-draft writes
clear only the matching recovery copy; cleanup failure is reported separately from
the successful local save. Damaged recovery records can be backed up and reset
without deleting the explicitly saved draft or changing provider mail.

Current browser fixtures cover incomplete addresses, edits after Save, owner
isolation, cross-tab conflicts, stale saved revisions, discard, damaged storage,
read cancellation and late account-switch completions with zero provider writes.
Native encrypted-store execution and physical process-death acceptance for this
new recovery copy remain separate gates. Large native recovery backups remain
subject to the reviewed document export size limit.

## Reviewed Files attachments

A supported document selected in Files offers **Use in email**. This opens a
separate local review naming the selected Gmail account and draft, file name,
MIME type and byte size. The attachment checkbox starts unchecked; unchecking it
removes the item from the review. Cancel, Back, Home or backgrounding adds nothing.
Open Inbox and select an account first; a saved draft must be restored before
adding to it.

Confirmation rereads the selected capability and verifies its name, type, size
and SHA-256 against the reviewed copy. Lost access, changed bytes, a changed
account/draft, duplicate bytes or attachment-policy limits refuse the insertion.
The copy then uses the existing local draft storage, removal controls and separate
provider send review. **Save draft locally** preserves the exact attachment bytes
for restart; later changes to the original file do not replace that saved copy.
No provider upload or send occurs during this Files review.

This is partial work for #419. It handles one explicitly selected Files item at a
time, including supported images selected through Files. The assistant's existing
text suggestion does not implicitly attach its context. Photos-library selections
remain unavailable here until their native catalog provides a reviewed original-
byte read bound to its permission and revision; the current display thumbnail is
not an attachment source. Native selected-grant/process-death and real Gmail
acceptance remain separate from browser contract tests.
