/** Uncredentialed development preparation using the production tool contracts.
 * No native bridge, approval claim, Notes store or scheduler is available here. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { validateActionParams, type Action, type IAgentRuntime, type Memory } from '@elizaos/core';
import { findViewActionHandoff } from '@elizaos/core/protocol';
import { deviceActionTools, resolveReadableReminderOperation, validateDeviceOperation } from '@elizaos/plugin-assistant';
import { createViewsAction } from '@elizaos/agent/actions/views';
import { beginViewInstallation, commitViewInstallation, revokeViewInstallation } from '../vendor/eliza/packages/agent/src/api/view-installations.ts';
import { DEVELOPMENT_PROPOSAL_VIEWS } from '../apps/app/src/runtime/development-view-contract.ts';

export const turns=new AsyncLocalStorage<{revision:number;proposals:any[];signal:AbortSignal}>();
function current(){
 if(process.env.ELIZA_DEV_ALLOW_TEST_MOCKS!=='1')throw Error('Development preparation is disabled');
 const turn=turns.getStore();
 if(!turn||turn.signal.aborted||turn.proposals.length>=4)throw Error('Development preparation is unavailable');
 return turn;
}
const types=new Map([['DEVICE_NOTE_CREATE','create_note'],['DEVICE_REMINDER_CREATE','reminder_create']]);
export const proposalActions:Action[]=deviceActionTools.filter(action=>types.has(action.name)).map(action=>({
 ...action,
 description:action.description+' Development preview only: prepares the exact operation for review; no native write or scheduling is available.',
 validate:async()=>process.env.ELIZA_DEV_ALLOW_TEST_MOCKS==='1'&&!!turns.getStore(),
 handler:async(_runtime,_message,_state,options)=>{
  try{
   const turn=current(),checked=validateActionParams(action,options?.parameters);
   if(!checked.valid||!checked.params)throw Error('Canonical operation parameters are required');
   const parameters=checked.params;
   const operation=validateDeviceOperation(resolveReadableReminderOperation(parameters.operation));
   if(operation.type!==types.get(action.name))throw Error('The operation does not match the selected tool');
   if(operation.type==='reminder_create'&&(operation.fields.schedule.recurrence!==null||operation.fields.schedule.alertMinutes!==0||operation.fields.schedule.at<=Date.now()))throw Error('This development preview supports a future one-time reminder only');
   const title=operation.type==='create_note'?operation.title:operation.type==='reminder_create'?operation.fields.title:'';
   const body=operation.type==='create_note'?operation.body:operation.type==='reminder_create'?operation.fields.body:'';
   const proposal={id:randomUUID(),title:'Preview '+(operation.type==='create_note'?'note: ':'reminder: ')+title,description:'Development simulation. Review the exact operation; no note will be saved and no reminder will be scheduled.\n\n'+title+'\n\n'+body,operation,simulated:true,contextRevision:turn.revision,expiresAt:Date.now()+120000};
   turn.proposals.push(proposal);
   return {success:true,text:'Prepared a development simulation for explicit review. Nothing was saved or scheduled.',data:{actionName:action.name,proposalId:proposal.id,executed:false,simulated:true,approvalRequired:true}};
  }catch{return {success:false,text:'Development preview parameters are invalid or reminder time is ambiguous. Supply the exact local date, time and IANA time zone. Nothing was prepared, saved or scheduled.'};}
 }
}));

const views=createViewsAction(async({view,clientId,handoffId,completedAction,signal,isAuthorized})=>{
 current();signal?.throwIfAborted();
 if(!completedAction||!isAuthorized())throw Error('Development navigation requires the bound originating renderer');
 return {status:200,body:{ok:true,status:'prepared',viewId:view.id,completedActionHandoffId:handoffId,navigationBinding:{requestId:handoffId,clientId,viewId:view.id,viewType:'gui',installationId:view.installationId}}};
});
export const navigationAction:Action={...views,handler:async(...args)=>{
 const turn=current(),result=await views.handler!(...args);
 const navigation={...result,actionName:'VIEWS'},handoff=findViewActionHandoff([navigation]);
 if(handoff?.navigationPrepared){
  const view=handoff.viewId==='chat'?'home':handoff.viewId==='automations'?'workflows':handoff.viewId;
  if(!(DEVELOPMENT_PROPOSAL_VIEWS as readonly string[]).includes(view))throw Error('Unregistered development view');
  turn.proposals.push({id:handoff.completedActionHandoffId,title:'Open '+view,description:'Open this local view after review. Opening a view reads or changes no records.',operation:{type:'open_view',view},navigation,contextRevision:turn.revision,expiresAt:Date.now()+120000});
 }
 return result;
}};
export function installDevelopmentViews(runtime:IAgentRuntime){
 if(process.env.ELIZA_DEV_ALLOW_TEST_MOCKS!=='1')throw Error('Development navigation is disabled');
 const installation=beginViewInstallation(runtime,'development-navigation');
 commitViewInstallation(runtime,installation,DEVELOPMENT_PROPOSAL_VIEWS.map(local=>{
  const id=local==='home'?'chat':local==='workflows'?'automations':local;
  return {id,label:local[0].toUpperCase()+local.slice(1),path:'/'+id,viewType:'gui' as const,viewKind:'release' as const,nativeOs:true,roleGate:{minRole:'OWNER' as const},pluginName:'development-navigation',hasHeroImage:false,available:false,loadedAt:Date.now(),platform:'android' as const};
 }));
 return ()=>revokeViewInstallation(runtime,installation);
}

/** Same schema and preparation path for message-service and direct-provider diagnostics. */
export function createDevelopmentPreparationSession(runtime:IAgentRuntime,messageFor:(text:string,context?:{view:string;revision:number})=>Memory,active:()=>boolean=()=>true){
 const diagnosticActions=[...proposalActions,navigationAction];
 return {
  tools:diagnosticActions.map(action=>({type:'function',function:{name:action.name,description:action.description,parameters:{type:'object',additionalProperties:false,properties:Object.fromEntries((action.parameters??[]).map(p=>[p.name,p.schema])),required:(action.parameters??[]).filter(p=>p.required).map(p=>p.name)}}})),
  async prepareActions(calls:Array<{function?:{name?:string;arguments?:string}}>,text:string,signal:AbortSignal,context?:{view:string;revision:number}){
   if(!active()||process.env.ELIZA_DEV_ALLOW_TEST_MOCKS!=='1'||signal.aborted)throw Error('Development preview is unavailable');
   const scope={revision:context?.revision??0,proposals:[] as any[],signal},message=messageFor(text,context),results=[];
   await turns.run(scope,async()=>{
    for(const call of calls.slice(0,4)){
     const action=diagnosticActions.find(action=>action.name===call.function?.name);if(!action)continue;
     let parameters;try{parameters=JSON.parse(call.function?.arguments??'');}catch{continue;}
     try{const result=await action.handler!(runtime,message,undefined,{parameters});if(result?.success&&result.text)results.push(result.text);}catch{signal.throwIfAborted();}
    }
   });
   if(signal.aborted)throw Error('Development preview was cancelled');
   return {proposals:scope.proposals,text:results.join("\n")};
  },
 };
}
/** Local navigation catalog only. This has no database, device credentials,
 * authenticated API kernel, native executor or conversation history. */
export function createDirectDevelopmentBackend(){
 if(process.env.ELIZA_DEV_ALLOW_TEST_MOCKS!=='1')throw Error('Development diagnostics are disabled');
 const agentId=randomUUID(),ownerId=randomUUID(),roomId=randomUUID(),worldId=randomUUID();
 const runtime={agentId,getRoom:async()=>({worldId}),getWorld:async()=>({id:worldId,metadata:{roles:{[ownerId]:'OWNER'},ownership:{ownerId}}}),getSetting:()=>undefined,getEntityById:async()=>null,reportError:(_name:string,error:unknown)=>{throw error;}} as unknown as IAgentRuntime;
 let closed=false;const dispose=installDevelopmentViews(runtime);
 const session=createDevelopmentPreparationSession(runtime,(text,context)=>({id:randomUUID(),agentId,entityId:ownerId,roomId,content:{text,metadata:{viewClientId:roomId,viewDelivery:'completed-action',...(context?{uiView:context.view}:{})}}}),()=>!closed);
 return {...session,info:{mode:'uncredentialed-development-preparation',semanticRecall:'unavailable; direct diagnostic does not store conversation history'},close:async()=>{closed=true;dispose();}};
}
