import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runChildSuite} from './fixtures/child-suite.mjs';

// These cases use closed provider and storage fixtures.
for (const [name, script, options] of [
  ['inbox attention, links, folders and attachments', 'test-inbox-attention-flow.ts', {flags: ['--import', 'tsx']}],
  ['new email preserves unfinished emails as separate account-scoped local drafts', 'test-inbox-multiple-drafts.ts', {timeout: 30_000}],
  ['saved Inbox drafts use the platform store and preserve account/conflict boundaries', 'test-inbox-saved-drafts.ts', {timeout: 30_000}],
]) {
  test(name, () => runChildSuite(script, options));
}

test('retained email edits publish Inbox status copy verbatim',async()=>{
 const fixtures={
  platform:`export const Capacitor={getPlatform:()=>'web'};`,
  native:`export const secureConnectionStore={};`,
  recovery:`export const nativeAssistantDraftRecovery=()=>({});`,
  domain:`export const openDomainRecovery=()=>{};`,
  profile:`export const browserDevProfile=null;`,
  documents:`export class BrowserJsonDomainDocument{async readJson(){return null;}async editJson(update){const f=globalThis.inboxUnsavedFixture;await f.gate;f.row=update(f.row);}}`,
 };
 const routes=[[/^@capacitor\/core$/,'platform'],[/native-connection$/,'native'],[/native-assistant-draft-recovery$/,'recovery'],[/domain-recovery$/,'domain'],[/dev-profile$/,'profile'],[/json-domain-document$/,'documents']];
 const bundled=await build({entryPoints:['apps/app/src/prototype/inbox-unsaved.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'unsaved-boundaries',setup(b){
  for(const [filter,path] of routes)b.onResolve({filter},()=>({path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:fixtures[path],loader:'js'}));
 }}]});
 const fixture=globalThis.inboxUnsavedFixture={row:null,gate:Promise.resolve()};
 const {inboxUnsaved}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
 const statuses=[];
 let unsaved;unsaved=inboxUnsaved('owner',()=>statuses.push(unsaved?.status),()=>{});
 await unsaved.ready;
 unsaved.edit({version:1,owner:'owner',baseRevision:null,draft:{version:1,id:'draft',revision:'1',owner:'owner',to:[],subject:'Synthetic',body:'Synthetic body'},toQ:''});
 while(!fixture.row?.text)await new Promise(resolve=>setTimeout(resolve,1));
 let release;fixture.gate=new Promise(resolve=>{release=resolve;});
 const clearing=unsaved.clear();
 await new Promise(resolve=>setTimeout(resolve,1));
 assert.equal(unsaved.status,'Clearing retained edits…');
 await assert.rejects(unsaved.clear(),{message:'Local draft storage is unavailable. Check it before sending.'});
 release();await clearing;
 assert.equal(unsaved.status,'');
 assert.equal(fixture.row.text,'');
 assert.ok(statuses.every(s=>!/provider review|conversation/.test(s??'')),'no rewritten chat copy reaches Inbox');
 unsaved.retire();delete globalThis.inboxUnsavedFixture;
});
