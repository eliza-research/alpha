import {test,expect} from '@playwright/test';
import {canonicalNotesFixture,openCanonicalNotes} from './helpers/canonical-notes';

test('a failed canonical save offers Copy draft and retains the exact edit through clipboard refusal and success',async({page})=>{
 const {foreign,errors}=await canonicalNotesFixture(page,{notes:[{
  id:'held-draft',title:'Held note',body:'\nSaved text.',color:'yellow',
  createdAt:'2026-11-10T12:00:00Z',updatedAt:'2026-11-10T12:00:00Z',
 }]});
 await page.evaluate(()=>{
  const clipboard=(window as any).draftClipboard={refuse:true,calls:[]};
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{
   clipboard.calls.push(text);if(clipboard.refuse)throw Error('Clipboard permission refused.');
  }}});
  (window as any).canonicalNotesFixture.fail=true;
 });
 await openCanonicalNotes(page);
 await page.getByRole('button',{name:'Open Held note',exact:true}).click();
 const editor=page.getByRole('textbox',{name:'Note',exact:true});
 await editor.fill('Owner edits remain here.\nSecond line.');
 const copy=page.getByRole('button',{name:'Copy draft',exact:true});
 await expect(copy).toBeVisible();
 await expect(page.getByRole('button',{name:'Discard',exact:true})).toBeVisible();
 const posts=await page.evaluate(()=>(window as any).canonicalNotesFixture.requests.filter((request:any)=>request.method==='POST').length);
 await copy.click();
 await expect(page.getByText('Clipboard permission refused.',{exact:true})).toBeVisible();
 await expect(editor).toHaveValue('Owner edits remain here.\nSecond line.');
 await page.evaluate(()=>(window as any).draftClipboard.refuse=false);
 await copy.click();
 await expect(page.getByText('Draft copied.',{exact:true})).toBeVisible();
 await expect(editor).toHaveValue('Owner edits remain here.\nSecond line.');
 await expect(copy).toBeVisible();
 expect(await page.evaluate(()=>(window as any).draftClipboard.calls)).toEqual([
  'Held note\n\nOwner edits remain here.\nSecond line.',
  'Held note\n\nOwner edits remain here.\nSecond line.',
 ]);
 expect(await page.evaluate(()=>(window as any).canonicalNotesFixture.state.notes[0].body)).toBe('\nSaved text.');
 expect(await page.evaluate(()=>(window as any).canonicalNotesFixture.requests.filter((request:any)=>request.method==='POST').length)).toBe(posts);
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});
