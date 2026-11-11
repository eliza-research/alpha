import {test,expect,type Page} from '@playwright/test';
import {canonicalNotesFixture,openCanonicalNotes} from './helpers/canonical-notes';
import {settled} from './helpers/settled';
const snapshot=(page:Page)=>page.evaluate(()=>(window as any).canonicalNotesFixture.state);
const writes=(page:Page)=>page.evaluate(()=>(window as any).canonicalNotesFixture.requests.filter((request:any)=>request.method==='POST'));
const refresh=(page:Page)=>page.evaluate(()=>window.dispatchEvent(new CustomEvent('alpha:canonical-notes-invalidated',{detail:{sessionId:'canonical-fixture-session'}})));

test('Try again rereads and updates the exact saved note at its current revision',async({page})=>{
 const {foreign,errors}=await canonicalNotesFixture(page,{notes:[{id:'exact-saved-note',title:'Saved note',body:'\nOriginal body.',color:'yellow',createdAt:'2026-11-10T12:00:00Z',updatedAt:'2026-11-10T12:00:00Z'}]});
 await openCanonicalNotes(page);await page.getByRole('button',{name:'Open Saved note',exact:true}).click();
 await page.evaluate(()=>(window as any).canonicalNotesFixture.fail=true);
 const editor=page.getByRole('textbox',{name:'Note',exact:true});await editor.fill('Exact retained edit.\nSecond line.');
 const retry=page.getByRole('button',{name:'Try again',exact:true});await expect(retry).toBeVisible();await expect(page.getByRole('button',{name:'Copy draft',exact:true})).toBeVisible();
 const failed=await writes(page);expect(failed).toHaveLength(1);expect(failed[0].body.capability).toBe('update-note');
 await page.evaluate(()=>{const f=(window as any).canonicalNotesFixture;f.fail=false;f.state.revision++;});
 await retry.click();await expect(retry).toHaveCount(0);await expect(page.getByRole('button',{name:'Copy draft',exact:true})).toHaveCount(0);
 await expect(editor).toHaveValue('Exact retained edit.\nSecond line.');
 const requests=await writes(page);expect(requests).toHaveLength(2);expect(requests.map((r:any)=>r.body.capability)).toEqual(['update-note','update-note']);
 expect(requests[1].body.params).toMatchObject({id:'exact-saved-note',expectedRevision:2,content:'Saved note\nExact retained edit.\nSecond line.'});
 const state=await snapshot(page);expect(state.notes).toHaveLength(1);expect(state.notes[0]).toMatchObject({id:'exact-saved-note',title:'Saved note',body:'\nExact retained edit.\nSecond line.'});
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});

for(const matchingRows of [1,2])test(`an unknown new creation keeps Copy draft without retry, duplicate writes or adopting ${matchingRows} matching saved rows`,async({page})=>{
 const {foreign,errors}=await canonicalNotesFixture(page);await openCanonicalNotes(page);
 await page.evaluate(()=>(window as any).canonicalNotesFixture.failAfterApplied=true);
 await page.getByRole('button',{name:'New note',exact:true}).click();const editor=page.getByRole('textbox',{name:'Note',exact:true});
 await editor.fill('Unconfirmed new words.\nSecond line.');
 const copy=page.getByRole('button',{name:'Copy draft',exact:true});await expect(copy).toBeVisible();await expect(page.getByRole('button',{name:'Discard',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Try again',exact:true})).toHaveCount(0);expect(await writes(page)).toHaveLength(1);
 const before=await page.evaluate(matchingRows=>{
  const f=(window as any).canonicalNotesFixture;f.failAfterApplied=false;
  if(matchingRows===2)f.state.notes.push({...f.state.notes[0],id:'other-matching-note'});
  f.state.revision++;return {acceptedReads:f.acceptedReads.length,notes:structuredClone(f.state.notes)};
 },matchingRows);
 await refresh(page);await expect.poll(()=>page.evaluate(()=>(window as any).canonicalNotesFixture.acceptedReads.length)).toBeGreaterThan(before.acceptedReads);
 await expect(copy).toBeVisible();await expect(page.getByRole('button',{name:'Try again',exact:true})).toHaveCount(0);
 await expect(editor).toHaveValue('Unconfirmed new words.\nSecond line.');
 // Editing after the matching rows were read must keep the unknown draft; adopting either
 // server identity would turn this into an update, and losing it would create a second note.
 await editor.fill('Still my unconfirmed draft.\nAdditional retained words.');await editor.press('Tab');await settled(page);
 await expect(copy).toBeVisible();await expect(page.getByRole('button',{name:'Discard',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Try again',exact:true})).toHaveCount(0);
 await expect(editor).toHaveValue('Still my unconfirmed draft.\nAdditional retained words.');
 expect((await writes(page)).map((r:any)=>r.body.capability)).toEqual(['create-note']);expect((await snapshot(page)).notes).toEqual(before.notes);
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});
