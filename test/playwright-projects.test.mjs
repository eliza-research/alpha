import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {test} from 'node:test';
import {STORAGE_SPECS} from '../scripts/storage-specs.ts';

// Loads the real Playwright config and routes every spec on disk through its projects.
const specs = readdirSync('test/browser').filter(name => name.endsWith('.spec.ts')).map(name => `test/browser/${name}`);
const production = file => /(production-surface|\.production)\.spec\.ts$/.test(file);
const live = file => /\.local\.spec\.ts$/.test(file);
const patterns = value => value === undefined ? undefined : [value].flat();
function runs(project, file) {
  const absolute = resolve(file), match = patterns(project.testMatch), ignore = patterns(project.testIgnore) ?? [];
  for (const pattern of [...match ?? [], ...ignore]) assert.ok(pattern instanceof RegExp, `${project.name} uses a non-RegExp pattern`);
  return (!match || match.some(pattern => pattern.test(absolute))) && !ignore.some(pattern => pattern.test(absolute));
}
const routing = config => file => config.projects.filter(project => runs(project, file)).map(project => project.name);

test('production specs run only in the production project and live specs in no default project', async () => {
  const {default: config} = await import('../playwright.config.ts');
  assert.equal(config.forbidOnly, true);
  assert.deepEqual(config.projects.map(project => project.name), ['chromium', 'production', 'firefox', 'webkit']);
  const projectsFor = routing(config);
  assert.ok(specs.some(production) && specs.some(live));
  for (const file of specs) {
    const expected = production(file) ? ['production'] : live(file) ? [] : ['chromium', ...(STORAGE_SPECS.includes(file) ? ['firefox', 'webkit'] : [])];
    assert.deepEqual(projectsFor(file), expected, file);
  }
});

test('the storage inventory names existing development specs only', () => {
  for (const file of STORAGE_SPECS) {
    assert.ok(specs.includes(file), `${file} does not exist`);
    assert.ok(!production(file) && !live(file), file);
  }
});

test('the live project runs only the live specs and exists only when selected', async () => {
  const argv = process.argv;
  process.argv = [...argv, '--project=live'];
  try {
    const {default: config} = await import('../playwright.config.ts?live');
    const project = config.projects.find(entry => entry.name === 'live');
    assert.ok(project);
    for (const file of specs) assert.equal(runs(project, file), live(file), file);
  } finally { process.argv = argv; }
});
