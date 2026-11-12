import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {fixture,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';
import {preparePatchedNative} from '../scripts/prepare-patched-native.ts';
import path from 'node:path';
// Files browser rules.
const storage=await import('../.eliza/client-features/plugins/plugin-files/src/browser/storage-model.ts');
const {BrowserStorageVolume}=await import('../.eliza/client-features/plugins/plugin-files/src/browser/storage-volume.ts');
const contract=await import('../.eliza/client-features/plugins/plugin-files/src/browser/files-agent-contract.ts');
const TRASH_FOLDER='.Trash-alpha';
const nativeStorage=path.join(preparePatchedNative().root,'plugins/plugin-native-filesystem/android/src/main/java/ai/eliza/plugins/filesystem/browser');
/** The browser file library's contract (plugin-files): unique names per folder, a move or
 * rename into a used name is refused, delete only removes an empty folder. */
function library(){
 const rows=new Map(),sel=new Map();let n=0;const rev=()=>'r'+(++n);
 const kids=id=>[...rows.values()].filter(r=>r.parentId===id);
 const insert=(parentId,name,extra)=>{if(parentId!=='root'&&!rows.get(parentId)?.directory)throw Error('Choose a folder.');if(kids(parentId).some(r=>r.name===name))throw Error('Choose a different name.');const id=crypto.randomUUID();rows.set(id,{id,parentId,name,revision:rev(),modifiedAt:clock,...extra});return id;};
 const mutate=(input,change)=>{const row=rows.get(input.id);if(!row||row.revision!==input.expectedRevision)throw Error('This file changed.');const next=change(row);if(next&&kids(next.parentId).some(r=>r.id!==row.id&&r.name===next.name))throw Error('Choose a different name.');if(next)rows.set(row.id,{...next,revision:rev()});else rows.delete(row.id);};
 const relocate=(input,name)=>mutate(input,row=>{let a=input.destinationId;while(a&&a!=='root'){if(a===row.id)throw Error('outside');a=rows.get(a)?.parentId;}return {...row,parentId:input.destinationId,name:name??row.name};});
 const api={rows,
  async list({id='root'}){if(id!=='root'&&!rows.get(id)?.directory)throw Error('Choose a folder.');return {folder:{id},entries:kids(id).map(({bytes,...r})=>r)};},
  async createFolder({id,name}){insert(id,name,{directory:true,mimeType:'',size:0});},
  async rename(input){mutate(input,row=>({...row,name:input.name}));},
  async move(input){relocate(input);},
  async place(input){relocate(input,input.name);},
  async delete(input){mutate(input,row=>{if(kids(row.id).length)throw Error('Empty this folder.');return null;});},
  async select({id}){const row=rows.get(id);if(!row||row.directory)throw Error('Choose a file.');const selectionId=crypto.randomUUID();sel.set(selectionId,id);return {status:'selected',selectionId,name:row.name,mimeType:row.mimeType};},
  async attachment({selectionId}){const row=rows.get(sel.get(selectionId));return {name:row.name,mimeType:row.mimeType,dataBase64:Buffer.from(row.bytes).toString('base64')};},
  async forgetSelected({selectionId}){sel.delete(selectionId);},
  async importFile(file,parentId='root'){const bytes=new Uint8Array(await file.arrayBuffer());const id=insert(parentId,file.name,{directory:false,mimeType:file.type,size:bytes.length,bytes});return api.select({id});},
  async shareMany(){return {status:'opened'};},async usage(){return {bytes:0,files:0};},
 };
 return api;
}
let clock=1_000_000;
const memory=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v))};};
async function fresh(){
 clock=1_000_000;const lib=library(),changes=[];
 const store=memory();
 const v=new BrowserStorageVolume(lib,{trashFolder:TRASH_FOLDER,trashKey:'alpha.files.trash.v1'},()=>changes.push(clock),()=>clock,store);
 for(const f of ['DCIM','Documents','Download','Movies','Pictures','Recordings'])await lib.createFolder({id:'root',name:f});
 await v.createFolder('DCIM','Camera');
 // The file carries exactly the type it was given, as in a browser: Bun's File turns text/plain into text/plain;charset=utf-8.
 v.add=async(folder,name,text='x',type)=>{const id=folder?await idOf(lib,folder):'root',mimeType=type??storage.mimeFromName(name);await lib.importFile(Object.defineProperty(new File([text],name,{type:mimeType}),'type',{value:mimeType}),id);};
 v.lib=lib;v.changes=changes;v.fixtureStore=store;return v;
}
async function idOf(lib,path){let id='root';for(const part of path.split('/')){id=(await lib.list({id})).entries.find(e=>e.name===part).id;}return id;}
const names=async(v,path)=>(await v.list(path)).entries.map(e=>e.name).sort();

