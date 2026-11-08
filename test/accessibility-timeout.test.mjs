// Android's "Time to take action" setting as the shell's toast scale (runtime/accessibility-timeout.ts).
// The native reply is a test double; the APK method and the device setting need a device check.
import test from "node:test";
import assert from "node:assert/strict";
import { tsImport } from "tsx/esm/api";

const timeout = await tsImport("../apps/app/src/runtime/accessibility-timeout.ts", import.meta.url);
const port = reply => { const calls = []; return { calls, async recommendedTimeout(options) { calls.push(options); return reply(); } }; };

test("the scale is 1 without the plugin and before any reply", async () => {
  assert.equal(timeout.accessibilityTimeoutScale(), 1);
  assert.equal(await timeout.refreshAccessibilityTimeout(null), 1);
  assert.equal(timeout.accessibilityTimeoutScale(), 1);
});

test("the scale follows the recommended timeout for a 5 s base", async () => {
  const native = port(() => ({ timeoutMs: 30000 }));
  assert.equal(await timeout.refreshAccessibilityTimeout(native), 6);
  assert.deepEqual(native.calls, [{ baseMs: 5000 }]);
  assert.equal(timeout.accessibilityTimeoutScale(), 6);
  assert.equal(await timeout.refreshAccessibilityTimeout(port(() => ({ timeoutMs: 5000 }))), 1, "an unset setting returns the base");
});

test("a failed or malformed reply keeps the last scale and never shortens a toast", async () => {
  await timeout.refreshAccessibilityTimeout(port(() => ({ timeoutMs: 10000 })));
  assert.equal(await timeout.refreshAccessibilityTimeout(port(() => { throw new Error("unavailable"); })), 2);
  assert.equal(await timeout.refreshAccessibilityTimeout(port(() => ({ timeoutMs: "slow" }))), 2);
  assert.equal(await timeout.refreshAccessibilityTimeout(port(() => ({ timeoutMs: 1000 }))), 1, "below the base is the base");
});

test("the setting is read at start and again on each resume", async () => {
  const native = port(() => ({ timeoutMs: 15000 }));
  let resumed;
  timeout.startAccessibilityTimeout({ async addListener(event, listener) { assert.equal(event, "appResumed"); resumed = listener; return {}; } }, native);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(native.calls.length, 1);
  assert.equal(timeout.accessibilityTimeoutScale(), 3);
  resumed();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(native.calls.length, 2);
});
