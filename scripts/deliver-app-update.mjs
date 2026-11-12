#!/usr/bin/env node
/** Publish an admitted release APK first, verify anonymous download, then move
 * the stable manifest. No keys, builds or private QA URLs enter this command.
 * GitHub asset replacement is not atomic: a manifest upload failure is reported
 * and must be repaired by retrying this same candidate, never by changing its APK.
 */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {main as prepare, MANIFEST_NAME} from './publish-update-manifest.mjs';
import {updateArtifactDigest} from './update-artifact.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Anonymous HTTPS only, bounded redirects/body/time, streamed APK digest. */
export async function publicObject(url, {maxBytes, missing = false, fetcher = fetch} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2**31) throw Error('Public update download needs a positive bounded size');
  let address = new URL(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10 * 60_000);
  try {
    for (let hop = 0; hop <= 5; hop++) {
      if (address.protocol !== 'https:' || address.username || address.password) throw Error('Public update transport requires credential-free HTTPS');
      const response = await fetcher(address.href, {redirect: 'manual', signal: controller.signal, headers: {'cache-control': 'no-cache'}});
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw Error('Public update redirect has no location');
        address = new URL(location, address);
        continue;
      }
      if (missing && response.status === 404) {await response.body?.cancel(); return null;}
      if (response.status !== 200) {await response.body?.cancel(); throw Error(`Public update download returned HTTP ${response.status}`);}
      const hash = createHash('sha256'), chunks = [];
      let size = 0;
      for await (const chunk of response.body || []) {
        size += chunk.byteLength;
        if (size > maxBytes) {controller.abort(); throw Error('Public update download exceeds its declared size');}
        hash.update(chunk);
        // Only manifests are retained; APK readback never buffers an entire APK.
        if (maxBytes <= 32768) chunks.push(chunk);
      }
      return {size, sha256: hash.digest('hex'), ...(maxBytes <= 32768 ? {bytes: Buffer.concat(chunks)} : {})};
    }
    throw Error('Too many public update redirects');
  } finally {clearTimeout(timeout);}
}

function parseOffer(bytes) {
  const value = JSON.parse(bytes.toString('utf8'));
  if (value?.schema !== 'alpha-update/v1' || !['launcher','standalone'].includes(value.variant) ||
      !Number.isSafeInteger(value.versionCode) || value.versionCode < 1 || !/^[0-9a-f]{64}$/.test(value.signerSha256 || '') ||
      !/^[0-9a-f]{64}$/.test(value.sha256 || '') || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 1 || value.sizeBytes > 2**31) {
    throw Error('Publication requires a single complete alpha-update/v1 offer; an index needs its own reviewed transition');
  }
  return value;
}

function gh(args, {allowMissing = false} = {}) {
  try {return execFileSync('gh', args, {encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 600_000, maxBuffer: 2**20}).trim();}
  catch (failed) {
    if (allowMissing && /release not found|HTTP 404/.test(String(failed.stderr))) return null;
    throw Error('GitHub update publication failed; inspect the release before retrying');
  }
}

/** All inputs have already passed prepare's release and actual-APK admission.
 * Injected ports let failure tests exercise the real publication ordering.
 */
