import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DocumentNotesStore,NotesDocumentConflict} from '../.eliza/client-features/plugins/plugin-notes/src/client/notes-document-store.ts';
import {executeNamedNotes,executeNotesQuery,executeNotesSearch} from '../apps/app/src/prototype/notes-query-executor.ts';
import {shareable} from '../apps/app/src/prototype/notes-query-review.ts';
import {addNotesTrashEntry,emptyNotesTrash,restoreNotesTrashEntry,validateNotesTrash} from '../apps/app/src/runtime/notes-trash-policy.ts';
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
 // A text note turned into a checklist keeps an empty body and its items elsewhere: it is never shared as an empty note.
 const converted=await make('converted',[{id:'list',kind:'list',title:'Packing',body:'',items:[{t:'Passport',done:false}],createdAt:500,modifiedAt:500}]);
 const convertedBefore=readFileSync(converted.file,'utf8');
 assert.equal(shareable({id:'list',kind:'list',title:'Packing',body:''}),false);assert.equal(shareable({id:'blank',kind:'text',title:'Blank',body:'  '}),false);assert.equal(shareable(records[1]),true);
 await assert.rejects(executeNotesQuery(converted.store,operation,'converted',signal(),()=>{},async()=> 'list'),/no text to share/);
 await assert.rejects(executeNotesSearch(converted.store,{type:'notes_search',query:{kind:'content',text:'packing'}} as any,'converted-search',signal(),()=>{},async()=> 'list'),/no text to share/);
 assert.equal(readFileSync(converted.file,'utf8'),convertedBefore);
 const session={ownerId:'owner',agentId:'agent',origin:'https://fixture.invalid',sessionId:'session'},credential={installationId:'device',enrollmentId:'enrollment',key:'a'.repeat(64),capabilities:['notes.local-record.v1','notes.query.v1']};let state='pending',attemptId='',reads=0,receiptDown=true;
 const journalFile=join(directory,'journal.json'),load=()=>existsSync(journalFile)?JSON.parse(readFileSync(journalFile,'utf8')):null;
 const journal={reserve:async(input:any)=>{const existing=load();if(existing)return {created:false,entry:existing};const entry={...input,phase:'reserved'};writeFileSync(journalFile,JSON.stringify(entry));return {created:true,entry};},markApplying:async(input:any)=>{writeFileSync(journalFile,JSON.stringify({...load(),...input,phase:'applying'}));},finish:async(input:any)=>{writeFileSync(journalFile,JSON.stringify({...load(),...input,phase:'terminal'}));},get:async()=>({entry:load()}),list:async()=>({entries:load()?[load()]:[]})};
 const proposal=()=>({id:'proposal',digest:'c'.repeat(64),state,subjectUserId:'owner',requestedBy:'agent',action:'device_action',expiresAt:new Date(Date.now()+60000).toISOString(),payload:{action:'device_action',version:1,installationId:'device',enrollmentId:'enrollment',operation},execution:attemptId?{attemptId}:null});
 const request=async(path:string,body:any)=>{if(path.endsWith('/proposals'))return {proposals:[proposal()]};if(path.endsWith('/decision'))state='approved';if(path.endsWith('/claim')){state='executing';attemptId='attempt';}if(path.endsWith('/receipt')){if(receiptDown)throw Error('Transport lost');assert.equal(body.receipt.result.record.fields.body,'Approved exact text');state='done';}return {proposal:proposal(),digest:'c'.repeat(64)};};
 const executor=async(op:any,id:string,_context:any,effectSignal:AbortSignal)=>{assert.equal(load().phase,'applying');reads++;return executeNotesQuery(first.store,op,id,effectSignal,guard,async()=> 'newer');};
 const makeClient=(identity=session,device=credential)=>new DeviceActions(identity,device,'e'.repeat(64),request,journal,executor);
 const context={view:'home' as const,revision:1,sensitive:false};await assert.rejects(makeClient({...session,ownerId:'other'}).pending(context,signal()),/another identity/);await assert.rejects(makeClient(session,{...credential,capabilities:['notes.local-record.v1']}).pending(context,signal()),/not negotiated/);
 const client=makeClient();assert.equal((await client.pending(context,signal())).length,1);assert.equal((await client.approve('proposal',context,signal())).status,'succeeded');assert.equal(reads,1);assert.equal(state,'executing');receiptDown=false;await makeClient().syncReceipts(signal());assert.equal(state,'done');assert.equal(reads,1);assert.equal(choices,1);
 // "Find my note about passport", then "delete it": content search shares only the chosen
 // note; the named delete is disambiguated locally and ends in Trash after approval.
 {
  const notes=[{id:'travel',kind:'text',title:'Travel plans',body:'Renew my passport before May',createdAt:100,modifiedAt:500},
   {id:'groceries',kind:'text',title:'Groceries',body:'PRIVATE_GROCERY_BODY',createdAt:200,modifiedAt:400},
   {id:'travel-old',kind:'text',title:'Travel 2025',body:'Old passport photo booth',createdAt:50,modifiedAt:50}];
  const fixture=await make('find-delete',notes);let trash=emptyNotesTrash();
  const flowSession={ownerId:'owner',agentId:'agent',origin:'https://fixture.invalid',sessionId:'session'};
  const flowCredential={installationId:'device',enrollmentId:'enrollment',key:'a'.repeat(64),capabilities:['notes.local-record.v1','notes.search.v1','device.named-target.v1']};
  const search={type:'notes_search',query:{kind:'content',text:'PASSPORT'}},remove={type:'notes_named',action:'delete',name:'travel'};
  const queue:any[]=[],states=new Map<string,string>(),uploads:any[]=[],entries=new Map<string,any>();
  const proposalFor=(id:string,operation:unknown)=>({id,digest:'d'.repeat(64),state:states.get(id)??'pending',subjectUserId:'owner',requestedBy:'agent',action:'device_action',expiresAt:new Date(Date.now()+60000).toISOString(),payload:{action:'device_action',version:1,installationId:'device',enrollmentId:'enrollment',operation},execution:states.get(id)==='executing'?{attemptId:'attempt-'+id}:null});
  const flowRequest=async(path:string,body:any)=>{if(path.endsWith('/proposals'))return {proposals:queue.map(item=>proposalFor(item.id,item.operation))};const id=path.split('/')[4],item=queue.find(entry=>entry.id===id);
   if(path.endsWith('/decision'))states.set(id,'approved');if(path.endsWith('/claim'))states.set(id,'executing');if(path.endsWith('/receipt')){uploads.push({id,receipt:body.receipt});states.set(id,'done');}
   return {proposal:proposalFor(id,item.operation),digest:'d'.repeat(64)};};
  const flowJournal={reserve:async(input:any)=>{if(entries.has(input.proposalId))return {created:false,entry:entries.get(input.proposalId)};const entry={...input,phase:'reserved'};entries.set(input.proposalId,entry);return {created:true,entry};},markApplying:async(input:any)=>{Object.assign(entries.get(input.proposalId),{phase:'applying',attemptId:input.attemptId});},finish:async(input:any)=>{Object.assign(entries.get(input.proposalId),input,{phase:'terminal'});},get:async(input:any)=>({entry:entries.get(input.proposalId)??null}),list:async()=>({entries:[...entries.values()]})};
  let chooserCandidates:string[]=[],namedCandidates:string[]=[];
  // The host's approved-deletion effect: write the restorable Trash copy ahead of the tombstone.
  const applyWithTrash=async(exact:any,operationId:string,effectSignal:AbortSignal,current:()=>void)=>{
   current();const list=fixture.store.list,index=list.findIndex((note:any)=>note.id===exact.target.noteId);if(index<0)throw Error('Selected note is missing');
   if(JSON.stringify(await fixture.store.target(exact.target.noteId))!==JSON.stringify(exact.target))throw Error('Selected note revision changed');
   trash=validateNotesTrash(addNotesTrashEntry(trash,{id:operationId,note:list[index],target:exact.target,index,deletedAt:Date.now()}));
   return fixture.store.execute(exact,operationId,effectSignal,current);
  };
  const foreground=async(operation:any,operationId:string,_context:any,effectSignal:AbortSignal)=>operation.type==='notes_search'
   ?executeNotesSearch(fixture.store,operation,operationId,effectSignal,()=>{},async candidates=>{chooserCandidates=candidates.map(note=>note.id);return 'travel';})
   :executeNamedNotes(fixture.store,operation,operationId,effectSignal,()=>{},applyWithTrash,async(candidates,named)=>{namedCandidates=candidates.map(note=>note.id);assert.equal(named.name,'travel');return 'travel';});
  const actions=new DeviceActions(flowSession,flowCredential,'f'.repeat(64),flowRequest,flowJournal,async()=>{throw Error('Exact executor must not run named reviews');},undefined,false,false,foreground);
  const home={view:'home' as const,revision:9,sensitive:false,timeZone:'UTC'};
  queue.push({id:'find',operation:search});
  const [findCard]=await actions.pending(home,signal());assert.equal(findCard.title,'Search notes');
  assert.equal((await actions.approve('find',home,signal())).status,'succeeded');
  assert.deepEqual(chooserCandidates.sort(),['travel','travel-old'],'content matches include body text, case-insensitively');
  const shared=uploads.find(item=>item.id==='find').receipt.result;
  assert.equal(shared.basis,'content-match');assert.equal(shared.record.fields.body,'Renew my passport before May');
  assert.ok(!JSON.stringify(uploads).includes('PRIVATE_GROCERY_BODY')&&!JSON.stringify(uploads).includes('Old passport photo booth'),'unchosen notes never leave the phone');
  queue.push({id:'delete',operation:remove});
  const pendingDelete=await actions.pendingReview(home,signal());
  assert.deepEqual(pendingDelete.map(item=>item.proposal?.title),['Delete note by name']);
  // From Notes the named delete is a visible notice, not a silent drop or an approvable card.
  assert.match((await actions.pendingReview({...home,view:'notes'},signal()))[0].notice??'',/Return to Home to choose the record/);
  await actions.pending(home,signal());
  assert.equal((await actions.approve('delete',home,signal())).status,'succeeded');
  assert.deepEqual(namedCandidates.sort(),['travel','travel-old'],'every local name match is offered for disambiguation');
  assert.ok(!fixture.store.list.some((note:any)=>note.id==='travel'),'deleted from Notes');
  assert.equal(trash.entries.length,1);assert.equal(trash.entries[0].note.id,'travel');assert.equal(trash.entries[0].note.body,'Renew my passport before May');
  const removed=uploads.find(item=>item.id==='delete').receipt.result;
  assert.equal(removed.basis,'owner-chosen');assert.equal(removed.operation.type,'notes_delete');assert.equal(removed.operation.target.noteId,'travel');
  assert.ok(!JSON.stringify(removed).includes('Renew my passport'),'a deletion receipt carries no note text');
  assert.equal(entries.get('delete').result.foregroundResult.record.kind,'notes_delete');
  assert.deepEqual(restoreNotesTrashEntry(fixture.store.list,trash.entries[0]).map((note:any)=>note.id).sort(),['groceries','travel','travel-old'],'the trashed note can be restored');
  // A cancelled disambiguation changes nothing; a titles listing shares only reviewed titles.
  const cancel=await executeNamedNotes(fixture.store,{type:'notes_named',action:'delete',name:'Groceries'},'cancel',signal(),()=>{},async()=>{throw Error('Cancelled reviews must not apply');},async()=>null);
  assert.equal(cancel.status,'failed');assert.ok(fixture.store.list.some((note:any)=>note.id==='groceries'));
  let reviewed:string[]=[];
  const titles=await executeNotesSearch(fixture.store,{type:'notes_search',query:{kind:'titles',limit:1}},'titles',signal(),()=>{},async()=>{throw Error('No chooser');},async(list,truncated)=>{reviewed=list;assert.equal(truncated,true);return true;});
  assert.deepEqual(reviewed,['Groceries']);assert.deepEqual((titles.foregroundResult as any).titles,['Groceries']);assert.ok(!JSON.stringify(titles).includes('PRIVATE_GROCERY_BODY'));
  const declined=await executeNotesSearch(fixture.store,{type:'notes_search',query:{kind:'titles',limit:5}},'declined',signal(),()=>{},async()=>null,async()=>false);
  assert.equal(declined.status,'failed');assert.ok(!('foregroundResult' in declined));
  const nothing=await executeNamedNotes(fixture.store,{type:'notes_named',action:'delete',name:'missing'},'missing',signal(),()=>{},async()=>{throw Error('No match must not apply');},async()=>{throw Error('No match must not open a review');});
  assert.equal((nothing.foregroundResult as any).basis,'no-match');
  // A very long saved title is bounded before review, so the reviewed listing is exactly what is shared.
  const long=await make('long-title',[{id:'long',kind:'text',title:'L'.repeat(600),body:'x',createdAt:1,modifiedAt:1}]);let shown:string[]=[];
  const bounded=await executeNotesSearch(long.store,{type:'notes_search',query:{kind:'titles',limit:5}},'long',signal(),()=>{},async()=>null,async list=>{shown=list;return true;});
  assert.equal(bounded.status,'succeeded');assert.equal(shown[0].length,500);assert.deepEqual((bounded.foregroundResult as any).titles,shown);
 }
 console.log('PASS Notes query: real file CAS store, selected exact text, empty success, uncertain dates, owner/raw/choice races, negotiated Home action, journal-before-read and receipt-only recovery; content search shares only the chosen note, a Home named delete is disambiguated locally and ends in restorable Trash after approval, titles listings share only reviewed titles. Synthetic only.');
}finally{rmSync(directory,{recursive:true,force:true});}
