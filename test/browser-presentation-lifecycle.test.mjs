import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const source=readFileSync(process.env.ALPHA_BROWSER_ADAPTER_SOURCE||'apps/app/src/prototype/browser-adapter.ts','utf8');
const start=source.indexOf('  const nativeUnderlay =');
const end=source.indexOf('  const openBrowserView =',start);
assert.ok(start>=0&&end>start,'exercise the actual renderer presentation update');
const updateSource=stripTypeScriptTypes(source.slice(start,end),{mode:'strip'});
function fixture(){
 const present=[],errors=[],attributes=new Map(),view={view:'browser',screen:'home',chat:'pill'},state={cur:'selected'};
 const rect={x:0,y:0,width:320,height:500,bottom:500,top:0};
 const element={offsetWidth:320,isConnected:true,getClientRects:()=>[rect],getBoundingClientRect:()=>rect};
 const dock={offsetWidth:100,closest:()=>null,getBoundingClientRect:()=>({x:0,y:400,width:100,height:60})};
 const document={hidden:false,documentElement:{hasAttribute:()=>false,setAttribute:(name,value)=>attributes.set(name,value),getAttribute:name=>attributes.get(name),removeAttribute:name=>attributes.delete(name),style:{setProperty(){},removeProperty(){}}},querySelector:()=>element,querySelectorAll:()=>[dock]};
 let saves=0,stops=0;
 const context={JSON,document,disposed:false,questionReview:false,confirming:false,clearingData:false,reading:false,
  session:'session',lastGeometry:'',lastPresented:undefined,presentationFailed:false,presentationFrame:undefined,report:error=>errors.push(error.message),getComputedStyle:()=>({display:'block',visibility:'visible',pointerEvents:'auto',opacity:'1',borderTopLeftRadius:'30px'}),hostModalOpen:()=>false,Capacitor:{isNativePlatform:()=>true,getPlatform:()=> 'android'},
  shell:{S:()=>view},state:()=>state,restored:new Map(),tabs:{has:()=>true},
  saveSession(){saves++;},stopReading(){stops++;context.reading=false;},
  Browser:{present(payload){present.push(payload);return Promise.resolve();}}};
 const update=vm.runInNewContext(updateSource+';update',context);
 return {context,document,view,state,present,update,attributes,errors,get saves(){return saves},get stops(){return stops}};
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
])test(`foreground ${name} still withdraws the native page`,async()=>{
 const h=fixture();await h.update();guard(h);await h.update();assert.equal(h.present.at(-1).id,null);
});
test('a disposed adapter neither persists nor presents',async()=>{
 const h=fixture();h.context.disposed=true;await h.update();assert.equal(h.saves,0);assert.equal(h.present.length,0);
});

for(const [name,change] of [['sheet',h=>h.view.chat='sheet'],['full',h=>h.view.chat='full'],['drag',h=>h.context.shell.chatMotion={moved:true}]])test(`assistant ${name} keeps the page drawn at the same size and gives input to the host`,async()=>{
 const h=fixture();await h.update();const before=h.present.at(-1);change(h);await h.update();const after=h.present.at(-1);assert.equal(after.id,before.id);assert.equal(after.height,before.height);assert.equal(after.layer,'below-host');assert.equal(after.hostRects[0].height,before.height);assert(h.attributes.has('data-alpha-browser-underlay'));
});
test('a late presentation receipt cannot restore the backdrop after a newer hide',async()=>{
 const h=fixture();let release;h.context.Browser.present=payload=>{h.present.push(payload);return payload.id?new Promise(resolve=>release=resolve):Promise.resolve();};const pending=h.update();h.view.view='notes';await h.update();release();await pending;assert.equal(h.attributes.has('data-alpha-browser-underlay'),false);
});
test('a failed presentation keeps a visible backdrop and remains retryable',async()=>{
 const h=fixture();h.context.Browser.present=async()=>{throw Error('Presentation refused');};await h.update();assert.equal(h.attributes.has('data-alpha-browser-underlay'),false);assert.equal(h.context.lastGeometry,'');assert.deepEqual(h.errors,['Presentation refused']);h.context.Browser.present=async()=>{};await h.update();assert(h.attributes.has('data-alpha-browser-underlay'));
});

test('retired presentation cannot clear a replacement browser backdrop',async()=>{
 const h=fixture();await h.update();h.attributes.set('data-alpha-browser-underlay','replacement');h.view.view='notes';await h.update();assert.equal(h.attributes.get('data-alpha-browser-underlay'),'replacement');
});
