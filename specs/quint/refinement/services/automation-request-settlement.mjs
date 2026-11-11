import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {action, deferred, sourceModule, until} from './support.mjs';

const adapter = 'apps/app/src/prototype/automations-adapter.ts';
const originalFixture = 'test/automations-unified.test.mjs';
const prefix = 'alpha.workflow.pending.v1:';
const none = {id: 0, kind: 'none', target: false};

/** Reuse the owning test's functional renderer fixture without importing its
 * node:test registrations. Only a read-only closure observer is added. */
async function factory(capture, rewrite) {
  const protocol = {...await sourceModule('apps/app/src/runtime/automations-protocol.ts', {}, capture),
    ...await sourceModule('apps/app/src/runtime/workflow-local-time.ts', {}, capture)};
  const {homeReadIsStale, presentHomeWorkflowFreshness} = await sourceModule('apps/app/src/prototype/home-cards.ts', {}, capture);
  capture([originalFixture]);
  const text = fs.readFileSync(originalFixture, 'utf8');
  const from = text.indexOf('function adapterFixture('), to = text.indexOf('\nconst wait=', from);
  assert.ok(from >= 0 && to > from, 'Exact owning automation fixture must remain available');
  const fixture = text.slice(from, to).replace('return {window:context.window',
    'return {inspect:()=>context.inspectSettlement(),session,window:context.window');
  const transformed = file => {
    capture([file]);
    let source = fs.readFileSync(file, 'utf8');
    if (file === adapter) {
      if (rewrite) {const changed = rewrite(source);assert.notEqual(changed, source, 'Settlement mutation must change actual source');source = changed;}
      const anchor = ' const mount=p.componentDidMount,unmount=p.componentWillUnmount;';
      assert.ok(source.includes(anchor), 'Read-only automation closure observer anchor');
      source = source.replace(anchor, ' globalThis.inspectSettlement=()=>({state,busy:!!controller,loadedSession,session,rows,uncertain:[...uncertain]});\n' + anchor);
    }
    return stripTypeScriptTypes(source.replace(/^import .*;\n/gm, '').replace(/export /g, ''), {mode: 'transform'});
  };
  const context = {vm, fs, protocol, transformed, homeReadIsStale, presentHomeWorkflowFreshness,
    queueMicrotask, AbortController, Date, crypto, Event, console};
  vm.runInNewContext(fixture + '\nglobalThis.create=adapterFixture;', context);
  return (request, storage) => {
    const app = context.create(request, storage, {deviceReminders: []});
    app.window.confirm = () => true;
    return app;
  };
}

