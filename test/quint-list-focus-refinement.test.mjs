import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {JSDOM} from 'jsdom';
import {captureInputs, checkTraces, qmap, qset} from '../specs/quint/refinement/check-traces.mjs';

const source='apps/app/src/prototype/keyed-list-focus.ts';
const sources=[source,'test/quint-list-focus-refinement.test.mjs','test/quint-list-focus-refinement.test.mjs'];
const root=new URL('../',import.meta.url);

function fixture(code){
 const dom=new JSDOM('<main><div id="root1"><div id="column1"></div><div id="column2"></div></div><div id="root2"></div></main>',{pretendToBeVisual:true});
 const {document,HTMLElement}=dom.window;
 HTMLElement.prototype.getClientRects=function(){return this.style.display==='none'?[]:[this.getBoundingClientRect()];};
 const roots=[null,document.getElementById('root1'),document.getElementById('root2')];
 const nodes=new Map([1,2,3,4,5].map(id=>{const node=document.createElement('button');node.textContent='node'+id;node.dataset.node=String(id);if(id<5)node.dataset.key=String(id===4?2:1);return[id,node];}));
 const owner=id=>id===4?2:1;
 const snapshots=new Map(),tickets=new Map(),listeners=new Map(),queue=[];
 let scheduling,hidden=false,lastRestored=0,lastIntended=0,preservedOtherFocus=true,restoring=false;
 Object.defineProperty(document,'hidden',{get:()=>hidden});
 const add=document.addEventListener.bind(document),remove=document.removeEventListener.bind(document);
 document.addEventListener=(name,handler,...rest)=>{if(name==='focusin'&&scheduling)listeners.set(handler,scheduling.slot);return add(name,handler,...rest);};
 document.removeEventListener=(name,handler,...rest)=>{if(name==='focusin')listeners.delete(handler);return remove(name,handler,...rest);};
 const queueMicrotask=callback=>{assert.ok(scheduling,'source schedules only inside capture/ref');queue.push({...scheduling,callback});if(scheduling.kind==='restore')tickets.set(scheduling.slot,manager.inspect().revision);};
 const context=vm.createContext({document,HTMLElement,queueMicrotask});
 vm.runInContext(code+'\nglobalThis.create=createKeyedListFocus;',context);
 const manager=context.create('data-key');
 for(const [id,node]of nodes){const original=node.focus.bind(node);node.focus=options=>{if(restoring)lastRestored=id;original(options);};}
 const nodeId=node=>node===document.body?0:Number(node?.dataset?.node||0);
 function renderNodes(ids){for(const [id,node]of nodes){if(!ids.includes(id))node.remove();else if(!node.parentNode)(owner(id)?roots[owner(id)].children[id===2?1:0]||roots[owner(id)]:document.querySelector('main')).append(node);}}
 renderNodes([1,4,5]);
 function capture(slot){scheduling={slot,kind:'capture'};snapshots.set(slot,manager.capture());tickets.set(slot,0);scheduling=undefined;}
 function ref(slot,id){scheduling={slot,kind:'restore'};manager.ref(snapshots.get(slot)||null)(roots[id]);scheduling=undefined;}
 function refWithoutCapture(id){manager.ref(null)(roots[id]);}
 function flush(){const pending=queue.shift();assert.ok(pending);const before=document.activeElement;
  if(pending.kind==='restore'){lastRestored=0;lastIntended=Number(snapshots.get(pending.slot).key);restoring=true;}
  pending.callback();restoring=false;
  if(pending.kind==='restore')preservedOtherFocus=before===document.body||document.activeElement===before;
  return {name:pending.kind==='capture'?'expireCapture':'restore',args:[pending.slot]};
 }
 const values=()=>{
  const state=manager.inspect();
  const captureValue=slot=>{const snapshot=snapshots.get(slot);return snapshot?{
   valid:true,root:roots.indexOf(snapshot.root),key:Number(snapshot.key),node:nodeId(snapshot.element),moved:snapshot.moved,committed:snapshot.committed,
   listening:[...listeners.values()].includes(slot),captureQueued:queue.some(row=>row.slot===slot&&row.kind==='capture'),restoreQueued:queue.some(row=>row.slot===slot&&row.kind==='restore'),ticket:tickets.get(slot)||0,
  }:{valid:false,root:0,key:0,node:0,moved:false,committed:false,listening:false,captureQueued:false,restoreQueued:false,ticket:0};};
  return {'s.root':roots.indexOf(state.root),'s.revision':state.revision,'s.present':qset([...nodes].filter(([,node])=>!!node.parentNode).map(([id])=>id)),
   's.connectedRoots':qset([1,2].filter(id=>roots[id].isConnected)),
   's.hiddenRoots':qset([1,2].filter(id=>roots[id].hasAttribute('inert'))),
   's.hiddenNodes':qset([...nodes].filter(([,node])=>node.hasAttribute('hidden')).map(([id])=>id)),
   's.disabled':qset([...nodes].filter(([,node])=>node.disabled).map(([id])=>id)),
   's.documentHidden':document.hidden,'s.dialog':!!document.querySelector('dialog[open]'),'s.focus':nodeId(document.activeElement),
   's.captures':qmap([1,2].map(slot=>[slot,captureValue(slot)])),
   's.queue':queue.map(row=>row.slot+(row.kind==='restore'?2:0)),
   's.lastRestored':lastRestored,'s.lastIntended':lastIntended,'s.preservedOtherFocus':preservedOtherFocus};
 };
 return {dom,values,capture,ref,refWithoutCapture,flush,renderNodes,
  focusNode:id=>nodes.get(id).focus(),blur:()=>document.activeElement.blur(),
  rootConnected:(id,value)=>value?document.querySelector('main').append(roots[id]):roots[id].remove(),
  rootHidden:(id,value)=>roots[id].toggleAttribute('inert',value),nodeHidden:(id,value)=>nodes.get(id).toggleAttribute('hidden',value),
  nodeDisabled:(id,value)=>nodes.get(id).disabled=value,documentHidden:value=>hidden=value,
  dialog:value=>{if(value){const dialog=document.createElement('dialog');dialog.open=true;document.body.append(dialog);}else document.querySelector('dialog')?.remove();}};
}

