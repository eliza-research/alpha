// The real AlphaClient refuses agent turns while the view is marked sensitive (the password vault,
// for example) and hands its transport nothing. Synthetic in-memory transport; no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';

const {AlphaClient,AlphaClientError}=await tsImport('../apps/app/src/runtime/alpha-client.ts',import.meta.url);

function transport(){
 const sent=[];
 return {sent,value:{
  session:{ownerId:'synthetic-owner',agentId:'synthetic-agent',sessionId:'synthetic-session',origin:'https://agent.example.invalid'},
  async send(input){sent.push(input.text);return {text:'Synthetic reply',proposals:[]};},
  async execute(input){sent.push(input.proposal.id);return {proposalId:input.proposal.id,status:'succeeded',summary:'Synthetic'};},
 }};
}

test('a sensitive view refuses send with code sensitive and issues no request',async()=>{
 const client=new AlphaClient(),agent=transport();
 client.attachVerifiedTransport(agent.value);
 client.setViewContext({view:'settings',sensitive:true});
 await assert.rejects(client.send('Read me the saved password'),error=>error instanceof AlphaClientError&&error.code==='sensitive');
 assert.deepEqual(agent.sent,[]);
 assert.equal(client.getState().pending,false);

 // Leaving the sensitive view lets the next turn through, so the refusal came from the flag.
 client.setViewContext({view:'settings'});
 await client.send('What can you help with?');
 assert.deepEqual(agent.sent,['What can you help with?']);
});

test('changing the local thread selection retires a proposal without sending the thread ID',async()=>{
 const client=new AlphaClient(),agent=transport(),observed=[];
 agent.value.send=async({context})=>{
  observed.push(context);
  return {text:'Share this conversation?',proposals:[{id:'read',title:'Share messages',description:'Share the open thread',expiresAt:Date.now()+60000,contextRevision:context.revision}]};
 };
 client.attachVerifiedTransport(agent.value);
 const view={view:'messages',selectedObject:{kind:'sms-subscription',id:'1'}};
 client.setViewContext(view,'private-thread-a');
 await client.send('Share the open conversation');
 client.setViewContext(view,'private-thread-a');
 assert.equal(client.getState().context.revision,observed[0].revision);
 client.setViewContext(view,'private-thread-b');
 assert.deepEqual(client.getState().context,{...observed[0],revision:observed[0].revision+1});
 assert.doesNotMatch(JSON.stringify(observed),/private-thread/);
 await assert.rejects(client.approve('read'),{code:'proposal-unavailable'});
 assert.deepEqual(agent.sent,[]);
});
