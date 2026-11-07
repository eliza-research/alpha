import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
import {nativeSource,fixture,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';
// Files browser rules (design/view-refresh-2026-11/PLAN.md section 4; spec files-browser Design.cfg).
const url=(code)=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const strip=path=>stripTypeScriptTypes(readFileSync(path,'utf8'));
const storageUrl=url(strip('apps/app/src/runtime/files-storage.ts'));
const storage=await import(storageUrl);
const volumeModule=await import(url(strip('apps/app/src/browser/storage-volume.ts').replace("from '../runtime/files-storage'",`from '${storageUrl}'`)));
const contract=await import(url(strip('apps/app/src/runtime/files-agent-contract.ts').replace("from './files-storage'",`from '${storageUrl}'`)));
const {BrowserStorageVolume,TRASH_FOLDER}=volumeModule;
/** The browser file library's contract (plugin-files): unique names per folder, a move or
 * rename into a used name is refused, delete only removes an empty folder. */
function library(){
 const rows=new Map(),sel=new Map();let n=0;const rev=()=>'r'+(++n);
 const kids=id=>[...rows.values()].filter(r=>r.parentId===id);
 const insert=(parentId,name,extra)=>{if(parentId!=='root'&&!rows.get(parentId)?.directory)throw Error('Choose a folder.');if(kids(parentId).some(r=>r.name===name))throw Error('Choose a different name.');const id=crypto.randomUUID();rows.set(id,{id,parentId,name,revision:rev(),modifiedAt:clock,...extra});return id;};
 const mutate=(input,change)=>{const row=rows.get(input.id);if(!row||row.revision!==input.expectedRevision)throw Error('This file changed.');const next=change(row);if(next&&kids(next.parentId).some(r=>r.id!==row.id&&r.name===next.name))throw Error('Choose a different name.');if(next)rows.set(row.id,{...next,revision:rev()});else rows.delete(row.id);};
 const api={rows,
  async list({id='root'}){if(id!=='root'&&!rows.get(id)?.directory)throw Error('Choose a folder.');return {folder:{id},entries:kids(id).map(({bytes,...r})=>r)};},
  async createFolder({id,name}){insert(id,name,{directory:true,mimeType:'',size:0});},
  async rename(input){mutate(input,row=>({...row,name:input.name}));},
  async move(input){mutate(input,row=>{let a=input.destinationId;while(a&&a!=='root'){if(a===row.id)throw Error('outside');a=rows.get(a)?.parentId;}return {...row,parentId:input.destinationId};});},
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
 const v=new BrowserStorageVolume(lib,()=>changes.push(clock),()=>clock,memory());
 for(const f of ['DCIM','Documents','Download','Movies','Pictures','Recordings'])await lib.createFolder({id:'root',name:f});
 await v.createFolder('DCIM','Camera');
 v.add=async(folder,name,text='x',type)=>{const id=folder?await idOf(lib,folder):'root';await lib.importFile(new File([text],name,{type:type??storage.mimeFromName(name)}),id);};
 v.lib=lib;v.changes=changes;return v;
}
async function idOf(lib,path){let id='root';for(const part of path.split('/')){id=(await lib.list({id})).entries.find(e=>e.name===part).id;}return id;}
const names=async(v,path)=>(await v.list(path)).entries.map(e=>e.name).sort();

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
 const adapter=readFileSync('apps/app/src/prototype/files-browser-adapter.ts','utf8');
 assert.equal(/ACTION_OPEN_DOCUMENT|pickFiles|action:'files'/.test(adapter),false,'no picker behind a Browse entry');
});

