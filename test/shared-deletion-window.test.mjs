// Alpha consumes the reviewed deletion Undo window from the pin: the native engine is
// @elizaos/capacitor-action-journal (ai.eliza.plugins.actionjournal.deletion), the renderer
// contract is @elizaos/contracts/deletion-window and the notice is @elizaos/ui's
// DeferredDeletionNotice. This runs the shared JVM suite against the staged pinned sources and
// checks that Alpha keeps its installed slot, bridge and work names and no duplicate engine.
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {prepareNativeFixture} from './fixtures/native-source.mjs';
import {jsonJar as jar,jvmSkip,javaBinary} from './fixtures/jvm-tools.mjs';
const root=resolve(import.meta.dirname,'..');

test('the shared deadline, journal, dispatch claim, receipt recovery and coordinator pass at the pin',{skip:jvmSkip('json')},()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-shared-deletion-'));
 try{
  const prepared=prepareNativeFixture(root,dir);
  const plugin=join(prepared.root,'plugins/plugin-native-action-journal'),source=join(plugin,'android/src/main/java/ai/eliza/plugins/actionjournal'),deletion=join(source,'deletion');
  const classes=join(dir,'classes');
  execFileSync(javaBinary('javac'),['--release','17','-cp',jar,'-d',classes,join(source,'ActionJournal.java'),join(source,'ActionJournalConfiguration.java'),...readdirSync(deletion).filter(n=>n.endsWith('.java')).map(n=>join(deletion,n)),join(root,'vendor/eliza/plugins/plugin-native-action-journal/test/native-host/DeferredDeletionTest.java')],{timeout:scaledTimeout(120000)});
  assert.match(execFileSync(javaBinary('java'),['-cp',classes+':'+jar,'DeferredDeletionTest'],{encoding:'utf8',timeout:scaledTimeout(120000)}),/^\d+ assertions passed/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
