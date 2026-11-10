import {spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {repositoryRoot, sha256} from './quint-lib.ts';

const root = repositoryRoot;
const receiptPath = join(root, 'test-results/lemma/check.json');
mkdirSync(dirname(receiptPath), {recursive: true});
interface LemmaResult {
  command: string; args: string[]; exitCode: number | null; signal: NodeJS.Signals | null;
  error?: string; output: string;
}
interface LemmaReceipt {
  schemaVersion: number; startedAt: string; status: string; passed: boolean;
  requiredDafnyVersion: string; inputs: Record<string, string>; results: LemmaResult[];
  lemmascriptVersion?: string; dafnyVersion?: string | null; reason?: string;
  verifiedConditions?: number; error?: string; finalInputs?: Record<string, string>;
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
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {cwd: root, encoding: 'utf8', timeout: 120000});
  const output = `${result.stdout || ''}${result.stderr || ''}`;
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
  receipt.lemmascriptVersion = JSON.parse(readFileSync(join(root, 'node_modules/lemmascript/package.json'), 'utf8')).version;
  if (receipt.lemmascriptVersion !== '0.6.6') throw Error('LemmaScript must be exactly 0.6.6');
  const cli = join(root, 'node_modules/lemmascript/tools/dist/lsc.js');
  if (!run(process.execPath, [cli, 'gen-check', '--backend=dafny'])) throw Error('LemmaScript generation or additions-only check failed');
  const generated = hashes();
  const changed = inputs.filter(file => generated[file] !== receipt.inputs[file]);
  if (changed.length) throw Error(`Stale LemmaScript generated inputs: ${changed.join(', ')}. Review and commit regenerated artifacts.`);
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