test('volume free space requires a finite, nonnegative and internally consistent estimate', async t => {
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 let estimate;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{storage:{estimate:async()=>estimate}}});
 t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;});
 const v=await fresh();
 v.lib.usage=async()=>({bytes:7,files:2});
 estimate={usage:1024,quota:4096};
 assert.deepEqual(await v.volume(),{id:'primary',name:'Internal storage',primary:true,free:3072,total:4096});
 for(const invalid of [undefined,{}, {usage:-1,quota:4096},{usage:Infinity,quota:4096},
   {usage:1024,quota:Infinity},{usage:4097,quota:4096},{usage:0,quota:-1},{usage:0,quota:0}]){
  estimate=invalid;
  assert.deepEqual(await v.volume(),{id:'primary',name:'Internal storage',primary:true,free:0,total:0,usage:{bytes:7,files:2}});
 }
});

test('categories are queries over storage: a camera photo is never in Downloads (CategoryIsQuery)',async()=>{
 const v=await fresh();
 await v.add('DCIM/Camera','IMG_1.jpg');await v.add('Download','bank.pdf');await v.add('Documents','notes.txt');await v.add('Recordings','memo.m4a');await v.add('Movies','clip.mp4');await v.add('Download','photo.png');
 const paths=async c=>(await v.category(c)).entries.map(e=>e.path).sort();
 assert.deepEqual(await paths('downloads'),['Download/bank.pdf','Download/photo.png']);
 assert.deepEqual(await paths('images'),['DCIM/Camera/IMG_1.jpg','Download/photo.png']);
 assert.deepEqual(await paths('documents'),['Documents/notes.txt','Download/bank.pdf']);
 assert.deepEqual(await paths('audio'),['Recordings/memo.m4a']);
 assert.deepEqual(await paths('videos'),['Movies/clip.mp4']);
 assert.equal(storage.inCategory('downloads',{path:'Download/sub/x.pdf',directory:false,mimeType:'application/pdf'}),false,'Downloads is the folder itself');
 assert.deepEqual(storage.groupByFolder((await v.category('images')).entries).map(g=>[g.name,g.count]).sort(),[['Camera',1],['Download',1]]);
 await v.trash(['Download/bank.pdf']);
 assert.deepEqual(await paths('documents'),['Documents/notes.txt'],'trashed files leave the categories');
 assert.equal((await v.list('')).entries.some(e=>e.name===TRASH_FOLDER),false,'the trash folder is hidden');
});

test('a move into a folder with the same name keeps both as "name (1)" and never overwrites (NoOverwriteWithoutConfirm)',async()=>{
 const v=await fresh();
 await v.add('Download','a.pdf','one');await v.add('Documents','a.pdf','two');await v.add('Documents','a (1).pdf','three');
 const {outcomes:[moved]}=await v.transfer(['Download/a.pdf'],'Documents',false);
 assert.deepEqual(moved,{path:'Download/a.pdf',status:'moved',to:'Documents/a (2).pdf'});
 assert.deepEqual((await v.list('Documents')).entries.map(e=>[e.name,e.size]).sort(),[['a (1).pdf',5],['a (2).pdf',3],['a.pdf',3]]);
 assert.deepEqual(await names(v,'Download'),[],'MoveConservesFiles: the source is gone, nothing duplicated');
 const {outcomes:[copied]}=await v.transfer(['Documents/a.pdf'],'Documents',true);
 assert.equal(copied.to,'Documents/a (3).pdf');
 assert.equal((await v.list('Documents')).entries.length,4);
 assert.equal((await v.transfer(['Documents/a.pdf'],'Documents',false)).outcomes[0].status,'unchanged');
 assert.equal((await v.transfer(['Download/gone.pdf'],'Documents',false)).outcomes[0].status,'missing','a file no longer where it was reviewed is left alone');
 assert.equal(storage.freeName('Taxes',['taxes'],true),'Taxes (1)','folders and case-insensitive names');
 assert.equal((await v.run('storageRename',{path:'Documents/a.pdf',name:'a (1).pdf'})).status,'exists','rename refuses an existing name');
 for(const hidden of ['.a.pdf','.Trash-alpha'])assert.equal((await v.run('storageRename',{path:'Documents/a.pdf',name:hidden})).status,'invalid','rename refuses a hidden name no listing would show');
 assert.equal((await v.createFolder('Documents','Taxes')).path,'Documents/Taxes');
 assert.equal((await v.createFolder('Documents','Taxes')).path,'Documents/Taxes (1)');
 assert.ok(v.changes.length>0,'open listings are told to refresh');
});

