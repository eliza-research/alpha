import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkTraces, qset} from '../check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, trace} from './support.mjs';
import {withHostedDigestRefresh} from './hosted-digest-refresh.mjs';

const driver = fileURLToPath(import.meta.url);
const refusal = 'The source or account changed. Nothing was added to your conversation.';
const synced = 'Synced with this agent.';
const messages = new Map([[refusal, 'refused'], [synced, 'synced'], ['No fixture session', ''], ['', '']]);
const idOf = (value, prefix) => {
  if (!value) return 0;
  const id = [1, 2].find(id => value === prefix+id);
  assert.ok(id, 'Unexpected fixture identity '+value);
  return id;
};

function observe(state) {
  assert.equal(state.session, state.binding);
  const owner = idOf(state.binding, 'session-');
  const held = kind => qset(state.requests.filter(row => row.kind === kind && !row.done).map(row => row.id));
  const effects = discard => qset(state.settlements.filter(([, value]) => value === discard).map(([id]) => id));
  const drafts = state.compositions.map(({draft, session}) => {
    assert.equal(draft, 'Help me understand this source renewal.\n\nSource: Scheduled source renewal notification\n\nA brief source expires soon. Renew it to keep your brief updated.');
    return idOf(session, 'session-');
  });
  assert.ok(messages.has(state.message), 'Unexpected renewal status '+state.message);
  return {'s.owner': owner, 's.visited': qset(state.visited), 's.pending': idOf(state.renewalTap, 'tap-'),
    's.exact': state.renewalExact, 's.dialog': state.renewalDialog ? owner : 0, 's.reading': held('renewal-read'),
    's.settling': held('renewal-settle'), 's.attempts': effects(false), 's.discarded': effects(true),
    's.drafts': qset(drafts), 's.sensitive': state.sensitive, 's.composer': state.canCompose, 's.notice': messages.get(state.message)};
}

async function schedule(run, name, steps) {
  const t = trace(name, observe(await run('observe')));
  for (const [operation, ...args] of steps) {
    if (operation === 'attach') {
      await run('select', args[0]);
      await run('history', args[0]);
      await run('sync', args[0]);
    } else if (operation === 'notify') await run('showRenewal', args[0], true, args[1]);
    else if (operation === 'readReply') await run('renewalRead', ...args);
    else if (operation === 'settleReply') await run('renewalSettle', args[0], !args[1]);
    else {
      const commands = {accept: 'acceptRenewal', dismiss: 'dismissRenewal', interrupt: 'interruptRenewal'};
      await run(commands[operation] ?? operation, ...args);
    }
    checkpoint(t, [operation, ...args].join(' '), call(operation, ...args), observe(await run('observe')));
  }
  return t;
}

export async function checkSourceRenewalQuestion(extraSources = []) {
  captureSources([driver, ...extraSources]);
  const attach = id => ['attach', id];
  const notify = (id, exact = true) => ['notify', id, exact];
  const accept = ['accept'];
  const dismiss = ['dismiss'];
  const interrupt = ['interrupt'];
  const read = (id, matches = true) => ['readReply', id, matches];
  const settle = (id, success = true) => ['settleReply', id, success];
  const opened = [attach(1), notify(1)];
  const accepted = [...opened, accept];
  const cases = [
    ['exact-review-reread-settle-and-compose', [...accepted, read(1), settle(1)]],
    ['retired-settlement-cannot-report-or-consume-new-review',
      [...accepted, read(1), attach(2), notify(2), settle(1), accept, read(2), settle(2)]],
    ['unavailable-composer-preserves-tap-for-a-new-review',
      [...accepted, ['conversation', false], read(1), ['conversation', true], notify(1), accept, read(1), settle(1)]],
    ['wrong-revision-and-sensitive-screen-do-not-open',
      [attach(1), notify(1, false), ['sensitivity', true], notify(1), ['sensitivity', false], notify(1), dismiss]],
    ['retired-read-cannot-settle-or-report',
      [...accepted, attach(2), notify(2), read(1), accept, read(2), settle(2)]],
    ['lifecycle-close-preserves-an-unsubmitted-tap', [...opened, interrupt, notify(1), dismiss]],
    ['lifecycle-close-after-approval-preserves-the-tap', [...accepted, interrupt, read(1)]],
    ['native-settlement-refusal-retains-exact-tap', [...accepted, read(1), settle(1, false)]],
    ['native-reread-must-still-return-the-same-token', [...accepted, read(1, false)]],
    ['composer-retired-after-dispatch-does-not-compose',
      [...accepted, read(1), ['conversation', false], settle(1)]],
    ['pending-tap-resumes-only-after-matching-owner-source-load', [notify(2), attach(1), attach(2), dismiss]],
  ];
  const {observations: traces, sources} = await withHostedDigestRefresh(async scenario => {
    const results = [];
    for (const [name, steps] of cases) results.push(await scenario(run => schedule(run, name, steps)));
    return results;
  }, [driver, ...extraSources], {native: true});
  return checkTraces(boundInputs({model: 'SourceRenewalQuestion', traces, sources, scope: 'bounded-orchestration', assumptions: [
    'The actual mounted digest panel, renewal question, shared tap resolver and content dialog execute in Chromium. Android bridge, digest transport, sensitive-context and conversation ports are controlled.',
    'Attach groups owner publication, held history, and successful source/loop/inbox refresh. Two unique binding lifetimes and at most one approved question in flight per owner. Tap effects are projected as owner sets, not counters.',
    'Hidden interruption and failure ownership are compared through dialog retirement, exact native settlement, status and draft publication. Native scheduling, actual Android events, interactive renewal rebind and composition after source mutation remain separate.',
  ]}));
}
