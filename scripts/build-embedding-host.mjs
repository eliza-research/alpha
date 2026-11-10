#!/usr/bin/env node
/**
 * Reproduce and stage the ARM64 embedding host from pinned source.
 * --status reports staged inputs; --candidate builds without staging; --offline forbids fetching.
 * Staging requires exact native library hashes and matching source/JNI inputs.
 */
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyEmbeddingInputs} from './stage-embedding-host.mjs';

export const QUALIFIED_HOST = 'android/embedding-host/qualified-host.json';
export const BUILD_TOOLCHAIN = 'android/embedding-host/build-toolchain.json';
export const WORKSPACE = '.eliza/embedding-host';

const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const jniDirectory = (root, abi) => path.join(root, 'android/app/src/main/jniLibs', abi);

/** State of each reviewed library in jniLibs: 'staged', 'missing' or 'different'. */
export function stagedLibraries(root, manifest = readJson(path.join(root, QUALIFIED_HOST))) {
  return manifest.libraries.map(row => {
    const file = path.join(jniDirectory(root, manifest.abi), row.name);
    let state = 'missing';
    if (fs.existsSync(file))
      state = !fs.lstatSync(file).isSymbolicLink() && fs.statSync(file).size === row.bytes && sha256(file) === row.sha256 ? 'staged' : 'different';
    return {name: row.name, state, file};
  });
}

/** Compare built files with the reviewed manifest. `built` maps library name to a file path. */
export function compareWithQualified(manifest, built) {
  return manifest.libraries.map(row => {
    const file = built[row.name];
    if (!file || !fs.existsSync(file)) return {name: row.name, reproduced: false, reason: 'not built', expected: {sha256: row.sha256, bytes: row.bytes}};
    const actual = {sha256: sha256(file), bytes: fs.statSync(file).size};
    return {name: row.name, reproduced: actual.sha256 === row.sha256 && actual.bytes === row.bytes, expected: {sha256: row.sha256, bytes: row.bytes}, actual, file};
  });
}

/** Copy reproduced libraries into jniLibs. Refuses unless every library is the reviewed bytes. */
export function stageReproduced(root, manifest, comparison) {
  if (comparison.length !== manifest.libraries.length || comparison.some(row => !row.reproduced))
    throw new Error('Refusing to stage: the rebuilt embedding host is not the reviewed bytes');
  const current = stagedLibraries(root, manifest);
  if (current.some(row => row.state === 'different'))
    throw new Error(`A different ${current.find(row => row.state === 'different').name} is already staged; review ownership before replacing it`);
  fs.mkdirSync(jniDirectory(root, manifest.abi), {recursive: true});
  for (const row of comparison) {
    const target = path.join(jniDirectory(root, manifest.abi), row.name);
    if (!fs.existsSync(target)) fs.copyFileSync(row.file, target, fs.constants.COPYFILE_EXCL);
    if (sha256(target) !== row.expected.sha256) throw new Error(`Staged ${row.name} changed while copying`);
  }
}

export function describeDifference(comparison) {
  return comparison.filter(row => !row.reproduced).map(row => row.actual
    ? `${row.name}: built ${row.actual.bytes} bytes sha256 ${row.actual.sha256}, reviewed ${row.expected.bytes} bytes sha256 ${row.expected.sha256}`
    : `${row.name}: ${row.reason}, reviewed ${row.expected.bytes} bytes sha256 ${row.expected.sha256}`);
}

/** Whether every expected library is staged. Missing libraries are reproducible build inputs. */
export function embeddingHostState(manifest, toolchain, staged) {
  return {ready: staged.every(row => row.state === 'staged'), suppliedBy: 'script', reason: null};
}

export class Stop extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function resolveSdk() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
    || [path.join(process.env.HOME || '', 'Library/Android/sdk'), path.join(process.env.HOME || '', 'Android/Sdk')].find(candidate => fs.existsSync(path.join(candidate, 'ndk')));
  if (!sdk || !fs.existsSync(sdk)) throw new Stop(2, 'Set ANDROID_HOME to an Android SDK that has the NDK installed.');
  return sdk;
}

function ndkTools(ndk) {
  const prebuilt = path.join(ndk, 'toolchains/llvm/prebuilt');
  const host = fs.existsSync(prebuilt) ? fs.readdirSync(prebuilt).find(name => fs.existsSync(path.join(prebuilt, name, 'bin/llvm-strip'))) : null;
  if (!host) throw new Stop(2, `NDK tools not found under ${prebuilt}`);
  return path.join(prebuilt, host);
}