test('trash keeps the origin; restore goes back there, recreating the folder, and a clash keeps both (TrashReversible)',async()=>{
 const v=await fresh();
 await v.createFolder('Documents','Taxes');await v.add('Documents/Taxes','2025.pdf','seven');
 const {outcomes:[trashed]}=await v.trash(['Documents/Taxes/2025.pdf']);
 assert.equal(trashed.status,'trashed');
 assert.deepEqual((await v.trashList()).items.map(t=>[t.name,t.origin]),[['2025.pdf','Documents/Taxes']]);
 const taxes=await idOf(v.lib,'Documents/Taxes'),row=v.lib.rows.get(taxes);await v.lib.delete({id:taxes,expectedRevision:row.revision});
 const {outcomes:[restored]}=await v.restore([trashed.to]);
 assert.deepEqual(restored,{path:trashed.to,status:'restored',to:'Documents/Taxes/2025.pdf'},'the missing origin is recreated');
 await v.trash(['Documents/Taxes/2025.pdf']);await v.add('Documents/Taxes','2025.pdf','new');
 const id=(await v.trashList()).items[0].id;
 assert.equal((await v.restore([id])).outcomes[0].to,'Documents/Taxes/2025 (1).pdf');
 assert.equal((await v.trashList()).items.length,0);
 await v.trash(['Documents/Taxes/2025.pdf']);
 assert.equal((await v.emptyTrash(undefined,false)).status,'confirmation-required','Empty needs the owner confirmation');
 assert.equal((await v.trashList()).items.length,1);
 const shown=(await v.trashList()).items.map(t=>t.id);
 assert.equal((await v.emptyTrash(undefined,true)).status,'invalid','Empty names the items the owner confirmed');
 // An item trashed after the confirmation was shown is not deleted.
 await v.add('Documents','late.pdf');await v.trash(['Documents/late.pdf']);
 assert.equal((await v.emptyTrash(shown,true)).count,1,'only a confirmed Empty deletes permanently');
 assert.deepEqual((await v.trashList()).items.map(t=>t.name),['late.pdf'],'the later item stays in Trash');
 await v.emptyTrash((await v.trashList()).items.map(t=>t.id),true);
 await v.createFolder('','Work');await v.add('Work','w.txt');await v.trash(['Work']);
 assert.equal((await v.emptyTrash((await v.trashList()).items.map(t=>t.id),true)).count,1,'a trashed folder is deleted with its contents');
});

test('trash items expire after 30 days; folder moves into themselves are refused; paths cannot escape the volume',async()=>{
 const v=await fresh();
 await v.add('Download','old.txt');await v.trash(['Download/old.txt']);
 clock+=29*86400000;assert.equal((await v.trashList()).items.length,1);assert.equal(storage.trashDaysLeft(1_000_000,clock),1);
 clock+=86400000;assert.equal((await v.trashList()).items.length,0);
 await v.createFolder('','Work');await v.createFolder('Work','Inner');
 assert.equal((await v.transfer(['Work'],'Work/Inner',false)).outcomes[0].status,'invalid');
 for(const bad of ['../x','a/../b','a//b','.','x\u0000'])assert.throws(()=>storage.validPath(bad));
 assert.equal(storage.validPath('/Download/'),'Download','leading slashes are volume-relative, never absolute');
 assert.equal((await v.run('storageList',{path:TRASH_FOLDER+'/x'})).status,'missing');
});

async function assertMovingTrashRecord(){
 const v=await fresh();await v.add('Download','moving.pdf');
 const peer=new BrowserStorageVolume(v.lib,{trashFolder:TRASH_FOLDER,trashKey:'alpha.files.trash.v1'},()=>{},()=>clock,v.fixtureStore);
 const arrived=Promise.withResolvers(), release=Promise.withResolvers(), place=v.lib.place;
 v.lib.place=async input=>{arrived.resolve();await release.promise;return place(input);};
 const moving=v.trash(['Download/moving.pdf']);await arrived.promise;
 const listing=peer.trashList();
 await new Promise(setImmediate);
 release.resolve();
 const [{outcomes:[moved]},{items}]=await Promise.all([moving,listing]);
 assert.equal(moved.status,'trashed');
 assert.deepEqual(items.map(({id,name,origin})=>({id,name,origin})),[{id:moved.to,name:'moving.pdf',origin:'Download'}]);
 assert.equal((await peer.restore([moved.to])).outcomes[0].to,'Download/moving.pdf');
}

test('a peer Trash list preserves the exact record while the selected file is moving', assertMovingTrashRecord);

test('same-realm Trash operations preserve the moving record without Web Locks',async t=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
 t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;});
 await assertMovingTrashRecord();
});

test('finishing a held Restore preserves a peer Trash write',async()=>{
 const v=await fresh();await v.add('Download','first.pdf');await v.add('Download','second.pdf');
 const {outcomes:[first]}=await v.trash(['Download/first.pdf']);
 const peer=new BrowserStorageVolume(v.lib,{trashFolder:TRASH_FOLDER,trashKey:'alpha.files.trash.v1'},()=>{},()=>clock,v.fixtureStore);
 const restored=Promise.withResolvers(), release=Promise.withResolvers(), place=v.lib.place;
 const download=await idOf(v.lib,'Download');
 v.lib.place=async input=>{if(input.destinationId===download){restored.resolve();await release.promise;}return place(input);};
 const restoring=v.restore([first.to]);await restored.promise;
 const moving=peer.trash(['Download/second.pdf']);
 await new Promise(setImmediate);
 release.resolve();
 const [{outcomes:[back]},{outcomes:[second]}]=await Promise.all([restoring,moving]);
 assert.equal(back.status,'restored');assert.equal(second.status,'trashed');
 assert.deepEqual((await v.trashList()).items.map(({id,name})=>[id,name]),[[second.to,'second.pdf']]);
});

