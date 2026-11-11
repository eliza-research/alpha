#!/usr/bin/env node
// LemmaScript proof gate (issue #856, W4).
//
// For every source listed in specs/lemma/LemmaScript-files.txt this script
//   1. checks that each `//@` contract annotation is read by LemmaScript (an annotation in a
//      function without `//@ verify`, or in a file that is not listed, proves nothing);
//   2. regenerates the Dafny model and fails when the committed `.dfy.gen` is stale or the
//      hand-written `.dfy` is no longer the generated text plus additions;
//   3. runs `lsc check` (Dafny) when a Dafny 4.11.x is available.
//
// Without a usable Dafny the proofs are NOT checked: the receipt says "skipped-no-backend",
// a warning is printed and the exit code is 0, or 2 when LEMMA_REQUIRE_BACKEND=1.
// A skip is never reported as a pass.
//
// Exit codes: 0 passed or skipped, 1 failed, 2 backend required but missing (or bad usage).
//
// Environment: LEMMASCRIPT_BIN (lsc when node_modules/.bin/lsc is absent), DAFNY (path to the
// dafny executable; else PATH), LEMMA_REQUIRE_BACKEND=1, LEMMA_CONCURRENCY (default 2).
// Options: --update (run `lsc regen --no-verify` first and keep the regenerated files),
// --root=<dir>, --out=<receipt path>, --files=<a,b> (subset of the manifest).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_DAFNY = /^4\.11\.\d+$/;
const MANIFEST = 'specs/lemma/LemmaScript-files.txt';
/** Repo-owned source roots whose `//@` annotations must be covered by the manifest. */
const ANNOTATED_ROOTS = ['apps/app/src'];
/** Annotations whose expression LemmaScript must have extracted. */
const CONTRACT = /^\s*\/\/@ (requires|ensures|invariant|decreases|done_with|assert)\s+(.+?)\s*$/;
const ANY_ANNOTATION = /^\s*\/\/@ \S/;

const args = process.argv.slice(2);
const option = (name, fallback) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
for (const arg of args) {
  if (arg !== '--update' && !['root', 'out', 'files'].some(name => arg.startsWith(`--${name}=`))) {
    console.error(`check-lemma: unknown option ${arg}`);
    process.exit(2);
  }
}
const update = args.includes('--update');
const root = resolve(option('root', join(dirname(fileURLToPath(import.meta.url)), '..')));
const receiptPath = resolve(root, option('out', 'test-results/lemma/check.json'));
const requireBackend = process.env.LEMMA_REQUIRE_BACKEND === '1';
const concurrency = Math.max(1, Math.min(8, Number.parseInt(process.env.LEMMA_CONCURRENCY || '2', 10) || 2));

const receipt = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  status: 'failed',
  passed: false,
  backendRequired: requireBackend,
  tools: { node: process.version, lemmascript: null, lsc: null, dafny: null, requiredDafny: '4.11.x' },
  files: [],
  problems: [],
};
let shim;
function finish(status, code) {
  if (shim) rmSync(shim, { recursive: true, force: true });
  receipt.status = status;
  receipt.passed = status === 'passed';
  receipt.finishedAt = new Date().toISOString();
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`check-lemma: ${status} (receipt ${relative(root, receiptPath) || receiptPath})`);
  process.exit(code);
}
function problem(message) {
  receipt.problems.push(message);
  console.error(`check-lemma: ${message}`);
}

// ---- tools -------------------------------------------------------------------------------

