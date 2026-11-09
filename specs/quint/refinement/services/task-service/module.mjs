import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {captureInputs} from '../../check-traces.mjs';
import {CORE_STATE_INPUTS, coreStatePatch, coreStateBuildRecord, coreStateRequiredTargets} from '../../../../../scripts/core-state-patch.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** Load actual TaskService and actual SQL fixtures, binding bytes before any evaluation. */
export async function loadTaskService(extraSources = []) {
  const root = process.cwd(), source = path.join(root, 'vendor/eliza');
  const packages = createRequire(path.join(root, 'package.json'));
  const core = coreStatePatch(root, source), compiled = new Map(), resources = new Set(), transforms = [];
  const pglite = path.dirname(path.dirname(packages.resolve('@electric-sql/pglite')));
  function bindResources(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) bindResources(file);
      else if (entry.isFile()) resources.add(file);
      else throw Error('Unexpected PGlite package entry');
    }
  }
  bindResources(pglite);
  const built = await build({
    stdin: {contents: `export {TaskService} from './vendor/eliza/packages/core/src/services/task.ts';\nexport {createIsolatedTestDatabase} from './vendor/eliza/plugins/plugin-sql/src/__tests__/test-helpers.ts';`, resolveDir: root},
    bundle: true, write: false, format: 'esm', platform: 'node',
    banner: {js: `import {createRequire as createBoundRequire} from 'node:module'; const require=createBoundRequire(${JSON.stringify(path.join(root, 'package.json'))});`},
    plugins: [{name: 'byte-bound-task-service', setup(builder) {
      builder.onResolve({filter: /^file-type$/}, () => ({path: 'file-type', external: true}));
      builder.onResolve({filter: /^@elizaos\/core$/}, () => ({path: path.join(source, 'packages/core/src/index.ts')}));
      builder.onResolve({filter: /^@electric-sql\/pglite(?:\/|$)/}, args => ({path: pathToFileURL(packages.resolve(args.path)).href, external: true}));
      builder.onLoad({filter: /\.(?:ts|tsx|js|mjs|cjs|json)$/, namespace: 'file'}, args => {
        const original = fs.readFileSync(args.path);
        compiled.set(args.path, hash(original));
        const relative = path.relative(source, args.path).split(path.sep).join('/');
        const patch = core.files.get(relative);
        if (patch) {
          assert.equal(hash(original), patch.beforeSha256);
          transforms.push({path: relative, sourceSha256: patch.beforeSha256, outputSha256: patch.afterSha256});
        }
        const extension = args.path.split('.').at(-1);
        return {contents: patch?.bytes ?? original, loader: ['mjs', 'cjs'].includes(extension) ? 'js' : extension, resolveDir: path.dirname(args.path)};
      });
    }}],
  });
  assert.doesNotMatch(built.outputFiles[0].text, /['"]file-type['"]/, 'Unprovided optional media dependency reached TaskService output');
  const sources = [...compiled.keys(), ...resources, fileURLToPath(import.meta.url), 'package-lock.json', ...CORE_STATE_INPUTS, ...extraSources];
  const driverHashes = captureInputs(sources);
  for (const [file, digest] of Object.entries(core.receipt.inputHashes)) assert.equal(driverHashes[path.resolve(file)], digest, 'Core source input changed before driver capture');
  for (const [file, digest] of compiled) assert.equal(driverHashes[path.resolve(file)], digest, 'Task source changed during compilation');
  const coreState = coreStateBuildRecord(root, transforms, coreStateRequiredTargets([...compiled.keys()]));
  const module = await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
  return {...module, sources, driverHashes, coreState};
}
