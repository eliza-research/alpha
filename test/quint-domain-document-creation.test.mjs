import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadProductModule, memoryDocuments, modelTraces, replayTraces} from '../specs/quint/refinement/application/notes-files-media-itf.mjs';

// DomainDocumentCreation against BrowserDomainDocument in apps/app/src/browser/domain-document.ts.
// Ports: the revisioned document store and the legacy reader. Legacy bytes "old" and "changed"
// are two distinct JSON documents; an edit writes a third.

const source = 'apps/app/src/browser/domain-document.ts', key = 'alpha.test.domain';
const bytes = {none: null, old: '{"from":"old"}', changed: '{"from":"changed"}'};
const named = raw => Object.keys(bytes).find(name => bytes[name] === raw);
const capped = value => Math.min(value, 3);

async function replayDomainDocumentCreation({rewrite, ...options} = {}) {
  const traces = modelTraces({path: 'specs/quint/application/DomainDocumentCreation.qnt', main: 'DomainDocumentCreation', ...options});
  const {BrowserDomainDocument} = await loadProductModule(source, {rewrite});
  return replayTraces(traces, {
    required: ['read', 'edit', 'legacyWrite'],
    project: state => state.s,
    reached: {
      'an empty domain read without a write': state => !state.s.present && state.s.reads > 0,
      'a legacy import': state => state.s.value === 'legacy',
      'a document created by its first edit': state => state.s.present && state.s.readWrites === 0 && state.s.baseline === 'none',
      'access stopped by a later legacy write': state => state.s.blocked,
    },
    async start(initial) {
      const documents = memoryDocuments();
      let legacy = initial.s.legacy, reads = 0, blocked = false, legacyWrites = 0;
      const domain = new BrowserDomainDocument(documents, key, () => bytes[legacy]);
      const guarded = async task => {
        try { await task();blocked = false; }
        catch (error) { if (!/Older browser data changed/.test(String(error?.message))) throw error;blocked = true; }
      };
      return {
        actions: {
          async read() { reads = capped(reads + 1);await guarded(() => domain.read(() => ({from: 'initial'}))); },
          async edit() { await guarded(() => domain.edit(() => ({from: 'initial'}), data => { data.from = 'edit'; })); },
          legacyWrite() { legacy = legacy === 'none' ? 'old' : 'changed';legacyWrites++; },
        },
        observe() {
          const stored = documents.rows.get(key), envelope = stored ? JSON.parse(stored.raw) : undefined;
          return {present: !!stored, baseline: envelope ? named(envelope.legacy) : 'none', legacy,
            value: !envelope ? 'none' : envelope.value === envelope.legacy ? 'legacy' : JSON.parse(envelope.value).from,
            writes: capped(documents.writes), readWrites: documents.creations, reads, blocked, legacyWrites};
        },
      };
    },
  });
}

test('browser domain documents follow every DomainDocumentCreation model step', {timeout: scaledTimeout(180000)}, async () => {
  const receipt = await replayDomainDocumentCreation({traces: 40, maxSteps: 14});
  assert.equal(receipt.traces, 40);
  assert.ok(receipt.steps > 100, JSON.stringify(receipt));
  for (const action of ['read', 'edit', 'legacyWrite']) assert.ok(receipt.actions[action] > 0, action);
});
test('a domain document that imports changed legacy bytes is rejected by the replay', {timeout: scaledTimeout(180000)}, async () => {
  await assert.rejects(replayDomainDocumentCreation({traces: 40, maxSteps: 14, rewrite: {'browser/domain-document.ts': text =>
    text.replace("if(actual!==expected)throw", 'if(false)throw')}}), /trace \d+ step \d+ (read|edit)/);
});
