import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DeviceActions} from '../apps/app/src/runtime/device-actions';
import {NotesStore,LEGACY_NOTES_KEY} from '../apps/app/src/runtime/notes-store';
import type {NotesOperation} from '../apps/app/src/runtime/notes-contract';
const session={ownerId:'owner',agentId:'agent',origin:'https://fixture.invalid',sessionId:'session'},credential={installationId:'device',enrollmentId:'enrollment',key:'a'.repeat(64)};
const dir=mkdtempSync(join(tmpdir(),'notes-client-e2e-'));
try{for(const type of ['notes_read_selected','notes_update','notes_delete'] as const){
 const file=join(dir,type+'.json'),journalFile=join(dir,type+'-journal.json');
 const load=(f:string)=>existsSync(f)?JSON.parse(readFileSync(f,'utf8')):{};
 const storage={getItem:(key:string)=>load(file)[key]??null,setItem:(key:string,value:string)=>writeFileSync(file,JSON.stringify({...load(file),[key]:value}))};
 storage.setItem(LEGACY_NOTES_KEY,JSON.stringify([{id:'note-1',kind:'text',title:'Fixture',body:'Original'}]));
 let store=new NotesStore(storage);const target=await store.target('note-1');const operation:NotesOperation=type==='notes_update'?{type,target,fields:{title:'Changed',body:'Approved'}}:{type,target};
 let state='pending',attemptId='',effects=0,lostReceipt=true;
 const proposal=()=>({id:'proposal',digest:'c'.repeat(64),state,subjectUserId:'owner',requestedBy:'agent',action:'device_action',expiresAt:new Date(Date.now()+60000).toISOString(),payload:{action:'device_action',version:1,installationId:'device',enrollmentId:'enrollment',operation},execution:attemptId?{attemptId}:null});
 const request=async(path:string,body:any)=>{if(path.endsWith('/decision'))state='approved';if(path.endsWith('/claim')){assert.equal(state,'approved');state='executing';attemptId='attempt';}if(path.endsWith('/receipt')){if(lostReceipt)throw Error('Response loss');assert.equal(body.receipt.result.kind,type);state='done';}return body?{proposal:proposal(),digest:'c'.repeat(64)}:{proposals:[proposal()]};};
 const save=(entry:any)=>writeFileSync(journalFile,JSON.stringify(entry));
 const journal={reserve:async(input:any)=>{const old=load(journalFile);if(old.proposalId)return{created:false,entry:old};const entry={...input,phase:'reserved'};save(entry);return{created:true,entry};},markApplying:async(input:any)=>save({...load(journalFile),...input,phase:'applying'}),finish:async(input:any)=>save({...load(journalFile),...input,phase:'terminal'}),get:async()=>({entry:load(journalFile)}),list:async()=>({entries:[load(journalFile)]})};
 const executor=async(op:any,operationId:string,_context:any,signal:AbortSignal)=>{assert.equal(load(journalFile).phase,'applying');effects++;return{status:'succeeded' as const,summary:'Applied',notesResult:await store.execute(op,operationId,signal,()=>{})};};
 const make=()=>new DeviceActions(session,credential,'e'.repeat(64),request,journal,executor);
 const context={view:'notes' as const,revision:1,sensitive:false,selectedObject:{kind:'note',id:target.noteId,revision:target.revision,accountId:target.sourceId,sourceRevision:target.sourceRevision}};
 const stale=make(),staleContext={...context,selectedObject:{...context.selectedObject,revision:'f'.repeat(64)}};const staleCards=await stale.pending(staleContext,new AbortController().signal);if(type==='notes_read_selected')assert.deepEqual(staleCards,[]);else{assert.equal(staleCards[0].reviewDestination,'notes');assert.equal((await stale.approve('proposal',staleContext,new AbortController().signal)).status,'unknown');}assert.equal(effects,0,'stale targets cannot execute');
 const client=make();const review=await client.pending(context,new AbortController().signal);assert.equal(review[0].title,type==='notes_read_selected'?'Share selected note':type==='notes_update'?'Update note':'Delete selected note');assert.ok(!review[0].description.includes(target.noteId));if(type==='notes_update')assert.equal(review[0].description,'Update note\n“Changed”\nApproved');assert.equal((await client.approve('proposal',context,new AbortController().signal)).status,'succeeded');assert.equal(effects,1);assert.equal(load(journalFile).result.notesResult.kind,type);
 store=new NotesStore(storage);lostReceipt=false;await make().syncReceipts(new AbortController().signal);assert.equal(state,'done');assert.equal(effects,1,'receipt replay must not execute again');
 if(type==='notes_delete')assert.equal(store.list.length,0);else assert.equal(store.list[0].body,type==='notes_update'?'Approved':'Original');
 }}finally{rmSync(dir,{recursive:true,force:true});}
console.log('PASS real NotesStore + DeviceActions: exact selected revisions, approved read/update/delete, disk reconstruction, journal before mutation and receipt-only recovery after lost response. Controlled HTTP boundary.');
