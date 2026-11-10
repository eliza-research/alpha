import test from 'node:test';
import assert from 'node:assert/strict';
import {checkMapsRerouteOwnership} from '../specs/quint/refinement/application/maps-reroute-ownership.mjs';

test('mounted Maps settles an agent reroute for the exact guidance and route request', {timeout:420000}, async () => {
  const receipt = await checkMapsRerouteOwnership(['test/quint-maps-reroute-ownership.test.mjs']);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
  const completed = Object.fromEntries(receipt.traceInputs.map(trace => [trace.name, trace.steps.at(-1).expect]));
  assert.deepEqual(Object.fromEntries(Object.entries(completed).map(([name, state]) => [name, state['s.agent']])), {
    live_same_public_route_id: 'accepted',
    live_new_public_route_id: 'accepted',
    live_provider_refusal: 'refused',
    end_without_new_route_preserves_review: 'retired',
    retired_success_after_replacement_start: 'retired',
    retired_refusal_after_replacement_start: 'retired',
    retired_reply_before_replacement_start: 'retired',
  });
  for (const name of Object.keys(completed).filter(name => name.startsWith('retired_'))) {
    const state = completed[name];
    assert.equal(state['s.guidanceSession'], 3);
    assert.equal(state['s.guidanceRoute'], 3);
    assert.equal(state['s.origin'], 3);
    assert.equal(state['s.watches'], 1);
  }
  assert.equal(completed.live_same_public_route_id['s.origin'], 2);
  assert.equal(completed.live_provider_refusal['s.origin'], 1);
  assert.equal(completed.live_provider_refusal['s.route'], 1);
  assert.equal(completed.live_provider_refusal['s.phase'], 'ready');
  assert.equal(completed.live_provider_refusal['s.watches'], 1);
  assert.equal(completed.end_without_new_route_preserves_review['s.origin'], 2);
  assert.equal(completed.end_without_new_route_preserves_review['s.guidanceSession'], 0);
});
