import {layoutBrowserDialog} from './dialog-layout';
import {browserDevProfile} from './dev-profile';
import {passwordProviderStatus,openPasswordProvider} from './password-provider';
import {focusActive} from './focus-state';
import {installBrowserAudioSettings} from './audio-settings';
import {installBrowserDisplay,applyBrowserDisplay} from './display';
import { browserApps } from './apps';
import { WebPlugin } from '@capacitor/core';
import {deviceRolesDocument} from './preference-documents';
import {initialDevicePreferences,cachedDevicePreferences,devicePreferencesStatus,readDevicePreferences,editDevicePreferences,initializeDevicePreferences} from './device-preferences';
import {beginNoticeAction,noticeActionBlocked} from './notice-action';
import {devSurfacesEnabled,testMocksEnabled} from '../build-flags';
declare const __APP_VERSION__:string;
const appVersion=typeof __APP_VERSION__==='string'&&__APP_VERSION__?__APP_VERSION__:'Unavailable';
/** Browsers do not report the device's Wi-Fi, Bluetooth or cellular transport, uptime or roles. */
const rolesUnavailable='Device roles are managed by the operating system, not this browser.';
type BrowserBattery={level:number;charging:boolean};
/**
 * Real browser facts only: the Battery Status API where the browser offers it, and
 * navigator.onLine. Seeded battery and network values exist only in test-mocks builds,
 * where development device controls simulate them.
 */
export async function browserDeviceFacts():Promise<Record<string,unknown>>{
 const facts:Record<string,unknown>={online:navigator.onLine};
 try{
  const getBattery=(navigator as Navigator&{getBattery?:()=>Promise<BrowserBattery>}).getBattery;
  const battery=typeof getBattery==='function'?await getBattery.call(navigator):null;
  if(battery&&Number.isFinite(battery.level)&&battery.level>=0&&battery.level<=1){facts.batteryPercent=Math.round(battery.level*100);facts.charging=battery.charging===true;}
 }catch{/* Not offered by this browser. */}
 return facts;
}
// Device-settings recovery copy. Development builds point at Device controls;
// product builds open the recovery dialog from the settings page itself.
const settingsRecoveryMessage=devSurfacesEnabled?'Device settings need recovery. Open Device controls.':'Device settings need recovery.';
const openSettingsRecovery=()=>void import('./preference-recovery').then(m=>m.openDevicePreferencesRecovery());
const initial=initialDevicePreferences;
let settingsEpoch=0;
const validateRoles=(roles:Record<string,boolean>)=>{if(!roles||typeof roles!=='object'||Array.isArray(roles)||Object.values(roles).some(value=>typeof value!=='boolean'))throw Error('Device roles need recovery.');return roles;};
export const browserDeviceState=()=>{const state=cachedDevicePreferences()??{...initial(),wifiActive:false,bluetoothActive:false,cellularActive:false,microphoneEnabled:false,locationEnabled:false,doNotDisturb:true,music:0,ring:0,alarm:0};return {...state,doNotDisturb:state.doNotDisturb||focusActive(),deviceSettingsStatus:devicePreferencesStatus()};};
export class BrowserDevice extends WebPlugin {
 constructor(){super();initializeDevicePreferences();installBrowserAudioSettings();installBrowserDisplay();const apply=()=>{applyBrowserDisplay(cachedDevicePreferences()??initial());};apply();window.addEventListener('alpha:device-settings',apply);}
 async setBrightness(input:{percent:number}){if(!Number.isFinite(input.percent))throw Error('Choose a brightness value.');const percent=Math.max(0,Math.min(100,Math.round(input.percent)));await editDevicePreferences(data=>{data.brightness=percent;});applyBrowserDisplay(await readDevicePreferences());window.dispatchEvent(new Event('alpha:device-settings'));return {brightness:percent};}

