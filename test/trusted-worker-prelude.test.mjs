import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {workerLeasePrelude} from '../vendor/eliza/plugins/plugin-workflow/src/services/workflow-worker-lease-prelude.ts';

const asset=new URL('../android/app/src/androidTest/assets/trusted-worker.mjs',import.meta.url);
const marker='\n// Instrumentation-only trusted harness.';

test('the resident survivor worker runs the lease prelude the pin ships',()=>{
 const source=fs.readFileSync(asset,'utf8');
 const split=source.indexOf(marker);
 assert.ok(split>0,'trusted-worker.mjs has no harness marker');
 // Regenerate the prelude from vendor workerLeasePrelude when this fails; the harness below the marker stays as is.
 assert.equal(source.slice(0,split),workerLeasePrelude,'trusted-worker.mjs prelude differs from the pinned workerLeasePrelude');
 assert.match(workerLeasePrelude,/__elizaAcquireWorkerLease/);
});
