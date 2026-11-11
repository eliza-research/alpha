import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {captureInputs, checkTraces, qmap} from '../check-traces.mjs';
import {deferred} from '../../legacy/core/source-support.mjs';

const model = 'GoogleAccessPublication';
const source = 'apps/app/src/runtime/google-agent-access.ts';
const inputs = [fileURLToPath(import.meta.url), source, 'apps/app/src/browser/device-preferences.ts',
  'apps/app/src/browser/preference-documents.ts', 'apps/app/src/browser/domain-document.ts',
  'apps/app/src/runtime/local-agent.ts', 'specs/quint/legacy/core/source-support.mjs', 'bun.lock'];
const key = 'alpha.browser.device.v1';
const ids = [1, 2];
const bits = value => ({gmail: value.gmailChanges, calendar: value.calendarEdits});
const initial = {gmail: false, calendar: true};

async function compile() {
  const replacements = {
    './documents': 'export const browserDocuments = ports.documents;',
    './local-agent': 'export const browserLocalAgentEnabled = false; export const saveNativeGoogleAgentAccess = ports.save;',
    '@capacitor/core': 'export const Capacitor = {isNativePlatform: () => true};',
  };
  const compiled = await build({entryPoints: [source], bundle: true, platform: 'node', format: 'cjs', write: false,
    metafile: true, plugins: [{name: 'controlled-google-access-ports', setup(builder) {
      builder.onResolve({filter: /^(\.\/documents|\.\/local-agent|@capacitor\/core)$/},
        args => ({path: args.path, namespace: 'port'}));
      builder.onLoad({filter: /.*/, namespace: 'port'}, args => ({contents: replacements[args.path], loader: 'js'}));
    }}]});
  for (const path of Object.keys(compiled.metafile.inputs).filter(path => !path.startsWith('port:'))) {
    assert.ok(inputs.includes(path), `Unexpected compiled input ${path}`);
  }
  return new Function('ports', 'module', 'exports', 'window', 'document', 'navigator', 'localStorage',
    'BroadcastChannel', compiled.outputFiles[0].text);
}

function scenario(instantiate, name) {
  let revision = 1, host = initial, previous = initial, nativeCalls = 0;
  let snapshot = {revision: '1', raw: JSON.stringify({version: 1, legacy: null,
    value: JSON.stringify({agentGmailChanges: initial.gmail, agentCalendarEdits: initial.calendar})})};
  let owner, submitting, refuseEdit = false;
  const primaryError = Error('Fixture native write reply missing');
  const correctionError = Error('Fixture corrective write reply missing');
  const queue = [];
  const requests = new Map(ids.map(id => [id, {id, choice: {field: 'gmail', value: false, expected: 0},
    result: 'idle', completion: deferred(), native: deferred(), count: 0}]));
  const saved = () => {
    const {agentGmailChanges, agentCalendarEdits} = JSON.parse(JSON.parse(snapshot.raw).value);
    return {gmail: agentGmailChanges, calendar: agentCalendarEdits};
  };
  const documents = {
    async read(name) { assert.equal(name, key); return structuredClone(snapshot); },
    async edit(name, editor) {
      assert.equal(name, key);
      if (refuseEdit) {refuseEdit = false; throw Error('Fixture rollback refused before document write');}
      const result = await editor(structuredClone(snapshot));
      snapshot = {revision: String(++revision), raw: result.raw};
      return result.result;
    },
  };
  const window = {addEventListener() {}, dispatchEvent() {}}, document = {addEventListener() {}};
  const navigator = {locks: {request(name, {mode}, operation) {
    assert.equal(name, 'alpha.google-agent-access.v1');
    assert.equal(mode, 'exclusive');
    assert.ok(submitting);
    const request = submitting;
    request.operation = operation;
    request.lock = deferred();
    queue.push(request);
    return request.lock.promise;
  }}};
  const module = {exports: {}};
  instantiate({documents, save(value) {
    assert.ok(owner);
    nativeCalls++;
    owner.count++;
    owner.call = {bits: bits(value), reply: deferred()};
    owner.native.resolve();
    return owner.call.reply.promise;
  }}, module, module.exports, window, document, navigator, {getItem: () => null}, undefined);
  const api = module.exports;
  const observe = () => ({
    'state.saved': saved(), 'state.host': host, 'state.previous': previous, 'state.revision': revision,
    'state.calls': nativeCalls, 'state.queue': queue.map(({id}) => id), 'state.owner': owner?.id ?? 0,
    'state.phase': !owner ? 'idle' : owner.count === 1 ? 'primary' : 'correction',
    'state.choices': qmap(ids.map(id => [id, requests.get(id).choice])),
    'state.results': qmap(ids.map(id => [id, requests.get(id).result])),
  });
  const trace = {name, init: {name: 'init'}, expect: observe(), steps: []};
  function checkpoint(label, action, ...args) {
    trace.steps.push({label, action: {name: action, args}, expect: observe()});
  }
  function complete(request, error) {
    request.result = !error ? 'applied' : request.count ? 'failed' : 'refused';
    request.error = error;
    owner = undefined;
    request.completion.resolve();
  }
  function respond(request, reply, error) {
    if (reply !== 'failed') host = request.call.bits;
    if (reply === 'ok') request.call.reply.resolve();
    else request.call.reply.reject(error);
  }
  const settledOrNative = request => Promise.race([request.native.promise, request.completion.promise]);
  return {
    trace,
    async submit(id, field, value, guarded = false) {
      const request = requests.get(id), choice = guarded ? await api.captureGoogleCalendarAccess() : undefined;
      if (guarded) assert.ok(choice);
      request.choice = {field, value, expected: choice ? Number(choice.receipt.snapshot.revision) : 0};
      request.result = 'pending';
      submitting = request;
      const result = api.setGoogleAgentAccess({[field === 'gmail' ? 'gmailChanges' : 'calendarEdits']: value}, choice && {
        current: () => true, expectedCalendarEdits: choice.calendarEdits, receipt: choice.receipt,
      });
      submitting = undefined;
      void result.then(() => complete(request), error => complete(request, error));
      checkpoint('source requests the exclusive Web Lock', 'submit', id, field, value, guarded);
    },
    async acquire() {
      assert.equal(owner, undefined);
      const request = queue.shift(), before = saved();
      owner = request;
      void request.operation().then(request.lock.resolve, request.lock.reject);
      await settledOrNative(request);
      if (owner) previous = before;
      checkpoint('the source canonical edit admits or refuses the guarded choice', 'acquire');
    },
    async primary(reply, rollbackFails = false) {
      const request = owner;
      assert.equal(request.count, 1);
      request.native = deferred();
      refuseEdit = rollbackFails;
      respond(request, reply, primaryError);
      await settledOrNative(request);
      if (reply !== 'ok') assert.equal(request.count, 2, `corrective host publication missing: ${JSON.stringify({host, saved: saved()})}`);
      checkpoint('original native reply commits or enters corrective publication', 'primary', reply, rollbackFails);
    },
    async correction(reply) {
      const request = owner;
      assert.equal(request.count, 2);
      respond(request, reply, correctionError);
      await request.completion.promise;
      assert.equal(request.error, primaryError);
      checkpoint('corrective publication settles and preserves the original failure', 'correction', reply);
    },
  };
}

