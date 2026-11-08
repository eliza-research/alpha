import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {registerHooks} from 'node:module';
import {upstreamNativeSource, sha} from './upstream-native-source.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const modulePath='packages/os/scripts/android/sense-systemui.mjs';
const testPath='packages/os/scripts/android/sense.test.mjs';

/** Apply the reviewed Node 26 copy fix without writing to the pinned checkout. */
function reviewedSystemuiSources(){
 const upstream=upstreamNativeSource(root);
 const manifestFile=path.join(root,'patches/eliza/sense-systemui-node26-manifest.json');
 const patchFile=path.join(root,'patches/eliza/sense-systemui-node26.patch');
 for(const file of [manifestFile,patchFile])if(!fs.lstatSync(file).isFile()||fs.realpathSync(file)!==file)throw Error('Nonregular SystemUI source patch');
 const manifest=JSON.parse(fs.readFileSync(manifestFile)),patch=fs.readFileSync(patchFile);
 if(manifest.schema!==1||manifest.baseCommit!==upstream.pin||sha(patch)!==manifest.patchSha256||
   JSON.stringify(manifest.files?.map(file=>file.path))!==JSON.stringify([modulePath,testPath]))throw Error('SystemUI source patch admission mismatch');
 const headers=patch.toString().split('\n').filter(line=>line.startsWith('--- ')||line.startsWith('+++ '));
 if(JSON.stringify(headers)!==JSON.stringify([modulePath,testPath].flatMap(file=>['--- a/'+file,'+++ b/'+file])))throw Error('SystemUI source patch target mismatch');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-systemui-source-'));
 try{
  for(const entry of manifest.files){
   const source=upstream.read(entry.path).get(entry.path);
   if(source.sha256!==entry.beforeSha256||!/^[a-f0-9]{64}$/.test(entry.afterSha256))throw Error('SystemUI source patch preimage mismatch');
   const target=path.join(temporary,entry.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,source.bytes);
  }
  execFileSync('git',['apply','--whitespace=error',patchFile],{cwd:temporary,stdio:'pipe',timeout:30000});
  return new Map(manifest.files.map(entry=>{
   const bytes=fs.readFileSync(path.join(temporary,entry.path));
   if(sha(bytes)!==entry.afterSha256)throw Error('SystemUI source patch postimage mismatch');
   // Preserve the real module URL so upstream's import.meta-based asset paths stay exact.
   const url=pathToFileURL(path.join(upstream.directory,entry.path));url.searchParams.set('alphaSourcePatch',manifest.patchSha256);
   return [entry.path,{url:url.href,source:bytes.toString()}];
  }));
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
const sources=reviewedSystemuiSources();
async function importReviewedSystemui(filename){
 const hooks=registerHooks({
  resolve(specifier,context,nextResolve){
   if(context.parentURL===sources.get(testPath).url&&specifier==='./sense-systemui.mjs')return {url:sources.get(modulePath).url,shortCircuit:true};
   return nextResolve(specifier,context);
  },
  load(url,context,nextLoad){
   const entry=[...sources.values()].find(source=>source.url===url);
   return entry?{format:'module',source:entry.source,shortCircuit:true}:nextLoad(url,context);
  },
 });
 try{return await import(sources.get(filename).url);}finally{hooks.deregister();}
}
const {prepareListenerSystemui:prepare,verifyListenerSystemui:verify}=await importReviewedSystemui(modulePath);
/** Run the shared SystemUI tests with the same reviewed source used by this CLI. */
export const loadListenerSystemuiTests=()=>importReviewedSystemui(testPath);
export function prepareListenerSystemui(source,output,bundle='ops'){return prepare(source,output,bundle);}
export function verifyListenerSystemui(source,state='before',bundle='ops'){return verify(source,state,bundle);}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const args=process.argv.slice(2),source=args[args.indexOf('--source')+1];
 if(!args.includes('--source')||!source)throw Error('Use --source AOSP_ROOT [--chip | --assist] [--output NEW_OVERLAY | --after]');
 if(args.includes('--chip')&&args.includes('--assist'))throw Error('Choose one SystemUI bundle');
 const bundle=args.includes('--chip')?'chip':args.includes('--assist')?'assist':'ops',output=args.includes('--output')?args[args.indexOf('--output')+1]:null;
 if(args.includes('--output')&&(!output||output.startsWith('--')))throw Error('--output needs a new directory');
 if(output&&args.includes('--after'))throw Error('--output requires unpatched source');
 console.log(JSON.stringify(output?prepareListenerSystemui(source,path.resolve(output),bundle):verifyListenerSystemui(source,args.includes('--after')?'after':'before',bundle),null,2));
}
