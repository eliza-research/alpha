import {test,expect,type Page} from '@playwright/test';
async function boot(page:Page){await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?mode=dev&tools=1');}
test('empty bookmark reads and sound polling do not invent stored data',async({page})=>{
 await boot(page);
 // The clock polls every second and reads the sound history each time. A second read means a whole
 // poll after this point has finished, including any write it would make.
 await page.evaluate(async()=>{const {alertSoundDocument:d}=await import('/src/browser/preference-documents.ts'),read=d.read,w=window as any;w.soundReads=0;(d as any).read=(...args:any[])=>(read as any)(...args).finally(()=>{w.soundReads++;});});
 await expect.poll(()=>page.evaluate(()=>(window as any).soundReads)).toBeGreaterThanOrEqual(2);
 expect(await page.evaluate(async()=>{const {BrowserSurface}=await import('/src/browser/browser-surface.ts'),{bookmarkDocument,alertSoundDocument}=await import('/src/browser/preference-documents.ts');await new BrowserSurface().bookmarks();return {bookmarks:(await bookmarkDocument.capture()).snapshot??null,sounds:(await alertSoundDocument.capture()).snapshot??null};})).toEqual({bookmarks:null,sounds:null});
});
test('concurrent bookmark writers in two tabs retain every saved address across reload',async({page,context})=>{
 await boot(page);const other=await context.newPage();await other.goto('/?mode=dev');
 await Promise.all([page,other].map((tab,index)=>tab.evaluate(async index=>{const {BrowserSurface}=await import('/src/browser/browser-surface.ts'),browser=new BrowserSurface();for(let i=0;i<10;i++)await browser.setBookmark({url:`https://example.com/${index}/${i}`,saved:true});},index)));
 await page.reload();const urls=await page.evaluate(async()=>{const {BrowserSurface}=await import('/src/browser/browser-surface.ts');return (await new BrowserSurface().bookmarks()).urls;});expect(new Set(urls).size).toBe(20);expect(await page.evaluate(()=>localStorage.getItem('alpha.browser.bookmarks.v1'))).toBeNull();
});
test('a failed bookmark commit retains the prior saved addresses',async({page})=>{
 await boot(page);expect(await page.evaluate(async()=>{const {BrowserSurface}=await import('/src/browser/browser-surface.ts'),browser=new BrowserSurface();await browser.setBookmark({url:'https://example.com/retained',saved:true});const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(key==='alpha.browser.bookmarks.v1')throw Error('Full');return put.call(this,value,key);};let rejected=false;try{await browser.setBookmark({url:'https://example.com/retained',saved:false});}catch{rejected=true;}finally{IDBObjectStore.prototype.put=put;}return {rejected,urls:(await browser.bookmarks()).urls};})).toEqual({rejected:true,urls:['https://example.com/retained']});
});
for(const domain of ['bookmarkDocument','alertSoundDocument'] as const){
 test(`${domain} preserves exact legacy bytes and refuses a changed older copy`,async({page})=>{
  await boot(page);expect(await page.evaluate(async domain=>{const documents=await import('/src/browser/preference-documents.ts'),store=documents[domain],key=domain==='bookmarkDocument'?'alpha.browser.bookmarks.v1':'alpha.browser.alert-sounds.v1',raw=domain==='bookmarkDocument'?'[ "https://example.com/old" ]':'{ "seen": [ "old" ] }';localStorage.setItem(key,raw);const imported=await store.readRaw(),before=await store.capture();localStorage.setItem(key,'{changed');let rejected=false;try{await store.readRaw();}catch{rejected=true;}const after=await store.capture();return {exact:imported===raw&&JSON.parse(before.snapshot!.raw!).legacy===raw,rejected,retained:after.raw===raw};},domain)).toEqual({exact:true,rejected:true,retained:true});
 });
 test(`${domain} stale recovery cannot erase a newer edit`,async({page})=>{
  await boot(page);expect(await page.evaluate(async domain=>{const store=(await import('/src/browser/preference-documents.ts'))[domain],before=await store.capture();await store.edit(()=>({values:[] as string[]}),data=>{data.values.push('Retained');});let rejected=false;try{await store.reset(before);}catch{rejected=true;}return {rejected,raw:await store.readRaw()};},domain)).toEqual({rejected:true,raw:'{"values":["Retained"]}'});
 });
}
test('damaged bookmarks download exact bytes before explicit reset',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));if(!sessionStorage.getItem('seeded')){localStorage.setItem('alpha.browser.bookmarks.v1','{damaged bookmarks');sessionStorage.setItem('seeded','1');}});await page.goto('/?mode=dev&tools=1');
 // Establish import completion before capturing; a later first import correctly invalidates an older capture.
 await page.evaluate(async()=>{const {bookmarkDocument}=await import('/src/browser/preference-documents.ts');await bookmarkDocument.readRaw();});
 await page.getByRole('button',{name:'Device controls',exact:true}).click();await page.getByRole('button',{name:'Bookmark recovery',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Browser bookmark recovery'});
 const pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download bookmarks backup',exact:true}).click();const stream=await (await pending).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));expect(Buffer.concat(chunks).toString()).toBe('{damaged bookmarks');
 await dialog.getByRole('button',{name:'Reset app bookmarks',exact:true}).click();await dialog.getByRole('button',{name:'Confirm bookmarks reset',exact:true}).click();await expect(dialog).toHaveCount(0);expect(await page.evaluate(async()=>{const {BrowserSurface}=await import('/src/browser/browser-surface.ts');return (await new BrowserSurface().bookmarks()).urls;})).toEqual([]);expect(await page.evaluate(()=>localStorage.getItem('alpha.browser.bookmarks.v1'))).toBe('{damaged bookmarks');
});
