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
import {main as prepare, MANIFEST_NAME} from './publish-update-manifest.ts';
import {updateArtifactDigest} from './update-artifact.ts';
import {
  APP_UPDATE_REPOSITORY, APP_UPDATE_REPOSITORY_ID, APP_UPDATE_REPOSITORY_OWNER_ID, APP_UPDATE_TAG,
  LEGACY_APP_UPDATE_TAG, appUpdateManifestUrl, isPublishedUpdateApkUrl,
} from './update-channel.ts';

interface UpdateOffer {
  schema: 'alpha-update/v1';
  variant: 'launcher' | 'standalone';
  versionCode: number;
  signerSha256: string;
  sha256: string;
  sizeBytes: number;
  apkUrl: string;
}
interface PublicArtifact {
  size: number;
  sha256: string;
  bytes?: Buffer;
}
interface PublicReadOptions {
  maxBytes?: number;
  missing?: boolean;
  fetcher?: typeof fetch;
}
interface DeliveryInput { directory: string; manifestUrl: string; source: string }
interface DeliveryPorts {
  run?: (args: string[], options?: {allowMissing?: boolean}) => string | null;
  read?: (url: string, options: PublicReadOptions) => Promise<PublicArtifact | null>;
  wait?: (ms: number) => Promise<void>;
}
interface ReleaseRecord {isDraft?: boolean; assets?: {name: string}[]}

