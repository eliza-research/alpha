import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {sha} from '../scripts/upstream-native-source.mjs';
import {clientServicePatch} from '../scripts/client-service-patch.mjs';

const target = 'plugins/plugin-inbox/src/mailbox/review-controller.ts';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-service-patch-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const directory = path.join(root, 'patches/eliza');
  fs.mkdirSync(directory, {recursive: true});
  const original = Buffer.from('export const version = 1;\n');
  const body = 'export const version = 2;\n';
  const patch = `--- a/${target}\n+++ b/${target}\n@@ -1 +1 @@\n-export const version = 1;\n+export const version = 2;\n`;
  const manifest = {schema: 1, baseCommit: 'a'.repeat(40), patches: [{file: 'service.patch', sha256: sha(patch),
    targets: [{path: target, beforeSha256: sha(original), afterSha256: sha(body)}]}]};
  const write = () => {
    fs.writeFileSync(path.join(directory, 'service.patch'), patch);
    fs.writeFileSync(path.join(directory, 'service-state-client-manifest.json'), JSON.stringify(manifest));
  };
  write();
  const upstream = {pin: manifest.baseCommit, read(name) {
    assert.equal(name, target);
    return new Map([[target, {bytes: original, mode: '100644', sha256: sha(original)}]]);
  }};
  return {root, directory, original, body, patch, manifest, write, upstream};
}

test('client service replacements preserve the source and bind preimage, patch and output', t => {
  const value = fixture(t);
  const before = Buffer.from(value.original);
  const result = clientServicePatch(value.root, value.upstream);
  assert.deepEqual(value.original, before);
  assert.equal(result.files.get(target).bytes.toString(), value.body);
  assert.deepEqual(result.receipt.files[target], {beforeSha256: sha(before), afterSha256: sha(value.body)});
  assert.equal(result.receipt.patches[0].sha256, sha(value.patch));
  assert.match(result.receipt.preparerSha256, /^[a-f0-9]{64}$/);
});

test('client service replacements reject mismatched identity and undeclared targets', t => {
  for (const kind of ['pin', 'preimage', 'output', 'digest', 'target', 'duplicate', 'schema']) {
    const value = fixture(t);
    const patch = value.manifest.patches[0];
    if (kind === 'pin') value.manifest.baseCommit = 'b'.repeat(40);
    if (kind === 'preimage') patch.targets[0].beforeSha256 = '0'.repeat(64);
    if (kind === 'output') patch.targets[0].afterSha256 = '0'.repeat(64);
    if (kind === 'digest') patch.sha256 = '0'.repeat(64);
    if (kind === 'target') patch.targets[0].path = '../outside.ts';
    if (kind === 'duplicate') value.manifest.patches.push(structuredClone(patch));
    if (kind === 'schema') value.manifest.extra = true;
    value.write();
    assert.throws(() => clientServicePatch(value.root, value.upstream), undefined, kind);
  }
});

test('client service replacements reject linked input and extra patch headers', t => {
  const linked = fixture(t);
  const outside = path.join(linked.root, 'outside.patch');
  fs.renameSync(path.join(linked.directory, 'service.patch'), outside);
  fs.symlinkSync(outside, path.join(linked.directory, 'service.patch'));
  assert.throws(() => clientServicePatch(linked.root, linked.upstream), /Linked/);
  const extra = fixture(t);
  const payload = extra.patch + '--- /dev/null\n+++ b/extra.ts\n@@ -0,0 +1 @@\n+export const extra = true;\n';
  extra.manifest.patches[0].sha256 = sha(payload);
  extra.write();
  fs.writeFileSync(path.join(extra.directory, 'service.patch'), payload);
  assert.throws(() => clientServicePatch(extra.root, extra.upstream), /headers mismatch/);
});
