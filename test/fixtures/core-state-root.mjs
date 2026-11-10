import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CORE_STATE_INPUTS, CORE_STATE_TARGETS, CORE_STATE_TARGET, PLUGIN_CONNECTOR_TARGET, CORE_STATE_MANIFEST} from '../../scripts/core-state-patch.ts';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const policySource = value => 'export default ' + JSON.stringify(value, null, 2) + ';\n';
const repository = path.resolve(import.meta.dirname, '../..');

/** A private source tree and reviewed manifest, with the same production verifier. */
export function writeCoreStateFixture(root, source, pin, simple = false) {
  const write = (name, bytes) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, bytes);
  };
  for (const name of [...CORE_STATE_INPUTS.filter(name => name.startsWith('scripts/')),
    'scripts/local-agent-source.ts', 'scripts/copy-file-clone.ts',
    'vendor/eliza/packages/app/scripts/lib/immutable-workspace-source.mjs',
    'vendor/eliza/packages/app/scripts/lib/committed-source.mjs']) write(name, fs.readFileSync(path.join(repository, name)));
  const files = {};
  for (const name of CORE_STATE_TARGETS) {
    const simpleTarget = simple && [CORE_STATE_TARGET, PLUGIN_CONNECTOR_TARGET].includes(name);
    const bytes = simpleTarget ? 'export const value = "reviewed";\n' : fs.readFileSync(path.join(repository, 'vendor/eliza', name));
    fs.mkdirSync(path.dirname(path.join(source, name)), {recursive: true});
    fs.writeFileSync(path.join(source, name), bytes);
    files[name] = hash(bytes);
  }
  const manifest = {schema: 1, baseCommit: pin, files};
  write(CORE_STATE_MANIFEST, policySource(manifest));
}
