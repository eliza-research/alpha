# Gmail background reconciliation

Source implementation for issue #398; the issue remains open for deployed-service
and real mailbox/device acceptance. The consumer uses the managed owner endpoint
from [Eliza PR36173](https://github.com/elizaOS/eliza/pull/36173), with its deployed served source still requiring verification. An absent endpoint is shown as unavailable,
not a successful sync. No OAuth grant, credential or send capability is created.

## Ownership and durable progress

The behaviour is shared upstream: `MailBackgroundDelivery`, `MailHistoryReconciliation`
and `MailNoticePoster` in `plugins/plugin-native-notifications`, and
`createMailBackground`/`mailBackgroundMessage` in `@elizaos/plugin-inbox/mailbox`.
Alpha keeps only its installed binding (`GmailBackground.java`, the `AlphaGmail`
Capacitor bridge, the WorkManager worker and `apps/app/src/runtime/gmail-background.ts`):
the `gmail-background:v1` slot, the `alpha-gmail` channel, tap action and route prefixes,
the production Cloud key and the reset fence.

The delivery uses the existing encrypted production Cloud key. The foreground
selection names the Cloud credential, owner (user and organization) and Gmail grant;
native independently verifies that owner and the connected `google.gmail.triage`
grant with Cloud before saving the selection and before every history page, and pins
the exact credential bytes. Selection attempts, credential changes, reset and worker
cancellation fence asynchronous responses. Revalidating the same owner/grant
preserves the cursor; renderer cold-start hydration cannot clear native progress.
Explicit Google disconnect (Settings or the Google accounts panel) starts retiring
native state before sending the remote revoke, including uncertain revocations. A
local withdraw failure never blocks the revoke; it is retried once afterwards, and
sync and taps re-verify the grant and fail closed.

Background checks do not depend on the agent's inference provider. The earlier
design admitted them only with the Eliza Cloud inference provider (reporting
`provider-unsupported` otherwise) because it borrowed that provider's owner snapshot.
The check only reads Cloud Gmail routes with the Cloud key, and the Cloud credential
plus the remotely verified owner are sufficient, so the coupling and that state were
removed; changing the inference provider no longer withdraws background checks.
Installed selections keep their cursor: the owner account reference format is unchanged.

`MailHistoryReconciliation` saves event-derived notice records and continuation together
in the native-only encrypted `gmail-background:v1` slot. Every continuation keeps
the original decimal history ID; only the final durable page advances it. Decimal
IDs retain 20-digit precision. A profile baseline or expired-history reset quietly
starts future observation and explicitly retains incomplete catch-up status. It
cannot establish that missed mail was fully reconciled.

Message additions require the endpoint's hydrated `messageAvailable` and current
INBOX/UNREAD labels; deleted, read, Sent, Spam and Trash messages do not alert.
Notice identities include the durable selection generation, owner, grant and
message. Dispatch is durably reserved before Android notification creation. A
bounded active-notification observation distinguishes posted from uncertain;
ambiguous dispatch is never automatically retried. This deliberately favors
at-most-once delivery over guaranteed alerts. Pending, active, captured and
uncertain records remain retained. Terminal records behind an already committed
checkpoint can be retired; the 1,000-record bound limits unresolved work rather
than lifetime deliveries. Overflow retains the checkpoint and reports incomplete
catch-up instead of truncating events.

Notifications contain no sender, subject or body. Taps carry only a ledger key.
The native bridge and renderer revalidate the owner/grant before consuming the
one-use tap and opening the Inbox list. Taps clear retained Sent/Trash/search state;
they never open a message body or mark mail read. Old selection PendingIntents
cannot match a new selection's ledger.

## Scheduling and user visibility

Ordinary constrained WorkManager checks run at a 15-minute minimum interval with
bounded four-page jobs and exponential retry. Resume schedules catch-up; pagination
and pending dispatch survive process recreation. Android Doze and battery saver can
delay work. Settings show the last successful check, unavailable/retrying state,
incomplete catch-up and notification denial/uncertainty, plus a link to Android
channel settings. Delivery is not an exact-time promise.

## Validation and remaining acceptance

Controlled tests (upstream `test/native-host/mail.node.mjs`, rerun at the pin by
`test/gmail-background-binding.test.mjs`) execute the real reconciliation engine and native delivery
coordinator on the JVM, with in-memory durable storage and an HTTP transport
fixture. They cover pagination/restart, failed persistence, death after notify,
permission loss, uncertain dispatch, stale owner/grant responses, same-owner
startup continuity, old tap rejection, expired baseline and 1,100 completed notice
cycles. The real Inbox adapter fixture covers Sent/search-to-Inbox taps, cold
hydration and resume retry. Existing grant/read-ahead/draft/notice tests and
TypeScript checks pass.

The shared Android sources compile against the Android 36 platform jar upstream
(`android-compile.node.mjs`); the Alpha bridge and worker compile only in the APK build. This is API compilation,
not a packaged APK or device run. Required release acceptance remains: deployed
served endpoint/source verification, real owned mailbox arrival and revoke,
notification permission/channel denial, lock/unlock, Doze, reboot, process death,
account changes and target-image execution. Upstream fixtures and local test passes
are not that evidence.

## Explicit Ask action

The redacted Gmail notice has a separate authenticated Ask PendingIntent. Its
ledger route includes the native selection generation and exact message/thread
identities; a missing OS notice cannot authorize review. Only an explicit Ask tap
reads the current message through the existing managed Gmail read endpoint. The
review receives subject and snippet, never the returned body or attachments.
Continue rechecks the native route, Cloud owner/grant, current message/history and
selected agent before prefilling a conversation draft. Send remains a separate
user action. Cancel releases the pending question without consuming the notice.
A missing message opens Inbox safely without creating a question draft.

Controlled browser cases cover compose, reusable Cancel, source changes and owner
changes for both Gmail and reminder questions. These tests do not establish real
mailbox or device notification delivery.
