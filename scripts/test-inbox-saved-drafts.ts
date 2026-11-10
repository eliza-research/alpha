import assert from 'node:assert/strict';
import {bundledFixture, installFixtureGlobals} from './fixtures/bundled-module.ts';

const nativeCalls: [method: string, ...args: unknown[]][] = [];
const fixture = {native: false, nativeCalls, rows: new Map<string, unknown>()};
const restoreGlobals = installFixtureGlobals({inboxSavedDraftFixture: fixture});
try {
  const {inboxLocalStore:store} = await bundledFixture<typeof import('../apps/app/src/runtime/inbox-local-store.ts')>(
    'apps/app/src/runtime/inbox-local-store.ts', {
      '@capacitor/core': `export const Capacitor={isNativePlatform:()=>globalThis.inboxSavedDraftFixture.native};`,
      'native-connection': `export const secureConnectionStore={read:async slot=>{globalThis.inboxSavedDraftFixture.nativeCalls.push(['read',slot]);return null;},compareExchange:async(...args)=>{globalThis.inboxSavedDraftFixture.nativeCalls.push(['cas',...args]);return {status:'saved'};}};`,
      'json-domain-document': `export class BrowserJsonDomainDocument{constructor(key){this.key=key;}async readJson(){return structuredClone(globalThis.inboxSavedDraftFixture.rows.get(this.key)??null);}async editJson(update){const rows=globalThis.inboxSavedDraftFixture.rows;rows.set(this.key,structuredClone(update(structuredClone(rows.get(this.key)??null))));}}`,
    },
  );
  const slot = (grant: string) => 'inbox-drafts:v1:' + JSON.stringify(['production','owner','organization',grant]);
  assert.equal(await store.read(slot('a')),null);
  const draft={id:'draft',revision:'1',body:'Synthetic local text'};
  assert.deepEqual(await store.compareExchange(slot('a'),null,draft),{status:'saved'});
  assert.deepEqual(await store.read(slot('a')),draft);
  assert.equal(await store.read(slot('b')),null,'another Google grant cannot read this draft');
  assert.deepEqual(await store.compareExchange(slot('a'),null,{...draft,body:'Stale replacement'}),{status:'conflict'});
  assert.deepEqual(await store.read(slot('a')),draft,'a stale writer preserves saved content');
  assert.deepEqual(nativeCalls,[],'browser drafts never reach the Cloud credential bridge');
  await assert.rejects(store.read('cloud:production'));
  await assert.rejects(store.read('inbox-drafts:v1:["production"]'));
  fixture.native=true;
  await store.read(slot('a'));await store.compareExchange(slot('a'),draft,null);
  assert.deepEqual(nativeCalls,[['read',slot('a')],['cas',slot('a'),draft,null]],'Android keeps its encrypted draft slot adapter');
  console.log('PASS saved Inbox drafts: browser/native routing, grant isolation, conflict preservation, invalid slots; synthetic storage only.');
} finally {
  restoreGlobals();
}
