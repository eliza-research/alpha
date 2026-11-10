import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import type {ManifestNode} from './apk.ts';

export const UPDATE_CHANNEL_META='ai.alphacompute.alphaphone.UPDATE_CHANNEL';
export const UPDATE_DIGEST_META='ai.alphacompute.alphaphone.UPDATE_MANIFEST_SHA256';
const digest=(bytes: string | Buffer)=>createHash('sha256').update(bytes).digest('hex');
const refused=()=>new Error('Update channel input refused');

export interface UpdateChannel {
 kind: 'public' | 'private-qa';
 manifestUrlSha256: string;
}

/** Private capability bytes never enter the returned build record or diagnostics. */
export function readUpdateChannel(environment: NodeJS.ProcessEnv, publicUrl: string): UpdateChannel {
 const kind=environment.ALPHA_UPDATE_CHANNEL||'public';
 const file=environment.ALPHA_PRIVATE_UPDATE_MANIFEST_FILE;
 const expected=environment.ALPHA_PRIVATE_UPDATE_MANIFEST_SHA256;
 if(kind==='public'){
  if(file||expected)throw refused();
  return {kind,manifestUrlSha256:digest(publicUrl)};
 }
 if(kind!=='private-qa'||!file||!path.isAbsolute(file)||!expected||!/^[a-f0-9]{64}$/.test(expected))throw refused();
 let fd;
 try{
  if(typeof process.getuid!=='function'||fs.lstatSync(file).isSymbolicLink())throw refused();
  const checkout=fs.realpathSync(fileURLToPath(new URL('..',import.meta.url)));
  if(fs.realpathSync(file).startsWith(checkout+path.sep))throw refused();
  fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  const before=fs.fstatSync(fd);
  if(!before.isFile()||before.uid!==process.getuid()||(before.mode&0o7777)!==0o600||before.size<1||before.size>2048)throw refused();
  const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd),named=fs.lstatSync(file);
  if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||named.isSymbolicLink()||named.ino!==before.ino||named.dev!==before.dev||digest(bytes)!==expected)throw refused();
  const text=bytes.toString('ascii');
  if(bytes.some(byte=>byte<33||byte>126))throw refused();
  const url=new URL(text);
  if(url.href!==text||/["\\]/.test(text)||url.origin!=='https://storage.googleapis.com'||url.username||url.password||url.hash||!/^\/alpha-aosp-lab-20261024-private-apks\/update-qa\/[a-f0-9]{32}\/alpha-update\.json$/.test(url.pathname)||!url.search)throw refused();
  // gcloud emits lowercase signing fields; older admitted URLs use X-Goog-*.
  // Keep the signed bytes intact and reject aliases of the same parameter.
  const parameters=new Map<string, string>();
  for(const [name,value] of url.searchParams){const key=name.toLowerCase();if(parameters.has(key))throw refused();parameters.set(key,value);}
  const expires=parameters.get('x-goog-expires');
  if(parameters.get('x-goog-algorithm')!=='GOOG4-RSA-SHA256'||!/^\d+$/.test(expires||'')||Number(expires)<300||Number(expires)>86400)throw refused();
  return {kind,manifestUrlSha256:expected};
 }catch{throw refused();}finally{if(fd!==undefined)fs.closeSync(fd);}
}

export function validateUpdateChannel(value: unknown): UpdateChannel {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='kind,manifestUrlSha256')throw refused();
 const {kind,manifestUrlSha256}=value as Record<string, unknown>;
 if((kind!=='public'&&kind!=='private-qa')||typeof manifestUrlSha256!=='string'||!/^[a-f0-9]{64}$/.test(manifestUrlSha256))throw refused();
 return value as UpdateChannel;
}

/** Read the channel from compiled Android metadata, never from a renderer flag. */
export function apkUpdateChannel(tree: ManifestNode){
 const application=tree.children.find(node=>node.name==='manifest')?.children.find(node=>node.name==='application');
 const field=(name: string)=>{
  const rows=application?.children.filter(node=>node.name==='meta-data'&&node.attrs.name===name)||[];
  if(rows.length!==1)throw new Error('APK update channel metadata missing or duplicated');
  return rows[0].attrs.value;
 };
 const sha=field(UPDATE_DIGEST_META);
 if(typeof sha!=='string'||!sha.startsWith('sha256:'))throw refused();
 return validateUpdateChannel({kind:field(UPDATE_CHANNEL_META),manifestUrlSha256:sha.slice(7)});
}
