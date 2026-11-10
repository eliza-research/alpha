import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
test('configured host speech warms before requests and recovers from cold failure',()=>{
 execFileSync(process.execPath,['--experimental-vm-modules','scripts/test-tts-startup.ts'],{cwd:new URL('..',import.meta.url),timeout:10000,stdio:'pipe'});
});
