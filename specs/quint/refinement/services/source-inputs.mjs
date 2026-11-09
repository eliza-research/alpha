import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareClientFeatures} from '../../../../scripts/prepare-client-features.mjs';

const staged = '.eliza/client-features/';
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Bind the authenticated projection and its pinned inputs. Hashing establishes provenance,
 * while each driver separately states the source behavior its trace actually observes. */
export function serviceInputs(entries) {
  prepareClientFeatures({check:true});
  const found = new Set(entries.map(entry => path.relative(process.cwd(), path.resolve(entry)).split(path.sep).join('/')));
  const provenance = JSON.parse(fs.readFileSync(staged + '.source.json', 'utf8'));
  for (const [relative, expected] of Object.entries(provenance.files)) {
    const effective = staged + relative;
    if (digest(effective) !== expected) throw Error(`Unverified staged service input ${relative}`);
    found.add(effective);
    if (provenance.sourceFiles[relative]) {
      const original = 'vendor/eliza/' + relative;
      if (digest(original) !== provenance.sourceFiles[relative]) throw Error(`Changed pinned service input ${relative}`);
      found.add(original);
    }
  }
  for (const entry of ['specs/quint/refinement/services/source-inputs.mjs', 'package-lock.json', 'upstream.lock.json', staged + '.source.json', 'scripts/prepare-client-features.mjs', 'scripts/upstream-native-source.mjs']) found.add(entry);
  const preparer = 'scripts/managed-google-client-backport.mjs';
  found.add(preparer);
  const receipt = provenance.managedGooglePatch;
  if (receipt) {
    const manifest = 'patches/eliza/managed-google-agent-manifest.json';
    if (digest(manifest) !== receipt.manifestSha256 || digest(preparer) !== receipt.preparerSha256) {
      throw Error('Stale managed Google client backport provenance');
    }
    found.add(manifest);
    for (const patch of receipt.patches) {
      const file = 'patches/eliza/' + patch.file;
      if (digest(file) !== patch.sha256) throw Error(`Changed client patch ${file}`);
      found.add(file);
    }
  }
  for (const [key, value] of Object.entries(provenance)) {
    if (value?.manifestSha256 && key !== 'managedGooglePatch') throw Error(`Unbound client patch provenance ${key}`);
  }
  return [...found].sort();
}
