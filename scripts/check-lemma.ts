import {spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {repositoryRoot, sha256} from './quint-lib.ts';

if (process.argv.length > 2) {console.error('check-lemma takes no options; the root inventory defines the complete proof gate'); process.exit(2);}
const root = repositoryRoot;
const receiptPath = join(root, 'test-results/lemma/check.json');
mkdirSync(dirname(receiptPath), {recursive: true});
interface LemmaResult {
  command: string; args: string[]; exitCode: number | null; signal: NodeJS.Signals | null;
  error?: string; output: string;
}
interface LemmaSource {file: string; functions: string[]; trust: {externs: number; havocs: number; skips: number; typeOverrides: number; sourceAssumes: number; proofAssumes: number; proofAxioms: number}}
interface LemmaReceipt {
  schemaVersion: number; startedAt: string; status: string; passed: boolean;
  requiredDafnyVersion: string; inputs: Record<string, string>; results: LemmaResult[];
  lemmascriptVersion?: string; dafnyVersion?: string | null; reason?: string;
  files?: LemmaSource[]; verifiedConditions?: number; error?: string; finalInputs?: Record<string, string>;
  changedInputs?: string[]; finalInputError?: string; finishedAt?: string;
}
let files: string[] = [], inputs: string[] = [];
const proofsWithin = (directory: string): string[] => readdirSync(directory, {withFileTypes: true}).flatMap(entry =>
  entry.isDirectory() ? proofsWithin(join(directory, entry.name)) : entry.name.endsWith('.dfy') || entry.name.endsWith('.dfy.gen') ? [join(directory, entry.name)] : []);
const hashes = () => Object.fromEntries(inputs.map(file => [file, sha256(readFileSync(join(root, file)))]));
const receipt: LemmaReceipt = {schemaVersion: 1, startedAt: new Date().toISOString(), status: 'running', passed: false,
  requiredDafnyVersion: '4.11.0', inputs: {}, results: []};
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
let exitCode = 1;
let lastOutput = "";
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {cwd: root, encoding: 'utf8', timeout: 120000});
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  lastOutput = output;
  process.stdout.write(output);
  receipt.results.push({command, args, exitCode: result.status, signal: result.signal, error: result.error?.message, output});
  return Number.isInteger(result.status) && result.status === 0 && !result.error && !result.signal;
}
try {
  files = readFileSync(join(root, 'LemmaScript-files.txt'), 'utf8').split(/\r?\n/)
    .map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => line.split(/\s+/)[0]);
  if (!files.length || files.some(file => !/^apps\/app\/src\/[A-Za-z0-9_./-]+\.ts$/.test(file) || file.split('/').includes('..'))) throw Error('Invalid or empty LemmaScript source inventory');
  for (const file of files) if (!/^\s*\/\/@ verify\s*$/m.test(readFileSync(join(root, file), 'utf8'))) throw Error(`No verified function registered in ${file}`);
  const config = JSON.parse(readFileSync(join(root, 'lemmascript.json'), 'utf8'));
  if (config['proof-dir'] !== 'specs/lemma') throw Error('The reviewed proof directory must be specs/lemma');
  const expectedProofs = files.flatMap(file => [file.replace(/\.ts$/, '.dfy'), file.replace(/\.ts$/, '.dfy.gen')].map(path => `specs/lemma/${path}`));
  inputs = [...new Set(['package-lock.json', 'lemmascript.json', 'LemmaScript-files.txt', 'scripts/check-lemma.ts',
    ...files, ...expectedProofs, ...proofsWithin(join(root, 'specs/lemma')).map(path => path.slice(root.length + 1))])];
  receipt.inputs = hashes();
  const frozenProofs = new Map(expectedProofs.map(file => [file, readFileSync(join(root, file))]));
  receipt.lemmascriptVersion = JSON.parse(readFileSync(join(root, 'node_modules/lemmascript/package.json'), 'utf8')).version;
  if (receipt.lemmascriptVersion !== '0.6.6') throw Error('LemmaScript must be exactly 0.6.6');
  const cli = join(root, 'node_modules/lemmascript/tools/dist/lsc.js');
  const annotation = /^\s*\/\/@ \S/m;
  const unlisted = readdirSync(join(root, 'apps/app/src'), {recursive: true, encoding: 'utf8'})
    .filter(file => /\.tsx?$/.test(file))
    .map(file => `apps/app/src/${file.split('\\').join('/')}`)
    .filter(file => annotation.test(readFileSync(join(root, file), 'utf8')) && !files.includes(file));
  if (unlisted.length) throw Error(`Unregistered function annotations: ${unlisted.join(', ')}`);
  receipt.files = [];
  const strings = (value: unknown): string[] => typeof value === 'string' ? [value]
    : Array.isArray(value) ? value.flatMap(strings)
    : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
  for (const file of files) {
    const source = readFileSync(join(root, file), 'utf8'), lines = source.split('\n');
    const count = (pattern: RegExp) => lines.filter(line => pattern.test(line)).length;
    const proof = readFileSync(join(root, 'specs/lemma', file.replace(/\.ts$/, '.dfy')), 'utf8').replace(/\/\/.*$/gm, '');
    const trust = {externs: count(/^\s*\/\/@ extern\b/), havocs: count(/^\s*\/\/@ (havoc|autohavoc)\b/),
      skips: count(/^\s*\/\/@ skip\b/), typeOverrides: count(/^\s*\/\/@ (type|declare-type)\b/), sourceAssumes: count(/^\s*\/\/@ assume\b/),
      proofAssumes: (proof.match(/\bassume\b/g) || []).length,
      proofAxioms: (proof.match(/\{:\s*(axiom|verify\s+false)\b/g) || []).length};
    if (trust.sourceAssumes || trust.proofAssumes || trust.proofAxioms) throw Error(`Unadmitted proof assumption in ${file}`);
    if (!run(process.execPath, [cli, 'extract', file])) throw Error(`LemmaScript extraction failed: ${file}`);
    const model = JSON.parse(lastOutput) as {functions?: Array<{name?: string}>; classes?: unknown[]};
    const known = strings(model), contracts = lines.map(line => /^\s*\/\/@ (requires|ensures|invariant|decreases|done_with|assert)\s+(.+?)\s*$/.exec(line)).filter(match => match !== null);
    const unread = contracts.filter(match => !known.some(text => text.includes(match[2])));
    const functions = (model.functions || []).flatMap(fn => fn.name ? [fn.name] : []);
    if ((!functions.length && !model.classes?.length) || unread.length) throw Error(`Unread or empty verified contract in ${file}`);
    receipt.files.push({file, functions, trust});
  }
  const generatedOK = run(process.execPath, [cli, 'gen-check', '--backend=dafny']);
  const generated = hashes();
  const changed = inputs.filter(file => generated[file] !== receipt.inputs[file]);
  if (changed.length) {
    receipt.changedInputs = changed;
    for (const file of changed) {const frozen = frozenProofs.get(file); if (frozen) writeFileSync(join(root, file), frozen);}
    throw Error(`Stale LemmaScript generated inputs: ${changed.join(', ')}. Review and commit regenerated artifacts.`);
  }
  if (!generatedOK) throw Error('LemmaScript generation or additions-only check failed');
  const backend = spawnSync('dafny', ['--version'], {encoding: 'utf8', timeout: 10000});
  receipt.dafnyVersion = backend.status === 0 ? backend.stdout.trim() : null;
  // Official archives may include the release's Git commit as SemVer build metadata.
  if (!/^4\.11\.0(?:\+[0-9a-f]{40})?$/.test(receipt.dafnyVersion ?? '')) {
    receipt.status = 'skipped-no-qualified-backend';
    receipt.reason = 'Dafny 4.11.0 is required; generation passed but no function proof ran.';
    console.warn(receipt.reason);
    exitCode = process.env.LEMMA_REQUIRE_BACKEND === '1' ? 2 : 0;
  } else {
    if (!run(process.execPath, [cli, 'check', '--backend=dafny'])) throw Error('Dafny verification failed');
    const proofs = [...receipt.results.at(-1)!.output.matchAll(/Dafny program verifier finished with ([1-9][0-9]*) verified, 0 errors/g)];
    if (proofs.length !== files.length) throw Error('Dafny did not report a nonempty successful proof for every source');
    receipt.verifiedConditions = proofs.reduce((count, match) => count + Number(match[1]), 0);
    receipt.status = 'passed'; receipt.passed = true; exitCode = 0;
  }
} catch (error) {
  receipt.status = 'failed'; receipt.error = error instanceof Error ? error.message : String(error);
  console.error(receipt.error);
} finally {
  try {
    const finalInputs = hashes();
    receipt.finalInputs = finalInputs;
    const changed = inputs.filter(file => finalInputs[file] !== receipt.inputs[file]);
    if (changed.length) {receipt.status = 'failed'; receipt.passed = false; receipt.changedInputs = changed; exitCode = 1;}
  } catch (error) {receipt.status = 'failed'; receipt.passed = false; receipt.finalInputError = String(error); exitCode = 1;}
  receipt.finishedAt = new Date().toISOString();
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  console.log(`LemmaScript ${receipt.status}; evidence: ${receiptPath}`);
}
process.exitCode = exitCode;
