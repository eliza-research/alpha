#!/usr/bin/env bun
/** Invoke the unmodified pinned builder, attesting only a fresh output from clean source. */
import fs from 'node:fs';
import {sha256File} from './sha256.ts';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {upstreamNativeSource} from './upstream-native-source.ts';
import {verifyParadeeFfi} from './paradee-runtime.ts';
import {verifyPinnedUpstream} from './pinned-upstream-source.ts';

const identity = (root: string) => {
  const source = upstreamNativeSource(root);
  for (const prefix of ['packages/app/scripts/paradee-voice', 'packages/app/scripts/stage-elizavoice-lib.ts', 'plugins/plugin-local-inference/native/android/inputs.json']) source.read(prefix);
  const pin = source.pin;
  const {forkPin} = verifyParadeeFfi(root);
  return {sourceCommit: pin, nativeCommit: forkPin};
};
type Identity = ReturnType<typeof identity>;
type BuildRecord = Partial<Identity> & {files?: {path: string; bytes: number; sha256: string}[]};
export function buildPinnedVoice(root: string, args: string[], {
  readIdentity = identity,
  verifyUpstream = verifyPinnedUpstream,
  run = (file: string, argv: string[]) => execFileSync(file, argv, {stdio: 'inherit'}),
} = {}) {
  const index = args.indexOf('--out');
  if (index < 0 || !args[index + 1] || args.filter(value => value === '--out').length !== 1 || args.some(value => value.startsWith('--out='))) throw Error('Provide exactly one --out <fresh directory>');
  const output = path.resolve(args[index + 1]);
  const vendor = path.join(root, 'vendor');
  if (output === vendor || output.startsWith(vendor + path.sep)) throw Error('Voice output must be outside vendor');
  for (let current = path.dirname(output); current !== path.dirname(current); current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error('Voice output must not traverse a symbolic link');
  }
  if (fs.existsSync(output)) throw Error('Voice output must be a fresh directory');
  const before = readIdentity(root);
  run(process.execPath, [path.join(root, 'vendor/eliza/packages/app/scripts/paradee-voice/build-native.ts'), ...args]);
  const after = readIdentity(root);
  const recordPath = path.join(output, 'build-record.json');
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Voice source changed during the build');
  // The Android build authenticates the whole checkout, ignored files included; refuse here first.
  verifyUpstream(root);
  if (!fs.lstatSync(recordPath).isFile()) throw Error('Voice build record must be a regular file');
  const record: BuildRecord = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  for (const key of Object.keys(before) as (keyof Identity)[]) if (record[key] !== undefined && record[key] !== before[key]) throw Error('Voice builder reported a different source revision');
  if (!Array.isArray(record.files) || !record.files.length || new Set(record.files.map(row => row.path)).size !== record.files.length) throw Error('Voice build file evidence is incomplete');
  for (const row of record.files) {
    if (typeof row.path !== 'string' || path.isAbsolute(row.path) || row.path.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw Error('Invalid voice build file path');
    let file = output;
    for (const part of row.path.split('/')) {file = path.join(file, part);if (fs.lstatSync(file).isSymbolicLink()) throw Error('Voice build file must not traverse a symbolic link');}
    if (!fs.statSync(file).isFile() || fs.statSync(file).size !== row.bytes) throw Error('Voice build artifact size differs from its record');
    if (sha256File(file) !== row.sha256) throw Error('Voice build artifact hash differs from its record');
  }
  fs.writeFileSync(recordPath, JSON.stringify({...record, ...before}, null, 2) + '\n');
  return before;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildPinnedVoice(path.resolve(import.meta.dirname, '..'), process.argv.slice(2));
