import {test,expect} from '@playwright/test';

/** Opens the scan review of an unsaved scan-mode capture whose Keep answers come from `answers` in order:
 * 'saved', or a ScanKeepError with or without retry. Records every Keep call on window.keepCalls. */
async function open(page:any,answers:string[]){
 await page.goto('/');await expect(page.getByRole('button',{name:'Camera',exact:true})).toBeVisible();
 await page.evaluate(async(answers:string[])=>{
  const c=document.createElement('canvas');c.width=40;c.height=30;const image=await new Promise<Blob>(r=>c.toBlob(b=>r(b!),'image/jpeg'));
  const {openScanReview,ScanKeepError}=await import('/src/prototype/scan-review.ts');
  const w=window as any;w.keepCalls=0;
  openScanReview(image,async()=>false,undefined,'unsaved',async()=>{
   const answer=answers[w.keepCalls++];
   if(answer==='saved')return 'Photo kept in Android Photos.';
   if(answer==='retry')throw new ScanKeepError('Keep photo unconfirmed. Trying again checks the same photo and does not save a second copy.',true);
   throw new ScanKeepError('Keep photo unconfirmed. Check Photos before keeping it again.',false);
  });
 },answers);
 // Local recognition reports into the same status; let it settle so only Keep writes there next.
 await expect(status(page)).toContainText('No text recognized',{timeout:60_000});
}
function status(page:any){return page.getByRole('dialog',{name:'Review scanned text'}).getByRole('status',{name:'Scan status'});}

test('an unconfirmed Keep that the host can resolve once offers Try keeping again, which keeps the photo',async({page})=>{
 await open(page,['retry','saved']);
 await page.getByRole('button',{name:'Keep photo',exact:true}).click();
 await expect(status(page)).toHaveText('Keep photo unconfirmed. Trying again checks the same photo and does not save a second copy.');
 const again=page.getByRole('button',{name:'Try keeping again',exact:true});await expect(again).toBeEnabled();
 await again.click();
 await expect(status(page)).toHaveText('Photo kept in Android Photos.');
 await expect(page.getByRole('button',{name:'Photo kept',exact:true})).toBeDisabled();
 expect(await page.evaluate(()=>(window as any).keepCalls)).toBe(2);
});

test('an unconfirmed Keep that could duplicate the photo leaves Keep off',async({page})=>{
 await open(page,['final']);
 const keep=page.getByRole('button',{name:'Keep photo',exact:true});await keep.click();
 await expect(status(page)).toHaveText('Keep photo unconfirmed. Check Photos before keeping it again.');
 await expect(keep).toBeDisabled();
 await keep.click({force:true});
 expect(await page.evaluate(()=>(window as any).keepCalls)).toBe(1);
});
