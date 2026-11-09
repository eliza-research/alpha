import test from 'node:test';
import { execFileSync } from 'node:child_process';

const cases = [
  ['configured host speech warms before requests and recovers from cold failure', 'test-tts-startup.mjs'],
  ['shared speech workers contain pipe failures and recover after cancellation', 'test-tts-worker-lifecycle.mjs'],
];

for (const [name, script] of cases) {
  test(name, () => {
    execFileSync(process.execPath, ['--experimental-vm-modules', `scripts/${script}`], {
      cwd: new URL('..', import.meta.url),
      timeout: 10_000,
      stdio: 'pipe',
    });
  });
}
