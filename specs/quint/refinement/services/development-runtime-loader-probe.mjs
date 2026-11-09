import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CORE_STATE_MANIFEST, CORE_STATE_TARGET, verifyCoreStateBuildRecord} from '../../../../scripts/core-state-patch.mjs';
import {writeCoreStateFixture} from '../../../../test/fixtures/core-state-root.mjs';

const repository = resolve(import.meta.dirname, '../../../..');
const resolver = 'vendor/eliza/packages/app/scripts/lib/consumer-source-resolver.mjs';
const action = (name, ...args) => ({name, args});

function fixture(scratch, {duplicate = false, customState = false} = {}) {
  const root = mkdtempSync(join(scratch, 'loader-'));
  const upstream = join(root, 'vendor/eliza');
  const state = join(root, customState ? 'custom-state' : 'backend/state');
  const generated = join(root, 'backend/.generated');
  const receipt = join(generated, 'source-map.json');
  const runtime = join(generated, 'runtime.js');
  const salt = join(state, 'secret-salt');
  const write = (name, value) => {
    const path = join(root, name);
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, value);
  };
  for (const name of ['backend/loader.ts', 'scripts/pinned-upstream-source.mjs', resolver])
    write(name, readFileSync(join(repository, name)));
  write('package.json', '{"type":"module"}');
  write('vendor/eliza/package.json', '{"workspaces":["packages/*"]}');
  write('vendor/eliza/turbo.json', '{"tasks":{}}');
  write('vendor/eliza/.gitignore', 'hidden/\n');
  write('vendor/eliza/packages/example/package.json', JSON.stringify({name: '@elizaos/example',
    exports: {'./first': {import: './first.ts'}, './second': {import: './second.ts'}}}));
  write('vendor/eliza/packages/example/first.ts', 'export const value = "runtime-first";\n');
  write('vendor/eliza/packages/example/second.ts', 'export const value = "runtime-second";\n');
  write('vendor/eliza/packages/core/package.json', JSON.stringify({name: '@elizaos/core',
    exports: {'./services/task': {import: './src/services/task.ts'}}}));
  if (duplicate) write('vendor/eliza/packages/duplicate/package.json', '{"name":"@elizaos/example"}');
  const git = (...args) => execFileSync('git', args, {
    cwd: upstream, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
  }).trim();
  writeCoreStateFixture(root, upstream, '0'.repeat(40), true);
  git('init');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture workspace');
  const head = git('rev-parse', 'HEAD');
  write('upstream.lock.json', JSON.stringify({commit: head}));
  const manifest = JSON.parse(readFileSync(join(root, CORE_STATE_MANIFEST)));
  write(CORE_STATE_MANIFEST, JSON.stringify({...manifest, baseCommit: head}));
  delete process.env.SECRET_SALT;
  if (customState) process.env.ALPHA_ELIZA_DATA_DIR = state;
  else delete process.env.ALPHA_ELIZA_DATA_DIR;
  return {root, upstream, generated, receipt, runtime, state, salt, write, git, head};
}

const isDirectory = file => statSync(file, {throwIfNoEntry: false})?.isDirectory() === true;
const isFile = file => statSync(file, {throwIfNoEntry: false})?.isFile() === true;
const id = value => value === 'runtime-first' ? 1 : value === 'runtime-second' ? 2 : 0;
const artifactId = bytes => id(bytes.match(/runtime-(first|second)/)?.[0]);