 async setNetwork(input:{field:'wifiActive'|'bluetoothActive'|'cellularActive'|'airplaneMode';enabled?:boolean}){
  if(!['wifiActive','bluetoothActive','cellularActive','airplaneMode'].includes(input.field)||input.enabled!==undefined&&typeof input.enabled!=='boolean')throw Error('Choose a network control.');
  await editDevicePreferences(data=>{const enabled=input.enabled??!data[input.field];
   if(input.field==='airplaneMode'){
    if(enabled&&!data.airplaneMode){data.preAirplane={wifiActive:data.wifiActive,bluetoothActive:data.bluetoothActive,cellularActive:data.cellularActive};data.wifiActive=data.bluetoothActive=data.cellularActive=false;}
    else if(!enabled&&data.airplaneMode&&data.preAirplane){Object.assign(data,data.preAirplane);data.preAirplane=null;}
    data.airplaneMode=enabled;
   }else{if(input.field==='cellularActive'&&enabled&&data.airplaneMode)throw Error('Turn off airplane mode before enabling mobile data.');data[input.field]=enabled;}
  });window.dispatchEvent(new Event('alpha:device-settings'));window.dispatchEvent(new Event('focus'));return browserDeviceState();
 }
 async setSensor(input:{field:'microphoneEnabled'|'locationEnabled'|'doNotDisturb';enabled?:boolean}){
  if(!['microphoneEnabled','locationEnabled','doNotDisturb'].includes(input.field)||input.enabled!==undefined&&typeof input.enabled!=='boolean')throw Error('Choose a sensor control.');
  await editDevicePreferences(data=>{data[input.field]=input.enabled??!(data[input.field]??initial()[input.field]);});window.dispatchEvent(new Event('alpha:device-settings'));window.dispatchEvent(new Event('focus'));return browserDeviceState();
 }
 async getStatus(){if(!testMocksEnabled)throw Error(rolesUnavailable);const roles=validateRoles(await deviceRolesDocument.read<Record<string,boolean>>(()=>({})));return {packageName:'ai.elizaresearch.alphaphone',roles:['home','assistant','dialer','sms'].map(role=>({role,androidRole:role,held:!!roles[role],holders:roles[role]?['ai.elizaresearch.alphaphone']:[],available:true}))};}
 async requestRole(input:{role:string}){if(!testMocksEnabled)throw Error(rolesUnavailable);if(!['home','assistant','dialer','sms'].includes(input.role))throw Error('Choose a device role.');await deviceRolesDocument.edit<Record<string,boolean>,void>(()=>({}),roles=>{validateRoles(roles);roles[input.role]=true;});window.dispatchEvent(new Event('focus'));return {role:input.role,held:true,resultCode:-1};}
 async snapshot(){
  const permissionStates:Record<string,string>={};for(const [label,name] of [['Camera','camera'],['Microphone','microphone'],['Location','geolocation']]){try{permissionStates[label]=(await navigator.permissions.query({name:name as PermissionName})).state;}catch{permissionStates[label]='unknown';}}
  const permissions=Object.fromEntries(Object.entries(permissionStates).map(([name,state])=>[name,state==='granted'])),locationAccess=permissionStates.Location==='granted'?'browser':'none';
  const common={readAt:Date.now(),model:devSurfacesEnabled?'Browser development device':'Web browser',appVersion,androidRelease:'Browser',build:devSurfacesEnabled?'Development':'Managed by your browser',securityPatch:'Browser managed',permissionStates,permissions,locationAccess};
  // Text size is this app's own setting; battery and transports below are real or absent.
  if(!testMocksEnabled){const state=await readDevicePreferences().catch(()=>null);return {...await browserDeviceFacts(),...common,...(state?{textScalePercent:state.textScalePercent}:{})};}
  const state=await readDevicePreferences();return {...state,doNotDisturb:state.doNotDisturb||focusActive(),...(browserDevProfile?{passwordProvider:await passwordProviderStatus()}:{}),...common};
 }

