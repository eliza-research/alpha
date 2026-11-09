import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {JSDOM} from 'jsdom';
import {decodeMailPreview} from '../apps/app/src/runtime/mail-preview.ts';
const dom=new JSDOM('<!doctype html>');globalThis.document=dom.window.document;
after(()=>{dom.window.close();delete globalThis.document;});
test('Gmail preview decodes apostrophes, quotes, ampersands and Unicode references',()=>{
 assert.equal(decodeMailPreview('We&#39;ll confirm it&#x27;s ready &amp; say &quot;hello&quot;.'),'We\'ll confirm it\'s ready & say "hello".');
 assert.equal(decodeMailPreview('&apos;single&apos; &lsquo;smart&rsquo; &mdash; &#x1F680;'),'\'single\' ‘smart’ — 🚀');
 assert.equal(decodeMailPreview('A&nbsp;B &copy; 2026'),'A\u00a0B © 2026');
});
test('preview preserves literal text, unknown references and single-pass encoding',()=>{
 assert.equal(decodeMailPreview('Fish & chips <b>text</b> &unknown;'),'Fish & chips <b>text</b> &unknown;');
 assert.equal(decodeMailPreview('&amp;#39; &amp;amp;'),'&#39; &amp;');
 assert.equal(decodeMailPreview('https://example.test/?a=1&b=2'),'https://example.test/?a=1&b=2');
});
test('marketing preheader padding does not consume the inbox preview',()=>{
 assert.equal(decodeMailPreview('New collection &#847;&zwnj;&nbsp;&#847;&zwnj; Shop now'),'New collection Shop now');
 assert.equal(decodeMailPreview('Offer\u200c\u00a0\u034f\u200c\u00a0Details'),'Offer Details');
 assert.equal(decodeMailPreview('New release '+('\u034f\u2800 '.repeat(30))+'Listen now'),'New release Listen now');
 assert.equal(decodeMailPreview('Braille \u2801\u2800\u2803'),'Braille \u2801\u2800\u2803');
 assert.equal(decodeMailPreview('Persian \u0628\u200c\u0628 and A\u00a0B'),'Persian \u0628\u200c\u0628 and A\u00a0B');
});
