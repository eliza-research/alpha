import { usableNavigationFix } from '../maps/navigation-fix';
import {distanceToRoute,routeProgress} from '../maps/route-distance';
import {atStep,guidanceView} from '../maps/guidance';
import {BackgroundNavigation,type NavigationBridge} from '../maps/background-navigation';
import {registerPlugin} from '../platform-plugins';
import {DailyApps} from '../daily';
import {mapsEventReturnOffered,mapsEventStillThere,type MapsEventOrigin} from '../runtime/maps-event-return';
import {Capacitor} from '@capacitor/core';
import {isAndroid} from '../native';
import {NavigationVoice} from '../maps/navigation-voice';
import {placeShare,routeShare,shareMap,type MapShare} from '../maps/share';
import { MapPlane } from '../maps/map-plane';
import type {MapBasemap} from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/map-plane.ts';
import { globalBasemap } from '../maps/basemap';
import { initializeRegionalMaps, regionalMap, regionalDiagnostics, regionalMapsConfigured } from '../maps/regional-provider';
import { initializeCloudMaps, cloudMapsConnecting, cloudMapsCoverage, cloudMapsDiagnostics } from '../maps/cloud-maps';
import { insideCloudCoverage } from '../maps/cloud-provider';
import { NativeMapsLocation, locationPermissionGranted, type Position } from '../maps/native-location';
import { bindAgentNavigation, residentMapsNavigationPort } from '../maps/agent-navigation';
import type { MapsNavigationSurface } from '../maps/device-navigation';
import { publishMapsSelection, clearMapsSelection } from '../maps/agent-context';
import { MapsController, type MapsState } from '../maps/state';
import { mapsConnection, onMapsConnectionChange } from '../maps/runtime';
import { connectionController } from '../runtime/connection-ui';
import { coordinate, failure, MapsFailure, type Coordinate, type Place, type Route, type TravelMode } from '../maps/contracts';
import { readDevicePreferences } from '../browser/device-preferences';
import type { SavedPlace } from '../maps/saved-places';

