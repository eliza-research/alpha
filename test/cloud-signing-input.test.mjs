import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';

// The suite's 28 cases take about 45 s on a developer host; it shares the Python-suite budget
// (python-suites.test.mjs) rather than a narrower cap.
test('Cloud signing admission verifies the exact reviewed unsigned archive', () => {
  execFileSync('python3', ['-B', 'test/cloud-signing-input.test.py'], {
    cwd: new URL('..', import.meta.url),
    stdio: 'pipe',
    timeout: scaledTimeout(120_000),
  });
});
