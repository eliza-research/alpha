import type {ElizaPasswordsPlugin,PasswordEntrySummary,PasswordSaveInput,PasswordsStatus} from '../../../../vendor/eliza/plugins/plugin-native-passwords/src/definitions.ts';
import {normalizeWebsite} from '../../../../vendor/eliza/plugins/plugin-native-passwords/src/bindings.ts';
import {layoutBrowserDialog} from '../browser/dialog-layout';

/**
 * Development vault for the browser development profile only (ELIZA_DEV_ALLOW_TEST_MOCKS=1,
 * development server, ?mode=dev). In-memory synthetic records, simulated unlock and simulated
 * autofill selection: no Keystore, no system prompt, nothing persisted. It honours the native
 * contract exactly: no method resolves with a password.
 */
type Record_={id:string;label:string;username:string;bindings:string[];secret:string;updatedAt:number};
const UNLOCK_MS=60_000;
const fail=(code:string,message:string)=>Object.assign(new Error(message),{code});
const display=(facet:string)=>facet.replace(/^https:\/\//,'');

export function createDevelopmentVault():ElizaPasswordsPlugin & {readonly selection:string;expire():void}{
 const records=new Map<string,Record_>();
 let unlockedUntil=0,selected:'none'|'this-app'='none',sequence=0;
 const seed=(label:string,username:string,origin:string)=>{const id=`dev-${++sequence}`;records.set(id,{id,label,username,bindings:[origin],secret:`synthetic-dev-${sequence}-not-real`,updatedAt:Date.now()});};
 seed('Example sign-in','alex@example.test','https://example.test');
 seed('Library account','reader@example.test','https://library.example.test');
 const unlocked=()=>Date.now()<unlockedUntil;
 const need=()=>{if(!unlocked())throw fail('locked','Unlock saved passwords first');};
 const summary=(r:Record_):PasswordEntrySummary=>({id:r.id,label:r.label,username:r.username,updatedAt:r.updatedAt,bindings:r.bindings.map(facet=>({kind:'web' as const,facet,display:display(facet)}))});
 const surface=(title:string,text:string)=>{
  const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Development vault secret');
  dialog.style.cssText='box-sizing:border-box;width:min(92vw,360px);border:0;border-radius:20px;padding:22px;background:var(--bg,#fff);color:var(--fg,#111);font:16px system-ui';
  const heading=document.createElement('h2');heading.textContent=title;
  const value=document.createElement('p');value.textContent=text;value.style.fontFamily='monospace';
  const close=document.createElement('button');close.type='button';close.textContent='Hide';close.style.cssText='width:100%;min-height:44px;font:inherit';
  const done=()=>{value.textContent='';dialog.remove();};close.onclick=done;dialog.oncancel=e=>{e.preventDefault();done();};
  dialog.append(heading,value,close);layoutBrowserDialog(dialog,[close]);(document.querySelector('.os')||document.body).append(dialog);dialog.showModal();
  setTimeout(done,30_000);
 };
 return {
  get selection(){return selected;},
  expire(){unlockedUntil=0;},
  async status():Promise<PasswordsStatus>{return {available:true,locked:!unlocked(),unlockRemainingMs:Math.max(0,unlockedUntil-Date.now()),unlockSeconds:60,biometric:true,autofill:{supported:true,selected}};},
  async unlock(){unlockedUntil=Date.now()+UNLOCK_MS;return {unlocked:true as const,unlockRemainingMs:UNLOCK_MS};},
  async lock(){unlockedUntil=0;return {locked:true as const};},
  async list(){need();return {entries:[...records.values()].map(summary)};},
  async save(input:PasswordSaveInput){
   need();
   const label=String(input.label||'').trim();if(!label)throw fail('invalid','Enter a name');
   if(input.password!==undefined&&input.generate!==undefined)throw fail('invalid','Choose a typed or generated password');
   const existing=input.id?records.get(input.id):undefined;if(input.id&&!existing)throw fail('invalid','Password no longer exists');
   let bindings:string[];try{bindings=[...new Set([...(input.keepBindings||[]),...(input.websites||[])].map(normalizeWebsite))];}catch{throw fail('invalid','Use an HTTPS website address without a path');}
   if(!bindings.length)throw fail('invalid','Add at least one website or app');
   const length=input.generate?Math.trunc(input.generate.length??20):0;if(input.generate&&(length<8||length>128))throw fail('invalid','Choose a length from 8 to 128');
   const secret=input.generate?Array.from({length},(_,index)=>'abcdefghjkmnpqrstuvw'[index%20]).join(''):input.password??existing?.secret;
   if(!secret)throw fail('invalid','Enter a password');
   const id=existing?.id||`dev-${++sequence}`;
   records.set(id,{id,label,username:String(input.username||''),bindings,secret,updatedAt:Date.now()});
   return input.generate?{id,generated:true as const,length}:{id};
  },
  async openEditor():Promise<never>{throw fail('unavailable','The protected native password editor is unavailable in browser development.');},
  async remove({id}){need();if(!records.delete(id))throw fail('invalid','Password no longer exists');return {removed:true as const};},
  async reset(){need();throw fail('invalid','Saved passwords are not damaged');},
  async reveal({id}){need();const r=records.get(id);if(!r)throw fail('invalid','Password no longer exists');surface(r.label,r.secret);return {shown:true as const,hidesAfterMs:30_000};},
  async copy({id}){need();if(!records.get(id))throw fail('invalid','Password no longer exists');return {copied:true as const,clearsAfterMs:45_000};},
  async openAutofillSettings(){selected='this-app';return {status:'opened' as const,destination:'autofill-picker' as const};},
 };
}
