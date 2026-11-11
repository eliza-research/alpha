import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script = fileURLToPath(new URL('../scripts/check-lemma.mjs', import.meta.url));
const SOURCE = 'apps/app/src/sample.ts';

// Stand-in for lsc: no TypeScript project, no Dafny. It records each command, "generates" a
// model that depends only on the source text, and reports a verifier summary for `check`.
const STUB_LSC = `
import fs from 'node:fs';
import path from 'node:path';
const [command, ...rest] = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_LOG, command + '\\n');
if (command === 'version') { console.log('0.0.0-stub'); process.exit(0); }
const file = rest.find(arg => !arg.startsWith('--'));
const source = fs.readFileSync(file, 'utf8');
if (command === 'extract') {
  const read = source.split('\\n').filter(line => /\\/\\/@ (requires|ensures)/.test(line) && !line.includes('ignored')).map(line => line.replace(/^.*\\/\\/@ \\w+\\s+/, '').trim());
  console.log(JSON.stringify({functions: source.includes('//@ verify') ? [{name: 'sample', ensures: read}] : []}));
  process.exit(0);
}
const base = path.join('specs/lemma/proofs', path.dirname(file), path.basename(file, '.ts'));
const generated = '// stub model of ' + source.length + ' characters\\n';
fs.writeFileSync(base + '.dfy.gen', generated);
if (!fs.readFileSync(base + '.dfy', 'utf8').startsWith(generated)) { console.error('WARNING: sample.dfy has modifications to generated lines (not additions-only):'); process.exit(1); }
if (command === 'gen-check') process.exit(0);
if (command !== 'check') process.exit(64);
const errors = Number(process.env.STUB_ERRORS || 0);
console.log('Dafny program verifier finished with 2 verified, ' + errors + ' errors');
process.exit(errors ? 1 : 0);
`;

function fixture(t, source = 'export function sample(x: number): number {\n  //@ verify\n  //@ ensures \\result === x\n  return x;\n}\n') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-lemma-check-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const write = (file, text, mode) => { fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true}); fs.writeFileSync(path.join(root, file), text, mode ? {mode} : undefined); };
  write('lemmascript.json', '{"proof-dir":"specs/lemma/proofs"}\n');
  write('specs/lemma/LemmaScript-files.txt', `# targets\n${SOURCE}\n`);
  write(SOURCE, source);
  const generated = `// stub model of ${source.length} characters\n`;
  write('specs/lemma/proofs/apps/app/src/sample.dfy.gen', generated);
  write('specs/lemma/proofs/apps/app/src/sample.dfy', `${generated}// proof additions\n`);
  write('tools/lsc.mjs', STUB_LSC);
  write('empty-path/.keep', '');
  const log = path.join(root, 'lsc.log');
  fs.writeFileSync(log, '');
  /** A fake `dafny` that only answers --version. */
  const dafny = version => { write(`dafny-${version}/dafny`, `#!/bin/sh\necho "${version}+stub"\n`, 0o755); return path.join(root, `dafny-${version}/dafny`); };
  const run = (env = {}, ...args) => {
    // PATH holds nothing, so no real dafny on this machine can be picked up.
    const result = spawnSync(process.execPath, [script, `--root=${root}`, ...args], {encoding: 'utf8', env: {
      PATH: path.join(root, 'empty-path'), LEMMASCRIPT_BIN: path.join(root, 'tools/lsc.mjs'), STUB_LOG: log, ...env,
    }});
    const receiptFile = path.join(root, 'test-results/lemma/check.json');
    return {...result, receipt: fs.existsSync(receiptFile) ? JSON.parse(fs.readFileSync(receiptFile, 'utf8')) : null, commands: fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)};
  };
  return {root, run, write, dafny, generated};
}

test('without a backend the proofs are skipped, warned about and never reported as passed', t => {
  const {run} = fixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /WARNING: LemmaScript proofs were NOT checked/);
  assert.equal(result.receipt.status, 'skipped-no-backend');
  assert.equal(result.receipt.passed, false);
  assert.equal(result.receipt.tools.lemmascript, '0.0.0-stub');
  assert.match(result.receipt.tools.dafny.unavailable, /no dafny on PATH/);
  assert.deepEqual(result.receipt.files.map(row => [row.file, row.annotations, row.generated, row.proof]), [[SOURCE, 'read', 'fresh', 'skipped-no-backend']]);
  // The freshness check still ran; the verifier did not.
  assert.ok(result.commands.includes('gen-check'));
  assert.ok(!result.commands.includes('check'));
});

