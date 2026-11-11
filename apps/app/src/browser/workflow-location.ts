import {NativeMapsLocation,type Position} from '../maps/native-location';
import {devSurfacesEnabled} from '../build-flags';
import {SavedPlaces} from '../maps/saved-places';
import {distanceToRoute} from '../maps/route-distance';
import {readLocationSimulation} from './location-simulation';
export async function workflowAwayFromHome(signal:AbortSignal):Promise<{away:boolean;detail:string}>{
 signal.throwIfAborted();const config=readLocationSimulation(),home=new SavedPlaces().read().find(place=>place.id===config.homeId);
 if(!home)throw Error(devSurfacesEnabled?'Choose a saved Home place in Device controls → Location.':'Save a Home place in Maps saved places to use location conditions.');
 const original=JSON.stringify({home,radius:config.radius});
 const position=await new Promise<Position>((resolve,reject)=>{
  const location=new NativeMapsLocation();let settled=false;
  const finish=(error?:unknown,position?:Position)=>{if(settled)return;settled=true;signal.removeEventListener('abort',cancel);for(const event of events)window.removeEventListener(event,cancel);document.removeEventListener('visibilitychange',hidden);void location.stop().then(()=>error?reject(error):resolve(position!),reject);};
  const cancel=()=>finish(new DOMException('Location condition cancelled','AbortError')),hidden=()=>{if(document.hidden)cancel();},events=['launcher-home','alpha:device-state','pagehide','alpha:dev-incoming-call'];
  signal.addEventListener('abort',cancel,{once:true});for(const event of events)window.addEventListener(event,cancel);document.addEventListener('visibilitychange',hidden);
  if(signal.aborted||document.hidden||document.documentElement.dataset.devBackground==='true'){cancel();return;}
  void location.start(true,position=>finish(undefined,position),error=>finish(error)).catch(error=>finish(error));
 });
 signal.throwIfAborted();const current=readLocationSimulation(),latest=new SavedPlaces().read().find(place=>place.id===current.homeId);
 if(JSON.stringify({home:latest,radius:current.radius})!==original)throw Error('Home changed during this check. Run the condition again.');
 const distance=distanceToRoute(position.coordinate,[home.coordinate]),accuracy=position.accuracyMeters;
 if(distance-accuracy<=config.radius&&distance+accuracy>config.radius)throw Error('The location accuracy overlaps the Home boundary. Choose a more precise location and retry.');
 const away=distance-accuracy>config.radius;return {away,detail:`${away?'Outside':'Inside'} Home · ${Math.round(distance)} m`};
}
