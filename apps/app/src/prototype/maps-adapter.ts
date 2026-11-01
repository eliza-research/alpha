import {BackgroundNavigation,type NavigationBridge} from '../maps/background-navigation';
import {registerPlugin} from '../platform-plugins';
import {DailyApps} from '../daily';
import {mapsEventReturnOffered,mapsEventStillThere,type MapsEventOrigin} from '../runtime/maps-event-return';
import {Capacitor} from '@capacitor/core';
import {isAndroid} from '../native';
import {NavigationVoice} from '../maps/navigation-voice';
import {shareMap} from '../maps/share';
import { MapPlane } from '../maps/map-plane';
import type {MapBasemap} from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/map-plane.ts';
import { globalBasemap } from '../maps/basemap';
import { initializeRegionalMaps, regionalMap, regionalDiagnostics, regionalMapsConfigured } from '../maps/regional-provider';
import { initializeCloudMaps, cloudMapsCoverage, cloudMapsDiagnostics } from '../maps/cloud-maps';
import { describeMapsDisclosure, insideCloudCoverage } from '../maps/cloud-provider';
import { NativeMapsLocation, locationPermissionGranted } from '../maps/native-location';
import { bindAgentNavigation, residentMapsNavigationPort } from '../maps/agent-navigation';
import { publishMapsSelection, clearMapsSelection } from '../maps/agent-context';
import { MapsController } from '../maps/state';
import { mapsConnection, onMapsConnectionChange } from '../maps/runtime';
import { MapsScreenController, type MapsScreenView } from '../maps/screen';
import { connectionController } from '../runtime/connection-ui';
import type { Coordinate, TravelMode } from '../maps/contracts';