function observer(f) {
  let builds = 0, resolved = 0, transformed = false, returned = 0, outcome = 'idle';
  const events = [], observedSalts = new Set();
  globalThis.runtimeLoaderEvaluation = (value, patched, failed) => {
    // Evaluation sees only the actual loader's persisted receipt and salt.
    const persisted = readFileSync(f.salt, 'utf8');
    assert.equal(process.env.SECRET_SALT, persisted);
    assert.equal(statSync(f.salt).mode & 0o077, 0);
    assert.equal(statSync(f.state).mode & 0o077, 0);
    const receipt = JSON.parse(readFileSync(f.receipt));
    assert.equal(receipt.commit, f.head);
    verifyCoreStateBuildRecord(f.root, receipt.coreState, [CORE_STATE_TARGET]);
    assert.equal(patched, 'after');
    events.push({version: id(value), failed});
  };
  return {
    build() {builds++; resolved = 0; transformed = false;},
    resolve(value) {resolved = value;},
    transform() {transformed = true;},
    returned(value) {returned = id(value); outcome = 'loaded';},
    failed(reason) {returned = 0; outcome = reason;},
    begin() {returned = 0; outcome = 'running';},
    observe() {
      const receipt = isFile(f.receipt) ? JSON.parse(readFileSync(f.receipt, 'utf8')) : null;
      const bytes = isFile(f.salt) ? readFileSync(f.salt, 'utf8') : '';
      if (bytes) {
        assert.match(bytes, /^[a-f0-9]{64}$/);
        observedSalts.add(bytes);
      }
      const artifact = isFile(f.runtime) ? artifactId(readFileSync(f.runtime, 'utf8')) : 0;
      const cache = events[0];
      return {
        's.builds': builds, 's.resolved': resolved, 's.transformed': transformed,
        's.artifact': artifact,
        's.receipt': receipt ? receipt.modules['@elizaos/example/second'] ? 2 : 1 : 0,
        's.stateDir': isDirectory(f.state),
        's.salt': !!bytes, 's.saltBound': !!bytes && process.env.SECRET_SALT === bytes,
        's.cache': cache ? cache.failed ? 'failed' : 'v'+cache.version : 'empty',
        's.evaluations': events.length, 's.returned': returned, 's.outcome': outcome,
        's.saltVersions': observedSalts.size, ReturnedCurrentArtifact: outcome !== 'loaded' || returned === artifact,
      };
    },
  };
}

function moduleSource(version) {
  return `import { value as marker } from "@elizaos/example/${version === 1 ? 'first' : 'second'}";
import { value as patched } from "@elizaos/core/services/task";
globalThis.runtimeLoaderEvaluation(marker, patched, false);
export { marker, patched };
`;
}

function createBuildPort(f, observer) {
  let active;
  const port = async options => {
    const spec = active;
    assert.ok(spec && !spec.entered);
    spec.entered = true;
    observer.build();
    assert.deepEqual(options.entrypoints, [join(f.root, 'backend/runtime.ts')]);
    assert.equal(options.outdir, f.generated);
    assert.equal(options.target, 'bun');
    assert.equal(options.metafile, true);
    assert.deepEqual(options.plugins.map(plugin => plugin.name), ['authenticated-core-state', 'eliza-consumer-source']);
    spec.reached();
    await spec.release;
    if (spec.kind === 'build-throw') throw Error('Closed fixture build threw');
    const resolvers = [], loaders = [];
    for (const plugin of options.plugins) plugin.setup({
      onResolve({filter}, fn) {resolvers.push([filter, fn]);},
      onLoad({filter}, fn) {loaders.push([filter, fn]);},
    });
    const resolveImport = name => {
      const match = resolvers.find(([filter]) => filter.test(name));
      assert.ok(match);
      return match[1]({path: name, importer: options.entrypoints[0]}).path;
    };
    if (spec.kind === 'resolve') {
      assert.throws(() => resolveImport('@elizaos/example/undeclared'), /No permitted source export/);
      return {success: false, logs: ['Closed fixture source resolution refused']};
    }
    const examplePath = resolveImport('@elizaos/example/'+(spec.version === 1 ? 'first' : 'second'));
    const taskPath = resolveImport('@elizaos/core/services/task');
    observer.resolve(spec.version);
    if (spec.kind === 'build-false') return {success: false, logs: ['Closed fixture compilation failed']};
    const taskLoad = loaders.find(([filter]) => filter.test(taskPath));
    assert.ok(taskLoad);
    if (spec.kind !== 'missing-transform') {
      assert.equal(taskLoad[1]({path: taskPath}).contents, 'export const value = "after";\n');
      observer.transform();
    }
    const inputs = Object.fromEntries([options.entrypoints[0], examplePath, taskPath].map(path => [path, {}]));
    if (spec.kind === 'receipt-write') mkdirSync(f.receipt, {recursive: true});
    const marker = 'runtime-'+(spec.version === 1 ? 'first' : 'second');
    // This is the only artifact the closed build port can emit.
    f.write('backend/.generated/runtime.js', `const marker = "${marker}";
const patched = "after";
globalThis.runtimeLoaderEvaluation(marker, patched, ${spec.kind === 'import'});
${spec.kind === 'import' ? 'throw new Error("Closed fixture module failed");' : ''}
export { marker, patched };
`);
    return {success: true, logs: [], metafile: {inputs}};
  };
  return {port, select(spec) {active = spec;}};
}

function boundary(options) {
  let reached, settle;
  const arrival = new Promise(resolve => {reached = resolve;});
  const release = new Promise(resolve => {settle = resolve;});
  return {...options, reached, arrival, release, settle};
}

