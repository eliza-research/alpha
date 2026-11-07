import {test} from 'node:test';
import assert from 'node:assert/strict';
import {supportsAppUpdateStartup,waitForAppUpdateStartup} from '../apps/app/src/runtime/app-update-startup.ts';

const activationId = '11111111-2222-4333-8444-555555555555';
const bridgeId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const other = '99999999-2222-4333-8444-555555555555';

test('startup probes the journal only for hosts that advertise the bridge method', () => {
  assert.equal(supportsAppUpdateStartup(undefined), false);
  assert.equal(supportsAppUpdateStartup([{name:'AlphaDevice',methods:[{name:'installUpdate'}]}]), false);
  assert.equal(supportsAppUpdateStartup([{name:'AlphaDevice',methods:[{name:'updateState'}]}]), true);
});

test('an unmounted WebView acknowledges its own preparation and waits through uncertain status', async () => {
  const preparing = {activationId, bridgeId, pending:true, phase:'preparing'};
  const states = [
    undefined,
    preparing,
    preparing,
    {activationId, bridgeId, pending:true, phase:'paused'},
    {bridgeId, pending:false},
    {activationId:other, bridgeId, pending:false, outcome:'canceled'},
    {activationId, bridgeId:other, pending:false, outcome:'installed'},
    {activationId, bridgeId, pending:false, outcome:'canceled'},
  ];
  const acknowledgments = [];
  let reads = 0;
  await waitForAppUpdateStartup({
    async updateState() {
      assert.ok(reads < states.length);
      const row = states[reads++];
      if (!row) throw Error('Native status changing');
      return row;
    },
    async activateUpdate(value) {
      acknowledgments.push(value);
      throw Error('The acknowledgment result was lost');
    },
  }, async () => assert.ok(reads < states.length, 'The matching terminal result must release startup'));
  assert.equal(reads, states.length);
  assert.deepEqual(acknowledgments, [{activationId, bridgeId, ready:true}]);
});

test('a newly launched successor can mount after native startup reconciles the journal', async () => {
  await waitForAppUpdateStartup({
    async updateState() { return {bridgeId,pending:false}; },
    async activateUpdate() { assert.fail('No pending preparation'); },
  }, async () => assert.fail('No pause to wait for'));
});