test('only the primary volume exists in the browser; another volume is refused like an unmounted one',async()=>{
 const v=await fresh();
 const state=await v.run('storageState',{});assert.deepEqual(state.volumes.map(x=>[x.id,x.primary]),[['primary',true]]);
 for(const [method,input] of [['storageList',{path:''}],['storageTrash',{paths:['Download/a.pdf']}],['storageTrashList',{}],['storageEmptyTrash',{confirmed:true}]])assert.equal((await v.run(method,{...input,volume:'1234-ABCD'})).status,'unavailable',method);
 assert.equal((await v.run('storageList',{path:'',volume:'primary'})).status,'ready');
});
test('sort is folders first, then name, date or size; breadcrumbs follow the path',()=>{
 const rows=[{name:'b.pdf',directory:false,modified:3,size:10},{name:'Zed',directory:true,modified:9,size:0},{name:'a.pdf',directory:false,modified:1,size:30},{name:'file10.pdf',directory:false,modified:2,size:20}];
 assert.deepEqual(storage.sortEntries(rows,'name').map(r=>r.name),['Zed','a.pdf','b.pdf','file10.pdf']);
 assert.deepEqual(storage.sortEntries(rows,'date').map(r=>r.name),['Zed','b.pdf','file10.pdf','a.pdf']);
 assert.deepEqual(storage.sortEntries(rows,'size').map(r=>r.name),['Zed','a.pdf','file10.pdf','b.pdf']);
 assert.deepEqual(storage.breadcrumbs('DCIM/Camera'),[{label:'Internal storage',path:''},{label:'DCIM',path:'DCIM'},{label:'Camera',path:'DCIM/Camera'}]);
 assert.equal(storage.formatFree({free:38.2*1024**3,total:128*1024**3}),'38.2 GB free of 128 GB');
});

test('the agent filter is read-only, validated, and matches names, kinds, folders and dates (FilterIsReadOnly)',()=>{
 const f=storage.validateFilesFilter({text:'bank',kind:'pdf',folder:'Download',from:'2026-01-01',to:'2026-12-31'});
 const row=(path,mimeType,modified)=>({path,name:path.split('/').pop(),directory:false,mimeType,size:1,modified});
 assert.equal(storage.filterMatches(f,row('Download/Bank statement.pdf','application/pdf',Date.parse('2026-05-01'))),true);
 assert.equal(storage.filterMatches(f,row('DCIM/Camera/bank.jpg','image/jpeg',Date.parse('2026-05-01'))),false);
 assert.equal(storage.filterMatches(f,row('Download/bank.pdf','application/pdf',Date.parse('2025-05-01'))),false);
 assert.equal(storage.filterMatches({to:'2026-05-01'},row('x.pdf','application/pdf',Date.parse('2026-05-01T23:00:00Z'))),true,'a date-only end includes that day');
 for(const bad of [{},{text:''},{kind:'exe'},{folder:'../x'},{from:'yesterday'},{from:'2026-02-01',to:'2026-01-01'},{text:'a',extra:1}])assert.throws(()=>storage.validateFilesFilter(bad));
 assert.match(storage.filterLabel(f),/“bank” · PDFs · in Download/);
});

test('Files agent tools: filter and open are direct; share, move, trash and folder creation are reviewed proposals',()=>{
 assert.deepEqual(contract.validateFilesOperation({type:'files_filter',text:'lease'}),{type:'files_filter',text:'lease'});
 assert.deepEqual(contract.validateFilesOperation({type:'files_move',paths:['Download/a.pdf'],dest:'Documents'}),{type:'files_move',paths:['Download/a.pdf'],dest:'Documents'});
 assert.deepEqual(contract.validateFilesOperation({type:'files_folder_create',parent:'',name:'Taxes'}),{type:'files_folder_create',parent:'',name:'Taxes'});
 for(const bad of [{type:'files_move',paths:[],dest:'x'},{type:'files_move',paths:['a','a'],dest:'x'},{type:'files_trash',paths:['../etc']},{type:'files_folder_create',parent:'',name:'.hidden'},{type:'files_open',path:'a',extra:1},{type:'files_delete',paths:['a']}])assert.throws(()=>contract.validateFilesOperation(bad));
 assert.deepEqual([...contract.FILES_DIRECT_TYPES],['files_filter','files_open']);
 for(const type of ['files_share','files_move','files_trash','files_folder_create'])assert.equal(contract.FILES_DIRECT_TYPES.includes(type),false);
 assert.deepEqual(contract.describeFilesOperation({type:'files_move',paths:['Download/a.pdf'],dest:'Documents/Taxes'}),{title:'Move 1 item',description:'a.pdf → Documents › Taxes'});
 assert.equal(contract.filesContextAllowed({type:'files_trash',paths:['a']},{view:'home'}),false,'changes are reviewed only with Files on screen');
 assert.equal(contract.filesContextAllowed({type:'files_filter',text:'a'},{view:'home'}),true);
 assert.equal(contract.filesContextAllowed({type:'files_filter',text:'a'},{view:'files',sensitive:true}),false);
});

