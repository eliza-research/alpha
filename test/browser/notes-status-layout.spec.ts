import {openLegacyNotes} from './helpers/legacy-notes';
import {test,expect} from '@playwright/test';
for(const theme of ['light','dark'])for(const viewport of [{width:360,height:740},{width:412,height:915},{width:1440,height:500}]){
 test(`Notes storage failure has its own space: ${theme} ${viewport.width}x${viewport.height}`,async({page})=>{
  await page.setViewportSize(viewport);
  await page.addInitScript((theme)=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));localStorage.setItem('alpha.appearance.v1',theme);},theme);
  await page.goto(`/?theme=${theme}`);await expect(page.locator('[data-screen]')).toHaveCSS('background-color',theme==='dark'?'rgb(0, 0, 0)':'rgb(255, 255, 255)');await openLegacyNotes(page);
  const status=page.locator('.notes-storage-status');await expect(status).toHaveCount(0);
  const check=async()=>{
   const result=await page.evaluate(()=>{
    const status=document.querySelector('.notes-storage-status')!,workspace=document.querySelector('.notes-workspace')!,layout=document.querySelector('.notes-layout')!;
    const a=status.getBoundingClientRect(),b=workspace.getBoundingClientRect(),c=layout.getBoundingClientRect();
    return {belowStatusBar:a.top-document.querySelector('[data-screen]>div:first-child')!.getBoundingClientRect().bottom,overlap:a.bottom-b.top,height:a.height,overflow:status.scrollHeight>status.clientHeight||status.scrollWidth>status.clientWidth};
   });expect(result.belowStatusBar).toBeGreaterThan(0);expect(result.overlap).toBeLessThanOrEqual(.5);expect(result.height).toBeGreaterThan(0);expect(result.overflow).toBe(false);
  };
  await page.getByRole('button',{name:'New note',exact:true}).click();
  await page.getByRole('textbox',{name:'Title',exact:true}).fill('Status layout');await page.getByRole('textbox',{name:'Note',exact:true}).fill('Original');
  await page.evaluate(()=>{const set=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(key==='alpha.browser.notes.v1')throw new DOMException('Full','QuotaExceededError');return set.call(this,value,key);};});
  await page.getByRole('textbox',{name:'Note',exact:true}).fill('Keep this unsaved text');
  await expect(status).toContainText('Keep this screen open');await check();
  const controls=await page.getByRole('button',{name:'Back to notes',exact:true}).boundingBox(),bounds=await status.boundingBox();expect(controls!.y).toBeGreaterThanOrEqual(bounds!.y+bounds!.height-.5);
  await expect(page.getByRole('textbox',{name:'Note',exact:true})).toHaveValue('Keep this unsaved text');
  await page.screenshot({animations:'disabled',path:test.info().outputPath('notes-status-error.png')});
  await page.addStyleTag({content:'.notes-storage-status{font-size:24px!important;line-height:1.35!important}'});await check();
  const expanded=await status.boundingBox(),back=await page.getByRole('button',{name:'Back to notes',exact:true}).boundingBox();expect(back!.y).toBeGreaterThanOrEqual(expanded!.y+expanded!.height-.5);
  await page.getByRole('button',{name:'Back to notes',exact:true}).click();await expect(page.getByRole('button',{name:'Open Status layout',exact:true})).toBeVisible();
  await page.screenshot({animations:'disabled',path:test.info().outputPath('notes-status-large-text.png')});
 });
}
