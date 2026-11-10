import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// A closed producer port. The product wrapper and artifact verifier execute normally.
export async function buildWorkflowArtifact({sourceRoot, outputDir, sourceIdentity}) {
  const port = globalThis[Symbol.for('alpha.quint.preparedWorkerPorts')].get(sourceRoot);
  port.enter();
  const outcome = await port.release;
  if (outcome === 'failed') throw Error('Synthetic worker producer failed');
  fs.mkdirSync(outputDir, {recursive: true});
  if (outcome === 'partial') {
    fs.writeFileSync(path.join(outputDir, 'incomplete.txt'), 'Retained interrupted producer output');
    throw Error('Synthetic worker producer interrupted');
  }
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const files = {};
  for (const name of ['node_modules/smthrs/package.json', 'node_modules/zod/package.json',
    'node_modules/effect/package.json', 'node_modules/@smthrs/engine/package.json', 'dependencies.json']) {
    const file = path.join(outputDir, name);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, '{}');
    files[name] = hash('{}');
  }
  const manifest = {version: 1, sourceStampSha256: sourceIdentity,
    lockSha256: hash(fs.readFileSync(path.join(sourceRoot, 'bun.lock'))), files};
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest));
  if (outcome === 'corrupt') fs.writeFileSync(path.join(outputDir, 'dependencies.json'), 'Corrupted bytes');
}
