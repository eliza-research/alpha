import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {javaBinary} from './fixtures/jvm-tools.mjs';
const root=resolve(import.meta.dirname,'..');
test('storage responses finish before the next read/CAS; retirement refuses queued and later work',()=>{
 const temporary=mkdtempSync(join(tmpdir(),'alpha-storage-queue-'));
 try{
  execFileSync(javaBinary('javac'),['--release','11','-d',temporary,join(root,'android/app/src/main/java/ai/alphacompute/alphaphone/SerialStorageTasks.java'),join(root,'test/fixtures/SerialStorageTasksTest.java')],{timeout:60000});
  assert.match(execFileSync(javaBinary('java'),['-cp',temporary,'ai.alphacompute.alphaphone.SerialStorageTasksTest'],{encoding:'utf8',timeout:10000}),/PASS serialized storage responses and retirement/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
test('all renderer slot operations use the serialized lane through response dispatch; HTTP stays parallel',()=>{
 const source=readFileSync(join(root,'android/app/src/main/java/ai/alphacompute/alphaphone/AlphaConnectionPlugin.java'),'utf8');
 for(const method of ['secureRead','secureWrite','secureCompareExchange','secureRemove']){
  const start=source.indexOf('@PluginMethod public void '+method+'('),end=source.indexOf('\n }',start),body=source.slice(start,end);
  assert.match(body,/submitStorage\(call,/);assert.doesNotMatch(body,/\bsubmit\(call,/);assert.ok(body.indexOf('call.resolve(')>body.indexOf('submitStorage(call,'));
 }
 const close=source.slice(source.indexOf('@Override protected void handleOnDestroy()'));
 assert.match(close,/synchronized\(foregroundLock\)\{destroyed=true;foregroundLock\.notifyAll\(\);\}/);
 assert.match(close,/requests\.cancelAll\(\);\s+storageTasks\.close\(\);workers\.shutdownNow\(\)/);
 assert.ok(close.indexOf('destroyed=true')<close.indexOf('requests.cancelAll()'),'retirement precedes cancellation and queue closure');
 assert.match(source,/workers = Executors\.newFixedThreadPool\(4\)/);
});
