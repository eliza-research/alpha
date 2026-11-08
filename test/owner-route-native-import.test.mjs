// Native Node loader regression: Vite's native config loader imports this policy
// through the real development bridge. A bundler-only test misses JSON attributes.
import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
test('owner route policy imports with the native Node TypeScript/JSON loader',()=>{
 const policy=new URL('../apps/app/src/runtime/owner-route-policy.ts',import.meta.url).href;
 const code=`import assert from 'node:assert/strict';import {ownerRouteGroup,ownerRouteAllowed} from ${JSON.stringify(policy)};assert.equal(ownerRouteGroup('/api/notes/state'),'records');assert.equal(ownerRouteAllowed('records','/api/notes/state','GET'),true);assert.equal(ownerRouteAllowed('automations','/api/triggers/test','DELETE'),true);assert.equal(ownerRouteAllowed('approvals','/api/approvals?state=all&limit=500','GET'),true);assert.equal(ownerRouteAllowed('approvals','/api/approvals?state=all&limit=500','POST'),false);console.log('PASS native owner route import');`;
 const run=spawnSync(process.execPath,['--experimental-transform-types','--input-type=module','--eval',code],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',timeout:30000});
 assert.equal(run.status,0,run.stderr);assert.equal(run.signal,null);assert.match(run.stdout,/^PASS native owner route import\s*$/);
});
