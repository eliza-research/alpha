import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CLIENT_FEATURE_PATCHES, prepareClientFeatures} from '../../../../scripts/prepare-client-features.mjs';

const staged = '.eliza/client-features/';
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Bind the authenticated projection and its active patch inputs. Hashing establishes provenance,
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
  for (const entry of ['specs/quint/refinement/services/source-inputs.mjs', 'package-lock.json', 'upstream.lock.json', staged + '.source.json', 'scripts/prepare-client-features.mjs', 'scripts/upstream-native-source.mjs', 'scripts/client-speech-patch.mjs']) found.add(entry);
  const accounted = new Set();
  for (const [key, prefix] of CLIENT_FEATURE_PATCHES) {
    const receipt = provenance[key];
    if (!receipt) continue;
    const manifestPath = `patches/eliza/${prefix}-manifest.json`, patchPath = `patches/eliza/${prefix}.patch`;
    if (digest(manifestPath) !== receipt.manifestSha256 || digest(patchPath) !== receipt.patchSha256) throw Error(`Changed client patch ${prefix}`);
    found.add(manifestPath);found.add(patchPath);accounted.add(key);
  }
  for (const [key, name] of [['speechPatch', 'cloud-speech-client'], ['managedGooglePatch', 'managed-google-agent']]) {
    const receipt = provenance[key];
    if (!receipt) continue;
    const manifestPath = `patches/eliza/${name}-manifest.json`;
    if (digest(manifestPath) !== receipt.manifestSha256 || digest('scripts/client-speech-patch.mjs') !== receipt.preparerSha256) throw Error(`Stale client patch provenance ${name}`);
    found.add(manifestPath);accounted.add(key);
    for (const patch of JSON.parse(fs.readFileSync(manifestPath, 'utf8')).patches) {
      const file = 'patches/eliza/' + patch.file;
      if (digest(file) !== patch.sha256) throw Error(`Changed client patch ${file}`);
      found.add(file);
    }
  }
  for (const [key, receipt] of Object.entries(provenance)) {
    if (receipt?.manifestSha256 && !accounted.has(key)) throw Error(`Unbound client patch provenance ${key}`);
  }
  return [...found].sort();
}
