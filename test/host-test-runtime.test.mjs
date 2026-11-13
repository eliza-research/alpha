import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ensureHostTestRuntime, hostTestAsset, hostTestBuilder, verifyHostTestBinary, writeHostTestArchive} from '../scripts/host-test-runtime.ts';

test('the host-test runtime is pinned separately from the actual builder', async () => {
 const builder = await hostTestBuilder();
 const runtime = await ensureHostTestRuntime();
 assert.equal(runtime.version, '1.4.4');
 assert.equal(builder.version, '1.4.2');
 assert.equal(builder.file, process.env.ALPHA_BUN ?? process.execPath);
 await assert.rejects(hostTestBuilder(runtime.file), /Build Bun must remain 1.4.2/);
 assert.notEqual(fs.realpathSync(runtime.file), fs.realpathSync(builder.file));
 await verifyHostTestBinary(runtime.file);
 for (const [platform, arch] of [['linux','x64'],['linux','arm64'],['darwin','x64'],['darwin','arm64']]) {
  const asset = hostTestAsset(platform, arch);
  assert.match(asset.url, /^https:\/\/github\.com\/oven-sh\/bun\/releases\/download\/bun-v1\.4\.4\//);
  assert.ok(asset.binaryBytes > 0 && asset.archiveBytes > 0);
 }
 assert.throws(() => hostTestAsset('freebsd', 'x64'), /No pinned host-test Bun/);
});

test('a cached host-test executable rejects replacement bytes and symlinks before execution', async t => {
 const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-host-test-cache-'));
 t.after(() => fs.rmSync(temporary, {recursive:true, force:true}));
 const runtime = await ensureHostTestRuntime(), file = path.join(temporary, 'bun');
 fs.copyFileSync(runtime.file, file); fs.chmodSync(file, 0o700);
 await verifyHostTestBinary(file);
 // Replace the executed file by rename: Linux refuses writes to a file a process just executed (ETXTBSY).
 const replacement = path.join(temporary, 'bun.replacement'), bytes = fs.readFileSync(file);
 bytes[0] ^= 1; fs.writeFileSync(replacement, bytes, {mode:0o700}); fs.chmodSync(replacement, 0o700);
 fs.renameSync(replacement, file);
 await assert.rejects(verifyHostTestBinary(file), /hash differs/);
 fs.unlinkSync(file); fs.symlinkSync(runtime.file, file);
 await assert.rejects(verifyHostTestBinary(file), /owned regular executable/);
 const alpha = path.join(temporary, 'alpha'); fs.mkdirSync(alpha);
 fs.symlinkSync(temporary, path.join(alpha, 'host-test-bun'), 'dir');
 await assert.rejects(ensureHostTestRuntime(temporary), /owned, non-writable directory/);
 const writable = path.join(temporary, 'writable'); fs.mkdirSync(writable, {mode:0o777}); fs.chmodSync(writable, 0o777);
 await assert.rejects(ensureHostTestRuntime(writable), /owned, non-writable directory/);
});

test('archive acquisition refuses changed, truncated and excess bytes without extracting them', async t => {
 const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-host-test-archive-'));
 t.after(() => fs.rmSync(temporary, {recursive:true, force:true}));
 const bytes = Buffer.from('controlled archive bytes');
 const asset = {...hostTestAsset(), archiveBytes:bytes.length, archiveSha256:createHash('sha256').update(bytes).digest('hex')};
 await writeHostTestArchive(new Response(bytes), path.join(temporary, 'accepted'), asset);
 assert.deepEqual(fs.readFileSync(path.join(temporary, 'accepted')), bytes);
 await assert.rejects(writeHostTestArchive(new Response(Buffer.alloc(bytes.length)), path.join(temporary, 'changed'), asset), /differs from its pin/);
 await assert.rejects(writeHostTestArchive(new Response(bytes.subarray(1)), path.join(temporary, 'short'), asset), /differs from its pin/);
 await assert.rejects(writeHostTestArchive(new Response(Buffer.concat([bytes,bytes])), path.join(temporary, 'long'), asset), /exceeds its pinned size/);
});
