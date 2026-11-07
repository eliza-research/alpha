// Synthetic storage only. No browser session, OAuth, provider data or native state.
import assert from 'node:assert/strict';
import { readGoogleCalendarSelection as read, saveGoogleCalendarSelection as save, clearGoogleCalendarSelectionForConnection as disconnect, readGoogleCalendarPrefs as readPrefs, setGoogleCalendarVisible as setVisible, setGoogleCalendarColor as setColor, clearGoogleCalendarPrefsForConnection as clearPrefs, googleCalendarVisible as visible, GOOGLE_CALENDAR_PREFS_CHANGED as PREFS_CHANGED, type GoogleCalendarAccountKey, type GoogleCalendarSelection, type GoogleCalendarSelectionStorage } from '../apps/app/src/runtime/google-calendar-selection.ts';
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
const team=`google:${connectionId}:team%40example.test`,otherSource=`google:${otherConnection}:other%40example.test`;
check('v2 visibility defaults to Google\'s shown flag or primary; the owner\'s choice wins either way',()=>{
 const {storage}=store();let prefs=readPrefs(owner,storage);assert.deepEqual(prefs,{});
 assert.equal(visible(prefs,{id:source.sourceId,selected:false,primary:true}),true);
 assert.equal(visible(prefs,{id:team,selected:true,primary:false}),true);
 assert.equal(visible(prefs,{id:team,selected:false,primary:false}),false);
 assert.equal(setVisible(owner,source.sourceId,false,storage),true);assert.equal(setVisible(owner,team,true,storage),true);prefs=readPrefs(owner,storage);
 assert.equal(visible(prefs,{id:source.sourceId,selected:true,primary:true}),false);
 assert.equal(visible(prefs,{id:team,selected:false,primary:false}),true);
});
check('v2 colours are palette tokens or #rrggbb; null returns to Google\'s colour; bad input changes nothing',()=>{
 const {storage,rows}=store();assert.equal(setColor(owner,team,'#9FE1E7',storage),true);assert.equal(setColor(owner,source.sourceId,'teal',storage),true);
 assert.deepEqual(readPrefs(owner,storage),{[team]:{color:'#9fe1e7'},[source.sourceId]:{color:'teal'}});
 const before=[...rows.entries()];
 for(const bad of ['red;}','#12345','javascript:x','',`url(x)`])assert.equal(setColor(owner,team,bad,storage),false);
 for(const id of ['local',`google:not-a-uuid:x`,`google:${connectionId}:a b`,`google:${connectionId}:`])assert.equal(setColor(owner,id,'teal',storage),false);
 assert.deepEqual([...rows.entries()],before);
 assert.equal(setColor(owner,team,null,storage),true);assert.deepEqual(readPrefs(owner,storage),{[source.sourceId]:{color:'teal'}});
 assert.equal(setColor(owner,source.sourceId,null,storage),true);assert.equal(rows.size,0,'an empty preference set leaves no slot');
});
check('v2 preferences are account-bound and ignore the old single choice',()=>{
 const {storage,rows}=store();save(owner,source,storage);assert.deepEqual(readPrefs(owner,storage),{},'a past single choice is not a visibility rule');
 setVisible(owner,team,false,storage);const other={...owner,environment:'staging' as const};assert.deepEqual(readPrefs(other,storage),{});
 const key=[...rows.keys()].find(k=>k.startsWith('alpha.google-calendar-prefs.v2:'))!;
 for(const bad of ['{','[]',JSON.stringify({version:1,owner:'x',calendars:{}}),JSON.stringify({...JSON.parse(rows.get(key)!),owner:'elsewhere'})]){const keep=rows.get(key)!;rows.set(key,bad);assert.deepEqual(readPrefs(owner,storage),{});rows.set(key,keep);}
 rows.set(key,JSON.stringify({...JSON.parse(rows.get(key)!),calendars:{[team]:{hidden:'no',color:'bad;'},local:{hidden:true}}}));assert.deepEqual(readPrefs(owner,storage),{});
});
check('disconnect drops only that connection\'s preferences and its old single choice; the alias does the same',()=>{
 const {storage}=store();save(owner,source,storage);setVisible(owner,team,false,storage);setColor(owner,otherSource,'teal',storage);
 assert.equal(clearPrefs(owner,connectionId,storage),true);assert.deepEqual(readPrefs(owner,storage),{[otherSource]:{color:'teal'}});assert.equal(read(owner,storage),null);
 assert.equal(clearPrefs(owner,connectionId,storage),false,'nothing left to clear');
 assert.equal(disconnect(owner,otherConnection,storage),true);assert.deepEqual(readPrefs(owner,storage),{});
 assert.equal(clearPrefs(owner,'not-a-uuid',storage),false);
});
check('v2 storage failures report no success',()=>{
 const broken:GoogleCalendarSelectionStorage={getItem(){throw Error('unavailable');},setItem(){throw Error('quota');},removeItem(){throw Error('unavailable');}};
 assert.deepEqual(readPrefs(owner,broken),{});assert.equal(setVisible(owner,team,false,broken),false);assert.equal(setColor(owner,team,'teal',broken),false);assert.deepEqual(readPrefs(owner),{});
});
check('the old change event name is kept for listeners',()=>{assert.equal(PREFS_CHANGED,'alpha:google-calendar-selection-changed');});
console.log(`${passed} synthetic Google Calendar selection checks passed.`);
