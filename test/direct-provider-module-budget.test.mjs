import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {featureParityAllowlist} from './support/feature-parity.mjs';
import {alphaBehaviouralModules} from '../scripts/feature-manifest.ts';
test('provider setup reuses its owning modules',()=>{
 const modules=alphaBehaviouralModules(process.cwd());
 assert.deepEqual(Array.from(modules).filter(file=>!featureParityAllowlist.modules.includes(file)),[]);
 for(const file of ['apps/app/src/runtime/own-provider-choice.tsx','apps/app/src/runtime/provider-configuration.ts'])assert.equal(fs.existsSync(file),false);
 assert.match(fs.readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8'),/function OwnProviderChoice/);
 assert.match(fs.readFileSync('apps/app/src/runtime/abort-signal.ts','utf8'),/function runProviderConfiguration/);
});
