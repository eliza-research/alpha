import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from './support.mjs';
import {modelStateInventory, unobservedStateFields} from '../model-state.mjs';
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
import {checkCanonicalCalendarDraft} from './canonical-calendar-draft.mjs';
import {checkAgentCalendarRefresh} from './agent-calendar-refresh.mjs';
import {checkAgentCalendarMutation} from './agent-calendar-mutation.mjs';
import {checkAgentCalendarEventReturn} from './agent-calendar-event-return.mjs';
import {checkMapsEventReturn} from './maps-event-return.mjs';
import {checkAgentCalendarSyncControl} from './agent-calendar-sync-control.mjs';
import {checkGoogleCalendarLinkFlow} from './google-calendar-link-flow.mjs';
import {checkGoogleCalendarDisconnect} from './google-calendar-disconnect.mjs';
import {checkGoogleCalendarLinkPublication} from './google-calendar-link-publication.mjs';
import {checkGoogleCalendarAccessChoice} from './google-calendar-access-choice.mjs';
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
import {checkRendererDigestQueue} from './renderer-digest-queue.mjs';
import {checkHomeFailureNotice} from './home-failure-notice.mjs';
import {checkHomeGesture} from './home-gesture.mjs';
import {checkDrawerInteraction} from './drawer-interaction.mjs';
import {checkLauncherOwnership} from './launcher-ownership.mjs';
import {checkLauncherObserver} from './launcher-observer.mjs';
import {checkLauncherFavorites} from './launcher-favorites.mjs';
import {checkAccessibleToastLifetime} from './accessible-toast-lifetime.mjs';
import {checkModalToastForwarding} from './modal-toast-forwarding.mjs';
import {checkScreenFocusOwnership} from './screen-focus-ownership.mjs';
import {checkDockClearanceOwnership} from './dock-clearance-ownership.mjs';
import {checkMountedUpdateAdmission} from './mounted-update-admission.mjs';
import {checkStartupUpdateAdmission} from './startup-update-admission.mjs';
import {checkCanonicalNotificationTapAdmission} from './canonical-notification-tap-admission.mjs';
import {checkResidentLiveness} from './resident-liveness.mjs';

const adapters = [application, shellNavigation, startupPermissions, assistantConversation, notesLifecycle,
  browserSession, credentialVault, developmentSurfaces, filesAndSharing, preferences, durableStore,
  permissionWalkthrough, developmentDevice, permanentVoiceDeletion, developmentHost, filesTree,
  calendarPresentation, draftDispatch, notificationCollection, callbackLanding,
  checkBrowserHostedResultNotice, checkHostedNoticeQuestion, checkRendererHostedInbox, checkRendererDigestQueue,
  runStartupPermissionsCoordinatorRefinement, checkVaultCoordinator, checkNotesCoordinator, listFocus, checkRecoveryUI, checkShellCoordinator, checkNativeViewSubscription, filesPreview, runPermissionChoicesRefinement, checkCanonicalNotesController, checkCanonicalNotesDraft,
  checkCanonicalNotesFeedback, checkCanonicalNotesMutation, checkCanonicalNotesView, checkCanonicalCalendarDraft, checkAgentCalendarRefresh, checkAgentCalendarMutation, checkAgentCalendarEventReturn, checkMapsEventReturn, checkAgentCalendarSyncControl, checkGoogleCalendarLinkFlow, checkGoogleCalendarDisconnect, checkGoogleCalendarLinkPublication, checkGoogleCalendarAccessChoice, checkFilesBrowserController, checkFilesFilter, checkPhotosWindow, checkPhotosTrash, checkGoogleConsentAdmission, checkGoogleAccessPublication, checkBrowserDeletionPoll, checkBrowserJournalRetention, checkBrowserReminderOrphan, checkBrowserOwnerReminderRead, checkBrowserOwnerReminderAction, checkHomeFailureNotice, checkHomeGesture, checkDrawerInteraction, checkLauncherOwnership, checkLauncherObserver, checkLauncherFavorites, checkAccessibleToastLifetime, checkModalToastForwarding, checkScreenFocusOwnership, checkDockClearanceOwnership, checkMountedUpdateAdmission, checkStartupUpdateAdmission, checkCanonicalNotificationTapAdmission, checkResidentLiveness];

/** Component traces, with remaining obligations kept explicit for the aggregate report. */
export async function runApplicationRefinement() {
  const receipts = [], obligations = [];
  const manifest = JSON.parse(readFileSync(resolve(root, 'specs/quint/application/manifest.json'), 'utf8'));
  for (const adapter of adapters) {
    const result = await adapter();
    const receipt = result.receipt ?? result;
    if(result.obligations)obligations.push(...result.obligations);
    const model = receipt.model === 'PermanentVoiceDeletionContract' ? 'PermanentVoiceDeletion' : receipt.model;
    receipts.push({...receipt, coverageModel: model});
    const entry = (Array.isArray(manifest) ? manifest : manifest.models).find(entry => entry.module === model);
    const inventory = modelStateInventory(resolve(root, entry.path), model);
    const missingFields = unobservedStateFields(inventory, receipt.observedFields);
    const actions = inventory.actions.filter(name => !['init', 'step', 'check'].includes(name));
    const executed = new Set([...Object.keys(receipt.actions), ...receipt.traceInputs.map(trace => trace.init?.name || 'init')]);
    const missingActions = actions.filter(action => !executed.has(action));
    if (missingFields.length) obligations.push({model, obligation: `Observe state fields ${missingFields.join(', ')}`,
      reason: 'These fields are outside the current concrete projection. Passing traces do not establish their implementation refinement.'});
    if (missingActions.length) obligations.push({model, obligation: `Exercise source transitions for ${missingActions.join(', ')}`,
      reason: 'No current trace maps these actions to implementation execution.'});
    for (const assumption of receipt.assumptions.slice(1)) obligations.push({model, obligation: assumption,
      reason: 'Declared boundary of the adapter. Further source scheduling or platform instrumentation is required.'});
  }
  return {receipts, obligations};
}
