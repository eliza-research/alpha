import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('startup OFF warning survives mount races once without replaying listener shutdown',()=>{
 const source=readFileSync(new URL('../apps/app/src/main.tsx',import.meta.url),'utf8');
 const begin=source.indexOf('ref={(value: any) => { shell = value;');assert(begin>=0);
 const end=source.indexOf('} />',begin);assert(end>begin);
 const ref=source.slice(begin+5,end).replace('(value: any)','(value)');
 const marker='stopWakeListenerForChatOnly().then(';const a=source.indexOf(marker);assert(a>=0);assert.equal(source.indexOf(marker,a+1),-1);
 const z=source.indexOf('\n  });',a);const stopped=source.slice(a+marker.length,z)+'\n  }';
 const warning='Wake listening could not be confirmed off. Turn it off in Android settings.';
 function fixture(){const queue=[],context={queueMicrotask:f=>queue.push(f)};vm.runInNewContext('let shell;let pendingNotice;const ref='+ref+';const stopped='+stopped+';globalThis.result={ref,stopped,pending:()=>pendingNotice};',context);return{...context.result,flush(){while(queue.length)queue.shift()();},queue};}
 const shell=()=>({live:true,notices:[],toast(n){this.notices.push(n);}});
 {const f=fixture(),s=shell();f.stopped(false);assert.equal(f.pending(),warning);f.ref(s);f.flush();assert.deepEqual(s.notices,[warning]);assert.equal(f.pending(),undefined);f.ref(s);f.flush();assert.deepEqual(s.notices,[warning]);}
 {const f=fixture(),s=shell();f.ref(s);f.stopped(false);assert.deepEqual(s.notices,[warning]);f.flush();assert.deepEqual(s.notices,[warning]);}
 {const f=fixture(),old=shell(),next=shell();f.stopped(false);f.ref(old);f.ref(next);f.flush();assert.deepEqual(old.notices,[]);assert.deepEqual(next.notices,[warning]);assert.equal(f.pending(),undefined);}
 {const f=fixture(),old=shell(),next=shell();f.stopped(false);f.ref(old);f.ref(null);f.flush();assert.deepEqual(old.notices,[]);assert.equal(f.pending(),warning);f.ref(next);f.flush();assert.deepEqual(next.notices,[warning]);}
 {const f=fixture(),dead=shell(),next=shell();dead.live=false;f.ref(dead);f.stopped(false);f.flush();assert.deepEqual(dead.notices,[]);assert.equal(f.pending(),warning);f.ref(next);f.flush();assert.deepEqual(next.notices,[warning]);}
 {const f=fixture(),dead=shell(),next=shell();f.stopped(false);f.ref(dead);dead.live=false;f.flush();assert.deepEqual(dead.notices,[]);assert.equal(f.pending(),warning);f.ref(next);f.flush();assert.deepEqual(next.notices,[warning]);}
 {const f=fixture(),s=shell();f.stopped(true);f.ref(s);f.flush();assert.deepEqual(s.notices,[]);assert.equal(f.pending(),undefined);}
 assert.doesNotMatch(ref,/stopWakeListener|installListenerInvocation|startListening|\.stop\(/);assert.doesNotMatch(stopped,/stopWakeListener|installListenerInvocation|startListening/);
});

test('startup keeps one inert shell mounted and restores its saved data before reveal',async()=>{
 const [{JSDOM},{transformSync},React,{createRoot},{ServiceReadCache}]=await Promise.all([
  import('jsdom'),import('esbuild'),import('react'),import('react-dom/client'),import('../apps/app/src/runtime/service-read-cache.ts'),
 ]);
 const source=readFileSync(new URL('../apps/app/src/main.tsx',import.meta.url),'utf8');
 const first=source.indexOf('  return <>{!mock&&<DeletionUndo/>',source.indexOf('function Phone()'));
 const last=source.indexOf('\n}',first);assert(first>0&&last>first);
 // Execute the actual Phone presentation. External panels remain separate and
 // the probe uses the real saved-read store, without an agent or provider.
 const compiled=transformSync('export function Presentation({startupPending}){'+source.slice(first,last)+'\n}',{loader:'tsx',jsx:'automatic',format:'cjs'}).code;
 const dom=new JSDOM('<div id="root"></div>',{url:'https://alpha.invalid'}),previous={window:globalThis.window,document:globalThis.document,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 let stored=null,mounts=0,unmounts=0,reads=0;
 const cache=new ServiceReadCache('verified-owner',{read:async()=>{reads++;return structuredClone(stored);},compareExchange:async(_before,value)=>{stored=structuredClone(value);return 'saved';}});
 await cache.put('calendar',{title:'Saved appointment'});reads=0;
 class Probe extends React.Component{
  state={title:''};live=true;
  componentDidMount(){mounts++;void cache.get('calendar').then(saved=>this.setState({title:saved.value.title}));}
  componentWillUnmount(){unmounts++;}
  render(){return React.createElement('button',{style:{visibility:'visible',opacity:1}},this.state.title);}
 }
 const jsx=await import('react/jsx-runtime');
 const module={exports:{}},quiet=()=>null,context={module,exports:module.exports,require:name=>{if(name==='react/jsx-runtime')return jsx;throw Error(name);},mock:false,fixture:false,testMocksEnabled:false,residentAlwaysPresent:true,BrowserDeviceControls:null,isAndroid:false,Component:Probe,DeletionUndo:quiet,ConnectionChooser:quiet,GoogleConnectionsPanel:quiet,HostedDigestPanel:quiet,StartupPermissions:quiet,connection:{},startupPermissionsActive:()=>false,questionTarget:()=>false,assistantSurface:false,launcherPresentation:false,systemShade:false,initialTheme:'light',chatPullBinding:{},setPullScale:()=>{},closeAssistant:()=>{},reopenStartupPermissions:()=>{},queueMicrotask,pendingNotice:undefined};
 vm.runInNewContext(compiled,context);const Presentation=module.exports.Presentation,root=createRoot(dom.window.document.getElementById('root'));
 try{
  await React.act(async()=>{root.render(React.createElement(Presentation,{startupPending:true}));await new Promise(resolve=>setImmediate(resolve));});
  const wrapper=dom.window.document.querySelector('[data-alpha-startup-shell]'),button=wrapper.querySelector('button');
  assert.equal(mounts,1);assert.equal(unmounts,0);assert.equal(reads,1);assert.equal(button.textContent,'Saved appointment');
  assert.equal(wrapper.getAttribute('aria-hidden'),'true');assert.equal(wrapper.hasAttribute('inert'),true);assert.equal(wrapper.style.opacity,'0');assert.equal(wrapper.style.pointerEvents,'none');
  assert.equal(button.style.visibility,'visible','a child cannot bypass its ancestor opacity even when it overrides visibility');
  assert.ok(dom.window.document.querySelector('[aria-label="Loading Alpha"]'));
  await React.act(async()=>root.render(React.createElement(Presentation,{startupPending:false})));
  assert.equal(dom.window.document.querySelector('[data-alpha-startup-shell]'),wrapper);assert.equal(wrapper.querySelector('button'),button);
  assert.equal(mounts,1);assert.equal(unmounts,0);assert.equal(wrapper.hasAttribute('inert'),false);assert.equal(wrapper.hasAttribute('aria-hidden'),false);assert.equal(wrapper.style.opacity,'1');assert.equal(wrapper.style.pointerEvents,'');
  assert.equal(button.textContent,'Saved appointment');assert.equal(dom.window.document.querySelector('[aria-label="Loading Alpha"]'),null);
 }finally{
  await React.act(async()=>root.unmount());dom.window.close();for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
 }
});

// A restored account can arrive before the resident process is connected.
test('restoring an account keeps the Alpha mark until the agent startup settles',()=>{
 const source=readFileSync(new URL('../apps/app/src/main.tsx',import.meta.url),'utf8');
 const expression=/const startupPending = (.*);/.exec(source)?.[1];assert.ok(expression);
 const pending=(connection,homeShown=false)=>vm.runInNewContext(expression,{connection,homeShown,connectionChooserVisible:value=>value.open});
 const starting={startupResolved:false,session:null,cloudAccount:{id:'restored-account'},residentPlanNotice:undefined,open:false};
 assert.equal(pending(starting),true);
 assert.equal(pending({...starting,session:{sessionId:'connected'}}),false);
 assert.equal(pending({...starting,startupResolved:true,kind:'recovering',error:'Startup failed'}),false);
 assert.equal(pending({...starting,open:true}),false);
 assert.equal(pending({...starting,residentPlanNotice:'offline'}),false);
 assert.equal(pending(starting,true),false);
});
