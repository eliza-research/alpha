// Decision P-43 (owner, 2026-10-13): "there should NEVER be no agent connected since the agent
// should ALWAYS run locally on device, no exceptions." Eliza Cloud sign-in and plan state decide only
// whether Cloud inference is bound into the running agent. Structural source contracts for the
// renderer and the native start path. Evidence class: source/test only; not an APK, emulator, image
// or device run. The browser specs in test/browser/native-cloud-subscription.spec.ts exercise the
// composed flow with synthetic ports.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DENYLIST, RETIRED_NO_AGENT_TEXT, RETIRED_REMOTE_AGENT_TEXT} from '../scripts/audit-production-bundle.ts';

test('production bundles forbid the retired no-agent copy', () => {
  for (const text of ['without AI', 'Continue offline', 'Connect an agent']) {
    assert.ok(RETIRED_NO_AGENT_TEXT.includes(text), text);
    assert.ok(DENYLIST.includes(text), text);
  }
});

test('production bundles forbid remote-agent fallback copy, which stays test-mocks only (#381)', () => {
  for (const text of ['Connect your remote agent', 'No remote agent connected', 'Connect a remote agent']) {
    assert.ok(RETIRED_REMOTE_AGENT_TEXT.includes(text), text);
    assert.ok(DENYLIST.includes(text), text);
  }
});
