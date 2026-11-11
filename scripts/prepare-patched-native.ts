import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import type { UpstreamBlob } from "./upstream-native-source.ts";
import {upstreamNativeSource,sha} from './upstream-native-source.ts';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
export const NATIVE_SOURCE_MANIFEST='android/upstream-native-sources.json';
const AUTH_ANDROID_MODULE='packages/auth/android';
const BROWSER_ANDROID_RESOURCES='plugins/plugin-native-browser-surface/resources';
const SENSE_ANDROID_MODULE='packages/app/platforms/android/sense';
const SPEECH_ANDROID_MODULE='plugins/plugin-local-inference/native/android';
const SECURE_STORE_NATIVE_ONLY_MODULE='plugins/plugin-native-secure-store/android-nativeonly';
const SPEECH_JNI_SOURCE='packages/app/platforms/android/app/src/main/elizavoice-jni';
function inventory(root: string){const files: Record<string, string>={};function visit(dir: string){for(const row of fs.readdirSync(dir,{withFileTypes:true})){const name=path.join(dir,row.name);if(row.isSymbolicLink())throw Error('Symlink in patched source');if(row.isDirectory())visit(name);else if(row.isFile())files[path.relative(root,name)]=sha(fs.readFileSync(name));else throw Error('Nonregular patched source');}}visit(root);return files;}
function verifyModes(root: string,modes: Record<string, string>){for(const [name,mode] of Object.entries(modes))if(Boolean(fs.statSync(path.join(root,name)).mode&0o100)!==(mode==='100755'))throw Error('Native staged source mode drift');}
function same(a: Record<string, string>,b: Record<string, string>){return JSON.stringify(Object.entries(a).sort())===JSON.stringify(Object.entries(b).sort());}
/** Stage the configured modules from the pin and verify every staged byte and mode. */
type NativeSourceManifest = { schema: number; baseCommit: string; modules: string[] };
type Source = Pick<ReturnType<typeof upstreamNativeSource>, 'pin' | 'read'>;
export function materializeNativePatches({source,manifest,temporary}: {
 source: Source;
 manifest: NativeSourceManifest;
 temporary: string;
}){
 if(manifest.schema!==1||manifest.baseCommit!==source.pin)throw Error('Native patch manifest pin/schema mismatch');
 if(!Array.isArray(manifest.modules)||manifest.modules.some(m=>typeof m!=='string'))throw Error('Invalid native patch modules');
 const modules=[...new Set(manifest.modules)].sort(),files=new Map<string, UpstreamBlob>(),expected: Record<string, string>={};
 for(const module of modules){if(module!==AUTH_ANDROID_MODULE&&module!==BROWSER_ANDROID_RESOURCES&&module!==SPEECH_ANDROID_MODULE&&module!==SPEECH_JNI_SOURCE&&module!==SECURE_STORE_NATIVE_ONLY_MODULE&&module!==SENSE_ANDROID_MODULE&&!/^plugins\/plugin-native-[a-z-]+\/android$/.test(module))throw Error('Invalid native patch module');for(const [name,file] of source.read(module)){files.set(name,file);expected[name]=file.sha256;}}
 for(const [name,file] of files){const dest=path.join(temporary,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,file.bytes,{mode:parseInt(file.mode,8)});}
 if(!same(inventory(temporary),expected))throw Error('Patched native output differs from reviewed manifest');
 const modes=Object.fromEntries([...files].map(([name,file])=>[name,file.mode]));
 verifyModes(temporary,modes);
 return {modules,files:expected,modes};
}
export function nativePatchReceipt(prepared: ReturnType<typeof preparePatchedNative>){const {root,...receipt}=prepared;return receipt;}
export function verifyNativePatchReceipt(raw: string,prepared: ReturnType<typeof preparePatchedNative>){let receipt;try{receipt=JSON.parse(raw);}catch{throw Error('Missing or invalid packaged native patch receipt');}if(JSON.stringify(receipt)!==JSON.stringify(nativePatchReceipt(prepared)))throw Error('Packaged native patch receipt mismatch');return receipt;}
export function preparePatchedNative({root=ROOT,manifestFile='native-manifest.json'}={}){
 root=path.resolve(root);
 if(manifestFile!=='native-manifest.json')throw Error('Unknown native patch slot');
 const source=upstreamNativeSource(root),manifestBytes=fs.readFileSync(path.join(root,NATIVE_SOURCE_MANIFEST)),configuration: Omit<NativeSourceManifest, 'baseCommit'> & {patches: unknown[]}=JSON.parse(manifestBytes.toString('utf8'));
 if(configuration.schema!==1||!Array.isArray(configuration.modules)||!Array.isArray(configuration.patches)||configuration.patches.length!==0)throw Error('Expected pinned native source modules without product patches');
 const manifest={...configuration,baseCommit:source.pin};
 const key=sha(Buffer.concat([Buffer.from(source.pin),manifestBytes,fs.readFileSync(fileURLToPath(import.meta.url))]));
 const parent=path.join(root,'.eliza/patched-native'),destination=path.join(parent,key);
 for(let current=parent;current!==root;current=path.dirname(current))if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('Symlink in native staging parent');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-native-patches-'));
 try{
  const verified=materializeNativePatches({source,manifest,temporary});
  const receipt={baseCommit:source.pin,manifestSha256:sha(manifestBytes),preparerSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),...verified};
  if(fs.existsSync(destination)){
   if(fs.lstatSync(destination).isSymbolicLink())throw Error('Symlink in staged native source');
   verifyModes(destination,verified.modes);
   const actual=inventory(destination);delete actual['.source.json'];
   if(!same(actual,verified.files)||!fs.readFileSync(path.join(destination,'.source.json')).equals(Buffer.from(JSON.stringify(receipt,null,2)+'\n')))throw Error('Staged patched native source drift');
  }else{
   fs.mkdirSync(parent,{recursive:true});const staged=fs.mkdtempSync(path.join(parent,'stage-'));
   try{fs.cpSync(temporary,staged,{recursive:true});fs.writeFileSync(path.join(staged,'.source.json'),JSON.stringify(receipt,null,2)+'\n');try{fs.renameSync(staged,destination);}catch(error){if(!(error instanceof Error && 'code' in error && (error.code === 'EEXIST' || error.code === 'ENOTEMPTY')))throw error;const actual=inventory(destination);delete actual['.source.json'];verifyModes(destination,verified.modes);if(!same(actual,verified.files)||fs.readFileSync(path.join(destination,'.source.json'),'utf8')!==JSON.stringify(receipt,null,2)+'\n')throw Error('Concurrent native staging differs');}}finally{fs.rmSync(staged,{recursive:true,force:true});}
  }
  return {root:destination,...receipt};
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(preparePatchedNative()));