const failures = {
  disabled: /Development runtime is disabled/,
  pin: /Unexpected runtime source change|Unexpected untracked runtime source|Prepared runtime base commit changed/,
  prebuild: /Duplicate source package|Core patch (digest|pin|schema)/,
  resolve: /Pinned runtime build failed/,
  'build-throw': /Closed fixture build threw/,
  'build-false': /Pinned runtime build failed/,
  'missing-transform': /Missing or invalid selected core transformation/,
  'receipt-write': /EISDIR/,
  'state-dir': /EEXIST|ENOTDIR/,
  'salt-read': /EISDIR/,
  import: /Closed fixture module failed/,
  'cached-import': /Closed fixture module failed/,
};

async function synthetic(scratch, name, specs, settings = {}) {
  const f = fixture(scratch, settings);
  const o = observer(f);
  const build = createBuildPort(f, o);
  Object.defineProperty(globalThis, 'Bun', {configurable: true, value: {build: build.port}});
  const {loadPinnedRuntime} = await import(pathToFileURL(join(f.root, 'backend/loader.ts')).href);
  const trace = {name, expect: o.observe(), steps: []};
  const point = (label, next) => trace.steps.push({label, action: next, expect: o.observe()});
  for (const options of specs) {
    const spec = boundary({version: 1, ...options});
    const {kind, version} = spec;
    const enabled = kind !== 'disabled';
    process.env.ELIZA_DEV_ALLOW_TEST_MOCKS = enabled ? '1' : '0';
    if (spec.prepare) spec.prepare(f);
    build.select(spec);
    o.begin();
    point('Admit the selected synthetic invocation', action('begin', enabled, isDirectory(f.state)));
    const pending = loadPinnedRuntime().then(value => ({value}), error => ({error}));
    const winner = await Promise.race([spec.arrival.then(() => 'build'), pending.then(() => 'settled')]);
    if (winner === 'build') {
      point('Exact loader reaches Bun.build after source and registry preparation', action('buildEnter'));
      spec.settle();
    }
    const {value, error} = await pending;
    if (kind === 'success') {
      assert.ok(value, error?.message);
      assert.equal(value.head, f.head);
      assert.equal(value.dataDir, f.state);
      assert.equal(value.module.patched, 'after');
      o.returned(value.module.marker);
    } else {
      assert.ok(error, 'Closed fixture should be refused at '+kind);
      assert.match(error.message, failures[kind]);
      o.failed(kind === 'cached-import' ? 'import' : kind);
    }
    const next = [];
    if (winner === 'build') {
      if (!['build-throw', 'resolve'].includes(kind)) next.push(action('resolveSource', version));
      if (['build-throw', 'resolve', 'build-false'].includes(kind)) next.push(action('failBeforeOutput', kind));
      else {
        next.push(action('emitArtifact', version, kind !== 'missing-transform'));
        if (['missing-transform', 'receipt-write'].includes(kind)) next.push(action('failReceipt', kind));
        else {
          next.push(action('publishReceipt'));
          if (kind === 'state-dir') next.push(action('failState'));
          else {
            next.push(action('openState'));
            if (kind === 'salt-read') next.push(action('failSalt'));
            else next.push(action('bindSalt'), action('importOutput', kind === 'import'));
          }
        }
      }
    } else next.push(action('failAdmission', kind));
    point('Actual loader settles '+kind+' and leaves observed artifacts and state', next);
  }
  return trace;
}

