import {openContentLink} from './content-links';
import {guidanceDistance} from '../maps/guidance';
import {distanceToRoute} from '../maps/route-distance';
import {mapsChatText} from '../runtime/action-message-presentation';
import {BackgroundNavigation,type NavigationBridge} from '../maps/background-navigation';
import {registerPlugin} from '../platform-plugins';
import {DailyApps} from '../daily';
import {mapsEventReturnOffered,mapsEventStillThere,type MapsEventOrigin} from '../runtime/maps-event-return';
import {Capacitor} from '@capacitor/core';
import {isAndroid} from '../native';
import {NavigationVoice} from '../maps/navigation-voice';
import {mapShareLabel,shareMap} from '../maps/share';
import { MapPlane } from '../maps/map-plane';
import type {MapBasemap} from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/map-plane.ts';
import { globalBasemap } from '../maps/basemap';
import { initializeRegionalMaps, regionalMap, regionalDiagnostics, regionalMapsConfigured } from '../maps/regional-provider';
import { initializeCloudMaps, cloudMapsCoverage, cloudMapsDiagnostics, cloudMapsBasemap } from '../maps/cloud-maps';
import { describeMapsDisclosure, insideCloudCoverage } from '../maps/cloud-provider';
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
  let api: Bag | undefined, disposed=false, renders=0;
  let startupLocationChecked=false,locationGeneration=0,saveNamedPlace=false;
  let planeBasemap:MapBasemap|undefined, plane: MapPlane | undefined, planeElement: HTMLElement | undefined;
  let mapGeneration=0,mapFailed=false,mapObserver:MutationObserver|undefined;
  let mapCopyright='';
  let pendingHandoff: {query:string}|undefined, mapsController:MapsController|undefined;
  const active=()=>!disposed&&!document.hidden&&!!api?.isActive();
  let searchTimer:ReturnType<typeof setTimeout>|undefined;
  let resultDrag:{id:number;y:number;distance:number;sheet:HTMLElement}|undefined;
  const resetResultDrag=()=>{if(resultDrag)resultDrag.sheet.style.translate='';resultDrag=undefined;};
  const resultGrip={
    down:(event:PointerEvent)=>{
      if(event.button!==0)return;
      const target=event.currentTarget as HTMLElement,sheet=target.closest<HTMLElement>('[data-alpha-maps-sheet]');
      if(!sheet)return;
      resultDrag={id:event.pointerId,y:event.clientY,distance:0,sheet};
      target.setPointerCapture(event.pointerId);
    },
    move:(event:PointerEvent)=>{
      if(!resultDrag||event.pointerId!==resultDrag.id)return;
      resultDrag.distance=Math.max(0,event.clientY-resultDrag.y);
      resultDrag.sheet.style.translate=`0 ${resultDrag.distance}px`;
      event.preventDefault();
    },
    up:(event:PointerEvent)=>{
      if(!resultDrag||event.pointerId!==resultDrag.id)return;
      const dismiss=resultDrag.distance>=72;
      resetResultDrag();
      if(dismiss){cancelSearch();submittedSearch=undefined;screen.back();}
    },
    cancel:resetResultDrag,
  };
  let submittedSearch:{kind:'place'|'origin';text:string}|undefined;
  const cancelSearch=()=>{if(searchTimer!==undefined)clearTimeout(searchTimer);searchTimer=undefined;};
  const runSearch=(kind:'place'|'origin',text:string)=>{
    cancelSearch();
    const snapshot=mapsController?.snapshot();
    const failed=(kind==='origin'?snapshot?.originSearch:snapshot?.search)?.phase==='error';
    if(!active()||!text.trim()||!failed&&submittedSearch?.kind===kind&&submittedSearch.text===text)return;
    submittedSearch={kind,text};
    if(kind==='origin')screen.planOrigin();else screen.submit();
  };
  const queueSearch=(kind:'place'|'origin',text:string)=>{
    cancelSearch();submittedSearch=undefined;
    if(!text.trim())return;
    searchTimer=setTimeout(()=>runSearch(kind,text),350);
  };
  const dropPlane=()=>{++mapGeneration;mapObserver?.disconnect();mapObserver=undefined;mapFailed=false;mapCopyright='';plane?.destroy();plane=undefined;planeElement=undefined;planeBasemap=undefined;};
  const navigationVoice=new NavigationVoice(error=>screen.notify((error instanceof Error?error.message+' ':'')+'Voice guidance paused. Tap Enable voice guidance to retry.'));
  const background=new BackgroundNavigation(registerPlugin<NavigationBridge>('AlphaMapsTransport'),()=>Capacitor.isNativePlatform());
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
    createController: (config, provider) => (mapsController = new MapsController(config, provider)),
    navigationLocation: new NativeMapsLocation(),
    agentLocation: new NativeMapsLocation(),
    locationGranted: locationPermissionGranted,
    voice: navigationVoice,
    background,
    share: async (data, signal) => {
      try { return await shareMap(data, signal); }
      catch (error) {
        if (!signal.aborted && active()) api?.toast(error instanceof Error ? error.message : 'Sharing is unavailable.');
        return 'closed';
      }
    },
    openWebsite: url => {
      if (shell) void openContentLink(shell as any, url.href).catch(error => api?.toast(error instanceof Error ? error.message : 'The browser could not open.'));
    },
    active,
    invalidate: () => { if (active()) api?.set({ nativeMapsRevision: ++renders }); },
    toast: text => api?.toast(text==='Copied'?'Link copied':text),
    discardHandoff: () => { pendingHandoff=undefined; if(api?.get('maps').query!=null)api.set({query:null}); },
    handoffReturn: () => !!mapsEventReturnOffered(api?.get('maps').fromEvent,api?.S.stack,screen.isNavigating()),
    released: ()=>{resetResultDrag();cancelSearch();submittedSearch=undefined;dropPlane();},
    // With no Maps provider on Android, an event's location can be handed to an installed map
    // app, only when the user taps for it. The exact hand-off text is sent; no route is shown.
    ...(isAndroid ? { mapsApp: {
      available: () => DailyApps.capabilities().then(result => result.actions.some(row => row.action === 'maps' && row.available)),
      open: (text: string) => DailyApps.perform({ action: 'maps', query: text }).then(result => ({ opened: result.status === 'opened', message: result.message })),
    } } : {}),
    deniedLocationHelp: isAndroid ? 'Allow location in app settings, or search for a place.' : 'Allow location in browser site settings, or search for a place.',
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
      if(outcome==='permission'){currentApi.toast('Allow Calendar access to check this event.');return;}
      if(outcome==='unknown'){currentApi.toast("Can't check this event. Try again.");return;}
      if(outcome==='missing'){currentApi.set({fromEvent:null});currentApi.toast('That event was deleted or moved.');return;}
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
    startupLocationChecked=false;locationGeneration++;
    retireEventReturn();
    screen.release();
  };
  module.ongoing = () => null;
  module.reply = () => null;
  module.suggestions = () => mapsConnected() ? ['Help me with this place', 'Explain Maps coverage'] : ['Help me with Maps', 'Explain location permissions'];
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
    if(!startupLocationChecked){
      startupLocationChecked=true;
      const generation=locationGeneration;
      void locationPermissionGranted().then(granted=>{
        const current=screen.view();
        if(granted&&generation===locationGeneration&&active()&&current.mode==='base'&&!current.query&&!pendingHandoff)screen.recenter();
      });
    }
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
    const status = view.status, region = regionalMap(), raster=cloudMapsBasemap(), basemap = region || raster || globalBasemap, globalMap = !region&&!raster;
    // Alpha's Cloud provider is operator-owned. Translate only the generic setup
    // prompt after a service-configuration refusal; preserve other recovery messages.
    const cloudFailure = cloudMapsDiagnostics();
    const statusText = !regionalMapsConfigured && cloudFailure.error === 'unconfigured' &&
      (status.text.startsWith('Connect a Maps provider') || status.text === cloudFailure.message)
      ? 'Maps is unavailable right now. Try again later.' : status.text;
    const directionsOpen = view.mode === 'directions' || view.mode === 'origin' || view.mode === 'navigation';
    const isPlace = view.mode === 'place', isNav = view.mode === 'navigation';
    const sheetHeight = directionsOpen ? 300+(view.directions?.routes.length??0)*50 : isPlace ? 400 : 520;
    const savedMatches=view.mode!=='origin'&&view.query.trim()?view.saved.filter(item=>item.label.toLocaleLowerCase().includes(view.query.trim().toLocaleLowerCase())):[];
    const isResults=(view.mode==='results'||view.mode==='origin')&&!view.emptyQuery&&(view.hasResults||savedMatches.length>0);
    const routineStatus=['Finding location…','Place saved on this device.','Place removed from saved.','Saved place renamed.','Name updated. Tap Save to keep this place.'].includes(statusText);
    const emptySearch=view.noResults&&!view.emptyQuery&&!savedMatches.length&&status.map!=='error';
    const snapshot=mapsController?.snapshot();
    const position=snapshot?.position.phase==='ready'?snapshot.position.value?.coordinate:undefined;
    const places=new Map((view.mode==='origin'?snapshot?.originSearch.value:snapshot?.search.value)?.map(place=>[`place:${place.providerId}:${place.id}`,place.coordinate]));
    for(const saved of snapshot?.saved.value??[])places.set(`saved:${saved.id}`,saved.coordinate);
    const distanceFor=(key:string)=>{const point=places.get(key);return position&&point?guidanceDistance(distanceToRoute(position,[point])):'';};
    Object.assign(data, {
      rootRef:(element:HTMLElement)=>{if(element)element.dataset.mapDiagnostics=JSON.stringify({...view.diagnostics,agentNavigation:{offered:agentNavigation.registered(),relay:residentMapsNavigationPort.relay}});},
      // Who receives search text and route points, from the connected Cloud provider.
      nativeShareLabel:mapShareLabel(),nativeSystemShare:mapShareLabel()==='Share',nativeCopyLink:mapShareLabel()==='Copy link',
      searchDisclosure:region?'':describeMapsDisclosure(cloudMapsCoverage()?.disclosure),
      cloudCredit:cloudCredit(directionsOpen),
      notNative:false, hasNativeMap:true,globalBasemap:globalMap,regionalBasemap:!!region,cloudBasemap:!region&&!!raster,mapLabel:raster?'Google Maps':globalMap?'World map':'Regional map',mapAttribution:region?.attribution||(raster?(mapCopyright||raster.attribution):globalBasemap.attribution),attributionBottom:directionsOpen||isPlace||isResults?sheetHeight+10:130,
      mapRef:(element:HTMLElement)=>{
        if(!element||!basemap)return;
        if(element!==planeElement||planeBasemap!==basemap){
          mapObserver?.disconnect();plane?.destroy();mapFailed=false;mapCopyright='';planeElement=element;planeBasemap=basemap;const generation=++mapGeneration;delete element.dataset.mapReady;delete element.dataset.mapError;
          const current=()=>generation===mapGeneration&&planeElement===element&&!disposed&&!!api?.isActive();
          try{
            plane=new MapPlane(element,basemap,()=>{if(!current())return;mapFailed=true;screen.setMapState('error');},data.C,id=>id.startsWith('saved:')?screen.chooseSaved(id.slice(6)):screen.pin(id),text=>{if(current()&&text!==mapCopyright){mapCopyright=text;screen.refresh();}});
            mapObserver=new MutationObserver(()=>{if(current())screen.setMapState(element.dataset.mapReady==='true'?'ready':'loading');});
            mapObserver.observe(element,{attributes:true,attributeFilter:['data-map-ready']});
          }catch{mapFailed=true;element.replaceChildren();queueMicrotask(()=>{if(current())screen.setMapState('error');});}
        }
        plane?.update(view.map.selected,view.map.route,{...view.map.overlay,pins:[...(view.map.overlay.pins??[]),...savedMatches.map(item=>({id:`saved:${item.id}`,label:item.label,coordinate:item.coordinate}))]});
      },
      native: true, nativeStatusVisible:(status.visible&&!routineStatus)||emptySearch, nativeStatus: emptySearch?'No places':statusText, nativeStatusTop: directionsOpen?232:isPlace ? 128 : view.mode==='results' ? 130 : 174,
      nativeSavedEmpty: !view.saved.length, nativeLocationBusy: status.locationBusy, nativeLocation: () => screen.locate(),
      nativeLocationState:status.location,nativeMapState:status.map,nativeMapStatus:status.mapText,
      nativeLocationLabel:status.locationLabel,nativeLocationDenied:status.locationDenied,nativeStatusControls:status.controls,
      nativeLocationHelp:status.locationHelp,
      nativeLocationSettings:()=>{if(!active())return;void device.openSettings({page:'privacy'}).catch(()=>{if(!disposed&&currentApi.isActive())screen.notify('Location settings could not be opened. Check device or browser permissions, or search for a place.');});},
      nativeManualLocation:()=>{if(!active())return;screen.manualLocation();queueMicrotask(()=>{if(active())document.querySelector<HTMLInputElement>('input[aria-label="Search places"]')?.focus();});},
      nativeMapRetry:status.mapRetry,
      retryNativeMap:()=>{if(!active())return;dropPlane();screen.retryMap();},
      mode:view.mode==='navigation'?'nav':view.mode==='directions'?'dir':view.mode, isBase:view.mode==='base',isResults,isPlace,isDir:view.mode==='directions',isNav,
      showSearch:view.showSearch, showRec:!isNav, grid: '', major: '', fwy: '', water: '', parks: '', rwy: '', routeD: '', doneD: '', hasRoute: false, pins: [], labels: [], meCss: 'display:none;',
      mapDown: () => {}, mapUp: () => {}, q: view.query, hasQ: !!view.query, searchLabel: view.searchLead === 'back' ? 'Back' : 'Search',
      searchLead: () => {cancelSearch();submittedSearch=undefined;screen.searchLead();},
      onQ: (event: Event) => {const text=(event.target as HTMLInputElement).value;screen.setQuery(text);queueSearch('place',text);},
      focusQ: () => screen.focusQuery(),
      qKey: (event: KeyboardEvent) => { if (event.key === 'Enter') { event.preventDefault(); runSearch('place',(event.target as HTMLInputElement).value); (event.target as HTMLInputElement).blur(); } },
      clearQ: () => {cancelSearch();submittedSearch=undefined;screen.clearQuery();},
      chips: view.saved.map(item => ({ id: 'saved:' + item.id, label: item.label, d: PIN, go: () => {cancelSearch();screen.chooseSaved(item.id);submittedSearch=undefined;} })),
      cats: data.cats.map((category: Bag) => ({ ...category, go: () => screen.searchFor(category.label) })),
      savedRows: savedMatches.map(item => ({ id: 'saved:' + item.id, name: item.label, sub: '', distance:distanceFor(`saved:${item.id}`), d: PIN, go: () => {cancelSearch();screen.chooseSaved(item.id);submittedSearch=undefined;} })),
      results: view.results.map(row => ({ id: row.key, name: row.name, sub: row.detail, distance:distanceFor(row.key), d: PIN, go: () => {cancelSearch();screen.choose(row.key);submittedSearch=undefined;} })),
      hasResults: view.hasResults||savedMatches.length>0, noResults: view.noResults&&!savedMatches.length, emptyQ: view.emptyQuery,
      recenter: () => screen.recenter(), recBottom: isPlace ? 414 : view.mode === 'results' ? 534 : 124, recCss: '',
      sheetH: sheetHeight, sheetSw: resultGrip, sheetTap: () => {},
      askAlpha: () => currentApi.send(view.query || 'Help me with Maps.'), noResTxt: `Ask ${currentApi.name} about this search`,
    });
    const place = view.place;
    if (place) {
      // Provider detail for this exact place: opening hours, phone and website when the
      // source has them. Phone is shown as text; calling stays deferred with Phone.
      data.pc = {
        name: place.name, meta: place.meta, addr: place.address,
        hasHours: !!place.hours, hoursRows: (place.hours || '').split(/;|\s+·\s+/).map((text,index)=>{const separator=text.indexOf(':');return {id:String(index),day:separator>0?text.slice(0,separator).trim():'',hours:separator>0?text.slice(separator+1).trim():text.trim()};}).filter(row=>row.hours),
        hasPhone: false, hasWeb: !!place.website, web: () => screen.openWebsite(),
        canDir: place.canDirections, min: 'Directions', saved: place.saved,
        saveLabel: place.saved ? 'Remove from saved' : 'Save', starCss: place.saved ? 'color:var(--acct)' : '', starFill: place.saved ? 'fill:currentColor' : '',
        close: () => {saveNamedPlace=false;screen.closePlace();}, save: () => {if(place.saved)screen.toggleSaved();else {saveNamedPlace=true;screen.startRename();}},
        dirs: () => screen.openDirections(),
        share: () => screen.sharePlace(),
        nativeName: place.name, nativeEditing: place.editingName, nativeNameAction:saveNamedPlace?'Save':'Done',
        nativeTitleRole: 'button', nativeTitleTabIndex: 0, nativeTitleLabel: 'Rename place',
        nativeEdit: () => {saveNamedPlace=false;screen.startRename();},
        nativeEditKey: (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); saveNamedPlace=false;screen.startRename(); } },
        nativeRename: (event: Event) => screen.rename((event.target as HTMLInputElement).value),
        nativeApplyName: () => {screen.applyName();const updated=screen.view().place;if(saveNamedPlace&&updated&&!updated.editingName){saveNamedPlace=false;if(!updated.saved)screen.toggleSaved();}},
      };
    }
    const directions = view.directions;
    if (directions) {
      // Coordinates plan directly; any other text searches places and saved places.
      data.originText=directions.originText;
      data.onOrigin=(event:Event)=>{const text=(event.target as HTMLInputElement).value;screen.setOriginText(text);queueSearch('origin',text);};
      data.originKey=(event:KeyboardEvent)=>{if(event.key==='Enter'){event.preventDefault();runSearch('origin',(event.target as HTMLInputElement).value);}};
      data.originLocation=()=>{cancelSearch();submittedSearch=undefined;screen.locate();};
      const nav = view.navigation;
      data.dr={name:directions.name,close:()=>screen.back(),min:directions.duration,meta:directions.meta,via:directions.via,shareLabel:mapShareLabel()==='Share'?'Share route':'Copy route link',shareEta:()=>screen.shareRoute(),
       modes:data.nativeModeMetadata.map((reference:{mode:'drive'|'walk'|'bike'|'transit';label:string;d:string})=>{const mode:TravelMode=reference.mode==='bike'?'bicycle':reference.mode;const on=!!directions.modes.find(choice=>choice.mode===mode)?.selected;return {label:reference.label,t:reference.label,d:reference.d,on,css:on?'background:var(--acc);color:#fff':'background:var(--s2);color:var(--fg)',go:()=>screen.setMode(mode)};}),
       // The provider's ordered route choice (recommended first); choosing requests nothing.
       hasRoutes:directions.routes.length>0,
       routes:directions.routes.map(choice=>({label:`${choice.label}, ${choice.duration}, ${choice.meta}`,t:choice.label,sub:`${choice.duration} · ${choice.meta}`,on:choice.selected,css:choice.selected?'background:var(--acc);color:#fff':'background:var(--s2);color:var(--fg)',go:()=>screen.chooseRoute(choice.id)})),
       start:()=>screen.start(),
       nav:{going:!nav?.arrived,arrived:!!nav?.arrived,dist:nav?.distance||'Locating…',street:nav?.instruction||'Waiting for location',icon:nav?.maneuverIcon||PIN,hasThen:!!nav?.following,thenD:nav?.following?.icon||'',thenText:nav?.following?.text||'',
        left:nav?.remainingTime||'Guidance',meta:nav?.remaining&&nav.remaining===nav.meta?'':nav?.meta||'Foreground guidance',remaining:nav?.remaining||'',
        offRoute:!!nav?.offRoute,canReroute:!!nav?.canReroute,reroute:()=>screen.reroute(),rerouteLabel:'Reroute from here',background:!!nav?.background,
        end:()=>screen.end(),ask:()=>currentApi.send('Help me with this route.'),voiceLabel:navigationVoice.enabled?'Mute voice guidance':'Enable voice guidance',voice:()=>screen.toggleVoice(),voiceD:navigationVoice.enabled?VOICE_ON:VOICE_OFF}};
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
    } else screen.refresh();
  };
  const pagehide = () => {
    retireEventReturn();
    screen.release();
  };
  window.addEventListener('pagehide', pagehide);
  document.addEventListener('visibilitychange', visibility);
  return () => { disposed = true; resetResultDrag(); retireEventReturn(); stopCoverage(); agentNavigation.dispose(); shell=undefined; for(const event of shareEvents)window.removeEventListener(event,retireShare); screen.dispose(); window.removeEventListener('pagehide', pagehide); document.removeEventListener('visibilitychange', visibility); Object.assign(module, original); };
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
  if(String(shell.S().draft||'').trim()){shell.toast('Keep or send your chat draft before answering.');return;}
  // send() refuses a prompt while a message edit is open; do not mark the answer as sent.
  if(shell.messageEditTarget){shell.toast('Finish or cancel the message you are editing first.');return;}
  done.add(id);if(shell.live)shell.setState({});
  try{if(!current()){done.delete(id);return;}await shell.send(value);}catch(error){done.delete(id);if(shell.live){shell.setState({});shell.toast(error instanceof Error?error.message:'The answer was not sent.');}}
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
    mapsCards:parsed.cards.map(card=>({...card,lines:card.lines.map(text=>({text})),hasAttribution:!!card.attribution})),
    hasMapsChoice:open,mapsChoices:open?choice!.options.map(option=>({label:option.label,choose:()=>void answer(this,id,option.value,current)})):[]};
  });return out;
 };
}
