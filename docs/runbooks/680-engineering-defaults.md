# #680 Open Alpha engineering choices: missed-run window, Run now scope, dev host, default roles, field updates

Owner prep for [#680](https://github.com/eliza-research/alphaphone/issues/680). For each default
this page gives the code that implements it, what each option would change, a draft P- entry and a
PR outline. It changes no product code. The draft entries take the next free P- number in
`docs/decisions.md` (the highest today is P-56) once the owner answers on the issue.

Evidence class: source reading at `main` 94676c82 and the vendor/eliza pin `1f2a922f86`
(read-only). Nothing here was run in an APK, an emulator, an image or on a device, and no image
role assignment or OTA was observed.

## Read-only findings the owner should know first

1. **Three 120-second windows, with two different rules.** Upstream has
   `SCHEDULED_OCCURRENCE_WINDOW_MS` (core, generic schedules), `PHONE_SCHEDULE_ADMISSION_WINDOW_MS`
   (contracts, typed phone schedules) and `DIGEST_RUN_WINDOW_MS` (plugin-workflow, resident digests).
   Each is 120,000 ms. Generic schedules count as missed only when the occurrence is more than
   120 s late **and** came due before the agent process started
   (`isMissedScheduledOccurrence`): a Doze delay while the agent runs still runs. Typed schedules
   and digests count as missed whenever they are more than 120 s late, even while the agent was
   running. So under P-14's honest Doze delays, a typed or digest occurrence delayed more than
   2 minutes by Doze is recorded as missed, but a generic one is not. The owner's answer should say
   whether the window is lateness alone or "agent was not running".
2. **Run now scope differs from the issue text.** The issue says Run now is offered for "missed
   typed and generic scheduled occurrences". In source, the Workflows receipt offers the missed-run
   action only for a **typed** scheduled workflow (`missedRunNow` in
   `apps/app/src/prototype/workflow-adapter.ts` requires `scheduledPhoneTrigger`).
   `test/browser/workflow-missed-run-now.spec.ts` asserts that a **generic** missed receipt does
   **not** offer it. Scheduled digests offer their own reviewed Run now (`missedRunNowOffers`,
   upstream `plugins/plugin-workflow/src/client/hosted-digests.ts`), only for the newest missed
   result of an active **morning** digest over a current source. Overlap ("an earlier run was still
   active") never offers it, as the issue says.
3. **The image already preassigns three roles, not dialer or SMS.** Alpha's production staging
   (`scripts/stage-aosp.mjs --production`, upstream `launcher-provisioning.mjs`) writes default HOME
   (preferred-apps), `config_defaultAssistant` and `config_defaultAutofillService`. Dialer and SMS
   are not preassigned. Eliza's own generic image overlay does preassign them to `ai.elizaos.app`
   (`packages/os/android/vendor/eliza/overlays/frameworks/base/core/res/res/values/config.xml`).
   Alpha's dialer and SMS role components ship **disabled** and are enabled at runtime only after
   `AlphaImageCapability` verifies the image (`AlphaTelephonyRoles.sync`). A boot-time
   `config_defaultDialer` naming Alpha would point at disabled components on first boot. Preassigning
   therefore also needs a role re-evaluation after the components are enabled; see option 4B.
4. **Neither update mode exists on the device today.** The only update path is the operator client
   `scripts/aosp-ota-update.mjs` (shared `packages/os/scripts/android/aosp-ota-update.mjs`): ADB
   sideload through stock recovery, with `--execute --confirm-update` on the operator's host. The
   channel `android/aosp/pixel10a-ota-channel.json` has `otaCertificateSha256`, `avbPublicKeySha256`
   and the known-good release `UNSET`, and every drill "not run". Both a user-confirmed on-device
   update and an unattended one need an on-device `update_engine` client. No such client exists in
   Alpha or at the pin.

## Decisions for the owner

### 1. Missed-occurrence window (P-10 vs P-14 Doze)

- **Default:** 120 s. A scheduled run that reaches the agent more than 120 s late is recorded once
  as missed and not run late.
- **Code:**
  - vendor `packages/core/src/services/trigger-scheduling.ts`: `SCHEDULED_OCCURRENCE_WINDOW_MS`
    and `isMissedScheduledOccurrence` (generic).
  - vendor `packages/contracts/src/phone-workflow.ts`: `PHONE_SCHEDULE_ADMISSION_WINDOW_MS`, used
    by `plugins/plugin-workflow/src/services/phone-workflow-spec.ts` (`typedScheduleAdmission`) and
    `embedded-workflow-service.ts` (`settleLateScheduledStart`).
  - vendor `plugins/plugin-workflow/src/services/hosted-digest-policy.ts`:
    `DIGEST_RUN_WINDOW_MS` and `digestOccurrenceMissed`.
  - The policy is switched on by `ELIZA_MISSED_SCHEDULED_OCCURRENCES=record` in vendor
    `packages/app/src/runtime/native-runtime-profile.ts`.
  - Alpha: `apps/app/src/browser/development-digest-occurrence.ts` re-exports the digest window
    for the development scheduler, in test-mocks builds only.
- **Options:**
  - A. Confirm 120 s, keeping the split rule as it is.
  - B. Confirm 120 s with one rule: "agent was not running". Typed schedules and digests also run
    a Doze-delayed occurrence late. This matches P-14 best.
  - C. Another window, for example 10 minutes, on all three constants.
- **What changes:** A changes nothing. B and C are upstream changes; Alpha consumes them by
  moving the pin. Alpha's tests that encode 120 s (for example
  `test/workflow-typed-schedule.test.mjs`) follow the pin.

### 2. Run now on missed occurrences (P-10 "where useful")

- **Default (as implemented):** typed scheduled workflows get one reviewed new run from the
  missed receipt, through the two-step run confirmation. Morning digests get their own reviewed
  Run now. Generic schedules and overlap records get none.
- **Code:** `apps/app/src/prototype/workflow-adapter.ts` (`missedRunNow`, line 335;
  `scheduledPhoneTrigger`), `apps/app/src/runtime/hosted-digest-ui.tsx` (`missedOffers`),
  vendor `plugins/plugin-workflow/src/client/hosted-digests.ts` (`missedRunNowOffers`).
  Tests: `test/browser/workflow-missed-run-now.spec.ts`.
- **Options:**
  - A. Confirm the implemented scope.
  - B. Widen to generic scheduled workflows: `missedRunNow` also accepts a generic workflow with a
    schedule trigger, and the spec's `generic missed` case flips to expect the action.
  - C. Narrow to digests only: remove the typed receipt action.
- **Note:** the issue text describes option B as the default. The owner's answer should pick one
  explicitly.

### 3. Emulator development host

- **Default:** kept as a developer surface. It runs only with `ELIZA_DEV_ALLOW_TEST_MOCKS=1`, uses
  canonical action names and backs `agent:dev` and `agent:diagnostic`.
- **Footprint:** `scripts/dev-agent.mjs` ("Loopback-only emulator development chat"),
  `scripts/start-local-agent.mjs`, `scripts/configure-dev-agent.mjs` (`agent:configure-emulator`),
  `scripts/test-dev-agent.mjs`, `backend/runtime.ts`, `backend/proposal-action.ts`,
  `backend/loader.ts`, `backend/test-runtime.ts`, `backend/test-actions.mjs`,
  `apps/app/src/runtime/development-transport.ts`, `development-view-contract.ts`,
  `android/app/src/testMocks/java/ai/elizaresearch/alphaphone/DevelopmentAgentPlugin.java` (loaded
  by reflection from `MainActivity.java` line 285), `test/development-scope-flow.test.mjs`,
  `test/pinned-runtime-admission.test.mjs`, and the package.json scripts `agent:dev`,
  `agent:diagnostic` and `agent:configure-emulator`.
- **Options:**
  - A. Keep it as a developer surface. The audit's
    (`docs/unification-audit-2026-10-27.md` section 2) "exercise the same resident/device action
    service with a non-effecting executor" stays a follow-up.
  - B. Delete it. Remove the files above and the three scripts, then update `docs/agent-integration.md`,
    `docs/local-agent-development.md`, `docs/research-report.md` and
    `docs/remote-device-actions-plan.md`. Emulator chat then uses only the resident agent.
- **Check before B:** `npm run audit:bundle` must still pass. The production bundle excludes these
  files today. Live-provider development evidence must not be replaced by mocks (audit section 2).

### 4. Default role holders on the AOSP image (dialer, SMS)

- **Default:** not preassigned. The owner picks Alpha in Android's own role dialog after the image
  verifies.
- **Code:** `scripts/stage-aosp.mjs` (production provisioning overlay, line 300 onward),
  `scripts/aosp-provisioning-overlay.mjs`, vendor
  `packages/os/scripts/android/launcher-provisioning.mjs` (writes `config_defaultAssistant`,
  `config_defaultAutofillService` and the HOME preferred-apps entry),
  `android/app/src/launcher/java/ai/elizaresearch/alphaphone/AlphaTelephonyRoles.java`.
- **Options:**
  - A. Keep as is: user-chosen roles.
  - B. Preassign Alpha as dialer and SMS on production images. The shared
    `launcher-provisioning.mjs` gains opt-in `config_defaultDialer` and `config_defaultSms` lines
    (an upstream change, as for Eliza's overlay). The role components must qualify when
    RoleManager evaluates the defaults: either they are enabled on images at install, or Alpha
    asks for the role again after `AlphaTelephonyRoles.sync` enables them. `packages/os`
    `validate.ts` and `boot-validate.ts` already check these keys for Eliza images.
- **What B affects:** emergency and stock dialer behaviour (Telecom keeps emergency routing). As
  the SMS role holder, Alpha must store sent messages itself (`docs/architecture.md` telephony
  section). Image qualification also gains a role readback (`cmd role get-role-holders`).

### 5. Field updates

- **Default:** user-confirmed.
- **Code:** `scripts/aosp-ota-update.mjs` (operator client binding), vendor
  `packages/os/scripts/android/aosp-ota-update.mjs`, `android/aosp/pixel10a-ota-channel.json`,
  `scripts/sign-aosp-release.mjs`.
- **Options:**
  - A. Operator-assisted sideload only, for the pilot: what exists today.
  - B. User-confirmed on-device updates. This needs an on-device client that checks the signed
    channel, downloads the package, shows the version and asks the owner, then applies it through
    `update_engine` (A/B). It needs privileged access, so it is a second narrowly privileged
    component beside the listener, a new exception to "the main app stays nonprivileged".
  - C. Unattended updates. The same client as B, with policy for when to apply (charging, idle,
    Wi-Fi), and the drills: interrupted update, rollback, stock recovery.
- **Note:** the issue says only C needs an `update_engine` client; B needs one too.

## Draft decision entries

- **P-__ (missed window)** — #680 item 1 (owner, 2026-__-__): a scheduled occurrence that reaches
  the agent more than **120 s** after its scheduled time [only when the agent was not running at
  that time | regardless of whether the agent was running] is recorded once as missed and never run
  late (P-10). Generic, typed and digest schedules use the same rule.
- **P-__ (Run now)** — #680 item 2 (owner, 2026-__-__): Run now on a missed occurrence is offered
  for [typed scheduled workflows and morning digests | also generic scheduled workflows], as one
  new reviewed run behind the two-step confirmation. It is never offered for an occurrence skipped
  because an earlier run was still active.
- **P-__ (dev host)** — #680 item 3 (owner, 2026-__-__): the emulator development host
  (`scripts/dev-agent.mjs`, `agent:dev`, `agent:diagnostic`) [stays a test-mocks-only developer
  surface | is deleted].
- **P-__ (default roles)** — #680 item 4 (owner, 2026-__-__): production Alpha images [do not
  preassign | preassign Alpha as] the default dialer and SMS app. HOME, assistant and Autofill
  stay preassigned as today.
- **P-__ (field updates)** — #680 item 5 (owner, 2026-__-__): field updates are [operator-assisted
  for the pilot | user-confirmed on the device | unattended]. [For B and C: a narrowly privileged
  on-device update client applies signed channel packages through update_engine.]

