import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createSmsSession } from '../apps/app/src/runtime/image-sms.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const emptyPage = () => ({ rows: [], next: null });
const granted = { permissions: { sms: 'granted' }, subscriptions: [] };

function fixture(t, overrides = {}, image = true) {
  const counts = { reads: 0, stops: 0 };
  const client = {
    smsSendHistory: async () => [],
    status: async () => granted,
    threadPage: async () => {
      counts.reads++;
      return emptyPage();
    },
    messagePage: async () => emptyPage(),
    requestAccess: async () => {},
    observeMessages: async () => async () => { counts.stops++; },
    ...overrides,
  };
  const session = createSmsSession(client, image, () => {});
  t.after(() => session.setActive(false));
  return { session, counts };
}

test('off-image SMS never reads and leaving the image view clears rows and stops observation', async t => {
  const offImage = fixture(t, {}, false);
  offImage.session.setActive(true);
  await tick();
  assert.equal(offImage.counts.reads, 0);

  const rows = [{ id: 'thread:1' }];
  const { session, counts } = fixture(t, { threadPage: async () => ({ rows, next: null }) });
  session.setActive(true);
  await tick();
  assert.deepEqual(session.state.threads, rows);
  session.setActive(false);
  await tick();
  assert.equal(counts.stops, 1);
  assert.equal(session.state.status, null);
  assert.deepEqual(session.state.threads, []);
});

test('an old visit failure cannot erase rows fetched by a later visit', async t => {
  const firstRead = Promise.withResolvers();
  const rows = [{ id: 'thread:2' }];
  let reads = 0;
  const { session } = fixture(t, {
    threadPage: async () => ++reads === 1 ? firstRead.promise : { rows, next: null },
  });
  session.setActive(true);
  await tick();
  session.setActive(false);
  session.setActive(true);
  await tick();
  firstRead.reject(Error('permission revoked in old visit'));
  await tick();
  assert.deepEqual(session.state.threads, rows);
});

test('paging continues with the provider cursor', async t => {
  const cursors = [];
  const { session } = fixture(t, {
    threadPage: async cursor => {
      cursors.push(cursor);
      return { rows: [{ id: 'thread:3' }], next: cursor ? null : '10:thread:3' };
    },
  });
  session.setActive(true);
  await tick();
  await session.refresh(true);
  assert.deepEqual(cursors, [undefined, '10:thread:3']);
});

test('SMS reports permission denial and provider failure distinctly', async t => {
  for (const [overrides, message] of [
    [{ status: async () => ({ permissions: { sms: 'denied' } }) }, /not been granted/],
    [{ threadPage: async () => { throw Error('provider unavailable'); } }, /could not be read completely/],
  ]) {
    const { session } = fixture(t, overrides);
    session.setActive(true);
    await tick();
    assert.match(session.state.message, message);
  }
});

test('switching threads rejects a delayed read of the old thread', async t => {
  const firstRead = Promise.withResolvers();
  const rows = [{ id: 'sms:2' }];
  const { session } = fixture(t, {
    messagePage: async id => id === 'thread:1' ? firstRead.promise : { rows, next: null },
  });
  session.setActive(true);
  await tick();
  session.openThread('thread:1');
  await tick();
  session.openThread('thread:2');
  await tick();
  firstRead.resolve({ rows: [{ id: 'sms:1' }], next: null });
  await tick();
  assert.deepEqual(session.state.rows, rows);
});

test('SMS review completion is visit-bound and uncertain sends retain their operation ID', async t => {
  const pending = [];
  const operationIds = [];
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  let owner;
  t.after(() => {
    owner?.componentWillUnmount();
    delete globalThis.document;
    delete globalThis.__smsFixturePort;
  });
  globalThis.__smsFixturePort = {
    smsSendHistory: async () => [],
    status: async () => ({
      permissions: { sms: 'granted', phoneState: 'granted' },
      subscriptions: [{ id: 3, slot: 0, displayName: 'SIM' }],
    }),
    threadPage: async () => emptyPage(),
    observeMessages: async () => async () => {},
    sendSms: (_review, operationId) => {
      operationIds.push(operationId);
      const send = Promise.withResolvers();
      pending.push(send);
      return send.promise;
    },
  };

  const modules = {
    'platform-plugins': 'export const registerPlugin = () => globalThis.__smsFixturePort;',
    'aosp-image': 'export const aospImage = true;',
    'aosp-telephony': 'export const createAospTelephony = () => globalThis.__smsFixturePort;',
    'native-adapter': 'export const watchReturnToApp = () => () => {};',
  };
  const bundle = await build({
    entryPoints: ['apps/app/src/prototype/sms-adapter.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'native-fixture',
      setup(builder) {
        builder.onResolve({ filter: /\/(platform-plugins|aosp-image|aosp-telephony|native-adapter)$/ }, args => ({
          path: args.path.split('/').at(-1),
          namespace: 'fixture',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: modules[args.path] }));
      },
    }],
  });
  const { installSmsAdapter } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  class Component {
    view = 'messages';
    S() { return { view: this.view }; }
    setState() {}
  }
  const views = { messages: {} };
  installSmsAdapter(Component, views);
  owner = new Component();
  owner.componentDidMount();
  const render = () => views.messages.render();
  const compose = () => {
    const model = render();
    model.nativeOnRecipients({ target: { value: '+15555550100' } });
    model.nativeOnBody({ target: { value: 'hello' } });
    render().nativeSims[0].pick();
    render().nativeSend();
  };

  await tick();
  compose();
  await tick();
  owner.view = 'home';
  owner.componentDidUpdate();
  owner.view = 'messages';
  owner.componentDidUpdate();
  await tick();
  pending[0].resolve({ status: 'sent' });
  await tick();
  assert.equal(render().nativeNotice, '');
  assert.equal(render().nativeBody, '');

  compose();
  await tick();
  pending[1].reject(Error('transport lost'));
  await tick();
  assert.match(render().nativeNotice, /unknown/);
  render().nativeSend();
  await tick();
  assert.equal(operationIds[1], operationIds[2], 'retry must reuse the uncertain operation ID');
  pending[2].resolve({ status: 'unknown' });
  await tick();
});

test('old observer cleanup finishes before a new visit observes messages', async t => {
  const firstObserver = Promise.withResolvers();
  const calls = [];
  let attempt = 0;
  const { session } = fixture(t, {
    observeMessages: async () => {
      const id = ++attempt;
      calls.push(`start ${id}`);
      if (id === 1) await firstObserver.promise;
      return async () => { calls.push(`stop ${id}`); };
    },
  });
  session.setActive(true);
  await tick();
  session.setActive(false);
  session.setActive(true);
  await tick();
  assert.deepEqual(calls, ['start 1']);
  firstObserver.resolve();
  await tick();
  await tick();
  assert.deepEqual(calls, ['start 1', 'stop 1', 'start 2']);
});
