import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {sourceDirectory, verifySource} from './local-agent-source.mjs';
import {RESIDENT_HOST_CLASSES,stageResidentHostSources} from '../vendor/eliza/packages/app/scripts/mobile/android/resident-host-sources.mjs';
const root=path.resolve(import.meta.dirname,'..');
const upstream=path.join(root,'vendor/eliza');
const pin=JSON.parse(fs.readFileSync(path.join(root,'upstream.lock.json'),'utf8')).commit;
if(execFileSync('git',['-C',upstream,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!==pin)throw Error('Unexpected native runtime source pin');
const identity=JSON.parse(fs.readFileSync(path.join(root,'app.config.json'),'utf8')).appId;
if(!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(identity))throw Error('Invalid application identity');
// All shared native code comes directly from the same reviewed upstream commit.
const runtimeSource=sourceDirectory(root);
if(!fs.existsSync(path.join(runtimeSource,'.alpha-runtime-source.json')))throw Error(`Prepared runtime source ${path.relative(root,runtimeSource)} is missing. Run npm run android:build:local (distributable APKs) or npm run agent:prepare first.`);
verifySource(runtimeSource,pin);
// Upstream owns the rewrite anchors; android/consumer-host.json supplies Alpha's installed
// identities (sockets, secure-store route, notification resources, environment and lifecycle
// hooks) and the shared notification classes Alpha compiles beside the resident runtime.
const {residentHost}=JSON.parse(fs.readFileSync(path.join(root,'android/consumer-host.json'),'utf8'));
const output=path.join(root,'android/app/build/generated/local-agent/java');
fs.rmSync(output,{recursive:true,force:true});
const staged=stageResidentHostSources({sourceRoot:runtimeSource,output,identity:{packageName:identity,sockets:residentHost.sockets,notification:residentHost.notification,environmentHook:residentHost.environmentHook,lifecycleHooks:residentHost.lifecycleHooks},classes:[...RESIDENT_HOST_CLASSES,...residentHost.classes],helpers:residentHost.helpers});
const manifest={pin,identity,runtimeSource:{commit:pin},patches:[],files:staged.files.map(row=>({path:row.path,generatedPath:path.relative(root,row.generatedFile),sourceSha256:row.sourceSha256,sha256:row.sourceSha256,generatedSha256:row.generatedSha256}))};
fs.writeFileSync(path.join(root,'android/app/build/generated/local-agent/source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`Generated ${manifest.files.length} pinned local-agent sources for ${identity}`);
