// Alpha consumes the reviewed deletion Undo window from the pin: the native engine is
// @elizaos/capacitor-action-journal (ai.eliza.plugins.actionjournal.deletion), the renderer
// contract is @elizaos/contracts/deletion-window and the notice is @elizaos/ui's
// DeferredDeletionNotice. This runs the shared JVM suite against the staged pinned sources and
// checks that Alpha keeps its installed slot, bridge and work names and no duplicate engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readdirSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {prepareNativeFixture} from './fixtures/native-source.mjs';
const root=resolve(import.meta.dirname,'..');
const cache=join(homedir(),'.gradle/caches/modules-2/files-2.1/org.json/json/20250517');
const jar=process.env.ALPHA_JSON_JAR||(existsSync(cache)?readdirSync(cache).flatMap(hash=>readdirSync(join(cache,hash)).filter(n=>n==='json-20250517.jar').map(n=>join(cache,hash,n)))[0]:undefined);
const bin=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
const alpha=name=>readFileSync(join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone',name+'.java'),'utf8');

test('the shared deadline, journal, dispatch claim, receipt recovery and coordinator pass at the pin',{skip:!jar?'Pinned JVM JSON dependency unavailable':false},()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-shared-deletion-'));
 try{
  const prepared=prepareNativeFixture(root,dir);
  const plugin=join(prepared.root,'plugins/plugin-native-action-journal'),source=join(plugin,'android/src/main/java/ai/eliza/plugins/actionjournal'),deletion=join(source,'deletion');
  const classes=join(dir,'classes');
  execFileSync(bin('javac'),['--release','17','-cp',jar,'-d',classes,join(source,'ActionJournal.java'),join(source,'ActionJournalConfiguration.java'),...readdirSync(deletion).filter(n=>n.endsWith('.java')).map(n=>join(deletion,n)),join(root,'vendor/eliza/plugins/plugin-native-action-journal/test/native-host/DeferredDeletionTest.java')],{timeout:120000});
  assert.match(execFileSync(bin('java'),['-cp',classes+':'+jar,'DeferredDeletionTest'],{encoding:'utf8',timeout:120000}),/^\d+ assertions passed/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Alpha binds the shared coordinator with its installed slots, bridge and work names and keeps no duplicate engine',()=>{
 const binding=alpha('NativeDeletionCoordinator');
 assert.match(binding,/static final String JOURNAL="native-delete-journal:v1",INSTALLATION="native-delete-installation:v1";/);
 assert.match(binding,/static final String WORK="alpha-delete-window";/);
 assert.match(binding,/new DeferredDeletionCoordinator\(new DeferredDeletionCoordinator\.Configuration\(JOURNAL,INSTALLATION\),/);
 assert.match(binding,/ExistingWorkPolicy\.REPLACE/,'one wake-up replaces the last');
 assert.doesNotMatch(binding,/synchronized\(this\)|boolean reconcile\(/,'admission lives in the shared coordinator');
 for(const name of ['DeletionDeadline','DeferredDeletionJournal','NativeDeletionRecovery','NativeDeletionClaim'])
  assert.equal(existsSync(join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone',name+'.java')),false,name+' is the shared module\'s');
 assert.match(alpha('AlphaDeletionsPlugin'),/@CapacitorPlugin\(name="AlphaDeletions"\)/);
 assert.match(readFileSync(join(root,'apps/app/src/runtime/deletions.ts'),'utf8'),/\}>\('AlphaDeletions'\);/);
 assert.match(alpha('DeletionWorker'),/NativeDeletionCoordinator\.get\(getApplicationContext\(\)\)\.reconcile\(\)\?Result\.retry\(\):Result\.success\(\)/);
 assert.match(alpha('AlphaActionJournalPlugin'),/DeletionReceiptRecovery\.recover\(entry,receipt,reminderResult\)/);
 assert.equal(existsSync(join(root,'apps/app/src/runtime/deletion-window.ts')),false,'the renderer contract is @elizaos/contracts/deletion-window');
 const notice=readFileSync(join(root,'apps/app/src/runtime/deletion-undo.tsx'),'utf8');
 assert.match(notice,/<DeferredDeletionNotice bridge=\{deletions\} identity=\{identity\} concealed=\{browserScreenLocked\} refreshEvents=\{refreshEvents\} onChanged=\{refreshDeletionViews\} className="alpha-deletion-undo"/);
 assert.match(notice,/\[session\.origin,session\.ownerId,session\.agentId,session\.sessionId\]/,'an owner or session change clears the notice');
});