export async function deliver({directory, manifestUrl, source}, {run = gh, read = publicObject, wait = sleep} = {}) {
  const parsed = new URL(manifestUrl);
  const match = /^\/([\w.-]+\/[\w.-]+)\/releases\/download\/app-stable\/alpha-update-stable.json$/.exec(parsed.pathname);
  if (parsed.origin !== 'https://github.com' || parsed.username || parsed.password || parsed.search || parsed.hash || !match) throw Error('Stable publication must match the configured GitHub app-stable channel');
  if (!/^[0-9a-f]{40}$/.test(source || '')) throw Error('Publication needs an exact source commit');
  const repo = match[1];
  const manifestFile = path.join(directory, MANIFEST_NAME);
  const manifestBytes = fs.readFileSync(manifestFile), offer = parseOffer(manifestBytes);
  const apkName = `alpha-phone-${offer.versionCode}.apk`;
  if (offer.apkUrl !== new URL(apkName, manifestUrl).href) throw Error('APK URL differs from the configured stable release');
  const apk = path.join(directory, apkName), artifact = updateArtifactDigest(apk);
  if (artifact.size !== offer.sizeBytes || artifact.sha256 !== offer.sha256) throw Error('Staged APK differs from its admitted manifest');
  const repository = JSON.parse(run(['repo','view',repo,'--json','isPrivate']));
  if (repository.isPrivate !== false) throw Error('Phones require an anonymously readable public update repository');
  const readManifest = () => read(manifestUrl, {maxBytes: 32768, missing: true});
  const previous = await readManifest();
  if (previous) {
    const current = parseOffer(previous.bytes);
    if (current.variant !== offer.variant || current.signerSha256 !== offer.signerSha256) throw Error('Refusing to replace another flavor or signing family');
    if (current.versionCode > offer.versionCode) throw Error('Refusing to roll back the published versionCode');
    if (current.versionCode === offer.versionCode && sha(previous.bytes) !== sha(manifestBytes)) throw Error('A published versionCode is immutable; allocate a higher version');
  }
  const releaseJson = run(['release','view','app-stable','--repo',repo,'--json','isDraft,assets'], {allowMissing: true});
  const release = releaseJson === null ? null : JSON.parse(releaseJson);
  if (release?.isDraft !== false && release !== null) throw Error('The stable update release must be public, not a draft');
  // A failed --clobber can leave no pointer. Retained immutable APKs still consume
  // their versions, so absence of a pointer must never reset the version floor.
  const retainedCodes = (release?.assets || []).map(asset => /^alpha-phone-([1-9][0-9]*)\.apk$/.exec(asset.name)?.[1])
    .filter(Boolean).map(Number);
  if (retainedCodes.some(code => !Number.isSafeInteger(code) || code > offer.versionCode)) throw Error('Candidate is below the retained stable APK version floor');
  if (!previous && release?.assets?.some(asset => asset.name === MANIFEST_NAME)) throw Error('Stable manifest exists but is not publicly readable; resolve visibility before publishing');
  if (release === null) run(['release','create','app-stable','--repo',repo,'--target',source,'--title','Alpha Phone app updates','--notes','Signed Alpha Phone application updates.','--latest=false']);
  // Never overwrite a versioned APK: even a failed delivery can be safely retried.
  if (!release?.assets?.some(asset => asset.name === apkName)) run(['release','upload','app-stable',apk,'--repo',repo]);
  const verifyApk = async () => {
    const remote = await read(offer.apkUrl, {maxBytes: offer.sizeBytes});
    if (!remote || remote.size !== offer.sizeBytes || remote.sha256 !== offer.sha256) throw Error('Anonymous APK readback differs from the admitted release');
  };
  // Eventual visibility may lag an upload. Never advance the pointer first.
  let verified = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {await verifyApk(); verified = true; break;}
    catch (failed) {if (attempt === 3) throw failed; await wait(1000 * (attempt + 1));}
  }
  if (!verified) throw Error('APK readback was not verified');
  const current = await readManifest();
  if ((current ? current.sha256 : null) !== (previous ? previous.sha256 : null)) throw Error('Stable channel changed during publication; retry against its current state');
  const manifestSha256 = sha(manifestBytes);
  if (!previous || previous.sha256 !== manifestSha256) run(['release','upload','app-stable',manifestFile,'--repo',repo,'--clobber']);
  // Release asset visibility can lag a successful upload. Poll the public
  // pointer for up to 92 seconds of backoff without replacing it again.
  let visible = false;
  for (const delay of [0, 2000, 5000, 10000, 15000, 30000, 30000]) {
    if (delay) await wait(delay);
    const published = await readManifest();
    if (published?.sha256 === manifestSha256) {visible = true; break;}
  }
  if (!visible) throw Error('Stable manifest readback failed; inspect the public pointer before retrying this same candidate');
  return {schema: 'alpha-app-update-delivery/v1', publisherCommit: source, sourceScope: 'publication-tooling-only', variant: offer.variant, versionCode: offer.versionCode,
    apkSha256: offer.sha256, manifestSha256, anonymousReadback: true};
}

export async function main(argv, {root = process.cwd(), log = console.log} = {}) {
  // Preparation remains a separate reviewable step; delivery copies its output
  // into a private snapshot so another preparation cannot race the uploads.
  let variant, apkManifest = 'artifacts/apk-manifest.json', notes;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i], value = argv[++i];
    if (!value || value.startsWith('--')) throw Error('Usage: node scripts/deliver-app-update.mjs --variant launcher|standalone [--apk-manifest FILE] [--notes TEXT]');
    if (flag === '--variant') variant = value;
    else if (flag === '--apk-manifest') apkManifest = value;
    else if (flag === '--notes') notes = value;
    else throw Error(`Unknown argument ${flag}`);
  }
  if (!['launcher','standalone'].includes(variant)) throw Error('--variant launcher|standalone is required');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-app-delivery-'));
  try {
    const args = ['--variant',variant,'--apk-manifest',apkManifest,'--out-dir',directory,...(notes === undefined ? [] : ['--notes',notes])];
    if (prepare(args, {root}) !== 0) throw Error('Release admission failed; nothing was uploaded');
    const {updateManifestUrl} = JSON.parse(fs.readFileSync(path.join(root,'app.config.json'),'utf8'));
    const source = execFileSync('git',['rev-parse','HEAD'],{cwd: root, encoding: 'utf8'}).trim();
    const receipt = await deliver({directory, manifestUrl: updateManifestUrl, source});
    const destination = path.join(root,'artifacts/app-update-delivery.json');
    fs.mkdirSync(path.dirname(destination),{recursive:true});
    fs.writeFileSync(destination,JSON.stringify(receipt,null,2)+'\n');
    log(`Published and anonymously verified ${variant} versionCode ${receipt.versionCode}. Receipt: ${destination}`);
    return 0;
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => {process.exitCode = code;}, failed => {console.error(failed.message); process.exitCode = 1;});
}
