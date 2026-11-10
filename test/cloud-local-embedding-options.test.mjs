import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {parseBuildArgs,gradleFlagArgs,consumerBuildOptions,buildEnv} from '../scripts/build-android.ts';
const stage=readFileSync(new URL('../scripts/stage-local-agent-runtime.ts',import.meta.url),'utf8');
const start=stage.indexOf('export function runtimeProfileSelection('),end=stage.indexOf('\nfunction stageLocalAgentRuntime',start);
const select=new Function(stripTypeScriptTypes(stage.slice(start,end).replace('export ', ''),{mode:'strip'})+';return runtimeProfileSelection;')();
test('local embeddings is explicit and keeps the Cloud profile',()=>{
 const options=parseBuildArgs(['--runtime-profile=cloud','--local-embeddings']);
 assert.equal(options.runtimeProfile,'cloud');assert.equal(options.localEmbeddings,true);
 assert.ok(gradleFlagArgs(options).includes('-PELIZA_LOCAL_EMBEDDINGS=1'));
 assert.ok(gradleFlagArgs(options).includes('-PELIZA_RUNTIME_PROFILE=cloud'));
 assert.equal(buildEnv({ELIZA_LOCAL_EMBEDDINGS:'1',ORG_GRADLE_PROJECT_ELIZA_LOCAL_EMBEDDINGS:'1'},parseBuildArgs(['--runtime-profile=cloud'])).ELIZA_LOCAL_EMBEDDINGS,undefined);
 assert.equal(buildEnv({ORG_GRADLE_PROJECT_ELIZA_LOCAL_EMBEDDINGS:'1'},parseBuildArgs(['--runtime-profile=cloud'])).ORG_GRADLE_PROJECT_ELIZA_LOCAL_EMBEDDINGS,undefined);
 const build=consumerBuildOptions(options,{},process.cwd());
 assert.equal(build.record.metadata.localEmbeddings,true);
 assert.ok(build.verify.args.includes('--local-embeddings'));
});
test('ordinary Cloud builds remain model-free and do not implicitly enable the capability',()=>{
 const options=parseBuildArgs(['--runtime-profile=cloud']);assert.equal(options.localEmbeddings,undefined);
 assert.ok(!gradleFlagArgs(options).some(x=>x.includes('LOCAL_EMBEDDINGS')));
 assert.deepEqual(select(['--runtime-profile=cloud']),{runtimeProfile:'cloud',localEmbeddings:false});
});
test('staging accepts only Cloud plus the explicit embedding capability',()=>{
 assert.deepEqual(select(['--local-embeddings','--runtime-profile=cloud']),{runtimeProfile:'cloud',localEmbeddings:true});
 assert.throws(()=>select(['--local-embeddings']),/requires the Cloud profile/);
 assert.throws(()=>select(['--runtime-profile=other']),/Unknown runtime profile/);
});
test('build rejects implicit, mock and unpackaged capability combinations',()=>{
 assert.throws(()=>parseBuildArgs(['--local-embeddings']),/requires the Cloud profile/);
 for(const bad of ['--test-mocks','--allow-unpackaged-runtime'])assert.throws(()=>parseBuildArgs(['--runtime-profile=cloud','--local-embeddings',bad]),/genuine packaged resident/);
});
