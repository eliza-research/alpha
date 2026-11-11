import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {BrowserTabSession} from '../.eliza/client-features/plugins/plugin-native-browser-surface/src/tab-host.ts';
const source=readFileSync('apps/app/src/prototype/browser-adapter.ts','utf8');
const openedStart="  void Browser.addListener('tabOpened',";
const begin=source.indexOf(openedStart)+openedStart.length;
const openedSource=stripTypeScriptTypes(source.slice(begin,source.indexOf(').then((value:any)=>{openedListener=value;})',begin)),{mode:'strip'});
const forgetSource=stripTypeScriptTypes(source.slice(source.indexOf('  function forgetTabs('),source.indexOf('  function savedSnapshot(')),{mode:'strip'});
async function fixture({count=2,privateOpener=false}={}){
 const tabs=new BrowserTabSession({session:'owned-session'}),closed=[],toasts=[];
 const rows=Array.from({length:count},(_,i)=>({id:i===0?'first':i===1?'opener':'restored-'+i}));
 const state={tabs:rows,cur:'opener'};
 await tabs.ensure('first',false,async()=>{});await tabs.ensure('opener',privateOpener,async()=>{});
 const box={state:()=>state,disposed:false,tabs,restored:new Map(),newTabId:()=> 'fresh-tab',MAX_TABS:8,session:'owned-session',refresh(){},
  shell:{vset(_key,patch){Object.assign(state,patch);},toast(message){toasts.push(message);}},
  Browser:{close(input){closed.push(input);return Promise.resolve();}}};
 const opened=vm.runInNewContext(openedSource,box),forget=vm.runInNewContext(forgetSource+';forgetTabs',box);
 return {state,tabs,closed,toasts,open:event=>opened({session:'owned-session',id:'popup',opener:'opener',private:false,...event}),forget};
}
test('a self-closing popup returns to its second-tab opener',async()=>{
 const h=await fixture();h.open();assert.equal(h.state.cur,'popup');h.forget(['popup']);assert.equal(h.state.cur,'opener');
});
test('closing a popup whose opener is gone falls back to a surviving tab',async()=>{
 const h=await fixture();h.open();h.forget(['opener']);assert.equal(h.state.cur,'popup');h.forget(['popup']);assert.equal(h.state.cur,'first');
});
test('a popup beyond the renderer cap closes only the new native child',async()=>{
 const h=await fixture({count:8});h.open();assert.equal(h.state.tabs.length,8);assert.equal(h.state.cur,'opener');
 assert.equal(h.closed.length,1);assert.equal(h.closed[0].id,'popup');assert.equal(h.closed[0].session,'owned-session');
 assert.equal(h.tabs.has('popup'),false);assert.equal(h.tabs.has('opener'),true);assert.deepEqual(h.toasts,['Tab limit']);
});
test('foreign-session and duplicate popup events cannot close or navigate an owned tab',async()=>{
 const h=await fixture({count:8});h.open({session:'foreign'});h.open({id:'opener'});
 assert.equal(h.closed.length,0);assert.equal(h.state.tabs.length,8);assert.equal(h.state.cur,'opener');
});
test('a private opener keeps its popup private and its return target',async()=>{
 const h=await fixture({privateOpener:true});h.open();assert.equal(h.state.tabs.at(-1).priv,true);h.forget(['popup']);assert.equal(h.state.cur,'opener');
});
