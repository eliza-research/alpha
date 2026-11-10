import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {captureInputs, checkTraces, qmap} from '../check-traces.mjs';

const source = 'apps/app/src/prototype/model.js';
const names = ['Settings', 'General', 'Display', 'About', 'Licenses'];
const controls = [[1, 2], [3, 4], [5], [6, 7], [8]];
function fixture() {
  const dom = new JSDOM('<div id="pages"><div data-settings-page="Settings"></div></div>');
  const {document} = dom.window, root = document.querySelector('#pages');
  const text = readFileSync(source, 'utf8');
  const start = text.indexOf('var stPageFocus ='), end = text.indexOf('/* the prototype page', start);
  assert.ok(start >= 0 && end > start);
  const actual = vm.runInNewContext(text.slice(start, end) + ';({access:stPageAccess,inspect:()=>stPageFocus.get(root)})', {document, root});
  const render = page => {
    root.querySelector('[data-settings-page="Settings"]').innerHTML = controls[0].map(id => `<button id="c${id}" aria-label="control-${id}">${id}</button>`).join('');
    for (const child of [...root.children].slice(1)) child.remove();
    if (page) {
      const child = document.createElement('div');
      child.setAttribute('data-settings-page', names[page]);
      child.innerHTML = controls[page].map(id => `<button id="c${id}" aria-label="control-${id}">${id}</button>`).join('');
      root.append(child);
    }
    actual.access(root);
  };
  render(0);
  return {
    observe() {
      const value = actual.inspect();
      return {'s.page': names.indexOf(value.page.getAttribute('data-settings-page')),
        's.focus': Number(document.activeElement.id.slice(1)) || 0,
        's.saved': qmap(names.map((name, page) => [page, Number(value.saved.get(`${page ? 1 : 0}:${name}`)?.id.slice(1)) || 0]))};
    },
    run(name, args) {
      if (name === 'focus') document.getElementById('c' + args[0]).focus();
      else if (name === 'show') render(args[0]);
      else if (name === 'remount') render(names.indexOf(actual.inspect().page.getAttribute('data-settings-page')));
      else throw Error('Unexpected Settings focus action');
    },
    close: () => dom.window.close(),
  };
}
export async function checkSettingsPageFocus(extraSources = []) {
  const sources = [source, fileURLToPath(import.meta.url), ...extraSources], driverHashes = captureInputs(sources);
  const schedules = [
    ['General and Display Back', [['focus', 1], ['show', 1], ['focus', 4], ['show', 2], ['show', 1], ['show', 0]]],
    ['About and Licenses Back', [['focus', 2], ['show', 3], ['focus', 7], ['show', 4], ['show', 3], ['show', 0]]],
    ['replaced control retains page identity', [['focus', 1], ['show', 1], ['focus', 4], ['show', 2], ['remount'], ['show', 1]]],
    ['repeated navigation and replaced parent', [['focus', 2], ['show', 3], ['focus', 7], ['show', 4], ['show', 3], ['remount'], ['show', 4], ['show', 3], ['show', 0]]],
  ];
  const traces = schedules.map(([name, actions]) => {
    const actual = fixture();
    try {
      const trace = {name, expect: actual.observe(), steps: []};
      for (const [action, ...args] of actions) {
        actual.run(action, args);
        trace.steps.push({label: action, action: {name: action, args}, expect: actual.observe()});
      }
      return trace;
    } finally {actual.close();}
  });
  return checkTraces({model: 'SettingsPageFocus', sources, driverHashes, traces, scope: 'bounded-component', assumptions: [
    'The actual stPageAccess function and its focusin listener execute over real DOM focus, replacement and inert ownership; the observer reads the actual WeakMap records.',
    'Five named pages and eight uniquely identified controls bound this projection. Root and same-depth category replacements execute. Layout, React scheduling, duplicate labels and native accessibility remain separate obligations.',
    'Popup focus ownership is exercised by the existing modal campaign and is outside these no-popup traces. No liveness or hardware acceptance follows from these finite safety checks.',
  ]});
}
