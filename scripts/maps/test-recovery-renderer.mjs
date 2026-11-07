import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(process.env.ALPHA_BROWSER_MODULES?path.join(process.env.ALPHA_BROWSER_MODULES,'maps-test.cjs'):import.meta.url);
const {chromium}=require('playwright'),browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:412,height:915}});page.setDefaultTimeout(20000);
let capabilitiesDown=true,routesDown=false,capabilityRequests=0;
await page.route('http://127.0.0.1:47850/capabilities',route=>{capabilityRequests++;return capabilitiesDown?route.abort('connectionrefused'):route.continue();});
await page.route('http://127.0.0.1:47850/route?*',route=>routesDown?route.abort('connectionrefused'):route.continue());
try{
 await page.goto(`http://127.0.0.1:${Number(process.env.ALPHA_BROWSER_TEST_PORT||5194)}`,{waitUntil:'load'});await page.getByRole('button',{name:'Maps',exact:true}).click();
 // A failed connection shows one short line; the next search retries it.
 await page.locator('[data-alpha-maps-status]').getByText(/Connecting Maps…|Maps is unavailable right now\.|Regional Maps is unavailable/).first().waitFor();
 assert.equal(capabilityRequests,1);assert.equal(await page.locator('[data-alpha-map-plane] canvas').count(),0);
 capabilitiesDown=false;
 const query=page.getByRole('textbox',{name:'Search places',exact:true});await query.fill('Casino de Monte Carlo');await query.press('Enter');
 await page.getByRole('button',{name:/^Casino de Monte Carlo/}).first().click();assert.equal(capabilityRequests,2);
 await page.getByRole('button',{name:'Directions',exact:true}).click();
 // The route sheet names only live traffic, so a planned route shows as an enabled Start.
 const routeReady=()=>page.waitForFunction(()=>document.querySelector('[data-alpha-maps-start]')?.dataset.canStart==='true');
 const origin=page.getByRole('textbox',{name:'Starting point',exact:true});await origin.fill('43.7384, 7.4246');await origin.press('Enter');
 await routeReady();
 routesDown=true;await origin.fill('43.7385, 7.4246');await origin.press('Enter');
 await page.getByText('Regional Maps is unavailable. Check the configured service connection.',{exact:true}).waitFor();
 assert.equal(await page.locator('[data-alpha-maps-start][data-can-start="true"]').count(),0);
 routesDown=false;await origin.fill('43.7384, 7.4246');await origin.press('Enter');await routeReady();
 const result={passed:true,scope:'Chromium network interception for connection failures; recovery uses actual local OSM provider; native permission/gateway-timeout execution pending',capabilityRequests};
 fs.mkdirSync('test-results/maps-regional-development',{recursive:true});fs.writeFileSync('test-results/maps-regional-development/recovery-renderer.json',JSON.stringify(result,null,2));console.log('PASS explicit connection retry and route failure recovery with real provider results');
}finally{await browser.close();}
