import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
// Real Chromium renderer against the real local regional provider (scripts/maps/dev.mjs).
// The app port follows the Playwright convention (ALPHA_BROWSER_TEST_PORT, default 5194).
const require=createRequire(process.env.ALPHA_BROWSER_MODULES?path.join(process.env.ALPHA_BROWSER_MODULES,'maps-test.cjs'):import.meta.url);
const {chromium}=require('playwright');
const app=`http://127.0.0.1:${Number(process.env.ALPHA_BROWSER_TEST_PORT||5194)}`,gateway='http://127.0.0.1:47850';
const ICONS={depart:'M12 20V4M6 10l6-6 6 6',continue:'M12 20V4M6 10l6-6 6 6',left:'M18 21v-8a3 3 0 0 0-3-3H5M9 6l-4 4 4 4',right:'M6 21v-8a3 3 0 0 1 3-3h10M15 6l4 4-4 4'};
const json=async url=>{const response=await fetch(gateway+url,{signal:AbortSignal.timeout(15000)});assert.ok(response.ok,url);return response.json();};
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:412,height:915}});
const page=await context.newPage();page.setDefaultTimeout(20000);
const errors=[];page.on('console',m=>{if(m.type()==='error')console.log('renderer',m.text());});page.on('pageerror',e=>errors.push(e.message));
const requests=[];page.on('request',r=>{if(r.url().includes(':47850/'))requests.push(new URL(r.url()).pathname+(new URL(r.url()).searchParams.get('q')?'?q='+new URL(r.url()).searchParams.get('q'):''));});
let releaseDetail;const detailGate=new Promise(resolve=>{releaseDetail=resolve;});
let detailFetched;const detailReady=new Promise(resolve=>{detailFetched=resolve;});
let holdDetail=true;
// Hold a real provider response until after the user submits Directions. This
// exercises native-style detail latency without replacing any provider data.
await page.route(gateway+'/place?*',async route=>{if(!holdDetail)return route.continue();const response=await route.fetch();detailFetched();await detailGate;await route.fulfill({response});});
const root=()=>page.locator('[data-alpha-maps-root]');
const rootText=text=>page.waitForFunction(value=>document.querySelector('[data-alpha-maps-root]')?.textContent.includes(value),text);
const status=text=>page.waitForFunction(value=>document.querySelector('[data-alpha-maps-status]')?.textContent.includes(value),text);
const evidence={};
try{
 // Rendered vector roads in the default app profile.
 const tiles=await browser.newPage({viewport:{width:412,height:915}});
 try{
  let tileRequests=0;tiles.on('request',r=>{if(r.url().startsWith(gateway+'/tiles/'))tileRequests++;});
  await tiles.goto(app,{waitUntil:'load'});await tiles.getByRole('button',{name:'Maps',exact:true}).click();
  await tiles.waitForFunction(()=>Number(document.querySelector('[data-alpha-map-plane]')?.dataset.mapFeatureCount)>0,undefined,{timeout:30000});
  assert.ok(tileRequests>0,'Actual vector tile requests');
 }finally{await tiles.close();}
 // The rest runs in the development profile (?mode=dev), whose coordinate location source
 // feeds real fixes through the same location bridge used for navigation.
 await page.goto(app+'/?mode=dev',{waitUntil:'load'});
 await page.getByRole('button',{name:'Maps',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-alpha-map-plane]')?.dataset.mapReady==='true');
 const query=page.getByRole('textbox',{name:'Search places',exact:true});await query.fill('Casino');await query.press('Enter');
 // Result pins: one map marker per provider result, from the same response.
 const casinoResults=await json('/search?q=Casino');
 await page.waitForFunction(count=>document.querySelectorAll('[data-alpha-map-plane] [data-map-pin]').length===count,casinoResults.length);
 evidence.resultPins=casinoResults.length;
 const casino=casinoResults.find(p=>p.name==='Casino de Monte Carlo');assert.ok(casino,'Actual Monaco destination');
 // Tapping a pin selects that exact provider place.
 await page.evaluate(id=>document.querySelector(`[data-alpha-map-plane] [data-map-pin="${id}"]`).click(),casino.id);
 await page.getByRole('button',{name:'Rename place'}).filter({hasText:'Casino de Monte Carlo'}).waitFor();
 assert.equal(await page.locator('[data-alpha-map-plane] [data-map-pin]').count(),0,'Pins clear when a place is selected');
 await page.getByRole('button',{name:'Directions',exact:true}).click();
 const origin=page.getByRole('textbox',{name:'Route origin coordinates'});await origin.fill('43.7384, 7.4246');await origin.press('Enter');
 await detailReady;
 assert.equal(requests.filter(p=>p==='/route').length,0,'Route waits for the selected place detail');
 releaseDetail();holdDetail=false;
 await rootText('no live traffic');
 for(const mode of ['Walk','Bike','Drive']){await page.getByRole('button',{name:mode,exact:true}).click();await rootText('no live traffic');}
 await origin.fill('37, -122');await origin.press('Enter');await page.getByText('Both endpoints must be inside the Monaco region.',{exact:true}).waitFor();
 assert.ok(!await page.getByText('no live traffic',{exact:false}).count(),'Old route removed on changed origin');
 await origin.fill('43.7384, 7.4246');await origin.press('Enter');await rootText('no live traffic');
 const dir='test-results/maps-regional-development';fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:path.join(dir,'route.png')});

 // A stale origin search is cancelled by editing: its late response never shows.
 let releaseOrigin;const originGate=new Promise(resolve=>{releaseOrigin=resolve;});let originHeld;const originSeen=new Promise(resolve=>{originHeld=resolve;});
 await page.route(gateway+'/search?q=Decathlon',async route=>{originHeld();await originGate;try{await route.fulfill({response:await route.fetch()});}catch{}},{times:1});
 await origin.fill('Decathlon');await origin.press('Enter');await originSeen;
 await status('Choose a starting point for the route to Casino de Monte Carlo');
 // While choosing, the search bar holds the origin text; editing it cancels the held search.
 assert.equal(await query.inputValue(),'Decathlon');
 await query.fill('43.7384, 7.4246');releaseOrigin();
 await page.waitForTimeout(500);
 assert.equal(await page.getByRole('button',{name:/^Decathlon/}).count(),0,'Cancelled origin search never shows results');
 await query.press('Enter');await rootText('no live traffic');
 assert.equal(await origin.inputValue(),'43.7384, 7.4246');

 // Named origin: the origin field searches regional places; choosing one replans.
 const decathlon=(await json('/search?q=Decathlon')).find(p=>p.name==='Decathlon');assert.ok(decathlon,'Actual Monaco origin place');
 const routesBefore=requests.filter(p=>p==='/route').length;
 await origin.fill('Decathlon');await origin.press('Enter');
 await page.waitForFunction(()=>document.querySelectorAll('[data-alpha-map-plane] [data-map-pin]').length>0);
 await page.locator('[data-alpha-maps-root] button.tap').filter({hasText:/^Decathlon/}).first().click();
 await rootText('From Decathlon');await rootText('no live traffic');
 assert.ok(requests.filter(p=>p==='/route').length>routesBefore,'Choosing the origin plans a new route');
 assert.equal(await origin.inputValue(),'Decathlon');
 evidence.namedOrigin='Decathlon';

 // Turn-by-turn: a real fix at the origin shows the upcoming maneuver, its arrow,
 // the following step, remaining distance/time and the device position marker.
 const route=await json('/route?'+new URLSearchParams({from:`${decathlon.coordinate.latitude},${decathlon.coordinate.longitude}`,to:`${casino.coordinate.latitude},${casino.coordinate.longitude}`,mode:'drive'}));
 assert.ok(route.steps.every(step=>typeof step.maneuver==='string'),'Gateway reports a maneuver for every step');
 // The development device's coordinate location source (?mode=dev) reports a fix every
 // second through the same location bridge; Chromium's emulated provider errors on change.
 const move=point=>page.evaluate(({latitude,longitude})=>{localStorage.setItem('alpha.dev.location.v1',JSON.stringify({mode:'coordinates',latitude,longitude,accuracy:5,homeId:'',radius:200}));window.dispatchEvent(new Event('alpha:dev-location'));},point);
 await move(decathlon.coordinate);
 await page.getByRole('button',{name:'Start',exact:true}).click();
 await status('Foreground guidance · location accuracy');
 // The upcoming maneuver is the first one the device has not yet come within 40 m of.
 const meters=(a,b)=>{const r=Math.PI/180,dlat=(a.latitude-b.latitude)*r,dlon=(a.longitude-b.longitude)*r;return 6371000*2*Math.asin(Math.min(1,Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin(dlon/2)**2)));};
 let index=0;while(index<route.steps.length-1&&meters(decathlon.coordinate,route.steps[index].coordinate)<40)index++;
 const next=route.steps[index];
 await page.waitForFunction(text=>[...document.querySelectorAll('[data-alpha-maps-root] div')].some(e=>e.textContent===text),next.instruction);
 const icon=await page.evaluate(()=>[...document.querySelectorAll('[data-alpha-maps-root] svg path')].map(p=>p.getAttribute('d')));
 if(ICONS[next.maneuver])assert.ok(icon.includes(ICONS[next.maneuver]),'Turn arrow follows the step maneuver '+next.maneuver);
 assert.equal(await page.getByText('Then',{exact:true}).count(),index+1<route.steps.length?1:0,'Then banner shows the following step');
 await rootText('arrive');await rootText('no live traffic');
 await page.waitForFunction(()=>!!document.querySelector('[data-alpha-map-plane] [data-map-position]'));
 evidence.guidance={next:next.instruction,maneuver:next.maneuver,steps:route.steps.length};
 await page.screenshot({path:path.join(dir,'navigation.png')});
 await move({latitude:43.725,longitude:7.410});await status('Off route. Stop and calculate a new route.');
 await move(casino.coordinate);await status('Destination reached.');
 await page.getByRole('button',{name:'End navigation'}).click();
 assert.equal(await page.locator('[data-alpha-map-plane] [data-map-position]').count(),0,'Position marker ends with navigation');

 // Place detail: OSM opening_hours, phone and website appear when the source has them.
 await page.getByRole('button',{name:'Back to place'}).click().catch(()=>{});
 await page.getByRole('button',{name:'Close place'}).click();
 await query.fill('Decathlon');await query.press('Enter');
 await page.locator('[data-alpha-maps-root] button.tap').filter({hasText:/^Decathlon/}).first().click();
 const detail=await json('/place?id='+encodeURIComponent(decathlon.id));
 assert.ok(detail.openingHours&&detail.phone&&detail.website,'Actual OSM detail tags');
 await rootText(detail.openingHours);await rootText('Phone '+detail.phone);
 await page.getByRole('button',{name:'Website',exact:true}).waitFor();
 evidence.placeDetail={openingHours:detail.openingHours,phone:true,website:true};

 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(dir,'renderer.json'),JSON.stringify({passed:true,delayedRealDetail:true,...evidence,requests,scope:'Real Chromium renderer + local OSM provider + development coordinate location source (?mode=dev); native GPS, screen-off and Android untested'},null,2));
 console.log('PASS real map tiles/search pins/delayed-detail route/modes/out-of-region/stale-route clearing/named origin/cancelled origin search/maneuver guidance/position marker/place detail');
}catch(error){console.log(JSON.stringify({errors,requests:requests.slice(-20),state:await root().innerText().catch(()=>''),planes:await page.locator('[data-alpha-map-plane]').count()}));throw error;}finally{await browser.close();}
