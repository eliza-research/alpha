import {checkCalendarFormControls} from './calendar-form-controls.mjs';
import {checkSettingsPageFocus} from './settings-page-focus.mjs';
import {checkKeyboardFocus} from './keyboard-focus.mjs';
import {checkChatAttachments} from './chat-attachments.mjs';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from './support.mjs';
import {modelStateInventory, traceActionCoverage, unobservedStateFields} from '../model-state.mjs';
import {startupPermissions, callbackLanding, preferences, browserSession, permanentVoiceDeletion, draftDispatch} from './portable.mjs';
import {application, assistantConversation} from './clients.mjs';
import {durableStore} from './storage.mjs';
import {notesLifecycle, calendarPresentation, credentialVault, permissionWalkthrough} from './contracts.mjs';
import {shellNavigation, developmentSurfaces, developmentDevice, filesTree} from './surfaces.mjs';
import {filesAndSharing, notificationCollection, developmentHost} from './boundaries.mjs';
import {runStartupPermissionsCoordinatorRefinement} from './startup-permissions-coordinator.mjs';
import {checkVaultCoordinator} from './vault-coordinator.mjs';
import {checkNotesCoordinator} from './notes-coordinator.mjs';
import {listFocus} from './list-focus.mjs';
import {checkRecoveryUI} from './recovery-ui.mjs';
import {checkShellCoordinator} from './shell-coordinator.mjs';
import {checkNativeViewSubscription} from './native-view-subscription.mjs';
import {filesPreview} from './files-preview.mjs';
import {runPermissionChoicesRefinement} from './permission-choices.mjs';
import {checkCanonicalNotesController} from './canonical-notes-controller.mjs';
import {checkCanonicalNotesDraft} from './canonical-notes-draft.mjs';
import {checkCanonicalNotesFeedback} from './canonical-notes-feedback.mjs';
import {checkCanonicalNotesMutation} from './canonical-notes-mutation.mjs';
import {checkCanonicalNotesView} from './canonical-notes-view.mjs';
import {checkNotesRecorderMediaAdmission} from './notes-recorder-media-admission.mjs';
import {checkCanonicalCalendarDraft} from './canonical-calendar-draft.mjs';
import {checkAgentCalendarRefresh} from './agent-calendar-refresh.mjs';
import {checkAgentCalendarMutation} from './agent-calendar-mutation.mjs';
import {checkAgentCalendarEventReturn} from './agent-calendar-event-return.mjs';
import {checkMapsEventReturn} from './maps-event-return.mjs';
import {checkMapsRerouteOwnership} from './maps-reroute-ownership.mjs';
import {checkCloudConnectionNotices} from './cloud-connection-notices.mjs';
import {checkModalScrimOwnership} from './modal-scrim-ownership.mjs';
import {checkRetainedReminderTapAdmission} from './retained-reminder-tap-admission.mjs';
import {checkReminderOpenIntent} from './reminder-open-intent.mjs';
import {checkFirstSendDraftMigration} from './first-send-draft-migration.mjs';
import {checkShadeNoticeQuestionAdmission} from './shade-notice-question-admission.mjs';
import {checkWorkflowClockAdmission} from './workflow-clock-admission.mjs';
import {checkBrowserAlbumStorage} from './browser-album-storage.mjs';
import {checkShadeRowCustody} from './shade-row-custody.mjs';
import {checkPhotosOwnedAlbumDialog} from './photos-owned-album-dialog.mjs';
import {checkBrowserExternalHandoff} from './browser-external-handoff.mjs';
import {checkObservationTurnDispatch} from './observation-turn-dispatch.mjs';
import {checkClientObservationSupport} from './client-observation-support.mjs';
import {checkEmailSuggestionReview} from './email-suggestion-review.mjs';
import {checkSharePanelAdmission} from './share-panel-admission.mjs';
import {checkWorkflowRequestRecoveryAdmission} from './workflow-request-recovery-admission.mjs';
import {checkAppearancePreferenceAdmission} from './appearance-preference-admission.mjs';
import {checkNotesTrashReadPublication} from './notes-trash-read-publication.mjs';
import {checkPreviousNotesAvailability} from './previous-notes-availability.mjs';
import {checkCommittedViewObservation} from './committed-view-observation.mjs';
import {checkPreviousNotesSourceOpening} from './previous-notes-source-opening.mjs';
import {checkScheduledTaskControls} from './scheduled-task-controls.mjs';
import {checkAgentCalendarSyncControl} from './agent-calendar-sync-control.mjs';
import {checkGoogleCalendarLinkFlow} from './google-calendar-link-flow.mjs';
import {checkGoogleCalendarDisconnect} from './google-calendar-disconnect.mjs';
import {checkGoogleCalendarLinkPublication} from './google-calendar-link-publication.mjs';
import {checkGoogleCalendarAccessChoice} from './google-calendar-access-choice.mjs';
import {checkCalendarPreservationConfirmation} from './calendar-preservation-confirmation.mjs';
import {checkCanonicalCalendarEditorClose} from './canonical-calendar-editor-close.mjs';
import {checkCanonicalCalendarDraftHandoff} from './canonical-calendar-draft-handoff.mjs';
import {checkCameraPreviewRetirement} from './camera-preview-retirement.mjs';
import {checkFilesBrowserController} from './files-browser-coordinator.mjs';
import {checkFilesFilter} from './files-filter.mjs';
import {checkGoogleConsentAdmission} from './google-consent-admission.mjs';
import {checkGoogleAccessPublication} from './google-access-publication.mjs';
import {checkPhotosWindow} from './photos-window.mjs';
import {checkPhotosTrash} from './photos-trash.mjs';
import {checkBrowserDeletionPoll} from './browser-deletion-poll.mjs';
import {checkBrowserJournalRetention} from './browser-journal-retention.mjs';
import {checkBrowserReminderOrphan} from './browser-reminder-orphan.mjs';
import {checkBrowserOwnerReminderRead} from './browser-owner-reminder-read.mjs';
import {checkBrowserOwnerReminderAction} from './browser-owner-reminder-action.mjs';
import {checkBrowserHostedResultNotice} from './browser-hosted-result-notice.mjs';
import {checkHostedNoticeQuestion} from './hosted-notice-question.mjs';
import {checkRendererHostedInbox} from './renderer-hosted-inbox.mjs';
import {checkHostedBackgroundAdmission} from './hosted-background-admission.mjs';
import {checkHostedDigestRefresh} from './hosted-digest-refresh.mjs';
import {checkHostedDigestMutation} from './hosted-digest-mutation.mjs';
import {checkSourceRenewalQuestion} from './source-renewal-question.mjs';
import {checkBrowserFilesTrash} from './browser-files-trash.mjs';
import {checkRendererDigestQueue} from './renderer-digest-queue.mjs';
import {checkRetainedHomeBrief} from './retained-home-brief.mjs';
import {checkHomeFailureNotice} from './home-failure-notice.mjs';
import {checkHomeGesture} from './home-gesture.mjs';
import {checkDrawerInteraction} from './drawer-interaction.mjs';
import {checkAppInfoHandoffComposition} from './app-info-handoff-composition.mjs';
import {checkLauncherOwnership} from './launcher-ownership.mjs';
import {checkLauncherObserver} from './launcher-observer.mjs';
import {checkLauncherFavorites} from './launcher-favorites.mjs';
import {checkAccessibleToastLifetime} from './accessible-toast-lifetime.mjs';
import {checkModalToastForwarding} from './modal-toast-forwarding.mjs';
import {checkScreenFocusOwnership} from './screen-focus-ownership.mjs';
import {checkDockClearanceOwnership} from './dock-clearance-ownership.mjs';
import {checkMountedUpdateAdmission} from './mounted-update-admission.mjs';
import {checkAutomaticAppUpdateSchedule} from './automatic-app-update-schedule.mjs';
import {checkStartupUpdateAdmission} from './startup-update-admission.mjs';
import {checkCanonicalNotificationTapAdmission} from './canonical-notification-tap-admission.mjs';
import {checkResidentLiveness} from './resident-liveness.mjs';

