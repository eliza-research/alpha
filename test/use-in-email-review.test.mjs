// MVP-14: the assistant's "Use in email" review. The real review module runs against a stub shell
// and a stub Inbox view: no renderer, account, network or mail. It proves which replies offer the
// action, what the review states, and that a changed conversation, agent, Cloud account or email
// destination refuses the insert. Sending is not reachable from this module at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = async () => {
  let text = await readFile(new URL('../apps/app/src/prototype/use-in-email-review.ts', import.meta.url), 'utf8');
  text = text.replace(/^import .*;\n/gm, '').replace(/^export (?=function |const )/gm, '');
  // The review wording and limits are the shared @elizaos/plugin-inbox/mailbox module at the pin.
  let shared = await readFile(new URL('../.eliza/client-features/plugins/plugin-inbox/src/mailbox/use-in-email.ts', import.meta.url), 'utf8');
  shared = shared.replace(/^import .*;\n/gm, '').replace(/^export (?=function |const )/gm, '');
  return '{' + stripTypeScriptTypes(shared, { mode: 'transform' }) + stripTypeScriptTypes(text, { mode: 'transform' }) + '\nglobalThis.installUseInEmailReview=installUseInEmailReview;globalThis.describeEmailTarget=describeEmailTarget;globalThis.USE_IN_EMAIL_ATTACHMENT_POLICY=USE_IN_EMAIL_ATTACHMENT_POLICY;}';
};
const plain = value => JSON.parse(JSON.stringify(value));

async function boot() {
  const world = { session: { sessionId: 'agent-1', agentId: 'a', ownerId: 'o', origin: 'https://agent.invalid' }, cloud: 'cloud-1', chooser: false, hidden: false };
  const inserted = [], toasts = [];
  // The stub Inbox: one destination whose token changes whenever `revision` changes.
  const inbox = { revision: 1, ready: true, append: false, room: 64000,
    emailTarget() { return this.ready ? { ready: true, kind: 'reply', append: this.append, reply: true, subject: 'Re: Plan', to: ['sender@example.invalid'], from: 'Sender', room: this.room, accountId: 'grant-a', account: 'owner@example.invalid', token: 'token-' + this.revision }
      : { ready: false, reason: 'Restore or discard the saved local draft in Inbox first. The suggestion was not added.', token: 'blocked', accountId: 'grant-a', account: 'owner@example.invalid' }; },
    useInEmail(text, expected) { if (!this.ready || expected.token !== 'token-' + this.revision) return false; inserted.push({ text, append: expected.append === true }); return true; } };
  class Shell {
    constructor() { this.state = { view: 'inbox', chat: 'sheet', msgs: [] }; this.live = true; }
    S() { return this.state; }
    setState(patch) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); }
    toast(text) { toasts.push(text); }
    // The message-actions layer below marks every finished text message as having a menu.
    renderVals() { return { msgs: this.state.msgs.map(m => ({ id: m.id, text: m.text, ...(m.streaming || m.interrupted ? {} : { messageActionsRole: 'button' }) })) }; }
    componentWillUnmount() {}
  }
  const sandbox = { createInlineModal: () => ({ ref() {} }), CSS: { escape: v => v }, Date, JSON,
    document: { get hidden() { return world.hidden; }, querySelector: () => null },
    connectionController: { getSnapshot: () => ({ session: world.session, open: world.chooser }), getCloudClient: () => world.cloud ? { sessionId: world.cloud } : null } };
  vm.createContext(sandbox); vm.runInContext(await source(), sandbox);
  const views = { inbox };
  sandbox.installUseInEmailReview(Shell, views);
  const shell = new Shell();
  const reply = { id: 'reply-1', from: 'agent', text: 'Thanks. Tuesday at 10 works for me.', card: null };
  shell.state.msgs = [{ id: 'user-1', from: 'user', text: 'Help me write a reply' }, reply,
    { id: 'card-1', from: 'agent', text: 'Approve this action', card: { type: 'generic' } }, { id: 'stream-1', from: 'agent', text: 'Still typ', card: null, streaming: true }];
  return { world, inbox, inserted, toasts, shell, views, sandbox, reply, render: () => shell.renderVals(), row: id => shell.renderVals().msgs.find(m => m.id === id) };
}

test('only finished plain agent replies offer Use in email, and only over Inbox', async () => {
  const t = await boot();
  assert.deepEqual(t.render().msgs.map(m => [m.id, m.canUseInEmail === true]), [['user-1', false], ['reply-1', true], ['card-1', false], ['stream-1', false]]);
  assert.equal(t.render().emailUseOpen, false);
  t.shell.state.view = 'notes';
  assert.equal(t.render().msgs.some(m => m.canUseInEmail), false, 'other apps do not offer an email destination');
  t.shell.state.view = 'inbox'; delete t.views.inbox.useInEmail;
  assert.equal(t.render().msgs.some(m => m.canUseInEmail), false, 'no Inbox adapter, no control');
});

