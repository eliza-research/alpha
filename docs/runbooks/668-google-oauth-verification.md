# #668 Google OAuth production verification for Gmail and Calendar (H-17)

Owner: Cloud operator with the Google Cloud project behind Eliza Cloud's Google connector client
(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` on the Worker). Requirement AP-09; umbrella #381;
test account H-27.

This runbook prepares the submission and the acceptance run. Nothing here has been submitted to
Google, changed in the Google Cloud project, deployed, or run against a real account. Evidence
classes stay separate: source and synthetic tests (this branch), a development-host send
(October 16, `docs/evidence/gmail-prompt-send-20261016.json`), an APK on an emulator, an image, a
device, and Google's own verification result each prove only themselves.

## What is prepared

| Item | File |
| --- | --- |
| Capability-to-scope matrix, every consent path Alpha can start | [668-google-capability-scope-matrix.md](668-google-capability-scope-matrix.md) |
| Generator and read-only privacy probe | `scripts/owner/google-oauth-scopes.mjs` (`matrix`, `probe`) |
| Tests: matrix vs pinned Cloud source and real `CloudProtocol` bodies; readState gate; probe makes one credential-free GET | `test/owner-google-oauth-scopes.test.mjs` |
| Browser test: inbox shows read state as unavailable when `inbox-v1/capabilities` omits or denies `readState` | `test/browser/owner-gmail-read-state-absent.spec.ts` |
| Gmail OAuth acceptance row (draft) and evidence template with placeholders only | this file, [668-gmail-oauth-evidence-template.json](668-gmail-oauth-evidence-template.json) |
| Scope justifications and data-use statements (drafts for Google's form and the privacy policy) | this file |

## Read-only findings (2026-10-28)

- **F-1 The served privacy text does not mention Google user data.**
  `node scripts/owner/google-oauth-scopes.mjs probe` (one unauthenticated GET of
  `https://api.eliza.app/api/public/service`, HTTP 200) found the Privacy Policy "Last updated:
  November 4, 2025", 12 sections, with no mention of Google, Gmail, Calendar, the Google API
  Services User Data Policy or Limited Use. Google's verification reviews the privacy policy for
  exactly that disclosure. The web privacy pages on `eliza.app` and `cloud.eliza.app` are
  client-rendered, so this probe could not read them; check them in a browser. The staging API
  host was unreachable from this machine.
- **F-2 The modify step asks for overlapping scopes.** "Enable Gmail changes" requests
  `gmail.send`, `gmail.compose` and `gmail.modify` together. Google documents `gmail.modify` as
  including read, compose and send. Expect a reviewer question; see D-1.
- **F-3 A later, narrower consent can drop earlier grants.** Cloud builds the Google request from
  exactly the posted capabilities, sends no `include_granted_scopes`, and on callback overwrites the
  stored connection's `scopes` with the requested set (`oauth2.ts` `storeConnection`,
  `onConflictDoUpdate ... scopes`). Alpha's Settings `initiateGoogle` does not carry over held
  capabilities: "Add Google account" on an already connected Google account requests the read set
  only, and "Enable Gmail changes" requests `calendar.read` even when the account holds
  `calendar.write` (reachable after the send-only upgrade path). Either can silently remove
  Calendar write or Gmail change access. `initiateGmail` carries over Gmail capabilities but never
  Calendar ones. This is a product defect independent of verification; it is recorded here and not
  fixed on this branch.
- **F-4 Cloud records requested scopes as granted.** For these owner flows Cloud stores the
  requested scope list, not the `scope` Google returns (only the personal-context flow checks the
  granted list). With Google's granular consent a user can untick a box, and Alpha would then show
  an action as authorized that Google refuses. The acceptance run below checks this.
- **F-5 readState stays unavailable until advertised.** Confirmed by tests on this branch: a
  capabilities answer without `readState` (or with `false`) parses to `readState: false`, the
  inbox shows no Mark read/unread control, opening an unread message prepares no mailbox change,
  and the row stays unread. With `readState: true` the same fixture offers it. Synthetic evidence
  only; whether the deployed Cloud advertises `readState` needs a signed-in read (step 3).
- **F-6 Alpha never requests `google.gmail.manage`** (`gmail.settings.basic`) and no Contacts
  scope. Cloud's provider defaults include `contacts.readonly`; if another Cloud product uses this
  client with that scope, the submission must cover it.

## Remaining human steps