test('Files shows no picker tiles, search box, Recents or instruction subtitles',()=>{
 const template=readFileSync('apps/app/src/prototype/template.html','utf8'),files=template.slice(template.indexOf('<sc-if value="{{is.files}}">'),template.indexOf('<sc-if value="{{is.wallet}}">'));
 for(const gone of ['Search files','files.recent','files.locs','recentEmptyText','files.storageText','Choose folder','Import folder','Receipts'])assert.equal(files.includes(gone),false,gone);
 const model=readFileSync('apps/app/src/prototype/model.js','utf8'),module=model.slice(model.indexOf('registerView("files"'),model.indexOf('render: function (st, api) {\n    var files'));
 assert.equal(/reply:/.test(module),false,'no fixture reply() regexes for files');
 const adapter=readFileSync('.eliza/client-features/plugins/plugin-files/src/browser/files-browser-adapter.ts','utf8');
 assert.equal(/ACTION_OPEN_DOCUMENT|pickFiles|action:'files'/.test(adapter),false,'no picker behind a Browse entry');
});

test('native StorageBrowser on a host JVM: clashes keep both, trash restores to origin, retention, no escape',{skip:jsonJarSkip},()=>{
 assert.match(runJvm([`${nativeStorage}/StorageBrowser.java`,fixture('android-stubs/android/webkit/MimeTypeMap.java'),fixture('StorageBrowserTest.java')],'ai.eliza.plugins.filesystem.browser.StorageBrowserTest',{json:true}),/^PASS storage browser/);
});
test('category counts and folder groups cover the whole category, not only the listed newest rows',()=>{
 const row=(path,modified)=>({path,name:storage.baseName(path),directory:false,mimeType:'image/jpeg',size:1,modified});
 const listed=[row('DCIM/Camera/a.jpg',3),row('DCIM/Camera/b.jpg',2)];
 // Android lists the newest rows and counts every file per folder, including folders with no listed row.
 const counted=[{folder:'DCIM/Camera',count:1850,latest:listed[0]},{folder:'Pictures/Old',count:150,latest:row('Pictures/Old/z.jpg',1)}];
 assert.deepEqual(storage.groupByFolder(listed,counted).map(g=>[g.name,g.count]),[['Camera',1850],['Old',150]]);
 assert.deepEqual(storage.groupByFolder(listed).map(g=>[g.name,g.count]),[['Camera',2]],'without counts the listed rows are grouped');
 const adapter=readFileSync('.eliza/client-features/plugins/plugin-files/src/browser/files-browser-adapter.ts','utf8');
 assert.match(adapter,/next\[id\] = value\.count \?\? value\.entries\?\.length \?\? 0/);
 assert.match(adapter,/groupByFolder\(entries, categoryFolders\)/);
 const catalog=readFileSync(`${nativeStorage}/StorageCatalog.java`,'utf8');
 assert.match(catalog,/while\(cursor\.moveToNext\(\)&&\(tally!=null\|\|out\.length\(\)<limit\)\)/,'a category reads every row to count it');
 assert.match(catalog,/out\.put\("count",tally\.count\);out\.put\("truncated",tally\.count>entries\.length\(\)\)/);
});
test('a folder watch also follows MediaStore, so provider writes (downloads, camera) refresh the open folder (ListingsConverge)',()=>{
 const plugin=readFileSync('android/app/src/main/java/ai/alphacompute/alphaphone/AlphaFilesPlugin.java','utf8');
 const watch=plugin.slice(plugin.indexOf('public void storageWatch'),plugin.indexOf('public void storageUnwatch'));
 assert.match(watch,/android\.database\.ContentObserver media=new android\.database\.ContentObserver/,'the MediaStore observer is registered for every watch, folders included');
 assert.doesNotMatch(watch,/if\(category!=null\|\|path==null\)\{/);
 assert.match(watch,/"downloads"\.equals\(category\)\?new java\.io\.File\(primaryBrowser\(\)\.root,StorageCatalog\.DOWNLOAD_FOLDER\)/,'Downloads watches the Download folder too');
});
test('every Browse category id has a native answer on Android; Downloads is the Download folder',()=>{
 const catalog=readFileSync(`${nativeStorage}/StorageCatalog.java`,'utf8');
 const ids=JSON.parse('['+catalog.match(/static final String\[\] CATEGORY_IDS=\{([^}]*)\};/)[1]+']');
 assert.deepEqual(ids,storage.CATEGORIES.map(c=>c.id),'StorageCatalog.CATEGORY_IDS names exactly the renderer\'s categories');
 assert.equal(catalog.match(/static final String DOWNLOAD_FOLDER="([^"]+)";/)[1],storage.DOWNLOAD_FOLDER);
 assert.match(catalog,/if\(!"downloads"\.equals\(category\)\)return category\(resolver,category\);/);
 assert.match(catalog,/browser\.files\(DOWNLOAD_FOLDER,Integer\.MAX_VALUE\)/);
 for(const id of ids.filter(id=>id!=='downloads'))assert.ok(catalog.includes(`"${id}"`),`MediaStore category ${id}`);
 const plugin=readFileSync('android/app/src/main/java/ai/alphacompute/alphaphone/AlphaFilesPlugin.java','utf8');
 assert.match(plugin,/StorageCatalog\.category\(resolver\(\),primaryBrowser\(\),call\.getString\("category",""\)\)/);
 const instrumented=readFileSync('android/app/src/androidTest/java/ai/alphacompute/alphaphone/StorageCategoriesInstrumentedTest.java','utf8');
 assert.match(instrumented,/for\(String id:StorageCatalog\.CATEGORY_IDS\)/,'the device test answers every category id');
});
test('the agent filter queries documents as their types and folders by a walk, not the newest rows of any type',()=>{
 const adapter=readFileSync('.eliza/client-features/plugins/plugin-files/src/browser/files-browser-adapter.ts','utf8');
 assert.match(adapter,/value\.kind === ["']document["']\s*\?\s*\{\s*documents: true\s*\}\s*:\s*value\.kind === ["']folder["']\s*\?\s*\{\s*folders: true\s*\}/);
 const catalog=readFileSync(`${nativeStorage}/StorageCatalog.java`,'utf8');
 assert.match(catalog,/if\(documents\)\{[^\n]*args\.add\(DOCUMENT_TYPES\[i\]\)[^\n]*MIME_TYPE\+" IN \("/);
 const plugin=readFileSync('android/app/src/main/java/ai/alphacompute/alphaphone/AlphaFilesPlugin.java','utf8');
 assert.match(plugin,/call\.getBoolean\("folders",false\)[^\n]*primaryBrowser\(\)\.folders\(/);
 assert.match(plugin,/Boolean\.TRUE\.equals\(call\.getBoolean\("documents",false\)\)/);
 const catalogDocs=JSON.parse('['+catalog.match(/static final String\[\] DOCUMENT_TYPES=\{([^}]*)\};/s)[1].replace(/\s+/g,'')+']');
 assert.deepEqual([...catalogDocs].sort(),[...storage.DOCUMENT_MIME_TYPES].sort(),'native and renderer agree on document types');
});
test('each mounted volume is its own Storage row and tree; Trash spans volumes and acts on the row\'s volume',()=>{
 const adapter=readFileSync('.eliza/client-features/plugins/plugin-files/src/browser/files-browser-adapter.ts','utf8');
 assert.match(adapter,/vols: volumes\.map\(\(?volume\)? => \(\{[\s\S]*?go: \(\) =>\s*go\(\{\s*kind: ["']folder["'],\s*path: ["']["'],\s*\.\.\.onVolume\(volume\.primary \? undefined : volume\.id\),?\s*\}\)/);
 assert.match(adapter,/storageList\(\{\s*path: at\.path,\s*\.\.\.onVolume\(at\.volume\),?\s*\}\)/);
 assert.match(adapter,/\[undefined, \.\.\.extraVolumes\(\)\]\.map\(async \(?volume\)? =>/);
 assert.match(adapter,/storageEmptyTrash\(\{\s*ids: ids\.slice\(at, at \+ EMPTY_BATCH\),\s*confirmed: true,\s*\.\.\.onVolume\(volume\),?\s*\}\)/);
 assert.match(adapter,/dialog = \{\s*kind: ["']empty["'],\s*items: \[\.\.\.trashItems\],?\s*\}/,'Empty deletes the rows the owner was shown');
 assert.match(adapter,/void emptyTrash\(d\.items\)/);
 assert.equal(Number(adapter.match(/const EMPTY_BATCH = (\d+);/)[1]),Number(readFileSync(`${nativeStorage}/StorageBrowser.java`,'utf8').match(/BATCH_MAX=(\d+)/)[1]));
 assert.match(readFileSync('android/app/src/main/java/ai/alphacompute/alphaphone/AlphaFilesPlugin.java','utf8'),/b\.emptyTrash\(strings\(call,"ids",StorageBrowser\.BATCH_MAX\)\)/,'native refuses an Empty without ids');
 assert.match(adapter,/void restore\(\[d\.item\.id\], d\.item\.volume\)/);
 const catalog=readFileSync(`${nativeStorage}/StorageCatalog.java`,'utf8');
 assert.match(catalog,/for\(StorageVolume volume:manager\.getStorageVolumes\(\)\)/);
 assert.match(catalog,/if\(!primary&&\(uuid==null\|\|!uuid\.matches\("\[A-Za-z0-9-\]\{1,64\}"\)\)\)continue;/);
});

test('a reviewed agent move or trash acts only on the opaque identities the owner reviewed (FixIdentity)',async()=>{
 const v=await fresh();await v.add('Download','lease.pdf','lease');await v.add('Download','notes.txt','notes');
 const missing=await v.run('storageReviewedIdentities',{paths:['Download/lease.pdf','Download/missing.pdf']});
 assert.notEqual(missing.status,'ready','missing items cannot be reviewed');
 const ids=await v.run('storageReviewedIdentities',{paths:['Download/lease.pdf','Download/notes.txt']});
 assert.equal(ids.status,'ready');const reviewed=ids.reviewed;
 assert.equal(reviewed.length,2);for(const token of reviewed)assert.match(token,/^[A-Za-z0-9_-]{43}$/);
 const row=[...v.lib.rows.values()].find(r=>r.name==='lease.pdf'),size=row.size,modified=row.modifiedAt;
 // The external provider can replace bytes without changing size or timestamps.
 // Its revision is authority; neither visible metadata pair is a reviewed token.
 row.bytes=new TextEncoder().encode('other');row.revision='external-replacement';
 assert.equal(row.size,size);assert.equal(row.modifiedAt,modified);
 const moved=await v.run('storageTransfer',{paths:['Download/lease.pdf','Download/notes.txt'],dest:'Documents',copy:false,reviewed});
 assert.deepEqual(moved.outcomes.map(o=>o.status),['changed','moved']);
 assert.deepEqual(await names(v,'Download'),['lease.pdf'],'the replaced file stays');
 assert.deepEqual((await v.run('storageTrash',{paths:['Download/lease.pdf'],reviewed:[reviewed[0]]})).outcomes.map(o=>o.status),['changed']);
 assert.deepEqual(await names(v,'Download'),['lease.pdf']);
 const now=(await v.run('storageReviewedIdentities',{paths:['Download/lease.pdf']})).reviewed;
 assert.notEqual(now[0],reviewed[0]);
 assert.deepEqual((await v.run('storageTrash',{paths:['Download/lease.pdf'],reviewed:now})).outcomes.map(o=>o.status),['trashed']);
 assert.notEqual((await v.run('storageTrash',{paths:['Documents/notes.txt'],reviewed:[]})).status,'ready','one opaque identity per path');
});

test('the Files agent contract carries opaque reviewed identities and refuses unreviewed mutation',()=>{
 const reviewed=['a'.repeat(43)];
 for(const op of [{type:'files_move',paths:['Download/a.pdf'],dest:'Documents',reviewed},{type:'files_trash',paths:['Download/a.pdf'],reviewed}]){
  const valid=contract.validateFilesOperation(op);assert.deepEqual(valid,op);assert.deepEqual(contract.validateFilesOperation(valid),valid);
 }
 for(const bad of [{type:'files_trash',paths:['a','b'],reviewed},{type:'files_trash',paths:['a'],reviewed:[{size:3,modified:1}]},{type:'files_trash',paths:['a'],reviewed:['a'.repeat(42)]},{type:'files_trash',paths:['a'],reviewed:['/'.repeat(43)]},{type:'files_share',paths:['a'],reviewed}])assert.throws(()=>contract.validateFilesOperation(bad));
 // A proposal may omit identities; validation must not invent owner approval.
 // The mounted Files runner below refuses mutation until review supplies them.
 for(const proposal of [{type:'files_move',paths:['a'],dest:''},{type:'files_trash',paths:['a']}]){
  const validated=contract.validateFilesOperation(proposal);
  assert.deepEqual(validated,proposal);
  assert.equal(Object.hasOwn(validated,'reviewed'),false);
  assert.equal(contract.filesContextAllowed(validated,{view:'home'}),false);
  assert.equal(contract.filesContextAllowed(validated,{view:'files',sensitive:true}),false);
  assert.equal(contract.filesContextAllowed(validated,{view:'files'}),true);
 }
 const adapter=readFileSync('.eliza/client-features/plugins/plugin-files/src/browser/files-browser-adapter.ts','utf8');
 // The current runner owns the identity fence directly, before opening Files or refreshing storage.
 const runner = adapter.slice(adapter.indexOf('async run(op: FilesAgentOperation'));
 const reviewFence = /if\s*\(\s*\(op\.type === "files_move" \|\| op\.type === "files_trash"\) &&\s*\(!op\.reviewed \|\| !reviewingPrimary\(\)\)\s*\)\s*return reviewRequired;/.exec(runner);
 assert.ok(reviewFence, 'unreviewed mutations are refused at the runner entry point');
 const openFiles = runner.indexOf('await openFiles()');
 assert.ok(openFiles > reviewFence.index, 'mutation review runs before the cold Files handoff');
 assert.match(adapter,/if \(!reviewingPrimary\(\) \|\| !op\.reviewed\) return reviewRequired/);
 assert.match(adapter,/paths: op\.paths,[\s\S]*reviewed: op\.reviewed,[\s\S]*volume: "primary"/);
 assert.match(adapter,/storage\.storageTransfer\(\{[\s\S]*\.\.\.selection,[\s\S]*copy: false/);
 assert.match(adapter,/storage\.storageTrash\(selection\)/);
 assert.match(adapter,/async reviewedIdentities\(paths, signal\)/);
 assert.doesNotMatch(adapter,/Restore from Files/);
 const plugin=readFileSync('android/app/src/main/java/ai/alphacompute/alphaphone/AlphaFilesPlugin.java','utf8');
 assert.match(plugin,/b\.transfer\(paths,call\.getString\("dest",""\),copy,reviewed\)/);
 assert.match(plugin,/b\.trash\(paths,System\.currentTimeMillis\(\),reviewed\)/);
 assert.match(plugin,/public void storageReviewedIdentities\(PluginCall call\)/);
 assert.match(plugin,/reviewed!=null&&!filesReviewVisible\(\)/);
});

test('the browser volume answers the folder filter with folders, as Android walks them (files_filter kind folder)',async()=>{
 const v=await fresh();await v.createFolder('Documents','Taxes');await v.createFolder('Documents/Taxes','2025');await v.add('Documents','a.pdf');
 const all=(await v.run('storageQuery',{folders:true})).entries;
 assert.ok(all.every(e=>e.directory),'only folders');
 assert.ok(['DCIM/Camera','Documents/Taxes','Documents/Taxes/2025'].every(p=>all.some(e=>e.path===p)));
 const under=(await v.run('storageQuery',{folders:true,folder:'Documents'})).entries.map(e=>e.path).sort();
 assert.deepEqual(under,['Documents/Taxes','Documents/Taxes/2025']);
 assert.equal((await v.run('storageQuery',{folders:true,folder:'Documents'})).entries.find(e=>e.path==='Documents/Taxes').children,1);
 const shown=all.filter(e=>storage.filterMatches({kind:'folder',text:'taxes'},e));
 assert.deepEqual(shown.map(e=>e.path),['Documents/Taxes'],'the renderer\'s filter now has folders to match');
 assert.deepEqual((await v.run('storageQuery',{folders:true,folder:'Nope'})).entries,[]);
 assert.ok((await v.run('storageQuery',{})).entries.every(e=>!e.directory),'without folders the query is the file walk');
});


test('Browse requests count-only category summaries from the shared storage adapter',async()=>{
 const adapter=readFileSync('.eliza/client-features/plugins/plugin-files/src/browser/files-browser-adapter.ts','utf8');
 const counts=adapter.slice(adapter.indexOf('async function loadCounts'),adapter.indexOf('async function reload'));
 assert.match(counts,/storageCategory\(\{\s*category: id,\s*countOnly: true,?\s*\}\)/);
 const v=await fresh();await v.add('DCIM/Camera','one.jpg','x');await v.add('DCIM/Camera','two.jpg','y');
 assert.deepEqual(await v.run('storageCategory',{category:'images',countOnly:true}),{status:'ready',count:2});
 assert.equal((await v.run('storageCategory',{category:'images'})).entries.length,2);
 assert.match(adapter,/Files needs storage access\. Nothing was changed\./);
 assert.match(adapter,/'Opened the share sheet\.'|"Opened the share sheet\."/);
});


test('a superseded storage watch neither registers nor publishes an observer',{skip:jsonJarSkip},()=>{
 assert.match(runJvm([`${nativeStorage}/StorageBrowser.java`,fixture('android-stubs/android/webkit/MimeTypeMap.java'),fixture('StorageWatchSlotTest.java')],'ai.eliza.plugins.filesystem.browser.StorageWatchSlotTest',{json:true}),/^PASS storage watch slot/);
 const plugin=readFileSync('android/app/src/main/java/ai/alphacompute/alphaphone/AlphaFilesPlugin.java','utf8');
 assert.match(plugin,/public void storageWatch\(PluginCall call\)\{long ticket=watch\.request\(\);storage\(call,b->\{/);
 assert.match(plugin,/watch\.install\(ticket,\(\)->\{/);
 assert.match(plugin,/private void stopWatching\(\)\{watch\.clear\(\);\}/);
 assert.match(plugin,/watch\.isCurrent\(ticket\)/,'queued callbacks recheck their current owner');
});
