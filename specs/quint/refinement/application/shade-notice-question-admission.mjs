import {fileURLToPath} from 'node:url';
import {shadeNoticeQuestionFixture, shadeNoticeQuestionSources} from '../../../../test/fixtures/shade-notice-question.mjs';
import {captureInputs, checkTraces, qmap, qset} from '../check-traces.mjs';
import {call, checkpoint, trace} from './support.mjs';

const driver = fileURLToPath(import.meta.url);
const model = 'ShadeNoticeQuestionAdmission';
const fields = ({reviews, pending, ...state}) => ({'s.reviews': qmap(reviews), 's.pending': qset(pending),
  ...Object.fromEntries(Object.entries(state).map(([key, value]) => [`s.${key}`, value]))});

export async function checkShadeNoticeQuestionAdmission(extraSources = []) {
  const sources = [...new Set([driver, ...shadeNoticeQuestionSources, ...extraSources,
    fileURLToPath(new URL('./support.mjs', import.meta.url))])];
  const driverHashes = captureInputs(sources);
  const traces = [];
  async function scenario(name, run) {
    const f = shadeNoticeQuestionFixture();
    try {
      const t = trace(name, fields(f.observe()));
      const mark = (label, action) => checkpoint(t, label, action, fields(f.observe()));
      const ask = id => {f.ask(id);mark('The actual shade opens a review for notice ' + id, call('ask', id));};
      const approve = async () => {
        await f.approve();mark('The dialog closes and hands its lease to the held native read', call('approve'));
      };
      const finish = async (id, outcome, label, items) => {
        const index = f.requests.findIndex(request => request.id === id);
        if (outcome === 'unavailable') await f.refuse(index);else await f.finish(index, items);
        mark(label, call('finish', id, outcome));
      };
      await run({f, mark, ask, approve, finish});
      traces.push(t);
    } finally {f.close();}
  }
  await scenario('the exact own notice remains admitted after its own dialog closes', async c => {
    c.ask('a');await c.approve();await c.finish(1, 'exact', 'The current exact result reaches the closed composer');
  });
  await scenario('the newer review wins while the earlier exact result is held', async c => {
    c.ask('a');await c.approve();c.ask('b');
    await c.finish(1, 'exact', 'The retired result stays silent and leaves the newer dialog open');
    await c.approve();await c.finish(2, 'exact', 'The successor alone can compose its own excerpt');
  });
  await scenario('an old unavailable response leaves the successor dialog and notice alone', async c => {
    c.ask('a');await c.approve();c.ask('b');
    await c.finish(1, 'unavailable', 'An error on the old request reports nothing');
    await c.f.cancel();c.mark('Cancel retires the exact active dialog', call('cancel'));
  });
  await scenario('a new shade visit never inherits its earlier read', async c => {
    c.ask('a');await c.approve();await c.f.set({shade: false});
    c.mark('Committed shade departure retires the held lease', call('setShade', false));
    await c.f.set({shade: true});c.mark('A fresh committed shade visit has no lease', call('setShade', true));
    await c.finish(1, 'exact', 'The old result cannot compose in the fresh shade');
  });
  await scenario('locking while shade remains set retires its held question', async c => {
    c.ask('a');await c.approve();await c.f.set({screen: 'lock'});
    c.mark('The committed lock retires the old review despite the shade flag', call('setScreen', 'lock'));
    await c.finish(1, 'exact', 'The lock prevents publication from the old lease');
  });
  await scenario('visibility leave and return cannot revive a retired result or report', async c => {
    c.ask('a');await c.approve();await c.f.visibility(true);
    c.mark('The actual visibility listener retires the lease', call('visibility', true));
    await c.f.visibility(false);c.mark('The resumed list has no inherited review', call('visibility', false));
    await c.finish(1, 'exact', 'The retired read stays silent after resuming');
  });
  await scenario('an explicit Cancel before approval never starts a read', async c => {
    c.ask('a');await c.f.cancel();c.mark('The actual Cancel closes and retires the review', call('cancel'));
  });
  for (const [part, change] of [['revision', {revision: 'replaced'}], ['excerpt', {text: 'Different synthetic text'}]]) {
    await scenario('the current lease reports a changed ' + part, async c => {
      c.ask('a');await c.approve();
      const items = [{...c.f.rows[0], ...change}, c.f.rows[1]];
      await c.finish(1, 'changed', 'The current changed notice reports refusal without composing', items);
    });
  }
  await scenario('a current list error keeps the existing diagnostic', async c => {
    c.ask('a');await c.approve();await c.finish(1, 'unavailable', 'The active review reports its own read failure');
  });
  await scenario('a device-state event retires the held own notice review', async c => {
    c.ask('a');await c.approve();await c.f.deviceState();
    c.mark('The actual synthetic device event drops the current lease', call('deviceState'));
    await c.finish(1, 'exact', 'The former device state cannot populate the composer');
  });
  await scenario('a retired shell cannot publish an old read or error', async c => {
    c.ask('a');await c.approve();c.f.unmount();
    c.mark('Unmount releases the exact lease', call('unmount'));
    await c.finish(1, 'unavailable', 'A response after unmount stays silent');
  });
  return checkTraces({model, scope: 'bounded-orchestration', sources, driverHashes, traces,
    assumptions: ['Actual simulated shade adapter, notice identity and excerpt checks and content-question buttons run in closed JSDOM. A shell port commits the requested state and records synthetic composer calls. No real composer, provider or delivery port is invoked.',
      'Two eligible own notices, up to three review leases, and independent held exact, changed or unavailable reads. Ordinary list refreshes, native alert actions, real focus, and rendered shade geometry remain separate.',
      'A committed shade close, lock, visibility event, device-state event or unmount can retire a review. Uncommitted close/reopen and Android notification delivery have separate obligations.']});
}
