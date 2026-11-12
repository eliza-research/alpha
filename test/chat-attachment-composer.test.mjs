import assert from 'node:assert/strict';
import test from 'node:test';
import {chatAttachmentComposerFixture} from './fixtures/chat-attachment-composer.mjs';

test('the browser composer restores its transcript after a definite pre-dispatch refusal', async () => {
  const f = chatAttachmentComposerFixture();
  f.attach();
  assert.equal(f.observe().draft, true);
  await f.start();
  assert.equal(f.observe().draft, false);
  assert.equal(f.observe().visible, true);
  await f.refuse();
  assert.equal(f.observe().draft, true);
  assert.equal(f.observe().visible, false);
  assert.equal(f.inspect().draftText, 'Summarize this for me');
});

for (const changed of ['Owner', 'Conversation']) {
  test(`a held attachment save cannot publish after replacing the ${changed.toLowerCase()}`, async () => {
    const f = chatAttachmentComposerFixture();
    f.attach();
    f.holdStorage();
    await f.start();
    f[`switch${changed}`]();
    await f.completeStorage();
    const state = f.observe(), {connectCalls} = f.inspect();
    if (connectCalls) await f.refuse();
    else await f.finish();
    assert.equal(state.visible, false);
    assert.equal(state.draft, false);
    assert.equal(connectCalls, 0);
    assert.deepEqual(f.observe().saved, [11], 'The accepted old write keeps its exact slot');
  });
}
