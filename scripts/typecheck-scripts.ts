#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const compiler = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
const result = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.scripts.json', '--pretty', 'false'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});

if (result.error) throw result.error;
if (result.stderr) process.stderr.write(result.stderr);

// Check repository tooling without making its optional, pinned dependencies a
// second build target. npm run typecheck separately checks the application.
const diagnostics: string[] = [];
let inScope = true;
for (const line of result.stdout.split(/\r?\n/)) {
  if (!line) continue;
  if (!/^\s/.test(line)) {
    const location = /^(.*)\(\d+,\d+\): error TS\d+:/.exec(line)?.[1];
    inScope = !location || location.startsWith('scripts/') || location.startsWith('scripts\\');
  }
  if (inScope) diagnostics.push(line);
}

const compilerFailed = ![0, 1, 2].includes(result.status ?? -1) || (result.status !== 0 && !result.stdout.trim());
if (diagnostics.length || result.stderr || compilerFailed) {
  if (diagnostics.length) console.error(diagnostics.join('\n'));
  if (compilerFailed) console.error(`TypeScript compiler failed (${result.signal ?? result.status})`);
  process.exitCode = 1;
} else {
  console.log('Script typecheck passed');
}
