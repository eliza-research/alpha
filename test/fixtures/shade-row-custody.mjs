import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../support/strip-types.mjs';
import {createOwnNoticeRevisions,noticeKind} from '../../apps/app/src/prototype/context-selection.ts';

const adapter = new URL('../../apps/app/src/prototype/notifications-adapter.ts', import.meta.url);
export const shadeRowCustodySources = [import.meta.url, adapter,
  new URL('../../apps/app/src/prototype/context-selection.ts', import.meta.url),
  new URL('../../apps/app/src/prototype/template.html', import.meta.url),
  new URL('../support/strip-types.mjs', import.meta.url), new URL('../../bun.lock', import.meta.url)].map(fileURLToPath);

const tick = () => new Promise(resolve => setImmediate(resolve));
export const notice = (id, revision = '1', source = 'own', canOpen = true, clearable = true) =>
  ({id, revision, source, canOpen, clearable, title: 'Synthetic ' + id, text: 'Synthetic text', appLabel: 'Closed fixture', at: 0});
const copy = value => structuredClone(value);

/** Runs the actual installed lifecycle, timer and rendered handlers with a closed bridge. */
export function shadeRowCustodyFixture() {
  const source = readFileSync(adapter, 'utf8');
  const code = source.slice(source.indexOf('const opaque'), source.indexOf('type Notice =')) + '\n' +
    source.slice(source.indexOf('export function installNotificationsAdapter'));
  const document = new EventTarget(), window = new EventTarget();
  document.hidden = false;
  const requests = [], operations = [], toasts = [], slots = new Map();
  let timer, swallowed = false;
  const timers = [];
  window.setTimeout = fn => timers.push(fn);
  window.setInterval = fn => {timer = fn; return 1;};
  const clearInterval = () => {timer = undefined;};
  class Shell {
    state = {shade: true, screen: 'home'};
    renders = 0;
    S() {return this.state;}
    renderVals() {return {ic: {bell: 'synthetic'}};}
    setState(patch) {
      const before = this.state;
      this.state = {...before, ...patch};
      this.renders++;
      this.renderVals();
      this.componentDidUpdate(undefined, before);
    }
    swallowed() {return swallowed;}
    sw(dismiss) {return {down() {}, up() {if (swallowed) dismiss();}};}
    toast(message) {toasts.push(message);}
  }
  const native = {list() {return new Promise((resolve, reject) => requests.push({resolve, reject, pending: true}));}};
  for (const kind of ['open', 'dismiss', 'clear']) native[kind] = input => new Promise((resolve, reject) => {
    const keys = copy(kind === 'clear' ? input.items : [input]);
    operations.push({kind, keys, pending: true, resolve, reject});
  });
  const unusedReview = () => {throw Error('Question dialog is outside the row action fixture');};
  vm.runInNewContext(stripTypeScriptTypes(code.replace(/^export /gm, '')) + '\ninstallNotificationsAdapter(Shell);',
    {Shell, window, document, clearInterval, native, Capacitor: {isNativePlatform: () => false},
      createOwnNoticeRevisions,noticeKind, noticeReviewable: () => false, reviewContentQuestion: unusedReview, formatTime: () => 'time'});
  const shell = new Shell();
  shell.renderVals();
  shell.componentDidMount();
  const visits = new WeakMap([[shell.alphaNoticeVisit, 0]]);
  let lastVisit = 0;
  const settle = async (queue, index, value, failed) => {
    const item = queue[index - 1];
    assert.ok(item?.pending, 'The selected closed port is pending');
    item.pending = false;
    if (failed) item.reject(Error('Closed fixture refusal'));
    else item.resolve(value);
    await tick();
  };
  return {shell, requests, operations, toasts,
    async poll() {timer?.(); await tick();},
    async finishPoll(index, items, result = 'ok') {
      await settle(requests, index, {items: copy(items), calendarStatus: result}, result === 'error');
    },
    async finishOperation(index, result = 'ok') {
      const value = operations[index - 1]?.kind === 'clear' ? {outcomes: [{status: result}]} : undefined;
      await settle(operations, index, value, result === 'error');
    },
    capture(slot) {slots.set(slot, shell.renderVals());},
    async act(slot, kind, id) {
      const output = slots.get(slot);
      assert.ok(output);
      if (kind === 'clear') output.clearAll();
      else {
        const row = output.shadeN.find(item => item.id === id);
        assert.ok(row);
        if (kind === 'open') row.open();
        else {
          swallowed = kind === 'dismiss';
          row.down({});
          row.up({});
          swallowed = false;
        }
      }
      while (timers.length) timers.shift()();
      await tick();
    },
    set(patch) {shell.setState(patch);},
    async visibility(hidden) {document.hidden = hidden; document.dispatchEvent(new Event('visibilitychange')); await tick();},
    async deviceState() {window.dispatchEvent(new Event('alpha:device-state')); await tick();},
    unmount() {shell.componentWillUnmount();},
    observe() {
      const {shade, screen} = shell.state;
      const selected = shell.alphaNoticeSelection ? copy(shell.alphaNoticeSelection) : null;
      if (shell.alphaNoticesLive && !document.hidden && shade && screen === 'home') {
        const wire = shell.notificationSelection();
        assert.deepEqual(wire === undefined ? undefined : copy(wire), selected ?
          {kind: 'notification', id: selected.id, revision: selected.revision, accountId: 'own'} : undefined,
        'the real context accessor expands only the exact selected opaque notice');
      }
      const identity = shell.alphaNoticeVisit;
      if (!visits.has(identity)) visits.set(identity, ++lastVisit);
      return {shade, screen, visit: visits.get(identity), epoch: shell.alphaNoticeEpoch, hidden: document.hidden, live: shell.alphaNoticesLive,
        items: copy(shell.alphaNotices.map(({id, revision, source, canOpen, clearable}) => ({id, revision, source, canOpen, clearable}))),
        selection: selected,
        renderedSelection: JSON.parse(shell.alphaNoticeSelectionRendered),
        busy: !!shell.alphaNoticesBusy, error: !!shell.alphaNoticeError, calendarError: !!shell.alphaCalendarAlertError,
        reads: requests.length, renders: shell.renders,
        operations: operations.map(({kind, keys, pending}) => ({kind, keys, pending})), toasts: [...toasts]};
    },
  };
}
