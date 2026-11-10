import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {parseBuildArgs,gradleFlagArgs,consumerBuildOptions,buildEnv} from '../scripts/build-android.ts';
import {stagingArguments} from '../scripts/stage-local-agent-runtime.ts';
import {ONE_PROFILE_MESSAGE,refuseRemovedProfileFlags} from '../scripts/removed-profile-flags.ts';
import {preparedRuntimeProblems} from '../scripts/android-build-preflight.ts';
const read=file=>fs.readFileSync(file,'utf8');
const REMOVED=/There is one runtime profile now: remove --runtime-profile and --local-embeddings/;

// The build-time `native` and `cloud` profiles are one profile now: every build packages on-device
// speech and local embeddings (the former native packaging), and speech is routed at run time.
test('the removed profile options fail with one line everywhere they were accepted',()=>{
 for(const args of [['--runtime-profile=cloud'],['--runtime-profile=native'],['--runtime-profile','cloud'],['--local-embeddings'],['--test-mocks','--runtime-profile=cloud']]){
  assert.throws(()=>refuseRemovedProfileFlags(args),REMOVED);
  assert.throws(()=>parseBuildArgs(args),REMOVED);
 }
 for(const args of [['--runtime-profile=cloud'],['--local-embeddings'],['--local-embeddings','--runtime-profile=cloud']])assert.throws(()=>stagingArguments(args),REMOVED);
 assert.throws(()=>stagingArguments(['--other']),/Unknown option --other/);
 assert.doesNotThrow(()=>stagingArguments([]));
 assert.doesNotThrow(()=>refuseRemovedProfileFlags(['--test-mocks','--allow-unpackaged-runtime','--check']));
 assert.equal(ONE_PROFILE_MESSAGE.split('\n').length,1);
 // The command-line entry points say the same, before any work.
 for(const [script,args] of [['scripts/verify-apks.ts',['--runtime-profile=cloud']],['scripts/verify-apks.ts',['--local-embeddings']],['scripts/gradle-verification.ts',['--write','--runtime-profile=cloud']],['scripts/build-archive.ts',['--runtime-profile=cloud','test-results/never-created']],['scripts/stage-local-agent-runtime.ts',['--runtime-profile=cloud']],['scripts/android-build-preflight.ts',['--report','--runtime-profile=cloud']]]){
  const result=spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:60000});
  assert.notEqual(result.status,0,script);assert.match(result.stderr,REMOVED,script);
 }
 assert.equal(fs.existsSync('test-results/never-created'),false);
 const packaged=spawnSync('python3',['-B','scripts/verify-packaged-runtime.py','--runtime-profile=cloud','missing.apk'],{encoding:'utf8',timeout:60000});
 assert.equal(packaged.status,2);assert.match(packaged.stderr,/There is one runtime profile now/);
 const usage=spawnSync(process.execPath,['scripts/runtime-profile.ts','--verify-cloud'],{encoding:'utf8',timeout:60000});
 assert.notEqual(usage.status,0);assert.match(usage.stderr,/--verify-native\. There is one runtime profile now; --verify-cloud is gone\./);
});

test('a build carries no profile switch to the renderer, Gradle, the record or the verifier',()=>{
 const options=parseBuildArgs([]);
 assert.equal('runtimeProfile' in options,false);assert.equal('localEmbeddings' in options,false);
 assert.deepEqual(gradleFlagArgs(options),['-PELIZA_DEV_ALLOW_TEST_MOCKS=0','-PELIZA_ALLOW_UNPACKAGED_RUNTIME=0']);
 const env=buildEnv({ELIZA_DEV_ALLOW_TEST_MOCKS:'1',VITE_ELIZA_RUNTIME_PROFILE:'cloud',ELIZA_LOCAL_EMBEDDINGS:'1',ORG_GRADLE_PROJECT_ELIZA_LOCAL_EMBEDDINGS:'1',ORG_GRADLE_PROJECT_ELIZA_RUNTIME_PROFILE:'cloud'},options);
 for(const name of ['ELIZA_DEV_ALLOW_TEST_MOCKS','VITE_ELIZA_RUNTIME_PROFILE','ELIZA_LOCAL_EMBEDDINGS','ORG_GRADLE_PROJECT_ELIZA_LOCAL_EMBEDDINGS','ORG_GRADLE_PROJECT_ELIZA_RUNTIME_PROFILE'])assert.equal(env[name],undefined,name);
 const build=consumerBuildOptions(options,{},process.cwd());
 assert.equal(build.record.metadata.runtimeProfile,'native');assert.equal('localEmbeddings' in build.record.metadata,false);
 assert.deepEqual(build.verify.args,['scripts/verify-apks.ts']);
 // The renderer build no longer records a profile; Gradle and the build refuse stale synced assets that do.
 assert.doesNotMatch(read('vite.config.ts'),/RUNTIME_PROFILE|runtimeProfile/);
 assert.doesNotMatch(read('apps/app/src/build-flags.ts'),/RUNTIME_PROFILE|cloudRuntimeEnabled/);
 assert.match(read('scripts/build-android.ts'),/if \(flags\.runtimeProfile !== undefined\) throw Error/);
});

