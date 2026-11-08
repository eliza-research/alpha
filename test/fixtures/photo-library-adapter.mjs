// Run with `node --import=tsx` from test/photo-library.test.mjs. Drives the Photos device
// library adapter against an in-memory port: no Android, no MediaStore, no device.
import assert from 'node:assert/strict';
const {createDeviceLibrary,deviceLibraryAgent,LibraryAgentRefusal}=await import('../../apps/app/src/prototype/photo-library-adapter.ts');
const lib=await import('../../apps/app/src/runtime/photo-library.ts');

const tick=async(n=6)=>{for(let i=0;i<n;i++)await new Promise(resolve=>setTimeout(resolve,0));};
const item=row=>({id:`lib:i:${row}:${row*10}`,revision:`${1700000000+row}:${123456+row}:${row}`,kind:'image',mime:'image/jpeg',name:`IMG_${row}.jpg`,album:'Camera',width:400,height:300,takenAt:1700000000000+row,modifiedAt:1700000000000,size:123456+row,duration:0,favorite:false,owned:false,image:''});
function fakePort(){
 const state={rows:[3,2,1],scope:'full',version:'v1',pages:[],requested:0,watch:[],listeners:{}};
 const scope=()=>({scope:state.scope,images:state.scope==='full',videos:state.scope==='full',canSelectMore:state.scope==='selected',canEditOthers:true,locked:false,version:state.version});
 const port={
  async scope(){return scope();},async requestAccess(){return scope();},
  async page(options){state.pages.push(options);const after=state.rows.filter(row=>!options.before||row<Number(options.before)),rows=after.slice(0,options.limit);return {...scope(),items:rows.map(item),next:after.length>rows.length?String(rows.at(-1)):'',generation:1};},
  async inspect({id}){const row=state.rows.find(r=>item(r).id===id);if(!row)throw Object.assign(Error('missing'),{code:'LIBRARY_MISSING'});return item(row);},
  async validate({items}){return {...scope(),items:items.map(entry=>({id:entry.id,status:state.rows.some(r=>item(r).id===entry.id)?'current':'missing'}))};},
  async requestChange(options){state.requested++;if(!state.change)throw Error('not in this fixture');return state.change(options);},async share(){throw Error('not in this fixture');},
  async watch({active}){state.watch.push(active);return {active};},
  async addListener(event,listener){state.listeners[event]=listener;return {remove:async()=>{}};},
 };
 return {state,port};
}
const fakeApi=()=>{const store={photos:{album:'device'}};return {store,api:{get:name=>store[name],set(){},isActive:()=>true}};};

// 1. A library change reloads a fresh first page (native changes() always resets) instead of waiting for a restart.
{
 const {state,port}=fakePort(),{api}=fakeApi(),library=createDeviceLibrary(port,()=>true);
 library.tile(api);library.album({},api);await tick();
 assert.deepEqual(library.album({},api).items.map(row=>row.nativeMediaId),['lib:i:3:30','lib:i:2:20','lib:i:1:10']);
 assert.deepEqual(state.watch,[true],'observer starts only with the album open');
 state.rows=[4,3,2,1];
 const before=state.pages.length;
 library.tile(api).open();await tick();
 assert.equal(state.pages.length,before+1,'a fresh page is read');
 assert.equal(state.pages.at(-1).before,'','from the first page');
 const view=library.album({},api);
 assert.equal(view.items[0].nativeMediaId,'lib:i:4:40','the new item appears without a restart');
 assert.equal(view.more,true);assert.equal(view.moreLabel,'Reload','an explicit reload is always available');
 // 2. Leaving Photos stops the observer and the next visit starts from a fresh first page.
 library.leave();assert.equal(state.watch.at(-1),false);
 state.rows=[5,4,3,2,1];
 const visits=state.pages.length;library.tile(api).open();await tick();
 assert.equal(state.pages.length,visits+1);assert.equal(library.album({},api).items[0].nativeMediaId,'lib:i:5:50');
 library.dispose();
}

// 3. A grant widened in Settings while Photos is not showing the album reloads on the next visit.
{
 const {state,port}=fakePort(),{store,api}=fakeApi();state.scope='selected';state.rows=[2];
 const library=createDeviceLibrary(port,()=>true);
 library.tile(api);library.album({},api);await tick();
 assert.deepEqual(library.album({},api).items.map(row=>row.nativeMediaId),['lib:i:2:20']);
 store.photos={album:null};
 state.scope='full';state.rows=[3,2,1];
 state.listeners.scopeChanged({...await port.scope(),previous:'selected'});await tick();
 store.photos={album:'device'};
 const before=state.pages.length;library.tile(api).open();await tick();
 assert.equal(state.pages.length,before+1,'widened scope reads a fresh page');
 assert.deepEqual(library.album({},api).items.map(row=>row.nativeMediaId),['lib:i:3:30','lib:i:2:20','lib:i:1:10']);
 library.dispose();
}

