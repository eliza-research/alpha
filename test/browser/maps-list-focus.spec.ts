import {test,expect,type Page,type TestInfo} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {captureInputs} from '../../specs/quint/refinement/check-traces.mjs';
const sources=['apps/app/src/prototype/keyed-list-focus.ts','apps/app/src/prototype/maps-adapter.ts','apps/app/src/prototype/model.js',
 'apps/app/src/prototype/template.html','apps/app/src/prototype/dc-lite.js','apps/app/src/maps/state.ts',
 '.eliza/client-features/plugins/plugin-maps/src/client/state.ts','apps/app/src/maps/saved-places.ts',
 '.eliza/client-features/plugins/plugin-maps/src/client/saved-places.ts','test/browser/maps-list-focus.spec.ts'];
async function observe(page:Page,intended:string|null){
 return page.evaluate(intended=>({intended,current:document.activeElement?.getAttribute('data-alpha-map-row')||null,
  rows:Array.from(document.querySelectorAll('[data-alpha-map-row]')).map(element=>({id:element.getAttribute('data-alpha-map-row'),label:element.textContent})),
  selected:document.querySelector('[data-alpha-maps-sheet="place"] h1')?.textContent||null,
  activeView:document.documentElement.dataset.activeView,
 }),intended);
}
async function saveTrace(info:TestInfo,hashes:any,name:string,checkpoints:any[]){
 expect(captureInputs(sources)).toEqual(hashes);const path=info.outputPath(name+'.json');
 writeFileSync(path,JSON.stringify({sources:hashes,checkpoints},null,2));await info.attach(name,{path,contentType:'application/json'});
}
async function setup(page:Page){
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await page.evaluate(async()=>{
  const {configureMapsProvider}=await import('/src/maps/runtime.ts');
  const {MapsController}=await import('/src/maps/state.ts');
  const original=MapsController.prototype.search;
  MapsController.prototype.search=function(...args:any[]){(window as any).mapFocus.controller=this;return original.apply(this,args as any);};
  const place=(id:string,name:string)=>({providerId:'focus-fixture',id,name,coordinate:{latitude:43.7+Number(id)*.001,longitude:7.425},attribution:'Fixture',fetchedAt:Date.now()});
  const f=(window as any).mapFocus={items:[place('1','One'),place('2','Two')],place};
  configureMapsProvider({status:'configured',providerId:'focus-fixture',connectionId:'conn_focus_fixture_123456',revision:'fixture1',capabilities:{map:false,search:true,placeDetails:true,modes:['walk'],traffic:'none',transit:'none',offline:{map:false,search:false,routing:false}}},{providerId:'focus-fixture',connectionId:'conn_focus_fixture_123456',search:async()=>f.items,detail:async(id:string)=>f.items.find((item:any)=>item.id===id),route:async()=>{throw Error('No route requested');}} as any);
 });
 await page.getByRole('button',{name:'Maps',exact:true}).click();
}

test('a Maps search readback keeps the focused provider place when a preceding result arrives',async({page},info)=>{
 const hashes=captureInputs(sources),checkpoints:any[]=[];await setup(page);
 const query=page.getByRole('searchbox',{name:'Search places',exact:true});await query.fill('place');await query.press('Enter');
 const sheet=page.locator('[data-alpha-maps-sheet="results"]');const target=sheet.getByRole('button',{name:/^Two/});await target.focus();
 const intended=await target.getAttribute('data-alpha-map-row');expect(intended).not.toBeNull();await target.evaluate(element=>(window as any).originalMapRow=element);
 checkpoints.push({label:'focus provider result',...await observe(page,intended)});
 await page.evaluate(async()=>{const f=(window as any).mapFocus;f.items=[f.place('0','Inserted'),...f.items];await f.controller.search('place');});
 await expect(sheet.getByRole('button',{name:/^Inserted/})).toBeVisible();await expect(target).toBeFocused();
 expect(await target.evaluate(element=>element===(window as any).originalMapRow)).toBe(true);
 checkpoints.push({label:'provider inserts a preceding result',...await observe(page,intended)});
 await page.keyboard.press('Enter');await expect(page.locator('[data-alpha-maps-sheet="place"] h1')).toHaveText('Two');
 checkpoints.push({label:'open retained provider place',...await observe(page,intended)});
 await saveTrace(info,hashes,'maps-provider-focus',checkpoints);
});

test('removing another saved place keeps focus and selection on the retained saved identity',async({page},info)=>{
 const hashes=captureInputs(sources),checkpoints:any[]=[];await setup(page);
 const query=page.getByRole('searchbox',{name:'Search places',exact:true});await query.fill('saved');await query.fill('');
 await page.evaluate(()=>{const f=(window as any).mapFocus;f.first=f.controller.save({label:'Saved One',coordinate:{latitude:43.7,longitude:7.4}});f.controller.save({label:'Saved Two',coordinate:{latitude:43.8,longitude:7.4}});});
 const sheet=page.locator('[data-alpha-maps-sheet="results"]');const target=sheet.getByRole('button',{name:/^Saved Two/});await target.focus();
 const intended=await target.getAttribute('data-alpha-map-row');expect(intended).not.toBeNull();await target.evaluate(element=>(window as any).originalMapRow=element);
 checkpoints.push({label:'focus saved place',...await observe(page,intended)});
 await page.evaluate(()=>{const f=(window as any).mapFocus;f.controller.removeSaved(f.first.id);});
 await expect(sheet.getByRole('button',{name:/^Saved One/})).toHaveCount(0);await expect(target).toBeFocused();
 expect(await target.evaluate(element=>element===(window as any).originalMapRow)).toBe(true);
 checkpoints.push({label:'remove earlier saved place',...await observe(page,intended)});
 await page.keyboard.press('Enter');await expect(page.locator('[data-alpha-maps-sheet="place"] h1')).toHaveText('Saved Two');
 checkpoints.push({label:'open retained saved place',...await observe(page,intended)});
 await saveTrace(info,hashes,'maps-saved-focus',checkpoints);
});