test('the review names the account, the exact destination and the attachment policy before inserting', async () => {
  const t = await boot();
  t.row('reply-1').useInEmail();
  const review = t.render().emailUse;
  assert.equal(t.render().emailUseOpen, true);
  assert.deepEqual(plain({ account: review.account, destination: review.destination, text: review.text, blocked: review.blocked, confirmLabel: review.confirmLabel, notice: review.notice }),
    { account: 'From owner@example.invalid', destination: 'New reply to sender@example.invalid (Sender) · Re: Plan', text: t.reply.text, blocked: false, confirmLabel: 'Insert into draft', notice: '' });
  assert.match(review.policy, /Files and photos are not attached/);
  assert.equal(t.inserted.length, 0, 'opening the review inserts nothing');
  review.close();
  assert.equal(t.render().emailUseOpen, false); assert.equal(t.inserted.length, 0, 'Cancel inserts nothing');
  t.row('reply-1').useInEmail(); t.render().emailUse.confirm();
  assert.deepEqual(plain(t.inserted), [{ text: t.reply.text, append: false }]);
  assert.equal(t.render().emailUseOpen, false); assert.equal(t.shell.state.chat, 'hidden', 'the composer is shown after inserting');
});

test('a draft that already has text is only ever appended to, and says so', async () => {
  const t = await boot(); t.inbox.append = true;
  t.row('reply-1').useInEmail();
  const review = t.render().emailUse;
  assert.equal(review.confirmLabel, 'Add below existing text'); assert.match(review.effect, /nothing is replaced/);
  review.confirm();
  assert.deepEqual(plain(t.inserted), [{ text: t.reply.text, append: true }]);
});

test('a destination that changed after the review opened is refused and shown again', async () => {
  const t = await boot();
  t.row('reply-1').useInEmail(); t.inbox.revision = 2;
  t.render().emailUse.confirm();
  assert.equal(t.inserted.length, 0); assert.equal(t.render().emailUseOpen, true);
  assert.match(t.render().emailUse.notice, /changed since you opened this review.*Nothing was added/);
  // The refreshed review can be confirmed against the current destination.
  t.render().emailUse.confirm();
  assert.deepEqual(plain(t.inserted), [{ text: t.reply.text, append: false }]);
});

test('a blocked destination cannot be confirmed', async () => {
  const t = await boot(); t.inbox.ready = false;
  t.row('reply-1').useInEmail();
  const review = t.render().emailUse;
  assert.equal(review.blocked, true); assert.match(review.effect, /saved local draft/); assert.equal(review.account, 'From owner@example.invalid');
  review.confirm(); assert.equal(t.inserted.length, 0); assert.equal(t.render().emailUseOpen, true);
});

test('a changed agent, edited reply, Cloud account, chooser or hidden app inserts nothing', async () => {
  for (const [change, expectOpen] of [
    [t => { t.world.session = { ...t.world.session, sessionId: 'agent-2' }; }, false],
    [t => { t.shell.state.msgs = t.shell.state.msgs.map(m => m.id === 'reply-1' ? { ...m, text: 'Different text' } : m); }, false],
    [t => { t.shell.state.msgs = t.shell.state.msgs.filter(m => m.id !== 'reply-1'); }, false],
    [t => { t.world.cloud = 'cloud-2'; }, true],
    [t => { t.world.chooser = true; }, true],
    [t => { t.world.hidden = true; }, true],
  ]) {
    const t = await boot();
    t.row('reply-1').useInEmail(); const review = t.render().emailUse; change(t);
    review.confirm();
    assert.equal(t.inserted.length, 0, 'nothing inserted after: ' + change);
    assert.equal(t.render().emailUseOpen, expectOpen);
    if (expectOpen) assert.match(t.render().emailUse.notice, /Nothing was added/);
  }
});

test('leaving Inbox or closing the conversation ends the review without inserting', async () => {
  for (const leave of [t => { t.shell.state.view = 'notes'; }, t => { t.shell.state.chat = 'hidden'; }]) {
    const t = await boot();
    t.row('reply-1').useInEmail(); const review = t.render().emailUse; leave(t);
    assert.equal(t.render().emailUseOpen, false);
    review.confirm(); assert.equal(t.inserted.length, 0);
  }
});

test('locking the phone ends the review, and a locked phone inserts nothing', async () => {
  for (const screen of ['lock', 'off']) {
    const t = await boot();
    t.row('reply-1').useInEmail(); const review = t.render().emailUse;
    // Confirm reached before the next render still refuses.
    t.shell.state.screen = screen; review.confirm();
    assert.equal(t.inserted.length, 0, 'nothing inserted while ' + screen);
    assert.equal(t.render().emailUseOpen, false, 'the review is gone after ' + screen);
    t.shell.state.screen = 'home';
    assert.equal(t.render().emailUseOpen, false, 'unlocking does not bring the review back');
    // A locked phone does not open a review either.
    t.shell.state.screen = screen; t.row('reply-1').useInEmail?.();
    t.shell.state.screen = 'home'; assert.equal(t.render().emailUseOpen, false);
  }
});

