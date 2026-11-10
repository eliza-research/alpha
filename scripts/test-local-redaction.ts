#!/usr/bin/env node
import type {FixtureEvidence} from './host-fixture-types.ts';
/** Opt-in real-provider qualification. Owns only a new synthetic profile. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {sourceDirectory,verifySource} from './local-agent-source.ts';
import {readLocalAgentStream} from '../apps/app/src/runtime/local-agent-stream.ts';

if(!process.argv.includes('--live'))throw Error('Pass --live to send synthetic test prompts to the configured Cerebras provider.');
if(process.platform==='win32')throw Error('This qualification requires POSIX process groups.');
const product=path.resolve(import.meta.dirname,'..');
const source=process.env.ALPHA_ELIZA_SOURCE?path.resolve(process.env.ALPHA_ELIZA_SOURCE):sourceDirectory(product);
const lock=JSON.parse(fs.readFileSync(path.join(product,'upstream.lock.json'),'utf8'));
verifySource(source,lock.commit);
const bun=execFileSync('/usr/bin/which',[process.env.ALPHA_BUN||'bun'],{encoding:'utf8'}).trim();
if(!path.isAbsolute(bun)||/[\r\n]/.test(bun))throw Error('Expected an absolute Bun executable.');
const output=path.join(product,'test-results','local-redaction');fs.mkdirSync(output,{recursive:true});
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-redaction-'));fs.chmodSync(fixture,0o700);
const profile=path.join(fixture,'profile'),wireFile=path.join(fixture,'wire.jsonl');
const email='alpha.redaction.probe@example.invalid',phone='+1 202-555-0147';
const credentials=[
 {name:'quoted spaces',text:'password="q7 CredentialTailZ8"',marker:'CredentialTailZ8'},
 {name:'escaped quote',text:JSON.stringify({password:'q7"CredentialTailZ8'}),marker:'CredentialTailZ8'},
 {name:'escaped newline',text:JSON.stringify({password:'q7\nCredentialTailZ8'}),marker:'CredentialTailZ8'},
 {name:'HTTPS userinfo',text:'https://synthetic:q7@CredentialTailZ8@example.invalid/path',marker:'CredentialTailZ8'},
 {name:'database userinfo',text:'postgresql://user:q7@@CredentialTailZ8@localhost:5432/db',marker:'CredentialTailZ8'},
 {name:'short named password',text:'password="z9Q2!"',marker:'z9Q2!'},
];
const markers=[...new Set(credentials.map((c: any)=>c.marker))];
// RELEASE content-class probes: synthetic values shaped like what Alpha can put in front of the
// agent. Each must reach the provider only as a placeholder. The selected note, mail and file
// blocks stand in for context the owner attached; each carries a secret-shaped value of its own.
// Every listed marker of a class is checked, so a class with two secrets fails if either leaks.
const contentClasses=[
 {name:'password vault entry',text:'Saved login for synthetic.example.invalid: username jane, password "VaultTailQ4xR9!"',markers:['VaultTailQ4xR9!']},
 {name:'TOTP code',text:'Your one-time verification code is 480216. It expires in 30 seconds.',markers:['480216']},
 {name:'recovery codes',text:'Recovery codes: RCVY-4K9M-2P7X RCVY-8D3N-5T1V RCVY-6H2J-9Q4W',markers:['RCVY-4K9M-2P7X']},
 {name:'API key',text:'API key: sk-synthetic-2b7f3c9d4e1a6b8c0d2e4f6a8b0c1d3e',markers:['sk-synthetic-2b7f3c9d4e1a6b8c0d2e4f6a8b0c1d3e']},
 {name:'selected note',text:'Selected note "Accounts": the bank PIN is 7319 and the passphrase is "NoteTail Kp2 Vw8"',markers:['NoteTail Kp2 Vw8','7319']},
 {name:'selected mail',text:'Selected mail from billing@example.invalid: your account password was reset to "MailTailM3nB7"',markers:['MailTailM3nB7']},
 {name:'selected file',text:'Selected file credentials.txt: DB_PASSWORD=FileTailZ5cL1',markers:['FileTailZ5cL1']},
];
const classMarkers=contentClasses.map((c: any)=>c.markers);
// Record booleans only; never provider headers, credentials, or request bodies.
const preload=path.join(fixture,'wire.mjs');
fs.writeFileSync(preload,`import {appendFileSync} from 'node:fs';
const original=globalThis.fetch;
globalThis.fetch=async function(input,init){
 const url=input instanceof Request?input.url:String(input);
 if(new URL(url).hostname==='api.cerebras.ai'){
  const body=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';
  const record={captured:body.length>0,rawEmail:body.includes(${JSON.stringify(email)}),rawPhone:body.includes(${JSON.stringify(phone)}),rawCredential:${JSON.stringify(markers)}.some(value=>body.includes(value)),
   rawContentClasses:${JSON.stringify(classMarkers)}.map((values,index)=>values.some(value=>body.includes(value))?index:-1).filter(index=>index>=0),placeholder:/__ELIZA_(SECRET|CONTACT)_/.test(body)};
  appendFileSync(${JSON.stringify(wireFile)},JSON.stringify(record)+'\\n',{mode:0o600});
 }
 return original.call(this,input,init);
};\n`,{mode:0o600});
const quote=(value: any)=>"'"+value.replaceAll("'","'\\''")+"'";
const wrapper=path.join(fixture,'bun-instrumented');
fs.writeFileSync(wrapper,`#!/bin/sh\nexec ${quote(bun)} --preload ${quote(preload)} "$@"\n`,{mode:0o700});
const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=(socket.address() as import('node:net').AddressInfo).port;await new Promise((resolve: any)=>socket.close(resolve));
const origin=`http://127.0.0.1:${port}`;
let child:import('node:child_process').ChildProcess|undefined,token:string|undefined,owner:string|undefined,retainedConversation:string|undefined,runtimePid:number|undefined;
const wait=(ms: any)=>new Promise((resolve: any)=>setTimeout(resolve,ms));
async function request(route: any,body: any=undefined,credential: any=token){
 const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw Error(`Qualification request failed: HTTP ${response.status}`);
 return response.json();
}
async function start(){
 const log=fs.openSync(path.join(fixture,'launcher.log'),'a',0o600);
 child=spawn(process.execPath,['scripts/start-local-remote.ts'],{cwd:product,detached:true,stdio:['ignore',log,log],env:{...process.env,ALPHA_BUN:wrapper,ALPHA_ELIZA_SOURCE:source,ALPHA_REMOTE_PROFILE:profile,ALPHA_REMOTE_PORT:String(port),ELIZA_ASR_ENABLED:'0',ELIZA_PARADEE_ENABLED:'0',ELIZA_SECRET_SWAP_ENABLED:'true',ELIZA_PII_SWAP_ENABLED:'true'}});fs.closeSync(log);
 let exited=false;child.once('exit',()=>{exited=true;});const deadline=Date.now()+180000;
 while(true){
  if(exited)throw Error('Isolated runtime exited before readiness.');
  if(Date.now()>deadline)throw Error('Isolated runtime readiness deadline exceeded.');
  try{const root=fs.readFileSync(path.join(profile,'owner-token'),'utf8').trim();const response=await fetch(origin+'/api/auth/status',{headers:{Authorization:'Bearer '+root},signal:AbortSignal.timeout(2000)});if(response.ok){const status=await response.json();const code=await request('/api/auth/pair-code',undefined,root);const paired=await request('/api/auth/pair',{code:code.code,instanceId:status.instanceId},root);assert.equal(paired.access,'owner');token=paired.token;const who=await request('/api/auth/me');assert.equal(who.access.role,'OWNER');const agents=await request('/api/agents');if(agents.agents?.length===1){const metadata=JSON.parse(fs.readFileSync(path.join(profile,'process.json'),'utf8'));assert.equal(metadata.revision,lock.commit);assert.equal(metadata.egressRedactionRequested,'all');assert.ok(Number.isInteger(metadata.pid));runtimePid=metadata.pid;owner=who.identity.id;return;}}}catch{}
  await wait(500);
 }
}
async function stop(){
 if(!child)return;
 const current=child;child=undefined;
 const terminate=(signal: any)=>{try{process.kill(-current.pid!,signal);}catch(error: any){if(error.code!=='ESRCH')throw error;}};
 terminate('SIGTERM');
 const deadline=Date.now()+10000;while(current.exitCode===null&&current.signalCode===null&&Date.now()<deadline)await wait(50);
 // The complete isolated process group belongs to this fixture, including workers.
 terminate('SIGKILL');
 if(current.exitCode===null&&current.signalCode===null)await once(current,'exit');
}
const interrupted=()=>{void stop().finally(()=>process.exit(130));};process.once('SIGINT',interrupted);process.once('SIGTERM',interrupted);
const report: FixtureEvidence={checkedAt:new Date().toISOString(),source:lock.commit,scope:'Synthetic real-provider host requests; no browser UI or Android acceptance',cases:[],passed:false};
const safe=(text: any)=>![...markers,...classMarkers.flat()].some((value: any)=>text.includes(value))&&!/__ELIZA_(SECRET|CONTACT)_/.test(text);
const restored=(text: any)=>text.includes(email)&&text.includes(phone);
try{
 await start();const firstOwner=owner,firstPid=runtimePid;
 for(const [index,credential]of credentials.entries()){
  const {conversation}=await request('/api/conversations',{title:'Synthetic privacy qualification '+index});if(index===0)retainedConversation=conversation.id;
  const reply=await request(`/api/conversations/${conversation.id}/messages`,{text:`Draft a fictional contact card for Jane using email ${email} and telephone ${phone}. Include both contact values exactly. This unrelated test credential must not appear in the card: ${credential.text}. Do not send anything or use tools.`,channelType:'DM',clientMessageId:crypto.randomUUID()});
  report.cases.push({name:credential.name,contactsRestored:restored(reply.text||''),safe:safe(reply.text||'')});
 }
 // One turn per content class, each in its own conversation, so a wire record maps to one class.
 const classWireStart=fs.existsSync(wireFile)?fs.readFileSync(wireFile,'utf8').trim().split('\n').filter(Boolean).length:0;
 report.contentClasses=[];
 for(const [index,probe]of contentClasses.entries()){
  const {conversation}=await request('/api/conversations',{title:'Synthetic content-class qualification '+index});
  const reply=await request(`/api/conversations/${conversation.id}/messages`,{text:`Here is context I selected:\n${probe.text}\nReply only with the word "noted". Do not repeat the context, send anything or use tools.`,channelType:'DM',clientMessageId:crypto.randomUUID()});
  report.contentClasses.push({name:probe.name,safe:safe(reply.text||'')});
 }
 const classWire=fs.readFileSync(wireFile,'utf8').trim().split('\n').filter(Boolean).slice(classWireStart).map((line:string)=>JSON.parse(line));
 // Every provider request of these turns carries placeholders and none of the raw values.
 report.contentClassWire={requests:classWire.length,noRawValues:classWire.length>=contentClasses.length&&classWire.every((row: any)=>row.captured&&row.rawContentClasses.length===0),placeholders:classWire.length>0&&classWire.every((row: any)=>row.placeholder)};
 const {conversation}=await request('/api/conversations',{title:'Synthetic streaming privacy qualification'});let progress='',progressSafe=true;
 const signal=AbortSignal.timeout(120000);const response=await fetch(origin+`/api/conversations/${conversation.id}/messages/stream`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({text:`Draft a fictional contact card with email ${email} and telephone ${phone}. Include both exactly. Exclude this unrelated password="q7 CredentialTailZ8". Do not send anything or use tools.`,channelType:'DM',streamProtocol:'delta-v2',clientMessageId:crypto.randomUUID()}),signal});
 const reply=await readLocalAgentStream(response,signal,(text: any)=>{progress=text;progressSafe=progressSafe&&safe(text);});
 report.stream={contactsRestored:restored(reply.text),safe:safe(reply.text),progressSafe,progressReceived:progress.length>0};
 await stop();await start();
 const retained=await request(`/api/conversations/${retainedConversation}/messages`,{text:'Repeat the fictional contact card from earlier, including its exact email and phone. Keep unrelated credentials out. Do not use tools or send anything.',channelType:'DM',clientMessageId:crypto.randomUUID()});
 report.restart={distinctRuntimeProcess:runtimePid!==firstPid,ownerRetained:owner===firstOwner,contactsRestored:restored(retained.text||''),safe:safe(retained.text||'')};
 const wire=fs.readFileSync(wireFile,'utf8').trim().split('\n').map((line:string)=>JSON.parse(line));
 report.wire={requests:wire.length,safe:wire.length>=credentials.length+contentClasses.length+2&&wire.every((row: any)=>row.captured&&!row.rawCredential&&!row.rawEmail&&!row.rawPhone&&row.rawContentClasses.length===0)};
 report.passed=report.cases.every((row: any)=>row.contactsRestored&&row.safe)&&report.contentClasses.every((row: any)=>row.safe)&&report.contentClassWire.noRawValues&&report.contentClassWire.placeholders&&Object.values(report.stream).every(Boolean)&&Object.values(report.restart).every(Boolean)&&report.wire.safe;
}finally{
 await stop();fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2)+'\n');
 // The private synthetic profile is retained for failure diagnosis, never copied
 // into the repository or included in the public summary.
 console.log(JSON.stringify(report,null,2));
 if(report.passed)fs.rmSync(fixture,{recursive:true,force:true});else console.error('Private synthetic evidence retained at '+fixture);
}
if(!report.passed)process.exitCode=1;
