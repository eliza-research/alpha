import assert from 'node:assert/strict';
import {checkTraces} from '../check-traces.mjs';
import {boundInputs, bundledSource, call, captureSources, checkpoint, deferred, trace} from './support.mjs';

const clientSource = 'apps/app/src/runtime/view-navigation.ts';
const driverSource = 'specs/quint/refinement/application/completed-view-delivery.mjs';

export async function checkCompletedViewDelivery() {
  captureSources([driverSource]);
  const {exports: {ViewNavigationClient}, sources} = await bundledSource(clientSource, {'import.meta.env': '{}'});
  const previous = Object.fromEntries(['document', 'window'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.defineProperty(globalThis, 'document', {configurable: true, writable: true, value: Object.assign(new EventTarget(), {hidden: false})});
  Object.defineProperty(globalThis, 'window', {configurable: true, writable: true, value: new EventTarget()});
  const traces = [];
  try {
    for (const mode of ['accepted', 'lost-ack', 'manual-view-before-claim', 'manual-view-during-claim', 'manual-view-before-commit']) {
      let context = {view: 'home', revision: 0, sensitive: false};
      const claimStarted = deferred(), grantClaim = deferred(), commitStarted = deferred();
      const allowCommit = deferred(), resultStarted = deferred(), acknowledge = deferred();
      let claims = 0, commits = 0, destination = '';
      const reports = [];
      const client = new ViewNavigationClient(async (path, body) => {
        if (path === '/api/views/interact-claim') {
          assert.deepEqual(body, binding);
          claims++;
          destination = body.viewId;
          claimStarted.resolve();
          await grantClaim.promise;
          return {claimId: 'claim'};
        }
        assert.equal(path, '/api/views/interact-result');
        assert.deepEqual(body, {...binding, claimId: 'claim', success: body.success, result: {switched: body.success}});
        reports.push(body.success);
        resultStarted.resolve();
        return acknowledge.promise;
      }, () => true, () => context);
      const binding = {requestId: 'handoff', clientId: client.clientId, viewId: 'notes', viewType: 'gui', installationId: 'installation'};
      const handoff = [{actionName: 'VIEWS', success: true, values: {mode: 'show', viewId: 'notes', viewPath: '/notes',
        viewType: 'gui', navigationPrepared: true, completedActionHandoffId: binding.requestId, navigationBinding: binding}}];
      const observed = claim => ({'s.view': context.view, 's.revision': context.revision,
        's.claim': claim, 's.destination': claim === 'none' ? '' : destination});
      try {
        const t = trace(mode, observed('none'));
        const attempt = client.capture(context);
        assert.equal(client.currentAttempt(context), attempt);
        checkpoint(t, 'capture the exact current screen', call('capture'), {...observed('captured'), 's.captured': context.revision});
        if (mode === 'manual-view-before-claim') {
          context = {view: 'calendar', revision: 1, sensitive: false};
          await assert.rejects(client.deliver(handoff, attempt, async () => { commits++; return true; }), /screen or connection changed/);
          assert.equal(claims, 0);
          assert.equal(commits, 0);
          assert.deepEqual(reports, []);
          checkpoint(t, 'a manual view change before delivery makes no claim or result request', call('open', 'calendar'), observed('none'));
          traces.push(t);
          continue;
        }
        const delivery = client.deliver(handoff, attempt, async (target, current) => {
          commitStarted.resolve(target);
          await allowCommit.promise;
          current();
          commits++;
          context = {view: target, revision: context.revision + 1, sensitive: false};
          return true;
        }).then(result => ({result}), error => ({error}));
        await Promise.race([claimStarted.promise, delivery]);
        assert.equal(claims, 1);
        assert.equal(commits, 0);
        assert.deepEqual(reports, []);
        checkpoint(t, 'the exact transport claim has begun on the old screen', call('claim', destination), observed('claimed'));
        if (mode === 'manual-view-during-claim' || mode === 'manual-view-before-commit') {
          if (mode === 'manual-view-before-commit') {
            grantClaim.resolve();
            assert.equal(await Promise.race([commitStarted.promise, delivery]), destination);
          }
          context = {view: 'calendar', revision: 1, sensitive: false};
          assert.equal(client.currentAttempt(context), undefined);
          checkpoint(t, 'unrelated manual view retires the captured claim', call('open', 'calendar'), observed('none'));
          grantClaim.resolve();
          allowCommit.resolve();
          acknowledge.resolve({accepted: true});
          const outcome = await delivery;
          if (mode === 'manual-view-during-claim') assert.match(outcome.error?.message ?? '', /screen or connection changed/);
          else assert.equal(outcome.result?.status, 'unknown');
          assert.equal(commits, 0);
          assert.deepEqual(reports, [false]);
          assert.equal(client.deliveredContext(attempt), undefined);
        } else {
          grantClaim.resolve();
          assert.equal(await Promise.race([commitStarted.promise, delivery]), 'notes');
          assert.deepEqual(reports, []);
          allowCommit.resolve();
          await Promise.race([resultStarted.promise, delivery]);
          assert.equal(commits, 1);
          assert.deepEqual(reports, [true]);
          assert.equal(client.deliveredContext(attempt), undefined, 'a commit is not yet a verified delivery');
          checkpoint(t, 'the real result request follows the owned view commit', call('commitClaimedView', 'notes'), observed('committed'));
          if (mode === 'accepted') {
            acknowledge.resolve({accepted: true});
            assert.equal((await delivery).result?.status, 'delivered');
            assert.deepEqual(client.deliveredContext(attempt), context);
            checkpoint(t, 'the new view is accepted after the old revision was retired', call('acknowledge'), observed('delivered'));
          } else {
            acknowledge.reject(Error('Acknowledgement lost'));
            assert.match((await delivery).error?.message ?? '', /Acknowledgement lost/);
            assert.equal(client.deliveredContext(attempt), undefined);
            assert.deepEqual(reports, [true], 'a lost response does not replay the effect or send another result');
            checkpoint(t, 'lost acknowledgement keeps the actual view but does not confirm delivery', call('acknowledgementLost'), observed('unknown'));
          }
        }
        traces.push(t);
      } finally {
        grantClaim.resolve();
        allowCommit.resolve();
        acknowledge.resolve({accepted: false});
        client.dispose();
      }
    }
  } finally {
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
  return checkTraces(boundInputs({model: 'ShellNavigation', id: 'CompletedViewDelivery',
    sources: [driverSource, clientSource, ...sources], traces, scope: 'bounded-orchestration', assumptions: [
      'The full ViewNavigationClient and its pinned shared completed-action helpers execute. The transport captures exact claim/result calls, and an injected shell port commits one representative target after a controlled wait.',
      'The trace observes the client result and transport calls against injected view and revision updates. Actual React commit timing, backend ledger persistence, owner replacement and arbitrary scheduling remain separate.',
    ]}));
}
