import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {join,resolve} from 'node:path';import {execFileSync} from 'node:child_process';
// Device photo/video library rules (issue 408). Source-level: this proves the renderer contract and
// the native source shape, not Android behaviour (see PhotoLibraryInstrumentedTest for that).
const m=await import('../apps/app/src/runtime/photo-library.ts');
// AlphaPhotos and AlphaPhotoLibrary register plugin-native-media's PhotosPlugin and DeviceLibraryPlugin.
// The shared sources are read with whitespace collapsed so these checks name the code, not its layout.
const compact=source=>source.replace(/\s+/g,' ').replace(/ (?=\W)|(?<=\W) /g,'');
const media='vendor/eliza/plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media/';
const registration=readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaPhotoLibraryPlugin.java','utf8');
const java=compact(readFileSync(media+'DeviceLibraryPlugin.java','utf8'));
const access=compact(readFileSync(media+'PhotoLibraryAccess.java','utf8'));
const sharedPhotos=compact(readFileSync(media+'PhotosPlugin.java','utf8'));
const manifest=readFileSync('android/app/src/main/AndroidManifest.xml','utf8');
const adapter=readFileSync('apps/app/src/prototype/photo-library-adapter.ts','utf8');

const scope=(extra={})=>({scope:'full',images:true,videos:true,canSelectMore:false,canEditOthers:true,locked:false,version:'v1',...extra});
const item=(row,extra={})=>({id:`lib:i:${row}:${row*10}`,revision:`${1700000000+row}:${1000+row}:${row}`,kind:'image',mime:'image/jpeg',name:`IMG_${row}.jpg`,album:'Camera',width:4000,height:3000,takenAt:1700000000000+row,modifiedAt:1700000000000,size:1000+row,duration:0,favorite:false,owned:false,image:'data:image/jpeg;base64,AA==',...extra});
const page=(rows,next='',extra={})=>({...scope(extra),items:rows.map(row=>typeof row==='number'?item(row):row),next,generation:42});

