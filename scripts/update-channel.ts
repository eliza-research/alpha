import {createHash} from 'node:crypto';
import type {ManifestNode} from './apk.ts';

export const UPDATE_CHANNEL_META='ai.alphacompute.alphaphone.UPDATE_CHANNEL';
export const UPDATE_DIGEST_META='ai.alphacompute.alphaphone.UPDATE_MANIFEST_SHA256';
export const APP_UPDATE_REPOSITORY = 'eliza-research/alpha';
export const APP_UPDATE_REPOSITORY_ID = 1396333361;
const APP_UPDATE_REPOSITORY_ALIASES = ['eliza-research/alphaphone', 'alphacompute/alpha', 'alphacompute/alphaphone'] as const;
export const APP_UPDATE_TAG = 'app-stable-alphacompute';
export const LEGACY_APP_UPDATE_TAG = 'app-stable';
export const APP_UPDATE_MANIFEST = 'alpha-update-stable.json';

export function appUpdateManifestUrl(tag: typeof APP_UPDATE_TAG | typeof LEGACY_APP_UPDATE_TAG = APP_UPDATE_TAG) {
 return `https://github.com/${APP_UPDATE_REPOSITORY}/releases/download/${tag}/${APP_UPDATE_MANIFEST}`;
}

/** Retained pointers may carry an earlier repository path. */
export function isPublishedUpdateApkUrl(url: string, tag: typeof APP_UPDATE_TAG | typeof LEGACY_APP_UPDATE_TAG, versionCode: number) {
  return [APP_UPDATE_REPOSITORY, ...APP_UPDATE_REPOSITORY_ALIASES].some(repository =>
    url === `https://github.com/${repository}/releases/download/${tag}/alpha-phone-${versionCode}.apk`);
}

const digest=(bytes: string | Buffer)=>createHash('sha256').update(bytes).digest('hex');
const refused=()=>new Error('Update channel input refused');

export interface UpdateChannel {
 kind: 'public';
 manifestUrlSha256: string;
}

/** The one update channel: the public manifest URL in app.config.json, recorded by digest. */
export function publicUpdateChannel(publicUrl: string): UpdateChannel {
 return {kind:'public',manifestUrlSha256:digest(publicUrl)};
}

export function validateUpdateChannel(value: unknown): UpdateChannel {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='kind,manifestUrlSha256')throw refused();
 const {kind,manifestUrlSha256}=value as Record<string, unknown>;
 if(kind!=='public'||typeof manifestUrlSha256!=='string'||!/^[a-f0-9]{64}$/.test(manifestUrlSha256))throw refused();
 return value as UpdateChannel;
}

/**
 * A legacy APK can lack both metadata fields. Partial or ambiguous metadata
 * never qualifies for that exception.
 */
export function apkUpdateChannelOrLegacy(tree: ManifestNode): UpdateChannel | null {
 const application=tree.children.find(node=>node.name==='manifest')?.children.find(node=>node.name==='application');
 if(!application)throw Error('APK application manifest is unavailable');
 const metadata=application.children.filter(node=>node.name==='meta-data'&&
  (node.attrs.name===UPDATE_CHANNEL_META||node.attrs.name===UPDATE_DIGEST_META));
 if(!metadata.length)return null;
 const field=(name: string)=>{
  const rows=metadata.filter(node=>node.attrs.name===name);
  if(rows.length!==1)throw Error('APK update channel metadata missing or duplicated');
  return rows[0].attrs.value;
 };
 const sha=field(UPDATE_DIGEST_META);
 if(typeof sha!=='string'||!sha.startsWith('sha256:'))throw refused();
 return validateUpdateChannel({kind:field(UPDATE_CHANNEL_META),manifestUrlSha256:sha.slice(7)});
}

/** Read the channel from compiled Android metadata, never from a renderer flag. */
export function apkUpdateChannel(tree: ManifestNode) {
 const channel=apkUpdateChannelOrLegacy(tree);
 if(!channel)throw Error('APK update channel metadata missing');
 return channel;
}

/** Refuse conflicting release evidence before any provisioning effect. */
export function recordedProvisioningUpdateChannel(...records: unknown[]): UpdateChannel | null {
 const channels=records.filter(record=>record!==undefined).map(validateUpdateChannel);
 const reviewed=channels[0]??null;
 for(const channel of channels)assertProvisioningUpdateChannel(channel,reviewed);
 return reviewed;
}

/** Require exact agreement between compiled and reviewed evidence, including legacy absence. */
export function assertProvisioningUpdateChannel(compiled: UpdateChannel | null, reviewed: UpdateChannel | null) {
 if(compiled?.kind!==reviewed?.kind||compiled?.manifestUrlSha256!==reviewed?.manifestUrlSha256)
  throw Error('APK update channel differs from the reviewed release');
}