## PR outlines for the alternatives

- **1B/1C (upstream elizaOS):** "Use one powered-on missed-occurrence rule for typed and digest
  schedules". Make `typedScheduleAdmission`, `settleLateScheduledStart` and
  `digestOccurrenceMissed` use `isMissedScheduledOccurrence`, or set one shared window constant.
  Update `missed-schedule-occurrence-e2e.test.ts` and the hosted digest tests. Alpha then moves the
  pin and updates `test/workflow-typed-schedule.test.mjs` and
  `apps/app/src/browser/development-digest-occurrence.ts` comments.
- **2B (Alpha):** "Offer reviewed Run now for missed generic scheduled workflows". `missedRunNow`
  accepts a generic workflow with an active schedule trigger, and
  `workflow-missed-run-now.spec.ts` flips its `generic missed` case to expect the action.
- **2C (Alpha):** "Offer Run now only for missed digests". Remove the typed receipt action and its
  spec cases.
- **3B (Alpha):** "Retire the emulator development host". Delete the files listed in item 3 and the
  three package scripts, then update the docs. Run `npm run verify` and `audit:bundle`.
- **4B (upstream, then Alpha):** "Opt-in dialer and SMS defaults in launcher provisioning".
  Upstream adds `roles: {dialer, sms}` options to `launcher-provisioning.mjs` and validate checks.
  Alpha passes them from `stage-aosp.mjs --production`, and either enables the role components on
  verified images at install or asks for the role after enabling them. It adds an image role
  readback to qualification.
- **5B/5C (upstream os, then Alpha):** "On-device signed update client". A privileged updater app
  with its own SELinux and permission review: channel check, download, verify, apply through
  update_engine, owner confirmation (B) or scheduled policy (C). Alpha then adds it to the image
  and runs the four channel drills.

## Remaining human steps

1. Reply on #680 for each item with the option letter, or confirm the default. For item 1, also
   say whether a Doze delay while the agent runs should still run (option B).
2. An agent then records the dated P- entries and opens the matching PRs from the outlines above.
   Upstream PRs go to elizaOS/eliza first. Alpha follows by moving the pin.
