#!/usr/bin/env bun
/**
 * Reproduce and stage the ARM64 embedding host from pinned source.
 * --from <directory> stages the exact reviewed libraries supplied by a host.
 * Staging requires exact native library hashes and matching source/JNI inputs.
 */
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type { EmbeddingManifest, PreparedEmbeddingLibrary } from "./stage-embedding-host.ts";
import {embeddingLibrarySource,verifyEmbeddingEngine,verifyEmbeddingInputs} from './stage-embedding-host.ts';

export const QUALIFIED_HOST = 'android/embedding-host/qualified-host.json';
export const BUILD_TOOLCHAIN = 'android/embedding-host/build-toolchain.json';
export const WORKSPACE = '.eliza/embedding-host';

type LibraryManifest = Pick<EmbeddingManifest, 'abi' | 'libraries'>;
type Toolchain = { ndk: string; cmake: string; engineRepository: string; remapBuildPath: boolean; remapBuildPathEvidence: string };
type BuildOptions = { remap: boolean };
type LibraryDigest = { sha256: string; bytes: number };
type Comparison = { name: string; expected: LibraryDigest } & (
  { reproduced: false; reason: string; actual?: undefined; file?: undefined }
  | { reproduced: boolean; actual: LibraryDigest; file: string; reason?: undefined }
);
const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8'));
const jniDirectory = (root: string, abi: string) => path.join(root, 'android/app/src/main/jniLibs', abi);

/** State of each reviewed library in jniLibs: 'staged', 'missing' or 'different'. */
export function stagedLibraries(root: string, manifest: LibraryManifest = readJson(path.join(root, QUALIFIED_HOST))) {
  return manifest.libraries.map(row => {
    const file = path.join(jniDirectory(root, manifest.abi), row.name);
    let state = 'missing';
    if (fs.existsSync(file))
      state = !fs.lstatSync(file).isSymbolicLink() && fs.statSync(file).size === row.bytes && sha256(file) === row.sha256 ? 'staged' : 'different';
    return {name: row.name, state, file};
  });
}

/** Compare built files with the reviewed manifest. `built` maps library name to a file path. */
export function compareWithQualified(manifest: LibraryManifest, built: Record<string, string | undefined>): Comparison[] {
  return manifest.libraries.map(row => {
    const file = built[row.name];
    if (!file || !fs.existsSync(file)) return {name: row.name, reproduced: false, reason: 'not built', expected: {sha256: row.sha256, bytes: row.bytes}};
    const actual = {sha256: sha256(file), bytes: fs.statSync(file).size};
    return {name: row.name, reproduced: actual.sha256 === row.sha256 && actual.bytes === row.bytes, expected: {sha256: row.sha256, bytes: row.bytes}, actual, file};
  });
}

/** Copy reproduced libraries into jniLibs. Refuses unless every library is the reviewed bytes. */
export function stageReproduced(root: string, manifest: LibraryManifest, comparison: Comparison[]) {
  if (comparison.length !== manifest.libraries.length || comparison.some(row => !row.reproduced))
    throw new Error('Refusing to stage: the rebuilt embedding host is not the reviewed bytes');
  const current = stagedLibraries(root, manifest);
  const different = current.find(row => row.state === 'different');
  if (different)
    throw new Error(`A different ${different.name} is already staged; review ownership before replacing it`);
  fs.mkdirSync(jniDirectory(root, manifest.abi), {recursive: true});
  for (const row of comparison) {
    const target = path.join(jniDirectory(root, manifest.abi), row.name);
    if (!row.file) throw new Error(`Missing rebuilt file for ${row.name}`);
    if (!fs.existsSync(target)) fs.copyFileSync(row.file, target, fs.constants.COPYFILE_EXCL);
    if (sha256(target) !== row.expected.sha256) throw new Error(`Staged ${row.name} changed while copying`);
  }
}

export function describeDifference(comparison: Comparison[]) {
  return comparison.filter(row => !row.reproduced).map(row => row.actual
    ? `${row.name}: built ${row.actual.bytes} bytes sha256 ${row.actual.sha256}, reviewed ${row.expected.bytes} bytes sha256 ${row.expected.sha256}`
    : `${row.name}: ${row.reason}, reviewed ${row.expected.bytes} bytes sha256 ${row.expected.sha256}`);
}

/** Admit reviewed producer bytes without modifying the committed record. */
function stageFrom(root: string, directory: string) {
  const manifest = readJson<EmbeddingManifest>(path.join(root, QUALIFIED_HOST));
  verifyEmbeddingInputs(root, manifest, {requireProducerInputs:true});
  verifyEmbeddingEngine(root, manifest);
  const libraries = Object.fromEntries(manifest.libraries.map(row =>
    [row.name, embeddingLibrarySource({path:row.name},directory)]));
  stageReproduced(root, manifest, compareWithQualified(manifest, libraries));
  console.log('Reviewed ARM64 embedding host libraries staged; committed admission record preserved.');
}

