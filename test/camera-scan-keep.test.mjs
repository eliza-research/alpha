import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {tsImport} from 'tsx/esm/api';
const {createScanCapture}=await tsImport(new URL('../.eliza/client-features/plugins/plugin-native-camera/src/scan-document.ts',import.meta.url).href,{parentURL:import.meta.url});
const source=readFileSync(resolve(import.meta.dirname,'../apps/app/src/prototype/camera-adapter.ts'),'utf8');
function declaration(signature){const start=source.indexOf(signature);assert.ok(start>=0,signature);let end=source.indexOf('{',start),depth=1;for(end++;depth;end++){if(source[end]==='{')depth++;if(source[end]==='}')depth--;}return source.slice(start,end);}
function run(signature,name,sandbox){vm.createContext(sandbox);vm.runInContext(stripTypeScriptTypes(declaration(signature)+`\nglobalThis.${name}=${name};`,{mode:'strip'}),sandbox);return sandbox[name];}

function nativeKeep(answers){
 const calls=[];
 const sandbox={browserMode:false,loaded:true,captures:[],library:{keepCapture:async options=>{calls.push(options.operationId);return answers.shift();}}};
 const keepScan=run('async function keepScan(','keepScan',sandbox);
 const owner={setView(){}};
 return {calls,scan:createScanCapture({base64:'AA=='},'unsaved',(page,operationId,signal)=>keepScan(page,operationId,signal,owner))};
}
test('an unknown native Keep is retried under the same operation identity',async()=>{
 const {calls,scan}=nativeKeep([{status:'unknown',message:'Photo save could not be confirmed.'},{status:'saved',id:'7'}]);
 assert.deepEqual({...await scan.keep()},{status:'unknown',message:'Photo save could not be confirmed.'});
 assert.equal(scan.state,'unknown');
 assert.equal((await scan.keep()).status,'saved');
 assert.equal(calls.length,2);
 assert.equal(calls[1],calls[0],'the retry resolves the same reservation');
});
test('a definite native failure starts a new identity',async()=>{
 const {calls,scan}=nativeKeep([{status:'failed',message:'Photo was not kept.'},{status:'saved',id:'7'}]);
 assert.equal((await scan.keep()).status,'failed');
 await scan.keep();
 assert.notEqual(calls[1],calls[0]);
});

function selectionChange(rejection){
 const toasts=[];
 const owner={isActive:()=>true,set(){},toast:message=>toasts.push(message)};
 const sandbox={mutating:false,sharing:false,disposed:false,selection:[{id:'native-camera-1',mutationRevision:'r1'}],preview:undefined,
  closeVideo(){},retirePhotoRead(){},nativeId:id=>id.replace('native-camera-',''),refresh(){},loadTrash(){},loadCounts(){},loadCustomAlbums(){},Date,
  library:{changeMany:async()=>{throw rejection;}}};
 const changeSelection=run('async function changeSelection(','changeSelection',sandbox);
 return {toasts,done:changeSelection(owner,'trash')};
}
test('cancelling Android review of a selection change shows no toast',async()=>{
 const {toasts,done}=selectionChange(Object.assign(new Error('Photo change cancelled. No change was dispatched.'),{code:'LIBRARY_DECLINED'}));
 await done;
 assert.deepEqual(toasts,[]);
});
test('any other selection change rejection still asks to reopen Photos',async()=>{
 for(const rejection of [Object.assign(new Error('stale'),{code:'LIBRARY_STALE'}),new Error('bridge closed')]){
  const {toasts,done}=selectionChange(rejection);
  await done;
  assert.deepEqual(toasts,['Reopen Photos to check.']);
 }
});
