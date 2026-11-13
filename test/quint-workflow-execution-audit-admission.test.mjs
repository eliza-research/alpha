import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {captureReplayClosure} from '../specs/quint/refinement/observed-replay.mjs';
import {workflowAdapter, intentSlot, wait} from '../specs/quint/refinement/services/workflow-adapter-fixture.mjs';
import {action, deferred} from '../specs/quint/refinement/services/support.mjs';

/** Admission and retained-request projection of the complementary audit model.
 * Actual protocol validation, save, request, renderer review and journal code
 * execute; the agent transport and its admission result are controlled inputs. */
async function checkWorkflowExecutionAuditAdmission(extraSources = [], {rewrite, out} = {}) {
  const driverHashes = captureReplayClosure([fileURLToPath(import.meta.url), ...extraSources]);
  const [{WorkflowProtocol}, {normalizePhoneSpec}, {workflowSha}] = await Promise.all([
    import('../apps/app/src/runtime/workflow-protocol.ts'),
    import('../apps/app/src/runtime/phone-workflow-authoring.ts'),
    import('../apps/app/src/runtime/workflow-device-contract.ts'),
  ]);
  const spec = normalizePhoneSpec({version: 1, name: 'Admission audit', description: '', trigger: {kind: 'manual'},
    steps: [{id: 'input', kind: 'Read', operation: 'supplied_text', text: 'Reviewed synthetic input'}]});
  const digest = await workflowSha(spec), catalog = {catalogRevision: 'audit-catalog', compilerRevision: 'audit-compiler'};
  const traces = [];
  async function scenario(name, legacy, run) {
    const storage = {}, posts = [], requests = [], admitted = new Map();
    let app, currentVersion = 'v0', lastReconciled = null;
    const flow = () => ({id: 'flow', name: 'Admission audit', description: '', active: false, versionId: currentVersion,
      steps: [], metadata: {elizaPhoneWorkflowSpec: JSON.stringify(spec)}});
    const execution = version => ({id: 'run', workflowId: 'flow', workflowVersionId: version,
      status: 'running', finished: false, startedAt: '2026-11-01T00:00:00.000Z', events: []});
    const request = async (path, body) => {
      requests.push({path, body});
      if (path === '/api/workflow/phone/validate') return {spec, specDigest: digest, ...catalog, active: false};
      if (path === '/api/workflow/phone/workflows') return {receipt: {mutationId: 'audit-save', workflowId: 'flow', operation: 'create',
        previousVersionId: null, versionId: currentVersion, specDigest: digest, compilerRevision: catalog.compilerRevision, appliedAt: '2026-11-01T00:00:00Z'}};
      if (path.endsWith('/status')) return {engine: 'smthrs', status: 'ready', ...(legacy ? {} : {manualSubmissionProtocol: 1})};
      if (path === '/api/workflow/workflows') return {workflows: [flow()]};
      if (path === '/api/workflow/workflows/flow') return flow();
      if (path.endsWith('/executions')) return {executions: []};
      if (path.includes('/submissions/')) {
        const id = path.split('/').at(-1);return {submissionId: id, execution: admitted.get(id) ?? null};
      }
      if (path.endsWith('/run')) {
        const raw = storage[intentSlot('flow')];assert.ok(raw, 'Real journal admission must precede the transport effect');
        const held = JSON.parse(raw);assert.equal(held.workflowId, 'flow');assert.equal(held.versionId, 'v0');
        assert.equal(held.submissionId, body.submissionId);
        if (!legacy) assert.equal(body.expectedVersionId, held.versionId);
        const task = {...deferred(), body, raw};posts.push(task);return task.promise;
      }
      throw Error('Unused closed workflow request: ' + path);
    };
    const client = new WorkflowProtocol(request);
    const reconcile = client.reconcile.bind(client);
    client.reconcile = async (...args) => {const result = await reconcile(...args);lastReconciled = result;return result;};
    const ownerReview = () => !!app && ['Confirm resend', 'Confirm clear'].includes(app.render().fd?.runLabel);
    const observe = () => {
      const raw = storage[intentSlot('flow')], rendered = app?.render(), detail = rendered?.fd;
      const result = {'s.intentSaved': raw !== undefined, 's.ownerReview': ownerReview()};
      if (rendered?.runOpen) result['s.phase'] = 'running';
      else if (detail && raw && !detail.busy) result['s.phase'] = /^Not received/.test(detail.last) ? 'unadmitted' : 'uncertain';
      else if (detail?.busy && raw) result['s.phase'] = 'submitting';
      if (lastReconciled) result['s.ranVersion'] = Number(lastReconciled.versionId.slice(1));
      return result;
    };
    const trace = {name, init: action(legacy ? 'initLegacy' : 'initFor', false), expect: observe(), steps: []};
    const mark = (label, operation) => trace.steps.push({label, action: operation, expect: observe()});
    const signal = new AbortController().signal;
    try {
      const validated = await client.validatePhone(spec, catalog, signal);
      assert.equal(validated.specDigest, digest);mark('Actual source validates the reviewed spec digest', action('validate'));
      const saved = await client.savePhone(spec, catalog, {mutationId: 'audit-save', specDigest: digest, compilerRevision: catalog.compilerRevision}, signal);
      assert.equal(saved.versionId, 'v0');mark('Actual save receipt installs the reviewed workflow', action('save'));
      app = await workflowAdapter({client, storage, rewrite});
      const open = async () => {app.render().openWorkflow('flow');await wait(() => app.render().detail && !app.render().fd.busy);};
      await open();
      const begin = async () => {
        app.render().fd.run();assert.equal(posts.length, 0, 'Initial run requires its own review');
        app.render().fd.run();await wait(() => posts.length === 1 && !!storage[intentSlot('flow')]);
        mark('Actual beforeSubmit stores the exact request before dispatch', action('retainSubmission', true));
        return posts[0];
      };
      const take = task => {
        const result = execution(currentVersion);task.execution = result;
        if (task.body.submissionId) admitted.set(task.body.submissionId, result);
        mark('Controlled agent admits the received identity', action('serverAdmit'));
      };
      const answer = async (task, lost = false) => {
        if (lost) task.reject(Error('Synthetic workflow reply lost'));
        else task.resolve({...(task.body.submissionId ? {submissionId: task.body.submissionId} : {}), execution: task.execution});
        await wait(() => !app.render().fd.busy);
        mark('Actual renderer retains unknown requests or accepts an exact receipt', action(lost ? 'unknownSubmission' : task.execution.workflowVersionId === 'v0' ? 'receipt' : 'versionMismatch'));
      };
      const restart = async () => {app.restart();mark('New actual renderer restores its persisted request', action('restart'));await open();mark('Actual reconciliation reads the reviewed identity', action('reconcile'));};
      await run({app, client, storage, posts, requests, begin, take, answer, restart, mark, observe,
        changeVersion() {currentVersion = 'v1';mark('Independent agent changes the workflow version', action('remoteEdit'));},
        async remountLegacy() {app.restart();mark('Legacy request survives a new renderer', action('restart'));await open();},
        async resend() {
          const before = posts.length;app.render().fd.run();
          assert.equal(posts.length, before, 'Retained resend requires owner confirmation');
          assert.equal(app.render().fd.runLabel, 'Confirm resend', 'Retained resend requires owner confirmation');
          mark('First actual Resend tap is a review only', action('resend'));
          app.render().fd.run();await wait(() => posts.length === before + 1);
          assert.equal(posts.at(-1).body.submissionId, posts[0].body.submissionId, 'A resend preserves the original identity');
          mark('Confirmed actual resend uses the retained submission', action('resend'));return posts.at(-1);
        }});
      traces.push(trace);
    } finally {for (const task of posts) task.reject(Error('Fixture closed'));app?.close();}
  }
  await scenario('accepted exact-version run clears its real durable admission', false, async c => {
    const task = await c.begin();c.take(task);await c.answer(task);assert.equal(c.observe()['s.intentSaved'], false);assert.equal(c.posts.length, 1);
  });
  await scenario('an unseen request waits for an explicit same-identity resend', false, async c => {
    const task = await c.begin();await c.answer(task, true);await c.restart();
    assert.equal(c.observe()['s.phase'], 'unadmitted');const repeated = await c.resend();c.take(repeated);await c.answer(repeated);
  });
  await scenario('an admitted lost reply reconciles without another dispatch', false, async c => {
    const task = await c.begin();c.take(task);await c.answer(task, true);await c.restart();
    assert.equal(c.observe()['s.intentSaved'], false);assert.equal(c.posts.length, 1);
  });
  await scenario('changed-version absence releases only the exact old admission', false, async c => {
    const task = await c.begin();await c.answer(task, true);c.changeVersion();await c.restart();
    assert.equal(c.observe()['s.intentSaved'], false);assert.equal(c.posts.length, 1);
    assert.ok(c.app.toasts.includes('Not run · Workflow changed'));
  });
  await scenario('a legacy unknown request is cleared only by its owner and sends nothing', true, async c => {
    const task = await c.begin();await c.answer(task, true);await c.remountLegacy();
    c.app.render().fd.run();assert.equal(c.app.render().fd.runLabel, 'Confirm clear', 'Removing a retained legacy request requires owner confirmation');
    assert.equal(c.observe()['s.intentSaved'], true, 'First legacy clear tap retains the request');c.mark('First actual clear tap discloses uncertainty', action('clearRequest'));
    c.app.render().fd.run();await wait(() => !c.observe()['s.intentSaved'] && !c.app.render().fd.busy);
    c.mark('Confirmed actual clear removes the journal without dispatch', action('clearRequest'));assert.equal(c.posts.length, 1);
  });
  await scenario('legacy reply for another version stays unaccepted and retained', true, async c => {
    const task = await c.begin();c.changeVersion();c.take(task);await c.answer(task);
    assert.equal(c.app.render().runOpen, false);assert.equal(c.observe()['s.intentSaved'], true);assert.equal(c.posts.length, 1);
  });
  const receipt = await checkTraces({model: 'WorkflowExecutionAuditAdmission', sources: Object.keys(driverHashes), driverHashes, traces, out,
    scope: 'bounded-orchestration', assumptions: [
      'Actual WorkflowProtocol validation/save/version checks, renderer run/resend/clear reviews and owner-isolated WorkflowIntentStore execute with the existing functional renderer fixture.',
      'Six selected production/manual schedules use one workflow and at most two transport submissions. The agent is a controlled port: its exact-once engine behavior is not proved by these source observations.',
      'The projection observes real journal presence, owner review, visible request/admission states and actual reconciled version identities. Approval graph effects, triggers, owner switches, legacy remote execution counts and arbitrary interleavings remain explicit unobserved obligations.']});
  return {receipt, obligations: [{model: receipt.model, obligation: 'Composed authoring, approval, trigger and agent execution refinement',
    reason: 'This source-bound admission projection preserves the independent audit model; it does not replace the canonical WorkflowExecution driver or claim all audit fields were observed.'}]};
}

