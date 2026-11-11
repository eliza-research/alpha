import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformSync} from 'esbuild';
import {JSDOM,VirtualConsole} from 'jsdom';
const source=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const begin=source.indexOf('const restoreSaved=');
assert.ok(begin>=0);
const end=source.indexOf(':null;',begin)+5;
const fragment=source.slice(begin+'const restoreSaved='.length,end);
const code=transformSync('function recovery(snapshot,requiredSignInView){return ('+fragment+')||null;}',{loader:'tsx',jsxFactory:'React.createElement'}).code;
let calls=0;
const recovery=new Function('React','connectionController','iconStyle',code+';return recovery;')(React,{restoreSavedSignIn:()=>{calls++;}},()=>({}));
const eligible={cloudAccount:null,legacySignInRecovery:true,busy:false};
const choose={step:'choose',environment:'production'};
test('actual eligible legacy action is a direct button with no disclosure or explainer',()=>{
 const element=recovery(eligible,choose),html=renderToStaticMarkup(element);
 // A low-emphasis recovery entry under the sign-in methods, never a filled primary.
 assert.equal(html,'<button type="button" class="alpha-btn alpha-btn--text" aria-label="Restore saved sign-in"><span aria-hidden="true" data-alpha-icon="/icons/lucide/undo-2.svg"></span>Restore</button>');
 assert.equal(calls,0);element.props.onClick();assert.equal(calls,1);
});
test('ordinary, signed-in, staging and verification states expose no legacy restore; busy disables it',()=>{
 for(const [snapshot,view] of [[{...eligible,legacySignInRecovery:false},choose],[{...eligible,cloudAccount:{}},choose],[eligible,{...choose,environment:'staging'}],[eligible,{...choose,step:'code'}]])assert.equal(renderToStaticMarkup(recovery(snapshot,view)),'');
 assert.match(renderToStaticMarkup(recovery({...eligible,busy:true},choose)),/<button [^>]*disabled=""/);
});
test('real stylesheet hides only the prototype cutout for native and standalone classes',()=>{
 const css=readFileSync(new URL('../apps/app/src/prototype/phone.css',import.meta.url),'utf8');
 const dom=new JSDOM('<style></style><div data-alpha-system-cutout></div>',{virtualConsole:new VirtualConsole()});
 try {
  dom.window.document.querySelector('style').textContent=css;
  const cutout=dom.window.document.querySelector('[data-alpha-system-cutout]');
  for(const cls of ['native-phone','standalone-app']){dom.window.document.documentElement.className=cls;assert.equal(dom.window.getComputedStyle(cutout).display,'none');}
  dom.window.document.documentElement.className='';assert.notEqual(dom.window.getComputedStyle(cutout).display,'none');
 } finally {dom.window.close();}
});
