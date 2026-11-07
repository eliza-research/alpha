import {test,expect,type Page} from '@playwright/test';
import {execFileSync} from 'node:child_process';
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?mode=dev');});
// Files browser (PLAN section 4): select mode from the folder menu; Delete moves to Trash; only a confirmed Empty deletes.
async function openStorage(page:Page){await page.getByRole('button',{name:'Files',exact:true}).click();await page.getByRole('button',{name:'Internal storage',exact:true}).click();}
async function startSelect(page:Page){await page.getByRole('button',{name:'Sort and more',exact:true}).click();await page.getByRole('button',{name:'Select',exact:true}).click();}
const zipJson=(path:string)=>JSON.parse(execFileSync('python3',['-c','import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({n:z.read(n).decode() for n in z.namelist()}))',path],{encoding:'utf8'}));
test('select, move together into a folder, delete to Trash, restore, and Empty only after confirming',async({page})=>{
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const f=registerPlugin<any>('AlphaFiles');await f.importFile(new File(['Café\n'],'one.txt',{type:'text/plain'}));await f.importFile(new File(['two'],'two.txt',{type:'text/plain'}));await f.createFolder({id:'root',name:'Destination'});});
 await openStorage(page);await startSelect(page);
 for(const name of ['one.txt','two.txt'])await page.getByRole('button',{name:'Select '+name,exact:true}).click();
 await expect(page.getByText('2 selected',{exact:true})).toBeVisible();
 await page.getByRole('toolbar',{name:'Selection actions'}).getByRole('button',{name:'Move',exact:true}).click();
 const move=page.getByRole('dialog',{name:'Move to',exact:true});await move.getByRole('button',{name:'Open Destination',exact:true}).click();await move.getByRole('button',{name:'Move here',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open one.txt',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Open Destination',exact:true}).click();await expect(page.getByRole('button',{name:'Open one.txt',exact:true})).toBeVisible();
 await expect(page.getByRole('navigation',{name:'Folder path'})).toContainText('Destination');
 await startSelect(page);await page.getByRole('button',{name:'Select all',exact:true}).click();await page.getByRole('toolbar',{name:'Selection actions'}).getByRole('button',{name:'Delete',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open one.txt',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('button',{name:'Trash',exact:true}).click();
 await page.getByRole('button',{name:'one.txt',exact:true}).click();await page.getByRole('dialog',{name:'one.txt',exact:true}).getByRole('button',{name:'Restore',exact:true}).click();
 await expect(page.getByRole('button',{name:'one.txt',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Empty',exact:true}).click();const empty=page.getByRole('dialog',{name:'Empty Trash?',exact:true});await expect(empty).toContainText('1 item');
 await empty.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('button',{name:'two.txt',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Empty',exact:true}).click();await page.getByRole('dialog',{name:'Empty Trash?',exact:true}).getByRole('button',{name:'Empty',exact:true}).click();await expect(page.getByRole('button',{name:'two.txt',exact:true})).toHaveCount(0);
 await page.reload();expect(await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const f=registerPlugin<any>('AlphaFiles');const all=await f.storageList({path:'Destination'});return all.entries.map((e:any)=>e.name);})).toEqual(['one.txt']);
});
test('a move into a folder that already has the name keeps both files',async({page})=>{
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const f=registerPlugin<any>('AlphaFiles');await f.importFile(new File(['outer'],'a.txt',{type:'text/plain'}));await f.storageCreateFolder({parent:'',name:'Target'});const target=(await f.list({})).entries.find((r:any)=>r.name==='Target');await f.importFile(new File(['inner'],'a.txt',{type:'text/plain'}),target.id);});
 await openStorage(page);await startSelect(page);await page.getByRole('button',{name:'Select a.txt',exact:true}).click();await page.getByRole('toolbar',{name:'Selection actions'}).getByRole('button',{name:'Move',exact:true}).click();
 const move=page.getByRole('dialog',{name:'Move to',exact:true});await move.getByRole('button',{name:'Open Target',exact:true}).click();await move.getByRole('button',{name:'Move here',exact:true}).click();
 await page.getByRole('button',{name:'Open Target',exact:true}).click();
 for(const name of ['a.txt','a (1).txt'])await expect(page.getByRole('button',{name:'Open '+name,exact:true})).toBeVisible();
});
test('a file another Alpha flow saves appears in the open folder without reopening it',async({page})=>{
 await openStorage(page);
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaFiles').importFile(new File(['late'],'late.txt',{type:'text/plain'}));});
 await expect(page.getByRole('button',{name:'Open late.txt',exact:true})).toBeVisible();
});
test('stale revisions, collisions and nonempty folders roll back the entire batch',async({page})=>{
 const result=await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const f=registerPlugin<any>('AlphaFiles');await f.importFile(new File(['a'],'a.txt'));await f.importFile(new File(['b'],'b.txt'));await f.createFolder({id:'root',name:'Target'});let rows=(await f.list({})).entries;const target=rows.find((r:any)=>r.directory),files=rows.filter((r:any)=>!r.directory),items=files.map((r:any)=>({id:r.id,expectedRevision:r.revision}));await f.importFile(new File(['collision'],'b.txt'),target.id);const failures=[];for(const operation of [{action:'move',destinationId:target.id},{action:'delete',confirmPermanent:true,items:[items[0],{...items[1],expectedRevision:'stale'}]},{action:'delete',confirmPermanent:true,items:[items[0],{id:target.id,expectedRevision:target.revision}]}]){try{await f.changeMany({items,...operation});failures.push(false);}catch{failures.push(true);}}return {failures,names:(await f.list({})).entries.map((r:any)=>r.name).sort()};});expect(result).toEqual({failures:[true,true,true],names:['Target','a.txt','b.txt']});
});
test('explicit folder saving preserves nested Unicode paths and empty directories',async({page})=>{
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const f=registerPlugin<any>('AlphaFiles');const folder=await f.importDirectory([{path:'nested/café.txt',file:new File(['nested bytes'],'café.txt')}],'Bundle');await f.createFolder({id:folder.folder.id,name:'Empty'});});
 const downloading=page.waitForEvent('download');await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const f=registerPlugin<any>('AlphaFiles');const row=(await f.list({})).entries[0];await f.saveMany({items:[{id:row.id,expectedRevision:row.revision}]});});const path=await(await downloading).path();const contents=JSON.parse(execFileSync('python3',['-c','import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({n:z.read(n).decode() for n in z.namelist()}))',path!],{encoding:'utf8'}));expect(contents).toEqual({'Bundle/':'','Bundle/nested/':'','Bundle/nested/café.txt':'nested bytes','Bundle/Empty/':''});
});
test('normalized dot paths cannot enter Files or downloaded archives',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {BrowserFiles}=await import('/src/browser/files.ts');const f=new BrowserFiles();const rejected=[];
  for(const name of ['. ',' ..',' .. ']){try{await f.createFolder({id:'root',name});rejected.push(false);}catch{rejected.push(true);}}
  const {fileArchive}=await import('/src/browser/file-archive.ts');const archiveRejected=[];
  for(const path of ['../escape.txt','folder/../escape.txt','/absolute.txt','C:/escape.txt','folder\\escape.txt','folder//file.txt']){try{fileArchive([{path,bytes:new Uint8Array([1])}]);archiveRejected.push(false);}catch{archiveRejected.push(true);}}
  return {rejected,archiveRejected,entries:(await f.list({})).entries.length};
 });expect(result).toEqual({rejected:[true,true,true],archiveRejected:Array(6).fill(true),entries:0});
});

