import test from 'node:test';
import {execFileSync} from 'node:child_process';
test('resident crash evidence is owned, fixed-schema and bounded on real subprocesses',()=>{
 execFileSync('python3',['scripts/ci/test-resident-uid-crash-audit.py'],{cwd:new URL('..',import.meta.url),timeout:20000,stdio:'pipe'});
});
