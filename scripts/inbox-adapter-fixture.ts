// Shared Inbox adapter harness: the real adapter, drafts and review controllers in a vm realm with a
// closed provider fixture and a fixed clock. No network, real account or mail; nothing is dispatched.
import React from 'react';
import {MailFolderPicker} from '../.eliza/client-features/plugins/plugin-inbox/src/components/mailbox/MailFolderPicker.tsx';
import {mailSenderImage} from '../apps/app/src/runtime/mail-sender-image.ts';
import {decodeMailPreview} from '../apps/app/src/runtime/mail-preview.ts';
import {readGmailAccountChoice,saveGmailAccountChoice} from '../apps/app/src/runtime/gmail-account-selection.ts';
import {GmailReadAhead} from '../apps/app/src/runtime/gmail-read-ahead.ts';
import {formatMonthDay,formatTime,formatFullDateTime,weekdayName} from '../apps/app/src/prototype/locale-time.ts';
// Existing shared formatter supplies fixture presentation; retention tests do not depend on its wording.
import {formatBytes} from '../.eliza/client-features/packages/ui/src/mobile-shell/photos-view.ts';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from '../test/support/strip-types.mjs';
import { InboxOperation, composerKind, composerContent, reviewBinding, reviewBindingRefusal, reviewOpaqueAttachment, checkOutgoingAttachments, outgoingAttachmentLimits, attachmentBytes } from '../apps/app/src/runtime/inbox-operation.ts';
import { reviewMailAttachment } from '../apps/app/src/runtime/inbox-attachment.ts';
import { reviewMailContext, validateMailContext } from '../apps/app/src/runtime/reviewed-mail-context.ts';
import { cloudServiceName, safeMailLink } from '../apps/app/src/runtime/cloud-protocol.ts';
import { linkifyMailText, linkTextMismatch } from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/links.ts';
import * as mailbox from '../apps/app/src/runtime/gmail-mailbox.ts';
import * as googleAccounts from '../apps/app/src/runtime/google-accounts.ts';
import * as grants from '../apps/app/src/runtime/gmail-grants.ts';
import {createMailReviewController} from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/review-controller.ts';
import {createMailDraftsController} from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/drafts-controller.ts';
import type {CloudProtocol} from '../apps/app/src/runtime/cloud-protocol.ts';
import type {GmailNoticeTap} from '../apps/app/src/runtime/gmail-background.ts';
import type {reviewOwnNoticeQuestion} from '../apps/app/src/prototype/own-notice-question.ts';
import * as mailboxList from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/mailbox-list.ts';

export const strip=async(file: string,names: string|string[])=>{let source=await readFile(new URL(`../apps/app/src/prototype/${file}`,import.meta.url),'utf8');source=source.replace(/^import .*;\n/gm,'').replace(/^export (?=(?:async )?function |const |let |interface |type )/gm,'')+`\n${(Array.isArray(names)?names:[names]).map((n:string)=>`globalThis.${n}=${n};`).join('')}`;return '{'+stripTypeScriptTypes(source,{mode:'transform'})+'}';};
export const digest=async (text: any)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),(b: any)=>b.toString(16).padStart(2,'0')).join('');
// vm-realm values compare by JSON value.
export const deq=(actual: unknown,expected: unknown,message?: string)=>assert.deepEqual(actual===undefined?undefined:JSON.parse(JSON.stringify(actual)),expected,message||'');
export const b64=(text: any)=>Buffer.from(text).toString('base64');
// The adapter compares against the fixture clock below, so "today" is that clock's local day.
export const FIXTURE_NOW=Date.UTC(2026,9,8,12);
export const today=new Date(FIXTURE_NOW);today.setHours(9,41,0,0);
export const mail=(id: any,extra: any={})=>({id,threadId:'thread-'+id,subject:'Fixture '+id,from:'Sender',fromEmail:'sender@example.invalid',to:['owner@example.invalid'],snippet:'Preview',receivedAt:'2026-09-30T00:00:00Z',unread:false,...extra});
export const inboxPage=[mail('m1',{unread:true,hasAttachments:true,receivedAt:today.toISOString()}),mail('m2',{unread:true}),mail('m3')];

