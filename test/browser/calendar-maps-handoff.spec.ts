import {openBrowserCalendar} from './helpers/browser-calendar';
import { returnToApps } from './app-navigation';
import {test,expect,type Page} from '@playwright/test';
const address='12 Market Street, Test Town';
async function event(page:Page,configured=true,deferred=false){
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev');await openBrowserCalendar(page);
 await page.evaluate(async({address,configured,deferred})=>{
  const row={id:'travel-source',calendarId:'local',title:'Travel appointment',body:'Return to this exact event',location:address,begin:Date.parse('2028-04-02T12:00:00Z'),end:Date.parse('2028-04-02T13:00:00Z'),revision:'b'.repeat(64)};
  await (async(raw:string)=>{const {browserDocuments}=await import('/src/browser/documents.ts');await browserDocuments.edit('alpha.browser.calendar.v1',async before=>({raw:JSON.stringify({...before?JSON.parse(before.raw!):{version:1,legacy:localStorage.getItem('alpha.browser.calendar.v1')},value:raw}),result:undefined}));})(JSON.stringify({sourceRevision:'a'.repeat(64),events:[row]}));
  (window as any).travelQueries=[];(window as any).travelRoutes=[];
  if(configured){const {configureMapsProvider}=await import('/src/maps/runtime.ts');const places=['East entrance','West entrance'].map((name,i)=>({providerId:'travel-fixture',id:String(i),name,coordinate:{latitude:[43.739,43.74][i],longitude:7.425},attribution:'Travel fixture',fetchedAt:Date.now()}));configureMapsProvider({status:'configured',providerId:'travel-fixture',connectionId:'conn_travel_fixture_123456',revision:'fixture1',capabilities:{map:false,search:true,placeDetails:true,modes:['drive'],traffic:'none',transit:'none',offline:{map:false,search:false,routing:false}}},{providerId:'travel-fixture',connectionId:'conn_travel_fixture_123456',search:async(q:string)=>{(window as any).travelQueries.push(q);if(deferred&&q===address)await new Promise<void>(resolve=>(window as any).releaseTravelSearch=resolve);return q===address?places:places.map(p=>({...p,name:'Replacement '+p.name}));},detail:async(id:string)=>places[Number(id)],route:async(from:any,to:any,mode:any)=>{(window as any).travelRoutes.push({from,to,mode});return {providerId:'travel-fixture',id:'reviewed-route',from,to,mode,geometry:[from,to],distanceMeters:420,durationSeconds:300,steps:[{instruction:'Continue to the selected entrance',coordinate:to,distanceMeters:420}],attribution:'Travel fixture',fetchedAt:Date.now(),traffic:'none'};}});}
  const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaCalendar').open({id:row.id});
 },{address,configured,deferred});
 await expect(page.getByText('Return to this exact event',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:address,exact:true}).click();
}
async function back(page:Page){await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));}
test('event address searches once, preserves result choice and returns to the same event',async({page},info)=>{
 await event(page);await expect(page.getByRole('textbox',{name:'Search places',exact:true})).toHaveValue(address);
 await expect(page.getByRole('button',{name:/^East entrance/}).first()).toBeVisible();await expect(page.getByRole('button',{name:/^West entrance/}).first()).toBeVisible();
 expect(await page.evaluate(()=>(window as any).travelQueries)).toEqual([address]);
 await page.getByRole('button',{name:/^West entrance/}).first().click();await expect(page.getByRole('button',{name:'Directions',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Directions',exact:true}).click();const origin=page.getByRole('textbox',{name:'Starting point'});await origin.fill('43.738, 7.424');await expect(page.getByText(/no live traffic/).first()).toBeVisible();await origin.press('Enter');await expect(page.getByText(/no live traffic/).first()).toBeVisible();expect(await page.evaluate(()=>(window as any).travelRoutes)).toEqual([{from:{latitude:43.738,longitude:7.424},to:{latitude:43.74,longitude:7.425},mode:'drive'}]);await page.screenshot({path:info.outputPath('reviewed-event-route.png')});
 // Unwind the route and selected place, then the event-owned search returns directly to Calendar.
 // A fourth Back would dismiss the event detail we are checking.
 await back(page);await expect(page.getByRole('button',{name:'Directions',exact:true})).toBeVisible();
 await back(page);await expect(page.getByRole('textbox',{name:'Search places',exact:true})).toHaveValue(address);
 await back(page);await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');
 await expect(page.getByText('Return to this exact event',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:address,exact:true}).click();await expect(page.getByRole('button',{name:/^East entrance/}).first()).toBeVisible();expect(await page.evaluate(()=>(window as any).travelQueries)).toEqual([address,address]);
});
test('signed-out Maps retains the event address without inventing a destination',async({page})=>{
 await event(page,false);await expect(page.getByRole('textbox',{name:'Search places',exact:true})).toHaveValue(address);await expect(page.getByRole('status').filter({hasText:'The Maps account changed. Search again after signing in.'})).toBeVisible();await expect(page.getByRole('button',{name:'Directions',exact:true})).toHaveCount(0);await back(page);await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');await expect(page.getByText('Return to this exact event',{exact:true})).toBeVisible();
});

test('a late event-address response cannot replace a newer Maps search',async({page})=>{
 await event(page,true,true);await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseTravelSearch)).toBe('function');const query=page.getByRole('textbox',{name:'Search places',exact:true});await query.fill('Replacement address');await query.press('Enter');await expect(page.getByRole('button',{name:/^Replacement West entrance/}).first()).toBeVisible();await page.evaluate(()=>(window as any).releaseTravelSearch());await expect(query).toHaveValue('Replacement address');await expect(page.getByRole('button',{name:/^West entrance/})).toHaveCount(0);expect(await page.evaluate(()=>(window as any).travelQueries)).toEqual([address,'Replacement address']);
});
test('leaving during an event-address search prevents late results and automatic replay',async({page})=>{
 await event(page,true,true);await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseTravelSearch)).toBe('function');await returnToApps(page);await page.evaluate(()=>(window as any).releaseTravelSearch());await expect(page.getByRole('button',{name:'Calendar',exact:true})).toBeVisible();await page.getByRole('button',{name:'Maps',exact:true}).click();await expect(page.getByRole('textbox',{name:'Search places',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/^West entrance/})).toHaveCount(0);expect(await page.evaluate(()=>(window as any).travelQueries)).toEqual([address]);
});
