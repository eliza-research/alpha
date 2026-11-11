import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {browsingSnapshot} from '../.eliza/client-features/plugins/plugin-native-browser-surface/src/browsing-session.ts';

const source=readFileSync(process.env.ALPHA_BROWSER_ADAPTER_SOURCE||'apps/app/src/prototype/browser-adapter.ts','utf8');
const declarations=source.slice(source.indexOf('  // Saving waits'),source.indexOf('  const tabOf ='));
const saving=source.slice(source.indexOf('  function savedSnapshot()'),source.indexOf('  async function restoreSession()'));
const clearing=source.slice(source.indexOf('  async function clearBrowsingData()'),source.indexOf('  async function clearSiteData()'));
function fixture(){
 let now=0,snapshots=0,fail=false,hold,release,record=null,clears=0;
 const state={tabs:[{id:'tab'}],cur:'tab',visits:['https://example.test/a']},metadata=new Map([['tab',{savedUrl:'https://example.test/a',title:'A'}]]),writes=[],errors=[];
 const context={JSON,Map,Promise,Date:{now:()=>now},disposed:false,clearingData:false,session:'session',state:()=>state,restored:new Map(),tabInfo:id=>metadata.get(id),Capacitor:{isNativePlatform:()=>true},
  browsingSnapshot(...args){snapshots++;return browsingSnapshot(...args);},confirmBrowser:async()=>true,report:error=>errors.push(error.message),
  forgetTabs(ids){state.tabs=state.tabs.filter(tab=>!ids.includes(tab.id));state.cur=state.tabs[0]?.id||'';},shell:{vset(_key,patch){Object.assign(state,patch);},toast(){}},
  Browser:{async saveBrowsingState(input){writes.push(input);if(hold){const pending=hold;hold=undefined;await pending;}if(fail)throw Error('Storage unavailable');record=input;},async clearBrowsingData(){clears++;record={history:[],tabs:[],cur:''};return {closed:[]};}}};
 const api=vm.runInNewContext(stripTypeScriptTypes(declarations+saving+clearing+';({saveSession,clearBrowsingData,hydrate(){sessionHydrated=true;},flush:()=>saveQueue,changed(){if(typeof snapshotRevision!=="undefined")snapshotRevision++;}})',{mode:'strip'}),context);api.hydrate();
 return {...api,state,metadata,writes,errors,context,advance(ms){now+=ms;},fail(value=true){fail=value;},hold(){hold=new Promise(resolve=>release=resolve);return ()=>release();},get snapshots(){return snapshots},get record(){return record},get clears(){return clears}};
}
const settle=async h=>{await h.flush();await Promise.resolve();};

test('idle presentation ticks reuse the bounded snapshot, including outside Browser',async()=>{
 const h=fixture();h.saveSession();await settle(h);for(let i=0;i<100;i++)h.saveSession();await settle(h);
 assert.equal(h.snapshots,1,'idle ticks must not normalize every saved URL again');assert.equal(h.writes.length,1);
 h.metadata.get('tab').title='New title';h.changed();h.saveSession();await settle(h);assert.equal(h.writes.at(-1).tabs[0].title,'New title');assert.equal(h.snapshots,2);
 h.state.visits=[...h.state.visits,'https://example.test/b'];h.saveSession();await settle(h);assert.equal(h.writes.length,3);
});
test('failed saves use bounded exponential retry rather than the 100ms geometry cadence',async()=>{
 const h=fixture();h.fail();h.saveSession();await settle(h);for(let i=0;i<19;i++){h.advance(100);h.saveSession();await settle(h);}assert.equal(h.writes.length,1);
 h.advance(100);h.saveSession();await settle(h);assert.equal(h.writes.length,2);
 h.advance(3999);h.saveSession();await settle(h);assert.equal(h.writes.length,2);h.advance(1);h.saveSession();await settle(h);assert.equal(h.writes.length,3);
 assert.equal(h.errors.length,1,'one ongoing storage failure should produce one notice');
 h.fail(false);h.advance(8000);h.saveSession();await settle(h);assert.equal(h.writes.length,4);for(let i=0;i<20;i++){h.advance(100);h.saveSession();}await settle(h);assert.equal(h.writes.length,4);
 assert.equal(h.snapshots,1,'retry the already normalized snapshot');
});
test('new browsing state can save immediately during a failed snapshot backoff',async()=>{
 const h=fixture();h.fail();h.saveSession();await settle(h);h.fail(false);h.state.visits=['https://example.test/new'];h.saveSession();await settle(h);
 assert.equal(h.writes.length,2);assert.deepEqual(Array.from(h.record.history),h.state.visits);
});
test('Clear waits for an in-flight save and retires queued pre-clear snapshots',async()=>{
 const h=fixture(),release=h.hold();h.saveSession();await Promise.resolve();h.state.visits=['https://example.test/queued'];h.saveSession();
 const clearing=h.clearBrowsingData();await Promise.resolve();await Promise.resolve();assert.equal(h.clears,0,'an earlier save must finish before native Clear');release();await clearing;await settle(h);
 assert.equal(h.writes.length,1,'queued pre-clear state must never be written');assert.equal(h.clears,1);assert.deepEqual(h.record,{history:[],tabs:[],cur:''});
 h.saveSession();await settle(h);assert.equal(h.writes.length,1,'the cleared state is already durable');
});
test('a failed pre-clear save cannot schedule a retry after Clear',async()=>{
 const h=fixture(),release=h.hold();h.fail();h.saveSession();await Promise.resolve();const clearing=h.clearBrowsingData();await Promise.resolve();release();await clearing;h.advance(60000);h.saveSession();await settle(h);
 assert.equal(h.writes.length,1);assert.equal(h.clears,1);assert.deepEqual(h.record,{history:[],tabs:[],cur:''});assert.equal(h.errors.length,0);
});
