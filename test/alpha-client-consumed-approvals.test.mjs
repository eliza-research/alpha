// The real AlphaClient (apps/app/src/runtime/alpha-client.ts) with synthetic in-memory transports:
// an approved proposal is dispatched once per agent session, also across a history reload.
import test from 'node:test';
import assert from 'node:assert/strict';
import {tsImport} from './support/ts-import.mjs';

const {AlphaClient} = await tsImport('../apps/app/src/runtime/alpha-client.ts', import.meta.url);
const session = sessionId => ({ownerId: 'synthetic-owner', agentId: 'synthetic-agent', sessionId, origin: 'https://agent.example'});
function transport(sessionId, log) {
  return {
    session: session(sessionId),
    async send(input) { return {text: 'Review this.', proposals: [{id: 'proposal-1', title: 'Send', description: 'Send it', expiresAt: Date.now() + 60_000, contextRevision: input.context.revision}]}; },
    async execute(input) { log.push(input.proposal.id); return {proposalId: input.proposal.id, status: 'succeeded', summary: 'Done'}; },
  };
}

test('a proposal approved before a history reload of the same session is refused when the agent offers it again', async () => {
  const log = [], client = new AlphaClient();
  client.attachVerifiedTransport(transport('s-1', log));
  await client.send('do it');
  await client.approve('proposal-1');
  assert.deepEqual(log, ['proposal-1']);
  // The shell reloads conversation history: it drops the transport and attaches the same session again.
  client.disconnect({keepConsumed: true});
  client.attachVerifiedTransport(transport('s-1', log));
  await assert.rejects(client.send('do it again'), {code: 'invalid-response'});
  await assert.rejects(client.approve('proposal-1'), {code: 'proposal-unavailable'});
  assert.deepEqual(log, ['proposal-1'], 'dispatched once');
});

test('another session, or a plain disconnect, starts with no consumed approvals', async () => {
  const log = [], client = new AlphaClient();
  client.attachVerifiedTransport(transport('s-1', log));
  await client.send('do it');
  await client.approve('proposal-1');
  client.disconnect({keepConsumed: true});
  client.attachVerifiedTransport(transport('s-2', log));
  await client.send('do it');
  await client.approve('proposal-1');
  assert.deepEqual(log, ['proposal-1', 'proposal-1'], 'a different agent session has its own proposals');
  client.disconnect();
  client.attachVerifiedTransport(transport('s-2', log));
  await client.send('do it');
  await client.approve('proposal-1');
  assert.equal(log.length, 3);
});
