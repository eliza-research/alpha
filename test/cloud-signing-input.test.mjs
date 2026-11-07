import test from 'node:test';
import {execFileSync} from 'node:child_process';

test('Cloud signing admission verifies the exact reviewed unsigned archive', () => {
  execFileSync('python3', ['-B', 'test/cloud-signing-input.test.py'], {
    cwd: new URL('..', import.meta.url),
    stdio: 'pipe',
    timeout: 30_000,
  });
});
