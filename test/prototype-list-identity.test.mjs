import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {JSDOM} from 'jsdom';

async function fixture(t, keyed) {
  const dom = new JSDOM('<div id="root"></div>', {pretendToBeVisual:true});
  const names = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries({window:dom.window, document:dom.window.document,
    navigator:dom.window.navigator, IS_REACT_ACT_ENVIRONMENT:true})) {
    Object.defineProperty(globalThis, name, {value, writable:true, configurable:true});
  }
  const source = readFileSync(new URL('../apps/app/src/prototype/dc-lite.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export class DCLogic', 'class DCLogic');
  const key = keyed ? ' key="{{row.id}}"' : '';
  const template = `<div class="os"><div data-screen><sc-for list="{{rows}}" as="row"${key}><button onClick="{{row.pick}}">{{row.label}}</button></sc-for></div></div>`;
  const DCLogic = new Function('React', 'document', 'templateHtml', 'iconStyle', `${source}\nreturn DCLogic;`)(React, dom.window.document, template, () => ({}));
  class List extends DCLogic {
    renderVals() { return {rows:this.props.rows}; }
  }
  const {createRoot} = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return {
    render: rows => React.act(async () => root.render(React.createElement(List, {rows}))),
    button: label => [...document.querySelectorAll('button')].find(button => button.textContent === label),
  };
}

test('semantic list keys preserve focused row identity across insertion and reordering', async t => {
  const f = await fixture(t, true), actions = [];
  const about = {id:'about', label:'About', pick:() => actions.push('about')};
  const setup = {id:'setup', label:'Finish setup', pick:() => actions.push('setup')};
  await f.render([about]);
  const focused = f.button('About');
  focused.focus();
  await f.render([setup, about]);
  assert.equal(document.activeElement, focused);
  assert.equal(focused.textContent, 'About');
  await f.render([about, setup]);
  assert.equal(document.activeElement, focused);
  focused.click();
  assert.deepEqual(actions, ['about']);
  await f.render([setup]);
  assert.equal(focused.isConnected, false);
  assert.notEqual(document.activeElement, focused);
});

test('unkeyed lists preserve existing positional reconciliation', async t => {
  const f = await fixture(t, false);
  await f.render([{id:'about', label:'About'}]);
  const first = f.button('About');
  await f.render([{id:'setup', label:'Finish setup'}, {id:'about', label:'About'}]);
  assert.equal(f.button('Finish setup'), first);
});

test('a missing semantic key falls back to positional reconciliation', async t => {
  const f = await fixture(t, true);
  await f.render([{label:'Before'}]);
  const first = f.button('Before');
  await f.render([{label:'After'}]);
  assert.equal(f.button('After'), first);
});
