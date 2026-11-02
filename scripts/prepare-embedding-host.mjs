// Consumer-owned preparation of the pinned fused Android engine and relocated JNI host.
// Produces isolated artifacts only; does not alter vendor, package an APK or select runtime providers.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {embeddingProducerInputPaths as producerInputPaths,nativeInputPaths,nativeJavaPath,nativeBinding,nativeInputs,nativeGenerated,nativeCmakeOptions,verifyNativeJava,nativeRequiredSymbols,verifyNativeSymbols} from './embedding-native-contract.mjs';
import {embeddingBuildRemap} from './embedding-build-remap.mjs';
// Full producer module closure and repository-shape metadata; no dependency install.

const root=path.resolve(import.meta.dirname,'..'),upstream=path.join(root,'vendor/eliza');
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
for(let i=0;i<args.length;i++){if(args[i]==='--build'||args[i]==='--remap-build-path')continue;if(['--fork','--output','--abi'].includes(args[i])){if(!args[++i]||args[i].startsWith('--'))throw Error('Missing option value');}else throw Error('Unknown option');}
const abi=option('--abi')||'arm64-v8a',forkInput=option('--fork'),outputInput=option('--output');
if(!['arm64-v8a','x86_64'].includes(abi)||!forkInput||!outputInput)throw Error('Usage: node scripts/prepare-embedding-host.mjs --fork <existing pinned checkout> --output <new isolated directory> [--abi arm64-v8a|x86_64] [--build] [--remap-build-path]');
const fork=fs.realpathSync(forkInput),output=path.resolve(outputInput);
const within=(parent,child)=>{const relative=path.relative(parent,child);return relative===''||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
for(let p=output;p!==path.dirname(p);p=path.dirname(p))if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('Output must not traverse a symlink');
if(within(upstream,output)||within(fork,output)||within(path.join(root,'artifacts'),output))throw Error('Output must be outside vendor, engine checkout and prepared runtime artifacts');
if(fs.existsSync(output))throw Error('Output already exists; preserve prior artifacts');
const git=(directory,...command)=>execFileSync('git',['-C',directory,...command],{encoding:'utf8'}).trim();
const pin=JSON.parse(fs.readFileSync(path.join(root,'upstream.lock.json'),'utf8')).commit;
if(git(upstream,'rev-parse','HEAD')!==pin)throw Error('Unexpected Eliza pin');
const forkPath='plugins/plugin-local-inference/native/llama.cpp';
const forkPin=git(upstream,'ls-tree',pin,forkPath).match(/^160000 commit ([a-f0-9]{40})\t/)?.[1];
if(!forkPin||git(fork,'rev-parse','HEAD')!==forkPin||git(fork,'status','--porcelain'))throw Error('Engine checkout must be clean at the exact Eliza gitlink');
if(git(fork,'submodule','status','--recursive').split('\n').some(line=>line&&/^[-+U]/.test(line)))throw Error('Engine nested submodules must already be initialized at their pins; no downloads are performed');
for(const file of ['tools/omnivoice/CMakeLists.txt','tools/omnivoice/include/eliza-inference-ffi.h'])if(!fs.existsSync(path.join(fork,file)))throw Error('Pinned fused engine source is incomplete');
const identity=JSON.parse(fs.readFileSync(path.join(root,'app.config.json'),'utf8')).appId;
if(!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(identity))throw Error('Invalid product identity');
const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT;
if(!sdk)throw Error('Set ANDROID_HOME to the existing SDK');
const versions=fs.readdirSync(path.join(sdk,'ndk')).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
const ndkVersion=process.env.ELIZA_NDK_VERSION||versions.at(-1),ndk=path.join(sdk,'ndk',ndkVersion||'');
const toolchain=path.join(ndk,'build/cmake/android.toolchain.cmake');
if(!fs.existsSync(toolchain))throw Error('Existing NDK toolchain required');
let existing=path.dirname(output);while(!fs.existsSync(existing))existing=path.dirname(existing);
const disk=fs.statfsSync(existing);if(args.includes('--build')&&disk.bavail*disk.bsize<6*1024**3)throw Error('Native build requires at least 6 GiB free; no cleanup is performed');
const staging=path.join(output,'source'),inputs=[];
const source=relative=>execFileSync('git',['-C',upstream,'show',pin+':'+relative],{encoding:'utf8',maxBuffer:4*1024*1024});
const cpp=source(nativeInputPaths.at(-1)),cmake=source(nativeInputPaths.at(-2)),jniBinding=nativeBinding(cpp,cmake,identity);
if(jniBinding.mode==='registered')verifyNativeJava(cpp,source(nativeJavaPath));
const files=nativeInputs(jniBinding);
for(const relative of files){
 const original=execFileSync('git',['-C',upstream,'show',pin+':'+relative],{encoding:'utf8',maxBuffer:4*1024*1024});
 const generated=nativeGenerated(relative,original,identity,jniBinding);
 const target=path.join(staging,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,generated);
 const sha=value=>createHash('sha256').update(value).digest('hex');inputs.push({path:relative,sourceSha256:sha(original),generatedSha256:sha(generated)});
}
// These unmodified producer files are distinct from the relocated native compile inputs.
const producerInputs=[];
for(const relative of producerInputPaths){
 const original=source(relative),target=path.join(staging,relative);
 const digest=createHash('sha256').update(original).digest('hex');
 if(!files.includes(relative)){fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,original);}
 else if(createHash('sha256').update(fs.readFileSync(target)).digest('hex')!==digest)throw Error('Producer input overlaps a relocated native input');
 producerInputs.push({path:relative,sha256:digest});
}
fs.mkdirSync(path.dirname(path.join(staging,forkPath)),{recursive:true});fs.symlinkSync(fork,path.join(staging,forkPath),'dir');
const nativeSource=path.join(staging,'packages/app/platforms/android/app/src/main/elizavoice-jni');
const commands=[
 [process.execPath,path.join(staging,'packages/app/scripts/stage-elizavoice-lib.ts'),'--abi',abi,'--variant','cpu'],
 ['cmake','-S',nativeSource,'-B',path.join(output,'jni-build'),'-G','Ninja',`-DCMAKE_TOOLCHAIN_FILE=${toolchain}`,`-DANDROID_ABI=${abi}`,'-DANDROID_PLATFORM=android-23','-DCMAKE_BUILD_TYPE=Release',...nativeCmakeOptions(jniBinding),`-DELIZAVOICE_FFI_INCLUDE_DIR=${path.join(fork,'tools/omnivoice/include')}`],
 ['cmake','--build',path.join(output,'jni-build'),'--target','elizavoicejni','-j','2'],
];
// Without a remap the compiler embeds this output directory in the libraries (__FILE__ in the
// engine's assertions), so the bytes can only be reproduced at the same absolute path.
// --remap-build-path rewrites it to a fixed name through clang's CCC_OVERRIDE_OPTIONS (the NDK
// toolchain file ignores CFLAGS). Bytes built with and without it differ; a receipt records which.
const remap=args.includes('--remap-build-path');
const remapEnv=remap?embeddingBuildRemap(root,{sdk,staging,fork,build:path.join(output,'jni-build')}):{};
const receipt={pin,forkPin,identity,abi,inputs,producerInputs,...(jniBinding.mode==='registered'?{jniBinding}:{}),commands,env:{ANDROID_HOME:sdk,ELIZA_NDK_VERSION:ndkVersion,CMAKE_BUILD_PARALLEL_LEVEL:'2',...remapEnv},buildPathRemapped:remap,built:false,packaged:false,runtimePolicyChanged:false};
fs.writeFileSync(path.join(output,'PREPARATION.json'),JSON.stringify(receipt,null,2)+'\n');
if(args.includes('--build')){
 for(const [executable,...argv] of commands)execFileSync(executable,argv,{cwd:staging,env:{...process.env,...receipt.env},stdio:'inherit'});
 const tools=path.join(ndk,'toolchains/llvm/prebuilt',process.platform==='darwin'?'darwin-x86_64':'linux-x86_64','bin');
 const libraries=[path.join(staging,'packages/app/platforms/android/app/src/main/jniLibs',abi,'libelizainference.so'),path.join(staging,'packages/app/platforms/android/app/src/main/jniLibs',abi,'libc++_shared.so'),path.join(output,'jni-build/libelizavoicejni.so')];
 receipt.libraries=libraries.map(file=>{
  const symbols=execFileSync(path.join(tools,'llvm-nm'),['-D','--defined-only',file],{encoding:'utf8',maxBuffer:16*1024*1024});
  const elf=execFileSync(path.join(tools,'llvm-readelf'),['-W','-h','-l','-d',file],{encoding:'utf8'});
  if(!elf.includes(abi==='arm64-v8a'?'AArch64':'Advanced Micro Devices X86-64')||/NEEDED[^\n]*musl/i.test(elf))throw Error('Wrong native engine ABI');
  const required=path.basename(file)==='libelizainference.so'?['eliza_inference_embed','eliza_inference_embed_with_options','eliza_inference_abi_version']:path.basename(file)==='libelizavoicejni.so'?nativeRequiredSymbols(jniBinding):[];
  for(const symbol of required)if(!symbols.split('\n').some(line=>line.trim().endsWith(' '+symbol)))throw Error('Required embedding symbol missing');
  if(path.basename(file)==='libelizavoicejni.so')verifyNativeSymbols(symbols,jniBinding);
  const loads=elf.split('\n').filter(line=>/^\s*LOAD\s/.test(line));
  if(!loads.length||loads.some(line=>parseInt(line.trim().split(/\s+/).at(-1),16)<16384))throw Error('Native library is not 16 KiB compatible');
  return {path:file,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex'),bytes:fs.statSync(file).size,requiredSymbols:required,alignment16KiB:true};
 });
 for(const row of producerInputs){
  const stagedHash=createHash('sha256').update(fs.readFileSync(path.join(staging,row.path))).digest('hex');
  const sourceHash=createHash('sha256').update(source(row.path)).digest('hex');
  if(stagedHash!==row.sha256||sourceHash!==row.sha256)throw Error('Producer source changed during build');
 }
 if(git(upstream,'rev-parse','HEAD')!==pin)throw Error('Upstream source pin changed during build');
 if(git(fork,'rev-parse','HEAD')!==forkPin||git(fork,'status','--porcelain'))throw Error('Engine source changed during build');
 receipt.built=true;
 fs.writeFileSync(path.join(output,'PREPARATION.json'),JSON.stringify(receipt,null,2)+'\n');
}
console.log(JSON.stringify({receipt:path.join(output,'PREPARATION.json'),built:receipt.built,packaged:false,runtimePolicyChanged:false}));