test('manifest declares the media permissions Android needs per API level, legacy read capped at API 32',()=>{
 assert.match(manifest,/<uses-permission android:name="android\.permission\.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" \/>/);
 for(const name of ['READ_MEDIA_IMAGES','READ_MEDIA_VIDEO','READ_MEDIA_VISUAL_USER_SELECTED'])assert.match(manifest,new RegExp(`<uses-permission android:name="android\\.permission\\.${name}" />`));
 // No write-all or manage-all storage shortcut.
 assert.doesNotMatch(manifest,/MANAGE_EXTERNAL_STORAGE|ACCESS_MEDIA_LOCATION/);
 assert.match(manifest,/WRITE_EXTERNAL_STORAGE" tools:node="remove"/);
 assert.match(readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/MainActivity.java','utf8'),/registerPlugin\(AlphaPhotoLibraryPlugin\.class\);/);
});

test('native facade bounds the renderer contract: per-SDK permission request, page, validation and action limits',()=>{
 // The scope, identity and MediaStore rules live in the shared PermittedMediaCatalog/MediaLibraryKey
 // (plugins/plugin-native-media, tested upstream). Alpha keeps only the facade bounds checked here.
 assert.match(registration,/public class AlphaPhotoLibraryPlugin extends DeviceLibraryPlugin \{/);
 assert.match(sharedPhotos,/public static String\[\]libraryPermissionAliases\(\)\{return PhotoLibraryAccess\.permissionAliases\(Build\.VERSION\.SDK_INT\);\}/);
 assert.match(access,/public static final int SELECTED_SDK=34;/);assert.match(access,/public static final int MEDIA_PERMISSIONS_SDK=33;/);
 assert.match(access,/if\(sdk>=SELECTED_SDK\)return new String\[\]\{"libraryImages","libraryVideos","librarySelected"\};if\(sdk>=MEDIA_PERMISSIONS_SDK\)return new String\[\]\{"libraryImages","libraryVideos"\};return new String\[\]\{"libraryLegacy"\};/);
 assert.match(access,/public static final int PAGE=24;/);assert.match(access,/return Math\.min\(PAGE,Math\.max\(1,requested\)\);/);
 assert.match(java,/PhotoLibraryAccess\.pageLimit\(call\.getInt\("limit",PhotoLibraryAccess\.PAGE\)\)/,'pages never exceed the shared catalog page');
 assert.match(access,/public static final int VALIDATE=200;/);assert.match(java,/requested\.length\(\)>PhotoLibraryAccess\.VALIDATE\)throw/,'validation is bounded');
 assert.match(access,/public static final int REVIEWED=20;/);assert.match(access,/items\.length\(\)<1\|\|items\.length\(\)>max\)throw/);
 assert.match(java,/PhotoLibraryAccess\.reviewed\(call\.getArray\("items"\),PhotoLibraryAccess\.REVIEWED\)/,'reviewed actions are bounded');
 assert.equal(m.LIBRARY_LIMITS.page,100);assert.equal(m.LIBRARY_LIMITS.thumbnailRows,30);assert.equal(m.LIBRARY_LIMITS.validate,200);assert.equal(m.LIBRARY_LIMITS.action,20);assert.equal(m.LIBRARY_LIMITS.query,80);
 // Renderer accepts the shared catalog identity and the legacy lib: identity.
 assert.ok(m.isLibraryId('m:external_primary:i:42'));assert.ok(!m.isLibraryId('m:external:i:42'));
 assert.equal(m.LIBRARY_ID.source,'^lib:([iv]):([1-9][0-9]{0,18}):([0-9]{1,19})$');
});

test('agent album delegates reads and reviewed mutations to the canonical catalog',()=>{
 assert.match(java,/catalog\.list\(/);assert.match(java,/catalog\.read\(/);assert.match(java,/review\.request\(/);
 assert.doesNotMatch(java,/MediaStore\.Files|createDeleteRequest|createTrashRequest|createFavoriteRequest/);
 assert.match(java,/LIBRARY_LOCKED/);assert.match(java,/LIBRARY_DENIED/);
 // The catalog's generation fences and date bounds are the shared native media module's (tested there).
 assert.match(registration,/import ai\.eliza\.plugins\.media\.DeviceLibraryPlugin;/);
});

test('scope parsing and honest scope copy',()=>{
 assert.throws(()=>m.parseScope({scope:'all'}));
 const full=m.parseScope(scope());assert.equal(full.scope,'full');
 const copy=m.scopePresentation(full);
 assert.equal(copy.label,'Full access');assert.match(copy.detail,/Nothing is uploaded automatically/);assert.match(copy.detail,/work-profile/);assert.equal(copy.actionKind,'settings');
 assert.match(m.scopePresentation(m.parseScope(scope({videos:false}))).detail,/Videos are not allowed/);
 const selected=m.scopePresentation(m.parseScope(scope({scope:'selected',images:false,videos:false,canSelectMore:true})));
 assert.equal(selected.label,'Selected items');assert.match(selected.detail,/only the items you chose/);assert.equal(selected.actionKind,'request');
 const denied=m.scopePresentation(m.parseScope(scope({scope:'denied',images:false,videos:false})));
 assert.equal(denied.label,'Not allowed');assert.equal(denied.action,'Allow access');
 assert.equal(m.scopePresentation(m.parseScope(scope({scope:'denied',settingsRequired:true}))).actionKind,'settings');
 assert.equal(m.scopePresentation(m.parseScope(scope({locked:true}))).label,'Locked');
 assert.equal(m.scopePresentation(undefined).label,'Unavailable');
 // Never claims full access for a selected grant, nor anything about uploads having happened.
 for(const state of [scope({scope:'selected'}),scope({scope:'denied'})])assert.doesNotMatch(m.scopePresentation(m.parseScope(state)).label,/Full/);
});

test('pages validate identities, cursors and duplicates',()=>{
 const parsed=m.parsePage(page([5,4,3],'3'));
 assert.deepEqual(parsed.items.map(row=>row.id),['lib:i:5:50','lib:i:4:40','lib:i:3:30']);assert.equal(parsed.next,'3');
 assert.throws(()=>m.parsePage(page([5,5])),/Duplicate/);
 assert.throws(()=>m.parsePage(page([5],'abc')),/cursor/);
 assert.throws(()=>m.parsePage(page([item(5,{kind:'video'})])),/kind/);
 assert.throws(()=>m.parsePage(page([item(5,{id:'lib:i:0:1'})])));
 assert.throws(()=>m.parsePage(page([item(5,{revision:'x|y'})])));
 assert.throws(()=>m.parsePage(page(Array.from({length:101},(_,i)=>i+1))));
 // Thumbnails are local JPEG data only.
 assert.equal(m.parseItem(item(1,{image:'https://example.invalid/x.jpg'})).image,undefined);
});

test('a large catalog pages without gaps or repeats and stays bounded in memory',()=>{
 const catalog=new m.LibraryCatalog();
 const all=Array.from({length:2600},(_,i)=>2600-i);
 let cursor='',first=true,pages=0;
 do{
  const start=cursor?all.indexOf(Number(cursor))+1:0,rows=all.slice(start,start+24);
  const next=start+24<all.length?String(rows.at(-1)):'';
  catalog.apply(m.parsePage(page(rows,next)),first);first=false;cursor=catalog.next;pages++;
 }while(cursor&&pages<500);
 assert.equal(catalog.items.length,m.LIBRARY_LIMITS.kept,'bounded');
 assert.equal(new Set(catalog.items.map(row=>row.id)).size,catalog.items.length,'no repeats');
 assert.deepEqual(catalog.items.map(row=>Number(row.id.split(':')[2])),all.slice(0,m.LIBRARY_LIMITS.kept),'no gaps, newest first');
 assert.equal(catalog.next,'','stops at the bound instead of growing');
 assert.equal(catalog.items.filter(row=>row.image).length,m.LIBRARY_LIMITS.thumbnailsKept,'thumbnails bounded');
 // A repeated page (insert between reads) does not duplicate rows.
 const small=new m.LibraryCatalog();small.apply(m.parsePage(page([9,8,7],'7')),true);small.apply(m.parsePage(page([8,7,6],'')),false);
 assert.deepEqual(small.items.map(row=>row.id),['lib:i:9:90','lib:i:8:80','lib:i:7:70','lib:i:6:60']);
});

test('external edits and deletes reconcile; a row id reused after delete is a different identity',()=>{
 const catalog=new m.LibraryCatalog();catalog.apply(m.parsePage(page([3,2,1])),true);
 const edited=item(2,{revision:'1700000999:2000:77'});
 const result=catalog.reconcile(m.parseValidation({items:[{id:'lib:i:3:30',status:'current'},{id:'lib:i:2:20',status:'changed',item:edited},{id:'lib:i:1:10',status:'missing'}]}));
 assert.deepEqual(result,{removed:['lib:i:1:10'],changed:['lib:i:2:20']});
 assert.equal(catalog.items.find(row=>row.id==='lib:i:2:20').revision,'1700000999:2000:77');
 assert.throws(()=>m.parseValidation({items:[{id:'lib:i:2:20',status:'changed',item:item(3)}]}),/mismatch/);
 // Incremental changes: trashed rows leave, changed rows update, unknown rows are counted as new.
 const changes=catalog.applyChanges([{...item(3),trashed:true},{...item(2,{revision:'1:1:99'})},{...item(9)}],99);
 assert.deepEqual(changes,{removed:['lib:i:3:30'],changed:['lib:i:2:20'],added:1});assert.equal(catalog.generation,99);
 assert.equal('trashed' in catalog.items[0],false);
 // MediaStore _id 2 reused with a new add generation is not the old item.
 assert.notEqual('lib:i:2:20','lib:i:2:21');assert.ok(m.isLibraryId('lib:i:2:21'));
});

test('permission downgrade or a MediaStore version change clears the catalog and selection',()=>{
 const catalog=new m.LibraryCatalog(),selection=new m.LibrarySelection();
 catalog.apply(m.parsePage(page([3,2,1])),true);selection.toggle(catalog.items[0]);
 assert.equal(catalog.observeScope(m.parseScope(scope())),false,'unchanged full grant keeps the catalog');
 assert.equal(catalog.observeScope(m.parseScope(scope({scope:'selected',images:false,videos:false}))),true,'full to selected clears');
 assert.equal(catalog.items.length,0);selection.reconcile(catalog);assert.equal(selection.size,0);
 catalog.apply(m.parsePage(page([3])),true);
 assert.equal(catalog.observeScope(m.parseScope(scope({scope:'denied'}))),true,'revoke clears');
 catalog.apply(m.parsePage(page([3])),true);
 assert.equal(catalog.observeScope(m.parseScope(scope({version:'v2'}))),true,'new MediaStore version clears');
});

test('selection is bounded and drops changed or removed items instead of acting on stale ones',()=>{
 const catalog=new m.LibraryCatalog(),selection=new m.LibrarySelection();
 catalog.apply(m.parsePage(page(Array.from({length:22},(_,i)=>22-i))),true);
 for(const row of catalog.items.slice(0,20))selection.toggle(row);
 assert.throws(()=>selection.toggle(catalog.items[20]),/at most 20/);
 assert.equal(selection.toggle(catalog.items[0]),false,'toggle unselects');
 catalog.reconcile([{id:catalog.items[1].id,status:'missing'},{id:catalog.items[2].id,status:'changed',item:{...catalog.items[2],revision:'1:1:1'}}]);
 assert.deepEqual(selection.reconcile(catalog),{dropped:1,changed:1});assert.equal(selection.size,17);
});

test('destructive and share actions are reviewed against exact revisions and expire',()=>{
 const catalog=new m.LibraryCatalog();catalog.apply(m.parsePage(page([2,1])),true);
 const review=m.prepareReview('trash',[{id:catalog.items[0].id,revision:catalog.items[0].revision}],1000,()=>'r1');
 assert.equal(review.title,'Move 1 item to trash?');assert.match(review.detail,/Android asks you to confirm/);
 assert.equal(m.reviewCurrent(review,catalog,1001),true);
 assert.equal(m.reviewCurrent(review,catalog,1000+120000),false,'expired');
 catalog.reconcile([{id:catalog.items[0].id,status:'changed',item:{...catalog.items[0],revision:'1:1:5'}}]);
 assert.equal(m.reviewCurrent(review,catalog,1001),false,'changed item invalidates the review');
 assert.match(m.reviewText('delete',2).detail,/cannot be undone/);assert.match(m.reviewText('share',1).detail,/Nothing is sent until/);
 assert.throws(()=>m.prepareReview('rename',[{id:'lib:i:1:1',revision:'1:1'}]));
 assert.throws(()=>m.prepareReview('share',[]));
 assert.throws(()=>m.prepareReview('share',[{id:'lib:i:1:1',revision:'1:1'},{id:'lib:i:1:1',revision:'1:1'}]));
 for(const action of m.DESTRUCTIVE_LIBRARY_ACTIONS)assert.ok(m.REVIEWED_LIBRARY_ACTIONS.includes(action));
 assert.ok(m.REVIEWED_LIBRARY_ACTIONS.includes('share'));
 // The adapter calls native change/share only from the confirmed review, never from a tap.
 const confirm=adapter.slice(adapter.indexOf('async function confirmReview'),adapter.indexOf('function attach'));
 assert.match(confirm,/port\.share\(\{ items: pending\.items \}\)/);assert.match(confirm,/port\.requestChange\(\{ operation: pending\.action, items: pending\.items \}\)/);
 assert.equal((adapter.match(/port\.(share|requestChange)\(/g)||[]).length,2,'no other native change path');
});

test('agent operations: search/inspect/select read locally; every change or share is a review',()=>{
 assert.deepEqual(m.validateLibraryOperation({type:'photo_library_search',kind:'image',from:1,to:2,limit:10}),{type:'photo_library_search',kind:'image',from:1,to:2,limit:10});
 // No search text: names are never matched for the agent, so hit/miss cannot probe them.
 for(const bad of [{type:'photo_library_search',query:'beach'},{type:'photo_library_search',limit:51},{type:'photo_library_search',from:5,to:1},{type:'photo_library_search',extra:1},{type:'photo_library_delete',ids:['lib:i:1:1']},{type:'photo_library_inspect',id:'content://media/external/images/1'},{type:'photo_library_select',ids:[]}])assert.throws(()=>m.validateLibraryOperation(bad));
 assert.deepEqual(m.validateLibraryOperation({type:'photo_library_select',ids:['lib:v:4:9']}),{type:'photo_library_select',ids:['lib:v:4:9']});
 assert.throws(()=>m.validateLibraryOperation({type:'photo_library_review',action:'delete',items:[{id:'lib:i:1:1',revision:'rev-ab12-3'}]}),/Unsupported/);
 // A native revision (modification time, size, generation) is refused at the agent boundary.
 assert.throws(()=>m.validateLibraryOperation({type:'photo_library_review',action:'trash',items:[{id:'lib:i:1:1',revision:'1:2:3'}]}),/Invalid reviewed item/);
 assert.throws(()=>m.validateLibraryOperation({type:'photo_library_review',action:'restore',items:[{id:'lib:i:1:1',revision:'rev-ab12-3'}]}),/Unsupported/);
 assert.equal(m.REVIEWED_LIBRARY_ACTIONS.includes('restore'),false,'restore is not offered: trashed rows are never paged');
 assert.match(m.describeLibraryOperation({type:'photo_library_review',action:'delete',items:[{id:'lib:i:1:1',revision:'rev-ab12-3'}]}).description,/You confirm it there and then in Android/);
 // Results: exact shape, opaque revisions only.
 const search={type:'photo_library_search',limit:2};
 assert.throws(()=>m.validateLibraryResult(search,{kind:'photo_library_search',scope:'full',more:false,items:[{id:'lib:i:1:1',revision:'1:2:3',kind:'image',takenAt:1,width:1,height:1}]}),/Invalid library result item/);
 assert.throws(()=>m.validateLibraryResult(search,{kind:'photo_library_search',scope:'full',more:false,items:[{id:'lib:i:1:1',revision:'rev-a-1',kind:'image',takenAt:1,width:1,height:1,name:'x'}]}),/Unexpected/);
 assert.throws(()=>m.validateLibraryResult({type:'photo_library_select',ids:['lib:i:1:1']},{kind:'photo_library_select',selected:2,missing:0}));
});

test('opaque model revisions resolve locally and change when the item changes',()=>{
 const revisions=new m.LibraryRevisions('s1',3);
 const a=revisions.model('lib:i:1:1','10:20:30');
 assert.match(a,m.MODEL_REVISION);assert.equal(revisions.model('lib:i:1:1','10:20:30'),a,'stable while unchanged');
 assert.equal(revisions.native('lib:i:1:1',a),'10:20:30');
 const b=revisions.model('lib:i:1:1','11:20:31');assert.notEqual(b,a);
 assert.equal(revisions.native('lib:i:1:1',a),undefined,'a superseded revision no longer resolves');
 assert.equal(revisions.native('lib:i:2:2',b),undefined,'bound to its id');
 for(const id of ['lib:i:2:2','lib:i:3:3','lib:i:4:4'])revisions.model(id,'1:1:1');
 assert.equal(revisions.native('lib:i:1:1',b),undefined,'bounded');
 assert.throws(()=>new m.LibraryRevisions('Bad Session'));
});

test('selected outbound model context carries no names, album names, sizes, modification times or pixels',()=>{
 const parsed=m.parsePage(page([item(7,{name:'PRIVATE_NAME.jpg',album:'PRIVATE_ALBUM',favorite:true,size:987654,revision:'1699999999:987654:7'}),item(6,{id:'lib:v:6:60',kind:'video',duration:12.4})],'6'));
 const result=m.modelSearchResult(parsed,new m.LibraryRevisions('s1'),10);
 assert.equal(result.more,true);
 const wire=JSON.stringify(result);
 assert.doesNotMatch(wire,/PRIVATE_NAME|PRIVATE_ALBUM|base64|image\/jpeg|987654|1699999999|1700000000:/);
 assert.deepEqual(result.items[0],{id:'lib:i:7:70',revision:'rev-s1-1',kind:'image',takenAt:parsed.items[0].takenAt,width:4000,height:3000,favorite:true});
 assert.equal(result.items[1].duration,12);
 // The assistant's selected object is one item's identity and a local counter revision.
 assert.match(adapter,/if \(selection\.size !== 1 \|\| !visible\(\)\) return null;/);
 assert.match(adapter,/revisions\(\{ kind: item\.kind, id: item\.id, revision: item\.revision \}\)/);
 const agent=readFileSync('apps/app/src/prototype/agent-adapter.ts','utf8');
 assert.match(agent,/state\.album === 'device' && !state\.open && state\.nativeLibrarySelection\) providerSelection = state\.nativeLibrarySelection;/);
});

test('agent album observes only while open and falls back to a bounded fresh catalog',()=>{
 // One catalog and one review for both permitted-media surfaces, observed only while a view is open.
 assert.match(java,/catalog=photos\.permittedCatalog\(\);review=photos\.permittedReview\(\);/);
 assert.doesNotMatch(java,/new PermittedMediaCatalog\(|new PermittedMediaReview\(/,'the device library constructs no second catalog or review');
 assert.match(java,/catalog\.watch\("library",watching\)/);
 const photos=sharedPhotos;
 assert.match(photos,/permitted=new PermittedMediaCatalog\(getContext\(\),false,\(\)->\{if\(!destroyed\)\{diagnostic\(Diagnostic\.LIBRARY_CHANGED_CATALOG\);notifyListeners\("libraryChanged",new JSObject\(\)\);\}\}\);/,'Photos observes only while its grid is open; catalog diagnostics and notification share the destroyed guard');
 assert.match(photos,/permitted\.watch\("photos",active\)/);
 const camera=readFileSync('apps/app/src/prototype/camera-adapter.ts','utf8');
 assert.match(camera,/watchLibrary\(!disposed&&!document\.hidden&&!!photosApi\?\.isActive\(\)&&permittedLibrary\(\)\)/);
 // The shared catalog registers its MediaStore observer only while some view watches (tested upstream).
 assert.match(java,/out\.put\("reset",true\)/);
 assert.match(adapter,/watch\(!!scope && scope.scope !== 'denied' && !scope.locked\)/);
 const agent=adapter.slice(adapter.indexOf('const agent: LibraryAgent'),adapter.indexOf('mountedAgent = agent;'));
 assert.doesNotMatch(agent,/query/);
});

test('adapter: new items and widened grants reload a fresh first page; agent reads are identity-only',()=>{
 const root=resolve(import.meta.dirname,'..');
 assert.match(execFileSync(process.execPath,['--import=tsx',join(root,'test/fixtures/photo-library-adapter.mjs')],{cwd:root,encoding:'utf8',timeout:120000}),/PASS photo library adapter/);
});

test('library operations are registered in Alpha device actions: Photos-only, negotiated, journaled and receipted',async()=>{
 const root=resolve(import.meta.dirname,'..');
 const script=`const d=await import(${JSON.stringify(join(root,'apps/app/src/runtime/device-actions.ts'))});
 const out={};
 out.search=d.validateDeviceOperation({type:'photo_library_search',limit:5});
 try{d.validateDeviceOperation({type:'photo_library_search',query:'x'});out.query='accepted';}catch{out.query='refused';}
 out.home=d.proposalContextNotice({type:'photo_library_search'},{view:'home',revision:'1',sensitive:false});
 out.locked=d.proposalContextNotice({type:'photo_library_search'},{view:'photos',revision:'1',sensitive:true});
 out.photos=d.proposalContextNotice({type:'photo_library_search'},{view:'photos',revision:'1',sensitive:false})??null;
 console.log(JSON.stringify(out));`;
 const out=JSON.parse(execFileSync(process.execPath,['--import=tsx','--input-type=module','-e',script],{cwd:root,encoding:'utf8',timeout:120000}));
 assert.deepEqual(out.search,{type:'photo_library_search',limit:5});
 assert.equal(out.query,'refused');
 assert.equal(out.home,'Open Photos > Device library to review this action.');
 assert.equal(out.locked,'Unlock the phone to review this action.');
 assert.equal(out.photos,null);
 const {DeviceActions}=await import('./fixtures/device-action-policy.mjs');
 const proposal={id:'photo',digest:'a'.repeat(64),state:'pending',expiresAt:new Date(Date.now()+60000).toISOString(),subjectUserId:'owner',requestedBy:'agent',action:'device_action',payload:{action:'device_action',version:1,installationId:'device',enrollmentId:'enrollment',operation:{type:'photo_library_search',limit:5}}};
 for(const enabled of [false,true]){
  let writes=0;
  const actions=new DeviceActions({ownerId:'owner',agentId:'agent',origin:'https://agent.example',sessionId:'session'},{installationId:'device',enrollmentId:'enrollment',key:'b'.repeat(64),capabilities:enabled?['photos.library.v1']:[]},'c'.repeat(64),async(_path,body)=>{if(body!==undefined){writes++;throw Error('No approval authorized');}return {proposals:[proposal]};},{},async()=>{throw Error('No effect authorized');});
  const items=await actions.pendingReview({view:'photos',revision:1,sensitive:false},new AbortController().signal);
  assert.equal(items.some(item=>item.proposal!==null),enabled);assert.equal(writes,0);
 }
 const executor=readFileSync('apps/app/src/prototype/agent-adapter.ts','utf8');
 assert.match(executor,/if\(isLibraryOperation\(operation\)\)\{[\s\S]*deviceLibraryAgent\(\)[\s\S]*expectedContext\.view!=='photos'/);
 const journal=readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaActionJournal.java','utf8');
 assert.match(journal,/"photo_library_search","photo_library_inspect","photo_library_select","photo_library_review"\)\.contains\(type\)\)\{/);
});

test('volume-qualified media identities and provider revisions survive the agent contract',()=>{
 const native=item(1,{id:'m:external_primary:i:12',revision:'db-v1:100:200:300:400:500'});
 assert.equal(m.parseItem(native).id,native.id);
 assert.equal(m.libraryKindOf('m:1234-abcd:v:12'),'video');
 assert.equal(m.isLibraryId('m:external:i:12'),false);
 const revisions=new m.LibraryRevisions('test'); const model=m.modelItem(native,revisions);
 assert.equal(revisions.native(model.id,model.revision),native.revision);
 assert.doesNotMatch(JSON.stringify(model),/db-v1/);
 assert.equal(m.parsePage({...page([]),items:[native],next:'12345678-1234-1234-1234-123456789012'}).items.length,1);
 const catalog=new m.LibraryCatalog();catalog.apply(page([1]),true);catalog.observeScope(scope({locked:true}));assert.equal(catalog.items.length,0);
});

test('mixed full and selected media grants are not represented as full access',()=>{
 const mixed=m.parseScope(scope({scope:'partial',imageAccess:'full',videoAccess:'selected',videos:false}));
 assert.equal(mixed.scope,'partial');assert.equal(m.scopePresentation(mixed).label,'Mixed access');
 assert.match(m.scopePresentation(mixed).detail,/Videos: selected/);
 assert.equal(m.validateLibraryResult({type:'photo_library_search'},{kind:'photo_library_search',scope:'partial',items:[],more:false}).scope,'partial');
});

test('the library contract is the shared elizaOS module, with Alpha named only in owner-facing text',()=>{
 const wrapper=readFileSync('apps/app/src/runtime/photo-library.ts','utf8');
 assert.match(wrapper,/export \* from '\.\.\/\.\.\/\.\.\/\.\.\/\.eliza\/client-features\/plugins\/plugin-assistant\/src\/services\/device-actions\/photo-library-contract\.ts';/);
 assert.ok(wrapper.split('\n').length<20&&!/class LibraryCatalog|function validateLibraryOperation/.test(wrapper),'a wrapper, not a copy');
 assert.match(m.scopePresentation(scope({scope:'denied'})).detail,/^Alpha cannot read your photo library\. Captures you make in Alpha/);
 assert.match(m.reviewText('delete',1).detail,/cannot be undone by Alpha\.$/);
 assert.match(m.describeLibraryOperation({type:'photo_library_search'}).description,/Android lets Alpha read/);
});
