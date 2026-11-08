import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from './support.mjs';
import {startupPermissions, callbackLanding, preferences, browserSession, permanentVoiceDeletion, draftDispatch} from './portable.mjs';
import {application, assistantConversation} from './clients.mjs';
import {durableStore} from './storage.mjs';
import {notesLifecycle, calendarPresentation, credentialVault, permissionWalkthrough} from './contracts.mjs';
import {shellNavigation, developmentSurfaces, developmentDevice, filesTree} from './surfaces.mjs';
import {filesAndSharing, notificationCollection, developmentHost} from './boundaries.mjs';

const adapters = [application, shellNavigation, startupPermissions, assistantConversation, notesLifecycle,
  browserSession, credentialVault, developmentSurfaces, filesAndSharing, preferences, durableStore,
  permissionWalkthrough, developmentDevice, permanentVoiceDeletion, developmentHost, filesTree,
  calendarPresentation, draftDispatch, notificationCollection, callbackLanding];

/** Component traces, with remaining obligations kept explicit for the aggregate report. */
export async function runApplicationRefinement() {
  const receipts = [], obligations = [];
  const manifest = JSON.parse(readFileSync(resolve(root, 'specs/quint/application/manifest.json'), 'utf8'));
  for (const adapter of adapters) {
    const receipt = await adapter();
    const model = receipt.model === 'PermanentVoiceDeletionContract' ? 'PermanentVoiceDeletion' : receipt.model;
    receipts.push({...receipt, coverageModel: model});
    const entry = (Array.isArray(manifest) ? manifest : manifest.models).find(entry => entry.module === model);
    const source = readFileSync(resolve(root, entry.path), 'utf8');
    const main = source.slice(source.indexOf(`module ${model} {`)).split('\n}')[0];
    const fields = [...(main.match(/type State\s*=\s*\{([^}]+)\}/s)?.[1] || '').matchAll(/\b(\w+)\s*:/g)].map(match => match[1]);
    const checked = new Set(receipt.observedFields);
    const missingFields = fields.filter(field => !checked.has(`s.${field}`));
    const actions = [...main.matchAll(/^\s*action (\w+)/gm)].map(match => match[1]).filter(name => !['init', 'step', 'check'].includes(name));
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
