// Runs the Python unittest suites that no other runner covers, isolated (python3 -I) from the
// working directory. packaged-runtime has its own wrapper; embedding-artifact-inputs runs in
// resident-android.yml.
import test from 'node:test';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const root=resolve(import.meta.dirname,'..');
const python=(args,timeout=120000)=>spawnSync('python3',['-I',...args],{cwd:root,encoding:'utf8',timeout});
const check=result=>{
 assert.equal(result.error,undefined,String(result.error));
 assert.equal(result.status,0,result.stdout+result.stderr);
};
const run=name=>check(python([join('test',name)]));

const noGrpc=python(['-c','import grpc, grpc_tools'],30000).status===0?false:'Python grpcio and grpcio-tools are not installed';

test('launcher native input expiry and reviewed replacement pins',()=>run('native-input-expiry.test.py'));
test('emulator microphone preflight never injects or reads audio unsafely',{skip:noGrpc},()=>run('emulator-microphone-preflight.test.py'));
