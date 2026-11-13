#!/usr/bin/env bun
/**
 * Automatically build, cache and stage voice and embedding inputs from pinned source.
 * Generated receipts preserve output hashes and the original producer identity.
 */
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import type {EmbeddingManifest} from "./stage-embedding-host.ts";
import {nativeCacheRoot,nativeCacheDirectory,nativeRecipe,nativeRecipeDigest,NATIVE_BUILD_RECEIPT,NATIVE_BUILD_REQUIREMENTS,NATIVE_PYTHON,fileDigest,verifyNativeBuildFiles,verifyNativeBuildLibraries,validateNativeBuildReceipt,nativeOutputInventory,writeNativeBuildReceipt,assertNativeOutputPath,withNativeCacheLock,type NativeBuildReceipt} from './native-build-inputs.ts';
import {stageVoiceModels} from './android-stage-voice-models.ts';
import {voiceHostProblems} from './voice-host.ts';

export const QUALIFIED_HOST = 'android/embedding-host/qualified-host.json';
export const BUILD_TOOLCHAIN = 'android/embedding-host/build-toolchain.json';
export const WORKSPACE = '.eliza/embedding-host';

type LibraryManifest = Pick<EmbeddingManifest, 'abi' | 'libraries'>;
type Toolchain = {ndk:string;cmake:string;engineRepository:string;remapBuildPath:boolean};
const readJson = <T>(file:string):T => JSON.parse(fs.readFileSync(file,'utf8'));

/** Report staged library integrity; the generated producer receipt supplies current output hashes. */
export function stagedLibraries(root:string,manifest:LibraryManifest=readJson(path.join(root,QUALIFIED_HOST))) {
  return manifest.libraries.map(row=>{
    const file=path.join(root,'android/app/src/main/jniLibs',manifest.abi,row.name);
    const state=!fs.existsSync(file)?'missing':!fs.lstatSync(file).isSymbolicLink()&&fs.statSync(file).size===row.bytes&&fileDigest(file)===row.sha256?'staged':'different';
    return {name:row.name,state,file};
  });
}
export function embeddingHostState(_manifest:LibraryManifest,_toolchain:Toolchain,staged:ReturnType<typeof stagedLibraries>) {
  return {ready:staged.every(row=>row.state==='staged'),suppliedBy:'script' as const,reason:null};
}
export class Stop extends Error {constructor(readonly code:number,message:string){super(message);}}
function resolveSdk() {
  const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT||[path.join(process.env.HOME||'','Library/Android/sdk'),path.join(process.env.HOME||'','Android/Sdk')].find(value=>fs.existsSync(path.join(value,'ndk')));
  if(!sdk||!fs.existsSync(sdk))throw new Stop(2,'Set ANDROID_HOME to an Android SDK. Native setup installs its pinned NDK automatically.');
  return sdk;
}
function ndkTools(ndk:string) {
  const prebuilt=path.join(ndk,'toolchains/llvm/prebuilt'),host=fs.readdirSync(prebuilt).find(name=>fs.existsSync(path.join(prebuilt,name,'bin/llvm-strip')));
  if(!host)throw new Stop(2,'Pinned NDK host tools are missing');
  return path.join(prebuilt,host);
}