export function scenario({caps={},accounts=null}: any={}){
 let session:string|null='session-a',clock=FIXTURE_NOW,probeFail: any=null,probeGate: any=null;
 const calls: any[]=[],toasts: any[]=[],prepared: any[]=[],dispatched: any[]=[],opened: any[]=[],saved: any[]=[],navigations: any[]=[],confirms: any[]=[],resume: any[]=[];let confirmAnswer=true;
 const defaultAccounts=[{connectionId:'grant-a',label:'Fixture account',connected:true,grantedCapabilities:['google.gmail.triage']}];
 const capabilities={version:1,from:'owner@example.invalid',threads:true,send:true,providerDrafts:true,mailboxMutations:true,attachments:true,providerExactlyOnce:false,atomicDraftReplacement:false,readState:false,draftsList:false,forwardAttachments:false,opaqueAttachments:false,searchTrash:false,attachmentPolicy:{maximumOutgoing:1,maximumBytes:5242880,maximumTotalBytes:5242880},...caps};
 const bodies:Record<string,{bodyText:string;links:{href:string;text:string}[];attachments:{partId:string;name:string;mimeType:string;size:number;supported:boolean}[]}>= {m1:{bodyText:'See https://docs.example.org/plan?x=1. and the old http://insecure.example.net page',links:[{href:'https://tracker.attacker.invalid/r',text:'www.bank.example.com'},{href:'https://docs.example.org/plan?x=1',text:'the plan'}],attachments:[{partId:'1',name:'report.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size:12,supported:false},{partId:'2',name:'notes.txt',mimeType:'text/plain',size:5,supported:true}]}};
 type FixtureClient=Omit<Pick<CloudProtocol,'gmailAccounts'|'gmailSearch'|'gmailRead'|'gmailThread'|'gmailInboxCapabilities'|'gmailDrafts'|'gmailDraftContent'|'gmailOpaqueAttachment'|'gmailAttachment'|'gmailPrepareOperation'|'gmailDispatchOperation'|'gmailOperation'>,'gmailRead'> & {gmailRead:(...args:any[])=>Promise<any>};
 const client:FixtureClient={
  gmailAccounts:async()=>{calls.push('accounts');return accounts||defaultAccounts;},
  gmailSearch:async(_grant: any,query: any,_signal: any,size: any,pageToken: any)=>{calls.push(['search',query,size,pageToken??null]);if(query==='in:inbox is:unread'&&probeGate)await probeGate;if(query==='in:inbox is:unread'&&probeFail){throw probeFail;}
   if(query==='in:inbox is:unread')return {messages:inboxPage.filter((m: any)=>m.unread),syncedAt:'2026-10-08T12:00:00Z',nextPageToken:null,supportsSpamTrash:false};
   if(query==='in:inbox')return {messages:inboxPage,syncedAt:'2026-10-08T12:01:00Z',nextPageToken:null,supportsSpamTrash:false};
   return {messages:query==='in:archive'?[mail('arch-1')]:query==='in:trash'?[mail('trash-1')]:[],syncedAt:'2026-10-08T12:02:00Z',nextPageToken:null,supportsSpamTrash:false};},
  gmailRead:async(_grant: string,id: string,_signal?:AbortSignal):Promise<{message:any;bodyText:string;links?:{href:string;text:string}[];historyId:string;attachments:unknown[]}>=>{calls.push(['read',id]);const m=inboxPage.find((x: any)=>x.id===id)||mail(id);return {message:m,bodyText:bodies[id]?.bodyText||'Plain body',links:bodies[id]?.links||[],historyId:'h-'+id,attachments:bodies[id]?.attachments||[]};},
  gmailThread:async(_grant: any,threadId: any)=>{calls.push(['thread',threadId]);const id=threadId.slice(7),m=inboxPage.find((x: any)=>x.id===id)||mail(id);return {messages:[{message:m,bodyText:bodies[id]?.bodyText||'Plain body',links:bodies[id]?.links||[],historyId:'h-'+id,attachments:bodies[id]?.attachments||[]}],total:1,offset:0,historyId:'th',nextOffset:null};},
  gmailInboxCapabilities:async()=>capabilities,
  gmailDrafts:async()=>{calls.push('drafts');return {drafts:[{draftId:'d1',messageId:'dm1',subject:'Plan draft',to:['friend@example.invalid'],snippet:'Draft body',updatedAt:today.toISOString()},{draftId:'d2',messageId:'dm2',subject:'Re: thread',to:[],snippet:'',updatedAt:null}],nextPageToken:null,supportsSpamTrash:false};},
  gmailDraftContent:async(_grant: any,draftId: any)=>{calls.push(['draft',draftId]);return draftId==='d1'?{draftId,messageId:'dm1',providerDigest:'a'.repeat(64),to:['friend@example.invalid'],cc:[],bcc:[],subject:'Plan draft',bodyText:'Draft body',threaded:false,attachmentCount:0,plainText:true}:{draftId,messageId:'dm2',providerDigest:'b'.repeat(64),to:[],cc:[],bcc:[],subject:'Re: thread',bodyText:'',threaded:true,attachmentCount:0,plainText:true};},
  gmailOpaqueAttachment:async(_grant: any,messageId: any,partId: any,historyId: any)=>{calls.push(['opaque',messageId,partId,historyId]);const data=b64('PK\u0003\u0004docx');return {name:'report.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',dataBase64:data,size:8,sha256:await digest('PK\u0003\u0004docx'),opaque:true};},
  gmailAttachment:async()=>{calls.push('attachment');throw new Error('not used');},
  gmailPrepareOperation:async(grant: any,requestId: any,proposal: any)=>{prepared.push(structuredClone(proposal));const files=await Promise.all((proposal.attachments||[]).map(async (f: any)=>{const {text,...m}=await reviewMailAttachment(f);return m;}));
   const review={...proposal,from:'owner@example.invalid',attachments:files,...(proposal.forwardAttachments?{forwardSource:{messageId:proposal.forwardAttachments.messageId,historyId:proposal.forwardAttachments.historyId},forwardedAttachments:proposal.forwardAttachments.partIds.map((partId: any)=>({partId,name:'notes.txt',mimeType:'text/plain',size:5,sha256:'c'.repeat(64)}))}:{})};
   delete review.forwardAttachments;return {receipt:{requestId,kind:proposal.kind,state:'prepared',reviewDigest:await digest(JSON.stringify(review)),providerResult:null,rejectionCode:null},review};},
  gmailDispatchOperation:async()=>{dispatched.push(1);throw new Error('No dispatch in this fixture');},
  gmailOperation:async()=>{throw new Error('No receipt');},
 };
 const listeners=new Set<()=>void>(),slots=new Map<string,unknown>();
 const controller={getCloudClient:()=>session?{client,sessionId:session,credentialId:'fixture-credential'}:null,getWorkflowDeviceTarget:()=>({installationId:'device'}),getSnapshot:()=>({session:mailNotices?.agent||null,cloudAccount:session?{environment:'production',userId:'fixture-owner',sessionId:session}:null}),subscribe:(fn: any)=>{listeners.add(fn);return()=>listeners.delete(fn);},rejectCloudSession:()=>false,open:()=>{}};
 class Shell{
 declare st: any;
 declare opened: [string,unknown][];
 declare renderVals:()=>Record<string,any>;
 declare api:(view?:string)=>vm.Context;
 declare S:()=>{view:string};
 declare toast:(message:string)=>void;
 declare inboxAccountsChanged:()=>Promise<void>;
constructor(){this.st={q:null,compose:null};this.opened=[];}componentDidMount(){}componentWillUnmount(){}vset(_: any,p: any){Object.assign(this.st,p);}openView(view: string,patch?: unknown){this.opened.push([view,patch]);}browserNavigateApproved(href: any){navigations.push(href);return Promise.resolve();}}
 // Adapter installation adds renderer methods to this explicitly dynamic VM boundary.
 const views:Record<string,vm.Context>={inbox:{state:{}}};
 let selectionCount=0;const files=[{name:'a.txt',mimeType:'text/plain',text:'alpha'},{name:'b.txt',mimeType:'text/plain',text:'bravo'},{name:'c.txt',mimeType:'text/plain',text:'charlie'}];
 const native={cancel:async()=>{},openReviewed:async (input: any)=>{opened.push(input);return {message:'opened'};},saveReviewed:async (input: any)=>{saved.push(input);return {status:'saved',message:'Saved to the chosen destination. Exact bytes verified.'};},
  readSelected:async({selectionId}: any)=>{const f=files[Number(selectionId.slice(4))%3];return {name:f.name,mimeType:f.mimeType,dataBase64:b64(f.text),size:f.text.length,sha256:await digest(f.text)};}};
 class FixedDate extends Date{constructor(...args:unknown[]){super(args.length?(Reflect.construct(Date,args) as Date).getTime():clock);}static now(){return clock;}}
 const windowFixture={addEventListener(){},removeEventListener(){},dispatchEvent(){return true;},confirm:(text: any)=>{confirms.push(text);return confirmAnswer;}};
 const inboxUnsaved=()=>({ready:Promise.resolve(),available:false,conflict:false,error:false,status:'',peek:()=>null,edit(){},clear:async()=>{},retire(){},resume(){}});
 // The saved account choice (a hint only) lives in this scenario's own storage.
 const choiceSlots=new Map(),choices={getItem:(key: any)=>choiceSlots.get(key)??null,setItem:(key: any,value: any)=>choiceSlots.set(key,value),removeItem:(key: any)=>choiceSlots.delete(key)};
 const mailNotices:{tap:GmailNoticeTap|null;withdrawals:number;withdrawn:(string|null)[];consumed:string[];listener:(()=>void)|null;agent:Record<string,string>|null;review:Parameters<typeof reviewOwnNoticeQuestion>[0]|null;released:number;drafts:unknown[]}={tap:null,withdrawals:0,withdrawn:[],consumed:[],listener:null,agent:null,review:null,released:0,drafts:[]};
 const sandbox:vm.Context={...mailboxList,formatMonthDay,formatTime,formatFullDateTime,weekdayName,formatBytes,MailboxListCache:class extends mailboxList.MailboxListCache{get(key: any,now: any=clock){return super.get(key,now);}},MailBodyCache:class extends mailboxList.MailBodyCache<unknown>{remember(key: any,body: any,now: any=clock){return super.remember(key,body,now);}},createMailReviewController,createMailDraftsController,reviewMailAttachment,cloudServiceName,linkifyMailText,linkTextMismatch,React,MailFolderPicker,mailSenderImage,serviceReadCache:async()=>null,decodeMailPreview,cachedDevicePreferences:()=>({autoLoadMailImages:true}),initializeDevicePreferences:()=>{},alphaClient:{getState:()=>({context:{sensitive:false}})},reviewOwnNoticeQuestion:(options: any)=>{mailNotices.review=options;return ()=>{};},releaseGmailQuestion:async()=>{mailNotices.released++;mailNotices.tap=null;},configureGmailBackground:async()=>{},withdrawGmailBackground:async (grant: any)=>{mailNotices.withdrawals++;mailNotices.withdrawn.push(grant??null);},pendingGmailNotice:async()=>mailNotices.tap,consumeGmailNotice:async (token: any)=>{mailNotices.consumed.push(token);mailNotices.tap=null;},onGmailNotice:async (fn: any)=>{mailNotices.listener=fn;return {remove:async()=>{}};},prepareMailHtml:()=>{throw Error("HTML uses the rendered browser test");},readGmailAccountChoice:(owner: any)=>readGmailAccountChoice(owner,choices),saveGmailAccountChoice:(owner: any,id: any)=>saveGmailAccountChoice(owner,id,choices),GmailReadAhead,URL,Date:FixedDate,inboxUnsaved,InboxOperation,composerKind,composerContent,reviewBinding,reviewBindingRefusal,reviewOpaqueAttachment,checkOutgoingAttachments,outgoingAttachmentLimits, attachmentBytes,safeMailLink,reviewMailContext,validateMailContext,...mailbox,...googleAccounts,...grants,Event,googleConnectionController:{open(){throw Error('Explicit Google authorization not exercised by this read fixture');}},
  registerPlugin:()=>native,crypto:globalThis.crypto,TextEncoder,structuredClone,
  secureConnectionStore:{read:async (key: any)=>structuredClone(slots.get(key)??null),compareExchange:async(key: any,prior: any,next: any)=>{if(JSON.stringify(slots.get(key)??null)!==JSON.stringify(prior))return {status:'conflict'};if(next===null)slots.delete(key);else slots.set(key,structuredClone(next));return {status:'saved'};}},
  connectionController:controller,
  DailyApps:{addListener:async(name: any,fn: any)=>{if(name==='appResumed')resume.push(fn);return {remove:async()=>{}};},perform:async()=>({status:'selected',selectionId:'sel-'+(selectionCount++),name:'file'}),forgetSelected:async()=>{}},
  openConnectionBrowser:async()=>{throw new Error('No OAuth');},queueMicrotask,setTimeout,AbortController,DOMException,console,window:windowFixture,CustomEvent:class{
 declare type: any;
 declare detail: any;
constructor(t: any,i: any){this.type=t;this.detail=i?.detail;}},document:{querySelector(){return null;},addEventListener(){},removeEventListener(){},documentElement:{dataset:{connectionMode:'live'}}},atob,btoa};
 return {choices,mailNotices,sandbox,client,calls,toasts,prepared,dispatched,opened,saved,navigations,confirms,resume,views,Shell,listeners,slots,
  setSession:(v: any)=>{session=v;for(const fn of listeners)fn();},advance:(ms: any)=>{clock+=ms;},gate:()=>{let open!:()=>void;probeGate=new Promise<void>(r=>{open=r;});return ()=>{probeGate=null;open();};},failProbe:(e: any)=>{probeFail=e;},answer:(v: any)=>{confirmAnswer=v;}};
}
export async function boot(options: any={}){
 const s=scenario(options);s.sandbox.inboxLocalStore=s.sandbox.secureConnectionStore;vm.createContext(s.sandbox);
 for(const [file,names] of ([['inbox-provider-controls.ts','inboxProviderControls'],['inbox-drafts.ts','inboxDrafts'],['inbox-cloud-adapter.ts',['installInboxCloudAdapter','inboxAttention','openInbox','linkifyMailText','linkTextMismatch']]] as [string,string|string[]][]))vm.runInContext(await strip(file,names),s.sandbox);
 const attentionBefore=JSON.parse(JSON.stringify(s.sandbox.inboxAttention()));
 s.sandbox.installInboxCloudAdapter(s.Shell,s.views);const shell=new s.Shell();
 let active=false;const api:vm.Context={sw:()=>({down(){},up(){}}),swallowed:()=>false,get:()=>shell.st,isActive:()=>active,set:(p: any)=>shell.vset('inbox',p),toast:(t: any)=>s.toasts.push(t)};
 const tick=async()=>{for(let i=0;i<40;i++)await new Promise((r: any)=>setTimeout(r,0));};
 const render=()=>s.views.inbox.render(shell.st,api);
 const chip=(label: any)=>{const found=[...render().chips,...render().extraFolders].find((c: any)=>c.label===label);assert.ok(found,`chip ${label} in ${render().chips.map((c: any)=>c.label)}`);return found;};
 return {...s,shell,api,tick,render,chip,attentionBefore,setActive:(v: any)=>{active=v;},attention:()=>JSON.parse(JSON.stringify(s.sandbox.inboxAttention())),mount:()=>shell.componentDidMount()};
}
export const searches=(t: any)=>t.calls.filter((c: any)=>Array.isArray(c)&&c[0]==='search');
