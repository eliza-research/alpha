import {test,expect} from '@playwright/test';
declare global { interface Window { shareProof:{calls:number;current:boolean;finish?:()=>void}; openSharePanel:(options:import('../../apps/app/src/runtime/share-panel').SharePanelOptions)=>Promise<void>; } }
test('Share opens the device route directly and never renders another chooser',async({page})=>{
 await page.route('**/share-panel-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><title>Share test</title><button id="share">Share selected</button>'}));
 await page.goto('/share-panel-fixture');
 await page.evaluate(async()=>{
  window.openSharePanel=(await import('/src/runtime/share-panel.ts' as string)).openSharePanel;
  window.shareProof={calls:0,current:true};
  document.querySelector('#share')!.addEventListener('click',()=>void window.openSharePanel({
   current:()=>window.shareProof.current,
   external:()=>{window.shareProof.calls++;return new Promise<void>(resolve=>window.shareProof.finish=resolve);}
  }));
 });
 await page.getByRole('button',{name:'Share selected'}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:'Share selected'}).click();
 expect(await page.evaluate(()=>window.shareProof.calls)).toBe(1);
 await page.evaluate(()=>window.shareProof.finish!());
 await page.evaluate(()=>window.shareProof.current=false);
 await page.getByRole('button',{name:'Share selected'}).click();
 expect(await page.evaluate(()=>window.shareProof.calls)).toBe(1);
});
