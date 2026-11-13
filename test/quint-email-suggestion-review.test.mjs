import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {bootEmailReview, reviewInputs} from './fixtures/use-in-email-review.mjs';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {call, checkpoint, root, trace} from '../specs/quint/refinement/application/support.mjs';

const model = 'EmailSuggestionReview';
const shared = 'vendor/eliza/plugins/plugin-inbox/src/mailbox/use-in-email.ts';
const inputs = [...reviewInputs, shared, fileURLToPath(import.meta.url),
  fileURLToPath(new URL('./fixtures/use-in-email-review.mjs', import.meta.url)),
  fileURLToPath(new URL('../specs/quint/refinement/application/support.mjs', import.meta.url))];

function textClass(value) {
  if (value === undefined) return 'missing';
  if (value === 'Updated reply') return 'edited';
  if (value.length > 64000) return 'long';
  assert.equal(value, 'Thanks. Tuesday at 10 works for me.');
  return 'short';
}

function noticeClass(value) {
  if (!value) return '';
  if (value === 'Inbox closed') return 'front';
  if (value === 'Account changed') return 'cloud';
  assert.equal(value, 'Changed');
  return 'target';
}

function observe(t, rendered) {
  const state = t.shell.state;
  const front = state.view !== 'inbox' ? 'away'
    : state.screen === 'lock' ? 'lock'
      : state.chat === 'hidden' ? 'chat'
        : t.world.hidden ? 'hidden' : t.world.chooser ? 'chooser' : 'normal';
  const fields = {
    's.env.front': front,
    's.env.session': Number(t.world.session.sessionId.slice(-1)),
    's.env.cloud': Number(t.world.cloud.slice(-1)),
    's.env.text': textClass(state.msgs.find(row => row.id === t.reply.id)?.text),
    's.env.token': t.inbox.revision,
    's.env.ready': t.inbox.ready,
    's.env.room': t.inbox.room === 64000,
    's.env.appendMode': t.inbox.append,
    's.toasts': t.toasts.length,
    's.inserts': t.inserted.map(({text, append}, index) => ({
      token: t.insertTokens[index], text: textClass(text), appendMode: append,
    })),
  };
  // Rendering can retire a review. A checkpoint following a late click must not
  // render on its own and accidentally retire the review before the action.
  if (rendered) {
    fields['s.review.text'] = rendered.emailUseOpen ? textClass(rendered.emailUse.text) : '';
    fields['s.review.ready'] = rendered.emailUseOpen && !rendered.emailUse.blocked;
    fields['s.review.notice'] = noticeClass(rendered.emailUse?.notice);
  }
  return fields;
}