/** argv prefix that runs a tool: Node scripts run under this Node, so no `node` on PATH is needed. */
function launcher(path) {
  const real = realpathSync(path);
  return /\.[cm]?js$/.test(real) ? [process.execPath, real] : [real];
}
function locateLsc() {
  const local = join(root, 'node_modules/.bin/lsc');
  if (existsSync(local)) return local;
  const named = process.env.LEMMASCRIPT_BIN;
  if (named && existsSync(named)) return resolve(named);
  return null;
}
function onPath(name) {
  for (const dir of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    const candidate = join(dir, name);
    try { if (statSync(candidate).isFile()) return candidate; } catch { /* not here */ }
  }
  return null;
}
const dafnyEnv = () => ({ ...process.env, DOTNET_ROLL_FORWARD: process.env.DOTNET_ROLL_FORWARD || 'LatestMajor' });
/** A Dafny whose `--version` is 4.11.x, or the reason there is none. */
function locateDafny() {
  const named = process.env.DAFNY;
  const path = named ? (existsSync(named) ? resolve(named) : null) : onPath('dafny');
  if (!path) return { reason: named ? `DAFNY=${named} does not exist` : 'no dafny on PATH and DAFNY is unset' };
  const run = spawnSync(path, ['--version'], { encoding: 'utf8', env: dafnyEnv(), timeout: 60000 });
  const version = /(\d+\.\d+\.\d+)/.exec(run.stdout || '')?.[1];
  if (run.status !== 0 || !version) return { path, reason: `${path} --version failed${run.error ? `: ${run.error.message}` : ''}` };
  if (!REQUIRED_DAFNY.test(version)) return { path, version, reason: `${path} is Dafny ${version}; proofs are checked with 4.11.x only` };
  return { path, version };
}

// ---- manifest and layout -----------------------------------------------------------------

function readManifest() {
  const path = join(root, MANIFEST);
  if (!existsSync(path)) throw Error(`${MANIFEST} is missing`);
  const entries = [];
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [file, second, ...rest] = line.split(/\s+/);
    const timeout = second && /^[1-9]\d*$/.test(second) ? Number(second) : undefined;
    const flags = (timeout === undefined ? [second, ...rest] : rest).filter(Boolean).join(' ') || undefined;
    if (file.startsWith('/') || file.split('/').includes('..') || !/\.tsx?$/.test(file)) throw Error(`${MANIFEST}: invalid entry ${file}`);
    if (file.startsWith('.eliza/') || file.startsWith('vendor/') || file.includes('node_modules/')) throw Error(`${MANIFEST}: ${file} is shared upstream code, not a proof target here`);
    if (entries.some(entry => entry.file === file)) throw Error(`${MANIFEST}: ${file} is listed twice`);
    entries.push({ file, timeout, flags });
  }
  return entries;
}
function proofDir() {
  const config = JSON.parse(readFileSync(join(root, 'lemmascript.json'), 'utf8'));
  if (typeof config['proof-dir'] !== 'string' || !config['proof-dir']) throw Error('lemmascript.json must set proof-dir');
  return config['proof-dir'];
}
function annotatedSources() {
  const found = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && readFileSync(path, 'utf8').split('\n').some(line => ANY_ANNOTATION.test(line))) found.push(relative(root, path).split(sep).join('/'));
    }
  };
  for (const source of ANNOTATED_ROOTS) if (existsSync(join(root, source))) walk(join(root, source));
  return found.sort();
}

// ---- running lsc -------------------------------------------------------------------------

