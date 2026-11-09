import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

/** Fetch only the missing historical specification revision; never change the checkout. */
export function prepareQuintHistory(root = projectRoot) {
  const inventory = JSON.parse(readFileSync(resolve(root, 'specs/quint/legacy/core/source-inventory.json')));
  const revision = inventory.revision;
  if (!/^[a-f0-9]{40}$/.test(revision)) throw Error('Invalid historical formal-source revision');
  const vendor = resolve(root, 'vendor/eliza');
  const git = args => execFileSync('git', ['-C', vendor, ...args], {stdio:'pipe'});
  git(['rev-parse', '--git-dir']);
  let fetched = false;
  try {git(['cat-file', '-e', revision+'^{commit}']);}
  catch (error) {
    if (error.status !== 128 && error.status !== 1) throw error;
    execFileSync('git', ['-C', vendor, 'fetch', '--no-tags', '--depth=1', 'origin', revision], {stdio:'inherit'});
    git(['cat-file', '-e', revision+'^{commit}']);
    fetched = true;
  }
  return {revision, fetched};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = prepareQuintHistory();
  console.log(`Historical formal-source objects ready at ${result.revision} (${result.fetched ? 'fetched' : 'cached'}).`);
}
