import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
// Local review dialogs for Notes: the query choice, name-targeted edits and the titles-only listing.
// The real modules are served by the dev server on a same-origin page that does not boot the app.
const css=readFileSync(resolve(import.meta.dirname,'../../apps/app/src/prototype/phone.css'),'utf8');
async function load(page:Page,theme:'light'|'dark'='light'){
 await page.setViewportSize({width:360,height:740});
 const os=`<div class="os" style="--bg:${theme==='dark'?'#000000':'#FFFFFF'};--fg:${theme==='dark'?'#FFFFFF':'#000000'}"><button id="origin">Original focus</button></div>`;
 await page.route('**/notes-review-fixture',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en"><head><title>Notes review</title><style>${css}</style></head><body>${os}</body></html>`}));
 await page.goto('/notes-review-fixture');
 await page.evaluate(async()=>{Object.assign(window,await import('/src/prototype/notes-query-review.ts' as string));});
}
for(const theme of ['light','dark'] as const)test(`local Notes choice preserves ${theme} theme, exact long preview and modal ownership`,async({page})=>{
 await load(page,theme);
 const open=async()=>{await page.locator('#origin').focus();await page.evaluate(()=>{const win=window as any;win.body='Exact long note line\n'.repeat(1000);win.controller=new AbortController();win.result=win.reviewNotesQuery([{id:'private-record-id',kind:'text',title:'First note',body:win.body},{id:'other-private-id',kind:'text',title:'Other note',body:'Other exact body'}],'Choose the note to share.',win.controller.signal,()=>{});});await expect(page.getByRole('dialog',{name:'Choose a note to share'})).toBeVisible();};
 await open();const dialog=page.getByRole('dialog');await expect(dialog).toHaveCSS('background-color',theme==='dark'?'rgb(0, 0, 0)':'rgb(255, 255, 255)');await expect(dialog).toHaveCSS('color',theme==='dark'?'rgb(255, 255, 255)':'rgb(0, 0, 0)');await expect(page.getByRole('button',{name:'Share this note'})).toBeDisabled();
 await page.getByRole('combobox',{name:'Note',exact:true}).selectOption('private-record-id');expect(await dialog.locator('pre').textContent()).toBe('Exact long note line\n'.repeat(1000));expect(await dialog.innerText()).not.toContain('private-record-id');
 const layout=await dialog.evaluate(element=>{const content=element.querySelector('.note-source-content')!,footer=element.querySelector('footer')!,buttons=[...element.querySelectorAll('button')];return {scroll:content.scrollHeight>content.clientHeight,bottom:footer.getBoundingClientRect().bottom,heights:buttons.map(button=>button.getBoundingClientRect().height),inert:(document.querySelector('.os') as HTMLElement).inert};});expect(layout.scroll).toBe(true);expect(layout.bottom).toBeLessThanOrEqual(740);expect(layout.heights.every(height=>height>=44)).toBe(true);expect(layout.inert).toBe(true);
 await page.getByRole('button',{name:'Share this note'}).click();expect(await page.evaluate(async()=>(window as any).result)).toBe('private-record-id');await expect(page.locator('#origin')).toBeFocused();expect(await page.locator('.os').evaluate((element:HTMLElement)=>element.inert)).toBe(false);
 await open();await page.keyboard.press('Escape');expect(await page.evaluate(async()=>(window as any).result)).toBeNull();await expect(page.locator('#origin')).toBeFocused();
 await open();await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));expect(await page.evaluate(async()=>(window as any).result)).toBeNull();expect(await page.locator('.os').evaluate((element:HTMLElement)=>element.inert)).toBe(false);
 await page.locator('#origin').focus();const failed=await page.evaluate(async()=>{HTMLDialogElement.prototype.showModal=function(){throw new DOMException('Fixture showModal failure','InvalidStateError');};try{await (window as any).reviewNotesQuery([{id:'note',kind:'text',title:'One',body:'Text'}],'Review',new AbortController().signal,()=>{});return 'unexpected';}catch(error){return (error as Error).name;}});expect(failed).toBe('InvalidStateError');await expect(page.locator('dialog')).toHaveCount(0);expect(await page.locator('.os').evaluate((element:HTMLElement)=>element.inert)).toBe(false);await expect(page.locator('#origin')).toBeFocused();expect(await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})))).toBe(true);
});
const notes=[{id:'private-travel-id',kind:'text',title:'Travel plans',body:'Renew passport'},{id:'private-old-id',kind:'text',title:'Travel 2025',body:'Old trip'}];
test('a named delete is disambiguated locally and confirmed for the exact note',async({page})=>{
 await load(page);
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
 await load(page);
 await page.evaluate(notes=>{const win=window as any;win.result=win.reviewNamedNote([notes[0]],{type:'notes_named',action:'update',name:'Travel plans',fields:{title:'Travel plans',body:'Renew passport by April'}},new AbortController().signal,()=>{});},notes);
 const dialog=page.getByRole('dialog',{name:'Choose the note to update'});
 await expect(dialog).toContainText('New title: “Travel plans”');await expect(dialog).toContainText('Renew passport by April');
 await expect(dialog.locator('footer button').last()).toHaveText('Update “Travel plans”');
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
 expect(await page.evaluate(()=>(window as any).result)).toBeNull();
});
test('the titles listing shares only after explicit approval',async({page})=>{
 await load(page);
 await page.evaluate(()=>{const win=window as any;win.result=win.reviewNoteTitles(['Groceries','Travel plans'],true,new AbortController().signal,()=>{});});
 const dialog=page.getByRole('dialog',{name:'Review note titles to share'});
 await expect(dialog.getByRole('listitem')).toHaveText(['Groceries','Travel plans']);
 await expect(dialog).toContainText('Note text stays on this phone. Older notes are not included.');
 await page.keyboard.press('Escape');expect(await page.evaluate(()=>(window as any).result)).toBe(false);
 await page.evaluate(()=>{const win=window as any;win.result=win.reviewNoteTitles(['Groceries'],false,new AbortController().signal,()=>{});});
 await page.getByRole('button',{name:'Share 1 title'}).click();expect(await page.evaluate(()=>(window as any).result)).toBe(true);
});
