import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const HEX=/^[a-f0-9]{64}$/;
const safe=name=>typeof name==='string'&&!name.startsWith('/')&&!name.includes('\\')&&name.split('/').every(part=>part&&part!=='.'&&part!=='..');
function regular(file,root){
 file=path.resolve(file);root=path.resolve(root);
 if(!file.startsWith(root+path.sep))throw Error('Client feature patch escaped source root');
 for(let current=file;current!==root;current=path.dirname(current))if(fs.lstatSync(current).isSymbolicLink())throw Error('Linked client feature patch');
 if(!fs.lstatSync(file).isFile())throw Error('Nonregular client feature patch');
}
/** Explicit additions and a hash-bound assistant-controller patch; the vendor and resident stay immutable. */
export function clientSpeechPatch(root,upstream){
 return clientFeaturePatch(root,upstream,{
  manifest:'cloud-speech-client-manifest.json',
  prefix:'packages/voice/src',
  target:/^packages\/voice\/src\/[a-z0-9-]+\.ts$/,
  editable:'packages/voice/src/voice-assistant-session.ts',
 });
}

/** Backport of the shared Google host. It can only add modules in its own source directory. */
export function clientManagedGooglePatch(root,upstream){
 return clientFeaturePatch(root,upstream,{
  manifest:'managed-google-agent-manifest.json',
  prefix:'packages/app/src/runtime/managed-google-agent',
  target:/^packages\/app\/src\/runtime\/managed-google-agent\/[a-z0-9-]+\.ts$/,
  additionsOnly:true,
 });
}

function clientFeaturePatch(root,upstream,policy){
 root=path.resolve(root);
 const patchRoot=path.join(root,'patches/eliza'),file=path.join(patchRoot,policy.manifest);
 if(!fs.existsSync(file))return {files:new Map(),receipt:null};
 regular(file,root);
 const manifestBytes=fs.readFileSync(file),manifest=JSON.parse(manifestBytes);
 if(manifest.schema!==1||manifest.baseCommit!==upstream.pin||!Array.isArray(manifest.patches)||manifest.patches.length>8)throw Error('Client feature patch pin/schema mismatch');
 const original=upstream.read(policy.prefix,{allowMissing:policy.additionsOnly});
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-client-feature-'));
 const expected=new Map(),patches=[];
 try{
  for(const patch of manifest.patches){
   if(!safe(patch.file)||!HEX.test(patch.sha256)||!Array.isArray(patch.targets)||!patch.targets.length||patch.targets.length>16)throw Error('Invalid client feature patch');
   const filename=path.join(patchRoot,patch.file);regular(filename,patchRoot);
   const bytes=fs.readFileSync(filename);
   if(bytes.length>2*1024*1024||sha(bytes)!==patch.sha256)throw Error('Client feature patch digest mismatch');
   for(const target of patch.targets){
    if(!safe(target.path)||!policy.target.test(target.path)||!HEX.test(target.afterSha256)||expected.has(target.path))throw Error('Client feature target mismatch');
    const before=original.get(target.path);
    if(target.beforeSha256===null){
     if(before)throw Error('Client feature addition target mismatch');
    }else{
     if(target.path!==policy.editable||!HEX.test(target.beforeSha256)||!before||before.mode!=='100644'||sha(before.bytes)!==target.beforeSha256)throw Error('Client feature source mismatch');
     const destination=path.join(temporary,target.path);
     fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,before.bytes);
    }
    expected.set(target.path,target.afterSha256);
   }
   const headers=bytes.toString('utf8').split('\n').filter(line=>line.startsWith('--- ')||line.startsWith('+++ '));
   const wanted=patch.targets.flatMap(target=>[target.beforeSha256===null?'--- /dev/null':'--- a/'+target.path,'+++ b/'+target.path]);
   if(JSON.stringify(headers)!==JSON.stringify(wanted))throw Error('Client feature patch headers mismatch');
   execFileSync('patch',['--batch','--fuzz=0','--forward','-p1'],{cwd:temporary,input:bytes,stdio:'pipe',timeout:30000});
   patches.push({file:patch.file,sha256:patch.sha256});
  }
  const files=new Map();
  function visit(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
   const filename=path.join(directory,entry.name),name=path.relative(temporary,filename).split(path.sep).join('/');
   if(entry.isDirectory())visit(filename);else{
    if(!entry.isFile()||entry.isSymbolicLink()||!expected.has(name))throw Error('Unexpected client feature patch output');
    const bytes=fs.readFileSync(filename);
    if(bytes.length>256*1024||sha(bytes)!==expected.get(name)||(fs.statSync(filename).mode&0o111)!==0)throw Error('Client feature output digest/mode mismatch');
    files.set(name,{bytes,mode:'100644',sha256:expected.get(name)});
   }
  }}
  visit(temporary);
  if(files.size!==expected.size)throw Error('Missing client feature patch output');
  return {files,receipt:{manifestSha256:sha(manifestBytes),preparerSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),patches,files:Object.fromEntries(expected)}};
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
