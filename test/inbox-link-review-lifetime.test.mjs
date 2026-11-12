import assert from 'node:assert/strict';
import test from 'node:test';
import {tsImport} from './support/ts-import.mjs';
const {boot} = await tsImport('../scripts/inbox-adapter-fixture.ts', import.meta.url);

// Real Inbox adapter and closed provider fixture. The review port holds the owner's answer;
// no browser, external link, mail, credentials or provider mutation is used.
async function fixture({holdAfterCancel = false} = {}) {
  const source = await boot(), reviews = [];
  source.sandbox.BrowserReviews = class {
    confirm(id, title, details, label, options) {
      return new Promise(resolve => reviews.push({id, title, details, label, options, resolve, cancelled: false}));
    }
    cancelAll() {
      for (const review of reviews) {
        review.cancelled = true;
        if (!holdAfterCancel) review.resolve(false);
      }
    }
    cancel() { this.cancelAll(); }
  };
  source.mount(); source.setActive(true); source.render(); await source.tick();
  source.render().rows[0].open(); await source.tick();
  return {...source, reviews};
}
function noMailEffects(source) {
  assert.equal(source.prepared.length, 0, 'Opening a link cannot prepare a mail mutation');
  assert.equal(source.dispatched.length, 0, 'Opening a link cannot dispatch mail');
}
async function reopen(source) {
  source.render(); await source.tick();
  source.render().rows[0].open(); await source.tick();
}

test('a current reviewed Inbox HTTPS link opens once in Alpha Browser', async () => {
  const source = await fixture();
  try {
    source.reader().links[1].open();
    const review = source.reviews[0];
    assert.match(review.details, /docs\.example\.org\nhttps:\/\/docs\.example\.org\/plan\?x=1/);
    assert.equal(review.options.current(), true);
    review.resolve(true); await source.tick();
    assert.deepEqual(source.navigations, ['https://docs.example.org/plan?x=1']);
    noMailEffects(source);
  } finally { source.shell.componentWillUnmount(); }
});

test('a declined misleading Inbox link keeps its destination warning and opens nothing', async () => {
  const source = await fixture();
  try {
    source.reader().links[0].open();
    const review = source.reviews[0];
    assert.match(review.details, /tracker\.attacker\.invalid/);
    assert.match(review.details, /Warning: the email shows “www\.bank\.example\.com”/);
    review.resolve(false); await source.tick();
    assert.deepEqual(source.navigations, []); noMailEffects(source);
  } finally { source.shell.componentWillUnmount(); }
});

for (const retirement of ['left-and-reopened', 'cloud-session-replaced', 'other-message-and-return']) {
  for (const holdAfterCancel of [false, true]) test(`${retirement}: an old link review ${holdAfterCancel ? 'cannot revive after a late answer' : 'is cancelled'}`, async () => {
    const source = await fixture({holdAfterCancel});
    try {
      source.reader().links[1].open(); const review = source.reviews[0];
      assert.equal(review.options.current(), true);
      if (retirement === 'left-and-reopened') {
        source.setActive(false); source.views.inbox.onLeave(); source.setActive(true);
        await reopen(source);
      } else if (retirement === 'cloud-session-replaced') {
        source.setSession('session-b'); await reopen(source);
      } else {
        source.render().rows[1].open(); await source.tick(); await reopen(source);
      }
      assert.equal(source.reader().links[1].href, 'https://docs.example.org/plan?x=1', 'The same ID and link are visible again');
      assert.equal(review.cancelled, true, 'Retirement dismisses the original review');
      assert.equal(review.options.current(), false, 'A later matching message ID cannot restore the original authority');
      review.resolve(true); await source.tick();
      assert.deepEqual(source.navigations, [], 'A retired review cannot open even an identical URL');
      noMailEffects(source);
    } finally { source.shell.componentWillUnmount(); }
  });
}
