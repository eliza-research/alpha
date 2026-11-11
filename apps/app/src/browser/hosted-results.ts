import {beginNoticeAction} from './notice-action';
import {browserScreenLocked} from './screen-locked';
import {WebPlugin} from '@capacitor/core';
import type {HostedResultBinding,HostedResultRoute} from '../runtime/hosted-result-notices';
import {revision} from './revision';
import {BrowserDomainDocument} from './domain-document';
import {browserDocuments} from './documents';

type RecordRow=HostedResultRoute&{id:string;digest:string;at:number;revision:string;phase:'posted'|'opened'|'dismissed'|'denied'};
type State={enabled:boolean;polling:boolean;rows:RecordRow[];pending?:{id:string;token:string}};
const key='alpha.browser.hosted-results.v1';
export const hostedResultsDocument=new BrowserDomainDocument(browserDocuments,key,()=>localStorage.getItem(key));
const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('alpha.browser.documents.v1');
const initial=():State=>({enabled:true,polling:true,rows:[]});
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
function canonical(value:unknown):string{return JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);}
const blocked=()=>document.hidden||document.documentElement.dataset.devBackground==='true'||!!browserScreenLocked();
const matches=(a:HostedResultRoute,b:HostedResultBinding)=>a.scope===b.scope&&a.origin===b.origin&&a.ownerId===b.ownerId&&a.agentId===b.agentId;
/** Redacted browser notice ledger. Result bodies stay in the authenticated digest store. */
export class BrowserHostedResults extends WebPlugin {
 private binding?:{sessionId:string;value:HostedResultBinding};
 private session=revision();
 constructor(){super();if(channel)channel.onmessage=event=>{if(event.data?.key===key)this.changed(false);};const retire=()=>{this.session=revision();};for(const event of ['alpha:device-state','blur','pagehide','pageshow'])window.addEventListener(event,retire);document.addEventListener('visibilitychange',retire);window.addEventListener('storage',event=>{if(event.key===key)this.changed();});}
 bind(sessionId:string,value:HostedResultBinding){const binding={sessionId,value};this.binding=binding;this.changed();return ()=>{if(this.binding===binding){this.binding=undefined;this.changed();}};}
 async disableBackground(input?:{sessionId:string}){if(!input||input.sessionId===this.binding?.sessionId)this.binding=undefined;}
 private changed(broadcast=true){if(broadcast)channel?.postMessage({key});window.dispatchEvent(new Event('alpha:hosted-notices-changed'));}
 private async retained(route:HostedResultRoute){const binding=this.binding;if(!binding||!binding.value.current()||!matches(route,binding.value))throw Error('Hosted account changed');const result=(await binding.value.history()).find(row=>row.runId===route.runId&&row.workflowId===route.workflowId&&row.workflowVersionId===route.workflowVersionId);if(this.binding!==binding||!binding.value.current()||!result)throw Error('Result is not retained');const digest=await hash(canonical(result));if(this.binding!==binding||!binding.value.current())throw Error('Hosted account changed');return {digest,binding};}
 async publishResult(route:HostedResultRoute){
  for(const field of ['scope','origin','ownerId','agentId','runId','workflowId','workflowVersionId'] as const)if(typeof route[field]!=='string'||!route[field]||route[field].length>2048)throw Error('Invalid result identity');
  if(route.scope!==await hash(JSON.stringify([route.origin,route.ownerId,route.agentId]))||!/^\w[\w-]{0,127}$/.test(route.runId))throw Error('Result scope mismatch');
  const {digest,binding}=await this.retained(route),id=await hash(route.scope+':'+route.runId);
  const phase=await hostedResultsDocument.edit(initial,state=>{if(this.binding!==binding||!binding.value.current())throw Error('Hosted account changed');const prior=state.rows.find(row=>row.id===id);if(prior){if(prior.digest!==digest)throw Error('Retained result changed');return prior.phase==='dismissed'?'opened':prior.phase;}
   const saved:RecordRow={scope:route.scope,origin:route.origin,ownerId:route.ownerId,agentId:route.agentId,runId:route.runId,workflowId:route.workflowId,workflowVersionId:route.workflowVersionId,id,digest,at:Date.now(),revision:revision(),phase:state.enabled?'posted':'denied'};state.rows.push(saved);while(state.rows.length>200){const index=state.rows.findIndex(row=>row.id!==id&&row.id!==state.pending?.id);state.rows.splice(index,1);}return saved.phase;});this.changed();return {phase};
 }
 async pendingResult(){const state=await hostedResultsDocument.read(initial),row=state.rows.find(row=>row.id===state.pending?.id);if(!row||!state.pending)return {};let retained=false;try{retained=(await this.retained(row)).digest===row.digest;}catch{}const {digest,at,revision,phase,id,...route}=row;return {...route,token:state.pending.token,retained};}
 async consumeResult(input:{token:string}){
  const binding=this.binding;
  await hostedResultsDocument.edit(initial,state=>{
   const pending=state.pending;
   if(!pending||pending.token!==input.token)throw Error('Result link changed');
   const row=state.rows.find(row=>row.id===pending.id);
   if(!row||!binding||this.binding!==binding||!binding.value.current()||!matches(row,binding.value))throw Error('Hosted account changed');
   row.phase='opened';
   delete state.pending;
  });
  this.changed();
 }
 async status(){const state=await hostedResultsDocument.read(initial);return {enabled:state.enabled,backgroundEnabled:state.polling&&!!this.binding?.value.current(),backgroundStatus:state.polling?'waiting':'paused'};}
 async setBackgroundPolling(input:{enabled:boolean}){if(typeof input.enabled!=='boolean')throw Error('Invalid polling preference');await hostedResultsDocument.edit(initial,state=>{state.polling=input.enabled;});this.changed();return this.status();}
 async setNotifications(input:{enabled:boolean}){if(typeof input.enabled!=='boolean')throw Error('Invalid notification preference');await hostedResultsDocument.edit(initial,state=>{state.enabled=input.enabled;for(const row of state.rows)row.revision=revision();});this.changed();return this.status();}
 async enable(){return this.setNotifications({enabled:true});}
 async list(){const state=await hostedResultsDocument.read(initial);return state.enabled?state.rows.filter(row=>row.phase==='posted').map(row=>({id:row.id,revision:row.revision+':'+this.session,source:'hosted' as const,appLabel:'Alpha Phone',title:'Scheduled digest',text:blocked()?'':'Ready',at:row.at,clearable:true,canOpen:!blocked()})):[];}
 async action(input:{id:string;revision:string},open:boolean){const action=beginNoticeAction();try{await hostedResultsDocument.edit(initial,state=>{const row=state.rows.find(row=>row.id===input.id);if(blocked()||!state.enabled||!row||row.phase!=='posted'||input.revision!==row.revision+':'+this.session)throw Error('Result notification changed');if(open){if(state.pending?.id!==row.id)state.pending={id:row.id,token:crypto.randomUUID()};}else row.phase='dismissed';},action.signal);this.changed();if(open&&!action.signal.aborted&&!blocked())await this.notifyListeners('pendingResult',{});}finally{action.dispose();}}
}
export const browserHostedResults=new BrowserHostedResults();
