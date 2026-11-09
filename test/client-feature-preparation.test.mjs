import test from 'node:test';
import {createHash} from 'node:crypto';
import {buildSync} from 'esbuild';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawn, spawnSync} from 'node:child_process';
import {clientSpeechPatch} from '../scripts/client-speech-patch.mjs';
import {upstreamNativeSource} from '../scripts/upstream-native-source.mjs';
import {git as fixtureGit} from './fixtures/git-fixture.mjs';
import {prepareClientFeatures, CLIENT_FEATURE_PATHS, satisfiesRange} from '../scripts/prepare-client-features.mjs';
function fixture(run) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-client-source-'));
 const vendor=path.join(root,'vendor/eliza');fs.mkdirSync(vendor,{recursive:true});
 const git=args=>fixtureGit(vendor,...args),cleanup=()=>fs.rmSync(root,{recursive:true,force:true});
 let pending=false;
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
  const result=run({root,vendor,commit,git});
  if(result?.then){pending=true;return result.finally(cleanup);}
  return result;
 } finally {if(!pending)cleanup();}
}
test('prepared client source repairs changed, missing and unexpected cached files',()=>fixture(({root,commit})=>{
 const source=prepareClientFeatures({root,projectVoice:false}),stamp=JSON.parse(fs.readFileSync(path.join(source,'.source.json'))),file=Object.keys(stamp.files)[0],original=fs.readFileSync(path.join(source,file));
 fs.writeFileSync(path.join(source,file),'corrupt');fs.writeFileSync(path.join(source,'unexpected.ts'),'unreviewed');
 assert.equal(prepareClientFeatures({root,projectVoice:false}),source);assert.deepEqual(fs.readFileSync(path.join(source,file)),original);assert.equal(fs.existsSync(path.join(source,'unexpected.ts')),false);
 fs.unlinkSync(path.join(source,file));prepareClientFeatures({root,projectVoice:false});assert.deepEqual(fs.readFileSync(path.join(source,file)),original);assert.equal(stamp.baseCommit,commit);
}));
test('concurrent preparers after a source change all succeed and leave one authenticated tree',()=>fixture(async({root,vendor,git})=>{
 prepareClientFeatures({root,projectVoice:false});
 fs.appendFileSync(path.join(vendor,CLIENT_FEATURE_PATHS[0]),'export const changed = 2;\n');
 git(['add','.']);git(['-c','user.name=Source fixture','-c','user.email=fixture@example.invalid','commit','-qm','Change']);
 const commit=git(['rev-parse','HEAD']);fs.writeFileSync(path.join(root,'upstream.lock.json'),JSON.stringify({commit}));
 const script=`import {prepareClientFeatures} from ${JSON.stringify(path.resolve('scripts/prepare-client-features.mjs'))};prepareClientFeatures({root:${JSON.stringify(root)},projectVoice:false});`;
 const run=()=>new Promise(resolve=>{const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});child.on('close',status=>resolve({status,stderr}));});
 for(const result of await Promise.all(Array.from({length:12},run))) assert.equal(result.status,0,result.stderr);
 const source=path.join(root,'.eliza/client-features'),stamp=JSON.parse(fs.readFileSync(path.join(source,'.source.json')));
 assert.equal(stamp.baseCommit,commit);assert.match(fs.readFileSync(path.join(source,CLIENT_FEATURE_PATHS[0]),'utf8'),/changed = 2/);
 assert.equal(prepareClientFeatures({root,projectVoice:false,check:true}),source);
 assert.deepEqual(fs.readdirSync(path.join(root,'.eliza')),['client-features'],'no staging or set-aside tree is left behind');
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
test('dependency ranges follow npm caret, tilde, exact, comparator and union rules',()=>{
 for(const [version,range] of [['6.16.4','^6.16.0'],['0.7.9','^0.7.1'],['1.2.9','~1.2.3'],['19.3.1','19.3.1'],['8.5.2','>=8.3.1 <9'],['5.0.0','^4.0.0 || ^5.0.0'],['3.1.0','*'],['2.4.0','2.x']])assert.equal(satisfiesRange(version,range),true,version+' satisfies '+range);
 for(const [version,range] of [['6.11.2','^6.16.0'],['0.8.0','^0.7.1'],['1.3.0','~1.2.3'],['19.3.0','19.3.1'],['8.5.2','8.4.0'],['9.0.0','>=8.3.1 <9']])assert.equal(satisfiesRange(version,range),false,version+' does not satisfy '+range);
 assert.throws(()=>satisfiesRange('1.0.0','workspace:*'),/Unsupported dependency range/);
});
test('copied client features fail on an unmet dependency range unless a reviewed exception names it',()=>fixture(({root,vendor,git})=>{
 fs.writeFileSync(path.join(vendor,'plugins/plugin-maps/package.json'),JSON.stringify({peerDependencies:{'maplibre-gl':'^6.16.0',react:'^19.0.0'},devDependencies:{typescript:'^9.0.0'}}));
 git(['add','.']);git(['commit','-qm','Ranges']);
 fs.writeFileSync(path.join(root,'upstream.lock.json'),JSON.stringify({commit:git(['rev-parse','HEAD'])}));
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({dependencies:{'maplibre-gl':'6.11.2',react:'19.3.0'},devDependencies:{typescript:'7.0.2'}}));
 for(const [name,version] of [['maplibre-gl','6.11.2'],['react','19.3.0']]){fs.mkdirSync(path.join(root,'node_modules',name),{recursive:true});fs.writeFileSync(path.join(root,'node_modules',name,'package.json'),JSON.stringify({version}));}
 assert.throws(()=>prepareClientFeatures({root,projectVoice:false}),error=>/plugins\/plugin-maps: maplibre-gl \^6\.16\.0, installed 6\.11\.2/.test(error.message)&&!/react|typescript/.test(error.message));
 assert.equal(fs.existsSync(path.join(root,'.eliza/client-features')),false,'nothing is prepared over an unmet range');
 const exception={package:'plugins/plugin-maps',dependency:'maplibre-gl',range:'^6.16.0',installed:'6.11.2',reason:'Map bump needs its own UI check.'};
 fs.mkdirSync(path.join(root,'docs'));fs.writeFileSync(path.join(root,'docs/client-feature-dependency-exceptions.json'),JSON.stringify({exceptions:[exception]}));
 const printed=[];prepareClientFeatures({root,projectVoice:false,log:line=>printed.push(line)});
 assert.deepEqual(printed,['Client feature dependency exception: plugins/plugin-maps maplibre-gl ^6.16.0, installed 6.11.2: Map bump needs its own UI check.']);
 // Once the installed version satisfies the range the exception is stale and must be removed.
 fs.writeFileSync(path.join(root,'node_modules/maplibre-gl/package.json'),JSON.stringify({version:'6.16.0'}));
 assert.throws(()=>prepareClientFeatures({root,projectVoice:false}),/Stale client feature dependency exceptions[^]*maplibre-gl/);
 fs.writeFileSync(path.join(root,'docs/client-feature-dependency-exceptions.json'),JSON.stringify({exceptions:[{...exception,reason:' '}]}));
 fs.writeFileSync(path.join(root,'node_modules/maplibre-gl/package.json'),JSON.stringify({version:'6.11.2'}));
 assert.throws(()=>prepareClientFeatures({root,projectVoice:false}),/exception has no reason: plugins\/plugin-maps maplibre-gl/);
}));
test('direct local development launcher prepares a clean client tree before starting services',()=>fixture(({root,commit})=>{
 for(const file of ['scripts/dev-local.mjs','scripts/dev-speech-settings.mjs','scripts/speech-env.mjs','scripts/local-agent-source.mjs','scripts/copy-file-clone.mjs','scripts/prepare-client-features.mjs','scripts/client-speech-patch.mjs','scripts/upstream-native-source.mjs']){const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target);}
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
 const scan='plugins/plugin-native-camera/src/scan-document.ts';
 assert.equal(stamp.sourceFiles[scan],stamp.files[scan],'Scan state is copied from the pinned shared owner without a product patch');
 assert.deepEqual(fs.readFileSync(path.join(source,scan)),fs.readFileSync(path.join('vendor/eliza',scan)));
assert.equal(stamp.baseCommit,JSON.parse(fs.readFileSync('upstream.lock.json','utf8')).commit);assert.equal(stamp.projectionVersion,12);
 // Node consumers (the Vite config bundle and backend hosts) load linked-sync through cloud-protocol.
 for(const file of ['google-sync-port.ts','sync-controller.ts','linked-store.ts']){
  const name='plugins/plugin-calendar/src/linked-sync/'+file,projected=fs.readFileSync(path.join(source,name),'utf8'),original=fs.readFileSync(path.join('vendor/eliza',name),'utf8');
  assert.doesNotMatch(projected,/["']@elizaos\/contracts["']/,name+' has no package-name contracts import');
  assert.equal(projected,original.replace('} from "@elizaos/contracts";','} from "../../../../packages/contracts/src/calendar-linked-sync.ts";'),name+' differs from the pinned SDK only in that specifier');
 }
 // Renderer types come from upstream leaf entries copied byte-for-byte; no declaration is extracted.
 // Upstream runs its own notes tests; Alpha copies none of them.
 assert.equal(fs.existsSync(path.join(source,'plugins/plugin-notes/test')),false);
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
 assert.equal(stamp.calendarSemanticPatch.beforeSha256,stamp.sourceFiles[calendarPath]);
 assert.equal(stamp.calendarSemanticPatch.afterSha256,stamp.files[calendarPath]);
 for(const [key,file] of [
  ['inboxConfirmationPatch','plugins/plugin-inbox/src/mailbox/review-controller.ts'],
  ['inboxCleanupPatch','plugins/plugin-inbox/src/mailbox/drafts-controller.ts'],
  ['crashErrorClassPatch','plugins/plugin-native-system/src/crash-log.ts'],
  ['launcherObserverPatch','plugins/plugin-native-system/src/client/launcher.ts'],
  ['launcherLegacyViewKeyPatch','packages/ui/src/mobile-shell/view-registry.ts'],
  ['screenFocusPriorityPatch','packages/ui/src/accessibility/screen-focus.ts'],
  ['appUpdateResumePatch','packages/ui/src/state/app-update-gate.ts'],
  ['launcherDrawerOwnershipPatch','packages/ui/src/mobile-shell/InstalledAppsGridDrawer.tsx'],
  ['filesListIdentityPatch','plugins/plugin-files/src/browser/files-browser-adapter.ts'],
  ['filesStorageQueryPatch','plugins/plugin-files/src/browser/storage-volume.ts'],
  ['filesStoragePlacementPatch','plugins/plugin-files/src/browser/files.ts'],
  ['photosWindowPatch','packages/ui/src/mobile-shell/photos-view.ts'],
  ['photosLibraryPresentationPatch','plugins/plugin-assistant/src/services/device-actions/photo-library-contract.ts'],
 ]){
  assert.equal(stamp[key].beforeSha256,stamp.sourceFiles[file]);
  assert.equal(stamp[key].afterSha256,stamp.files[file]);
  assert.notEqual(stamp.sourceFiles[file],stamp.files[file],file+' carries its reviewed patch');
 }
 const calendarBundle=buildSync({entryPoints:[path.join(source,calendarPath)],bundle:true,write:false,platform:'browser',format:'esm',metafile:true});
 assert.equal(Object.keys(calendarBundle.metafile.inputs).length,1,'shared Calendar reconciliation has no Node, SQL, or runtime dependency');
 const voiceFiles=['packages/ui/src/voice/voice-session-client-core.ts','packages/ui/src/voice/voice-session-status.ts','packages/core/src/logging.ts','packages/core/src/view-interaction.ts','packages/host/src/voice/ui-context.ts'];
 for(const file of voiceFiles){
  assert.equal(stamp.sourceFiles[file],stamp.files[file],file+' is not projected');
  assert.deepEqual(fs.readFileSync(path.join(source,file)),fs.readFileSync(path.join('vendor/eliza',file)),file+' is copied exactly');
 }
 // Authenticate the reviewed streaming patch before the random-id import projection.
 const patchedVoice=clientSpeechPatch(process.cwd(),upstreamNativeSource(process.cwd())).files;
 // Plain Node needs the copied .ts random-id import.
 for(const file of ['packages/voice/src/voice-assistant-session.ts','packages/voice/src/live-voice-session.ts']){
  const upstream=patchedVoice.get(file)?.bytes.toString()??fs.readFileSync(path.join('vendor/eliza',file),'utf8'),projected=fs.readFileSync(path.join(source,file),'utf8');
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


for(const [receipt,prefix,file] of [
 ['inboxConfirmationPatch','inbox-confirmation-client','plugins/plugin-inbox/src/mailbox/review-controller.ts'],
 ['inboxCleanupPatch','inbox-cleanup-client','plugins/plugin-inbox/src/mailbox/drafts-controller.ts'],
 ['crashErrorClassPatch','crash-error-class-client','plugins/plugin-native-system/src/crash-log.ts'],
 ['launcherObserverPatch','launcher-observer-client','plugins/plugin-native-system/src/client/launcher.ts'],
 ['launcherLegacyViewKeyPatch','launcher-legacy-view-key-client','packages/ui/src/mobile-shell/view-registry.ts'],
 ['screenFocusPriorityPatch','screen-focus-priority-client','packages/ui/src/accessibility/screen-focus.ts'],
 ['appUpdateResumePatch','app-update-resume-client','packages/ui/src/state/app-update-gate.ts'],
 ['launcherDrawerOwnershipPatch','launcher-drawer-ownership-client','packages/ui/src/mobile-shell/InstalledAppsGridDrawer.tsx'],
 ['filesListIdentityPatch','files-list-identity-client','plugins/plugin-files/src/browser/files-browser-adapter.ts'],
 ['filesStorageQueryPatch','files-storage-query-client','plugins/plugin-files/src/browser/storage-volume.ts'],
 ['photosWindowPatch','photos-window-client','packages/ui/src/mobile-shell/photos-view.ts'],
 ['photosLibraryPresentationPatch','photos-library-presentation-client','plugins/plugin-assistant/src/services/device-actions/photo-library-contract.ts'],
])test(`${prefix} requires its exact source, patch and target`,()=>fixture(({root,vendor,git})=>{
 const before='export const value = 1;\n',after='export const value = 2;\n';
 const digest=value=>createHash('sha256').update(value).digest('hex');
 const sourceFile=path.join(vendor,file);fs.mkdirSync(path.dirname(sourceFile),{recursive:true});fs.writeFileSync(sourceFile,before);
 git(['add','.']);git(['-c','user.name=Source fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','Target']);
 const commit=git(['rev-parse','HEAD']);fs.writeFileSync(path.join(root,'upstream.lock.json'),JSON.stringify({commit}));
 const patch=`--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n`;
 const patchRoot=path.join(root,'patches/eliza');fs.mkdirSync(patchRoot,{recursive:true});
 const patchFile=path.join(patchRoot,prefix+'.patch'),manifestFile=path.join(patchRoot,prefix+'-manifest.json');
 const manifest={schema:1,baseCommit:commit,path:file,beforeSha256:digest(before),afterSha256:digest(after),patchSha256:digest(patch)};
 const write=value=>fs.writeFileSync(manifestFile,JSON.stringify(value));
 fs.writeFileSync(patchFile,patch);write(manifest);
 const projected=prepareClientFeatures({root,projectVoice:false});
 assert.equal(fs.readFileSync(path.join(projected,file),'utf8'),after);
 const stamp=fs.readFileSync(path.join(projected,'.source.json'));
 assert.equal(JSON.parse(stamp)[receipt].afterSha256,digest(after));
 write({...manifest,beforeSha256:'0'.repeat(64)});
 assert.throws(()=>prepareClientFeatures({root,projectVoice:false}),/patch source mismatch/);
 write({...manifest,path:'unreviewed.ts'});
 assert.throws(()=>prepareClientFeatures({root,projectVoice:false}),/patch source mismatch/);
 write(manifest);fs.appendFileSync(patchFile,'changed');
 assert.throws(()=>prepareClientFeatures({root,projectVoice:false}),/patch digest or target mismatch/);
 assert.deepEqual(fs.readFileSync(path.join(projected,'.source.json')),stamp,'refused patches preserve the prior authenticated cache');
}));
