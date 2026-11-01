import test from 'node:test';
import {buildSync} from 'esbuild';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {prepareClientFeatures, CLIENT_FEATURE_PATHS} from '../scripts/prepare-client-features.mjs';
function fixture(run) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-client-source-'));
 const vendor=path.join(root,'vendor/eliza');fs.mkdirSync(vendor,{recursive:true});
 const git=args=>execFileSync('git',['-C',vendor,...args],{encoding:'utf8'}).trim();
 try {
  git(['init','-q']);
  for(const prefix of CLIENT_FEATURE_PATHS) {
   const file=path.join(vendor,path.extname(prefix)?prefix:prefix+'/fixture.ts');
   fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'export const value = 1;\n');
  }
  // The development launcher imports the shared verifier through its product adapter.
  for(const name of ['immutable-workspace-source.mjs','committed-source.mjs']) {
   const relative=`packages/app/scripts/lib/${name}`,target=path.join(vendor,relative);
   fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join('vendor/eliza',relative),target);
  }
  git(['add','.']);git(['-c','user.name=Source fixture','-c','user.email=fixture@example.invalid','commit','-qm','Fixture']);
  const commit=git(['rev-parse','HEAD']);fs.writeFileSync(path.join(root,'upstream.lock.json'),JSON.stringify({commit}));
  return run({root,vendor,commit,git});
 } finally {fs.rmSync(root,{recursive:true,force:true});}
}
test('prepared client source repairs changed, missing and unexpected cached files',()=>fixture(({root,commit})=>{
 const source=prepareClientFeatures({root,projectVoice:false}),stamp=JSON.parse(fs.readFileSync(path.join(source,'.source.json'))),file=Object.keys(stamp.files)[0],original=fs.readFileSync(path.join(source,file));
 fs.writeFileSync(path.join(source,file),'corrupt');fs.writeFileSync(path.join(source,'unexpected.ts'),'unreviewed');
 assert.equal(prepareClientFeatures({root,projectVoice:false}),source);assert.deepEqual(fs.readFileSync(path.join(source,file)),original);assert.equal(fs.existsSync(path.join(source,'unexpected.ts')),false);
 fs.unlinkSync(path.join(source,file));prepareClientFeatures({root,projectVoice:false});assert.deepEqual(fs.readFileSync(path.join(source,file)),original);assert.equal(stamp.baseCommit,commit);
}));
test('client source rejects changed pin and upstream content without replacing its cache',()=>fixture(({root,vendor,commit})=>{
 const source=prepareClientFeatures({root,projectVoice:false}),stamp=fs.readFileSync(path.join(source,'.source.json'));
 fs.writeFileSync(path.join(root,'upstream.lock.json'),JSON.stringify({commit:'0'.repeat(40)}));assert.throws(()=>prepareClientFeatures({root,projectVoice:false}),/Unexpected upstream source pin/);
 fs.writeFileSync(path.join(root,'upstream.lock.json'),JSON.stringify({commit}));
 fs.appendFileSync(path.join(vendor,CLIENT_FEATURE_PATHS[0]),'corrupt');assert.throws(()=>prepareClientFeatures({root,projectVoice:false}),/dirty|drift/);assert.deepEqual(fs.readFileSync(path.join(source,'.source.json')),stamp);
}));
test('client source refuses unknown directories and cache symlinks',()=>fixture(({root})=>{
 const source=path.join(root,'.eliza/client-features');fs.mkdirSync(source,{recursive:true});fs.writeFileSync(path.join(source,'keep'),'owned elsewhere');assert.throws(()=>prepareClientFeatures({root,projectVoice:false}),/unrecognized/);assert.equal(fs.readFileSync(path.join(source,'keep'),'utf8'),'owned elsewhere');
 fs.rmSync(source,{recursive:true});prepareClientFeatures({root,projectVoice:false});fs.symlinkSync(path.join(root,'upstream.lock.json'),path.join(source,'unexpected-link'));assert.throws(()=>prepareClientFeatures({root,projectVoice:false}),/Symlink/);assert.equal(fs.existsSync(path.join(root,'upstream.lock.json')),true);
}));
test('client source cannot follow a linked staging parent',()=>fixture(({root})=>{
 const outside=path.join(root,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'keep'),'retained');fs.symlinkSync(outside,path.join(root,'.eliza'));assert.throws(()=>prepareClientFeatures({root,projectVoice:false}),/Nonregular/);assert.deepEqual(fs.readdirSync(outside),['keep']);
}));
test('client source rejects committed symlinks and missing source groups',()=>fixture(({root,vendor,git})=>{
 const file=path.join(vendor,CLIENT_FEATURE_PATHS[0]);fs.unlinkSync(file);fs.symlinkSync('../../outside',file);
 git(['add','.']);git(['-c','user.name=Source fixture','-c','user.email=fixture@example.invalid','commit','-qm','Symlink']);
 fs.writeFileSync(path.join(root,'upstream.lock.json'),JSON.stringify({commit:git(['rev-parse','HEAD'])}));assert.throws(()=>prepareClientFeatures({root,projectVoice:false}),/Nonregular upstream/);
 fs.unlinkSync(file);git(['add','.']);git(['-c','user.name=Source fixture','-c','user.email=fixture@example.invalid','commit','-qm','Missing source']);
 fs.writeFileSync(path.join(root,'upstream.lock.json'),JSON.stringify({commit:git(['rev-parse','HEAD'])}));assert.throws(()=>prepareClientFeatures({root,projectVoice:false}),/Missing upstream source/);
}));
test('direct local development launcher prepares a clean client tree before starting services',()=>fixture(({root,commit})=>{
 for(const file of ['scripts/dev-local.mjs','scripts/dev-speech-settings.mjs','scripts/speech-env.mjs','scripts/local-agent-source.mjs','scripts/copy-file-clone.mjs','scripts/prepare-client-features.mjs','scripts/upstream-native-source.mjs']){const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target);}
 // The generic copier fixture explicitly tests the non-voice projection path.
 const prep=path.join(root,'scripts/prepare-client-features.mjs');fs.writeFileSync(prep,fs.readFileSync(prep,'utf8').replace('projectVoice = true','projectVoice = false'));
 const result=spawnSync(process.execPath,[path.join(root,'scripts/dev-local.mjs')],{cwd:root,env:{...process.env,ALPHA_REMOTE_PORT:'0',ALPHA_REMOTE_PROFILE:path.join(root,'empty-profile')},encoding:'utf8',timeout:20000});
 assert.equal(result.status,1);assert.match(result.stderr,/Invalid local agent port/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'.eliza/client-features/.source.json'))).baseCommit,commit);
 // Development uses authenticated upstream source without a patch cache.
 assert.equal(fs.existsSync(path.join(root,'.eliza/patched')),false);
}));

