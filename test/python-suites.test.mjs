// Runs the Python unittest suites that no other runner covers, isolated (python3 -I) from the
// working directory. packaged-runtime has its own wrapper; embedding-artifact-inputs runs in
// resident-android.yml, which also runs resident-crash-diagnostic and the recovery guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import {globSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const root=resolve(import.meta.dirname,'..');
const python=(args,timeout=120000)=>spawnSync('python3',['-I',...args],{cwd:root,encoding:'utf8',timeout});
const check=result=>{
 assert.equal(result.error,undefined,String(result.error));
 assert.equal(result.status,0,result.stdout+result.stderr);
};
const run=name=>check(python([join('test',name)]));
// -I drops the script directory from sys.path; the recovery guards import their sibling modules.
const runCi=name=>check(python(['-c',"import runpy,sys;sys.path.insert(0,'scripts/ci');runpy.run_path(sys.argv[1],run_name='__main__')",join('scripts','ci',name)]));

const gradleHome=process.env.GRADLE_USER_HOME||join(homedir(),'.gradle');
const noGroovy=globSync('wrapper/dists/gradle-*/*/gradle-*/lib/groovy-[0-9]*.jar',{cwd:gradleHome}).length?false:'No Gradle wrapper distribution to supply Groovy; run an Android build once';
const noGrpc=python(['-c','import grpc, grpc_tools'],30000).status===0?false:'Python grpcio and grpcio-tools are not installed';

test('recovery UI guard admission, transcript and refusal flows',()=>runCi('test-recovery-ui-guard.py'));
test('pending recovery phase loop settles and refuses each fault',()=>runCi('test-pending-recovery-phases.py'));
test('resident crash diagnostic projection and refusals',()=>run('resident-crash-diagnostic.test.py'));
test('launcher native input expiry and reviewed replacement pins',()=>run('native-input-expiry.test.py'));
test('Android app ABI selection and build-type filters',{skip:noGroovy},()=>run('android-app-abi-selection.test.py'));
test('emulator microphone preflight never injects or reads audio unsafely',{skip:noGrpc},()=>run('emulator-microphone-preflight.test.py'));