 async openPasswordProvider(input:{action:string}){return openPasswordProvider(input.action);}
 async setTextScale(input:{percent:number}){if(!Number.isFinite(input.percent))throw Error('Choose a text size.');const percent=Math.max(75,Math.min(150,Math.round(input.percent)));await editDevicePreferences(data=>{data.textScalePercent=percent;});applyBrowserDisplay(await readDevicePreferences());return {textScalePercent:percent,effectiveTextZoom:percent};}
 async getDeviceSettings(){const data=await readDevicePreferences();return {volumes:['music','ring','alarm'].map(stream=>({stream,current:data[stream as 'music'],max:100}))};}
 async openSettings(input:{page:string}={page:'device'}) {
  const epoch=++settingsEpoch,opening=beginNoticeAction();let state:ReturnType<typeof browserDeviceState>;
  try{let saved:Awaited<ReturnType<typeof readDevicePreferences>>;try{saved=await readDevicePreferences(opening.signal);}catch(error){if(!devSurfacesEnabled&&epoch===settingsEpoch&&!opening.signal.aborted&&devicePreferencesStatus()==='unavailable')openSettingsRecovery();throw error;}if(epoch!==settingsEpoch||opening.signal.aborted||noticeActionBlocked())throw Error('Settings opening cancelled.');state={...saved,doNotDisturb:saved.doNotDisturb||focusActive(),deviceSettingsStatus:'ready'};}finally{opening.dispose();}
  document.querySelector<HTMLDialogElement>('[data-browser-settings]')?.close();
  const dialog=document.createElement('dialog');dialog.dataset.browserSettings='true';dialog.setAttribute('aria-label',`${input.page} settings`);dialog.style.cssText='border:0;border-radius:18px;padding:24px;width:min(320px,85vw);background:var(--bg,#fff);color:var(--fg,#111);font:16px system-ui';
  const title=document.createElement('h2');title.textContent=input.page[0].toUpperCase()+input.page.slice(1);dialog.append(title);
  const status=document.createElement('p'),inputs=new Map<string,HTMLInputElement>();status.setAttribute('role','status');
  // Simulated network, sensor and battery controls exist only in test-mocks builds.
  const fields:Record<string,(keyof ReturnType<typeof initial>)[]>=testMocksEnabled?{privacy:['microphoneEnabled','locationEnabled'],wifi:['wifiActive','airplaneMode'],bluetooth:['bluetoothActive'],mobile:['cellularActive'],battery:['powerSave','batteryPercent','charging'],sound:['music','ring','alarm','doNotDisturb'],display:['brightness','textScalePercent']}:{sound:['music','ring','alarm','doNotDisturb'],display:['brightness','textScalePercent']};
  for(const keyName of fields[input.page]||[]){const label=document.createElement('label'),control=document.createElement('input');label.style.cssText='display:flex;justify-content:space-between;align-items:center;margin:16px 0;gap:12px';inputs.set(keyName,control);label.textContent=keyName.replace(/([A-Z])/g,' $1');control.type=typeof state[keyName]==='boolean'?'checkbox':'range';if(control.type==='checkbox')control.checked=state[keyName] as boolean;else{label.style.flexDirection='column';label.style.alignItems='stretch';control.style.width='100%';control.style.minWidth='0';control.min=keyName==='textScalePercent'?'75':'0';control.max=keyName==='textScalePercent'?'150':'100';control.value=String(state[keyName]);}control.onchange=async()=>{control.disabled=true;try{if(['microphoneEnabled','locationEnabled','doNotDisturb'].includes(keyName))await this.setSensor({field:keyName as 'microphoneEnabled',enabled:control.checked});else if(['wifiActive','bluetoothActive','cellularActive','airplaneMode'].includes(keyName))await this.setNetwork({field:keyName as 'wifiActive',enabled:control.checked});else await editDevicePreferences(data=>{Object.assign(data,{[keyName]:control.type==='checkbox'?control.checked:Number(control.value)});});applyBrowserDisplay(await readDevicePreferences());window.dispatchEvent(new Event('alpha:device-settings'));window.dispatchEvent(new Event('focus'));status.textContent='';}catch{const saved=await readDevicePreferences().catch(()=>null);if(!saved){status.textContent=settingsRecoveryMessage;recover.hidden=devSurfacesEnabled;return;}if(control.type==='checkbox')control.checked=saved[keyName] as boolean;else control.value=String(saved[keyName]);status.textContent='The setting could not be confirmed. Reopen settings to check.';}finally{control.disabled=false;}};label.append(control);dialog.append(label);}
  if(!fields[input.page]){const text=document.createElement('p');text.textContent=input.page==='privacy'?'Camera, microphone and location permissions are managed by your browser.':'Managed by your browser';dialog.append(text);}
  const sync=()=>{const saved=browserDeviceState();if(saved.deviceSettingsStatus!=='ready'){status.textContent=settingsRecoveryMessage;recover.hidden=devSurfacesEnabled;return;}for(const [field,control] of inputs){if(control.disabled)continue;const value=saved[field as keyof typeof saved];if(control.type==='checkbox')control.checked=!!value;else control.value=String(value);}};window.addEventListener('alpha:device-settings',sync);
  dialog.append(status);
  const recover=document.createElement('button');recover.textContent='Recover device settings';recover.hidden=true;recover.onclick=()=>{dialog.close();openSettingsRecovery();};dialog.append(recover);
  const close=document.createElement('button');close.textContent='Done';close.onclick=()=>dialog.close();dialog.append(close);const previous=document.activeElement as HTMLElement|null;const back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();dialog.close();};window.addEventListener('alpha-back',back,true);dialog.onclose=()=>{window.removeEventListener('alpha:device-settings',sync);window.removeEventListener('alpha-back',back,true);dialog.remove();previous?.focus();window.dispatchEvent(new Event('focus'));};layoutBrowserDialog(dialog,[close]);document.body.append(dialog);dialog.showModal();return {status:'opened'};
 }
 async list(){return {apps:browserApps.map(({view,...app})=>app)};}
 async launch(input:{packageName:string}){const app=browserApps.find(app=>app.packageName===input.packageName);if(!app)throw Error('Choose an installed development app.');window.dispatchEvent(new CustomEvent('alpha:browser-open-view',{detail:app.view}));}
 /** The development device as ElizaSystem's launcher methods, so the browser and Android share one
  * launcher bridge (createSystemLauncherBridge). */
 async listLauncherApps(){return this.list();}
 async launchApp(input:{packageName:string}){return this.launch(input);}
 async buildInfo(){return {launcher:false,version:appVersion};}
 async getBuildInfo(){return this.buildInfo();}
}
