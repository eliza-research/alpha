import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {checkTraces, qset} from '../check-traces.mjs';
import {boundInputs, captureSources, checkpoint, deferred, read, tick, trace, call} from './support.mjs';

const model = 'CanonicalNotificationTapAdmission';
const modelPath = 'specs/quint/application/CanonicalNotificationTapAdmission.qnt';
const adapter = 'apps/app/src/prototype/notifications-adapter.ts';
const tokens = ['', '11111111-2222-4333-8444-555555555555', '22222222-2222-4333-8444-555555555555'];
const accounts = [undefined, {ownerId: 'owner-a', agentId: 'agent-a'}, {ownerId: 'owner-b', agentId: 'agent-b'}];

function fixture(name, code) {
  let generation = 0, currentTap = {}, selected, reads = 0, lostAck = false;
  const navigation = {revision: 0}, document = {hidden: false};
  const ui = {view: 'home', chat: false, draft: '', typing: false, recording: false};
  const connection = {session: accounts[1], busy: false, open: false, history: undefined};
  const readbacks = new Map(), restores = new Map(), commits = new Map(), captures = new Map();
  const published = new Set(), opens = [], attempts = [], acknowledged = new Set();
  const tokenId = value => tokens.indexOf(value ?? '');
  const accountId = value => Math.max(0, accounts.findIndex(account =>
    account && account.ownerId === value?.ownerId && account.agentId === value?.agentId));
  const tap = value => ({
    token: tokenId(value?.token), account: accountId(value),
    route: !value?.token ? 'none' : value.view === 'clock' ? 'calendar' :
      value.view === 'chat' && value.messageId ? 'exact' : value.view,
  });
  const currentToken = () => tokenId(captures.get(generation).tap.token);
  const native = {
    canonicalPending() {
      assert.equal(readbacks.has(generation), false);
      reads++;
      const port = deferred();
      readbacks.set(generation, port);
      captures.set(generation, {tap: {...currentTap}, session: accountId(connection.session),
        context: navigation.revision, view: ui.view});
      return port.promise;
    },
    async acknowledgeCanonical({token}) {
      attempts.push(tokenId(token));
      if (currentTap.token !== token) throw Error('Fixture native token changed');
      acknowledged.add(tokenId(token));
      currentTap = {};
      if (lostAck) throw Error('Fixture native read status unconfirmed after consuming token');
    },
    async addListener(event) {
      assert.equal(event, 'canonicalNotificationTap');
      return {async remove() {}};
    },
  };
  const context = vm.createContext({native, document, queueMicrotask,
    window: {addEventListener() {}, removeEventListener() {}},
    Capacitor: {isNativePlatform: () => true}, isMvpView: view => ['notes', 'calendar'].includes(view),
    alphaClient: {getState: () => ({context: navigation})},
    connectionController: {
      getSnapshot: () => connection,
      getSelectedConversationId: () => selected,
      subscribe: () => () => {},
      async restoreHistory(id, canCommit) {
        assert.equal(id, 'exact-conversation');
        assert.equal(restores.has(generation), false);
        const port = deferred();
        restores.set(generation, port);
        connection.busy = true;
        const found = await port.promise;
        if (canCommit()) {
          selected = id;
          connection.history = {conversationId: id, messages: found ? [{id: 'exact-message'}] : []};
        }
        connection.busy = false;
      },
    },
  });
  code.runInContext(context);
  class Shell {
    S() { return ui; }
    openView(view) {
      opens.push(currentToken());
      ui.view = view;
    }
    setState(patch, complete) {
      if (patch.chat === 'full') opens.push(currentToken());
      Object.assign(ui, patch);
      assert.equal(commits.has(generation), false);
      commits.set(generation, complete);
    }
  }
  context.install(Shell);
  const shell = new Shell();
  const observe = () => {
    const owner = shell.inspectCanonical?.();
    const live = owner?.live ?? false;
    const capture = live && owner.opening ? captures.get(generation) : undefined;
    const phase = !capture ? 'idle' : readbacks.has(generation) ? 'read' :
      restores.has(generation) ? 'restore' : commits.has(generation) ? 'commit' : assert.fail('unobserved tap phase');
    return {
      'state.generation': generation,
      'state.live': live,
      'state.busy': connection.busy,
      'state.protected': document.hidden || !!ui.draft.trim() || ui.typing || ui.recording || connection.open,
      'state.session': accountId(connection.session),
      'state.context': navigation.revision,
      'state.view': ui.view,
      'state.chat': ui.chat === 'full',
      'state.exactHistory': selected === 'exact-conversation' &&
        !!connection.history?.messages.some(row => row.id === 'exact-message'),
      'state.phase': phase,
      'state.drain': live && owner.drainRequested,
      'state.pending': tap(currentTap),
      'state.captured': tap(capture?.tap),
      'state.published': qset(published),
      'state.originSession': capture?.session ?? 0,
      'state.originContext': capture?.context ?? 0,
      'state.originView': capture?.view ?? 'home',
      'state.reads': reads,
      'state.opens': [...opens],
      'state.attempts': [...attempts],
      'state.acknowledged': qset(acknowledged),
    };
  };
  const result = trace(name, observe());
  const save = async (label, ...action) => {
    await tick();
    checkpoint(result, label, call(...action), observe());
  };
  return {
    result,
    end: () => shell.componentWillUnmount?.(),
    async mount() {
      generation++;
      shell.componentDidMount();
      await save('mount the actual tap adapter on this component', 'mount');
    },
    async retire() {
      shell.componentWillUnmount();
      await save('retire this exact mount and its pending render callback', 'retire');
    },
    async publish(id, account, route) {
      published.add(id);
      currentTap = {token: tokens[id], ...accounts[account],
        view: route === 'calendar' ? 'clock' : route === 'exact' ? 'chat' : route,
        ...(route === 'exact' ? {conversationId: 'exact-conversation', messageId: 'exact-message'} : {})};
      await save('native compare-and-clear custody receives a new token', 'publish', id, account, route);
    },
    async wake() {
      shell.alphaCanonicalWake();
      await save('the native event or focus wake drains one tap at a time', 'wake');
    },
    async probe() {
      void shell.alphaCanonicalTap();
      await save('a current connection probes the actual tap path', 'probe');
    },
    async busy(value) {
      connection.busy = value;
      await save('a connection operation changes busy state', 'setBusy', value);
    },
    async protect(value, kind = 'draft') {
      if (kind === 'hidden') document.hidden = value;
      else if (kind === 'dialog') connection.open = value;
      else ui.draft = value ? 'Fixture draft' : '';
      await save('the renderer becomes protected or available', 'protect', value);
    },
    async session(id) {
      connection.session = accounts[id];
      connection.history = undefined;
      selected = undefined;
      await save('replace or retire the verified connection session', 'switchSession', id);
    },
    async navigate(view) {
      ui.view = view;
      ui.chat = false;
      navigation.revision++;
      selected = 'manual-conversation';
      connection.history = {conversationId: selected, messages: []};
      await save('user navigation replaces the captured origin', 'navigate', view);
    },
    async reply(ok, owner = generation) {
      const readback = readbacks.get(owner);
      assert.ok(readback);
      readbacks.delete(owner);
      if (ok) readback.resolve(captures.get(owner).tap);
      else readback.reject(Error('Fixture native read unavailable'));
      if (owner === generation && shell.inspectCanonical().live)
        await save('native readback is handled only by its current mount', 'readReply', ok);
      else await save('old mount readback cannot publish in a new lifetime', 'staleCompletion');
    },
    async restore(found) {
      const port = restores.get(generation);
      assert.ok(port);
      restores.delete(generation);
      port.resolve(found);
      await save('the exact conversation and message restore under the captured origin', 'restored', found);
    },
    async commit(lose = false, owner = generation) {
      const callback = commits.get(owner);
      assert.ok(callback);
      commits.delete(owner);
      lostAck = lose;
      callback();
      await save('renderer commit admits only the exact native token acknowledgment',
        owner === generation && shell.inspectCanonical().live ? 'committed' : 'staleCompletion');
    },
  };
}

