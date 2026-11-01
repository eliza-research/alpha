/** Explicit Cloud resident packaging: real orchestration, no local inference claim. */
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {sourceDirectory,verifySource,workerArtifactDirectory,digest} from './local-agent-source.mjs';
import {verifyWorkerArtifact,workerHash} from './workflow-worker-artifact.mjs';
import {verifyNativeGoogleHostArtifact} from './native-google-host-artifact.mjs';
import {verifyMobileBuildReceipt} from './mobile-uuid-adapter.mjs';
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
export function verifyCloudResident(root,source=sourceDirectory(root)) {
 const main=path.join(root,'android/app/src/main'),agent=path.join(main,'assets/agent');
 const pin=json(path.join(root,'upstream.lock.json')).commit;
 verifySource(source,pin);
 const stamp=path.join(source,'.alpha-runtime-source.json'),staged=path.join(agent,'alpha-source.json');
 if(digest(stamp)!==digest(staged))throw Error('Cloud resident source stamp differs from prepared source');
 if(json(staged).base!==pin||json(staged).patches?.length!==0)throw Error('Cloud resident requires exact patchless source');
 const profile=json(path.join(agent,'alpha-runtime-profile.json'));
 if(profile.version!==1||profile.runtimeProfile!=='cloud')throw Error('Stage the explicit Cloud resident profile');
 const provenance=json(path.join(agent,'android-agent-runtime-provenance.json'));
 if(provenance.schema!=='eliza.android_agent_runtime_provenance.v1'||!Array.isArray(provenance.files))throw Error('Cloud resident runtime provenance missing');
 const omitted={path:'assets/agent/models/bge-small-en-v1.5-f16.gguf',sha256:'f0b2fef971e8366438bfd2d9aefea1b0115919389448806d290237f638bae999'};
 if(JSON.stringify(profile.omittedLocalModels)!==JSON.stringify([omitted]))throw Error('Cloud local-model projection differs');
 const lock=json(path.join(source,'packages/app/scripts/lib/android-bun-artifacts.lock.json'));
 const bunTarget=provenance.bun?.target??'linux-musl';
 if(!['linux-musl','android'].includes(bunTarget))throw Error('Unsupported Cloud Bun target');
 const bun=bunTarget==='linux-musl'?lock.channels?.[provenance.bun?.channel]:lock.targets?.android?.[provenance.bun?.channel];
 const runtimeAbis=bunTarget==='android'?provenance.bun?.architectures:['arm64-v8a','x86_64'];
 if(!Array.isArray(runtimeAbis)||!runtimeAbis.length||new Set(runtimeAbis).size!==runtimeAbis.length||runtimeAbis.some(abi=>!['arm64-v8a','x86_64'].includes(abi)))throw Error('Invalid Cloud Bun ABI admission');
 if(!bun||bun.version!==provenance.bun.version||bun.revision!==provenance.bun.revision)throw Error('Cloud Bun provenance differs from pinned producer lock');
 const seen=new Set();
 for(const row of provenance.files){
  if(typeof row.path!=='string'||! /^(assets\/agent\/|lib\/)/.test(row.path)||row.path.split('/').some(part=>!part||part==='.'||part==='..')||seen.has(row.path))throw Error('Invalid runtime provenance path');
  seen.add(row.path);
  if(row.path===omitted.path){if(row.sha256!==omitted.sha256||fs.existsSync(path.join(main,row.path)))throw Error('Cloud omitted model changed or remains packaged');continue;}
  const file=path.join(main,row.path.replace(/^lib\//,'jniLibs/'));
  if(fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).size!==row.size_bytes||digest(file)!==row.sha256)throw Error('Cloud runtime bytes differ: '+row.path);
 }
 for(const name of ['agent-bundle.js','pglite.wasm','pglite.data','pglite-initdb.bin','vector.tar','fuzzystrmatch.tar'])if(!seen.has('assets/agent/'+name))throw Error('Required Cloud resident database/bundle missing: '+name);
 for(const name of ['pglite.wasm','pglite.data','pglite-initdb.bin','vector.tar','fuzzystrmatch.tar']){const original=fs.readFileSync(path.join(source,'packages/agent/dist-mobile',name.endsWith('.tar')?name+'.gz':name));if(workerHash(name.endsWith('.tar')?gunzipSync(original):original)!==digest(path.join(agent,name)))throw Error('Cloud PGlite differs from prepared build: '+name);}
 for(const abi of runtimeAbis){const arch=abi==='arm64-v8a'?'aarch64':'x64';if(!bun.artifacts?.[arch]||digest(path.join(main,'jniLibs',abi,'libeliza_bun.so'))!==bun.artifacts[arch].binarySha256)throw Error('Cloud Bun executable differs from pinned artifact: '+abi);}
 if(digest(path.join(agent,'agent-bundle.js'))!==digest(path.join(source,'packages/agent/dist-mobile/agent-bundle.js')))throw Error('Cloud agent bundle differs from prepared build');
 verifyMobileBuildReceipt(root,source,agent);
 for(const abi of runtimeAbis){
  const musl=[abi==='arm64-v8a'?'libeliza_ld_musl_aarch64.so':'libeliza_ld_musl_x86_64.so','libeliza_stdcpp.so','libeliza_gcc_s.so','libsigsys-handler.so',abi==='arm64-v8a'?'libeliza_ld_musl_aarch64_real.so':'libeliza_ld_musl_x86_64_real.so'];
  if(bunTarget==='android'&&musl.some(name=>seen.has(`lib/${abi}/${name}`)))throw Error('Native Android Cloud runtime contains musl libraries');
  for(const name of ['libeliza_bun.so',...(bunTarget==='android'?[]:musl)])if(!seen.has(`lib/${abi}/${name}`))throw Error('Cloud resident executable missing: '+abi+'/'+name);
 }
 // Absence is deliberate capability admission, never acceptance of arbitrary local bytes.
 const visit=directory=>{if(!fs.existsSync(directory))return;for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isSymbolicLink())throw Error('Runtime symlink refused');if(entry.isDirectory())visit(file);else if(/\.(gguf|onnx|safetensors|pt|pth)$/.test(entry.name))throw Error('Cloud profile cannot package local model: '+file);else if(/^(lib(?:elizainference|elizavoicejni|paradeevoicejni|llama|ggml|omnivoice)|llama-server)/.test(entry.name))throw Error('Cloud profile cannot package local inference: '+file);}};
 visit(agent);visit(path.join(main,'jniLibs'));
 if(fs.existsSync(path.join(main,'assets/paradee-voice')))throw Error('Cloud profile cannot package local speech');
 const worker=verifyWorkerArtifact(workerArtifactDirectory(root),{sourceStampSha256:workerHash(fs.readFileSync(stamp)),lockSha256:digest(path.join(source,'bun.lock'))});
 verifyNativeGoogleHostArtifact(root,workerArtifactDirectory(root));
 for(const [file,hash] of worker.files)if(digest(path.join(agent,'workflow-worker',file))!==hash)throw Error('Staged Cloud worker differs: '+file);
 return {runtimeProfile:'cloud',resident:true,localInference:false,sourcePin:pin,verifiedRuntimeEntries:seen.size};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.slice(2).join(' ')!=='--verify-cloud')throw Error('Usage: runtime-profile.mjs --verify-cloud');
 console.log(JSON.stringify(verifyCloudResident(path.resolve(import.meta.dirname,'..'))));
}
