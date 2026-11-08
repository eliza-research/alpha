import {systemNoticeKind,collapseSystemNotices} from '../apps/app/src/runtime/action-message-presentation.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const model=read('apps/app/src/prototype/model.js'),dc=read('apps/app/src/prototype/dc-lite.js'),adapter=read('apps/app/src/prototype/agent-adapter.ts'),connection=read('apps/app/src/runtime/connection-ui.tsx');
const slice=(source,start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
const base=slice(model,'var BASE = {','class Component extends DCLogic');
const component=slice(model,'class Component extends DCLogic {','  componentDidMount()')+'}';
const dcConstructor=slice(dc,'    constructor(p)','    render()');
const callback=stripTypeScriptTypes('(function(){const session=connectionController.getSnapshot().session?.sessionId;'+slice(adapter,'      const history = connectionController.getSnapshot().history;','      syncStoppedReplyNotice(')+'})',{mode:'strip'});
const merge=stripTypeScriptTypes(slice(connection,'export function mergeConversationDelivery','const actionReceipts =').replace('export ',''),{mode:'strip'});
function fixture(){
 let snapshot={session:{sessionId:'owner-a'},history:null,conversationDelivery:null};const pending=[];
 const box={systemNoticeKind,collapseSystemNotices,structuredClone,QUICK_SETTINGS:{wifi:false},ALPHA_PRODUCT:{identity:{characterName:'Alpha'}},Date,connectionController:{getSnapshot:()=>snapshot,getSelectedConversationId:()=> 'room'},alphaClient:{disconnect(){}},cancelMessageContext(){}};
 // Evaluate the actual shell constructor and history/delivery callback with queued React-style state updates.
 const context=vm.createContext({...box,pending});vm.runInContext('class ReactBase {constructor(props){this.props=props;}setState(update){pending.push(()=>{const patch=typeof update==="function"?update(this.state):update;if(patch)Object.assign(this.state,patch);});}} class DCLogic extends ReactBase {'+dcConstructor+'}'+base+component+';globalThis.Component=Component;'+merge+';globalThis.changed='+callback,context);
 const shell=new context.Component({});Object.assign(shell,{live:true,composerDraft:{retire(){}},closeSummaryReview(){}});
 return {shell,newShell:()=>new context.Component({}),setSnapshot:value=>snapshot=value,get snapshot(){return snapshot;},changed:()=>context.changed.call(shell),flush:()=>{while(pending.length)pending.shift()();}};
}
const history=(messages=[{id:'saved',text:'Saved reply'}])=>({sessionId:'owner-a',conversationId:'room',messages,automatic:true,deliveryRevisionAtStart:1});
test('cold shell owns complete raw state before mount or a history subscription',()=>{const f=fixture();assert.ok(Array.isArray(f.shell.state.msgs));assert.equal(f.shell.state.draft,'');f.setSnapshot({...f.snapshot,history:history()});f.changed();f.flush();assert.equal(f.shell.state.msgs[0].id,'saved');});
test('cold automatic history restores saved messages before the first shell update',()=>{const f=fixture();f.setSnapshot({...f.snapshot,history:history()});f.changed();f.flush();assert.equal(f.shell.state.msgs[0].id,'saved');});
test('automatic history keeps a newer concurrent delivery and the current draft',()=>{const f=fixture();f.shell.state.msgs=[];f.shell.state.draft='Unsent';f.setSnapshot({...f.snapshot,history:history()});f.changed();f.shell.state.msgs.push({id:'new',conversationDeliveryRevision:2,messageBinding:{conversationId:'room'}});f.flush();assert.deepEqual(Array.from(f.shell.state.msgs,m=>m.id),['saved','new']);assert.equal(f.shell.state.draft,'Unsent');});
test('queued history cannot apply after the selected history changes',()=>{const f=fixture();f.shell.state.msgs=[{id:'current'}];f.setSnapshot({...f.snapshot,history:history()});f.changed();f.setSnapshot({...f.snapshot,history:null});f.flush();assert.equal(f.shell.state.msgs[0].id,'current');});
test('owner change retires queued history before it can install old messages',()=>{const f=fixture();f.shell.state.msgs=[{id:'current'}];f.setSnapshot({...f.snapshot,history:history()});f.changed();f.setSnapshot({session:{sessionId:'owner-b'},history:null,conversationDelivery:null});f.flush();assert.equal(f.shell.state.msgs[0].id,'current');});
test('delivery arriving before history or mount merges into initialized messages',()=>{const f=fixture();f.setSnapshot({...f.snapshot,conversationDelivery:{sessionId:'owner-a',conversationId:'room',revision:1,messages:[{id:'delivery',text:'New reply'}]}});f.changed();f.flush();assert.equal(f.shell.state.msgs[0].id,'delivery');});
test('shell defaults are isolated across instances',()=>{const f=fixture(),other=f.newShell();f.shell.state.msgs.push({id:'local'});f.shell.state.vs.notes={open:'one'};assert.equal(other.state.msgs.length,0);assert.equal(other.state.vs.notes,undefined);});
test('queued delivery cannot cross an owner change',()=>{const f=fixture();f.setSnapshot({...f.snapshot,conversationDelivery:{sessionId:'owner-a',conversationId:'room',revision:1,messages:[{id:'old-owner'}]}});f.changed();f.setSnapshot({session:{sessionId:'owner-b'},history:null,conversationDelivery:null});f.flush();assert.equal(f.shell.state.msgs.length,0);});
test('history does not import concurrent messages from another room',()=>{const f=fixture();f.shell.state.msgs=[{id:'foreign',conversationDeliveryRevision:2,messageBinding:{conversationId:'other'}}];f.setSnapshot({...f.snapshot,history:history()});f.changed();f.flush();assert.deepEqual(Array.from(f.shell.state.msgs,m=>m.id),['saved']);});
test('explicit history selection retains its existing full-chat and draft-clear behavior',()=>{const f=fixture();f.shell.state.draft='old room draft';f.setSnapshot({...f.snapshot,history:{...history(),automatic:false}});f.changed();f.flush();assert.equal(f.shell.state.chat,'full');assert.equal(f.shell.state.draft,'');assert.equal(f.shell.state.msgs[0].id,'saved');});
