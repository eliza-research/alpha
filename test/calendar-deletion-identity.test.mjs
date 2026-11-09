import test from 'node:test';
import {fixture, nativeSource, runJvm} from './fixtures/jvm-tools.mjs';

test('native scoped deletion identity cannot widen an occurrence or legacy event into a series', () => {
  runJvm([
    nativeSource('CalendarDeletionIdentity.java'),
    fixture('CalendarDeletionIdentityTest.java'),
  ], 'ai.elizaresearch.alphaphone.CalendarDeletionIdentityTest');
});
