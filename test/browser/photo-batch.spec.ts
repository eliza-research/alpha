import {execFileSync} from 'node:child_process';
import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/');
 await page.evaluate(async()=>{const {importBrowserPhoto}=await import('/src/prototype/browser-camera.ts');const canvas=document.createElement('canvas');canvas.width=16;canvas.height=12;for(let i=0;i<3;i++){const ctx=canvas.getContext('2d')!;ctx.fillStyle=['red','green','blue'][i];ctx.fillRect(0,0,16,12);const image=canvas.toDataURL('image/jpeg');await importBrowserPhoto({original:new File([],'source.jpg'),image,width:16,height:12},new AbortController().signal);}});
});
test('visible batch favorite, trash, undo and download journey persists exact selected items',async({page})=>{
 await page.getByRole('button',{name:'Photos',exact:true}).click();
 const tiles=page.locator('button[data-owned-media-id^="native-camera-"]');await expect(tiles).toHaveCount(3);
 const select=async()=>{await page.getByRole('button',{name:'Select photos',exact:true}).click();await tiles.nth(0).click();await tiles.nth(1).click();};
 await select();await page.getByRole('button',{name:'Favorite selected',exact:true}).click();await expect(page.getByText('Added 2 to Favorites',{exact:true})).toBeVisible();
 await select();const selectedIds=await tiles.evaluateAll(nodes=>nodes.slice(0,2).map(n=>n.getAttribute('data-owned-media-id')!.replace(/^native-camera-/,'')));const expected=await page.evaluate(async(ids)=>{const {browserPhotoLibrary:p}=await import('/src/prototype/browser-camera.ts');return Promise.all(ids.map(async id=>{const row=await p.read({id});const bytes=await (await fetch(row.image)).arrayBuffer();return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');}));},selectedIds);expect(new Set(expected).size).toBe(2);const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Share selected',exact:true}).click();await page.getByRole('dialog',{name:'Share',exact:true}).getByRole('button',{name:'Save locally',exact:true}).click();const download=await downloading;expect(download.suggestedFilename()).toBe('Alpha photos.zip');const path=await download.path();const entries=JSON.parse(execFileSync('python3',['-c','import zipfile,json,sys,hashlib; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}))',path!],{encoding:'utf8'}));expect(entries).toEqual({'Alpha-photo-1.jpg':expected[0],'Alpha-photo-2.jpg':expected[1]});
 await page.getByRole('button',{name:'Delete selected',exact:true}).click();await expect(tiles).toHaveCount(1);await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(tiles).toHaveCount(3);
 await page.reload();const result=await page.evaluate(async()=>{const {browserPhotoLibrary:p}=await import('/src/prototype/browser-camera.ts');return {summary:await p.summary(),count:(await p.list()).items.length};});expect(result).toMatchObject({summary:{favorites:2,trash:0},count:3});
});
test('invalid and duplicate batch requests cannot restore trashed media; stale items report conflicts',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {browserPhotoLibrary:p}=await import('/src/prototype/browser-camera.ts');const rows=(await p.list()).items,items=rows.map(r=>({id:r.id,revision:r.mutationRevision}));await p.setTrashed({...items[0],trashed:true});let rejected=0;
  for(const request of [{operation:'typo',items},{operation:'restore',items:[items[1],items[1]]},{operation:'restore',items:[]},{operation:'restore',items:Array.from({length:21},(_,i)=>({id:String(i),revision:'x'}))}])try{await p.changeMany(request as any);}catch{rejected++;}
  const receipt=await p.changeMany({operation:'favorite',items});const valid=receipt.outcomes.filter(r=>r.item).map(r=>({id:r.id,revision:r.item!.mutationRevision}));const unchanged=await p.changeMany({operation:'favorite',items:valid});return {rejected,trash:(await p.summary()).trash,status:receipt.outcomes.map(r=>r.status),unchanged:unchanged.outcomes.map(r=>r.status),same:unchanged.outcomes.every((r,i)=>r.item!.mutationRevision===valid[i].revision)};
 });expect(result).toEqual({rejected:4,trash:1,status:['conflict','updated','updated'],unchanged:['unchanged','unchanged'],same:true});
});
test('a storage abort rolls back the entire batch and returns no success receipt',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {browserPhotoLibrary:p}=await import('/src/prototype/browser-camera.ts');const items=(await p.list()).items.map(r=>({id:r.id,revision:r.mutationRevision}));const original=IDBObjectStore.prototype.put;let calls=0;IDBObjectStore.prototype.put=function(...args){const request=original.apply(this,args);if(++calls===2)this.transaction.abort();return request;};let rejected=false;
  try{await p.changeMany({operation:'favorite',items});}catch{rejected=true;}finally{IDBObjectStore.prototype.put=original;}return {rejected,favorites:(await p.summary()).favorites};
 });expect(result).toEqual({rejected:true,favorites:0});
});
test('a stale share selection requests no downloads, including its valid items',async({page})=>{
 const downloads:string[]=[];page.on('download',download=>downloads.push(download.suggestedFilename()));
 const rejected=await page.evaluate(async()=>{const {browserPhotoLibrary:p}=await import('/src/prototype/browser-camera.ts');const items=(await p.list()).items.map(r=>({id:r.id,revision:r.mutationRevision}));await p.setFavorite({...items[1],favorite:true});try{await p.shareMany({items},()=>true);return false;}catch{return true;}});expect(rejected).toBe(true);expect(downloads).toEqual([]);
});
test('batch controls remain reachable above the assistant pill in compact light and dark layouts',async({page},info)=>{
 await page.setViewportSize({width:360,height:640});
 for(const theme of ['light','dark']){
  await page.goto('/?theme='+theme);await page.getByRole('button',{name:'Photos',exact:true}).click();await page.getByRole('button',{name:'Select photos',exact:true}).click();await page.locator('button[data-owned-media-id^="native-camera-"]').first().click();
  await page.screenshot({path:info.outputPath('batch-'+theme+'.png')});// Favorite toggles: the second theme run finds the tile already a favourite and removes it.
  await page.getByRole('button',{name:/^(Favorite|Unfavorite) selected$/}).click();await expect(page.getByText(/^(Added 1 to|Removed 1 from) Favorites$/)).toBeVisible();
 }
});

