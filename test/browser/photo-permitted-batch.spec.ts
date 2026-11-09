import {openPhotoTools} from './helpers/owned-photo';
import {test,expect,type Page} from '@playwright/test';
import {photosBridge} from './helpers/photos-bridge';

// Renderer + real shared batching contract with a synthetic native transport.
// This does not establish Android consent, MediaStore writes or device acceptance.
async function selection(page:Page,count:number,declineAt=0,holdFirst=false,unknownAt=0){
 await photosBridge(page,'full',false);
 await page.evaluate(async({count,declineAt,holdFirst,unknownAt})=>{
  const w=window as any,f=w.mediaFixture,cap=w.Capacitor,original=cap.nativePromise;
  cap.PluginHeaders.find((p:any)=>p.name==='AlphaPhotos').methods.push({name:'changeMany',rtype:'promise'});
  const now=Date.now(),rows=Array.from({length:count},(_,i)=>({...f.row,id:`m:external_primary:i:${i+1}`,date:now-i,revision:`revision:${i+1}`,mutationRevision:`revision:${i+1}`,favorite:false}));
  f.batchCalls=[];
  if(holdFirst||unknownAt){
   const {Component}=await import('/src/prototype/model.js');
   const render=Component.prototype.renderVals;Component.prototype.renderVals=function(){f.shell=this;return render.call(this);};
   if(unknownAt){f.toasts=[];const toast=Component.prototype.toast;Component.prototype.toast=function(message:string,...args:any[]){f.toasts.push(message);return toast.call(this,message,...args);};}
  }
  cap.nativePromise=async(plugin:string,method:string,input:any)=>{
   if(plugin==='AlphaPhotos'){
    if(method==='list')return {items:f.scope==='denied'||input?.trashed?[]:rows,next:''};
    if(method==='changeMany'){
     f.batchCalls.push(input);
     if(f.batchCalls.length===unknownAt)throw new Error('Outcome unknown');
     if(f.batchCalls.length===declineAt)throw Object.assign(new Error('Cancelled'),{code:'LIBRARY_DECLINED'});
     if(holdFirst&&f.batchCalls.length===1)await new Promise<void>(resolve=>{f.release=resolve;});
     return {status:'complete',outcomes:input.items.map((item:any)=>({id:item.id,status:'updated',item:{...rows.find(row=>row.id===item.id),favorite:true}}))};
    }
   }
   return original(plugin,method,input);
  };
 },{count,declineAt,holdFirst,unknownAt});
 await page.getByRole('button',{name:'Photos',exact:true}).click();
 await openPhotoTools(page);await page.getByRole('button',{name:'Select photos',exact:true}).click();
 await page.getByRole('button',{name:'Select all',exact:true}).click();
 await page.getByRole('button',{name:'Favorite selected',exact:true}).click();
}
for(const [count,sizes] of [[500,[500]],[501,[500,1]],[1001,[500,500,1]]] as const){
 test(`${count} permitted items use reviewed batches of ${sizes.join(',')}`,async({page})=>{
  await selection(page,count);
  await expect(page.getByText(`Added ${count} to Favorites`,{exact:true})).toBeVisible();
  const calls=await page.evaluate(()=>(window as any).mediaFixture.batchCalls);
  expect(calls.map((call:any)=>call.items.length)).toEqual(sizes);
  expect(calls.flatMap((call:any)=>call.items)).toEqual(Array.from({length:count},(_,i)=>({id:`m:external_primary:i:${i+1}`,revision:`revision:${i+1}`})));
 });
}
for(const declineAt of [1,2])test(`declining permitted batch ${declineAt} dispatches no later confirmation`,async({page})=>{
 await selection(page,1001,declineAt);
 await openPhotoTools(page);await expect(page.getByRole('button',{name:'Select photos',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>(window as any).mediaFixture.batchCalls.map((call:any)=>call.items.length))).toEqual(declineAt===1?[500]:[500,500]);
});
test('leaving Photos during a reviewed batch stops later requests and stale publication',async({page})=>{
 await selection(page,1001,0,true);
 await expect.poll(()=>page.evaluate(()=>(window as any).mediaFixture.batchCalls.length)).toBe(1);
 await page.evaluate(()=>(window as any).mediaFixture.shell.goHome());
 await page.evaluate(()=>(window as any).mediaFixture.release());
 await page.getByRole('button',{name:'Photos',exact:true}).click();
 await openPhotoTools(page);await expect(page.getByRole('button',{name:'Select photos',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>(window as any).mediaFixture.batchCalls.length)).toBe(1);
 await expect(page.getByText(/Added .* to Favorites/)).toHaveCount(0);
});

for(const count of [500,1001])test(`an unknown batch result among ${count} items reports uncertainty and is not replayed`,async({page})=>{
 await selection(page,count,0,false,1);
 await openPhotoTools(page);await expect(page.getByRole('button',{name:'Select photos',exact:true})).toBeEnabled();
 await expect(page.getByText(count===500?"Couldn't confirm the change.":'Added 501 to Favorites · 500 not confirmed',{exact:true})).toBeVisible();
 await expect(page.getByText(/Added 0 to Favorites|Nothing changed\. Try again\.|not changed/)).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).mediaFixture.toasts)).toEqual([count===500?"Couldn't confirm the change.":'Added 501 to Favorites · 500 not confirmed']);
 const calls=await page.evaluate(()=>(window as any).mediaFixture.batchCalls);
 expect(calls.map((call:any)=>call.items.length)).toEqual(count===500?[500]:[500,500,1]);
 expect(new Set(calls.flatMap((call:any)=>call.items.map((item:any)=>item.id))).size).toBe(count);
});
test('permission retirement during a reviewed batch stops later requests',async({page})=>{
 await selection(page,1001,0,true);
 await expect.poll(()=>page.evaluate(()=>(window as any).mediaFixture.batchCalls.length)).toBe(1);
 await page.evaluate(()=>{const f=(window as any).mediaFixture;f.scope='denied';f.emit();});
 await expect(page.getByText('No photos',{exact:true})).toBeVisible();
 await page.evaluate(()=>(window as any).mediaFixture.release());
 await expect(page.getByRole('button',{name:'Select all',exact:true})).toBeEnabled();
 await expect(page.getByText(/Added .* to Favorites/)).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).mediaFixture.batchCalls.length)).toBe(1);
});