async function checkEmailSuggestionReview(extraSources = []) {
  const sources = [...new Set([...inputs, ...extraSources])];
  const driverHashes = captureInputs(sources);
  assert.deepEqual(readFileSync(root + reviewInputs[1]), readFileSync(root + shared),
    'Use-in-email rules must be the pinned shared source');
  const traces = [];
  async function scenario(name, run) {
    const t = await bootEmailReview();
    const buttons = new Map();
    const replay = trace(name, observe(t));
    const mark = (action, args = [], rendered) => checkpoint(replay,
      [action, ...args].join(' '), call(action, ...args), observe(t, rendered));
    await run({
      render(slot) {
        const rendered = t.render();
        buttons.set(slot, {opener: rendered.msgs.find(row => row.id === t.reply.id)?.useInEmail,
          confirm: rendered.emailUse?.confirm, close: rendered.emailUse?.close});
        mark('render', [slot], rendered);
      },
      open(slot) {buttons.get(slot).opener?.(); mark('open', [slot]);},
      confirm(slot) {buttons.get(slot).confirm?.(); mark('confirm', [slot]);},
      close(slot) {buttons.get(slot).close?.(); mark('close', [slot]);},
      session(session) {t.world.session = {...t.world.session, sessionId: 'agent-' + session}; mark('setSession', [session]);},
      cloud(cloud) {t.world.cloud = 'cloud-' + cloud; mark('setCloud', [cloud]);},
      text(text) {
        if (text === 'missing') t.shell.state.msgs = t.shell.state.msgs.filter(row => row !== t.reply);
        else t.reply.text = text === 'long' ? 'x'.repeat(64001) : 'Updated reply';
        mark('setText', [text]);
      },
      front(front) {
        t.world.hidden = front === 'hidden';
        t.world.chooser = front === 'chooser';
        t.shell.state.view = front === 'away' ? 'notes' : 'inbox';
        t.shell.state.chat = front === 'chat' ? 'hidden' : 'sheet';
        t.shell.state.screen = front === 'lock' ? 'lock' : 'home';
        mark('setFront', [front]);
      },
      target(token, ready = true, room = true, append = false) {
        Object.assign(t.inbox, {revision: token, ready, room: room ? 64000 : 1, append});
        mark('setTarget', [token, ready, room, append]);
      },
    });
    traces.push(replay);
  }
  const displayed = c => {c.render(1); c.open(1); c.render(1);};
  await scenario('confirmation inserts only once into the reviewed draft', c => {
    displayed(c); c.confirm(1); c.confirm(1); c.render(2);
  });
  await scenario('superseded controls cannot confirm or close the replacement', c => {
    displayed(c); c.target(2, true, true, true); c.open(1); c.confirm(1); c.close(1);
    c.render(2); c.confirm(2); c.render(3);
  });
  for (const cause of ['target', 'cloud', 'hidden', 'chooser']) {
    await scenario(cause + ' refresh requires another displayed review', c => {
      displayed(c);
      if (cause === 'target') c.target(2, true, true, true);
      else if (cause === 'cloud') {c.cloud(2); c.target(2);}
      else c.front(cause);
      c.confirm(1);
      if (cause === 'hidden' || cause === 'chooser') c.front('normal');
      c.confirm(1); c.render(2); c.confirm(2); c.render(3);
    });
  }
  for (const cause of ['chat', 'lock', 'away']) {
    await scenario('late confirm before the ' + cause + ' render cannot insert', c => {
      displayed(c); c.front(cause); c.confirm(1); c.render(2);
    });
  }
  for (const cause of ['session', 'edited', 'missing']) {
    await scenario(cause + ' retires an existing confirmation', c => {
      displayed(c);
      if (cause === 'session') c.session(2); else c.text(cause);
      c.confirm(1); c.render(2);
    });
  }
  for (const cause of ['session', 'edited']) {
    await scenario(cause + ' is not adopted by a retained opener', c => {
      c.render(1);
      if (cause === 'session') c.session(2); else c.text(cause);
      c.open(1); c.render(2); c.open(2); c.render(3); c.confirm(3);
    });
  }
  await scenario('oversized text is blocked as a whole', c => {
    c.text('long'); displayed(c); c.confirm(1); c.render(2);
  });
  await scenario('destination refresh with insufficient room remains blocked', c => {
    displayed(c); c.target(2, true, false, true); c.confirm(1); c.render(2); c.confirm(2); c.render(3);
  });
  await scenario('cancel retires the reviewed controls', c => {
    displayed(c); c.close(1); c.confirm(1); c.render(2);
  });
  return checkTraces({model, sources, driverHashes, traces, scope: 'bounded-component',
    assumptions: [
      'Executes the actual renderer review and byte-identical shared fit and presentation helpers with a closed synthetic Inbox adapter. Its only mutation records local text insertions.',
      'One agent reply, up to four review snapshots, three retained render-control slots and representative visibility, account, token and capacity classes.',
      'The Inbox composer internals, actual DOM focus, arbitrary renderer schedules and provider execution are separate obligations.',
    ]});
}

test('the renderer review refines exact local email suggestion admission', async () => {
  const receipt = await checkEmailSuggestionReview([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 17);
});
