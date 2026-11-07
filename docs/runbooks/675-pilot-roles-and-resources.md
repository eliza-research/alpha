# #675 Pilot roles, cohort, accounts and test resources (H-07, H-26 to H-29)

Owner preparation for [#675](https://github.com/eliza-research/alphaphone/issues/675). This page is
a draft to fill in; it is not evidence and records no account, number, code or key. The steps
themselves are [human actions](../human-actions.md) H-07 and H-26 to H-29, and the per-unit table
they fill is in the [pilot acceptance runbook](../pilot-acceptance-runbook.md#per-unit-evidence-record).

Agents prepared this page only. Nobody in the orchestration created an account, held a credential,
bought a plan, minted a grant code, sent a message or touched a unit.

## Rules for every record on this page

- Write roles and aliases, never personal data, in this repository. A role row names the person by
  a handle the owner chooses (for example `operator-1`); the mapping from handle to person stays in
  the owner's private records.
- Units are `unit-a` to `unit-d`. Never write a serial, IMEI, phone number, SIM ICCID, email address
  or account ID here. `scripts/provision-unit.mjs` records only the SHA-256 of the serial and build
  fingerprint.
- Never write a password, PIN, passphrase, token, grant code, API key, OTP or recovery code anywhere:
  not in this page, an issue, a PR, a commit or a test report. A cell that would need one records
  "held by `<role>`" instead.
- Evidence classes stay separate: provisioning a unit is not device acceptance; a plan shown in
  Settings is not real-integration evidence for Gmail; nothing here is user acceptance.

## H-07 Role assignment (draft)

| Role | Handle (owner's choice) | Constraint | Assigned on (UTC) | Accepted by the person |
| --- | --- | --- | --- | --- |
| Operator (device operator) | `<operator-handle>` | runs provisioning and journeys (H-32, H-33) | `<yyyy-mm-dd>` | `<yes/no>` |
| Reviewer | `<reviewer-handle>` | must not be the operator; reproduces setup and a journey (H-34) | `<yyyy-mm-dd>` | `<yes/no>` |
| Support owner | `<support-handle>` | named contact during the pilot | `<yyyy-mm-dd>` | `<yes/no>` |
| Rollback owner | Shaw (P-16) | accountable release, support and rollback owner | fixed by P-16 | n/a |
| Release owner | `<release-owner-handle>` | records `lastRelease` with `scripts/record-release.mjs` (H-32) | `<yyyy-mm-dd>` | `<yes/no>` |
| Key custodian | `<custodian-handle>` | from the key ceremony issue (#661, H-01/H-08) | `<yyyy-mm-dd>` | `<yes/no>` |
| Key ceremony witness | `<witness-handle>` | must not be the custodian (#661, H-08) | `<yyyy-mm-dd>` | `<yes/no>` |
| Target user 1 to 4 | `<user-1>` … `<user-4>` | the cohort that records acceptance (H-34) | `<yyyy-mm-dd>` | `<yes/no>` |

Check before closing H-07: the reviewer handle differs from the operator handle, the witness differs
from the custodian, and four target-user handles are distinct.

## H-07 Per-unit table (draft for the runbook's per-unit record)

Copy the filled rows into the [per-unit evidence record](../pilot-acceptance-runbook.md#per-unit-evidence-record)
in a reviewed change. Hardware cells record what the box and `adb shell getprop` show; the serial is
never written.

| Unit | Model / codename | SKU (box label) | Hardware revision | Operator handle | Target user handle | Eliza Cloud plan (H-26) | SIM present (H-28) | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| unit-a | Pixel 10a / `stallion` | `<sku>` | `<rev>` | `<operator-handle>` | `<user-1>` | `<plan name, no code>` | `<yes/no>` | not run |
| unit-b | Pixel 10a / `stallion` | `<sku>` | `<rev>` | `<operator-handle>` | `<user-2>` | `<plan name, no code>` | `<yes/no>` | not run |
| unit-c | Pixel 10a / `stallion` | `<sku>` | `<rev>` | `<operator-handle>` | `<user-3>` | `<plan name, no code>` | `<yes/no>` | not run |
| unit-d | Pixel 10a / `stallion` | `<sku>` | `<rev>` | `<operator-handle>` | `<user-4>` | `<plan name, no code>` | `<yes/no>` | not run |

Read the hardware cells without writing the serial: `adb -s <serial> shell getprop ro.product.device`
(expect `stallion`), `adb -s <serial> shell getprop ro.boot.hardware.revision` (or `ro.revision`, whichever
the unit reports; record which), and the SKU from the retail box or
Settings › About phone › Model. Other Pixel models are not supported pilot hardware.

## Pilot resource request checklist (H-07, H-26 to H-29)

One list to send to the people who supply each resource. Each line says what is requested, who
holds it, where Alpha already waits for it, and how the operator verifies it without copying a
secret.

### H-07 Hardware and people

- [ ] Four Pixel 10a (`stallion`) units, factory state, with stock recovery available. Holder:
  operator. Verify: `getprop ro.product.device` reads `stallion` on each; SKU and revision filled in
  the table above.
- [ ] Owner's written consent to the exact provisioning and reset operation for each unit, before the
  unit is changed ([pilot runbook](../pilot-acceptance-runbook.md#release-entry-conditions)). Verify:
  a dated note in the owner's private records, referenced here by date only.
- [ ] Every role in the table above accepted by the person. Verify: the "Accepted" column.

### H-26 Eliza Cloud accounts and plans

- [ ] One designated Eliza Cloud account per unit (four). Holder: the target user or the operator, as
  the owner decides (see Decisions). Seam: Alpha's own sign-in screen and the plan gate.
- [ ] A plan on each account: bought, or a grant code minted by the Cloud operator with upstream
  `packages/cloud/scripts/admin/mint-subscription-grant-codes.ts` (for example
  `--duration-months <n>`; the owner chooses the term). The code is handed directly to the person who
  redeems it and is never written down here. Seam: Redeem code in the plan gate and in Settings.
- [ ] One extra account per condition of the deployed admission-latency benchmark (H-15, #666).
  Holder: Cloud operator.
- Verify on each unit (operator): Settings › Eliza Cloud account & plan shows the plan, and the
  running agent binds Cloud inference; sign out once and confirm the agent keeps running with AI
  unbound ([pilot runbook](../pilot-acceptance-runbook.md#external-integration-runbooks), "Cloud plan
  per unit"). Record: plan name and expiry date shown, never the code or session.

### H-27 Google test account

- [ ] One designated Google account with synthetic mail and synthetic calendars only. Holder: owner.
  Precondition: the Google connector covers Gmail and Calendar scopes and the account is a listed test
  user or the app is verified (H-17, #668).
- [ ] Before any live send: the owner states in writing the exact recipient and the exact message.
  Until then only synthetic sends are run and real-send acceptance stays open.
- Verify (operator): the runbook's Gmail OAuth row — authorize from Settings, read a synthetic thread,
  create a draft, revoke from the Google account, confirm recovery without local data loss, repeat
  after restart. Record: grant and revoke observations with receipt IDs, never tokens.

### H-28 Telephony test resources

- [ ] An active SIM for each image unit (four). Holder: owner. A plan with SMS and MMS (carrier MMSC
  and APN) is needed for the MMS journeys.
- [ ] Owned endpoints the team controls for calls, SMS and MMS, and two SIMs or numbers on one unit
  for the multi-SIM and delivery-report tests. Holder: owner.
- [ ] No emergency numbers in any test plan.
- Verify (operator, on the image, #673): provider rows, carrier delivery reports and role readback on
  a unit. Record: provider row IDs and delivery-report status, never a phone number.

### H-29 Password test resources

- [ ] A test vault with synthetic credentials only. Holder: owner.
- [ ] A designated test website the team controls for save and fill.
- [ ] Optionally Proton Pass with a test account, installed on a release-signed build (#662).
- Verify (operator): the runbook's password provider row — choose the provider through Android's
  picker, save and fill on the test site, lock, cancel, disable, wrong-origin and iframe boundaries
  ([password provider setup](../password-provider-setup.md)). Record: provider-owned UI screenshots
  without secrets.

## Evidence templates carry no credential fields

Checked on this branch (`test/owner-pilot-templates.test.mjs`):

- The per-unit evidence record in [the pilot runbook](../pilot-acceptance-runbook.md#per-unit-evidence-record)
  has the columns Unit, SKU / hardware / Android fingerprint, App SHA / APK SHA / signer /
  versionCode, OS image SHA / runtime manifest, Local owner-agent binding evidence, Test report /
  video / reviewer, Status. None asks for a credential.
- The two drafts on this page and the unit record of [#677](677-pixel10a-device-pilot.md) have no
  column or field for a password, PIN, token, key, grant code, OTP, recovery code, phone number,
  email address or serial.
- `scripts/provision-unit.mjs` writes `schema, alias, createdAt, sourceCommit, evidence,
  notEvidenceFor, device, apk, installed, runtimeIdentity, homeRole`; the device block holds the
  serial and fingerprint as SHA-256 only.

## What `npm run human:status` reports

Read on this branch on 2026-10-28 (`node scripts/human-actions.mjs`):

| Step | State | Detail printed |
| --- | --- | --- |
| H-07 | external | verify: the per-unit table names each unit alias, SKU and assigned operator. |
| H-26 | external | verify: Settings › Eliza Cloud account & plan shows the plan on each unit. |
| H-27 | external | verify: grant and revoke readback with receipt IDs. |
| H-28 | external | verify: provider rows, delivery reports and role readback on a unit. |
| H-29 | external | verify: the runbook's password provider row. |

`external` means the outcome is recorded outside this repository: the status script has no check
for these five steps and prints their Verify line. It will keep printing `external` after they are
done; closing #675 is judged from the filled per-unit table and the verification records, not from
the status script.

## Decisions for the owner

| Question | Options | Documented default | What each choice changes |
| --- | --- | --- | --- |
| Who holds each unit's Eliza Cloud account? | (a) the target user signs in with an account the owner designates; (b) the operator holds all four | None documented. H-26 says "designated" | (a) target users see their own plan and sign-in, closer to user acceptance, but the operator needs them present for sign-in and sign-out checks; (b) the operator can run every check alone, but H-34 user acceptance then rests on accounts the users do not own |
| Plan source per unit | bought plan or Cloud grant code | Either (H-26); the owner chooses the grant term | A grant code needs the Cloud operator to mint it and hand it over directly; a bought plan needs a payment method and exercises billing |
| Grant term | `--duration-months <n>` | Owner's choice (H-26) | Must cover the whole pilot including H-34; an expiry during the pilot exercises expiry but interrupts journeys |
| Whether a live Gmail send happens at all | (a) no live send, synthetic only; (b) one authorized send | No live send until the owner writes recipient and message (H-27) | (a) real-send acceptance for AP-09 stays open; (b) closes it for that one message only |
| Proton Pass | include or skip | Optional (H-29) | Skipping leaves the third-party provider path unaccepted; the integrated vault is still required |
| Telephony scope | SIM in every unit, or only the designated telephony unit | Every image unit (H-28) | Fewer SIMs means multi-unit telephony journeys cannot run; the per-unit table must say which unit carries telephony |

## Remaining human steps

1. Owner fills the role table and the per-unit table with handles and hardware values, and merges
   the per-unit rows into the pilot runbook in a reviewed change (H-07).
2. Owner and Cloud operator provide the four Cloud accounts and plans and the benchmark accounts
   (H-26); the operator verifies the plan in Settings on each unit.
3. Owner provides the Google test account and, if a live send is wanted, writes the exact recipient
   and message (H-27).
4. Owner provides SIMs and owned endpoints (H-28) and the password test resources (H-29).
5. Each verification is recorded under its own evidence class, without credentials.

## Draft decision entries

Drafts for `docs/decisions.md`; the owner assigns numbers and dates when recording them. Policy is
not evidence.

- **P-NN — H-07 ([#675](https://github.com/eliza-research/alphaphone/issues/675)):** The pilot roles are operator `<handle>`, reviewer `<handle>` (not the operator), support owner `<handle>`, rollback owner Shaw (P-16), release owner `<handle>`; the cohort is four target users `<handles>` on four Pixel 10a (`stallion`) units `unit-a` to `unit-d`. Handles map to people only in the owner's private records.
- **P-NN — H-26 ([#675](https://github.com/eliza-research/alphaphone/issues/675)):** Each pilot unit uses a designated Eliza Cloud account held by `<target user | operator>` with a `<bought | granted>` plan; grant terms are `<n>` months.
- **P-NN — H-27 ([#675](https://github.com/eliza-research/alphaphone/issues/675)):** `<No live Gmail send in the pilot | One live send to the recipient and message recorded in the owner's private note of <date>>`.
