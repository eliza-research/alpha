// Host contract for RELEASE redaction probes: switching the agent connection (for example Eliza
// Cloud to the resident runtime) never resends earlier raw context. The real AlphaClient from
// apps/app/src runs with two synthetic in-memory transports; nothing leaves the process and no
// model is called. Synthetic values only; this is source evidence, not device or provider evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {tsImport} from './support/ts-import.mjs';

const {AlphaClient,AlphaClientError}=await tsImport('../apps/app/src/runtime/alpha-client.ts',import.meta.url);

// One synthetic value per content class the egress redaction probes cover.
const RAW={
 vaultPassword:'VaultEntry-Synthetic-7Qz!pW',
 totp:'480216',
 recoveryCodes:'rc-4k9m-2p7x rc-8d3n-5t1v',
 apiKey:'sk-synthetic-2b7f3c9d4e1a6b8c0d2e4f6a8b0c1d3e',
 note:'Selected note: synthetic diagnosis memo 9921',
 mail:'Selected mail: synthetic invoice IBAN-SYN-0042',
 file:'Selected file: synthetic payroll row 7731',
};
const rawText=Object.entries(RAW).map(([kind,value])=>`${kind}=${value}`).join('\n');
const leaked=value=>Object.values(RAW).filter(raw=>JSON.stringify(value).includes(raw));
const session=(origin,sessionId)=>({ownerId:'synthetic-owner',agentId:'synthetic-agent',sessionId,origin});

/** Records exactly what the client hands a transport; `hold` keeps a send open until released. */
function transport(origin,sessionId,{hold=false}={}){
 const sent=[];let release;
 return {sent,release:()=>release?.(),value:{
  session:session(origin,sessionId),
  async send(input){
   sent.push(JSON.parse(JSON.stringify({text:input.text,context:input.context,replyTo:input.replyTo??null,channelType:input.channelType??null})));
   if(hold)await new Promise((resolve,reject)=>{release=resolve;input.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});
   return {text:'Synthetic reply',proposals:[{id:'proposal-'+sent.length,title:'Synthetic',description:'Synthetic',expiresAt:Date.now()+60000,contextRevision:input.context.revision}]};
  },
  async execute(input){return {proposalId:input.proposal.id,status:'succeeded',summary:'Synthetic'};},
 }};
}

test('a new connection receives only what is sent after the switch, never earlier raw context',async()=>{
 const client=new AlphaClient();
 const cloud=transport('https://cloud.example.invalid','cloud-session'),resident=transport('https://resident.example.invalid','resident-session');
 client.attachVerifiedTransport(cloud.value);
 client.setViewContext({view:'notes',selectedObject:{kind:'note',id:'note-synthetic-1',revision:'r1'}});
 const first=await client.send(`Summarize this for me:\n${rawText}`);
 assert.equal(cloud.sent.length,1);
 assert.deepEqual(leaked(cloud.sent[0].text).length,Object.keys(RAW).length,'the first connection received what the owner sent it');
 assert.equal(first.proposals.length,1);

 // The switch: the next agent starts from nothing it was not given.
 client.attachVerifiedTransport(resident.value);
 await assert.rejects(client.approve(first.proposals[0].id),error=>error instanceof AlphaClientError&&error.code==='proposal-unavailable','a proposal from the old connection cannot execute on the new one');
 await client.send('What can you help with?');
 assert.equal(resident.sent.length,1,'nothing was replayed to the new connection');
 assert.equal(resident.sent[0].text,'What can you help with?');
 assert.deepEqual(leaked(resident.sent[0]),[],'no earlier raw value reaches the new connection');
 // The view context carries opaque identifiers only, unchanged by the switch.
 assert.deepEqual(resident.sent[0].context.selectedObject,{kind:'note',id:'note-synthetic-1',revision:'r1'});
 assert.equal(cloud.sent.length,1,'the old connection receives nothing after the switch');
});

test('a request in flight at the switch is cancelled and never resent to the new connection',async()=>{
 const client=new AlphaClient();
 const cloud=transport('https://cloud.example.invalid','cloud-session',{hold:true}),resident=transport('https://resident.example.invalid','resident-session');
 client.attachVerifiedTransport(cloud.value);
 const pending=client.send(`Use this context:\n${rawText}`);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(cloud.sent.length,1);
 client.attachVerifiedTransport(resident.value);
 await assert.rejects(pending,error=>error instanceof AlphaClientError&&['cancelled','stale'].includes(error.code));
 assert.equal(resident.sent.length,0,'the cancelled request is not retried on the new connection');
 await client.send('Hello');
 assert.deepEqual(resident.sent.map(row=>row.text),['Hello']);
 assert.deepEqual(leaked(resident.sent),[]);
});

test('disconnecting, then connecting again, starts clean as well',async()=>{
 const client=new AlphaClient();
 const first=transport('https://cloud.example.invalid','cloud-session'),second=transport('https://cloud.example.invalid','cloud-session-2');
 client.attachVerifiedTransport(first.value);
 await client.send(`Remember: ${RAW.apiKey} ${RAW.totp}`);
 client.disconnect();
 await assert.rejects(client.send('Anything?'),error=>error instanceof AlphaClientError&&error.code==='unconfigured');
 client.attachVerifiedTransport(second.value);
 await client.send('Anything?');
 assert.deepEqual(second.sent.map(row=>row.text),['Anything?']);
 assert.deepEqual(leaked(second.sent),[]);
});
