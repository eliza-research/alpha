import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {jsonJar,jvmSkip,javaBinary} from './fixtures/jvm-tools.mjs';
const root=resolve(import.meta.dirname,'..');
test('bounded native Notes fixture fills the real 32 MiB collection and a small edit exceeds it',{skip:jvmSkip('json')},()=>{
 const temporary=mkdtempSync(join(tmpdir(),'notes-capacity-fixture-'));
 try{
  execFileSync(javaBinary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,join(root,'android/app/src/androidTest/java/ai/elizaresearch/alphaphone/NotesCapacityFixture.java'),join(root,'test/fixtures/NotesCapacityFixtureTest.java')],{timeout:60000,stdio:'pipe'});
  assert.equal(execFileSync(javaBinary('java'),['-Xmx512m','-cp',temporary+':'+jsonJar,'ai.elizaresearch.alphaphone.NotesCapacityFixtureTest'],{timeout:60000,encoding:'utf8'}).trim(),'PASS bounded Notes capacity fixture');
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
