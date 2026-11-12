import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
import * as selection from '../apps/app/src/prototype/context-selection.ts';
import {sanitizePhoneContext} from '../apps/app/src/runtime/phone-context.ts';
import {shadeNoticeQuestionFixture} from './fixtures/shade-notice-question.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const daily=path.join(root,'apps/app/src/browser/daily.ts');
function entry(){const source=readFileSync(daily,'utf8'),start=source.indexOf('export async function reminderNoticeRevision('),end=source.indexOf('\nfunction operationBinding(',start);assert.ok(start>=0&&end>start);return source.slice(start,end)+"\nexport {calendarAlerts} from './apps/app/src/browser/calendar-alerts.ts';";}
const options=()=>({stdin:{contents:entry(),resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',metafile:true});
const discovered=await build(options());
const inputs=[daily,...Object.keys(discovered.metafile.inputs).filter(name=>name!=='<stdin>').map(name=>path.resolve(root,name))];
const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const hashes=new Map(inputs.map(file=>[file,digest(file)]));
const executable=await build(options());assert.equal(executable.outputFiles[0].text,discovered.outputFiles[0].text);
for(const [file,hash] of hashes)assert.equal(digest(file),hash,'Actual producer source stayed stable before executable import: '+file);
const {reminderNoticeRevision,calendarAlerts}=await import('data:text/javascript;base64,'+Buffer.from(executable.outputFiles[0].text).toString('base64'));
const target={sourceRevision:'a'.repeat(64),reminderId:'reminder-one',occurrenceId:'occurrence-one',revision:'b'.repeat(64)};
const own=(id,revision,kind)=>({id,revision,source:'own',...(kind?{kind}:{}),appLabel:'Alpha Phone',title:'Reviewed title',text:'Reviewed body',at:1,canOpen:true});
const browserReminderRevision=await reminderNoticeRevision(target);
const reminder=()=>own(target.reminderId,browserReminderRevision);
const legacyReminderRevision=({sourceRevision,reminderId,occurrenceId,revision})=>JSON.stringify([sourceRevision,reminderId,occurrenceId,revision]);
const legacyReminder=()=>own(target.reminderId,legacyReminderRevision(target));
function calendar(){const now=Date.UTC(2026,10,11,12),start=now-86400000-300000;const rows=calendarAlerts([{id:'series',calendarId:'local',title:'Recurring title',body:'Reviewed body',location:'',begin:start,end:start+3600000,revision:'c'.repeat(64),repeat:'daily',timeZone:'UTC',alert:10}],{},now);const row=rows.find(item=>item.at<=now&&item.at>now-86400000);assert.ok(row);assert.match(row.eventId,/:occ:/);return {...row,source:'own',appLabel:'Calendar',canOpen:true};}
const plain=value=>JSON.parse(JSON.stringify(value));
for(const [name,make] of [['reminder',reminder],['recurring Calendar',calendar]]){
 test(`actual ${name} producer revision can be reviewed and sends only opaque context`,async()=>{
  const row=make();assert.equal(selection.noticeReviewable(row),true);assert.equal(selection.ownNoticeRevisionValid(row),true);
  const f=shadeNoticeQuestionFixture({initialRows:[row]});try{
   f.ask(row.id);assert.equal(f.rawSelection().revision,row.revision);
   const wire=f.selection();assert.deepEqual(Object.keys(wire).sort(),['accountId','id','kind','revision']);assert.equal(wire.id,row.id);
   if(name==='reminder'){
    assert.equal(wire.revision,createHash('sha256').update(legacyReminderRevision(target)).digest('hex'));
   }else{
    assert.match(wire.revision,/^notice-[a-f0-9]{12}-[1-9]\d*$/);
    assert.notEqual(wire.revision,row.revision);
   }
   assert.ok(wire.revision.length<=128);
   assert.deepEqual(plain(sanitizePhoneContext({view:'home',revision:1,sensitive:false,selectedObject:wire}).selectedObject),wire);
   assert.doesNotMatch(JSON.stringify(wire),/Reviewed|sourceRevision|occurrence-one|\[|%/);
   await f.approve();assert.equal(f.requests.length,1);await f.finish(0);assert.deepEqual(f.drafts,['Help me with this notification.\n\nSource: '+row.appLabel+' notification\n\n'+row.title+'\n'+row.text]);assert.equal(f.selection(),undefined);
  }finally{f.close();}
 });
 test(`${name} unchanged refresh keeps raw custody and stable wire; changed raw revision clears selection`,async()=>{
  const row=make(),f=shadeNoticeQuestionFixture({initialRows:[row]});try{
   f.ask(row.id);const first=f.selection();await f.refresh();assert.equal(f.rawSelection().revision,row.revision);assert.deepEqual(f.selection(),first);
   f.rows[0].revision=name==='reminder'?await reminderNoticeRevision({...target,sourceRevision:'d'.repeat(64)}):row.revision.slice(0,-64)+'d'.repeat(64);
   await f.refresh();assert.equal(f.rawSelection(),undefined);assert.equal(f.selection(),undefined);assert.deepEqual(f.drafts,[]);
   f.ask(row.id);assert.notEqual(f.selection().revision,first.revision);
  }finally{f.close();}
 });
 test(`${name} changed source read or excerpt never composes the reviewed row or a neighbor`,async()=>{
  for(const change of ['revision','excerpt','source','kind','askable-kind','duplicate']){
   const row=make(),f=shadeNoticeQuestionFixture({initialRows:[row]});try{
    f.ask(row.id);await f.approve();assert.equal(f.requests.length,1);
    if(change==='revision')f.rows[0].revision='changed';if(change==='excerpt')f.rows[0].text='Changed body';if(change==='source')f.rows[0].source='external';if(change==='kind')f.rows[0].kind='workflow';if(change==='askable-kind')f.rows[0].kind='navigation';if(change==='duplicate')f.rows.push({...f.rows[0]});
    await f.finish(0);assert.deepEqual(f.drafts,[],change);assert.deepEqual(f.toasts,['Gone'],change);
   }finally{f.close();}
  }
 });
}
test('structured revision parsers refuse wrong source, kind, row, shape, encoding and bounds',()=>{
 const row=legacyReminder(),fields=JSON.parse(row.revision),cal=calendar(),split=cal.revision.lastIndexOf(':'),calendarFields=JSON.parse(decodeURIComponent(cal.revision.slice(0,split)));
 const bad=[{...row,source:'external'},{...row,source:'hosted'},{...row,kind:'workflow'},{...row,kind:'navigation'},{...row,id:'neighbor'},
  {...row,revision:JSON.stringify(fields.slice(0,3))},{...row,revision:JSON.stringify([...fields,'extra'])},{...row,revision:JSON.stringify({...fields})},{...row,revision:' '+row.revision},
  ...[0,2,3].map(index=>({...row,revision:JSON.stringify(fields.map((value,i)=>i===index?'PRIVATE/path':value))})),{...row,revision:'x'.repeat(513)},
  {...cal,source:'external'},{...cal,kind:'reminder'},{...cal,id:'calendar:neighbor'},{...cal,revision:cal.revision.slice(0,-64)+'not-a-hash'},
  {...cal,revision:cal.revision.replace('%5B','%5b')},...[-1,1.5,8640000000000001].map(start=>({...cal,revision:encodeURIComponent(JSON.stringify([calendarFields[0],start,10]))+':'+ 'c'.repeat(64)})),
  {...cal,revision:encodeURIComponent(JSON.stringify([calendarFields[0],calendarFields[1],5]))+':'+ 'c'.repeat(64)}];
 for(const candidate of bad){assert.equal(selection.ownNoticeRevisionValid(candidate),false,JSON.stringify(candidate));assert.equal(selection.noticeReviewable(candidate),false,JSON.stringify(candidate));assert.equal(selection.createOwnNoticeRevisions()(candidate),undefined);}
});
test('native opaque identity stays exact; structured wire counters cover all tuple fields and bounded eviction',async()=>{
 const native=own('native-reminder','native-revision','reminder'),revisions=selection.createOwnNoticeRevisions();assert.equal(revisions(native),native.revision);assert.equal(selection.noticeReviewable(native),true);
 const first=legacyReminder(),one=revisions(first);assert.equal(revisions(first),one);assert.notEqual(selection.createOwnNoticeRevisions()(first),one);
 for(const field of ['sourceRevision','occurrenceId','revision']){const changed={...target,[field]:field==='occurrenceId'?'occurrence-two':'d'.repeat(64)},next={...first,revision:legacyReminderRevision(changed)};assert.notEqual(revisions(next),one,field);assert.notEqual(await reminderNoticeRevision(changed),browserReminderRevision,field);}
 const again=revisions(first);assert.notEqual(again,one);
 for(let i=0;i<130;i++){const next={...target,reminderId:'row-'+i};revisions(own(next.reminderId,legacyReminderRevision(next)));}assert.notEqual(revisions(first),again);
 const f=shadeNoticeQuestionFixture({initialRows:[native]});try{f.ask(native.id);assert.deepEqual(f.selection(),{kind:'notification',id:native.id,revision:native.revision,accountId:'own'});}finally{f.close();}
 for(const kind of ['navigation','workflow']){const f=shadeNoticeQuestionFixture({initialRows:[native]});try{f.ask(native.id);await f.approve();f.rows[0].kind=kind;await f.finish(0);assert.deepEqual(f.drafts,[],kind);assert.deepEqual(f.toasts,['Gone'],kind);}finally{f.close();}}
 const refreshed=shadeNoticeQuestionFixture({initialRows:[native]});try{refreshed.ask(native.id);refreshed.rows[0].kind='navigation';await refreshed.refresh();assert.equal(refreshed.selection(),undefined);assert.equal(refreshed.rawSelection(),undefined);}finally{refreshed.close();}
});
