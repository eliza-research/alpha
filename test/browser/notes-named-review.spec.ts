import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
// Local review dialogs for name-targeted Notes edits and the titles-only listing.
const root=resolve(import.meta.dirname,'../..');
const compile=(path:string)=>stripTypeScriptTypes(readFileSync(resolve(root,path),'utf8'),{mode:'transform'});
const inert=compile('apps/app/src/runtime/modal-inert.ts');
const review=[compile('apps/app/src/prototype/source-review-dialog.ts').replace(/import\s*\{\s*holdPhoneInert\s*\}\s*from\s*['"]\.\.\/runtime\/modal-inert['"];/,''),compile('apps/app/src/prototype/notes-query-review.ts').replace(/import\s*\{\s*openReview\s*\}\s*from\s*['"]\.\/source-review-dialog['"];/,'')].join('\n');
const css=readFileSync(resolve(root,'apps/app/src/prototype/phone.css'),'utf8');
test.beforeEach(async({page})=>{
 await page.setViewportSize({width:360,height:740});
 await page.setContent(`<style>${css}</style><div class="os" style="--bg:#FFFFFF;--fg:#000000"><button id="origin">Original focus</button></div>`);
 await page.addScriptTag({type:'module',content:inert+'\n'+review+'\nwindow.reviewNamedNote=reviewNamedNote;window.reviewNoteTitles=reviewNoteTitles;'});
 await page.waitForFunction(()=>typeof (window as any).reviewNamedNote==='function');
});
const notes=[{id:'private-travel-id',kind:'text',title:'Travel plans',body:'Renew passport'},{id:'private-old-id',kind:'text',title:'Travel 2025',body:'Old trip'}];
test('a named delete is disambiguated locally and confirmed for the exact note',async({page})=>{
 await page.locator('#origin').focus();
 await page.evaluate(notes=>{const win=window as any;win.result=win.reviewNamedNote(notes,{type:'notes_named',action:'delete',name:'travel'},new AbortController().signal,()=>{});},notes);
 const dialog=page.getByRole('dialog',{name:'Choose the note to delete'});await expect(dialog).toBeVisible();
 await expect(dialog).toContainText('Several notes match “travel”. Choose the exact note.');
 await expect(dialog).toContainText('erased after 3 days unless you restore it');
 const confirm=dialog.locator('footer button').last();await expect(confirm).toBeDisabled();
 expect(await page.locator('.os').evaluate((element:HTMLElement)=>element.inert)).toBe(true);
 await page.getByRole('combobox',{name:'Note',exact:true}).selectOption('private-travel-id');
 await expect(confirm).toHaveText('Move “Travel plans” to Trash');await expect(dialog.locator('pre')).toHaveText('Renew passport');
 expect(await dialog.innerText()).not.toContain('private-travel-id');
 await confirm.click();expect(await page.evaluate(()=>(window as any).result)).toBe('private-travel-id');
 await expect(page.locator('#origin')).toBeFocused();expect(await page.locator('.os').evaluate((element:HTMLElement)=>element.inert)).toBe(false);
});
test('a single match is preselected for update and Back cancels without a choice',async({page})=>{
 await page.evaluate(notes=>{const win=window as any;win.result=win.reviewNamedNote([notes[0]],{type:'notes_named',action:'update',name:'Travel plans',fields:{title:'Travel plans',body:'Renew passport by April'}},new AbortController().signal,()=>{});},notes);
 const dialog=page.getByRole('dialog',{name:'Choose the note to update'});
 await expect(dialog).toContainText('New title: “Travel plans”');await expect(dialog).toContainText('Renew passport by April');
 await expect(dialog.locator('footer button').last()).toHaveText('Update “Travel plans”');
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
 expect(await page.evaluate(()=>(window as any).result)).toBeNull();
});
test('the titles listing shares only after explicit approval',async({page})=>{
 await page.evaluate(()=>{const win=window as any;win.result=win.reviewNoteTitles(['Groceries','Travel plans'],true,new AbortController().signal,()=>{});});
 const dialog=page.getByRole('dialog',{name:'Review note titles to share'});
 await expect(dialog.getByRole('listitem')).toHaveText(['Groceries','Travel plans']);
 await expect(dialog).toContainText('Note text stays on this phone. Older notes are not included.');
 await page.keyboard.press('Escape');expect(await page.evaluate(()=>(window as any).result)).toBe(false);
 await page.evaluate(()=>{const win=window as any;win.result=win.reviewNoteTitles(['Groceries'],false,new AbortController().signal,()=>{});});
 await page.getByRole('button',{name:'Share 1 title'}).click();expect(await page.evaluate(()=>(window as any).result)).toBe(true);
});
