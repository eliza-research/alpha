/** Shared production schemas and validators, with a deliberately uncredentialed preview host. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('canonical development preparation keeps civil-time ambiguity and never grants a native effect', {timeout:120000}, async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),dir=await mkdtemp(path.join(tmpdir(),'canonical-development-actions-'));
 try{
 await symlink(path.join(root,'backend/node_modules'),path.join(dir,'node_modules'),'dir');
 const fixture=path.join(dir,'fixture.ts'),runner=path.join(dir,'build.ts');
 await writeFile(fixture,`
import assert from 'node:assert/strict';
import {proposalActions,navigationAction,installDevelopmentViews,turns} from ${JSON.stringify(path.join(root,'backend/proposal-action.ts'))};
import {deviceActionTools} from '@elizaos/plugin-assistant';
import {findViewActionHandoff} from '@elizaos/core/protocol';
const runtime={agentId:'44444444-4444-4444-8444-444444444444',getRoom:async()=>({worldId:'world'}),getWorld:async()=>({id:'world',metadata:{roles:{'11111111-1111-4111-8111-111111111111':'OWNER'},ownership:{ownerId:'11111111-1111-4111-8111-111111111111'}}}),getSetting:()=>undefined,getEntityById:async()=>null,reportError:()=>{throw Error('unexpected delivery error')}};
const message={id:'33333333-3333-4333-8333-333333333333',entityId:'11111111-1111-4111-8111-111111111111',roomId:'22222222-2222-4222-8222-222222222222',content:{text:'Create a preview',metadata:{viewClientId:'55555555-5555-4555-8555-555555555555',viewDelivery:'completed-action'}}};
const scope=()=>({revision:4,proposals:[],signal:new AbortController().signal});
const invoke=(action,turn,parameters)=>turns.run(turn,()=>action.handler(runtime,message,undefined,{parameters}));
assert.deepEqual(proposalActions.map(a=>a.name),['DEVICE_NOTE_CREATE','DEVICE_REMINDER_CREATE']);
for(const action of proposalActions)assert.deepEqual(action.parameters,deviceActionTools.find(a=>a.name===action.name).parameters);
const [note,reminder]=proposalActions;
delete process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;
let turn=scope();assert.equal((await invoke(note,turn,{operation:{type:'create_note',title:'Preview',body:'Exact body'},operationKey:'note-1',reason:'Requested preview'})).success,false);assert.equal(turn.proposals.length,0);
process.env.ELIZA_DEV_ALLOW_TEST_MOCKS='1';
turn=scope();assert.equal((await invoke(note,turn,{operation:{type:'create_note',title:'Preview',body:'Exact body'},operationKey:'note-1',reason:'Requested preview'})).success,true);assert.equal(turn.proposals[0].simulated,true);assert.deepEqual(turn.proposals[0].operation,{type:'create_note',title:'Preview',body:'Exact body'});
const reminderParams=(localDate,localTime,timeZone)=>({operation:{type:'reminder_create',fields:{title:'Preview reminder',body:'Exact reminder',schedule:{localDate,localTime,timeZone,alertMinutes:0,recurrence:null}}},operationKey:'reminder-1',reason:'Requested preview'});
for(const params of [reminderParams('2030-11-03','01:30','America/Los_Angeles'),reminderParams('2030-03-10','02:30','America/Los_Angeles'),reminderParams('2030-05-01','14:00','Unknown/Zone')]){turn=scope();assert.equal((await invoke(reminder,turn,params)).success,false);assert.equal(turn.proposals.length,0);}
turn=scope();assert.equal((await invoke(reminder,turn,reminderParams('2030-05-01','14:00','UTC'))).success,true);assert.equal(turn.proposals[0].operation.fields.schedule.at,Date.parse('2030-05-01T14:00:00Z'));assert.equal(turn.proposals[0].simulated,true);
turn=scope();turn.signal=AbortSignal.abort();assert.equal((await invoke(note,turn,{operation:{type:'create_note',title:'Preview',body:'Exact body'},operationKey:'note-2',reason:'Requested preview'})).success,false);assert.equal(turn.proposals.length,0);
const dispose=installDevelopmentViews(runtime);
try{turn=scope();const result=await invoke(navigationAction,turn,{action:'show',view:'Calendar'});assert.equal(result.success,true);assert.equal(turn.proposals.length,1);const handoff=findViewActionHandoff([turn.proposals[0].navigation]);assert.equal(handoff.navigationPrepared,true);assert.equal(handoff.completedActionDelivered,undefined);assert.equal(handoff.viewId,'calendar');assert.equal(handoff.completedActionHandoffId,turn.proposals[0].id);assert.match(handoff.navigationBinding.installationId,/^[a-f0-9-]{36}$/);assert.equal(turn.proposals[0].operation.type,'open_view');assert.equal(turn.proposals[0].operation.view,'calendar');}finally{dispose();}
console.log('PASS: canonical schemas, no-effect preparation, ambiguous/nonexistent/invalid-zone rejection, exact UTC timing, cancellation and registry-bound prepared navigation. No model or native device used.');
`);
 await writeFile(runner,`import {createConsumerSourceResolver} from ${JSON.stringify(path.join(root,'vendor/eliza/packages/app/scripts/lib/consumer-source-resolver.mjs'))};const {plugin}=createConsumerSourceResolver({sourceRoot:${JSON.stringify(path.join(root,'vendor/eliza'))},consumerRoots:[${JSON.stringify(root)},${JSON.stringify(dir)}]});const result=await Bun.build({entrypoints:[${JSON.stringify(fixture)}],outdir:${JSON.stringify(dir)},target:'bun',plugins:[plugin]});if(!result.success){console.error(result.logs);process.exit(1);}`);
 const build=spawnSync(process.env.ALPHA_BUN||'bun',[runner],{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024});assert.equal(build.status,0,build.stdout+build.stderr);
 const run=spawnSync(process.env.ALPHA_BUN||'bun',[path.join(dir,'fixture.js')],{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});assert.equal(run.status,0,run.stdout+run.stderr);console.log(run.stdout.trim());
 }finally{await rm(dir,{recursive:true,force:true});}
});
