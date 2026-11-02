import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts/prepare-embedding-host.mjs'), 'utf8');
const match = source.match(/const producerInputPaths=(\[[\s\S]*?\]);/);
assert.ok(match, 'producer declares its copied source closure');
const copied = new Set(JSON.parse(match[1]));

function checkClosure(read, allowed) {
  const pending = ['packages/app/scripts/stage-elizavoice-lib.ts'], seen = new Set();
  while (pending.length) {
    const name = pending.pop();
    if (seen.has(name)) continue;
    assert.ok(allowed.has(name), `producer does not copy ${name}`);
    seen.add(name);
    assert.ok(seen.size <= 60, 'producer source closure stays bounded');
    const text = read(name);
    for (const [, target] of text.matchAll(/(?:from\s*|import\s*\(?\s*)["']([^"']+)["']/g)) {
      if (target.startsWith('node:')) continue;
      assert.ok(target.startsWith('.'), `undeclared package dependency ${target}`);
      assert.match(target, /\.(?:ts|js|mjs|json)$/, `unresolved producer import ${target}`);
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), target));
      assert.ok(!resolved.startsWith('../'), 'producer import escapes the source root');
      pending.push(resolved);
    }
  }
  return seen;
}

test('the actual pinned engine producer imports are copied before it runs', () => {
  const read = name => fs.readFileSync(path.join(root, 'vendor/eliza', name), 'utf8');
  const reached = checkClosure(read, copied);
  assert.ok(reached.has('packages/app/scripts/aosp/compile-libllama.ts'));
  for (const name of ['package.json', 'packages/app/package.json', 'packages/agent/package.json']) {
    assert.ok(copied.has(name), `repository root discovery needs ${name}`);
    assert.ok(JSON.parse(read(name)).name, 'repository-shape file is genuine package metadata');
  }
  assert.ok(source.indexOf('const producerInputs=[]') < source.indexOf('for(const [executable,...argv] of commands)'));
  assert.match(source, /identity,abi,inputs,producerInputs,/);
  assert.match(source, /Producer input overlaps a relocated native input/);
});

test('an omitted transitive producer module is refused', () => {
  const entry = 'packages/app/scripts/stage-elizavoice-lib.ts';
  assert.throws(() => checkClosure(() => "import './missing.ts';", new Set([entry])), /does not copy/);
});

test('an undeclared package import is refused rather than installed implicitly', () => {
  const entry = 'packages/app/scripts/stage-elizavoice-lib.ts';
  assert.throws(() => checkClosure(() => "import value from 'unreviewed-package';", new Set([entry])), /undeclared package/);
});
