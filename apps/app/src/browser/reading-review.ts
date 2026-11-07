import {layoutBrowserDialog} from './dialog-layout';
import {sensitiveReadingUrl,sensitiveReadingText} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts';
import {readPublicPageSource as browserReadingSource} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-source.ts';
import {speakLocalText} from '../local-speech-playback';

/** Review public source text when accessible, or supply an excerpt; the frame stays isolated. */
export async function reviewBrowserReading(url:string,signal:AbortSignal,valid:()=>void):Promise<void>{
 valid();
 const previous=document.activeElement as HTMLElement|null;
 const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Read page excerpt');
 dialog.style.cssText='box-sizing:border-box;width:min(440px,calc(100vw - 24px));max-height:85dvh;overflow:auto;border:1px solid var(--bd,#aaa);border-radius:20px;padding:20px;background:var(--bg,#fff);color:var(--fg,#111);font:15px/1.45 system-ui,sans-serif';
 const theme=getComputedStyle(document.querySelector('.os')||document.documentElement);
 for(const name of ['--bg','--fg','--s2']){const value=theme.getPropertyValue(name).trim();if(value)dialog.style.setProperty(name,value);}
 const border=theme.getPropertyValue('--line').trim();if(border)dialog.style.setProperty('--bd',border);
 const title=document.createElement('h2');title.textContent='Read page excerpt';
 const source=document.createElement('p');source.textContent=new URL(url).origin;source.style.overflowWrap='anywhere';
 const explanation=document.createElement('p');explanation.textContent='Review or paste the text you want to hear. Speech runs on this device through your local agent’s on-device voice; the text is used only to read it aloud and is not saved.';
 const label=document.createElement('label');label.textContent='Excerpt to read';
 const field=document.createElement('textarea');field.setAttribute('aria-label','Excerpt to read');field.maxLength=5000;field.rows=7;field.style.cssText='box-sizing:border-box;width:100%;font:inherit;background:var(--s2,#eee);color:inherit;border:1px solid var(--bd,#aaa);border-radius:8px;padding:8px';label.append(field);
 const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-label','Reading status');status.textContent='Up to 5,000 characters. Review the text before reading.';
 const controls=document.createElement('div');controls.style.cssText='display:flex;gap:12px;flex-wrap:wrap';
 const button=(text:string)=>{const b=document.createElement('button');b.textContent=text;b.style.cssText='min-height:44px;padding:8px 16px;font:inherit;border:1px solid var(--bd,#aaa);border-radius:10px;background:var(--s2,#eee);color:inherit';controls.append(b);return b;};
 const read=button('Read locally'),stop=button('Stop reading'),close=button('Close');stop.disabled=true;
 dialog.append(title,source,explanation,label,status,controls);
 const blockedMessage='Reading is unavailable because this page or excerpt may contain credentials or verification codes. Open a different page.';
 let blocked=sensitiveReadingUrl(url),sourcePending=true;read.disabled=true;
 const block=()=>{blocked=true;field.value='';field.disabled=true;read.disabled=true;status.textContent=blockedMessage;};
 if(blocked)block();
 const sourceAbort=new AbortController();let edited=false;field.oninput=()=>{edited=true;};
 let active=true,generation=0,speech:AbortController|undefined;
 const stopSpeech=()=>{generation++;speech?.abort();speech=undefined;field.disabled=false;read.disabled=blocked||sourcePending;field.disabled=blocked;stop.disabled=true;};
 let finish!:()=>void;
 const closed=new Promise<void>(resolve=>{finish=()=>{if(!active)return;active=false;sourceAbort.abort();stopSpeech();signal.removeEventListener('abort',finish);window.removeEventListener('pagehide',finish);window.removeEventListener('alpha-back',back,true);document.removeEventListener('visibilitychange',visibility);dialog.remove();if(previous?.isConnected)previous.focus();resolve();};});
 const visibility=()=>{if(document.hidden)finish();},back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();finish();};
 window.addEventListener('pagehide',finish);window.addEventListener('alpha-back',back,true);document.addEventListener('visibilitychange',visibility);signal.addEventListener('abort',finish,{once:true});
 dialog.oncancel=event=>{event.preventDefault();finish();};dialog.onclose=finish;close.onclick=finish;
 stop.onclick=()=>{if(!active)return;stopSpeech();status.textContent='Reading stopped.';};
 read.onclick=async()=>{
  if(!active||read.disabled||blocked||sourcePending)return;
  try{valid();}catch{finish();return;}
  edited=true;sourceAbort.abort();
  const text=field.value.trim();if(!text||text.length>5000){status.textContent='Enter between 1 and 5,000 characters.';return;}
  if(sensitiveReadingText(text)){block();return;}
  const current=++generation;field.disabled=true;read.disabled=true;stop.disabled=false;status.textContent='Preparing local speech…';const owner=new AbortController();speech=owner;
  try{
   await speakLocalText(text,owner.signal,()=>{valid();if(active&&current===generation)status.textContent='Reading locally…';});
   if(active&&current===generation){stopSpeech();status.textContent='Reading finished.';}
  }catch(error){if(active&&current===generation){stopSpeech();status.textContent=error instanceof Error?error.message:'Speech could not start. Try again.';}}
 };
 try{valid();if(!active)return;layoutBrowserDialog(dialog,[read,stop,close]);document.body.append(dialog);dialog.showModal();field.focus();
 void browserReadingSource(url,sourceAbort.signal).then(result=>{if(!active||sourceAbort.signal.aborted)return;valid();sourcePending=false;if(result?.blocked){block();return;}if(blocked)return;read.disabled=false;if(edited)return;if(result){field.value=result.text;status.textContent=result.truncated?'First 5,000 characters of public page text. Review before reading.':'Public page text loaded. Review before reading.';}else status.textContent='Paste up to 5,000 characters from the page to read locally.';}).catch(()=>{if(active&&!sourceAbort.signal.aborted){sourcePending=false;block();}});
 await closed;}finally{finish();}
}