for(const mode of ['supported','unsupported','cancelled'])test('sharing a selection ('+mode+') never silently downloads',async({page})=>{
 const downloads:string[]=[];page.on('download',download=>downloads.push(download.suggestedFilename()));
 await page.evaluate(async(mode)=>{
  (window as any).bulkShareCalls=[];
  Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>mode!=='unsupported'});
  Object.defineProperty(navigator,'share',{configurable:true,value:async(data:ShareData)=>{(window as any).bulkShareCalls.push({files:await Promise.all((data.files||[]).map(async file=>({name:file.name,bytes:Array.from(new Uint8Array(await file.arrayBuffer()))})))});if(mode==='cancelled')throw new DOMException('User cancelled','AbortError');}});
  const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaFiles').importFile(new File(['Café\n'],'one.txt',{type:'text/plain'}));
 },mode);
 await openStorage(page);await startSelect(page);await page.getByRole('button',{name:'Select one.txt',exact:true}).click();
 await page.getByRole('toolbar',{name:'Selection actions'}).getByRole('button',{name:'Share',exact:true}).click();
 // Files' share panel has no unavailable-email row and no explanatory text.
 const panel=page.getByRole('dialog',{name:'Share',exact:true});await expect(panel.getByRole('button',{name:'Share to email',exact:true})).toHaveCount(0);await expect(panel.getByText(/unavailable/i)).toHaveCount(0);
 await panel.getByRole('button',{name:'Share externally',exact:true}).click();
 if(mode==='unsupported')await expect(page.getByText('Sharing is unavailable in this browser.',{exact:true})).toBeVisible();
 else await expect.poll(()=>page.evaluate(()=>(window as any).bulkShareCalls.length)).toBe(1);
 expect(downloads).toEqual([]);await expect(page.getByRole('button',{name:'Deselect one.txt',exact:true})).toBeVisible();
 const calls=await page.evaluate(()=>(window as any).bulkShareCalls);expect(calls.length).toBe(mode==='unsupported'?0:1);
 if(calls.length){expect(calls[0].files).toHaveLength(1);const content=JSON.parse(execFileSync('python3',['-c','import io,zipfile,json,sys; z=zipfile.ZipFile(io.BytesIO(bytes(json.loads(sys.argv[1])))); assert z.testzip() is None; print(json.dumps({n:z.read(n).decode() for n in z.namelist()}))',JSON.stringify(calls[0].files[0].bytes)],{encoding:'utf8'}));expect(content).toEqual({'one.txt':'Café\n'});}
 if(mode==='cancelled')await expect(page.getByText(/could not|unavailable|cancel/i)).toHaveCount(0);
});

