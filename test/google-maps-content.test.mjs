import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

async function load(entry) {
 const result=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const provider=await load('apps/app/src/maps/cloud-provider.ts');
const {SavedPlaces}=await load('apps/app/src/maps/saved-places.ts');
const point={latitude:43.7384,longitude:7.4246};
const customGoogle={providerId:'deployment-google',sources:{data:'Google Maps'}};
const memory=()=>{
 const values=new Map();
 return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
};

test('Google identity follows the advertised source when a deployment overrides its ID',()=>{
 assert.equal(provider.isGoogleMapsCoverage({providerId:'eliza-cloud-google'}),true);
 assert.equal(provider.isGoogleMapsCoverage(customGoogle),true);
 assert.equal(provider.isGoogleMapsProvider('deployment-google',customGoogle),true);
 assert.equal(provider.isGoogleMapsProvider('other',customGoogle),false);
 assert.equal(provider.isGoogleMapsCoverage({providerId:'regional',sources:{data:'OpenStreetMap'}}),false);
 assert.equal(provider.isGoogleMapsCoverage(undefined),false);
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
