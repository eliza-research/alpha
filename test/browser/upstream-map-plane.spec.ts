import { test, expect } from '@playwright/test';
import {createServer,type ViteDevServer} from 'vite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('shared map renderer loads its real worker and draws host-styled route geometry', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Explicit synthetic tile transport; this does not qualify a real map provider.
  await page.route('https://maps-fixture.invalid/**', route => route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }));
  await page.goto('/?mode=dev');
  await page.evaluate(async () => {
    const { MapPlane } = await import('/src/maps/map-plane.ts');
    const container = document.createElement('div');
    container.id = 'shared-map-test';
    container.style.cssText = 'position:fixed;inset:0;width:412px;height:915px;z-index:9999';
    document.body.append(container);
    const plane = new MapPlane(container, { base: 'https://maps-fixture.invalid', region: 'fixture', bounds: [7.40,43.72,7.45,43.76], attribution: 'Synthetic test' }, () => { container.dataset.failed = 'true'; }, { land:'#ffffff',water:'#ddddff',park:'#ddffdd',rwy:'#eeeeee',fwyE:'#cccccc',major:'#bbbbbb',label:'#111111' });
    const from = { latitude:43.738,longitude:7.424 }, to = { latitude:43.741,longitude:7.425 };
    plane.update(to, { providerId:'fixture',id:'fixture-route',from,to,mode:'walk',geometry:[from,to],distanceMeters:300,durationSeconds:200,steps:[],attribution:'Synthetic test',fetchedAt:Date.now(),traffic:'none' });
    (window as any).sharedPlane = plane;
  });
  const container = page.locator('#shared-map-test');
  await expect(container).toHaveAttribute('data-map-ready','true');
  await expect(container.locator('canvas')).toBeVisible();
  await expect(container.locator('.maplibregl-marker')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).sharedPlane.map.getPaintProperty('route-line','line-color'))).toBe('#1616d8');
  await expect(container).not.toHaveAttribute('data-failed','true');
  await page.evaluate(() => (window as any).sharedPlane.destroy());
  await expect(container.locator('canvas')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// Location stays independent of search/routing; the public basemap is a closed render fixture here.
for(const mode of ['granted','denied','late-fix'] as const)test(`Maps location recovery without a configured search or route provider: ${mode}`,async({page,context})=>{
 await page.route('https://tiles.openfreemap.org/**',route=>route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e7ebed'}}]}}));
 await context.grantPermissions(['geolocation']);await context.setGeolocation({latitude:43.739,longitude:7.425,accuracy:5});await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 if(mode!=='granted')await page.addInitScript(mode=>{const w=window as any;navigator.geolocation.watchPosition=((success:any,error:any)=>{if(mode==='denied')queueMicrotask(()=>error({code:1}));else w.mapsLateFix=success;return 19;}) as any;navigator.geolocation.clearWatch=()=>{};},mode);
 await page.goto('/');await page.getByRole('button',{name:'Maps',exact:true}).click();const status=page.locator('[data-alpha-maps-status]');await expect(status).toHaveAttribute('data-map-state','ready');await expect(page.locator('[data-alpha-map-plane]')).toHaveAttribute('data-map-ready','true');expect(await page.evaluate(async()=>{const {mapsConnection}=await import('/src/maps/runtime.ts');return mapsConnection().config.status;})).toBe('unconfigured');await expect(page.getByRole('button',{name:'Add location',exact:true})).toBeVisible();await page.getByRole('button',{name:'Add location',exact:true}).click();
 if(mode==='granted'){await expect(status).toHaveAttribute('data-location-state','ready');await expect(status).toHaveAttribute('data-map-state','ready');await expect(page.locator('[data-alpha-map-plane]').getByRole('img',{name:'Your position',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Directions',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Use current location',exact:true})).toBeVisible();await expect(status).toContainText('Location access does not share it with your agent.');}
 if(mode==='denied'){await expect(status).toHaveAttribute('data-location-state','denied');await expect(page.getByRole('button',{name:'Location settings',exact:true})).toBeVisible();await expect(status).toContainText('browser site settings');await page.getByRole('button',{name:'Location settings',exact:true}).click();await expect(page.getByRole('dialog',{name:'privacy settings',exact:true})).toBeVisible();await page.getByRole('button',{name:'Done',exact:true}).click();}
 if(mode==='late-fix')await expect(status).toHaveAttribute('data-location-state','loading');
 await page.getByLabel('Map information',{exact:true}).click();await page.getByRole('button',{name:'Enter coordinates',exact:true}).click();const search=page.getByRole('textbox',{name:'Search places',exact:true});await expect(search).toBeFocused();await search.fill('43.74000, 7.42600');await search.press('Enter');await expect(page.getByText('Dropped pin',{exact:true})).toBeVisible();
 if(mode==='late-fix'){await page.evaluate(()=>(window as any).mapsLateFix({coords:{latitude:43.73,longitude:7.42,accuracy:5},timestamp:Date.now()}));await expect(page.getByText('Dropped pin',{exact:true})).toBeVisible();await expect(page.getByText('Current location',{exact:true})).toHaveCount(0);}
});

// A separate server configures this group with the synthetic Maps provider.
// Every request to that synthetic endpoint is fulfilled here, never sent out.
test.describe('configured synthetic Maps provider',()=>{
 let server:ViteDevServer,origin:string,cache:string;
 test.beforeAll(async()=>{cache=await mkdtemp(path.join(tmpdir(),'alpha-maps-vite-'));server=await createServer({cacheDir:cache,define:{'import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS':JSON.stringify('1'),'import.meta.env.VITE_MAPS_BASE_URL':JSON.stringify('https://maps-fixture.invalid')},server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});await server.listen();origin=`http://127.0.0.1:${(server.httpServer!.address() as any).port}`;});
 test.afterAll(async()=>{await server?.close();if(cache)await rm(cache,{recursive:true,force:true});});
for(const mode of ['granted','outside-coverage','webgl','tiles'] as const)test(`Maps configured renderer recovery: ${mode}`,async({page,context})=>{
 let badTiles=mode==='tiles';await page.route('https://maps-fixture.invalid/**',route=>{if(new URL(route.request().url()).pathname==='/capabilities')return route.fulfill({json:{providerId:'alpha-osm-monaco',region:'Synthetic Monaco fixture',bounds:[7.40,43.72,7.45,43.76],attribution:'Synthetic browser test',connectionId:'conn_maps_fixture_connection_123456',revision:'fixture1',capabilities:{map:true,search:true,placeDetails:true,modes:['walk'],traffic:'none',transit:'none',offline:{map:false,search:false,routing:false}}},headers:{'access-control-allow-origin':'*'}});return route.fulfill({status:badTiles?503:204,headers:{'access-control-allow-origin':'*'}});});
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await context.grantPermissions(['geolocation']);await context.setGeolocation(mode==='outside-coverage'?{latitude:10,longitude:10,accuracy:5}:{latitude:43.739,longitude:7.425,accuracy:5});
 if(mode==='webgl')await page.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;(window as any).restoreMapWebGL=()=>HTMLCanvasElement.prototype.getContext=get;HTMLCanvasElement.prototype.getContext=function(type:string,...args:any[]){if(type.startsWith('webgl'))return null;return (get as any).call(this,type,...args);} as any;});
 await page.goto(origin);await page.getByRole('button',{name:'Maps',exact:true}).click();const status=page.locator('[data-alpha-maps-status]'),map=page.locator('[data-alpha-map-plane]');
 if(mode==='webgl'||mode==='tiles'){await expect(status).toHaveAttribute('data-map-state','error');await expect(page.getByRole('button',{name:'Retry map',exact:true})).toBeVisible();await page.getByLabel('Map information',{exact:true}).click();await expect(page.getByRole('button',{name:'Enter coordinates',exact:true})).toBeVisible();await page.getByLabel('Map information',{exact:true}).click();if(mode==='webgl')await page.evaluate(()=>(window as any).restoreMapWebGL());else badTiles=false;await page.getByRole('button',{name:'Retry map',exact:true}).click();}
 await expect(map).toHaveAttribute('data-map-ready','true');await expect(map.locator('canvas')).toBeVisible();await page.getByRole('button',{name:'Add location',exact:true}).click();await expect(status).toHaveAttribute('data-location-state','ready');
 if(mode==='outside-coverage'){await expect(status).toHaveAttribute('data-map-state','outside-coverage');await expect(status).toContainText('outside Synthetic Monaco fixture map coverage');await expect(map.locator('.maplibregl-marker:not([data-map-position])')).toHaveCount(0);}else{await expect(status).toHaveAttribute('data-map-state','ready');await expect(map.locator('.maplibregl-marker:not([data-map-position])')).toHaveCount(1);}
 await expect(map.getByRole('img',{name:'Your position',exact:true})).toHaveCount(1);
 await expect(status).toContainText('Location access does not share it with your agent.');
});

});
