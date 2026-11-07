import {guardCalendarFixture as guardNoMedia} from './calendar-draft-readiness';
import {test,expect} from '@playwright/test';
test.beforeEach(async({context,page})=>{await guardNoMedia(context);await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,route=>route.abort());});
for(const theme of ['light','dark'])test(`${theme} file rename and delete dialogs restore their opener and preserve the file`,async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto(`/?mode=dev&theme=${theme}`);
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaFiles').importFile(new File(['Retained contents'],'keep.txt',{type:'text/plain'}));});
 await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).fill('Retained unsent file question');
 await page.getByRole('button',{name:'Files',exact:true}).click();await page.getByRole('button',{name:'Internal storage',exact:true}).click();await page.getByRole('button',{name:'Open keep.txt',exact:true}).click();
 const remove=page.getByRole('button',{name:'Delete file',exact:true});await expect(remove).toBeVisible();const selection=await page.evaluate(async()=>(await import('/src/runtime/alpha-client.ts')).alphaClient.getState().context.selectedObject);
 const rename=page.getByRole('button',{name:'Rename',exact:true});await rename.click();
 const dialog=page.getByRole('dialog',{name:'Rename',exact:true}),name=dialog.getByRole('textbox',{name:'Name',exact:true});await expect(name).toBeFocused();await name.fill('Unapproved.txt');
 const dock=await page.locator('[data-alpha-layer="pill"]').boundingBox(),confirm=await dialog.getByRole('button',{name:'Rename',exact:true}).boundingBox();
 expect(confirm!.y+confirm!.height).toBeLessThan(dock!.y);
 await page.screenshot({path:test.info().outputPath('rename-review.png'),animations:'disabled'});
 // A native HTML review above the inline sheet owns the first Back.
 await page.evaluate(()=>{const review=document.createElement('dialog');review.setAttribute('aria-label','Owned outer review');review.textContent='Synthetic review';review.addEventListener('close',()=>review.remove());document.body.append(review);review.showModal();});
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));await expect(page.getByRole('dialog',{name:'Owned outer review',exact:true})).toHaveCount(0);await expect(name).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));await expect(name).toHaveCount(0);await expect(rename).toBeFocused();expect(await page.evaluate(async()=>(await import('/src/runtime/alpha-client.ts')).alphaClient.getState().context.selectedObject)).toEqual(selection);
 await rename.click();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(rename).toBeFocused();
 await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));await expect(page.getByRole('button',{name:'Files',exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'Ask Alpha',exact:true})).toHaveValue('Retained unsent file question');
 expect(await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return (await registerPlugin<any>('AlphaFiles').storageList({path:''})).entries.map((row:any)=>row.name);})).toEqual(['keep.txt']);
});
