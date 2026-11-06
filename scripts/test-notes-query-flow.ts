import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DocumentNotesStore,NotesDocumentConflict} from '../.eliza/client-features/plugins/plugin-notes/src/client/notes-document-store.ts';
import {executeNotesQuery} from '../apps/app/src/prototype/notes-query-executor.ts';
import {DeviceActions} from '../apps/app/src/runtime/device-actions.ts';
const directory=mkdtempSync(join(tmpdir(),'alpha-notes-query-')),signal=()=>new AbortController().signal;
try{
 const make=async(name:string,records:any[])=>{
  const file=join(directory,name+'.json');const snapshot=()=>{if(!existsSync(file))return null;const raw=readFileSync(file,'utf8');return {raw,revision:createHash('sha256').update(raw).digest('hex')};};
  const port={initialize:async(create:any)=>{if(!existsSync(file))writeFileSync(file,create(null,null));return snapshot()!;},read:async()=>snapshot(),compareExchange:async(expected:any,raw:string)=>{if(snapshot()?.revision!==expected.revision)throw new NotesDocumentConflict('Changed');writeFileSync(file,raw);return snapshot()!;}};
  return {file,port,store:await DocumentNotesStore.open(port,records)};
 };
 const records=[{id:'older',kind:'text',title:'Other',body:'UNSELECTED_PRIVATE_BODY',createdAt:100,modifiedAt:300,pinned:true},{id:'newer',kind:'text',title:'Requested title',body:'Approved exact text',createdAt:200,modifiedAt:200}];
 const first=await make('healthy',records),before=readFileSync(first.file,'utf8');let choices=0;
 const operation={type:'notes_query' as const,query:{kind:'latest' as const,by:'created' as const}};
 const selected=await executeNotesQuery(first.store,operation,'read',signal(),()=>{},async(candidates,explanation,_signal,current)=>{choices++;assert.equal(candidates.length,1);assert.equal(candidates[0].id,'newer');assert.match(explanation,/latest created/);current();return 'newer';});
 assert.equal(selected.status,'succeeded');assert.equal(selected.notesResult?.basis,'latest-created');assert.ok(!JSON.stringify(selected).includes('UNSELECTED_PRIVATE_BODY'));assert.equal(readFileSync(first.file,'utf8'),before);
 await assert.rejects(executeNotesQuery(first.store,operation,'bad-choice',signal(),()=>{},async()=> 'older'),/did not match/);
 const empty=await make('empty',[]);const noMatch=await executeNotesQuery(empty.store,operation,'empty',signal(),()=>{},async()=>{throw Error('Empty must not open a chooser');});assert.equal(noMatch.status,'succeeded');assert.deepEqual(noMatch.notesResult,{version:1,kind:'notes_query',query:operation.query,basis:'no-match'});
 const titleMissing=await executeNotesQuery(first.store,{type:'notes_query',query:{kind:'title',text:'missing'}},'missing',signal(),()=>{},async()=>{throw Error('Missing must not open chooser');});assert.equal(titleMissing.notesResult?.basis,'no-match');
 const unknown=await make('unknown',[records[0],{id:'legacy',kind:'text',title:'Legacy',body:'Legacy body',custom:{keep:true}}]);const chosen=await executeNotesQuery(unknown.store,operation,'uncertain',signal(),()=>{},async(candidates,explanation)=>{assert.equal(candidates.length,2);assert.match(explanation,/cannot be verified/);return 'legacy';});assert.equal(chosen.notesResult?.basis,'owner-choice-uncertain');
 const race=await make('race',records);await assert.rejects(executeNotesQuery(race.store,operation,'race',signal(),()=>{},async()=>{const external=await DocumentNotesStore.open(race.port);await external.replace([...external.list,{id:'newest',kind:'text',title:'New insertion',body:'Not approved',createdAt:400}]);return 'newer';}),/changed/i);
 let owner='owner';const guard=()=>{if(owner!=='owner')throw Error('Owner changed');};await assert.rejects(executeNotesQuery(first.store,operation,'owner',signal(),guard,async()=>{owner='other';return 'newer';}),/Owner changed/);owner='owner';
 const cancelled=await executeNotesQuery(first.store,operation,'cancelled',signal(),guard,async()=>null);assert.equal(cancelled.status,'failed');assert.ok(!('notesResult' in cancelled));
 const session={ownerId:'owner',agentId:'agent',origin:'https://fixture.invalid',sessionId:'session'},credential={installationId:'device',enrollmentId:'enrollment',key:'a'.repeat(64),capabilities:['notes.local-record.v1','notes.query.v1']};let state='pending',attemptId='',reads=0,receiptDown=true;
 const journalFile=join(directory,'journal.json'),load=()=>existsSync(journalFile)?JSON.parse(readFileSync(journalFile,'utf8')):null;
 const journal={reserve:async(input:any)=>{const existing=load();if(existing)return {created:false,entry:existing};const entry={...input,phase:'reserved'};writeFileSync(journalFile,JSON.stringify(entry));return {created:true,entry};},markApplying:async(input:any)=>{writeFileSync(journalFile,JSON.stringify({...load(),...input,phase:'applying'}));},finish:async(input:any)=>{writeFileSync(journalFile,JSON.stringify({...load(),...input,phase:'terminal'}));},get:async()=>({entry:load()}),list:async()=>({entries:load()?[load()]:[]})};
 const proposal=()=>({id:'proposal',digest:'c'.repeat(64),state,subjectUserId:'owner',requestedBy:'agent',action:'device_action',expiresAt:new Date(Date.now()+60000).toISOString(),payload:{action:'device_action',version:1,installationId:'device',enrollmentId:'enrollment',operation},execution:attemptId?{attemptId}:null});
 const request=async(path:string,body:any)=>{if(path.endsWith('/proposals'))return {proposals:[proposal()]};if(path.endsWith('/decision'))state='approved';if(path.endsWith('/claim')){state='executing';attemptId='attempt';}if(path.endsWith('/receipt')){if(receiptDown)throw Error('Transport lost');assert.equal(body.receipt.result.record.fields.body,'Approved exact text');state='done';}return {proposal:proposal(),digest:'c'.repeat(64)};};
 const executor=async(op:any,id:string,_context:any,effectSignal:AbortSignal)=>{assert.equal(load().phase,'applying');reads++;return executeNotesQuery(first.store,op,id,effectSignal,guard,async()=> 'newer');};
 const makeClient=(identity=session,device=credential)=>new DeviceActions(identity,device,'e'.repeat(64),request,journal,executor);
 const context={view:'home' as const,revision:1,sensitive:false};await assert.rejects(makeClient({...session,ownerId:'other'}).pending(context,signal()),/another identity/);await assert.rejects(makeClient(session,{...credential,capabilities:['notes.local-record.v1']}).pending(context,signal()),/not negotiated/);
 const client=makeClient();assert.equal((await client.pending(context,signal())).length,1);assert.equal((await client.approve('proposal',context,signal())).status,'succeeded');assert.equal(reads,1);assert.equal(state,'executing');receiptDown=false;await makeClient().syncReceipts(signal());assert.equal(state,'done');assert.equal(reads,1);assert.equal(choices,1);
 console.log('PASS Notes query: real file CAS store, selected exact text, empty success, uncertain dates, owner/raw/choice races, negotiated Home action, journal-before-read and receipt-only recovery. Synthetic only.');
}finally{rmSync(directory,{recursive:true,force:true});}