test('a reply longer than a draft can hold is refused in the review', async () => {
  const t = await boot();
  t.shell.state.msgs = t.shell.state.msgs.map(m => m.id === 'reply-1' ? { ...m, text: 'x'.repeat(64001) } : m);
  t.row('reply-1').useInEmail();
  assert.equal(t.render().emailUse.blocked, true); assert.match(t.render().emailUse.effect, /longer than an email draft/);
  t.render().emailUse.confirm(); assert.equal(t.inserted.length, 0);
});

test('a draft without room for the whole reply blocks the review instead of cutting the text', async () => {
  const t = await boot(); t.inbox.append = true; t.inbox.room = t.reply.text.length - 1;
  t.row('reply-1').useInEmail();
  let review = t.render().emailUse;
  assert.equal(review.blocked, true); assert.match(review.effect, /does not have room for this whole reply/); assert.equal(review.account, 'From owner@example.invalid');
  review.confirm(); assert.equal(t.inserted.length, 0); assert.equal(t.render().emailUseOpen, true);
  // Exactly enough room is accepted whole.
  review.close(); t.inbox.room = t.reply.text.length;
  t.row('reply-1').useInEmail(); review = t.render().emailUse;
  assert.equal(review.blocked, false); review.confirm();
  assert.deepEqual(plain(t.inserted), [{ text: t.reply.text, append: true }]);
});

test('a destination that changed to one without room is refused and then stays blocked', async () => {
  const t = await boot(); t.inbox.append = true;
  t.row('reply-1').useInEmail(); t.inbox.revision = 2; t.inbox.room = 3;
  t.render().emailUse.confirm();
  assert.equal(t.inserted.length, 0); assert.equal(t.render().emailUse.blocked, true);
  assert.match(t.render().emailUse.effect, /does not have room/);
  t.render().emailUse.confirm(); assert.equal(t.inserted.length, 0);
});

test('destination wording covers a new email and an open draft', async () => {
  const t = await boot(), describe = t.sandbox.describeEmailTarget;
  assert.deepEqual(plain(describe({ ready: true, kind: 'new', append: false, reply: false, subject: '', to: [], account: 'me@example.invalid', token: 't' })),
    { account: 'From me@example.invalid', destination: 'A new email. You add the recipients and subject.', effect: 'A local draft opens with this text for you to edit.', confirmLabel: 'Insert into draft', blocked: false });
  assert.equal(describe({ ready: true, kind: 'draft', append: false, reply: false, subject: '', to: [], account: 'me@example.invalid', token: 't' }).destination, 'Your open email draft · (no subject) · to no recipients yet');
  assert.equal(describe({ ready: true, kind: 'draft', append: true, reply: true, subject: 'Re: Plan', to: ['a@example.invalid', 'b@example.invalid'], account: 'me@example.invalid', token: 't' }).destination, 'Your open reply draft · Re: Plan · to a@example.invalid, b@example.invalid');
  assert.equal(describe({ ready: false, reason: 'Connect a Gmail account in Inbox first. Nothing was added.', token: '' }).blocked, true);
  // A draft that was set aside is named as off screen; over another message the review says it is not a reply to it.
  const aside = { ready: true, kind: 'draft', append: true, aside: true, elsewhere: false, reply: true, subject: 'Re: Plan', to: ['a@example.invalid'], account: 'me@example.invalid', token: 't' };
  assert.equal(describe(aside).destination, 'Your unfinished reply draft (not on screen) · Re: Plan · to a@example.invalid');
  assert.equal(describe(aside).effect, 'This draft already has text. The suggestion is added below it; nothing is replaced.');
  assert.equal(describe({ ...aside, elsewhere: true }).effect, 'This is not a reply to the message on screen. This draft already has text. The suggestion is added below it; nothing is replaced.');
  assert.equal(describe({ ...aside, elsewhere: true, append: false, reply: false }).destination, 'Your unfinished email draft (not on screen) · Re: Plan · to a@example.invalid');
  assert.equal(describe({ ...aside, elsewhere: true, append: false }).effect, 'This is not a reply to the message on screen. The draft has no message text yet. The suggestion becomes its text.');
  // The literal address leads; a display name chosen by the sender cannot stand in for it.
  assert.equal(describe({ ready: true, kind: 'reply', append: false, reply: true, subject: 'Re: Invoice', to: ['billing@other.invalid'], from: 'Bank <help@bank.invalid>', account: 'me@example.invalid', token: 't' }).destination,
    'New reply to billing@other.invalid (Bank <help@bank.invalid>) · Re: Invoice');
  // A message from the account's own address has no other reply address: none is named.
  assert.equal(describe({ ready: true, kind: 'reply', append: false, reply: true, subject: 'Re: Notes', to: [], from: 'Me', account: 'me@example.invalid', token: 't' }).destination,
    'New reply · Re: Notes · no recipients yet');
});