export async function checkCanonicalNotificationTapAdmission() {
  const sources = [fileURLToPath(import.meta.url), adapter, 'apps/app/src/main.tsx', 'apps/app/src/runtime/connection-ui.tsx',
    'android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaCanonicalNotifications.java',
    'android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaNotificationsPlugin.java'];
  captureSources([...sources, modelPath]);
  const text = read(adapter);
  const start = text.indexOf('export function installCanonicalNotificationTaps');
  const end = text.indexOf('/** Active rows only.', start);
  assert.ok(start >= 0 && end > start);
  const marker = '  const tapCurrent=async()=>{';
  const method = text.slice(start, end).replace(/^export /, '');
  assert.equal(method.split(marker).length, 2);
  const code = new vm.Script(stripTypeScriptTypes(method.replace(marker, '  this.inspectCanonical=()=>owner;\n' + marker) +
    '\nglobalThis.install=installCanonicalNotificationTaps;', {mode: 'strip'}));
  const traces = [];
  async function run(name, sequence) {
    const owner = fixture(name, code);
    try {
      await sequence(owner);
      traces.push(owner.result);
    } finally { owner.end(); }
  }
  await run('held_commit_coalesces_wake_and_lost_ack', async f => {
    await f.publish(1, 1, 'notes'); await f.mount(); await f.reply(true);
    await f.wake(); await f.commit(true); await f.reply(true);
  });
  await run('busy_after_read_refuses_until_current_connection_retries', async f => {
    await f.publish(1, 1, 'notes'); await f.mount(); await f.busy(true); await f.reply(true);
    await f.busy(false); await f.probe(); await f.reply(true); await f.commit();
  });
  await run('old_mount_cannot_publish_into_reused_shell', async f => {
    await f.publish(1, 1, 'notes'); await f.mount(); await f.retire();
    await f.publish(2, 1, 'calendar'); await f.mount(); await f.reply(true); await f.commit();
    await f.reply(true, 1);
  });
  await run('exact_history_has_its_own_busy_read', async f => {
    await f.publish(1, 1, 'exact'); await f.mount(); await f.reply(true); await f.restore(true); await f.commit();
  });
  await run('manual_navigation_blocks_exact_history', async f => {
    await f.publish(1, 1, 'exact'); await f.mount(); await f.reply(true);
    await f.navigate('calendar'); await f.restore(true);
  });
  await run('new_native_token_survives_old_commit', async f => {
    await f.publish(1, 1, 'chat'); await f.mount(); await f.reply(true);
    await f.publish(2, 1, 'notes'); await f.wake(); await f.commit(); await f.reply(true); await f.commit();
  });
  await run('foreign_owner_and_protected_editor_preserve_custody', async f => {
    await f.publish(1, 2, 'notes'); await f.mount(); await f.reply(true);
    await f.session(2); await f.protect(true); await f.wake(); await f.protect(false);
    await f.probe(); await f.reply(true); await f.protect(true, 'dialog'); await f.commit();
    await f.protect(false, 'dialog'); await f.probe(); await f.reply(true); await f.commit();
  });
  await run('failed_read_never_acknowledges', async f => {
    await f.publish(1, 1, 'calendar'); await f.mount(); await f.reply(false);
    await f.wake(); await f.reply(true); await f.retire(); await f.commit();
  });

  return checkTraces(boundInputs({model, modelPath, sources, traces, scope: 'bounded-orchestration',
    assumptions: ['The actual mounted renderer adapter runs with controlled native and history ports. A read-only hook observes the mount lease.',
      'Synthetic native custody copies one read and compare-and-clears the exact token before an optional lost acknowledgement.',
      'Installed tap expiry, foreground delivery and the real resident read effect remain separate.']}));
}