// The existing renderer fixture imports the application's extensionless TS graph.

const own = fileURLToPath(import.meta.url);
test('workflow admission audit observes actual protocol, journal and renderer recovery', {timeout: scaledTimeout(180000)}, async () => {
  const {receipt} = await checkWorkflowExecutionAuditAdmission([own]);
  assert.equal(receipt.passed, true);assert.equal(receipt.inputsUnchanged, true);assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 6);assert.equal(receipt.checkpoints, 48);
  assert.deepEqual(receipt.observedFields, ['s.intentSaved', 's.ownerReview', 's.phase', 's.ranVersion']);
  for (const action of ['validate', 'save', 'retainSubmission', 'serverAdmit', 'receipt', 'unknownSubmission', 'restart', 'reconcile', 'resend', 'clearRequest', 'versionMismatch'])
    assert.ok(receipt.actions[action] > 0, action);
});

for (const [name, rewrite, expected] of [
  ['resend dispatch bypasses its owner review', source => source.replace('if(request){if(!reviewResend){', 'if(request){if(false&&!reviewResend){'), /Retained resend requires owner confirmation/],
  ['legacy clear bypasses its owner review', source => source.replace('if(stuck){if(!reviewClear){', 'if(stuck){if(false&&!reviewClear){'), /Removing a retained legacy request requires owner confirmation/],
]) test('admission audit rejects actual-source mutation: ' + name, {timeout: scaledTimeout(180000)}, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-workflow-audit-canary-'));
  try {
    await assert.rejects(checkWorkflowExecutionAuditAdmission([own], {rewrite, out: join(directory, 'receipt.json')}), expected);
  } finally {rmSync(directory, {recursive: true, force: true});}
});