/** Whether every expected library is staged. Missing libraries are reproducible build inputs. */
export function embeddingHostState(_manifest: LibraryManifest, _toolchain: Toolchain, staged: ReturnType<typeof stagedLibraries>) {
  return {ready: staged.every(row => row.state === 'staged'), suppliedBy: 'script' as const, reason: null};
}

export class Stop extends Error {
  readonly code: number;
  constructor(code: number, message: string) { super(message); this.code = code; }
}

function resolveSdk() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
    || [path.join(process.env.HOME || '', 'Library/Android/sdk'), path.join(process.env.HOME || '', 'Android/Sdk')].find(candidate => fs.existsSync(path.join(candidate, 'ndk')));
  if (!sdk || !fs.existsSync(sdk)) throw new Stop(2, 'Set ANDROID_HOME to an Android SDK that has the NDK installed.');
  return sdk;
}

function ndkTools(ndk: string) {
  const prebuilt = path.join(ndk, 'toolchains/llvm/prebuilt');
  const host = fs.existsSync(prebuilt) ? fs.readdirSync(prebuilt).find(name => fs.existsSync(path.join(prebuilt, name, 'bin/llvm-strip'))) : null;
  if (!host) throw new Stop(2, `NDK tools not found under ${prebuilt}`);
  return path.join(prebuilt, host);
}

/** The reviewed libc++_shared.so identifies the NDK release: refuse another before a long compile. */
function checkNdk(ndk: string, manifest: LibraryManifest, scratch: string) {
  const row = manifest.libraries.find(item => item.name === 'libc++_shared.so');
  if (!row) throw new Stop(2, 'The reviewed embedding host is missing libc++_shared.so.');
  const tools = ndkTools(ndk);
  const source = path.join(tools, 'sysroot/usr/lib/aarch64-linux-android/libc++_shared.so');
  const stripped = path.join(scratch, 'ndk-check-libc++_shared.so');
  fs.mkdirSync(scratch, {recursive: true});
  execFileSync(path.join(tools, 'bin/llvm-strip'), ['--strip-unneeded', source, '-o', stripped]);
  const actual = sha256(stripped);
  fs.rmSync(stripped);
  if (actual !== row.sha256)
    throw new Stop(2, `NDK at ${ndk} does not produce the reviewed libc++_shared.so (${actual} instead of ${row.sha256}).`);
}

