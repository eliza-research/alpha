import {gmailBackgroundStatus,gmailNotificationSettings,GMAIL_BACKGROUND_CHANGED,type GmailBackgroundStatus} from './gmail-background';
import {isAndroid} from '../native';
import {googleAccountAccessLabel} from './gmail-grants';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {holdPhoneInert} from './modal-inert';
import {connectionController} from './connection-ui';
import {createGoogleAccounts,GOOGLE_ACCOUNTS_CHANGED,googleDisconnectConfirmation,googleDisconnectMessage} from './google-accounts';
import type {GoogleCalendarBinding} from './google-calendar';
import {clearGoogleCalendarPrefsForConnection} from './google-calendar-selection';
import {googleConnect,googleConnectNote} from './google-connect-flow';
import {cloudServiceName,type GmailAccount} from './cloud-protocol';
let opened=false;const listeners=new Set<()=>void>();
export const googleConnectionController={open(){opened=true;for(const listener of listeners)listener();},close(){opened=false;for(const listener of listeners)listener();},subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},getSnapshot:()=>opened};
export function googleCalendarAccountKey(){const account=connectionController.getSnapshot().cloudAccount;return account?.organizationId?{environment:account.environment,userId:account.userId,organizationId:account.organizationId}:null;}
export function currentGoogleCalendarBinding(connectionId:string):GoogleCalendarBinding|null{const cloud=connectionController.getCloudClient(),account=connectionController.getSnapshot().cloudAccount;if(!cloud||!account?.organizationId)return null;return {...account,organizationId:account.organizationId,connectionId};}
/** Only a Gmail alert state the owner can act on is shown; normal watching shows nothing. */
export function gmailAlertLine(value:GmailBackgroundStatus):string{
 if(value.status==='disabled'||value.status==='grant-unavailable')return 'Open Inbox to finish setting up Gmail alerts.';
 return value.notificationsAllowed===false?'Gmail notifications are off.':'';
}
/** One connection manager for Settings, Inbox and Calendar; provider grants remain in Cloud. Calendar
 * visibility is chosen in Calendar itself, so this panel lists accounts only. */
