#!/usr/bin/env node
// Alpha's functional feature manifest, emitted by the shared mobile-shell emitter
// (@elizaos/ui/mobile-shell/core mobileFeatureManifest) from config/alpha-product.json, and its
// parity against Eliza's reference registration. Alpha and Eliza may differ only by identity and
// theme; every remaining functional difference and every Alpha-owned behavioural module is listed
// in config/feature-parity.json, which may only shrink (test/feature-parity.test.mjs).
//
//   node scripts/feature-manifest.mjs            print Alpha's manifest
//   node scripts/feature-manifest.mjs --parity   print the differences and modules as they are now
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {tsImport} from 'tsx/esm/api';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = '.eliza/client-features/packages/ui/src/mobile-shell/core.ts';

/** Source that is not identity, theme or product registration: behaviour Alpha still owns. */
export function alphaBehaviouralModules(cwd = root) {
  const files = execFileSync('git', ['ls-files', 'apps/app/src', 'android/app/src/main/java'], {cwd, encoding: 'utf8'}).split('\n').filter(Boolean);
  return files.filter(file =>
    /\.(?:ts|tsx|js|mjs|java|kt)$/.test(file) && !file.endsWith('.d.ts') &&
    !file.startsWith('apps/app/src/product/') && fs.existsSync(path.join(cwd, file))).sort();
}

export async function featureParity(cwd = root) {
  const core = await tsImport(pathToFileURL(path.join(cwd, CORE)).href, import.meta.url);
  const record = JSON.parse(fs.readFileSync(path.join(cwd, 'config/alpha-product.json'), 'utf8'));
  const alpha = core.mobileFeatureManifest(core.defineMobileProductRegistration(record));
  const eliza = core.mobileFeatureManifest(core.ELIZA_MOBILE_PRODUCT);
  return {
    alpha, eliza,
    differences: core.compareMobileFeatureManifests(alpha, eliza).map(core.mobileFeatureDifferenceKey),
    modules: alphaBehaviouralModules(cwd),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const parity = await featureParity();
  const output = process.argv.includes('--parity')
    ? {differences: parity.differences, modules: parity.modules}
    : parity.alpha;
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}
