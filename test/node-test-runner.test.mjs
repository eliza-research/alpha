import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

for (const filter of ['selected', 'failure']) test(`npm test forwards the name filter and exit status: ${filter}`, t => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-test-runner-'));
 t.after(() => fs.rmSync(root, {recursive: true, force: true}));
 fs.mkdirSync(path.join(root, 'scripts')); fs.mkdirSync(path.join(root, 'test'));
 for (const file of ['run-node-tests.ts', 'child-command.ts']) fs.copyFileSync(new URL(`../scripts/${file}`, import.meta.url), path.join(root, 'scripts', file));
 fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
 fs.writeFileSync(path.join(root, 'test/fixture.test.mjs'), `
  import test from 'node:test'; import fs from 'node:fs';
  test('selected', () => fs.appendFileSync('ran.txt', 'selected'));
  test('failure', () => { fs.appendFileSync('ran.txt', 'failure'); throw Error('fixture failure'); });
 `);
 // The default suite leaves out test/quint-*; `npm run quint:tests` names those files.
 fs.writeFileSync(path.join(root, 'test/quint-fixture.test.mjs'), `
  import test from 'node:test'; import fs from 'node:fs';
  for (const name of ['selected', 'failure']) test(name, () => fs.appendFileSync('ran.txt', 'quint'));
 `);
 const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
 const result = spawnSync(process.execPath, [path.join(root, 'scripts/run-node-tests.ts'), `--test-name-pattern=^${filter}$`],
   {env, encoding: 'utf8', timeout: 30000});
 assert.equal(result.status, filter === 'failure' ? 1 : 0, result.stdout + result.stderr);
 assert.equal(fs.readFileSync(path.join(root, 'ran.txt'), 'utf8'), filter);
});

test('npm run quint:tests runs only the quint suites', t => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-test-runner-'));
 t.after(() => fs.rmSync(root, {recursive: true, force: true}));
 fs.mkdirSync(path.join(root, 'scripts')); fs.mkdirSync(path.join(root, 'test'));
 for (const file of ['run-node-tests.ts', 'child-command.ts']) fs.copyFileSync(new URL(`../scripts/${file}`, import.meta.url), path.join(root, 'scripts', file));
 fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
 for (const name of ['fixture', 'quint-fixture']) fs.writeFileSync(path.join(root, `test/${name}.test.mjs`), `
  import test from 'node:test'; import fs from 'node:fs';
  test('runs', () => fs.appendFileSync('ran.txt', '${name}'));
 `);
 const suites = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts['quint:tests']
   .match(/'[^']+'/g).map(glob => glob.slice(1, -1));
 assert.deepEqual(suites, ['test/quint-*.test.mjs', 'test/quint-*.test.ts']);
 const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
 const result = spawnSync(process.execPath, [path.join(root, 'scripts/run-node-tests.ts'), ...suites], {env, encoding: 'utf8', timeout: 30000});
 assert.equal(result.status, 0, result.stdout + result.stderr);
 assert.equal(fs.readFileSync(path.join(root, 'ran.txt'), 'utf8'), 'quint-fixture');
});
