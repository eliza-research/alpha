import {openCameraTools} from './camera-tools';
import {test,expect,type Page} from '@playwright/test';
import {openLegacyNotes} from './helpers/legacy-notes';
test.beforeEach(async({page})=>{await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));(window as any).cameraImportAttempts=0;navigator.mediaDevices.getUserMedia=async()=>{(window as any).cameraImportAttempts++;throw new DOMException('No camera','NotFoundError');};});await page.goto('/');await page.getByRole('button',{name:'Camera',exact:true}).click();await cameraRecovery(page);});
async function cameraRecovery(page:Page){const recovery=page.getByRole('alert',{name:'Camera unavailable',exact:true});await expect(recovery).toBeVisible();await expect(recovery.getByRole('button',{name:'Try again',exact:true})).toBeEnabled();return recovery;}
async function image(page:Page){const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=360;const ctx=c.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='black';ctx.font='60px Arial';ctx.fillText('Alpha Phone local scan',50,100);ctx.fillText('Review text before saving.',50,210);return c.toDataURL('image/png').split(',')[1];});return {name:'chosen.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')};}
async function count(page:Page){return page.evaluate(async()=>{const {browserPhotoLibrary}=await import('/src/prototype/browser-camera.ts');return (await browserPhotoLibrary.list()).items.length;});}
test('camera-less image selection saves one explicit JPEG copy and restores it in Photos',async({page})=>{
 const file=await image(page);await openCameraTools(page);await page.getByRole('button',{name:'Choose image',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Choose camera image'});await dialog.getByLabel('Image file').setInputFiles(file);await expect(dialog.getByRole('button',{name:'Save to Photos',exact:true})).toBeEnabled();expect(await count(page)).toBe(0);
 await dialog.getByRole('button',{name:'Save to Photos',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'Open last photo',exact:true})).toBeVisible();await expect(page.locator('[data-alpha-camera="said"]')).toHaveCount(0);expect(await count(page)).toBe(1);
 await page.reload();await page.getByRole('button',{name:'Photos',exact:true}).click();await expect(page.getByRole('button',{name:/Captured photo/})).toHaveCount(1);
 const row=await page.evaluate(async()=>{const {browserPhotoLibrary}=await import('/src/prototype/browser-camera.ts');const r=(await browserPhotoLibrary.list()).items[0];return {width:r.width,height:r.height,jpeg:r.image.startsWith('data:image/jpeg;base64,')};});expect(row).toEqual({width:1200,height:360,jpeg:true});
});
test('selected image scans locally with truthful provenance and explicit Notes save',async({page})=>{
 test.setTimeout(90000);
 await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));
 await openLegacyNotes(page);
 await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));
 await page.getByRole('button',{name:'Camera',exact:true}).click();await cameraRecovery(page);
 const remote:string[]=[],ocr:string[]=[];page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/ocr/'))ocr.push(u.pathname);if(u.protocol.startsWith('http')&&u.hostname!=='127.0.0.1')remote.push(u.origin);});
 const file=await image(page);await openCameraTools(page);await page.getByRole('button',{name:'Choose image',exact:true}).click();const importer=page.getByRole('dialog',{name:'Choose camera image'});await importer.getByLabel('Image file').setInputFiles(file);await expect(importer.getByRole('button',{name:'Scan text',exact:true})).toBeEnabled();expect(ocr).toEqual([]);await importer.getByRole('button',{name:'Scan text',exact:true}).click();
 const review=page.getByRole('dialog',{name:'Review scanned text'});await expect(review).toContainText('selected file stays unchanged and is not copied to Photos');await expect(review.getByRole('textbox',{name:'Scanned text'})).toBeEnabled({timeout:60000});expect(await review.getByRole('textbox',{name:'Scanned text'}).inputValue()).toContain('Alpha Phone local scan');expect(await count(page)).toBe(0);
 await review.getByRole('button',{name:'Save to Notes',exact:true}).click();await expect(review.getByRole('status',{name:'Scan status'})).toHaveText('Saved to Notes.');await review.getByRole('button',{name:'Close scan',exact:true}).click();expect(remote).toEqual([]);expect(ocr).toContain('/ocr/eng.traineddata.gz');
 await page.reload();await openLegacyNotes(page);await expect(page.getByText('Alpha Phone local scan',{exact:true}).first()).toBeVisible();
});
test('invalid selections and cancellation neither save photos nor start OCR',async({page})=>{
 await openCameraTools(page);await page.getByRole('button',{name:'Choose image',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Choose camera image'});await dialog.getByLabel('Image file').setInputFiles({name:'not-image.png',mimeType:'image/png',buffer:Buffer.from('not an image')});await expect(dialog.getByRole('status')).toContainText('Choose a readable');await expect(dialog.getByRole('button',{name:'Save to Photos',exact:true})).toBeDisabled();
 await dialog.getByLabel('Image file').setInputFiles(await image(page));await expect(dialog.getByRole('button',{name:'Save to Photos',exact:true})).toBeEnabled();await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));await expect(dialog).toHaveCount(0);expect(await count(page)).toBe(0);
});
test('leaving during image decode retires the selection and closes the late bitmap',async({page})=>{
 const file=await image(page);await page.evaluate(()=>{const original=window.createImageBitmap;(window as any).bitmapClosed=false;window.createImageBitmap=async(...args:any[])=>{const bitmap=await (original as any)(...args),close=bitmap.close.bind(bitmap);bitmap.close=()=>{(window as any).bitmapClosed=true;close();};await new Promise<void>(resolve=>{(window as any).releaseBitmap=resolve;});return bitmap;};});
 await openCameraTools(page);await page.getByRole('button',{name:'Choose image',exact:true}).click();await page.getByLabel('Image file').setInputFiles(file);await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseBitmap)).toBe('function');await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));await expect(page.getByRole('dialog',{name:'Choose camera image'})).toHaveCount(0);await page.evaluate(()=>(window as any).releaseBitmap());await expect.poll(()=>page.evaluate(()=>(window as any).bitmapClosed)).toBe(true);expect(await count(page)).toBe(0);
});

