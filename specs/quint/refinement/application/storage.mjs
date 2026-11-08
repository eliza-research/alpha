import assert from 'node:assert/strict';
import {checkTraces} from '../check-traces.mjs';
import {sourceModule, deferred, tick, trace, checkpoint, call, captureSources, boundInputs} from './support.mjs';
captureSources(['specs/quint/refinement/application/storage.mjs']);

export async function durableStore() {
  const source = 'apps/app/src/browser/domain-document.ts';
  const {BrowserDomainDocument} = await sourceModule(source), traces = [];
  for (const race of ['none', 'current', 'legacy', 'failure']) {
    let legacy = '"old"', snapshot, writes = 0, gate, staged;
    const documents = {
      async read() {return snapshot;},
      async readOrCreate(_key, raw) {if (!snapshot) snapshot = {revision: '0', raw}; return snapshot;},
      async compareExchange(_key, expected, raw) {
        if (JSON.stringify(expected) !== JSON.stringify(snapshot)) throw Error('CAS conflict');
        snapshot = {revision: String(++writes), raw}; return snapshot;
      },
      async edit(_key, edit) {
        const before = snapshot, next = await edit(before); staged = next; await gate.promise;
        if (race === 'failure') throw Error('Injected persistence failure');
        await this.compareExchange(_key, before, next.raw); return next.result;
      },
    };
    const domain = new BrowserDomainDocument(documents, 'test', () => legacy);
    snapshot = {revision: '0', raw: JSON.stringify({version: 1, legacy, value: JSON.stringify({text: 'empty'})})};
    const t = trace(`document-${race}`, {'s.value': (await domain.read(() => ({}))).text, 's.version': writes});
    gate = deferred(); staged = undefined;
    const operation = domain.edit(() => ({text: 'empty'}), value => {value.text = 'edit';}).then(() => null, error => error);
    await tick();
    checkpoint(t, 'real editor suspended before persistence', [call('edit'), call('prepare')], {'s.draft': JSON.parse(JSON.parse(staged.raw).value).text});
    if (race === 'current') {
      writes++; snapshot = {revision: String(writes), raw: JSON.stringify({version: 1, legacy, value: JSON.stringify({text: 'other'})})};
      checkpoint(t, 'competing transaction publishes', call('concurrentWrite'), {'s.value': JSON.parse(JSON.parse(snapshot.raw).value).text, 's.version': writes});
    }
    if (race === 'legacy') {legacy = '"changed"'; checkpoint(t, 'retained legacy bytes changed', call('legacyWrite'), {'s.legacy': JSON.parse(legacy)});}
    if (race === 'failure') checkpoint(t, 'persistence port starts failing', call('failWrites'), {'s.value': JSON.parse(JSON.parse(snapshot.raw).value).text});
    gate.resolve(); const error = await operation;
    if (race === 'none') checkpoint(t, 'durable commit', call('commit'), {'s.value': JSON.parse(JSON.parse(snapshot.raw).value).text, 's.version': writes});
    else if (race === 'legacy') {
      // This port changes legacy after the editor has returned; BrowserDomainDocument's
      // last check already ran. Admission on the next read still detects the change.
      assert.equal(error, null);
      checkpoint(t, 'CAS completes after the final legacy check', call('commit'), {'s.value': JSON.parse(JSON.parse(snapshot.raw).value).text, 's.version': writes});
      await assert.rejects(domain.readRaw(), /Older browser data changed/);
      checkpoint(t, 'next read detects post-editor legacy race', null, {'s.legacy': JSON.parse(legacy)});
    } else {assert.ok(error); checkpoint(t, 'failed write leaves bytes intact', {...call('commit'), reject: true}, {'s.value': JSON.parse(JSON.parse(snapshot.raw).value).text, 's.version': writes});}
    traces.push(t);
  }
  return checkTraces(boundInputs({model: 'DurableStore', sources: [source, 'specs/quint/refinement/application/storage.mjs', 'specs/quint/refinement/application/support.mjs'],
    traces, scope: 'bounded-component', assumptions: ['Executes actual BrowserDomainDocument. The injected Documents port provides CAS and a controllable precommit boundary.',
      'Only envelope/read/edit/CAS conflict projection is checked. BrowserDocumentStore transaction implementation, recovery/reset and cross-tab locking remain separate obligations.',
      'A legacy change after the editor returns is observed on the next read; the adapter does not claim atomicity across external localStorage writes.']}));
}