// 4. Agent operations: identity-only rows with opaque revisions; review opens the in-app review.
{
 const {state,port}=fakePort(),{store,api}=fakeApi(),library=createDeviceLibrary(port,()=>true);
 assert.equal(deviceLibraryAgent(),library.agent);
 library.tile(api);library.album({},api);await tick();
 const signal=new AbortController().signal;
 const search=await library.agent.run(lib.validateLibraryOperation({type:'photo_library_search',limit:2}),signal);
 const op={type:'photo_library_search',limit:2};
 assert.deepEqual(lib.validateLibraryResult(op,search),search);
 assert.equal(state.pages.at(-1).thumbnails,false,'agent reads carry no thumbnails');
 assert.equal('query' in state.pages.at(-1),false,'agent search never matches names');
 const wire=JSON.stringify(search);
 assert.doesNotMatch(wire,/IMG_|Camera|base64|12345[0-9]|170000000[0-9]:/,'no names, sizes or modification times');
 assert.match(search.items[0].revision,lib.MODEL_REVISION);
 const inspected=await library.agent.run({type:'photo_library_inspect',id:'lib:i:3:30'},signal);
 assert.equal(inspected.item.revision,search.items[0].revision,'same item, same opaque revision');
 await assert.rejects(library.agent.run({type:'photo_library_inspect',id:'lib:i:9:90'},signal),LibraryAgentRefusal);
 // Native revisions are refused at the boundary; opaque ones resolve locally.
 assert.throws(()=>lib.validateLibraryOperation({type:'photo_library_review',action:'trash',items:[{id:'lib:i:3:30',revision:item(3).revision}]}),/Invalid reviewed item/);
 const review=lib.validateLibraryOperation({type:'photo_library_review',action:'trash',items:[{id:'lib:i:3:30',revision:search.items[0].revision}]});
 assert.deepEqual(await library.agent.run(review,signal),{kind:'photo_library_review',status:'review_opened',action:'trash',count:1});
 const view=library.album({},api);
 assert.equal(view.dev.reviewing,true);assert.equal(view.dev.reviewTitle,'Move 1 item to trash?');
 view.dev.cancel();
 await assert.rejects(library.agent.run({type:'photo_library_review',action:'trash',items:[{id:'lib:i:3:30',revision:'rev-zz-999'}]},signal),/changed since/);
 const selected=await library.agent.run({type:'photo_library_select',ids:['lib:i:3:30','lib:i:9:90']},signal);
 assert.deepEqual(selected,{kind:'photo_library_select',selected:1,missing:1});
 // Select and review need the owner-visible album.
 store.photos={album:null};
 await assert.rejects(library.agent.run({type:'photo_library_select',ids:['lib:i:3:30']},signal),/Open Photos > Device library/);
 // Denied scope refuses everything.
 state.scope='denied';
 await assert.rejects(library.agent.run({type:'photo_library_search'},signal),/not allowed/);
 library.dispose();
 assert.equal(deviceLibraryAgent(),undefined);
}
// 5. The adapter reads the real native change contract (PermittedMediaReview): resolved
//    {status:'complete'|'partial',outcomes:[...]}, rejected LIBRARY_DECLINED / LIBRARY_STALE.
{
 const rejection=(message,code)=>()=>{throw Object.assign(Error(message),{code});};
 for(const [name,change,expected,revalidates] of [
  ['complete',()=>({status:'complete',outcomes:[{id:'lib:i:3:30',status:'trashed'}]}),/^1 item changed and verified\. /,true],
  ['partial',()=>({status:'partial',outcomes:[{id:'lib:i:3:30',status:'stale'}]}),/^0 of 1 changes verified; 1 changed elsewhere and was skipped\./,true],
  ['unverified',()=>({status:'partial',outcomes:[{id:'lib:i:3:30',status:'unverified'}]}),/^0 of 1 changes verified\./,true],
  ['declined',rejection('Photo change cancelled. No change was dispatched.','LIBRARY_DECLINED'),/^Android review was cancelled\. Nothing changed\. /,false],
  ['stale',rejection('Selected media changed or is unavailable. Refresh Photos.','LIBRARY_STALE'),/^An item changed before Android review\. Nothing changed; review again\. /,true],
  ['other',rejection('Finish the current photo review first.','LIBRARY_BUSY'),/^The action could not be completed\./,false],
 ]){
  const {state,port}=fakePort(),{api}=fakeApi(),library=createDeviceLibrary(port,()=>true);
  library.tile(api);library.album({},api);await tick();
  const signal=new AbortController().signal,search=await library.agent.run({type:'photo_library_search',limit:1},signal);
  await library.agent.run(lib.validateLibraryOperation({type:'photo_library_review',action:'trash',items:[{id:'lib:i:3:30',revision:search.items[0].revision}]}),signal);
  state.change=change;const pages=state.pages.length;
  library.album({},api).dev.confirm();await tick(10);
  assert.equal(state.requested,1,name);assert.match(library.album({},api).status,expected,name);
  assert.equal(state.pages.length>pages,revalidates,name+' revalidation');
  library.dispose();
 }
}
// Delayed reads from an earlier visit/grant must never mutate the new catalog.
for (const operation of ['page', 'validate']) {
 const {state,port}=fakePort(),{api}=fakeApi(),library=createDeviceLibrary(port,()=>true);
 library.tile(api);library.album({},api);await tick();
 library.album({},api).items[0].tap();
 let complete;
 const original=port[operation];
 port[operation]=()=>new Promise(resolve=>{complete=resolve;});
 state.listeners.libraryChanged();await tick();
 assert.equal(typeof complete,'function',operation+' read started');
 library.leave();port[operation]=original;
 state.rows=[4,3,2,1];library.tile(api).open();await tick();
 complete(operation==='page'?{scope:'full',images:true,videos:true,canSelectMore:false,canEditOthers:true,locked:false,version:'v1',items:[item(9)],next:'',generation:1}:{items:[{id:item(3).id,status:'missing'}]});
 await tick();
 assert.deepEqual(library.album({},api).items.map(row=>row.nativeMediaId),state.rows.map(row=>item(row).id),operation+' cannot remove a fresh item after reopen');
 library.dispose();
}
{
 const {state,port}=fakePort(),{api}=fakeApi(),library=createDeviceLibrary(port,()=>true);
 let complete;
 const page=port.page;
 port.page=async options=>{const snapshot=await page(options);return new Promise(resolve=>{complete=()=>resolve(snapshot);});};
 library.tile(api);library.album({},api);await tick();
 assert.equal(typeof complete,'function','page started before revoke');
 state.scope='denied';state.listeners.scopeChanged(await port.scope());await tick();
 complete();await tick();
 const view=library.album({},api);
 assert.equal(view.count,'Not allowed');assert.equal(view.items.length,0,'pre-revocation page cannot restore removed media');
 library.dispose();
}
{
 const {state,port}=fakePort(),{api}=fakeApi(),library=createDeviceLibrary(port,()=>true);
 let reject;
 const page=port.page;
 port.page=()=>new Promise((resolve,fail)=>{reject=fail;});
 library.tile(api);library.album({},api);await tick();
 assert.equal(typeof reject,'function','old page pending');
 library.leave();port.page=page;state.rows=[4,3,2,1];library.tile(api).open();await tick();
 reject(Object.assign(Error('old grant denied'),{code:'LIBRARY_DENIED'}));await tick();
 assert.deepEqual(library.album({},api).items.map(row=>row.nativeMediaId),state.rows.map(row=>item(row).id),'an old denial must not clear a fresh catalog');
 library.dispose();
}
// 6. Every resume posts scopeChanged with a new version. An unchanged grant keeps loaded selections
//    that still validate, says nothing about access, and turns the paused observer on again.
{
 const {state,port}=fakePort(),{api}=fakeApi();state.rows=Array.from({length:30},(_,i)=>30-i);
 const library=createDeviceLibrary(port,()=>true);
 library.tile(api);library.album({},api);await tick();
 library.album({},api).loadMore();await tick();
 let view=library.album({},api);assert.equal(view.items.length,30,'two pages loaded');
 view.items[0].tap();view.items[27].tap();
 const watches=state.watch.length;
 state.version='v2';state.listeners.scopeChanged(await port.scope());await tick(10);
 view=library.album({},api);
 assert.deepEqual(view.items.filter(row=>row.on).map(row=>row.nativeMediaId),[item(30).id,item(3).id],'selections on both pages survive');
 assert.doesNotMatch(view.status,/access changed|unselected/);
 assert.equal(state.watch.length,watches+1,'the next render turns the observer on again');assert.equal(state.watch.at(-1),true);
 // A selected item that left the library is unselected; the rest stay.
 state.rows=state.rows.filter(row=>row!==3);state.version='v3';state.listeners.scopeChanged(await port.scope());await tick(10);
 view=library.album({},api);
 assert.deepEqual(view.items.filter(row=>row.on).map(row=>row.nativeMediaId),[item(30).id]);
 assert.match(view.status,/unselected/);
 // The library-changed reset path keeps selections that are still current.
 state.listeners.libraryChanged();await tick(10);
 assert.deepEqual(library.album({},api).items.filter(row=>row.on).map(row=>row.nativeMediaId),[item(30).id]);
 // A narrowed grant still clears the selection and says so.
 state.scope='selected';state.listeners.scopeChanged(await port.scope());await tick(10);
 view=library.album({},api);
 assert.equal(view.items.filter(row=>row.on).length,0);assert.match(view.status,/Library access changed in Android\./);
 library.dispose();
}
// 7. An approved agent read during a concurrent load or resume is not refused as "not allowed".
{
 const {state,port}=fakePort(),{api}=fakeApi(),library=createDeviceLibrary(port,()=>true);
 library.tile(api);library.album({},api);await tick();
 const scope=port.scope;let release;
 port.scope=()=>new Promise(resolve=>{release=()=>resolve(scope());port.scope=scope;});
 const run=library.agent.run({type:'photo_library_search',limit:2},new AbortController().signal);
 await tick();assert.equal(typeof release,'function','agent scope read pending');
 state.version='v2';state.listeners.scopeChanged(await scope());release();
 const result=await run;
 assert.equal(result.items.length,2);
 library.dispose();
}
console.log('PASS photo library adapter');
