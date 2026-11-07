import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
declare global { interface Window { calls: {email:number;external:number;copy:number}; current:boolean; openSharePanel: (options: import('../../apps/app/src/runtime/share-panel').SharePanelOptions) => Promise<void>; } }
test('common Share panel keeps email/external explicit and retires without fallback',async({page})=>{
 // The real module, served by the dev server on a same-origin page that does not boot the app.
 await page.route('**/share-panel-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>Share panel</title><style>body{font-family:serif}.os{font-family:"Public Sans",system-ui,sans-serif;font-size:19px}</style></head><body><main class="os"><button id="origin">Share selected</button></main></body></html>'}));
 await page.goto('/share-panel-fixture');await page.evaluate(async()=>{window.openSharePanel=(await import('/src/runtime/share-panel.ts' as string)).openSharePanel;});
 const open=()=>page.evaluate(()=>{window.calls={email:0,external:0,copy:0};window.current=true;void window.openSharePanel({title:'Selected note',current:()=>window.current,email:()=>window.calls.email++,external:()=>{window.calls.external++;throw new DOMException('Cancel','AbortError');},copy:()=>window.calls.copy++});});
 await open();const dialog=page.getByRole('dialog',{name:'Share',exact:true});
 const fonts=await dialog.evaluate(el=>({body:getComputedStyle(document.body).fontFamily,theme:getComputedStyle(document.querySelector('.os')!).fontFamily,panel:getComputedStyle(el).fontFamily,buttons:Array.from(el.querySelectorAll('button'),button=>getComputedStyle(button).fontFamily)}));
 expect(fonts.theme).not.toBe(fonts.body);expect(fonts.panel).toBe(fonts.theme);expect(fonts.buttons.every(font=>font===fonts.theme)).toBe(true);await expect(dialog).toHaveCSS('font-size','19px');
 expect(await dialog.evaluate(el=>el.matches('dialog:modal'))).toBe(true);for(let i=0;i<6;i++){await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true);}await page.getByRole('button',{name:'Share to email',exact:true}).focus();await page.keyboard.press('Shift+Tab');await expectFocus();
 async function expectFocus(){assert.equal(await page.getByRole('button',{name:'Cancel',exact:true}).evaluate(el=>el===document.activeElement),true);}
 await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.calls),{email:0,external:0,copy:0});
 await open();await page.getByRole('button',{name:'Share to email',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.calls),{email:1,external:0,copy:0});
 await open();await page.getByRole('button',{name:'Share externally',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.calls),{email:0,external:1,copy:0});await page.waitForTimeout(30);assert.equal(await page.getByRole('alert').count(),0);
 await open();await page.evaluate(()=>{window.current=false;});await page.getByRole('dialog',{name:'Share',exact:true}).waitFor({state:'detached'});assert.deepEqual(await page.evaluate(()=>window.calls),{email:0,external:0,copy:0});
 await open();await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));assert.equal(await page.getByRole('dialog',{name:'Share',exact:true}).count(),0);assert.deepEqual(await page.evaluate(()=>window.calls),{email:0,external:0,copy:0});
 await page.locator('.os').evaluate(el=>el.classList.remove('os'));await open();assert.equal(await dialog.evaluate(el=>getComputedStyle(el).fontFamily),await page.evaluate(()=>getComputedStyle(document.body).fontFamily));await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.calls),{email:0,external:0,copy:0});
});
