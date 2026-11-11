// Renderer recovery (AP-02). Host-JVM run of the extracted budget and HOME decision. Not emulator
// evidence: killing the renderer on a device is the separate instrumented task
// (renderer-recovery-emulator), and the escape view has not been seen on screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nativeSource,fixture,runJvm} from './fixtures/jvm-tools.mjs';

test('renderer losses: budget, backoff, escape while HOME, background reclaim deferred and uncounted',()=>{
 assert.match(runJvm([nativeSource('RendererRecoveryBudget.java'),fixture('RendererRecoveryBudgetTest.java')],'ai.alphacompute.alphaphone.RendererRecoveryBudgetTest'),/^PASS renderer recovery budget/);
});

test('each activity reports a renderer loss with the death count its WebView was created under',()=>{
 const main=readFileSync(nativeSource('MainActivity.java'),'utf8');
 assert.match(main,/recoveryBudget\.onLoss\(SystemClock\.elapsedRealtime\(\), showsHome\(\), detail\.didCrash\(\), visible, rendererDeathsAtCreate\)/);
 assert.equal((main.match(/recoveryBudget\.onLoss\(/g)||[]).length,1,'no loss is reported without the creation count');
 const read=main.indexOf('rendererDeathsAtCreate = recoveryBudget.deaths();'),bridge=main.indexOf('super.onCreate(state);');
 assert.ok(read>0&&read<bridge,'the count is read before BridgeActivity creates the WebView');
 assert.equal((main.match(/rendererDeathsAtCreate = /g)||[]).length,1);
 assert.match(main,/private static final RendererRecoveryBudget recoveryBudget/,'the budget stays process-wide');
 assert.match(readFileSync(nativeSource('AlphaAssistActivity.java'),'utf8'),/public class AlphaAssistActivity extends MainActivity/,'the assistant surface reports to the same budget');
});
