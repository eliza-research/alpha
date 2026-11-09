import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {MOBILE_BUILD_INPUTS, MOBILE_UUID_POLICY} from '../../scripts/mobile-uuid-adapter.mjs';
import {coreStateReceipt} from '../../scripts/core-state-patch.mjs';
import {parseBuildPolicy} from '../../scripts/build-policy-source.mjs';
import {policySource, writeCoreStateFixture} from './core-state-root.mjs';

const repository = path.resolve(import.meta.dirname, '../..');
const read = name => fs.readFileSync(path.join(repository, name));
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const actualPolicy = parseBuildPolicy(read(MOBILE_UUID_POLICY));
export const barrel = [['MAX','max'], ['NIL','nil'],
  ...['parse','stringify','v1','v1ToV6','v3','v4','v5','v6','v6ToV1','v7','validate','version'].map(name => [name,name])]
  .map(([name,file]) => `export { default as ${name} } from './${file}.js';`).join('\n')+'\n';

/** Each fixture owns only its private tree. Reviewed mode copies exact installed inputs. */
export function mobileUuidFixture({reviewed = false} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-uuid-producer-'));
  const source = path.join(root, 'source'), policy = structuredClone(actualPolicy);
  const cleanup = () => fs.rmSync(root, {recursive: true, force: true});
  const write = (name, bytes) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, bytes);
  };
  const json = (name, value) => write(name, JSON.stringify(value));
  const save = () => write(MOBILE_UUID_POLICY, policySource(policy));
  try {
    if (reviewed) write('upstream.lock.json', read('upstream.lock.json'));
    else json('upstream.lock.json', {commit: policy.baseCommit});
    json('source/.alpha-runtime-source.json', {base: policy.baseCommit, patches: []});
    const lock = reviewed ? read('vendor/eliza/bun.lock') : 'fixture pinned dependency lock';
    const builder = reviewed ? read('vendor/eliza/'+policy.builder.path) : 'fixture unchanged producer';
    write('source/bun.lock', lock);
    write('source/'+policy.builder.path, builder);
    if (!reviewed) {
      policy.lockSha256 = hash(lock);
      policy.builder.sha256 = hash(builder);
    }
    for (const name of MOBILE_BUILD_INPUTS) write(name, reviewed ? read(name) : 'fixture '+name);
    for (const name of Object.keys(policy.package.files)) {
      const bytes = reviewed ? read('node_modules/uuid/'+name)
        : name === 'package.json' ? JSON.stringify({name: 'uuid', version: '14.0.2'})
          : name === 'dist-node/index.js' ? barrel : 'export default "fixture";\n';
      write('source/'+policy.package.root+'/'+name, bytes);
      if (!reviewed) policy.package.files[name] = hash(bytes);
    }
    writeCoreStateFixture(root, source, policy.baseCommit);
    if (reviewed) write(MOBILE_UUID_POLICY, read(MOBILE_UUID_POLICY));
    else save();
    const output = 'packages/agent/dist-mobile/agent-bundle.js';
    const bundle = path.join(source, output);
    write('source/'+output, 'fixture bundled output');
    const receipt = coreStateReceipt(root);
    const coreTransforms = Object.entries(receipt.files).map(([path, entry]) => ({
      path, sourceSha256: entry.beforeSha256, outputSha256: entry.afterSha256,
    }));
    return {root, source, policy, write, json, save, bundle, coreTransforms, cleanup};
  } catch (error) {
    cleanup();
    throw error;
  }
}
