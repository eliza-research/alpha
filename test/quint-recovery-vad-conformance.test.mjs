import test from 'node:test';
import assert from 'node:assert/strict';
import {runRecoveryVadConformance} from '../specs/quint/native/recovery-vad-conformance.mjs';

test('renderer recovery and VAD Quint traces match the native Java policies', {timeout: 180_000}, async () => {
  const result = await runRecoveryVadConformance();
  assert.ok(result.javaAssertions > 1000);
  assert.ok(result.models.RendererRecovery.transitions > 100);
  assert.ok(result.models.VadSegmentation.transitions > 100);
});
