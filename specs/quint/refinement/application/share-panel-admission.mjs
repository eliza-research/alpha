import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {captureInputs, checkTraces, qset} from '../check-traces.mjs';
import {call, checkpoint, sourceContext, tick, trace} from './support.mjs';

const model = 'SharePanelAdmission';
const source = 'apps/app/src/runtime/share-panel.ts';
const labels = {email: 'Email', external: 'Share', copy: 'Copy text', save: 'Save file', cancel: 'Close share'};
const ownInputs = [source, fileURLToPath(import.meta.url), fileURLToPath(new URL('./support.mjs', import.meta.url)),
  fileURLToPath(new URL('../../../../test/support/strip-types.mjs', import.meta.url))];

function sharePanelFixture() {
  const dom = new JSDOM('<!doctype html><button id="origin">Share selection</button>');
  const {window} = dom;
  const {document} = window;
  let hidden = false;
  Object.defineProperty(document, 'hidden', {get: () => hidden});
  window.HTMLDialogElement.prototype.showModal = function () {this.open = true;};
  window.HTMLDialogElement.prototype.close = function () {this.open = false;};
  const polls = new Set();
  const {openSharePanel} = sourceContext([source], ['openSharePanel'], {
    window, document, DOMException: window.DOMException,
    setInterval: run => {polls.add(run); return run;}, clearInterval: run => polls.delete(run),
    setTimeout: () => undefined,
  });
  const panels = [], effects = [];
  const settled = new Set();
  document.querySelector('#origin').focus();
  const current = () => {
    const live = panels.filter(panel => panel.dialog?.isConnected);
    if (live.length > 1) throw Error('More than one share panel remains mounted');
    return live[0];
  };
  const mark = () => {
    const active = current();
    return {'s.seen': panels.length, 's.active': active?.id ?? 0, 's.hidden': hidden,
      's.invalid': qset(panels.filter(panel => !panel.current).map(panel => panel.id)),
      's.emails': qset(panels.filter(panel => panel.buttons.email && !panel.buttons.email.disabled).map(panel => panel.id)),
      's.settled': qset([...settled]), 's.effects': effects.map(effect => ({...effect})),
      's.notice': !!active?.dialog.querySelector('[role="status"]')?.textContent,
      's.alerts': document.querySelectorAll('[role="alert"]').length};
  };
  return {
    mark, close: () => window.close(),
    open(email) {
      const panel = {id: panels.length + 1, current: true, outcome: 'ok'};
      panels.push(panel);
      const run = destination => () => {
        effects.push({panel: panel.id, destination, closed: !panel.dialog.isConnected});
        if (panel.outcome === 'abort') throw new window.DOMException('Canceled fixture', 'AbortError');
        if (panel.outcome === 'fail') return Promise.reject(Error('Closed destination refused'));
      };
      const done = openSharePanel({title: 'Synthetic item ' + panel.id, current: () => panel.current,
        email: email ? run('email') : undefined, external: run('external'), copy: run('copy'), save: run('save')});
      panel.dialog = document.querySelector('dialog.alpha-share-panel');
      panel.buttons = Object.fromEntries([...panel.dialog?.querySelectorAll('button') ?? []].map(button =>
        [Object.keys(labels).find(name => labels[name] === (button.textContent||button.getAttribute('aria-label'))), button]));
      void done.then(() => settled.add(panel.id));
    },
    choose(id, destination, outcome) {
      const panel = panels[id - 1];
      panel.outcome = outcome;
      // Retain the actual button to exercise a late or repeated DOM event.
      panel.buttons[destination]?.dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true}));
    },
    invalidate() {current().current = false;},
    poll() {for (const run of [...polls]) run();},
    visibility(value) {hidden = value; document.dispatchEvent(new window.Event('visibilitychange'));},
    retire(event) {
      const target = ['cancel', 'close'].includes(event) ? current().dialog : window;
      target.dispatchEvent(new window.Event(event, {cancelable: true}));
    },
  };
}

export async function checkSharePanelAdmission(extraSources = []) {
  const sources = [...new Set([...ownInputs, ...extraSources])];
  const driverHashes = captureInputs(sources);
  const traces = [];
  async function scenario(name, run) {
    const f = sharePanelFixture();
    try {
      const t = trace(name, f.mark());
      const step = async (action, args, execute, label) => {
        execute();
        await tick();
        checkpoint(t, label, call(action, ...args), f.mark());
      };
      const open = email => step('open', [email], () => f.open(email), 'Open the actual destination chooser');
      const choose = (id, destination, outcome = 'ok') => step('choose', [id, destination, outcome],
        () => f.choose(id, destination, outcome), `Deliver the ${destination} button event for panel ${id}`);
      const visibility = hidden => step('visibility', [hidden], () => f.visibility(hidden), 'Deliver the document visibility event');
      const retire = event => step('retire', [], () => f.retire(event), 'Retire via ' + event);
      await run({open, choose, visibility, retire, step, f});
      traces.push(t);
    } finally {f.close();}
  }
  await scenario('only the successor can hand off, and its own duplicate event is inert', async c => {
    await c.open(true); await c.open(false); await c.choose(1, 'external'); await c.choose(2, 'email');
    await c.choose(2, 'copy'); await c.choose(2, 'copy');
  });
  await scenario('changed selection shows its refusal before the poll removes the panel', async c => {
    await c.open(true);
    await c.step('invalidate', [], c.f.invalidate, 'Change the caller selection while its panel is visible');
    await c.choose(1, 'email');
    await c.step('poll', [], c.f.poll, 'Deliver the selection poll');
    await c.choose(1, 'external');
  });
  await scenario('hide retires, hidden opens settle, and Cancel has no fallback', async c => {
    await c.open(true); await c.visibility(true); await c.open(false); await c.visibility(false);
    await c.choose(1, 'copy'); await c.open(true); await c.choose(3, 'cancel'); await c.choose(3, 'save');
  });
  await scenario('external cancellation is silent, a failed email reports, and save is explicit', async c => {
    await c.open(true); await c.choose(1, 'external', 'abort'); await c.open(true);
    await c.choose(2, 'email', 'fail'); await c.open(false); await c.choose(3, 'save');
  });
  for (const event of ['alpha-back', 'launcher-home', 'pagehide', 'alpha:device-state', 'alpha:dev-incoming-call', 'cancel', 'close']) {
    await scenario(event + ' retires the exact panel without dispatch', async c => {
      await c.open(true); await c.retire(event); await c.choose(1, 'external');
    });
  }
  return checkTraces({model, sources, driverHashes, traces, scope: 'bounded-component',
    assumptions: ['Actual common Share chooser executes in JSDOM with closed destination functions and explicit dialog primitives, timers, caller selection and document visibility. No device/provider destination is invoked.',
      'Up to three panels per trace. Source observations include actual dialog attachment, enabled email row, status and alert, promise settlement and which exact destination function ran.',
      'Mounted browser focus/keyboard behavior, arbitrary caller reentrancy, timer expiry, and destination or platform behavior remain separate.']});
}
