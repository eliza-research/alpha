// Partial source-contract regression: authenticated extracted production members execute
// with controlled ports; this is not whole-file implementation refinement.
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preparePatchedNative} from '../../../../scripts/prepare-patched-native.ts';
import {chainMethods, injectMethods} from '../../../../test/fixtures/google-browser-auth/chain-methods.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {directory, javaTraces, root} from './java.mjs';

const model = 'GoogleBrowserReturnClaim';
const harness = 'GoogleBrowserReturnClaimTraces.java';
const overlay = 'test/fixtures/google-browser-auth';
const javaPackage = 'packages/auth/android/src/main/java/ai/eliza/auth/cloud';
const template = join(root, overlay, 'ai/eliza/auth/cloud/CloudSignInChainTest.java.txt');

function replaceOnce(source, from, to) {
  assert.equal(source.split(from).length, 2, 'Exact plugin observation seam');
  return source.replace(from, to);
}

/** These wrappers label actual queue entries, then forward to the original fixture ports. */
function observedChain(plugin) {
  const methods = chainMethods(plugin);
  methods.ACTUAL_CALLBACK = replaceOnce(methods.ACTUAL_CALLBACK, '  run(() -> {',
    '  observeCallbackWork(received, claimed, () -> {');
  methods.ACTUAL_CALLBACK = replaceOnce(methods.ACTUAL_CALLBACK, '     main.postDelayed(() -> {',
    '     observeGrace("hint", () -> {');
  methods.ACTUAL_BROWSER_LIFECYCLE = replaceOnce(methods.ACTUAL_BROWSER_LIFECYCLE, '  main.postDelayed(() -> {',
    '  observeGrace("resume", () -> {');
  methods.ACTUAL_BURN = replaceOnce(methods.ACTUAL_BURN, '  run(() -> {', '  observeBurnWork(() -> {');
  methods.ACTUAL_CANCEL = replaceOnce(methods.ACTUAL_CANCEL, 'try { worker.execute(() -> {',
    'try { observeCancelWork(() -> {');
  return injectMethods(readFileSync(template, 'utf8'), methods);
}

const observationPorts = `
 void observeCallbackWork(CloudSignInFlow.Callback received, Attempt claimed, Runnable task) { run(task); }
 void observeBurnWork(Runnable task) { run(task); }
 void observeCancelWork(Runnable task) { worker.execute(task); }
 void observeGrace(String kind, Runnable task, long delay) { main.postDelayed(task, delay); }
`;

export async function checkGoogleBrowserReturnClaim(extraSources = []) {
  const native = preparePatchedNative({root});
  const java = join(native.root, javaPackage);
  const plugin = join(java, 'CloudSignInPlugin.java');
  const pure = readdirSync(java).filter(name => name.endsWith('.java') &&
    !['CloudSignInPlugin.java', 'NativeGoogleCredential.java'].includes(name)).map(name => join(java, name));
  const registration = join(native.root, 'packages/auth/android/test/ai/eliza/auth/cloud/TestRegistration.java');
  const manifest = 'android/upstream-native-sources.json';
  const sources = [
    ...pure, plugin, registration, template, manifest,
    ...JSON.parse(readFileSync(join(root, manifest), 'utf8')).patches.map(row => 'patches/eliza/' + row.file),
    join(native.root, '.source.json'), 'upstream.lock.json', 'scripts/prepare-patched-native.ts',
    'scripts/upstream-native-source.ts', join(overlay, 'chain-methods.mjs'),
    join(directory, harness), join(directory, 'Trace.java'), join(directory, 'java.mjs'),
    fileURLToPath(import.meta.url), ...extraSources,
  ];
  const driverHashes = captureInputs(sources);
  const temporary = mkdtempSync(join(tmpdir(), 'alpha-google-return-claim-'));
  let traces;
  try {
    const generated = join(temporary, 'CloudSignInChainTest.java');
    const source = replaceOnce(observedChain(readFileSync(plugin, 'utf8')),
      ' static void check(boolean value', observationPorts + ' static void check(boolean value');
    writeFileSync(generated, source);
    traces = javaTraces(harness, [...pure, registration, generated], [], 'ai.eliza.auth.cloud.GoogleBrowserReturnClaimTraces');
  } finally {
    rmSync(temporary, {recursive: true, force: true});
  }
  return checkTraces({model, sources, driverHashes, traces, scope: 'bounded-orchestration', assumptions: [
    'Authenticated pinned CloudSignInPlugin callback, browser pause/resume, scoped cancel, retirement and completion methods execute in the same plain-JVM chain fixture used by the packaged source regression.',
    'The scope starts with a prepared browser attempt in the host task, or a stored pending record without a live attempt or an adoptable credential generation. It bounds one owner, four FIFO worker entries and four main grace timers. Typed observations label actual enqueued Runnable instances and inspect actual attempt and port state.',
    'A full worker dispatch is one transition. The campaign uses controlled queue, credential store and HTTPS ports, a valid success response, and fixed representative expiry classes. Actual Android lifecycle delivery, secure-store durability, intra-worker interleavings, new attempt setup and OAuth provider behavior remain outside this projection.',
  ]});
}