function run(argv, env, timeoutMs) {
  return new Promise(done => {
    const child = spawn(argv[0], argv.slice(1), { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error;
    const timer = setTimeout(() => { error = Error(`timed out after ${Math.round(timeoutMs / 1000)} s`); child.kill('SIGKILL'); }, timeoutMs);
    const append = chunk => { if (output.length < 4 * 1024 * 1024) output += chunk.toString(); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', failure => { error ??= failure; });
    child.on('close', code => { clearTimeout(timer); done({ code: error ? null : code, output, error: error?.message }); });
  });
}
const tail = text => text.trim().split('\n').slice(-25).join('\n');
const read = path => (existsSync(path) ? readFileSync(path, 'utf8') : null);
function strings(value, into = []) {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, into);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) strings(item, into);
  return into;
}
const withoutLineComments = text => text.replace(/\/\/.*$/gm, '');

async function checkFile(entry, context) {
  const { lsc, env, dafny, proofs } = context;
  const result = { file: entry.file, annotations: 'unchecked', generated: 'unchecked', proof: dafny ? 'unchecked' : 'skipped-no-backend', trust: {} };
  const fail = (field, value, detail) => { result[field] = value; result.failed = true; if (detail) (result.details ||= []).push(detail); return result; };
  const sourcePath = join(root, entry.file);
  if (!existsSync(sourcePath)) return fail('annotations', 'missing-source', `${entry.file} does not exist`);
  const source = readFileSync(sourcePath, 'utf8');
  const base = basename(entry.file).replace(/\.tsx?$/, '');
  const artifacts = join(root, proofs, dirname(entry.file));
  const genPath = join(artifacts, `${base}.dfy.gen`), dfyPath = join(artifacts, `${base}.dfy`);
  result.proofFile = relative(root, dfyPath).split(sep).join('/');

  // Trust boundary: whatever the proof takes on faith is recorded; `assume` is refused.
  const lines = source.split('\n');
  const count = pattern => lines.filter(line => pattern.test(line)).length;
  result.trust = {
    externs: count(/^\s*\/\/@ extern\b/), havocs: count(/^\s*\/\/@ (havoc|autohavoc)\b/), skips: count(/^\s*\/\/@ skip\b/),
    typeOverrides: count(/^\s*\/\/@ (type|declare-type)\b/), sourceAssumes: count(/^\s*\/\/@ assume\b/),
  };
  if (result.trust.sourceAssumes) fail('annotations', 'assumes', `${entry.file} uses //@ assume`);

  // 1. Every contract annotation must reach LemmaScript's extraction.
  const extracted = await run([...lsc, 'extract', entry.file], env, 180000);
  let model;
  try { model = JSON.parse(extracted.output); } catch { /* reported below */ }
  if (extracted.code !== 0 || !model) return fail('annotations', 'extract-failed', tail(extracted.error || extracted.output));
  const known = strings(model);
  const unread = lines.map(line => CONTRACT.exec(line)).filter(Boolean).filter(match => !known.some(text => text.includes(match[2]))).map(match => `//@ ${match[1]} ${match[2]}`);
  result.functions = (model.functions || []).map(fn => fn.name).filter(Boolean);
  if (!result.functions.length && !(model.classes || []).length) fail('annotations', 'nothing-to-verify', `${entry.file} has no //@ verify function`);
  else if (unread.length) fail('annotations', 'unread', `unread annotations in ${entry.file}: ${unread.join(' | ')}`);
  else if (result.annotations === 'unchecked') result.annotations = 'read';

  // 2. Generation freshness. lsc rewrites `.dfy.gen`; a difference means the committed one was stale.
  if (update) {
    const regen = await run([...lsc, 'regen', '--backend=dafny', '--no-verify', entry.file], env, 180000);
    if (regen.code !== 0) return fail('generated', 'regen-failed', tail(regen.error || regen.output));
  }
  const committedGen = read(genPath), committedDfy = read(dfyPath);
  if (committedGen === null || committedDfy === null) return fail('generated', 'missing', `${relative(root, committedGen === null ? genPath : dfyPath)} is missing; run this script with --update`);
  const command = dafny ? 'check' : 'gen-check';
  const argv = [...lsc, command, '--backend=dafny'];
  if (dafny && entry.timeout) argv.push(`--time-limit=${entry.timeout}`);
  if (dafny && entry.flags) argv.push(`--extra-flags=${entry.flags}`);
  const checked = await run([...argv, entry.file], env, ((entry.timeout || 120) + 180) * 1000);
  const stale = read(genPath) !== committedGen;
  if (stale) {
    // A check must not rewrite the tree: put the committed text back and fail.
    writeFileSync(genPath, committedGen);
    fail('generated', 'stale', `${relative(root, genPath)} is stale; run this script with --update and re-check the proof`);
  } else if (/not additions-only|modifications to generated lines/.test(checked.output)) {
    fail('generated', 'not-additions-only', tail(checked.output));
  } else result.generated = 'fresh';
  const proofText = withoutLineComments(read(dfyPath) || '');
  result.trust.proofAssumes = (proofText.match(/\bassume\b/g) || []).length;
  result.trust.proofAxioms = (proofText.match(/\{:\s*(axiom|verify\s+false)\b/g) || []).length;
  if (result.trust.proofAssumes || result.trust.proofAxioms) fail('proof', 'assumes', `${result.proofFile} contains assume, {:axiom} or {:verify false}`);

  // 3. The proof itself.
  if (!dafny) {
    if (checked.code !== 0 && result.generated === 'fresh') fail('generated', 'gen-check-failed', tail(checked.error || checked.output));
    return result;
  }
  const summary = /Dafny program verifier finished with (\d+) verified, (\d+) errors?/.exec(checked.output);
  result.verified = summary ? Number(summary[1]) : 0;
  result.errors = summary ? Number(summary[2]) : null;
  if (checked.code === 0 && summary && result.errors === 0 && result.verified > 0) { if (result.proof === 'unchecked') result.proof = 'verified'; }
  else fail('proof', 'failed', tail(checked.error || checked.output));
  return result;
}

// ---- main --------------------------------------------------------------------------------

try {
  const entries = readManifest();
  const requested = option('files', '').split(',').filter(Boolean);
  for (const name of requested) if (!entries.some(entry => entry.file === name)) throw Error(`--files: ${name} is not in ${MANIFEST}`);
  const selected = requested.length ? entries.filter(entry => requested.includes(entry.file)) : entries;
  const proofs = proofDir();

  for (const file of annotatedSources()) {
    if (!entries.some(entry => entry.file === file)) problem(`${file} has //@ annotations but is not listed in ${MANIFEST}: nothing reads them`);
  }

  const lscPath = locateLsc();
  if (!lscPath) {
    problem('LemmaScript (lsc) not found: install the lemmascript devDependency or set LEMMASCRIPT_BIN');
    finish('failed', 1);
  }
  const lsc = launcher(lscPath);
  const versionRun = spawnSync(lsc[0], [...lsc.slice(1), 'version'], { encoding: 'utf8', cwd: root, timeout: 60000 });
  receipt.tools.lsc = lscPath;
  receipt.tools.lemmascript = versionRun.status === 0 ? versionRun.stdout.trim() : null;
  if (!receipt.tools.lemmascript) { problem(`${lscPath} version failed`); finish('failed', 1); }

  const located = locateDafny();
  const dafny = located.reason ? null : located;
  receipt.tools.dafny = dafny ? { path: dafny.path, version: dafny.version } : { unavailable: located.reason, ...(located.version ? { version: located.version } : {}) };
  const env = dafnyEnv();
  if (dafny) {
    // lsc runs the command named `dafny`; make the chosen executable the first one on PATH.
    let dir = dirname(dafny.path);
    if (basename(dafny.path) !== 'dafny') {
      shim = mkdtempSync(join(tmpdir(), 'alpha-lemma-dafny-'));
      symlinkSync(dafny.path, join(shim, 'dafny'));
      dir = shim;
    }
    env.PATH = [dir, process.env.PATH || ''].filter(Boolean).join(delimiter);
  }

  const context = { lsc, env, dafny, proofs };
  const results = new Array(selected.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, async () => {
    while (next < selected.length) {
      const index = next++;
      results[index] = await checkFile(selected[index], context);
      const row = results[index];
      console.log(`${row.failed ? 'FAIL' : dafny ? 'ok  ' : 'skip'} ${row.file}: annotations ${row.annotations}, generated ${row.generated}, proof ${row.proof}${row.verified !== undefined ? ` (${row.verified} verified, ${row.errors ?? '?'} errors)` : ''}`);
      for (const detail of row.details || []) console.error(detail.split('\n').map(line => `    ${line}`).join('\n'));
    }
  }));
  receipt.files = results;
  if (!selected.length) problem(`${MANIFEST} lists no files`);

  if (receipt.problems.length || results.some(row => row.failed)) finish('failed', 1);
  if (!dafny) {
    console.warn([
      '',
      'WARNING: LemmaScript proofs were NOT checked.',
      `  ${located.reason}.`,
      '  Only annotation coverage and generated-file freshness were checked.',
      '  Install Dafny 4.11.x (or set DAFNY) to check the proofs; LEMMA_REQUIRE_BACKEND=1 makes this an error.',
      '',
    ].join('\n'));
    finish('skipped-no-backend', requireBackend ? 2 : 0);
  }
  finish('passed', 0);
} catch (error) {
  problem(error instanceof Error ? error.message : String(error));
  finish('failed', 1);
}
