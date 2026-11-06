import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
// Photos view agent tools (design/view-refresh-2026-11/PLAN.md section 2). Source-level: the phone
// mirror of the proposed upstream photos-view-contract (patches/eliza/photos-view-agent.patch).
const m=await import('../apps/app/src/runtime/photos-view-contract.ts');
const {LIBRARY_LIMITS}=await import('../apps/app/src/runtime/photo-library.ts');
const id=(n,kind='i')=>`lib:${kind}:${n}:${n*10}`;
const ids=count=>Array.from({length:count},(_,i)=>id(i+1));
const v=m.validatePhotosViewOperation;

test('types, direct types, albums and capability',()=>{
  assert.equal(m.PHOTOS_VIEW_CAPABILITY,'photos.view.v1');
  assert.deepEqual([...m.PHOTOS_VIEW_TYPES],['photos_filter','photos_open','photos_album_create','photos_share']);
  assert.deepEqual([...m.PHOTOS_VIEW_DIRECT_TYPES],['photos_filter','photos_open']);
  assert.deepEqual([...m.PHOTOS_FILTER_ALBUMS],['favorites','videos','camera','screenshots']);
  for(const type of m.PHOTOS_VIEW_TYPES)assert.equal(m.isPhotosViewOperation({type}),true);
  for(const value of [{type:'photo_library_select'},{type:'photos_trash'},null,'photos_open'])assert.equal(m.isPhotosViewOperation(value),false);
  assert.equal(m.photosViewCapabilityAvailable(['photos.library.v1','photos.view.v1']),true);
  for(const caps of [['photos.library.v1'],['photos.view.v1'],[],undefined])assert.equal(m.photosViewCapabilityAvailable(caps),false);
  assert.throws(()=>v({type:'photos_trash',ids:[id(1)]}),/Unsupported Photos operation/);
  assert.throws(()=>v([]),/Invalid Photos operation/);
});

test('photos_filter validation',()=>{
  assert.deepEqual(v({type:'photos_filter'}),{type:'photos_filter'});
  const full={type:'photos_filter',from:0,to:1_700_000_000_000,kind:'video',favorite:false,album:'custom:trip_2026-a',text:'beach'};
  assert.deepEqual(v(full),full);
  for(const album of m.PHOTOS_FILTER_ALBUMS)assert.deepEqual(v({type:'photos_filter',album}),{type:'photos_filter',album});
  assert.equal(v({type:'photos_filter',text:'x'.repeat(LIBRARY_LIMITS.query)}).text.length,LIBRARY_LIMITS.query);
  for(const from of [-1,1.5,'1',Number.MAX_SAFE_INTEGER+1,Number.NaN])assert.throws(()=>v({type:'photos_filter',from}),/Invalid filter date/);
  assert.throws(()=>v({type:'photos_filter',from:2,to:1}),/Invalid filter date range/);
  assert.throws(()=>v({type:'photos_filter',kind:'all'}),/Invalid filter kind/);
  assert.throws(()=>v({type:'photos_filter',favorite:'yes'}),/Invalid favorites filter/);
  for(const album of ['Favorites','custom:','custom:a b',`custom:${'a'.repeat(81)}`,3])assert.throws(()=>v({type:'photos_filter',album}),/Invalid filter album/);
  for(const text of ['x'.repeat(LIBRARY_LIMITS.query+1),'a\nb','a\u007f',7])assert.throws(()=>v({type:'photos_filter',text}),/Invalid filter text/);
  assert.throws(()=>v({type:'photos_filter',favorites:true}),/Unexpected Photos field/);
});

