/** Real development renderer coordinator; the native network boundary is controlled. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('canonical previews never dispatch record writes and exact local navigation remains reviewed', async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'development-preview-'));
 const previous=globalThis.__developmentPreview;
 const context={view:'notes',revision:1},signal=new AbortController().signal;
 let reply,dispatched=0;
 globalThis.__developmentPreview={status:async()=>({available:true,configured:true,connected:true,mode:'development',sessionId:'development-fixture',providerOrigin:'https://provider.invalid'}),chat:async()=>reply,cancel:async()=>({cancelled:true})};
 try{
  const output=await build({entryPoints:['apps/app/src/runtime/development-transport.ts'],bundle:true,write:false,format:'esm',platform:'node',define:{'import.meta.env':'{"VITE_ELIZA_DEV_ALLOW_TEST_MOCKS":"1"}'},plugins:[{name:'controlled-native-preview-boundary',setup(builder){builder.onResolve({filter:/platform-plugins$|build-flags$/},args=>({path:args.path,namespace:'preview-fixture'}));builder.onLoad({filter:/.*/,namespace:'preview-fixture'},args=>({contents:args.path.endsWith('build-flags')?'export const testMocksEnabled=true; export const devSurfacesEnabled=true;':'export const registerPlugin=()=>globalThis.__developmentPreview;'}));}}]});
  const file=path.join(dir,'transport.mjs');await writeFile(file,output.outputFiles[0].text);
  const {createDevelopmentTransport}=await import(pathToFileURL(file));
  const transport=await createDevelopmentTransport(async operation=>{dispatched++;return {status:'succeeded',summary:'Opened '+operation.view};});
  const proposal=operation=>({id:crypto.randomUUID(),title:'Preview',description:'Development simulation',contextRevision:1,expiresAt:Date.now()+120000,operation,simulated:true});
  for(const operation of [{type:'create_note',title:'N'.repeat(256),body:'B'.repeat(32000)},{type:'reminder_create',fields:{title:'Reminder',body:'Body',schedule:{at:Date.now()+60000,dueAt:Date.now()+60000,alertMinutes:0,recurrence:null}}}]){
   if(operation.type==='reminder_create')operation.fields.schedule.dueAt=operation.fields.schedule.at;
   reply={requestId:'record',text:'Prepared a simulation',proposals:[proposal(operation)]};
   const result=await transport.send({requestId:'record',text:'Preview',context,signal});
   assert.match(result.proposals[0].description,/simulation/i);
   const receipt=await transport.execute({proposal:result.proposals[0],context,signal});
   assert.equal(receipt.status,'failed');assert.match(receipt.summary,/No note was saved and no reminder was scheduled/);assert.equal(dispatched,0);
   await assert.rejects(transport.execute({proposal:result.proposals[0],context,signal}),/not available/);
  }
  reply={requestId:'bad',text:'Invalid note',proposals:[proposal({type:'create_note',title:'N'.repeat(257),body:'Body'})]};
  await assert.rejects(transport.send({requestId:'bad',text:'Preview',context,signal}));
  const id=crypto.randomUUID(),client=crypto.randomUUID(),installation=crypto.randomUUID();
  const navigation={actionName:'VIEWS',success:true,values:{mode:'show',viewId:'calendar',viewPath:'/calendar',navigationPrepared:true,completedActionHandoffId:id,navigationBinding:{requestId:id,clientId:client,viewId:'calendar',viewType:'gui',installationId:installation}}};
  reply={requestId:'nav',text:'Review local navigation',proposals:[{...proposal({type:'open_view',view:'calendar'}),id,navigation}]};
  const nav=await transport.send({requestId:'nav',text:'Open Calendar',context,signal});
  assert.equal(dispatched,0);assert.equal((await transport.execute({proposal:nav.proposals[0],context,signal})).status,'succeeded');assert.equal(dispatched,1);
  reply.proposals[0].navigation.values.navigationBinding.requestId=crypto.randomUUID();
  await assert.rejects(transport.send({requestId:'nav',text:'Open Calendar',context,signal}),/navigation preparation/);
  transport.close();
  const native=await readFile('android/app/src/testMocks/java/ai/elizaresearch/alphaphone/DevelopmentAgentPlugin.java','utf8');
  assert.match(native,/noteTitle.length\(\) > 256 \|\| noteBody.length\(\) > 32000/,'Native boundary must admit the same canonical note limits');
 }finally{globalThis.__developmentPreview=previous;await rm(dir,{recursive:true,force:true});}
});
