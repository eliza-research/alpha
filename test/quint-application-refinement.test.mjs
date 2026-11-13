import test from 'node:test';
import assert from 'node:assert/strict';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import {startupPermissions, callbackLanding, preferences, browserSession, permanentVoiceDeletion, draftDispatch} from '../specs/quint/refinement/application/portable.mjs';
import {application, assistantConversation} from '../specs/quint/refinement/application/clients.mjs';
import {durableStore} from '../specs/quint/refinement/application/storage.mjs';
import {notesLifecycle, calendarPresentation, credentialVault, permissionWalkthrough} from '../specs/quint/refinement/application/contracts.mjs';
import {filesAndSharing, notificationCollection, developmentHost} from '../specs/quint/refinement/application/boundaries.mjs';
import {checkShellCoordinator} from '../specs/quint/refinement/application/shell-coordinator.mjs';
import {checkCompletedViewDelivery} from '../specs/quint/refinement/application/completed-view-delivery.mjs';
import {filesPreview} from '../specs/quint/refinement/application/files-preview.mjs';
import {checkModalScrimOwnership} from '../specs/quint/refinement/application/modal-scrim-ownership.mjs';

// Application source campaigns that share adapters across several models. Each runs the product
// source against its model's transitions; a model with a single adapter has its own test file.
for (const check of [application, assistantConversation, startupPermissions, callbackLanding, preferences, browserSession,
  permanentVoiceDeletion, draftDispatch, durableStore, notesLifecycle, calendarPresentation, credentialVault,
  permissionWalkthrough, filesAndSharing, notificationCollection, developmentHost, checkShellCoordinator,
  checkCompletedViewDelivery, filesPreview, checkModalScrimOwnership]) {
  test(`${check.name} source observations match its Quint model`, {timeout: scaledTimeout(600000)}, async () => {
    const result = await check();
    const receipt = result.receipt ?? result;
    assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound, receipt.model);
  });
}
