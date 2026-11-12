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
  const f=(window as any).mapFocus={items:[place('1','One'),place('2','Two')],place,searches:[]};
  configureMapsProvider({status:'configured',providerId:'focus-fixture',connectionId:'conn_focus_fixture_123456',revision:'fixture1',capabilities:{map:false,search:true,placeDetails:true,modes:['drive','walk'],traffic:'none',transit:'none',offline:{map:false,search:false,routing:false}}},{providerId:'focus-fixture',connectionId:'conn_focus_fixture_123456',search:async(query:string)=>{f.searches.push(query);return f.pending?await f.pending:f.items;},detail:async(id:string)=>f.items.find((item:any)=>item.id===id),route:async(...args:any[])=>{if(f.route)return f.route(...args);throw Error('No route requested');}} as any);
 });
 await page.getByRole('button',{name:'Maps',exact:true}).click();
}

test('a Maps search readback keeps the focused provider place when a preceding result arrives',async({page},info)=>{
 const hashes=captureInputs(sources),checkpoints:any[]=[];await setup(page);
 const query=page.getByRole('textbox',{name:'Search places',exact:true});await query.fill('place');
 const sheet=page.locator('[data-alpha-maps-sheet="results"]');const target=sheet.getByRole('button',{name:/^Two/});await target.focus();
 await expect.poll(()=>page.evaluate(()=>(window as any).mapFocus.searches.length)).toBe(1);
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
 const query=page.getByRole('textbox',{name:'Search places',exact:true});await query.fill('saved');await query.fill('');
 await page.evaluate(()=>{const f=(window as any).mapFocus;f.first=f.controller.save({label:'Saved One',coordinate:{latitude:43.7,longitude:7.4}});f.controller.save({label:'Saved Two',coordinate:{latitude:43.8,longitude:7.4}});});
 await query.fill('Saved');
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


test('automatic Maps search cancels empty and abandoned input',async({page})=>{
 await setup(page);const query=page.getByRole('textbox',{name:'Search places',exact:true});
 await query.fill('abandoned');await query.fill('');
 await page.waitForTimeout(500);
 expect(await page.evaluate(()=>(window as any).mapFocus.searches)).toEqual([]);
 await expect(page.locator('[data-alpha-maps-sheet="results"]')).toHaveCount(0);
 await query.fill('leaving');await page.getByRole('button',{name:'Back to apps',exact:true}).click();
 await page.waitForTimeout(500);
 expect(await page.evaluate(()=>(window as any).mapFocus.searches)).toEqual([]);
});


test('an empty automatic search gives compact feedback without an empty sheet',async({page})=>{
 await setup(page);await page.evaluate(()=>(window as any).mapFocus.items=[]);
 await page.getByRole('textbox',{name:'Search places',exact:true}).fill('missing place');
 await expect(page.getByText('No places',{exact:true})).toBeVisible();
 await expect(page.locator('[data-alpha-maps-sheet="results"]')).toHaveCount(0);
});


test('Maps uses allowed location, shows result distances and dismisses results from the handle',async({page})=>{
 await page.context().grantPermissions(['geolocation']);
 await page.context().setGeolocation({latitude:43.7,longitude:7.425});
 await setup(page);
 await expect(page.getByText('Finding location…',{exact:true})).toHaveCount(0);
 await page.getByRole('textbox',{name:'Search places',exact:true}).fill('place');
 const sheet=page.locator('[data-alpha-maps-sheet="results"]');
 await expect(sheet.getByRole('button',{name:/^One/})).toContainText(/ft|mi|m|km/);
 const grip=sheet.getByRole('button',{name:'Resize results',exact:true});
 const bounds=(await grip.boundingBox())!;
 await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
 await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+110,{steps:8});await page.mouse.up();
 await expect(sheet).toHaveCount(0);
});

test('place hours have one row per day and its website opens inside Alpha',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{const f=(window as any).mapFocus;f.items=[{...f.place('1','Public place'),openingHours:'Monday: 8:00 AM–6:00 PM · Tuesday: 8:00 AM–6:00 PM · Wednesday: Closed',website:'https://example.com/'}];});
 await page.getByRole('textbox',{name:'Search places',exact:true}).fill('public place');
 await page.locator('[data-alpha-maps-sheet="results"]').getByRole('button',{name:/^Public place/}).click();
 await expect(page.getByLabel('Opening hours').locator('dt')).toHaveText(['Monday','Tuesday','Wednesday']);
 await expect(page.getByRole('button',{name:'Share',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Website',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.activeView)).toBe('browser');
});


test('saving a named place stays quiet and the saved name remains searchable',async({page})=>{
 await setup(page);const query=page.getByRole('textbox',{name:'Search places',exact:true});
 await query.fill('place');await page.locator('[data-alpha-maps-sheet="results"]').getByRole('button',{name:/^One/}).click();
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.getByRole('textbox',{name:'Place name',exact:true}).fill('My named place');
 await page.getByRole('button',{name:'Apply place name',exact:true}).click();
 await expect(page.getByRole('button',{name:'Remove from saved',exact:true})).toBeVisible();
 await expect(page.locator('[data-alpha-maps-status]')).toHaveCount(0);
 await page.getByRole('button',{name:'Close place',exact:true}).click();
 await query.fill('My named');
 await expect(page.locator('[data-alpha-maps-sheet="results"]').getByRole('button',{name:'My named place',exact:true})).toBeVisible();
});


test('typing a new Maps search keeps the current panel until replacement results arrive',async({page})=>{
 await setup(page);const query=page.getByRole('textbox',{name:'Search places',exact:true});
 await query.fill('first');const panel=page.locator('[data-alpha-maps-sheet="results"]');
 await expect(panel.getByRole('button',{name:/^One/})).toBeVisible();
 await panel.evaluate(element=>(window as any).originalResultPanel=element);
 await page.evaluate(()=>{const f=(window as any).mapFocus;f.pending=new Promise(resolve=>f.resolveSearch=resolve);});
 await query.fill('replacement');
 await expect(panel).toHaveAttribute('aria-busy','true');
 await expect(panel.getByRole('button',{name:/^One/})).toBeVisible();
 expect(await panel.evaluate(element=>element===(window as any).originalResultPanel)).toBe(true);
 await panel.getByRole('button',{name:/^One/}).click({force:true});
 await expect(page.locator('[data-alpha-maps-sheet="place"]')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>(window as any).mapFocus.searches.length)).toBe(2);
 await page.evaluate(()=>{const f=(window as any).mapFocus;f.resolveSearch([f.place('3','Three')]);});
 await expect(panel.getByRole('button',{name:/^Three/})).toBeVisible();
 await expect(panel).toHaveAttribute('aria-busy','false');
 await expect(panel.getByRole('button',{name:/^One/})).toHaveCount(0);
});


test('directions start from the allowed current location and can swap endpoints',async({page})=>{
 await page.context().grantPermissions(['geolocation']);await page.context().setGeolocation({latitude:43.7,longitude:7.425});
 await setup(page);await page.evaluate(()=>{const f=(window as any).mapFocus;f.routes=[];f.route=async(from:any,to:any,mode:string)=>{f.routes.push({from,to,mode});return {providerId:'focus-fixture',id:'route-'+f.routes.length,from,to,mode,geometry:[from,to],distanceMeters:111,durationSeconds:60,steps:[{coordinate:to,instruction:'Continue',distanceMeters:111}],attribution:'Fixture',fetchedAt:Date.now(),traffic:'none'};};});
 await page.getByRole('textbox',{name:'Search places',exact:true}).fill('place');
 await page.locator('[data-alpha-maps-sheet="results"]').getByRole('button',{name:/^One/}).click();
 await page.getByRole('button',{name:'Directions',exact:true}).click();
 await expect(page.locator('[data-alpha-maps-sheet="directions"]')).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Starting point',exact:true})).toHaveValue('My location');
 await page.getByRole('button',{name:'Swap starting point and destination',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).mapFocus.routes.length)).toBe(2);
 expect(await page.evaluate(()=>(window as any).mapFocus.routes.at(-1))).toMatchObject({from:{latitude:43.701,longitude:7.425},to:{latitude:43.7,longitude:7.425}});
 await page.getByRole('button',{name:'Start',exact:true}).click();
 await expect(page.getByRole('button',{name:'End navigation',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/voice guidance/i})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Ask Alpha',exact:true})).toHaveCount(0);
});
