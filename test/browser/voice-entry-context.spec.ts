import {openLegacyNotes} from './helpers/legacy-notes';
import {test,expect} from '@playwright/test';
import {silentMicrophone,agentContext} from './voice-fixture';

// Voice entry from an open note keeps that note open, unchanged, and keeps its selection
// revision in the agent context envelope. No message is sent.
// The development server is shared and slow on a loaded machine.
test.describe.configure({timeout:120000});
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));});

test('unavailable chat voice preserves the selected note and returns to typing without sending',async({page})=>{
 let sent=0;page.on('request',request=>{if(request.method()==='POST')sent++;});
 await page.goto('/');await silentMicrophone(page);
 await openLegacyNotes(page);
 await page.getByRole('button',{name:'New note',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Voice context');
 await page.getByRole('textbox',{name:'Note',exact:true}).fill('Original body stays put.');
 await expect.poll(async()=>(await agentContext(page)).selectedObject?.kind,{timeout:15000}).toBe('note');
 const before=await agentContext(page);
 expect(before.view).toBe('notes');
 await page.evaluate(async()=>{const {Component}=await import('/src/prototype/model.js'),{connectionController:c}=await import('/src/runtime/connection-ui.tsx');const render=Component.prototype.renderVals;Component.prototype.renderVals=function(){(window as any).entryContextShell=this;return render.call(this);};c.close();});
 await page.getByRole('button',{name:'Open conversation',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).entryContextShell?.swallowed())).toBe(false);
 await page.getByRole('button',{name:'Talk',exact:true}).press('Enter');
 const voice=page.getByRole('region',{name:'Voice conversation',exact:true});
 await expect(voice).toBeVisible();
 await expect(voice.getByRole('button',{name:'Stop voice conversation',exact:true})).toBeEnabled();
 await expect(voice.getByRole('button',{name:'Microphone off',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Minimize chat',exact:true}).click();
 await expect(voice).toHaveCount(0);
 await page.getByRole('button',{name:'Type',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Ask Alpha',exact:true})).toHaveValue('');
 // The same note is still open beside the keyboard composer, and the envelope still names it at the same revision.
 await expect(page.locator('textarea[aria-label="Note"]')).toHaveValue('Original body stays put.');
 await expect.poll(async()=>JSON.stringify((await agentContext(page)).selectedObject),{timeout:15000}).toBe(JSON.stringify(before.selectedObject));
 await expect(page.getByRole('textbox',{name:'Note',exact:true})).toHaveValue('Original body stays put.');
 await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Voice context');
 await expect.poll(async()=>JSON.stringify((await agentContext(page)).selectedObject),{timeout:15000}).toBe(JSON.stringify(before.selectedObject));
 const after=await agentContext(page);
 expect(after.view).toBe('notes');
 expect(after.selectedObject).toEqual(before.selectedObject);
 expect(sent).toBe(0);
});