const adapters = [checkCalendarFormControls, checkSettingsPageFocus, checkKeyboardFocus, checkChatAttachments, application, shellNavigation, startupPermissions, assistantConversation, notesLifecycle,
  browserSession, credentialVault, developmentSurfaces, filesAndSharing, preferences, durableStore,
  permissionWalkthrough, developmentDevice, permanentVoiceDeletion, developmentHost, filesTree,
  calendarPresentation, draftDispatch, notificationCollection, callbackLanding,
  checkBrowserHostedResultNotice, checkHostedNoticeQuestion, checkRendererHostedInbox, checkHostedBackgroundAdmission,
  checkRendererDigestQueue, checkHostedDigestRefresh, checkHostedDigestMutation, checkSourceRenewalQuestion, checkBrowserFilesTrash,
  checkRetainedHomeBrief,
  checkCalendarPreservationConfirmation,
  checkCanonicalCalendarEditorClose,
  checkCanonicalCalendarDraftHandoff,
  checkCameraPreviewRetirement,
  checkNotesRecorderMediaAdmission, checkRetainedReminderTapAdmission, checkReminderOpenIntent, checkFirstSendDraftMigration,
  checkShadeNoticeQuestionAdmission, checkWorkflowClockAdmission,
  checkBrowserExternalHandoff,
  checkPhotosOwnedAlbumDialog,
  checkShadeRowCustody,
  checkBrowserAlbumStorage,
  checkClientObservationSupport,
  checkObservationTurnDispatch,
  checkEmailSuggestionReview,
  checkSharePanelAdmission,
  checkWorkflowRequestRecoveryAdmission,
  checkAppearancePreferenceAdmission,
  checkNotesTrashReadPublication,
  checkPreviousNotesAvailability,
  checkCommittedViewObservation,
  checkPreviousNotesSourceOpening,
  checkScheduledTaskControls,
  runStartupPermissionsCoordinatorRefinement, checkVaultCoordinator, checkNotesCoordinator, listFocus, checkRecoveryUI, checkShellCoordinator, checkNativeViewSubscription, filesPreview, runPermissionChoicesRefinement, checkCanonicalNotesController, checkCanonicalNotesDraft,
  checkCanonicalNotesFeedback, checkCanonicalNotesMutation, checkCanonicalNotesView, checkCanonicalCalendarDraft, checkAgentCalendarRefresh, checkAgentCalendarMutation, checkAgentCalendarEventReturn, checkMapsEventReturn, checkMapsRerouteOwnership, checkCloudConnectionNotices, checkModalScrimOwnership, checkAgentCalendarSyncControl, checkGoogleCalendarLinkFlow, checkGoogleCalendarDisconnect, checkGoogleCalendarLinkPublication, checkGoogleCalendarAccessChoice, checkFilesBrowserController, checkFilesFilter, checkPhotosWindow, checkPhotosTrash, checkGoogleConsentAdmission, checkGoogleAccessPublication, checkBrowserDeletionPoll, checkBrowserJournalRetention, checkBrowserReminderOrphan, checkBrowserOwnerReminderRead, checkBrowserOwnerReminderAction, checkHomeFailureNotice, checkHomeGesture, checkDrawerInteraction, checkAppInfoHandoffComposition, checkLauncherOwnership, checkLauncherObserver, checkLauncherFavorites, checkAccessibleToastLifetime, checkModalToastForwarding, checkScreenFocusOwnership, checkDockClearanceOwnership, checkMountedUpdateAdmission, checkStartupUpdateAdmission, checkAutomaticAppUpdateSchedule, checkCanonicalNotificationTapAdmission, checkResidentLiveness];

