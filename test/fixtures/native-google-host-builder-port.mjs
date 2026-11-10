import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {PLUGIN_CONNECTOR_TARGET} from '../../scripts/core-state-patch.mjs';

export const productInput = 'scripts/native-google-product-host.ts';
export const fixtureSource = version => `export const fixtureSource = ${version};\n`;
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const fixtureModule = bytes => `export const fixtureInputSha256 = "${digest(bytes)}";\n`;
export const controlName = '.native-google-fixture.json';
export const eventsName = '.native-google-events.jsonl';

async function main() {
  const root = path.dirname(process.argv[1]);
  const control = JSON.parse(fs.readFileSync(path.join(root, controlName), 'utf8'));
  const event = kind => fs.appendFileSync(path.join(root, eventsName), JSON.stringify(kind)+'\n');
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--version') {
    event('version');
    console.log(control.mode === 'wrong-bun' ? '1.4.1' : '1.4.2');
    return;
  }
  const [condition, script, requestedRoot, sdk, file, meta] = args;
  assert.equal(args.length, 6);
  assert.equal(condition, '--conditions=eliza-source');
  assert.equal(script, 'scripts/build-native-google-host.ts');
  assert.equal(requestedRoot, root);
  assert.equal(process.cwd(), root);
  assert.equal(sdk, path.join(root, 'artifacts/sdk'));
  assert.equal(path.dirname(path.dirname(meta)), path.join(root, 'artifacts'));
  assert.match(path.basename(path.dirname(meta)), /^\.native-google-host-build-/);
  assert.equal(path.basename(meta), 'meta.json');
  assert.equal(file, path.join(path.dirname(meta), 'google-host.mjs'));

  const input = path.join(root, productInput);
  const missing = path.join(root, 'unavailable-input.ts'), linked = path.join(root, 'linked-input.ts');
  const coreTarget = path.join(sdk, PLUGIN_CONNECTOR_TARGET);
  const sdkInput = path.join(sdk, 'tsconfig.json');
  const fixtureDependency = path.join(sdk, 'fixture-dependency.ts');
  const repository = path.resolve(import.meta.dirname, '../..');
  const output = {kind: 'entry-point', async arrayBuffer() {return Uint8Array.from(Buffer.from(bytes)).buffer;}};
  let bytes;
  globalThis.Bun = {
    async build(options) {
      event('compile');
      assert.deepEqual(options.entrypoints, [input]);
      assert.deepEqual(options.conditions, ['eliza-source']);
      assert.equal(options.tsconfig, sdkInput);
      assert.equal(options.metafile, true);
      if (control.mode === 'compiler-refused') return {success: false, logs: [Error('fixture compiler refused')]};
      if (control.mode === 'no-output') return {success: true, outputs: [], metafile: {inputs: {}}};
      const loads = [];
      for (const plugin of options.plugins) plugin.setup({
        onLoad({filter}, load) {loads.push({filter, load});},
        onResolve({filter}, resolve) {
          assert.ok(filter.test('@elizaos/fixture-dependency'));
          assert.equal(resolve({path: '@elizaos/fixture-dependency', importer: input}).path, fixtureDependency);
          assert.equal(resolve({path: 'node:fs', importer: input}), undefined);
        },
      });
      const selected = {[input]: {}, [fixtureDependency]: {}};
      if (control.selectedCore) selected[coreTarget] = {};
      if (control.mode === 'missing-input') selected[missing] = {};
      if (control.mode === 'linked-input') selected[linked] = {};
      for (const file of Object.keys(selected)) {
        const handlers = loads.filter(({filter}) => filter.test(file));
        const index = file === coreTarget && control.mode === 'missing-transform' ? 1 : 0;
        const actual = handlers[index].load({path: file, loader: 'ts'});
        assert.equal(actual.loader, 'ts');
        if (file === input) bytes = fixtureModule(actual.contents);
      }
      if (control.mode === 'escape-graph') selected[path.join(root, '..', 'outside-input.ts')] = {};
      if (control.mode === 'unbound-graph') selected[path.join(root, 'unavailable-input.ts')] = {};
      if (control.mode === 'incomplete-graph') delete selected[fixtureDependency];
      if (control.mode === 'input-drift') fs.writeFileSync(input, fixtureSource(2));
      if (control.mode === 'fixed-drift') fs.appendFileSync(path.join(root, 'scripts/prepare-client-features.mjs'), '\n');
      if (control.mode === 'worker-drift') fs.writeFileSync(path.join(root, 'artifacts/worker/google-host.mjs'), fixtureModule(fixtureSource(2)));
      if (control.mode === 'sdk-drift') fs.appendFileSync(sdkInput, '\n');
      return {success: true, outputs: [output], metafile: {inputs: selected}};
    },
    resolveSync(name, parent) {
      assert.equal(name, '@elizaos/fixture-dependency');
      assert.equal(parent, sdk);
      if (control.mode === 'escape-resolver') return path.join(root, 'outside-sdk.ts');
      return fixtureDependency;
    },
    async write(target, artifact) {
      assert.equal(target, file);
      assert.equal(artifact, output);
      fs.writeFileSync(target, control.mode === 'output-drift' ? bytes+'// synthetic corruption' : bytes);
      event('module');
      if (control.mode === 'metadata-refused') fs.mkdirSync(meta);
      if (control.mode === 'missing-input') fs.unlinkSync(missing);
      if (control.mode === 'linked-input') {
        fs.unlinkSync(linked);
        fs.symlinkSync('linked-target.ts', linked);
      }
    },
  };
  process.argv = [process.execPath, path.join(repository, script), root, sdk, file, meta];
  await import(pathToFileURL(process.argv[1]).href);
  assert.ok(fs.statSync(meta).isFile());
  event('metadata');
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith('/fixture-bun.mjs')) await main();