test('photos_open, photos_album_create and photos_share validation',()=>{
  assert.deepEqual(v({type:'photos_open',id:id(4,'v')}),{type:'photos_open',id:id(4,'v')});
  for(const bad of ['4','lib:x:1:1','m:external:i:1',undefined])assert.throws(()=>v({type:'photos_open',id:bad}),/Invalid library id/);
  assert.throws(()=>v({type:'photos_open',id:id(1),ids:[]}),/Unexpected Photos field/);
  assert.deepEqual(v({type:'photos_album_create',name:'  Trip  ',ids:[id(1)]}),{type:'photos_album_create',name:'Trip',ids:[id(1)]});
  assert.equal(v({type:'photos_album_create',name:'a'.repeat(80),ids:[id(1)]}).name,'a'.repeat(80));
  assert.equal(v({type:'photos_album_create',name:'All',ids:ids(LIBRARY_LIMITS.kept)}).ids.length,LIBRARY_LIMITS.kept);
  for(const name of ['','   ','a'.repeat(81),'a\tb',1,undefined])assert.throws(()=>v({type:'photos_album_create',name,ids:[id(1)]}),/Choose an album name between 1 and 80 characters/);
  for(const bad of [[],[id(1),id(1)],['x'],ids(LIBRARY_LIMITS.kept+1),'x'])assert.throws(()=>v({type:'photos_album_create',name:'Trip',ids:bad}),/Invalid album items/);
  assert.deepEqual(v({type:'photos_share',ids:[id(1),id(2,'v')]}),{type:'photos_share',ids:[id(1),id(2,'v')]});
  assert.equal(v({type:'photos_share',ids:ids(100)}).ids.length,100);
  for(const bad of [[],[id(1),id(1)],['x'],ids(101)])assert.throws(()=>v({type:'photos_share',ids:bad}),/Invalid share items/);
  assert.throws(()=>v({type:'photos_share',ids:[id(1)],target:'mail'}),/Unexpected Photos field/);
});

test('review text is short and names Photos',()=>{
  const d=m.describePhotosViewOperation;
  assert.deepEqual(d({type:'photos_filter'}),{title:'Filter Photos',description:'Everything'});
  assert.deepEqual(d({type:'photos_filter',kind:'video',favorite:true,album:'camera',text:'beach',from:1}),{title:'Filter Photos',description:'Videos · Favorites · In Camera · “beach” · In the requested dates'});
  assert.deepEqual(d({type:'photos_open',id:id(1)}),{title:'Open photo',description:'In Photos. Nothing is changed or shared.'});
  assert.equal(d({type:'photos_open',id:id(1,'v')}).title,'Open video');
  assert.deepEqual(d({type:'photos_album_create',name:'Trip',ids:[id(1),id(2)]}),{title:'Create album “Trip”',description:'2 items. You confirm it in Photos.'});
  assert.deepEqual(d({type:'photos_share',ids:[id(1)]}),{title:'Share 1 item',description:"You confirm it in Photos, then pick where it goes in Android's share sheet. Nothing leaves Alpha before that."});
});

test('results are validated exactly',()=>{
  const r=m.validatePhotosViewResult,filter={type:'photos_filter'},open={type:'photos_open',id:id(1)};
  assert.deepEqual(r(filter,{kind:'photos_filter',shown:0,more:false}),{kind:'photos_filter',shown:0,more:false});
  for(const bad of [{kind:'photos_filter',shown:-1,more:false},{kind:'photos_filter',shown:1.5,more:false},{kind:'photos_filter',shown:1},{kind:'photos_filter',shown:1,more:true,items:[]},{kind:'photos_open',opened:true},null])assert.throws(()=>r(filter,bad));
  assert.deepEqual(r(open,{kind:'photos_open',opened:false}),{kind:'photos_open',opened:false});
  assert.throws(()=>r(open,{kind:'photos_open',opened:1}),/Invalid photos open result/);
  for(const op of [{type:'photos_album_create',name:'Trip',ids:[id(1),id(2)]},{type:'photos_share',ids:[id(1),id(2)]}]){
    const row={kind:op.type,status:'review_opened',count:1,missing:1};
    assert.deepEqual(r(op,row),row);
    for(const bad of [{...row,count:0,missing:2},{...row,count:2,missing:1},{...row,status:'done'},{...row,ids:[]}])assert.throws(()=>r(op,bad));
  }
});

test('review only in Photos on the unlocked phone',()=>{
  assert.equal(m.photosViewContextAllowed({view:'photos'}),true);
  assert.equal(m.photosViewContextAllowed({view:'photos',sensitive:true}),false);
  assert.equal(m.photosViewContextAllowed({view:'home'}),false);
});

test('the mirror keeps the upstream rules: same constants and messages as the proposed patch',()=>{
  const patch=readFileSync(new URL('../patches/eliza/photos-view-agent.patch',import.meta.url),'utf8');
  for(const text of ['"photos.view.v1"','/^custom:[A-Za-z0-9_-]{1,80}$/','PHOTOS_SHARE_MAX = 100','Choose an album name between 1 and 80 characters','Invalid album items','Invalid share items','Invalid filter text','In Photos. Nothing is changed or shared.','You confirm it in Photos.',"then pick where it goes in Android's share sheet. Nothing leaves ${appName} before that."])assert.ok(patch.includes(text),text);
});
