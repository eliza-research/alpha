import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from './support/strip-types.mjs';
const source=readFileSync('apps/app/src/prototype/canonical-notes-ui.ts','utf8');
const start=source.indexOf(' private async scheduleDraft('),end=source.indexOf(' /** Speech recognition',start);assert.ok(start>=0&&end>start);
const method=stripTypeScriptTypes('class Subject{'+source.slice(start,end)+'}',{mode:'transform'});
const origin={version:2,noteId:'owned-note',revision:'exact-note-revision'};
const make=()=>new Function('noteScheduleDraft',method+';return Subject;')(async()=>({status:'ready',draft:{title:'Discuss launch',notes:'From note',origin}}));
test('Notes event handoff requires Calendar admission and preserves the exact origin without writing',async()=>{
 for(const accepted of [true,false]){
  const Subject=make(),ui=new Subject(),opened=[],reviewed=[],toasts=[];ui.editor={draft:{}};ui.controller={current:true,viewNote:()=>({id:'owned-note'})};ui.open='owned-note';
  const api={isActive:()=>true,get:()=>({calendarAuthority:'canonical'}),open:(...x)=>opened.push(x),toast:t=>toasts.push(t),reviewCalendarDraft:d=>{reviewed.push(d);return accepted;}};
  await ui.scheduleDraft('owned-note','event',api);
  assert.equal(reviewed.length,1);assert.deepEqual(reviewed[0].origin,origin);assert.equal(opened.length,0,'no direct form bypass');assert.equal(toasts.length,1);assert.match(toasts[0],accepted?/Review the time/:/Calendar can't open/);
 }
});
test('Notes reminder handoff keeps its separate review and a changed owner starts neither handoff',async()=>{
 const Subject=make(),ui=new Subject(),opened=[],reviewed=[];ui.editor={draft:{}};ui.controller={current:true,viewNote:()=>({id:'owned-note'})};ui.open='owned-note';const api={isActive:()=>true,get:()=>({calendarAuthority:'canonical'}),open:(...x)=>opened.push(x),toast(){},reviewCalendarDraft:d=>{reviewed.push(d);return true;}};
 await ui.scheduleDraft('owned-note','reminder',api);assert.equal(reviewed.length,0);assert.equal(opened[0][1].form.cal,'alpha-reminders');assert.deepEqual(opened[0][1].form.origin,origin);
 opened.length=0;ui.controller.current=false;await ui.scheduleDraft('owned-note','event',api);assert.equal(reviewed.length,0);assert.equal(opened.length,0);
});
