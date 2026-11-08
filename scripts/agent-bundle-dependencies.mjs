import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {readMobileBundleDependencies} from '../vendor/eliza/packages/agent/scripts/mobile-bundle-dependencies.ts';

export const AGENT_BUNDLE_DEPENDENCIES = 'agent-bundle-dependencies.json';

/** Read the producer's inventory against the actual staged bytes and prepared packages. */
export function readAgentBundleDependencies(sourceDir, agentDir) {
  const file = path.join(agentDir, AGENT_BUNDLE_DEPENDENCIES);
  try {
    const expected = producerInventory(sourceDir, agentDir);
    const staged = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!isDeepStrictEqual(staged, expected))
      throw new Error('Staged inventory differs from the complete producer inventory');
    return expected.packages;
  } catch (cause) {
    throw new Error(`Agent bundle dependency inventory cannot be verified: ${cause.message}`, {cause});
  }
}

/** Keep the producer inventory with the staged payload; compact JS has no module comments. */
export function stageAgentBundleDependencies(sourceDir, agentDir) {
  const inventory = producerInventory(sourceDir, agentDir);
  fs.writeFileSync(path.join(agentDir, AGENT_BUNDLE_DEPENDENCIES), `${JSON.stringify(inventory, null, 2)}\n`);
}

function producerInventory(sourceDir, agentDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'packages/agent/dist-mobile/plugins-manifest.json'), 'utf8'));
  if (manifest.bundle !== 'agent-bundle.js' || manifest.platform !== 'android')
    throw new Error('Agent bundle dependency inventory requires the Android mobile manifest');
  const packages = readMobileBundleDependencies(
    manifest.bundleDependencies,
    fs.readFileSync(path.join(agentDir, 'agent-bundle.js')),
    sourceDir,
  );
  return {version: 1, bundleSha256: manifest.bundleDependencies.bundleSha256, packages};
}