export async function checkAutomationRequestSettlement(extraSources = [], {rewrite, out} = {}) {
  const sources = new Set([fileURLToPath(import.meta.url), originalFixture, adapter,
    'test/support/strip-types.mjs', 'specs/quint/refinement/services/support.mjs',
    'apps/app/src/runtime/workflow-intents.ts', 'upstream.lock.json', 'scripts/prepare-client-features.ts',
    '.eliza/client-features/.source.json', ...extraSources]);
  let driverHashes = captureInputs([...sources]);
  const capture = paths => {
    for (const path of paths) sources.add(path);
    const next = captureInputs([...sources]);
    for (const [path, hash] of Object.entries(driverHashes)) assert.equal(next[path], hash, 'Source changed before automation execution: ' + path);
    driverHashes = next;
  };
  const create = await factory(capture, rewrite), traces = [];
  async function scenario(name, run) {
    let exists = true, enabled = false, complete = true, holdReads = false, readGate = deferred();
    const requests = [], storage = {}, admitted = new Map();
    const row = () => ({id: 'trigger:prompt', type: 'coordinator_text', title: 'Owner prompt',
      description: 'Synthetic prompt', enabled, status: enabled ? 'active' : 'paused', triggerId: 'prompt', schedules: []});
    const rawEntries = () => Object.entries(storage).filter(([key]) => key.startsWith(prefix));
    async function request(path, method, body) {
      if (method !== 'GET') {
        assert.ok((path === '/api/triggers/prompt' && ['PUT', 'DELETE'].includes(method)) || (path === '/api/triggers/prompt/execute' && method === 'POST'));
        const [[key, raw]] = rawEntries();
        const intent = JSON.parse(raw);
        assert.equal(intent.method, method);assert.equal(intent.path, path);
        assert.deepEqual(JSON.parse(JSON.stringify(intent.body ?? null)), JSON.parse(JSON.stringify(body ?? null)));
        assert.ok(key.includes('automation:trigger:prompt'), 'Actual journal admission precedes dispatch');
        if (!admitted.has(raw)) admitted.set(raw, admitted.size + 1);
        const task = {...deferred(), id: requests.length + 1, path, method, body, raw, applied: false};
        requests.push(task);return task.promise;
      }
      if (holdReads) await readGate.promise;
      if (path === '/api/automations') {
        if (!complete) throw Object.assign(Error('Synthetic incomplete automation list'), {status: 503});
        return {automations: exists ? [row()] : []};
      }
      if (path.startsWith('/api/lifeops/scheduled-tasks')) return {tasks: []};
      if (path === '/api/lifeops/reminders') return {reminders: []};
      if (path === '/api/lifeops/definitions') return {definitions: []};
      throw Error('Unused closed automation read: ' + path);
    }
    const app = create(request, storage);
    const inspect = () => app.inspect();
    function observe() {
      const state = inspect(), entries = rawEntries();assert.ok(entries.length <= 1);
      const mutationBusy = state.busy && state.state !== 'loading';
      let retained = none;
      if (entries.length) {
        const raw = entries[0][1], intent = JSON.parse(raw);
        assert.ok(admitted.has(raw), 'Observed lock belongs to a genuinely dispatched admitted request');
        retained = {id: admitted.get(raw), kind: intent.method === 'DELETE' ? 'delete' : intent.method === 'PUT' ? 'enable' : 'fire', target: intent.method === 'PUT' ? intent.body.enabled : false};
      }
      const known = state.rows.find(row => row.key === 'trigger:prompt');
      const loaded = state.loadedSession === app.session.sessionId;
      return {'s.retained': retained, 's.busy': mutationBusy,
        's.loaded': loaded,
        's.unknown': !mutationBusy && state.uncertain.some(key => entries.some(([entry]) => entry === key)),
        ...(loaded ? {'s.knownExists': !!known, ...(known ? {'s.knownEnabled': known.enabled} : {})} : {})};
    }
    try {
      app.render();await until(() => inspect().state === 'ready' && !inspect().busy, 'initial actual automation list');
      app.render().cards[0].open();
      const trace = {name, init: action('init'), expect: observe(), steps: []};
      const mark = (label, operation) => trace.steps.push({label, action: operation, expect: observe()});
      const change = async (kind, target = false) => {
        const nextRequest = requests.length + 1;
        holdReads = true;readGate = deferred();
        const label = kind === 'delete' ? 'Delete prompt' : kind === 'fire' ? 'Run now' : target ? 'Enable' : 'Pause';
        const control = app.render().automation.actions.find(control => control.label === label);
        assert.ok(control && !control.disabled, 'Actual row admits reviewed ' + label);
        control.run();assert.equal(app.render().automation.review, true);
        app.render().automation.confirm();
        await until(() => requests.length === nextRequest && admitted.size === nextRequest && inspect().busy && requests.at(-1)?.raw === rawEntries()[0]?.[1], 'actual retained mutation dispatch');
        mark('Actual reviewed request is journaled before dispatch', action('change', kind, target));
        return requests.at(-1);
      };
      const take = task => {
        assert.equal(task.applied, false);
        task.applied = true;
        task.reply = exists ? 'ok' : 'rejected';
        if (exists) {if (task.method === 'DELETE') exists = false;else if (task.method === 'PUT') enabled = task.body.enabled;}
        mark('Controlled agent applies the exact received request', action('serverTake', {id: task.id, kind: task.method === 'DELETE' ? 'delete' : task.method === 'PUT' ? 'enable' : 'fire', target: task.method === 'PUT' ? task.body.enabled : false}));
      };
      const answer = async (task, unknown = false) => {
        if (unknown) task.reject(Error('Synthetic reply lost after dispatch'));
        else if (task.reply === 'rejected') task.reject(Object.assign(Error('Synthetic definite refusal'), {status: 404}));
        else task.resolve(task.method === 'DELETE' ? {ok: true} : task.method === 'PUT' ? {trigger: {id: 'prompt', enabled: task.body.enabled}} : {ok: true, result: {status: 'success'}});
        await until(() => inspect().state === 'loading' && inspect().busy, 'post-request actual read held at the boundary');
        mark('Actual caller settles without manufacturing a receipt', action(unknown ? 'unknownReply' : task.reply === 'rejected' ? 'refusedReply' : 'okReply'));
      };
      const refresh = async all => {
        complete = all;holdReads = false;readGate.resolve();
        if (inspect().state !== 'loading') app.render().automation.refresh();
        await until(() => inspect().state === 'ready' && !inspect().busy, 'actual complete or partial read settlement');
        mark('Actual list proof settles only eligible retained changes', action('refresh', all));
      };
      await run({app, requests, change, take, answer, refresh, mark, observe,
        remoteToggle() {enabled = !enabled;mark('Independent agent state changes', action('remoteToggle'));}});
      traces.push(trace);
    } finally {holdReads = false;readGate.resolve();for (const task of requests) task.reject(Error('Fixture closed'));app.close();}
  }
  await scenario('lost delete reply is settled only by the complete exact source', async c => {
    const task = await c.change('delete');c.take(task);await c.answer(task, true);await c.refresh(true);
    assert.equal(c.observe()['s.retained'].kind, 'none');assert.equal(c.requests.length, 1);
  });
  await scenario('partial source cannot release an applied unknown deletion', async c => {
    const task = await c.change('delete');c.take(task);await c.answer(task, true);await c.refresh(false);
    assert.equal(c.observe()['s.retained'].kind, 'delete', 'Partial source must retain unknown deletion');
    const writes = c.requests.length;const control = c.app.render().automation.actions.find(control => control.label === 'Run now');
    if (control) {assert.equal(control.disabled, true);control.run();}
    assert.equal(c.requests.length, writes);
    c.mark('A locked row refuses a second run', {...action('change', 'fire', false), reject: true});
  });
  await scenario('a complete list cannot prove a run; owner release never resends', async c => {
    const task = await c.change('fire');c.take(task);await c.answer(task, true);await c.refresh(true);
    assert.equal(c.observe()['s.retained'].kind, 'fire', 'Complete list cannot prove prior run');
    c.app.render().automation.allowAnother();await until(() => c.observe()['s.retained'].kind === 'none' && !c.app.inspect().busy, 'actual owner release');
    c.mark('Owner acknowledges uncertainty without a second effect', action('allowAnother'));assert.equal(c.requests.length, 1);
  });
  await scenario('known delete receipt releases the journal before the next list', async c => {
    const task = await c.change('delete');c.take(task);await c.answer(task);await c.refresh(true);
    assert.equal(c.observe()['s.retained'].kind, 'none');assert.equal(c.requests.length, 1);
  });
  await scenario('a replacement connection cannot change an unread row', async c => {
    c.app.retire();c.mark('The actual connection observer retires the old read', action('switchConnection'));
    const before = c.requests.length, controls = c.app.render().automation;
    controls.actions.find(control => control.label === 'Enable')?.run();
    assert.equal(c.requests.length, before);c.mark('Unread row cannot dispatch', {...action('change', 'enable', true), reject: true});
  });
  await scenario('readback can settle an enable whose remote request later overrides a newer choice', async c => {
    const old = await c.change('enable', true);await c.answer(old, true);c.remoteToggle();await c.refresh(true);
    const fresh = await c.change('enable', false);c.take(fresh);await c.answer(fresh);
    c.take(old);assert.equal(c.requests.length, 2);await c.refresh(true);assert.equal(c.observe()['s.knownEnabled'], true);
  });
  const receipt = await checkTraces({model: 'AutomationRequestSettlement', sources: [...sources], driverHashes, traces, out,
    scope: 'bounded-orchestration', assumptions: [
      'The actual Automations renderer, AutomationsProtocol and owner-isolated WorkflowIntentStore execute through the owning functional fixture. The observer reads closure state and durable slot bytes only.',
      'Six selected complete/partial-list, lost-reply, known-reply, owner release, unread-connection and delayed-server schedules use one prompt and at most two mutations. Remote application and reply timing are controlled ports, not an upstream-agent refinement claim.',
      'Retained request IDs are equality classes assigned to actual admitted raw journal bytes. Release reasons, every remote engine counter, reminders and arbitrary interleavings remain unobserved obligations.']});
  return {receipt, obligations: [{model: receipt.model, obligation: 'Unrestricted source scheduling and agent execution',
    reason: 'The bounded projection observes real local journal/lock/list behavior; remote engine effects, full flight-state ghosts and all mutation histories remain outside this source campaign.'}]};
}
