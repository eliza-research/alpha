import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {loadBrowserModule} from '../../../../test/fixtures/browser-source.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {call, checkpoint, deferred, root, tick, trace} from './support.mjs';

const model = 'ClientObservationSupport';
const modelPath = 'specs/quint/application/ClientObservationSupport.qnt';
const source = 'apps/app/src/runtime/client-observation-support.ts';
const projection = '.eliza/client-features/';
const contracts = ['packages/contracts/src/client-turn-observation.ts',
  'packages/contracts/src/contracts/remote-agent-pairing.ts'];
const instance = '11111111-1111-4111-8111-111111111111';
const replacement = '22222222-2222-4222-8222-222222222222';
const supported = (serverInstanceId, optionalFields = ['calendarDay']) =>
  ({serverInstanceId, clientTurnObservationSupport: {version: 1, optionalFields}});
const responses = {
  supported: supported(instance), different: supported(replacement),
  unlisted: supported(instance, []), legacy: {serverInstanceId: instance},
  invalid: supported('invalid-instance'),
};
const binding = {origin: 'https://closed.invalid', ownerId: 'synthetic-owner',
  agentId: 'synthetic-agent', sessionId: 'synthetic-session', connectionEpoch: 1};
const ordinary = {view: 'calendar', revision: 2, sensitive: false, timeZone: 'UTC',
  selectedObject: {kind: 'synthetic-selection', id: 'closed-record'}};
const calendarDay = {date: '2026-11-09', timeZone: 'UTC'};

function controlledStatus() {
  let reads = 0;
  let pending;
  return {
    get reads() { return reads; },
    request(signal) {
      assert.equal(pending, undefined, 'the prior status call is settled');
      reads++;
      const request = deferred();
      const abort = () => request.reject(signal.reason);
      pending = request;
      signal.addEventListener('abort', abort, {once: true});
      if (signal.aborted) abort();
      return request.promise.finally(() => {
        signal.removeEventListener('abort', abort);
        pending = undefined;
      });
    },
    finish(response) {
      assert.ok(pending, 'a status read is pending');
      if (response === 'unavailable') pending.reject(Error('Closed status failure'));
      else pending.resolve(responses[response]);
    },
  };
}

