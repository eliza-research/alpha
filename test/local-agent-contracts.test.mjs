import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
test('local agent contracts (synthetic HTTP and durable development journal)',()=>{
 execFileSync(process.execPath,['scripts/test-local-agent.ts'],{cwd:new URL('..',import.meta.url),timeout:scaledTimeout(60000),stdio:'pipe'});
});
test('local agent streaming and cancellation contracts',()=>{
 execFileSync(process.execPath,['scripts/test-local-agent-stream.ts'],{cwd:new URL('..',import.meta.url),timeout:scaledTimeout(60000),stdio:'pipe'});
});

test('local browser digest persistence and recovery',()=>{
 execFileSync(process.execPath,['scripts/test-local-digest-storage.ts'],{cwd:new URL('..',import.meta.url),timeout:scaledTimeout(60000),stdio:'pipe'});
});

test('digest cancellation preserves replay recovery',()=>{
 execFileSync(process.execPath,['scripts/test-digest-cancellation.ts'],{cwd:new URL('..',import.meta.url),timeout:scaledTimeout(60000),stdio:'pipe'});
});

test('local agent speech bridge owns credentials, binary bounds and cancellation',()=>{
 execFileSync(process.execPath,['scripts/test-agent-speech-bridge.ts'],{cwd:new URL('..',import.meta.url),timeout:scaledTimeout(30000),stdio:'pipe'});
});

test('local agent TTS bridge validates audio identity, ownership and cancellation',()=>{
 execFileSync(process.execPath,['scripts/test-agent-tts-bridge.ts'],{cwd:new URL('..',import.meta.url),timeout:scaledTimeout(30000),stdio:'pipe'});
});
