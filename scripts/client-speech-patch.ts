import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

import {sha} from './upstream-native-source.ts';
import type {UpstreamBlob, upstreamNativeSource} from './upstream-native-source.ts';

interface SpeechPatch {
 file: string;
 sha256: string;
 targets: {path: string; beforeSha256: string | null; afterSha256: string}[];
}

interface SpeechPatchManifest {
 schema: number;
 baseCommit: string;
 patches: SpeechPatch[];
}
const HEX=/^[a-f0-9]{64}$/;
const safe=(name: unknown): name is string =>typeof name==='string'&&!name.startsWith('/')&&!name.includes('\\')&&name.split('/').every(part=>part&&part!=='.'&&part!=='..');
function regular(file: string, root: string){
 file=path.resolve(file);root=path.resolve(root);
 if(!file.startsWith(root+path.sep))throw Error('Client speech patch escaped source root');
 for(let current=file;current!==root;current=path.dirname(current))if(fs.lstatSync(current).isSymbolicLink())throw Error('Linked client speech patch');
 if(!fs.lstatSync(file).isFile())throw Error('Nonregular client speech patch');
}
/** Explicit additions and a hash-bound assistant-controller patch; the vendor and resident stay immutable. */
export function clientSpeechPatch(root: string, upstream: ReturnType<typeof upstreamNativeSource>){
 root=path.resolve(root);
 const patchRoot=path.join(root,'patches/eliza'),file=path.join(patchRoot,'cloud-speech-client-manifest.json');
 if(!fs.existsSync(file))return {files:new Map<string, UpstreamBlob>(),receipt:null};
 regular(file,root);
 const manifestBytes=fs.readFileSync(file);
 const manifest: SpeechPatchManifest = JSON.parse(manifestBytes.toString('utf8'));
 if(manifest.schema!==1||manifest.baseCommit!==upstream.pin||!Array.isArray(manifest.patches)||manifest.patches.length>8)throw Error('Client speech patch pin/schema mismatch');
 const original=upstream.read('packages/voice/src');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-client-speech-'));
 const expected = new Map<string, string>();
 const patches: Omit<SpeechPatch, 'targets'>[] = [];
 try{
  for(const patch of manifest.patches){
   if(!safe(patch.file)||!HEX.test(patch.sha256)||!Array.isArray(patch.targets)||!patch.targets.length||patch.targets.length>16)throw Error('Invalid client speech patch');
   const filename=path.join(patchRoot,patch.file);regular(filename,patchRoot);
   const bytes=fs.readFileSync(filename);
   if(bytes.length>2*1024*1024||sha(bytes)!==patch.sha256)throw Error('Client speech patch digest mismatch');
   for(const target of patch.targets){
    if(!safe(target.path)||!/^packages\/voice\/src\/[a-z0-9-]+\.ts$/.test(target.path)||!HEX.test(target.afterSha256)||expected.has(target.path))throw Error('Client speech target mismatch');
    const before=original.get(target.path);
    if(target.beforeSha256===null){
     if(before)throw Error('Client speech addition target mismatch');
    }else{
     if(target.path!=='packages/voice/src/voice-assistant-session.ts'||!HEX.test(target.beforeSha256)||!before||before.mode!=='100644'||sha(before.bytes)!==target.beforeSha256)throw Error('Client speech source mismatch');
     const destination=path.join(temporary,target.path);
     fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,before.bytes);
    }
    expected.set(target.path,target.afterSha256);
   }
   const headers=bytes.toString('utf8').split('\n').filter(line=>line.startsWith('--- ')||line.startsWith('+++ '));
   const wanted=patch.targets.flatMap(target=>[target.beforeSha256===null?'--- /dev/null':'--- a/'+target.path,'+++ b/'+target.path]);
   if(JSON.stringify(headers)!==JSON.stringify(wanted))throw Error('Client speech patch headers mismatch');
   execFileSync('patch',['--batch','--fuzz=0','--forward','-p1','--input',filename],{cwd:temporary,stdio:'pipe',timeout:30000});
   patches.push({file:patch.file,sha256:patch.sha256});
  }
  const files = new Map<string, UpstreamBlob>();
  function visit(directory: string){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
   const filename=path.join(directory,entry.name),name=path.relative(temporary,filename).split(path.sep).join('/');
   if(entry.isDirectory())visit(filename);else{
    const digest = expected.get(name);
    if(!entry.isFile()||entry.isSymbolicLink()||!digest)throw Error('Unexpected client speech patch output');
    const bytes=fs.readFileSync(filename);
    if(bytes.length>256*1024||sha(bytes)!==digest||(fs.statSync(filename).mode&0o111)!==0)throw Error('Client speech output digest/mode mismatch');
    files.set(name,{bytes,mode:'100644',sha256:digest});
   }
  }}
  visit(temporary);
  if(files.size!==expected.size)throw Error('Missing client speech patch output');
  return {files,receipt:{manifestSha256:sha(manifestBytes),preparerSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),patches,files:Object.fromEntries(expected)}};
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
