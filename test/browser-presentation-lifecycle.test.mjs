import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const source=readFileSync(process.env.ALPHA_BROWSER_ADAPTER_SOURCE||'apps/app/src/prototype/browser-adapter.ts','utf8');
const start=source.indexOf('  const nativeUnderAssistant =');
const end=source.indexOf('  const openBrowserView =',start);
assert.ok(start>=0&&end>start,'exercise the actual renderer presentation update');
const updateSource=stripTypeScriptTypes(source.slice(start,end),{mode:'strip'});
function fixture(){
 const present=[],view={view:'browser',screen:'home',chat:'pill'},state={cur:'selected'};
 const rect={x:0,y:0,width:320,height:500,bottom:500,top:0};
 const element={isConnected:true,getClientRects:()=>[rect],getBoundingClientRect:()=>rect};
 const document={hidden:false,documentElement:{hasAttribute:()=>false},querySelector:()=>element};
 let saves=0,stops=0;
 const context={JSON,document,disposed:false,questionReview:false,confirming:false,clearingData:false,reading:false,
  session:'session',lastGeometry:'',hostModalOpen:()=>false,Capacitor:{isNativePlatform:()=>true},
  shell:{S:()=>view},state:()=>state,restored:new Map(),tabs:{has:()=>true},
  saveSession(){saves++;},stopReading(){stops++;context.reading=false;},
  Browser:{present(payload){present.push(payload);return Promise.resolve();}}};
 const update=vm.runInNewContext(updateSource+';update',context);
 return {context,document,view,state,present,update,get saves(){return saves},get stops(){return stops}};
}

test('pausing after presentation retains the native tab, saves state and stops reading',async()=>{
 const h=fixture();await h.update();assert.equal(h.present.at(-1).id,'selected');
 h.document.hidden=true;h.context.reading=true;await h.update();
 assert.equal(h.present.length,1,'background cannot withdraw the retained autofill tab');
 assert.equal(h.stops,1);assert.equal(h.saves,2,'pause still persists the browsing session');
 h.document.hidden=false;await h.update();assert.equal(h.present.length,1,'resume keeps unchanged geometry');
});
test('a first update while stopped does not withdraw an existing native tab',async()=>{
 const h=fixture();h.document.hidden=true;await h.update();assert.equal(h.present.length,0);assert.equal(h.saves,1);
});
test('foreground owner changes while stopped withdraw the old tab on resume',async()=>{
 const h=fixture();await h.update();h.document.hidden=true;h.view.view='notes';await h.update();
 assert.equal(h.present.length,1);h.document.hidden=false;await h.update();assert.equal(h.present.at(-1).id,null);
});
for(const [name,guard] of [
 ['modal',h=>h.context.hostModalOpen=()=>true],['content review',h=>h.context.questionReview=true],
 ['confirmation',h=>h.context.confirming=true],['address editor',h=>h.state.editing=true],
 ['tab switcher',h=>h.state.tabsOpen=true],['menu',h=>h.state.menu=true],
 ['library',h=>h.state.lib=true],['share',h=>h.state.share=true],
 ['shade',h=>h.view.shade=true],['lock screen',h=>h.view.screen='lock'],
 ['assistant sheet',h=>h.view.chat='sheet'],['assistant drag',h=>h.context.shell.chatMotion={moved:true}],
])test(`foreground ${name} still withdraws the native page`,async()=>{
 const h=fixture();await h.update();guard(h);await h.update();assert.equal(h.present.at(-1).id,null);
});
test('a disposed adapter neither persists nor presents',async()=>{
 const h=fixture();h.context.disposed=true;await h.update();assert.equal(h.saves,0);assert.equal(h.present.length,0);
});
