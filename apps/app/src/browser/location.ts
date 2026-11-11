import {readDevicePreferences,initializeDevicePreferences} from './device-preferences';
import {browserScreenLocked} from './screen-locked';
import {readLocationSimulation,locationSimulationKey} from './location-simulation';
import { WebPlugin } from '@capacitor/core';
import {browserSensorEnabled} from './sensor-policy';
import {devSurfacesEnabled} from '../build-flags';
import {MapsFailure} from '../maps/contracts';
// The 'alpha.dev.location.v1' simulation is read only on the development server
// with test mocks enabled; flag-off builds always use browser geolocation.
const simulatedCoordinates=()=>devSurfacesEnabled&&readLocationSimulation().mode==='coordinates';
const foreground=()=>!document.hidden&&document.documentElement.dataset.devBackground!=='true'&&!browserScreenLocked();
export class BrowserLocation extends WebPlugin {
 private generation=0;
 private watches=new Map<string,{id:number;active:boolean;simulated?:boolean}>();
 private pending=new Map<string,()=>void>();
 constructor(){super();initializeDevicePreferences();if(devSurfacesEnabled){const changed=()=>{this.generation++;for(const cancel of [...this.pending.values()])cancel();let simulated:boolean;try{simulated=simulatedCoordinates();}catch{this.retire('UNAVAILABLE');return;}for(const [watchId,watch] of this.watches){if(!!watch.simulated!==simulated){void this.clearWatch({watchId});void this.notifyListeners('error',{code:'UNAVAILABLE'});}else if(simulated)this.simulatedFix();}};window.addEventListener('alpha:dev-location',changed);window.addEventListener('storage',event=>{if(event.key===locationSimulationKey||event.key===null)changed();});}window.addEventListener('alpha:device-settings',()=>{if(!browserSensorEnabled('locationEnabled'))this.retire();});window.addEventListener('pagehide',()=>this.retire());window.addEventListener('alpha:device-state',()=>this.retire());document.addEventListener('visibilitychange',()=>{if(document.hidden)this.retire();});}
 private retire(code='PERMISSION_DENIED'){this.generation++;for(const cancel of [...this.pending.values()])cancel();const had=this.watches.size>0;for(const watch of this.watches.values()){watch.active=false;if(watch.simulated)clearInterval(watch.id);else navigator.geolocation.clearWatch(watch.id);}this.watches.clear();if(had)void this.notifyListeners('error',{code});}
 async checkPermissions(){const generation=this.generation,enabled=(await readDevicePreferences()).locationEnabled;if(generation!==this.generation)return {location:'denied',accuracy:'none'};if(simulatedCoordinates()&&enabled)return {location:'granted',accuracy:'precise'};if(!enabled)return {location:'denied',accuracy:'none'};try{const status=await navigator.permissions.query({name:'geolocation'});if(generation!==this.generation||!browserSensorEnabled('locationEnabled'))return {location:'denied',accuracy:'none'};return {location:status.state,accuracy:status.state==='granted'?'precise':'none'};}catch{return {location:generation!==this.generation||!browserSensorEnabled('locationEnabled')?'denied':'prompt',accuracy:'none'};}}
 async requestPermissions(input?:{requestId?:string}){
  const requestId=input?.requestId||crypto.randomUUID();this.pending.get(requestId)?.();
  let cancelled=false,finishPending:((granted:boolean)=>void)|undefined;const cancel=()=>{cancelled=true;finishPending?.(false);};this.pending.set(requestId,cancel);
  try{
   const settings=await readDevicePreferences();
   if(cancelled||!settings.locationEnabled||!foreground())return {location:'denied',accuracy:'none'};
   if(simulatedCoordinates())return {location:'granted',accuracy:'precise'};
   let permission:PermissionStatus|undefined;
   try{permission=await navigator.permissions.query({name:'geolocation'});}catch{/* Browsers without Permissions API still use the cancellable geolocation probe. */}
   if(cancelled||!browserSensorEnabled('locationEnabled')||!foreground())return {location:'denied',accuracy:'none'};
   if(permission?.state==='granted')return {location:'granted',accuracy:'precise'};
   if(permission?.state==='denied')return {location:'denied',accuracy:'none'};
   return await new Promise((resolve,reject)=>{
    let id:number|undefined,settled=false,removePermissionListener=()=>{};
    const finish=(granted:boolean,failure?:MapsFailure)=>{
     if(settled)return;settled=true;removePermissionListener();
     if(id!==undefined)navigator.geolocation.clearWatch(id);
     if(failure)reject(failure);else resolve({location:granted?'granted':'denied',accuracy:granted?'precise':'none'});
    };
    finishPending=finish;
    const permissionChanged=()=>{
     if(permission?.state==='granted')finish(!cancelled&&browserSensorEnabled('locationEnabled')&&foreground());
     else if(permission?.state==='denied')finish(false);
    };
    const observing=!!permission&&typeof permission.addEventListener==='function';
    if(observing){
     removePermissionListener=()=>permission?.removeEventListener('change',permissionChanged);
     permission!.addEventListener('change',permissionChanged);permissionChanged();
     if(settled)return;
    }
    try{
     id=navigator.geolocation.watchPosition(()=>finish(!cancelled&&browserSensorEnabled('locationEnabled')),error=>{
      // Permission approval is independent of obtaining the first GPS/network fix.
      if(permission?.state==='granted'){permissionChanged();return;}
      if(error.code===1){finish(false);return;}
      // Do not let the acquisition timer reject a still-open permission prompt.
      if(error.code===3&&observing&&permission?.state==='prompt')return;
      finish(false,new MapsFailure('unavailable',error.code===3?'Location timed out':'No location'));
     },{timeout:10000});
     if(settled)navigator.geolocation.clearWatch(id);
    }catch{finish(false,new MapsFailure('unavailable','No location'));}
   });
  }finally{if(this.pending.get(requestId)===cancel)this.pending.delete(requestId);}
 }
 async cancelPermissionRequest(input:{requestId:string}){this.pending.get(input.requestId)?.();}
 private simulatedFix(){if(!devSurfacesEnabled||!browserSensorEnabled('locationEnabled')||!foreground())return;try{const fix=readLocationSimulation();if(fix.mode==='coordinates')void this.notifyListeners('locationChange',{coords:{latitude:fix.latitude,longitude:fix.longitude,accuracy:fix.accuracy,timestamp:Date.now()},cached:false});}catch{void this.notifyListeners('error',{code:'UNAVAILABLE'});}}
 async watchPosition(){
  const generation=this.generation,settings=await readDevicePreferences();
  if(generation!==this.generation||!settings.locationEnabled||!foreground())throw new DOMException(devSurfacesEnabled?'Location is off. Turn it on in device controls.':'Location is off. Turn it on in quick settings.','NotAllowedError');
  if(simulatedCoordinates()){const watchId=crypto.randomUUID(),watch={id:0,active:true,simulated:true};this.watches.set(watchId,watch);watch.id=window.setInterval(()=>{if(watch.active)this.simulatedFix();},1000);queueMicrotask(()=>{if(watch.active)this.simulatedFix();});return {watchId};}
  const watchId=crypto.randomUUID(),watch={id:0,active:true};this.watches.set(watchId,watch);
  try{watch.id=navigator.geolocation.watchPosition(position=>{if(watch.active&&browserSensorEnabled('locationEnabled'))void this.notifyListeners('locationChange',{coords:{latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,timestamp:position.timestamp},cached:false});},error=>{if(watch.active)void this.notifyListeners('error',{code:error.code===1?'PERMISSION_DENIED':'UNAVAILABLE'});},{enableHighAccuracy:true,maximumAge:0,timeout:10000});return {watchId};}catch(error){watch.active=false;this.watches.delete(watchId);throw error;}
 }
 async clearWatch(input:{watchId:string}){const watch=this.watches.get(input.watchId);if(watch){watch.active=false;if(watch.simulated)clearInterval(watch.id);else navigator.geolocation.clearWatch(watch.id);}this.watches.delete(input.watchId);}
}
