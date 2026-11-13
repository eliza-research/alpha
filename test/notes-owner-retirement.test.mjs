import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {transformSync} from 'esbuild';
const root=fileURLToPath(new URL('..',import.meta.url));
function moduleLoader(globals={}){
 const modules=new Map();
 function load(request){
  let file=path.resolve(request);if(!fs.existsSync(file))for(const suffix of ['.ts','.tsx','.js'])if(fs.existsSync(file+suffix)){file+=suffix;break;}
  if(modules.has(file))return modules.get(file).exports;
  const module={exports:{}};modules.set(file,module);
  const require=name=>{assert.match(name,/^\.\.?\//);return load(path.resolve(path.dirname(file),name));};
  vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:'ts',target:'es2022',format:'cjs'}).code,Object.defineProperties({exports:module.exports,module,require,AbortController,DOMException,crypto,structuredClone,TextEncoder,TextDecoder},Object.getOwnPropertyDescriptors(globals)),{filename:file});return module.exports;
 }
 return load;
}
test('blocked storage getter reports unavailable without throwing from a Notes render or reading another store',async()=>{
 const globals={get localStorage(){throw new DOMException('Browser storage is blocked','SecurityError');}};
 const access=moduleLoader(globals)(path.join(root,'apps/app/src/prototype/legacy-notes-access.ts'));
 const signal=new AbortController().signal;let reads=0;
 for(const method of ['browserPreviousNotesAvailability','devicePreviousNotesAvailability']){
  const port={read:async()=>{reads++;return null;},readRaw:async()=>{reads++;return null;}};
  let pending;assert.doesNotThrow(()=>{pending=access[method](port,signal,()=>true);});
  assert.equal(await pending,'unavailable');
 }
 assert.equal(reads,0,'an unavailable presence probe must not inspect another store or initialize data');
});
test('empty previous Notes is distinct from retained keys and unreadable storage without initializing it',async()=>{
 const load=moduleLoader(),access=load(path.join(root,'apps/app/src/prototype/legacy-notes-access.ts')),keys=load(path.join(root,'apps/app/src/runtime/notes-secure-store.ts'));
 const signal=new AbortController().signal;
 let writes=0;const storage={getItem:()=>null,setItem:()=>writes++,removeItem:()=>writes++},vault={read:async()=>null,compareExchange:async()=>{writes++;throw Error('No write allowed');}},port={read:async()=>null,compareExchange:async()=>{writes++;throw Error('No write allowed');}};
 await assert.rejects(access.openExistingBrowserNotes(port,signal,()=>true,storage),error=>error.constructor.name==='LegacyNotesAbsent');
 await assert.rejects(access.openExistingDeviceNotes(vault,storage,signal,()=>true),error=>error.constructor.name==='LegacyNotesAbsent');assert.equal(writes,0);
 for(const key of keys.LEGACY_NOTES_SOURCE_KEYS){const old={...storage,getItem:found=>found===key?'retained':null};await assert.rejects(access.openExistingBrowserNotes(port,signal,()=>true,old),error=>error.constructor.name==='LegacyNotesReviewRequired');await assert.rejects(access.openExistingDeviceNotes(vault,old,signal,()=>true),error=>error.constructor.name!=='LegacyNotesAbsent');}
 const unreadable={...vault,read:async()=>{throw Error('Keystore locked');}};await assert.rejects(access.openExistingDeviceNotes(unreadable,storage,signal,()=>true),/Keystore locked/);assert.equal(writes,0);
});
test('previous Notes availability reads retained browser, encrypted collection and draft data without writing',async()=>{
 const load=moduleLoader(),access=load(path.join(root,'apps/app/src/prototype/legacy-notes-access.ts')),keys=load(path.join(root,'apps/app/src/runtime/notes-secure-store.ts'));
 const signal=new AbortController().signal,storage={getItem:()=>null};
 assert.equal(await access.browserPreviousNotesAvailability({read:async()=>null},signal,()=>true,storage),'absent');
 assert.equal(await access.browserPreviousNotesAvailability({read:async()=>({revision:'r',raw:'saved'})},signal,()=>true,storage),'present');
 assert.equal(await access.browserPreviousNotesAvailability({read:async()=>{throw Error('Unreadable');}},signal,()=>true,storage),'unavailable');
 for(const key of keys.LEGACY_NOTES_SOURCE_KEYS){
  assert.equal(await access.browserPreviousNotesAvailability({read:async()=>null},signal,()=>true,{getItem:found=>found===key?'kept':null}),'present');
 }
 assert.equal(await access.devicePreviousNotesAvailability({readRaw:async()=>null},signal,()=>true,storage),'absent');
 for(const slot of [keys.SECURE_NOTES_SLOT,keys.SECURE_NOTES_DRAFT_SLOT]){
  assert.equal(await access.devicePreviousNotesAvailability({readRaw:async key=>key===slot?'retained encrypted bytes':null},signal,()=>true,storage),'present');
 }
 assert.equal(await access.devicePreviousNotesAvailability({readRaw:async()=>{throw Error('Locked');}},signal,()=>true,storage),'unavailable');
 await assert.rejects(access.openExistingDeviceNotes({read:async key=>key===keys.SECURE_NOTES_DRAFT_SLOT?{draft:'kept'}:null,compareExchange:async()=>assert.fail('probe wrote')},storage,signal,()=>true),error=>error.constructor.name==='LegacyNotesDraftOnly');
 await assert.rejects(access.openExistingDeviceNotes({read:async key=>{if(key===keys.SECURE_NOTES_DRAFT_SLOT)throw Error('Draft unreadable');return null;},compareExchange:async()=>assert.fail('probe wrote')},storage,signal,()=>true),error=>error.constructor.name==='LegacyNotesReviewRequired');
});
test('delayed previous Notes presence cannot publish after owner replacement or suspension',async()=>{
 const access=moduleLoader()(path.join(root,'apps/app/src/prototype/legacy-notes-access.ts'));
 for(const failed of [false,true]){
  const held=Promise.withResolvers(),controller=new AbortController();let current=true;
  const pending=access.browserPreviousNotesAvailability({read:()=>held.promise},controller.signal,()=>current,{getItem:()=>null});
  current=false;failed?held.reject(Error('Unreadable')):held.resolve({revision:'old',raw:'retained'});
  await assert.rejects(pending,error=>error.name==='AbortError');
 }
});
test('an owner change during the native collection probe does not read its draft slot',async()=>{
 const access=moduleLoader()(path.join(root,'apps/app/src/prototype/legacy-notes-access.ts'));
 const held=Promise.withResolvers(),calls=[];let current=true;
 const pending=access.devicePreviousNotesAvailability({readRaw:key=>{calls.push(key);return held.promise;}},new AbortController().signal,()=>current,{getItem:()=>null});
 current=false;held.resolve(null);
 await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(calls.length,1);
});
