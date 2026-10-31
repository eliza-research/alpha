# Google capability-to-scope matrix (#668, H-17)

Alpha never names Google OAuth scopes. It posts Eliza Cloud capability names to
`POST /api/v1/eliza/google/connect/initiate` (`apps/app/src/runtime/cloud-protocol.ts`,
`initiateGoogle` and `initiateGmail`), and Cloud's `capabilitiesToScopes`
(`vendor/eliza/packages/cloud/shared/src/lib/services/agent-google-connector/shared.ts` at the pin
in `upstream.lock.json`, `1f2a922f86`) turns them into the scopes on Google's consent page.
Regenerate this table with `node scripts/owner/google-oauth-scopes.mjs matrix`; it parses the
pinned Cloud source and exits 1 if that source has drifted from the embedded copy.
`test/owner-google-oauth-scopes.test.mjs` checks every row below against the real `CloudProtocol`
request bodies and the Settings buttons.

This is source evidence. It does not show what the deployed Worker requests, what Google granted,
or that any consent screen is configured.

## Cloud capabilities and scopes

Cloud always adds `userinfo.email` and `userinfo.profile` (identity) to every request.

| Cloud capability | Google scope(s) | Google class | Alpha uses it for |
| --- | --- | --- | --- |
| `google.basic_identity` | `userinfo.email`, `userinfo.profile` | non-sensitive | Labelling the connected account; the Gmail `from` address |
| `google.calendar.read` | `calendar.readonly` | sensitive | Listing calendars and reading events in a bounded range for the optional Google Calendar sync |
| `google.calendar.write` | `calendar.events` | sensitive | Creating and updating events the user reviewed in Alpha |
| `google.gmail.triage` | `gmail.readonly` | **restricted** | Inbox, Sent and folder lists, search, reading a message or thread, attachments, provider drafts list (read) |
| `google.gmail.send` | `gmail.send` | sensitive | Sending a reviewed message or reply after explicit confirmation |
| `google.gmail.drafts` | `gmail.compose` | **restricted** | Creating, replacing and deleting provider drafts the user reviewed |
| `google.gmail.mailbox` | `gmail.modify` | **restricted** | Archive, unarchive, trash, untrash, mark read and mark unread after review |
| `google.gmail.manage` | `gmail.modify`, `gmail.settings.basic` | **restricted** | Never requested by Alpha |

Classes follow Google's published scope lists; the Data Access page of the Google Cloud project is
authoritative and must be rechecked when the screen is configured.

## Every consent request Alpha can start

Surface `ui` is a button or switch in `apps/app/src/runtime/google-connection-ui.tsx` (Settings > Google).
Connect asks for everything Cloud's Google provider allowlist accepts at this source; the "Gmail changes" and
"Calendar edits" switches only stop agent writes and never revoke or disconnect Google.
Cloud's Google `defaultScopes` (also its allowlist) do not include `gmail.compose` or `gmail.modify`, so the
`modify`, `drafts` and `mailbox` paths are refused by Cloud before Google is reached until that allowlist changes.
Surface `api` exists in `CloudProtocol` but no shipped screen calls it at this source.

| Path | Surface | Call | Capabilities posted | Scopes Google shows |
| --- | --- | --- | --- | --- |
| connect | ui: "Connect Google account" / "Add Google account", or turning on "Gmail changes" / "Calendar edits" when the grant is missing | `initiateGoogle(write, send)` | basic_identity, gmail.triage, calendar.read, calendar.write, gmail.send | userinfo.*, gmail.readonly, calendar.readonly, calendar.events, gmail.send |
| switch-upgrade-modify | ui: same switches when an account already holds Gmail changes | `initiateGoogle(write, modify)` | read set + gmail.send, gmail.drafts, gmail.mailbox + calendar.write | userinfo.*, gmail.readonly, gmail.send, gmail.compose, gmail.modify, calendar.readonly, calendar.events |
| calendar-connect | ui: "Connect Google Calendar" (Google accounts opened from Calendar) when no account holds Gmail send or changes; otherwise the same intent asks connect or switch-upgrade-modify so Gmail access is never narrowed | `initiateGoogle(write, read)` | basic_identity, gmail.triage, calendar.read, calendar.write | userinfo.*, gmail.readonly, calendar.readonly, calendar.events |
| enable-gmail-changes | api | `initiateGoogle(read, modify)` | + gmail.send, gmail.drafts, gmail.mailbox | + gmail.send, gmail.compose, gmail.modify |
| api-drafts | api | `initiateGoogle(read, drafts)` | read set + gmail.drafts | + gmail.compose |
| api-mailbox | api | `initiateGoogle(read, mailbox)` | read set + gmail.mailbox | + gmail.modify |
| api-gmail-read | api | `initiateGmail(read)` | basic_identity, gmail.triage | userinfo.*, gmail.readonly |
| api-gmail-modify | api | `initiateGmail(modify)` | + gmail.send, gmail.drafts, gmail.mailbox | + gmail.send, gmail.compose, gmail.modify |

`initiateGmail` also carries over Gmail capabilities the account already holds; it never carries
Calendar capabilities (see the runbook's finding F-3).

## Scopes the consent screen must list

For the shipped Settings paths, the Google Cloud project's Data Access page must list exactly:

| Scope | Class |
| --- | --- |
| `https://www.googleapis.com/auth/userinfo.email` | non-sensitive |
| `https://www.googleapis.com/auth/userinfo.profile` | non-sensitive |
| `https://www.googleapis.com/auth/calendar.readonly` | sensitive |
| `https://www.googleapis.com/auth/calendar.events` | sensitive |
| `https://www.googleapis.com/auth/gmail.send` | sensitive |
| `https://www.googleapis.com/auth/gmail.readonly` | restricted |
| `https://www.googleapis.com/auth/gmail.compose` | restricted |
| `https://www.googleapis.com/auth/gmail.modify` | restricted |

The connector client belongs to Eliza Cloud and may serve other Cloud products. Cloud's provider
registry default list also names `contacts.readonly`, and `google.gmail.manage` maps to
`gmail.settings.basic`. Alpha requests neither. If another Cloud product does, the verification
submission must justify those scopes too; this matrix covers Alpha only.

## Reviewer notes derived from the scope sets

- The modify step requests `gmail.modify` together with `gmail.send` and `gmail.compose`. Google
  documents `gmail.modify` as covering read, compose and send, so a reviewer may ask why the
  narrower scopes are also requested. This is decision D-1 in the runbook.
- Three restricted Gmail scopes are requested. Restricted scopes need the annual third-party
  security assessment in addition to verification, whichever of them is kept.
