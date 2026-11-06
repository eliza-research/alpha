import { externalVoiceInvocationEnabled } from './runtime/voice-entry-policy';
// Register browser implementations before any runtime module claims plugin identity.
import './browser/register';
import {installCanonicalNotesView} from './prototype/canonical-notes-ui';
import {installCanonicalCalendarDrafts} from './prototype/canonical-calendar-drafts';
import {installAgentCalendarAdapter,deviceCalendarScope} from './prototype/agent-calendar-adapter';
import {Capacitor} from '@capacitor/core';
import {ownerReminderNotifications} from './runtime/owner-reminder-notification-port';
import {installCalendarApprovalAdapter} from './prototype/calendar-approval-adapter';
import {bindBrowserDeletionOwner} from './runtime/deletion-owner';
import {DEFAULT_PULL_VELOCITY} from "../../../.eliza/client-features/packages/ui/src/gestures/constants";
import {usePullGesture} from "../../../.eliza/client-features/packages/ui/src/components/shell/use-pull-gesture";
import {installChatOverlayMotion} from './prototype/chat-overlay-motion-adapter';
import {installSubviewAccessibility,keepFocusOnScreen} from './prototype/subview-accessibility';
import {installCalendarMonthFocus} from './prototype/calendar-month-focus';
import {installCalendarEditDraftAdapter} from './prototype/calendar-edit-draft-adapter';
import {installCalendarFormDraftAdapter} from './prototype/calendar-form-draft-adapter';
import { browserApps } from './browser/apps';
import { installSmsAdapter } from './prototype/sms-adapter';
import { installContactsAdapter } from './prototype/contacts-adapter';
import { installPhoneAdapter } from './prototype/phone-adapter';
import { admitImageContacts } from './prototype/mvp-features';
import {DeletionUndo} from './runtime/deletion-undo';
import {bindBrowserSpeechConnection} from './browser/agent-speech';
import { testMocksEnabled, devSurfacesEnabled } from './build-flags';
import { RootErrorBoundary, installGlobalErrorRecovery } from './runtime/error-boundary';
import { installBrowserDeviceAdapter } from './browser/device-adapter';
import { browserDevProfile as devProfileQuery,developmentAgentWorkflows as devAgentWorkflowsQuery } from './browser/dev-profile';
// Static imports keep development startup synchronous (no top-level await, which the page load
// event does not wait for). Flag-off builds resolve these two modules to inert stubs in vite.config.
import { BrowserDeviceControls as DevDeviceControls } from './browser/device-controls';
import { captureSimulatedApps, installSimulatedApps } from './browser/simulated-apps';
import {HostedDigestPanel} from './runtime/hosted-digest-ui';
import { installClockAdapter } from './prototype/clock-adapter';
import {installNoteWebSourceAdapter} from './prototype/note-web-source-adapter';
import {installNoteSourceAdapter} from './prototype/note-source-adapter';
import {installSharePanelAdapter} from './prototype/share-panel-adapter';
import {installNotesShareAdapter} from './prototype/notes-share-adapter';
import { installNotesDocumentAdapter } from './prototype/notes-document-adapter';
import { installPrototypeMapsAdapter } from './prototype/maps-adapter';
import { installNotificationsAdapter } from './prototype/notifications-adapter';
import { installSystemShade, shadeSurface } from './prototype/system-shade';
import { installContextSelection } from './prototype/context-selection';
import { installWorkflowAdapter } from './prototype/workflow-adapter';
import { installAutomationsAdapter } from './prototype/automations-adapter';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { StartupPermissions } from './startup-permissions';
import { reopenStartupPermissions } from './startup-permission-flow';
import { createRoot } from 'react-dom/client';
import { Component, VIEWS, ORDER } from './prototype/model.js';
import { installReminderAdapter } from './prototype/reminder-adapter';
import { installNoteOriginAdapter } from './prototype/note-origin-adapter';
import { installAgentAdapter } from './prototype/agent-adapter';
import { installPrototypeNativeAdapters } from './prototype/native-adapter';
import { installSelectedDocumentAdapter } from './prototype/selection-adapter';
import { installPrototypeCameraAdapter } from './prototype/camera-adapter';
import { installPrototypeHomeBindings, installPrototypeDataAdapter, setHomeSources, HOME_SOURCES_CHANGED } from './prototype/data-adapter';
import { isAndroid, DeviceApps, System, launcherBridge, launcherListens, openAppInfo } from './native';
import { DailyApps } from './daily';
import { installPrototypeVoiceAdapter } from './prototype/voice-adapter';
import { installPrototypeBrowserAdapter } from './prototype/browser-adapter';
import { installCalendarAdapter } from './prototype/calendar-adapter';
import { installSettingsAdapter, readAppearanceChoice, resolveAppearance } from './prototype/settings-adapter';
import { ConnectionChooser, connectionController, connectionChooserVisible, residentAlwaysPresent } from './runtime/connection-ui';
import { protectedPowerLaunchState } from './runtime/power-launch-state';
import { installListenerInvocation, stopWakeListenerForChatOnly } from './runtime/always-on-listener';
import {GoogleConnectionsPanel} from './runtime/google-connection-ui';
import { installNotesTrashAdapter } from './prototype/notes-trash-adapter';
import { installNotesFoldersAdapter } from './prototype/notes-folders-adapter';
import { installInboxCloudAdapter, inboxAttention, subscribeInboxAttention } from './prototype/inbox-cloud-adapter';
import { installHomeOverviewCards } from './prototype/home-overview-cards';
import { installUseInEmailReview } from './prototype/use-in-email-review';
import { latestRetainedDigest, subscribeRetainedDigest } from './runtime/hosted-digests';
import { installHomeShell } from './prototype/home-shell';
import { alphaViews } from './product/alpha-product';
import { setLocalePreferences } from './prototype/locale-time';
import { installTextScale } from './runtime/text-scale';
import { installDockClearance } from './runtime/dock-clearance';
import { canvasGeometry, isEditing, keyboardFreeHeight, publishSurfaceLayout, surfaceLayout } from './runtime/canvas-geometry';
import { TEXT_SCALE_PROPERTY } from './runtime/text-scale';
import { installToastLayer } from './runtime/toast-layer';
import { installViewFocus } from './runtime/view-focus';
import './prototype/prototype.css';
import './prototype/phone.css';
installGlobalErrorRecovery();
// Registration has completed; this injected source cannot form a register→connection cycle.
if(!Capacitor.isNativePlatform())ownerReminderNotifications.bind({binding:()=>connectionController.getOwnerReminderNotificationBinding(),subscribeBinding:listener=>connectionController.subscribe(listener)});
// Developer surfaces are only reachable in an explicitly flagged development server.
const browserDevProfile=devSurfacesEnabled&&devProfileQuery;
const developmentAgentWorkflows=devSurfacesEnabled&&devAgentWorkflowsQuery;
const BrowserDeviceControls=devSurfacesEnabled?DevDeviceControls:null;
const MOCK_BANNER_STYLE=".mock-mode-banner{position:fixed;top:0;left:0;right:0;z-index:2000;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 10px;background:#0000ff;color:white;font:11px 'Public Sans',sans-serif}.mock-mode-banner button{border:1px solid white;border-radius:14px;background:transparent;color:white;min-height:24px;padding:4px 8px;font:inherit}.native-phone .mock-mode-banner{top:var(--native-top-inset,24px)}";
if(!isAndroid)bindBrowserSpeechConnection(connectionController);
if(!isAndroid)bindBrowserDeletionOwner(()=>{const session=connectionController.getSnapshot().session,device=connectionController.getWorkflowDeviceTarget();return session&&device?'agent:'+JSON.stringify([session.origin,session.ownerId,session.agentId,session.sessionId,device.installationId,device.enrollmentId]):null;});
const query = new URLSearchParams(location.search);
document.documentElement.classList.toggle('native-phone', isAndroid);
const savedMock = testMocksEnabled && (() => {
  try { return isAndroid && JSON.parse(localStorage.getItem('alpha.connection.selection.v1') || 'null')?.kind === 'mock'; }
  catch { return false; }
})();
// Resolve mock before mounting any native adapter, including after a cold start.
// Production builds never admit mock or fixture state, whatever the URL or storage says.
const mock = testMocksEnabled && (query.get('mode') === 'mock' || savedMock);
// Android's shade is the notification surface (#416, #417); only the browser development build simulates it.
const systemShade=shadeSurface({native:isAndroid,simulated:devSurfacesEnabled});
const fixture = testMocksEnabled && (mock || (devSurfacesEnabled && !isAndroid && query.get('fixture') === '1'));
const initialTheme = (() => {
  if (testMocksEnabled && (query.has('theme') || fixture)) return query.get('theme') === 'dark' ? 'dark' : 'light';
  return resolveAppearance(readAppearanceChoice());
})();
document.documentElement.dataset.connectionMode = mock ? 'mock' : 'live';
if (testMocksEnabled && mock) { const style = document.createElement('style'); style.textContent = MOCK_BANNER_STYLE; document.head.append(style); }
const simulatedApps=devSurfacesEnabled?captureSimulatedApps(VIEWS):undefined;
installPrototypeHomeBindings(Component);
if (!fixture) {
  let selected: ReturnType<typeof installSelectedDocumentAdapter> | undefined;
  installPrototypeNativeAdapters(Component, VIEWS, { onSelection: (module, result, api) => { void selected?.(module, result, api); } });
  installPrototypeMapsAdapter(Component, VIEWS);
  selected = installSelectedDocumentAdapter(Component, VIEWS);
  installPrototypeCameraAdapter(Component, VIEWS);
  installAgentAdapter(Component, VIEWS);
  installReminderAdapter(Component, VIEWS);
  installCalendarAdapter(Component, VIEWS, {active:deviceCalendarScope});
  if(isAndroid){installContactsAdapter(Component,VIEWS);installSmsAdapter(Component,VIEWS);installPhoneAdapter(Component,VIEWS);}
  installCalendarFormDraftAdapter(Component, VIEWS, {active:shell=>deviceCalendarScope(shell)||shell?.vget('calendar').form?.cal==='alpha-reminders'});
  installCalendarEditDraftAdapter(Component, VIEWS, {active:shell=>deviceCalendarScope(shell)||shell?.vget('calendar').form?.cal==='alpha-reminders'});
  installNoteOriginAdapter(Component, VIEWS);
  installPrototypeDataAdapter(Component, VIEWS);
  installAgentCalendarAdapter(Component,VIEWS);
  installCanonicalCalendarDrafts(Component,VIEWS);
  // Notice rows feed only the development stand-in shade; product builds read no notice list (#416).
  if(systemShade==='simulated')installNotificationsAdapter(Component);
  installContextSelection(Component);
  installPrototypeVoiceAdapter(Component, VIEWS);
  installCalendarApprovalAdapter(Component);
  installNotesDocumentAdapter(Component, VIEWS);
  installNotesShareAdapter(VIEWS);
  installNotesTrashAdapter(Component, VIEWS);
  installNotesFoldersAdapter(Component, VIEWS);
  installCanonicalNotesView(Component,VIEWS);
  installNoteSourceAdapter(VIEWS);
  installNoteWebSourceAdapter(VIEWS);
  installPrototypeBrowserAdapter(Component, VIEWS);
  installSettingsAdapter(Component, VIEWS);
  if(!isAndroid){if(devSurfacesEnabled)installBrowserDeviceAdapter(Component);else installBrowserCapabilityTiles(Component);}
  if(!browserDevProfile) {installInboxCloudAdapter(Component, VIEWS);installUseInEmailReview(Component, VIEWS);}
  // Home cards read only the provider summaries: unread count, account label and read time for
  // mail, and the latest retained brief. Nothing here starts a read or a run.
  if(!browserDevProfile){
    const homeSourcesChanged=()=>window.dispatchEvent(new Event(HOME_SOURCES_CHANGED));
    subscribeInboxAttention(homeSourcesChanged);subscribeRetainedDigest(homeSourcesChanged);
    setHomeSources({
      attention:()=>{const value=inboxAttention();return {state:value.state,unread:value.unread,...(value.source?{source:value.source}:{}),...(value.updatedAt?{updatedAt:value.updatedAt}:{})};},
      brief:latestRetainedDigest,
    });
  }
  if(!browserDevProfile) {installWorkflowAdapter(Component, VIEWS);installAutomationsAdapter(Component,VIEWS);}
  // The development profile has no provider mail summary, but its scheduled digests retain results
  // the same way, so its Home reads the latest retained brief from the same source.
  if(browserDevProfile){subscribeRetainedDigest(()=>window.dispatchEvent(new Event(HOME_SOURCES_CHANGED)));setHomeSources({brief:latestRetainedDigest});}
  installSharePanelAdapter(Component,VIEWS);
}
if(devSurfacesEnabled&&simulatedApps)installSimulatedApps(Component,VIEWS,simulatedApps);
if(developmentAgentWorkflows){installWorkflowAdapter(Component,VIEWS);installAutomationsAdapter(Component,VIEWS);}
installSubviewAccessibility(VIEWS);
installCalendarMonthFocus(Component, VIEWS);
installChatOverlayMotion(Component);
installSystemShade(Component,{native:isAndroid});
// The shared agenda, mail and brief cards render the final Home values of every adapter above.
installHomeOverviewCards(Component);
installClockAdapter(Component, VIEWS, { simulated: testMocksEnabled && fixture, browser: !isAndroid });
// Home and its app grid from the shared mobile shell, and Alpha's Apps drawer. Installed apps come
// from ElizaSystem (Android, or the browser device's app list) through the shared launcher bridge;
// outermost so Home composes with every binding above. App info exists on Android only.
installHomeShell(Component, VIEWS, launcherBridge, { icons: isAndroid, follow: launcherListens, appInfo: isAndroid ? openAppInfo : undefined,
  aliases: isAndroid ? undefined : Object.fromEntries(browserApps.flatMap(app => { const view = alphaViews.find(app.view); return view ? [[app.packageName, alphaViews.launcherKey(view)]] : []; })),
});
/** A browser cannot read or change radios and sensors; show that instead of fixture toggles. */
function installBrowserCapabilityTiles(Component:any){
  const p=Component.prototype,render=p.renderVals;
  const managed=new Set(['Wi-Fi','Bluetooth','Airplane mode','Agent can listen','Location','Do not disturb']);
  p.renderVals=function(){
    const out=render.call(this);
    const tiles=(out.tiles||[]).map((tile:any)=>managed.has(tile.label)?{...tile,on:false,pressed:undefined,disabled:true,css:'background:var(--s2);color:var(--fg);opacity:.55',toggle:()=>{}}:tile);
    return {...out,tiles,deviceSettingsPending:true,deviceSettingsMessage:'Network, radio and sensor settings are managed by your browser and operating system.',sbWifi:navigator.onLine,sbPlane:false};
  };
}
let shell: any;
/** A notice raised while the startup loading screen holds Home unmounted; shown once Home mounts. */
let pendingNotice: string | undefined;
/** A hosted-notice question may fill only the live conversation of the same verified session. */
function questionTarget(sessionId:string){const snapshot=connectionController.getSnapshot();return Boolean(shell?.live&&!document.hidden&&!snapshot.open&&snapshot.session?.sessionId===sessionId);}
let launcherPresentation = false;
/** Opened through ACTION_ASSIST (AlphaAssistActivity): chat and close only. */
let assistantSurface = false;
const closeAssistant = () => { void DailyApps.closeAssistant().catch(() => {}); };
function Phone() {
  const [pullScale,setPullScale]=useState(1);
  const chatPullBinding=usePullGesture({
    swipeEnabled:false,
    preventTouchCompatibilityEvents:true,
    velocityThreshold:DEFAULT_PULL_VELOCITY*pullScale,
    onDrag:offset=>shell?.paintChatMotion(offset),
    onPullUp:()=>shell?.settleChatMotion('up'),
    onPullDown:()=>shell?.settleChatMotion('down'),
    onSettleFree:direction=>shell?.settleChatMotion(direction,true),
    onDragReset:()=>{if(shell?.chatMotion?.moved)shell.cancelChatMotion();},
    onTap:()=>shell?.tapChatMotion(),
    onCancel:()=>shell?.cancelChatMotion(),
  });
  const connection = useSyncExternalStore(connectionController.subscribe, connectionController.getSnapshot);
  // Startup decides whether sign-in or access setup opens first: a verified account, a saved one
  // that is offline (neither prompt), the sign-in itself or a settled start. Until then a neutral
  // screen stands in for the shell, so Home is never shown and then covered. Once shown, Home
  // stays; a start that has not decided in 60 s (a first boot takes about 27 s) shows it as before.
  const [homeShown, setHomeShown] = useState(fixture || !residentAlwaysPresent);
  const startupPending = !homeShown && !connection.startupResolved && !connection.cloudAccount && connection.residentPlanNotice !== 'offline' && !connectionChooserVisible(connection);
  useEffect(() => {
    if (!startupPending) { setHomeShown(true); return; }
    const timer = setTimeout(() => setHomeShown(true), 60_000);
    return () => clearTimeout(timer);
  }, [startupPending]);
  useEffect(() => {
    if (isAndroid) void DailyApps.surfaceInfo().then(info => {
      if (Number.isFinite(info.topInset)) document.documentElement.style.setProperty('--native-top-inset', `${info.topInset}px`);
      if (Number.isFinite(info.bottomInset)) document.documentElement.style.setProperty('--native-bottom-inset', `${info.bottomInset}px`);
      size();
    }).catch(() => {});
    const freeHeight = keyboardFreeHeight();
    // List-detail split and Calendar day columns change what surfaces render, so a change in the
    // measured canvas width or text size renders the shell again (runtime/canvas-geometry.ts).
    let canvasWidth = 412, desktopCanvas = false;
    const publishLayout = () => {
      const textScale = parseFloat(document.documentElement.style.getPropertyValue(TEXT_SCALE_PROPERTY)) || 1;
      const next = surfaceLayout(canvasWidth, textScale, desktopCanvas);
      if (!publishSurfaceLayout(next)) return;
      document.documentElement.classList.toggle('alpha-split', next.split);
      const focused = document.activeElement;
      shell?.setState({ surfaceLayoutRevision: Date.now() }, () => keepFocusOnScreen(focused));
    };
    const textScaleObserver = new MutationObserver(publishLayout);
    textScaleObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    const size = () => {
      // Android WebView can expand innerWidth/visualViewport to overflowing content
      // during rotation. Feeding that back into the phone canvas leaves portrait
      // content at landscape width. The root client box is the fitted WebView;
      // a smaller visual viewport still supplies the keyboard's usable height.
      const width = document.documentElement.clientWidth || window.innerWidth;
      const layoutHeight = document.documentElement.clientHeight || window.innerHeight;
      const height = Math.min(layoutHeight, window.visualViewport?.height || layoutHeight);
      const viewportTop = Math.max(0, Math.min(window.visualViewport?.offsetTop || 0, layoutHeight - height));
      document.documentElement.style.setProperty('--alpha-visible-height', `${height}px`);
      document.documentElement.style.setProperty('--alpha-visible-top', `${viewportTop}px`);
      const coarse = !isAndroid && window.matchMedia('(pointer: coarse)').matches;
      const desktop = !isAndroid && width > 600 && !coarse;
      const banner = testMocksEnabled && mock ? document.querySelector('.mock-mode-banner')?.getBoundingClientRect().bottom || 36 : 0;
      const tools = devSurfacesEnabled && !isAndroid && !mock ? document.querySelector<HTMLElement>('.alpha-dev-tools') : null;
      const toolsInset = tools ? Math.max(56, Math.ceil(tools.getBoundingClientRect().height + (parseFloat(getComputedStyle(tools).bottom) || 0) + 2)) : 0;
      const available = Math.max(1, height - banner - (desktop ? 48 : 0) - toolsInset);
      // Measured width and keyboard-free height decide the arrangement (runtime/canvas-geometry.ts).
      // Standalone touch windows keep their own density; the launcher keeps its fitted canvas.
      const input = { width, layoutHeight, available, desktop, fluid: isAndroid || coarse, launcher: launcherPresentation, screenShort: Math.min(window.screen.width, window.screen.height), editing: isEditing(document.activeElement) };
      const geometry = canvasGeometry(input, freeHeight(width, layoutHeight, input.editing), banner);
      document.documentElement.style.setProperty('--phone-scale', String(geometry.scale));
      document.documentElement.style.setProperty('--phone-width', geometry.width);
      document.documentElement.style.setProperty('--phone-height', `${geometry.height}px`);
      document.documentElement.style.setProperty('--phone-left', `${geometry.left}px`);
      document.documentElement.style.setProperty('--phone-top', `${geometry.top}px`);
      document.documentElement.classList.toggle('browser-desktop', desktop);
      document.documentElement.classList.toggle('alpha-landscape', geometry.landscape);
      document.documentElement.classList.toggle('alpha-wide', geometry.wide);
      canvasWidth = desktop ? 412 : width / geometry.scale; desktopCanvas = desktop;
      publishLayout();

    };
    const bannerObserver=new ResizeObserver(size);const bannerElement=testMocksEnabled&&mock?document.querySelector('.mock-mode-banner'):null;if(bannerElement)bannerObserver.observe(bannerElement);
    size(); window.addEventListener('resize', size); window.visualViewport?.addEventListener('resize', size); window.visualViewport?.addEventListener('scroll', size);
    return () => { textScaleObserver.disconnect(); bannerObserver.disconnect(); window.removeEventListener('resize', size); window.visualViewport?.removeEventListener('resize', size); window.visualViewport?.removeEventListener('scroll', size); };
  }, []);
  // Access setup opens for a Cloud account, or for own Cerebras keys only once saved from the sign-in
  // page this session (configureLocal onboarding bumps setupRevision): a passive providerStatus read
  // of keys configured earlier is no onboarding step and never opens setup over the phone.
  return <>{!mock&&<DeletionUndo/>}{BrowserDeviceControls&&!isAndroid&&!mock&&query.get('tools')==='1'&&<BrowserDeviceControls command={action=>{
    if(!shell)return;
    if(action==='home')window.dispatchEvent(new Event('launcher-home'));
    else if(action==='back')window.dispatchEvent(new Event('alpha-back',{cancelable:true}));
    else if(action==='power'){shell.leave();shell.power();}
    else if(action==='unlock'){shell.unlock();window.dispatchEvent(new Event('focus'));}
    else if(action==='boot'){shell.leave();shell.runBoot();}
    else if(action==='shade'){shell.unlock();shell.setState({shade:true});}
    else if(action==='assistant'){shell.unlock();shell.setState({chat:'full'});}
    else if(action==='background'){shell.leave();shell.setState({screen:'off',voice:'off',chat:'input',shade:false});document.documentElement.dataset.devBackground='true';window.dispatchEvent(new Event('blur'));}
    else if(action==='resume'){delete document.documentElement.dataset.devBackground;shell.unlock();window.dispatchEvent(new Event('focus'));}
    if(['power','unlock','boot','background','resume'].includes(action))window.dispatchEvent(new Event('alpha:device-state'));
  }}/>}{testMocksEnabled && mock && <div className="mock-mode-banner" role="status"><span>Mock mode · simulated data and actions</span><button onClick={() => { void connectionController.offline().then(() => { const url = new URL(location.href); url.searchParams.delete('mode'); url.searchParams.delete('start'); location.assign(url.href); }); }}>Exit mock mode</button></div>}{startupPending ? <div className="alpha-startup-loading" role="status" aria-label="Loading Alpha"><span className="alpha-compute-mark"/></div> : <Component configureChatPull={(surface:{scale:number})=>setPullScale(surface.scale)} chatPullBinding={chatPullBinding} phoneSurface assistantSurface={assistantSurface} onCloseAssistant={closeAssistant} onReopenStartupAccess={!fixture && !assistantSurface ? reopenStartupPermissions : undefined} systemShell={launcherPresentation} systemShade={systemShade} nativeSystemChrome={isAndroid || !launcherPresentation} initial={testMocksEnabled && fixture ? query.get('start') || 'home' : 'home'} theme={initialTheme} ref={(value: any) => { shell = value; if (value && pendingNotice) queueMicrotask(() => { if (shell === value && value.live && pendingNotice) { value.toast(pendingNotice); pendingNotice = undefined; } }); }} />}
{!fixture && <><ConnectionChooser /><GoogleConnectionsPanel />{!assistantSurface && <><HostedDigestPanel canComposeQuestion={questionTarget} composeQuestion={(draft,sessionId)=>{if(!questionTarget(sessionId))return false;shell.api(shell.S().view).composeContentQuestion(draft);return true;}} /><StartupPermissions active={(!!connection.cloudAccount || (!!connection.setupRevision && connection.providerStatus?.selected === true && connection.providerStatus.provider === 'cerebras')) && !(connection.busy && !connection.residentStarting) && !connection.signIn} /></>}</>}</>;
}
/** Android's locale and 24-hour setting; WebView Intl alone does not follow the latter. */
async function applyDeviceLocale() {
  try { const info = await System.getLocaleInfo(); setLocalePreferences({ locale: info.locale, hourCycle: info.hour24 === true ? 'h23' : info.hour24 === false ? 'h12' : undefined }); }
  catch { /* Keep the WebView's default locale formatting. */ }
}
async function mountPhone() {
  // Android owns its system bars; browser defaults to the standalone app.
  launcherPresentation = isAndroid
    ? await System.getBuildInfo().then(info => info.launcher === true).catch(() => false)
    : devSurfacesEnabled && query.get('shell') === 'launcher';
  if (isAndroid) {
    // AlphaAssistActivity (surfaceInfo) or an Activity opened with the 'alpha.assistant' extra.
    const [surface, launch] = await Promise.all([
      DailyApps.surfaceInfo().then(info => info.assistant === true).catch(() => false),
      System.getLaunchInfo().then(info => info.assistant === true).catch(() => false),
    ]);
    assistantSurface = surface || launch;
    const refreshImage=async()=>{const image=await DeviceApps.platformCapabilities().catch(()=>({aospImage:false,contacts:false}));const admitted=image.aospImage===true&&image.contacts===true;admitImageContacts(admitted);const index=ORDER.indexOf('contacts');if(admitted&&index<0)ORDER.push('contacts');else if(!admitted&&index>=0)ORDER.splice(index,1);if(!admitted&&shell?.S().view==='contacts')shell.goHome();};
    await refreshImage();
    await applyDeviceLocale();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshImage().then(()=>applyDeviceLocale()).then(() => shell?.setState({ localeRevision: Date.now() })); });
  } else if (devSurfacesEnabled && query.get('surface') === 'assistant') {
    // Development server only: preview the ACTION_ASSIST surface without an Android host.
    assistantSurface = true;
  }
  document.documentElement.classList.toggle('alpha-assistant-surface', assistantSurface);
  document.documentElement.classList.toggle('standalone-app', !launcherPresentation);
  // Large text is measured, not declared: layout rules read --alpha-text-scale (runtime/text-scale.ts).
  installTextScale();
  // The floating dock's footprint is measured too: Home ends above it (runtime/dock-clearance.ts).
  installDockClearance();
  // Dialog feedback is announced in its own flow above the form (runtime/toast-layer.ts).
  installToastLayer();
  // Focus dropped by a screen change or HOME lands on the new screen's title (runtime/view-focus.ts).
  installViewFocus();
  if (testMocksEnabled && mock && isAndroid) {
    const { pauseLiveActivityForMock } = await import('./runtime/mock-admission');
    const root=document.getElementById('root')!;
    root.setAttribute('role','status');
    root.textContent='Pausing live background activity before opening mock mode…';
    try { await pauseLiveActivityForMock(); }
    catch {
      root.setAttribute('role','alert');
      root.textContent='Live background activity could not be paused. Retry before opening mock mode.';
      const retry=document.createElement('button');retry.textContent='Retry mock mode';
      retry.onclick=()=>{retry.disabled=true;void mountPhone();};root.append(retry);return;
    }
    root.removeAttribute('role');
  }
  createRoot(document.getElementById('root')!).render(<RootErrorBoundary><Phone /></RootErrorBoundary>);
  // P-78 also retires an already-enabled listener; entry-point hiding alone is insufficient.
  if (isAndroid && !externalVoiceInvocationEnabled) void stopWakeListenerForChatOnly().then(stopped => {
    if (stopped) return;
    const notice = 'Wake listening could not be confirmed off. Turn it off in Android settings.';
    if (shell?.live) { shell.toast(notice); pendingNotice = undefined; } else pendingNotice = notice;
  });
  // The image's always-on listener heard the wake phrase: start the on-device voice assistant.
  if (externalVoiceInvocationEnabled && isAndroid && assistantSurface) installListenerInvocation(() => shell, { authority: () => { const port=connectionController.getAppRecordClient(); if(!port)return null; try{if(!port.current())return null;return JSON.stringify([port.sessionId,port.scope??null,port.identity.ownerId,port.identity.agentId,port.identity.sessionId,port.identity.origin]);}catch{return null;} }, initialRestorePending: () => protectedPowerLaunchState(connectionController.getSnapshot()).initialRestorePending, powerAccountRef: () => protectedPowerLaunchState(connectionController.getSnapshot()).accountRef, connectionOpen: () => connectionController.getSnapshot().open, connected: () => !!connectionController.getSnapshot().session && !connectionController.getSnapshot().busy, voiceActive: () => !!document.querySelector('[data-alpha-chat-recorder]'), subscribe: listener => connectionController.subscribe(listener) });
}
// Provider and Cloud account changes report a short receipt in the phone's toast (connection-ui.tsx).
window.addEventListener('alpha:connection-toast', event => {
  const notice = (event as CustomEvent<unknown>).detail;
  if (typeof notice !== 'string' || !notice) return;
  if (shell?.live) { shell.toast(notice); pendingNotice = undefined; } else pendingNotice = notice;
});
void mountPhone();
