// Resident reuse (MVP-16): JVM contract of the native attach decision, the renderer attach
// contract, and structural guards on the plugin's start path. Not emulator or device evidence.
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {jsonJar,jvmSkip,javaBinary} from './fixtures/jvm-tools.mjs';
const root=resolve(import.meta.dirname,'..');
test('an admitted running resident is attached to; any change in runtime, enrollment or provider restarts',{skip:jvmSkip('json')},()=>{
 const temporary=mkdtempSync(join(tmpdir(),'resident-attachment-'));
 try{
  execFileSync(javaBinary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,join(root,'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/ResidentAttachment.java'),join(root,'test/fixtures/ResidentAttachmentTest.java')],{timeout:scaledTimeout(120000)});
  const output=execFileSync(javaBinary('java'),['-cp',temporary+':'+jsonJar,'ai.alphacompute.alphaphone.ResidentAttachmentTest'],{encoding:'utf8',timeout:scaledTimeout(120000)});
  // Two surfaces before enrollment (MVP-16): the pending pairing is not shared; accepted limit.
  assert.match(output,/^PASS pre-enrollment: a second surface before enrollment starts on its own/m);
  assert.match(output,/^PASS resident attachment/m);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
test('renderer attaches without rebinding the provider and keeps one identity across assistant invocations',()=>{
 assert.match(execFileSync(process.execPath,['scripts/test-resident-reuse.ts'],{cwd:root,timeout:scaledTimeout(120000),encoding:'utf8'}),/PASS resident reuse/);
});
