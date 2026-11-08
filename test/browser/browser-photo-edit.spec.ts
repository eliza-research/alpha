import { returnToApps } from './app-navigation';
import {test,expect,type Page} from '@playwright/test';

// Controlled source pixels in real IndexedDB; the production editor/canvas and UI are used.
async function seed(page:Page,width=240,height=120){
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 return page.evaluate(async({width,height})=>{
  const {browserPhotoLibrary:library}=await import('/src/prototype/browser-camera.ts');await library.list();
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d')!;
  ctx.fillStyle='#d22';ctx.fillRect(0,0,width/2,height);ctx.fillStyle='#2c4';ctx.fillRect(width/2,0,width/2,height);
  const original={id:'1000',kind:'image',image:canvas.toDataURL('image/jpeg',.9),width,height,date:1700000000000,revision:'original-pixels',mutationRevision:'original-metadata',favorite:false,trashed:false};
  await new Promise<void>((resolve,reject)=>{const request=indexedDB.open('alpha.browser.photos.v1');request.onsuccess=()=>{const db=request.result,tx=db.transaction('photos','readwrite');tx.objectStore('photos').add(original);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};request.onerror=()=>reject(request.error);});
  return original;
 },{width,height});
}
async function openEditor(page:Page){
 await page.getByRole('button',{name:'Photos',exact:true}).click();
 await page.getByRole('button',{name:/^Photo, /}).click();
 await page.getByRole('button',{name:'Edit photo',exact:true}).click();
 await expect(page.getByRole('button',{name:'Save copy',exact:true})).toBeEnabled();
}
test('browser photo rotation, crop and filter save a distinct copy with unchanged original pixels',async({page},info)=>{
 const original=await seed(page);await openEditor(page);
 await page.getByRole('button',{name:'Rotate',exact:true}).click();
 await expect(page.getByRole('button',{name:'Save copy',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Crop',exact:true}).click();
 await expect(page.getByRole('button',{name:'Crop',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Mono filter',exact:true}).click();
 await expect(page.getByRole('button',{name:'Mono filter',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.screenshot({path:info.outputPath('edit-preview.png'),animations:'disabled'});
 await page.getByRole('button',{name:'Save copy',exact:true}).click();
 await expect(page.getByText('Copy saved',{exact:true})).toBeVisible();
 const result=await page.evaluate(async()=>{
  const {browserPhotoLibrary:library}=await import('/src/prototype/browser-camera.ts');const rows=(await library.list()).items;
  const copy=rows.find(row=>row.id!=='1000')!;const image=new Image();image.src=copy.image;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=copy.width;canvas.height=copy.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let colorDifference=0;for(let i=0;i<pixels.length;i+=4)colorDifference=Math.max(colorDifference,Math.abs(pixels[i]-pixels[i+1]),Math.abs(pixels[i+1]-pixels[i+2]));
  return {count:rows.length,original:await library.read({id:'1000'}),width:copy.width,height:copy.height,colorDifference};
 });
 expect(result).toMatchObject({count:2,width:92,height:185,original});expect(result.colorDifference).toBeLessThanOrEqual(3);
 await page.screenshot({path:info.outputPath('saved-copy.png'),animations:'disabled'});
});
test('lost photo-copy response and reload recover the same durable receipt without another copy',async({page})=>{
 await seed(page);await openEditor(page);
 await page.getByRole('button',{name:'Rotate',exact:true}).click();await expect(page.getByRole('button',{name:'Save copy',exact:true})).toBeEnabled();
 await page.evaluate(async()=>{const {browserPhotoLibrary:library}=await import('/src/prototype/browser-camera.ts');const save=library.saveEdit;library.saveEdit=async input=>{(window as any).savedEdit=input;await save(input);throw Error('Synthetic lost reply after commit');};});
 await page.getByRole('button',{name:'Save copy',exact:true}).click();
 await expect(page.getByText('Copy saved',{exact:true})).toBeVisible();
 const request=await page.evaluate(()=>(window as any).savedEdit);
 await page.evaluate(async id=>(await import('/src/runtime/media-copy-intent.ts')).admitMediaCopyIntent(id),request.sessionId);
 await page.reload();await page.getByRole('button',{name:'Photos',exact:true}).click();
 await expect.poll(()=>page.evaluate(async()=>(await import('/src/runtime/media-copy-intent.ts')).readMediaCopyIntent())).toBe(null);
 const result=await page.evaluate(async request=>{
  const {browserPhotoLibrary:library}=await import('/src/prototype/browser-camera.ts');
  const first=await library.editResult({operationId:request.sessionId}),repeated=await library.saveEdit(request);
  let changedRejected=false;try{await library.saveEdit({...request,rotation:180});}catch{changedRejected=true;}
  return {first,repeated,changedRejected,count:(await library.list()).items.length};
 },request);
 expect(result.first.status).toBe('saved');expect(result.first).toEqual(result.repeated);expect(result.changedRejected).toBe(true);expect(result.count).toBe(2);
});
test('recovery retires a suspended photo save before it can commit in another tab',async({page,context})=>{
 const original=await seed(page);
 const operationId=await page.evaluate(async()=>{
  const {browserPhotoLibrary:library}=await import('/src/prototype/browser-camera.ts');const edit=await library.beginEdit({id:'1000',revision:'original-metadata'});
  const decode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=async function(){await decode.call(this);await new Promise<void>(resolve=>{(window as any).releaseDecode=()=>{HTMLImageElement.prototype.decode=decode;resolve();};});};
  (window as any).saveFinished=library.saveEdit({sessionId:edit.sessionId,rotation:90,crop:false,filter:'none'});return edit.operationId;
 });
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseDecode)).toBe('function');
 const other=await context.newPage();await other.goto('/');
 const retired=await other.evaluate(async operationId=>{const {browserPhotoLibrary:library}=await import('/src/prototype/browser-camera.ts');return library.editResult({operationId});},operationId);
 expect(retired.status).toBe('not-started');
 await page.evaluate(()=>(window as any).releaseDecode());
 const result=await page.evaluate(async()=>{const {browserPhotoLibrary:library}=await import('/src/prototype/browser-camera.ts');return {receipt:await (window as any).saveFinished,rows:(await library.list()).items};});
 expect(result.receipt.status).toBe('not-started');expect(result.rows).toEqual([original]);await other.close();
});
test('unchanged edits create no copy; bounded previews and source revision checks reject stale saves',async({page})=>{
 const original=await seed(page,2560,1280);
 const result=await page.evaluate(async()=>{
  const {browserPhotoLibrary:library}=await import('/src/prototype/browser-camera.ts');
  const first=await library.beginEdit({id:'1000',revision:'original-metadata'});
  const unchanged=await library.saveEdit({sessionId:first.sessionId,rotation:0,crop:false,filter:'none'});await library.cancelEdit({sessionId:first.sessionId});
  const next=await library.beginEdit({id:'1000',revision:'original-metadata'});
  await library.setFavorite({id:'1000',revision:'original-metadata',favorite:true});
  const stale=await library.saveEdit({sessionId:next.sessionId,rotation:90,crop:false,filter:'none'});
  return {width:first.width,height:first.height,reduced:first.reduced,unchanged,stale,rows:(await library.list()).items};
 });
 expect(result).toMatchObject({width:2048,height:1024,reduced:true,unchanged:{status:'unchanged'},stale:{status:'failed'}});
 expect(result.rows).toHaveLength(1);expect(result.rows[0].image).toBe(original.image);
});

test('copy and receipt roll back together when the commit is interrupted',async({page})=>{
 const original=await seed(page);
 const result=await page.evaluate(async()=>{
  const {browserPhotoLibrary:library}=await import('/src/prototype/browser-camera.ts');
  const edit=await library.beginEdit({id:'1000',revision:'original-metadata'}),put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,key){if(value.kind==='edit-receipt'&&value.status==='saved'){this.transaction.abort();return undefined as any;}return put.call(this,value,key);};
  let rejected=false;try{await library.saveEdit({sessionId:edit.sessionId,rotation:90,crop:false,filter:'none'});}catch{rejected=true;}finally{IDBObjectStore.prototype.put=put;}
  return {rejected,receipt:await library.editResult({operationId:edit.operationId}),rows:(await library.list()).items};
 });
 expect(result.rejected).toBe(true);expect(result.receipt.status).toBe('failed');expect(result.rows).toEqual([original]);
});

test('preview and save capture transform parameters before asynchronous work',async({page})=>{
 await seed(page);
 const result=await page.evaluate(async()=>{
  const {browserPhotoLibrary:library}=await import('/src/prototype/browser-camera.ts');
  const edit=await library.beginEdit({id:'1000',revision:'original-metadata'});
  const previewInput={sessionId:edit.sessionId,rotation:90,crop:false,filter:'none'};
  const previewWork=library.previewEdit(previewInput);previewInput.rotation=180;
  const preview=await previewWork;
  const saveInput={sessionId:edit.sessionId,rotation:90,crop:false,filter:'none'};
  const saveWork=library.saveEdit(saveInput);saveInput.rotation=180;
  const saved=await saveWork,copy=await library.read({id:saved.id!});
  return {preview:[preview.width,preview.height],copy:[copy.width,copy.height]};
 });
 expect(result).toEqual({preview:[120,240],copy:[120,240]});
});
for(const mode of ['failed','cancelled'])test(`photo copy waits for durable request admission: ${mode}`,async({page})=>{
 await seed(page);await openEditor(page);
 await page.evaluate(async mode=>{
  const {browserPhotoLibrary:library}=await import('/src/prototype/browser-camera.ts'),{browserDocuments}=await import('/src/browser/documents.ts');const save=library.saveEdit,edit=browserDocuments.edit;(window as any).copyDispatches=0;
  library.saveEdit=async input=>{(window as any).copyDispatches++;return save(input);};
  browserDocuments.edit=async function(key,fn,signal){if(key!=='alpha.photos.pending-copy.v1')return edit.call(this,key,fn,signal);browserDocuments.edit=edit;if(mode==='failed')throw Error('Synthetic admission refused');const result=await edit.call(this,key,fn,signal);await new Promise<void>(resolve=>(window as any).releaseCopyAdmission=resolve);return result;};
 },mode);
 await page.getByRole('button',{name:'Save copy',exact:true}).click();
 if(mode==='cancelled'){await expect.poll(()=>page.evaluate(()=>typeof(window as any).releaseCopyAdmission)).toBe('function');await page.getByRole('button',{name:'Cancel edit',exact:true}).click();await page.evaluate(()=>(window as any).releaseCopyAdmission());}
 else await expect(page.getByText('Copy request could not be retained. Check saved-copy recovery before another save.',{exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(async()=>(await import('/src/runtime/media-copy-intent.ts')).readMediaCopyIntent())).toBeNull();expect(await page.evaluate(()=>(window as any).copyDispatches)).toBe(0);expect(await page.evaluate(async()=>(await(await import('/src/prototype/browser-camera.ts')).browserPhotoLibrary.list()).items.length)).toBe(1);
});
test('a late pending-request read cannot open an editor after Home',async({page})=>{
 await seed(page);await page.getByRole('button',{name:'Photos',exact:true}).click();await page.getByRole('button',{name:/^Photo, /}).click();
 await page.evaluate(async()=>{const {browserDocuments}=await import('/src/browser/documents.ts'),read=browserDocuments.read;browserDocuments.read=async function(key,signal){if(key==='alpha.photos.pending-copy.v1'){browserDocuments.read=read;const result=await read.call(this,key,signal);await new Promise<void>(resolve=>(window as any).releaseCopyRead=resolve);return result;}return read.call(this,key,signal);};});
 await page.getByRole('button',{name:'Edit photo',exact:true}).click();await expect.poll(()=>page.evaluate(()=>typeof(window as any).releaseCopyRead)).toBe('function');await returnToApps(page);await page.evaluate(()=>(window as any).releaseCopyRead());await expect(page.getByRole('button',{name:'Save copy',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Photos',exact:true}).click();await expect(page.getByRole('button',{name:'Save copy',exact:true})).toHaveCount(0);
});
test('Replace overwrites the original in place: same id and date, new revisions, no copy',async({page})=>{
 const original=await seed(page);await openEditor(page);
 await expect(page.getByRole('button',{name:'Replace original',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Rotate',exact:true}).click();
 await expect(page.getByRole('button',{name:'Replace original',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Replace original',exact:true}).click();
 await expect(page.getByText('Saved',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Edit photo',exact:true})).toBeVisible();
 const result=await page.evaluate(async()=>{const {browserPhotoLibrary:library}=await import('/src/prototype/browser-camera.ts');const rows=(await library.list()).items;return {ids:rows.map(row=>row.id),row:await library.read({id:'1000'})};});
 expect(result.ids).toEqual(['1000']);
 expect(result.row.date).toBe(original.date);
 expect([result.row.width,result.row.height]).toEqual([original.height,original.width]);
 expect(result.row.revision).not.toBe(original.revision);expect(result.row.mutationRevision).not.toBe(original.mutationRevision);
 // A save that names the old revision can no longer apply (the reviewed revision is gone).
 const stale=await page.evaluate(async()=>{const {browserPhotoLibrary:library}=await import('/src/prototype/browser-camera.ts');try{await library.beginEdit({id:'1000',revision:'original-metadata'});return 'opened';}catch(error){return String((error as Error).message);}});
 expect(stale).toMatch(/changed/);
});
