#!/usr/bin/env bun
/** Observe the actual product mobile producer without changing its build options or source. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {preparedSourceEnv, sourceDirectory, verifySource} from '../../../../scripts/local-agent-source.mjs';
import {CORE_STATE_INPUTS, coreStatePatch} from '../../../../scripts/core-state-patch.mjs';
import {verifyMobileBuildReceipt} from '../../../../scripts/mobile-uuid-adapter.mjs';
import {writeRuntimeBundleGraph} from './runtime-bundle-graph.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const source = sourceDirectory(root, {ALPHA_LOCAL_AGENT_SOURCE_DIR: path.resolve(process.argv[2] ?? '')});
const output = path.join(root, 'test-results/quint-runtime-bundle-core-state');
const pin = JSON.parse(fs.readFileSync(path.join(root, 'upstream.lock.json'), 'utf8')).commit;
const policy = JSON.parse(fs.readFileSync(path.join(root, 'patches/eliza/mobile-uuid-build.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (Bun.version !== policy.bun.version || Bun.revision !== policy.bun.revision) throw Error('Audit requires the exact reviewed Bun build');
verifySource(source, pin);
fs.mkdirSync(output, {recursive: true});
const inputFiles = [fileURLToPath(import.meta.url), 'specs/quint/refinement/services/runtime-bundle-graph.mjs', 'upstream.lock.json', 'patches/eliza/mobile-uuid-build.json',
  'scripts/build-mobile-agent.mjs', 'scripts/mobile-uuid-adapter.mjs', 'scripts/mobile-bundle-smoke.mjs',
  'scripts/local-agent-source.mjs', ...CORE_STATE_INPUTS].map(file => path.resolve(root, file));
const core = coreStatePatch(root, source);
const before = Object.fromEntries(inputFiles.map(file => [file, hash(fs.readFileSync(file))]));
const tracked = new Map(execFileSync('git', ['ls-tree', '-r', '-z', pin], {cwd: source, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024})
  .split('\0').filter(Boolean).map(row => {const at = row.indexOf('\t'); return [row.slice(at + 1), row.slice(0, at).split(' ')[2]];}));
const evidence = {schema: 1, sourcePin: pin, source, producer: 'scripts/build-mobile-agent.mjs',
  bun: {version: Bun.version, revision: Bun.revision}, startedAt: new Date().toISOString(),
  inputHashesBefore: before, builds: [], passed: false};
const evidencePath = path.join(output, 'producer-observation.json');
const persist = () => fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
persist();
const original = Bun.build;
const previousArgv = process.argv;
const previousDirectory = process.cwd();
let failure;
try {
  const env = preparedSourceEnv(process.env);
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  process.chdir(source);
  Bun.build = async options => {
    const result = await original(options);
    if (options.metafile && result.metafile) {
      const index = evidence.builds.length;
      const metadata = typeof result.metafile === 'string' ? JSON.parse(result.metafile) : result.metafile;
      const metadataPath = path.join(output, `build-${index}-metafile.json`);
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
      const emitted = new Map();
      for (const record of Object.values(metadata.outputs ?? {})) {
        for (const [input, detail] of Object.entries(record.inputs ?? {})) {
          emitted.set(input, (emitted.get(input) ?? 0) + detail.bytesInOutput);
        }
      }
      const firstParty = [];
      for (const input of Object.keys(metadata.inputs ?? {})) {
        const file = path.resolve(source, input);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
        const canonical = fs.realpathSync(file);
        const relative = path.relative(source, canonical).split(path.sep).join('/');
        if (relative.startsWith('../') || path.isAbsolute(relative) || relative.split('/').includes('node_modules')) continue;
        const bytes = fs.readFileSync(canonical);
        const gitObject = createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
        if (tracked.has(relative) && tracked.get(relative) !== gitObject) throw Error(`Compiled first-party input differs from pinned Git bytes: ${relative}`);
        const transformed = core.files.get(relative);
        if (transformed && hash(bytes) !== transformed.beforeSha256) throw Error('Core input differs from patch preimage');
        firstParty.push({input, path: relative, sha256: hash(bytes),
          ...(transformed ? {effectiveSourceSha256: transformed.afterSha256, transformation: 'authenticated-core-state'} : {}), bytesInOutput: emitted.get(input) ?? 0,
          tracked: tracked.has(relative), ...(tracked.has(relative) ? {gitObject} : {})});
      }
      evidence.builds.push({success: result.success, entrypoints: options.entrypoints,
        rawMetafile: metadataPath, rawMetafileSha256: hash(fs.readFileSync(metadataPath)),
        parsedInputs: Object.keys(metadata.inputs ?? {}).length, firstParty: firstParty.sort((a, b) => a.path.localeCompare(b.path))});
      persist();
    }
    return result;
  };
  process.argv = [process.execPath, path.join(root, 'scripts/build-mobile-agent.mjs'), source, '--target=android'];
  await import(pathToFileURL(path.join(root, 'scripts/build-mobile-agent.mjs')).href);
  verifySource(source, pin);
  evidence.coreState = verifyMobileBuildReceipt(root, source).coreState;
  evidence.bundleSha256 = hash(fs.readFileSync(path.join(source, 'packages/agent/dist-mobile/agent-bundle.js')));
  evidence.passed = true;
} catch (error) {
  failure = error;
  evidence.error = error instanceof Error ? error.stack : String(error);
} finally {
  Bun.build = original;
  process.argv = previousArgv;
  process.chdir(previousDirectory);
  evidence.inputHashesAfter = Object.fromEntries(inputFiles.map(file => [file, hash(fs.readFileSync(file))]));
  evidence.inputsUnchanged = inputFiles.every(file => before[file] === evidence.inputHashesAfter[file]);
  if (!evidence.inputsUnchanged) {evidence.passed = false; failure ||= Error('Audit producer input changed during build');}
  evidence.finishedAt = new Date().toISOString();
  persist();
}
if (failure) throw failure;
writeRuntimeBundleGraph(root, source, evidencePath, path.join(root, 'specs/quint/refinement/services/runtime-bundle-inputs.json'));
console.log(JSON.stringify({passed: evidence.passed, builds: evidence.builds.length,
  firstPartyInputs: evidence.builds.reduce((count, build) => count + build.firstParty.length, 0), evidence: evidencePath}));
