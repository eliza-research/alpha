import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.route('**/photo-seed',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Seed old photo storage</title>'}));
 await page.goto('/photo-seed');
 // A real version-1 database must upgrade without discarding media or edit receipts.
 await page.evaluate(async()=>{
  await new Promise<void>((resolve,reject)=>{const r=indexedDB.open('alpha.browser.photos.v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('photos',{keyPath:'id'});r.onerror=()=>reject(r.error);r.onsuccess=()=>{
   const db=r.result,tx=db.transaction('photos','readwrite'),store=tx.objectStore('photos');
   for(let i=0;i<125;i++)store.add({id:(i%2?'v:':'')+String(i).padStart(4,'0'),kind:i%2?'video':'image',date:1700000000000+Math.floor(i/3),image:'data:image/jpeg;base64,',path:i%2?'data:video/webm;base64,':undefined,width:1,height:1,revision:'pixels',mutationRevision:'r'+i,favorite:i%2===0,trashed:i>=120});
   store.add({id:'edit:receipt',kind:'edit-receipt',status:'saved'});
   tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);
  };});
 });await page.goto('/');
});

test('migrated mixed media pages use capture date and stable identity ties without gaps or duplicates',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {browserPhotoLibrary:p}=await import('/src/prototype/browser-camera.ts');const items:any[]=[];const sizes:number[]=[];let before='';
  do{const page=await p.list({before});items.push(...page.items);sizes.push(page.items.length);before=page.next;}while(before);
  return {ids:items.map(i=>i.id),sizes,summary:await p.summary()};
 });
 const expected=Array.from({length:120},(_,i)=>({id:(i%2?'v:':'')+String(i).padStart(4,'0'),date:Math.floor(i/3)})).sort((a,b)=>b.date-a.date||(a.id<b.id?1:-1)).map(i=>i.id);
 expect(result.ids).toEqual(expected);expect(result.sizes).toEqual([40,40,40]);expect(new Set(result.ids).size).toBe(120);expect(result.summary).toMatchObject({favorites:60,videos:60,trash:5});
 await page.getByRole('button',{name:'Photos',exact:true}).click();
 const tiles=page.locator('button[data-owned-media-id^="native-camera-"]');
 const shown=()=>tiles.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-owned-media-id')!.replace('native-camera-','')));
 // One day section; its header counts what is loaded. The grid is virtualised: only on-screen rows are in the DOM.
 const count=page.locator('.photo-day-header span');await expect(count).toHaveText('40');
 const first=await shown();expect(first).toEqual(expected.slice(0,first.length));
 // Newest-first paging continues as the end of the grid scrolls into view; there is no Load more button.
 const grid=page.locator('[data-alpha-app-scroll="photos"]');
 await grid.evaluate(el=>el.scrollTo(0,el.scrollHeight));await expect(count).toHaveText('80');
 await grid.evaluate(el=>el.scrollTo(0,el.scrollHeight));await expect(count).toHaveText('120');
 await grid.evaluate(el=>el.scrollTo(0,el.scrollHeight));
 await expect.poll(async()=>(await shown()).at(-1)).toBe(expected.at(-1));
 const last=await shown();expect(last.length).toBeLessThan(60);expect(last).toEqual(expected.slice(expected.length-last.length));
 await expect(page.getByRole('button',{name:/Load more/})).toHaveCount(0);
 await page.reload();expect(await page.evaluate(async()=>{const {browserPhotoLibrary:p}=await import('/src/prototype/browser-camera.ts');return (await p.list()).items[0].id;})).toBe(expected[0]);
});

test('page boundary survives deletion and newer captures without repeating or skipping remaining media',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {browserPhotoLibrary:p}=await import('/src/prototype/browser-camera.ts');const first=await p.list(),expected=await p.list({before:first.next}),boundary=first.items.at(-1)!;
  await p.setTrashed({id:boundary.id,revision:boundary.mutationRevision,trashed:true});await p.deletePreparedTrash(await p.prepareDeleteTrash({all:true}));
  await new Promise<void>((resolve,reject)=>{const r=indexedDB.open('alpha.browser.photos.v1');r.onsuccess=()=>{const db=r.result,tx=db.transaction('photos','readwrite');tx.objectStore('photos').put({...first.items[0],id:'new-photo',kind:'image',date:Date.now()});tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};r.onerror=()=>reject(r.error);});
  const actual=await p.list({before:first.next});let rejected=false;try{await p.list({before:'date:[null,"x"]'});}catch{rejected=true;}
  return {expected:expected.items.map(i=>i.id),actual:actual.items.map(i=>i.id),rejected};
 });expect(result.actual).toEqual(result.expected);expect(result.rejected).toBe(true);
});

test('favorites, videos, trash and custom albums paginate within their filters',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {browserPhotoLibrary:p}=await import('/src/prototype/browser-camera.ts');const first=await p.list();const album=await p.changeAlbum({operation:'create',name:'Chosen',mediaId:first.items[0].id,mediaRevision:first.items[0].mutationRevision});
  const counts:number[]=[],valid:boolean[]=[];
  for(const options of [{album:'favorites'},{album:'videos'},{trashed:true},{album:'custom:'+album.id}]){let before='';const items:any[]=[];do{const page=await p.list({...options,before});items.push(...page.items);before=page.next;}while(before);counts.push(items.length);valid.push(items.every(i=>options.trashed?i.trashed:!i.trashed&&(options.album==='favorites'?i.favorite:options.album==='videos'?i.kind==='video':i.id===first.items[0].id)));}
  return {counts,valid};
 });expect(result).toEqual({counts:[60,60,5,1],valid:[true,true,true,true]});
});
