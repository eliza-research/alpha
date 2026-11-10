import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const quintHistoryInventories = [
  'specs/quint/legacy/core/source-inventory.json',
  'specs/quint/refinement/native/mms-historical-sources.json',
];

/** Fetch only missing explicitly inventoried historical revisions; never change the checkout. */
export function prepareQuintHistory(root = projectRoot) {
  const revisions = [...new Set(quintHistoryInventories.map(path=>{
    const {revision}: {revision?: unknown} = JSON.parse(readFileSync(resolve(root, path), 'utf8'));
    if (typeof revision !== 'string' || !/^[a-f0-9]{40}$/.test(revision)) throw Error('Invalid historical source revision');
    return revision;
  }))];
  const vendor = resolve(root, 'vendor/eliza');
  const git = (args: string[]) => execFileSync('git', ['-C', vendor, ...args], {stdio:'pipe'});
  git(['rev-parse', '--git-dir']);
  return {revisions:revisions.map(revision=>{
    let fetched = false;
    try {git(['cat-file', '-e', revision+'^{commit}']);}
    catch (error) {
      if (!(error instanceof Error && 'status' in error && (error.status === 128 || error.status === 1))) throw error;
      execFileSync('git', ['-C', vendor, 'fetch', '--no-tags', '--depth=1', 'origin', revision], {stdio:'inherit'});
      git(['cat-file', '-e', revision+'^{commit}']);
      fetched = true;
    }
    return {revision,fetched};
  })};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = prepareQuintHistory();
  for(const {revision,fetched} of result.revisions)console.log(`Historical source objects ready at ${revision} (${fetched ? 'fetched' : 'cached'}).`);
}
