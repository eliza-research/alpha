import {guardCalendarFixture as guardNoMedia} from './calendar-draft-readiness';
import {test,expect} from '@playwright/test';
test.beforeEach(async({context,page})=>{await guardNoMedia(context);await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,route=>route.abort());});
for(const theme of ['light','dark'])for(const height of [915,420])test(`photo deletion review owns focus ${theme} ${height}`,async({page},info)=>{
 await page.setViewportSize({width:412,height});
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto(`/?theme=${theme}`);
 await page.evaluate(async({delayPreparation})=>{
  const {importBrowserPhoto,browserPhotoLibrary:library}=await import('/src/prototype/browser-camera.ts');
  // Keep the compact-layout preparation asynchronous to expose premature Back.
  if(delayPreparation){const prepare=library.prepareDeleteTrash.bind(library);library.prepareDeleteTrash=async(input)=>{await new Promise(resolve=>setTimeout(resolve,100));return prepare(input);};}
  const canvas=document.createElement('canvas');canvas.width=100;canvas.height=80;canvas.getContext('2d')!.fillRect(0,0,100,80);
  await importBrowserPhoto({original:new File([],'fixture.jpg'),image:canvas.toDataURL('image/jpeg'),width:100,height:80},new AbortController().signal);
  const row=(await library.list()).items[0];await library.setTrashed({id:row.id,revision:row.mutationRevision,trashed:true});
 },{delayPreparation:theme==="light"&&height===420});
 await page.getByRole('button',{name:'Photos',exact:true}).click();
 await page.getByRole('button',{name:'Albums',exact:true}).click();
 await page.getByRole('button',{name:'Recently deleted',exact:true}).click();
 const opener=page.getByRole('button',{name:'Delete all forever',exact:true});await opener.click();
 const dialog=page.getByRole('dialog',{name:'Delete photos forever'}),cancel=dialog.getByRole('button',{name:'Cancel',exact:true}),remove=dialog.getByRole('button',{name:'Delete forever',exact:true});
 await expect(cancel).toBeFocused();await expect(page.getByRole('button',{name:'Back to albums'})).toHaveCount(0);
 await expect(page.locator('[data-alpha-layer="pill"]')).toBeHidden();
 await page.keyboard.press('Shift+Tab');await expect(remove).toBeFocused();await page.keyboard.press('Tab');await expect(cancel).toBeFocused();
 await page.screenshot({path:info.outputPath('delete-review.png'),animations:'disabled'});
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(opener).toBeFocused();
 await expect(page.getByRole('button',{name:/^Photo, /})).toHaveCount(1);
 await opener.click();await expect(cancel).toBeFocused();await cancel.click();await expect(opener).toBeFocused();
 await opener.click();await expect(cancel).toBeFocused();await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back')));await expect(dialog).toHaveCount(0);await expect(opener).toBeFocused();
 // Deletion is exercised only against the isolated, test-created image.
 await opener.click();await expect(cancel).toBeFocused();await remove.click();await expect(dialog).toHaveCount(0);
 await expect(page.getByRole('button',{name:/^Photo, /})).toHaveCount(0);
});
