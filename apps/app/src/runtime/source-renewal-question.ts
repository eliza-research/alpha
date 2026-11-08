import {reviewContentQuestion} from '../browser/content-question';
import {sensitiveReadingText} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts';
import {noticeReviewable} from '../prototype/context-selection';
import {alphaClient} from './alpha-client';
import type {HostedNativeSelection} from './hosted-digests';
export interface SourceRenewalTap {token:string;question:boolean;selection:HostedNativeSelection;expiresAt:number}
export function renewalMatches(tap:SourceRenewalTap,selection:HostedNativeSelection,expiresAt:string){return tap.expiresAt===Date.parse(expiresAt)&&['provider','ownerId','agentId','installationId','enrollmentId','sourceId','revision'].every(field=>tap.selection[field as keyof HostedNativeSelection]===selection[field as keyof HostedNativeSelection]);}
export function reviewSourceRenewalQuestion(o:{tap:SourceRenewalTap;signal:AbortSignal;current:()=>boolean;recheck:()=>Promise<Partial<SourceRenewalTap>>;settle:(discard:boolean)=>Promise<void>;compose:(text:string)=>boolean;report:(text:string)=>void;closed:()=>void}){
 const text='Scheduled brief source expires soon. Renew it in Alpha Phone to keep your brief reading it.';
 const current=()=>o.current()&&!alphaClient.getState().context.sensitive;
 if(!o.tap.question||!current()||!noticeReviewable({source:'own',id:o.tap.selection.sourceId,revision:o.tap.selection.revision,title:'Scheduled source renewal',text})||sensitiveReadingText(text))return;
 let composing=false,ended=false,interrupted=false;
 const done=()=>{if(ended)return;ended=true;window.removeEventListener('blur',abort);window.removeEventListener('launcher-home',abort);o.closed();};let abort=()=>{};
 const close=reviewContentQuestion({signal:o.signal,name:'Scheduled source renewal notification',text,question:'Help me understand this source renewal.',current,validate:value=>!sensitiveReadingText(value),closed:dismissed=>queueMicrotask(()=>{if(!composing){if(dismissed&&!interrupted)void o.settle(true).catch(()=>{});interrupted=true;done();}}),compose:draft=>{composing=true;void(async()=>{try{if(interrupted||!current())throw Error();const next=await o.recheck();if(interrupted||!current()||next.token!==o.tap.token||!next.question||!next.selection||!renewalMatches(next as SourceRenewalTap,o.tap.selection,new Date(o.tap.expiresAt).toISOString()))throw Error();await o.settle(false);if(interrupted||!current()||!o.compose(draft))throw Error();}catch{o.report('The source or account changed. Nothing was added to your conversation.');}finally{done();}})();}});
 abort=()=>{interrupted=true;close();done();};window.addEventListener('blur',abort);window.addEventListener('launcher-home',abort);return abort;
}