test('oversized images are refused and a failed save cannot silently retry',async({page})=>{
 await openCameraTools(page);await page.getByRole('button',{name:'Choose image',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Choose camera image'});
 await dialog.getByLabel('Image file').setInputFiles({name:'large.png',mimeType:'image/png',buffer:Buffer.alloc(16*1024*1024+1)});await expect(dialog.getByRole('status')).toContainText('Choose a readable');await expect(dialog.getByRole('button',{name:'Save to Photos',exact:true})).toBeDisabled();
 await dialog.getByLabel('Image file').setInputFiles(await image(page));await expect(dialog.getByRole('button',{name:'Save to Photos',exact:true})).toBeEnabled();
 await page.evaluate(()=>{const original=IDBObjectStore.prototype.add;(window as any).restoreImportWrites=()=>{IDBObjectStore.prototype.add=original;};IDBObjectStore.prototype.add=function(value,key){if(this.name==='photos')throw new DOMException('Full','QuotaExceededError');return original.call(this,value,key);};});
 await dialog.getByRole('button',{name:'Save to Photos',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Save unconfirmed. Check Photos before importing again.');await page.evaluate(()=>(window as any).restoreImportWrites());await expect(dialog.getByRole('button',{name:'Save to Photos',exact:true})).toBeDisabled();expect(await count(page)).toBe(0);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
});
test('import review fits light and compact dark layouts',async({page})=>{
 const file=await image(page);await openCameraTools(page);await page.getByRole('button',{name:'Choose image',exact:true}).click();let dialog=page.getByRole('dialog',{name:'Choose camera image'});await dialog.getByLabel('Image file').setInputFiles(file);await expect(dialog.getByRole('button',{name:'Scan text',exact:true})).toBeEnabled();await page.screenshot({path:'test-results/image-import-light.png'});
 await page.setViewportSize({width:360,height:640});await page.goto('/?theme=dark');await page.getByRole('button',{name:'Camera',exact:true}).click();await cameraRecovery(page);await openCameraTools(page);await page.getByRole('button',{name:'Choose image',exact:true}).click();dialog=page.getByRole('dialog',{name:'Choose camera image'});await dialog.getByLabel('Image file').setInputFiles(file);await expect(dialog.getByRole('button',{name:'Scan text',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'Cancel',exact:true}).scrollIntoViewIfNeeded();await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeInViewport();expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);expect(await dialog.evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgb(0, 0, 0)');await page.screenshot({path:'test-results/image-import-dark.png'});
});

test('unavailable camera retries explicitly without importing or saving a photo',async({page})=>{
 expect(await page.evaluate(()=>(window as any).cameraImportAttempts)).toBe(1);
 await (await cameraRecovery(page)).getByRole('button',{name:'Try again',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).cameraImportAttempts)).toBe(2);
 await cameraRecovery(page);expect(await count(page)).toBe(0);
 await openCameraTools(page);await page.getByRole('button',{name:'Choose image',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Choose camera image'});await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Save to Photos',exact:true})).toBeDisabled();
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(await count(page)).toBe(0);
});