/** Component traces, with remaining obligations kept explicit for the aggregate report. */
export async function runApplicationRefinement(onProgress) {
  return collectApplicationCampaigns(adapters, onProgress);
}

export async function collectApplicationCampaigns(campaigns, onProgress) {
  const receipts = [], obligations = [], failures = [];
  const manifest = JSON.parse(readFileSync(resolve(root, 'specs/quint/application/manifest.json'), 'utf8'));
  const entries = new Map((Array.isArray(manifest) ? manifest : manifest.models).map(entry => [entry.module, entry]));
  for (const adapter of campaigns) {
    try {
      const result = await adapter();
      const receipt = result.receipt ?? result;
      const model = receipt.model === 'PermanentVoiceDeletionContract' ? 'PermanentVoiceDeletion' : receipt.model;
      const inventory = modelStateInventory(resolve(root, entries.get(model).path), model);
      const missingFields = unobservedStateFields(inventory, receipt.observedFields);
      const coverage = traceActionCoverage([receipt]);
      const executed = new Set([...coverage.modelTransitionActions, ...coverage.modelInitializers]);
      const missingActions = inventory.actions.filter(name => !['init', 'step', 'check'].includes(name) && !executed.has(name));
      receipts.push({...receipt, coverageModel: model});
      obligations.push(...(result.obligations ?? []));
      if (missingFields.length) obligations.push({model, obligation: `Observe state fields ${missingFields.join(', ')}`,
        reason: 'These fields are outside the current concrete projection. Passing traces do not establish their implementation refinement.'});
      if (missingActions.length) obligations.push({model, obligation: `Exercise source transitions for ${missingActions.join(', ')}`,
        reason: 'No current trace maps these actions to implementation execution.'});
      for (const assumption of receipt.assumptions.slice(1)) obligations.push({model, obligation: assumption,
        reason: 'Declared boundary of the adapter. Further source scheduling or platform instrumentation is required.'});
    } catch (error) {
      failures.push({campaign: adapter.name, error});
    }
    onProgress?.({receipts, failures});
  }
  return {receipts, obligations, failures};
}
