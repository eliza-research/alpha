import {fileURLToPath} from 'node:url';
import {committedViewFixture, committedViewSources} from '../../../../test/fixtures/committed-view-observation.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {call, checkpoint, tick, trace} from './support.mjs';

const model = 'CommittedViewObservation';

function projection(f, returned) {
  const count = suffix => f.calls.filter(call => call.path.endsWith(suffix)).length;
  const latest = f.calls.findLast(call => call.path.endsWith('interact-result'));
  return {'s.view': f.observedView, 's.hidden': f.context.document.hidden, 's.session': f.session,
    's.disposed': f.client.disposed, 's.cacheView': f.client.observationView ?? '',
    's.accepted': f.client.observationAccepted, 's.returned': returned,
    's.host': f.outcome, 's.lastReply': latest ? (latest.body.success ? 'positive' : 'negative') : 'none',
    's.prepares': count('/navigate'), 's.claims': count('interact-claim'), 's.replies': count('interact-result'),
    's.history': f.history};
}

export async function checkCommittedViewObservation(extraSources = []) {
  const sources = [...new Set([...committedViewSources, ...extraSources, fileURLToPath(import.meta.url),
    fileURLToPath(new URL('../../../../test/fixtures/committed-view-observation.mjs', import.meta.url)),
    fileURLToPath(new URL('../../../../test/support/strip-types.mjs', import.meta.url)),
    fileURLToPath(new URL('./support.mjs', import.meta.url))])];
  const driverHashes = captureInputs(sources);
  const traces = [];
  async function scenario(name, run) {
    const f = committedViewFixture('unchanged');
    let returned = 'none';
    const t = trace(name, projection(f, returned));
    const mark = (label, action) => checkpoint(t, label, action, projection(f, returned));
    try {
      await run({
        async observe(mode, retry = false) {
          f.setMode(mode);
          returned = String(await f.client.observeCommittedView(retry));
          await tick();
          mark('Settle actual renderer observation with ' + mode, call('observe', mode, retry));
        },
        async expire() {
          f.expire();
          await tick();
          mark('Fire the actual pending host deadline', call('expire'));
        },
        hide(value) {f.context.document.hidden = value;mark('Change fixture document visibility', call('hide', value));},
        setView(value) {f.setView(value);mark('Commit the fixture view', call('setView', value));},
      });
      traces.push(t);
    } finally {f.close();}
  }
  await scenario('the exact receipt is cached across same-view reads and changes on a new view', async c => {
    await c.observe('unchanged'); await c.observe('unchanged'); c.setView('settings'); await c.observe('unchanged');
  });
  for (const mode of ['before','after','deadline','disposed','negative-lost']) {
    await scenario(mode + ' retires the exact host waiter without history', async c => {await c.observe(mode);});
  }
  for (const mode of ['retired','retired-after-claim','lost-prepare','invalid-binding','claim-lost','cleanup-denied','cleanup-retired','installation-retired','bad-nonce']) {
    await scenario(mode + ' leaves the host to its genuine timeout', async c => {await c.observe(mode);await c.expire();});
  }
  await scenario('a lost positive receipt leaves one host commit and no default replay', async c => {
    await c.observe('positive-lost'); await c.observe('unchanged');
  });
  await scenario('hiding during claim retires that waiter and preserves the next view', async c => {
    await c.observe('superseded-claim');c.hide(false);await c.observe('unchanged');
  });
  await scenario('a failed view is cached until explicit retry', async c => {
    await c.observe('invalid-binding');await c.expire();await c.observe('unchanged');await c.observe('unchanged', true);
  });
  return checkTraces({model, sources, driverHashes, traces, scope: 'bounded-orchestration',
    assumptions: ['Actual ViewNavigationClient, shared installation registry, ViewInteractionHost, pending map and route settlement callback execute together through a closed request port. The history writer records only synthetic commits.',
      'Two views and up to two attempts per trace. Each observation checkpoint is a settled source call. The source test drives selected losses, stale claims, timer expiration, visibility and explicitly retried reads.',
      'Real renderer delivery, account authentication, transport framing, arbitrary interleavings and an actual history backend remain separate.']});
}