export async function checkClientObservationSupport(extraSources = []) {
  const sources = [modelPath, source, 'apps/app/src/runtime/connection-ui.tsx',
    'scripts/prepare-client-features.mjs', 'upstream.lock.json', 'package-lock.json',
    ...contracts.map(path => projection + path), projection + '.source.json',
    'test/fixtures/browser-source.mjs', 'specs/quint/refinement/application/support.mjs',
    fileURLToPath(import.meta.url), ...extraSources];
  const driverHashes = captureInputs(sources);
  const readJson = path => JSON.parse(readFileSync(root + path, 'utf8'));
  const prepared = readJson(projection + '.source.json');
  assert.equal(prepared.baseCommit, readJson('upstream.lock.json').commit);
  for (const path of contracts) {
    const hash = driverHashes[root + projection + path];
    assert.equal(hash, prepared.sourceFiles[path], path + ' pinned input');
    assert.equal(hash, prepared.files[path], path + ' projected input');
  }
  const {ClientObservationSupportSession} = await loadBrowserModule(source);
  const traces = [];
  async function scenario(name, run) {
    const status = controlledStatus();
    let currentEpoch = binding.connectionEpoch;
    const peer = new ClientObservationSupportSession(binding,
      () => currentEpoch === binding.connectionEpoch, status.request);
    let retired = false;
    let background = 'none';
    let turn = 'none';
    let offered = false;
    let handshakeController;
    let turnController;
    let error;
    const observe = () => ({
      's.retired': retired, 's.connectionCurrent': currentEpoch === binding.connectionEpoch,
      's.background': background, turnObservation: turn,
      's.reads': status.reads, 's.offered': offered,
    });
    const item = trace(name, observe());
    const mark = async (action, ...args) => {
      await tick();
      if (error) throw error;
      checkpoint(item, action + ' on exact session source', call(action, ...args), observe());
    };
    await run({
      async beginHandshake() {
        handshakeController = new AbortController();
        background = 'pending';
        void peer.handshake(handshakeController.signal).then(() => { background = 'resolved'; }, reason => {
          if (reason?.name !== 'AbortError') error = reason;
          background = 'aborted';
        });
        await mark('beginHandshake');
      },
      async beginTurn(hasOptional) {
        turnController = new AbortController();
        const context = hasOptional ? {...ordinary, calendarDay: {...calendarDay}} : {...ordinary};
        turn = 'pending';
        offered = hasOptional;
        void peer.context(context, turnController.signal).then(result => {
          try {
            assert.deepEqual(result, result.calendarDay ? {...ordinary, calendarDay} : ordinary);
            if (result.calendarDay) assert.notEqual(result.calendarDay, context.calendarDay);
            turn = result.calendarDay ? 'admitted' : 'ordinary';
          } catch (reason) { error = reason; }
        }, reason => {
          if (reason?.name !== 'AbortError') error = reason;
          turn = 'aborted';
        });
        await mark('beginTurn', hasOptional);
      },
      async finishHandshake(response) {
        status.finish(response);
        await mark('finishHandshake', response);
      },
      async finishComparison(response) {
        status.finish(response);
        await mark('finishComparison', response);
      },
      async abortHandshake() {
        handshakeController.abort();
        await mark('abortHandshake');
      },
      async abortTurn() {
        turnController.abort();
        await mark('abortTurn');
      },
      async retire() {
        peer.clear();
        retired = true;
        await mark('retire');
      },
      async invalidateConnection() {
        currentEpoch++;
        await mark('invalidateConnection');
      },
    });
    assert.notEqual(background, 'pending');
    assert.notEqual(turn, 'pending');
    traces.push(item);
  }
  await scenario('one background handshake is shared, followed by a fresh matching comparison', async c => {
    await c.beginHandshake(); await c.beginTurn(true);
    await c.finishHandshake('supported'); await c.finishComparison('supported');
    await c.beginTurn(true); await c.finishComparison('supported');
  });
  await scenario('a changed process strips the field and is never relearned by that session', async c => {
    await c.beginHandshake(); await c.finishHandshake('supported');
    await c.beginTurn(true); await c.finishComparison('different'); await c.beginTurn(true);
  });
  await scenario('a live turn retries a cancelled background handshake with its own signal', async c => {
    await c.beginHandshake(); await c.beginTurn(true); await c.abortHandshake();
    await c.finishHandshake('supported'); await c.finishComparison('supported');
  });
  await scenario('cancelling a waiter leaves the shared handshake available to a later turn', async c => {
    await c.beginHandshake(); await c.beginTurn(true); await c.abortTurn();
    await c.finishHandshake('supported'); await c.beginTurn(true); await c.finishComparison('supported');
  });
  await scenario('an abandoned turn-owned learn permits a new turn to learn', async c => {
    await c.beginTurn(true); await c.abortTurn(); await c.beginTurn(true);
    await c.finishHandshake('supported'); await c.finishComparison('supported');
  });
  await scenario('retiring during a handshake fences a late reply and future turns', async c => {
    await c.beginHandshake(); await c.beginTurn(true); await c.retire();
    await c.finishHandshake('supported'); await c.beginTurn(true);
  });
  await scenario('retiring during a comparison fences a late matching reply', async c => {
    await c.beginTurn(true); await c.finishHandshake('supported'); await c.retire();
    await c.finishComparison('supported'); await c.beginTurn(false);
  });
  await scenario('a replacement epoch independently fences a late comparison and future turn', async c => {
    await c.beginTurn(true); await c.finishHandshake('supported'); await c.invalidateConnection();
    await c.finishComparison('supported'); await c.beginTurn(false);
  });
  await scenario('a replacement epoch independently fences a held shared handshake', async c => {
    await c.beginHandshake(); await c.beginTurn(true); await c.invalidateConnection();
    await c.finishHandshake('supported'); await c.retire();
  });
  await scenario('cancelling a comparison clears support for later turns', async c => {
    await c.beginTurn(true); await c.finishHandshake('supported'); await c.abortTurn();
    await c.beginTurn(true);
  });
  for (const response of ['legacy', 'unlisted', 'invalid', 'unavailable']) {
    await scenario(response + ' learn preserves ordinary context and skips comparison', async c => {
      await c.beginTurn(true); await c.finishHandshake(response); await c.beginTurn(true);
    });
    await scenario(response + ' comparison strips the optional field on later turns', async c => {
      await c.beginTurn(true); await c.finishHandshake('supported');
      await c.finishComparison(response); await c.beginTurn(true);
    });
  }
  await scenario('a turn without the optional field does not await or request status', async c => {
    await c.beginTurn(false); await c.beginHandshake(); await c.beginTurn(false);
    await c.finishHandshake('supported'); await c.beginTurn(false);
  });

  return checkTraces({model, modelPath, sources, driverHashes, traces, scope: 'bounded-component',
    assumptions: ['The exact renderer session, support cache and projected upstream parsers run through a controlled status callback with synthetic identity and context.',
      'The renderer call site serializes send and binds support to one resident connection epoch. The replay drives one turn and one shared background learn, with the latter allowed to settle late. It does not execute the full connection controller.',
      'Admission here is an optional observation field decision. Authentication, transport delivery, provider integration and native device access are separate.']});
}