/** The normal build acquires public source/model inputs and caches its own exact output receipts. */
export async function preparePortableNativeInputs(root:string) {
  const recipe=nativeRecipe(root),cache=nativeCacheDirectory(root),cacheRoot=nativeCacheRoot();
  const pin=readJson<{commit:string}>(path.join(root,'upstream.lock.json')).commit;
  const command=(file:string,args:string[],cwd=root,env:NodeJS.ProcessEnv=process.env)=>execFileSync(file,args,{cwd,env,stdio:'inherit'});
  const productReceipt=path.join(root,NATIVE_BUILD_RECEIPT);
  if(fs.existsSync(productReceipt)) {
    try {const receipt=verifyNativeBuildFiles(root);verifyNativeBuildLibraries(root,receipt);console.log('Verified cached native inputs for the current source recipe.');return;}
    catch { /* Owned generated output is refreshed below; tracked records and vendor remain untouched. */ }
  }
  assertNativeOutputPath(cacheRoot,path.relative(cacheRoot,cache).split(path.sep).join('/'));
  fs.mkdirSync(cache,{recursive:true});
  await withNativeCacheLock(cache,async()=>{
  const sdk=resolveSdk(),toolchain=recipe.toolchain as Toolchain,ndk=path.join(sdk,'ndk',toolchain.ndk);
  if(!fs.existsSync(path.join(ndk,'source.properties')))command('sdkmanager',[`ndk;${toolchain.ndk}`]);
  const enginePath='plugins/plugin-local-inference/native/llama.cpp';
  command('git',['submodule','update','--init','--depth','1',enginePath],path.join(root,'vendor/eliza'));
  // Source-only SDK changes reuse the same compiled native inputs without changing their producer receipt.
  const source=path.join(cacheRoot,`source-${nativeRecipeDigest(recipe).slice(0,20)}`);
  if(!fs.existsSync(path.join(source,'.git')))command('git',['clone','--no-hardlinks','--dissociate','--no-checkout',path.join(root,'vendor/eliza'),source]);
  if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:source,encoding:'utf8'}).trim())throw Error('Cached native producer source has tracked modifications');
  const alternates=path.join(source,'.git/objects/info/alternates');
  if(fs.existsSync(alternates)){command('git',['repack','-a','-d'],source);fs.rmSync(alternates);}
  command('git',['checkout','--detach',pin],source);
  command('git',['submodule','update','--init','--recursive','--reference',path.join(root,'vendor/eliza',enginePath),enginePath],source);
  if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:source,encoding:'utf8'}).trim())throw Error('Cached native producer source has tracked modifications');
  const fork=path.join(source,'plugins/plugin-local-inference/native/llama.cpp');
  const engineAlternates=execFileSync('git',['-C',fork,'rev-parse','--path-format=absolute','--git-path','objects/info/alternates'],{encoding:'utf8'}).trim();
  if(fs.existsSync(engineAlternates)){command('git',['repack','-a','-d'],fork);fs.rmSync(engineAlternates);}

  // Python and build tools live in this cache, never in a user/global environment.
  let uv='uv';
  if(spawnSync(uv,['--version'],{stdio:'ignore'}).status!==0) {
    const bootstrap=path.join(cacheRoot,'bootstrap');
    command('python3',['-m','pip','install','--require-hashes','--no-deps','--target',bootstrap,'-r',path.join(root,'android/embedding-host/bootstrap-requirements.txt')]);
    uv=path.join(bootstrap,'bin','uv');
  }
  command(uv,['python','install',NATIVE_PYTHON]);
  const venv=path.join(cache,'python'),python=path.join(venv,'bin','python');
  if(!fs.existsSync(python))command(uv,['venv','--python',NATIVE_PYTHON,venv]);
  const requirements=path.join(root,NATIVE_BUILD_REQUIREMENTS),requirementsStamp=path.join(venv,'requirements.sha256');
  if(!fs.existsSync(requirementsStamp)||fs.readFileSync(requirementsStamp,'utf8')!==fileDigest(requirements)) {
    command(uv,['pip','install','--python',python,'--require-hashes','--extra-index-url','https://download.pytorch.org/whl/cpu','--index-strategy','unsafe-best-match','-r',requirements]);
    fs.writeFileSync(requirementsStamp,fileDigest(requirements));
  }
  if([source,cache,sdk].some(file=>/[\s=\0]/.test(file)))throw Error('Native compiler path remapping requires build/cache/SDK paths without whitespace');
  const remap=['#',`+-ffile-prefix-map=${source}=/alpha-native-source`,`+-ffile-prefix-map=${cache}=/alpha-native-build`,`+-ffile-prefix-map=${cacheRoot}=/alpha-native-cache`,`+-ffile-prefix-map=${sdk}=/android-sdk`].join(' ');
  const {preparedSourceEnv}=await import('./local-agent-source.ts');
  const nativeEnv=preparedSourceEnv(process.env);
  const env:NodeJS.ProcessEnv={...nativeEnv,PATH:`${path.join(venv,'bin')}${path.delimiter}${nativeEnv.PATH}`,ANDROID_HOME:sdk,ANDROID_SDK_ROOT:sdk,ELIZA_NDK_VERSION:toolchain.ndk,CMAKE_BUILD_PARALLEL_LEVEL:'2',PYTHONPATH:path.join(fork,'gguf-py'),CCC_OVERRIDE_OPTIONS:remap};
  const voiceOutput=path.join(cache,'voice'),cacheOutput=path.join(cache,'output'),builtReceipt=path.join(cacheOutput,NATIVE_BUILD_RECEIPT);
  let receipt:NativeBuildReceipt|undefined;
  if(fs.existsSync(builtReceipt)) {
    const existing=readJson<NativeBuildReceipt>(builtReceipt);
    if(existing.recipeSha256===nativeRecipeDigest(recipe)&&JSON.stringify(existing.recipe)===JSON.stringify(recipe)) {
      validateNativeBuildReceipt(root,existing,{currentConsumer:false});
      verifyNativeBuildFiles(cacheOutput,existing);verifyNativeBuildLibraries(cacheOutput,existing);
      receipt=existing;
    }
  }
  if(!receipt) {
    const {assertAndroidVoiceLibrary}=createRequire(import.meta.url)('../vendor/eliza/packages/app/scripts/build-helpers/verify-fused-symbols.ts');
    // The upstream builder verifies each download, converted GGUF and native ABI/symbol contract.
    // It runs in an isolated source checkout; it never writes into vendor/eliza.
    command(env.ALPHA_NODE||'node',[path.join(source,'packages/app/scripts/paradee-voice/build-native.ts'),'--workspace',path.join(cacheRoot,'downloads'),'--out',voiceOutput,'--model-cache',path.join(cacheRoot,'models'),'--python',python],source,env);
    const nativeTools=ndkTools(ndk),host=readJson<any>(path.join(root,'android/voice-host/qualified-voice-host.json'));
    const abis=host.abis.map((abi:any)=>({abi:abi.abi,release:abi.release,alignment16KiB:true,abiVersion:assertAndroidVoiceLibrary({lib:path.join(voiceOutput,'jniLibs',abi.abi,'libelizainference.so'),objdump:path.join(nativeTools,'bin/llvm-objdump'),nm:path.join(nativeTools,'bin/llvm-nm')}).abiVersion,componentBuild:`Portable source build from SDK ${pin}, engine ${recipe.engineCommit}, recipe ${nativeRecipeDigest(recipe)}. Integrity only; no device qualification.`,libraries:abi.libraries.map((library:any)=> {
      const output=path.join(voiceOutput,'jniLibs',abi.abi,library.name);
      if(library.name==='libc++_shared.so') {
        const triple=abi.abi==='arm64-v8a'?'aarch64':'x86_64';
        command(path.join(nativeTools,'bin/llvm-strip'),['--strip-unneeded',path.join(nativeTools,`sysroot/usr/lib/${triple}-linux-android/libc++_shared.so`),'-o',output],root,env);
      }
      return {name:library.name,bytes:fs.statSync(output).size,sha256:fileDigest(output)};
    })}));
    const voice={...host,description:'Portable source-built voice inputs. Exact bytes are recorded by this build; device and user qualification remain separate.',pin,forkPin:recipe.engineCommit,abis,qualified:false,evidence:{deviceExecuted:false,emulatorDeviceExecuted:false,userAccepted:false}};
    const voiceProblems=voiceHostProblems(voice);
    if(voiceProblems.length)throw Error(voiceProblems.join('\n'));
    // Every non-native byte remains pinned independently of the build output receipt.
    for(const model of voice.models) {
      const file=path.join(voiceOutput,'assets/paradee-voice/v1',model.path);
      if(!fs.existsSync(file)||fs.statSync(file).size!==model.bytes||fileDigest(file)!==model.sha256)throw Error(`Native producer model differs: ${model.path}`);
      const shared=path.join(cacheRoot,'models',model.path);
      if(!fs.existsSync(shared)||fileDigest(shared)!==model.sha256){fs.mkdirSync(path.dirname(shared),{recursive:true});const pending=`${shared}.${process.pid}.partial`;fs.copyFileSync(file,pending);fs.renameSync(pending,shared);}
    }
    const embeddingOutput=path.join(cache,'embedding');
    const preparedFile=path.join(embeddingOutput,'PREPARATION.json');
    if(fs.existsSync(preparedFile)&&readJson<{built:boolean}>(preparedFile).built!==true)fs.rmSync(embeddingOutput,{recursive:true,force:true});
    if(!fs.existsSync(path.join(embeddingOutput,'PREPARATION.json')))command(env.ALPHA_NODE||'node',[path.join(root,'scripts/prepare-embedding-host.ts'),'--fork',fork,'--output',embeddingOutput,'--abi','arm64-v8a','--engine',path.join(voiceOutput,'jniLibs/arm64-v8a'),'--build','--remap-build-path'],root,env);
    const preparation=readJson<any>(path.join(embeddingOutput,'PREPARATION.json'));
    if(!preparation.built)throw Error('Native JNI preparation did not complete');
    const libraries=preparation.libraries.map((row:any)=>({name:path.basename(row.path),sha256:row.sha256,bytes:row.bytes,alignment16KiB:row.alignment16KiB}));
    const original=readJson<any>(path.join(root,QUALIFIED_HOST));
    const embedding={pin,forkPin:recipe.engineCommit,identity:recipe.identity,abi:'arm64-v8a',model:original.model,libraries,jniIdentityRelocated:true,inputs:preparation.inputs,producerInputs:preparation.producerInputs,jniBinding:preparation.jniBinding};
    receipt={schema:'alpha-native-build/v1',recipeSha256:nativeRecipeDigest(recipe),recipe,consumerSdkCommit:pin,producer:{sdkCommit:pin,platform:process.platform,arch:process.arch,ndk:toolchain.ndk,cmake:toolchain.cmake,python:NATIVE_PYTHON},voice,embedding,files:[],qualification:{deviceExecuted:false,userAccepted:false}};
    fs.rmSync(cacheOutput,{recursive:true,force:true});
    const inputs='vendor/eliza/plugins/plugin-local-inference/native/android/inputs.json';
    fs.mkdirSync(path.dirname(path.join(cacheOutput,inputs)),{recursive:true});fs.copyFileSync(path.join(root,inputs),path.join(cacheOutput,inputs));
    stageVoiceModels(cacheOutput,{from:[voiceOutput],record:voice});
    for(const library of preparation.libraries){if(fs.statSync(library.path).size!==library.bytes||fileDigest(library.path)!==library.sha256)throw Error('Built embedding library changed');fs.copyFileSync(library.path,path.join(cacheOutput,'android/app/src/main/jniLibs/arm64-v8a',path.basename(library.path)));}
    receipt.files=[...nativeOutputInventory(receipt).keys()].sort().map(file=>({path:file,bytes:fs.statSync(path.join(cacheOutput,file)).size,sha256:fileDigest(path.join(cacheOutput,file))}));
    validateNativeBuildReceipt(root,receipt);verifyNativeBuildFiles(cacheOutput,receipt);verifyNativeBuildLibraries(cacheOutput,receipt);writeNativeBuildReceipt(cacheOutput,receipt);
  }
  // Owned generated directories may be replaced after a recipe changes. Never modify vendor or committed admission data.
  assertNativeOutputPath(root,'.eliza/paradee-voice');assertNativeOutputPath(root,'android/app/src/main/jniLibs');
  fs.rmSync(path.join(root,'.eliza/paradee-voice'),{recursive:true,force:true});
  for(const abi of ['arm64-v8a','x86_64'])for(const name of ['libelizainference.so','libelizavoicejni.so','libc++_shared.so'])fs.rmSync(path.join(root,'android/app/src/main/jniLibs',abi,name),{force:true});
  stageVoiceModels(root,{from:[path.join(cacheOutput,'.eliza/paradee-voice/native'),path.join(cacheOutput,'android/app/src/main')],record:{...receipt.voice,pin} as Parameters<typeof stageVoiceModels>[1]['record']});
  for(const library of receipt.embedding.libraries) {
    const source=path.join(cacheOutput,'android/app/src/main/jniLibs/arm64-v8a',library.name);
    const target=path.join(root,'android/app/src/main/jniLibs/arm64-v8a',library.name);
    if(fs.existsSync(target)&&fileDigest(target)!==library.sha256)throw Error('Voice and embedding producer libraries differ');
    fs.copyFileSync(source,target);
  }
  receipt=structuredClone(receipt);receipt.consumerSdkCommit=pin;
  receipt.files=[...nativeOutputInventory(receipt).keys()].sort().map(file=>({path:file,bytes:fs.statSync(path.join(root,file)).size,sha256:fileDigest(path.join(root,file))}));
  validateNativeBuildReceipt(root,receipt);verifyNativeBuildFiles(root,receipt);verifyNativeBuildLibraries(root,receipt);writeNativeBuildReceipt(root,receipt);
  verifyNativeBuildFiles(root);
  console.log('Built and staged source-bound native voice and embedding inputs; no device qualification claimed.');
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const root = path.resolve(import.meta.dirname, '..');
  if(args.length)throw Error('Usage: bun scripts/build-embedding-host.ts');
  try {
    await preparePortableNativeInputs(root);
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    console.error(error.message);
    process.exitCode = error.code;
  }
}
