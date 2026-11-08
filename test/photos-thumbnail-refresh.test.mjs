import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {readWindow,thumbnailPlan,batches} from '../.eliza/client-features/packages/ui/src/mobile-shell/photos-view.ts';
const source=readFileSync(new URL('../apps/app/src/prototype/camera-adapter.ts',import.meta.url),'utf8');
function declaration(signature){const start=source.indexOf(signature);assert.ok(start>=0);let end=source.indexOf('{',start),depth=1;for(end++;depth;end++){if(source[end]==='{')depth++;if(source[end]==='}')depth--;}return source.slice(start,end);}
const photo=(n,image='')=>({id:'native-camera-'+n,date:n,image,revision:'r1'});
function fixture(rows){
 const requests=[],updates=[],state={open:null,album:null,tab:'lib'};
 const owner={get:()=>state,isActive:()=>true,set:value=>updates.push(value)};
 const context={libraryEpoch:1,photoReadEpoch:1,disposed:false,document:{hidden:false},photosApi:owner,captures:rows,thumbnailPlan,batches,LIBRARY_LIMITS:{thumbnailsKept:240},thumbFetching:new Set(),nativeId:id=>id.replace(/^native-camera-/,''),Date,library:{thumbnails:input=>new Promise((resolve,reject)=>requests.push({input,resolve,reject}))}};
 vm.createContext(context);vm.runInContext(stripTypeScriptTypes(declaration('async function settleThumbnails('),{mode:'transform'}),context);
 return {context,requests,updates,state,owner,settle:(from,to)=>context.settleThumbnails(context.captures,from,to)};
}
test('library refresh keeps rows beyond the previous 240-row reload cap',async()=>{
 const rows=Array.from({length:650},(_,i)=>photo(i)),calls=[];
 const result=await readWindow(async({before})=>{const start=Number(before||0);calls.push(start);return {items:rows.slice(start,start+24),next:start+24<rows.length?String(start+24):''};},{more:false,cursor:'600',loaded:601,limit:10000});
 assert.ok(result.rows.some(row=>row.id==='native-camera-600'));
 assert.equal(calls[0],0);assert.equal(result.rows.length,624);assert.equal(result.next,'624');
});
test('repeated native page cursor fails instead of hanging a library reload',async()=>{
 let calls=0;await assert.rejects(readWindow(async()=>{calls++;return {items:[],next:'same'};},{more:false,cursor:'',loaded:500,limit:10000}),/repeated a cursor/);assert.equal(calls,2);
});
test('thumbnail cache drops distant pixels and reloads them after scrolling back',async()=>{
 const f=fixture(Array.from({length:600},(_,i)=>photo(i,'pixels-'+i)));
 await f.settle(400,424);assert.equal(f.context.captures.filter(row=>row.image).length,240);assert.equal(f.context.captures[0].image,'');assert.equal(f.requests.length,0);
 const pending=f.settle(0,24);assert.equal(f.requests.length,1);assert.equal(f.requests[0].input.ids.length,24);
 f.requests[0].resolve({items:f.requests[0].input.ids.map(id=>({id,image:'fresh-'+id}))});await pending;
 assert.equal(f.context.captures[0].image,'fresh-0');assert.equal(f.context.captures[400].image,'');assert.equal(f.context.thumbFetching.size,0);
});
test('thumbnail reads split at native24 limit and reject unrequested results',async()=>{
 const f=fixture(Array.from({length:60},(_,i)=>photo(i))),pending=f.settle(0,50);
 for(const size of [24,24,2]){const request=f.requests.at(-1);assert.equal(request.input.ids.length,size);request.resolve({items:[...request.input.ids.map(id=>({id,image:'pixels'})),{id:'59',image:'unrequested'}]});await new Promise(resolve=>setImmediate(resolve));}
 await pending;assert.equal(f.requests.length,3);assert.equal(f.context.captures[49].image,'pixels');assert.equal(f.context.captures[59].image,'');
});
for(const reason of ['catalog','hidden','departed','read-retired','disposed','viewer','album'])test(`pending thumbnail result cannot publish after ${reason}`,async()=>{
 const f=fixture([photo(1)]),pending=f.settle(0,1);
 if(reason==='catalog')f.context.libraryEpoch++;
 if(reason==='hidden')f.context.document.hidden=true;
 if(reason==='departed')f.owner.isActive=()=>false;
 if(reason==='read-retired')f.context.photoReadEpoch++;
 if(reason==='disposed')f.context.disposed=true;
 if(reason==='viewer')f.state.open=photo(1).id;
 if(reason==='album')f.state.album='favorites';
 f.requests[0].resolve({items:[{id:'1',image:'stale pixels'}]});await pending;
 assert.equal(f.context.captures[0].image,'');assert.equal(f.context.thumbFetching.size,0);
 if(reason==='catalog'){assert.equal(f.updates.length,1,'current renderer gets a retry after pending ids are released');const retry=f.settle(0,1);assert.equal(f.requests.length,2);f.requests[1].resolve({items:[{id:'1',image:'current pixels'}]});await retry;assert.equal(f.context.captures[0].image,'current pixels');}
});
test('same-window overlapping renders share the pending thumbnail read',async()=>{
 const f=fixture([photo(1)]),pending=f.settle(0,1);await f.settle(0,1);assert.equal(f.requests.length,1);f.requests[0].resolve({items:[]});await pending;assert.equal(f.context.thumbFetching.size,0);
});
test('last-capture reads refresh the Camera album and cannot overwrite a newer capture',async()=>{
 const requests=[],updates=[];const context={lastEpoch:0,lastCapture:photo(1,'old'),disposed:false,document:{hidden:false},libraryAvailable:()=>true,library:{list:input=>new Promise(resolve=>requests.push({input,resolve}))},session:{current:token=>token===4},normalize:row=>({...row,id:'native-camera-'+row.id}),api:{set:value=>updates.push(value)},Date};
 vm.createContext(context);vm.runInContext(stripTypeScriptTypes([declaration('function setLast('),declaration('async function loadLast(')].join('\n'),{mode:'transform'}),context);
 const pending=context.loadLast(4);assert.deepEqual(JSON.parse(JSON.stringify(requests[0].input)),{album:'camera',limit:1});context.setLast(photo(3,'new capture'));requests[0].resolve({items:[{id:'2',image:'old read'}]});await pending;assert.equal(context.lastCapture.image,'new capture');assert.equal(updates.length,0);
 const reload=context.loadLast(4);requests[1].resolve({items:[]});await reload;assert.equal(context.lastCapture,undefined,'deleting the last camera photo clears the tile');
 const hidden=context.loadLast(4);context.document.hidden=true;requests[2].resolve({items:[{id:'2',image:'hidden'}]});await hidden;assert.equal(context.lastCapture,undefined);
});