1. **Consent screen (Cloud operator, Google Cloud Console).** Keep the existing connector client.
   On Branding: app name and logo as Eliza Cloud presents them, a homepage and privacy policy on a
   verified authorized domain, support and developer contacts. On Data Access: exactly the scopes in
   the [matrix](668-google-capability-scope-matrix.md#scopes-the-consent-screen-must-list) (plus any
   other Cloud product's, F-6). Do not paste the client secret anywhere in this repository.
2. **Privacy policy (owner or counsel, then Cloud operator).** Publish a Google user data section
   (draft below) on the web privacy page and in `CLOUD_PUBLIC_SERVICE_JSON`, then rerun
   `node scripts/owner/google-oauth-scopes.mjs probe`; it exits 0 only when the served text mentions
   Google, Gmail, Calendar and the User Data Policy or Limited Use.
3. **Deploy and read back (Cloud operator).** Deploy the managed Gmail routes including read-state
   operations. With the H-27 account signed in, read `inbox-v1/capabilities` for that grant and
   record whether `readState` is `true`. Until it is, Alpha keeps read state unavailable (F-5).
4. **Decide D-1 to D-4** below, then submit for verification with the scope justifications and a
   demo video (outline below). Start the restricted-scope security assessment with a Google-approved
   assessor. Record status only (no secrets) in the evidence template.
5. **Native send path stays off (Alpha owner decision, not a Cloud setting).**
   `ELIZA_NATIVE_GOOGLE_GMAIL_SEND_ENABLED` is read by the native managed-Google host in the pinned
   upstream (`packages/app/src/runtime/native-managed-google-host.ts`, `NATIVE_GMAIL_SEND_FLAG`).
   Alpha removes it on purpose from the resident agent environment
   (`android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java`, the two
   `env.remove` lists) so the path stays refused until Seeker acceptance and the production service
   exist (`docs/verification.md`). OAuth verification does not change this. Stopping the strip is a
   separate reviewed Alpha change, made only after Seeker acceptance and a deployed production send
   service, with its own decision entry and tests; no operator should set the flag to bypass it.
6. **Acceptance (operator with the H-27 account).** Run the Gmail OAuth row below and fill
   [the evidence template](668-gmail-oauth-evidence-template.json). Until verification completes,
   the account must be a listed test user, and its refresh token expires after seven days.

## Gmail OAuth acceptance row (draft for `docs/pilot-acceptance-runbook.md`)

| Entry | Preconditions | Procedure | Evidence and boundary |
| --- | --- | --- | --- |
| Gmail OAuth | Consent screen lists the matrix scopes; Google has verified the app or lists the H-27 account as a test user (H-17); H-27 account seeded with synthetic mail and calendars only; for a live send, the owner's written authorization naming the exact recipient and message | From Settings connect (read set); confirm granted capabilities read back match the request; open the synthetic thread and record `inbox-v1/capabilities` (read state must be unavailable unless `readState` is true); Enable Gmail changes and read back; create a provider draft to `<SYNTHETIC_RECIPIENT_PLACEHOLDER>` and read it back; untick one scope on Google's page in a second consent and confirm Alpha does not offer that action (F-4); disconnect in Alpha and read back; reconnect, revoke from the Google Account, confirm Alpha returns to recovery without deleting local data; restart and repeat connect and read | Filled `668-gmail-oauth-evidence-template.json`: granted capabilities per step, receipt request IDs, disconnect outcome, evidence class. A browser or development host run is not APK, emulator, image or device evidence. No real recipient unless authorized in writing; never record addresses, tokens, auth URLs or message bodies. |

## Scope justifications (draft for Google's form)

Write these per scope in the verification form. They describe what Alpha does at this source;
the Cloud operator must confirm they also cover any other product on the same client (F-6).

- `gmail.readonly` (restricted): Alpha Phone is a phone whose built-in Mail screen shows the user's
  Gmail Inbox, Sent and other folders, opens messages and threads, searches and opens attachments.
  It reads mail only when the user opens the Mail screen or a notification the user enabled. No
  narrower scope can show full message bodies and attachments; `gmail.metadata` cannot open a
  message.
- `gmail.compose` (restricted): the user composes replies and new messages on the phone and may
  save them as Gmail drafts, reopen and replace them, or delete them. Every draft write is shown
  for review and needs the user's confirmation.
- `gmail.send` (sensitive): the user sends a message or reply they reviewed. The assistant can
  prepare a message, but sending always requires the user's explicit confirmation of the exact
  recipients and text, even when other agent actions are not set to ask.
- `gmail.modify` (restricted): the user archives, unarchives, trashes, restores and marks messages
  read or unread from the Mail screen. Each change is shown for review before it is applied. Alpha
  never deletes mail permanently and never changes Gmail settings. (See D-1 on whether
  `gmail.send` and `gmail.compose` stay alongside this scope.)
- `calendar.readonly` (sensitive): optional sync shows the user's chosen Google calendars beside
  the calendars stored on the phone, for a bounded date range.
- `calendar.events` (sensitive): the user, or the assistant after the user reviews the exact
  change, creates or updates events on a chosen Google calendar. Alpha requests it only when the
  user approves the separate "Sending and Calendar sync" upgrade.
- `userinfo.email`, `userinfo.profile` (non-sensitive): label the connected account and set the
  sender address.

Incremental authorization: the first consent asks for read access only; change access is a second,
separate consent started from Settings when the user turns it on.

## Data-use statements (drafts for owner or counsel)

Privacy policy section, "Google user data":

> When you connect a Google account, Eliza Cloud stores the OAuth tokens Google issues and uses them
> only to read and act on your Gmail and Google Calendar at your request from Alpha Phone. Mail and
> calendar content is fetched when you open it and shown on your phone; Alpha keeps a cache on the
> phone that is removed when you disconnect the account or sign out. Alpha changes mail or
> calendars only after you review and confirm each change. If you ask the assistant about a
> message, you first review exactly what will be shared, and that text is then sent to the
> assistant's model provider only to answer you. Google user data is not sold, not used for
> advertising, and not used to train generalized AI or machine-learning models. Humans do not read
> it except with your explicit consent for a specific message, for security investigations, to
> comply with law, or when aggregated and anonymized for internal operations. You can disconnect in
> Alpha Settings, which deletes Eliza Cloud's stored tokens, and revoke access in your Google
> Account at any time.

Limited Use disclosure (homepage or privacy policy, wording Google expects):

> Eliza Cloud's use and transfer to any other app of information received from Google APIs will
> adhere to the Google API Services User Data Policy, including the Limited Use requirements.

Before publishing, the owner must confirm each claim against Cloud's actual behaviour: token
storage and deletion on disconnect, server-side retention of any mail or calendar content, the
phone cache's lifetime, the inference provider used when signed in and its no-training terms, and
who can access production data.

## Demo video outline

One unlisted video, English, showing: the Google consent page with the client ID visible in the
URL bar; first consent (read set) from Alpha Settings; Mail list and opening a synthetic message;
"Enable Gmail changes" and its second consent; a reviewed draft save, a reviewed archive and mark
read; a reviewed send to a synthetic address the team controls (only under the H-27 written
authorization); "Sending and Calendar sync" consent, the Calendar list and a reviewed event
create; Disconnect in Settings. Use only the H-27 synthetic account.

## Decisions for the owner

| # | Question | Options | Default / recommendation | What each choice changes |
| --- | --- | --- | --- | --- |
| D-1 | Does the modify step keep `gmail.send` and `gmail.compose` alongside `gmail.modify`? | (a) keep all three (current source mapping; no recorded decision covers the Gmail scope set yet, so this row would become that decision); (b) request only `gmail.modify` for the modify step and keep `gmail.send` alone for the send-only upgrade | Recommend (a) for this submission with the per-action justification above, unless a reviewer objects; (b) is the least-privilege fallback | (a) no code change, possible reviewer question. (b) needs a Cloud mapping change (`scopesToCapabilities` already reads `gmail.modify` as drafts and mailbox, but not as send) and an Alpha grants change in the pinned upstream; fewer restricted scopes on the screen (compose dropped) |
| D-2 | Submit Gmail change scopes now, or verify read-only Gmail and Calendar first? | (a) submit everything in the matrix; (b) verify read set plus Calendar first, keep change scopes in Testing | Default (a): the MVP includes reviewed sends and mailbox changes (AP-09) | (a) one assessment covers all restricted scopes. (b) faster first approval, but change actions stay limited to test users with seven-day tokens |
| D-3 | Who publishes the Google user data disclosure (F-1)? | (a) Eliza Cloud privacy policy (client owner); (b) a separate Alpha Phone policy | Default (a): the consent screen and tokens belong to Eliza Cloud's client | (a) Cloud's served Privacy text and web page change. (b) Alpha would need its own homepage/domain on the consent screen, which it does not have |
| D-4 | Fix F-3 (narrower consent drops grants) before the acceptance run? | (a) carry over held capabilities in `initiateGoogle` like `initiateGmail` does, including Calendar; (b) Cloud adds `include_granted_scopes=true` and merges scopes; (c) leave as is | Recommend (a), and (b) in Cloud as defence in depth | (a) Alpha change plus a test. (b) upstream Cloud change through a reviewed eliza commit. (c) acceptance must avoid the affected button sequences, and real users can lose access silently |

## Draft decision entries

- **P-draft (#668) Google verification scope set.** Alpha's Google consent screen lists exactly the
  scopes in `docs/runbooks/668-google-capability-scope-matrix.md` (userinfo.email,
  userinfo.profile, calendar.readonly, calendar.events, gmail.send, gmail.readonly, gmail.compose,
  gmail.modify); `gmail.settings.basic` and Contacts are not requested by Alpha. Resolution of D-1
  and D-2 recorded here.
- **P-draft (#668) Google user data disclosure.** Eliza Cloud's privacy policy carries the Google
  user data section and the Limited Use statement (D-3); `scripts/owner/google-oauth-scopes.mjs
  probe` is the readback.
- **P-draft (#668) Consent never narrows held grants.** Every consent request names what the
  selected account already holds, Gmail and Calendar alike (D-4).