test('a pending share chooser keeps the selection busy and dispatches only once',async({page})=>{
 let downloads=0;page.on('download',()=>downloads++);
 await page.evaluate(async()=>{(window as any).bulkShareCalls=0;Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:()=>{(window as any).bulkShareCalls++;return new Promise<void>(resolve=>{(window as any).finishBulkShare=resolve;});}});const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaFiles').importFile(new File(['one'],'one.txt'));});
 await openStorage(page);await startSelect(page);await page.getByRole('button',{name:'Select one.txt',exact:true}).click();
 const bar=page.getByRole('toolbar',{name:'Selection actions'});await bar.getByRole('button',{name:'Share',exact:true}).click();await page.getByRole('dialog',{name:'Share',exact:true}).getByRole('button',{name:'Share externally',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).bulkShareCalls)).toBe(1);
 await expect(bar.getByRole('button',{name:'Share',exact:true})).toBeDisabled();await expect(bar.getByRole('button',{name:'Move',exact:true})).toBeDisabled();
 await page.evaluate(()=>(window as any).finishBulkShare());await expect(bar.getByRole('button',{name:'Share',exact:true})).toBeEnabled();expect(await page.evaluate(()=>(window as any).bulkShareCalls)).toBe(1);expect(downloads).toBe(0);await expect(page.getByRole('button',{name:'Deselect one.txt',exact:true})).toBeVisible();
});
