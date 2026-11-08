import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {transformSync} from 'esbuild';
import {readFileSync} from 'node:fs';
const root=resolve(import.meta.dirname,'..');
// The renderer contract is the pinned @elizaos/contracts/deletion-window (staged client features).
const src=transformSync(readFileSync(join(root,'.eliza/client-features/packages/contracts/src/deletion-window.ts'),'utf8'),{loader:'ts',format:'esm'}).code;
const {deletionDeadline,deletionWindow,claimDeletion,undoConfirmed}=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
const clock=(elapsed=100,wall=100000,continuity='boot:1')=>({elapsed,wall,continuity});
const entry=()=>({version:1,id:'fixture',owner:'owner-A',target:{id:'event',revision:'r1'},deadline:deletionDeadline(clock()),phase:'queued'});
test('ten seconds uses monotonic time, including exact boundary and wall/timezone changes',()=>{
 const deadline=deletionDeadline(clock());
 assert.equal(deletionWindow(deadline,clock(10099,1)),'open');
 assert.equal(deletionWindow(deadline,clock(10100,900000000)),'expired');
 assert.equal(deletionWindow(deadline,clock(100,900000000)),'open');
 assert.equal(deletionWindow(deadline,clock(99)),'clock-changed');
 assert.equal(deletionWindow(deadline,clock(20000,100000,'boot:2')),'clock-changed');
});
test('persisted exact target survives restart; Undo and expiry cannot both win or replay dispatch',()=>{
 const original=entry(),restored=JSON.parse(JSON.stringify(original));
 assert.deepEqual(restored.target,original.target);assert.equal(claimDeletion(restored,'owner-A',clock(10100),'dispatch'),true);
 assert.equal(claimDeletion(restored,'owner-A',clock(10100),'undo'),false);
 assert.equal(claimDeletion(restored,'owner-A',clock(20100),'dispatch'),false);
 const undone=entry();assert.equal(claimDeletion(undone,'owner-A',clock(10100),'undo'),false);
 assert.equal(claimDeletion(undone,'owner-A',clock(10099),'undo'),true);
 assert.equal(claimDeletion(undone,'owner-A',clock(20100),'dispatch'),false);
});
test('different owner and unprovable browser/reboot clock cannot dispatch; pending intent can be cancelled',()=>{
 const saved=entry();assert.equal(claimDeletion(saved,'owner-B',clock(20100),'dispatch'),false);
 assert.equal(claimDeletion(saved,'owner-A',clock(20100,1,'new-renderer'),'dispatch'),false);
 assert.equal(saved.phase,'queued');assert.equal(claimDeletion(saved,'owner-A',clock(20100,1,'new-renderer'),'undo'),true);
});
test('native deadline agrees on same-boot restart, exact expiry, reboot and invalid clocks',()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-delete-deadline-')),bin=n=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',n):n;
 const shared=join(root,'vendor/eliza/plugins/plugin-native-action-journal/android/src/main/java/ai/eliza/plugins/actionjournal/deletion/DeletionDeadline.java');
 try{const file=join(dir,'DeadlineTest.java');writeFileSync(file,`import ai.eliza.plugins.actionjournal.deletion.DeletionDeadline; public class DeadlineTest {static void check(boolean v){if(!v)throw new AssertionError();}public static void main(String[] args){check(DeletionDeadline.WINDOW_MS==10000);DeletionDeadline d=new DeletionDeadline("boot:1",100,100000);check(d.expiresAt==110000);check(d.state("boot:1",10099)==DeletionDeadline.State.OPEN);check(d.state("boot:1",10100)==DeletionDeadline.State.EXPIRED);check(d.state("boot:1",99)==DeletionDeadline.State.CLOCK_CHANGED);check(d.state("boot:2",20000)==DeletionDeadline.State.CLOCK_CHANGED);try{new DeletionDeadline("boot",Long.MAX_VALUE,0);throw new AssertionError();}catch(IllegalArgumentException expected){}System.out.println("PASS deletion deadline");}}`);
 execFileSync(bin('javac'),['--release','11','-d',dir,shared,file],{timeout:60000});assert.match(execFileSync(bin('java'),['-cp',dir,'DeadlineTest'],{encoding:'utf8',timeout:10000}),/PASS deletion deadline/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('Undo is confirmed only by an undone receipt; a late Undo after dispatch is never shown as kept',()=>{
 assert.equal(undoConfirmed({phase:'undone'}),true);
 for(const phase of ['deleted','conflict','dispatching','unknown','queued','paused'])assert.equal(undoConfirmed({phase}),false,phase);
 assert.equal(undoConfirmed(undefined),false);assert.equal(undoConfirmed(null),false);assert.equal(undoConfirmed('undone'),false);
 // The shared notice (bound by runtime/deletion-undo.tsx) shows Undo as kept only on an undone receipt.
 const ui=readFileSync(join(root,'.eliza/client-features/packages/ui/src/components/composites/deferred-deletion-notice.tsx'),'utf8');
 assert.match(ui,/if \(action\.current\(\) && !undoConfirmed\(result\)\)\s+setError\(\{ text: UNDO_TOO_LATE, scope: action \}\);/,'late Undo is shown only for the same current owner/action');
 assert.match(ui,/const shownError = error\?\.scope\.current\(\) \? error\.text : "";/,'a retired owner cannot see a stale Undo error');
 const coordinator=readFileSync(join(root,'vendor/eliza/plugins/plugin-native-action-journal/android/src/main/java/ai/eliza/plugins/actionjournal/deletion/DeferredDeletionCoordinator.java'),'utf8');
 assert.match(coordinator,/DeferredDeletionJournal\.requireUndone\(reminders\.settleDeletion\(id, row\.getString\("owner"\), time, true\)\)/,'native reminder Undo refuses a settled deletion');
});
