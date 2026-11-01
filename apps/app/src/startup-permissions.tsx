import {Capacitor, type PluginListenerHandle} from '@capacitor/core';
import React, {useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {registerPlugin} from './platform-plugins';
import {connectionController} from './runtime/connection-ui';
import {cloudServiceName} from './runtime/cloud-protocol';
import {googleConnectionController} from './runtime/google-connection-ui';
import {readStartupPermissionMemory,writeStartupPermissionMemory,startupPhotoAccess,startupLocationAccess,STARTUP_PERMISSIONS_REOPEN} from './startup-permission-flow';
import {iconStyle} from './icon-style';
import {browserStartupPermission} from './startup-browser-permissions';
import {createStartupPermissionFlow, startupPermissionKeys, nativeStartupPermissionKeys, type NativeStartupPermissionKey as PermissionKey, type StartupPermissionState} from './startup-permission-flow';
import {readStartupPermissionProgress, writeStartupPermissionProgress, startupPermissionProgressKey} from './startup-permission-progress';
import {showWalkthroughCompletion} from '../../../.eliza/client-features/packages/ui/src/components/permissions/permission-walkthrough.ts';
import './startup-permissions.css';

const notifications = registerPlugin<{status(): Promise<{permissionGranted: boolean; appEnabled: boolean}>}>('AlphaNotifications');
const permissions = registerPlugin<{
  checkPermissions(): Promise<{camera: string}>;
  requestPermissions(options: {permissions: ['notifications'] | ['camera']}): Promise<unknown>;
  addListener(event: 'appResumed', callback: () => void): Promise<PluginListenerHandle>;
}>('DailyApps');
const microphone = registerPlugin<{checkPermissions(): Promise<{microphone: string}>; requestPermissions(options: {permissions: ['microphone']}): Promise<unknown>}>('AlphaVoiceCloud');
const location = registerPlugin<{checkPermissions(): Promise<{location: string}>; requestPermissions(): Promise<unknown>}>('ElizaLocation');
const photos = registerPlugin<{scope():Promise<unknown>;requestAccess():Promise<unknown>}>('AlphaPhotoLibrary');
const calendar = registerPlugin<{checkPermissions(): Promise<{calendar: string}>; requestAccess(): Promise<{status: string}>}>('AlphaCalendar');
const device = registerPlugin<{openSettings(options: {page: 'notifications' | 'privacy'}): Promise<unknown>}>('AlphaDevice');
const details = {
  notifications: {title: 'Stay in the loop.', icon: 'bell', description: 'Allow notifications for reminders and task updates.', browser: 'Show reminders and task alerts while Alpha is open.'},
  microphone: {title: 'Talk to Alpha.', icon: 'mic', description: 'Allow the microphone for voice conversations.', browser: 'Use your voice to talk with Alpha.'},
  camera: {title: 'Capture a moment.', icon: 'camera', description: 'Allow the camera when you want to take a photo.', browser: 'Take photos and scan documents.'},
  photos: {title: 'Your photos, here.', icon: 'images', description: 'Choose which photos and videos Alpha can use.', browser: ''},
  calendar: {title: 'Plan your day.', icon: 'calendar', description: 'Allow calendar access to view and save events.', browser: ''},
  location: {title: 'Find your way.', icon: 'map-pin', description: 'Allow location for Maps. Approximate location is enough.', browser: 'Use your location in Maps.'},
};
const progressKey = 'alpha:startup-permission-progress:v1';
const dismissedKey = 'alpha:startup-permissions-dismissed:v1';
type Progress = {version: 3; step: number; choices: ('allowed' | 'continued' | 'skipped')[]};
function savedProgress(native = false): Progress | null {
  const keys: readonly PermissionKey[] = native ? nativeStartupPermissionKeys : startupPermissionKeys;
  try {
    const durable = readStartupPermissionProgress(localStorage, native);
    if (durable.status === 'completed') return null;
    // Session progress from before the durable marker is only read as a fallback, never written.
    const raw = localStorage.getItem(startupPermissionProgressKey) === null ? sessionStorage.getItem(progressKey) : null;
    if (!raw) return {version: 3, step: durable.step, choices: durable.choices ?? Array(durable.step).fill('continued')};
    const value = JSON.parse(raw);
    if (![1, 2, 3].includes(value.version) || !Number.isInteger(value.step) || value.step < 0 || value.step >= keys.length || !Array.isArray(value.choices) || value.choices.length !== value.step || value.choices.some((choice: unknown) => typeof choice !== 'string' || !['allowed', 'skipped', 'continued'].includes(choice))) return {version: 3, step: 0, choices: []};
    return {version: 3, step: value.step, choices: value.choices};
  } catch { return {version: 3, step: 0, choices: []}; }
}
function permissionAccess(value: unknown) {
  if (typeof value !== 'string' || !['granted', 'denied', 'prompt', 'prompt-with-rationale'].includes(value)) throw Error('Permission status unavailable');
  return {granted: value === 'granted', enabled: value === 'granted', requestable: value !== 'denied'};
}
/** UI progress is never permission authority. Every grant is read back from the platform. */
export function StartupPermissions({active:enabled = true}: {active?: boolean} = {}) {
  const connection = useSyncExternalStore(connectionController.subscribe,connectionController.getSnapshot);
  const googleOpen = useSyncExternalStore(googleConnectionController.subscribe,googleConnectionController.getSnapshot);
  const [reopened,setReopened] = useState(false);
  const [ready,setReady] = useState(false);
  const locationDescription=useRef(''),photoDescription=useRef('');
  const native = Capacitor.getPlatform() === 'android';
  const keys: readonly PermissionKey[] = native ? nativeStartupPermissionKeys : startupPermissionKeys;
  const [flows] = useState(() => {
    const nativeBridges = {
      notifications: {status: async () => {const status = await notifications.status(); return {granted: status.permissionGranted, enabled: status.appEnabled};}, request: () => permissions.requestPermissions({permissions: ['notifications']}), openSettings: () => device.openSettings({page: 'notifications'})},
      microphone: {status: async () => permissionAccess((await microphone.checkPermissions()).microphone), request: () => microphone.requestPermissions({permissions: ['microphone']}), openSettings: () => device.openSettings({page: 'privacy'})},
      // Shared ElizaCamera requests all aliases. The product DailyApps alias requests CAMERA only.
      camera: {status: async () => permissionAccess((await permissions.checkPermissions()).camera), request: () => permissions.requestPermissions({permissions: ['camera']}), openSettings: () => device.openSettings({page: 'privacy'})},
      photos: {status: async () => {const access=startupPhotoAccess(await photos.scope());photoDescription.current=access.description;return access;},request: () => photos.requestAccess(),openSettings: () => device.openSettings({page:'privacy'})},
      calendar: {status: async () => permissionAccess((await calendar.checkPermissions()).calendar), request: () => calendar.requestAccess(), openSettings: () => device.openSettings({page: 'privacy'})},
      location: {status: async () => {const raw=await location.checkPermissions();const access=startupLocationAccess(raw);locationDescription.current=access.description;return {...access,requestable:raw.location!=='denied'};}, request: () => location.requestPermissions(), openSettings: () => device.openSettings({page: 'privacy'})},
    } as const;
    return Object.fromEntries(keys.map(key => [key, createStartupPermissionFlow(native ? nativeBridges[key] : browserStartupPermission(key as typeof startupPermissionKeys[number], {permissions: navigator.permissions, media: navigator.mediaDevices, geolocation: navigator.geolocation, notifications: typeof Notification === 'undefined' ? undefined : Notification}), {key: native ? key : 'browser'+key})])) as Record<PermissionKey, ReturnType<typeof createStartupPermissionFlow>>;
  });
  const [progress, setProgress] = useState(() => savedProgress(native));
  const [active, setActive] = useState(() => !!savedProgress(native));
  const [target, setTarget] = useState<PermissionKey | null>(null);
  // A Settings reopen of completed setup is a review: it can be left at once and never rewrites the durable marker.
  const [review, setReview] = useState(false);
  const progressRef = useRef(progress), targetRef = useRef<PermissionKey | null>(null), reviewRef = useRef(false);
  const [states, setStates] = useState<Record<PermissionKey, StartupPermissionState>>({notifications: 'checking', microphone: 'checking', camera: 'checking', location: 'checking', calendar: 'checking', photos: 'checking'});
  const [busy, setBusy] = useState(false);
  const [progressError, setProgressError] = useState(false);
  const [canSkip, setCanSkip] = useState(false);
  const [checkNotice, setCheckNotice] = useState('');
  const alive = useRef(false), actionPending = useRef(false), sequence = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const key = target ?? keys[progress?.step ?? 0];
  const state = states[key];
  const visible = (active || ready) && (enabled || reopened) && !connection.open && !googleOpen;
  const writeProgress = (value: Progress | null, choices = value?.choices ?? []) => {
    if (!reviewRef.current) try {
      writeStartupPermissionProgress(localStorage, {version: native ? 3 : 1, status: value ? 'pending' : 'completed', step: value?.step ?? keys.length, ...(choices.includes('skipped') ? {choices} : {})}, native);
      setProgressError(false);
    } catch { setProgressError(true); }
    // Browser storage may be blocked. Keep the current session usable without
    // claiming durable storage or treating a reviewed step as an OS grant.
    progressRef.current = value; setProgress(value);
    return true;
  };
  const changed = () => window.dispatchEvent(new Event('alpha:permissions-changed'));

  useEffect(() => { if (!enabled) ++sequence.current; }, [enabled, connection.cloudAccount?.credentialId]);
  useEffect(() => {
    if (!connection.setupRevision) return;
    ++sequence.current;setReopened(false);setTarget(null);targetRef.current=null;setReview(false);reviewRef.current=false;
    const resume=progressError?progressRef.current:savedProgress(native);setReady(showWalkthroughCompletion({accountCreated: connection.accountCreated, resumed: !!resume}));setActive(!!resume);if(resume)writeProgress(resume);
  }, [connection.setupRevision]);
  useEffect(() => {
    alive.current = true; let disposed = false;
    const refresh = async () => {
      const results = await Promise.all(keys.map(async key => {const value = await flows[key].refresh(); if (!disposed && value !== null) setStates(previous => ({...previous, [key]: value})); return value;}));
      if (!disposed && results.some(value => value !== null)) {
        // Access can change independently of the walkthrough. Refresh status,
        // but never reopen reviewed steps or undo an explicit skip.
        changed();
      }
    };
    void refresh();
    const resume = () => {if (!document.hidden && !actionPending.current) void refresh();};
    document.addEventListener('visibilitychange', resume);
    let listener: PluginListenerHandle | undefined;
    if (native) void permissions.addListener('appResumed', resume).then(handle => {if (disposed) void handle.remove(); else listener = handle;}).catch(() => {});
    return () => {disposed = true; alive.current = false; document.removeEventListener('visibilitychange', resume); void listener?.remove();};
  }, [flows, native]);
  useEffect(() => {
    const reopen = (event: Event) => {
      const selected = (event as CustomEvent<{permission?: unknown}>).detail?.permission;
      if (selected !== undefined && (typeof selected !== 'string' || !keys.includes(selected as PermissionKey))) return;
      ++sequence.current;
      targetRef.current = typeof selected === 'string' && keys.includes(selected as PermissionKey) ? selected as PermissionKey : null;
      setTarget(targetRef.current);
      const resume=savedProgress(native);reviewRef.current=resume===null;setReview(reviewRef.current);
      if (!selected) {if(!writeProgress(resume??{version:3 as const,step:0,choices:[]}))return;}
      setReopened(true);setReady(false);
      setActive(true);
      void Promise.all(keys.map(async key => {const value = await flows[key].refresh(); if (alive.current && value !== null) setStates(previous => ({...previous, [key]: value}));}));
    };
    window.addEventListener('alpha:setup-permissions', reopen);window.addEventListener(STARTUP_PERMISSIONS_REOPEN,reopen);
    return () => {window.removeEventListener('alpha:setup-permissions', reopen);window.removeEventListener(STARTUP_PERMISSIONS_REOPEN,reopen);};
  }, [flows]);
  useLayoutEffect(() => {
    const panel = dialog.current;
    if (visible && panel && !panel.open) panel.showModal();
    return () => {if (panel?.open) panel.close();};
  }, [visible]);
  useLayoutEffect(() => {
    if (!visible) return;
    const panel = dialog.current, phone = document.querySelector<HTMLElement>('.os');
    if (panel && phone) {const theme = getComputedStyle(phone); for (const token of ['bg', 'fg', 's2', 'line', 'mut', 'acc']) panel.style.setProperty(`--connection-${token}`, theme.getPropertyValue(token==='acc'?'--acct':`--${token}`));}
    const back = (event: Event) => {event.preventDefault(); event.stopImmediatePropagation(); if (reviewRef.current) close();};
    window.addEventListener('alpha-back', back, true);
    return () => window.removeEventListener('alpha-back', back, true);
  }, [visible]);

  useEffect(() => {if (visible && !target && progress) writeProgress(progress);}, [visible, target, progress]);

  useEffect(() => {
    setCanSkip(false);setCheckNotice('');
    if (!visible || ready) return;
    const timer = setTimeout(() => setCanSkip(true), 20_000);
    return () => clearTimeout(timer);
  }, [key, visible, ready]);

  useEffect(() => {if (visible) dialog.current?.querySelector<HTMLHeadingElement>('h2')?.focus({preventScroll: true});}, [key, visible, ready]);

  function advance(choice: Progress['choices'][number]) {
    if (target) {setActive(false); return;}
    const current = progress ?? {version: 3 as const, step: 0, choices: []};
    if (current.step + 1 < keys.length) writeProgress({version: 3, step: current.step + 1, choices: [...current.choices, choice]});
    else {writeProgress(null, [...current.choices, choice]);setActive(false);setReady(true);}
  }
  function skip() {
    if (!canSkip) return;
    ++sequence.current;flows[key].cancel();actionPending.current=false;setBusy(false);
    advance('skipped');
  }
  /** Leaves a review at any step. Completed setup stays completed; a pending request is retired, not granted. */
  function close() {
    if (!reviewRef.current) return;
    ++sequence.current;flows[targetRef.current ?? keys[progressRef.current?.step ?? 0]].cancel();actionPending.current=false;setBusy(false);
    setActive(false);setReady(false);setReopened(false);setTarget(null);targetRef.current=null;progressRef.current=null;setProgress(null);
  }
  async function allow() {
    if (actionPending.current) return;
    if (target && !native && state === 'ready') {advance('continued'); return;}
    actionPending.current = true; setBusy(true);setCheckNotice('');
    const ticket = sequence.current;
    try {
      let value: StartupPermissionState | null;
      if (target && native && state === 'ready') {await device.openSettings({page: key === 'notifications' ? 'notifications' : 'privacy'}); value = await flows[key].refresh();}
      else value = state === 'unavailable' || (!native && state === 'settings') ? await flows[key].refresh() : await flows[key].enable();
      if (alive.current && ticket === sequence.current && value !== null) {
        setStates(previous => ({...previous, [key]: value})); changed();
        if (value === 'ready' && !target) advance(state === 'ready' ? 'continued' : 'allowed');
        else if (!native && value !== 'ready') setCheckNotice(value === 'settings' ? 'Access is still off. Change it using the site controls.' : 'This browser could not confirm access.');
      }
    } catch {if (alive.current && ticket === sequence.current) setStates(previous => ({...previous, [key]: 'unavailable'}));}
    finally {if (ticket === sequence.current) {actionPending.current = false; if (alive.current) setBusy(false);}}
  }
  function finish() {
    if(actionPending.current)return;
    // Completing the walkthrough records choices, never permission authority.
    // Each feature still checks current OS/browser access when it is used.
    writeStartupPermissionMemory({dismissed:true});setActive(false);setReady(false);
    try{sessionStorage.setItem(dismissedKey,'1');}catch{}
    if(!reopened)window.dispatchEvent(new Event('launcher-home'));
  }
  if (!visible) return null;
  if(ready)return <dialog ref={dialog} className="alpha-startup-permissions" aria-label="You’re all set" onCancel={event=>{event.preventDefault();close();}}><div className="alpha-permission-content">
    <span className="alpha-permission-icon" aria-hidden="true"><span style={iconStyle('check')}/></span><h2 className="serif" tabIndex={-1}>You’re all set</h2>
    <p>{progressError ? 'Your choices apply for this session. This browser could not save setup progress.' : 'Your choices are saved.'}</p>
    {/* A missing plan is known at admission. Setup does not wait for the agent to start, so this notice does not either. */}
    {(connection.residentPlanNotice==='needs-plan'||connection.residentInference&&connection.residentInference!=='cloud')&&<p role="status" className="alpha-permission-status">{connection.residentPlanNotice==='needs-plan'?'AI needs an active Cloud plan. Manage it in Settings.':'AI is not ready yet. Check your connection in Settings.'}</p>}
    {connection.error&&<p role="alert" className="alpha-permission-status">{connection.error}</p>}
    {connection.message?.includes('did not confirm revoking')&&<p role="status" className="alpha-permission-status">{connection.message}</p>}
    {connection.accountCreated&&<p role="status" className="alpha-permission-status">This sign-in created a new {cloudServiceName(connection.cloudAccount?.environment ?? 'production')} account{connection.cloudAccount?.email?` (${connection.cloudAccount.email})`:''}.</p>}
    {progressError&&<p role="alert" className="alpha-permission-status">Setup progress could not be saved. Try again.</p>}
    <div className="alpha-permission-actions"><button type="button" className="alpha-permission-primary" disabled={busy} onClick={()=>void finish()}>{busy?'Checking…':'Go to Alpha'}</button></div>
  </div></dialog>;
  const info = details[key];
  const primary = busy ? 'Checking…' : target && native && (state === 'ready' || state === 'settings') ? 'Open Android settings' : target && !native && state === 'ready' ? 'Done' : state === 'ready' ? 'Continue' : state === 'settings' ? native ? 'Open Android settings' : 'Check access' : state === 'unavailable' ? 'Try again' : 'Allow';
  return <dialog ref={dialog} className="alpha-startup-permissions" aria-labelledby="alpha-permission-title" aria-describedby="alpha-permission-description" onCancel={event => {event.preventDefault(); close();}}>
    <div className="alpha-permission-content" key={key}>
      <span className="alpha-permission-icon" aria-hidden="true"><span style={iconStyle(info.icon)}/></span>
      <h2 id="alpha-permission-title" className="serif" tabIndex={-1}>{info.title}</h2>
      <p id="alpha-permission-description">{native ? info.description : info.browser}</p>
      {state === 'ready' && <p className="alpha-permission-status" role="status">{native&&key==='location'?locationDescription.current:native&&key==='photos'?photoDescription.current:'Access is allowed.'}{target && !native ? ' Change it using the site controls in the address bar.' : ''}</p>}
      {state === 'settings' && !checkNotice && <p className="alpha-permission-status" role="status">{native ? 'Access is off. You can change it in Android settings.' : 'Review access using the site controls in the address bar.'}</p>}
      {state === 'unavailable' && !checkNotice && <p className="alpha-permission-status" role="status">Access could not be confirmed. {native ? 'Check Android app settings.' : 'Check the site controls in the address bar.'}</p>}
      {progressError && <p className="alpha-permission-status" role="alert">Setup progress could not be saved. Try again.</p>}
      {checkNotice && <p className="alpha-permission-status" role="status">{checkNotice}{canSkip && !target ? ' You can skip this step for now.' : ''}</p>}
      <div className="alpha-permission-actions"><button className="alpha-permission-primary" type="button" disabled={busy || state === 'checking'} onClick={() => void allow()}>{state === 'checking' ? 'Checking…' : primary}</button>{canSkip && (!target || busy) && <button className="alpha-permission-skip" type="button" onClick={skip}>Skip for now</button>}{target && !( !native && state === 'ready') && <button className="alpha-permission-skip" type="button" disabled={busy} onClick={() => advance('continued')}>Done</button>}{review && !target && <button className="alpha-permission-skip" type="button" onClick={close}>Close</button>}</div>
    </div>
  </dialog>;
}