test('actual pinned client features retain shared voice source unchanged and exclude dashboard transport',()=>{
 const source=prepareClientFeatures(),stamp=JSON.parse(fs.readFileSync(path.join(source,'.source.json')));
assert.equal(stamp.baseCommit,JSON.parse(fs.readFileSync('upstream.lock.json','utf8')).commit);assert.equal(stamp.projectionVersion,12);
 // Node consumers (the Vite config bundle and backend hosts) load linked-sync through cloud-protocol.
 for(const file of ['google-sync-port.ts','sync-controller.ts','linked-store.ts']){
  const name='plugins/plugin-calendar/src/linked-sync/'+file,projected=fs.readFileSync(path.join(source,name),'utf8'),original=fs.readFileSync(path.join('vendor/eliza',name),'utf8');
  assert.doesNotMatch(projected,/["']@elizaos\/contracts["']/,name+' has no package-name contracts import');
  assert.equal(projected,original.replace('} from "@elizaos/contracts";','} from "../../../../packages/contracts/src/calendar-linked-sync.ts";'),name+' differs from the pinned SDK only in that specifier');
 }
 // Renderer types come from upstream leaf entries copied byte-for-byte; no declaration is extracted.
 for(const name of ['alpha-voice-core-types.ts','alpha-client-fetch-types.ts']) assert.equal(fs.existsSync(path.join(source,name)),false,name+' is no longer projected');
 for(const file of ['packages/core/src/schema-types.ts','packages/core/src/types/json.ts','packages/core/src/types/schema.ts','packages/core/src/types/surface-manifest.ts','packages/core/src/types/view-capability.ts','packages/core/src/types/view-kind.ts','packages/ui/src/api/transport.ts','plugins/plugin-calendar/src/meetings/auto-join-types.ts','plugins/plugin-calendar/src/api/calendar-api.ts','plugins/plugin-notes/src/types.ts','plugins/plugin-notes/src/capabilities.ts','plugins/plugin-notes/src/client/notes-api.ts']){
  assert.equal(stamp.sourceFiles[file],stamp.files[file],file+' is not projected');
  assert.deepEqual(fs.readFileSync(path.join(source,file)),fs.readFileSync(path.join('vendor/eliza',file)),file+' is copied exactly');
 }
 for(const file of ['packages/core/src/types/plugin.ts','packages/core/src/types/components.ts','packages/core/src/types/model.ts','packages/core/src/types/primitives.ts','packages/ui/src/api/client-base.ts','plugins/plugin-calendar/src/meetings/auto-join-settings.ts']){
  assert.equal(stamp.files[file],undefined,file+' (runtime or class module) is not shipped to the browser');
 }
 const leafBundle=buildSync({entryPoints:[path.join(source,'plugins/plugin-notes/src/client/notes-api.ts')],bundle:true,write:false,platform:'browser',format:'esm',metafile:true,alias:{'@elizaos/core/schema-types':path.join(source,'packages/core/src/schema-types.ts'),'@elizaos/ui/api/transport':path.join(source,'packages/ui/src/api/transport.ts')}});
 assert.equal(Object.keys(leafBundle.metafile.inputs).some(file=>/client-base|core\/src\/types\/(plugin|components|model)\.ts/.test(file)),false,'Notes client loads no root core or ElizaClient module');
 // The shared mobile entry adds only the page registry, its store host, the application catalog
 // and MobileApplication (elizaOS/eliza#38276), copied exactly; it never reaches the app-shell barrel.
 const shellBundle=buildSync({entryPoints:[path.join(source,'packages/ui/src/mobile-shell/index.ts')],bundle:true,write:false,platform:'browser',format:'esm',metafile:true,external:['react','react/jsx-runtime'],alias:{'@elizaos/core/schema-types':path.join(source,'packages/core/src/schema-types.ts'),'@elizaos/capacitor-system/launcher':path.join(source,'plugins/plugin-native-system/src/client/launcher.ts'),'@elizaos/contracts':path.join(source,'client-contracts.ts')}});
 const shellInputs=Object.keys(shellBundle.metafile.inputs).map(file=>path.relative(source,path.resolve(file)));
 assert.deepEqual(shellInputs.filter(file=>!stamp.files[file]),[],'the mobile entry loads only projected files');
 assert.deepEqual(shellInputs.filter(file=>file.startsWith('packages/ui/src/')&&!file.startsWith('packages/ui/src/mobile-shell/')).sort(),['packages/ui/src/app-shell-pages.ts','packages/ui/src/components/pages/InstalledAppsLauncher.tsx','packages/ui/src/config/theme.ts','packages/ui/src/registry-host.ts'],'the mobile entry reaches no other shared UI module');
 for(const file of ['packages/ui/src/app-shell-pages.ts','packages/ui/src/registry-host.ts','packages/ui/src/mobile-shell/application-catalog.ts','packages/ui/src/mobile-shell/MobileApplication.tsx','packages/ui/src/mobile-shell/view-policy.ts']){
  assert.equal(stamp.sourceFiles[file],stamp.files[file],file+' is not projected');
  assert.deepEqual(fs.readFileSync(path.join(source,file)),fs.readFileSync(path.join('vendor/eliza',file)),file+' is copied exactly');
 }
 const relayPath='plugins/plugin-maps/src/client/navigation-relay.ts';
 // The WebView signal shim is upstream (elizaOS/eliza#37315); the relay is carried unchanged.
 assert.equal(stamp.sourceFiles[relayPath],stamp.files[relayPath]);
 assert.match(fs.readFileSync(path.join(source,relayPath),'utf8'),/host\.anySignal \? host\.anySignal\(signals\)/);
 const mapPath='plugins/plugin-maps/src/client/map-plane.ts';
 assert.equal(stamp.sourceFiles[mapPath],stamp.files[mapPath]);
 assert.match(fs.readFileSync(path.join(source,mapPath),'utf8'),/export interface GlobalBasemap/);
 const calendarPath='packages/contracts/src/calendar-linked-sync.ts';
 assert.equal(stamp.sourceFiles[calendarPath],stamp.files[calendarPath]);
 const calendarBundle=buildSync({entryPoints:[path.join(source,calendarPath)],bundle:true,write:false,platform:'browser',format:'esm',metafile:true});
 assert.equal(Object.keys(calendarBundle.metafile.inputs).length,1,'shared Calendar reconciliation has no Node, SQL, or runtime dependency');
 const voiceFiles=['packages/ui/src/voice/voice-session-client-core.ts','packages/ui/src/voice/voice-session-status.ts','packages/core/src/logging.ts','packages/core/src/view-interaction.ts','packages/host/src/voice/ui-context.ts'];
 for(const file of voiceFiles){
  assert.equal(stamp.sourceFiles[file],stamp.files[file],file+' is not projected');
  assert.deepEqual(fs.readFileSync(path.join(source,file)),fs.readFileSync(path.join('vendor/eliza',file)),file+' is copied exactly');
 }
 // The shared voice sessions differ from upstream only in the one random-id value import, so
 // plain Node can load them (it does not map ./random-id.js to the copied .ts source).
 for(const file of ['packages/voice/src/voice-assistant-session.ts','packages/voice/src/live-voice-session.ts']){
  const upstream=fs.readFileSync(path.join('vendor/eliza',file),'utf8'),projected=fs.readFileSync(path.join(source,file),'utf8');
  assert.notEqual(stamp.sourceFiles[file],stamp.files[file],file+' is projected');
  assert.equal(projected,upstream.replace('import { randomId } from "./random-id.js";','import { randomId } from "./random-id.ts";'));
 }
 assert.deepEqual(fs.readFileSync(path.join(source,'packages/voice/src/random-id.ts')),fs.readFileSync('vendor/eliza/packages/voice/src/random-id.ts'));
 const client=voiceFiles[0],text=fs.readFileSync(path.join(source,client),'utf8');
 assert.doesNotMatch(text,/import\("\.\/voice-session-fetch"\)/);
 for(const file of ['packages/core/src/logger.ts','packages/host/src/voice.ts','packages/ui/src/voice/voice-chat-types.ts','packages/ui/src/voice/voice-session-client.ts','packages/ui/src/voice/voice-session-fetch.ts']){
  assert.equal(stamp.sourceFiles[file],undefined);assert.equal(stamp.files[file],undefined);
  assert.equal(fs.existsSync(path.join(source,file)),false,file+' is not staged');
 }

 const bundle=buildSync({entryPoints:[path.join(source,client)],bundle:true,write:false,platform:'browser',format:'esm',metafile:true,alias:{
  '@elizaos/host/voice/ui-context':path.join(source,'packages/host/src/voice/ui-context.ts'),
  '@elizaos/core/view-interaction':path.join(source,'packages/core/src/view-interaction.ts'),
  '@elizaos/core/logging':path.join(source,'packages/core/src/logging.ts'),
  '@elizaos/core/speech':path.join(source,'packages/core/src/speech.ts'),
  '@elizaos/core/protocol':path.join(source,'alpha-voice-core-protocol.ts'),
 }});
 assert.ok(bundle.outputFiles[0].contents.length>10000);
 assert.equal(Object.keys(bundle.metafile.inputs).some(file=>/csrf-client|steward|persistence|core\/src\/logger|api\//.test(file)),false);

});
