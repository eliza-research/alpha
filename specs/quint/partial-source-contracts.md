# Retained partial-source contracts

These existing member-level tests execute authenticated source members inside bounded fixtures. They retain
unique behavior, effect, refusal, ownership and recovery checks. The separately listed current-worker
projection executes complete source files with a deliberately partial observation boundary.
Their evidence class is `partial-source-contract`: compiling selected members does not qualify the
surrounding source file or its reconstructed enclosing class. Do not add new source slices or treat
these receipts as whole-file implementation refinement.

Existing raw receipts may retain `bounded-component` or `bounded-orchestration` scope values.
Those values describe the recorded extent; this inventory and the actual source boundaries and
exclusions establish the partial-source classification. This documentation does not relabel
historical receipts.

Each owner preserves its recorded scenarios and checks source and driver inputs before and after
execution. Replacing a partial contract requires qualified coverage of its behavior. Pure source-text
assertions, model restatements and duplicate aggregate runners are not substitutes.

This is an inventory of retained partial contracts, not a claim that every other registered model
has complete source coverage. The family manifests still define the model checks and bounds.
Individual owning receipts define the finite implementation schedules and environmental assumptions.

## Native

| Model | Owning test | Driver |
| --- | --- | --- |
| `BatchCaptureCompletion` | [quint-batch-capture-completion.test.mjs](../../test/quint-batch-capture-completion.test.mjs) | [batch-capture-completion.mjs](refinement/native/batch-capture-completion.mjs) |
| `GoogleBrowserReturnClaim` | [quint-google-browser-return-claim.test.mjs](../../test/quint-google-browser-return-claim.test.mjs) | [google-browser-return-claim.mjs](refinement/native/google-browser-return-claim.mjs) |
| `NativeUpdateActivation` | [quint-native-update-activation.test.mjs](../../test/quint-native-update-activation.test.mjs) | [update-barrier.mjs](refinement/native/update-barrier.mjs) |
| `CanonicalNotificationTap` | [quint-canonical-notification-tap-refinement.test.mjs](../../test/quint-canonical-notification-tap-refinement.test.mjs) | [canonical-notification-tap.mjs](refinement/native/canonical-notification-tap.mjs) |
| `NativeUpdateComposition` | [quint-native-update-composition.test.mjs](../../test/quint-native-update-composition.test.mjs) | [update-composition.mjs](refinement/native/update-composition.mjs) |
| `NativeUpdateStaging` | [quint-native-update-staging.test.mjs](../../test/quint-native-update-staging.test.mjs) | [update-staging.mjs](refinement/native/update-staging.mjs) |
| `NativeHostedResultNotices` | [quint-native-hosted-result-notices.test.mjs](../../test/quint-native-hosted-result-notices.test.mjs) | [hosted-result-notices.mjs](refinement/native/hosted-result-notices.mjs) |
| `NativeClockReview` | [quint-native-clock-review.test.mjs](../../test/quint-native-clock-review.test.mjs) | [clock-review.mjs](refinement/native/clock-review.mjs) |
| `NativeSmsDispatch` | [quint-native-sms-dispatch.test.mjs](../../test/quint-native-sms-dispatch.test.mjs) | [sms-dispatch.mjs](refinement/native/sms-dispatch.mjs) |
| `NativeMmsDispatch` | [quint-native-mms-dispatch.test.mjs](../../test/quint-native-mms-dispatch.test.mjs) | [mms-dispatch.mjs](refinement/native/mms-dispatch.mjs) |
| `NativeTextScaleLifecycle` | [quint-native-text-scale-lifecycle.test.mjs](../../test/quint-native-text-scale-lifecycle.test.mjs) | [text-scale-lifecycle.mjs](refinement/native/text-scale-lifecycle.mjs) |
| `NativeCrashJournal` | [quint-native-crash-journal.test.mjs](../../test/quint-native-crash-journal.test.mjs) | [crash-journal.mjs](refinement/native/crash-journal.mjs) |
| `NativeSettingsHandoff` | [quint-native-settings-handoff.test.mjs](../../test/quint-native-settings-handoff.test.mjs) | [settings-handoff.mjs](refinement/native/settings-handoff.mjs) |
| `NativeAppInfoHandoff` | [quint-native-app-info-handoff.test.mjs](../../test/quint-native-app-info-handoff.test.mjs) | [app-info-handoff.mjs](refinement/native/app-info-handoff.mjs) |
| `NativeSourceRenewal` | [quint-native-source-renewal.test.mjs](../../test/quint-native-source-renewal.test.mjs) | [source-renewal.mjs](refinement/native/source-renewal.mjs) |
| `NativeAssistantEntry` | [quint-native-assistant-entry.test.mjs](../../test/quint-native-assistant-entry.test.mjs) | [assistant-entry.mjs](refinement/native/assistant-entry.mjs) |
| `NativeActionRecovery` | [quint-native-action-recovery.test.mjs](../../test/quint-native-action-recovery.test.mjs) | [action-recovery.mjs](refinement/native/action-recovery.mjs) |
| `BrowserUnderlay` | [quint-browser-underlay-partial-contract.test.mjs](../../test/quint-browser-underlay-partial-contract.test.mjs) | [browser-underlay.mjs](refinement/native/browser-underlay.mjs) |
| `NativeGmailBackground` | [quint-native-gmail-background.test.mjs](../../test/quint-native-gmail-background.test.mjs) | [gmail-background.mjs](refinement/native/gmail-background.mjs) |
| `NativeDigestConsent` | [quint-native-digest-consent.test.mjs](../../test/quint-native-digest-consent.test.mjs) | [native-digest.mjs](refinement/native/native-digest.mjs) |
| `SpeechCleanupLatch` | [quint-speech-cleanup-latch.test.mjs](../../test/quint-speech-cleanup-latch.test.mjs) | [speech-cleanup-latch.mjs](refinement/native/speech-cleanup-latch.mjs) |
| `NativeRequestWithdrawal` | [quint-native-request-withdrawal.test.mjs](../../test/quint-native-request-withdrawal.test.mjs) | [request-withdrawal.mjs](refinement/native/request-withdrawal.mjs) |

