import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
test('provider setup reuses owning modules within the unchanged Alpha module ceiling',()=>{
 const source=fs.readFileSync('scripts/feature-manifest.mjs','utf8');
 const body=source.slice(source.indexOf('export function alphaBehaviouralModules('),source.indexOf('export async function featureParity(')).replace('export function','function');
 const modules=vm.runInNewContext(body+';alphaBehaviouralModules(cwd)',{fs,path,execFileSync,cwd:process.cwd()});
 const allow=JSON.parse(fs.readFileSync('config/feature-parity.json','utf8'));
 assert.equal(allow.ceiling.modules,545);assert.equal(modules.length,545);
 assert.deepEqual(Array.from(modules).filter(file=>!allow.modules.includes(file)),[]);
 for(const file of ['apps/app/src/runtime/own-provider-choice.tsx','apps/app/src/runtime/provider-configuration.ts'])assert.equal(fs.existsSync(file),false);
 assert.match(fs.readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8'),/function OwnProviderChoice/);
 assert.match(fs.readFileSync('apps/app/src/runtime/abort-signal.ts','utf8'),/function runProviderConfiguration/);
});
