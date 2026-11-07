// Run with `node --import=tsx` from test/photo-library.test.mjs. Drives the Photos agent bridge
// against an in-memory port and a fake main Library host: no Android, no MediaStore, no device.
// Catalog paging, change reconciliation and scope rules are tested directly on LibraryCatalog in
// test/photo-library.test.mjs; the grid's own window/patch rules in test/photos-view.test.mjs.
import assert from 'node:assert/strict';
const {createDeviceLibrary,deviceLibraryAgent,LibraryAgentRefusal,setMainLibraryHost}=await import('../../apps/app/src/prototype/photo-library-adapter.ts');
const lib=await import('../../apps/app/src/runtime/photo-library.ts');

const tick=async(n=6)=>{for(let i=0;i<n;i++)await new Promise(resolve=>setTimeout(resolve,0));};
const item=row=>({id:`lib:i:${row}:${row*10}`,revision:`${1700000000+row}:${123456+row}:${row}`,kind:'image',mime:'image/jpeg',name:`IMG_${row}.jpg`,album:'Camera',width:400,height:300,takenAt:1700000000000+row,modifiedAt:1700000000000,size:123456+row,duration:0,favorite:false,owned:false,image:''});
function fakePort(){
 const state={rows:[3,2,1],scope:'full',pages:[],changes:{reset:false,items:[],generation:0},watch:[],listeners:{}};
 const scope=()=>({scope:state.scope,images:state.scope==='full',videos:state.scope==='full',canSelectMore:state.scope==='selected',canEditOthers:true,locked:false,version:'v1'});
 const port={
  async scope(){return scope();},
  async page(options){state.pages.push(options);const rows=state.rows.filter(row=>!options.before||row<Number(options.before)).slice(0,options.limit);return {...scope(),items:rows.map(item),next:'',generation:40};},
  async inspect({id}){const row=state.rows.find(r=>item(r).id===id);if(!row)throw Object.assign(Error('missing'),{code:'LIBRARY_MISSING'});return item(row);},
  async validate({items}){return {...scope(),items:items.map(entry=>({id:entry.id,status:state.rows.some(r=>item(r).id===entry.id)?'current':'missing'}))};},
  async requestChange(options){state.changes.requested=(state.changes.requested||0)+1;if(!state.change)throw Error('not in this fixture');return state.change(options);},
  async share(options){state.shared=(state.shared||[]).concat([options.items]);return {status:'opened',count:options.items.length};},
 };
 return {state,port};
}
/** The main Photos Library (camera-adapter's host): records what the agent asked of it. */
function fakeHost(){
 const host={visible:true,changes:0,trashed:[],calls:[]};
 host.release=setMainLibraryHost({visible:()=>host.visible,reviewOpen:()=>!!host.pending,reviewChanged:()=>{host.changes++;},trashed:ids=>host.trashed.push(...ids),
  async run(operation){host.calls.push(operation);
   if(operation.type==='photos_filter')return {kind:'photos_filter',shown:2,more:false};
   if(operation.type==='photos_open')return {kind:'photos_open',opened:operation.id==='lib:i:3:30'};
   if(operation.type==='photo_library_select')return {kind:'photo_library_select',selected:operation.ids.length,missing:0};
   return {kind:operation.type,status:'review_opened',count:operation.ids.length,missing:0};}});
 return host;
}

