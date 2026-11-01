import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {upstreamNativeSource,sha} from './upstream-native-source.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const HEX=/^[a-f0-9]{64}$/;
const AUTH_ANDROID_MODULE='packages/auth/android';
const safe=name=>typeof name==='string'&&!name.startsWith('/')&&!name.split('/').some(x=>!x||x==='.'||x==='..')&&!name.includes('\\');
function inventory(root){const files={};function visit(dir){for(const row of fs.readdirSync(dir,{withFileTypes:true})){const name=path.join(dir,row.name);if(row.isSymbolicLink())throw Error('Symlink in patched source');if(row.isDirectory())visit(name);else if(row.isFile())files[path.relative(root,name)]=sha(fs.readFileSync(name));else throw Error('Nonregular patched source');}}visit(root);return files;}
function verifyModes(root,modes){for(const [name,mode] of Object.entries(modes))if((fs.statSync(path.join(root,name)).mode&0o111)!==(mode==='100755'?0o111:0))throw Error('Native staged source mode drift');}
function same(a,b){return JSON.stringify(Object.entries(a).sort())===JSON.stringify(Object.entries(b).sort());}
/** Verify every input and output byte; patches may modify declared existing Java/Kotlin files and the shared auth dependency descriptor. */
export function materializeNativePatches({source,manifest,patchRoot,temporary}){
 if(manifest.schema!==1||manifest.baseCommit!==source.pin||!Array.isArray(manifest.patches))throw Error('Native patch manifest pin/schema mismatch');
 // Modules with no remaining patch are still staged from the pin so Gradle compiles authenticated source.
 if(manifest.modules!==undefined&&(!Array.isArray(manifest.modules)||manifest.modules.some(m=>typeof m!=='string')))throw Error('Invalid native patch modules');
 const modules=[...new Set([...(manifest.modules||[]),...manifest.patches.map(p=>p.module)])].sort(),files=new Map(),expected={};
 for(const module of modules){if(module!==AUTH_ANDROID_MODULE&&!/^plugins\/plugin-native-[a-z-]+\/android$/.test(module))throw Error('Invalid native patch module');for(const [name,file] of source.read(module)){files.set(name,file);expected[name]=file.sha256;}}
 for(const [name,file] of files){const dest=path.join(temporary,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,file.bytes,{mode:parseInt(file.mode,8)});}
 const targets=new Set();
 for(const patch of manifest.patches){
  if(!safe(patch.file)||!HEX.test(patch.sha256)||!Array.isArray(patch.targets)||!patch.targets.length)throw Error('Invalid native patch descriptor');
  const filename=path.join(patchRoot,patch.file);if(!fs.lstatSync(filename).isFile()||fs.lstatSync(filename).isSymbolicLink())throw Error('Nonregular native patch');
  for(let current=filename;current!==patchRoot;current=path.dirname(current))if(fs.lstatSync(current).isSymbolicLink())throw Error('Symlink in native patch path');
  const bytes=fs.readFileSync(filename);if(sha(bytes)!==patch.sha256)throw Error('Native patch digest mismatch');
  for(const target of patch.targets){
   const sourceTarget=typeof target.path==='string'&&target.path.startsWith(patch.module+'/src/main/java/')&&/\.(?:java|kt)$/.test(target.path);
   const authDescriptor=patch.module===AUTH_ANDROID_MODULE&&target.path===AUTH_ANDROID_MODULE+'/build.gradle';
   if(!safe(target.path)||(!sourceTarget&&!authDescriptor)||targets.has(target.path)||!HEX.test(target.beforeSha256)||!HEX.test(target.afterSha256)||expected[target.path]!==target.beforeSha256)throw Error('Native patch target/source mismatch');targets.add(target.path);expected[target.path]=target.afterSha256;
  }
  const headers=bytes.toString('utf8').split('\n').filter(line=>line.startsWith('--- ')||line.startsWith('+++ '));
  const wanted=patch.targets.flatMap(target=>['--- a/'+target.path,'+++ b/'+target.path]);
  if(JSON.stringify(headers)!==JSON.stringify(wanted))throw Error('Native patch headers do not match declared targets');
  // No shell, fuzz or vendor writes. Full final inventory rejects extra files/backups/deletions.
  execFileSync('patch',['--batch','--fuzz=0','--forward','-p1','--input',filename],{cwd:temporary,stdio:'pipe',timeout:30000});
 }
 if(!same(inventory(temporary),expected))throw Error('Patched native output differs from reviewed manifest');
 const modes=Object.fromEntries([...files].map(([name,file])=>[name,file.mode]));
 verifyModes(temporary,modes);
 return {modules,files:expected,modes};
}
export function nativePatchReceipt(prepared){const {root,...receipt}=prepared;return receipt;}
export function verifyNativePatchReceipt(raw,prepared){let receipt;try{receipt=JSON.parse(raw);}catch{throw Error('Missing or invalid packaged native patch receipt');}if(JSON.stringify(receipt)!==JSON.stringify(nativePatchReceipt(prepared)))throw Error('Packaged native patch receipt mismatch');return receipt;}
export function preparePatchedNative({root=ROOT,manifestFile='native-manifest.json'}={}){
 root=path.resolve(root);
 if(manifestFile!=='native-manifest.json')throw Error('Unknown native patch slot');
 const source=upstreamNativeSource(root),patchRoot=path.join(root,'patches/eliza'),manifestBytes=fs.readFileSync(path.join(patchRoot,manifestFile)),manifest=JSON.parse(manifestBytes);
 const key=sha(Buffer.concat([manifestBytes,fs.readFileSync(fileURLToPath(import.meta.url))]));
 const parent=path.join(root,'.eliza/patched-native'),destination=path.join(parent,key);
 for(let current=parent;current!==root;current=path.dirname(current))if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('Symlink in native staging parent');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-native-patches-'));
 try{
  const verified=materializeNativePatches({source,manifest,patchRoot,temporary});
  const receipt={baseCommit:source.pin,manifestSha256:sha(manifestBytes),preparerSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),...verified};
  if(fs.existsSync(destination)){
   if(fs.lstatSync(destination).isSymbolicLink())throw Error('Symlink in staged native source');
   verifyModes(destination,verified.modes);
   const actual=inventory(destination);delete actual['.source.json'];
   if(!same(actual,verified.files)||!fs.readFileSync(path.join(destination,'.source.json')).equals(Buffer.from(JSON.stringify(receipt,null,2)+'\n')))throw Error('Staged patched native source drift');
  }else{
   fs.mkdirSync(parent,{recursive:true});const staged=fs.mkdtempSync(path.join(parent,'stage-'));
   try{fs.cpSync(temporary,staged,{recursive:true});fs.writeFileSync(path.join(staged,'.source.json'),JSON.stringify(receipt,null,2)+'\n');try{fs.renameSync(staged,destination);}catch(error){if(!['EEXIST','ENOTEMPTY'].includes(error.code))throw error;const actual=inventory(destination);delete actual['.source.json'];verifyModes(destination,verified.modes);if(!same(actual,verified.files)||fs.readFileSync(path.join(destination,'.source.json'),'utf8')!==JSON.stringify(receipt,null,2)+'\n')throw Error('Concurrent native staging differs');}}finally{fs.rmSync(staged,{recursive:true,force:true});}
  }
  return {root:destination,...receipt};
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(preparePatchedNative()));
