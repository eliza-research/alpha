import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {linkedMessageText, openContentLink} from '../apps/app/src/prototype/content-links.tsx';

test('chat text renders safe web links while preserving punctuation and escaped text', () => {
  const html = renderToStaticMarkup(React.createElement('div', null,
    linkedMessageText('See [Example](https://example.org/a) and https://example.org/b. <script>alert(1)</script>')));
  assert.match(html, /href="https:\/\/example.org\/a"[^>]*>Example<\/a>/);
  assert.match(html, /href="https:\/\/example.org\/b"[^>]*>https:\/\/example.org\/b<\/a>\./);
  assert.match(html, /&lt;script&gt;/);
  assert.equal((html.match(/<a /g) || []).length, 2);
  assert.equal(linkedMessageText('Keep ordinary text.'), 'Keep ordinary text.');
});

test('links use the in-app Browser and a late result cannot replace another view', async () => {
  let view = 'inbox', opened = '', shown = 0, release;
  const host = {live: true, S: () => ({view}), toast() {}, browserOpenContentLink: async url => {
    opened = url;
    await new Promise(resolve => {release = resolve;});
    return () => {shown++;};
  }};
  const first = openContentLink(host, 'https://example.org');
  view = 'notes'; release(); await first;
  assert.equal(opened, 'https://example.org/'); assert.equal(shown, 0);
  host.browserOpenContentLink = async url => {opened = url; return () => {shown++;};};
  await openContentLink(host, 'http://example.org/page');
  assert.equal(shown, 1); assert.equal(opened, 'http://example.org/page');
  await assert.rejects(openContentLink(host, 'https://name:password@example.org'), /cannot open/);
  await assert.rejects(openContentLink(host, 'javascript:alert(1)'), /cannot open/);
});
