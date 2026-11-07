// Source-shape guard (class S). It shows nothing about Android's behaviour.
// AlphaDevicePlugin stops its problem-log worker in handleOnDestroy. A plugin call the page made
// just before the activity was destroyed can still arrive afterwards; handing it to the stopped
// executor throws RejectedExecutionException on Capacitor's bridge thread, which kills the process
// (seen on the API 36 emulator in LauncherHomeInstrumentedTest). Every problem-log method must go
// through the one helper that answers such a call with a rejection.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaDevicePlugin.java", "utf8");

test("problem-log work is never handed to the worker outside the helper that survives a stopped worker", () => {
  // The helper delegates to the shared PluginWorkers guard (see test/plugin-worker-guard.test.mjs).
  assert.equal([...source.matchAll(/diagnosticsWorker\.execute\(/g)].length, 0, "the worker is never called directly");
  const helper = source.match(/private void diagnostics\(PluginCall call,Runnable work\)\{([\s\S]*?)\n \}/);
  assert.ok(helper, "the helper exists");
  assert.match(helper[1], /PluginWorkers\.submit\(diagnosticsWorker,work,\(\)->call\.reject\(/);
  assert.ok([...source.matchAll(/diagnostics\(call,\(\)->/g)].length >= 4, "the four problem-log methods use the helper");
  const destroy = source.match(/handleOnDestroy\(\)\{([^\n]+)super\.handleOnDestroy\(\);/);
  assert.ok(destroy, "the plugin implements the destroy lifecycle");
  assert.match(destroy[1], /diagnosticsWorker\.shutdown\(\);/, "the worker is stopped before the superclass lifecycle");
});