The SMS and MMS owners retain 27 and 20 current-source schedules respectively, plus three
pre-repair counterexample witnesses. Their historical sources at
`b1817660a0347ae19551b9ee296410fe55f02d59` are authenticated by
[the historical inventory](refinement/native/mms-historical-sources.json).
`scripts/prepare-quint-history.ts` makes both explicitly inventoried historical revisions available
without changing the pinned vendor checkout. Historical witnesses and current-source regressions
retain distinct provenance; neither is carrier, provider or device acceptance.

The additional `ListenerLeaseRecovery` [owner](../../test/quint-listener-lease-recovery.test.mjs)
and [driver](refinement/native/listener-lease-recovery.mjs) compile the whole current listening
service, listener and store. Two fresh JVMs distinguish the durable crash marker from the actual
private worker, input-read entry, recording identity, microphone-held flag and unsilenced timestamp,
and check the real lease verdict at the attribution-grace boundary. This is a partial observation
of settled unsilenced capture: the controlled input blocks before audio delivery. Arbitrary audio
silencing, accepted-frame content effects, lifecycle scheduling, JNI audio and device acceptance
remain outside this evidence; no source slices are introduced.

## Application and services

These 60 owners retain existing member-level behavior checks. Individual owners for previously
aggregate-only contracts relocate the same checks; they do not introduce new source slicing.
Where an owner contains a focused canary as well as a model-trace campaign, its original assertion
sets and source boundaries remain distinct. The owner and its retained receipt identify the actual
models, recorded actions and controlled ports.

