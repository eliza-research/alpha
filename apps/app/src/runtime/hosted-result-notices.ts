import { registerPlugin } from '../platform-plugins';
import { type PluginListenerHandle } from '@capacitor/core';
import type { DigestResult } from './hosted-digests';
export interface HostedResultRoute { scope:string;origin:string;ownerId:string;agentId:string;runId:string;workflowId:string;workflowVersionId:string }
export interface HostedResultNative {
 publishResult(route:HostedResultRoute):Promise<{phase:string}>;
 pendingResult():Promise<Partial<HostedResultRoute>&{token?:string;retained?:boolean;question?:boolean}>;
 releaseResultQuestion?(input:{token:string}):Promise<void>;
 consumeResult(input:{token:string}):Promise<void>;
 /** Android: these runs were shown in the app, so their notices are withdrawn. A captured tap stays pending. */
 withdrawResult?(input:{scope:string;runIds:string[]}):Promise<{withdrawn:number}>;
 /** Android: the scope whose results panel is on screen, or null. A result for it posts silently. */
 setResultsShowing?(input:{scope:string|null}):Promise<void>;
 status():Promise<{enabled:boolean;backgroundEnabled?:boolean;backgroundStatus?:string;lastSuccess?:number}>;
 setBackgroundPolling(input:{enabled:boolean}):Promise<{enabled:boolean;backgroundEnabled?:boolean}>;
 enable():Promise<{enabled:boolean}>;
 addListener(event:'pendingResult',listener:()=>void):Promise<PluginListenerHandle>;
}
export const hostedResultNative=registerPlugin<HostedResultNative>('AlphaHostedResults');
export interface HostedResultBinding {
 scope:string;origin:string;ownerId:string;agentId:string;
 current():boolean;
 revalidate(signal:AbortSignal):Promise<boolean>;
 history():Promise<DigestResult[]>;
}
export async function publishHostedResult(native:HostedResultNative,binding:HostedResultBinding,result:DigestResult,signal:AbortSignal){
 signal.throwIfAborted();if(!binding.current())throw new Error('Hosted account changed');
 const resultState=await native.publishResult({scope:binding.scope,origin:binding.origin,ownerId:binding.ownerId,agentId:binding.agentId,runId:result.runId,workflowId:result.workflowId,workflowVersionId:result.workflowVersionId});
 signal.throwIfAborted();if(!binding.current())throw new Error('Hosted account changed');
 if(!['posted','opened','denied','uncertain'].includes(resultState.phase))throw new Error('Notice outcome unknown');
 return resultState;
}
/** No automatic account selection, workflow execution, or unverified result display. */
export async function resolveHostedResultTap(native:HostedResultNative,binding:HostedResultBinding|null,signal:AbortSignal):Promise<{kind:'none'|'other-account'|'unavailable'}|{kind:'ready';token:string;question:boolean;result:DigestResult}>{
 const tap=await native.pendingResult();signal.throwIfAborted();if(!tap.token)return {kind:'none'};
 if(!binding||!binding.current()||tap.scope!==binding.scope||tap.origin!==binding.origin||tap.ownerId!==binding.ownerId||tap.agentId!==binding.agentId)return {kind:'other-account'};
 if(!await binding.revalidate(signal))return {kind:'unavailable'};signal.throwIfAborted();if(!binding.current())throw new Error('Hosted account changed');
 const result=(await binding.history()).find(row=>row.runId===tap.runId&&row.workflowId===tap.workflowId&&row.workflowVersionId===tap.workflowVersionId);
 signal.throwIfAborted();if(!binding.current())throw new Error('Hosted account changed');
 if(!result||tap.retained!==true)return {kind:'unavailable'};
 return {kind:'ready',token:tap.token,question:tap.question===true,result};
}
