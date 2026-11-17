// Runs the Python unittest suites that no other runner covers, isolated (python3 -I) from the
// working directory. packaged-runtime has its own wrapper; embedding-artifact-inputs runs in
// resident-android.yml.
import test from 'node:test';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';

const root=resolve(import.meta.dirname,'..');
const python=(args,timeout=120000)=>spawnSync('python3',['-I',...args],{cwd:root,encoding:'utf8',timeout:scaledTimeout(timeout)});
const check=result=>{
 assert.equal(result.error,undefined,String(result.error));
 assert.equal(result.status,0,result.stdout+result.stderr);
};
const run=name=>check(python([join('test',name)]));

const noGrpc=python(['-c','import grpc, grpc_tools'],30000).status===0?false:'Python grpcio and grpcio-tools are not installed';

// Hermetic: repository files, Bun (the runner's ALPHA_BUN) and synthetic stage fixtures only.
test('the canonical Pixel source packet admission and stage preimages are rechecked',()=>run('aosp-image-packet.test.py'));
test('the canonical role upgrade preserves owner choices and recovers partial grants',()=>run('aosp-role-upgrade.test.py'));

test('emulator microphone preflight never injects or reads audio unsafely',{skip:noGrpc},()=>run('emulator-microphone-preflight.test.py'));
