import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import {JSDOM} from 'jsdom';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';

const template = '<main class="os"><section data-screen><sc-for list="{{groups}}" as="g" key="{{g.id}}"><div><sc-for list="{{g.rows}}" as="r" key="{{r.id}}"><button onClick="{{r.go}}">{{r.label}}</button></sc-for></div></sc-for></section></main>';
const code = buildSync({
  stdin: {contents:readFileSync('apps/app/src/prototype/dc-lite.js', 'utf8')
    .replace('import {iconStyle} from \'../icon-style\';', 'const iconStyle = () => ({});')
    .replace('import templateHtml from "./template-source";', `const templateHtml = ${JSON.stringify(template)};`),
  resolveDir:process.cwd(), loader:'js'},
  bundle:true, write:false, platform:'node', format:'cjs', external:['react'],
}).outputFiles[0].text;

test('keyed groups and rows preserve a focused action through insertions and remove retired controls', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const previousWindow = globalThis.window;
  const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = dom.window;
  const module = {exports:{}};
  new Function('require', 'module', 'exports', 'document', code)(createRequire(import.meta.url), module, module.exports, dom.window.document);
  class Fixture extends module.exports.DCLogic {
    renderVals() { return this.state; }
  }
  const container = dom.window.document.getElementById('root');
  const root = createRoot(container);
  let fixture, selected = '';
  const row = (id, label) => ({id, label, go:() => { selected = id; }});
  const theme = row('theme', 'Theme'), text = row('text', 'Text size');
  const otherText = row('other-text', 'Text size');
  const appearance = {id:'appearance', rows:[theme, text, otherText]};
  const privacy = {id:'privacy', rows:[row('permissions', 'App permissions')]};
  try {
    await act(async () => root.render(React.createElement(Fixture, {ref:value => { fixture = value; }})));
    await act(async () => fixture.setState({groups:[appearance, privacy]}));
    const focused = [...container.querySelectorAll('button')].find(button => button.textContent === 'Text size');
    focused.focus();
    const assistant = {id:'assistant', rows:[row('agent', 'Agent')]};
    await act(async () => fixture.setState({groups:[assistant, {...appearance, rows:[row('contrast', 'Contrast'), theme, otherText, text]}, privacy]}));
    assert.equal(dom.window.document.activeElement, focused);
    assert.equal(focused.textContent, 'Text size');
    focused.click();
    assert.equal(selected, 'text');
    const sameLabel = [...container.querySelectorAll('button')].filter(button => button.textContent === 'Text size');
    assert.equal(sameLabel.length, 2);
    sameLabel[0].click();
    assert.equal(selected, 'other-text');
    await act(async () => fixture.setState({groups:[assistant, {...appearance, rows:[theme, otherText]}, privacy]}));
    assert.equal(focused.isConnected, false);
    assert.notEqual(dom.window.document.activeElement?.textContent, 'Theme');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    if (previousAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('Settings opts into group and row identities in the real template', () => {
  const source = readFileSync('apps/app/src/prototype/template.html', 'utf8');
  assert.match(source, /<sc-for list="\{\{p\.groups\}\}" as="g" key="\{\{g\.id\}\}">/);
  assert.match(source, /<sc-for list="\{\{g\.rows\}\}" as="r" key="\{\{r\.id\}\}">/);
});