test('cancelling selection returns to the Library; Albums has no Select',async({page})=>{
 await page.getByRole('button',{name:'Photos',exact:true}).click();
 await page.getByRole('button',{name:'Albums',exact:true}).click();
 await expect(page.getByRole('button',{name:'Albums',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('button',{name:'Select photos',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Library',exact:true}).click();
 await page.getByRole('button',{name:'Select photos',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Select items',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Select all',exact:true}).click();
 await expect(page.getByRole('heading',{name:'3 selected',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Deselect all',exact:true}).click();
 await page.getByRole('button',{name:'Cancel selection',exact:true}).click();
 await expect(page.getByRole('button',{name:'Library',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(async()=>{
  const {browserPhotoLibrary}=await import('/src/prototype/browser-camera.ts');
  return {count:(await browserPhotoLibrary.list()).items.length,trash:(await browserPhotoLibrary.summary()).trash};
 })).toEqual({count:3,trash:0});
});

for(const batch of [false,true])for(const outcome of ['supported','unavailable','cancelled'])test(`media external sharing is separate from saving: ${batch?'batch':'single'} ${outcome}`,async({page})=>{
 const downloads:string[]=[];page.on('download',download=>downloads.push(download.suggestedFilename()));
 await page.evaluate(outcome=>{
  const w=window as any;w.sharedMedia=[];
  Object.defineProperty(navigator,'canShare',{configurable:true,value:(data:ShareData)=>outcome!=='unavailable'&&!!data.files?.length});
  Object.defineProperty(navigator,'share',{configurable:true,value:async(data:ShareData)=>{w.sharedMedia.push(data.files?.map(file=>({name:file.name,type:file.type,size:file.size})));if(outcome==='cancelled')throw new DOMException('Cancelled','AbortError');}});
 },outcome);
 await page.getByRole('button',{name:'Photos',exact:true}).click();
 const tiles=page.locator('button[data-owned-media-id^="native-camera-"]');await expect(tiles).toHaveCount(3);
 if(batch){await page.getByRole('button',{name:'Select photos',exact:true}).click();await tiles.nth(0).click();await tiles.nth(1).click();}else await tiles.first().click();
 const share=page.getByRole('button',{name:batch?'Share selected':'Share photo',exact:true});
 await share.click();const panel=page.getByRole('dialog',{name:'Share',exact:true});
 await expect(panel.getByRole('button',{name:'Share to email',exact:true})).toBeVisible();
 await expect(panel.getByRole('button',{name:'Save locally',exact:true})).toBeVisible();
 await panel.getByRole('button',{name:'Share externally',exact:true}).click();
 if(outcome==='unavailable')await expect(page.getByText('Sharing is unavailable in this browser. Use Save locally.',{exact:true})).toBeVisible();
 else await expect.poll(()=>page.evaluate(()=>(window as any).sharedMedia.length)).toBe(1);
 const shared=await page.evaluate(()=>(window as any).sharedMedia);
 if(outcome==='unavailable')expect(shared).toEqual([]);else{expect(shared[0]).toHaveLength(batch?2:1);for(const file of shared[0]){expect(file.type).toBe('image/jpeg');expect(file.size).toBeGreaterThan(0);}}
 expect(downloads).toEqual([]);
 await share.click();const saving=page.waitForEvent('download');await page.getByRole('dialog',{name:'Share',exact:true}).getByRole('button',{name:'Save locally',exact:true}).click();
 expect((await saving).suggestedFilename()).toMatch(batch?/^Alpha photos\.zip$/:/^Alpha-photo-\d+\.jpg$/);
 expect(downloads).toHaveLength(1);
});

for(const destination of ['share','save'])test(`media ${destination} rechecks revisions after asynchronous blob preparation`,async({page})=>{
 const downloads:string[]=[];page.on('download',download=>downloads.push(download.suggestedFilename()));
 const result=await page.evaluate(async destination=>{
  const {browserPhotoLibrary:p,saveBrowserMedia}=await import('/src/prototype/browser-camera.ts');
  const items=(await p.list()).items.slice(0,2).map(row=>({id:row.id,revision:row.mutationRevision}));
  const original=window.fetch;let release!:()=>void,started!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),reading=new Promise<void>(resolve=>started=resolve);let calls=0;
  Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{calls++;}});
  window.fetch=async(...args)=>{if(typeof args[0]==='string'&&args[0].startsWith('data:image/')){started();await gate;}return original(...args);};
  try{const pending=destination==='share'?p.shareMany({items},()=>true):saveBrowserMedia({items},()=>true);await reading;await p.setFavorite({...items[0],favorite:true});release();let refused=false;try{await pending;}catch{refused=true;}return {refused,calls};}finally{release();window.fetch=original;}
 },destination);
 expect(result).toEqual({refused:true,calls:0});expect(downloads).toEqual([]);
});

for(const destination of ['share','save'])for(const retirement of ['back','home-return','hidden-return'])test(`pending media ${destination} is retired by ${retirement} without changing the media revision`,async({page})=>{
 const downloads:string[]=[];page.on('download',download=>downloads.push(download.suggestedFilename()));
 await page.evaluate(()=>{
  const w=window as any;w.mediaHandoffCalls=0;w.mediaReadStarted=false;const original=window.fetch;let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);w.releaseMediaRead=release;w.restoreMediaFetch=()=>{window.fetch=original;};
  Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{w.mediaHandoffCalls++;}});
  window.fetch=async(...args)=>{if(typeof args[0]==='string'&&args[0].startsWith('data:image/')){w.mediaReadStarted=true;await gate;}return original(...args);};
 });
 await page.getByRole('button',{name:'Photos',exact:true}).click();await page.locator('button[data-owned-media-id^="native-camera-"]').first().click();
 const before=await page.evaluate(async()=>{const p=(await import('/src/prototype/browser-camera.ts')).browserPhotoLibrary;return (await p.list()).items.map(row=>[row.id,row.mutationRevision]);});
 await page.getByRole('button',{name:'Share photo',exact:true}).click();await page.getByRole('dialog',{name:'Share',exact:true}).getByRole('button',{name:destination==='share'?'Share externally':'Save locally',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).mediaReadStarted)).toBe(true);
 if(retirement==='hidden-return')await page.evaluate(()=>{let hidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});document.dispatchEvent(new Event('visibilitychange'));hidden=false;document.dispatchEvent(new Event('visibilitychange'));});
 else{await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));await expect(page.getByRole('button',{name:'Share photo',exact:true})).toHaveCount(0);if(retirement==='home-return'){await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));await page.getByRole('button',{name:'Photos',exact:true}).click();await page.locator('button[data-owned-media-id^="native-camera-"]').first().click();}}
 await page.evaluate(()=>{(window as any).releaseMediaRead();});
 await expect.poll(()=>page.evaluate(async()=>{const p=(await import('/src/prototype/browser-camera.ts')).browserPhotoLibrary;return (await p.list()).items.map(row=>[row.id,row.mutationRevision]);})).toEqual(before);
 await page.waitForTimeout(300);
 expect(await page.evaluate(()=>(window as any).mediaHandoffCalls)).toBe(0);expect(downloads).toEqual([]);
 await page.evaluate(()=>{(window as any).restoreMediaFetch();});
});
