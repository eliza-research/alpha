/** Portable native producer identity and local build evidence. No device qualification is inferred. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {embeddingProducerInputPaths,nativeInputPaths,nativeJavaPath,nativeBinding,nativeInputs,nativeGenerated,verifyNativeSymbols} from './embedding-native-contract.ts';

export const NATIVE_BUILD_RECEIPT = '.eliza/native-inputs/receipt.json';
export const NATIVE_BUILD_REQUIREMENTS = 'android/embedding-host/native-requirements.txt';
export const NATIVE_PYTHON = '3.12.11';
export interface NativeFile {path:string; bytes:number; sha256:string}
export interface NativeBuildReceipt {
  schema:'alpha-native-build/v1'; recipeSha256:string; recipe:ReturnType<typeof nativeRecipe>;
  consumerSdkCommit:string;
  producer:{sdkCommit:string; platform:string; arch:string; ndk:string; cmake:string; python:string};
  files:NativeFile[];
  voice:Record<string,any>;
  embedding:Record<string,any>;
  qualification:{deviceExecuted:false; userAccepted:false};
}
export const bytesDigest = (bytes:Buffer|string) => createHash('sha256').update(bytes).digest('hex');
export function fileDigest(file:string) {
  const hash=createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.alloc(4*1024*1024);
  try {let count;while((count=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,count));}
  finally {fs.closeSync(fd);}
  return hash.digest('hex');
}
const json=(root:string,file:string)=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
export function nativeRecipe(root:string) {
  const vendor=path.join(root,'vendor/eliza'),pin=json(root,'upstream.lock.json').commit;
  const git=(...args:string[])=>execFileSync('git',['-C',vendor,...args],{encoding:'utf8',maxBuffer:16*1024*1024}).trim();
  if(!/^[a-f0-9]{40}$/.test(pin)||git('rev-parse','HEAD')!==pin)throw Error('Native producer requires the locked SDK checkout');
  // Trees include the complete upstream producer module closure, model recipes and Java/JNI inputs.
  const sources=[...new Set([...embeddingProducerInputPaths,...nativeInputPaths,nativeJavaPath,'packages/app/scripts','bun.lock','packages/app/scripts/paradee-voice/build-native.ts','packages/app/scripts/voice/build-phonon2-gguf.ts','plugins/plugin-local-inference/native/android','plugins/plugin-native-inference/src/model-catalog','plugins/plugin-native-inference/src/model-catalog/voice-model-versions.json'])].sort();
  const ids=git('rev-parse',...sources.map(name=>`${pin}:${name}`)).split('\n');
  const sourceTrees=Object.fromEntries(sources.map((name,index)=>[name,ids[index]]));
  git('diff','--quiet','HEAD','--',...sources,'plugins/plugin-local-inference/native/llama.cpp');
  const engineCommit=git('rev-parse',`${pin}:plugins/plugin-local-inference/native/llama.cpp`);
  const inputFiles=['android/embedding-host/build-toolchain.json',NATIVE_BUILD_REQUIREMENTS,'android/embedding-host/bootstrap-requirements.txt','android/paradee-voice/asr-inputs.json','scripts/build-embedding-host.ts','scripts/prepare-embedding-host.ts','scripts/embedding-native-contract.ts','scripts/embedding-build-remap.ts','scripts/native-build-inputs.ts','scripts/android-stage-voice-models.ts','scripts/local-agent-source.ts'];
  const productInputs=Object.fromEntries(inputFiles.map(name=>[name,fileDigest(path.join(root,name))]));
  const voice=json(root,'android/voice-host/qualified-voice-host.json');
  return {schema:'alpha-native-recipe/v1',identity:json(root,'app.config.json').appId,engineCommit,sourceTrees,productInputs,models:voice.models,asrSlot:voice.asrSlot,toolchain:json(root,'android/embedding-host/build-toolchain.json'),python:NATIVE_PYTHON};
}
export const nativeRecipeDigest=(recipe:ReturnType<typeof nativeRecipe>)=>bytesDigest(JSON.stringify(recipe));
export function nativeCacheRoot() {return path.join(process.env.XDG_CACHE_HOME||path.join(os.homedir(),'.cache'),'alpha','native-inputs');}
export function nativeCacheDirectory(root:string) {return path.join(nativeCacheRoot(),nativeRecipeDigest(nativeRecipe(root)),`${process.platform}-${process.arch}`);}
export function assertNativeOutputPath(root:string,relative:string) {
  let cursor=root;
  if(fs.existsSync(cursor)&&(!fs.lstatSync(cursor).isDirectory()||fs.lstatSync(cursor).isSymbolicLink()))throw Error('Native output root must be a real directory');
  for(const part of relative.split('/')){
    if(!part||part==='.'||part==='..')throw Error('Invalid native output path');
    cursor=path.join(cursor,part);
    if(fs.lstatSync(cursor,{throwIfNoEntry:false})?.isSymbolicLink())throw Error('Native output traverses a symbolic link');
  }
}

export function readNativeBuildReceipt(root:string):NativeBuildReceipt|null {
  const file=path.join(root,NATIVE_BUILD_RECEIPT);
  assertNativeOutputPath(root,NATIVE_BUILD_RECEIPT);
  if(!fs.existsSync(file))return null;
  if(fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).size>2*1024*1024)throw Error('Invalid native producer receipt');
  const receipt:NativeBuildReceipt=JSON.parse(fs.readFileSync(file,'utf8'));
  return validateNativeBuildReceipt(root,receipt);
}
export function validateNativeBuildReceipt(root:string,receipt:NativeBuildReceipt,{currentConsumer=true}={}) {
  const recipe=nativeRecipe(root),pin=json(root,'upstream.lock.json').commit;
  if(receipt.schema!=='alpha-native-build/v1'||receipt.recipeSha256!==nativeRecipeDigest(recipe)||JSON.stringify(receipt.recipe)!==JSON.stringify(recipe))throw Error('Native producer receipt is stale; run the normal Android build to regenerate it');
  if(receipt.qualification?.deviceExecuted!==false||receipt.qualification?.userAccepted!==false||receipt.voice?.qualified!==false)throw Error('Native build evidence cannot assert device qualification');
  if(receipt.voice?.identity!==recipe.identity||receipt.embedding?.identity!==recipe.identity||receipt.voice?.forkPin!==recipe.engineCommit||receipt.embedding?.forkPin!==recipe.engineCommit)throw Error('Native producer receipt identity differs');
  if(JSON.stringify(receipt.voice.models)!==JSON.stringify(recipe.models)||JSON.stringify(receipt.voice.asrSlot)!==JSON.stringify(recipe.asrSlot))throw Error('Native producer changed a pinned voice model');
  const producer=receipt.producer;
  if(!producer||!['darwin','linux'].includes(producer.platform)||!['arm64','x64'].includes(producer.arch)||producer.ndk!==recipe.toolchain.ndk||producer.cmake!==recipe.toolchain.cmake||producer.python!==recipe.python||!/^[a-f0-9]{40}$/.test(producer.sdkCommit))throw Error('Native producer toolchain changed');
  if(!/^[a-f0-9]{40}$/.test(receipt.consumerSdkCommit)||currentConsumer&&receipt.consumerSdkCommit!==pin||receipt.voice.pin!==producer.sdkCommit||receipt.embedding.pin!==producer.sdkCommit)throw Error('Native producer or consumer source binding differs');
  const vendor=path.join(root,'vendor/eliza');
  const source=(file:string)=>{const input=path.join(vendor,file);if(fs.lstatSync(input).isSymbolicLink())throw Error('Native source input is a link');return fs.readFileSync(input);};
  const oldIds=execFileSync('git',['-C',vendor,'rev-parse',...Object.keys(recipe.sourceTrees).map(name=>`${producer.sdkCommit}:${name}`)],{encoding:'utf8'}).trim().split('\n');
  if(Object.values(recipe.sourceTrees).some((id,index)=>id!==oldIds[index]))throw Error('Cached native producer has different source inputs');
  const binding=nativeBinding(source(nativeInputPaths.at(-1)!).toString(),source(nativeInputPaths.at(-2)!).toString(),recipe.identity);
  const inputs=nativeInputs(binding).map(name=>({path:name,sourceSha256:bytesDigest(source(name)),generatedSha256:bytesDigest(nativeGenerated(name,source(name).toString(),recipe.identity,binding))}));
  const producers=embeddingProducerInputPaths.map(name=>({path:name,sha256:bytesDigest(source(name))}));
  if(JSON.stringify(receipt.embedding.inputs)!==JSON.stringify(inputs)||JSON.stringify(receipt.embedding.producerInputs)!==JSON.stringify(producers)||JSON.stringify(receipt.embedding.jniBinding)!==JSON.stringify(binding))throw Error('Native JNI producer inputs changed');
  if(receipt.embedding.abi!=='arm64-v8a'||receipt.embedding.jniIdentityRelocated!==true)throw Error('Native JNI ABI or relocation changed');
  if(JSON.stringify(receipt.embedding.model)!==JSON.stringify(json(root,'android/embedding-host/qualified-host.json').model))throw Error('Native embedding model admission changed');
  const abis=receipt.voice.abis,libraries=receipt.embedding.libraries;
  if(!Array.isArray(abis)||abis.map((row:any)=>row.abi).join()!=='arm64-v8a,x86_64'||!Array.isArray(libraries)||libraries.map((row:any)=>row.name).sort().join()!=='libc++_shared.so,libelizainference.so,libelizavoicejni.so')throw Error('Native library inventory changed');
  for(const abi of abis)if(abi.alignment16KiB!==true||abi.abiVersion<17||abi.libraries.map((row:any)=>row.name).join()!=='libelizainference.so,libc++_shared.so')throw Error('Native voice ABI changed');
  for(const library of libraries)if(library.alignment16KiB!==true)throw Error('Native JNI alignment changed');
  for(const library of abis[0].libraries) {const same=libraries.find((row:any)=>row.name===library.name);if(same?.bytes!==library.bytes||same?.sha256!==library.sha256)throw Error('Voice and embedding engines differ');}
  if(!Array.isArray(receipt.files)||!receipt.files.length||new Set(receipt.files.map(row=>row.path)).size!==receipt.files.length)throw Error('Native producer inventory is incomplete');
  for(const row of receipt.files)if(typeof row.path!=='string'||path.isAbsolute(row.path)||row.path.split(/[\\/]/).some(part=>!part||part==='.'||part==='..')||!/^[a-f0-9]{64}$/.test(row.sha256)||!Number.isSafeInteger(row.bytes)||row.bytes<=0)throw Error('Invalid native producer output');
  const expected=nativeOutputInventory(receipt);
  if(receipt.files.length!==expected.size||receipt.files.some(row=>!expected.has(row.path)))throw Error('Native output inventory is incomplete or contains extra files');
  for(const row of receipt.files){const pin=expected.get(row.path);if(pin&&(row.sha256!==pin.sha256||row.bytes!==pin.bytes))throw Error('Native output differs from its model or library record');}
  return receipt;
}
export function nativeOutputInventory(receipt:NativeBuildReceipt) {
  const native='.eliza/paradee-voice/native',expected=new Map<string,{sha256:string;bytes:number}|null>();
  for(const model of receipt.voice.models)expected.set(`${native}/assets/paradee-voice/v1/${model.path}`,model);
  expected.set(`${native}/assets/paradee-voice/v1/manifest.json`,null);expected.set(`${native}/build-record.json`,null);
  for(const abi of receipt.voice.abis)for(const library of abi.libraries){expected.set(`android/app/src/main/jniLibs/${abi.abi}/${library.name}`,library);if(library.name==='libelizainference.so')expected.set(`${native}/jniLibs/${abi.abi}/${library.name}`,library);}
  expected.set('android/app/src/main/jniLibs/arm64-v8a/libelizavoicejni.so',receipt.embedding.libraries.find((row:any)=>row.name==='libelizavoicejni.so'));
  return expected;
}
export function verifyNativeBuildFiles(root:string,receipt=readNativeBuildReceipt(root)) {
  if(!receipt)throw Error('Native producer receipt is missing');
  verifyNativeFileBytes(root,receipt.files);
  const native=path.join(root,'.eliza/paradee-voice/native'),manifest=json(native,'assets/paradee-voice/v1/manifest.json'),build=json(native,'build-record.json');
  const models=receipt.voice.models.map(({path,bytes,sha256}:NativeFile)=>({path,bytes,sha256})).sort((a:NativeFile,b:NativeFile)=>a.path.localeCompare(b.path));
  if(manifest.format!=='eliza-paradee-voice-v2'||JSON.stringify(manifest.files)!==JSON.stringify(models)||build.sourceCommit!==receipt.consumerSdkCommit||build.nativeCommit!==receipt.recipe.engineCommit)throw Error('Native voice metadata differs from the producer receipt');
  const recorded=new Map(build.files.map((row:NativeFile)=>[row.path,row]));
  const voiceFiles=receipt.files.filter(row=>row.path.startsWith('.eliza/paradee-voice/native/')&&!row.path.endsWith('/build-record.json'));
  if(recorded.size!==voiceFiles.length||voiceFiles.some(row=>{const same:any=recorded.get(row.path.slice('.eliza/paradee-voice/native/'.length));return same?.bytes!==row.bytes||same?.sha256!==row.sha256;}))throw Error('Native voice build record inventory differs');
  return receipt;
}
export function verifyNativeFileBytes(root:string,files:NativeFile[]) {
  if(!fs.lstatSync(root).isDirectory()||fs.lstatSync(root).isSymbolicLink())throw Error('Native output root must be a real directory');
  for(const row of files) {
    if(path.isAbsolute(row.path)||row.path.split(/[\\/]/).some(part=>!part||part==='.'||part==='..'))throw Error('Invalid native output path');
    let cursor=root;
    for(const part of row.path.split('/')){cursor=path.join(cursor,part);if(fs.lstatSync(cursor).isSymbolicLink())throw Error('Native output traverses a symbolic link');}
    if(!fs.statSync(cursor).isFile()||fs.statSync(cursor).size!==row.bytes||fileDigest(cursor)!==row.sha256)throw Error(`Native output changed: ${row.path}`);
  }
}
/** Inspect executable structure separately from frozen-byte custody checks. */
export function verifyNativeBuildLibraries(root:string,receipt:NativeBuildReceipt) {
  const {assertAndroidVoiceLibrary,minElfLoadAlignment}=createRequire(import.meta.url)('../vendor/eliza/packages/app/scripts/build-helpers/verify-fused-symbols.ts');
  const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT||path.join(os.homedir(),'Library/Android/sdk');
  const prebuilt=path.join(sdk,'ndk',receipt.producer.ndk,'toolchains/llvm/prebuilt');
  const host=fs.readdirSync(prebuilt).find(name=>fs.existsSync(path.join(prebuilt,name,'bin/llvm-nm')));
  if(!host)throw Error('Pinned Android NDK inspection tools are required');
  const tool=(name:string)=>path.join(prebuilt,host,'bin',name);
  for(const abi of receipt.voice.abis)for(const library of abi.libraries) {
    const file=path.join(root,'android/app/src/main/jniLibs',abi.abi,library.name),bytes=fs.readFileSync(file);
    if(bytes.length<64||bytes.readUInt32BE(0)!==0x7f454c46||bytes[4]!==2||bytes[5]!==1||bytes.readUInt16LE(18)!==(abi.abi==='arm64-v8a'?183:62)||minElfLoadAlignment(bytes)<16384)throw Error('Native library ABI or page alignment differs');
    if(library.name==='libelizainference.so') {
      const actual=assertAndroidVoiceLibrary({lib:file,objdump:tool('llvm-objdump'),nm:tool('llvm-nm')});
      if(actual.abiVersion!==abi.abiVersion)throw Error('Native voice ABI receipt differs');
    }
  }
  const jni=path.join(root,'android/app/src/main/jniLibs/arm64-v8a/libelizavoicejni.so');
  verifyNativeSymbols(execFileSync(tool('llvm-nm'),['-D','--defined-only',jni],{encoding:'utf8'}),receipt.embedding.jniBinding);
  return receipt;
}
export function writeNativeBuildReceipt(root:string,receipt:NativeBuildReceipt) {
  assertNativeOutputPath(root,NATIVE_BUILD_RECEIPT);
  const target=path.join(root,NATIVE_BUILD_RECEIPT);fs.mkdirSync(path.dirname(target),{recursive:true});
  if(fs.lstatSync(path.dirname(target)).isSymbolicLink())throw Error('Native receipt parent is a link');
  const temporary=`${target}.${randomUUID()}.partial`;
  try{fs.writeFileSync(temporary,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});fs.renameSync(temporary,target);}
  finally{fs.rmSync(temporary,{force:true});}
}
export async function withNativeCacheLock<T>(cache:string,build:(assertHeld:()=>void)=>Promise<T>) {
  const absolute=path.resolve(cache),base=path.parse(absolute).root;
  assertNativeOutputPath(base,path.relative(base,absolute).split(path.sep).join('/'));
  const lock=path.join(cache,'build.lock');
  fs.mkdirSync(cache,{recursive:true});
  // Kernel advisory locks survive neither process death nor cache relocation.
  // Never unlink the inode: another waiting process may already have it open.
  const holder=spawn('python3',['-c','import fcntl,os,sys\nf=os.fdopen(os.open(sys.argv[1],os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600),"a+")\nfcntl.flock(f,fcntl.LOCK_EX)\nprint("locked",flush=True)\nsys.stdin.read()\n',lock],{stdio:['pipe','pipe','pipe']});
  await new Promise<void>((resolve,reject)=>{
    holder.once('error',reject);
    holder.once('exit',code=>reject(Error(`Native cache lock failed (${code})`)));
    holder.stdout.once('data',chunk=>String(chunk).trim()==='locked'?resolve():reject(Error('Invalid native lock response')));
  });
  const assertHeld=()=>{if(holder.exitCode!==null||holder.signalCode!==null)throw Error('Native cache lock owner exited');};
  try{assertHeld();return await build(assertHeld);}
  finally{if(holder.exitCode===null&&holder.signalCode===null)await new Promise<void>(resolve=>{holder.once('exit',()=>resolve());holder.stdin.end();});}
}
