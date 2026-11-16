import {setTextScale} from './accessibility-states';
import {agentBrowserVoice} from './voice-fixture';
import {genericCloudSpeechFixture} from './generic-cloud-speech-fixture';
import { returnToApps } from './app-navigation';
import {test,expect,type Page} from '@playwright/test';
test.use({locale:'en-GB',hasTouch:true,isMobile:true,viewport:{width:390,height:740}});
const spoken=(page:Page)=>page.evaluate(()=>(window as any).speechTest.spoken);
async function fix(page:Page,latitude=43.738,accuracy=5){await page.evaluate(({latitude,accuracy})=>(window as any).geoFix({coords:{latitude,longitude:7.424,accuracy},timestamp:Date.now()}),{latitude,accuracy});}
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));const s=(window as any).speechTest={spoken:[],voices:[{name:'Device',lang:'en-US',localService:true}],utterance:null,cancelled:0};Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:'granted'})}});const w=window as any;w.geoWatchId=0;w.geoWatches=new Set<number>();Object.defineProperty(navigator,'geolocation',{value:{watchPosition:(fn:any)=>{const id=++w.geoWatchId;w.geoWatches.add(id);w.geoFix=fn;return id;},clearWatch:(id:number)=>{w.geoWatches.delete(id);}}});});
 await page.goto('/?mode=dev');await genericCloudSpeechFixture(page);await agentBrowserVoice(page,{state:'speechTest'});await page.evaluate(async()=>{const {configureMapsProvider}=await import('/src/maps/runtime.ts');const place={providerId:'fixture-region',id:'destination',name:'Test destination',coordinate:{latitude:43.741,longitude:7.424},attribution:'Fixture attribution',fetchedAt:Date.now()};configureMapsProvider({status:'configured',providerId:'fixture-region',connectionId:'conn_fixture_region_123456',revision:'fixture1',capabilities:{map:false,search:true,placeDetails:true,modes:['drive'],traffic:'none',transit:'none',offline:{map:false,search:false,routing:false}}},{providerId:'fixture-region',connectionId:'conn_fixture_region_123456',search:async()=>[place],detail:async()=>place,route:async(from,to,mode)=>({providerId:'fixture-region',id:'route',from,to,mode,geometry:[from,{latitude:43.739,longitude:7.424},to],distanceMeters:333,durationSeconds:223,steps:[{instruction:'Start here',coordinate:from,distanceMeters:0},{instruction:'Turn right',coordinate:{latitude:43.739,longitude:7.424},distanceMeters:111},{instruction:'Continue to destination',coordinate:to,distanceMeters:222}],attribution:'Fixture attribution',fetchedAt:Date.now(),traffic:'none'})});});
 await page.getByRole('button',{name:'Maps',exact:true}).click();const q=page.getByRole('searchbox',{name:'Search places'});await q.fill('Test destination');await q.press('Enter');await page.getByRole('button',{name:/^Test destination/}).first().click();await page.getByRole('button',{name:'Directions',exact:true}).click();const origin=page.getByRole('textbox',{name:'Starting point'});await origin.fill('43.738, 7.424');await origin.press('Enter');await expect(page.getByText(/no live traffic/).first()).toBeVisible();await page.getByRole('button',{name:'Start',exact:true}).click();await expect.poll(()=>page.evaluate(()=>typeof(window as any).geoFix)).toBe('function');
});
// The owner deferred Maps speech and its controls. Shared speech-unit contracts remain separate.
test('Maps keeps visual guidance with centered ETA and one End control',async({page},info)=>{
 await page.setViewportSize({width:390,height:740});await fix(page);
 const controls=page.locator('[data-alpha-maps-guidance-controls]');
 await expect(controls.getByRole('button',{name:'End navigation',exact:true})).toBeVisible();
 await expect(controls.getByRole('button')).toHaveCount(1);
 await expect(page.getByRole('button',{name:'Back to apps',exact:true})).toHaveText('');
 await expect(page.getByRole('button',{name:/voice guidance|^Reroute$|^Ask Alpha$/})).toHaveCount(0);
 const offset=()=>controls.evaluate(el=>{const a=el.getBoundingClientRect(),b=el.querySelector(':scope > div')!.getBoundingClientRect();return Math.abs((a.left+a.right-b.left-b.right)/2);});
 await expect.poll(offset).toBeLessThan(1);expect(await spoken(page)).toEqual([]);
 await page.screenshot({path:info.outputPath('maps-centered-visual-guidance.png'),animations:'disabled'});
 await fix(page,43.75);await expect(page.getByRole('status').filter({hasText:'Off route'})).toBeVisible();await expect(page.getByRole('status').filter({hasText:'Off route'})).toContainText('End navigation');await expect(page.getByRole('status').filter({hasText:'Off route'})).not.toContainText('Reroute');
 await expect(controls.getByRole('button')).toHaveCount(1);expect(await spoken(page)).toEqual([]);
 await page.setViewportSize({width:915,height:412});await expect(page.locator('html')).toHaveClass(/alpha-landscape/);await setTextScale(page,2);
 await expect.poll(offset).toBeLessThan(1);
 const end=controls.getByRole('button',{name:'End navigation',exact:true});
 const box=await end.boundingBox();expect(box).not.toBeNull();expect(box!.width).toBeGreaterThanOrEqual(44);
 expect(box!.height).toBeGreaterThanOrEqual(44);expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(412);
 await end.click();await expect(controls).toHaveCount(0);
});
test('repeated, inaccurate and arrival fixes remain silent and release the navigation watch',async({page})=>{
 await fix(page,43.738,100);await fix(page);await fix(page);await fix(page,43.739);
 expect(await spoken(page)).toEqual([]);const watch=await page.evaluate(()=>(window as any).geoWatchId);
 await fix(page,43.740);await expect(page.getByRole('button',{name:'End navigation',exact:true})).toBeVisible();
 expect(await page.evaluate(id=>(window as any).geoWatches.has(id),watch)).toBe(true);
 await fix(page,43.741);await expect.poll(()=>page.evaluate(id=>(window as any).geoWatches.has(id),watch)).toBe(false);
 expect(await spoken(page)).toEqual([]);
});
test('deferring Maps speech preserves playback owned by another consumer',async({page})=>{
 await fix(page);expect(await spoken(page)).toEqual([]);
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const voice=registerPlugin<any>('AlphaVoiceCloud');await voice.play(await voice.synthesizeLocal({text:'Other consumer'}));});
 await expect.poll(()=>spoken(page)).toEqual(['Other consumer']);
 const before=await page.evaluate(()=>(window as any).speechTest.cancelled);await returnToApps(page);
 expect(await page.evaluate(()=>(window as any).speechTest.cancelled)).toBe(before);
});
test('End retires late location callbacks without starting Maps speech',async({page})=>{
 await fix(page);await page.getByRole('button',{name:'End navigation',exact:true}).click();
 await fix(page,43.739);expect(await spoken(page)).toEqual([]);
 await expect(page.locator('[data-alpha-maps-guidance-controls]')).toHaveCount(0);
});
test('visual guidance continues through an app change until explicit End',async({page})=>{
 await fix(page);await returnToApps(page);await fix(page,43.739);
 await page.getByRole('button',{name:'Maps',exact:true}).click();
 await expect(page.getByRole('button',{name:'End navigation',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'End navigation',exact:true}).click();await fix(page);
 expect(await spoken(page)).toEqual([]);
});
