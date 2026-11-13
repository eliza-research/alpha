import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {stripErasableTypes} from './support/strip-types.mjs';

test('host tooling stays migrated and runs on native TypeScript', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const files = execFileSync('git', ['ls-files', '-z', 'scripts'], {cwd:root, encoding:'utf8'})
    .split('\0').filter(file => file && fs.existsSync(path.join(root, file)));
  assert.deepEqual(files.filter(file => /\.(?:mjs|cjs|js)$/.test(file)), []);
  for (const file of files.filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts'))) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotThrow(() => stripErasableTypes(source), `${file} must stay erasable TypeScript`);
  }
});
