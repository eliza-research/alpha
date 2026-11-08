# #681 Eliza-side product questions raised by the shared Alpha components

Owner prep for [#681](https://github.com/eliza-research/alphaphone/issues/681): five elizaOS product
decisions (four in the issue, plus the Clock item in the 2026-10-28 comment). Alpha is unaffected
by every answer. Each one would be implemented upstream in elizaOS/eliza, never by editing
`vendor/eliza`. The comparison below reads the vendor/eliza pin `1f2a922f86` read-only.

Evidence class: source reading only. No Eliza app, APK, image or device was built or run.

## Summary

| # | Question | Eliza today (pin `1f2a922f86`) | Alpha today | Documented default |
| --- | --- | --- | --- | --- |
| 1 | Reset app data in the Eliza app | Android app does not host `DataReset`. Desktop has an App-menu "Reset App…" flow (`packages/app/src/runtime/desktop/DesktopTrayRuntime.tsx`). | Only host of the shared `reset.DataReset` coordinator (P-25 confirmed reset) | none recorded; Alpha stays the only host until decided |
| 2 | Eliza Android sign-in | hosted Cloud sign-in with PKCE through a Custom Tab (Play) or the app's own WebView task (pinned launcher): `packages/ui/src/android-cloud/android-cloud-auth.ts` | shared native `CloudSignInPlugin` (email/SMS code, native Google) from `packages/auth/android` | none recorded |
| 3 | Eliza SMS gateway | `ElizaSmsGatewayService` posts each incoming SMS to Cloud and sends Cloud's `replyText` back automatically with `SmsManager.sendTextMessage`, with no review step. `ElizaRespondViaMessageService` handles RESPOND_VIA_MESSAGE. | shared reviewed SMS-role components (`plugin-native-messages`: `TelephonyPlugin`, `SmsRoleConfiguration`, a reviewed native send dialog) | none recorded |
| 4 | Eliza image privilege profile | generic Eliza products (`eliza_cf_*`, `eliza_gsi_*`, `eliza_grizzly_phone` through `vendor/eliza/eliza_common.mk`) install Eliza as a **privileged** system app with privapp permissions and preassign the dialer and SMS roles. The Pixel 10a Eliza product (`packages/os/android/products/pixel10a-eliza.json`) already uses the shared nonprivileged-launcher composition (`hardware-targets.json` note). | nonprivileged launcher; only the isolated listener is privileged (P-40) | none recorded |
| 5 | Clock capability | `SlotClockPlugin` builds `ClockHostClient` with `AlarmMetadata`, so it advertises its own alarm store `clock.alarms.v1` (`ElizaAlarms`, `ElizaAlarmReceiver`, ringing activity and service) | handoff only: `clock.handoff.v1`, plus `clock.handoff.v2` with repeat days, via `clockHandoffCapabilities` (P-17) | none recorded; brands differ (`docs/architecture.md`) |

**Finding for item 4:** part of the question is already settled upstream. The Pixel 10a Eliza
product composes the nonprivileged launcher. The open decision is about the other Eliza products:
Cuttlefish, GSI and grizzly.

## Decisions for the owner

### 1. Reset in the Eliza app

- **A. Alpha stays the only host (status quo).** No change.
- **B. Eliza's Android app hosts `DataReset`.** Upstream PR outline: in `packages/app/platforms/android`,
  build one `DataReset.builder("eliza-data-reset", ElizaDataResetRecoveryActivity.class)` and run its
  pending-reset check (`admitBeforeStartup`) from the Application before providers. Register a
  `DataResetPlugin` subclass and add the recovery activity in its own provider-free process.
  Optional `beforeDispatch` revokes the device's Cloud sign-in. Add a Settings entry wired to
  `plugins/plugin-native-system/src/reset.ts` (`review()`), and a JVM test plus an instrumentation
  test that mirror Alpha's reset wiring. Decide how the desktop "Reset App…" and Android copy line
  up (`DataResetCopy`).

### 2. Native sign-in in Eliza's Android app

- **A. Keep hosted Custom Tab PKCE** for `ai.elizaos.app`. No change. Eliza keeps one login code
  path with web and desktop.
- **B. Move to the shared native `CloudSignInPlugin`.** Upstream PR outline: subclass
  `CloudSignInPlugin` in `packages/app/platforms/android` with a `CloudSignInConfig` (App Auth
  client id, device and product names, Steward client for native Google, admitted deployments,
  installed storage names) and its `CloudCredentialSlots`. Admit staging only in development
  builds. Use `@elizaos/auth/auth/native-cloud-sign-in` in the renderer in place of
  `android-cloud-auth.ts` on Android. Keep a migration that reads an existing hosted-login
  credential, so signed-in users are not signed out. Run `bun run --cwd packages/auth test:native-android`.
- **C. Both:** native first, hosted Custom Tab as a fallback. This keeps the larger surface.

### 3. Eliza SMS gateway auto-reply

- **A. Keep the auto-reply gateway** on Eliza's host. No change. Note: replies go out without the
  owner seeing them first.
- **B. Move Eliza onto the shared reviewed SMS-role components and drop auto-reply.** Upstream PR
  outline: subclass `ai.eliza.plugins.messages.TelephonyPlugin` with a `SmsTelephonyConfiguration`
  and register the shared SMS-role components through `SmsRoleConfiguration`. Delete
  `ElizaSmsGatewayService`, `ElizaSmsReceiver` and `ElizaRespondViaMessageService`, and their
  entries in `install-android-sms-gateway.ts`, `cloud-policy.ts`, `overlay.ts` and
  `source-audit.ts`. Cloud's reply becomes a draft the owner reviews.
- **C. Shared components plus an opt-in auto-reply policy:** a reviewed, owner-enabled
  "auto-reply" setting with its own consent and an audit trail. The shared core then gains a policy
  hook, and Alpha keeps it off.

### 4. Eliza images privilege profile

- **A. Keep the privileged generic Eliza images** (Cuttlefish, GSI, grizzly). No change. Pixel 10a
  is already nonprivileged.
- **B. Adopt the nonprivileged-launcher profile on every Eliza image.** Upstream PR outline: compose
  `eliza_cf_*`, `eliza_gsi_*` and `eliza_grizzly_phone` from the same nonprivileged-launcher
  product that Pixel 10a uses, instead of `eliza_common.mk`'s `priv-app` install and
  `privapp-permissions-ai.elizaos.app.xml`. Move each privileged need in
  `manifests/aosp-assistant-full-control.json` (app ops, accessibility, privileged permissions) to a
  narrow companion like Alpha's listener, or drop it. Update `validate.ts` and `boot-validate.ts`.
  Item 3 and the role defaults (`config_defaultDialer`/`config_defaultSms`) interact with this.

### 5. Clock capability in Eliza's app

- **A. Keep Eliza's own alarm store** (`clock.alarms.v1`). The two brands keep advertising
  different capabilities.
- **B. Move Eliza to handoff only (P-17 policy), with one of three choices for existing
  `ElizaAlarms`:**
  - B1 migrate: hand each saved alarm to Android Clock once, through the reviewed handoff, then
    delete the store;
  - B2 keep read-only: show saved alarms, schedule no new ones, offer handoff;
  - B3 hand off and stop: stop ringing, show a one-time notice that lists the alarms to recreate in
    Clock.
  Upstream PR outline: construct `ClockHostClient` without `AlarmMetadata` in `SlotClockPlugin`, so
  it advertises `clock.handoff.v1,clock.handoff.v2` only. Implement the chosen `ElizaAlarms`
  path, then remove `ElizaAlarmReceiver`, `ElizaAlarmRingingActivity`, `ElizaAlarmRingingService`
  and `ClockOwnedAlarms` once no alarm depends on them. Update `ElizaAlarmsInstrumentedTest`,
  `packages/app/README.md` and `docs/architecture.md`'s brand note.

## Draft decision entries

These belong in the elizaOS repository's decision record, or in a comment on #681. Alpha's
`docs/decisions.md` needs no entry, because Alpha is unchanged. A dated tracking line is optional.

- **E-__ (reset)** (owner, 2026-__-__): Eliza's Android app [does not host | hosts] the shared
  DataReset coordinator.
- **E-__ (sign-in)** (owner, 2026-__-__): Eliza's Android app signs in with [hosted Custom Tab PKCE |
  the shared native CloudSignInPlugin | native with hosted fallback].
- **E-__ (SMS)** (owner, 2026-__-__): Eliza's SMS handling [keeps automatic gateway replies | uses
  the shared reviewed SMS-role components without auto-reply | uses the shared components with an
  opt-in auto-reply policy].
- **E-__ (images)** (owner, 2026-__-__): Eliza's non-Pixel images [stay privileged | adopt the
  nonprivileged-launcher profile].
- **E-__ (clock)** (owner, 2026-__-__): Eliza's app [keeps clock.alarms.v1 | moves to handoff only],
  and existing ElizaAlarms are [migrated | kept read-only | handed off].

## Remaining human steps

1. Reply on #681 per item (1 to 5), or record the decisions in the elizaOS repository.
2. An agent then opens the matching upstream PR in elizaOS/eliza from the outline above. Alpha
   changes nothing, and no pin move is needed unless shared code changes.
