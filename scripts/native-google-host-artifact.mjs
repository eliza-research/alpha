import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {prepareClientFeatures} from './prepare-client-features.mjs';
import {sourceDirectory,verifySource} from './local-agent-source.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const safe=name=>typeof name==='string'&&!path.isAbsolute(name)&&name.split('/').every(part=>part&&part!=='.'&&part!=='..');
export function verifyNativeGoogleHostArtifact(root,directory){
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8')),host=manifest.nativeGoogleHost;
 if(host?.version!==1||host.module!=='google-host.mjs'||host.bunVersion!=='1.4.2'||!host.inputs||Array.isArray(host.inputs)||Object.keys(host.inputs).length<1)throw Error('Native Google host artifact is missing; build a fresh host artifact');
 for(const [name,digest] of Object.entries(host.inputs)){
  if(!safe(name)||!/^[a-f0-9]{64}$/.test(digest))throw Error('Invalid native Google input record');
  const file=path.join(root,name),stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||hash(fs.readFileSync(file))!==digest)throw Error('Native Google host source changed; build a fresh host artifact');
 }
 const file=path.join(directory,host.module),stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||hash(fs.readFileSync(file))!==manifest.files[host.module])throw Error('Native Google host bytes changed');
 return host;
}
/** Product host code is separate from the unchanged upstream workflow producer. */
export function addNativeGoogleHostArtifact(root,directory){
 prepareClientFeatures({root});
 const bun=process.env.ALPHA_BUN||(process.versions.bun?process.execPath:'bun');
 if(execFileSync(bun,['--version'],{encoding:'utf8'}).trim()!=='1.4.2')throw Error('Native Google host requires pinned Bun1.4.2');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-google-host-build-'));
 try{
  const meta=path.join(temporary,'meta.json'),file=path.join(directory,'google-host.mjs');
  const sdk=sourceDirectory(root),pin=JSON.parse(fs.readFileSync(path.join(root,'upstream.lock.json'),'utf8')).commit;
  verifySource(sdk,pin);
  execFileSync(bun,['--conditions=eliza-source','scripts/build-native-google-host.ts',root,sdk,file,meta],{cwd:root,stdio:'pipe'});
  verifySource(sdk,pin);
  const metadata=JSON.parse(fs.readFileSync(meta,'utf8')),names=new Set([...Object.keys(metadata.inputs),'package.json','tsconfig.json','vendor/eliza/tsconfig.json',path.relative(root,path.join(sdk,'tsconfig.json')),'scripts/build-native-google-host.ts','scripts/local-agent-source.mjs','upstream.lock.json','scripts/native-google-host-artifact.mjs','scripts/prepare-client-features.mjs','scripts/client-speech-patch.mjs']);
  for(const name of ['patches/eliza/cloud-speech-client-manifest.json','patches/eliza/cloud-speech-client.patch'])if(fs.existsSync(path.join(root,name)))names.add(name);
  const inputs={};for(const name of [...names].sort()){
   if(!safe(name))throw Error('Native Google build input escaped product source');
   const source=path.join(root,name),stat=fs.lstatSync(source);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Native Google build input is not regular');
   inputs[name]=hash(fs.readFileSync(source));
  }
  const manifestFile=path.join(directory,'manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  manifest.files['google-host.mjs']=hash(fs.readFileSync(file));
  manifest.nativeGoogleHost={version:1,module:'google-host.mjs',bunVersion:'1.4.2',inputs};
  fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
  return verifyNativeGoogleHostArtifact(root,directory);
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
