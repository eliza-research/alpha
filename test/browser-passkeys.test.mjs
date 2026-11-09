import test from 'node:test';
import {fixture, nativeSource, runJvm} from './fixtures/jvm-tools.mjs';

test('a provider that ignores or cannot apply the passkey setting cannot open a tab', () => {
  runJvm(
    [nativeSource('BrowserPasskeys.java'), fixture('BrowserPasskeysTest.java')],
    'ai.elizaresearch.alphaphone.BrowserPasskeysTest',
  );
});
