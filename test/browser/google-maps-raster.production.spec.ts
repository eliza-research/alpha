// Synthetic native HTTP boundaries; real flag-off renderer and MapLibre. No Google key or location.
import {test,expect} from '@playwright/test';
import {flagOffAndroid,residentHome,button} from './flag-off-android';
import {residentStub} from './resident-stub';
// Valid opaque-white 1×1 gray/alpha PNG; IDAT CRC and zlib checksum are verified.
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP4/x8AAwAB/2+Bq7YAAAAASUVORK5CYII=';
test.beforeEach(({},info)=>test.skip(info.project.name!=='production','Flag-off renderer'));
for(const broken of [false,true])test(`Google raster transport and attribution ${broken?'refuse malformed tiles':'replace the public basemap'}`,async({page},info)=>{
 await flagOffAndroid(page);await residentStub(page);
 await page.route('https://tiles.openfreemap.org/**',route=>route.abort());
 await page.addInitScript(({png,broken})=>{
  const w=window as any,base=w.Capacitor.nativePromise;
  w.Capacitor.PluginHeaders.push({name:'ElizaSense',methods:[{name:'turnOff',rtype:'promise'},{name:'status',rtype:'promise'}]});
  const f=w.googleRaster={tiles:0,viewport:0,queries:0,tileKeys:[] as string[]};
  const providerId='eliza-cloud-google',attribution='Google Maps';
  w.Capacitor.nativePromise=async(plugin:string,method:string,input:any)=>{
   if(plugin==='ElizaSense')return {available:true,state:'OFF',label:'Listening off',consented:false,listening:false,microphoneOpen:false};
   if(plugin==='AlphaConnection'&&method==='request'&&new URL(input.url).pathname.startsWith('/api/v1/maps/')){
    const path=new URL(input.url).pathname;
    if(path.endsWith('/capabilities'))return {status:200,data:{providerId,connectionId:'conn_google_fixture_0001',revision:'fixture-google',attribution,sources:{data:'Google Maps',search:'Google Places',routing:'Google Routes'},regions:[{id:'world',name:'World',bounds:[-180,-85,180,85]}],capabilities:{map:true,search:true,placeDetails:true,modes:['drive','walk'],alternatives:false,traffic:'none',transit:'none',offline:{map:false,search:false,routing:false}},tiles:{urlTemplate:'/api/v1/maps/tiles/{z}/{x}/{y}',tileSize:256,minZoom:0,maxZoom:18,attribution:'Map data © Google'}}};
    if(/\/tiles\/\d+\//.test(path)){f.tiles++;f.tileKeys.push(input.headers['Idempotency-Key']);return {status:200,data:{encoding:'base64',contentType:'image/png',data:broken?'invalid':png}};}
    if(path.endsWith('/tiles/viewport')){f.viewport++;return {status:200,data:{providerId,copyright:'Map data © Google · synthetic viewport'}};}
    if(path.endsWith('/places/search')){f.queries++;return {status:200,data:{providerId,attribution,places:[{providerId,id:'fixture-place',name:'Synthetic harbour',coordinate:{latitude:43.735,longitude:7.42},attribution,fetchedAt:Date.now()}]}};}
    return {status:404,data:{}};
   }
   return base(plugin,method,input);
  };
 },{png,broken});
 await residentHome(page);await button(page,'Maps').click();
 const search=page.getByRole('searchbox',{name:'Search places',exact:true});await search.fill('Synthetic harbour');await search.press('Enter');
 const plane=page.locator('[data-alpha-map-plane]');await expect(plane).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>(window as any).googleRaster.tiles)).toBeGreaterThan(0);
 await expect(page.locator('.alpha-map-credits').getByText('Google Maps',{exact:true})).toBeVisible();
 await expect(page.locator('.alpha-map-credits').getByText('OpenFreeMap',{exact:true})).toHaveCount(0);
 const keys=await page.evaluate(()=>(window as any).googleRaster.tileKeys);expect(keys.every((k:string)=>/^[a-f0-9-]{36}$/.test(k))).toBe(true);
 if(broken){await expect(plane).toHaveAttribute('data-map-error',/./);}
 else{
  await expect(plane).toHaveAttribute('data-map-ready','true');
  await expect(page.locator('.alpha-map-credits')).toContainText('synthetic viewport');
  await expect(page.getByRole('button',{name:'Synthetic harbour',exact:true})).toBeVisible();
  const credits=await page.locator('.alpha-map-credits').boundingBox();
  const sheet=await page.locator('[data-alpha-maps-sheet="results"]').boundingBox();
  expect(credits).not.toBeNull();expect(sheet).not.toBeNull();
  expect(credits!.y+credits!.height).toBeLessThanOrEqual(sheet!.y);
 }
 await page.screenshot({path:info.outputPath('google-raster.png'),animations:'disabled'});
});
