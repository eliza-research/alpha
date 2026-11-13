import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces, qset} from '../specs/quint/refinement/check-traces.mjs';
import {call, checkpoint, deferred, sourceContext, tick, trace} from '../specs/quint/refinement/application/support.mjs';

const source = 'apps/app/src/runtime/workflow-request-recovery.ts';
const model = 'WorkflowRequestRecoveryAdmission';
const modelSources = [source, 'apps/app/src/prototype/automations-adapter.ts',
  'apps/app/src/browser/domain-recovery.ts', 'apps/app/src/runtime/workflow-intents.ts',
  'apps/app/src/prototype/template.html'];

function fixture() {
  let allowed = true, loadingFor = 0;
  const attempts = [], reports = [], publications = [], captures = [];
  const {createWorkflowRequestRecovery} = sourceContext([source], ['createWorkflowRequestRecovery']);
  const recovery = createWorkflowRequestRecovery(() => {
    const attempt = attempts[loadingFor - 1];
    attempt.loading = true;
    return attempt.module.promise;
  });
  const mark = () => ({
    's.allowed': allowed, 's.seen': attempts.length,
    's.reading': qset(attempts.filter(a => a.reading).map(a => a.id)),
    's.loading': qset(attempts.filter(a => a.loading).map(a => a.id)),
    's.offered': qset(attempts.filter(a => a.dialog).map(a => a.id)),
    's.closed': qset(attempts.filter(a => a.dialog?.signal.aborted).map(a => a.id)),
    's.captured': qset(captures), 's.saving': qset(attempts.filter(a => a.saving).map(a => a.id)),
    's.published': qset(publications), 's.reported': qset(reports),
  });
  return {
    mark, retire: recovery.retire,
    block(value) {allowed = !value;},
    depart() {allowed = false; recovery.retire();},
    open() {
      const attempt = {id: attempts.length + 1, document: deferred(), module: deferred(), save: deferred()};
      void recovery.open({
        store: {recoveryDocument() {attempt.reading = true; attempts.push(attempt); return attempt.document.promise;}},
        current: () => allowed, changed: () => publications.push(attempt.id), unavailable: () => reports.push(attempt.id),
      });
    },
    read(id, ok) {
      const attempt = attempts[id - 1];
      attempt.reading = false;
      loadingFor = id;
      if (!ok) return attempt.document.reject(Error('closed read refused'));
      attempt.document.resolve({
        capture: async () => {captures.push(id); return {raw: 'synthetic request ' + id};},
        reset: async expected => {
          if (expected.raw !== 'synthetic request ' + id) throw Error('Unexpected closed capture');
          attempt.saving = true;
          await attempt.save.promise;
        },
      });
    },
    offer(id, ok) {
      const attempt = attempts[id - 1];
      attempt.loading = false;
      if (!ok) return attempt.module.reject(Error('closed dialog load refused'));
      attempt.module.resolve((domain, name, heading, details, signal) => {
        if (name !== 'workflow requests' || heading !== 'Browser workflow request recovery' ||
          !details.includes('does not cancel executions')) throw Error('Unexpected recovery purpose');
        attempt.dialog = {domain, signal};
      });
    },
    capture(id) {
      const attempt = attempts[id - 1];
      try {void Promise.resolve(attempt.dialog.domain.capture(new AbortController().signal)).catch(() => {});}
      catch (error) {if (error.name !== 'AbortError') throw error;}
    },
    reset(id) {
      const attempt = attempts[id - 1];
      void attempt.dialog.domain.reset({raw: 'synthetic request ' + id}, new AbortController().signal)
        .catch(error => {if (error.name !== 'AbortError') throw error;});
    },
    saved(id) {
      const attempt = attempts[id - 1];
      attempt.saving = false;
      attempt.save.resolve();
    },
  };
}

async function checkWorkflowRequestRecoveryAdmission(extraSources = []) {
  const sources = [...new Set([...modelSources, fileURLToPath(import.meta.url),
    fileURLToPath(new URL('../specs/quint/refinement/application/support.mjs', import.meta.url)),
    fileURLToPath(new URL('./support/strip-types.mjs', import.meta.url)), ...extraSources])];
  const driverHashes = captureInputs(sources);
  const traces = [];
  async function scenario(name, actions) {
    const f = fixture();
    const t = trace(name, f.mark());
    try {
      for (const [action, ...args] of actions) {
        f[action](...args);
        await tick();
        checkpoint(t, [action, ...args].join(' '), call(action, ...args), f.mark());
      }
      traces.push(t);
    } finally {f.retire();}
  }
  const open = ['open'], depart = ['depart'];
  const admit = id => [open, ['read', id, true], ['offer', id, true]];
  await scenario('the current exact review can request backup and reset with the selected bytes',
    [...admit(1), ['capture', 1], ['reset', 1], ['saved', 1]]);
  await scenario('retirement during the selected dialog import cannot reopen on a new visit',
    [open, ['read', 1, true], depart, ['block', false], open, ['offer', 1, true], ['read', 2, true], ['offer', 2, true]]);
  await scenario('a successor revokes retained callbacks from its predecessor',
    [...admit(1), open, ['capture', 1], ['reset', 1], ['read', 2, true], ['offer', 2, true], ['capture', 2]]);
  await scenario('a settled reset cannot publish to an already retired visit',
    [...admit(1), ['reset', 1], depart, ['saved', 1]]);
  await scenario('only a current failure can report recovery unavailable',
    [open, open, ['read', 1, false], ['read', 2, true], ['offer', 2, false]]);
  await scenario('an unavailable owner neither reads nor opens until admitted again',
    [['block', true], open, ['block', false], ...admit(1)]);
  await scenario('invalidated selection refuses its retained callbacks before teardown',
    [...admit(1), ['block', true], ['capture', 1], ['reset', 1], depart]);
  return checkTraces({model, traces, sources, driverHashes, scope: 'bounded-component',
    assumptions: ['Actual workflow request recovery coordinator with controlled document and dialog ports. A callback records a closed fixture observation and never touches installed data.',
      'The active controller variable is private. Actual admitted reads, dialog load, close signal, controlled backup/reset calls and guarded publication are observed.',
      'The mounted Workflows fixture separately checks the real management card, dialog confirmation and account-bound IndexedDB record. Concurrent writers and physical storage remain separate.']});
}

test('workflow request recovery follows the exact admitted browser review', {timeout: 120000}, async () => {
  const receipt = await checkWorkflowRequestRecoveryAdmission([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 7);
});