// 4. Agent operations: identity-only rows with opaque revisions; reviews open over the main Library.
{
 const {state,port}=fakePort(),host=fakeHost(),library=createDeviceLibrary(port,()=>true);
 assert.equal(deviceLibraryAgent(),library.agent);
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
 assert.equal(library.reviewCard().title,'Move 1 item to trash?');assert.ok(host.changes>0,'the host re-renders');
 await assert.rejects(library.agent.run({type:'photo_library_select',ids:['lib:i:3:30']},signal),/Finish the open review/);
 await assert.rejects(library.agent.runView({type:'photos_share',ids:['lib:i:3:30']},signal),/Finish the open review/);
 library.reviewCard().cancel();assert.equal(library.reviewCard(),undefined);
 await assert.rejects(library.agent.run({type:'photo_library_review',action:'trash',items:[{id:'lib:i:3:30',revision:'rev-zz-999'}]},signal),/changed since/);
 const selected=await library.agent.run({type:'photo_library_select',ids:['lib:i:3:30','lib:i:9:90']},signal);
 assert.deepEqual(selected,{kind:'photo_library_select',selected:2,missing:0});
 // Select and review need Photos on screen.
 host.visible=false;
 await assert.rejects(library.agent.run({type:'photo_library_select',ids:['lib:i:3:30']},signal),/Open Photos, then ask again/);
 host.visible=true;
 // Denied scope refuses every library read and change.
 state.scope='denied';
 await assert.rejects(library.agent.run({type:'photo_library_search'},signal),/not allowed/);
 host.release();library.dispose();
 assert.equal(deviceLibraryAgent(),undefined);
}
// 5. The adapter reads the real native change contract (PermittedMediaReview): resolved
//    {status:'complete'|'partial',outcomes:[...]}, rejected LIBRARY_DECLINED / LIBRARY_STALE.
{
 const rejection=(message,code)=>()=>{throw Object.assign(Error(message),{code});};
 for(const [name,change,expected,undo] of [
  ['complete',()=>({status:'complete',outcomes:[{id:'lib:i:3:30',status:'trashed'}]}),/^$/,['lib:i:3:30']],
  ['partial',()=>({status:'partial',outcomes:[{id:'lib:i:3:30',status:'stale'}]}),/^0 of 1 changes verified; 1 changed elsewhere and was skipped\.$/,[]],
  ['unverified',()=>({status:'partial',outcomes:[{id:'lib:i:3:30',status:'unverified'}]}),/^0 of 1 changes verified\.$/,[]],
  ['declined',rejection('Photo change cancelled. No change was dispatched.','LIBRARY_DECLINED'),/^Nothing changed\.$/,[]],
  ['stale',rejection('Selected media changed or is unavailable. Refresh Photos.','LIBRARY_STALE'),/^An item changed\. Nothing changed; review again\.$/,[]],
  ['other',rejection('Finish the current photo review first.','LIBRARY_BUSY'),/^The action could not be completed\.$/,[]],
 ]){
  const {state,port}=fakePort(),host=fakeHost(),library=createDeviceLibrary(port,()=>true);
  const signal=new AbortController().signal,search=await library.agent.run({type:'photo_library_search',limit:1},signal);
  await library.agent.run(lib.validateLibraryOperation({type:'photo_library_review',action:'trash',items:[{id:'lib:i:3:30',revision:search.items[0].revision}]}),signal);
  state.change=change;
  library.reviewCard().confirm();await tick(10);
  assert.equal(state.changes.requested,1,name);assert.match(library.takeStatus(),expected,name);
  assert.deepEqual(host.trashed,undo,name+' undo offered only for verified moves');
  host.release();library.dispose();
 }
}
// 6. View requests (photos.view.v1) act on the main Library; album and share reviews open there.
{
 const {state,port}=fakePort(),host=fakeHost(),library=createDeviceLibrary(port,()=>true);
 const signal=new AbortController().signal;
 // The filter is read-only and needs no device library at all, even without scope.
 state.scope='denied';
 assert.deepEqual(await library.agent.runView({type:'photos_filter',kind:'video'},signal),{kind:'photos_filter',shown:2,more:false});
 assert.equal(state.changes.requested,undefined,'a filter requests no change');
 assert.deepEqual(await library.agent.runView({type:'photos_open',id:'lib:i:3:30'},signal),{kind:'photos_open',opened:true});
 assert.deepEqual(await library.agent.runView({type:'photos_open',id:'lib:i:9:90'},signal),{kind:'photos_open',opened:false});
 assert.deepEqual(await library.agent.runView({type:'photos_album_create',name:'Trip',ids:['lib:i:3:30']},signal),{kind:'photos_album_create',status:'review_opened',count:1,missing:0});
 assert.deepEqual(await library.agent.runView({type:'photos_share',ids:['lib:i:3:30','lib:i:2:20']},signal),{kind:'photos_share',status:'review_opened',count:2,missing:0});
 assert.deepEqual(host.calls.map(call=>call.type),['photos_filter','photos_open','photos_open','photos_album_create','photos_share']);
 assert.equal(state.shared,undefined,'nothing is shared before the owner confirms in Photos');
 state.scope='full';
 // While the host's album or share review waits, no second review opens.
 host.pending=true;
 await assert.rejects(library.agent.run({type:'photo_library_select',ids:['lib:i:3:30']},signal),/Finish the open review/);
 host.pending=false;
 // A review binds the revisions the assistant read; the provider confirms they are current before it opens.
 const search=await library.agent.run({type:'photo_library_search',limit:3},signal);
 // Stale before approval (NoActionOnStaleRev): an item changed after review applies nothing.
 const again=await library.agent.run(lib.validateLibraryOperation({type:'photo_library_review',action:'favorite',items:[{id:'lib:i:2:20',revision:search.items[1].revision}]}),signal);
 assert.equal(again.status,'review_opened');
 state.rows=state.rows.filter(row=>row!==2);
 library.reviewCard().confirm();await tick(10);
 assert.equal(state.changes.requested,undefined,'no Android request for a stale review');assert.equal(library.reviewCard(),undefined);
 assert.match(library.takeStatus(),/changed/);
 // A review the provider no longer validates never opens.
 await assert.rejects(library.agent.run(lib.validateLibraryOperation({type:'photo_library_review',action:'trash',items:[{id:'lib:i:2:20',revision:search.items[1].revision}]}),signal),LibraryAgentRefusal);
 // A reviewed share opens Android's share sheet with exactly the reviewed items.
 await library.agent.run(lib.validateLibraryOperation({type:'photo_library_review',action:'share',items:[{id:'lib:i:3:30',revision:search.items[0].revision}]}),signal);
 library.reviewCard().confirm();await tick(10);
 assert.equal(state.shared.length,1);assert.equal(state.shared[0][0].id,'lib:i:3:30');
 // Photos not showing: everything is refused, including the read-only filter.
 host.visible=false;
 await assert.rejects(library.agent.runView({type:'photos_filter'},signal),/Open Photos/);
 await assert.rejects(library.agent.runView({type:'photos_open',id:'lib:i:3:30'},signal),/Open Photos/);
 await assert.rejects(library.agent.run({type:'photo_library_select',ids:['lib:i:1:10']},signal),/Open Photos/);
 // No Library mounted at all: refused, never acted on elsewhere.
 host.release();
 await assert.rejects(library.agent.runView({type:'photos_filter'},signal),/Open Photos/);
 library.dispose();
}
console.log('PASS photo library adapter');
