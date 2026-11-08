import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {captureInputs} from '../../specs/quint/refinement/check-traces.mjs';

const sources=['apps/app/src/prototype/home-launcher.ts','apps/app/src/prototype/template.html',
 'apps/app/src/prototype/dc-lite.js','apps/app/src/prototype/keyed-list-focus.ts','test/browser/launcher-list-focus.spec.ts'];
async function observe(page:any,intended:string|null){
 return page.evaluate((intended:string|null)=>{
  const controls=Array.from(document.querySelectorAll<HTMLElement>('[data-launcher-focus]'));
  const candidates=controls.filter(element=>element.getAttribute('data-launcher-focus')===intended&&element.getClientRects().length&&!element.closest('[inert],[hidden],[aria-hidden="true"]'));
  const currentKey=document.activeElement?.getAttribute('data-launcher-focus')||null;
  return {
   rows:Array.from(document.querySelectorAll('[data-launcher-favorite],[data-launcher-app]')).map(row=>({id:row.getAttribute('data-launcher-favorite')||row.getAttribute('data-launcher-app'),favorite:row.hasAttribute('data-launcher-favorite')})),
   currentKey,intended,restorationCandidate:candidates.length===1?candidates[0].getAttribute('data-launcher-focus'):null,
   removed:!!intended&&!controls.some(element=>element.getAttribute('data-launcher-focus')===intended),
   focusMovedToOtherControl:document.activeElement!==document.body&&currentKey!==intended,
   currentLabel:document.activeElement?.getAttribute('aria-label')||null,
   owner:document.activeElement?.closest('[data-alpha-app-scroll]')?.getAttribute('data-alpha-app-scroll')||null,
   activeView:document.documentElement.dataset.activeView,
  };
 },intended);
}
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  localStorage.setItem('alpha.launcher.favorites.v1',JSON.stringify({version:2,defaultPolicy:'alpha-apps',keys:['alpha:inbox','alpha:calendar','alpha:notes']}));
 });
 await page.goto('/');await page.getByRole('button',{name:'All apps',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'All apps',exact:true})).toBeVisible();
});

test('reordering a launcher favorite preserves the focused app and its launch action',async({page},info)=>{
 const hashes=captureInputs(sources),checkpoints:any[]=[];
 const drawer=page.getByRole('dialog',{name:'All apps',exact:true});
 const target=drawer.getByRole('button',{name:'Open Calendar',exact:true});await target.focus();
 await target.evaluate(element=>(window as any).originalLauncherControl=element);
 const intended=await target.getAttribute('data-launcher-focus');
 checkpoints.push({label:'focus actual Calendar favorite',...await observe(page,intended)});
 // The source action changes order without moving focus to its own control.
 await drawer.getByRole('button',{name:'Move Calendar earlier',exact:true}).evaluate((element:HTMLElement)=>element.click());
 await expect(target).toBeFocused();
 expect(await target.evaluate(element=>element===(window as any).originalLauncherControl)).toBe(true);
 checkpoints.push({label:'move Calendar before Inbox',...await observe(page,intended)});
 await page.keyboard.press('Enter');await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');
 checkpoints.push({label:'activate retained app',...await observe(page,intended)});
 expect(captureInputs(sources)).toEqual(hashes);
 const path=info.outputPath('launcher-favorite-reorder.json');writeFileSync(path,JSON.stringify({sources:hashes,checkpoints},null,2));await info.attach('launcher-favorite-reorder',{path,contentType:'application/json'});
});

test('removing a favorite retains its focused toggle after it moves to All apps',async({page},info)=>{
 const hashes=captureInputs(sources),checkpoints:any[]=[];
 const drawer=page.getByRole('dialog',{name:'All apps',exact:true});
 const target=drawer.getByRole('button',{name:'Remove Calendar from favorites',exact:true});await target.focus();
 const intended=await target.getAttribute('data-launcher-focus');
 checkpoints.push({label:'focus actual Calendar favorite toggle',...await observe(page,intended)});
 await page.keyboard.press('Enter');
 const moved=drawer.getByRole('button',{name:'Add Calendar to favorites',exact:true});
 await expect(moved).toBeFocused();
 checkpoints.push({label:'Calendar toggle moves between parent lists',...await observe(page,intended)});
 await page.keyboard.press('Enter');
 await expect(drawer.getByRole('button',{name:'Remove Calendar from favorites',exact:true})).toBeFocused();
 checkpoints.push({label:'same control returns to Favorites',...await observe(page,intended)});
 expect(captureInputs(sources)).toEqual(hashes);
 const path=info.outputPath('launcher-favorite-transfer.json');writeFileSync(path,JSON.stringify({sources:hashes,checkpoints},null,2));await info.attach('launcher-favorite-transfer',{path,contentType:'application/json'});
});
