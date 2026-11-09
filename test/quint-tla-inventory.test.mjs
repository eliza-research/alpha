import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {loadModels, readJson, repositoryRoot, sha256} from '../scripts/quint-lib.mjs';
import {authenticateFormalSources, materializeHistoricalFormalSources} from '../specs/quint/legacy/core/formal-source-inventory.mjs';
import {git as fixtureGit} from './fixtures/git-fixture.mjs';
import {prepareQuintHistory} from '../scripts/prepare-quint-history.mjs';

const sourcePath = 'specs/quint/legacy/core/source-inventory.json';
const viewRefreshPath = 'specs/quint/legacy/view-refresh-configurations.json';
const gitPaths = (directory, args) => execFileSync('git', ['-C', directory, ...args], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024})
  .split('\0').filter(path => /\.(tla|cfg)$/.test(path)).sort();

test('all tracked TLA+ specifications and configurations have Quint translations', () => {
  const models = new Map(loadModels().map(model => [model.module, model]));
  const core = readJson(resolve(repositoryRoot, sourcePath));
  const pin = readJson(resolve(repositoryRoot, 'upstream.lock.json')).commit;
  const upstream = resolve(repositoryRoot, 'vendor/eliza');
  const coreFiles = [];
  for (const source of core.models) {
    const model = models.get(source.quintModule);
    assert.ok(model, `Register the Quint translation of ${source.source}`);
    assert.equal(model.classification, 'upstream-design-conversion');
    assert.deepEqual(model.configurations.map(config => config.name).sort(), source.configs.map(config => config.name).sort());
    for (const {path} of [{path: source.source, sha256: source.sha256}, ...source.configs]) {
      coreFiles.push(path);
    }
  }
  authenticateFormalSources(upstream, core.revision, core.models, models);
  assert.equal(core.currentUpstream.revision, pin, 'Review the live formal-source inventory after an upstream pin change');
  authenticateFormalSources(upstream, pin, core.currentUpstream.models, models);
  assert.equal(core.models.length, core.modelCount);
  assert.equal(coreFiles.length - core.models.length, core.configurationCount);

  const design = readJson(resolve(repositoryRoot, viewRefreshPath));
  const productFiles = [];
  for (const source of design.models) {
    assert.ok(models.has(source.module), `Register the Quint translation of ${source.legacySource.path}`);
    for (const {path, sha256: expected} of [source.legacySource, ...source.configurations.map(config => config.legacyConfiguration)]) {
      productFiles.push(path);
      assert.equal(sha256(readFileSync(resolve(repositoryRoot, path))), expected, path);
    }
  }
  assert.deepEqual(gitPaths(repositoryRoot, ['ls-files', '-z', '--', '*.tla', '*.cfg']), productFiles.sort());
});

test('formal history preparation fetches only the missing revision in a shallow clone and preserves HEAD', () => {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-formal-history-'));
  try {
    const origin = join(directory, 'origin'), root = join(directory, 'product'), vendor = join(root, 'vendor/eliza');
    mkdirSync(origin);mkdirSync(join(root, 'vendor'), {recursive:true});
    const git = (...args) => fixtureGit(origin, ...args);
    const original = '---- MODULE Fixture ----\n====\n';
    git('init', '-q');writeFileSync(join(origin, 'Fixture.tla'), original);
    git('add', '.');git('commit', '-qm', 'Original specification');
    const revision = git('rev-parse', 'HEAD');
    git('rm', 'Fixture.tla');writeFileSync(join(origin, 'current.txt'), 'Current application');
    git('add', '.');git('commit', '-qm', 'Current source retires specification');
    const head = git('rev-parse', 'HEAD');
    fixtureGit(directory, 'clone', '--no-local', '--depth=1', pathToFileURL(origin).href, vendor);
    const metadata = join(root, 'specs/quint/legacy/core');mkdirSync(metadata, {recursive:true});
    const inventory = {revision,models:[{source:'Fixture.tla',sha256:sha256(original),configs:[]}]};
    writeFileSync(join(metadata, 'source-inventory.json'), JSON.stringify(inventory));
    assert.throws(()=>fixtureGit(vendor, 'cat-file', '-e', revision+'^{commit}'));
    assert.deepEqual(prepareQuintHistory(root), {revision, fetched:true});
    assert.equal(fixtureGit(vendor, 'rev-parse', 'HEAD'), head);
    assert.equal(fixtureGit(vendor, 'rev-parse', '--is-shallow-repository'), 'true');
    assert.deepEqual(prepareQuintHistory(root), {revision, fetched:false});
    assert.equal(fixtureGit(vendor, 'rev-parse', 'HEAD'), head);
    const input = 'vendor/eliza/Fixture.tla';
    const history = materializeHistoricalFormalSources(root,[input]);
    assert.equal(readFileSync(history.resolveSource(input),'utf8'), original);
    assert.ok(history.resolveSource(input).startsWith(join(root,'.eliza/quint-historical',revision)));
    assert.equal(fixtureGit(vendor,'status','--short'), '', 'Historical materialization never writes to vendor');
    assert.equal(readJson(join(root,'.eliza/quint-historical',revision,'.source.json')).revision,revision);
    writeFileSync(join(metadata, 'source-inventory.json'), JSON.stringify({...inventory,models:[{...inventory.models[0],sha256:'0'.repeat(64)}]}));
    assert.throws(()=>materializeHistoricalFormalSources(root,[input]), /Historical specification differs/);
  } finally {rmSync(directory, {recursive:true,force:true});}
});

test('historical formal-source authentication cannot hide a new live specification or changed historical bytes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-formal-source-'));
  const git = (...args) => fixtureGit(directory, ...args);
  try {
    git('init', '-q');
    const source = '---- MODULE Fixture ----\n====\n', config = 'CONSTANT N = 1\n';
    writeFileSync(join(directory, 'Fixture.tla'), source);writeFileSync(join(directory, 'Fixture.cfg'), config);
    git('add', '.');git('commit', '-qm', 'Historical formal sources');
    const historical = git('rev-parse', 'HEAD');
    const model = {quintModule:'Fixture',source:'Fixture.tla',sha256:sha256(source),configs:[{path:'Fixture.cfg',sha256:sha256(config)}]};
    const registered = new Set(['Fixture']);
    authenticateFormalSources(directory, historical, [model], registered);
    git('rm', 'Fixture.tla', 'Fixture.cfg');git('commit', '-qm', 'Upstream retires TLA sources');
    const retired = git('rev-parse', 'HEAD');
    authenticateFormalSources(directory, retired, [], registered);
    authenticateFormalSources(directory, historical, [model], registered);
    writeFileSync(join(directory, 'New.tla'), '---- MODULE New ----\n====\n');
    git('add', '.');git('commit', '-qm', 'New formal source requires allocation');
    assert.throws(()=>authenticateFormalSources(directory, git('rev-parse', 'HEAD'), [], registered), /Unallocated or removed formal sources/);
    assert.throws(()=>authenticateFormalSources(directory, historical, [{...model,sha256:'0'.repeat(64)}], registered));
    assert.throws(()=>authenticateFormalSources(directory, historical, [model], new Set()), /Register the Quint translation/);
  } finally {rmSync(directory, {recursive:true,force:true});}
});
