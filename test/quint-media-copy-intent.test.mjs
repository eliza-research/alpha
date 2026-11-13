import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadProductModule, memoryDocuments, memoryStorage, modelTraces, replayTraces} from '../specs/quint/refinement/application/notes-files-media-itf.mjs';

// MediaCopyIntent against apps/app/src/runtime/media-copy-intent.ts.
// Ports: Capacitor.getPlatform, localStorage and the browser document store. The browser
// revision is a random UUID; it is observed as the ordinal of the admission that minted it.

const source = 'apps/app/src/runtime/media-copy-intent.ts';
const none = {token: 0, revision: 0, id: 0};
const capped = value => Math.min(value, 2);

/** `rewrite` substitutes product source text before loading; tests use it to show that a
 * divergent implementation is rejected. */
async function replayMediaCopyIntent({rewrite, ...options} = {}) {
  const traces = modelTraces({path: 'specs/quint/application/MediaCopyIntent.qnt', main: 'MediaCopyIntent', ...options});
  return replayTraces(traces, {
    required: ['admit', 'acknowledge', 'restart', 'recover'],
    project: state => state.s,
    reached: {
      'a second request refused on Android': state => !state.s.browser && state.s.refusedAdmits > 0,
      'a second request refused in the browser': state => state.s.browser && state.s.refusedAdmits > 0,
      'a stale acknowledgement refused in the browser': state => state.s.browser && state.s.refusedAcks > 0,
      'a request recovered after a restart': state => state.s.restarts > 0 && state.s.slot.token !== 0
        && Object.values(state.s.held).some(held => held.token !== 0),
      'an Android token admitted again and cleared by an earlier reader': state => !state.s.browser && state.s.clearedId !== state.s.heldIdAtClear,
    },
    async start(initial) {
      const browser = initial.s.browser, storage = memoryStorage(), documents = memoryDocuments();
      globalThis.localStorage = storage;
      globalThis.__alphaMediaCopyPorts = {platform: browser ? 'web' : 'android', documents};
      const load = () => loadProductModule(source, {rewrite, stubs: {
        '@capacitor/core': 'export const Capacitor={getPlatform:()=>globalThis.__alphaMediaCopyPorts.platform};',
        '../browser/documents': 'export const browserDocuments=globalThis.__alphaMediaCopyPorts.documents;',
      }});
      let product = await load();
      // Driver bookkeeping: which admission wrote each stored or held request.
      const ordinals = new Map();
      let serial = 0, slotId = 0, held = {1: undefined, 2: undefined};
      const count = {admitted: 0, acknowledged: 0, refusedAdmits: 0, refusedAcks: 0, restarts: 0, clearedId: 0, heldIdAtClear: 0};
      const abstract = (intent, id) => !intent ? none
        : {token: Number(intent.token.slice(6)), revision: intent.revision ? ordinals.get(intent.revision) : 0, id};
      return {
        actions: {
          async admit({caller, token}) {
            try {
              const intent = await product.admitMediaCopyIntent(`token-${token}`);
              serial++;slotId = serial;count.admitted++;
              if (intent.revision) ordinals.set(intent.revision, serial);
              held[caller] = {intent, id: serial};
            } catch (error) {
              if (!/Another saved-copy request is unresolved/.test(String(error?.message))) throw error;
              count.refusedAdmits = capped(count.refusedAdmits + 1);
            }
          },
          async acknowledge({caller}) {
            const mine = held[caller];held[caller] = undefined;
            try {
              await product.acknowledgeMediaCopyIntent(mine.intent);
              count.acknowledged++;count.clearedId = slotId;count.heldIdAtClear = mine.id;slotId = 0;
            } catch (error) {
              if (!/Another saved-copy request is unresolved/.test(String(error?.message))) throw error;
              count.refusedAcks = capped(count.refusedAcks + 1);
            }
          },
          // A new renderer: nothing is held and the module's cached document is gone.
          async restart() { held = {1: undefined, 2: undefined};count.restarts++;product = await load(); },
          async recover({caller}) { held[caller] = {intent: await product.readMediaCopyIntent(), id: slotId}; },
        },
        async observe() {
          const stored = await product.readMediaCopyIntent();
          return {browser, slot: abstract(stored, slotId), serial,
            held: Object.fromEntries([1, 2].map(caller => [caller, abstract(held[caller]?.intent, held[caller]?.id)])), ...count};
        },
        close() { delete globalThis.localStorage;delete globalThis.__alphaMediaCopyPorts; },
      };
    },
  });
}

test('saved-copy request storage follows every MediaCopyIntent model step on both platforms', {timeout: scaledTimeout(180000)}, async () => {
  const receipt = await replayMediaCopyIntent({traces: 400, maxSteps: 20});
  assert.equal(receipt.traces, 400);
  assert.ok(receipt.steps > 2000, JSON.stringify(receipt));
  for (const action of ['admit', 'acknowledge', 'restart', 'recover']) assert.ok(receipt.actions[action] > 0, action);
});

test('a saved-copy store without the compare step is rejected by the replay', {timeout: scaledTimeout(180000)}, async () => {
  await assert.rejects(replayMediaCopyIntent({traces: 400, maxSteps: 20, rewrite: {'runtime/media-copy-intent.ts': text =>
    text.replace("if(JSON.stringify(decode(archive))!==JSON.stringify(expected))throw", 'if(false)throw')}}), /trace \d+ step \d+ (admit|acknowledge)/);
});
