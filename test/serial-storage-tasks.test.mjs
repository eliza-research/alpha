import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
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