test('native StorageBrowser on a host JVM: clashes keep both, trash restores to origin, retention, no escape',{skip:jsonJarSkip},()=>{
 assert.match(runJvm([nativeSource('StorageBrowser.java'),fixture('android-stubs/android/webkit/MimeTypeMap.java'),fixture('StorageBrowserTest.java')],'ai.elizaresearch.alphaphone.StorageBrowserTest',{json:true}),/^PASS storage browser/);
});
test('category counts and folder groups cover the whole category, not only the listed newest rows',()=>{
 const row=(path,modified)=>({path,name:storage.baseName(path),directory:false,mimeType:'image/jpeg',size:1,modified});
 const listed=[row('DCIM/Camera/a.jpg',3),row('DCIM/Camera/b.jpg',2)];
 // Android lists the newest rows and counts every file per folder, including folders with no listed row.
 const counted=[{folder:'DCIM/Camera',count:1850,latest:listed[0]},{folder:'Pictures/Old',count:150,latest:row('Pictures/Old/z.jpg',1)}];
 assert.deepEqual(storage.groupByFolder(listed,counted).map(g=>[g.name,g.count]),[['Camera',1850],['Old',150]]);
 assert.deepEqual(storage.groupByFolder(listed).map(g=>[g.name,g.count]),[['Camera',2]],'without counts the listed rows are grouped');
 const adapter=readFileSync('apps/app/src/prototype/files-browser-adapter.ts','utf8');
 assert.match(adapter,/next\[id\] = value\.count \?\? value\.entries\?\.length \?\? 0/);
 assert.match(adapter,/groupByFolder\(entries, categoryFolders\)/);
 const catalog=readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/StorageCatalog.java','utf8');
 assert.match(catalog,/while\(cursor\.moveToNext\(\)&&\(tally!=null\|\|out\.length\(\)<limit\)\)/,'a category reads every row to count it');
 assert.match(catalog,/out\.put\("count",tally\.count\);out\.put\("truncated",tally\.count>entries\.length\(\)\)/);
});
test('a folder watch also follows MediaStore, so provider writes (downloads, camera) refresh the open folder (ListingsConverge)',()=>{
 const plugin=readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaFilesPlugin.java','utf8');
 const watch=plugin.slice(plugin.indexOf('public void storageWatch'),plugin.indexOf('public void storageUnwatch'));
 assert.match(watch,/\n  mediaObserver=new android\.database\.ContentObserver/,'the MediaStore observer is registered for every watch, folders included');
 assert.doesNotMatch(watch,/if\(category!=null\|\|path==null\)\{mediaObserver/);
 assert.match(watch,/"downloads"\.equals\(category\)\?new java\.io\.File\(primaryBrowser\(\)\.root,StorageCatalog\.DOWNLOAD_FOLDER\)/,'Downloads watches the Download folder too');
});
test('every Browse category id has a native answer on Android; Downloads is the Download folder',()=>{
 const catalog=readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/StorageCatalog.java','utf8');
 const ids=JSON.parse('['+catalog.match(/static final String\[\] CATEGORY_IDS=\{([^}]*)\};/)[1]+']');
 assert.deepEqual(ids,storage.CATEGORIES.map(c=>c.id),'StorageCatalog.CATEGORY_IDS names exactly the renderer\'s categories');
 assert.equal(catalog.match(/static final String DOWNLOAD_FOLDER="([^"]+)";/)[1],storage.DOWNLOAD_FOLDER);
 assert.match(catalog,/if\(!"downloads"\.equals\(category\)\)return category\(resolver,category\);/);
 assert.match(catalog,/browser\.files\(DOWNLOAD_FOLDER,Integer\.MAX_VALUE\)/);
 for(const id of ids.filter(id=>id!=='downloads'))assert.ok(catalog.includes(`"${id}"`),`MediaStore category ${id}`);
 const plugin=readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaFilesPlugin.java','utf8');
 assert.match(plugin,/StorageCatalog\.category\(resolver\(\),primaryBrowser\(\),call\.getString\("category",""\)\)/);
 const instrumented=readFileSync('android/app/src/androidTest/java/ai/elizaresearch/alphaphone/StorageCategoriesInstrumentedTest.java','utf8');
 assert.match(instrumented,/for\(String id:StorageCatalog\.CATEGORY_IDS\)/,'the device test answers every category id');
});
test('the agent filter queries documents as their types and folders by a walk, not the newest rows of any type',()=>{
 const adapter=readFileSync('apps/app/src/prototype/files-browser-adapter.ts','utf8');
 assert.match(adapter,/value\.kind === 'document' \? \{documents: true\} : value\.kind === 'folder' \? \{folders: true\}/);
 const catalog=readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/StorageCatalog.java','utf8');
 assert.match(catalog,/if\(documents\)\{[^\n]*args\.add\(DOCUMENT_TYPES\[i\]\)[^\n]*MIME_TYPE\+" IN \("/);
 const plugin=readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaFilesPlugin.java','utf8');
 assert.match(plugin,/call\.getBoolean\("folders",false\)[^\n]*primaryBrowser\(\)\.folders\(/);
 assert.match(plugin,/Boolean\.TRUE\.equals\(call\.getBoolean\("documents",false\)\)/);
 const catalogDocs=JSON.parse('['+catalog.match(/static final String\[\] DOCUMENT_TYPES=\{([^}]*)\};/s)[1].replace(/\s+/g,'')+']');
 assert.deepEqual([...catalogDocs].sort(),[...storage.DOCUMENT_MIME_TYPES].sort(),'native and renderer agree on document types');
});
test('each mounted volume is its own Storage row and tree; Trash spans volumes and acts on the row\'s volume',()=>{
 const adapter=readFileSync('apps/app/src/prototype/files-browser-adapter.ts','utf8');
 assert.match(adapter,/vols: volumes\.map\(volume => \(\{[^\n]*go: \(\) => go\(\{kind: 'folder', path: '', \.\.\.onVolume\(volume\.primary \? undefined : volume\.id\)\}\)/);
 assert.match(adapter,/storageList\(\{path: at\.path, \.\.\.onVolume\(at\.volume\)\}\)/);
 assert.match(adapter,/\[undefined, \.\.\.extraVolumes\(\)\]\.map\(async volume =>/);
 assert.match(adapter,/storageEmptyTrash\(\{ids: ids\.slice\(at, at \+ EMPTY_BATCH\), confirmed: true, \.\.\.onVolume\(volume\)\}\)/);
 assert.match(adapter,/dialog = \{kind: 'empty', items: \[\.\.\.trashItems\]\}/,'Empty deletes the rows the owner was shown');
 assert.match(adapter,/void emptyTrash\(d\.items\)/);
 assert.equal(Number(adapter.match(/const EMPTY_BATCH = (\d+);/)[1]),Number(readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/StorageBrowser.java','utf8').match(/BATCH_MAX=(\d+)/)[1]));
 assert.match(readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaFilesPlugin.java','utf8'),/b\.emptyTrash\(strings\(call,"ids",StorageBrowser\.BATCH_MAX\)\)/,'native refuses an Empty without ids');
 assert.match(adapter,/void restore\(\[d\.item\.id\], d\.item\.volume\)/);
 const catalog=readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/StorageCatalog.java','utf8');
 assert.match(catalog,/for\(StorageVolume volume:manager\.getStorageVolumes\(\)\)/);
 assert.match(catalog,/if\(!primary&&\(uuid==null\|\|!uuid\.matches\("\[A-Za-z0-9-\]\{1,64\}"\)\)\)continue;/);
});
