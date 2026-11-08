import assert from 'node:assert/strict';
import {checkTraces as check} from '../check-traces.mjs';
import {bundledSource, deferred, tick, trace, checkpoint, call, captureSources, boundInputs} from './support.mjs';

const source = 'apps/app/src/runtime/alpha-client.ts';
captureSources(['specs/quint/refinement/application/clients.mjs']);
let clientModule;
const checkTraces = options => check(boundInputs({...options, sources: [...clientModule.sources,
  'specs/quint/refinement/application/clients.mjs', 'specs/quint/refinement/application/support.mjs']}));

async function fixture() {
  clientModule ??= await bundledSource(source);
  const {AlphaClient} = clientModule.exports;
  const client = new AlphaClient(), pending = [], dispatches = [];
  let operation = 'none';
  const transport = owner => ({session: {ownerId: String(owner), agentId: 'agent', sessionId: `session-${owner}`, origin: 'https://fixture.example'},
    send(input) {const task = deferred(); pending.push({task, input}); operation = 'send'; return task.promise;},
    execute(input) {const task = deferred(); dispatches.push({task, input}); operation = 'execute'; return task.promise;}, close() {}});
  const observe = () => {
    const state = client.getState();
    return {'s.connected': state.connection === 'ready', 's.sensitive': !!state.context.sensitive,
      's.epoch': client.epoch, 's.revision': state.context.revision,
      's.busy': !state.pending ? 'none' : client.activeWorkflow ? 'workflow' : operation,
      's.proposal': client.proposals.size > 0, 's.consumed': client.consumed.size > 0, 's.dispatches': dispatches.length};
  };
  const reply = proposals => ({text: 'Reply', proposals: proposals ? [{id: 'proposal', title: 'Review', description: 'One action', expiresAt: Date.now() + 60000, contextRevision: client.getState().context.revision}] : []});
  return {client, pending, dispatches, transport, observe, reply};
}

export async function assistantConversation() {
  const traces = [];
  for (const cancelAt of ['none', 'request', 'view', 'dispatch']) {
    const f = await fixture(), t = trace(`conversation-${cancelAt}`, f.observe());
    f.client.attachVerifiedTransport(f.transport(1)); checkpoint(t, 'attach verified source transport', call('connect'), f.observe());
    const sent = f.client.send('Hello'); const settled = sent.then(value => ({value}), error => ({error}));
    checkpoint(t, 'send starts at actual transport suspension', call('send'), f.observe());
    if (cancelAt === 'request' || cancelAt === 'view') {
      if (cancelAt === 'view') f.client.setViewContext({view: 'passwords', sensitive: true}); else f.client.cancel();
      checkpoint(t, 'retire in-flight source request', call(cancelAt === 'view' ? 'changeView' : 'cancel', ...(cancelAt === 'view' ? [true] : [])), f.observe());
      f.pending[0].task.resolve(f.reply(true)); const result = await settled;
      assert.ok(result.error); checkpoint(t, 'old transport completion does not publish', null, f.observe());
    } else {
      f.pending[0].task.resolve(f.reply(true)); await sent;
      checkpoint(t, 'actual reply registers proposal', call('reply'), f.observe());
      const approved = f.client.approve('proposal'); const outcome = approved.then(value => ({value}), error => ({error}));
      checkpoint(t, 'consume before external execute completion', call('approve'), f.observe());
      if (cancelAt === 'dispatch') {
        f.client.cancel(); checkpoint(t, 'cancel uncertain effect', call('cancel'), f.observe());
        f.dispatches[0].task.resolve({proposalId: 'proposal', status: 'succeeded', summary: 'done'});
        assert.ok((await outcome).error); checkpoint(t, 'late effect result cannot revive proposal', null, f.observe());
      } else {
        f.dispatches[0].task.resolve({proposalId: 'proposal', status: 'succeeded', summary: 'done'}); await approved;
        checkpoint(t, 'verified receipt', call('receipt'), f.observe());
      }
      await assert.rejects(f.client.approve('proposal'), error => error.code === 'proposal-unavailable');
      checkpoint(t, 'consumed proposal cannot dispatch again', {...call('approve'), reject: true}, f.observe());
    }
    traces.push(t);
  }
  const f = await fixture(), t = trace('automatic-workflow-ordinary-navigation', f.observe());
  f.client.attachVerifiedTransport(f.transport(1)); checkpoint(t, 'attach', call('connect'), f.observe());
  const result = f.client.generateWorkflowText('Summarize', 'input', new AbortController().signal, true);
  checkpoint(t, 'workflow starts', call('startWorkflow'), f.observe());
  f.client.setViewContext({view: 'notes'}); checkpoint(t, 'ordinary navigation retains automatic work', call('changeView', false), f.observe());
  f.client.cancel(); checkpoint(t, 'foreground cancel retains workflow', call('cancel'), f.observe());
  f.pending[0].task.resolve({text: 'Generated text'}); await result;
  checkpoint(t, 'workflow completion', call('workflowReply'), f.observe()); traces.push(t);
  return checkTraces({model: 'AssistantConversation', traces, scope: 'bounded-component', assumptions: [
    'Five schedules execute actual AlphaClient with deferred transport promises and inspect its actual state.',
    'TypeScript private fields are read by this test observer after erasure. Providers and transport validation are environmental inputs.',
    'Draft CAS has a separate adapter. Arbitrary proposal batches, invalid wire shapes and indefinite streams are outside these traces.']});
}

export async function application() {
  const f = await fixture();
  const observe = () => {const state = f.client.getState(); return {'s.owner': Number(state.session?.ownerId || 0),
    's.pending': state.pending, 's.sensitive': !!state.context.sensitive};};
  const t = trace('owner-switch-retires-actual-request', observe());
  f.client.attachVerifiedTransport(f.transport(1)); checkpoint(t, 'first verified owner', call('signIn', 1), observe());
  const request = f.client.send('First owner data').catch(error => error);
  checkpoint(t, 'start owner-bound operation', call('begin'), observe());
  f.client.attachVerifiedTransport(f.transport(2)); checkpoint(t, 'replace owner', call('signIn', 2), observe());
  f.pending[0].task.resolve({text: 'Old owner reply'}); assert.equal((await request).code, 'cancelled');
  checkpoint(t, 'retired response', call('staleCallback'), observe());
  return checkTraces({model: 'Application', traces: [t], scope: 'bounded-component', assumptions: [
    'Checks the AlphaClient ownership projection using real transport replacement and deferred completion.',
    'Application root lifecycle, voice, reset and cross-domain cached results require an orchestration adapter.']});
}
