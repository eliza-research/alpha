import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {bundledFixture, installFixtureGlobals} from './fixtures/bundled-module.ts';

type DomWindow = Pick<Window, 'document' | 'close'> & {DOMParser: typeof DOMParser};
const require = createRequire(import.meta.url);
const {JSDOM}: {JSDOM: new (html: string, options: {url: string}) => {window: DomWindow}} = require('jsdom');
const dom = new JSDOM('<!doctype html>', {url: 'https://fixture.invalid/'});
const restoreGlobals = installFixtureGlobals({window: dom.window, document: dom.window.document});
try {
  const {prepareMailHtml} = await bundledFixture<typeof import('../apps/app/src/runtime/mail-html.ts')>('apps/app/src/runtime/mail-html.ts');
  const html='<table><tr><td style="color:red"><strong>Owned formatted email</strong><img src="https://tracker.invalid/image.png" alt="Owned image"><a href="https://example.invalid/read">Read more</a></td></tr></table><script>alert(1)</script><form action="https://attacker.invalid"><input name="private"></form><iframe srcdoc="<script>alert(2)</script>"></iframe><img src="javascript:alert(3)" onerror="alert(4)">';
  const parse=(value: string)=>new dom.window.DOMParser().parseFromString(value,'text/html');
  const blocked=prepareMailHtml(html),clean=parse(blocked.document);
  assert.equal(blocked.remoteImages,1);assert.equal(clean.querySelectorAll('script,form,input,iframe,object,embed').length,0);assert.equal(clean.querySelectorAll('[onerror],img[src^="https:"],a[href]').length,0);
  assert.ok(clean.querySelector('table strong'));assert.equal(clean.querySelector('td')?.getAttribute('style'),'color:red');assert.equal(clean.querySelector('a[data-alpha-link]')?.getAttribute('data-alpha-link'),'https://example.invalid/read');
  assert.ok(blocked.document.includes("script-src 'none'"));assert.ok(blocked.document.includes("connect-src 'none'"));assert.ok(blocked.document.includes("img-src data:;"));
  assert.deepEqual([...blocked.inlineLinks],['https://example.invalid/read']);
  assert.equal(prepareMailHtml('<p>Visit https://example.invalid/read</p>').inlineLinks.size,0);
  const shown=prepareMailHtml(html,true);assert.equal(parse(shown.document).querySelector('img')?.src,'https://tracker.invalid/image.png');assert.ok(shown.document.includes('img-src data: https:'));
  const hostile=prepareMailHtml('<svg onload="alert(1)"><foreignObject><script>alert(2)</script></foreignObject></svg><a href="javascript:alert(3)">Bad link</a><img src="data:image/svg+xml;base64,PHN2Zz4=">');assert.equal(parse(hostile.document).querySelectorAll('svg,script,a[data-alpha-link],img').length,0);
  assert.throws(()=>prepareMailHtml('x'.repeat(512*1024+1)),/too large/);
  console.log('PASS HTML email: layout retained; scripts/forms/nested frames removed; inert reviewed links; blocked remote images; explicit image mode; size bounds. Synthetic DOM only.');
} finally {
  dom.window.close();
  restoreGlobals();
}
