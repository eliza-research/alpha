import fs from 'node:fs';
import path from 'node:path';

/** upstream.lock.json: the shared elizaOS source revision vendor/eliza is checked out at. */
export interface UpstreamPin {
  url: string;
  commit: string;
  appSource: string;
  nativeSystemSource: string;
  osSource: string;
}

/** The recorded pin of the product checkout at `root`, read as committed (no validation). */
export function readUpstreamPin(root: string): UpstreamPin {
  return JSON.parse(fs.readFileSync(path.join(root, 'upstream.lock.json'), 'utf8'));
}