- [quint-accessible-toast-lifetime.test.mjs](../../test/quint-accessible-toast-lifetime.test.mjs)
- [quint-address-input.test.mjs](../../test/quint-address-input.test.mjs)
- [quint-app-info-handoff-composition.test.mjs](../../test/quint-app-info-handoff-composition.test.mjs)
- [quint-appearance-preference-admission.test.mjs](../../test/quint-appearance-preference-admission.test.mjs)
- [quint-automatic-app-update-schedule.test.mjs](../../test/quint-automatic-app-update-schedule.test.mjs)
- [quint-automation-request-settlement.test.mjs](../../test/quint-automation-request-settlement.test.mjs)
- [quint-back-dispatch.test.mjs](../../test/quint-back-dispatch.test.mjs)
- [quint-bookmarks-hydration.test.mjs](../../test/quint-bookmarks-hydration.test.mjs)
- [quint-browser-google-return-contract.test.mjs](../../test/quint-browser-google-return-contract.test.mjs)
- [quint-browser-session-persistence.test.mjs](../../test/quint-browser-session-persistence.test.mjs)
- [quint-browser-surface-presentation.test.mjs](../../test/quint-browser-surface-presentation.test.mjs)
- [quint-browser-tab-lifecycle.test.mjs](../../test/quint-browser-tab-lifecycle.test.mjs)
- [quint-calendar-form-controls.test.mjs](../../test/quint-calendar-form-controls.test.mjs)
- [quint-canonical-notification-tap-admission.test.mjs](../../test/quint-canonical-notification-tap-admission.test.mjs)
- [quint-chat-attachments.test.mjs](../../test/quint-chat-attachments.test.mjs)
- [quint-chat-dock-gesture.test.mjs](../../test/quint-chat-dock-gesture.test.mjs)
- [quint-chat-dock.test.mjs](../../test/quint-chat-dock.test.mjs)
- [quint-cloud-plan-recheck.test.mjs](../../test/quint-cloud-plan-recheck.test.mjs)
- [quint-committed-view-observation.test.mjs](../../test/quint-committed-view-observation.test.mjs)
- [quint-composer-send.test.mjs](../../test/quint-composer-send.test.mjs)
- [quint-connection-controller.test.mjs](../../test/quint-connection-controller.test.mjs)
- [quint-delegation-receiver.test.mjs](../../test/quint-delegation-receiver.test.mjs)
- [quint-find-in-page.test.mjs](../../test/quint-find-in-page.test.mjs)
- [quint-first-send-draft-migration.test.mjs](../../test/quint-first-send-draft-migration.test.mjs)
- [quint-fixture-busy-latch.test.mjs](../../test/quint-fixture-busy-latch.test.mjs)
- [quint-keyboard-detectors.test.mjs](../../test/quint-keyboard-detectors.test.mjs)
- [quint-keyboard-focus.test.mjs](../../test/quint-keyboard-focus.test.mjs)
- [quint-lifeops-scheduled-task-route.test.mjs](../../test/quint-lifeops-scheduled-task-route.test.mjs)
- [quint-maps-share-choice.test.mjs](../../test/quint-maps-share-choice.test.mjs)
- [quint-mounted-update-admission.test.mjs](../../test/quint-mounted-update-admission.test.mjs)
- [quint-notes-coordinator-refinement.test.mjs](../../test/quint-notes-coordinator-refinement.test.mjs)
- [quint-observation-turn-dispatch.test.mjs](../../test/quint-observation-turn-dispatch.test.mjs)
- [quint-pending-action-recovery.test.mjs](../../test/quint-pending-action-recovery.test.mjs)
- [quint-personal-assistant-scheduled-task-custody.test.mjs](../../test/quint-personal-assistant-scheduled-task-custody.test.mjs)
- [quint-phone-call.test.mjs](../../test/quint-phone-call.test.mjs)
- [quint-plan-admission-grace.test.mjs](../../test/quint-plan-admission-grace.test.mjs)
- [quint-previous-notes-availability.test.mjs](../../test/quint-previous-notes-availability.test.mjs)
- [quint-previous-notes-source-opening.test.mjs](../../test/quint-previous-notes-source-opening.test.mjs)
- [quint-protected-app-update-promotion-contract.test.mjs](../../test/quint-protected-app-update-promotion-contract.test.mjs)
- [quint-prototype-surfaces-source-contracts.test.mjs](../../test/quint-prototype-surfaces-source-contracts.test.mjs)
- [quint-quiet-voice-retry.test.mjs](../../test/quint-quiet-voice-retry.test.mjs)
- [quint-reminder-open-intent.test.mjs](../../test/quint-reminder-open-intent.test.mjs)
- [quint-resident-liveness.test.mjs](../../test/quint-resident-liveness.test.mjs)
- [quint-retained-reminder-tap-admission.test.mjs](../../test/quint-retained-reminder-tap-admission.test.mjs)
- [quint-settings-capability-reads.test.mjs](../../test/quint-settings-capability-reads.test.mjs)
- [quint-settings-listener-reads.test.mjs](../../test/quint-settings-listener-reads.test.mjs)
- [quint-settings-page-focus.test.mjs](../../test/quint-settings-page-focus.test.mjs)
- [quint-settings-session.test.mjs](../../test/quint-settings-session.test.mjs)
- [quint-shade-notice-question-admission.test.mjs](../../test/quint-shade-notice-question-admission.test.mjs)
- [quint-shade-pull.test.mjs](../../test/quint-shade-pull.test.mjs)
- [quint-shade-row-custody.test.mjs](../../test/quint-shade-row-custody.test.mjs)
- [quint-shell-screen.test.mjs](../../test/quint-shell-screen.test.mjs)
- [quint-sign-in-chooser.test.mjs](../../test/quint-sign-in-chooser.test.mjs)
- [quint-sign-in-readiness-probe.test.mjs](../../test/quint-sign-in-readiness-probe.test.mjs)
- [quint-stopped-reply-reconciliation.test.mjs](../../test/quint-stopped-reply-reconciliation.test.mjs)
- [quint-voice-owned-navigation.test.mjs](../../test/quint-voice-owned-navigation.test.mjs)
- [quint-voice-transcript-follow-refinement.test.mjs](../../test/quint-voice-transcript-follow-refinement.test.mjs)
- [quint-workflow-clock-admission.test.mjs](../../test/quint-workflow-clock-admission.test.mjs)
- [quint-workflow-local-source.test.mjs](../../test/quint-workflow-local-source.test.mjs)
- [quint-workflow-run-ownership.test.mjs](../../test/quint-workflow-run-ownership.test.mjs)

The removed pure-model ChatDock replay is not partial-source evidence. Its existing source-driven
case remains in its owning test. Source-text-only assertions, documentation wrappers and duplicate
family aggregates are not part of this inventory. Model scenarios, witnesses and proof bounds stay
in the unchanged family registries; passing these finite source contracts does not establish
complete application refinement, native/provider behavior, an image boot or device acceptance.
