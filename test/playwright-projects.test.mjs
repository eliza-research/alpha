import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { STORAGE_SPECS } from '../scripts/storage-specs.mjs';

// The *.production specs carry no project guard, so the project lists alone must keep them out
// of the development lanes. A misconfigured match fails here instead of running a production
// spec against the flag-on development server.
const root = resolve(import.meta.dirname, '..');
const { default: config } = await import('../playwright.config.ts');
const specs = readdirSync(join(root, 'test/browser'), { recursive: true })
  .filter(name => String(name).endsWith('.spec.ts'))
  .map(name => join(root, 'test/browser', String(name)));
const production = name => /(production-surface|\.production)\.spec\.ts$/.test(name);
const patterns = value => value === undefined ? [] : [value].flat();
const runs = (project, file) => {
  for (const pattern of [...patterns(project.testMatch), ...patterns(project.testIgnore)]) {
    assert.ok(pattern instanceof RegExp, `${project.name} uses a non-RegExp match this check cannot evaluate`);
  }
  const match = patterns(project.testMatch);
  return (!match.length || match.some(pattern => pattern.test(file)))
    && !patterns(project.testIgnore).some(pattern => pattern.test(file));
};

test('every production spec runs only in the production project', () => {
  const productionSpecs = specs.filter(production);
  assert.ok(productionSpecs.length > 0);
  for (const file of productionSpecs) {
    assert.deepEqual(config.projects.filter(project => runs(project, file)).map(project => project.name), ['production'], file);
  }
});

test('the production project runs no development spec', () => {
  const project = config.projects.find(entry => entry.name === 'production');
  assert.deepEqual(specs.filter(file => !production(file) && runs(project, file)), []);
});

test('the firefox and webkit storage list holds no production spec', () => {
  assert.deepEqual(STORAGE_SPECS.filter(production), []);
});
