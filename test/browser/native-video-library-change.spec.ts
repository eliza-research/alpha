import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {photosBridge} from './helpers/photos-bridge';
// Real renderer/native-bridge contract with an explicitly held native Save.
// This fixture does not qualify Android MediaStore or provider publication.
async function openPendingVideoCopy(page:Page){
 const clip=await readFile(new URL('../../android/video-fixture/src/main/assets/qa-source.mp4',import.meta.url));
 await page.route('**/qa-video-source.mp4',route=>route.fulfill({status:200,contentType:'video/mp4',body:clip}));
 await photosBridge(page,'full',false);
 await page.evaluate(()=>{
  const w=window as any,f=w.mediaFixture,cap=w.Capacitor,original=cap.nativePromise;
  Object.assign(f.row,{id:'m:external_primary:v:91',name:'Synthetic video.mp4',kind:'video',duration:4,width:320,height:240,path:location.origin+'/qa-video-source.mp4',favorite:false});
  f.operation='video-11111111-1111-4111-8111-111111111111';f.copyCount=0;f.cancelCount=0;f.saveCount=0;f.deleted=false;
  f.checkReleases=[];f.releaseChecks=()=>{f.holdChecks=false;for(const release of f.checkReleases.splice(0))release();};
  cap.nativePromise=async(plugin:string,method:string,input:any)=>{
   if(plugin==='AlphaPhotos'&&f.holdChecks&&(f.checkRequests||0)<2&&(method==='libraryAccess'||method==='read'&&input.id===f.row.id)){f.checkRequests=(f.checkRequests||0)+1;await new Promise<void>(resolve=>f.checkReleases.push(resolve));}
   if(plugin==='AlphaPhotos'&&(method==='listPermitted'||method==='list'&&!input?.trashed&&!input?.album)){const result=await original(plugin,method,input);if(f.copy&&f.scope!=='denied')result.items.push(f.copy);return result;}
   if(plugin==='AlphaPhotos'&&['beginVideoEdit','saveVideoEdit','cancelVideoEdit','editResult','read'].includes(method)){
    f.calls.push({plugin,method,input});
    if(method==='read'){if(f.scope==='denied'||f.deleted)throw Error('Source unavailable');return input.id==='v:92'?f.copy:f.row;}
    if(method==='beginVideoEdit')return {sessionId:f.operation,operationId:f.operation,duration:4,width:320,height:240};
    if(method==='cancelVideoEdit'){f.cancelCount++;return {};}
    if(method==='editResult')return {operationId:f.operation,status:'not-started'};
    if(method==='saveVideoEdit'){
     f.saveCount++;return new Promise(resolve=>{f.complete=(saved:boolean)=>{if(saved){f.copy={...f.row,id:'v:92',name:'Synthetic edited copy.mp4',revision:'copy:1',mutationRevision:'copy:1',width:240,height:320,duration:2,date:f.row.date+60000,owned:true};f.copyCount++;}resolve({operationId:f.operation,status:saved?'saved':'not-started',...(saved?{id:'v:92'}:{})});};});
    }
   }
   return original(plugin,method,input);
  };
 });
 await page.getByRole('button',{name:'Photos',exact:true}).click();
 await page.getByRole('button',{name:/^Video, /}).click();
 await expect(page.getByRole('button',{name:'Video. Tap to show or hide controls, swipe to browse',exact:true})).toBeVisible();await page.getByRole('button',{name:'Play video',exact:true}).click();await expect(page.locator('[data-alpha-photo-frame] video')).toBeVisible();await page.getByRole('button',{name:'Pause video',exact:true}).click();await page.getByRole('button',{name:'Edit video',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Edit video',exact:true});
 await expect(dialog.getByRole('button',{name:'Save video copy',exact:true})).toBeEnabled();
 await dialog.getByRole('slider',{name:'Start seconds'}).press('ArrowRight');
 await dialog.getByRole('button',{name:'Save video copy',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).mediaFixture.saveCount)).toBe(1);
 return dialog;
}
test('own library notifications during native Save do not cancel the operation',async({page})=>{
 const dialog=await openPendingVideoCopy(page);
 await page.evaluate(()=>{const f=(window as any).mediaFixture;f.callsBeforeNotification=f.calls.length;f.emit();f.emit();});
 await expect.poll(()=>page.evaluate(()=>{const f=(window as any).mediaFixture;return f.calls.slice(f.callsBeforeNotification).filter((c:any)=>c.method==='libraryAccess').length;})).toBeGreaterThan(0);
 expect(await page.evaluate(()=>(window as any).mediaFixture.cancelCount)).toBe(0);
 await expect(dialog).toBeVisible();
 await page.evaluate(()=>(window as any).mediaFixture.complete(true));
 await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(()=>{const f=(window as any).mediaFixture;return {saves:f.saveCount,copies:f.copyCount,revision:f.row.mutationRevision};})).toEqual({saves:1,copies:1,revision:'provider:1:100:2:1:2'});
});
for(const change of ['permission revoked','source changed','source removed'])test(`native Save still invalidates when ${change}`,async({page})=>{
 const dialog=await openPendingVideoCopy(page);
 await page.evaluate(change=>{const f=(window as any).mediaFixture;if(change==='permission revoked')f.scope='denied';else if(change==='source changed')f.row.mutationRevision='provider:changed';else f.deleted=true;f.emit();},change);
 await expect.poll(()=>page.evaluate(()=>(window as any).mediaFixture.cancelCount)).toBeGreaterThan(0);
 await expect(dialog).toHaveCount(0);
 await page.evaluate(()=>(window as any).mediaFixture.complete(false));
 expect(await page.evaluate(()=>{const f=(window as any).mediaFixture;return {saves:f.saveCount,copies:f.copyCount};})).toEqual({saves:1,copies:0});
});

