import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadModels, readJson, repositoryRoot, sha256} from '../scripts/quint-lib.mjs';

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
    for (const {path, sha256: expected} of [{path: source.source, sha256: source.sha256}, ...source.configs]) {
      coreFiles.push(path);
      assert.equal(sha256(execFileSync('git', ['-C', upstream, 'cat-file', 'blob', `${pin}:${path}`])), expected, path);
    }
  }
  assert.deepEqual(gitPaths(upstream, ['ls-tree', '-r', '--name-only', '-z', pin]), coreFiles.sort());
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
