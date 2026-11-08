// Runs the Python unittest suites that no other runner covers, isolated (python3 -I) from the
// working directory. packaged-runtime has its own wrapper; embedding-artifact-inputs runs in
// resident-android.yml, which also runs resident-crash-diagnostic before resident preparation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {globSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const root=resolve(import.meta.dirname,'..');
const python=(args,timeout=120000)=>spawnSync('python3',['-I',...args],{cwd:root,encoding:'utf8',timeout});
const run=name=>{
 const result=python([join('test',name)]);
 assert.equal(result.error,undefined,String(result.error));
 assert.equal(result.status,0,result.stdout+result.stderr);
};

const gradleHome=process.env.GRADLE_USER_HOME||join(homedir(),'.gradle');
const noGroovy=globSync('wrapper/dists/gradle-*/*/gradle-*/lib/groovy-[0-9]*.jar',{cwd:gradleHome}).length?false:'No Gradle wrapper distribution to supply Groovy; run an Android build once';
const noGrpc=python(['-c','import grpc, grpc_tools'],30000).status===0?false:'Python grpcio and grpcio-tools are not installed';

test('resident crash diagnostic projection and refusals',()=>run('resident-crash-diagnostic.test.py'));
test('Android app ABI selection and build-type filters',{skip:noGroovy},()=>run('android-app-abi-selection.test.py'));
test('emulator microphone preflight never injects or reads audio unsafely',{skip:noGrpc},()=>run('emulator-microphone-preflight.test.py'));
