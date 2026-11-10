import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces, qset} from '../check-traces.mjs';
import {app, javaTraces, root} from './java.mjs';
import {canonicalTapPlatform} from './canonical-tap-platform.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.ts';

const model = 'CanonicalNotificationTap';
const driver = fileURLToPath(import.meta.url);
const here = fileURLToPath(new URL('./', import.meta.url));
const actor = app+'AlphaCanonicalNotifications.java';
const bridge = app+'AlphaNotificationsPlugin.java';
const notifications = 'plugins/plugin-native-notifications/android/src/';
const host = notifications+'capacitor/java/ai/eliza/plugins/notifications/NotificationsHostPlugin.java';
const gate = notifications+'main/java/ai/eliza/plugins/notifications/ForegroundNoticeGate.java';
const route = 'packages/app/platforms/android/app/src/main/java/ai/elizaos/app/NativeNotificationRoute.java';

export async function checkCanonicalNotificationTap(extraSources = []) {
  const paths = [driver, join(here, 'CanonicalTapTraces.java'), join(here, 'Trace.java'), join(here, 'java.mjs'),
    join(here, 'canonical-tap-platform.mjs'), 'test/fixtures/jvm-tools.mjs', 'scripts/upstream-native-source.ts',
    'upstream.lock.json', actor, bridge, app+'AlphaLocalAgentPlugin.java', app+'MainActivity.java',
    ...[host, gate, route].map(path => 'vendor/eliza/'+path), ...(jsonJar ? [jsonJar] : []), ...extraSources];
  const driverHashes = captureInputs(paths);
  const source = upstreamNativeSource(root);
  const pinned = path => {
    const file = source.read(path).get(path);
    assert.equal(driverHashes[join(root, 'vendor/eliza', path)], file.sha256);
    return file.bytes.toString('utf8');
  };
  const directory = mkdtempSync(join(tmpdir(), 'quint-canonical-tap-'));
  let traces;
  try {
    const files = canonicalTapPlatform(readFileSync(join(root, actor), 'utf8'), readFileSync(join(root, bridge), 'utf8'),
      pinned(host), pinned(route));
    pinned(gate);
    const generated = Object.entries(files).map(([path, contents]) => {
      const file = join(directory, path);
      mkdirSync(dirname(file), {recursive: true});
      writeFileSync(file, contents);
      return file;
    });
    traces = javaTraces('CanonicalTapTraces.java', [...generated, 'vendor/eliza/'+gate]);
  } finally {rmSync(directory, {recursive: true, force: true});}
  for (const trace of traces) {
    for (const {expect} of [trace, ...trace.steps]) expect['s.posted'] = qset(expect['s.posted']);
  }

  const receipt = await checkTraces({model, sources: paths, driverHashes, traces,
    scope: 'bounded-orchestration', assumptions: [
      'Exact extracted actor custody/check/detach and bridge read, acknowledgement, lifecycle and wakeup methods execute on the host JVM. The exact pinned foreground gate and route whitelist execute with synthetic Android Intent and activity ports.',
      'One bridge, three synthetic actor identities, at most four captures and controlled wall time. The driver chooses a verifier invocation at the same entry used by hydration and polling and holds unrelated executor work.',
      'Owner provisioning, projector result and read acknowledgement are controlled ports. A post means the fake read acknowledgement port was reached after native token consumption, with no provider transport.',
    ]});
  return {receipt, obligations: [
    {model, obligation: 'Android ingress, projector provenance and real resident acknowledgement',
      reason: 'Intent and owner/projector decisions are controlled. Installed PendingIntent provenance, process survival and service read receipt semantics need separate evidence.'},
    {model, obligation: 'Renderer navigation and arbitrary actor schedules',
      reason: 'The campaign covers one native bridge, selected ownership/foreground changes and a synthetic acknowledgement. Renderer routing, multi-bridge lifetime and arbitrary Android main-thread/executor behavior remain separate.'},
  ]};
}
