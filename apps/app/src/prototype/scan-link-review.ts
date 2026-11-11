import {Capacitor} from '@capacitor/core';
import {DailyApps} from '../daily';
import {scannedLinks} from '../../../../.eliza/client-features/plugins/plugin-files/src/documents/scan-links.ts';

/** Only an explicit click on a displayed, current URL may leave the scan. */
export function createScanLinkReview(current:()=>string,active:()=>boolean){
 const section=document.createElement('details');const summary=document.createElement('summary');summary.style.cssText='cursor:pointer;min-height:44px;padding-top:12px';
 const explanation=document.createElement('p');explanation.hidden=true;
 const list=document.createElement('ul');list.style.cssText='padding-left:20px;overflow-wrap:anywhere';
 const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-label','Scanned link status');
 section.append(summary,explanation,list,status);section.hidden=true;
 let generation=0,busy=false;
 const update=()=>{
  ++generation;const links=scannedLinks(current());section.hidden=links.length===0;summary.textContent=`Links (${links.length}${links.length===10?' max':''})`;list.replaceChildren();status.textContent='';
  for(const url of links){
   const row=document.createElement('li');row.style.cssText='margin-bottom:16px';const address=document.createElement('div');address.textContent=url;
   const anchor=document.createElement('a');anchor.textContent='Open link';anchor.setAttribute('aria-label','Open '+url);anchor.href=url;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.referrerPolicy='no-referrer';anchor.style.cssText='display:inline-block;padding:10px 0;color:var(--acct,#00f);text-decoration:underline';
   anchor.onclick=event=>{
    if(!active()||busy||!scannedLinks(current()).includes(url)){event.preventDefault();return;}
    if(!Capacitor.isNativePlatform())return;
    event.preventDefault();busy=true;const token=generation;status.textContent='Opening browser…';
    void DailyApps.perform({action:'browser',url}).then(result=>{if(active()&&token===generation)status.textContent=result.status==='opened'?'Opened the browser.':result.message||'The browser could not open.';},()=>{if(active()&&token===generation)status.textContent='Couldn’t open';}).finally(()=>{busy=false;});
   };
   row.append(address,anchor);list.append(row);
  }
 };
 return {element:section,update};
}
