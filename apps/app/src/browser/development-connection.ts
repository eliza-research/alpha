import {developmentWorkflowRequest} from './development-workflows';
import {developmentIdentity,readDevelopmentIdentity,verifyDevelopmentIdentity,assertDevelopmentIdentity,assertDevelopmentProfile,type DevelopmentProfile} from './development-identity';
import {developmentActionRequest} from './development-actions';
import {readDevelopmentAgent,editDevelopmentAgent,type DevelopmentConversation as Conversation} from './development-agent-document';
import type {LocalAgentBridge} from '../runtime/local-agent';
export const developmentName=(profile:DevelopmentProfile)=>`${profile==='local'?'On-device':profile==='cloud'?'Cloud':'Remote'} agent · development`;
export async function developmentReply(profile:DevelopmentProfile,signal?:AbortSignal){assertDevelopmentProfile(profile);return (await readDevelopmentAgent(await readDevelopmentIdentity(profile,signal),signal)).reply;}
export async function saveDevelopmentReply(profile:DevelopmentProfile,reply:string,signal?:AbortSignal){assertDevelopmentProfile(profile);const identity=developmentIdentity(profile);await verifyDevelopmentIdentity(identity,signal);if(typeof reply!=='string'||!reply.trim()||reply.length>16000)throw Error('Enter a reply between 1 and 16000 characters.');await editDevelopmentAgent(identity,data=>{data.reply=reply;},signal);}
/** Local protocol fixture for explicit dev profiles. It has no network or credential APIs. */
export function developmentBridge(profile:DevelopmentProfile,identity=developmentIdentity(profile)):LocalAgentBridge{
 assertDevelopmentProfile(profile);const {ownerId,agentId}=identity;
 return {start:async()=>({state:'running'}),async request(input,signal){
  signal?.throwIfAborted();assertDevelopmentProfile(profile);await verifyDevelopmentIdentity(identity,signal);const path=input.path,body=input.body===undefined?undefined:JSON.parse(input.body);let result:unknown;
  if(path==='/api/auth/me')result={identity:{id:ownerId,kind:'owner'},access:{role:'OWNER',mode:'local'}};
  else if(path==='/api/agents')result={agents:[{id:agentId,name:developmentName(profile),status:'running'}]};
  else{
   if(input.ownerId!==ownerId)throw Error('Development owner changed.');
   const check=()=>{signal?.throwIfAborted();assertDevelopmentIdentity(identity);const selected=JSON.parse(localStorage.getItem('alpha.connection.selection.v1')||'null');if(selected?.kind!=='development'||selected.profile!==profile)throw Error('Development selection changed.');};check();
   if(path.startsWith('/api/workflow/'))result=await developmentWorkflowRequest(identity,path,body,signal);
   else if(path.startsWith('/api/client-devices/'))result=await developmentActionRequest(profile,path,body,signal,identity);
   else if(path==='/api/conversations'&&input.method==='GET')result={conversations:(await readDevelopmentAgent(identity,signal)).conversations.map(({id,title})=>({id,title}))};
   else if(path==='/api/conversations'&&input.method==='POST')result=await editDevelopmentAgent(identity,data=>{check();if(data.conversations.length>=100)throw Error('Development history is full.');const title=body?.title;if(typeof title!=='string'||title.length>256)throw Error('Choose a conversation title.');const row:Conversation={id:crypto.randomUUID(),title,messages:[],receipts:{}};data.conversations.push(row);return {conversation:{id:row.id,title}};},signal);
   else{const match=/^\/api\/conversations\/([a-zA-Z0-9_-]+)\/messages$/.exec(path);if(!match)throw Error('This development protocol operation is not configured.');
    if(input.method==='GET'){const row=(await readDevelopmentAgent(identity,signal)).conversations.find(c=>c.id===match[1]);if(!row)throw Error('Conversation not found.');result={messages:row.messages};}
    else result=await editDevelopmentAgent(identity,data=>{check();const row=data.conversations.find(c=>c.id===match[1]);if(!row)throw Error('Conversation not found.');const text=body?.text,id=body?.clientMessageId;if(typeof text!=='string'||!text.trim()||text.length>200000||typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw Error('Choose a development message.');if(['__proto__','constructor','prototype'].includes(id))throw Error('Invalid message identity.');const prior=Object.hasOwn(row.receipts,id)?row.receipts[id]:undefined;if(prior){if(prior.input!==text)throw Error('Message identity changed.');return {text:prior.text,agentName:developmentName(profile)};}if(row.messages.length>198)throw Error('Development conversation is full.');const reply=data.reply,userMessageId=crypto.randomUUID(),messageId=crypto.randomUUID();row.messages.push({id:userMessageId,role:'user',text},{id:messageId,role:'assistant',text:reply});row.receipts[id]={input:text,text:reply};
     // The identities of the two messages just stored, as a real agent returns them. A voice turn is
     // spoken only when its reply can be matched to the message that asked for it.
     return {text:reply,agentName:developmentName(profile),userMessageId,messageId};},signal);
   }
   check();
  }
  await verifyDevelopmentIdentity(identity,signal);signal?.throwIfAborted();return {status:200,body:JSON.stringify(result)};
 }};
}
