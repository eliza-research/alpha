// Back, Home and opening a view move the assistant (pill, composer, sheet, full) through the
// shared mobile shell reducer (@elizaos/ui/mobile-shell/core). This runs model.js's own
// navigation methods against that reducer; the browser specs cover the rendered shell.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {tsImport} from 'tsx/esm/api';
const {navigateMobileShell}=await tsImport('../.eliza/client-features/packages/ui/src/mobile-shell/navigation.ts',import.meta.url);

const model=readFileSync('apps/app/src/prototype/model.js','utf8');
const start=model.indexOf('  goHome(chat) {'),end=model.indexOf('\n  }\n',model.indexOf('  back() {'))+4;
const methods=model.slice(start,end);
assert.ok(methods.includes('shellNavigate(action)')&&methods.trim().endsWith('}'));

function shell(initial){
  // Browser rests with its composer open; Notes and Files rest as a pill.
  const context={VIEWS:{notes:{},files:{},browser:{chat:'input'}},isMvpView:()=>true,navigateMobileShell};
  vm.createContext(context);
  vm.runInContext(`class Shell {
    constructor(){this.state=Object.assign({view:null,stack:[],chat:'input',voice:'off',drawer:false,drawerQ:'',secure:false,shade:false},${JSON.stringify(initial)});this.left=[];}
    S(){return this.state;} clear(){} leave(){this.left.push(this.state.view);} vget(){return {};} vreset(){} vset(){} homeHint(){} toast(){}
    mod(k){return VIEWS[k]||{};}
    defaultChat(k){return this.mod(k).chat==='input'?'input':'hidden';}
    rest(){var v=this.S().view;return v?this.defaultChat(v):'input';}
    setState(patch){Object.assign(this.state,patch);}
    stopVoice(){this.state.voice='off';} closeAssistant(){}
    ${methods}
  }
  globalThis.shell=new Shell();`,context);
  return context.shell;
}
const at=s=>({view:s.state.view,chat:s.state.chat,stack:[...s.state.stack]});

test('Back lowers an open conversation one detent before it leaves the view', () => {
  const s=shell({});
  s.openView('notes');
  assert.deepEqual(at(s),{view:'notes',chat:'hidden',stack:[]},'Notes rests as a pill');
  s.openView('browser',null,'full',{push:true});
  assert.deepEqual(at(s),{view:'browser',chat:'full',stack:['notes']});
  s.back();assert.deepEqual(at(s),{view:'browser',chat:'sheet',stack:['notes']});
  s.back();assert.deepEqual(at(s),{view:'browser',chat:'input',stack:['notes']},'the sheet lowers to the browser composer');
  s.back();assert.deepEqual(at(s),{view:'notes',chat:'hidden',stack:[]},'only then Back returns to the previous view');
  s.back();assert.deepEqual(at(s),{view:null,chat:'input',stack:[]},'and then Home, resting in the composer');
});

test('Home and view changes set the detent the destination rests in, unless one is asked for', () => {
  const s=shell({view:'notes',chat:'sheet'});
  s.openView('files');assert.equal(s.state.chat,'hidden');
  s.openView('browser');assert.equal(s.state.chat,'input');
  s.openView('notes',null,'sheet');assert.equal(s.state.chat,'sheet');
  s.goHome();assert.deepEqual(at(s),{view:null,chat:'input',stack:[]});
  s.goHome('full');assert.equal(s.state.chat,'full');
  s.back();assert.equal(s.state.chat,'sheet');
  s.back();assert.equal(s.state.chat,'input');
  // keepState returns to a view as it was left and still takes its rest detent.
  s.openView('browser',null,null,{keepState:true});assert.deepEqual(at(s),{view:'browser',chat:'input',stack:[]});
});

test('the drawer over Home closes before the conversation, and voice stops before either', () => {
  const s=shell({chat:'sheet',drawer:true,drawerQ:'ma'});
  s.back();assert.deepEqual([s.state.drawer,s.state.drawerQ,s.state.chat],[false,'','sheet']);
  s.state.voice='listening';
  s.back();assert.deepEqual([s.state.voice,s.state.chat],['off','sheet']);
  s.back();assert.equal(s.state.chat,'input');
});
