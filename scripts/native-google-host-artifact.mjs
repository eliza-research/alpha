import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {prepareClientFeatures} from './prepare-client-features.mjs';
import {sourceDirectory,verifySource} from './local-agent-source.mjs';
import {CORE_STATE_INPUTS,verifyCoreStateBuildRecord,coreStateRequiredTargets} from './core-state-patch.mjs';

const moduleName='google-host.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digestPattern=/^[a-f0-9]{64}$/;
const safe=name=>typeof name==='string'&&!path.isAbsolute(name)&&name.split('/').every(part=>part&&part!=='.'&&part!=='..');
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

function regularFile(file,{optional=false,message='Native Google build input is not regular'}={}){
 let stat;
 try{stat=fs.lstatSync(file);}catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
 if(!stat.isFile())throw Error(message);
 return {bytes:fs.readFileSync(file),mode:stat.mode&0o777};
}

export function verifyNativeGoogleHostArtifact(root,directory){
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8')),host=manifest.nativeGoogleHost;
 if(host?.version!==1||host.module!==moduleName||host.bunVersion!=='1.4.2'||!record(host.inputs)||Object.keys(host.inputs).length<1)throw Error('Native Google host artifact is missing; build a fresh host artifact');
 for(const [name,digest] of Object.entries(host.inputs)){
  if(!safe(name)||!digestPattern.test(digest))throw Error('Invalid native Google input record');
  const source=regularFile(path.join(root,name),{message:'Native Google host source changed; build a fresh host artifact'});
  if(hash(source.bytes)!==digest)throw Error('Native Google host source changed; build a fresh host artifact');
 }
 verifyCoreStateBuildRecord(root,host.coreState,coreStateRequiredTargets(Object.keys(host.inputs)));
 const file=regularFile(path.join(directory,moduleName),{message:'Native Google host bytes changed'});
 if(hash(file.bytes)!==manifest.files[moduleName])throw Error('Native Google host bytes changed');
 return host;
}

function fixedInputHashes(root,sdk){
 const names=new Set([...CORE_STATE_INPUTS,'package.json','tsconfig.json','vendor/eliza/tsconfig.json',
  path.relative(root,path.join(sdk,'tsconfig.json')),'scripts/build-native-google-host.ts','scripts/local-agent-source.mjs',
  'upstream.lock.json','scripts/native-google-host-artifact.mjs','scripts/prepare-client-features.mjs']);
 return Object.fromEntries([...names].sort().map(name=>{
  if(!safe(name))throw Error('Native Google build input escaped product source');
  return [name,hash(regularFile(path.join(root,name)).bytes)];
 }));
}

function candidateInputs(metadata,fixed){
 if(!record(metadata.inputs)||!record(metadata.inputHashes)||!Object.hasOwn(metadata.inputs,'backend/native-google-agent-host.ts')
  ||!isDeepStrictEqual(Object.keys(metadata.inputs).sort(),Object.keys(metadata.inputHashes).sort()))
  throw Error('Native Google compiler input graph lacks exact byte bindings');
 for(const [name,digest] of Object.entries(metadata.inputHashes)){
  if(!safe(name)||!digestPattern.test(digest))throw Error('Invalid native Google input record');
  if(Object.hasOwn(fixed,name)&&fixed[name]!==digest)throw Error('Native Google build input changed while compiling');
 }
 const inputs={...fixed,...metadata.inputHashes};
 return Object.fromEntries(Object.keys(inputs).sort().map(name=>[name,inputs[name]]));
}

/** Under the serial worker producer, a refused manifest rename restores the prior module. */
function publishPair(directory,temporary,previous,candidate){
 const manifest=path.join(directory,'manifest.json'),module=path.join(directory,moduleName);
 const currentManifest=regularFile(manifest),currentModule=regularFile(module,{optional:true});
 if(!isDeepStrictEqual(currentManifest,previous.manifest)||!isDeepStrictEqual(currentModule,previous.module))
  throw Error('Native Google worker artifact changed during build');
 const backup=path.join(temporary,'previous-host');
 if(previous.module){
  fs.writeFileSync(backup,previous.module.bytes,{mode:previous.module.mode});
  fs.chmodSync(backup,previous.module.mode);
 }
 fs.renameSync(path.join(temporary,moduleName),module);
 try{fs.renameSync(path.join(temporary,'manifest.json'),manifest);}
 catch(error){
  try{
   if(!isDeepStrictEqual(regularFile(manifest),previous.manifest)||!isDeepStrictEqual(regularFile(module),candidate))
    throw Error('Native Google worker artifact changed before module restore');
   if(previous.module)fs.renameSync(backup,module);
   else fs.unlinkSync(module);
  }catch(restoreError){
   throw new AggregateError([error,restoreError],'Native Google host manifest publication and module restore failed');
  }
  throw error;
 }
}

/** Product host code is separate from the unchanged upstream workflow producer. */
export function addNativeGoogleHostArtifact(root,directory){
 root=path.resolve(root);directory=path.resolve(directory);
 prepareClientFeatures({root});
 const bun=process.env.ALPHA_BUN||(process.versions.bun?process.execPath:'bun');
 if(execFileSync(bun,['--version'],{encoding:'utf8'}).trim()!=='1.4.2')throw Error('Native Google host requires pinned Bun1.4.2');
 const sdk=sourceDirectory(root),pin=JSON.parse(fs.readFileSync(path.join(root,'upstream.lock.json'),'utf8')).commit;
 verifySource(sdk,pin);
 const fixed=fixedInputHashes(root,sdk);
 const previous={
  manifest:regularFile(path.join(directory,'manifest.json')),
  module:regularFile(path.join(directory,moduleName),{optional:true}),
 };
 const temporary=fs.mkdtempSync(path.join(path.dirname(directory),'.native-google-host-build-'));
 try{
  const meta=path.join(temporary,'meta.json'),file=path.join(temporary,moduleName);
  execFileSync(bun,['--conditions=eliza-source','scripts/build-native-google-host.ts',root,sdk,file,meta],{cwd:root,stdio:'pipe'});
  verifySource(sdk,pin);
  if(!isDeepStrictEqual(fixedInputHashes(root,sdk),fixed))throw Error('Native Google fixed build input changed while compiling');
  const metadata=JSON.parse(regularFile(meta).bytes.toString('utf8')),inputs=candidateInputs(metadata,fixed);
  const manifest=JSON.parse(previous.manifest.bytes.toString('utf8'));
  if(previous.module)fs.chmodSync(file,previous.module.mode);
  const candidate=regularFile(file);
  if(hash(candidate.bytes)!==metadata.outputSha256)throw Error('Native Google candidate bytes differ from compiler output');
  manifest.files[moduleName]=metadata.outputSha256;
  manifest.nativeGoogleHost={version:1,module:moduleName,bunVersion:'1.4.2',inputs,coreState:metadata.coreState};
  const manifestFile=path.join(temporary,'manifest.json');
  fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n',{mode:previous.manifest.mode});
  fs.chmodSync(manifestFile,previous.manifest.mode);
  const host=verifyNativeGoogleHostArtifact(root,temporary);
  publishPair(directory,temporary,previous,candidate);
  return host;
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
