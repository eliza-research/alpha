import test from 'node:test';
import {join} from 'node:path';
import {fixture, root, runJvm} from './fixtures/jvm-tools.mjs';

test('native accessibility bounds exclude fully clipped descendants but retain partial and real overlapping controls', () => {
  runJvm([
    join(root, 'android/app/src/androidTest/java/ai/elizaresearch/alphaphone/AccessibilityBounds.java'),
    fixture('AccessibilityBoundsTest.java'),
  ], 'ai.elizaresearch.alphaphone.AccessibilityBoundsTest');
});
