import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname, extname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sdk = join(root, 'vendor/eliza');
const core = 'vendor/eliza/packages/core/src/';
const contracts = 'vendor/eliza/packages/contracts/src/';
const scheduling = 'vendor/eliza/plugins/plugin-scheduling/src/';
const route = '/api/lifeops/scheduled-tasks';
const agentId = 'closed-agent';
const taskId = 'weekly';
const hiddenId = 'hidden';
const clockStart = Date.parse('2026-09-22T12:00:00.000Z');
const turn = () => new Promise(resolve => setImmediate(resolve));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let compiled;

async function compile() {
  const metadata = [fileURLToPath(import.meta.url), join(root, 'upstream.lock.json'),
    join(root, 'package-lock.json'), join(sdk, 'bun.lock'), join(sdk, 'plugins/plugin-scheduling/package.json')];
  const hashes = Object.fromEntries(metadata.map(path => [path, digest(readFileSync(path))]));
  const pin = JSON.parse(readFileSync(metadata[1], 'utf8')).commit;
  assert.equal(execFileSync('git', ['-C', sdk, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), pin);
  const aliases = {
    '@elizaos/core': [
      ['ElizaError', 'errors.ts'],
      ['isMissedScheduledOccurrence,computeNextCronRunAtMs,parseCronExpression', 'services/trigger-scheduling.ts'],
      ['isLoopbackRemoteAddress', 'security/loopback-trust.ts'],
      ['stableStringify', 'utils/deterministic.ts'],
      ['stringToUuid', 'utils/string-to-uuid.ts'],
    ].map(([names, path]) => `export {${names}} from "./${core + path}";`).join('\n'),
    '@elizaos/contracts': [
      ['DEFAULT_TASK_EXECUTION_PROFILE,TASK_EXECUTION_PROFILES', 'contracts/scheduled-task-execution.ts'],
      ['isValidTimeZone', 'lifeops-normalize/time-zone.ts'],
    ].map(([names, path]) => `export {${names}} from "./${contracts + path}";`).join('\n'),
  };
  const exports = [
    ['makeScheduledTasksRouteHandler', 'routes/scheduled-tasks.ts'],
    ['createScheduledTaskRunner,createInMemoryScheduledTaskStore', 'scheduled-task/runner.ts'],
    ['createInMemoryScheduledTaskLogStore', 'scheduled-task/state-log.ts'],
    ['createTaskGateRegistry', 'scheduled-task/gate-registry.ts'],
    ['createCompletionCheckRegistry', 'scheduled-task/completion-check-registry.ts'],
    ['createEscalationLadderRegistry', 'scheduled-task/escalation.ts'],
    ['createAnchorRegistry,createConsolidationRegistry', 'scheduled-task/consolidation-policy.ts'],
  ];
  const artifact = await build({
    absWorkingDir: root, bundle: true, write: false, format: 'esm', platform: 'node', preserveSymlinks: true,
    stdin: {contents: exports.map(([names, path]) => `export {${names}} from "./${scheduling + path}";`).join('\n'),
      resolveDir: root, sourcefile: 'lifeops-route-entry.ts'},
    plugins: [{name: 'exact-scheduling-exports', setup(builder) {
      builder.onResolve({filter: /^@elizaos\/(core|contracts)$/}, ({path}) => ({path, namespace: 'exports'}));
      builder.onLoad({filter: /.*/, namespace: 'exports'}, ({path}) => ({contents: aliases[path], resolveDir: root, loader: 'js'}));
      builder.onLoad({filter: /\.(?:tsx?|mjs|cjs|js|json)$/, namespace: 'file'}, ({path}) => {
        const contents = readFileSync(path);
        hashes[path] = digest(contents);
        const extension = extname(path).slice(1);
        return {contents, loader: ['mjs', 'cjs'].includes(extension) ? 'js' : extension, resolveDir: dirname(path)};
      });
    }}],
  });
  const sdkSources = Object.keys(hashes).filter(path => path.startsWith(sdk + '/')).map(path => relative(sdk, path));
  execFileSync('git', ['-C', sdk, 'diff', '--quiet', pin, '--', ...sdkSources]);
  for (const [path, hash] of Object.entries(hashes)) assert.equal(digest(readFileSync(path)), hash, path);
  const implementation = await import('data:text/javascript;base64,' + Buffer.from(artifact.outputFiles[0].contents).toString('base64'));
  return {implementation, hashes};
}

function deferred() {
  let resolve;
  const promise = new Promise(yes => {resolve = yes;});
  return {promise, resolve};
}

function seed(id, ownerVisible) {
  return {taskId: id, kind: 'reminder', promptInstructions: 'Review the week.',
    trigger: {kind: 'manual'}, priority: 'low', respectsGlobalPause: true,
    source: 'user_chat', createdBy: 'closed-owner', ownerVisible,
    state: {status: 'scheduled', followupCount: 0}};
}

/** Real SDK routes, independent runners and stores with a controlled pre-egress and receipt port. */
export async function lifeOpsScheduledTaskRouteFixture() {
  const {implementation: sdk, hashes} = await (compiled ??= compile());
  const store = sdk.createInMemoryScheduledTaskStore();
  const logStore = sdk.createInMemoryScheduledTaskLogStore();
  await store.upsert(seed(taskId, true));
  await store.upsert(seed(hiddenId, false));
  let clock = 1, paused = false;
  const claimGates = new Map(), dispatchGates = new Map(), requests = new Map();
  const claims = [], writes = [], guards = [], egress = [];
  let reply = {status: 0, body: {}};
  const now = () => new Date(clockStart + clock * 60_000);
  const occurrence = value => value ? (Date.parse(value) - clockStart) / 60_000 : 0;
  function runner(actor) {
    return sdk.createScheduledTaskRunner({
      agentId, logStore, now,
      store: {...store,
        async claimForFire(args) {
          assert.equal(claimGates.has(actor), false);
          const gate = {...deferred(), at: occurrence(args.firedAtIso)};
          claimGates.set(actor, gate);
          await gate.promise;
          claimGates.delete(actor);
          const result = await store.claimForFire(args);
          claims.push({actor, result: result.kind, at: occurrence(args.firedAtIso)});
          return result;
        },
        async upsertIfStatus(task, expected) {
          const before = await store.get(task.taskId);
          const accepted = await store.upsertIfStatus(task, expected);
          writes.push({actor, accepted, status: task.state.status, at: occurrence(task.state.firedAt),
            beforeAt: occurrence(before?.state.firedAt), expectedStatus: expected.expectedStatus,
            expectedAt: occurrence(expected.expectedState?.firedAt)});
          return accepted;
        },
      },
      gates: sdk.createTaskGateRegistry(), completionChecks: sdk.createCompletionCheckRegistry(),
      ladders: sdk.createEscalationLadderRegistry(), anchors: sdk.createAnchorRegistry(),
      consolidation: sdk.createConsolidationRegistry(), ownerFacts: () => ({}),
      globalPause: {current: async () => ({active: paused})},
      activity: {hasSignalSince: () => false}, subjectStore: {wasUpdatedSince: () => false},
      dispatcher: {async dispatch(record) {
        assert.equal(dispatchGates.has(actor), false);
        const admission = deferred(), result = deferred();
        const claimed = await store.get(record.taskId);
        const at = occurrence(record.firedAtIso);
        const gate = {admission, result, phase: 'prepare', at, completed: occurrence(claimed?.state.completedAt)};
        dispatchGates.set(actor, gate);
        await admission.promise;
        const current = await store.get(record.taskId);
        const currentAt = occurrence(current?.state.firedAt);
        try {await record.assertStillFired();}
        catch (error) {
          guards.push({actor, at, currentAt, allowed: false});
          dispatchGates.delete(actor);
          throw error;
        }
        guards.push({actor, at, currentAt, allowed: true});
        gate.phase = 'egress';
        egress.push({actor, at});
        const outcome = await result.promise;
        dispatchGates.delete(actor);
        if (outcome === 'throw') throw Error('Synthetic dispatcher refusal');
        return {ok: true, messageId: 'closed-' + actor};
      }},
    });
  }
  const handlers = Object.fromEntries([1, 2].map(actor => {
    const runtime = runner(actor);
    return [actor, sdk.makeScheduledTasksRouteHandler({resolveRunner: async () => runtime})];
  }));
  async function request(actor, method, path, body) {
    const url = new URL(path, 'http://closed.invalid');
    const headers = body === undefined ? {} : {'content-length': String(Buffer.byteLength(JSON.stringify(body)))};
    const res = {status: 0, body: {}};
    assert.equal(await handlers[actor]({
      req: {headers, socket: {remoteAddress: '127.0.0.1'}}, res, method, pathname: url.pathname, url,
      json(result, data, status = 200) {result.status = status;result.body = structuredClone(data);},
      error(result, message, status) {result.status = status;result.body = {error: message};},
      async readJsonBody() {return body === undefined ? null : structuredClone(body);},
    }), true, method + ' ' + path);
    return res;
  }
  const controls = {
    'empty-edit': ['POST', route + '/' + taskId + '/edit', {}],
    'bodyless-edit': ['POST', route + '/' + taskId + '/edit'],
    'readonly-edit': ['POST', route + '/' + taskId + '/edit', {taskId: hiddenId}],
    edit: ['POST', route + '/' + taskId + '/edit', {promptInstructions: 'New instructions.',
      trigger: {kind: 'cron', expression: '30 9 * * 1', tz: 'UTC'}}],
    'invalid-snooze': ['POST', route + '/' + taskId + '/snooze', {}],
    snooze: ['POST', route + '/' + taskId + '/snooze', {minutes: 60}],
    complete: ['POST', route + '/' + taskId + '/complete'],
    reopen: ['POST', route + '/' + taskId + '/reopen'],
    'malformed-id': ['POST', route + '/%ZZ/fire'],
    'owner-list': ['GET', route + '?ownerVisibleOnly=1'],
    'all-list': ['GET', route],
    'duplicate-filter': ['GET', route + '?ownerVisibleOnly=1&ownerVisibleOnly=1'],
    history: ['GET', route + '/' + taskId + '/history'],
  };
  const fire = async actor => request(actor, 'POST', route + '/' + taskId + '/fire');
  function fireReceipt(result) {
    if (!result) return {http: 0, kind: '', task: '', state: '', at: 0};
    const item = result.body.fire;
    if (item?.kind === 'raced') assert.equal(item.task, null);
    return {http: result.status, kind: item?.kind ?? '', task: item?.task?.taskId ?? '',
      state: item?.task?.state.status ?? '', at: occurrence(item?.task?.state.firedAt)};
  }
  return {
    hashes,
    async control(action) {reply = await request(2, ...controls[action]);},
    async fire(actor) {
      assert.equal(requests.has(actor), false);
      const record = {result: undefined};
      requests.set(actor, record);
      record.settled = fire(actor).then(result => {record.result = result;});
      await turn();
    },
    async claim(actor) {claimGates.get(actor).resolve();await turn();},
    async enterEgress(actor) {dispatchGates.get(actor).admission.resolve();await turn();},
    async finish(actor, outcome) {
      dispatchGates.get(actor).result.resolve(outcome);
      await requests.get(actor).settled;
    },
    advance() {clock++;},
    pause() {paused = true;},
    async observe() {
      const task = await store.get(taskId);
      const logs = (await logStore.list({agentId, taskId})).map(entry => entry.transition).sort();
      return {clock, paused, state: task.state.status, at: occurrence(task.state.firedAt),
        completed: occurrence(task.state.completedAt), text: task.promptInstructions,
        cron: task.trigger.kind === 'cron' ? task.trigger.expression : '', zone: task.trigger.tz ?? '',
        claims: structuredClone(claims), writes: structuredClone(writes), guards: structuredClone(guards),
        egress: structuredClone(egress), logs,
        slots: [1, 2].map(actor => {
          const claim = claimGates.get(actor), dispatch = dispatchGates.get(actor);
          if (claim) return {phase: 'claim', at: claim.at, completed: 0};
          if (dispatch) return {phase: dispatch.phase, at: dispatch.at, completed: dispatch.completed};
          return {phase: requests.has(actor) ? 'done' : 'idle', at: 0, completed: 0};
        }),
        fireReplies: [1, 2].map(actor => fireReceipt(requests.get(actor)?.result)),
        reply: {http: reply.status, ids: reply.body.tasks?.map(row => row.taskId).sort() ?? [],
          task: reply.body.task?.taskId ?? reply.body.taskId ?? '', state: reply.body.task?.state.status ?? reply.body.status ?? '',
          at: occurrence(reply.body.task?.state.firedAt ?? reply.body.firedAt),
          completed: occurrence(reply.body.task?.state.completedAt ?? reply.body.completedAt),
          text: reply.body.task?.promptInstructions ?? '', cron: reply.body.task?.trigger.expression ?? '',
          zone: reply.body.task?.trigger.tz ?? ''}};
    },
  };
}
