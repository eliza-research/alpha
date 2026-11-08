import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root, captureSources} from './support.mjs';
import {modelStateInventory, unobservedStateFields} from '../model-state.mjs';
import {startupPermissions, callbackLanding, preferences, browserSession, permanentVoiceDeletion, draftDispatch} from './portable.mjs';
import {application, assistantConversation} from './clients.mjs';
import {durableStore} from './storage.mjs';
import {notesLifecycle, calendarPresentation, credentialVault, permissionWalkthrough} from './contracts.mjs';
import {shellNavigation, developmentSurfaces, developmentDevice, filesTree} from './surfaces.mjs';
import {filesAndSharing, notificationCollection, developmentHost} from './boundaries.mjs';
import {checkShellCoordinator} from './shell-coordinator.mjs';
import {checkVaultCoordinator} from './vault-coordinator.mjs';
import {checkNotesCoordinator} from './notes-coordinator.mjs';
import {checkNativeViewSubscription} from './native-view-subscription.mjs';
import {checkCanonicalNotesController} from './canonical-notes-controller.mjs';
import {checkRecoveryUI} from './recovery-ui.mjs';
import {fileURLToPath} from 'node:url';

const adapters = [application, shellNavigation, startupPermissions, assistantConversation, notesLifecycle,
  browserSession, credentialVault, developmentSurfaces, filesAndSharing, preferences, durableStore,
  permissionWalkthrough, developmentDevice, permanentVoiceDeletion, developmentHost, filesTree,
  calendarPresentation, draftDispatch, notificationCollection, callbackLanding];

/** Component traces, with remaining obligations kept explicit for the aggregate report. */
export async function runApplicationRefinement() {
  captureSources(['specs/quint/refinement/model-state.mjs']);
  const receipts = [], obligations = [];
  const manifest = JSON.parse(readFileSync(resolve(root, 'specs/quint/application/manifest.json'), 'utf8'));
  for (const adapter of adapters) {
    const receipt = await adapter();
    const model = receipt.model === 'PermanentVoiceDeletionContract' ? 'PermanentVoiceDeletion' : receipt.model;
    receipts.push({...receipt, coverageModel: model});
  }
  receipts.push(await checkShellCoordinator([fileURLToPath(import.meta.url), 'test/quint-application-refinement.test.mjs']));
  receipts.push(await checkVaultCoordinator([fileURLToPath(import.meta.url), 'test/quint-application-refinement.test.mjs']));
  receipts.push(await checkNotesCoordinator([fileURLToPath(import.meta.url), 'test/quint-application-refinement.test.mjs']));
  receipts.push(await checkNativeViewSubscription([fileURLToPath(import.meta.url), 'test/quint-application-refinement.test.mjs', 'specs/quint/refinement/model-state.mjs']));
  receipts.push(await checkCanonicalNotesController([fileURLToPath(import.meta.url), 'test/quint-application-refinement.test.mjs', 'specs/quint/refinement/model-state.mjs']));
  receipts.push(await checkRecoveryUI([fileURLToPath(import.meta.url), 'test/quint-application-refinement.test.mjs']));
  for (const entry of (Array.isArray(manifest) ? manifest : manifest.models)) {
    const model = entry.module;
    const related = receipts.filter(receipt => (receipt.coverageModel || receipt.model) === model);
    const inventory = modelStateInventory(resolve(root, entry.path), model);
    const checked = related.flatMap(receipt => receipt.observedFields);
    const missingFields = unobservedStateFields(inventory, checked);
    const executed = new Set(related.flatMap(receipt => [...Object.keys(receipt.actions), ...receipt.traceInputs.map(trace => trace.init?.name || 'init')]));
    const missingActions = inventory.actions.filter(action => !['init', 'step', 'check'].includes(action) && !executed.has(action));
    if (!related.length) obligations.push({model, obligation: 'Bind the current source transition relation',
      reason: 'No current source-executing adapter receipt is available for this model.'});
    if (missingFields.length) obligations.push({model, obligation: `Observe state fields ${missingFields.join(', ')}`,
      reason: 'These fields are outside the current concrete projection. Passing traces do not establish their implementation refinement.'});
    if (missingActions.length) obligations.push({model, obligation: `Exercise source transitions for ${missingActions.join(', ')}`,
      reason: 'No current trace maps these actions to implementation execution.'});
    for (const assumption of new Set(related.flatMap(receipt => receipt.assumptions))) obligations.push({model, obligation: assumption,
      reason: 'Declared boundary of the adapter. Further source scheduling or platform instrumentation is required.'});
  }
  return {receipts, obligations};
}