type Bag = Record<string, any>;
type Selection = { editingName?: boolean; label: string; coordinate: Coordinate; savedId?: string; providerId?: string; providerPlaceId?: string; origin: 'manual' | 'location' | 'saved' | 'provider' };
const PIN = 'M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0zM15 10a3 3 0 1 1-6 0a3 3 0 1 1 6 0z';
const coordLabel = (point: Coordinate) => `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
// Product builds use Eliza Cloud Maps; the regional gateway is a test-mocks prototype.
const initializeMaps = () => regionalMapsConfigured ? initializeRegionalMaps() : initializeCloudMaps();
const mapsDiagnostics = () => regionalMapsConfigured ? regionalDiagnostics() : cloudMapsDiagnostics();
/** The readable reason Maps is not connected (Cloud only; the regional gateway is development-only). */
const mapsFailureText = () => { const value = mapsDiagnostics(); return 'message' in value ? value.message : ''; };
/** Cloud Maps needs a Cloud sign-in; nothing connects (or is "connecting") without one. */
const signedOut = () => !regionalMapsConfigured && !connectionController.getCloudClient();
/** Why Maps has no provider: signed out, the last connection failure, or still connecting. */
const providerFailureText = () => signedOut() ? 'Sign in to use Maps.' : mapsFailureText() || 'Connecting Maps…';
const mapsAttribution = () => regionalMap()?.attribution || cloudMapsCoverage()?.attribution || '';
const mapsConnected = () => mapsConnection().config.status === 'configured';
/** The origin text once the device's own fix is the starting point; coordinates are never shown or typed. */
const YOUR_LOCATION = 'Your location';
const REROUTE_KEPT = 'Couldn’t get a new route. Keeping the current route and trying again.';
const OFF_ROUTE = 'Off route. Reroute from here, or end navigation.';
/** After a failed reroute the phone tries again from its latest precise fix, less often each time. */
const REROUTE_RETRY_MS = [10_000, 20_000, 40_000, 60_000];
/** Shared-controller failures that name a provider become the screen's one-line wording. */
const shownFailure = (text: string) => /support that route mode/i.test(text) ? 'This travel mode isn’t available here.'
  : /choose an actual origin/i.test(text) ? 'Choose a starting point.' : /provider/i.test(text) ? 'Maps is unavailable right now.' : text;

/** Exact prototype chrome with honest no-provider state and real local/native flows. */
export function installPrototypeMapsAdapter(Component: { prototype: Bag }, views: Record<string, Bag>): () => void {
  const device=registerPlugin<{openSettings(input:{page:string}):Promise<unknown>}>('AlphaDevice');
  const module = views.maps; if (!module) return () => {};
  const original = { render: module.render, back: module.back, onLeave: module.onLeave, reply: module.reply, suggestions: module.suggestions, ongoing: module.ongoing };
  let api: Bag | undefined, controller: MapsController | undefined, state: MapsState | undefined;
  let unsubscribe: (() => void) | undefined, selected: Selection | undefined;
  let planeBasemap:MapBasemap|undefined;
  let plane: MapPlane | undefined, planeElement: HTMLElement | undefined, initialized=false, directions=false, originText='', navigating=false, navDistance=0, arrived=false;
  // Origin picking reuses the results sheet; navigation state is per explicit Start.
  // The starting point the user typed or chose; a late GPS fix never replaces it.
  let chosenOrigin: {coordinate: Coordinate; label?: string} | undefined;
  let originMode=false, navStep=0, navFix: Position | undefined, navRouteId='', follow=true, offRoute=false, rerouting=false, navSession=0, backgroundRunning=false, rerouteCleared=false;
  // The route being followed. The shared controller clears its route while a reroute is planned
  // and keeps an error when one fails; guidance follows this one until a new route replaces it.
  let navRoute: Route | undefined, rerouteTimer: ReturnType<typeof setTimeout> | undefined, rerouteAttempts=0;
  const navigationLocation=new NativeMapsLocation();
  const background=new BackgroundNavigation(registerPlugin<NavigationBridge>('AlphaMapsTransport'),()=>Capacitor.isNativePlatform());
  let mapGeneration=0,mapFailed=false,mapObserver:MutationObserver|undefined;
  let query = '', searching = false, message = '', disposed = false, revision = 0, locating = false;
  const lifecycle={releases:0,hidden:0,permissionHeld:0,providerActivations:0,lastRelease:'',backgroundNavigation:0,backgroundStops:0};
  let initialization: Promise<void> | undefined, searchIntent = 0;
  const navigationVoice=new NavigationVoice(()=>{message='Voice guidance paused.';invalidate();});
  const searchIdentity = {};
  /** Ends guidance, its location watch and any screen-off session, once per Start. */
  // The agent's navigation requests (device-navigation.ts) are cancelled whenever Maps is released.
  const releaseListeners=new Set<()=>void>();
  const agentLocation=new NativeMapsLocation();
  function clearRerouteRetry(){if(rerouteTimer!==undefined)clearTimeout(rerouteTimer);rerouteTimer=undefined;}
  function stopGuidance(){
    navigationVoice.pause();navigating=false;rerouting=false;offRoute=false;navFix=undefined;navRouteId='';navRoute=undefined;backgroundRunning=false;++navSession;
    clearRerouteRetry();rerouteAttempts=0;
    void background.stop();
    return navigationLocation.stop();
  }
  let pendingHandoff: {query:string;intent:number}|undefined;
  // Explicit return to the event whose location opened Maps. It checks that exact event still exists,
  // restores Calendar on it and pops the cross-app stack. It never sets a Maps query.
  let returningToEvent=false;
  const calendarPlugin=registerPlugin<{list(input:{begin:number;end:number}):Promise<{status:string;events?:unknown[]}>}>('AlphaCalendar');
  async function returnToEvent(currentApi:Bag,origin:MapsEventOrigin,raw:unknown){
    if(returningToEvent)return;returningToEvent=true;
    try{
      // Only a ready read without the event withdraws the control; a refused or failed read keeps it.
      let outcome:'found'|'missing'|'permission'|'unknown'='unknown';
      try{const result=await calendarPlugin.list({begin:origin.begin-1,end:origin.begin+1});outcome=result.status==='ready'?(mapsEventStillThere(origin,result.events)?'found':'missing'):result.status==='permission-required'?'permission':'unknown';}catch{/* A thrown read says nothing about the event. */}
      if(disposed||document.hidden||!currentApi.isActive()||currentApi.get('maps').fromEvent!==raw||!mapsEventReturnOffered(raw,api?.S.stack,navigating))return;
      if(outcome==='permission'){currentApi.toast('Calendar access is needed to check this event. Allow calendar access, then try again.');return;}
      if(outcome==='unknown'){currentApi.toast('The event could not be checked. Maps stays open; try again.');return;}
      if(outcome==='missing'){currentApi.set({fromEvent:null});currentApi.toast('That event was deleted or moved. Maps stays open; nothing else changed.');return;}
      const stack=(api?.S.stack||[]).slice(0,-1);
      // Unwind this visit's Maps layers (route, place, results, search text) as system Back would, so
      // nothing of the hand-off is left to show or replay when Maps is opened again.
      for(let layer=0;layer<8&&back();layer++);
      currentApi.setView('calendar',{open:origin.rowId,openDay:origin.day,day:origin.day,month:null,form:null});
      currentApi.open('calendar',{keepState:true});currentApi.shell({stack});
    }finally{returningToEvent=false;}
  }
  // With no Maps provider on Android, an event's location can be handed to an installed map app,
  // only when the user taps for it. The exact hand-off text is sent; no route or ETA is shown here.
  let eventQuery='',mapsApp:boolean|undefined,mapsAppReading=false,mapsAppOpening=false;
  function readMapsApp(){
    if(mapsApp!==undefined||mapsAppReading)return;mapsAppReading=true;
    void DailyApps.capabilities().then(result=>{mapsApp=result.actions.some(row=>row.action==='maps'&&row.available);},()=>{mapsApp=false;}).finally(()=>{mapsAppReading=false;invalidate();});
  }
  function openInMapsApp(text:string){
    if(mapsAppOpening||disposed||document.hidden||!api?.isActive())return;mapsAppOpening=true;
    void DailyApps.perform({action:'maps',query:text}).then(result=>{message=result.status==='opened'?'Opened in your maps app. Review the place there.':result.message||'No installed app can complete this action.';},()=>{message='No installed app can complete this action.';})
      .finally(()=>{mapsAppOpening=false;invalidate();});
  }
  let sharing: {abort:AbortController;current:()=>boolean}|undefined;
  function share(data:MapShare,current:()=>boolean){
    if(!current()||document.hidden)return;sharing?.abort.abort();const owner={abort:new AbortController(),current};sharing=owner;
    void shareMap(data,owner.abort.signal).then(result=>{if(sharing===owner&&current()&&result==='copied')api?.toast('Copied');}).catch(()=>{}).finally(()=>{if(sharing===owner)sharing=undefined;});
  }
  const identities = new WeakMap<Selection, object>();
  // Basemap readiness changes presentation, not the selected location capability.
  const invalidate = (selectionChanged = true) => {
    if(sharing&&!sharing.current()){sharing.abort.abort();sharing=undefined;}
    const token = ++revision;
    if (selectionChanged && selected) {
      let identity = identities.get(selected);
      if (!identity) { identity = {}; identities.set(selected, identity); }
      const route = navigating ? navRoute ?? null : directions && state?.route.phase === 'ready' ? state.route.value : null;
      const selection = selected, provider = state?.provider;
      const read = provider?.status === 'configured' ? () => {
        if (route && route.mode !== 'transit') return { kind: 'map-route' as const, providerId: provider.providerId, providerRevision: provider.revision, attribution: route.attribution, from: route.from, to: route.to, mode: route.mode, distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds, traffic: route.traffic };
        return { kind: 'map-place' as const, providerId: provider.providerId, providerRevision: provider.revision, attribution: mapsAttribution() || state?.selection.value?.attribution || '', label: selection.label, coordinate: selection.coordinate };
      } : undefined;
      // Route identity changes with origin/mode/provider updates; failed/loading
      // routes expose no stale route read capability.
      publishMapsSelection(route ? 'map-route' : 'map-place', identity, token, read);
    }
    else if (selectionChanged && searching && query.trim()) publishMapsSelection('map-search', searchIdentity, token);
    else if (selectionChanged) clearMapsSelection();
    queueMicrotask(() => { if (!disposed && token === revision && api?.isActive()) api.set({ nativeMapsRevision: token }); });
  };
  function ensure() {
    // Cloud Maps usually connected at launch; connect here only if it has not, or failed. A launch
    // connection still in flight is awaited instead, so the first search runs once it is ready.
    if (!initialized) { initialized=true; const state=mapsDiagnostics(),connecting=regionalMapsConfigured?undefined:cloudMapsConnecting();
      if(connecting)initialization=connecting.finally(()=>{initialization=undefined;invalidate();});
      else if(!signedOut()&&(regionalMapsConfigured||!state.configured||state.error))initialization=initializeMaps().finally(()=>{initialization=undefined;invalidate();}); }
    if (controller) return controller;
    const connection = mapsConnection(); controller = new MapsController(connection.config, connection.provider);
    unsubscribe = controller.subscribe(next => {
      if(navigating&&rerouting){
        // An explicit reroute keeps the session; the new route replaces the old one.
        // Only a route planned after the reroute request replaced the old one is accepted.
        if(next.route.phase!=='ready'&&next.route.phase!=='error')rerouteCleared=true;
        else if(next.route.phase==='ready'&&next.route.value&&rerouteCleared){rerouting=false;navStep=0;navRoute=next.route.value;navRouteId=navRoute.id;clearRerouteRetry();rerouteAttempts=0;navigationVoice.pause();message='New route ready.';}
        // A failed reroute keeps the route being followed and tries again shortly.
        else if(next.route.phase==='error'&&rerouteCleared){rerouting=false;message=REROUTE_KEPT;scheduleRerouteRetry();}
      }
      // Only a different ready route planned outside a reroute replaces the session; an idle,
      // loading or failed controller route leaves guidance on the route it follows.
      else if(navigating&&next.route.phase==='ready'&&next.route.value&&next.route.value.id!==navRouteId){void stopGuidance().catch(()=>{});}
      // A fix that arrives after the user typed or chose a starting point: the shared controller has
      // already made it the origin, so the user's own starting point is put back.
      const late=!locating&&directions&&!navigating&&next.position.phase==='ready'&&!!next.position.value&&state?.position.phase!=='ready'&&originText!==YOUR_LOCATION;
      state = next;
      if(late){const chosen=chosenOrigin;queueMicrotask(()=>{
        if(disposed||!controller||!directions||locating||navigating||originText===YOUR_LOCATION||chosenOrigin!==chosen)return;
        if(chosen){controller.setOrigin(chosen.coordinate,chosen.label);void controller.planRoute();}else controller.clearOrigin();});}
      if (locating && next.position.phase === 'ready' && next.position.value) {
        const position = next.position.value; locating = false;
        if (!directions) selected = { label: 'Current location', coordinate: position.coordinate, origin: 'location' };
        else { originText=YOUR_LOCATION; void controller?.planRoute(); }
        searching = false;
        message = position.precision === 'approximate' ? 'Approximate location' : '';
      } else if (locating && next.position.phase === 'error') { locating = false; message = directions ? 'Choose a starting point.' : next.position.error?.message || 'Location unavailable.'; }
      invalidate();
    });
    return controller;
  }
  function discardHandoff(){
    pendingHandoff=undefined;
    if(api?.get('maps').query!=null)api.set({query:null});
  }
  function release(cancelIntent=true) {
    sharing?.abort.abort();sharing=undefined;navigationVoice.pause();
    for(const listener of [...releaseListeners])listener();void agentLocation.stop().catch(()=>{});
    lifecycle.releases++;lifecycle.lastRelease=cancelIntent?'leave-or-background':'provider-switch';message='';chosenOrigin=undefined;
    if(cancelIntent){++searchIntent;discardHandoff();eventQuery='';mapsApp=undefined;}
    ++mapGeneration;mapObserver?.disconnect();mapObserver=undefined;mapFailed=false;    plane?.destroy(); plane=undefined; planeElement=undefined;planeBasemap=undefined; directions=false; originMode=false; void stopGuidance().catch(()=>{});
    clearMapsSelection(); ++revision; locating = false; unsubscribe?.(); unsubscribe = undefined;
    const old = controller; controller = undefined; state = undefined;
    void old?.leave().catch(error => { message = failure(error).message; });
    selected = undefined;
  }
  function showSaved(saved: SavedPlace) { discardHandoff();selected = { label: saved.label, coordinate: saved.coordinate, savedId: saved.id, providerId: saved.providerId, providerPlaceId: saved.providerPlaceId, origin: 'saved' }; searching = false; message = ''; invalidate(); }
  function showPlace(place: Place) {
    selected = { label: place.name, coordinate: place.coordinate, providerId: place.providerId, providerPlaceId: place.id, origin: 'provider' };
    searching = false; message = ''; void ensure().select(place); invalidate();
  }
  /** "Reroute from here": replans the active session from a device coordinate; the session is kept. */
  function rerouteFrom(from: Coordinate): Promise<void>|undefined {
    if(!navigating||rerouting)return undefined;
    if(!usableNavigationFix(navFix)){message='Finding your location to reroute… Your current route is kept.';navigationVoice.pause();invalidate();return undefined;}
    clearRerouteRetry();
    rerouting=true;rerouteCleared=false;offRoute=false;navigationVoice.pause();originText=YOUR_LOCATION;message='Planning a new route from here…';
    const pending=ensure().reroute(from);invalidate();return pending;
  }
  /** Tries the failed reroute again while still navigating off the followed route with a precise fix. */
  function scheduleRerouteRetry(){
    clearRerouteRetry();if(!navigating||arrived)return;
    const delay=REROUTE_RETRY_MS[Math.min(rerouteAttempts++,REROUTE_RETRY_MS.length-1)];
    rerouteTimer=setTimeout(()=>{
      rerouteTimer=undefined;
      if(disposed||!navigating||rerouting||arrived||!navRoute)return;
      const fix=navFix&&usableNavigationFix(navFix)?navFix:undefined;
      if(fix&&distanceToRoute(fix.coordinate,navRoute.geometry)<=Math.max(75,fix.accuracyMeters*2)){rerouteAttempts=0;if(message===REROUTE_KEPT)message='';invalidate();return;}
      if(fix)void rerouteFrom(fix.coordinate);else scheduleRerouteRetry();
    },delay);
  }
  const distance=(a:Coordinate,b:Coordinate)=>{const r=Math.PI/180,dlat=(a.latitude-b.latitude)*r,dlon=(a.longitude-b.longitude)*r;return 6371000*2*Math.asin(Math.min(1,Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin(dlon/2)**2)));};
  /** The screen's End. */
  function endGuidance(){void stopGuidance().catch(error=>{message=failure(error).message;invalidate();});invalidate();}
  /** One location update during guidance, measured against the route being followed. */
  function onNavFix(fix:Position){
    if(!navigating)return;
    const current=navRoute;
    if(!usableNavigationFix(fix)){navFix=undefined;navigationVoice.pause();message='Finding your location…';invalidate();return;}
    if(rerouting||!current){navFix=fix;invalidate();return;}
    navFix=fix;navDistance=distance(fix.coordinate,current.to);arrived=navDistance<25&&fix.accuracyMeters<=30;
    if(arrived){navigationVoice.pause();clearRerouteRetry();message='Destination reached.';offRoute=false;void navigationLocation.stop();void background.stop();backgroundRunning=false;}
    else{
      const nearest=distanceToRoute(fix.coordinate,current.geometry);offRoute=nearest>Math.max(75,fix.accuracyMeters*2);
      // As before, a maneuver is passed once a fix comes within 40 m of it.
      while(navStep<current.steps.length-1&&distance(fix.coordinate,current.steps[navStep].coordinate)<40)navStep++;
      const reading=atStep(routeProgress(fix.coordinate,current),current.steps,navStep),view=guidanceView(reading,undefined,current.traffic),next=reading.next;
      // A retry after a failed reroute keeps its notice until the next attempt.
      message=offRoute?(rerouteTimer!==undefined?REROUTE_KEPT:OFF_ROUTE):'';
      if(offRoute){navigationVoice.pause();background.update('Off route','Open Maps to reroute from here or stop.');}
      else{if(next)navigationVoice.update(current.id+':'+next.index,view.spoken);background.update(view.notificationTitle,view.notificationText);}
    }
    invalidate();
  }
  /** The screen's Start for the route it shows (also the agent's, when allowed). False without a ready route. */
  function startGuidance():boolean{
    const route=state?.route.phase==='ready'?state.route.value:null,target=selected;
    if(navigating||!directions||!route||!target)return false;
    navigationVoice.pause();arrived=false;navigating=true;follow=true;navStep=0;offRoute=false;rerouting=false;navFix=undefined;navRoute=route;navRouteId=route.id;backgroundRunning=false;clearRerouteRetry();rerouteAttempts=0;
    const session=++navSession;message='Finding your location…';
    // Screen-off continuation only where the native session is available; the
    // notification's Stop ends this exact session once.
    void background.start(`Route to ${target.label}`,'Waiting for location',reason=>{if(session!==navSession||!navigating)return;lifecycle.backgroundStops++;
      // Only the notification's Stop is the user ending navigation. A refused or system-ended
      // service drops back to foreground-only guidance, which a hidden page then releases.
      if(reason==='notification'){message='Navigation stopped from the notification.';endGuidance();return;}
      backgroundRunning=false;message='Keep the screen on for guidance.';if(document.hidden)release();else invalidate();}).then(running=>{if(session!==navSession||!navigating){if(running)void background.stop();return;}backgroundRunning=running;invalidate();});
    void navigationLocation.start(false,onNavFix,error=>{if(session!==navSession)return;message=failure(error).message;void stopGuidance().catch(()=>{});invalidate();});invalidate();
    return true;
  }
  let pinTap: (id: string) => void = () => {};
  /** A chosen origin (saved or regional place) replaces the typed text and replans. */
  function chooseOrigin(candidate: Place | SavedPlace) {
    originMode=false;locating=false;originText='label' in candidate?candidate.label:candidate.name;message='';
    chosenOrigin={coordinate:candidate.coordinate,label:originText};
    void ensure().chooseOrigin(candidate);invalidate();
  }
  /** Opens a provider website only on an explicit tap, in the system browser surface. */
  function openWebsite(raw: string) {
    let url: URL;
    try { url = new URL(raw); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(); }
    catch { api?.toast('This website address is not valid.'); return; }
    if (Capacitor.isNativePlatform()) void DailyApps.perform({ action: 'browser', url: url.href }).then(result => { if (result.status !== 'opened') api?.toast(result.message || 'The browser could not open.'); }, () => api?.toast('The browser could not open.'));
    else window.open(url.href, '_blank', 'noopener,noreferrer');
  }
  function submit() {
    discardHandoff();
    const intent=++searchIntent;
    // A search the owner typed replaces a pending "Add location": a late fix must not take its place.
    locating = false;
    selected = undefined; searching = true; message = '';
    const match = query.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/);
    if (match) {
      try { const point = coordinate({ latitude: Number(match[1]), longitude: Number(match[2]) }); selected = { label: 'Dropped pin', coordinate: point, origin: 'manual' }; searching = false; }
      catch (error) { message = failure(error).message; }
      invalidate(); return;
    }
    // A new explicit search also retries a failed configured connection. Never
    // poll in the background or replay the search after the user leaves/edits.
    const requestedQuery=query;
    void (async()=>{
      ensure();
      // A connection already in flight (for example after an account change) is awaited first.
      const connecting=!initialization&&!regionalMapsConfigured?cloudMapsConnecting():undefined;
      if(connecting)initialization=connecting.finally(()=>{initialization=undefined;invalidate();});
      if(!initialization&&!signedOut()&&mapsDiagnostics().configured&&mapsDiagnostics().error){
        message='Connecting Maps…';invalidate();
        initialization=initializeMaps().finally(()=>{initialization=undefined;invalidate();});
      }
      await initialization;
      if(disposed||intent!==searchIntent||!api?.isActive()||query!==requestedQuery)return;
      message='';void ensure().search(requestedQuery);
    })();
  }
  function locate() { if(disposed||locating||document.hidden||!api?.isActive())return;discardHandoff();message = ''; locating = true; chosenOrigin = undefined; if(!directions)selected = undefined; searching = false; void ensure().locate(); invalidate(); }
  function save() {
    if (!selected) return;
    try {
      const existing = state?.saved.value.find(item => item.id === selected?.savedId || (!!selected?.providerId && item.providerId === selected.providerId && item.providerPlaceId === selected.providerPlaceId));
      if (existing) { ensure().removeSaved(existing.id); selected.savedId = undefined; message = 'Removed from saved.'; }
      else { const saved = ensure().save({ label: selected.label, coordinate: selected.coordinate, providerId: selected.providerId, providerPlaceId: selected.providerPlaceId }); selected.savedId = saved.id; message = 'Saved.'; }
    } catch (error) { message = failure(error).message; }
    invalidate();
  }
  const back = () => { discardHandoff();++searchIntent;if(originMode){originMode=false;ensure().cancelOriginSearch();message='';invalidate();return true;} if(directions||navigating){directions=false;void stopGuidance().catch(()=>{});message='';invalidate();return true;} if (selected) { selected = undefined; message = ''; invalidate(); return true; } if (searching || query) {
      // The search an event's location opened is the cross-app hand-off, not a Maps layer the user
      // made: system Back clears it and lets the shell return to that event (J04-7), never re-searching.
      const handoff=!!eventQuery&&query===eventQuery&&!!mapsEventReturnOffered(api?.get('maps').fromEvent,api?.S.stack,navigating);
      searching = false; query = ''; message = ''; if(handoff)eventQuery=''; void ensure().search(''); invalidate(); return !handoff;
    } return false; };
  module.back = back; module.onLeave = () => release(); module.ongoing = () => null;
  module.reply = () => null;
  module.suggestions = () => mapsConnected() ? ['Help me with this place', 'Directions home'] : ['Find coffee near me', 'Directions home'];
  module.render = (st: Bag, currentApi: Bag) => {
    api = currentApi; ensure();
    // Cross-app navigation carries a one-use search, not a selected destination.
    // Consume it outside render and fence it against leaving or a newer action.
    if(typeof st.query==='string'&&st.query.trim()&&!pendingHandoff){
      const handoff=pendingHandoff={query:st.query,intent:searchIntent};
      queueMicrotask(()=>{
        if(pendingHandoff!==handoff)return;pendingHandoff=undefined;
        if(disposed||!currentApi.isActive()||currentApi.get('maps').query!==handoff.query||handoff.intent!==searchIntent)return;
        const fromEvent=!!currentApi.get('maps').fromEvent;
        currentApi.set({query:null});release();query=handoff.query.trim();eventQuery=fromEvent?query:'';submit();invalidate();
      });
    }
    // Calling the original with neutral state retains visual tokens without
    // generating sample place cards, address guesses, routes or timers.
    const data = original.render({ ...st, query: null, place: null, directions: null, nav: false, saved: [], pan: null }, currentApi);
    const snapshot = state!, saved = snapshot.saved.value;
    const choosingOrigin = originMode && directions && !navigating && !!selected;
    // While navigating, a failed reroute's error is not the route being followed; its notice is the message.
    const routeError = navigating ? null : snapshot.route.error;
    const error = snapshot.saved.error || snapshot.position.error || (choosingOrigin ? snapshot.originSearch.error : snapshot.search.error) || routeError;
    const pending = locating || (choosingOrigin ? snapshot.originSearch.phase === 'loading' : snapshot.search.phase === 'loading');
    const unconfigured = snapshot.provider.status === 'unconfigured';
    const region=regionalMap(),cloud=region?undefined:cloudMapsCoverage(),diagnostic=mapsDiagnostics(),basemap=region||globalBasemap,globalMap=!region;
    const point=selected?.coordinate,coverageName=region?.region||cloud?.regions.map(item=>item.name).join(', ')||'';
    const outsideCoverage=!!point&&(region?(point.longitude<region.bounds[0]||point.latitude<region.bounds[1]||point.longitude>region.bounds[2]||point.latitude>region.bounds[3]):!!cloud&&!insideCloudCoverage(cloud,point));
    const locationState=locating?'loading':snapshot.position.phase==='ready'||!!selected?'ready':snapshot.position.error?.code==='permission-denied'?'denied':snapshot.position.phase==='error'?'unavailable':'not-set';
    const mapState=mapFailed?'error':region&&outsideCoverage?'outside-coverage':planeElement?.dataset.mapReady==='true'?'ready':'loading';
    const mapStatus=mapFailed?'The map couldn’t load.':outsideCoverage?'Maps doesn’t cover this area yet.':mapState==='loading'?'Loading map…':globalMap?(locationState==='ready'?'Location added':'Add a location'):region?.region||'Maps';
    // There is no Maps provider for the owner to choose: an unconfigured provider shows why Cloud Maps is not connected.
    const providerText=(text:string)=>/Maps provider/.test(text)?providerFailureText():text;
    const status=shownFailure(providerText((choosingOrigin && !snapshot.originSearch.error && snapshot.originSearch.phase !== 'loading' ? message : '')||routeError?.message||message||error?.message||(pending?'Finding location…':mapStatus)));
    const isPlace = !!selected && !directions && !navigating;
    const isResults = (searching && !isPlace && !directions && !navigating) || choosingOrigin;
    const isDir = directions && !navigating && !choosingOrigin;
    // Result pins come from the list being shown; the position marker from an explicit
    // Recenter or the active navigation watch. Nothing is drawn from prototype data.
    const pinned: readonly Place[] = choosingOrigin ? snapshot.originSearch.value : isResults ? snapshot.search.value : [];
    const fix = navigating ? navFix : snapshot.position.phase === 'ready' ? snapshot.position.value || undefined : undefined;
    const overlay = { pins: pinned.map(item => ({ id: item.id, label: item.name, coordinate: item.coordinate })), position: fix ? { coordinate: fix.coordinate, accuracyMeters: fix.accuracyMeters, headingDegrees: fix.headingDegrees } : null, follow: navigating && follow && !!navFix };
    const onPin = (id: string) => { const item = pinned.find(value => value.id === id); if (!item) return; if (choosingOrigin) chooseOrigin(item); else showPlace(item); };
    const savedOrigins = choosingOrigin ? controller!.savedMatches(originText) : [];
    Object.assign(data, {
      rootRef:(element:HTMLElement)=>{if(element)element.dataset.mapDiagnostics=JSON.stringify({...mapsDiagnostics(),agentNavigation:{offered:agentNavigation.registered(),relay:residentMapsNavigationPort.relay},lifecycle:{...lifecycle,locating,permissionPending:controller?.awaitingLocationPermission()||navigationLocation.awaitingPermission(),position:state?.position.phase}});},
      notNative:false, hasNativeMap:true,globalBasemap:globalMap,regionalBasemap:!globalMap,mapLabel:globalMap?'World map':'Regional map',mapAttribution:globalMap?globalBasemap.attribution:mapsAttribution(),attributionBottom:directions?310:isPlace?410:130,
      mapRef:(element:HTMLElement)=>{if(element&&basemap){if((element!==planeElement||planeBasemap!==basemap)&&!mapFailed){mapObserver?.disconnect();plane?.destroy();planeElement=element;planeBasemap=basemap;const generation=++mapGeneration;delete element.dataset.mapReady;delete element.dataset.mapError;try{plane=new MapPlane(element,basemap,()=>{if(generation!==mapGeneration||planeElement!==element||disposed||!api?.isActive())return;mapFailed=true;invalidate(false);},data.C,id=>pinTap(id));mapObserver=new MutationObserver(()=>{if(generation===mapGeneration&&planeElement===element&&!disposed&&api?.isActive())invalidate(false);});mapObserver.observe(element,{attributes:true,attributeFilter:['data-map-ready']});}catch{mapFailed=true;element.replaceChildren();queueMicrotask(()=>{if(generation===mapGeneration&&planeElement===element&&!disposed&&api?.isActive())invalidate(false);});}}pinTap=onPin;plane?.update(region&&outsideCoverage?undefined:selected?.coordinate,navigating&&navRoute?navRoute:snapshot.route.value,overlay);}},
      // Guidance shows no status line of its own; only a notice (off route, a kept route, an error) appears.
      native: true, nativeStatusVisible:navigating?!!status&&status!==mapStatus:!isPlace||!!(mapFailed||outsideCoverage||routeError||error||message), nativeStatus: status, nativeStatusTop: directions?232:isPlace ? 128 : searching ? 130 : 174,
      nativeSavedEmpty: !saved.length, nativeLocationBusy: locating, nativeLocation: locate,
      nativeLocationState:locationState,nativeMapState:mapState,nativeMapStatus:status===mapStatus?'':mapStatus,
      nativeLocationLabel:locating?'Finding location…':locationState==='ready'?'Use current location':'Add location',
      nativeLocationDenied:locationState==='denied',nativeStatusControls:!searching&&!directions&&!navigating,
      // Shown only when location is off; Location settings follows it.
      nativeLocationHelp:locationState==='denied'?'Location is off.':'',
      nativeLocationSettings:()=>{if(disposed||document.hidden||!currentApi.isActive())return;void device.openSettings({page:'privacy'}).catch(()=>{if(!disposed&&currentApi.isActive()){message=isAndroid?'Location settings couldn’t open.':'Allow location in your browser’s site settings.';invalidate();}});},
      nativeMapRetry:mapFailed,
      retryNativeMap:()=>{if(disposed||document.hidden||!currentApi.isActive())return;++mapGeneration;mapObserver?.disconnect();mapObserver=undefined;plane?.destroy();plane=undefined;planeElement=undefined;planeBasemap=undefined;mapFailed=false;message='';if(diagnostic.error&&!initialization&&!signedOut())initialization=initializeMaps().finally(()=>{initialization=undefined;invalidate();});invalidate();},
      mode:navigating?'nav':choosingOrigin?'origin':directions?'dir':isPlace?'place':searching?'results':'base', isBase:!isPlace&&!searching&&!directions&&!navigating,isResults,isPlace,isDir,isNav:navigating,
      showSearch:!directions&&!navigating, showRec:!navigating, grid: '', major: '', fwy: '', water: '', parks: '', rwy: '', routeD: '', doneD: '', hasRoute: false, pins: [], labels: [], meCss: 'display:none;',
      mapDown: () => {}, mapUp: () => {}, q: query, hasQ: !!query, searchLabel: isPlace || searching ? 'Back' : 'Search',
      searchLead: () => { if (!back()) { searching = true; invalidate(); } },
      onQ: (event: Event) => { discardHandoff();++searchIntent;query = (event.target as HTMLInputElement).value; selected = undefined; searching = true; message = ''; void ensure().search(''); invalidate(); },
      focusQ: () => { if (!searching) { selected = undefined; searching = true; invalidate(); } },
      qKey: (event: KeyboardEvent) => { if (event.key === 'Enter') { event.preventDefault(); submit(); (event.target as HTMLInputElement).blur(); } },
      clearQ: () => { ++searchIntent;query = ''; selected = undefined; searching = true; message = ''; void ensure().search(''); invalidate(); },
      chips: saved.map(item => ({ label: item.label, d: PIN, go: () => showSaved(item) })),
      cats: data.cats.map((category: Bag) => ({ ...category, go: () => { query = category.label; submit(); } })),
      savedRows: saved.map(item => ({ name: item.label, sub: coordLabel(item.coordinate), d: PIN, go: () => showSaved(item) })),
      results: choosingOrigin
        ? [...savedOrigins.map(item => ({ name: item.label, sub: 'Saved place', d: PIN, go: () => chooseOrigin(item) })),
           ...snapshot.originSearch.value.map(item => ({ name: item.name, sub: item.address || coordLabel(item.coordinate), d: PIN, go: () => chooseOrigin(item) }))]
        : snapshot.search.value.map(item => ({ name: item.name, sub: item.address || coordLabel(item.coordinate), d: PIN, go: () => showPlace(item) })),
      hasResults: choosingOrigin ? savedOrigins.length + snapshot.originSearch.value.length > 0 : snapshot.search.value.length > 0,
      noResults: choosingOrigin ? snapshot.originSearch.phase === 'empty' && !savedOrigins.length : snapshot.search.phase === 'empty', emptyQ: !choosingOrigin && !query.trim(),
      recenter: () => { if (navigating) { follow = true; invalidate(); } else locate(); }, recBottom: isPlace ? 414 : searching ? 534 : 124, recCss: '',
      sheetH: directions ? 300 : isPlace ? 400 : 520, sheetSw: { down: () => {}, up: () => {} }, sheetTap: () => {},
      askAlpha: () => currentApi.send(query || 'Help me with Maps.'), noResTxt: `Ask ${currentApi.name} about this search`,
    });
    if (selected) {
      const item = selected;
      const existing = saved.find(value => value.id === item.savedId || (!!item.providerId && value.providerId === item.providerId && value.providerPlaceId === item.providerPlaceId));
      // Provider detail for this exact place: opening hours, phone and website when the
      // source has them. Phone is shown as text; calling stays deferred with Phone.
      const detail = snapshot.selection.phase === 'ready' && item.providerPlaceId && snapshot.selection.value?.id === item.providerPlaceId && snapshot.selection.value.providerId === item.providerId ? snapshot.selection.value : undefined;
      const website = detail?.website;
      data.pc = {
        name: item.label, meta: [item.origin === 'saved' ? 'Saved' : item.origin === 'location' ? YOUR_LOCATION : item.origin === 'manual' ? 'Dropped pin' : '', detail?.phone ? 'Phone ' + detail.phone : ''].filter(Boolean).join(' · '), addr: detail?.address || coordLabel(item.coordinate),
        hasHours: !!detail?.openingHours, openTxt: 'Hours', openCss: '', hoursTxt: detail?.openingHours || '',
        hasPhone: false, hasWeb: !!website, web: () => { if (website) openWebsite(website); },
        canDir: ensure().capabilities().modes.length>0, min: 'Directions', saved: !!existing,
        saveLabel: existing ? 'Remove from saved' : 'Save', starCss: existing ? 'color:var(--acct)' : '', starFill: existing ? 'fill:currentColor' : '',
        close: () => { selected = undefined; message = ''; invalidate(); }, save,
        // Directions start from the device's location, asked for the first time it is needed.
        dirs: () => { if(unconfigured){message=providerFailureText();}else{directions=true; message=''; if(item.origin!=='provider'&&snapshot.provider.status==='configured')void ensure().select({providerId:snapshot.provider.providerId,id:item.providerPlaceId||'manual',name:item.label,coordinate:item.coordinate,attribution:'User-selected coordinates',fetchedAt:Date.now()},false); locate();} invalidate(); },
        share: () => share(placeShare(item.label,item.coordinate),()=>!disposed&&!!api?.isActive()&&selected===item),
        nativeName: item.label, nativeEditing: !!item.editingName,
        nativeTitleRole: 'button', nativeTitleTabIndex: 0, nativeTitleLabel: 'Rename place',
        nativeEdit: () => { item.editingName = true; invalidate(); },
        nativeEditKey: (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); item.editingName = true; invalidate(); } },
        nativeRename: (event: Event) => { item.label = (event.target as HTMLInputElement).value.slice(0, 300); invalidate(); },
        nativeApplyName: () => { try { if (existing) ensure().renameSaved(existing.id, item.label); else if (!item.label.trim()) throw new Error(); item.editingName = false; message = existing ? 'Saved place renamed.' : 'Name updated. Tap Save to keep this place.'; } catch { message = 'The place name could not be saved.'; } invalidate(); },
      };
    }
    if(directions&&selected){
      const route=navigating&&navRoute?navRoute:snapshot.route.value;
      // A place or saved place is searched; the device's location replans as is. Typed
      // coordinates still plan directly (development and test flows), though nothing asks for them.
      const plan=()=>{
        const text=originText.trim(),match=text.match(/^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/);
        // An explicit starting point ends a pending "Your location" request.
        locating=false;
        if(text===YOUR_LOCATION&&snapshot.origin){message='';originMode=false;void ensure().planRoute();invalidate();return;}
        if(match){try{const point=coordinate({latitude:Number(match[1]),longitude:Number(match[2])});ensure().setOrigin(point);chosenOrigin={coordinate:point};message='';originMode=false;void ensure().planRoute();}catch{message='That location isn’t valid. Enter a starting point.';}invalidate();return;}
        if(!text){message='Enter a starting point.';invalidate();return;}
        if(snapshot.provider.status!=='configured'&&!ensure().savedMatches(text).length){message='Choose a saved place or use your location.';invalidate();return;}
        originMode=true;message='';
        if(snapshot.provider.status==='configured')void ensure().searchOrigin(text);
        invalidate();
      };
      const editOrigin=(value:string)=>{originText=value;locating=false;chosenOrigin=undefined;ensure().clearOrigin();message='';invalidate();};
      data.originText=originText;data.onOrigin=(event:Event)=>{originMode=false;editOrigin((event.target as HTMLInputElement).value);};data.originKey=(event:KeyboardEvent)=>{if(event.key==='Enter'){event.preventDefault();plan();}};data.originLocation=locate;
      if(choosingOrigin){
        // While choosing an origin the search bar edits the origin text; editing cancels
        // the pending origin search and Back returns to the route sheet.
        Object.assign(data,{showSearch:true,q:originText,hasQ:!!originText,searchLabel:'Back',searchLead:()=>{back();},
          onQ:(event:Event)=>editOrigin((event.target as HTMLInputElement).value),focusQ:()=>{},
          qKey:(event:KeyboardEvent)=>{if(event.key==='Enter'){event.preventDefault();plan();(event.target as HTMLInputElement).blur();}},
          clearQ:()=>editOrigin('')});
      }
      const end=endGuidance;
      const progress=navigating&&navFix&&route&&!arrived&&!rerouting?atStep(routeProgress(navFix.coordinate,route),route.steps,navStep):undefined;
      const view=progress&&route?guidanceView(progress,undefined,route.traffic):undefined;
      const reroute=()=>{const from=navFix?.coordinate;if(from)void rerouteFrom(from);};
      data.dr={name:selected.label,close:()=>back(),min:route?Math.max(1,Math.round(route.durationSeconds/60))+' min':snapshot.route.phase==='loading'?'Planning…':'No route',meta:route?(route.distanceMeters/1000).toFixed(1)+' km'+(route.traffic==='live'?' · live traffic':''):'',via:route?(snapshot.originLabel?'From '+snapshot.originLabel+' · ':'')+(route.steps[0]?.instruction||''):'Choose a starting point',shareLabel:'Share route',shareEta:()=>{if(route&&snapshot.route.phase==='ready'){const target=selected;share(routeShare(target!.label,route),()=>!disposed&&!!api?.isActive()&&selected===target&&!!directions&&(navigating?navRoute===route:state?.route.phase==='ready'&&state.route.value===route));}},
       modes:data.nativeModeMetadata.map((reference:{mode:'drive'|'walk'|'bike'|'transit';label:string;d:string})=>{const mode=reference.mode==='bike'?'bicycle':reference.mode;const {label,d}=reference;return {label,t:label,d,on:snapshot.mode===mode,css:snapshot.mode===mode?'background:var(--acc);color:#fff':'background:var(--s2);color:var(--fg)',go:()=>{if(!ensure().capabilities().modes.includes(mode)){message=mode==='transit'?'Transit schedules are not available for this region.':`${label} directions aren’t available here.`;invalidate();return;}ensure().setMode(mode);message='';if(snapshot.origin)void ensure().planRoute();}};}),
       // Start is offered only with a ready route (canStart); without one it does nothing, and
       // startDisabled is its real disabled state for TalkBack and the keyboard.
       canStart:!!route&&!navigating,startDisabled:!route||navigating,start:()=>{startGuidance();},
       nav:{going:!arrived,arrived,dist:arrived?'Arrived':view?view.distance:rerouting?'Rerouting…':'Locating…',street:arrived?selected.label:view?view.instruction:rerouting?'Planning a new route from here':'Waiting for location',icon:view?.icon||PIN,hasThen:!!view?.hasThen,thenD:view?.thenIcon||'',thenText:view?.thenText||'',
        left:arrived?'Arrived':view?view.remainingTime:'Guidance',meta:arrived?'Destination reached':view?view.remaining:'',remaining:view?.remaining||'',
        offRoute,canReroute:offRoute&&usableNavigationFix(navFix)&&!rerouting,reroute,rerouteLabel:'Reroute from here',background:backgroundRunning,
        end,ask:()=>currentApi.send('Help me with this route.'),voiceLabel:navigationVoice.enabled?'Mute voice guidance':'Enable voice guidance',voice:()=>{navigationVoice.toggle();invalidate();},voiceD:PIN}};
    }
    const eventOrigin=mapsEventReturnOffered(st.fromEvent,currentApi.S.stack,navigating);
    data.eventReturnFloating=!!eventOrigin&&!!data.showSearch;data.eventReturnInline=!!eventOrigin&&!!data.isDir;
    data.backToEvent=eventOrigin?()=>void returnToEvent(currentApi,eventOrigin,st.fromEvent):undefined;
    data.backToEventTitle=eventOrigin?.title||'';
    // Offered only while the search still holds the event's text; editing or Back retires it.
    const handoffText=isAndroid&&unconfiguredNow()&&!!eventQuery&&query===eventQuery&&!navigating?eventQuery:'';
    if(handoffText)readMapsApp();
    data.nativeMapsHandoff=!!handoffText&&mapsApp===true;
    data.openInMapsApp=()=>{if(handoffText&&query===handoffText)openInMapsApp(handoffText);};
    return data;
  };
  function unconfiguredNow(){return state?.provider.status==='unconfigured';}
  // The shell instance opens Maps for an agent request, exactly as a user's open would.
  let shell: Bag | undefined;
  const renderVals=Component.prototype.renderVals;
  // Later adapters wrap renderVals too, so disposal leaves this wrapper in place as a pass-through.
  Component.prototype.renderVals=function(this: Bag,...args: unknown[]){if(!disposed)shell=this;return renderVals.apply(this,args);};
  /** Selects the agent's destination; the provider's own place name replaces the agent's once read. */
  async function showAgentPlace(place:Place,resolveDetails:boolean){
    const item:Selection={label:place.name,coordinate:place.coordinate,providerId:place.providerId,...(resolveDetails?{providerPlaceId:place.id}:{}),origin:resolveDetails?'provider':'manual'};
    selected=item;const pending=ensure().select(place,resolveDetails);invalidate();await pending;
    const detail=state?.selection.phase==='ready'?state.selection.value:null;
    if(selected===item&&detail&&detail.id===place.id&&detail.providerId===place.providerId){item.label=detail.name;item.coordinate=detail.coordinate;invalidate();}
  }
  /** The agent's requests use this screen's own state: selection, route sheet, Start, Reroute and End. */
  const surface: MapsNavigationSurface = {
    // Maps opens on an unlocked, visible, non-sensitive launcher screen: over Home or itself, or
    // over another app while the owner is talking to the agent there. Never over a call or a
    // recording; the agent then hears that the phone cannot show Maps now.
    async present(){
      const showable=()=>{
        const value=shell?.S?.();
        if(disposed||document.hidden||!shell?.live||!value||value.screen!=='home'||value.secure||value.shade||shell.pageSuspended||
          shell.props?.assistantSurface||connectionController.getSnapshot().open)return false;
        if(!value.view||value.view==='home'||value.view==='maps')return true;
        if(value.chat!=='full'&&value.chat!=='sheet')return false;
        return !shell.mod?.(value.view)?.ongoing?.(shell.vget(value.view),shell.api(value.view));
      };
      if(!showable())return false;
      const value=shell!.S();
      if(!api?.isActive()){
        // Back returns to the app the request was made in; a conversation sheet stays in view.
        shell!.openView('maps',null,value.chat==='sheet'?'sheet':null,{push:!!value.view&&value.view!=='home'});
        await Promise.race([new Promise<void>(resolve=>shell!.setState({},()=>resolve())),new Promise<void>(resolve=>setTimeout(resolve,2000))]);
      } else if(value.chat==='full'){
        // The full conversation covers Maps; it folds away so the result is visible.
        await Promise.race([new Promise<void>(resolve=>shell!.setState({chat:shell!.rest()},()=>resolve())),new Promise<void>(resolve=>setTimeout(resolve,2000))]);
      }
      return showable()&&shell!.S().view==='maps'&&!!api?.isActive()&&!!controller&&!!state;
    },
    snapshot:()=>state,
    showPlace(place,resolveDetails){
      discardHandoff();++searchIntent;directions=false;originMode=false;searching=false;locating=false;message='';
      return showAgentPlace(place,resolveDetails);
    },
    showDirections(place,travelMode:TravelMode,resolveDetails){
      discardHandoff();++searchIntent;originMode=false;searching=false;locating=false;originText='';chosenOrigin=undefined;
      const maps=ensure();maps.clearOrigin();maps.setMode(travelMode);directions=true;
      // Maps opens at the route sheet; without a location the sheet asks for a starting point.
      message='';
      return showAgentPlace(place,resolveDetails);
    },
    async showResults(text){
      // The agent's search, run as the screen's own search for the same words.
      directions=false;originMode=false;locating=false;selected=undefined;message='';query=text;submit();
    },
    startGuidance,
    locationGranted:locationPermissionGranted,
    async locate(signal){
      // Checked again right before the watch starts: an agent request never shows a permission prompt.
      if(!(await locationPermissionGranted()))throw new MapsFailure('permission-denied','Location is not granted.');
      return new Promise<Position>((resolve,reject)=>{
        const finish=()=>{signal.removeEventListener('abort',abort);void agentLocation.stop().catch(()=>{});};
        const abort=()=>{finish();reject(new MapsFailure('cancelled','Location request cancelled.'));};
        if(signal.aborted){abort();return;}
        signal.addEventListener('abort',abort,{once:true});
        agentLocation.start(true,fix=>{finish();resolve(fix);},error=>{finish();reject(error);}).catch(error=>{finish();reject(error);});
      });
    },
    planFrom(origin){
      const maps=ensure();originMode=false;locating=false;chosenOrigin=undefined;originText=YOUR_LOCATION;maps.setOrigin(origin);message='';
      const pending=maps.planRoute();invalidate();return pending;
    },
    // The session lasts from Start to End, including while rerouting and after arrival.
    guidance(){
      return navigating&&selected&&state?{routeId:navRouteId,placeName:selected.label,travelMode:state.mode,rerouting,arrived,...(navFix?{fix:navFix}:{})}:null;
    },
    reroute(from){return rerouteFrom(from)??Promise.reject(new MapsFailure('unavailable','The phone is already planning a new route.'));},
    stop(){const active=navigating,pending=stopGuidance();if(active&&api?.isActive())message='Navigation stopped.';invalidate();return pending;},
    onRelease(listener){releaseListeners.add(listener);return()=>{releaseListeners.delete(listener);};},
  };
  // Offered to the agent only while Eliza Cloud Maps is installed for the signed-in account.
  const agentNavigation=bindAgentNavigation({
    // Eliza Cloud Maps in the launcher renderer only; never the regional gateway or the assistant window.
    enabled:()=>!regionalMapsConfigured&&!shell?.props?.assistantSurface&&!document.documentElement.classList.contains('alpha-assistant-surface'),
    installation:()=>{const coverage=cloudMapsCoverage();return coverage&&{providerId:coverage.providerId,attribution:coverage.attribution};},
    connection:mapsConnection,onChange:onMapsConnectionChange,surface,port:residentMapsNavigationPort,
    // "Ask before agent actions" off: an agent's route starts guidance. A failed read asks.
    directStart:async()=>{try{return !(await readDevicePreferences()).askBeforeAgentActions;}catch{return false;}},
  });
  const changed = onMapsConnectionChange(() => {
    const connection=mapsConnection();
    if(controller&&state?.provider.status==='unconfigured'&&connection.config.status==='configured'&&mapsConnected()){lifecycle.providerActivations++;controller.activateProvider(connection.config,connection.provider);}
    else release(false);
    invalidate();
  });
  // Screen-off navigation keeps its voice; everything else retires shared and spoken output.
  const continuing=()=>navigating&&background.active();
  const retireShare=()=>{sharing?.abort.abort();sharing=undefined;if(!continuing())navigationVoice.pause();};
  const shareEvents=['launcher-home','alpha:device-state','alpha:dev-incoming-call'];for(const event of shareEvents)window.addEventListener(event,retireShare);
  const visibility = () => { if(document.hidden){retireShare();lifecycle.hidden++;if(continuing()){lifecycle.backgroundNavigation++;invalidate();return;}if(controller?.awaitingLocationPermission()||navigationLocation.awaitingPermission()){lifecycle.permissionHeld++;invalidate();return;}release();}else invalidate(); };
  const pagehide=()=>release();window.addEventListener('pagehide', pagehide); document.addEventListener('visibilitychange', visibility);
  return () => { disposed = true; agentNavigation.dispose(); shell=undefined; for(const event of shareEvents)window.removeEventListener(event,retireShare); changed(); release(); window.removeEventListener('pagehide', pagehide); document.removeEventListener('visibilitychange', visibility); Object.assign(module, original); };
}
