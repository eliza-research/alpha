import {test,expect,type Page} from '@playwright/test';
import {fenceNetwork} from './flag-off-android';
import {photosBridge} from './helpers/photos-bridge';
// Waits until Home or the optional prompt is shown before deciding, so a late prompt is not missed.
const dismissPrompt=async(page:Page)=>{const skip=page.getByRole('button',{name:'Not now',exact:true});await expect(skip.or(page.getByRole('button',{name:'Photos',exact:true})).filter({visible:true}).first()).toBeVisible();if(await skip.isVisible())await skip.click();};
// Flag-off bundled renderer/CSS with a closed native boundary; no Android/MediaStore acceptance claim.
for(const slow of [false,true])test(`native Photos grid opens and stays open ${slow?'delayed read':'immediate read'}`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await fenceNetwork(page);await photosBridge(page,'full',false,true);
 await dismissPrompt(page);
 await page.getByRole('button',{name:'Photos',exact:true}).click();
 await expect(page.getByRole('button',{name:/^Captured photo /})).toHaveCount(1);
 if(slow)await page.evaluate(()=>{const c=(window as any).Capacitor,original=c.nativePromise;c.nativePromise=async(p:string,m:string,i:any)=>{if(p==='AlphaPhotos'&&m==='read')await new Promise(r=>setTimeout(r,250));return original(p,m,i);};});
 await page.getByRole('button',{name:/^Captured photo /}).click();
 await expect(page.locator('[data-alpha-subview="photos-viewer"]')).toBeVisible();
 await page.waitForTimeout(700);
 await expect(page.locator('[data-alpha-subview="photos-viewer"]')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).mediaFixture.calls.filter((c:any)=>c.plugin==='AlphaPhotos'&&c.method==='read').length)).toBeGreaterThan(0);
 expect(errors).toEqual([]);
});
test('catalog invalidation during a pending read permits another normal grid tap',async({page})=>{
 await fenceNetwork(page);await photosBridge(page,'full',false,true);await dismissPrompt(page);await page.getByRole('button',{name:'Photos',exact:true}).click();
 await expect(page.getByRole('button',{name:/^Captured photo /})).toHaveCount(1);
 await page.evaluate(()=>{const w=window as any,c=w.Capacitor,original=c.nativePromise;w.heldReads=0;c.nativePromise=async(p:string,m:string,i:any)=>{if(p==='AlphaPhotos'&&m==='read'&&++w.heldReads===1)await new Promise(r=>{w.releaseHeldRead=r;});return original(p,m,i);};});
 await page.getByRole('button',{name:/^Captured photo /}).click();await expect(page.locator('[data-alpha-subview="photos-viewer"]')).toBeVisible();
 await page.evaluate(()=>(window as any).mediaFixture.emit());await expect(page.locator('[data-alpha-subview="photos-viewer"]')).toHaveCount(0);await expect(page.getByRole('button',{name:/^Captured photo /})).toHaveCount(1);
 await page.getByRole('button',{name:/^Captured photo /}).click();await expect(page.locator('[data-alpha-subview="photos-viewer"]')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).heldReads)).toBe(2);
 await page.evaluate(()=>(window as any).releaseHeldRead());await expect(page.locator('[data-alpha-subview="photos-viewer"]')).toBeVisible();
});
