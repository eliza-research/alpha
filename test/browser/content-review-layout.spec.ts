import {test,expect} from '@playwright/test';
test.use({viewport:{width:360,height:430}});
for(const theme of ['light','dark'])for(const kind of ['question','image','document','recording'])test(`${theme} ${kind} review remains usable at 150 percent text and compact height`,async({page},info)=>{
 await page.goto(`/?mode=dev&theme=${theme}`);
 await page.evaluate(async kind=>{
  const {BrowserDevice}=await import('/src/browser/device.ts');await BrowserDevice.prototype.setTextScale({percent:150});
  const name='Source-'+ 'unbroken'.repeat(12)+'.txt';
  if(kind==='question'||kind==='image'){
   const {reviewContentQuestion}=await import('/src/browser/content-question.ts');
   reviewContentQuestion({name,text:'Public text for review.\n'.repeat(15),current:()=>true,compose:()=>{},source:async()=>{throw Error('Unavailable source');},...(kind==='image'?{image:async()=>{throw Error('Unavailable preview');}}:{})});
  }else{
   const {reviewSummaryNote}=await import('/src/prototype/summary-note-review.ts');
   reviewSummaryNote({text:kind==='recording'?JSON.stringify({summary:'Reviewed summary',actions:['First action','Second action']}):'Reviewed summary',source:kind==='recording'?{kind:'recording',version:1,name,noteId:'fixture-recording',revision:'a'.repeat(64)}:{version:1,name,mimeType:'text/plain',size:12,sha256:'b'.repeat(64)},current:()=>true,save:async()=>false,complete:()=>{}});
  }
 },kind);
 const question=kind==='question'||kind==='image',dialog=page.getByRole('dialog',{name:question?'Ask about selected content':'Save summary'}),save=dialog.getByRole('button',{name:question?'Use in conversation':kind==='recording'?'Save recording summary':'Save reviewed note',exact:true});
 async function fits(){
  expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  for(const button of [save,dialog.getByRole('button',{name:'Cancel',exact:true})]){
   const box=await button.boundingBox();expect(box).not.toBeNull();expect(box!.height).toBeGreaterThanOrEqual(44);expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(360);expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(430);
  }
 }
 await fits();
 const region=dialog.getByRole('region',{name:question?'Content question review':'Summary note review'});await region.focus();await page.keyboard.press('End');await expect.poll(()=>region.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
 await save.click();await expect(dialog.getByRole('status')).toContainText(question?'Source unverified':'Save unconfirmed');await fits();
 await page.screenshot({path:info.outputPath('compact-review-error.png')});
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);
});
