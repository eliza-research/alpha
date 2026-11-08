import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {embeddingProducerInputPaths,nativeInputPaths,nativeJavaPath,nativeBinding,nativeInputs,nativeGenerated,verifyNativeJava} from './embedding-native-contract.mjs';
const root=path.resolve(import.meta.dirname,'..');
const sha=value=>createHash('sha256').update(value).digest('hex');
const hash=file=>sha(fs.readFileSync(file));
const names=['libelizainference.so','libelizavoicejni.so','libc++_shared.so'];
const model={path:'android/app/src/main/assets/agent/models/bge-small-en-v1.5-f16.gguf',sha256:'f0b2fef971e8366438bfd2d9aefea1b0115919389448806d290237f638bae999',dimensions:384};
const forkPath='plugins/plugin-local-inference/native/llama.cpp';

/** Map original receipt paths onto a verified extracted artifact without rewriting the receipt. */
export function embeddingLibrarySource(row,libraryRoot){
 if(libraryRoot===undefined)return row.path;
 if(!path.isAbsolute(libraryRoot)||path.resolve(libraryRoot)!==libraryRoot||fs.realpathSync(libraryRoot)!==libraryRoot||!fs.lstatSync(libraryRoot).isDirectory())throw Error('Embedding library root must be a canonical directory');
 const name=path.basename(row.path);
 if(!names.includes(name)||(row.artifactPath!==undefined&&row.artifactPath!==name))throw Error('Unexpected embedding artifact path');
 const file=path.join(libraryRoot,name),stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('Embedding artifact library must be a regular file');
 return file;
}

