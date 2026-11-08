import {loadBrowserModule} from './browser-source.mjs';
export const {DeviceActions,deviceJournalContext,actionScope}=await loadBrowserModule('apps/app/src/runtime/device-actions.ts');
export function policyFixture(rows,status='succeeded') {
 const f=new DeviceActions({sessionId:'session',ownerId:'owner',agentId:'agent',origin:'https://agent.example'},{installationId:'install',enrollmentId:'enrollment'},'c'.repeat(64),async()=>({proposals:[]}),{},async()=>({status:'succeeded',summary:'fixture'}));
 f.proposals=new Map(rows.map(([id,source,workflow,type='create_note'])=>[id,{proposal:{id,digest:'a'.repeat(64),requestMessageId:source,workflow,operation:{type,...(type==='browser_navigate'?{url:'https://example.com/'}:{})}},requestKey:f.requestKey(source)}]));
 f.card=()=>({});f.calls=[];f.approve=async id=>{f.calls.push(id);return {proposalId:id,status,summary:'Test result'};};
 return f;
}
