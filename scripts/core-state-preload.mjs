import fs from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {coreStateBuildPlugin, coreStateReceipt} from './core-state-patch.mjs';
import {verifySource} from './local-agent-source.mjs';

if (!globalThis.Bun) throw Error('Authenticated core preload requires Bun');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.env.ALPHA_CORE_STATE_SOURCE || path.join(root, 'vendor/eliza');
if (!path.isAbsolute(source)) throw Error('Core runtime source must be absolute');
const receipt = coreStateReceipt(root);
const frozen = process.env.ALPHA_CORE_STATE_FROZEN_MANIFEST;
if (frozen) {
  if (!path.isAbsolute(frozen)) throw Error('Frozen core source manifest must be absolute');
  const {sourceManifest} = await import('./combined-agent-source.mjs');
  const expected = JSON.parse(fs.readFileSync(frozen, 'utf8'));
  const actual = sourceManifest(source);
  if (actual.revision !== receipt.baseCommit || expected.format !== 1 ||
      expected.revision !== actual.revision || expected.contentSha256 !== actual.contentSha256 ||
      !isDeepStrictEqual(expected.entries, actual.entries)) throw Error('Frozen core source changed');
} else {
  verifySource(source, receipt.baseCommit);
}
Bun.plugin(coreStateBuildPlugin(root, source).plugin);
