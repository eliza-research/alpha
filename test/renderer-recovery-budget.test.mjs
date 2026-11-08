// Renderer recovery (AP-02). Host-JVM run of the extracted budget and HOME decision. Not emulator
// evidence: killing the renderer on a device is the separate instrumented task
// (renderer-recovery-emulator), and the escape view has not been seen on screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeSource,fixture,runJvm} from './fixtures/jvm-tools.mjs';

test('renderer losses: budget, backoff, escape while HOME, background reclaim deferred and uncounted',()=>{
 assert.match(runJvm([nativeSource('RendererRecoveryBudget.java'),fixture('RendererRecoveryBudgetTest.java')],'ai.elizaresearch.alphaphone.RendererRecoveryBudgetTest'),/^PASS renderer recovery budget/);
});
