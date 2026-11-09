import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {app, javaTraces, root} from './java.mjs';
import {workflowNoticePlatform} from './workflow-notice-platform.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.mjs';
import {preparePatchedNative} from '../../../../scripts/prepare-patched-native.mjs';

const model = 'WorkflowNoticeDelivery';
const driver = fileURLToPath(import.meta.url);
const here = fileURLToPath(new URL('./', import.meta.url));
const bridge = app+'AlphaNotificationsPlugin.java';
const notifications = 'plugins/plugin-native-notifications/android/src/';
const host = notifications+'capacitor/java/ai/eliza/plugins/notifications/NotificationsHostPlugin.java';
const shared = ['NoticeDelivery', 'NoticeOwner', 'NoticeRoutes', 'NoticeCoordinator', 'HostNoticePoster', 'ForegroundNoticeGate']
  .map(name => notifications+'main/java/ai/eliza/plugins/notifications/'+name+'.java');
const product = ['WorkflowNoticeDelivery', 'WorkflowNoticeTaps', 'WorkflowNoticeTapsFactory', 'WorkflowNoticePoster']
  .map(name => app+name+'.java');
const nativeManifest = 'android/upstream-native-sources.json';

export async function checkWorkflowNoticeDelivery(extraSources = []) {
  assert.ok(jsonJar, 'the pinned org.json fixture is required');
  const prepared=preparePatchedNative({root});
  const catalog=JSON.parse(readFileSync(join(root,nativeManifest),'utf8'));
  const staged=[host,...shared].filter(path=>Object.hasOwn(prepared.files,path));
  const paths = [driver, join(here, 'WorkflowNoticeTraces.java'), join(here, 'Trace.java'), join(here, 'java.mjs'),
    join(here, 'workflow-notice-platform.mjs'), 'test/fixtures/jvm-tools.mjs', 'scripts/upstream-native-source.mjs',
    'upstream.lock.json', nativeManifest, bridge, ...product,
    ...[host, ...shared].map(path => 'vendor/eliza/'+path),
    'scripts/prepare-patched-native.mjs',join(prepared.root,'.source.json'),
    ...catalog.patches.map(patch=>'patches/eliza/'+patch.file),
    ...staged.map(path=>join(prepared.root,path)),jsonJar, ...extraSources];
  const driverHashes = captureInputs(paths);
  const source = upstreamNativeSource(root);
  const pinned = path => {
    const file = source.read(path).get(path);
    assert.equal(driverHashes[join(root, 'vendor/eliza', path)], file.sha256);
    if(Object.hasOwn(prepared.files,path)){
      const selected=join(prepared.root,path);
      assert.equal(driverHashes[selected],prepared.files[path],'authenticated effective workflow native source');
      return readFileSync(selected,'utf8');
    }
    return file.bytes.toString('utf8');
  };
  const directory = mkdtempSync(join(tmpdir(), 'quint-workflow-notice-'));
  let traces;
  try {
    const files = workflowNoticePlatform(pinned(host), readFileSync(join(root, bridge), 'utf8'));
    for (const path of shared) files[path] = pinned(path);
    const generated = Object.entries(files).map(([path, contents]) => {
      const file = join(directory, path);
      mkdirSync(dirname(file), {recursive: true});
      writeFileSync(file, contents);
      return file;
    });
    traces = javaTraces('WorkflowNoticeTraces.java', [...generated, ...product]);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }

  const receipt = await checkTraces({model, sources: paths, driverHashes, traces,
    scope: 'bounded-orchestration', assumptions: [
      'Exact extracted native workflow entrypoints, bridge gates and Alpha configuration overrides execute with full pinned route, delivery, owner coordinator and poster classes on the host JVM.',
      'One ordinary workflow notice identity, one active bridge call, two explicit owners, and controlled serialized storage and main-thread/worker callbacks. Lost write replies can occur before or after the synthetic store changes.',
      'Manager notification admission and active-list reads are synthetic. The harness observes the actual configured tag, channel, token, body and exact readback. It performs no device or provider operation.',
    ]});
  return {receipt, obligations: [
    {model, obligation: 'Installed secure-storage and notification-manager guarantees',
      reason: 'The host fixture controls write interruption, worker ordering, notification permission and active-list visibility. Actual device process death, secure-storage durability and OS posting/acknowledgement need separate evidence.'},
    {model, obligation: 'Concurrent bridge calls and route/tap/approval coordination',
      reason: 'One operation and serialized work are bounded here. Other notice keys, cross-process publication, approval quiet re-posting and tap consumption have separate ownership and are outside these traces.'},
  ]};
}
