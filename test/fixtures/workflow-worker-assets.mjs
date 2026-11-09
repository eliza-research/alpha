import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {workerHash} from '../../scripts/workflow-worker-artifact.mjs';

export function writeWorkerFixture(directory, label = 'synthetic') {
  const files = {};
  for (const name of ['node_modules/smthrs/package.json', 'node_modules/zod/package.json',
    'node_modules/effect/package.json', 'node_modules/@smthrs/engine/package.json', 'dependencies.json', 'lib/worker.js']) {
    const bytes = Buffer.from(name.endsWith('.js') ? 'export const text='+JSON.stringify(label)+';' : '{}');
    const file = join(directory, name);
    mkdirSync(dirname(file), {recursive: true});
    writeFileSync(file, bytes);
    files[name] = workerHash(bytes);
  }
  const manifest = {version: 1, sourceStampSha256: 'a'.repeat(64), lockSha256: 'b'.repeat(64), files};
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest));
  return manifest;
}
