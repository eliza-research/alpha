# #677 Pixel 10a device pilot: provisioning, journeys, voice, accessibility and acceptance (H-32 to H-34)

Owner preparation for [#677](https://github.com/eliza-research/alphaphone/issues/677) and
[human actions](../human-actions.md) H-32, H-33 and H-34. The procedure itself is the
[pilot acceptance runbook](../pilot-acceptance-runbook.md); this page turns it into a per-unit
checklist, blank unit records, a prerequisite tracker, the voice-trial export layout and the H-34
reviewer guide and acceptance form. Nothing here was run on a unit and nothing here is evidence.

Evidence classes stay separate in every record: an APK build, an emulator HOME-role test, a full
AOSP image boot, a real integration, device acceptance and user acceptance. A cell names exactly
one class. A provisioning record is not acceptance of any journey.

Prepared on this branch:

- `node scripts/owner/voice-trial-export.mjs extract|check|dry-run` and
  `test/owner-voice-trial-export.test.mjs` (voice-trial layout and a dry run of the aggregator).

## Prerequisite tracker

Each journey can start only when the HUMAN issues on its row are closed. Rows are in the order the
pilot needs them.

| Prerequisite | Human action | Blocking issue | Needed by |
| --- | --- | --- | --- |
| Roles, cohort, four units | H-07 | [#675](https://github.com/eliza-research/alphaphone/issues/675) | everything below |
| Cloud accounts and plans | H-26 | #675 | sign-in, plan, agent, digest, every Cloud journey |
| Google test account; written live-send authorization | H-27 | #675 | Gmail, Calendar Google sync, digest with real mail |
| SIMs and owned endpoints | H-28 | #675 | telephony |
| Password test vault and test site | H-29 | #675 | password save/fill |
| Release key custody, ceremony, public identities | H-01, H-08, H-09 | [#661](https://github.com/eliza-research/alphaphone/issues/661) | any release-signed APK or image |
| Distributable release APKs, both variants | H-10 | [#662](https://github.com/eliza-research/alphaphone/issues/662) | provisioning (`provision-unit.mjs` refuses anything else) |
| On-device voice host admitted | H-18 | [#663](https://github.com/eliza-research/alphaphone/issues/663) | a distributable H-10 build; on-device speech; voice trials |
| Always-on listener qualified | H-20 | [#664](https://github.com/eliza-research/alphaphone/issues/664) | listening controls; production image staging |
| Catalog, plan limits, Maps allowance | H-02, H-03, H-04 | [#665](https://github.com/eliza-research/alphaphone/issues/665) | plan admission and expiry; every Maps request |
| Cloud subscription, sign-in, entitlement operations | H-11, H-12, H-14, H-15 | [#666](https://github.com/eliza-research/alphaphone/issues/666) | sign-in by email/SMS/Google, code redemption, plan admission/expiry/revocation |
| Maps provider, coverage and Cloud Maps | H-05, H-16 | [#667](https://github.com/eliza-research/alphaphone/issues/667) | Maps, J04, GPS navigation |
| Google OAuth production client and consent screen | H-17 | [#668](https://github.com/eliza-research/alphaphone/issues/668) | Gmail and Calendar Google sync on a production build |
| Release-signed native Google sign-in client | H-12 | [#669](https://github.com/eliza-research/alphaphone/issues/669) | Google sign-in on the release build |
| App Links on eliza.app | H-13 | [#670](https://github.com/eliza-research/alphaphone/issues/670) | verified App Links check |
| Development inference key (emulator rehearsal only) | H-30 | [#671](https://github.com/eliza-research/alphaphone/issues/671) | emulator redaction campaign; never on a pilot unit |
| Production image staged, signed, Cuttlefish boot | H-21, H-22, H-23 | [#672](https://github.com/eliza-research/alphaphone/issues/672) | telephony on the image, InCallService, MMS, image journeys |
| Image flashed to units; update and recovery drills | H-24, H-25 | [#673](https://github.com/eliza-research/alphaphone/issues/673) | every image-unit journey; signed update |
| Emulator campaigns at the candidate | H-31 | [#676](https://github.com/eliza-research/alphaphone/issues/676) | not a gate for device journeys, but each device result is reported beside its class E result |
| Product defaults confirmed | H-37 | [#660](https://github.com/eliza-research/alphaphone/issues/660) | final Settings copy and Notes storage of the pilot build |
| Licence obligations reviewed | H-35, H-06 | [#674](https://github.com/eliza-research/alphaphone/issues/674) | distribution with reviewed obligations |
| Owner per-view approval and Seeker review | H-38 | [#678](https://github.com/eliza-research/alphaphone/issues/678) | H-34 (unblocked by H-38) |

## Per-unit pilot checklist

Run on each of `unit-a` to `unit-d` with the release launcher selected as HOME, unless a line names
a designated unit. Each line records: UTC start/end, operator handle, exact APK/image identity,
route, expected, observed, evidence path, and the evidence class (device unless stated). A failure
or skip is recorded, never retried as a write.

### 1. Provision and record the release (H-32)

- [ ] Owner consent to the exact provisioning/reset of this unit recorded (date only).
- [ ] `node scripts/provision-unit.mjs --serial <serial> --alias <unit> --apk-manifest <release build>/apk-manifest.json --home-wait-ms 120000`;
  the operator makes the Home choice. Record `test-results/pilot-units/<unit>.json` (serial and
  fingerprint as SHA-256 only).
- [ ] After all four units carry the release: release owner runs
  `node scripts/record-release.mjs --apk-manifest <release build>/apk-manifest.json` (dry run), then
  the same with `--write`, in a reviewed commit. From then on that versionCode is refused.
- [ ] In-place update on a designated unit: `node scripts/pilot-update.mjs --serial <serial> --alias <unit> --apk-manifest <new build>/apk-manifest.json`
  (same signer, higher versionCode; release units read back package identity only).

### 2. Runbook journeys (every unit)

From [Execute on every unit](../pilot-acceptance-runbook.md#execute-on-every-unit):

- [ ] Boot and design (unedited recording plus screen inventory).
- [ ] Resident startup and chat (runtime identity, typed and spoken requests, context reaches the
  intended conversation; hosted Cerebras inference disclosed).
- [ ] Lifecycle and recovery (background, lock, network loss, kill, runtime restart and stop, reboot).
- [ ] Distribution has no mock surfaces (plus `node scripts/verify-apks.mjs` output for the exact APK).
- [ ] Speech and Notes; Calendar; Reminders; Clock; Workflows and results; Browser and passwords;
  Files, capture, photos and Maps; Settings and notifications; Email.
- [ ] Wrong-owner, revoked permission, stale target and lost-response cases on designated fixtures.

### 3. Journeys and device checks gathered from cycle-1 workstreams (#677 step 2)

- [ ] Sign-in by email, SMS and Google with a real account; code redemption; plan admission, expiry,
  revocation; account isolation. (#666, #669)
- [ ] Resident agent restart, history and missed runs; real Eliza Cloud inference; J05-9 (agent
  answers from the reviewed browser excerpt).
- [ ] Daily overview with real Gmail, CalendarProvider and scheduled-digest transitions through
  native delivery to the brief card. (#668)
- [ ] Gmail send/draft/Undo, read state; Calendar local-first plus Google sync; a solo create. A live
  send only for the recipient and message the owner wrote down (H-27).
- [ ] Telephony on the image (designated SIM unit): reviewed SMS send with delivery reports,
  multi-SIM, incoming SMS/MMS via carrier MMSC/APN, MMS send confirmation, InCallService, Contacts
  editor handoff. No emergency calls. (#672, #673, H-28)
- [ ] Camera/Photos/Files with real camera input and documents; J01 poster to calendar; J03 document
  analysis.
- [ ] Maps: live route checks, J04, GPS navigation with local TTS. (#667)
- [ ] Password real-site save and fill on a signed build (integrated vault; Proton Pass if provided).
- [ ] Home in landscape and with large text; Settings reset on a disposable fixture only; Quick
  Settings tile.

### 4. Designated-unit runs

- [ ] [Upgrade from earlier mock state](../pilot-acceptance-runbook.md#upgrade-from-earlier-mock-state)
  on one designated unit (the emulator half is #676).
- [ ] Resident redaction probes on one designated unit (synthetic contact and credential fixtures;
  leak booleans only).
- [ ] Signed update N to N+1 with real data, then the approved recovery drill (#673, H-25).

### 5. Voice, soak and accessibility (H-33)

- [ ] At least 50 successful voice trials per cohort, including at least 20 warm and 5 cold, last
  spoken input to first audible reply (P-11), on release builds from a clean tree, arm64-v8a, for
  each distribution variant (see the layout below).
- [ ] Full-duplex VAD, barge-in, audio focus and call coexistence.
- [ ] Physical loopback measurement of audible start on the target device.
- [ ] Battery and thermal soak on the exact release image (crashes, ANRs, missed deliveries with
  elapsed time and conditions).
- [ ] TalkBack, Switch Access, physical large font, rotation, gesture navigation, process death,
  full storage and repeated Home on every retained view.

## Blank unit records

One record per unit, kept private while it contains anything beyond aliases and hashes; the
redacted copy is committed under `docs/evidence/pilot/<unit>.md`. No field takes a credential,
phone number, email address, serial or account identifier.

```markdown
# Pilot unit record: unit-a

| Field | Value |
| --- | --- |
| Unit alias | unit-a |
| Model / codename / SKU / hardware revision | Pixel 10a / stallion / <sku> / <rev> |
| Android image and build fingerprint SHA-256 | <image name> / <sha256 from provision record> |
| Operator handle / reviewer handle | <operator-handle> / <reviewer-handle> |
| App commit / APK SHA-256 / signer SHA-256 / versionCode | <sha> / <sha256> / <sha256> / <code> |
| OS image SHA-256 / runtime manifest SHA-256 | <sha256> / <sha256> |
| Provision record | test-results/pilot-units/unit-a.json (<sha256>) |
| HOME role holder after provisioning | <package> |
| Eliza Cloud plan shown in Settings | <plan name and expiry, no code> |

| Journey / check | Evidence class | UTC start–end | Expected | Observed | Evidence path | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Boot and design | device | | | | | not run |
| Resident startup and chat | device | | | | | not run |
| Lifecycle and recovery | device | | | | | not run |
| Distribution has no mock surfaces | APK build + device | | | | | not run |
| Speech and Notes | device | | | | | not run |
| Calendar | device / real integration | | | | | not run |
| Reminders | device | | | | | not run |
| Clock | device | | | | | not run |
| Workflows and results | device | | | | | not run |
| Browser and passwords | device / real integration | | | | | not run |
| Files, capture, photos and Maps | device / real integration | | | | | not run |
| Settings and notifications | device | | | | | not run |
| Email (Gmail) | real integration | | | | | not run |
| Sign-in, code redemption, plan admission/expiry/revocation, isolation | real integration | | | | | not run |
| Resident restart/history/missed runs; Cloud inference; J05-9 | device / real integration | | | | | not run |
| Daily overview and scheduled digest | real integration | | | | | not run |
| Telephony on the image (designated unit) | image + real integration | | | | | not run |
| Camera/Photos/Files real input; J01; J03 | device | | | | | not run |
| Maps live routes; J04; GPS navigation with local TTS | real integration | | | | | not run |
| Password real-site save and fill | real integration | | | | | not run |
| Home landscape and large text; reset (fixture); QS tile | device | | | | | not run |
| Voice trials (cohorts in summary.json) | device | | | | voice-trials/summary.json | not run |
| Soak (battery/thermal) | device | | | | | not run |
| TalkBack, Switch Access, large font, rotation, gestures, process death, full storage, repeated Home | device | | | | | not run |
| Upgrade from earlier mock state (designated unit) | device | | | | | not run |
| Resident redaction probes (designated unit) | device | | | | | not run |
| Signed update N→N+1 and recovery drill (designated unit) | image + device | | | | | not run |
```

Copy it for `unit-b`, `unit-c` and `unit-d`. The four Status cells of the
[per-unit evidence record](../pilot-acceptance-runbook.md#per-unit-evidence-record) change from
"not run" only when every row of that unit's record has a result.

## Voice-trial export layout

Settings › Export diagnostics writes an `alpha-diagnostics/v1` report; its `nativeVoiceTiming`
member is the `alpha-native-voice-timing-v3` export. **Passing the diagnostics report directly to
`scripts/aggregate-voice-latency.mjs` exits 1** (it is not a timing export); extract the member
first:

```sh
node scripts/owner/voice-trial-export.mjs extract <diagnostics.json> --unit unit-a --variant launcher --session 20261105T1430Z --root voice-trials
node scripts/owner/voice-trial-export.mjs check --root voice-trials
node scripts/aggregate-voice-latency.mjs voice-trials/*/*/*.native-voice-timing.json --out voice-trials/summary.json
```

Layout: `voice-trials/<unit-a…d>/<launcher|standalone>/<yyyymmddThhmmZ>.native-voice-timing.json`,
plus `voice-trials/summary.json`. `extract` copies only the timing member (no connection, account or
permission data from the report) and refuses to overwrite a file. `check` reports, per aggregator
cohort, how many passed, warm and cold trials it still needs, and flags a trial whose `build` does
not match its directory.

How the aggregator groups trials (read from `scripts/native-voice-latency.mjs`), which decides how
many trials the pilot needs:

- A cohort is one combination of source commit, dirty state, engine SHA-256, model SHA-256, device
  model string, environment, ABI, build (for example `launcher-release`) and network. The unit alias
  is not part of it: trials from four units with the same model string pool into one cohort.
- Only `live-voice`, `device`, `arm64-v8a`, a `-release` build, a clean tree, AudioRecord capture
  timestamps, a platform audible timestamp and linked v3 turns can be an acceptance candidate.
  x86_64 and emulator trials are diagnostic: "both ABIs" in H-33 can be device acceptance only on
  arm64-v8a (the Pixel 10a ABI); x86_64 results are emulator diagnostics.
- Exit 0 needs **every** acceptance cohort sufficient and within budget, so each distribution
  variant and each network condition present needs its own 50 trials (20 warm, 5 cold). Any invalid
  or conflicting record anywhere blocks exit 0.

Dry run on this branch (`node scripts/owner/voice-trial-export.mjs dry-run`, synthetic fixtures of
the shape `test/native-voice-latency.test.mjs` uses; not evidence):

| Case | Expected exit | Observed |
| --- | --- | --- |
| Sufficient device cohort, both variants (50 each) | 0 | 0 |
| Emulator only | 2 | 2 |
| One variant one trial short of 50 | 2 | 2 |
| Over the six-second budget | 3 | 3 |
| Diagnostics report passed unextracted | 1 | 1 |

## H-34 Reviewer reproduction guide

The reviewer is not the operator (#675). The reviewer works only from the published guides and the
recorded release manifest; the operator does not help beyond handing over a unit and accounts.

1. Read [README](../../README.md) (Setup), [operational hand-off](../operational-handoff.md) and the
   [pilot acceptance runbook](../pilot-acceptance-runbook.md). Note every step that was unclear or
   wrong; that list is part of the result.
2. From a clean checkout at the release commit, confirm the source identity: `upstream.lock.json`,
   the release APK SHA-256 and signer in the recorded `apk-manifest.json`, and `lastRelease` in
   `android/release-signer.json`. Run `npm run human:status` and record its output.
3. Reproduce setup on a designated unit or a disposable unit the owner assigns: provision with
   `scripts/provision-unit.mjs` (or confirm the existing provision record matches the manifest),
   select Alpha as Home, sign in with the account assigned for review.
4. Run one complete journey end to end without help, chosen by the owner from the per-unit checklist
   (recommended: voice request → note → calendar event, J02, with the Home brief card afterwards).
5. Record an unedited demonstration of at least five minutes on the physical unit, without private
   content: synthetic accounts and data only, notifications from other apps silenced. No cuts.
6. Fill the acceptance form below. Then the target users and stakeholders record theirs.
7. Only after every other gate: the release owner records the `userAcceptance` gate in
   `android/aosp/pixel10a-qualification-gates.json` (`status: "passed"` needs a release-level
   evidence entry) in a reviewed commit, and `npm run human:status` shows H-34 done.

## Acceptance form (one per person)

```markdown
# Acceptance record: <reviewer | target user | stakeholder> <handle>

| Field | Value |
| --- | --- |
| Role | reviewer / target user / stakeholder |
| Handle | <handle, no personal data> |
| Date (UTC) | <yyyy-mm-dd> |
| Release accepted | versionName <name>, versionCode <code>, APK SHA-256 <sha256>, image SHA-256 <sha256> |
| Unit alias used | unit-a … unit-d |
| Guides followed (reviewer) | README Setup, operational hand-off, pilot runbook: <yes / steps that failed> |
| Journey performed | <name> |
| Demonstration video | <path or reference>, length <mm:ss>, unedited: <yes/no>, private content: none |
| Open defects at acceptance | <issue numbers or none> |
| P0/P1 open | <none / list> |
| Decision | accept / accept with listed defects / reject |
| Scope changes accepted (each needs a dated P- entry) | <none / list> |
| Statement | "I accept this exact release for the pilot as described above." (or the reason for rejection) |
```

No signature image, email address, phone number or account identifier goes into the record.

## Decisions for the owner

| Question | Options | Documented default / recommendation | What each choice changes |
| --- | --- | --- | --- |
| Voice cohort granularity | pool all four units per variant (aggregator default); or 50 trials per unit | The aggregator pools by device model string; the runbook says "per source/model/device/environment cohort" | Pooling needs 50 trials per variant and network; per-unit needs 200+ per variant and shows unit-to-unit variation |
| Network conditions to qualify | Wi-Fi only; Wi-Fi and cellular | Not set | Each network value is its own cohort and needs its own 50 trials for exit 0 |
| Which unit is designated for telephony, mock-state upgrade, redaction probes and the update drill | any one unit; spread across units | Not set | One designated unit concentrates destructive steps; spreading means more units carry non-pilot state |
| Live Gmail send | none; one authorized message | None until written authorization (H-27) | Without it real-send acceptance for AP-09 stays open |
| The H-34 journey | J02 (recommended), J01, J03, J04, J05 | "a complete journey" | Determines which integrations must be ready before H-34 can start |
| Soak definition | duration, screen state and workload | "an agreed battery/thermal/background soak" | Needs a written number before the soak starts, or the result cannot pass or fail |

## Remaining human steps

1. Close the prerequisites in the tracker (at minimum #675, #661, #662, #663, #666 and, for image
   journeys, #672 and #673).
2. Operator provisions each unit, runs the per-unit checklist and fills the four unit records.
3. Release owner records `lastRelease` (dry run, `--write`, reviewed commit).
4. Operator collects voice trials into the layout, runs `check`, then the aggregator; it must exit 0
   on device evidence. Loopback, soak and accessibility checks are recorded separately.
5. Reviewer reproduces setup and a journey, records the unedited demonstration, and fills the form;
   target users and stakeholders fill theirs; the `userAcceptance` gate is recorded last.

## Draft decision entries

Drafts for `docs/decisions.md`; the owner assigns numbers and dates.

- **P-NN — H-33 ([#677](https://github.com/eliza-research/alphaphone/issues/677)):** Voice acceptance cohorts are `<pooled across units per distribution variant | per unit>` and qualified on `<Wi-Fi | Wi-Fi and cellular>`; each needs at least 50 successful trials (20 warm, 5 cold) on arm64-v8a release builds. x86_64 results are emulator diagnostics only.
- **P-NN — H-33 ([#677](https://github.com/eliza-research/alphaphone/issues/677)):** The soak is `<duration>` with `<screen state, workload>`; it fails on any crash, ANR or missed delivery.
- **P-NN — H-34 ([#677](https://github.com/eliza-research/alphaphone/issues/677)):** The reviewer reproduces `<journey>` on `<unit>`; acceptance is recorded per person on the form in this runbook.
