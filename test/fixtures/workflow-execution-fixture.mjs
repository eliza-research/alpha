import vm from 'node:vm';import fs from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
import {workflowRendererFixture} from '../../scripts/workflow-renderer-fixture.mjs';
import {WorkflowProtocol,WorkflowAdmissionRejected,WorkflowMetadataRejected,WorkflowLifecycleRejected} from '../../apps/app/src/runtime/workflow-protocol.ts';
const source=fs.readFileSync('apps/app/src/prototype/workflow-adapter.ts','utf8').replace(/^import .*;\n/gm,'').replace('export function','function')+'\nglobalThis.install=installWorkflowAdapter;';
const settle=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setImmediate(resolve));}throw Error('Bounded workflow fixture did not settle');};
export async function executionFixture({status='finished',finished=true,device=false,version='v2',reconciliation,pendingLifecycle=false}={}){
 const session={sessionId:'session',ownerId:'owner',origin:'https://agent.invalid',agentId:'agent'};
 const id='e85f6e3b-3b07-49d9-abc7-d16abf2e58e0',workflowId='3db8cb9c-95e2-4838-88ec-1f1d036c966f';
 const flow={id:workflowId,name:'Alpha direct QA — manual text workflow',description:'Saved fixture',active:false,versionId:'v2',steps:[],phoneSpec:{version:1,name:'Manual text',description:'',trigger:{kind:'manual'},...(device?{device:{installationId:'installation',enrollmentId:'enrollment'}}:{}),steps:device?[{id:'read',kind:'Read',operation:'selected_notes',notes:[{id:'fixture-note',revision:'a'.repeat(64)}]},{id:'save',kind:'Write',operation:'save_note',source:'read',title:'Fixture note'}]:[{id:'text',kind:'Read',operation:'supplied_text',text:'Provided text'},{id:'draft',kind:'Write',operation:'compose_draft',source:'text',prefix:'',suffix:''}]}};
 flow.metadata={elizaPhoneWorkflowSpec:JSON.stringify(flow.phoneSpec)};
 const run={id,workflowId,workflowVersionId:version,status,finished,startedAt:'2026-10-24T07:56:46.000Z',output:'Alpha workflow QA: supplied text reached the saved draft.',...(reconciliation?{reconciliation}:{}),events:[{runId:id,workflowId,type:'RunStarted',timestamp:'2026-10-24T07:56:47.000Z',nodeId:'typed-steps'},{runId:id,workflowId,type:'RunFinished',timestamp:'2026-10-24T07:56:48.000Z',nodeId:'typed-steps'}]};
 const requests=[],storage={};const pendingKey='alpha.workflow.pending.v1:'+JSON.stringify([session.origin,session.ownerId,session.agentId,workflowId])+':lifecycle';
 if(pendingLifecycle)storage[pendingKey]=JSON.stringify({mutationId:crypto.randomUUID(),versionId:'v2',operation:'remove'});
 const client=new WorkflowProtocol(async(path,body)=>{requests.push({path,body});if(path.endsWith('/status'))return {engine:'smthrs',status:'ready',lifecycleMutationProtocol:1};if(path.includes('/lifecycle-mutations/'))return {mutationId:path.split('/').at(-1),receipt:null};if(path.endsWith('/executions'))return {executions:[run]};if(path.includes('/executions/'))return {execution:run};return flow;});
 const controller={getWorkflowClient:()=>({client,sessionId:session.sessionId}),getSnapshot:()=>({session}),subscribe:()=>()=>{},open:()=>{throw Error('Unexpected connection screen');}};
 const localStorage=new Proxy({getItem:key=>storage[key]??null,setItem:(key,value)=>storage[key]=value,removeItem:key=>delete storage[key]},{ownKeys:()=>Object.keys(storage),getOwnPropertyDescriptor:()=>({configurable:true,enumerable:true})});
 class Shell{componentDidMount(){}componentWillUnmount(){}vset(){}S(){return {view:'workflows'}}}
 const views={workflows:{automationsManaged:true}},context=workflowRendererFixture({WorkflowAdmissionRejected,WorkflowMetadataRejected,WorkflowLifecycleRejected,connectionController:controller,localStorage,queueMicrotask,AbortController,Date,console});
 vm.runInNewContext(stripTypeScriptTypes(source,{mode:'transform'}),context);context.install(Shell,views);const shell=new Shell();shell.componentDidMount();const api={isActive:()=>true,track:()=>'',kx:()=>'',ic:{clock:'clock',check:'check'},toast:()=>{}};
 const render=()=>views.workflows.render({},api);render().openWorkflow(workflowId);await settle(()=>render().detail&&!render().fd.isRunning);
 return {render,requests,storage,pendingKey,context,flow,run,close:()=>shell.componentWillUnmount(),async openRun(){render().fd.runs[0].open();await settle(()=>render().runOpen&&!render().r.againDisabled);return render().r;}};
}