export function GoogleConnectionsPanel(){
 const open=useSyncExternalStore(googleConnectionController.subscribe,googleConnectionController.getSnapshot);
 const connection=useSyncExternalStore(connectionController.subscribe,connectionController.getSnapshot);
 const [background,setBackground]=useState(''),[settingsError,setSettingsError]=useState('');
 useEffect(()=>{if(!open)return;let alive=true;const read=()=>void gmailBackgroundStatus().then(value=>{if(alive)setBackground(gmailAlertLine(value));},()=>{if(alive)setBackground('');});read();window.addEventListener(GMAIL_BACKGROUND_CHANGED,read);return()=>{alive=false;window.removeEventListener(GMAIL_BACKGROUND_CHANGED,read);};},[open]);
 const [accounts,setAccounts]=useState<GmailAccount[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[confirm,setConfirm]=useState<GmailAccount|null>(null),[revision,setRevision]=useState(0);
 const active=useRef<AbortController|null>(null),panel=useRef<HTMLDivElement>(null);
 // A disconnect announces the change, which reloads the list; its result line stays through that reload.
 const keepNotice=useRef(false);
 const cloud=connectionController.getCloudClient(),key=googleCalendarAccountKey();
 const serviceName=cloudServiceName(cloud?.client.environment ?? connection.cloudAccount?.environment ?? 'production');
 const identity=JSON.stringify([connection.cloudAccount,cloud?.sessionId,cloud?.credentialId]);
 async function load(){
  active.current?.abort();const abort=active.current=new AbortController();setAccounts([]);setConfirm(null);
  if(!cloud||!key){setBusy(false);setNotice('');return;}
  const current=()=>!abort.signal.aborted&&connectionController.getCloudClient()?.sessionId===cloud.sessionId&&connectionController.getCloudClient()?.credentialId===cloud.credentialId;
  setBusy(true);if(keepNotice.current)keepNotice.current=false;else setNotice('');
  try{
   const rows=await createGoogleAccounts(cloud,()=>connectionController.getCloudClient()).list(abort.signal);if(!current())return;setAccounts(rows);
  }catch(error){if(current()){connectionController.rejectCloudSession(cloud.sessionId,error);setNotice('Google accounts could not be loaded.');}}
  finally{if(active.current===abort)setBusy(false);}
 }
 useEffect(()=>{if(!open)return;void load();return()=>{active.current?.abort();};},[open,identity,revision]);
 // Grant changes reload the account list.
 useEffect(()=>{if(!open)return;const accountsChanged=()=>setRevision(value=>value+1);window.addEventListener(GOOGLE_ACCOUNTS_CHANGED,accountsChanged);return()=>{window.removeEventListener(GOOGLE_ACCOUNTS_CHANGED,accountsChanged);};},[open]);
 useEffect(()=>{
  if(!open)return;
  const element=panel.current,previous=document.activeElement,phone=document.querySelector<HTMLElement>('.os');
  const releaseInert=holdPhoneInert(phone);
  if(phone&&element){const theme=getComputedStyle(phone);for(const token of ['bg','fg','s2','line','mut','acc'])element.style.setProperty(`--connection-${token}`,theme.getPropertyValue(token==='acc'?'--acct':`--${token}`));}
  element?.focus();
  const back=(event:Event)=>{if(document.querySelector('dialog[open]'))return;event.preventDefault();event.stopImmediatePropagation();active.current?.abort();googleConnectionController.close();};
  const keydown=(event:KeyboardEvent)=>{if(event.key==='Escape'){back(event);return;}if(event.key==='Tab'&&element){const items=[...element.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],summary')];if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0]?.focus();}}};
  window.addEventListener('alpha-back',back,true);document.addEventListener('keydown',keydown);
  return()=>{window.removeEventListener('alpha-back',back,true);document.removeEventListener('keydown',keydown);releaseInert();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};
 },[open]);
 const connecting=useSyncExternalStore(googleConnect.subscribe,googleConnect.getSnapshot)==='waiting';
 // One upgrade offer when any connected account lacks sending or calendar changes.
 const upgrade=accounts.some(account=>account.connected&&(!account.grantedCapabilities.includes('google.gmail.send')||!account.grantedCapabilities.includes('google.calendar.write')));
 /** One consent for everything Alpha uses; the panel reloads when Alpha is back in front. */
 function connect(){if(!cloud){googleConnectionController.close();connectionController.openCloudAccount();return;}void googleConnect.start();}
 async function disconnect(account:GmailAccount){if(!cloud||!key||!account.connectionId)return;active.current?.abort();const abort=active.current=new AbortController();setBusy(true);setConfirm(null);try{const result=await createGoogleAccounts(cloud,()=>connectionController.getCloudClient()).disconnect(account.connectionId,abort.signal);if(result.outcome==='disconnected')clearGoogleCalendarPrefsForConnection(key,account.connectionId);keepNotice.current=true;setNotice(googleDisconnectMessage(result.outcome,account.label));setAccounts(result.accounts||[]);}catch(error){if(!abort.signal.aborted){connectionController.rejectCloudSession(cloud.sessionId,error);setNotice('Couldn’t confirm the disconnect. Close and reopen Google accounts to check, then try again.');}}finally{if(active.current===abort)setBusy(false);}}
 if(!open)return null;
 const icon={width:20,height:20,display:'inline-block',background:'currentColor',mask:'url(/icons/lucide/x.svg) center / contain no-repeat',WebkitMask:'url(/icons/lucide/x.svg) center / contain no-repeat'};
 return <div className="alpha-connection-scrim"><div className="alpha-connection alpha-google-connections" role="dialog" aria-modal="true" aria-labelledby="google-connections-title" tabIndex={-1} ref={panel}>
  <header><h2 id="google-connections-title">Google accounts</h2><button aria-label="Close Google accounts" onClick={()=>{active.current?.abort();googleConnectionController.close();}}><span aria-hidden="true" data-alpha-icon="/icons/lucide/x.svg" style={icon}/></button></header>
  {(notice||googleConnectNote())&&<p role="status">{notice||googleConnectNote()}</p>}
  {background&&<p role="status">{background}</p>}
  {settingsError&&<p role="alert">{settingsError}</p>}
  {isAndroid&&<button onClick={()=>{setSettingsError('');void gmailNotificationSettings().catch(()=>setSettingsError('Couldn’t open notification settings.'));}}>Gmail notification settings</button>}
  {accounts.filter(account=>account.connected).map(account=>{const access=googleAccountAccessLabel(account);return <section className="alpha-connection-current alpha-google-account" key={account.connectionId}><strong>{account.label}</strong>{access&&<span>{access}</span>}<button className="alpha-google-disconnect" aria-label={`Disconnect Google account ${account.label}`} disabled={busy} onClick={()=>setConfirm(account)}>Disconnect</button></section>;})}
  {upgrade&&<div className="alpha-connection-actions"><button disabled={busy||connecting} onClick={connect}>Update Google access</button></div>}
  {confirm&&<section role="alert"><p style={{whiteSpace:'pre-line'}}>{googleDisconnectConfirmation(confirm.label,serviceName)}</p><div className="alpha-connection-actions alpha-google-confirm"><button className="alpha-google-confirm-disconnect" disabled={busy} onClick={()=>void disconnect(confirm)}>Disconnect</button><button className="alpha-connection-cancel" disabled={busy} onClick={()=>setConfirm(null)}>Cancel</button></div></section>}
  <div className="alpha-connection-actions"><button className={upgrade?'alpha-connection-cancel':undefined} disabled={busy||connecting} onClick={connect}>{cloud?(connecting?'Connecting…':accounts.some(account=>account.connected)?'Add Google account':'Connect Google'):`Sign in to ${serviceName}`}</button>{connecting&&<button className="alpha-connection-cancel" onClick={()=>googleConnect.cancel()}>Cancel</button>}</div>
 </div></div>;
}
