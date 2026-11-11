import {createMapsNotificationOpen} from '../runtime/maps-notification-open';
import {mapsChatText} from '../runtime/action-message-presentation';
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
import { initializeCloudMaps, cloudMapsCoverage, cloudMapsDiagnostics, cloudMapsBasemap } from '../maps/cloud-maps';
import { insideCloudCoverage, type CloudMapsDisclosure, isGoogleMapsCoverage, isGoogleMapsProvider, isLocalMapsPlace } from '../maps/cloud-provider';
import googleMapsLogo from '../maps/google-maps-attribution.svg?url';
import { SavedPlaces } from '../maps/saved-places';

/** Who receives searches, in ≤4 words (full recipients and roles are in the provider's own disclosure). */
function searchRecipients(disclosure: CloudMapsDisclosure | undefined): string {
  if (!disclosure) return '';
  const names = [...new Set(disclosure.recipients.map(recipient => recipient.name))];
  return names.length ? `Search → ${names.join(', ')}` : '';
}
import { NativeMapsLocation, locationPermissionGranted } from '../maps/native-location';
import { bindAgentNavigation, keepCloudMapsCoverage, residentMapsNavigationPort } from '../maps/agent-navigation';
import { publishMapsSelection, clearMapsSelection } from '../maps/agent-context';
import { MapsController } from '../maps/state';
import { mapsConnection, onMapsConnectionChange } from '../maps/runtime';
import { MapsScreenController, type MapsScreenView } from '../maps/screen';
import { connectionController } from '../runtime/connection-ui';
import { cloudServiceName } from '../runtime/cloud-protocol';
import type { Coordinate, TravelMode } from '../maps/contracts';

