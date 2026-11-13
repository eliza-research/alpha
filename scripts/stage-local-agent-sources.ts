import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {sourceDirectory, verifySource} from './local-agent-source.ts';
import {readUpstreamPin} from './upstream-pin.ts';
import {RESIDENT_HOST_CLASSES,stageResidentHostSources} from '../vendor/eliza/packages/app/scripts/mobile/android/resident-host-sources.mjs';
const root=path.resolve(import.meta.dirname,'..');
const upstream=path.join(root,'vendor/eliza');
const pin=readUpstreamPin(root).commit;
if(execFileSync('git',['-C',upstream,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!==pin)throw Error('Unexpected native runtime source pin');
const identity=JSON.parse(fs.readFileSync(path.join(root,'app.config.json'),'utf8')).appId;
if(!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(identity))throw Error('Invalid application identity');
// All shared native code comes directly from the same reviewed upstream commit.
const runtimeSource=sourceDirectory(root);
if(!fs.existsSync(path.join(runtimeSource,'.alpha-runtime-source.json')))throw Error(`Prepared runtime source ${path.relative(root,runtimeSource)} is missing. Run bun run android:build:local (distributable APKs) or bun run agent:prepare first.`);
verifySource(runtimeSource,pin);
// Upstream owns the rewrite anchors; android/consumer-host.json supplies Alpha's installed
// identities (sockets, secure-store route, notification resources, environment and lifecycle
// hooks) and the shared notification classes Alpha compiles beside the resident runtime.
const {residentHost}=JSON.parse(fs.readFileSync(path.join(root,'android/consumer-host.json'),'utf8'));
const parent=path.join(root,'android/app/build/generated');
const published=path.join(parent,'local-agent');
fs.mkdirSync(parent,{recursive:true});
const transaction=fs.mkdtempSync(path.join(parent,'.local-agent-stage-'));
const candidate=path.join(transaction,'candidate');
const previous=path.join(transaction,'previous');
let preservePrevious=false;
let count;
try{
 const staged=stageResidentHostSources({
  sourceRoot:runtimeSource,
  output:path.join(candidate,'java'),
  identity:{
   packageName:identity,
   sockets:residentHost.sockets,
   notification:residentHost.notification,
   environmentHook:residentHost.environmentHook,
   lifecycleHooks:residentHost.lifecycleHooks,
  },
  classes:[...RESIDENT_HOST_CLASSES,...residentHost.classes],
  helpers:residentHost.helpers,
 });
 const manifest={pin,identity,runtimeSource:{commit:pin},patches:[],files:staged.files.map(row=>({
  path:row.path,
  generatedPath:path.join(path.relative(root,published),path.relative(candidate,row.generatedFile)),
  sourceSha256:row.sourceSha256,
  sha256:row.sourceSha256,
  generatedSha256:row.generatedSha256,
 }))};
 fs.writeFileSync(path.join(candidate,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 // Under the serial Gradle producer, publish the tree and its receipt together.
 const existing=fs.lstatSync(published,{throwIfNoEntry:false});
 if(existing){
  if(!existing.isDirectory()||fs.readdirSync(published).some(name=>name!=='java'&&name!=='source-manifest.json'))
   throw Error('Unexpected resident Java staging directory contents');
  fs.renameSync(published,previous);
  preservePrevious=true;
 }
 try{fs.renameSync(candidate,published);}
 catch(error){
  if(preservePrevious){
   try{
    fs.renameSync(previous,published);
    preservePrevious=false;
   }catch(restoreError){
    const stranded=new AggregateError([error,restoreError],`Resident Java publication and restore failed. Previous output retained at ${previous}`);
    // Bun reports an uncaught AggregateError by its members only; the retained path must reach the operator.
    console.error(`${stranded.name}: ${stranded.message}`);
    throw stranded;
   }
  }
  throw error;
 }
 preservePrevious=false;
 count=manifest.files.length;
}finally{
 if(!preservePrevious)fs.rmSync(transaction,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
console.log(`Generated ${count} pinned local-agent sources for ${identity}`);
