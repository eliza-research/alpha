import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

const cwd = new URL('..', import.meta.url);
for (const [description, script, timeout] of [
  ['local agent contracts (synthetic HTTP and durable development journal)', 'scripts/test-local-agent.mjs', 60_000],
  ['local agent streaming and cancellation contracts', 'scripts/test-local-agent-stream.mjs', 60_000],
  ['local browser digest persistence and recovery', 'scripts/test-local-digest-storage.mjs', 60_000],
  ['digest cancellation preserves replay recovery', 'scripts/test-digest-cancellation.mjs', 60_000],
  ['local agent speech bridge owns credentials, binary bounds and cancellation', 'scripts/test-agent-speech-bridge.mjs', 30_000],
  ['local agent TTS bridge validates audio identity, ownership and cancellation', 'scripts/test-agent-tts-bridge.mjs', 30_000],
]) {
  test(description, () => {
    execFileSync(process.execPath, ['--import', 'tsx', script], { cwd, timeout, stdio: 'pipe' });
  });
}