/** The reviewed libc++_shared.so identifies the NDK release: refuse another before a long compile. */
function checkNdk(ndk, manifest, scratch) {
  const row = manifest.libraries.find(item => item.name === 'libc++_shared.so');
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

function fetchEngine(engine, toolchain, forkPin, {offline}) {
  const git = (...args) => execFileSync('git', ['-C', engine, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']}).trim();
  if (!fs.existsSync(path.join(engine, '.git'))) {
    if (offline) throw new Stop(2, `Engine source ${engine} is not present and --offline forbids fetching ${toolchain.engineRepository} at ${forkPin}.`);
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

function compile(root, manifest, toolchain, output, {offline, remap}) {
  // Source admission: the pinned checkout still carries exactly the reviewed native inputs.
  try { verifyEmbeddingInputs(root, manifest); }
  catch (error) { throw new Stop(3, `The pinned checkout does not carry the reviewed embedding host inputs (${error.message}).`); }
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
  fetchEngine(engine, toolchain, manifest.forkPin, {offline});
  const receiptFile = path.join(output, 'PREPARATION.json');
  if (fs.existsSync(output) && !(fs.existsSync(receiptFile) && readJson(receiptFile).built === true && readJson(receiptFile).buildPathRemapped === remap))
    throw new Stop(2, `${path.relative(root, output)} holds an incomplete or differently configured build. Remove it and rerun.`);
  if (!fs.existsSync(output)) {
    console.log(`Building the embedding host with NDK ${toolchain.ndk} (about ten minutes; needs 6 GiB free)`);
    execFileSync(process.execPath, [path.join(root, 'scripts/prepare-embedding-host.mjs'), '--fork', engine, '--output', output, '--abi', manifest.abi, '--build', ...(remap ? ['--remap-build-path'] : [])],
      {cwd: root, stdio: ['ignore', 'inherit', 'inherit'], env: {...process.env, ANDROID_HOME: sdk, ELIZA_NDK_VERSION: toolchain.ndk}});
  } else console.log(`Reusing the build in ${path.relative(root, output)}`);
  const receipt = readJson(receiptFile);
  const comparison = compareWithQualified(manifest, Object.fromEntries((receipt.libraries || []).map(row => [path.basename(row.path), row.path])));
  const reproduced = comparison.every(row => row.reproduced);
  fs.writeFileSync(path.join(output, 'COMPARISON.json'), JSON.stringify({pin: receipt.pin, forkPin: receipt.forkPin, ndk: toolchain.ndk, buildPathRemapped: remap, reproduced, staged: false, libraries: comparison}, null, 2) + '\n');
  return {receiptFile, comparison, reproduced};
}

/** `build` is the compile step; tests replace it, the command line never does. */
export function run(root, {status = false, offline = false, candidate = false, build = compile} = {}) {
  const manifest = readJson(path.join(root, QUALIFIED_HOST));
  const toolchain = readJson(path.join(root, BUILD_TOOLCHAIN));
  const workspace = path.join(root, WORKSPACE);
  if (candidate) {
    const output = path.join(workspace, `candidate-${manifest.forkPin}`);
    const {receiptFile, reproduced} = build(root, manifest, toolchain, output, {offline, remap: true});
    console.log(`Candidate built with a remapped build path: ${path.relative(root, receiptFile)}. ${reproduced ? 'It is byte-identical to the reviewed libraries.' : 'It differs from the expected hashes and is not staged.'}`);
    return 0;
  }
  const staged = stagedLibraries(root, manifest);
  const host = embeddingHostState(manifest, toolchain, staged);
  if (host.ready) {
    console.log('Reviewed ARM64 embedding host libraries are staged (bytes match android/embedding-host/qualified-host.json).');
    return 0;
  }
  const different = staged.filter(row => row.state === 'different');
  if (different.length)
    throw new Stop(2, `Staged ${different.map(row => row.name).join(', ')} in android/app/src/main/jniLibs/${manifest.abi} is not the reviewed bytes. Review where it came from and remove it; this step never replaces a staged library.`);
  const missing = `Embedding host not staged: ${staged.filter(row => row.state === 'missing').map(row => row.name).join(', ')} missing from android/app/src/main/jniLibs/${manifest.abi}.`;
  if (status) {
    console.log(`${missing} Run: npm run agent:build-embedding-host`);
    return 3;
  }
  const output = path.join(workspace, `build-${manifest.forkPin}`);
  // The reviewed bytes of a reproducible manifest were built with the remap, so the rebuild is too.
  const {comparison, reproduced} = build(root, manifest, toolchain, output, {offline, remap: true});
  if (!reproduced)
    throw new Stop(3, `The rebuilt embedding host is not the reviewed bytes and was not staged:\n${describeDifference(comparison).map(line => `  - ${line}`).join('\n')}\nRebuilt files and COMPARISON.json are in ${path.relative(root, output)}.`);
  stageReproduced(root, manifest, comparison);
  fs.writeFileSync(path.join(output, 'COMPARISON.json'), fs.readFileSync(path.join(output, 'COMPARISON.json'), 'utf8').replace('"staged": false', '"staged": true'));
  console.log('Rebuilt embedding host reproduces the reviewed bytes; staged. No device execution is claimed.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const unknown = args.filter(arg => !['--status', '--offline', '--candidate'].includes(arg));
  if (unknown.length) { console.error('Usage: node scripts/build-embedding-host.mjs [--status | --candidate] [--offline]'); process.exit(2); }
  try {
    process.exitCode = run(path.resolve(import.meta.dirname, '..'), {status: args.includes('--status'), offline: args.includes('--offline'), candidate: args.includes('--candidate')});
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    console.error(error.message);
    process.exitCode = error.code;
  }
}