export async function checkGoogleAccessPublication(extraSources = []) {
  const sources = [...inputs, ...extraSources], driverHashes = captureInputs(sources);
  const instantiate = await compile(), traces = [];
  async function run(name, drive) {
    const f = scenario(instantiate, name);
    await drive(f);
    traces.push(f.trace);
  }
  await run('lost-write-reply-corrects-before-next-owner', async f => {
    await f.submit(1, 'gmail', true); await f.acquire(); await f.submit(2, 'calendar', false);
    await f.primary('lost'); await f.correction('ok'); await f.acquire(); await f.primary('ok');
  });
  await run('same-lock-revision-invalidates-queued-reviewed-choice', async f => {
    await f.submit(1, 'gmail', true); await f.submit(2, 'calendar', false, true);
    await f.acquire(); await f.primary('ok'); await f.acquire();
  });
  await run('rollback-refusal-republishes-the-current-canonical-choice', async f => {
    await f.submit(1, 'gmail', true); await f.acquire(); await f.primary('failed', true); await f.correction('ok');
  });
  await run('corrective-ack-lost-after-host-commit', async f => {
    await f.submit(1, 'gmail', true); await f.acquire(); await f.primary('lost'); await f.correction('lost');
  });
  await run('failed-correction-leaves-original-error-and-uncertainty', async f => {
    await f.submit(1, 'gmail', true); await f.acquire(); await f.primary('lost'); await f.correction('failed');
  });
  const receipt = await checkTraces({model, traces, sources, driverHashes, scope: 'bounded-orchestration', assumptions: [
    'Actual Google access, device preferences and canonical domain edit functions execute.',
    'The lock port grants two requests in FIFO order, the document port records committed revisions, and a controlled native port distinguishes refusal before write and lost acknowledgement after write.',
    'The native host and document remain independently committed. Process interruption and installed Android bridge recovery after a failed corrective write remain separate.',
  ]});
  return {receipt, obligations: [
    {model, obligation: 'Installed host readback after failed correction',
      reason: 'Both writes can fail or lose acknowledgements. The caller keeps the original error and the model allows an unresolved host divergence.'},
  ]};
}
