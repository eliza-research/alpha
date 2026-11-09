import {fileURLToPath} from 'node:url';
import {checkPluginConnectorCustody} from '../../../legacy/core/check-plugin-connector-custody.mjs';
import {checkTraces, qmap, qset} from '../../check-traces.mjs';

function observations(actual) {
  if (Array.isArray(actual)) {
    return {isolationView: qmap(actual.map((runtime, index) => [index+1, runtime]))};
  }
  const {ownerKeys, rivalKeys, ownerPostKeys, rivalPostKeys, ownerLegacyKey, rivalLegacyKey, ...values} = actual;
  const view = {...values,
    rival: rivalKeys !== null,
    ownerKeys: qset(ownerKeys ?? []),
    rivalKeys: qset(rivalKeys ?? []),
    ownerPostKeys: qset(ownerPostKeys ?? []),
    rivalPostKeys: qset(rivalPostKeys ?? []),
    ownerLegacyKey: ownerLegacyKey ?? false,
    rivalLegacyKey: rivalLegacyKey ?? false,
  };
  return Object.fromEntries(Object.entries(view).map(([field, value]) => ['sourceView.'+field, value]));
}

export async function checkCoreConnectorCustody(extraSources = []) {
  const {records, sources, driverHashes} = await checkPluginConnectorCustody([
    fileURLToPath(import.meta.url), ...extraSources,
  ]);
  const traces = records.map(({name, init, checkpoints: [initial, ...points]}) => ({
    name, init, expect: observations(initial.actual),
    steps: points.map(({label, actual, actions}) => ({
      label, action: actions.length ? actions : null, expect: observations(actual),
    })),
  }));
  return checkTraces({model: 'CoreConnectorCustody', sources, driverHashes, traces, scope: 'bounded-orchestration',
    assumptions: [
      'The authenticated AgentRuntime, connector registry, service lifecycle and plugin lifecycle execute with isolated PGlite. Start, dispose and stop gates are held by the existing fixture. Connector handlers return synthetic route labels and external fetches are closed.',
      'Each ordinary schedule has one runtime, one first plugin generation, one same-name replacement, one rival and one service. The shared-class schedule uses the same class identity in two independent runtimes.',
      'Default message, named message, default post, named post and a separate legacy send key are projected. Calls in a synchronous fixture registration form one action. Eager and lazy starts use the same bounded capture transition.',
      'Public ownership, labels, exact account lookup, default fallback, service presence, class admission, disposal, stop count and detached callback progress come from the fixture. Runtime and ownership stamps are abstract and checked through their effects.',
      'Explicit direct unregistration, other plugin effects, and callbacks outside all lifecycle scope are separate source boundaries.',
    ]});
}
