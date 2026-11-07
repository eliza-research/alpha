#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {statSync} from 'node:fs';
import {sourceDirectory} from './local-agent-source.mjs';
const root=resolve(import.meta.dirname,'..');
execFileSync(process.execPath,['scripts/prepare-local-agent.mjs','--source-only'],{cwd:root,stdio:'inherit'});
const tests=['./packages/agent/test/mobile-workspace-exports.test.ts','./plugins/plugin-workflow/__tests__/integration/workflow-process-host.test.ts','./plugins/plugin-workflow/__tests__/integration/process-host-controls.test.ts','./plugins/plugin-workflow/__tests__/integration/process-host-compiler.test.ts'];
const source=sourceDirectory(root);
for(const test of tests) {
  if(!statSync(resolve(source,test),{throwIfNoEntry:false})?.isFile()) throw new Error(`Required admitted-source test missing: ${test}`);
}
execFileSync(process.env.ALPHA_BUN||'bun',['--no-install','--conditions=eliza-source','test',...tests,resolve(root,'test/fixtures/agent-identity-canonical.test.ts')],{
  cwd:source,stdio:'inherit',env:{...process.env,ALPHA_IDENTITY_TEST_SOURCE:source},
});
