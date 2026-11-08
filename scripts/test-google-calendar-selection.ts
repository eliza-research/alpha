// Synthetic storage only. No browser session, OAuth, provider data or native state.
import assert from 'node:assert/strict';
import { readGoogleCalendarSelection as read, saveGoogleCalendarSelection as save, clearGoogleCalendarSelectionForConnection as disconnect, type GoogleCalendarAccountKey, type GoogleCalendarSelection, type GoogleCalendarSelectionStorage } from '../apps/app/src/runtime/google-calendar-selection.ts';
const owner: GoogleCalendarAccountKey = {environment:'production',userId:'11111111-1111-4111-8111-111111111111',organizationId:'22222222-2222-4222-8222-222222222222'};
const connectionId='33333333-3333-4333-8333-333333333333', otherConnection='44444444-4444-4444-8444-444444444444';
const source: GoogleCalendarSelection = {connectionId,providerCalendarId:'owner@example.test',sourceId:`google:${connectionId}:owner%40example.test`,name:'My Calendar',account:'owner@example.test'};
function store(){const rows=new Map<string,string>();const storage:GoogleCalendarSelectionStorage={getItem:key=>rows.get(key)??null,setItem:(key,value)=>{rows.set(key,value);},removeItem:key=>{rows.delete(key);}};return {rows,storage};}
let passed=0;
function check(name:string,run:()=>void){run();console.log(`ok ${++passed} - ${name}`);}
check('round trip copies only six nonsecret selection fields',()=>{
 const {storage,rows}=store();assert.equal(save(owner,{...source,token:'SECRET',credentialId:'SECRET',events:['SECRET']} as GoogleCalendarSelection,storage),true);assert.deepEqual(read(owner,storage),source);assert.ok(![...rows.values()][0].includes('SECRET'));
});
check('namespace isolates user, organization, environment and explicit embedded owner',()=>{
 const {storage,rows}=store();save(owner,source,storage);
 for(const next of [{...owner,userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},{...owner,organizationId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},{...owner,environment:'staging' as const}]){
  assert.equal(read(next,storage),null);save(next,source,storage);assert.deepEqual(read(owner,storage),source);
 }
 const keys=[...rows.keys()];rows.set(keys[0],rows.get(keys[1])!);assert.equal(read(owner,storage),null);
});
check('invalid account identity cannot access or mutate a preference',()=>{
 const {storage,rows}=store();for(const key of [{...owner,userId:''},{...owner,organizationId:'../another'},{...owner,environment:'dev' as 'production'}]){assert.equal(read(key,storage),null);assert.equal(save(key,source,storage),false);}assert.equal(rows.size,0);
});
check('malformed or mismatched source IDs do not replace a valid preference',()=>{
 const {storage}=store();save(owner,source,storage);
 for(const next of [{...source,sourceId:'local'},{...source,connectionId:otherConnection},{...source,providerCalendarId:'other@example.test'},{...source,providerCalendarId:'bad\ncalendar'},{...source,providerCalendarId:'\ud800'},{...source,providerCalendarId:'   '},{...source,name:''},{...source,account:'x'.repeat(321)},{...source,name:'x'.repeat(513)}]){assert.equal(save(owner,next,storage),false);assert.deepEqual(read(owner,storage),source);}
});
check('malformed, oversized, wrong-version and altered-owner JSON never restores',()=>{
 const {storage,rows}=store();save(owner,source,storage);const key=[...rows.keys()][0],original=rows.get(key)!;
 for(const bad of ['{','null','[]','x'.repeat(16385),JSON.stringify({...JSON.parse(original),version:2}),JSON.stringify({...JSON.parse(original),owner:'elsewhere'}),JSON.stringify({...JSON.parse(original),selection:{...source,sourceId:'local'}})]){rows.set(key,bad);assert.equal(read(owner,storage),null);}
});
check('only confirmed selected connection disconnect clears; other connection retained',()=>{
 const {storage}=store();save(owner,source,storage);assert.equal(disconnect(owner,otherConnection,storage),false);assert.deepEqual(read(owner,storage),source);
 assert.equal(disconnect(owner,connectionId,storage),true);assert.equal(read(owner,storage),null);
});
check('temporary storage read/write failure preserves stored bytes and reports no success',()=>{
 const {storage,rows}=store();save(owner,source,storage);const before=[...rows.entries()];const broken:GoogleCalendarSelectionStorage={getItem(){throw Error('unavailable');},setItem(){throw Error('quota');},removeItem(){throw Error('unavailable');}};
 assert.equal(read(owner,broken),null);assert.equal(save(owner,source,broken),false);assert.equal(save(owner,null,broken),false);assert.equal(disconnect(owner,connectionId,broken),false);assert.deepEqual([...rows.entries()],before);
});
check('SSR without localStorage returns null/false rather than throwing',()=>{assert.equal(read(owner),null);assert.equal(save(owner,source),false);});
check('explicit clear removes only the account slot',()=>{const {storage}=store(),other={...owner,environment:'staging' as const};save(owner,source,storage);save(other,source,storage);assert.equal(save(owner,null,storage),true);assert.equal(read(owner,storage),null);assert.deepEqual(read(other,storage),source);});
console.log(`${passed} synthetic Google Calendar selection checks passed.`);