const sha = (bytes: NodeJS.ArrayBufferView) => createHash('sha256').update(bytes).digest('hex');
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Anonymous HTTPS only, bounded redirects/body/time, streamed APK digest. */
export async function publicObject(url: string, {maxBytes, missing = false, fetcher = fetch}: PublicReadOptions = {}): Promise<PublicArtifact | null> {
  if (typeof maxBytes !== 'number' || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2**31) throw Error('Public update download needs a positive bounded size');
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
      const hash = createHash('sha256'), chunks: Uint8Array[] = [];
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

function parseOffer(bytes: Buffer): UpdateOffer {
  const value: UpdateOffer = JSON.parse(bytes.toString('utf8'));
  if (value?.schema !== 'alpha-update/v1' || !['launcher','standalone'].includes(value.variant) ||
      !Number.isSafeInteger(value.versionCode) || value.versionCode < 1 || !/^[0-9a-f]{64}$/.test(value.signerSha256 || '') ||
      !/^[0-9a-f]{64}$/.test(value.sha256 || '') || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 1 || value.sizeBytes > 2**31) {
    throw Error('Publication requires a single complete alpha-update/v1 offer; an index needs its own reviewed transition');
  }
  return value;
}

function gh(args: string[], {allowMissing = false}: {allowMissing?: boolean} = {}): string | null {
  try {return execFileSync('gh', args, {encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 600_000, maxBuffer: 2**20}).trim();}
  catch (failed) {
    if (allowMissing && failed && typeof failed === 'object' && 'stderr' in failed && /release not found|HTTP 404/.test(String(failed.stderr))) return null;
    throw Error('GitHub update publication failed; inspect the release before retrying');
  }
}

function stableRelease(run: NonNullable<DeliveryPorts['run']>, tag: typeof APP_UPDATE_TAG | typeof LEGACY_APP_UPDATE_TAG) {
  const text = run(['release','view',tag,'--repo',APP_UPDATE_REPOSITORY,'--json','isDraft,assets'], {allowMissing: true});
  const release: ReleaseRecord | null = text === null ? null : JSON.parse(text);
  if (release !== null && release.isDraft !== false) throw Error('The stable update release must be public, not a draft');
  return release;
}

function retainedCodes(release: ReleaseRecord | null) {
  return (release?.assets || []).flatMap(asset => {
    const match = /^alpha-phone-([1-9][0-9]*)\.apk$/.exec(asset.name);
    return match ? [Number(match[1])] : [];
  });
}

async function checkLegacyFloor(
  run: NonNullable<DeliveryPorts['run']>,
  read: NonNullable<DeliveryPorts['read']>,
  versionCode: number,
) {
  const release = stableRelease(run, LEGACY_APP_UPDATE_TAG);
  const manifestUrl = appUpdateManifestUrl(LEGACY_APP_UPDATE_TAG);
  const manifest = await read(manifestUrl, {maxBytes: 32768, missing: true});
  const versions = retainedCodes(release);
  if (manifest) {
    if (!release || !manifest.bytes) throw Error('Legacy stable pointer lacks authoritative release bytes');
    const offer = parseOffer(manifest.bytes);
    if (!isPublishedUpdateApkUrl(offer.apkUrl, LEGACY_APP_UPDATE_TAG, offer.versionCode))
      throw Error('Legacy stable pointer names an APK outside its release');
    versions.push(offer.versionCode);
  } else if (release?.assets?.some(asset => asset.name === MANIFEST_NAME)) {
    throw Error('Legacy stable manifest exists but is not publicly readable');
  }
  if (versions.some(code => !Number.isSafeInteger(code) || code >= versionCode))
    throw Error('Candidate must exceed the retained legacy APK version floor');
}

function checkStableFloor(release: ReleaseRecord | null, versionCode: number) {
  // A failed --clobber can leave no pointer. Retained immutable APKs still consume
  // their versions, so absence of a pointer must never reset the version floor.
  if (retainedCodes(release).some(code => !Number.isSafeInteger(code) || code > versionCode))
    throw Error('Candidate is below the retained stable APK version floor');
}

/** All inputs have already passed prepare's release and actual-APK admission.
 * Injected ports let failure tests exercise the real publication ordering.
 */
export async function deliver({directory, manifestUrl, source}: DeliveryInput, {run = gh, read = publicObject, wait = sleep}: DeliveryPorts = {}) {
  if (manifestUrl !== appUpdateManifestUrl()) throw Error('Stable publication must match the configured GitHub Alpha Compute update channel');
  if (!/^[0-9a-f]{40}$/.test(source || '')) throw Error('Publication needs an exact source commit');
  const repo = APP_UPDATE_REPOSITORY;
  const manifestFile = path.join(directory, MANIFEST_NAME);
  const manifestBytes = fs.readFileSync(manifestFile), offer = parseOffer(manifestBytes);
  const apkName = `alpha-phone-${offer.versionCode}.apk`;
  if (offer.apkUrl !== new URL(apkName, manifestUrl).href) throw Error('APK URL differs from the configured stable release');
  const apk = path.join(directory, apkName), artifact = updateArtifactDigest(apk);
  if (artifact.size !== offer.sizeBytes || artifact.sha256 !== offer.sha256) throw Error('Staged APK differs from its admitted manifest');
  const repository: {id?: number; full_name?: string; owner?: {id?: number}; private?: boolean} | null =
    JSON.parse(run(['api',`repos/${repo}`]) ?? 'null');
  if (repository?.id !== APP_UPDATE_REPOSITORY_ID || repository.full_name !== repo ||
      repository.owner?.id !== APP_UPDATE_REPOSITORY_OWNER_ID || repository.private !== false)
    throw Error('Phones require the anonymously readable public Alpha update repository');
  await checkLegacyFloor(run, read, offer.versionCode);
  const readManifest = () => read(manifestUrl, {maxBytes: 32768, missing: true});
  const previous = await readManifest();
  if (previous) {
    if (!previous.bytes) throw Error('Stable manifest download has no bytes');
    const current = parseOffer(previous.bytes);
    if (current.variant !== offer.variant || current.signerSha256 !== offer.signerSha256) throw Error('Refusing to replace another flavor or signing family');
    if (current.versionCode > offer.versionCode) throw Error('Refusing to roll back the published versionCode');
    if (current.versionCode === offer.versionCode && sha(previous.bytes) !== sha(manifestBytes)) throw Error('A published versionCode is immutable; allocate a higher version');
  }
  const release = stableRelease(run, APP_UPDATE_TAG);
  checkStableFloor(release, offer.versionCode);
  if (!previous && release?.assets?.some(asset => asset.name === MANIFEST_NAME)) throw Error('Stable manifest exists but is not publicly readable; resolve visibility before publishing');
  if (release === null) run(['release','create',APP_UPDATE_TAG,'--repo',repo,'--target',source,'--title','Alpha Phone app updates','--notes','Signed Alpha Compute application updates.','--latest=false']);
  // Never overwrite a versioned APK: even a failed delivery can be safely retried.
  if (!release?.assets?.some(asset => asset.name === apkName)) run(['release','upload',APP_UPDATE_TAG,apk,'--repo',repo]);
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
  // A separate writer may add an APK while anonymous readback streams ours.
  await checkLegacyFloor(run, read, offer.versionCode);
  const finalRelease = stableRelease(run, APP_UPDATE_TAG);
  checkStableFloor(finalRelease, offer.versionCode);
  if (!finalRelease?.assets?.some(asset => asset.name === apkName))
    throw Error('Verified APK is missing from the final stable release inventory');
  const current = await readManifest();
  if (!current && finalRelease.assets?.some(asset => asset.name === MANIFEST_NAME))
    throw Error('Stable manifest exists but is not publicly readable; resolve visibility before publishing');
  if ((current ? current.sha256 : null) !== (previous ? previous.sha256 : null)) throw Error('Stable channel changed during publication; retry against its current state');
  if (!previous || previous.sha256 !== sha(manifestBytes)) run(['release','upload',APP_UPDATE_TAG,manifestFile,'--repo',repo,'--clobber']);
  let visible = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const published = await readManifest();
    if (published?.sha256 === sha(manifestBytes)) {visible = true; break;}
    if (attempt < 3) await wait(1000 * (attempt + 1));
  }
  if (!visible) throw Error('Stable manifest readback failed; retry this same candidate to repair publication');
  return {schema: 'alpha-app-update-delivery/v1', publisherCommit: source, sourceScope: 'publication-tooling-only', variant: offer.variant, versionCode: offer.versionCode,
    apkSha256: offer.sha256, manifestSha256: sha(manifestBytes), anonymousReadback: true};
}

export async function main(argv: string[], {root = process.cwd(), log = console.log} = {}) {
  // Preparation remains a separate reviewable step; delivery copies its output
  // into a private snapshot so another preparation cannot race the uploads.
  let variant: string | undefined, apkManifest = 'artifacts/apk-manifest.json', notes: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i], value = argv[++i];
    if (!value || value.startsWith('--')) throw Error('Usage: node scripts/deliver-app-update.ts --variant launcher|standalone [--apk-manifest FILE] [--notes TEXT]');
    if (flag === '--variant') variant = value;
    else if (flag === '--apk-manifest') apkManifest = value;
    else if (flag === '--notes') notes = value;
    else throw Error(`Unknown argument ${flag}`);
  }
  if (variant !== 'launcher' && variant !== 'standalone') throw Error('--variant launcher|standalone is required');
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
  main(process.argv.slice(2)).then(code => {process.exitCode = code;}, failed => {console.error(failed instanceof Error ? failed.message : String(failed)); process.exitCode = 1;});
}