type Bag = Record<string, any>;
const VOICE_ON = 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11';
const VOICE_OFF = 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 10l4 4M20 10l-4 4';
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
  let api: Bag | undefined, disposed=false, renders=0,voicePreferenceRead=false;
  let planeBasemap:MapBasemap|undefined, plane: MapPlane | undefined, planeElement: HTMLElement | undefined;
  let mapGeneration=0,mapFailed=false,mapObserver:MutationObserver|undefined;
  let mapCopyright='';
  let pendingHandoff: {query:string}|undefined, mapsController:MapsController|undefined;
  const active=()=>!disposed&&!document.hidden&&!!api?.isActive();
  const dropPlane=()=>{++mapGeneration;mapObserver?.disconnect();mapObserver=undefined;mapFailed=false;mapCopyright='';plane?.destroy();plane=undefined;planeElement=undefined;planeBasemap=undefined;};
  const googleProviders = new Set<string>();
  const isGoogleProvider = (id?: string) => !!id && (googleProviders.has(id) || isGoogleMapsProvider(id, cloudMapsCoverage()));
  const googleContent = () => {
    if (regionalMapsConfigured) return false;
    const coverage = cloudMapsCoverage();
    if (isGoogleMapsCoverage(coverage)) googleProviders.add(coverage!.providerId);
    return isGoogleMapsCoverage(coverage) || isGoogleProvider(mapsController?.snapshot().route.value?.providerId);
  };
  const localPlace = (view: MapsScreenView) => {
    const controller = mapsController?.snapshot().provider;
    return isLocalMapsPlace(
      view.place, regionalMap()?.providerId || cloudMapsCoverage()?.providerId, isGoogleProvider,
      controller ? {controller, connection: mapsConnection().config} : undefined,
    );
  };
  const navigationVoice = new NavigationVoice(
    error => screen.notify((error instanceof Error ? error.message + ' ' : '') + 'Voice paused'),
    () => !googleContent(),
  );
  const navigationTransport=registerPlugin<NavigationBridge & {consumeNavigationOpen():Promise<{open:boolean}>;clearNavigationOpen():Promise<unknown>}>('AlphaMapsTransport');
  const background=new BackgroundNavigation(navigationTransport,()=>Capacitor.isNativePlatform());
  // A Cloud read already made or under way for this account is not repeated: a second read would
  // uninstall the provider an open Maps search is using. An account change retires it first (cloud-maps.ts).
  const readCloudMaps = () => { const read = cloudMapsDiagnostics(); return read.configured && !read.error ? Promise.resolve() : initializeCloudMaps(); };
  const screen: MapsScreenController = new MapsScreenController({
    connection: mapsConnection,
    onConnectionChange: onMapsConnectionChange,
    initialize: () => regionalMapsConfigured ? initializeRegionalMaps() : readCloudMaps(),
    diagnostics: () => regionalMapsConfigured ? regionalDiagnostics() : cloudMapsDiagnostics(),
    coverage: () => {
      const region=regionalMap();
      if(region)return {name:region.region,mapRestricted:true,contains:point=>point.longitude>=region.bounds[0]&&point.latitude>=region.bounds[1]&&point.longitude<=region.bounds[2]&&point.latitude<=region.bounds[3]};
      const cloud=cloudMapsCoverage();
      return cloud&&{name:cloud.regions.map(item=>item.name).join(', '),mapRestricted:false,contains:point=>insideCloudCoverage(cloud,point)};
    },
    attribution: () => regionalMap()?.attribution || cloudMapsCoverage()?.attribution || '',
    createController: (config, provider) => (mapsController = new MapsController(
      config, provider, new SavedPlaces(undefined, isGoogleProvider), undefined, isGoogleProvider,
    )),
    navigationLocation: new NativeMapsLocation(),
    agentLocation: new NativeMapsLocation(),
    locationGranted: locationPermissionGranted,
    voice: navigationVoice,
    background,
    share: (data, signal) => {
      signal.throwIfAborted();
      const view = screen.view();
      if ((view.place && !localPlace(view)) || (view.mode !== 'place' && googleContent())) return Promise.resolve('closed');
      return shareMap(data, signal);
    },
    openWebsite: url => {
      if (Capacitor.isNativePlatform()) void DailyApps.perform({ action: 'browser', url: url.href }).then(result => { if (result.status !== 'opened') api?.toast(result.message || 'Couldn’t open'); }, () => api?.toast('Couldn’t open'));
      else window.open(url.href, '_blank', 'noopener,noreferrer');
    },
    active,
    invalidate: () => { if (!disposed && !document.hidden && (active() || screen.isNavigating())) api?.set({ nativeMapsRevision: ++renders }); },
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
    deniedLocationHelp: 'Location off',
    publishContext: publishMapsSelection,
    clearContext: clearMapsSelection,
  });
  // Explicit return to the event whose location opened Maps. It checks that exact event still exists,
  // restores Calendar on it and pops the cross-app stack. It never sets a Maps query.
  let returningToEvent: {raw: unknown; abort: AbortController} | undefined;
  const calendarPlugin=registerPlugin<{list(input:{begin:number;end:number}):Promise<{status:string;events?:unknown[]}>}>('AlphaCalendar');
  const returnIsCurrent = (currentApi: Bag, raw: unknown) =>
    !disposed && !document.hidden && !shell?.pageSuspended && currentApi.isActive()
      && currentApi.get('maps').fromEvent === raw && !!mapsEventReturnOffered(raw, api?.S.stack, screen.isNavigating());
  const retireEventReturn = () => {
    const previous = returningToEvent;
    returningToEvent = undefined;
    previous?.abort.abort();
  };
  async function returnToEvent(currentApi: Bag, origin: MapsEventOrigin, raw: unknown) {
    if (!returnIsCurrent(currentApi, raw) || returningToEvent?.raw === raw) return;
    retireEventReturn();
    const attempt = {raw, abort: new AbortController()};
    returningToEvent = attempt;
    try{
      // Only a ready read without the event withdraws the control; a refused or failed read keeps it.
      let outcome:'found'|'missing'|'permission'|'unknown'='unknown';
      try{
        if (origin.version === 2) {
          outcome = await currentApi.checkCanonicalCalendarReturn?.(origin, attempt.abort.signal) ?? 'unknown';
        } else {
          const result = await calendarPlugin.list({begin: origin.begin - 1, end: origin.begin + 1});
          outcome = result.status === 'ready' ? (mapsEventStillThere(origin, result.events) ? 'found' : 'missing') :
            result.status === 'permission-required' ? 'permission' : 'unknown';
        }
      } catch { /* A thrown read says nothing about the event. */ }
      if (returningToEvent !== attempt || !returnIsCurrent(currentApi, raw)) return;
      if(outcome==='permission'){currentApi.toast('Allow Calendar');return;}
      if(outcome==='unknown'){currentApi.toast('Couldn’t check');return;}
      if(outcome==='missing'){currentApi.set({fromEvent:null});currentApi.toast('Event moved');return;}
      const stack=(api?.S.stack||[]).slice(0,-1);
      // Unwind this visit's Maps layers (route, place, results, search text) as system Back would, so
      // nothing of the hand-off is left to show or replay when Maps is opened again.
      screen.unwind();
      currentApi.setView('calendar',{...(origin.version===2?{calendarAuthority:'canonical'}:{}),open:origin.rowId,openDay:origin.day,day:origin.day,month:null,form:null});
      currentApi.open('calendar',{keepState:true});currentApi.shell({stack});
    } finally {
      if (returningToEvent === attempt) returningToEvent = undefined;
    }
  }
  module.back = () => screen.back();
  module.onLeave = () => {
    retireEventReturn();
    screen.leaveView();
  };
  module.ongoing = () => { const nav=screen.isNavigating()?screen.view().navigation:undefined; return nav?{label:nav.arrived?'Arrived':nav.remainingTime,icon:'pin'}:null; };
  module.reply = () => null;
  module.suggestions = () => mapsConnected() ? ['Help me with this place', 'Explain Maps coverage'] : ['Help me with Maps', 'Explain location permissions'];
  module.render = (st: Bag, currentApi: Bag) => {
    api = currentApi;
    if(!voicePreferenceRead){navigationVoice.enabled=st.voice!==false;voicePreferenceRead=true;}
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
  function cloudCredit(directionsOpen: boolean) {
    const route = directionsOpen ? mapsController?.snapshot().route : undefined;
    const text = (route?.phase === 'ready' && route.value?.attribution) || cloudMapsCoverage()?.attribution || '';
    return text.length > 200 ? `${text.slice(0, 199)}…` : text;
  }
  function bind(data: Bag, view: MapsScreenView, st: Bag, currentApi: Bag) {
    const status = view.status, region = regionalMap(), raster = cloudMapsBasemap();
    const coverage = cloudMapsCoverage();
    const connectedGoogle = !region && googleContent();
    const restrictedPlace = !!view.place && !localPlace(view);
    const googlePlace = restrictedPlace && isGoogleProvider(view.place?.providerId);
    const placeSourceVerified = !restrictedPlace || view.place?.origin === 'provider' && googlePlace && isGoogleMapsCoverage(coverage);
    const results = view.results.filter(row => !row.saved || view.saved.some(item =>
      row.key === 'saved:' + item.id && isLocalMapsPlace(
        {origin:'saved', providerId:item.providerId}, region?.providerId || coverage?.providerId, isGoogleProvider,
      ),
    ));
    const savedListVisible = view.mode === 'base' || view.mode === 'results' && view.emptyQuery;
    const restrictedSaved = savedListVisible ? view.saved.filter(item => !isLocalMapsPlace(
      {origin:'saved', providerId:item.providerId}, region?.providerId || coverage?.providerId, isGoogleProvider,
    )) : [];
    const googleMaps = googlePlace || restrictedSaved.some(item => isGoogleProvider(item.providerId)) || connectedGoogle;
    const googleOnly = (!restrictedPlace || googlePlace) && restrictedSaved.every(item => isGoogleProvider(item.providerId));
    const basemap = restrictedPlace || restrictedSaved.length
      ? googleOnly && isGoogleMapsCoverage(coverage) ? raster : undefined
      : region || raster || (googleMaps ? undefined : globalBasemap);
    const globalMap = basemap === globalBasemap;
    // Alpha's Cloud provider is operator-owned. Translate only the generic setup
    // prompt after a service-configuration refusal; preserve other recovery messages.
    const cloudFailure = cloudMapsDiagnostics();
    const statusText = !regionalMapsConfigured && cloudFailure.error === 'unconfigured' &&
      (status.text.startsWith('Connect a Maps provider') || status.text === cloudFailure.message)
      ? 'Maps unavailable' : status.text;
    const directionsOpen = view.mode === 'directions' || view.mode === 'origin' || view.mode === 'navigation';
    const isPlace = view.mode === 'place', isResults = view.mode === 'results' || view.mode === 'origin', isNav = view.mode === 'navigation';
    const sheetHeight = directionsOpen ? 300+(view.directions?.routes.length??0)*50 : isPlace ? 400 : 520;
    // The ⓘ and recenter buttons share one baseline: just above an open sheet, else above the dock.
    const recBottom = isPlace || isResults || (directionsOpen && !isNav) ? sheetHeight + 14 : 124;
    Object.assign(data, {
      rootRef:(element:HTMLElement)=>{if(element)element.dataset.mapDiagnostics=JSON.stringify({...view.diagnostics,agentNavigation:{offered:agentNavigation.registered(),relay:residentMapsNavigationPort.relay}});},
      // Who receives search text and route points, from the connected Cloud provider.
      searchDisclosure:region?'':searchRecipients(cloudMapsCoverage()?.disclosure),
      cloudCredit:cloudCredit(directionsOpen),
      notNative:false, hasNativeMap:true, globalBasemap:globalMap, regionalBasemap:!!region && basemap === region,
      cloudBasemap:!!raster && basemap === raster && !googleMaps, googleMaps, googleMapsLogo,
      googleMapMissing:googleMaps && !basemap,
      mapLabel:googleMaps ? 'Google Maps' : globalMap ? 'World map' : basemap === region && region ? 'Regional map' : basemap ? 'Cloud map' : 'Map',
      mapAttribution:region && basemap === region ? region.attribution : raster && basemap === raster ? (planeBasemap === raster && mapCopyright || raster.attribution) : '',
      // Navigation guidance owns the bottom sheet, so the ⓘ sits above it.
      attributionBottom:isNav?sheetHeight+14:recBottom,
      mapRef:(element:HTMLElement)=>{
        if (!element) return;
        if (!basemap) {
          if (planeElement) dropPlane();
          delete element.dataset.mapReady;
          delete element.dataset.mapError;
          queueMicrotask(() => { if (active() && element.isConnected && !planeElement) screen.setMapState('error'); });
          return;
        }
        if(element!==planeElement||planeBasemap!==basemap){
          mapObserver?.disconnect();plane?.destroy();mapFailed=false;mapCopyright='';planeElement=element;planeBasemap=basemap;const generation=++mapGeneration;delete element.dataset.mapReady;delete element.dataset.mapError;
          const current=()=>generation===mapGeneration&&planeElement===element&&!disposed&&!!api?.isActive();
          try{
            plane=new MapPlane(element,basemap,()=>{if(!current())return;mapFailed=true;screen.setMapState('error');},data.C,id=>screen.pin(id),text=>{if(current()&&text!==mapCopyright){mapCopyright=text;screen.refresh();}},()=>screen.stopFollowing());
            mapObserver=new MutationObserver(()=>{if(current())screen.setMapState(element.dataset.mapError ? 'error' : element.dataset.mapReady === 'true' ? 'ready' : 'loading');});
            mapObserver.observe(element,{attributes:true,attributeFilter:['data-map-ready','data-map-error']});
          }catch{mapFailed=true;element.replaceChildren();queueMicrotask(()=>{if(current())screen.setMapState('error');});}
        }
        plane?.update(view.map.selected,view.map.route,view.map.overlay);
      },
      native: true, nativeStatusVisible:status.visible, nativeStatus: statusText, nativeStatusTop: directionsOpen?232:isPlace ? 128 : view.mode==='results' ? 130 : 174,
      nativeSavedEmpty: !view.saved.length, nativeLocationBusy: status.locationBusy, nativeLocation: () => screen.locate(),
      nativeLocationState:status.location,nativeMapState:status.map,nativeMapStatus:status.mapText,
      nativeLocationLabel:status.locationLabel,nativeLocationDenied:status.locationDenied,nativeStatusControls:status.controls,
      nativeLocationHelp:status.locationHelp,
      nativeLocationSettings:()=>{if(!active())return;void device.openSettings({page:'privacy'}).catch(()=>{if(!disposed&&currentApi.isActive())screen.notify('Couldn’t open settings');});},
      nativeManualLocation:()=>{if(!active())return;screen.manualLocation();queueMicrotask(()=>{if(active())document.querySelector<HTMLInputElement>('input[aria-label="Search places"]')?.focus();});},
      nativeMapRetry:status.mapRetry,
      retryNativeMap:()=>{
        if(!active())return;
        dropPlane();
        if (!basemap && !regionalMapsConfigured) void initializeCloudMaps();
        screen.retryMap();
      },
      mode:view.mode==='navigation'?'nav':view.mode==='directions'?'dir':view.mode, isBase:view.mode==='base',isResults,isPlace,isDir:view.mode==='directions',isNav,
      showSearch:view.showSearch, showRec:!isNav||view.map.overlay.follow===false, grid: '', major: '', fwy: '', water: '', parks: '', rwy: '', routeD: '', doneD: '', hasRoute: false, pins: [], labels: [], meCss: 'display:none;',
      mapDown: () => {}, mapUp: () => {}, q: view.query, hasQ: !!view.query, searchIcon:view.searchLead==='back'?'M15 5l-7 7 7 7':data.searchIcon, searchLabel: view.searchLead === 'back' ? 'Back' : 'Search', leadIsSearch: view.searchLead !== 'back',
      searchLead: () => screen.searchLead(),
      onQ: (event: Event) => screen.setQuery((event.target as HTMLInputElement).value),
      focusQ: () => screen.focusQuery(),
      qKey: (event: KeyboardEvent) => { if (event.key === 'Enter') { event.preventDefault(); screen.submit(); (event.target as HTMLInputElement).blur(); } },
      clearQ: () => screen.clearQuery(),
      chips: view.saved.map(item => ({ id: 'saved:' + item.id, label: item.label, d: PIN, go: () => screen.chooseSaved(item.id) })),
      cats: (view.map.selected||view.map.overlay.position?data.cats:[]).map((category: Bag) => ({ ...category, go: () => screen.searchFor(category.label) })),
      savedRows: view.saved.map(item => ({ id: 'saved:' + item.id, name: item.label, sub: coordLabel(item.coordinate), d: PIN, go: () => screen.chooseSaved(item.id) })),
      results: results.map(row => ({ id: row.key, name: row.name, sub: row.detail, d: PIN, go: () => screen.choose(row.key) })),
      hasResults: results.length > 0, noResults: view.noResults || view.hasResults && results.length === 0, emptyQ: view.emptyQuery,
      recenter: () => screen.recenter(), recBottom, recCss: '',
      sheetH: sheetHeight, sheetSw: { down: () => {}, up: () => {} }, sheetTap: () => {},
      askAlpha: () => currentApi.send(view.query || 'Help me with Maps.'), noResTxt: 'Ask',
    });
    const place = view.place;
    if (place) {
      // Provider detail for this exact place: opening hours, phone and website when the
      // source has them. Phone is shown as text; calling stays deferred with Phone.
      data.pc = {
        name: place.name, meta: place.meta, addr: place.address,
        hasHours: !!place.hours, openTxt: 'Hours', openCss: '', hoursTxt: place.hours || '',
        hasPhone: false, hasWeb: !!place.website, web: () => screen.openWebsite(),
        canDir: place.canDirections && placeSourceVerified, min: 'Directions', saved: place.saved,
        saveLabel: place.saved ? 'Remove from saved' : 'Save', starCss: place.saved ? 'color:var(--acct)' : '', starFill: place.saved ? 'fill:currentColor' : '',
        close: () => screen.closePlace(), save: !restrictedPlace || place.saved ? () => screen.toggleSaved() : undefined,
        dirs: placeSourceVerified ? () => screen.openDirections() : undefined,
        share: restrictedPlace ? undefined : () => screen.sharePlace(),
        nativeName: place.name, nativeEditing: place.editingName,
        canRename:!restrictedPlace&&(place.saved||place.meta==='Coordinates'||place.meta==='Device location'),
        nativeTitleRole: restrictedPlace ? undefined : 'button', nativeTitleTabIndex: restrictedPlace ? undefined : 0,
        nativeTitleLabel: restrictedPlace ? undefined : 'Rename place',
        nativeEdit: restrictedPlace ? undefined : () => screen.startRename(),
        nativeEditKey: restrictedPlace ? undefined : (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); screen.startRename(); } },
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
      data.dr={name:directions.name,close:()=>screen.back(),min:directions.duration,meta:directions.meta,via:directions.via,shareLabel:'Share route',shareEta:googleMaps ? undefined : () => screen.shareRoute(),
       modes:data.nativeModeMetadata.map((reference:{mode:'drive'|'walk'|'bike'|'transit';label:string;d:string})=>{const mode:TravelMode=reference.mode==='bike'?'bicycle':reference.mode;const on=!!directions.modes.find(choice=>choice.mode===mode)?.selected;return {label:reference.label,t:reference.label,d:reference.d,on,available:!!directions.modes.find(choice=>choice.mode===mode)?.available,css:on?'background:var(--acc);color:#fff':'background:var(--s2);color:var(--fg)',go:()=>screen.setMode(mode)};}),
       // The provider's ordered route choice (recommended first); choosing requests nothing.
       hasRoutes:directions.routes.length>0,
       routes:directions.routes.map(choice=>({label:`${choice.label}, ${choice.duration}, ${choice.meta}`,t:choice.label,sub:`${choice.duration} · ${choice.meta}`,on:choice.selected,css:choice.selected?'background:var(--acc);color:#fff':'background:var(--s2);color:var(--fg)',go:()=>screen.chooseRoute(choice.id)})),
       start:()=>screen.start(),
       nav:{going:!nav?.arrived,arrived:!!nav?.arrived,dist:nav?.distance||'Locating…',street:nav?.instruction||'Waiting for location',icon:nav?.maneuverIcon||PIN,hasThen:!!nav?.following,thenD:nav?.following?.icon||'',thenText:nav?.following?.text||'',
        left:nav?.remainingTime||'Guidance',meta:nav?.remaining&&nav.remaining===nav.meta?'':nav?.meta||'Foreground guidance',remaining:nav?.remaining||'',
        offRoute:!!nav?.offRoute,canReroute:!!nav?.canReroute,reroute:()=>screen.reroute(),rerouteLabel:'Reroute from here',background:!!nav?.background,
        end:()=>screen.end(),ask:()=>currentApi.send('Help me with this route.'),voiceLabel:navigationVoice.enabled?'Mute voice guidance':'Enable voice guidance',voice:googleMaps ? undefined : ()=>{screen.toggleVoice();currentApi.set({voice:navigationVoice.enabled});},voiceD:navigationVoice.enabled?VOICE_ON:VOICE_OFF}};
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
  const notificationOpen=createMapsNotificationOpen({
    ready:()=>{const state=shell?.S?.();return Capacitor.isNativePlatform()&&!disposed&&!!shell?.live&&!document.hidden&&!shell.pageSuspended&&!shell.props?.assistantSurface&&!connectionController.getSnapshot().open&&state?.screen==='home'&&!state.secure&&!state.shade;},
    consume:()=>navigationTransport.consumeNavigationOpen(),clear:()=>navigationTransport.clearNavigationOpen(),
    open:()=>shell!.openView('maps',{keepState:true}),
  });
  const renderVals=Component.prototype.renderVals;
  // Later adapters wrap renderVals too, so disposal leaves this wrapper in place as a pass-through.
  Component.prototype.renderVals=function(this: Bag,...args: unknown[]){if(!disposed){shell=this;queueMicrotask(()=>void notificationOpen.flush());}return renderVals.apply(this,args);};
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
  // Coverage is read once the account is bound and the resident is ready, so the agent can navigate
  // before Maps is opened. A new account gets coverage only; its routes still need a new search.
  const stopCoverage=keepCloudMapsCoverage({
    enabled:()=>!regionalMapsConfigured&&!shell?.props?.assistantSurface&&!document.documentElement.classList.contains('alpha-assistant-surface'),
    ready:()=>!!connectionController.getSnapshot().session,
    account:()=>connectionController.getCloudClient(),
    initialize:readCloudMaps,
    onChange:listener=>connectionController.subscribe(listener),
  });
  // Screen-off navigation keeps its voice; everything else retires shared and spoken output.
  const retireShare=()=>screen.retireShare();
  const shareEvents=['launcher-home','alpha:device-state','alpha:dev-incoming-call'];for(const event of shareEvents)window.addEventListener(event,retireShare);
  const visibility = () => {
    if (document.hidden) {
      retireEventReturn();
      screen.hidden();
    } else {screen.refresh();void notificationOpen.flush();}
  };
  const pagehide = () => {
    retireEventReturn();
    screen.release();
  };
  const openNavigation=()=>notificationOpen.request();
  const cancelNavigationOpen=()=>notificationOpen.cancel();
  window.addEventListener('launcher-home',cancelNavigationOpen);
  window.addEventListener('alpha:maps-open',openNavigation);
  window.addEventListener('pagehide', pagehide);
  document.addEventListener('visibilitychange', visibility);
  return () => { disposed = true; notificationOpen.dispose(); window.removeEventListener('launcher-home',cancelNavigationOpen); retireEventReturn(); stopCoverage(); agentNavigation.dispose(); shell=undefined; for(const event of shareEvents)window.removeEventListener(event,retireShare); screen.dispose(); window.removeEventListener('alpha:maps-open',openNavigation); window.removeEventListener('pagehide', pagehide); document.removeEventListener('visibilitychange', visibility); Object.assign(module, original); };
}

/** Presentation only: stored messages, model context and copied source text remain unchanged.
 * A share answer is an ordinary chat message; the agent still owns the confirmation gate. */
export function installMapsChatAdapter(Component:Bag){
 const p=Component.prototype,render=p.renderVals;
 const answered=new WeakMap<object,Set<string>>();
 const answers=(shell:Bag)=>{let value=answered.get(shell);if(!value){value=new Set();answered.set(shell,value);}return value;};
 async function answer(shell:Bag,id:string,value:string,current:()=>boolean){
  const snapshot=connectionController.getSnapshot(),done=answers(shell);
  if(done.has(id)||!shell.live||document.hidden||snapshot.open||snapshot.busy||shell.S().typing||shell.S().recording||!current())return;
  if(String(shell.S().draft||'').trim()){shell.toast('Chat draft open');return;}
  // send() refuses a prompt while a message edit is open; do not mark the answer as sent.
  if(shell.messageEditTarget){shell.toast('Editing message');return;}
  done.add(id);if(shell.live)shell.setState({});
  try{if(!current()){done.delete(id);return;}await shell.send(value);}catch(error){done.delete(id);if(shell.live){shell.setState({});shell.toast(error instanceof Error?error.message:'Not sent');}}
 }
 p.renderVals=function(){
  const out=render.call(this),msgs=out.msgs||[],done=answers(this);
  out.msgs=msgs.map((message:Bag,index:number)=>{
   if(!message.isAgent)return message;
   const source=String(message.displayText??message.text??''),parsed=mapsChatText(source);
   if(!parsed.cards.length&&!parsed.choice&&parsed.displayText===source)return message;
   // Only the newest reply can still be answered; an old question is history.
   const choice=parsed.choice,id=choice?String(message.id)+':'+choice.id:'',snapshot=connectionController.getSnapshot(),session=snapshot.session,conversation=connectionController.getSelectedConversationId();
   const saved=this.S().msgs?.find((row:Bag)=>row.id===message.id),savedText=saved?String(saved.displayText??saved.text??''):undefined;
   const current=()=>{const latest=this.S().msgs?.at(-1);return !!session&&connectionController.getSnapshot().session===session&&connectionController.getSelectedConversationId()===conversation&&latest?.id===message.id&&latest.from==='agent'&&String(latest.displayText??latest.text??'')===savedText;};
   const open=!!choice&&index===msgs.length-1&&!done.has(id)&&current();
   return {...message,displayText:parsed.displayText,hasCalendarText:message.hasCalendarText!==false&&!!parsed.displayText,
    messageActionsLabel:message.messageActionsLabel?'Message actions: '+(parsed.displayText||parsed.cards[0]?.title||'Maps'):message.messageActionsLabel,
    mapsCards:parsed.cards.map(card=>({...card,lines:card.lines.map(text=>({text})),hasAttribution:!!card.attribution,canOpenMap:current(),
      openMap:()=>{if(!current()||!this.live||document.hidden||connectionController.getSnapshot().open)return;this.openView('maps',card.mapQuery?{query:card.mapQuery}:{keepState:true});}})),
    hasMapsChoice:open,mapsChoices:open?choice!.options.map(option=>({label:option.label,choose:()=>void answer(this,id,option.value,current)})):[]};
  });return out;
 };
}
