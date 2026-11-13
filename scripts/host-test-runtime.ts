/** A host-test process only. The SDK, bytecode and Android producers keep their builder Bun. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';

export interface HostTestAsset {
  url: string; archiveBytes: number; archiveSha256: string; member: string;
  binaryBytes: number; binarySha256: string;
}
const lock = JSON.parse(fs.readFileSync(new URL('./host-test-runtime.json', import.meta.url), 'utf8')) as {
  version: string; builderVersion: string; assets: Record<string, HostTestAsset>;
};
export const hostTestVersion = lock.version;

export function hostTestAsset(platform = process.platform, arch = process.arch): HostTestAsset {
  const asset = lock.assets[`${platform}-${arch}`];
  if (!asset) throw Error(`No pinned host-test Bun for ${platform}-${arch}`);
  return asset;
}

function directory(file: string) {
  try {fs.mkdirSync(file, {mode: 0o700});}
  catch (error) {if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;}
  const stat = fs.lstatSync(file);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o022) ||
      (process.getuid && stat.uid !== process.getuid())) throw Error('Host-test cache must be an owned, non-writable directory');
}

async function binaryDigest(file: string, expectedBytes: number) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o022) || !(stat.mode & 0o111) ||
      (process.getuid && stat.uid !== process.getuid())) throw Error('Host-test Bun must be an owned regular executable');
  if (stat.size !== expectedBytes) throw Error('Host-test Bun size differs from its pin');
  const handle = await fs.promises.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const hash = createHash('sha256'), buffer = Buffer.alloc(4 * 1024 * 1024);
    let position = 0;
    for (;;) {
      const {bytesRead} = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
    }
    if (position !== expectedBytes) throw Error('Host-test Bun changed while hashing');
    return hash.digest('hex');
  } finally {await handle.close();}
}

/** All subprocesses are asynchronous: the parent may still be the affected builder Bun. */
async function versionOf(file: string) {
  const child = spawn(file, ['--version'], {stdio: ['ignore', 'pipe', 'pipe']});
  const chunks: Buffer[] = []; let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      timer = setTimeout(() => {child.kill('SIGKILL'); reject(Error('Bun version check exceeded 30 seconds'));}, 30000);
      // Listen for completion before draining streams: a --version child can exit immediately.
      child.once('error', reject);
      child.once('close', (code, signal) => code === 0 && !signal
        ? resolve(Buffer.concat(chunks).toString('utf8').trim())
        : reject(Error(`Bun version check failed (${signal ?? code})`)));
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1024) {child.kill('SIGKILL'); reject(Error('Unexpected host-test version output'));}
        else chunks.push(chunk);
      });
      child.stderr.resume();
    });
  } finally {if (timer) clearTimeout(timer);}
}

export async function verifyHostTestBinary(file: string, asset = hostTestAsset()) {
  if (await binaryDigest(file, asset.binaryBytes) !== asset.binarySha256) throw Error('Host-test Bun hash differs from its pin');
  if (await versionOf(file) !== lock.version) throw Error('Host-test Bun version differs from its pin');
}

async function writeAll(handle: fs.promises.FileHandle, bytes: Uint8Array) {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const {bytesWritten} = await handle.write(bytes, offset, bytes.byteLength - offset);
    if (!bytesWritten) throw Error('Host-test runtime write made no progress');
    offset += bytesWritten;
  }
}

export async function writeHostTestArchive(response: Response, file: string, asset: HostTestAsset) {
  if (!response.ok || !response.body) throw Error(`Host-test Bun download failed (${response.status})`);
  const output = await fs.promises.open(file, 'wx', 0o600);
  const hash = createHash('sha256'); let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > asset.archiveBytes) throw Error('Host-test Bun archive exceeds its pinned size');
      hash.update(chunk);
      await writeAll(output, chunk);
    }
  } finally {await output.close();}
  if (size !== asset.archiveBytes || hash.digest('hex') !== asset.archiveSha256)
    throw Error('Host-test Bun archive differs from its pin');
}

async function download(file: string, asset: HostTestAsset) {
  const response = await fetch(asset.url, {signal: AbortSignal.timeout(120000)});
  await writeHostTestArchive(response, file, asset);
}

async function extract(archive: string, output: string, asset: HostTestAsset) {
  // Only this member's bytes reach the file we opened; no ZIP path can choose a destination.
  const handle = await fs.promises.open(output, 'wx', 0o700);
  const child = spawn('unzip', ['-p', archive, asset.member], {stdio: ['ignore', 'pipe', 'pipe']});
  const exit = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 && !signal ? resolve() : reject(Error(`Host-test Bun extraction failed (${signal ?? code})`)));
  });
  void exit.catch(() => {}); // The original rejection is awaited below, after stdout is drained.
  child.stderr.resume(); let size = 0;
  try {
    for await (const chunk of child.stdout) {
      size += chunk.length;
      if (size > asset.binaryBytes) throw Error('Host-test Bun member exceeds its pinned size');
      await writeAll(handle, chunk);
    }
    await exit;
    if (size !== asset.binaryBytes) throw Error('Host-test Bun member size differs from its pin');
  } catch (error) {
    child.kill('SIGKILL'); await exit.catch(() => {}); throw error;
  } finally {await handle.close();}
}

export async function ensureHostTestRuntime(cacheBase = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache')) {
  const asset = hostTestAsset();
  fs.mkdirSync(cacheBase, {recursive: true});
  let cache = fs.realpathSync(cacheBase);
  directory(cache);
  for (const part of ['alpha', 'host-test-bun']) {cache = path.join(cache, part); directory(cache);}
  const destination = path.join(cache, `${process.platform}-${process.arch}-${asset.binarySha256}`);
  const file = path.join(destination, 'bun');
  if (fs.existsSync(destination)) {
    directory(destination); await verifyHostTestBinary(file, asset);
  } else {
    const staged = fs.mkdtempSync(path.join(cache, 'stage-'));
    try {
      const archive = path.join(staged, 'archive.zip'), binary = path.join(staged, 'bun');
      await download(archive, asset); await extract(archive, binary, asset); await verifyHostTestBinary(binary, asset);
      fs.unlinkSync(archive);
      try {fs.renameSync(staged, destination);}
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        directory(destination); await verifyHostTestBinary(file, asset);
      }
    } finally {fs.rmSync(staged, {recursive: true, force: true});}
  }
  return {file, version: lock.version, platform: process.platform, arch: process.arch,
    sha256: asset.binarySha256, archiveSha256: asset.archiveSha256};
}

export async function hostTestBuilder(file = process.env.ALPHA_BUN ?? process.execPath) {
  const version = await versionOf(file);
  if (version !== lock.builderVersion) throw Error(`Build Bun must remain ${lock.builderVersion}; host-test Bun is separate`);
  return {file, version};
}