async function actualBun(scratch) {
  const compile = globalThis.Bun?.build?.bind(globalThis.Bun);
  assert.ok(compile);
  const f = fixture(scratch, {customState: true});
  const o = observer(f);
  const {loadPinnedRuntime} = await import(pathToFileURL(join(f.root, 'backend/loader.ts')).href);
  const trace = {name: 'actual_Bun_compiler_rebuild_keeps_cached_import', expect: o.observe(), steps: []};
  const point = (label, next) => trace.steps.push({label, action: next, expect: o.observe()});
  let port;
  const original = Object.getOwnPropertyDescriptor(globalThis.Bun, 'build');
  Object.defineProperty(globalThis.Bun, 'build', {value: async options => {
    o.build();
    port.reached();
    await port.release;
    return compile(options);
  }});
  try {
    process.env.ELIZA_DEV_ALLOW_TEST_MOCKS = '1';
    for (const version of [1, 2]) {
      f.write('backend/runtime.ts', moduleSource(version));
      port = boundary({});
      o.begin();
      point('Begin actual Bun build of synthetic consumer version '+version, action('begin', true, isDirectory(f.state)));
      const pending = loadPinnedRuntime();
      const winner = await Promise.race([port.arrival.then(() => 'build'), pending.then(() => 'settled')]);
      assert.equal(winner, 'build');
      point('The exact loader enters the real Bun compiler', action('buildEnter'));
      port.settle();
      const value = await pending;
      assert.equal(value.head, f.head);
      assert.equal(value.dataDir, f.state);
      assert.equal(value.module.patched, 'after');
      const receipt = JSON.parse(readFileSync(f.receipt, 'utf8'));
      const source = version === 1 ? 'first' : 'second';
      assert.equal(receipt.modules['@elizaos/example/'+source], 'packages/example/'+source+'.ts');
      verifyCoreStateBuildRecord(f.root, receipt.coreState, [CORE_STATE_TARGET]);
      o.resolve(version);
      o.transform();
      o.returned(value.module.marker);
      point('The installed URL returns its observed module and retains one salt', [
        action('resolveSource', version), action('emitArtifact', version, true), action('publishReceipt'),
        action('openState'), action('bindSalt'), action('importOutput', false),
      ]);
    }
    return [trace];
  } finally {
    if (original) Object.defineProperty(globalThis.Bun, 'build', original);
    else delete globalThis.Bun.build;
  }
}

export async function driveLoader(scratch, real = false) {
  globalThis.fetch = async () => {throw Error('Network is outside the closed development loader fixture');};
  if (real) return actualBun(scratch);
  const sequences = [
    ['flag_disabled', [{kind: 'disabled'}]],
    ['dirty_pin', [{kind: 'pin', prepare: f => f.write('vendor/eliza/packages/example/first.ts', 'export const changed = true;')}]],
    ['wrong_pin', [{kind: 'pin', prepare: f => f.write('upstream.lock.json', JSON.stringify({commit: '0'.repeat(40)}))}]],
    ['skip_worktree_edit', [{kind: 'pin', prepare: f => {
      f.git('update-index', '--skip-worktree', 'packages/example/first.ts');
      f.write('vendor/eliza/packages/example/first.ts', 'export const changed = true;');
    }}]],
    ['ignored_file', [{kind: 'pin', prepare: f => f.write('vendor/eliza/hidden/ignored.ts', 'export const extra = true;')}]],
    ['duplicate_source_registry', [{kind: 'prebuild'}], {duplicate: true}],
    ['wrong_transform_patch_bytes', [{kind: 'prebuild', prepare: f => f.write('patches/eliza/task-service-stop.patch', 'Fixture wrong bytes')}]],
    ['undeclared_source_export', [{kind: 'resolve'}]],
    ['build_rejects', [{kind: 'build-throw'}]],
    ['build_unsuccessful', [{kind: 'build-false'}]],
    ['missing_transform_leaves_artifact_without_receipt', [{kind: 'missing-transform'}]],
    ['receipt_write_fails_before_state', [{kind: 'receipt-write'}]],
    ['state_path_is_not_a_directory', [{kind: 'state-dir', prepare: f => f.write('custom-state', 'Fixture obstruction')}], {customState: true}],
    ['salt_path_is_not_a_file', [{kind: 'salt-read', prepare: f => mkdirSync(f.salt, {recursive: true, mode: 0o700})}]],
    ['valid_receipt_and_default_state', [{kind: 'success'}]],
    ['retry_after_unsuccessful_build', [{kind: 'build-false'}, {kind: 'success'}], {customState: true}],
    ['reauthenticate_after_success', [{kind: 'success'}, {kind: 'pin', prepare: f => f.write('vendor/eliza/packages/example/first.ts', 'export const changed = true;')}]],
    ['failed_rebuild_leaves_new_artifact_and_prior_receipt', [{kind: 'success'}, {kind: 'missing-transform', version: 2}]],
    ['same_process_rebuild_retains_loaded_module_identity', [{kind: 'success'}, {kind: 'success', version: 2}]],
    ['failed_module_evaluation_leaves_receipt_and_salt', [{kind: 'import'}]],
    ['failed_module_cache_outlives_artifact_rebuild', [{kind: 'import'}, {kind: 'cached-import', version: 2}]],
  ];
  const traces = [];
  for (const [name, specs, settings] of sequences) traces.push(await synthetic(scratch, name, specs, settings));
  return traces;
}

if (import.meta.main || (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)) {
  const result = await driveLoader(process.argv[2], process.argv[3] === 'real');
  process.stdout.write(JSON.stringify(result)+'\n');
}
