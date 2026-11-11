import {test,expect} from '@playwright/test';
import {flagOffAndroid,residentHome,button} from './flag-off-android';
import {residentStub} from './resident-stub';

test.beforeEach(({},info)=>test.skip(info.project.name!=='production','Flag-off renderer'));

for(const coverage of ['unavailable','non-google'] as const)test(`legacy Maps content with ${coverage} coverage`,async({page})=>{
 test.setTimeout(60_000);
 await flagOffAndroid(page);await residentStub(page);
 await page.route('https://tiles.openfreemap.org/**',route=>route.abort());
 await page.addInitScript(({coverage})=>{
  const w=window as any,base=w.Capacitor.nativePromise;
  const point={latitude:43.7384,longitude:7.4246},providerId='verified-regional';
  localStorage.setItem('alpha.maps.saved-places.v1',JSON.stringify({version:1,items:[
   {id:'legacy-google',label:'Old Google place',coordinate:point,providerId:'eliza-cloud-google',providerPlaceId:'google-id',savedAt:1},
   {id:'legacy-custom',label:'Old custom place',coordinate:point,providerId:'custom-google-provider',providerPlaceId:'custom-id',savedAt:1},
   {id:'manual',label:'My pin',coordinate:point,savedAt:1},
  ]}));
  w.Capacitor.PluginHeaders.push({name:'ElizaSense',methods:[{name:'turnOff',rtype:'promise'},{name:'status',rtype:'promise'}]});
  w.Capacitor.nativePromise=async(plugin:string,method:string,input:any)=>{
   if(plugin==='ElizaSense')return {available:true,state:'OFF',label:'Listening off',consented:false,listening:false,microphoneOpen:false};
   if(plugin==='AlphaConnection'&&method==='request'&&new URL(input.url).pathname.startsWith('/api/v1/maps/')){
    const path=new URL(input.url).pathname;
    if(path.endsWith('/capabilities'))return coverage==='unavailable'
     ? {status:503,data:{error:'Maps is not configured',code:'maps_not_configured'}}
     : {status:200,data:{providerId,connectionId:'conn_regional_fixture_0001',revision:'regional-fixture',attribution:'OpenStreetMap',
       sources:{data:'OpenStreetMap',search:'Nominatim',routing:'GraphHopper'},regions:[{id:'world',name:'World',bounds:[-180,-85,180,85]}],
       capabilities:{map:false,search:true,placeDetails:true,modes:['drive','walk'],alternatives:false,traffic:'none',transit:'none',offline:{map:false,search:false,routing:false}}}};
    if(path.endsWith('/places/search'))return {status:200,data:{providerId,attribution:'OpenStreetMap',places:[{providerId,id:'regional-place',name:'Regional search result',coordinate:point,attribution:'OpenStreetMap',fetchedAt:Date.now()}]}};
    return {status:404,data:{}};
   }
   return base(plugin,method,input);
  };
 },{coverage});
 await residentHome(page);await button(page,'Maps').click();
 if(coverage==='non-google'){
  const search=page.getByRole('searchbox',{name:'Search places',exact:true});
  await search.fill('Regional search result');await search.press('Enter');
  await expect(page.getByRole('button',{name:/^Regional search result/})).toBeVisible();
  await page.getByRole('button',{name:'Clear search',exact:true}).click();
 }
 const plane=page.locator('[data-alpha-map-plane]'),credits=page.locator('.alpha-map-credits');
 await expect(plane.locator('canvas')).toHaveCount(0);
 await expect(credits.getByText('OpenFreeMap',{exact:true})).toHaveCount(0);
 for(const name of ['Old Google place','Old custom place']){
  await page.getByRole('button',{name:new RegExp('^'+name)}).click();
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  await expect(plane.locator('canvas')).toHaveCount(0);
  await expect(credits.getByText('OpenFreeMap',{exact:true})).toHaveCount(0);
  for(const action of ['Share','Rename place','Directions'])await expect(page.getByRole('button',{name:action,exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Remove from saved',exact:true}).click();
  await page.getByRole('button',{name:'Close place',exact:true}).click();
  await expect(page.getByRole('button',{name:new RegExp('^'+name)})).toHaveCount(0);
 }
 await page.getByRole('button',{name:/^My pin/}).click();
 await expect(page.getByRole('button',{name:'Share',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Rename place',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Remove from saved',exact:true})).toBeVisible();
 // Tile credits stay visible alongside the Map information disclosure.
 await credits.getByLabel('Map information and credits',{exact:true}).click();
 await expect(credits.getByText('OpenFreeMap',{exact:true})).toBeVisible();
});
