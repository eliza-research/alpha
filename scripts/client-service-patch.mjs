import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sha} from './upstream-native-source.mjs';

const HEX = /^[a-f0-9]{64}$/;
const TARGETS = new Set([
  'plugins/plugin-inbox/src/mailbox/review-controller.ts',
  'plugins/plugin-inbox/src/mailbox/drafts-controller.ts',
  'plugins/plugin-native-camera/src/scan-document.ts',
]);
const exactKeys = (value, keys) => value && typeof value === 'object' &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

function regular(filename, root) {
  filename = path.resolve(filename);
  root = path.resolve(root);
  if (!filename.startsWith(root + path.sep)) throw Error('Client service patch escaped source root');
  for (let current = filename; current !== root; current = path.dirname(current)) {
    if (fs.lstatSync(current).isSymbolicLink()) throw Error('Linked client service patch');
  }
  if (!fs.lstatSync(filename).isFile()) throw Error('Nonregular client service patch');
}

/** Authenticated replacements of three reviewed shared state-controller files. */
export function clientServicePatch(root, upstream) {
  root = path.resolve(root);
  const patchRoot = path.join(root, 'patches/eliza');
  const manifestFile = path.join(patchRoot, 'service-state-client-manifest.json');
  if (!fs.existsSync(manifestFile)) return {files: new Map(), receipt: null};
  regular(manifestFile, root);
  const manifestBytes = fs.readFileSync(manifestFile);
  const manifest = JSON.parse(manifestBytes);
  if (!exactKeys(manifest, ['schema', 'baseCommit', 'patches']) || manifest.schema !== 1 ||
      manifest.baseCommit !== upstream.pin || !Array.isArray(manifest.patches) ||
      !manifest.patches.length || manifest.patches.length > TARGETS.size) {
    throw Error('Client service patch pin/schema mismatch');
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-client-services-'));
  const expected = new Map();
  const patches = [];
  try {
    for (const patch of manifest.patches) {
      if (!exactKeys(patch, ['file', 'sha256', 'targets']) ||
          !/^[a-z0-9-]+\.patch$/.test(patch.file) || !HEX.test(patch.sha256) ||
          !Array.isArray(patch.targets) || !patch.targets.length || patch.targets.length > TARGETS.size) {
        throw Error('Invalid client service patch');
      }
      const patchFile = path.join(patchRoot, patch.file);
      regular(patchFile, patchRoot);
      const bytes = fs.readFileSync(patchFile);
      if (bytes.length > 2 * 1024 * 1024 || sha(bytes) !== patch.sha256) {
        throw Error('Client service patch digest mismatch');
      }
      for (const target of patch.targets) {
        if (!exactKeys(target, ['path', 'beforeSha256', 'afterSha256']) ||
            !TARGETS.has(target.path) || expected.has(target.path) ||
            !HEX.test(target.beforeSha256) || !HEX.test(target.afterSha256)) {
          throw Error('Client service target mismatch');
        }
        const original = upstream.read(target.path).get(target.path);
        if (!original || original.mode !== '100644' || sha(original.bytes) !== target.beforeSha256) {
          throw Error('Client service preimage mismatch');
        }
        const destination = path.join(temporary, target.path);
        fs.mkdirSync(path.dirname(destination), {recursive: true});
        fs.writeFileSync(destination, original.bytes, {mode: 0o644});
        expected.set(target.path, {beforeSha256: target.beforeSha256, afterSha256: target.afterSha256});
      }
      const headers = bytes.toString('utf8').split('\n').filter(line => line.startsWith('--- ') || line.startsWith('+++ '));
      const wanted = patch.targets.flatMap(target => ['--- a/' + target.path, '+++ b/' + target.path]);
      if (JSON.stringify(headers) !== JSON.stringify(wanted)) throw Error('Client service patch headers mismatch');
      execFileSync('patch', ['--batch', '--fuzz=0', '--forward', '-p1', '--input', patchFile], {
        cwd: temporary, stdio: 'pipe', timeout: 30000,
      });
      patches.push({file: patch.file, sha256: patch.sha256});
    }
    const files = new Map();
    function visit(directory) {
      for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
        const filename = path.join(directory, entry.name);
        const name = path.relative(temporary, filename).split(path.sep).join('/');
        if (entry.isDirectory()) visit(filename);
        else {
          if (!entry.isFile() || entry.isSymbolicLink() || !expected.has(name)) {
            throw Error('Unexpected client service patch output');
          }
          const bytes = fs.readFileSync(filename);
          if (bytes.length > 512 * 1024 || sha(bytes) !== expected.get(name).afterSha256 ||
              (fs.statSync(filename).mode & 0o111) !== 0) {
            throw Error('Client service output digest/mode mismatch');
          }
          files.set(name, {bytes, mode: '100644', sha256: sha(bytes)});
        }
      }
    }
    visit(temporary);
    if (files.size !== expected.size) throw Error('Missing client service patch output');
    return {files, receipt: {
      manifestSha256: sha(manifestBytes),
      preparerSha256: sha(fs.readFileSync(fileURLToPath(import.meta.url))),
      patches,
      files: Object.fromEntries(expected),
    }};
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true});
  }
}
