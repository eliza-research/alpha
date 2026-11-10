// Synthetic native HTTP boundaries; real flag-off renderer and MapLibre. No Google key or location.
import {test,expect} from '@playwright/test';
import {flagOffAndroid,residentHome,button} from './flag-off-android';
import {residentStub} from './resident-stub';
// Valid opaque-white 1×1 gray/alpha PNG; IDAT CRC and zlib checksum are verified.
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP4/x8AAwAB/2+Bq7YAAAAASUVORK5CYII=';
test.use({video:{mode:'on',size:{width:915,height:915}}});
test.beforeEach(({},info)=>test.skip(info.project.name!=='production','Flag-off renderer'));
for(const tiles of ['valid','malformed','copyright-unavailable','unavailable'] as const)test(`Google Maps tiles ${tiles}`,async({page},info)=>{
 test.setTimeout(120_000);
 await flagOffAndroid(page);await residentStub(page);
 await page.route('https://tiles.openfreemap.org/**',route=>route.abort());
 await page.addInitScript(({png,tiles})=>{
  const w=window as any,base=w.Capacitor.nativePromise;
  w.Capacitor.PluginHeaders.push({name:'ElizaSense',methods:[{name:'turnOff',rtype:'promise'},{name:'status',rtype:'promise'}]});
  const f=w.googleRaster={tiles:0,viewport:0,queries:0,tileKeys:[] as string[]};
  const listeners=[{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'callback'}];
  w.Capacitor.PluginHeaders.push(
   {name:'ElizaLocation',methods:[...['checkPermissions','requestPermissions','watchPosition','clearWatch'].map(name=>({name,rtype:'promise'})),...listeners]},
   {name:'AlphaMapsTransport',methods:[{name:'navigationAvailability',rtype:'promise'},...listeners]},
  );
  const providerId='custom-google-provider',attribution='Google Maps';
  w.Capacitor.nativePromise=async(plugin:string,method:string,input:any)=>{
   if(plugin==='ElizaLocation'){
    if(method==='checkPermissions'||method==='requestPermissions')return {location:'granted',accuracy:'precise'};
    if(method==='watchPosition')return {watchId:'google-test-watch'};
    return {};
   }
   if(plugin==='AlphaMapsTransport'&&method==='navigationAvailability')return {background:false,activeSessionId:null};
   if(plugin==='ElizaSense')return {available:true,state:'OFF',label:'Listening off',consented:false,listening:false,microphoneOpen:false};
   if(plugin==='AlphaConnection'&&method==='request'&&new URL(input.url).pathname.startsWith('/api/v1/maps/')){
    const path=new URL(input.url).pathname;
    if(path.endsWith('/capabilities'))return {status:200,data:{providerId,connectionId:'conn_google_fixture_0001',revision:'fixture-google',attribution,sources:{data:'Google Maps',search:'Google Places',routing:'Google Routes'},regions:[{id:'world',name:'World',bounds:[-180,-85,180,85]}],capabilities:{map:tiles!=='unavailable',search:true,placeDetails:true,modes:['drive','walk'],alternatives:false,traffic:'none',transit:'none',offline:{map:false,search:false,routing:false}},...(tiles==='unavailable'?{}:{tiles:{urlTemplate:'/api/v1/maps/tiles/{z}/{x}/{y}',tileSize:256,minZoom:0,maxZoom:18,attribution:'Map data © Google'}})}};
    if(/\/tiles\/\d+\//.test(path)){f.tiles++;f.tileKeys.push(input.headers['Idempotency-Key']);return {status:200,data:{encoding:'base64',contentType:'image/png',data:tiles==='malformed'?'invalid':png}};}
    if(path.endsWith('/tiles/viewport')){f.viewport++;if(tiles==='copyright-unavailable')return {status:503,data:{error:{code:'provider_unavailable',message:'Copyright metadata unavailable'}}};return {status:200,data:{providerId,copyright:'Map data © Google · synthetic viewport'}};}
    if(path.endsWith('/routes')){
     const {from,to,mode}=JSON.parse(input.body);
     return {status:200,data:{providerId,attribution,routes:[{providerId,id:'google-test-route',from,to,mode,
      geometry:[from,to],distanceMeters:500,durationSeconds:120,
      steps:[{instruction:'Head toward the harbour',coordinate:from,distanceMeters:500,maneuver:'depart'},{instruction:'Arrive at the harbour',coordinate:to,distanceMeters:0,maneuver:'arrive'}],
      attribution,fetchedAt:Date.now(),traffic:'none'}]}};
    }
    if(path.endsWith('/places/details'))return {status:200,data:{providerId,attribution,place:{providerId,id:'fixture-place',name:'Synthetic harbour',coordinate:{latitude:43.735,longitude:7.42},attribution,fetchedAt:Date.now()}}};
    if(path.endsWith('/places/search')){f.queries++;return {status:200,data:{providerId,attribution,places:[{providerId,id:'fixture-place',name:'Synthetic harbour',coordinate:{latitude:43.735,longitude:7.42},attribution,fetchedAt:Date.now()}]}};}
    return {status:404,data:{}};
   }
   return base(plugin,method,input);
  };
 },{png,tiles});
 await residentHome(page);await button(page,'Maps').click();
 const search=page.getByRole('searchbox',{name:'Search places',exact:true});await search.fill('Synthetic harbour');await search.press('Enter');
 const plane=page.locator('[data-alpha-map-plane]');await expect(plane).toBeVisible();
 const attribution=page.locator('.alpha-map-credits');
 await expect(attribution.getByRole('img',{name:'Google Maps',exact:true})).toBeVisible();
 await expect(page.locator('.alpha-map-credits').getByText('OpenFreeMap',{exact:true})).toHaveCount(0);
 if(tiles==='unavailable'){
  await expect(attribution.getByText('Map imagery unavailable')).toBeVisible();
  await expect(plane.locator('canvas')).toHaveCount(0);
  await expect(page.getByText('Loading map…',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/^Synthetic harbour/})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).googleRaster.tiles)).toBe(0);
  await page.getByRole('button',{name:/^Synthetic harbour/}).click();
  await expect(page.getByRole('heading',{name:'Synthetic harbour',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Save',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Share',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Close place',exact:true}).click();
  await search.fill('43.7384, 7.4246');await search.press('Enter');
  await expect(page.getByRole('button',{name:'Save',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Share',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('button',{name:'Remove from saved',exact:true})).toBeVisible();
  return;
 }
 await expect.poll(()=>page.evaluate(()=>(window as any).googleRaster.tiles)).toBeGreaterThan(0);
 const keys=await page.evaluate(()=>(window as any).googleRaster.tileKeys);expect(keys.every((k:string)=>/^[a-f0-9-]{36}$/.test(k))).toBe(true);
 if(tiles==='copyright-unavailable'){
  await expect(plane).toHaveAttribute('data-map-error','copyright');
  await expect(plane.locator('canvas')).toHaveCSS('visibility','hidden');
  await expect(page.getByText('Loading map…',{exact:true})).toHaveCount(0);
  return;
 }
 if(tiles==='malformed'){await expect(plane).toHaveAttribute('data-map-error',/./);}
 else{
  await expect(plane).toHaveAttribute('data-map-ready','true');
  const dataSources=attribution.getByText('Data sources',{exact:true});
  const checkCreditLayouts=async(stage:string)=>{for(const layout of [
   {name:'portrait',width:412,height:915,scale:1},
   {name:'portrait-large',width:412,height:915,scale:2},
   {name:'small-landscape-large',width:640,height:360,scale:1.5},
   {name:'landscape',width:915,height:412,scale:1},
  ]){
   await page.setViewportSize({width:layout.width,height:layout.height});
   // Exercise the production text-measurement probe and enlarged attribution glyphs.
   await page.addStyleTag({content:`[data-alpha-text-probe]{font-size:${100*layout.scale}px!important}.alpha-map-credits{font-size:${12*layout.scale}px!important}.alpha-map-info{font-size:${14*layout.scale}px!important}`});
   await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--alpha-text-scale').trim())).toBe(String(layout.scale));
   await expect(attribution.getByRole('img',{name:'Google Maps',exact:true})).toBeVisible();
   if(await dataSources.isVisible()){
    await expect(async()=>{
     expect(await dataSources.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===el||el.contains(hit);})).toBe(true);
    }).toPass();
    await dataSources.click();
    const sources=attribution.locator('details[open]');
    await expect(sources).toContainText('Map data © Google · synthetic viewport');
    const panel=await sources.locator('.alpha-map-info').boundingBox();
    expect(panel!.x).toBeGreaterThanOrEqual(0);expect(panel!.y).toBeGreaterThanOrEqual(0);
    expect(panel!.x+panel!.width).toBeLessThanOrEqual(layout.width);
    expect(panel!.y+panel!.height).toBeLessThanOrEqual(layout.height);
    await page.screenshot({path:info.outputPath(`google-credit-${stage}-${layout.name}.png`),animations:'disabled'});
    await dataSources.click();
   }else{
    await expect(attribution.locator('.alpha-google-copyright')).toBeVisible();
   }
  }
  };
  await checkCreditLayouts('results');
  await page.setViewportSize({width:412,height:915});
  await expect(page.getByRole('button',{name:'Synthetic harbour',exact:true})).toBeVisible();
  await expect(async()=>{
   const credits=await attribution.boundingBox(),sheet=await page.locator('[data-alpha-maps-sheet="results"]').boundingBox();
   expect(credits).not.toBeNull();expect(sheet).not.toBeNull();
   expect(credits!.y+credits!.height).toBeLessThanOrEqual(sheet!.y);
  }).toPass();
  await page.getByRole('button',{name:/^Synthetic harbour/}).last().click();
  await page.getByRole('button',{name:'Directions',exact:true}).click();
  const origin=page.getByRole('textbox',{name:'Starting point'});
  await origin.fill('43.7384, 7.4246');await origin.press('Enter');
  await expect(page.getByText(/no live traffic/).first()).toBeVisible();
  await expect(page.getByRole('button',{name:'Share route',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Start',exact:true}).click();
  await expect(page.getByRole('button',{name:'End navigation',exact:true})).toBeVisible();
  await page.evaluate(()=>(window as any).flagOff.emit('ElizaLocation','locationChange',{coords:{latitude:43.7384,longitude:7.4246,accuracy:5,timestamp:Date.now(),heading:null,speed:null},cached:false}));
  await expect(page.getByRole('status',{name:'Remaining distance and time',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/voice guidance/})).toHaveCount(0);
  await checkCreditLayouts('navigation');
  await page.getByRole('button',{name:'End navigation',exact:true}).click();
 }
 await page.screenshot({path:info.outputPath('google-raster.png'),animations:'disabled'});
});
