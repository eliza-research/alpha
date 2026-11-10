import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

async function load(entry) {
 const result=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const provider=await load('apps/app/src/maps/cloud-provider.ts');
const {SavedPlaces}=await load('apps/app/src/maps/saved-places.ts');
const {MapsController}=await load('apps/app/src/maps/state.ts');
const point={latitude:43.7384,longitude:7.4246};
const customGoogle={providerId:'deployment-google',sources:{data:'Google Maps'}};
const memory=()=>{
 const values=new Map();
 return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
};

function controller(providerId) {
 const requests=[];
 const config={status:'configured',providerId,connectionId:'conn_content_fixture_0001',revision:'fixture',capabilities:{map:true,search:true,placeDetails:false,modes:['drive'],traffic:'none',transit:'none',offline:{map:false,search:false,routing:false}}};
 const backend={providerId,connectionId:config.connectionId,search:async()=>[],detail:async()=>null,route:async(from,to,mode)=>{
  requests.push({from,to,mode});
  return {providerId,id:'route',from,to,mode,geometry:[from,to],distanceMeters:500,durationSeconds:120,steps:[],attribution:providerId,fetchedAt:Date.now(),traffic:'none'};
 }};
 const location={stop:async()=>{},awaitingPermission:()=>false};
 const instance=new MapsController(config,backend,new SavedPlaces(memory()),location,id=>provider.isGoogleMapsProvider(id,customGoogle));
 const destination={providerId,id:'destination',name:'Destination',coordinate:{latitude:43.735,longitude:7.42},attribution:providerId,fetchedAt:Date.now()};
 return {instance,requests,config,backend,destination};
}

test('Google identity follows the advertised source when a deployment overrides its ID',()=>{
 assert.equal(provider.isGoogleMapsCoverage({providerId:'eliza-cloud-google'}),true);
 assert.equal(provider.isGoogleMapsCoverage(customGoogle),true);
 assert.equal(provider.isGoogleMapsProvider('deployment-google',customGoogle),true);
 assert.equal(provider.isGoogleMapsProvider('other',customGoogle),false);
 assert.equal(provider.isGoogleMapsCoverage({providerId:'regional',sources:{data:'OpenStreetMap'}}),false);
 assert.equal(provider.isGoogleMapsCoverage(undefined),false);
});

test('saved provider content stays restricted when its source is absent or does not match',()=>{
 for(const providerId of ['eliza-cloud-google','deployment-google','unknown-legacy-source']){
  const place={origin:'saved',providerId};
  assert.equal(provider.isLocalMapsPlace(place),false);
  assert.equal(provider.isLocalMapsPlace(place,'another-provider'),false);
 }
 const retainedGoogle=id=>id==='deployment-google'||provider.isGoogleMapsProvider(id);
 assert.equal(provider.isLocalMapsPlace({origin:'saved',providerId:'deployment-google'},'deployment-google',retainedGoogle),false);
 assert.equal(provider.isLocalMapsPlace({origin:'saved',providerId:'regional'},'regional',retainedGoogle),true);
});

test('explicit pins, device fixes and locally saved coordinates retain local actions',()=>{
 for(const place of [
  {origin:'manual',providerId:'deployment-google'},
  {origin:'location'},
  {origin:'saved'},
 ])assert.equal(provider.isLocalMapsPlace(place,undefined,()=>true),true);
 assert.equal(provider.isLocalMapsPlace(undefined),false);
});

test('Google content cannot enter the durable coordinate store while manual places remain usable',()=>{
 const storage=memory(),saved=new SavedPlaces(storage,id=>provider.isGoogleMapsProvider(id,customGoogle));
 for(const providerId of ['eliza-cloud-google','deployment-google']){
  assert.throws(()=>saved.save({label:'Provider business name',coordinate:point,providerId,providerPlaceId:'google-place'}),error=>error.code==='unsupported');
  assert.equal(storage.getItem('alpha.maps.saved-places.v1'),null);
 }
 const manual=saved.save({label:'Home',coordinate:point});
 assert.equal(saved.read()[0].id,manual.id);
 const regional=saved.save({label:'Regional place',coordinate:point,providerId:'regional',providerPlaceId:'N123'});
 assert.equal(saved.read().length,2);
 saved.remove(manual.id);saved.remove(regional.id);assert.deepEqual(saved.read(),[]);
});

test('existing saved rows remain readable and removable when new Google content is refused',()=>{
 const storage=memory(),legacy={id:'old-google',label:'Existing saved place',coordinate:point,providerId:'eliza-cloud-google',providerPlaceId:'google-place',savedAt:1};
 const original=JSON.stringify({version:1,items:[legacy]});storage.setItem('alpha.maps.saved-places.v1',original);
 const saved=new SavedPlaces(storage);
 assert.deepEqual(saved.read(),[legacy]);
 assert.throws(()=>saved.save({label:'New result',coordinate:point,providerId:'eliza-cloud-google',providerPlaceId:'new-id'}),error=>error.code==='unsupported');
 assert.equal(storage.getItem('alpha.maps.saved-places.v1'),original);
 saved.remove(legacy.id);assert.deepEqual(saved.read(),[]);
});

test('restricted saved origins retire a prior route without sending their coordinates to a provider',async()=>{
 for(const providerId of ['regional','eliza-cloud-google','deployment-google']){
  const f=controller(providerId);await f.instance.select(f.destination,false);
  await f.instance.chooseOrigin({id:'manual',label:'Manual origin',coordinate:point,savedAt:1});
  assert.equal(f.instance.snapshot().route.phase,'ready');assert.equal(f.requests.length,1);
  for(const legacyProvider of ['eliza-cloud-google','deployment-google','unknown-legacy']){
   const result=await f.instance.chooseOrigin({id:'old-origin',label:'Provider origin',coordinate:point,providerId:legacyProvider,providerPlaceId:'old-place',savedAt:1});
   assert.equal(f.instance.snapshot().origin,null);
   assert.equal(f.instance.snapshot().route.phase,'error');
   assert.equal(result.error.code,'unsupported');
   assert.equal(f.requests.length,1);
  }
 }
 const f=controller('regional');await f.instance.select(f.destination,false);
 await f.instance.chooseOrigin({id:'regional-origin',label:'Verified origin',coordinate:point,providerId:'regional',providerPlaceId:'N123',savedAt:1});
 assert.equal(f.requests.length,1);assert.equal(f.instance.snapshot().route.phase,'ready');
});

test('a provider change clears a held provider origin and preserves an explicit manual origin',async()=>{
 const google=controller('deployment-google'),regional=controller('regional');
 await google.instance.select(google.destination,false);
 await google.instance.chooseOrigin({...google.destination,id:'fresh-origin',name:'Fresh Google origin',coordinate:point});
 assert.equal(google.instance.snapshot().originLabel,'Fresh Google origin');
 google.instance.activateProvider(regional.config,regional.backend);
 assert.equal(google.instance.snapshot().origin,null);assert.equal(google.instance.snapshot().originLabel,null);
 google.instance.setOrigin(point,'Explicit origin');
 google.instance.activateProvider(google.config,google.backend);
 assert.deepEqual(google.instance.snapshot().origin,point);assert.equal(google.instance.snapshot().originLabel,'Explicit origin');
});


test('live non-Google selections require the controller and current connection to agree without admitting saved or Google content',()=>{
 const f=controller('regional'),place={origin:'provider',providerId:'regional'};
 const current=()=>({controller:f.instance.snapshot().provider,connection:f.config});
 const google=id=>provider.isGoogleMapsProvider(id,customGoogle);
 assert.equal(provider.isLocalMapsPlace(place,undefined,google,current()),true);
 assert.equal(provider.isLocalMapsPlace(place,undefined,google,{...current(),connection:{...f.config,providerId:'changed'}}),false);
 assert.equal(provider.isLocalMapsPlace(place,undefined,google,{...current(),connection:{status:'unconfigured'}}),false);
 for(const providerId of ['eliza-cloud-google','deployment-google']){
  const g=controller(providerId),live={controller:g.instance.snapshot().provider,connection:g.config};
  assert.equal(provider.isLocalMapsPlace({origin:'provider',providerId},undefined,google,live),false);
 }
 assert.equal(provider.isLocalMapsPlace({...place,origin:'saved'},undefined,google,current()),false);
 assert.equal(provider.isLocalMapsPlace({origin:'saved',providerId:'unknown-legacy-source'},undefined,google,current()),false);
 f.instance.activateProvider({...f.config,providerId:'changed'},f.backend);
 assert.equal(provider.isLocalMapsPlace(place,undefined,google,current()),false);
 f.instance.activateProvider({status:'unconfigured'});
 assert.equal(provider.isLocalMapsPlace(place,undefined,google,current()),false);
});
