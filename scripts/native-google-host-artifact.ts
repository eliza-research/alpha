import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {prepareClientFeatures} from './prepare-client-features.ts';
import {sourceDirectory,verifySource} from './local-agent-source.ts';
import {CORE_STATE_INPUTS,verifyCoreStateBuildRecord,coreStateRequiredTargets,type coreStateBuildRecord} from './core-state-patch.ts';
import {workerHash as hash} from './workflow-worker-artifact.ts';

const moduleName='google-host.mjs';
const digestPattern=/^[a-f0-9]{64}$/;
const safe=(name: unknown): name is string =>typeof name==='string'&&!path.isAbsolute(name)&&name.split('/').every(part=>part&&part!=='.'&&part!=='..');
const record=(value: unknown): value is Record<string, unknown> =>value!==null&&typeof value==='object'&&!Array.isArray(value);

type InputHashes = Record<string, string>;
type RegularFile = {bytes: Buffer; mode: number};
interface FileOptions {message?: string}
interface NativeGoogleHostRecord {
 version: 1;
 module: typeof moduleName;
 bunVersion: '1.4.2';
 inputs: InputHashes;
 coreState: ReturnType<typeof coreStateBuildRecord>;
}
interface ArtifactManifest {
 files: Record<string, unknown>;
 nativeGoogleHost?: unknown;
}
const isDigest = (value: unknown): value is string => typeof value === 'string' && digestPattern.test(value);

function regularFile(file: string, options?: FileOptions & {optional?: false}): RegularFile;
function regularFile(file: string, options: FileOptions & {optional: true}): RegularFile|null;
function regularFile(file: string,{optional=false,message='Native Google build input is not regular'}: FileOptions & {optional?: boolean} = {}): RegularFile|null {
 let stat;
 try{stat=fs.lstatSync(file);}catch(error){if(optional && error instanceof Error && 'code' in error && error.code==='ENOENT')return null;throw error;}
 if(!stat.isFile())throw Error(message);
 return {bytes:fs.readFileSync(file),mode:stat.mode&0o777};
}

export function verifyNativeGoogleHostArtifact(root: string, directory: string): NativeGoogleHostRecord {
 const manifest: ArtifactManifest = JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
 const host = manifest.nativeGoogleHost;
 if(!record(host)||host.version!==1||host.module!==moduleName||host.bunVersion!=='1.4.2'||!record(host.inputs)||Object.keys(host.inputs).length<1)throw Error('Native Google host artifact is missing; build a fresh host artifact');
 const inputs: [string,string][] = [];
 for(const [name,digest] of Object.entries(host.inputs)){
  if(!safe(name)||!isDigest(digest))throw Error('Invalid native Google input record');
  const source=regularFile(path.join(root,name),{message:'Native Google host source changed; build a fresh host artifact'});
  if(hash(source.bytes)!==digest)throw Error('Native Google host source changed; build a fresh host artifact');
  inputs.push([name,digest]);
 }
 verifyCoreStateBuildRecord(root,host.coreState,coreStateRequiredTargets(Object.keys(host.inputs)));
 const file=regularFile(path.join(directory,moduleName),{message:'Native Google host bytes changed'});
 if(hash(file.bytes)!==manifest.files[moduleName])throw Error('Native Google host bytes changed');
 return {...host,version:1,module:moduleName,bunVersion:'1.4.2',inputs:Object.fromEntries(inputs),coreState:host.coreState};
}

function fixedInputHashes(root: string, sdk: string): InputHashes {
 const names=new Set([...CORE_STATE_INPUTS,'package.json','tsconfig.json','vendor/eliza/tsconfig.json',
  path.relative(root,path.join(sdk,'tsconfig.json')),'scripts/build-native-google-host.ts','scripts/local-agent-source.ts',
  'upstream.lock.json','scripts/native-google-host-artifact.ts','scripts/prepare-client-features.ts','scripts/client-speech-patch.ts']);
 for(const name of ['patches/eliza/cloud-speech-client-manifest.json','patches/eliza/cloud-speech-client.patch'])
  if(fs.existsSync(path.join(root,name)))names.add(name);
 return Object.fromEntries([...names].sort().map(name=>{
  if(!safe(name))throw Error('Native Google build input escaped product source');
  return [name,hash(regularFile(path.join(root,name)).bytes)];
 }));
}

function candidateRecord(metadata: unknown, fixed: InputHashes) {
 if(!record(metadata)||!record(metadata.inputs)||!record(metadata.inputHashes)||!Object.hasOwn(metadata.inputs,'backend/native-google-agent-host.ts')
  ||!isDeepStrictEqual(Object.keys(metadata.inputs).sort(),Object.keys(metadata.inputHashes).sort()))
  throw Error('Native Google compiler input graph lacks exact byte bindings');
 const inputs = new Map(Object.entries(fixed));
 for(const [name,digest] of Object.entries(metadata.inputHashes)){
  if(!safe(name)||!isDigest(digest))throw Error('Invalid native Google input record');
  if(Object.hasOwn(fixed,name)&&fixed[name]!==digest)throw Error('Native Google build input changed while compiling');
  inputs.set(name,digest);
 }
 if(!isDigest(metadata.outputSha256))throw Error('Native Google candidate bytes differ from compiler output');
 return {inputs: Object.fromEntries([...inputs].sort(([a],[b])=>a<b?-1:a>b?1:0)),
  outputSha256: metadata.outputSha256, coreState: metadata.coreState};

}

/** Under the serial worker producer, a refused manifest rename restores the prior module. */
function publishPair(directory: string, temporary: string,
 previous: {manifest: RegularFile; module: RegularFile|null}, candidate: RegularFile) {
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
export function addNativeGoogleHostArtifact(root: string, directory: string) {
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
  const {inputs, outputSha256, coreState} = candidateRecord(JSON.parse(regularFile(meta).bytes.toString('utf8')), fixed);
  const manifest: ArtifactManifest = JSON.parse(previous.manifest.bytes.toString('utf8'));
  if(previous.module)fs.chmodSync(file,previous.module.mode);
  const candidate=regularFile(file);
  if(hash(candidate.bytes)!==outputSha256)throw Error('Native Google candidate bytes differ from compiler output');
  manifest.files[moduleName]=outputSha256;
  manifest.nativeGoogleHost={version:1,module:moduleName,bunVersion:'1.4.2',inputs,coreState};
  const manifestFile=path.join(temporary,'manifest.json');
  fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n',{mode:previous.manifest.mode});
  fs.chmodSync(manifestFile,previous.manifest.mode);
  const host=verifyNativeGoogleHostArtifact(root,temporary);
  publishPair(directory,temporary,previous,candidate);
  return host;
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
