import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {JSDOM} from 'jsdom';

const source=stripTypeScriptTypes(readFileSync(new URL('../apps/app/src/prototype/keyed-list-focus.ts',import.meta.url),'utf8'),{mode:'strip'});
const {createKeyedListFocus}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

function fixture(t) {
  const dom=new JSDOM('<main><div id="list"><button data-key="one">One</button></div><button id="other">Other</button></main>',{pretendToBeVisual:true});
  dom.window.HTMLElement.prototype.getClientRects=function(){return this.style.display==='none'?[]:[this.getBoundingClientRect()];};
  const names=['document','HTMLElement'],previous=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for(const name of names)Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true});
  t.after(()=>{dom.window.close();for(const [name,value]of previous){if(value)Object.defineProperty(globalThis,name,value);else delete globalThis[name];}});
  const root=document.getElementById('list'),manager=createKeyedListFocus('data-key');
  manager.ref(null)(root);
  root.firstElementChild.focus();
  return {root,manager,other:document.getElementById('other'),snapshot:manager.capture()};
}
const flush=()=>new Promise(resolve=>queueMicrotask(resolve));

test('one committed list render restores a retained item that moved parents',async t=>{
  const f=fixture(t);
  f.root.innerHTML='<div><button data-key="two">Two</button></div><div><button data-key="one">One</button></div>';
  f.manager.ref(f.snapshot)(f.root);await flush();
  assert.equal(document.activeElement.getAttribute('data-key'),'one');
});
for(const reason of ['removed','other-focus','other-focus-then-blur','navigation','inert','hidden','css-hidden','duplicate','newer-commit','uncommitted-render'])test(`list focus restoration stops for ${reason}`,async t=>{
  const f=fixture(t);
  f.root.innerHTML=reason==='removed'?'<button data-key="two">Two</button>':'<button data-key="one">One</button>';
  if(reason==='duplicate')f.root.insertAdjacentHTML('beforeend','<button data-key="one">Duplicate</button>');
  if(reason==='inert')f.root.setAttribute('inert','');
  if(reason==='hidden')f.root.setAttribute('aria-hidden','true');
  if(reason==='css-hidden')f.root.style.display='none';
  if(reason==='uncommitted-render')await flush();
  f.manager.ref(f.snapshot)(f.root);
  if(reason.startsWith('other-focus'))f.other.focus();
  if(reason==='other-focus-then-blur')f.other.blur();
  if(reason==='navigation')f.manager.ref(null)(null);
  if(reason==='newer-commit')f.manager.ref(null)(f.root);
  await flush();
  assert.notEqual(document.activeElement.getAttribute('data-key'),'one');
  if(reason==='other-focus')assert.equal(document.activeElement,f.other);
});
