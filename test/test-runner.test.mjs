import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

for (const filter of ['selected', 'failure']) test(`bun run test forwards the name filter and exit status: ${filter}`, t => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-test-runner-'));
 t.after(() => fs.rmSync(root, {recursive: true, force: true}));
 fs.mkdirSync(path.join(root, 'scripts')); fs.mkdirSync(path.join(root, 'test'));
 for (const file of ['run-tests.ts', 'child-command.ts', 'host-test-runtime.ts', 'host-test-runtime.json']) fs.copyFileSync(new URL(`../scripts/${file}`, import.meta.url), path.join(root, 'scripts', file));
 fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
 fs.writeFileSync(path.join(root, 'test/fixture.test.mjs'), `
  import test from 'node:test'; import fs from 'node:fs';
  const record = () => fs.writeFileSync('runtime.json', JSON.stringify({bun:process.versions.bun,builder:process.env.ALPHA_BUN,path:process.env.PATH}));
  test('selected', () => {record(); fs.appendFileSync('ran.txt', 'selected');});
  test('failure', () => {record(); fs.appendFileSync('ran.txt', 'failure'); throw Error('fixture failure'); });
 `);
 // The default suite leaves out test/quint-*; `bun run quint:tests` names those files.
 fs.writeFileSync(path.join(root, 'test/quint-fixture.test.mjs'), `
  import test from 'node:test'; import fs from 'node:fs';
  for (const name of ['selected', 'failure']) test(name, () => fs.appendFileSync('ran.txt', 'quint'));
 `);
 const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
 const result = spawnSync(process.execPath, [path.join(root, 'scripts/run-tests.ts'), '--test-name-pattern', `^${filter}$`],
   {env, encoding: 'utf8', timeout: 30000});
 assert.equal(result.status, filter === 'failure' ? 1 : 0, result.stdout + result.stderr);
 assert.equal(fs.readFileSync(path.join(root, 'ran.txt'), 'utf8'), filter);
 const runtime = JSON.parse(fs.readFileSync(path.join(root, 'runtime.json')));
 assert.equal(runtime.bun, '1.4.4');
 assert.equal(runtime.builder, env.ALPHA_BUN ?? process.execPath);
 assert.equal(runtime.path, env.PATH, 'The test runtime does not shadow the builder on PATH');
 const identity = JSON.parse(fs.readFileSync(path.join(root, 'test-results/host-test-runtime.json')));
 assert.deepEqual(identity.files.map(file => fs.realpathSync(file)), [fs.realpathSync(path.join(root, 'test/fixture.test.mjs'))]);
 assert.equal(identity.builder.version, '1.4.2');
 assert.deepEqual(identity.args.slice(0, 5), ['test', '--parallel=' + (env.ALPHA_TEST_CONCURRENCY || '4'), '--timeout=600000', '--test-name-pattern', `^${filter}$`]);
});

test('bun run quint:tests runs only the quint suites', t => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-test-runner-'));
 t.after(() => fs.rmSync(root, {recursive: true, force: true}));
 fs.mkdirSync(path.join(root, 'scripts')); fs.mkdirSync(path.join(root, 'test'));
 for (const file of ['run-tests.ts', 'child-command.ts', 'host-test-runtime.ts', 'host-test-runtime.json']) fs.copyFileSync(new URL(`../scripts/${file}`, import.meta.url), path.join(root, 'scripts', file));
 fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
 for (const name of ['fixture', 'quint-fixture']) fs.writeFileSync(path.join(root, `test/${name}.test.mjs`), `
  import test from 'node:test'; import fs from 'node:fs';
  test('runs', () => fs.appendFileSync('ran.txt', '${name}'));
 `);
 const suites = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts['quint:tests']
   .match(/'[^']+'/g).map(glob => glob.slice(1, -1));
 const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
 const result = spawnSync(process.execPath, [path.join(root, 'scripts/run-tests.ts'), ...suites], {env, encoding: 'utf8', timeout: 30000});
 assert.equal(result.status, 0, result.stdout + result.stderr);
 assert.equal(fs.readFileSync(path.join(root, 'ran.txt'), 'utf8'), 'quint-fixture');
 const identity = JSON.parse(fs.readFileSync(path.join(root, 'test-results/host-test-runtime.json')));
 assert.deepEqual(identity.files.map(file => fs.realpathSync(file)), [fs.realpathSync(path.join(root, 'test/quint-fixture.test.mjs'))]);
});

test('the host-test runner preserves the builder default, parallelism and child signal', t => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-test-runner-'));
 t.after(() => fs.rmSync(root, {recursive:true, force:true}));
 fs.mkdirSync(path.join(root, 'scripts')); fs.mkdirSync(path.join(root, 'test'));
 for (const file of ['run-tests.ts','child-command.ts','host-test-runtime.ts','host-test-runtime.json'])
  fs.copyFileSync(new URL(`../scripts/${file}`, import.meta.url), path.join(root,'scripts',file));
 fs.writeFileSync(path.join(root,'package.json'), '{"type":"module"}');
 fs.writeFileSync(path.join(root,'test/signal.test.mjs'), `import test from 'node:test';test('signal',()=>process.kill(process.pid,'SIGTERM'));`);
 const builder = process.env.ALPHA_BUN ?? process.execPath;
 const env = {...process.env, ALPHA_TEST_CONCURRENCY:'2'}; delete env.NODE_TEST_CONTEXT; delete env.ALPHA_BUN;
 const result = spawnSync(builder, [path.join(root,'scripts/run-tests.ts')], {env,encoding:'utf8',timeout:30000});
 assert.equal(result.signal, 'SIGTERM', result.stdout+result.stderr);
 const identity = JSON.parse(fs.readFileSync(path.join(root,'test-results/host-test-runtime.json')));
 assert.equal(identity.builder.file, builder);
 assert.equal(identity.builder.version, '1.4.2');
 assert.equal(identity.runtime.version, '1.4.4');
 assert.deepEqual(identity.args.slice(0,3), ['test','--parallel=2','--timeout=600000']);
});
