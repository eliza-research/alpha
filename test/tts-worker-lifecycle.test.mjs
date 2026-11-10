import test from 'node:test';
import {execFileSync} from 'node:child_process';
test('patched TTS service contains worker pipe failures and recovers after cancellation',()=>{
 execFileSync(process.execPath,['--experimental-vm-modules','scripts/test-tts-worker-lifecycle.ts'],{cwd:new URL('..',import.meta.url),timeout:10000,stdio:'pipe'});
});
