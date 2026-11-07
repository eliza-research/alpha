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

test('voice projection refuses an unreviewed pin by default',()=>fixture(({root})=>{
 assert.throws(()=>prepareClientFeatures({root}),/Review voice projections/);
 assert.equal(fs.existsSync(path.join(root,'.eliza/client-features')),false);
}));
test('actual pinned host projections authenticate source/output hashes and exclude dashboard transport',()=>{
 const source=prepareClientFeatures(),stamp=JSON.parse(fs.readFileSync(path.join(source,'.source.json')));
assert.equal(stamp.baseCommit,'b25d8aef2916385c571f4367e099809254fde0bb');assert.equal(stamp.projectionVersion,7);
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
 const client='packages/ui/src/voice/voice-session-client.ts',text=fs.readFileSync(path.join(source,client),'utf8');
 // The app entry's dashboard-transport fallback is dropped; upstream's core client requires the host fetch.
 assert.equal(text,'export * from "./voice-session-client-core";\n');
 const core=fs.readFileSync(path.join(source,'packages/ui/src/voice/voice-session-client-core.ts'),'utf8');
 assert.match(core,/\n  fetch: \(url: string, init\?: RequestInit\) => Promise<Response>;/);assert.doesNotMatch(core,/voice-session-fetch/);
 assert.notEqual(stamp.sourceFiles[client],stamp.files[client]);
 assert.ok(stamp.sourceFiles['packages/core/src/logger.ts']);assert.equal(stamp.files['packages/core/src/logger.ts'],undefined);
 assert.equal(fs.existsSync(path.join(source,'packages/ui/src/voice/voice-session-fetch.ts')),false);
 const bundle=buildSync({entryPoints:[path.join(source,client)],bundle:true,write:false,platform:'browser',format:'esm',metafile:true,alias:{
  '@elizaos/host/protocol':path.join(source,'packages/host/src/voice.ts'),
  '@elizaos/core/protocol':path.join(source,'alpha-voice-core-protocol.ts'),
  '@elizaos/core':path.join(source,'alpha-voice-core-types.ts'),
  '@elizaos/core/logging':path.join(source,'packages/core/src/logging.ts'),
  '@elizaos/core/view-interaction':path.join(source,'packages/core/src/view-interaction.ts'),
  '@elizaos/core/speech':path.join(source,'packages/core/src/speech.ts'),
  '@elizaos/host/voice/ui-context':path.join(source,'packages/host/src/voice/ui-context.ts'),
 }});
 assert.ok(bundle.outputFiles[0].contents.length>10000);
 assert.equal(Object.keys(bundle.metafile.inputs).some(file=>/csrf-client|steward|persistence|core\/src\/logger|api\//.test(file)),false);

});
