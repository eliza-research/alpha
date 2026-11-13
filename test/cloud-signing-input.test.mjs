import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';

test('Cloud signing admission verifies the exact reviewed unsigned archive', () => {
  execFileSync('python3', ['-B', 'test/cloud-signing-input.test.py'], {
    cwd: new URL('..', import.meta.url),
    stdio: 'pipe',
    timeout: scaledTimeout(30_000),
  });
});
