import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('Inbox retains reviewed message, cursor and offline snapshot through read failures',()=>{
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const run=spawnSync(process.execPath,['--import','tsx','--test','scripts/test-inbox-retention-cases.ts'],{env,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
 assert.equal(run.status,0,run.stdout+'\n'+run.stderr);
 assert.match(run.stdout,/tests 8/);assert.match(run.stdout,/fail 0/);
});
