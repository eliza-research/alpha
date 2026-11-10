import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

for (const fail of [false, true]) test(`npm test ${fail ? 'stops when a contract fails' : 'retains the Notes query campaign after contracts'}`, t => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-test-runner-'));
 t.after(() => fs.rmSync(root, {recursive: true, force: true}));
 fs.mkdirSync(path.join(root, 'scripts')); fs.mkdirSync(path.join(root, 'test'));
 for (const file of ['run-node-tests.ts', 'child-command.ts']) fs.copyFileSync(new URL(`../scripts/${file}`, import.meta.url), path.join(root, 'scripts', file));
 fs.symlinkSync(path.resolve(import.meta.dirname, '../node_modules'), path.join(root, 'node_modules'));
 fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
 fs.writeFileSync(path.join(root, 'test/fixture.test.mjs'), `import test from 'node:test'; import fs from 'node:fs'; test('contract',()=>{fs.appendFileSync('order.txt','contract\\n');${fail ? "throw Error('fixture failure');" : ''}});`);
 fs.writeFileSync(path.join(root, 'scripts/test-notes-query-flow.ts'), `import fs from 'node:fs'; fs.appendFileSync('order.txt','notes\\n');`);
 const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
 const result = spawnSync(process.execPath, [path.join(root, 'scripts/run-node-tests.ts')], {env, encoding: 'utf8', timeout: 30000});
 assert.equal(result.status, fail ? 1 : 0, result.stdout + result.stderr);
 assert.equal(fs.readFileSync(path.join(root, 'order.txt'), 'utf8'), fail ? 'contract\n' : 'contract\nnotes\n');
});
