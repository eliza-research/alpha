import { returnToApps } from './app-navigation';
import {test,expect} from '@playwright/test';

// A synthetic canvas stream supplies only the camera permission boundary; encoding and IndexedDB are real.
// No physical camera, model, native API, upload or external account is used.
test('browser camera persists a real encoded frame, releases capture and restores Photos after reload',async({page},info)=>{
 await page.addInitScript(()=>{
 const devices=navigator.mediaDevices;Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:devices});
 localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
 const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const ctx=canvas.getContext('2d')!;
 ctx.fillStyle='#c33';ctx.fillRect(0,0,320,480);ctx.fillStyle='#3c3';ctx.fillRect(320,0,320,480);
 navigator.mediaDevices.getUserMedia=async()=>{const stream=canvas.captureStream(10);setInterval(()=>{ctx.fillStyle='#3c3';ctx.fillRect(320,0,320,480);},100);return stream;};

 });
 await page.goto('/');await page.getByRole('button',{name:'Camera',exact:true}).click();
 const video=page.locator('[aria-label^="Viewfinder."] video');await expect(video).toBeVisible();
 await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);
 await page.evaluate(()=>{(window as any).cameraTracks=(document.querySelector('[aria-label^="Viewfinder."] video') as HTMLVideoElement).srcObject;});
 await page.evaluate(()=>{const add=IDBObjectStore.prototype.add;(window as any).restorePhotoWrites=()=>{IDBObjectStore.prototype.add=add;};IDBObjectStore.prototype.add=function(value,key){if(this.name==='photos')throw new DOMException('Synthetic full storage','QuotaExceededError');return add.call(this,value,key);};});
 await page.getByRole('button',{name:'Take photo',exact:true}).click();
 await expect(page.getByText('Photo not saved. Try again.',{exact:true})).toBeVisible();
 expect(await page.evaluate(async()=>{const {browserPhotoLibrary}=await import('/src/prototype/browser-camera.ts');return (await browserPhotoLibrary.list()).items.length;})).toBe(0);
 await page.evaluate(()=>(window as any).restorePhotoWrites());
 await page.getByRole('button',{name:'Take photo',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open last photo',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('capture.png')});
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
 await expect.poll(()=>page.evaluate(()=>(window as any).cameraTracks.getTracks().every((t:MediaStreamTrack)=>t.readyState==='ended'))).toBe(true);
 await page.reload();await page.getByRole('button',{name:'Photos',exact:true}).click();
 const saved=page.getByRole('button',{name:/^Photo, /});await expect(saved).toHaveCount(1);await saved.click();
 await expect(page.locator('[data-alpha-subview="photos-viewer"]').getByRole('heading',{name:'Today',exact:true})).toBeVisible();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Share photo',exact:true}).click();await page.getByRole('dialog',{name:'Share',exact:true}).getByRole('button',{name:'Save locally',exact:true}).click();
 expect((await download).suggestedFilename()).toMatch(/^Alpha-photo-\d+\.jpg$/);
 await page.getByRole('button',{name:'Favorite',exact:true}).click();
 await expect(page.getByRole('button',{name:'Remove from favorites',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('saved-photo.png'),animations:'disabled'});
 await page.getByRole('button',{name:'Delete photo',exact:true}).click();
 await expect(page.getByText('Moved to Recently deleted',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Albums',exact:true}).click();
 await page.getByRole('button',{name:'Recently deleted',exact:true}).click();
 await page.getByRole('button',{name:/^Photo, /}).click();
 await expect(page.getByRole('button',{name:'Recover deleted item',exact:true})).toBeVisible();
 expect(await page.evaluate(async()=>{const {browserPhotoLibrary:library}=await import('/src/prototype/browser-camera.ts');return (await library.list({trashed:true})).items.length;})).toBe(1);
 await page.getByRole('button',{name:'Recover deleted item',exact:true}).click();
 await expect(page.getByText('Restored',{exact:true})).toBeVisible();
 const result=await page.evaluate(async()=>{
  const {browserPhotoLibrary:library}=await import('/src/prototype/browser-camera.ts');
  const row=(await library.list()).items[0];
  await library.setFavorite({id:row.id,revision:row.mutationRevision,favorite:false});
  let staleRejected=false;try{await library.setTrashed({id:row.id,revision:row.mutationRevision,trashed:true});}catch{staleRejected=true;}
  const current=await library.read({id:row.id});
  const trashed=await library.setTrashed({id:row.id,revision:current.mutationRevision,trashed:true});
  const confirmation=await library.prepareDeleteTrash({all:true});
  await library.setTrashed({id:row.id,revision:trashed.mutationRevision,trashed:false});
  const receipt=await library.deletePreparedTrash(confirmation);
  return {staleRejected,deleted:receipt.deletedIds.length,skipped:receipt.skippedIds.length,retained:(await library.list()).items.length};
 });
 expect(result).toEqual({staleRejected:true,deleted:0,skipped:1,retained:1});
});

test('browser camera permission denial retries explicitly without a saved photo',async({page})=>{
 await page.addInitScript(()=>{
 const devices=navigator.mediaDevices;Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:devices});
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  (window as any).cameraAttempts=0;
  navigator.mediaDevices.getUserMedia=async()=>{(window as any).cameraAttempts++;throw new DOMException('Synthetic denial','NotAllowedError');};
 });
 await page.goto('/');await page.getByRole('button',{name:'Camera',exact:true}).click();
 const recovery=page.getByRole('alert',{name:'Camera access is off'});
 await expect(recovery).toBeVisible();
 await expect(page.locator('[data-alpha-camera="said"]')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).cameraAttempts)).toBe(1);
 await expect(recovery).toHaveText('Camera access is offTry again');
 await expect(recovery.getByRole('button',{name:'Open settings'})).toHaveCount(0);
 await page.getByRole('button',{name:'Take photo',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).cameraAttempts)).toBe(2);
 await recovery.getByRole('button',{name:'Try again',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).cameraAttempts)).toBe(3);
 await expect(recovery).toBeVisible();
 await expect(page.locator('[aria-label^="Viewfinder."] video')).toHaveCount(0);
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
 await page.getByRole('button',{name:'Photos',exact:true}).click();
 await expect(page.getByRole('button',{name:/^Photo, /})).toHaveCount(0);
});

test('leaving Camera while permission is pending stops a late stream without reopening preview',async({page})=>{
 await page.addInitScript(()=>{
 const devices=navigator.mediaDevices;Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:devices});
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{(window as any).releaseCamera=()=>{
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
   const stream=canvas.captureStream(10);(window as any).lateCameraStream=stream;resolve(stream);
  };});
 });
 await page.goto('/');await page.getByRole('button',{name:'Camera',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseCamera)).toBe('function');
 await returnToApps(page);
 await expect(page.getByRole('button',{name:'Camera',exact:true})).toBeVisible();
 await page.evaluate(()=>(window as any).releaseCamera());
 await expect.poll(()=>page.evaluate(()=>(window as any).lateCameraStream.getTracks().every((t:MediaStreamTrack)=>t.readyState==='ended'))).toBe(true);
 await expect(page.locator('[aria-label^="Viewfinder."] video')).toHaveCount(0);
});
