import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
const source=fileURLToPath(new URL('../../../../vendor/eliza/plugins/plugin-maps/src/client/map-plane.ts',import.meta.url));
const sources=[source,fileURLToPath(import.meta.url)];
export async function checkMapPlaneFailures(){
 const driverHashes=captureInputs(sources),text=readFileSync(source,'utf8');
 const marker='this.map.on("error", (event) => {';
 const start=text.indexOf(marker),end=text.indexOf('\n    });',start);
 assert(start>=0&&end>start);
 const traces=[];
 for(const actions of [['load','tile'],['tile'],['load','engine'],['load','abort'],['dispose','engine','tile']]){
  const container={dataset:{}},plane={destroyed:false,styleReady:false};let errors=0;
  const fail=new Function('container','onError','event',text.slice(start+marker.length,end));
  const observe=()=>({'s.loaded':plane.styleReady,'s.ready':container.dataset.mapReady==='true','s.disposed':plane.destroyed,'s.tileIssue':container.dataset.mapTileError==='true','s.errors':errors});
  const trace={name:actions.join('-'),expect:observe(),steps:[]};
  for(const action of actions){
   if(action==='load'){plane.styleReady=true;if(!container.dataset.mapError)container.dataset.mapReady='true';}
   else if(action==='dispose')plane.destroyed=true;
   else fail.call(plane,container,()=>errors++,{error:{name:action==='abort'?'AbortError':'Error',message:'Fixture failure'},...(action==='tile'?{tile:{}}:{})});
   trace.steps.push({action:{name:action,args:[]},expect:observe()});
  }
  traces.push(trace);
 }
 return checkTraces({model:'MapPlaneFailures',sources,driverHashes,traces,scope:'bounded-component',assumptions:['The actual shared MapPlane error callback executes with captured DOM readiness and error signals.','One map instance and up to two failures. The production-browser tests exercise real MapLibre tile loading separately.']});
}
