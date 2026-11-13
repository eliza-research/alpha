import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {checkTraces, qset} from '../specs/quint/refinement/check-traces.mjs';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import {boundInputs, captureSources, checkpoint, read, tick, trace, call} from '../specs/quint/refinement/application/support.mjs';

const model = 'ModalToastForwarding';
const modelPath = 'specs/quint/application/ModalToastForwarding.qnt';
const layer = 'apps/app/src/runtime/toast-layer.ts';
const hostSelector = '[data-alpha-dialog-toast]';

function fixture(name, code, customIds = [], wrapped = false) {
  const dom = new JSDOM([1, 2].map(id => customIds.includes(id)
    ? `<section id="${id}" role="dialog" aria-modal="false" hidden>${wrapped ? '<div>' : ''}<button>Control</button>${wrapped ? '</div>' : ''}</section>`
    : `<dialog id="${id}"><button>Control</button></dialog>`).join('') + '<div data-alpha-toast></div>');
  const {window} = dom, {document} = window;
  // JSDOM supplies real observer records and DOM ownership. The fixture supplies native modal membership.
  for (const [prototype, method] of [[window.Element.prototype, 'matches'],
    [window.Element.prototype, 'closest'], [window.Document.prototype, 'querySelectorAll']]) {
    const original = prototype[method];
    prototype[method] = function (selector) {
      return original.call(this, selector.replaceAll(':modal', '[data-fixture-modal]'));
    };
  }
  let frameId = 0, clicks = 0;
  const frames = new Map();
  const context = vm.createContext({
    window, document, HTMLElement: window.HTMLElement, HTMLDialogElement: window.HTMLDialogElement,
    MutationObserver: window.MutationObserver, getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  code.runInContext(context);
  const handles = new Map();
  const source = document.querySelector('[data-alpha-toast]');
  const dialogs = [];
  const observe = () => {
    const regions = [...document.querySelectorAll(hostSelector)];
    const forwarded = regions.filter(region => region.querySelector('span'));
    assert.ok(forwarded.length <= 1);
    return {
      'state.installed': [...handles].find(([, stop]) => stop === context.current())?.[0] ?? 0,
      'state.generation': handles.size,
      'state.dialogs': [...dialogs],
      'state.sourceMessage': Number(source.querySelector('span')?.textContent ?? ''),
      'state.sourceUndo': Boolean(source.querySelector('button')),
      'state.regions': qset(regions.map(region => Number(region.closest('dialog,[role="dialog"]').id))),
      'state.target': Number(forwarded[0]?.closest('dialog,[role="dialog"]').id ?? 0),
      'state.visible': Number(forwarded[0]?.querySelector('span').textContent ?? ''),
      'state.undo': Boolean(forwarded[0]?.querySelector('button')),
      'state.clicks': clicks,
    };
  };
  const result = trace(name, observe());
  async function settle(label, action) {
    for (let pass = 0; pass < 4; pass++) {
      await tick();
      if (!frames.size) {
        checkpoint(result, label, action, observe());
        return;
      }
      const queued = [...frames.values()];
      frames.clear();
      for (const callback of queued) callback();
    }
    assert.fail('toast observer did not settle after flushing its animation frame');
  }
  function open(id) {
    const dialog = document.getElementById(String(id));
    assert.ok(!dialogs.includes(id));
    dialogs.push(id);
    if (customIds.includes(id)) {
      dialog.removeAttribute('hidden');
      dialog.setAttribute('aria-modal', 'true');
    } else {
      dialog.setAttribute('data-fixture-modal', '');
      dialog.setAttribute('open', '');
    }
    dialog.querySelector('button').focus();
  }
  function close(id) {
    const dialog = document.getElementById(String(id));
    assert.ok(dialogs.includes(id));
    dialogs.splice(dialogs.indexOf(id), 1);
    if (customIds.includes(id)) {
      dialog.setAttribute('aria-modal', 'false');
      dialog.setAttribute('hidden', '');
    } else {
      dialog.removeAttribute('open');
      dialog.removeAttribute('data-fixture-modal');
    }
    const top = dialogs.at(-1);
    if (top) document.getElementById(String(top)).querySelector('button').focus();
  }
  return {
    result,
    end: () => { context.current()?.(); window.close(); },
    async install() {
      const previous = context.current(), stop = context.install();
      if (previous) assert.equal(stop, previous);
      else handles.set(handles.size + 1, stop);
      await settle('install or reuse the actual document observer', call('install'));
    },
    async dispose(owner) {
      const stop = handles.get(owner);
      assert.ok(stop);
      stop();
      await settle('clean up the exact installation owner', call('dispose', owner));
    },
    async open(id) {
      open(id);
      await settle('browser opens an exact modal', call('open', id));
    },
    async close(id) {
      close(id);
      await settle('browser closes the exact modal', call('close', id));
    },
    async batch(actions) {
      for (const [name, id] of actions) {
        if (name === 'open') open(id);
        else close(id);
      }
      await settle('one observer delivery preserves the browser open order', actions.map(args => call(...args)));
    },
    async show(message, undo) {
      const body = document.createElement('div'), text = document.createElement('span');
      text.textContent = String(message);
      body.append(text);
      if (undo) {
        const button = document.createElement('button');
        button.onclick = () => { clicks++; };
        body.append(button);
      }
      source.replaceChildren(body);
      await settle('page publishes a toast and optional Undo', call('show', message, undo));
    },
    async clear() {
      source.replaceChildren();
      await settle('page removes the toast', call('clearToast'));
    },
    async undo() {
      const button = document.querySelector(`${hostSelector} button`);
      assert.ok(button);
      button.click();
      await settle('forwarded Undo dispatches to the live page button', call('forwardUndo'));
    },
  };
}

async function checkModalToastForwarding() {
  const sources = [fileURLToPath(import.meta.url), layer, 'apps/app/src/main.tsx', 'apps/app/src/prototype/template.html'];
  captureSources([...sources, modelPath]);
  const text = stripTypeScriptTypes(read(layer), {mode: 'strip'}).replace(/^export /gm, '');
  const code = new vm.Script(`${text}\nglobalThis.install = installToastLayer; globalThis.current = () => installed;`);
  const traces = [];
  async function run(name, sequence, customIds, wrapped) {
    const owner = fixture(name, code, customIds, wrapped);
    try {
      await sequence(owner);
      traces.push(owner.result);
    } finally { owner.end(); }
  }
  await run('aria_backdrop_panel_owns_feedback', async f => {
    await f.install(); await f.open(1); await f.show(1, true);
    await f.undo(); await f.close(1);
  }, [1, 2], true);
  await run('reverse_document_order', async f => {
    await f.install(); await f.show(1, true); await f.batch([['open', 2], ['open', 1]]);
    await f.undo(); await f.close(1); await f.clear(); await f.close(2);
  });
  await run('reopen_in_same_observer_delivery', async f => {
    await f.install(); await f.batch([['open', 1], ['open', 2]]);
    await f.show(1, false); await f.batch([['close', 1], ['open', 1]]);
    await f.show(2, true); await f.undo();
  });
  await run('old_disposer_does_not_retire_replacement', async f => {
    await f.install(); await f.install(); await f.open(1); await f.show(1, false);
    await f.dispose(1); await f.install(); await f.dispose(1); await f.dispose(2);
  });
  await run('install_with_existing_focused_modal', async f => {
    await f.batch([['open', 2], ['open', 1]]);
    await f.show(1, false); await f.install(); await f.close(1); await f.close(2);
  });
  await run('source_toast_changes_under_one_modal', async f => {
    await f.install(); await f.open(2); await f.show(1, true); await f.show(2, true);
    await f.undo(); await f.show(2, false); await f.clear();
  });
  await run('custom_dialogs_use_the_same_open_order', async f => {
    await f.install(); await f.batch([['open', 2], ['open', 1]]);
    await f.show(1, true); await f.undo(); await f.close(1); await f.close(2);
  }, [1, 2]);
  await run('custom_and_native_dialogs_share_one_toast_owner', async f => {
    await f.install(); await f.open(1); await f.show(1, false); await f.open(2);
    await f.show(2, true); await f.undo(); await f.close(2); await f.clear(); await f.close(1);
  }, [2]);

  return checkTraces(boundInputs({model, modelPath,
    sources, traces, scope: 'bounded-component',
    assumptions: ['Actual toast-layer source executes with DOM mutations and controlled animation frames.',
      'The DOM fixture supplies native modal membership and focus; custom dialogs use their real ARIA and hidden attributes. Observations are after observer and frame settlement.',
      'Platform focus fallback for dialogs opened before installation, installed assistive technology and latency remain separate.']}));
}

test('actual dialog toast forwarding follows modal order and exact installation ownership', {timeout: scaledTimeout(60000)}, async () => {
  const receipt = await checkModalToastForwarding();
  assert.equal(receipt.traceInputs.length, 8);
  assert.equal(receipt.observedFields.length, 10);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