type Bag = Record<string, any>;
const PIN = 'M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0zM15 10a3 3 0 1 1-6 0a3 3 0 1 1 6 0z';
const coordLabel = (point: Coordinate) => `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
const mapsConnected = () => mapsConnection().config.status === 'configured';

/**
 * Alpha's Maps screen: the shared plugin-maps screen controller rendered in the
 * prototype template. This file supplies Alpha's platform ports (native location,
 * local speech, the screen-off service, share sheet, Calendar return, the launcher
 * check for agent requests) and maps the controller's view onto template bindings.
 * Product builds use Eliza Cloud Maps; the regional gateway is a test-mocks prototype.
 */
export function installPrototypeMapsAdapter(Component: { prototype: Bag }, views: Record<string, Bag>): () => void {
  const device=registerPlugin<{openSettings(input:{page:string}):Promise<unknown>}>('AlphaDevice');
  const module = views.maps; if (!module) return () => {};
  const original = { render: module.render, back: module.back, onLeave: module.onLeave, reply: module.reply, suggestions: module.suggestions, ongoing: module.ongoing };
  let api: Bag | undefined, disposed=false, renders=0;
  let planeBasemap:MapBasemap|undefined, plane: MapPlane | undefined, planeElement: HTMLElement | undefined;
  let mapGeneration=0,mapFailed=false,mapObserver:MutationObserver|undefined;
  let pendingHandoff: {query:string}|undefined;
  const active=()=>!disposed&&!document.hidden&&!!api?.isActive();
  const dropPlane=()=>{++mapGeneration;mapObserver?.disconnect();mapObserver=undefined;mapFailed=false;plane?.destroy();plane=undefined;planeElement=undefined;planeBasemap=undefined;};
  const navigationVoice=new NavigationVoice(error=>screen.notify((error instanceof Error?error.message+' ':'')+'Voice guidance paused. Tap Enable voice guidance to retry.'));
  const background=new BackgroundNavigation(registerPlugin<NavigationBridge>('AlphaMapsTransport'),()=>Capacitor.isNativePlatform());
  const screen: MapsScreenController = new MapsScreenController({
    connection: mapsConnection,
    onConnectionChange: onMapsConnectionChange,
    initialize: () => regionalMapsConfigured ? initializeRegionalMaps() : initializeCloudMaps(),
    diagnostics: () => regionalMapsConfigured ? regionalDiagnostics() : cloudMapsDiagnostics(),
    coverage: () => {
      const region=regionalMap();
      if(region)return {name:region.region,mapRestricted:true,contains:point=>point.longitude>=region.bounds[0]&&point.latitude>=region.bounds[1]&&point.longitude<=region.bounds[2]&&point.latitude<=region.bounds[3]};
      const cloud=cloudMapsCoverage();
      return cloud&&{name:cloud.regions.map(item=>item.name).join(', '),mapRestricted:false,contains:point=>insideCloudCoverage(cloud,point)};
    },
    attribution: () => regionalMap()?.attribution || cloudMapsCoverage()?.attribution || '',
    createController: (config, provider) => new MapsController(config, provider),
    navigationLocation: new NativeMapsLocation(),
    agentLocation: new NativeMapsLocation(),
    locationGranted: locationPermissionGranted,
    voice: navigationVoice,
    background,
    share: shareMap,
    openWebsite: url => {
      if (Capacitor.isNativePlatform()) void DailyApps.perform({ action: 'browser', url: url.href }).then(result => { if (result.status !== 'opened') api?.toast(result.message || 'The browser could not open.'); }, () => api?.toast('The browser could not open.'));
      else window.open(url.href, '_blank', 'noopener,noreferrer');
    },
    active,
    invalidate: () => { if (active()) api?.set({ nativeMapsRevision: ++renders }); },
    toast: text => api?.toast(text),
    discardHandoff: () => { pendingHandoff=undefined; if(api?.get('maps').query!=null)api.set({query:null}); },
    handoffReturn: () => !!mapsEventReturnOffered(api?.get('maps').fromEvent,api?.S.stack,screen.isNavigating()),
    released: dropPlane,
    // With no Maps provider on Android, an event's location can be handed to an installed map
    // app, only when the user taps for it. The exact hand-off text is sent; no route is shown.
    ...(isAndroid ? { mapsApp: {
      available: () => DailyApps.capabilities().then(result => result.actions.some(row => row.action === 'maps' && row.available)),
      open: (text: string) => DailyApps.perform({ action: 'maps', query: text }).then(result => ({ opened: result.status === 'opened', message: result.message })),
    } } : {}),
    deniedLocationHelp: isAndroid ? 'Allow location in app settings, or enter coordinates.' : 'Allow location in browser site settings, or enter coordinates.',
    publishContext: publishMapsSelection,
    clearContext: clearMapsSelection,
  });
  // Explicit return to the event whose location opened Maps. It checks that exact event still exists,
  // restores Calendar on it and pops the cross-app stack. It never sets a Maps query.
  let returningToEvent=false;
  const calendarPlugin=registerPlugin<{list(input:{begin:number;end:number}):Promise<{status:string;events?:unknown[]}>}>('AlphaCalendar');
  async function returnToEvent(currentApi:Bag,origin:MapsEventOrigin,raw:unknown){
    if(returningToEvent)return;returningToEvent=true;
    try{
      // Only a ready read without the event withdraws the control; a refused or failed read keeps it.
      let outcome:'found'|'missing'|'permission'|'unknown'='unknown';
      try{if(origin.version===2){const abort=new AbortController(),cancel=()=>{if(document.hidden||!currentApi.isActive())abort.abort();};document.addEventListener('visibilitychange',cancel);window.addEventListener('pagehide',cancel);try{outcome=await currentApi.checkCanonicalCalendarReturn?.(origin,abort.signal)??'unknown';}finally{document.removeEventListener('visibilitychange',cancel);window.removeEventListener('pagehide',cancel);}}else{const result=await calendarPlugin.list({begin:origin.begin-1,end:origin.begin+1});outcome=result.status==='ready'?(mapsEventStillThere(origin,result.events)?'found':'missing'):result.status==='permission-required'?'permission':'unknown';}}catch{/* A thrown read says nothing about the event. */}
      if(disposed||document.hidden||!currentApi.isActive()||currentApi.get('maps').fromEvent!==raw||!mapsEventReturnOffered(raw,api?.S.stack,screen.isNavigating()))return;
      if(outcome==='permission'){currentApi.toast('Calendar access is needed to check this event. Allow calendar access, then try again.');return;}
      if(outcome==='unknown'){currentApi.toast('The event could not be checked. Maps stays open; try again.');return;}
      if(outcome==='missing'){currentApi.set({fromEvent:null});currentApi.toast('That event was deleted or moved. Maps stays open; nothing else changed.');return;}
      const stack=(api?.S.stack||[]).slice(0,-1);
      // Unwind this visit's Maps layers (route, place, results, search text) as system Back would, so
      // nothing of the hand-off is left to show or replay when Maps is opened again.
      screen.unwind();
      currentApi.setView('calendar',{...(origin.version===2?{calendarAuthority:'canonical'}:{}),open:origin.rowId,openDay:origin.day,day:origin.day,month:null,form:null});
      currentApi.open('calendar',{keepState:true});currentApi.shell({stack});
    }finally{returningToEvent=false;}
  }
  module.back = () => screen.back(); module.onLeave = () => screen.release(); module.ongoing = () => null;
  module.reply = () => null;
  module.suggestions = () => mapsConnected() ? ['Help me with this place', 'Explain Maps coverage'] : ['Help me choose a Maps provider', 'Explain location permissions'];
  module.render = (st: Bag, currentApi: Bag) => {
    api = currentApi;
    // Cross-app navigation carries a one-use search, not a selected destination.
    // Consume it outside render and fence it against leaving or a newer action.
    if(typeof st.query==='string'&&st.query.trim()&&!pendingHandoff){
      const handoff=pendingHandoff={query:st.query};
      queueMicrotask(()=>{
        if(pendingHandoff!==handoff)return;pendingHandoff=undefined;
        if(disposed||!currentApi.isActive()||currentApi.get('maps').query!==handoff.query)return;
        const fromEvent=!!currentApi.get('maps').fromEvent;
        currentApi.set({query:null});screen.handoff(handoff.query,fromEvent);
      });
    }
    const view = screen.view();
    // Calling the original with neutral state retains visual tokens without
    // generating sample place cards, address guesses, routes or timers.
    const data = original.render({ ...st, query: null, place: null, directions: null, nav: false, saved: [], pan: null }, currentApi);
    bind(data, view, st, currentApi);
    return data;
  };
  function bind(data: Bag, view: MapsScreenView, st: Bag, currentApi: Bag) {
    const status = view.status, region = regionalMap(), basemap = region || globalBasemap, globalMap = !region;
    const directionsOpen = view.mode === 'directions' || view.mode === 'origin' || view.mode === 'navigation';
    const isPlace = view.mode === 'place', isResults = view.mode === 'results' || view.mode === 'origin', isNav = view.mode === 'navigation';
    Object.assign(data, {
      rootRef:(element:HTMLElement)=>{if(element)element.dataset.mapDiagnostics=JSON.stringify({...view.diagnostics,agentNavigation:{offered:agentNavigation.registered(),relay:residentMapsNavigationPort.relay}});},
      // Who receives search text and route points, from the connected Cloud provider.
      searchDisclosure:region?'':describeMapsDisclosure(cloudMapsCoverage()?.disclosure),
      notNative:false, hasNativeMap:true,globalBasemap:globalMap,regionalBasemap:!globalMap,mapLabel:globalMap?'World map':'Regional map',mapAttribution:globalMap?globalBasemap.attribution:(region?.attribution||''),attributionBottom:directionsOpen?310:isPlace?410:130,
      mapRef:(element:HTMLElement)=>{
        if(!element||!basemap)return;
        if((element!==planeElement||planeBasemap!==basemap)&&!mapFailed){
          mapObserver?.disconnect();plane?.destroy();planeElement=element;planeBasemap=basemap;const generation=++mapGeneration;delete element.dataset.mapReady;delete element.dataset.mapError;
          const current=()=>generation===mapGeneration&&planeElement===element&&!disposed&&!!api?.isActive();
          try{
            plane=new MapPlane(element,basemap,()=>{if(!current())return;mapFailed=true;screen.setMapState('error');},data.C,id=>screen.pin(id));
            mapObserver=new MutationObserver(()=>{if(current())screen.setMapState(element.dataset.mapReady==='true'?'ready':'loading');});
            mapObserver.observe(element,{attributes:true,attributeFilter:['data-map-ready']});
          }catch{mapFailed=true;element.replaceChildren();queueMicrotask(()=>{if(current())screen.setMapState('error');});}
        }
        plane?.update(view.map.selected,view.map.route,view.map.overlay);
      },
      native: true, nativeStatusVisible:status.visible, nativeStatus: status.text, nativeStatusTop: directionsOpen?232:isPlace ? 128 : view.mode==='results' ? 130 : 174,
      nativeSavedEmpty: !view.saved.length, nativeLocationBusy: status.locationBusy, nativeLocation: () => screen.locate(),
      nativeLocationState:status.location,nativeMapState:status.map,nativeMapStatus:status.mapText,
      nativeLocationLabel:status.locationLabel,nativeLocationDenied:status.locationDenied,nativeStatusControls:status.controls,
      nativeLocationHelp:status.locationHelp,
      nativeLocationSettings:()=>{if(!active())return;void device.openSettings({page:'privacy'}).catch(()=>{if(!disposed&&currentApi.isActive())screen.notify('Location settings could not be opened. Check device or browser permissions, or enter coordinates.');});},
      nativeManualLocation:()=>{if(!active())return;screen.manualLocation();queueMicrotask(()=>{if(active())document.querySelector<HTMLInputElement>('input[aria-label="Search places"]')?.focus();});},
      nativeMapRetry:status.mapRetry,
      retryNativeMap:()=>{if(!active())return;dropPlane();screen.retryMap();},
      mode:view.mode==='navigation'?'nav':view.mode==='directions'?'dir':view.mode, isBase:view.mode==='base',isResults,isPlace,isDir:view.mode==='directions',isNav,
      showSearch:view.showSearch, showRec:!isNav, grid: '', major: '', fwy: '', water: '', parks: '', rwy: '', routeD: '', doneD: '', hasRoute: false, pins: [], labels: [], meCss: 'display:none;',
      mapDown: () => {}, mapUp: () => {}, q: view.query, hasQ: !!view.query, searchLabel: view.searchLead === 'back' ? 'Back' : 'Search',
      searchLead: () => screen.searchLead(),
      onQ: (event: Event) => screen.setQuery((event.target as HTMLInputElement).value),
      focusQ: () => screen.focusQuery(),
      qKey: (event: KeyboardEvent) => { if (event.key === 'Enter') { event.preventDefault(); screen.submit(); (event.target as HTMLInputElement).blur(); } },
      clearQ: () => screen.clearQuery(),
      chips: view.saved.map(item => ({ label: item.label, d: PIN, go: () => screen.chooseSaved(item.id) })),
      cats: data.cats.map((category: Bag) => ({ ...category, go: () => screen.searchFor(category.label) })),
      savedRows: view.saved.map(item => ({ name: item.label, sub: coordLabel(item.coordinate), d: PIN, go: () => screen.chooseSaved(item.id) })),
      results: view.results.map(row => ({ name: row.name, sub: row.detail, d: PIN, go: () => screen.choose(row.key) })),
      hasResults: view.hasResults, noResults: view.noResults, emptyQ: view.emptyQuery,
      recenter: () => screen.recenter(), recBottom: isPlace ? 414 : view.mode === 'results' ? 534 : 124, recCss: '',
      sheetH: directionsOpen ? 300+(view.directions?.routes.length??0)*50 : isPlace ? 400 : 520, sheetSw: { down: () => {}, up: () => {} }, sheetTap: () => {},
      askAlpha: () => currentApi.send(view.query || 'Help me with Maps.'), noResTxt: `Ask ${currentApi.name} about this search`,
    });
    const place = view.place;
    if (place) {
      // Provider detail for this exact place: opening hours, phone and website when the
      // source has them. Phone is shown as text; calling stays deferred with Phone.
      data.pc = {
        name: place.name, meta: place.meta, addr: place.address,
        hasHours: !!place.hours, openTxt: 'Hours', openCss: '', hoursTxt: place.hours || '',
        hasPhone: false, hasWeb: !!place.website, web: () => screen.openWebsite(),
        canDir: place.canDirections, min: 'Directions', saved: place.saved,
        saveLabel: place.saved ? 'Remove from saved' : 'Save', starCss: place.saved ? 'color:var(--acct)' : '', starFill: place.saved ? 'fill:currentColor' : '',
        close: () => screen.closePlace(), save: () => screen.toggleSaved(),
        dirs: () => screen.openDirections(),
        share: () => screen.sharePlace(),
        nativeName: place.name, nativeEditing: place.editingName,
        nativeTitleRole: 'button', nativeTitleTabIndex: 0, nativeTitleLabel: 'Rename place',
        nativeEdit: () => screen.startRename(),
        nativeEditKey: (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); screen.startRename(); } },
        nativeRename: (event: Event) => screen.rename((event.target as HTMLInputElement).value),
        nativeApplyName: () => screen.applyName(),
      };
    }
    const directions = view.directions;
    if (directions) {
      // Coordinates plan directly; any other text searches places and saved places.
      data.originText=directions.originText;
      data.onOrigin=(event:Event)=>screen.setOriginText((event.target as HTMLInputElement).value);
      data.originKey=(event:KeyboardEvent)=>{if(event.key==='Enter'){event.preventDefault();screen.planOrigin();}};
      data.originLocation=()=>screen.locate();
      const nav = view.navigation;
      data.dr={name:directions.name,close:()=>screen.back(),min:directions.duration,meta:directions.meta,via:directions.via,shareLabel:'Share route',shareEta:()=>screen.shareRoute(),
       modes:data.nativeModeMetadata.map((reference:{mode:'drive'|'walk'|'bike'|'transit';label:string;d:string})=>{const mode:TravelMode=reference.mode==='bike'?'bicycle':reference.mode;const on=!!directions.modes.find(choice=>choice.mode===mode)?.selected;return {label:reference.label,t:reference.label,d:reference.d,on,css:on?'background:var(--acc);color:#fff':'background:var(--s2);color:var(--fg)',go:()=>screen.setMode(mode)};}),
       // The provider's ordered route choice (recommended first); choosing requests nothing.
       hasRoutes:directions.routes.length>0,
       routes:directions.routes.map(choice=>({label:`${choice.label}, ${choice.duration}, ${choice.meta}`,t:choice.label,sub:`${choice.duration} · ${choice.meta}`,on:choice.selected,css:choice.selected?'background:var(--acc);color:#fff':'background:var(--s2);color:var(--fg)',go:()=>screen.chooseRoute(choice.id)})),
       start:()=>screen.start(),
       nav:{going:!nav?.arrived,arrived:!!nav?.arrived,dist:nav?.distance||'Locating…',street:nav?.instruction||'Waiting for location',icon:nav?.maneuverIcon||PIN,hasThen:!!nav?.following,thenD:nav?.following?.icon||'',thenText:nav?.following?.text||'',
        left:nav?.remainingTime||'Guidance',meta:nav?.meta||'Foreground guidance',remaining:nav?.remaining||'',
        offRoute:!!nav?.offRoute,canReroute:!!nav?.canReroute,reroute:()=>screen.reroute(),rerouteLabel:'Reroute from here',background:!!nav?.background,
        end:()=>screen.end(),ask:()=>currentApi.send('Help me with this route.'),voiceLabel:navigationVoice.enabled?'Mute voice guidance':'Enable voice guidance',voice:()=>screen.toggleVoice(),voiceD:PIN}};
    }
    const eventOrigin=mapsEventReturnOffered(st.fromEvent,currentApi.S.stack,isNav);
    data.eventReturnFloating=!!eventOrigin&&!!data.showSearch;data.eventReturnInline=!!eventOrigin&&!!data.isDir;
    data.backToEvent=eventOrigin?()=>void returnToEvent(currentApi,eventOrigin,st.fromEvent):undefined;
    data.backToEventTitle=eventOrigin?.title||'';
    data.nativeMapsHandoff=status.mapsAppHandoff;
    data.openInMapsApp=()=>screen.openInMapsApp();
  }
  // The shell instance opens Maps for an agent request, exactly as a user's open would.
  let shell: Bag | undefined;
  const renderVals=Component.prototype.renderVals;
  // Later adapters wrap renderVals too, so disposal leaves this wrapper in place as a pass-through.
  Component.prototype.renderVals=function(this: Bag,...args: unknown[]){if(!disposed)shell=this;return renderVals.apply(this,args);};
  // Maps opens only over Home or itself, on an unlocked, visible, non-sensitive launcher screen.
  // Any other app keeps the screen; the agent hears that the phone cannot show Maps now.
  const surface = screen.surface(async () => {
    const showable=()=>{
      const value=shell?.S?.();
      return !disposed&&!document.hidden&&!!shell?.live&&!!value&&value.screen==='home'&&!value.secure&&!value.shade&&!shell.pageSuspended&&
        !shell.props?.assistantSurface&&!connectionController.getSnapshot().open&&(!value.view||value.view==='home'||value.view==='maps');
    };
    if(!showable())return false;
    if(!api?.isActive()){
      shell!.openView('maps');
      await Promise.race([new Promise<void>(resolve=>shell!.setState({},()=>resolve())),new Promise<void>(resolve=>setTimeout(resolve,2000))]);
    }
    return showable()&&shell!.S().view==='maps'&&!!api?.isActive()&&!!surface.snapshot();
  });
  // Offered to the agent only while Eliza Cloud Maps is installed for the signed-in account.
  const agentNavigation=bindAgentNavigation({
    // Eliza Cloud Maps in the launcher renderer only; never the regional gateway or the assistant window.
    enabled:()=>!regionalMapsConfigured&&!shell?.props?.assistantSurface&&!document.documentElement.classList.contains('alpha-assistant-surface'),
    installation:()=>{const coverage=cloudMapsCoverage();return coverage&&{providerId:coverage.providerId,attribution:coverage.attribution};},
    connection:mapsConnection,onChange:onMapsConnectionChange,surface,port:residentMapsNavigationPort,
  });
  // Screen-off navigation keeps its voice; everything else retires shared and spoken output.
  const retireShare=()=>screen.retireShare();
  const shareEvents=['launcher-home','alpha:device-state','alpha:dev-incoming-call'];for(const event of shareEvents)window.addEventListener(event,retireShare);
  const visibility = () => { if(document.hidden)screen.hidden();else screen.refresh(); };
  const pagehide=()=>screen.release();window.addEventListener('pagehide', pagehide); document.addEventListener('visibilitychange', visibility);
  return () => { disposed = true; agentNavigation.dispose(); shell=undefined; for(const event of shareEvents)window.removeEventListener(event,retireShare); screen.dispose(); window.removeEventListener('pagehide', pagehide); document.removeEventListener('visibilitychange', visibility); Object.assign(module, original); };
}
