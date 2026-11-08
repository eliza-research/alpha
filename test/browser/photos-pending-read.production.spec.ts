import {test,expect} from '@playwright/test';
import {fenceNetwork} from './flag-off-android';
import {photosBridge} from './helpers/photos-bridge';
// Flag-off bundled renderer/CSS with a closed native boundary; no Android/MediaStore acceptance claim.
for(const slow of [false,true])test(`native Photos grid opens and stays open ${slow?'delayed read':'immediate read'}`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await fenceNetwork(page);await photosBridge(page,'full',false,true);
 const skip=page.getByRole('button',{name:'Not now',exact:true});if(await skip.isVisible())await skip.click();
 await page.getByRole('button',{name:'Photos',exact:true}).click();
 await expect(page.getByRole('button',{name:/^Photo, /})).toHaveCount(1);
 if(slow)await page.evaluate(()=>{const c=(window as any).Capacitor,original=c.nativePromise;c.nativePromise=async(p:string,m:string,i:any)=>{if(p==='AlphaPhotos'&&m==='read')await new Promise(r=>setTimeout(r,250));return original(p,m,i);};});
 await page.getByRole('button',{name:/^Photo, /}).click();
 await expect(page.locator('[data-alpha-subview="photos-viewer"]')).toBeVisible();
 await page.waitForTimeout(700);
 await expect(page.locator('[data-alpha-subview="photos-viewer"]')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).mediaFixture.calls.filter((c:any)=>c.plugin==='AlphaPhotos'&&c.method==='read').length)).toBeGreaterThan(0);
 expect(errors).toEqual([]);
});
test('a store change during a pending read keeps the viewer and publishes the read',async({page})=>{
 await fenceNetwork(page);await photosBridge(page,'full',false,true);const skip=page.getByRole('button',{name:'Not now',exact:true});if(await skip.isVisible())await skip.click();await page.getByRole('button',{name:'Photos',exact:true}).click();
 await expect(page.getByRole('button',{name:/^Photo, /})).toHaveCount(1);
 await page.evaluate(()=>{const w=window as any,c=w.Capacitor,original=c.nativePromise;w.heldReads=0;c.nativePromise=async(p:string,m:string,i:any)=>{if(p==='AlphaPhotos'&&m==='read'&&++w.heldReads===1)await new Promise(r=>{w.releaseHeldRead=r;});return original(p,m,i);};});
 await page.getByRole('button',{name:/^Photo, /}).click();await expect(page.locator('[data-alpha-subview="photos-viewer"]')).toBeVisible();
 // FixPatch: an external MediaStore change patches the window; the viewer of a surviving item stays.
 await page.evaluate(()=>(window as any).mediaFixture.emit());await page.waitForTimeout(300);
 await expect(page.locator('[data-alpha-subview="photos-viewer"]')).toBeVisible();
 await page.evaluate(()=>(window as any).releaseHeldRead());await page.waitForTimeout(300);
 await expect(page.locator('[data-alpha-subview="photos-viewer"]')).toBeVisible();
});

test('native Photos keeps the deep window after a catalog event and reloads evicted thumbnails',async({page})=>{
 await fenceNetwork(page);await photosBridge(page,'full',false,true);
 await page.addInitScript(()=>{
  const w=window as any,c=w.Capacitor,original=c.nativePromise;
  const photos=c.PluginHeaders.find((plugin:any)=>plugin.name==='AlphaPhotos');photos.methods.push({name:'thumbnails',rtype:'promise'});
  const image=w.mediaFixture.row.image,now=Date.now();
  const rows=Array.from({length:400},(_,index)=>({...w.mediaFixture.row,id:`m:external_primary:i:${1000+index}`,date:now-index*1000,image}));
  w.thumbnailReads=[];
  c.nativePromise=async(plugin:string,method:string,input:any)=>{
   if(plugin==='AlphaPhotos'&&method==='list'){
    if(input?.trashed)return {items:[],next:''};
    const offset=Number(input?.before||0),limit=input?.limit||24;
    return {items:rows.slice(offset,offset+limit),next:offset+limit<rows.length?String(offset+limit):''};
   }
   if(plugin==='AlphaPhotos'&&method==='thumbnails'){w.thumbnailReads.push(input.ids);return {items:input.ids.map((id:string)=>({id,image}))};}
   return original(plugin,method,input);
  };
 });
 await page.reload();
 const skip=page.getByRole('button',{name:'Not now',exact:true});if(await skip.isVisible())await skip.click();
 await page.getByRole('button',{name:'Photos',exact:true}).click();
 const grid=page.locator('[data-alpha-app-scroll="photos"]'),count=page.locator('.photo-day-header span');
 await expect(count).toHaveText('48');
 for(let expected=72;expected<=384;expected+=24){await grid.evaluate(el=>el.scrollTo(0,el.scrollHeight));await expect(count).toHaveText(String(expected));}
 await page.waitForTimeout(180);
 await page.evaluate(()=>(window as any).mediaFixture.emit());
 await expect(count).toHaveText('384');
 await page.waitForTimeout(180);
 // Scroll back to old rows after the deep window has dropped their image data.
 await grid.evaluate(el=>el.scrollTo(0,0));
 await expect.poll(()=>page.evaluate(()=>(window as any).thumbnailReads.flat().includes('m:external_primary:i:1000'))).toBe(true);
 const first=page.locator('[data-owned-media-id="native-camera-m:external_primary:i:1000"]');
 await expect(first).toBeVisible();await expect.poll(()=>first.locator('span').first().evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('data:image/');
 expect(await page.evaluate(()=>(window as any).thumbnailReads.every((ids:string[])=>ids.length<=24))).toBe(true);
});
