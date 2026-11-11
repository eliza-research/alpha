// Back, Home and opening a view move the assistant (pill, composer, sheet, full) through the
// shared mobile shell reducer (@elizaos/ui/mobile-shell/core). This runs model.js's own
// navigation methods against that reducer; the browser specs cover the rendered shell.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {tsImport} from './support/ts-import.mjs';
const {navigateMobileShell}=await tsImport('../.eliza/client-features/packages/ui/src/mobile-shell/navigation.ts',import.meta.url);

const model=readFileSync(process.env.ALPHA_SHELL_MODEL_SOURCE||'apps/app/src/prototype/model.js','utf8');
const start=model.indexOf('  goHome(chat) {'),end=model.indexOf('\n  }\n',model.indexOf('  back() {'))+4;
const methods=model.slice(start,end);
assert.ok(methods.includes('shellNavigate(action)')&&methods.trim().endsWith('}'));

function shell(initial,props={}){
  // Browser rests with its composer open; Notes and Files rest as a pill.
  const context={VIEWS:{notes:{},files:{},browser:{chat:'input'}},isMvpView:()=>true,navigateMobileShell};
  vm.createContext(context);
  vm.runInContext(`class Shell {
    constructor(){this.state=Object.assign({view:null,stack:[],chat:'input',voice:'off',drawer:false,drawerQ:'',secure:false,shade:false},${JSON.stringify(initial)});this.props=${JSON.stringify(props)};this.left=[];this.closed=0;}
    S(){return this.state;} clear(){} leave(){this.left.push(this.state.view);} vget(){return {};} vreset(){} vset(){} homeHint(){} toast(){}
    mod(k){return VIEWS[k]||{};}
    defaultChat(k){return this.mod(k).chat==='input'?'input':'hidden';}
    rest(){var v=this.S().view;return v?this.defaultChat(v):'input';}
    setState(patch){Object.assign(this.state,patch);}
    stopVoice(){this.state.voice='off';} closeAssistant(){this.closed++;}
    ${methods}
  }
  globalThis.shell=new Shell();`,context);
  return context.shell;
}
const at=s=>({view:s.state.view,chat:s.state.chat,stack:[...s.state.stack]});

test('Home from the assistant entry closes its window without replacing the draft or navigating hidden Home',()=>{
  const s=shell({chat:'full',draft:'Keep these unsent words'},{assistantSurface:true});
  s.goHome();assert.equal(s.closed,1);assert.equal(s.state.chat,'full');assert.equal(s.state.draft,'Keep these unsent words');
  const app=shell({chat:'full'});app.goHome();assert.equal(app.closed,0);assert.equal(app.state.chat,'input');
});

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

test('a bar raised over a pill view lowers to the pill before Back leaves the view', () => {
  const s=shell({});
  s.openView('notes');
  s.state.chat='input';
  s.back();assert.deepEqual(at(s),{view:'notes',chat:'hidden',stack:[]},'the raised bar lowers to the pill');
  s.back();assert.deepEqual(at(s),{view:null,chat:'input',stack:[]},'only then Back leaves Notes');
  // Home and Browser rest in the bar: it is not a level there.
  s.openView('browser');s.back();assert.equal(s.state.view,null);
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

test('Back stops voice and lowers the visible conversation before closing the Home drawer', () => {
  const s=shell({chat:'full',drawer:true,drawerQ:'ma',voice:'listening'});
  const layers=()=>[s.state.drawer,s.state.drawerQ,s.state.voice,s.state.chat];
  s.back();assert.deepEqual(layers(),[true,'ma','off','full']);
  s.back();assert.deepEqual(layers(),[true,'ma','off','sheet']);
  s.back();assert.deepEqual(layers(),[true,'ma','off','input']);
  s.back();assert.deepEqual(layers(),[false,'','off','input']);
});

for(const chat of ['sheet','full'])test(`Alpha Home closes the ${chat} overlay and keeps the unsent draft`,()=>{
  const s=shell({view:'notes',chat,stack:['files'],draft:'Keep this unsent draft'});
  s.swallowed=()=>false;
  const source=model.match(/backToApps: (function \(event\) \{[^\n]+\}),\n/)[1];
  const backToApps=vm.runInNewContext('('+source+')',{self:s});
  backToApps({detail:1,currentTarget:{hasAttribute:name=>name==='data-alpha-chat-home'}});
  assert.deepEqual(at(s),{view:null,chat:'input',stack:[]});
  assert.equal(s.state.draft,'Keep this unsent draft');
});
