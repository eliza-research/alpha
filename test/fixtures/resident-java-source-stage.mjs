import {scaledTimeout} from '../../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {RESIDENT_HOST_CLASSES} from '../../vendor/eliza/packages/app/scripts/mobile/android/resident-host-sources.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const descriptor = 'android/consumer-host.json';
const config = 'app.config.json';
const lock = 'upstream.lock.json';
const stageScript = 'scripts/stage-local-agent-sources.ts';
const sdkPrefix = 'vendor/eliza/';
const sdkScripts = ['packages/app/scripts/mobile/android/resident-host-sources.mjs',
  'packages/app/scripts/lib/immutable-workspace-source.mjs', 'packages/app/scripts/lib/committed-source.mjs'];
const residentDirectory = 'packages/app/platforms/android/app/src/main/java/ai/elizaos/app';
const service = `${residentDirectory}/ElizaAgentService.java`;
const generatedDirectory = 'android/app/build/generated/local-agent';
const {residentHost} = JSON.parse(fs.readFileSync(join(root, descriptor), 'utf8'));
const sources = [...RESIDENT_HOST_CLASSES, ...residentHost.classes].map(name => `${residentDirectory}/${name}.java`)
  .concat(residentHost.helpers);
const productFiles = [stageScript, 'scripts/local-agent-source.ts', 'scripts/copy-file-clone.ts', 'scripts/upstream-pin.ts', descriptor, config];

export const residentJavaStageInputs = [lock, ...productFiles, ...[...sdkScripts, ...sources].map(file => sdkPrefix+file)];