async function listFocus(extraSources=[]){
 const inputs=[...sources,...extraSources];
 const driverHashes=captureInputs(inputs);
 let code=stripTypeScriptTypes(readFileSync(new URL(source,root),'utf8'),{mode:'strip'}).replace(/^export /gm,'');
 const marker='return {\n    capture()';assert.equal(code.split(marker).length,2,'exact read-only observer insertion');
 // The getter exposes actual closure values. Queue/listener shims retain source callbacks.
 code=code.replace(marker,'return {\n    inspect: () => ({root, revision}),\n    capture()');
 const traces=[];
 for(const scenario of ['restore','removed','duplicate','other','other-blur','hidden-root','hidden-node','disabled','dialog','hidden-document','disconnected','navigation','newer-commit','discarded','unchanged','two-captures','restoring-before-expiry']){
  const f=fixture(code),trace={name:scenario,init:{name:'init'},expect:f.values(),steps:[]};
  const step=(name,...args)=>{f[name](...args);trace.steps.push({label:`actual ${name}(${args.join(',')})`,action:{name,args},expect:f.values()});};
  const flush=()=>{const action=f.flush();trace.steps.push({label:`execute queued source ${action.name}`,action,expect:f.values()});};
  try{
   step('refWithoutCapture',1);step('focusNode',1);step('capture',1);
   if(scenario==='restoring-before-expiry'){
    step('ref',1,1);flush();step('capture',2);step('renderNodes',[2,4,5]);
    trace.steps.at(-1).action.args=[qset([2,4,5])];
    flush();flush();traces.push(trace);continue;
   }
   if(scenario==='two-captures')step('capture',2);
   if(scenario==='discarded')flush();
   if(scenario!=='unchanged')step('renderNodes',scenario==='removed'?[4,5]:scenario==='duplicate'?[2,3,4,5]:[2,4,5]);
   // Quint sets use an explicit serializer while this source operation takes an array.
   const rendered=trace.steps.findLast(row=>row.action.name==='renderNodes');if(rendered)rendered.action.args=[qset(rendered.action.args[0])];
   step('ref',1,1);if(scenario==='two-captures')step('ref',2,1);
   if(scenario!=='discarded')flush();if(scenario==='two-captures')flush();
   if(scenario==='other'||scenario==='other-blur')step('focusNode',5);
   if(scenario==='other-blur')step('blur');
   if(scenario==='hidden-root')step('rootHidden',1,true);
   if(scenario==='hidden-node')step('nodeHidden',2,true);
   if(scenario==='disabled')step('nodeDisabled',2,true);
   if(scenario==='dialog')step('dialog',true);
   if(scenario==='hidden-document')step('documentHidden',true);
   if(scenario==='disconnected')step('rootConnected',1,false);
   if(scenario==='navigation')step('refWithoutCapture',2);
   if(scenario==='newer-commit')step('refWithoutCapture',1);
   flush();if(scenario==='two-captures')flush();
   traces.push(trace);
  }finally{f.dom.window.close();}
 }
 for(const reason of ['unmounted','no-focus','other-owner','missing-key','hidden-root','disconnected','hidden-document']){
  const f=fixture(code),trace={name:'capture-'+reason,init:{name:'init'},expect:f.values(),steps:[]};
  const step=(name,...args)=>{f[name](...args);trace.steps.push({label:`actual ${name}(${args.join(',')})`,action:{name,args},expect:f.values()});};
  try{
   if(reason!=='unmounted')step('refWithoutCapture',1);
   if(!['unmounted','no-focus'].includes(reason))step('focusNode',reason==='other-owner'?4:reason==='missing-key'?5:1);
   if(reason==='hidden-root')step('rootHidden',1,true);
   if(reason==='disconnected')step('rootConnected',1,false);
   if(reason==='hidden-document')step('documentHidden',true);
   step('capture',1);traces.push(trace);
  }finally{f.dom.window.close();}
 }
 return checkTraces({model:'ListFocus',sources:inputs,driverHashes,traces,scope:'bounded-orchestration',assumptions:[
  'Actual createKeyedListFocus executes in JSDOM with a read-only getter exposing its root/revision closure and source queue callbacks executed in FIFO order.',
  'Two capture slots, two root identities and five DOM-node identities bound the schedules. DOM rendering and focus events execute through real DOM APIs; visibility geometry is an explicit JSDOM port.',
  'Browser Notes/Photos tests separately execute the real React renderer. Native accessibility, arbitrary unbounded queued renders and browser-engine-specific focus behavior remain outside this bounded adapter.',
 ]});
}

test('source list-focus captures and FIFO callbacks match the bounded Quint helper model', {timeout:180000}, async () => {
 const result=await listFocus();
 assert.equal(result.passed,true);
 assert.equal(result.inputsUnchanged,true);
 assert.equal(result.driverInputsBound,true);
 assert.equal(result.observedFields.length,15);
 assert.equal(result.traceInputs.length,24);
 for(const name of ['capture-unmounted','capture-no-focus','capture-other-owner','capture-missing-key',
  'restore','removed','duplicate','other','other-blur','hidden-root','hidden-node','disabled','dialog',
  'hidden-document','disconnected','navigation','newer-commit','discarded','unchanged',
  'two-captures','restoring-before-expiry'])assert(result.traceInputs.some(trace=>trace.name===name),name);
});
