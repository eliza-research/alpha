import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const staged = '.eliza/client-features/';
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Bind the entire authenticated client projection, plus each declared driver input.
 * This is provenance only. A hashed source does not imply that a trace covers its behavior. */
export function serviceInputs(entries) {
  const found = new Set(entries.map(entry => path.relative(process.cwd(), path.resolve(entry)).split(path.sep).join('/')));
  const provenance = JSON.parse(fs.readFileSync(staged + '.source.json', 'utf8'));
  const pin = JSON.parse(fs.readFileSync('upstream.lock.json', 'utf8')).commit;
  if (provenance.baseCommit !== pin) throw Error('Staged service source pin differs from lock');
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
  for (const entry of ['specs/quint/refinement/services/source-inputs.mjs', 'package-lock.json', 'upstream.lock.json', staged + '.source.json', 'scripts/prepare-client-features.mjs', 'scripts/upstream-native-source.mjs', 'scripts/client-service-patch.mjs', 'scripts/client-speech-patch.mjs']) found.add(entry);
  for (const [manifestPath, key, preparer] of [
    ['patches/eliza/service-state-client-manifest.json', 'serviceStatePatch', 'scripts/client-service-patch.mjs'],
    ['patches/eliza/cloud-speech-client-manifest.json', 'speechPatch', 'scripts/client-speech-patch.mjs'],
  ]) {
    if (!fs.existsSync(manifestPath)) continue;
    found.add(manifestPath);
    const receipt = provenance[key];
    if (!receipt || digest(manifestPath) !== receipt.manifestSha256 || digest(preparer) !== receipt.preparerSha256) throw Error(`Stale client patch provenance ${key}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const patch of manifest.patches) {
      const file = 'patches/eliza/' + patch.file;
      if (digest(file) !== patch.sha256) throw Error(`Changed client patch ${file}`);
      found.add(file);
    }
  }
  return [...found].sort();
}
