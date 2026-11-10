import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CORE_STATE_INPUTS, CORE_STATE_TARGET, PLUGIN_CONNECTOR_TARGET, CORE_STATE_MANIFEST} from '../../scripts/core-state-patch.ts';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
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
  const manifest = JSON.parse(fs.readFileSync(path.join(repository, CORE_STATE_MANIFEST)));
  manifest.baseCommit = pin;
  for (const patch of manifest.patches) {
    let patchBytes = fs.readFileSync(path.join(repository, 'patches/eliza', patch.file));
    for (const target of patch.targets) {
      const simpleTarget = simple && [CORE_STATE_TARGET, PLUGIN_CONNECTOR_TARGET].includes(target.path);
      const before = simpleTarget ? 'export const value = "before";\n' : fs.readFileSync(path.join(repository, 'vendor/eliza', target.path));
      if (simpleTarget) {
        patchBytes = `--- a/${target.path}\n+++ b/${target.path}\n@@ -1 +1 @@\n-export const value = "before";\n+export const value = "after";\n`;
        target.afterSha256 = hash('export const value = "after";\n');
      }
      fs.mkdirSync(path.dirname(path.join(source, target.path)), {recursive: true});
      fs.writeFileSync(path.join(source, target.path), before);
      target.beforeSha256 = hash(before);
    }
    write('patches/eliza/' + patch.file, patchBytes);
    patch.sha256 = hash(patchBytes);
  }
  write(CORE_STATE_MANIFEST, JSON.stringify(manifest, null, 2));
}