const hash = value => createHash('sha256').update(value).digest('hex');
const write = (file, value) => { fs.mkdirSync(dirname(file), {recursive: true}); fs.writeFileSync(file, value); };
const copy = (file, target) => write(target, fs.readFileSync(file));
const gitEnv = {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null'};
const git = (directory, ...args) => execFileSync('git', ['-C', directory, '-c', 'user.name=Quint Fixture',
  '-c', 'user.email=quint-fixture@localhost', ...args], {env: gitEnv, encoding: 'utf8'}).trim();

export function residentJavaStageFixture(directory) {
  directory = fs.realpathSync(directory);
  const vendor = join(directory, sdkPrefix);
  const runtime = join(directory, 'artifacts/prepared');
  const output = join(directory, generatedDirectory);
  const stamp = join(runtime, '.alpha-runtime-source.json');
  const source = join(runtime, service);
  for (const file of productFiles) copy(join(root, file), join(directory, file));
  for (const file of [...sdkScripts, ...sources]) copy(join(root, sdkPrefix, file), join(vendor, file));
  write(join(vendor, 'package.json'), '{"workspaces":[]}\n');
  write(join(vendor, 'turbo.json'), '{"tasks":{}}\n');
  git(vendor, 'init', '--quiet');
  const commit = message => {
    git(vendor, 'add', '.');
    git(vendor, 'commit', '--quiet', '-m', message);
    return git(vendor, 'rev-parse', 'HEAD');
  };
  const first = commit('first reviewed fixture');
  fs.appendFileSync(join(vendor, service), '\n// Second fixture generation.\n');
  const second = commit('second reviewed fixture');
  const anchored = fs.readFileSync(join(vendor, service), 'utf8');
  const changed = anchored.replace('"Eliza agent · Running"', '"Changed fixture notification anchor"');
  assert.notEqual(changed, anchored);
  write(join(vendor, service), changed);
  const changedAnchor = commit('fixture with a changed rewrite anchor');
  git(directory, 'clone', '--quiet', vendor, runtime);
  const pins = [null, first, second, changedAnchor];
  const committedHashes = new Map();
  const committed = (checkout, pin, file) => execFileSync('git', ['-C', checkout, 'show', `${pin}:${file}`], {env: gitEnv});

  function setAdmission(kind) {
    const pin = git(vendor, 'rev-parse', 'HEAD');
    write(join(directory, lock), JSON.stringify({commit: kind === 'wrongPin' ? '0'.repeat(40) : pin}));
    write(source, committed(runtime, pin, service));
    if (kind === 'dirty') fs.appendFileSync(source, '\n// Unreviewed fixture edit.\n');
    if (kind !== 'noStamp') write(stamp, '{}\n');
    else if (fs.existsSync(stamp)) fs.unlinkSync(stamp);
  }

  function select(generation) {
    const pin = pins[generation];
    setAdmission('ready');
    for (const checkout of [vendor, runtime]) git(checkout, 'checkout', '--quiet', '--detach', pin);
    setAdmission('ready');
  }

  function run(fault = 'none') {
    const preload = fault === 'none' ? null : join(directory, 'closed-stage-fault.mjs');
    if (preload) write(preload, `import fs from 'node:fs';
import path from 'node:path';
const output = ${JSON.stringify(output)}, fault = ${JSON.stringify(fault)};
const rename = fs.renameSync, write = fs.writeFileSync;
const privateSlot = file => path.dirname(path.dirname(file)) === path.dirname(output) &&
  path.basename(path.dirname(file)).startsWith('.local-agent-stage-');
fs.renameSync = (from, to) => {
  if (fault === 'move' && from === output && privateSlot(to) && path.basename(to) === 'previous') throw Error('fixture move refused');
  if ((fault === 'publish' || fault === 'restore') && to === output && privateSlot(from) && path.basename(from) === 'candidate') throw Error('fixture publish refused');
  if (fault === 'restore' && to === output && privateSlot(from) && path.basename(from) === 'previous') throw Error('fixture restore refused');
  return rename(from, to);
};
fs.writeFileSync = (file, ...args) => {
  if (fault === 'manifest' && typeof file === 'string' && path.basename(file) === 'source-manifest.json' &&
    privateSlot(path.dirname(file))) throw Error('fixture manifest refused');
  return write(file, ...args);
};
`);
    const result = spawnSync(process.execPath, [...(preload ? ['--preload', preload] : []), stageScript], {
      cwd: directory, encoding: 'utf8', timeout: scaledTimeout(30000), env: {...gitEnv, ALPHA_LOCAL_AGENT_SOURCE_DIR: runtime},
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  }

  function snapshot(target = output) {
    if (!fs.existsSync(target)) return null;
    const entries = fs.readdirSync(target, {recursive: true, withFileTypes: true});
    return Object.fromEntries(entries.filter(entry => !entry.isDirectory()).map(entry => {
      assert.ok(entry.isFile());
      const file = join(entry.parentPath, entry.name);
      return [file.slice(target.length + 1), hash(fs.readFileSync(file))];
    }));
  }

  function readPair(target) {
    const files = snapshot(target);
    if (!files?.['source-manifest.json']) {
      assert.ok(!files || Object.keys(files).every(name => name === 'unexpected.txt'), 'No Java tree may lack its manifest');
      return 0;
    }
    const manifest = JSON.parse(fs.readFileSync(join(target, 'source-manifest.json'), 'utf8'));
    const generation = pins.indexOf(manifest.pin);
    assert.ok(generation === 1 || generation === 2, 'Only a successful candidate may be published or retained');
    assert.deepEqual(manifest.runtimeSource, {commit: manifest.pin});
    assert.deepEqual(manifest.patches, []);
    assert.equal(manifest.identity, JSON.parse(fs.readFileSync(join(directory, config))).appId);
    assert.deepEqual(manifest.files.map(row => row.path), sources);
    const listed = new Set(['source-manifest.json', ...(files['unexpected.txt'] ? ['unexpected.txt'] : [])]);
    for (const row of manifest.files) {
      const generated = relative(generatedDirectory, row.generatedPath);
      assert.ok(generated.startsWith('java/'), 'Receipt must describe the published path even when inspecting a backup');
      assert.equal(row.generatedPath, join(generatedDirectory, generated));
      assert.ok(!listed.has(generated), 'A generated path has one origin');
      const key = `${manifest.pin}:${row.path}`;
      if (!committedHashes.has(key)) committedHashes.set(key, hash(committed(vendor, manifest.pin, row.path)));
      assert.equal(row.sourceSha256, committedHashes.get(key));
      assert.equal(row.sha256, row.sourceSha256);
      assert.equal(files[generated], row.generatedSha256);
      if (row.path === service) {
        const staged = fs.readFileSync(join(target, generated), 'utf8');
        assert.ok(staged.includes(`package ${manifest.identity};`));
        assert.equal(staged.includes('// Second fixture generation.'), generation === 2);
      }
      listed.add(generated);
    }
    assert.deepEqual(new Set(Object.keys(files)), listed);
    return generation;
  }

  function transactionDirectory() {
    const parent = dirname(output);
    const pending = fs.existsSync(parent) ? fs.readdirSync(parent).filter(name => name.startsWith('.local-agent-stage-')) : [];
    assert.ok(pending.length <= 1, 'The fixture bounds a single retained transaction');
    return pending.length ? join(parent, pending[0]) : null;
  }

  function observe() {
    const pin = git(vendor, 'rev-parse', 'HEAD');
    const selected = pins.indexOf(pin);
    assert.ok(selected > 0);
    assert.equal(git(runtime, 'rev-parse', 'HEAD'), pin);
    const admitted = JSON.parse(fs.readFileSync(join(directory, lock), 'utf8')).commit;
    const admission = admitted !== pin ? 'wrongPin' : !fs.existsSync(stamp) ? 'noStamp'
      : git(runtime, 'diff', '--name-only', 'HEAD') ? 'dirty' : 'ready';
    const transaction = transactionDirectory();
    const occupied = fs.existsSync(join(output, 'unexpected.txt'));
    if (occupied) assert.equal(fs.readFileSync(join(output, 'unexpected.txt'), 'utf8'), 'peer fixture\n');
    return {selected, admission, occupied, published: readPair(output),
      previous: transaction ? readPair(join(transaction, 'previous')) : 0,
      candidate: transaction ? readPair(join(transaction, 'candidate')) : 0};
  }

  function occupy(value) {
    const file = join(output, 'unexpected.txt');
    if (value) write(file, 'peer fixture\n');
    else fs.unlinkSync(file);
  }

  function retainedSnapshot() {
    const transaction = transactionDirectory();
    return transaction ? snapshot(join(transaction, 'previous')) : null;
  }

  return {select, setAdmission, run, snapshot, observe, occupy, retainedSnapshot};
}