for(const result of ['valid','permission revoked','source changed'])test(`native receipt waits for held source validation: ${result}`,async({page})=>{
 const dialog=await openPendingVideoCopy(page);
 await page.evaluate(()=>{const f=(window as any).mediaFixture;f.holdChecks=true;f.emit();});
 await expect.poll(()=>page.evaluate(()=>(window as any).mediaFixture.checkRequests)).toBe(2);
 await page.evaluate(()=>(window as any).mediaFixture.complete(true));
 await expect(dialog).toBeVisible();
 await expect(page.getByText('Copy saved',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).mediaFixture.cancelCount)).toBe(0);
 await page.evaluate(result=>{const f=(window as any).mediaFixture;if(result==='permission revoked')f.scope='denied';if(result==='source changed')f.row.mutationRevision='provider:changed-after-receipt';f.releaseChecks();},result);
 await expect(dialog).toHaveCount(0);
 if(result==='valid')await showsCopy(page);
 else{await expect.poll(()=>page.evaluate(()=>(window as any).mediaFixture.cancelCount)).toBeGreaterThan(0);await expect(page.getByRole('button',{name:'Back from photo',exact:true})).toHaveCount(0);await expect(page.getByText('Copy saved',{exact:true})).toHaveCount(0);}
 expect(await page.evaluate(()=>(window as any).mediaFixture.saveCount)).toBe(1);
});
test('notification during receipt acknowledgement cannot expose a revoked source',async({page})=>{
 const dialog=await openPendingVideoCopy(page);
 await page.evaluate(()=>{
  const f=(window as any).mediaFixture,remove=Storage.prototype.removeItem;
  Storage.prototype.removeItem=function(key:string){remove.call(this,key);if(key==='alpha.photos.pending-copy.v1'&&!f.ackNotified){f.ackNotified=true;f.scope='denied';f.emit();}};
  f.complete(true);
 });
 await expect.poll(()=>page.evaluate(()=>(window as any).mediaFixture.ackNotified)).toBe(true);
 await expect(dialog).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Back from photo',exact:true})).toHaveCount(0);
 await expect(page.getByText('Copy saved',{exact:true})).toHaveCount(0);
});
test('late validated receipt does not replace a newer selected video',async({page})=>{
 const dialog=await openPendingVideoCopy(page);
 await page.evaluate(()=>{const f=(window as any).mediaFixture;f.holdChecks=true;f.emit();});
 await expect.poll(()=>page.evaluate(()=>(window as any).mediaFixture.checkRequests)).toBe(2);
 await page.evaluate(()=>(window as any).mediaFixture.complete(true));
 await dialog.getByRole('button',{name:'Close video editor',exact:true}).click();
 await page.getByRole('button',{name:'Back from photo',exact:true}).click();
 await page.evaluate(()=>(window as any).mediaFixture.emit());
 await expect(page.getByRole('button',{name:/^Video, /})).toHaveCount(2);
 await page.getByRole('button',{name:/^Video, /}).first().click();// newest first: the later copy leads
 await showsCopy(page);
 await page.evaluate(()=>(window as any).mediaFixture.releaseChecks());
 await expect.poll(()=>page.evaluate(()=>localStorage.getItem('alpha.photos.pending-copy.v1'))).toBe(null);
 await showsCopy(page);
 expect(await page.evaluate(()=>(window as any).mediaFixture.saveCount)).toBe(1);
});
/** The viewer shows the saved copy: its Info lists the copy's dimensions. */
async function showsCopy(page:Page){
 await page.getByRole('button',{name:'Video info',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Video info',exact:true}).getByText('240 × 320',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Close info',exact:true}).click();
}
