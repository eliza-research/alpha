import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import {stripTypeScriptTypes} from '../support/strip-types.mjs';

export const reviewInputs = [
  'apps/app/src/prototype/use-in-email-review.ts',
  '.eliza/client-features/plugins/plugin-inbox/src/mailbox/use-in-email.ts',
];
const source = async () => {
  let text = await readFile(new URL('../../' + reviewInputs[0], import.meta.url), 'utf8');
  text = text.replace(/^import .*;\n/gm, '').replace(/^export (?=function |const )/gm, '');
  // The review wording and limits are the shared @elizaos/plugin-inbox/mailbox module at the pin.
  let shared = await readFile(new URL('../../' + reviewInputs[1], import.meta.url), 'utf8');
  shared = shared.replace(/^import .*;\n/gm, '').replace(/^export (?=function |const )/gm, '');
  return '{' + stripTypeScriptTypes(shared, { mode: 'strip' }) + stripTypeScriptTypes(text, { mode: 'strip' }) + '\nglobalThis.installUseInEmailReview=installUseInEmailReview;globalThis.describeEmailTarget=describeEmailTarget;globalThis.USE_IN_EMAIL_ATTACHMENT_POLICY=USE_IN_EMAIL_ATTACHMENT_POLICY;}';
};
export async function bootEmailReview() {
  const world = { session: { sessionId: 'agent-1', agentId: 'a', ownerId: 'o', origin: 'https://agent.invalid' }, cloud: 'cloud-1', chooser: false, hidden: false };
  const inserted = [], insertTokens = [], toasts = [];
  // The stub Inbox: one destination whose token changes whenever `revision` changes.
  const inbox = { revision: 1, ready: true, append: false, room: 64000,
    emailTarget() { return this.ready ? { ready: true, kind: 'reply', append: this.append, reply: true, subject: 'Re: Plan', to: ['sender@example.invalid'], from: 'Sender', room: this.room, accountId: 'grant-a', account: 'owner@example.invalid', token: 'token-' + this.revision }
      : { ready: false, reason: 'Restore or discard the saved local draft in Inbox first. The suggestion was not added.', token: 'blocked', accountId: 'grant-a', account: 'owner@example.invalid' }; },
    useInEmail(text, expected) { if (!this.ready || expected.token !== 'token-' + this.revision) return false; inserted.push({ text, append: expected.append === true }); insertTokens.push(this.revision); return true; } };
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
  return { world, inbox, inserted, insertTokens, toasts, shell, views, sandbox, reply, render: () => shell.renderVals(), row: id => shell.renderVals().msgs.find(m => m.id === id) };
}
