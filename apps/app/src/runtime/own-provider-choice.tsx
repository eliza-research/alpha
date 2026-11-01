import {useRef,useState} from 'react';
import {Capacitor} from '@capacitor/core';
import {browserCloudResidentEnabled} from './browser-cloud-resident';
import type {LocalProviderStatus} from './local-agent';

/** One explicit choice; key values live only in the submitted form and native credential vault. */
export function OwnProviderChoice({busy,status,onSave,onCloud}:{busy:boolean;status?:LocalProviderStatus|null;onSave:(key:string,voice?:string)=>Promise<void>;onCloud:()=>Promise<void>}){
 const [editing,setEditing]=useState(false),[switching,setSwitching]=useState(false);
 const ai=useRef<HTMLInputElement>(null),speech=useRef<HTMLInputElement>(null);
 const own=status?.selected===true&&status.provider==='cerebras';
 const native=Capacitor.isNativePlatform(),host=native||browserCloudResidentEnabled;
 return <section aria-label="AI provider">
  <h3>AI provider</h3>
  <p>{own?'Own API keys · Cerebras':status?.provider==='elizacloud'?'Cloud':'Choose Cloud or your own API keys.'}</p>
  <div className="alpha-connection-actions">
   <button type="button" disabled={busy} aria-pressed={!own&&!editing} onClick={()=>{setEditing(false);if(own)setSwitching(true);}}>Cloud</button>
   <button type="button" disabled={busy} aria-pressed={own||editing} onClick={()=>{setSwitching(false);setEditing(true);}}>Own API keys</button>
  </div>
  {switching&&<div><p>Switch to your saved Cloud account? Your conversations and phone data stay. You will need to enter your own keys again to switch back.</p><button disabled={busy} onClick={()=>{setSwitching(false);void onCloud();}}>Switch to Cloud</button><button disabled={busy} onClick={()=>setSwitching(false)}>Keep own keys</button></div>}
  {own&&!editing&&<p>{status.voiceConfigured?'Voice uses your Cartesia key when you start the microphone.':'Voice is off. Add a Cartesia key to configure voice.'}</p>}
  {editing&&<>
   <p>Cerebras receives prompts and selected context. Optional Cartesia voice receives recordings and reply text. Provider charges use your own accounts. Switching is manual; failed requests never switch providers.</p>
   {!host?<p role="status">Own API keys need Android secure storage. This browser cannot save or activate provider keys.</p>:<form onSubmit={event=>{event.preventDefault();const key=ai.current?.value||'',voice=speech.current?.value||'';if(ai.current)ai.current.value='';if(speech.current)speech.current.value='';void onSave(key,voice||undefined);}}>
    <label>Cerebras API key<input ref={ai} type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} required disabled={busy}/></label>
    <label>Cartesia API key (optional)<input ref={speech} type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy}/></label>
    <p>{native?'Keys are stored with Android Keystore.':'Keys stay in this host session memory only and are lost when the host closes. They are not saved in the browser.'} Save checks the Cerebras model list; it does not send a chat or a voice request. Cartesia is saved without a live check.</p>
    <button disabled={busy}>Save and use own keys</button><button type="button" disabled={busy} onClick={()=>{if(ai.current)ai.current.value='';if(speech.current)speech.current.value='';setEditing(false);}}>Cancel</button>
   </form>}
  </>}
 </section>;
}