const isCommit=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value)&&value!=='0'.repeat(40);
/** A new runtime pin may reuse reviewed binaries only when every native build input is exact. */
export function verifyEmbeddingInputs(productRoot,qualification,{requireProducerInputs=false}={}) {
 const pin=JSON.parse(fs.readFileSync(path.join(productRoot,'upstream.lock.json'),'utf8')).commit;
 const identity=JSON.parse(fs.readFileSync(path.join(productRoot,'app.config.json'),'utf8')).appId;
 if(!isCommit(pin)||!isCommit(qualification.pin)||!isCommit(qualification.forkPin)||qualification.identity!==identity||qualification.abi!=='arm64-v8a')throw Error('Embedding host source or identity admission changed');
 const inputs=qualification.inputs;

 const vendor=path.join(productRoot,'vendor/eliza');
 const git=(...args)=>execFileSync('git',['-C',vendor,...args],{maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
 try {
  if(git('rev-parse','HEAD').toString().trim()!==pin)throw Error('Locked vendor pin is not checked out');
  const source=relative=>git('show',pin+':'+relative).toString();
  const cpp=source(nativeInputPaths.at(-1)),cmake=source(nativeInputPaths.at(-2)),binding=nativeBinding(cpp,cmake,identity),inputPaths=nativeInputs(binding);
  if(!Array.isArray(inputs)||inputs.length!==inputPaths.length||new Set(inputs.map(row=>row?.path)).size!==inputPaths.length||inputs.some(row=>!inputPaths.includes(row?.path)||!/^[a-f0-9]{64}$/.test(row.sourceSha256)||!/^[a-f0-9]{64}$/.test(row.generatedSha256)))throw Error('Embedding host build input qualification missing or changed');
  if(binding.mode==='registered'){
   if(!qualification.jniBinding||Object.keys(qualification.jniBinding).length!==3||Object.entries(binding).some(([key,value])=>qualification.jniBinding[key]!==value))throw Error('Native registration identity qualification missing or changed');
   verifyNativeJava(cpp,source(nativeJavaPath));
  }
  const producers=qualification.producerInputs;
  if(requireProducerInputs||producers!==undefined){
   if(!Array.isArray(producers)||producers.length!==embeddingProducerInputPaths.length||new Set(producers.map(row=>row?.path)).size!==embeddingProducerInputPaths.length||producers.some(row=>!embeddingProducerInputPaths.includes(row?.path)||!/^[a-f0-9]{64}$/.test(row.sha256)))throw Error('Embedding producer input qualification missing or changed');
   git('diff','--quiet','HEAD','--',...embeddingProducerInputPaths);
   for(const row of producers)if(sha(git('show',pin+':'+row.path))!==row.sha256)throw Error('Embedding producer input changed: '+row.path);
  }
  git('diff','--quiet','HEAD','--',...inputPaths,forkPath);
  const fork=git('ls-tree',pin,forkPath).toString().match(/^160000 commit ([a-f0-9]{40})\t/)?.[1];
  if(fork!==qualification.forkPin)throw Error('Native engine gitlink changed');
  for(const row of inputs){
   const source=git('show',pin+':'+row.path);
   const generated=nativeGenerated(row.path,source.toString('utf8'),identity,binding);
   if(sha(source)!==row.sourceSha256||sha(generated)!==row.generatedSha256)throw Error('Native build input changed: '+row.path);
  }
 } catch(error){throw Error('Embedding host source admission changed: '+error.message,{cause:error});}
}
/** Build admission reads exact staged bytes; it never downloads or repairs a missing artifact. */
export function verifyEmbeddingHost(productRoot,{allowAbsentRuntime=false,requireProducerInputs=false}={}) {
 // The explicit unpackaged developer build has no agent to use this host. Never
 // admit a partial resident payload or a partially staged native host this way.
 if(allowAbsentRuntime){
  const runtime=['alpha-source.json','agent-bundle.js','workflow-worker/manifest.json'];
  const native=names.flatMap(name=>['arm64-v8a','x86_64'].map(abi=>'android/app/src/main/jniLibs/'+abi+'/'+name));
  const files=[...runtime.map(name=>'android/app/src/main/assets/agent/'+name),...native];
  if(files.every(file=>!fs.existsSync(path.join(productRoot,file))))return {status:'not-packaged',distributable:false};
 }

 const manifest=JSON.parse(fs.readFileSync(path.join(productRoot,'android/embedding-host/qualified-host.json'),'utf8'));
 // Set by a pin move that changed a native build input or the engine gitlink; a new --receipt replaces the record.
 // The explicit developer lane stays non-distributable, so pending requalification never admits a release.
 if(manifest.requalification?.required===true&&allowAbsentRuntime)return {status:'requalification-pending',distributable:false};
 if(manifest.requalification?.required===true)throw Error('Embedding host requalification required at '+String(manifest.requalification.atPin).slice(0,12)+': '+manifest.requalification.reason);
 if(!/^[a-f0-9]{64}$/.test(manifest.qualificationReceiptSha256)||manifest.jniIdentityRelocated!==true)throw Error('Embedding host qualification missing or changed');
 verifyEmbeddingInputs(productRoot,manifest,{requireProducerInputs});
 if(manifest.model?.sha256!==model.sha256||manifest.model?.path!==model.path||manifest.model?.dimensions!==384)throw Error('Embedding host model admission changed');
 if(!Array.isArray(manifest.libraries)||manifest.libraries.length!==names.length||new Set(manifest.libraries.map(row=>row.name)).size!==names.length)throw Error('Incomplete embedding host library set');
 for(const row of manifest.libraries){
  if(!names.includes(row.name)||!/^[a-f0-9]{64}$/.test(row.sha256)||!Number.isSafeInteger(row.bytes)||row.bytes<=0||row.alignment16KiB!==true)throw Error('Invalid qualified embedding library');
  const file=path.join(productRoot,'android/app/src/main/jniLibs',manifest.abi,row.name);
  if(!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).size!==row.bytes||hash(file)!==row.sha256)throw Error('Qualified embedding host library missing or changed: '+row.name);
 }
 const file=path.join(productRoot,model.path);
 if(!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink()||hash(file)!==model.sha256)throw Error('Pinned BGE384 model missing or changed');
 return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args[0]==='--verify'&&(args.length===1||args.length===2&&args[1]==='--allow-unpackaged-runtime')){
  const result=verifyEmbeddingHost(root,{allowAbsentRuntime:args.includes('--allow-unpackaged-runtime')});
  if(result.status==='not-packaged')console.log('No resident embedding host packaged; developer APK only.');
  else if(result.status==='requalification-pending')console.log('Embedding host requalification pending; non-distributable developer APK only.');
  else console.log('Qualified ARM64 embedding host and BGE384 bytes verified. No device execution claimed.');
 }
 else if(args[0]==='--receipt'&&(args.length===2||args.length===4&&args[2]==='--library-root')){
  const libraryRoot=args.length===4?args[3]:undefined;
  const receipt=JSON.parse(fs.readFileSync(args[1],'utf8'));
  const identity=JSON.parse(fs.readFileSync(path.join(root,'app.config.json'),'utf8')).appId;
  if(receipt.built!==true||!receipt.qualifiedAt||!Array.isArray(receipt.libraries)||receipt.libraries.length!==3)throw Error('Exact qualified ARM64 receipt required');
  verifyEmbeddingInputs(root,receipt,{requireProducerInputs:true});
  const libraries=names.map(name=>{
   const matches=receipt.libraries.filter(row=>path.basename(row.path)===name);
   if(matches.length!==1)throw Error('Incomplete embedding host receipt');
   const row=matches[0],sourcePath=embeddingLibrarySource(row,libraryRoot);if(!Number.isSafeInteger(row.bytes)||row.bytes<=0||fs.statSync(sourcePath).size!==row.bytes||row.alignment16KiB!==true||hash(sourcePath)!==row.sha256)throw Error('Qualified library bytes changed');
   const target=path.join(root,'android/app/src/main/jniLibs',receipt.abi,name);
   if(fs.existsSync(target)&&(fs.lstatSync(target).isSymbolicLink()||hash(target)!==row.sha256))throw Error('Existing native library differs; review ownership before replacing '+name);
   return {name,sha256:row.sha256,bytes:row.bytes,alignment16KiB:true,source:sourcePath,target};
  });
  // agent:stage-android stages the model with the runtime payload; this command only checks it.
  if(!fs.existsSync(path.join(root,model.path)))throw Error('Pinned BGE model is not staged: run npm run agent:prepare, npm run agent:build-workflow-worker and npm run agent:stage-android first');
  if(hash(path.join(root,model.path))!==model.sha256)throw Error('Pinned BGE model bytes changed');
  const manifest={pin:receipt.pin,forkPin:receipt.forkPin,identity,abi:receipt.abi,model,libraries:libraries.map(({source,target,...row})=>row),qualificationReceiptSha256:hash(args[1]),jniIdentityRelocated:true,inputs:receipt.inputs,producerInputs:receipt.producerInputs,...(receipt.jniBinding?{jniBinding:receipt.jniBinding}:{})};
  const manifestFile=path.join(root,'android/embedding-host/qualified-host.json');
  // A record marked for requalification is replaced by the new qualification; any other differing record needs review first.
  if(fs.existsSync(manifestFile)&&fs.readFileSync(manifestFile,'utf8')!==JSON.stringify(manifest,null,2)+'\n'&&JSON.parse(fs.readFileSync(manifestFile,'utf8')).requalification?.required!==true)throw Error('Existing embedding qualification differs; review before replacing');
  for(const row of libraries){fs.mkdirSync(path.dirname(row.target),{recursive:true});if(!fs.existsSync(row.target))fs.copyFileSync(row.source,row.target,fs.constants.COPYFILE_EXCL);}
  fs.mkdirSync(path.dirname(manifestFile),{recursive:true});fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
  verifyEmbeddingHost(root,{requireProducerInputs:true});console.log('Qualified ARM64 embedding host staged. Runtime policy and Cloud text/speech unchanged.');
 }else throw Error('Usage: node scripts/stage-embedding-host.mjs --receipt <QUALIFICATION.json> [--library-root <directory>] | --verify');
}