test('Gradle has one profile: local speech, the voice host and the embedding host are always checked and packaged',()=>{
 const gradle=read('android/app/product.gradle'),speech=read('android/local-speech/build.gradle');
 // The resident agent is always launched with the native profile (upstream's local-embeddings route).
 assert.match(gradle,/buildConfigField 'String', 'ELIZA_RUNTIME_PROFILE', '"native"'/);
 assert.match(gradle,/if \(project\.hasProperty\('ELIZA_RUNTIME_PROFILE'\) \|\| project\.hasProperty\('ELIZA_LOCAL_EMBEDDINGS'\)\)\s+throw new GradleException\('There is one runtime profile now/);
 assert.doesNotMatch(gradle+speech,/runtimeProfile\s*[!=]=\s*'|def runtimeProfile|cloudProfile|def localEmbeddings|--verify-cloud|--local-embeddings/);
 assert.match(gradle,/def args = \['node', 'scripts\/stage-embedding-host\.mjs', '--verify'\]\s+if \(unpackagedRuntime\) args \+= '--allow-unpackaged-runtime'/);
 for(const task of ['verifyParadeeAppLinkage','verifyVoiceHost']){
  const block=gradle.slice(gradle.indexOf(`def ${task} = tasks.register`),gradle.indexOf('}',gradle.indexOf(`def ${task} = tasks.register`)));
  assert.doesNotMatch(block,/onlyIf/,task+' always runs');assert.match(block,/unpackagedRuntime \? \['--allow-absent'\] : \[\]/);
 }
 assert.match(gradle,/onlyIf \{ !unpackagedRuntime && testMocksRaw\?\.toString\(\) != '1' \}\s+workingDir rootProject\.projectDir\.parentFile\s+commandLine 'node', 'scripts\/runtime-profile\.mjs', '--verify-native'/);
 // Only the unpackaged developer lane with no staged outputs keeps the Java API without the engine.
 assert.match(speech,/if \(unpackaged && !nativeOutput\.exists\(\)\) \{/);
 assert.match(speech,/tasks\.register\('verifySpeechInputs', Exec\) \{\s+workingDir/);
 // The private QA update channel no longer depends on a profile.
 assert.match(gradle,/if \(unpackagedRuntime \|\| testMocksRaw\?\.toString\(\) == '1' \|\| !privateUpdateFile/);
 // Routing belongs to the shared upstream profile; Alpha declares only its deployment.
 const declaration=read('apps/app/src/product/native-cloud-runtime.ts');
 assert.doesNotMatch(declaration,/serviceRouting|updateRoutingPreferences|ELIZA_RUNTIME_PROFILE/);
 assert.match(read('scripts/native-google-product-host.ts'),/export \{nativeCloudRuntime\} from '\.\.\/apps\/app\/src\/product\/native-cloud-runtime\.ts'/);
 const profile=read('vendor/eliza/packages/app/src/runtime/native-runtime-profile.ts');
 assert.match(profile,/native: Object\.freeze\(\{[^}]*embeddings: "local"[^}]*localModels: true/s);
});

test('every resident launch selects the native profile, so local embeddings and powered-on scheduling apply signed in or not',()=>{
 const plugin=read('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java');
 assert.match(plugin,/static void configureEnvironment\(Context context,java\.util\.Map<String,String> env\) throws java\.io\.IOException \{\s*env\.put\("ELIZA_RUNTIME_PROFILE",BuildConfig\.ELIZA_RUNTIME_PROFILE\);/);
 assert.doesNotMatch(plugin,/"cloud"\.equals\(BuildConfig\.ELIZA_RUNTIME_PROFILE\)/);
 const profile=read('vendor/eliza/packages/app/src/runtime/native-runtime-profile.ts');
 assert.equal((profile.match(/missedOccurrences: "record",/g)||[]).length,2);
 assert.match(read('vendor/eliza/packages/app/src/mobile-agent-entry.ts'),/applyNativeRuntimeProfileEnvironment\(process\.env\)/);
});

test('staging always writes the native marker and keeps the local embedding model; the Cloud verifier is gone',()=>{
 const stage=read('scripts/stage-local-agent-runtime.ts');
 assert.match(stage,/alpha-runtime-profile\.json'\),JSON\.stringify\(\{version:1,runtimeProfile:'native'\},null,2\)\+'\\n'\)/);
 assert.doesNotMatch(stage,/omittedLocalModels|unlinkSync\(file\)|Cloud projection/);
 const profile=read('scripts/runtime-profile.ts');
 assert.doesNotMatch(profile,/verifyCloudResident|cannot package local|omittedLocalModels/);
 assert.match(profile,/export function verifyNativeGoogleHost\(root\)/);
 // A payload staged for the removed Cloud profile is refused by the preflight, with the command to restage.
 const missing=path.join(process.cwd(),'artifacts','missing-prepared-source-one-profile');
 assert.match(preparedRuntimeProblems(process.cwd(),missing,{embeddingHost:()=>{},googleHost:()=>{}})[0],/Prepared runtime source .* is missing/);
 assert.doesNotMatch(read('scripts/android-build-preflight.ts'),/--verify-cloud|runtimeProfile === "cloud"|runtimeProfile !== "cloud"/);
});
