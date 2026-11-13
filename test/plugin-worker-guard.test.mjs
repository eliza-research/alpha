// Worker shutdown guard (AP-01/AP-02). Class S plus a host-JVM run of the shared helper; nothing here
// runs on Android. Capacitor can deliver a bridge call the page made just before the activity was
// destroyed after a plugin's handleOnDestroy stopped its worker. Executor.execute then throws
// RejectedExecutionException on the bridge thread and the process dies (AlphaDevicePlugin, round 8,
// a326b8dd). Every plugin that stops a worker must hand work to it only through PluginWorkers.submit,
// which answers the call instead of throwing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeSource,fixture,runJvm} from './fixtures/jvm-tools.mjs';

test('the shared guard refuses work for a stopped, shut-down or full worker without throwing',()=>{
 assert.match(runJvm([nativeSource('PluginWorkers.java'),fixture('PluginWorkersTest.java')],'ai.alphacompute.alphaphone.PluginWorkersTest'),/^PASS plugin workers/);
});

