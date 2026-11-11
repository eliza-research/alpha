/** Bind a release offer to the actual APK and its verified original signer.
 * Active release signing and installed signing-family selection are different
 * facts after rotation; neither is accepted from apk-manifest.json alone. */
import {execFileSync, type ExecFileSyncOptionsWithStringEncoding} from 'node:child_process';
import type {ReleaseSigner} from './build-android.ts';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {requireConsistentApk, PACKAGE} from './provision-unit.ts';
import {androidEnv, tool} from './toolchain.ts';
import {apkArchiveFacts} from '../vendor/eliza/packages/app/scripts/mobile/artifact-inspection/apk-distribution.mjs';
import {updateArtifactDigest} from './update-artifact.ts';
import {parseXmlTree} from './apk.ts';
import {apkUpdateChannel, type UpdateChannel} from './update-channel.ts';

const HEX = /^[0-9a-f]{64}$/;
const verifier = fileURLToPath(new URL('./owner/InspectUpdateApk.java', import.meta.url));
function requireValue(value: unknown, message: string): asserts value {
  if (!value) throw Error(`Update APK admission: ${message}`);
}
interface UpdateApk {
  file: string;
  sha256: string;
  build: 'debug' | 'release';
  variant: 'launcher' | 'standalone';
  versionCode: number;
  updateChannel: UpdateChannel | null;
}
interface Rotation {
  schema?: number;
  approval?: string;
  previousSignerSha256?: string;
  lineageSha256?: string | null;
  fromVersionCode: number;
  versionCode: number;
}
type UpdateSigner = Pick<ReleaseSigner, 'signerSha256'> & {apkSigningRotation?: Rotation};
interface UpdateSigning {
  verified?: boolean;
  activeSignerSha256: string;
  signerRootSha256: string;
  packageName: string;
  versionCode: number;
  targetSdkVersion?: number;
  lineageSize?: number;
  lineageSha256?: string | null;
}
interface ArchiveFacts {
  packageName?: string | null;
  home: boolean;
  launcher: boolean;
  xml: string;
}

/** Public distribution must inspect the compiled channel, not a release row's
 * claim. In particular a private QA APK must never become a public baseline. */
export function admitPublicUpdateChannel(xml: string, publicUrl: string) {
  requireValue(typeof publicUrl === 'string' && publicUrl.length > 0, 'the configured public manifest URL is required');
  const channel = apkUpdateChannel(parseXmlTree(xml));
  requireValue(channel.kind === 'public' && channel.manifestUrlSha256 ===
    createHash('sha256').update(publicUrl).digest('hex'),
    'compiled channel is not the configured public update channel');
  return channel;
}

/** Only policy over independently inspected facts; fixtures exercise refusals
 * without pretending their JSON is native signing evidence. */
export function admitUpdateApkIdentity(apk: Pick<UpdateApk, 'build' | 'variant' | 'versionCode'>, descriptor: UpdateSigner | undefined, archive: ArchiveFacts, signing: UpdateSigning) {
  requireValue(apk.build === 'release' && ['launcher','standalone'].includes(apk.variant), 'a release distribution is required');
  requireValue(descriptor && HEX.test(descriptor.signerSha256 ?? ''), 'an enrolled release signer is required');
  requireValue(signing?.verified === true && HEX.test(signing.activeSignerSha256 ?? '') && HEX.test(signing.signerRootSha256 ?? ''), 'verified signer and family are required');
  requireValue(signing.activeSignerSha256 === descriptor.signerSha256, 'active signer differs from the enrolled release signer');
  requireValue(signing.packageName === PACKAGE && archive?.packageName === PACKAGE, 'archive package differs from Alpha');
  requireValue(Number.isSafeInteger(apk.versionCode) && apk.versionCode > 0 && signing.versionCode === apk.versionCode, 'archive versionCode differs from its release row');
  const launcher = apk.variant === 'launcher';
  requireValue(archive.home === launcher && archive.launcher === true &&
    typeof archive.xml === 'string' && archive.xml.includes('android.permission.READ_CONTACTS') === launcher,
    'archive HOME or flavor marker differs from its release row');
  if (signing.signerRootSha256 !== signing.activeSignerSha256) {
    const rotation = descriptor.apkSigningRotation;
    requireValue(rotation?.schema === 1 && rotation.approval === 'approved' &&
      rotation.previousSignerSha256 === signing.signerRootSha256 && signing.lineageSize === 2 &&
      HEX.test(rotation.lineageSha256 ?? '') && rotation.lineageSha256 === signing.lineageSha256 &&
      Number.isSafeInteger(rotation.fromVersionCode) && rotation.fromVersionCode > 0 &&
      Number.isSafeInteger(rotation.versionCode) && rotation.versionCode > rotation.fromVersionCode &&
      apk.versionCode >= rotation.versionCode,
      'embedded rotation has no exact approved signing-family record');
  }
  return {signerRootSha256: signing.signerRootSha256};
}

export function verifiedUpdateSigning(apk: Pick<UpdateApk, 'file' | 'sha256'>): UpdateSigning {
  const env = androidEnv();
  const jar = path.join(path.dirname(tool('apksigner')), 'lib/apksigner.jar');
  const result = execFileSync(path.join(env.JAVA_HOME, 'bin/java'),
    ['-cp',jar,verifier,apk.file,apk.sha256,PACKAGE],
    {env,encoding:'utf8',timeout:120_000,maxBuffer:1 << 20,stdio:['ignore','pipe','pipe']});
  return JSON.parse(result);
}

function updateArchive(file: string) {
  const options: ExecFileSyncOptionsWithStringEncoding={env:androidEnv(),encoding:'utf8',timeout:120_000,maxBuffer:16 << 20,stdio:['ignore','pipe','pipe']};
  const badging=execFileSync(tool('aapt'),['dump','badging',file],options);
  const xml=execFileSync(tool('aapt'),['dump','xmltree',file,'AndroidManifest.xml'],options);
  return {...apkArchiveFacts({badging,xml,names:[]}),xml};
}

/** Production default: inspect exact admitted bytes, then return the original
 * family used by Android SigningInfo.getSigningCertificateHistory()[0]. */
export function inspectUpdateApk(apk: UpdateApk, {descriptor}: {descriptor?: ReleaseSigner & {apkSigningRotation?: Rotation}} = {}) {
  const before = fs.lstatSync(apk.file);
  requireValue(before.isFile() && before.size > 0 && before.size <= 2**31, 'APK must be a bounded regular file');
  requireConsistentApk(apk, {descriptor});
  const archive = updateArchive(apk.file), signing = verifiedUpdateSigning(apk);
  const {updateManifestUrl} = JSON.parse(fs.readFileSync(new URL('../app.config.json', import.meta.url),'utf8'));
  admitPublicUpdateChannel(archive.xml, updateManifestUrl);
  requireValue(updateArtifactDigest(apk.file).sha256 === apk.sha256, 'APK bytes changed during admission');
  return admitUpdateApkIdentity(apk, descriptor, archive, signing);
}