function fetchEngine(engine: string, toolchain: Toolchain, forkPin: string) {
  const git = (...args: string[]) => execFileSync('git', ['-C', engine, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']}).trim();
  if (!fs.existsSync(path.join(engine, '.git'))) {
    fs.mkdirSync(engine, {recursive: true});
    console.log(`Fetching engine source ${toolchain.engineRepository} at ${forkPin}`);
    git('init', '--quiet');
    git('fetch', '--quiet', '--depth=1', toolchain.engineRepository, forkPin);
    git('checkout', '--quiet', '--detach', 'FETCH_HEAD');
    git('submodule', 'update', '--init', '--recursive', '--depth', '1');
  }
  if (git('rev-parse', 'HEAD') !== forkPin || git('status', '--porcelain'))
    throw new Stop(2, `Engine source ${engine} is not a clean checkout of ${forkPin}; remove it and rerun.`);
}

function compile(root: string, manifest: EmbeddingManifest, toolchain: Toolchain, output: string, {remap}: BuildOptions) {
  // Source admission: the pinned checkout still carries exactly the reviewed native inputs.
  try { verifyEmbeddingInputs(root, manifest); }
  catch (error) { throw new Stop(3, `The pinned checkout does not carry the reviewed embedding host inputs (${error instanceof Error ? error.message : String(error)}).`); }
  const sdk = resolveSdk();
  const ndk = path.join(sdk, 'ndk', toolchain.ndk);
  if (!fs.existsSync(path.join(ndk, 'build/cmake/android.toolchain.cmake')))
    throw new Stop(2, `Android NDK ${toolchain.ndk} is required (${BUILD_TOOLCHAIN}) and is not installed under ${path.join(sdk, 'ndk')}. Install it with: sdkmanager "ndk;${toolchain.ndk}"`);
  if (spawnSync('ninja', ['--version'], {stdio: 'ignore'}).status !== 0) throw new Stop(2, 'ninja is required on PATH to build the embedding host.');
  const cmake = spawnSync('cmake', ['--version'], {encoding: 'utf8'});
  const cmakeVersion = /cmake version (\S+)/.exec(cmake.stdout ?? '')?.[1];
  // The speech runtime showed that a different CMake release changes native bytes; hold it fixed here too.
  if (cmakeVersion !== toolchain.cmake) throw new Stop(2, `CMake ${toolchain.cmake} is required on PATH (${BUILD_TOOLCHAIN}); found ${cmakeVersion ?? 'none'}. Install it with: python3 -m pip install cmake==${toolchain.cmake}`);
  const workspace = path.join(root, WORKSPACE);
  checkNdk(ndk, manifest, workspace);
  const engine = path.join(workspace, `engine-${manifest.forkPin}`);
  fetchEngine(engine, toolchain, manifest.forkPin);
  const receiptFile = path.join(output, 'PREPARATION.json');
  const existingReceipt = fs.existsSync(receiptFile) ? readJson<{ built: boolean; buildPathRemapped: boolean }>(receiptFile) : null;
  if (fs.existsSync(output) && !(existingReceipt?.built === true && existingReceipt.buildPathRemapped === remap))
    throw new Stop(2, `${path.relative(root, output)} holds an incomplete or differently configured build. Remove it and rerun.`);
  if (!fs.existsSync(output)) {
    console.log(`Building the embedding host with NDK ${toolchain.ndk} (about ten minutes; needs 6 GiB free)`);
    execFileSync(process.execPath, [path.join(root, 'scripts/prepare-embedding-host.ts'), '--fork', engine, '--output', output, '--abi', manifest.abi, '--build', ...(remap ? ['--remap-build-path'] : [])],
      {cwd: root, stdio: ['ignore', 'inherit', 'inherit'], env: {...process.env, ANDROID_HOME: sdk, ELIZA_NDK_VERSION: toolchain.ndk}});
  } else console.log(`Reusing the build in ${path.relative(root, output)}`);
  const receipt = readJson<{ pin: string; forkPin: string; libraries?: PreparedEmbeddingLibrary[] }>(receiptFile);
  const comparison = compareWithQualified(manifest, Object.fromEntries((receipt.libraries || []).map(row => [path.basename(row.path), row.path])));
  const reproduced = comparison.every(row => row.reproduced);
  fs.writeFileSync(path.join(output, 'COMPARISON.json'), JSON.stringify({pin: receipt.pin, forkPin: receipt.forkPin, ndk: toolchain.ndk, buildPathRemapped: remap, reproduced, staged: false, libraries: comparison}, null, 2) + '\n');
  return {receiptFile, comparison, reproduced};
}

/** `build` is the compile step; tests replace it, the command line never does. */
export function run(root: string, {from, build = compile}: {from?: string; build?: typeof compile} = {}) {
  if (from !== undefined) {
    stageFrom(root, path.resolve(from));
    return 0;
  }
  const manifest = readJson<EmbeddingManifest>(path.join(root, QUALIFIED_HOST));
  const toolchain = readJson<Toolchain>(path.join(root, BUILD_TOOLCHAIN));
  const workspace = path.join(root, WORKSPACE);
  const staged = stagedLibraries(root, manifest);
  const host = embeddingHostState(manifest, toolchain, staged);
  if (host.ready) {
    console.log('Reviewed ARM64 embedding host libraries are staged (bytes match android/embedding-host/qualified-host.json).');
    return 0;
  }
  const different = staged.filter(row => row.state === 'different');
  if (different.length)
    throw new Stop(2, `Staged ${different.map(row => row.name).join(', ')} in android/app/src/main/jniLibs/${manifest.abi} is not the reviewed bytes. Review where it came from and remove it; this step never replaces a staged library.`);
  const output = path.join(workspace, `build-${manifest.forkPin}`);
  // The reviewed bytes of a reproducible manifest were built with the remap, so the rebuild is too.
  const {comparison, reproduced} = build(root, manifest, toolchain, output, {remap: true});
  if (!reproduced)
    throw new Stop(3, `The rebuilt embedding host is not the reviewed bytes and was not staged:\n${describeDifference(comparison).map(line => `  - ${line}`).join('\n')}\nRebuilt files and COMPARISON.json are in ${path.relative(root, output)}.`);
  stageReproduced(root, manifest, comparison);
  fs.writeFileSync(path.join(output, 'COMPARISON.json'), fs.readFileSync(path.join(output, 'COMPARISON.json'), 'utf8').replace('"staged": false', '"staged": true'));
  console.log('Rebuilt embedding host reproduces the reviewed bytes; staged. No device execution is claimed.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const root = path.resolve(import.meta.dirname, '..');
  const from = args.length === 2 && args[0] === '--from' && !args[1].startsWith('--') ? args[1] : undefined;
  if (from === undefined && args.length) {
    console.error('Usage: bun scripts/build-embedding-host.ts [--from <directory>]');
    process.exit(2);
  }
  try {
    process.exitCode = run(root, {from});
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    console.error(error.message);
    process.exitCode = error.code;
  }
}
