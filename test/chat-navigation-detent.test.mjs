import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {tsImport} from 'tsx/esm/api';
const {alphaNavigation}=await tsImport('../apps/app/src/product/alpha-product.ts',import.meta.url);
const {navigateMobileShell}=await tsImport('../.eliza/client-features/packages/ui/src/mobile-shell/navigation.ts',import.meta.url);
// Only Notes is available here; the product registry resolves Home and canonical ids.
const notesOnly=alphaNavigation(view=>view==='notes');

const adapter=readFileSync('apps/app/src/prototype/agent-adapter.ts','utf8');
const helper=adapter.slice(adapter.indexOf('  function openInternalView('),adapter.indexOf('  function context(shell:',adapter.indexOf('  function openInternalView(')));
assert.ok(helper.includes('async function deliverChatNavigation'));
const model=readFileSync('apps/app/src/prototype/model.js','utf8');
const transitions=model.slice(model.indexOf('  goHome(chat) {'),model.indexOf('  back() {',model.indexOf('  goHome(chat) {')));
assert.ok(transitions.includes('openView(k, patch, chat, opts)'));
function harness(initial,source=helper){
  const context={views:{notes:{}},VIEWS:{notes:{}},isMvpView:view=>view==='notes',alphaViewKey:notesOnly.viewKey,navigateMobileShell,alphaClient:{getState:()=>({context:{}})},context:()=>{}};
  vm.createContext(context);
  vm.runInContext(`class Shell {
    constructor(){this.state=${JSON.stringify(initial)};this.live=true;this.transitions=[];this.toasts=[];}
    S(){return this.state;} clear(){} leave(){} mod(){return {};}
    defaultChat(){return 'hidden';} vget(){return {};} vreset(){} vset(){} homeHint(){} toast(message){this.toasts.push(message);}
    setState(patch,done){Object.assign(this.state,patch);this.transitions.push({...this.state});done?.();}
    ${transitions}
  }
  ${stripTypeScriptTypes(source,{mode:'transform'})}
  globalThis.shell=new Shell();globalThis.deliver=deliverChatNavigation;`,context);
  return {shell:context.shell,deliver:context.deliver};
}
function navigation(view,beforeCommit=()=>{}){
  return {attempt:{current(){}},client:{async deliver(_results,attempt,apply){attempt.current();beforeCommit();await apply(view,()=>attempt.current());return {status:'delivered',label:view};}}};
}
for(const chat of ['sheet','full'])for(const [from,to] of [['notes','home'],[null,'notes']]){
  test(`typed navigation keeps ${chat} from ${from??'home'} to ${to} without an intermediate collapsed render`,async()=>{
    const {shell,deliver}=harness({view:from,chat,secure:false});
    assert.equal(await deliver(shell,navigation(to),[{}]),true);
    assert.equal(shell.S().view,to==='home'?null:to);assert.equal(shell.S().chat,chat);
    assert.ok(shell.transitions.every(state=>state.chat===chat));
  });
}
test('closing chat while response is pending does not reopen it at delivery',async()=>{
  const {shell,deliver}=harness({view:'notes',chat:'sheet',secure:false});
  await deliver(shell,navigation('home',()=>shell.setState({chat:'hidden'})),[{}]);
  assert.equal(shell.S().view,null);assert.equal(shell.S().chat,'input');
  assert.ok(shell.transitions.every(state=>!['sheet','full'].includes(state.chat)));
});
test('voice continuation still owns its selected detent',async()=>{
  const {shell,deliver}=harness({view:'notes',chat:'sheet',secure:false});let applied=0;
  const continuation={async apply(view,check,commit){applied++;assert.equal(view,'home');check();return commit('full');}};
  await deliver(shell,navigation('home'),[{}],undefined,continuation);
  assert.equal(applied,1);assert.equal(shell.S().chat,'full');
});
test('regression control: original no-detent navigation collapses the actual shell',async()=>{
  const old=helper.replace("commit(chat==='sheet'||chat==='full'?chat:undefined)","commit()");
  const {shell,deliver}=harness({view:'notes',chat:'sheet',secure:false},old);
  await deliver(shell,navigation('home'),[{}]);assert.equal(shell.S().chat,'input');
});

test('successful chat navigation has no redundant success popup',async()=>{
  const {shell,deliver}=harness({view:'notes',chat:'sheet',secure:false});
  assert.equal(await deliver(shell,navigation('home'),[{}]),true);
  assert.equal(shell.toasts.length,0);
});
test('unconfirmed navigation preserves its actionable warning',async()=>{
  const {shell,deliver}=harness({view:'notes',chat:'sheet',secure:false});
  const uncertain={attempt:{current(){}},client:{async deliver(){return {status:'unknown'};}}};
  assert.equal(await deliver(shell,uncertain,[{}]),false);
  assert.equal(shell.toasts.length,1);assert.equal(shell.toasts[0],'Could not confirm the screen change. Check your screen.');
});