test('LEMMA_REQUIRE_BACKEND=1 turns a missing backend into exit 2', t => {
  const {run} = fixture(t);
  const result = run({LEMMA_REQUIRE_BACKEND: '1'});
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.receipt.status, 'skipped-no-backend');
  assert.equal(result.receipt.passed, false);
  assert.equal(result.receipt.backendRequired, true);
});

test('a Dafny other than 4.11.x is not a backend', t => {
  const {run, dafny} = fixture(t);
  const result = run({DAFNY: dafny('4.9.1'), LEMMA_REQUIRE_BACKEND: '1'});
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.receipt.status, 'skipped-no-backend');
  assert.equal(result.receipt.tools.dafny.version, '4.9.1');
  assert.ok(!result.commands.includes('check'));
});

test('a stale generated file fails without a backend and the check leaves the tree as it was', t => {
  const {root, run, write} = fixture(t);
  const generated = path.join(root, 'specs/lemma/proofs/apps/app/src/sample.dfy.gen');
  write('specs/lemma/proofs/apps/app/src/sample.dfy.gen', '// stub model of 1 characters\n');
  const result = run();
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.receipt.status, 'failed');
  assert.equal(result.receipt.files[0].generated, 'stale');
  assert.equal(fs.readFileSync(generated, 'utf8'), '// stub model of 1 characters\n');
});

test('a missing proof file and a proof that edits generated lines both fail', t => {
  const {root, run, write} = fixture(t);
  write('specs/lemma/proofs/apps/app/src/sample.dfy', '// rewritten\n');
  let result = run();
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.receipt.files[0].generated, 'not-additions-only');
  fs.rmSync(path.join(root, 'specs/lemma/proofs/apps/app/src/sample.dfy'));
  result = run();
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.receipt.files[0].generated, 'missing');
});

test('annotations nothing reads are errors', t => {
  const {run, write} = fixture(t, 'export function sample(x: number): number {\n  //@ verify\n  //@ ensures \\result === x\n  return x;\n}\nexport function other(x: number): number {\n  //@ ensures ignored(x)\n  return x;\n}\n');
  let result = run();
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.receipt.files[0].annotations, 'unread');
  assert.match(result.stderr, /unread annotations.*ensures ignored\(x\)/);

  // An annotated file that the manifest does not list.
  write('apps/app/src/unlisted.ts', 'export function unlisted(x: number): number {\n  //@ verify\n  return x;\n}\n');
  result = run();
  assert.equal(result.status, 1);
  assert.ok(result.receipt.problems.some(text => /unlisted\.ts has \/\/@ annotations but is not listed/.test(text)));
});

test('assume is refused in the source and in the proof file', t => {
  const {run, write, generated} = fixture(t);
  write('specs/lemma/proofs/apps/app/src/sample.dfy', `${generated}lemma L() ensures false { assume false; }\n`);
  const result = run();
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.receipt.files[0].proof, 'assumes');
});

test('with Dafny 4.11.x the verifier result decides: zero errors pass, any error fails', t => {
  const {run, dafny} = fixture(t);
  const backend = dafny('4.11.0');
  let result = run({DAFNY: backend});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.receipt.status, 'passed');
  assert.equal(result.receipt.passed, true);
  assert.deepEqual(result.receipt.tools.dafny, {path: backend, version: '4.11.0'});
  assert.deepEqual([result.receipt.files[0].proof, result.receipt.files[0].verified, result.receipt.files[0].errors], ['verified', 2, 0]);
  assert.ok(result.commands.includes('check'));

  result = run({DAFNY: backend, STUB_ERRORS: '1'});
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.receipt.status, 'failed');
  assert.equal(result.receipt.passed, false);
  assert.equal(result.receipt.files[0].proof, 'failed');
});

test('without lsc the check fails instead of skipping', t => {
  const {root, run} = fixture(t);
  const result = run({LEMMASCRIPT_BIN: path.join(root, 'absent')});
  assert.equal(result.status, 1);
  assert.equal(result.receipt.status, 'failed');
  assert.match(result.stderr, /LemmaScript \(lsc\) not found/);
});
