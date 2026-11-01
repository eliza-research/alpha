import React from 'react';
import {MailFolderPicker} from '../.eliza/client-features/plugins/plugin-inbox/src/components/mailbox/MailFolderPicker.tsx';
import {mailSenderImage} from '../apps/app/src/runtime/mail-sender-image.ts';
import {decodeMailPreview} from '../apps/app/src/runtime/mail-preview.ts';
import {readGmailAccountChoice,saveGmailAccountChoice} from '../apps/app/src/runtime/gmail-account-selection.ts';
import {GmailReadAhead} from '../apps/app/src/runtime/gmail-read-ahead.ts';
// Inbox attention summary, explicit Inbox reads, links, folders, provider drafts, multi/forwarded
// attachments, opaque save and "Use in email" against the real adapter with a closed provider
// fixture. No network, real account or mail; nothing is dispatched.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
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
import * as mailboxList from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/mailbox-list.ts';

const strip=async(file,names)=>{let source=await readFile(new URL(`../apps/app/src/prototype/${file}`,import.meta.url),'utf8');source=source.replace(/^import .*;\n/gm,'').replace(/^export (?=(?:async )?function |const |let |interface |type )/gm,'')+`\n${[].concat(names).map(n=>`globalThis.${n}=${n};`).join('')}`;return '{'+stripTypeScriptTypes(source,{mode:'transform'})+'}';};
const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
// vm-realm values compare by JSON value.
const deq=(actual,expected,message)=>assert.deepEqual(actual===undefined?undefined:JSON.parse(JSON.stringify(actual)),expected,message);
const b64=text=>Buffer.from(text).toString('base64');
// The adapter compares against the fixture clock below, so "today" is that clock's local day.
const FIXTURE_NOW=Date.UTC(2026,9,8,12);
const today=new Date(FIXTURE_NOW);today.setHours(9,41,0,0);
const mail=(id,extra={})=>({id,threadId:'thread-'+id,subject:'Fixture '+id,from:'Sender',fromEmail:'sender@example.invalid',to:['owner@example.invalid'],snippet:'Preview',receivedAt:'2026-09-30T00:00:00Z',unread:false,...extra});
const inboxPage=[mail('m1',{unread:true,hasAttachments:true,receivedAt:today.toISOString()}),mail('m2',{unread:true}),mail('m3')];

function scenario({caps={},accounts=null}={}){
 let session='session-a',clock=FIXTURE_NOW,probeFail=null,probeGate=null;
 const calls=[],toasts=[],prepared=[],dispatched=[],opened=[],saved=[],navigations=[],confirms=[],resume=[];let confirmAnswer=true;
 const defaultAccounts=[{connectionId:'grant-a',label:'Fixture account',connected:true,grantedCapabilities:['google.gmail.triage']}];
 const capabilities={version:1,from:'owner@example.invalid',threads:true,send:true,providerDrafts:true,mailboxMutations:true,attachments:true,providerExactlyOnce:false,atomicDraftReplacement:false,readState:false,draftsList:false,forwardAttachments:false,opaqueAttachments:false,searchTrash:false,attachmentPolicy:{maximumOutgoing:1,maximumBytes:5242880,maximumTotalBytes:5242880},...caps};
 const bodies={m1:{bodyText:'See https://docs.example.org/plan?x=1. and the old http://insecure.example.net page',links:[{href:'https://tracker.attacker.invalid/r',text:'www.bank.example.com'},{href:'https://docs.example.org/plan?x=1',text:'the plan'}],attachments:[{partId:'1',name:'report.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size:12,supported:false},{partId:'2',name:'notes.txt',mimeType:'text/plain',size:5,supported:true}]}};
 const client={
  gmailAccounts:async()=>{calls.push('accounts');return accounts||defaultAccounts;},
  gmailSearch:async(_grant,query,_signal,size,pageToken)=>{calls.push(['search',query,size,pageToken??null]);if(query==='in:inbox is:unread'&&probeGate)await probeGate;if(query==='in:inbox is:unread'&&probeFail){throw probeFail;}
   if(query==='in:inbox is:unread')return {messages:inboxPage.filter(m=>m.unread),syncedAt:'2026-10-08T12:00:00Z',nextPageToken:null};
   if(query==='in:inbox')return {messages:inboxPage,syncedAt:'2026-10-08T12:01:00Z',nextPageToken:null};
   return {messages:query==='in:archive'?[mail('arch-1')]:query==='in:trash'?[mail('trash-1')]:[],syncedAt:'2026-10-08T12:02:00Z',nextPageToken:null};},
  gmailRead:async(_grant,id)=>{calls.push(['read',id]);const m=inboxPage.find(x=>x.id===id)||mail(id);return {message:m,bodyText:bodies[id]?.bodyText||'Plain body',links:bodies[id]?.links||[]};},
  gmailThread:async(_grant,threadId)=>{calls.push(['thread',threadId]);const id=threadId.slice(7),m=inboxPage.find(x=>x.id===id)||mail(id);return {messages:[{message:m,bodyText:bodies[id]?.bodyText||'Plain body',links:bodies[id]?.links||[],historyId:'h-'+id,attachments:bodies[id]?.attachments||[]}],total:1,offset:0,historyId:'th',nextOffset:null};},
  gmailInboxCapabilities:async()=>capabilities,
  gmailDrafts:async()=>{calls.push('drafts');return {drafts:[{draftId:'d1',messageId:'dm1',subject:'Plan draft',to:['friend@example.invalid'],snippet:'Draft body',updatedAt:today.toISOString()},{draftId:'d2',messageId:'dm2',subject:'Re: thread',to:[],snippet:'',updatedAt:null}],nextPageToken:null};},
  gmailDraftContent:async(_grant,draftId)=>{calls.push(['draft',draftId]);return draftId==='d1'?{draftId,messageId:'dm1',providerDigest:'a'.repeat(64),to:['friend@example.invalid'],cc:[],bcc:[],subject:'Plan draft',bodyText:'Draft body',threaded:false,attachmentCount:0,plainText:true}:{draftId,messageId:'dm2',providerDigest:'b'.repeat(64),to:[],cc:[],bcc:[],subject:'Re: thread',bodyText:'',threaded:true,attachmentCount:0,plainText:true};},
  gmailOpaqueAttachment:async(_grant,messageId,partId,historyId)=>{calls.push(['opaque',messageId,partId,historyId]);const data=b64('PK\u0003\u0004docx');return {name:'report.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',dataBase64:data,size:8,sha256:await digest('PK\u0003\u0004docx'),opaque:true};},
  gmailAttachment:async()=>{calls.push('attachment');throw new Error('not used');},
  gmailPrepareOperation:async(grant,requestId,proposal)=>{prepared.push(structuredClone(proposal));const files=await Promise.all((proposal.attachments||[]).map(async f=>{const {text,...m}=await reviewMailAttachment(f);return m;}));
   const review={...proposal,from:'owner@example.invalid',attachments:files,...(proposal.forwardAttachments?{forwardSource:{messageId:proposal.forwardAttachments.messageId,historyId:proposal.forwardAttachments.historyId},forwardedAttachments:proposal.forwardAttachments.partIds.map(partId=>({partId,name:'notes.txt',mimeType:'text/plain',size:5,sha256:'c'.repeat(64)}))}:{})};
   delete review.forwardAttachments;return {receipt:{requestId,kind:proposal.kind,state:'prepared',reviewDigest:await digest(JSON.stringify(review)),providerResult:null,rejectionCode:null},review};},
  gmailDispatchOperation:async()=>{dispatched.push(1);throw new Error('No dispatch in this fixture');},
  gmailOperation:async()=>{throw new Error('No receipt');},
 };
 const listeners=new Set(),slots=new Map();
 const controller={getCloudClient:()=>session?{client,sessionId:session,credentialId:'fixture-credential'}:null,getWorkflowDeviceTarget:()=>({installationId:'device'}),getSnapshot:()=>({session:mailNotices?.agent||null,cloudAccount:session?{environment:'production',userId:'fixture-owner',sessionId:session}:null}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},rejectCloudSession:()=>false,open:()=>{}};
 class Shell{constructor(){this.st={q:null,compose:null};this.opened=[];}componentDidMount(){}componentWillUnmount(){}vset(_,p){Object.assign(this.st,p);}openView(view,patch){this.opened.push([view,patch]);}browserNavigateApproved(href){navigations.push(href);return Promise.resolve();}}
 const views={inbox:{state:{}}};
 let selectionCount=0;const files=[{name:'a.txt',mimeType:'text/plain',text:'alpha'},{name:'b.txt',mimeType:'text/plain',text:'bravo'},{name:'c.txt',mimeType:'text/plain',text:'charlie'}];
 const native={cancel:async()=>{},openReviewed:async input=>{opened.push(input);return {message:'opened'};},saveReviewed:async input=>{saved.push(input);return {status:'saved',message:'Saved to the chosen destination. Exact bytes verified.'};},
  readSelected:async({selectionId})=>{const f=files[Number(selectionId.slice(4))%3];return {name:f.name,mimeType:f.mimeType,dataBase64:b64(f.text),size:f.text.length,sha256:await digest(f.text)};}};
 class FixedDate extends Date{constructor(...a){super(...(a.length?a:[clock]));}static now(){return clock;}}
 const windowFixture={addEventListener(){},removeEventListener(){},dispatchEvent(){return true;},confirm:text=>{confirms.push(text);return confirmAnswer;}};
 const inboxUnsaved=()=>({ready:Promise.resolve(),available:false,conflict:false,error:false,status:'',peek:()=>null,edit(){},clear:async()=>{},retire(){},resume(){}});
 const mailNotices={tap:null,withdrawals:0,consumed:[],listener:null,agent:null,review:null,released:0,drafts:[]};
 const sandbox={...mailboxList,createMailReviewController,createMailDraftsController,reviewMailAttachment,cloudServiceName,linkifyMailText,linkTextMismatch,React,MailFolderPicker,mailSenderImage,serviceReadCache:async()=>null,decodeMailPreview,cachedDevicePreferences:()=>({autoLoadMailImages:true}),initializeDevicePreferences:()=>{},alphaClient:{getState:()=>({context:{sensitive:false}})},reviewOwnNoticeQuestion:options=>{mailNotices.review=options;return ()=>{};},releaseGmailQuestion:async()=>{mailNotices.released++;mailNotices.tap=null;},configureGmailBackground:async()=>{},withdrawGmailBackground:async()=>{mailNotices.withdrawals++;},pendingGmailNotice:async()=>mailNotices.tap,consumeGmailNotice:async token=>{mailNotices.consumed.push(token);mailNotices.tap=null;},onGmailNotice:async fn=>{mailNotices.listener=fn;return {remove:async()=>{}};},prepareMailHtml:()=>{throw Error("HTML uses the rendered browser test");},readGmailAccountChoice,saveGmailAccountChoice,GmailReadAhead,URL,Date:FixedDate,inboxUnsaved,InboxOperation,composerKind,composerContent,reviewBinding,reviewBindingRefusal,reviewMailAttachment,reviewOpaqueAttachment,checkOutgoingAttachments,outgoingAttachmentLimits, attachmentBytes,safeMailLink,reviewMailContext,validateMailContext,...mailbox,...googleAccounts,...grants,Event,googleConnectionController:{open(){throw Error('Explicit Google authorization not exercised by this read fixture');}},
  registerPlugin:()=>native,crypto:globalThis.crypto,TextEncoder,structuredClone,
  secureConnectionStore:{read:async key=>structuredClone(slots.get(key)??null),compareExchange:async(key,prior,next)=>{if(JSON.stringify(slots.get(key)??null)!==JSON.stringify(prior))return {status:'conflict'};if(next===null)slots.delete(key);else slots.set(key,structuredClone(next));return {status:'saved'};}},
  connectionController:controller,
  DailyApps:{addListener:async(name,fn)=>{if(name==='appResumed')resume.push(fn);return {remove:async()=>{}};},perform:async()=>({status:'selected',selectionId:'sel-'+(selectionCount++),name:'file'}),forgetSelected:async()=>{}},
  openConnectionBrowser:async()=>{throw new Error('No OAuth');},queueMicrotask,setTimeout,AbortController,DOMException,console,window:windowFixture,CustomEvent:class{constructor(t,i){this.type=t;this.detail=i?.detail;}},document:{addEventListener(){},removeEventListener(){},documentElement:{dataset:{connectionMode:'live'}}},atob,btoa};
 return {mailNotices,sandbox,client,calls,toasts,prepared,dispatched,opened,saved,navigations,confirms,resume,views,Shell,listeners,slots,
  setSession:v=>{session=v;for(const fn of listeners)fn();},advance:ms=>{clock+=ms;},gate:()=>{let open;probeGate=new Promise(r=>{open=r;});return ()=>{probeGate=null;open();};},failProbe:e=>{probeFail=e;},answer:v=>{confirmAnswer=v;}};
}
async function boot(options){
 const s=scenario(options);s.sandbox.inboxLocalStore=s.sandbox.secureConnectionStore;vm.createContext(s.sandbox);
 for(const [file,names] of [['inbox-provider-controls.ts','inboxProviderControls'],['inbox-drafts.ts','inboxDrafts'],['inbox-cloud-adapter.ts',['installInboxCloudAdapter','inboxAttention','openInbox','linkifyMailText','linkTextMismatch']]])vm.runInContext(await strip(file,names),s.sandbox);
 const attentionBefore=JSON.parse(JSON.stringify(s.sandbox.inboxAttention()));
 s.sandbox.installInboxCloudAdapter(s.Shell,s.views);const shell=new s.Shell();
 let active=false;const api={sw:()=>({down(){},up(){}}),swallowed:()=>false,get:()=>shell.st,isActive:()=>active,set:p=>shell.vset('inbox',p),toast:t=>s.toasts.push(t)};
 const tick=async()=>{for(let i=0;i<40;i++)await new Promise(r=>setTimeout(r,0));};
 const render=()=>s.views.inbox.render(shell.st,api);
 const chip=label=>{const found=[...render().chips,...render().extraFolders].find(c=>c.label===label);assert.ok(found,`chip ${label} in ${render().chips.map(c=>c.label)}`);return found;};
 return {...s,shell,api,tick,render,chip,attentionBefore,setActive:v=>{active=v;},attention:()=>JSON.parse(JSON.stringify(s.sandbox.inboxAttention())),mount:()=>shell.componentDidMount()};
}
const searches=t=>t.calls.filter(c=>Array.isArray(c)&&c[0]==='search');

// Home reads one bounded header page at mount; resume within a minute and leaving Inbox do not query mail.
{
 const t=await boot();
 t.mount();await t.tick();
 deq(t.calls,['accounts',['search','in:inbox',25,null]],'Home reads accounts and one 25-header page, no bodies or drafts');
 assert.equal(t.views.inbox.badge(),true,'the accepted header page sets the badge');
 for(const fn of t.resume)fn();await t.tick();
 deq(t.calls,['accounts',['search','in:inbox',25,null]],'resume within a minute outside Inbox does not read mail again');
 t.setActive(true);t.render();await t.tick();
 deq(searches(t),[['search','in:inbox',25,null]],'explicit Inbox open consumes the Home header page');assert.equal(t.calls.filter(c=>c==='accounts').length,1,'no second account discovery');
 assert.equal(t.attention().state,'ready');assert.equal(t.attention().unread,2);
 assert.equal(t.views.inbox.badge(),true);
 const rows=t.render().rows;assert.equal(rows[0].clip,true);assert.match(rows[0].label,/has attachments/);assert.equal(rows[1].clip,false);
 assert.match(rows[0].time,/9:41|09:41/);assert.doesNotMatch(rows[1].time,/:/);
 t.setActive(false);t.views.inbox.onLeave();await t.tick();
 assert.equal(t.attention().state,'stale');assert.equal(searches(t).length,1);
 assert.equal(t.views.inbox.badge(),true,'cached unread metadata stays visible');
 t.sandbox.openInbox();deq(t.shell.opened,[['inbox',{open:null,q:null}]]);
 t.setSession(null);await t.tick();assert.equal(t.attention().state,'not-connected');assert.equal(t.views.inbox.badge(),false);
 t.shell.componentWillUnmount();
}
// 2. No readable account: not-connected without a mail query.
{
 const t=await boot({accounts:[{connectionId:'grant-x',label:'Calendar only',connected:true,grantedCapabilities:[]}]});
 t.mount();await t.tick();
 assert.equal(t.attention().state,'not-connected');assert.equal(searches(t).length,0,'no mail query without a Gmail grant');
 t.shell.componentWillUnmount();
}
// 3. Links: provider links and plain-text https URLs, origin review, Browser only, no remote loads.
{
 deq(JSON.parse(JSON.stringify((await boot()).sandbox.linkifyMailText('Go to https://a.example.org/x). Or (https://b.example.org/y_(z)) and http://c.example.org'))).map(l=>l.href),['https://a.example.org/x','https://b.example.org/y_(z)']);
 {
  // Hostile bodies stay linear: trimming 150k trailing ")" per URL was quadratic (tens of seconds).
  const linkify=(await boot()).sandbox.linkifyMailText,started=Date.now();
  const found=linkify(['a','b','c'].map(h=>`https://${h}.example.org/x${')'.repeat(150_000)}`).join(' ')+' https://'+'y'.repeat(3000)+' https://end.example.org/');
  assert.ok(Date.now()-started<5000,'linkify is linear on hostile bodies');
  deq(JSON.parse(JSON.stringify(found)).map(l=>l.href),['https://a.example.org/x','https://b.example.org/x','https://c.example.org/x','https://end.example.org/']);
 }
 const t=await boot({caps:{opaqueAttachments:true,forwardAttachments:true,attachmentPolicy:{maximumOutgoing:10,maximumBytes:5242880,maximumTotalBytes:5242880}}});
 t.mount();t.setActive(true);t.render();await t.tick();
 t.render().rows[0].open();await t.tick();if(t.render().d?.canLoadThread){t.render().d.loadThread();await t.tick();}
 const d=t.render().d;assert.equal(d.hasLinks,true);assert.equal(t.render().d.links,d.links,'link rows are computed once per opened body');
 deq(d.links.map(l=>[l.href,l.mismatch]),[['https://tracker.attacker.invalid/r',true],['https://docs.example.org/plan?x=1',false]],'HTML links first, plain-text URL deduplicated, http dropped');
 t.answer(false);d.links[0].open();assert.equal(t.navigations.length,0,'declined review opens nothing');assert.match(t.confirms.at(-1),/tracker\.attacker\.invalid/);assert.match(t.confirms.at(-1),/Warning: the email shows/);
 t.answer(true);d.links[1].open();await t.tick();deq(t.navigations,['https://docs.example.org/plan?x=1'],'approved link opens in Alpha Browser');
 // Unsupported attachment: opaque byte copy, Save to Files only, no preview or viewer.
 assert.match(d.atts[0].size,/No preview · Save to Files/);
 d.atts[0].open();await t.tick();const review=t.render().attachment;assert.ok(review,'opaque review shown');assert.equal(review.external,false,'no viewer handoff for opaque bytes');
 assert.match(review.text,/not previewed/);review.save();await t.tick();
 assert.equal(t.saved.length,1);assert.equal(t.saved[0].opaque,true);assert.equal(t.saved[0].reviewed,true);assert.equal(t.opened.length,0);
 deq(t.calls.filter(c=>Array.isArray(c)&&c[0]==='opaque'),[['opaque','m1','1','h-m1']],'opaque download bound to message, part and historyId');
 t.render().attachment.close();
 // Forward lists the source attachments; each can be removed; the proposal binds them to the message.
 t.render().d.forward();await t.tick();
 let c=t.render().c;deq(c.atts.map(a=>a.name),['report.docx (original)','notes.txt (original)']);assert.match(c.status,/Forwarding 2 original attachments/);
 c.atts[0].rm();c=t.render().c;deq(c.atts.map(a=>a.name),['notes.txt (original)'],'remove one forwarded file');
 c.chips;c.onTo({target:{value:'friend@example.invalid'}});c.toKey({key:'Enter',preventDefault(){}});
 t.render().c.send();await t.tick();
 deq(t.prepared.at(-1).forwardAttachments,{messageId:'m1',historyId:'h-m1',partIds:['2']});assert.equal(t.prepared.at(-1).mode,'forward');
 assert.equal(t.dispatched.length,0,'review only: nothing is sent without explicit confirmation');
 assert.equal(t.render().providerReview,true,'the exact review is shown');assert.equal(t.render().provider.canConfirm,true);
 t.shell.componentWillUnmount();
}
// 4. Multiple attachments added and removed individually; old single-attachment servers refuse a second.
for(const maximumOutgoing of [10,1]){
 const t=await boot({caps:{attachmentPolicy:{maximumOutgoing,maximumBytes:5242880,maximumTotalBytes:5242880}}});
 t.mount();t.setActive(true);t.render();await t.tick();
 t.render().compose();await t.tick();
 for(let i=0;i<3;i++){t.render().c.attach();await t.tick();}
 let c=t.render().c;
 if(maximumOutgoing===1){deq(c.atts.map(a=>a.name),['a.txt']);assert.match(t.toasts.at(-1),/one attachment per email/);assert.equal(c.attachLabel,'Attach file');assert.match(c.attachmentHint,/1 file/);t.shell.componentWillUnmount();continue;}
 deq(c.atts.map(a=>a.name),['a.txt','b.txt','c.txt'],'three attachments');assert.equal(c.attachLabel,'Attach file');assert.match(c.attachmentHint,/10 files/);
 c.atts[1].rm();c=t.render().c;deq(c.atts.map(a=>a.name),['a.txt','c.txt'],'remove the middle one only');
 c.atts[0].rm();t.render().c.attach();await t.tick();c=t.render().c;deq(c.atts.map(a=>a.name),['c.txt','a.txt']);
 c.onTo({target:{value:'friend@example.invalid'}});c.toKey({key:'Enter',preventDefault(){}});t.render().c.send();await t.tick();
deq(t.prepared.at(-1).attachments.map(a=>a.name),['c.txt','a.txt']);assert.equal(t.dispatched.length,0);
 assert.throws(()=>checkOutgoingAttachments(Array.from({length:11},(_,i)=>({name:i+'.txt',dataBase64:'YQ=='}))),/at most 10/);
 assert.throws(()=>checkOutgoingAttachments([{name:'x.txt',dataBase64:'YQ=='},{name:'X.TXT',dataBase64:'YQ=='}]),/same name/);
 assert.throws(()=>checkOutgoingAttachments([{name:'big.txt',dataBase64:'A'.repeat(7*1024*1024)}]),/in total/);
 t.shell.componentWillUnmount();
}
// 5. Folders: Drafts, Archive and Trash load the matching lists; opening a draft edits it as a provider draft.
{
 const plain=await boot();plain.mount();plain.setActive(true);plain.render();await plain.tick();
 deq(plain.render().chips.filter(c=>['Drafts','Archive','Trash'].includes(c.label)).map(c=>c.label),['Archive'],'old servers: only the query-based Archive folder');
 plain.shell.componentWillUnmount();
 const t=await boot({caps:{draftsList:true,searchTrash:true}});t.mount();t.setActive(true);t.render();await t.tick();
 t.chip('Archive').pick();await t.tick();assert.equal(searches(t).at(-1)[1],'in:archive');deq(t.render().rows.map(r=>r.subj),['Fixture arch-1']);
 t.chip('Trash').pick();await t.tick();assert.equal(searches(t).at(-1)[1],'in:trash');deq(t.render().rows.map(r=>r.subj),['Fixture trash-1']);
 t.chip('Drafts').pick();await t.tick();assert.ok(t.calls.includes('drafts'));
 const rows=t.render().rows;deq(rows.map(r=>r.name),['Draft to friend@example.invalid','Draft (no recipients)']);
 rows[1].open();await t.tick();assert.match(t.toasts.at(-1),/is a reply, has attachments or formatting/);assert.equal(t.render().composing,false,'threaded drafts stay in Gmail');
 t.render().rows[0].open();await t.tick();if(t.render().d?.canLoadThread){t.render().d.loadThread();await t.tick();}
 const c=t.render().c;assert.equal(t.render().composing,true);assert.equal(c.subject,'Plan draft');assert.equal(c.body,'Draft body');assert.match(c.status,/Saved locally|provider draft/i);
 c.saveProvider();await t.tick();
 deq({kind:t.prepared.at(-1).kind,draftId:t.prepared.at(-1).draftId,expectedDigest:t.prepared.at(-1).expectedDigest},{kind:'draft-replace',draftId:'d1',expectedDigest:'a'.repeat(64)},'editing replaces the same provider draft after review');
 assert.equal(t.dispatched.length,0);
 t.shell.componentWillUnmount();
}
// 6. Use in email: an agent suggestion becomes a local reply draft for the open message; nothing is sent.
{
 const t=await boot();t.mount();t.setActive(true);t.render();await t.tick();
 t.render().rows[1].open();await t.tick();
 assert.equal(t.views.inbox.useInEmail('Thanks, I will review it today.'),true);
 const c=t.render().c;assert.equal(c.body,'Thanks, I will review it today.');assert.equal(c.subject,'Re: Fixture m2');deq(c.chips.map(r=>r.name),['sender@example.invalid']);
 assert.match(c.status,/nothing has been sent/);assert.equal(t.prepared.length,0);assert.equal(t.dispatched.length,0);
 assert.equal(t.views.inbox.useInEmail('Second suggestion'),false,'an edited open draft is never overwritten');assert.match(t.toasts.at(-1),/not added/);
 deq(JSON.parse(JSON.stringify(t.views.inbox.suggestions(t.shell.st))),['Help me write this email']);
 t.shell.componentWillUnmount();
}
// 7. Reviewed "Use in email" (MVP-14): the destination named in the review is the only one that can be
// filled. A changed account, session, message or draft refuses the insert; existing text is never replaced.
{
 const two=[{connectionId:'grant-a',label:'a@example.invalid',connected:true,grantedCapabilities:['google.gmail.triage']},{connectionId:'grant-b',label:'b@example.invalid',connected:true,grantedCapabilities:['google.gmail.triage']}];
 const t=await boot({accounts:two});t.mount();t.setActive(true);t.render();await t.tick();
 const inbox=t.views.inbox,target=()=>JSON.parse(JSON.stringify(inbox.emailTarget()));
 // List view: a new email under the selected account.
 const fresh=target();deq({ready:fresh.ready,kind:fresh.kind,append:fresh.append,room:fresh.room,account:fresh.account,accountId:fresh.accountId},{ready:true,kind:'new',append:false,room:64000,account:'a@example.invalid',accountId:'grant-a'});
 // Open message: an exact reply target naming the sender's literal address and subject.
 t.render().rows[1].open();await t.tick();
 const reply=target();deq({kind:reply.kind,to:reply.to,subject:reply.subject,from:reply.from,reply:reply.reply},{kind:'reply',to:['sender@example.invalid'],subject:'Re: Fixture m2',from:'Sender',reply:true});
 assert.notEqual(reply.token,fresh.token,'the open message is part of the reviewed destination');
 assert.equal(inbox.useInEmail('Stale list review',{token:fresh.token}),false,'a review made before the message was opened cannot fill a reply');
 assert.equal(t.render().composing,false);
 // The message changes after review: another message is opened.
 t.shell.st.open=null;t.render().rows[0].open();await t.tick();if(t.render().d?.canLoadThread){t.render().d.loadThread();await t.tick();}
 assert.equal(inbox.useInEmail('For m2 only',{token:reply.token}),false,'a different open message refuses the reviewed text');
 assert.equal(t.render().composing,false,'no draft was created for the wrong message');
 // Current review inserts into exactly that reply.
 const m1=target();assert.equal(m1.subject,'Re: Fixture m1');
 assert.equal(inbox.useInEmail('Thanks, reviewed.',{token:m1.token}),true);
 let c=t.render().c;assert.equal(c.body,'Thanks, reviewed.');assert.equal(c.subject,'Re: Fixture m1');assert.equal(c.from,'From a@example.invalid');assert.match(c.status,/nothing has been sent/);
 // The open draft is now the destination and already has text: append only, and only when reviewed as append.
 const open=target();deq({kind:open.kind,append:open.append,reply:open.reply,subject:open.subject},{kind:'draft',append:true,reply:true,subject:'Re: Fixture m1'});
 assert.equal(inbox.useInEmail('Replace?',{token:open.token}),false,'text is never replaced without the reviewed append');
 assert.equal(t.render().c.body,'Thanks, reviewed.');
 // The user edits the draft after the review opened: the stale review cannot touch it.
 c.onBody({target:{value:'Thanks, reviewed. My own edit.'}});
 assert.equal(inbox.useInEmail('Second paragraph.',{token:open.token,append:true}),false,'an edited draft is not changed by a stale review');
 assert.equal(t.render().c.body,'Thanks, reviewed. My own edit.');
 const edited=target();assert.notEqual(edited.token,open.token);
 assert.equal(inbox.useInEmail('Second paragraph.',{token:edited.token,append:true}),true);
 c=t.render().c;assert.equal(c.body,'Thanks, reviewed. My own edit.\n\nSecond paragraph.');assert.match(c.status,/added below your text/);
 // Capacity: the review is told how much room is left, and an append that would exceed it changes nothing.
 const full=target();assert.equal(full.room,64000-'Thanks, reviewed. My own edit.\n\nSecond paragraph.'.length-2);
 assert.equal(inbox.useInEmail('x'.repeat(64000),{token:full.token,append:true}),false);assert.match(t.toasts.at(-1),/too long/);
 assert.equal(t.render().c.body,'Thanks, reviewed. My own edit.\n\nSecond paragraph.');
 // Account identity: after switching account the reviewed token for the first account is refused.
 t.render().c.confirmDiscard?.();await t.tick();
 t.shell.st.open=null;inbox.back(t.shell.st,t.api);const before=target();assert.equal(before.accountId,'grant-a');
 t.chip('b@example.invalid').pick();await t.tick();
 assert.equal(inbox.useInEmail('For account A',{token:before.token}),false,'the suggestion is not placed under another account');
 assert.equal(t.render().composing,false);
 const other=target();deq({account:other.account,accountId:other.accountId,kind:other.kind},{account:'b@example.invalid',accountId:'grant-b',kind:'new'});
 assert.equal(inbox.useInEmail('For account B',{token:other.token}),true);assert.equal(t.render().c.from,'From b@example.invalid');assert.equal(t.render().c.body,'For account B');
 // An empty open draft is filled, not appended.
 t.render().c.onBody({target:{value:''}});const empty=target();deq({kind:empty.kind,append:empty.append},{kind:'draft',append:false});
 assert.equal(inbox.useInEmail('Fills the empty draft',{token:empty.token}),true);assert.equal(t.render().c.body,'Fills the empty draft');
 // The Cloud session ends: no destination, and the old token is refused.
 const held=target();t.setSession(null);await t.tick();
 deq({ready:target().ready},{ready:false});assert.equal(inbox.useInEmail('After sign-out',{token:held.token}),false);
 assert.equal(t.prepared.length,0);assert.equal(t.dispatched.length,0,'Use in email never prepares or sends mail');
 t.shell.componentWillUnmount();
}
// 7b. A saved local draft that is not open blocks the review instead of being replaced or bypassed.
{
 const t=await boot();t.mount();t.setActive(true);t.render();await t.tick();
 const inbox=t.views.inbox;
 t.render().compose();await t.tick();t.render().c.onBody({target:{value:'Saved words'}});t.render().c.save();await t.tick();
 // Signing out and back in reloads the account's saved draft without opening it.
 t.setSession(null);await t.tick();t.setSession('session-a');await t.tick();t.render();await t.tick();
 const saved=JSON.parse(JSON.stringify(inbox.emailTarget()));
 deq({ready:saved.ready},{ready:false});assert.match(saved.reason,/saved local draft/);
 assert.equal(inbox.useInEmail('Not placed',{token:saved.token}),false);assert.equal(t.render().composing,false);
 assert.equal(JSON.stringify([...t.slots.values()]).includes('Saved words'),true,'the saved draft is intact');
 assert.equal(JSON.stringify([...t.slots.values()]).includes('Not placed'),false);
 assert.equal(t.dispatched.length,0);
 t.shell.componentWillUnmount();
}
// 7c. While a mail operation review is on screen the reviewed proposal cannot drift: suggestions are blocked.
{
 const t=await boot();t.mount();t.setActive(true);t.render();await t.tick();
 const inbox=t.views.inbox;
 t.render().rows[1].open();await t.tick();
 const ready=JSON.parse(JSON.stringify(inbox.emailTarget()));assert.equal(inbox.useInEmail('Reviewed reply',{token:ready.token}),true);
 const open=JSON.parse(JSON.stringify(inbox.emailTarget()));
 t.render().c.send();await t.tick();assert.equal(t.render().providerReview,true);assert.equal(t.prepared.length,1,'only the user\'s own Send prepared a review');
 const during=JSON.parse(JSON.stringify(inbox.emailTarget()));deq({ready:during.ready},{ready:false});assert.match(during.reason,/review that is open in Inbox/);
 assert.equal(inbox.useInEmail('Late addition',{token:open.token,append:true}),false);assert.equal(t.render().c.body,'Reviewed reply');
 assert.equal(t.dispatched.length,0);
 t.shell.componentWillUnmount();
}
// 7d. The reviewed recipients are the ones the reply draft really gets. A message from the account's own
// address (for example one opened from Sent) has no other reply address, so the review names none.
{
 const original=inboxPage[2].fromEmail;inboxPage[2].fromEmail='Owner@Example.invalid';
 try{
  const t=await boot();t.mount();t.setActive(true);t.render();await t.tick();
  const inbox=t.views.inbox;
  t.render().rows[2].open();await t.tick();
  const own=JSON.parse(JSON.stringify(inbox.emailTarget()));
  deq({ready:own.ready,kind:own.kind,to:own.to,subject:own.subject},{ready:true,kind:'reply',to:[],subject:'Re: Fixture m3'});
  assert.equal(inbox.useInEmail('Note to self',{token:own.token}),true);
  deq(t.render().c.chips.map(r=>r.name),own.to,'the draft holds exactly the reviewed recipients');
  assert.equal(t.prepared.length,0);assert.equal(t.dispatched.length,0);
  t.shell.componentWillUnmount();
 }finally{inboxPage[2].fromEmail=original;}
}
// 7e. One draft exists per account. A draft that was set aside is still the destination, so the review
// is told it is not on screen and, with another message open, that it is not a reply to that message.
// A reviewed suggestion is inserted whole or not at all.
{
 const t=await boot();t.mount();t.setActive(true);t.render();await t.tick();
 const inbox=t.views.inbox,target=()=>JSON.parse(JSON.stringify(inbox.emailTarget()));
 const fresh=target();assert.equal(inbox.useInEmail('x'.repeat(64001),{token:fresh.token}),false,'an over-long reviewed suggestion is refused, never shortened');
 assert.equal(t.render().composing,false);assert.equal(inbox.useInEmail('x'.repeat(64000),{token:fresh.token}),true);assert.equal(t.render().c.body.length,64000);
 t.render().c.confirmDiscard();await t.tick();assert.equal(t.render().composing,false);
 t.render().rows[1].open();await t.tick();
 const m2=target();assert.equal(inbox.useInEmail('For m2.',{token:m2.token}),true);
 const shown=target();deq({kind:shown.kind,aside:shown.aside,elsewhere:shown.elsewhere},{kind:'draft',aside:false,elsewhere:false});
 // The composer is closed: the draft stays, off screen, still over its own message.
 assert.equal(inbox.back(t.shell.st,t.api),true);assert.equal(t.render().composing,false);
 const aside=target();deq({kind:aside.kind,aside:aside.aside,elsewhere:aside.elsewhere,subject:aside.subject},{kind:'draft',aside:true,elsewhere:false,subject:'Re: Fixture m2'});
 assert.equal(inbox.useInEmail('Reviewed while the composer was open',{token:shown.token,append:true}),false,'closing the composer makes the earlier review stale');
 // Another message is opened: the destination is still the m2 draft, and the review is told so.
 t.shell.st.open=null;t.render().rows[0].open();await t.tick();if(t.render().d?.canLoadThread){t.render().d.loadThread();await t.tick();}
 const other=target();deq({kind:other.kind,aside:other.aside,elsewhere:other.elsewhere,subject:other.subject,to:other.to},{kind:'draft',aside:true,elsewhere:true,subject:'Re: Fixture m2',to:['sender@example.invalid']});
 assert.equal(inbox.useInEmail('Meant for m1',{token:aside.token,append:true}),false,'a review made over the draft\'s own message does not cover another open message');
 assert.equal(t.render().composing,false);
 assert.equal(inbox.useInEmail('Second paragraph.',{token:other.token,append:true}),true);
 const c=t.render().c;assert.equal(t.render().composing,true);assert.equal(c.subject,'Re: Fixture m2');assert.equal(c.body,'For m2.\n\nSecond paragraph.');
 assert.equal(t.prepared.length,0);assert.equal(t.dispatched.length,0);
 t.shell.componentWillUnmount();
}
console.log('PASS: Inbox attention (not-connected/ready/error/stale), one bounded Home header read, openInbox, reviewed HTTPS links in Browser, clip/time rows, Archive/Trash/Drafts folders, provider draft editing, three-attachment add/remove, forwarded source attachments, opaque Save to Files, Use in email and its reviewed destination binding. Fixture only; zero dispatches.');

// Preparation remains read-only and cannot retain revoked content or run after hiding.
const preparationFailures=[];
{
 const t=await boot();const events=new Map();const doc=t.sandbox.document;doc.hidden=false;doc.addEventListener=(name,fn)=>events.set(name,fn);doc.removeEventListener=name=>events.delete(name);
 const signals=[];t.client.gmailRead=async(_grant,id,signal)=>{signals.push(signal);return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Hidden','AbortError')),{once:true}));};
 t.mount();t.setActive(true);t.render();await t.tick();
 try{assert.equal(signals.length,2);doc.hidden=true;events.get('visibilitychange')?.();await t.tick();assert.ok(signals.every(signal=>signal.aborted),'hiding the page cancels every prepared body');const count=signals.length;t.render();await t.tick();assert.equal(signals.length,count,'no hidden-page preparation');}catch(error){preparationFailures.push(error);}finally{t.shell.componentWillUnmount();}
}
{
 const t=await boot();const doc=t.sandbox.document;doc.addEventListener=()=>{};doc.removeEventListener=()=>{};
 t.client.gmailRead=async()=>{throw Object.assign(new Error('Owned revoked fixture'),{name:'CloudProtocolError',code:'http',status:409});};
 t.mount();t.setActive(true);t.render();await t.tick();
 try{assert.equal(t.render().rows.length,0,'observed revoked preparation clears displayed and cached metadata');assert.equal(t.attention().state,'error');assert.equal(t.views.inbox.badge(),false);assert.equal(t.attention().source,null,'revoked cache has no source summary');}catch(error){preparationFailures.push(error);}finally{t.shell.componentWillUnmount();}
}
if(preparationFailures.length)throw new AggregateError(preparationFailures,'Gmail preparation lifecycle failures');
console.log('PASS prepared Gmail reads cancel on hide and invalidate content on observed revocation. Owned fixtures only.');

// Native notice taps clear retained folder/search before reads; cold hydration retains native state.
{
 const t=await boot();t.mount();t.setActive(true);t.render();await t.tick();
 t.chip('Sent').pick();await t.tick();t.shell.st.q='subject:old';
 const tap=()=>({token:'notice',grantId:'grant-a',credentialId:'fixture-credential',userId:'fixture-owner',generation:'native-generation'});
 t.mailNotices.tap=tap();t.mailNotices.listener();await t.tick();
 assert.equal(searches(t).at(-1)[1],'in:inbox','notice opens Inbox rather than retained Sent/search');
 assert.equal(t.shell.st.q,null);assert.equal(t.mailNotices.consumed.length,1);
 t.setSession(null);await t.tick();t.mailNotices.tap=tap();t.setSession('session-rehydrated');await t.tick();
 assert.equal(t.mailNotices.withdrawals,0,'renderer hydration never withdraws native cursor');
 assert.equal(t.mailNotices.consumed.length,2,'pending cold-start tap retried after Cloud hydration');
 t.mailNotices.tap=tap();for(const fn of t.resume)fn();await t.tick();assert.equal(t.mailNotices.consumed.length,3,'resume retries pending tap');
 t.shell.componentWillUnmount();
}

// Pausing while native lookup is pending retains the route instead of consuming unseen mail.
{
 const t=await boot();t.mount();await t.tick();let release;
 t.sandbox.pendingGmailNotice=()=>new Promise(resolve=>{release=resolve;});
 t.mailNotices.listener();await t.tick();t.sandbox.document.hidden=true;
 release({token:'paused',grantId:'grant-a',credentialId:'fixture-credential',userId:'fixture-owner',generation:'g'});await t.tick();
 assert.equal(t.mailNotices.consumed.length,0);assert.equal(t.shell.opened.length,0);t.shell.componentWillUnmount();
}

// Explicit Gmail Ask reads only after tapping and rechecks exact source before draft handoff.
{
 const t=await boot();t.mount();await t.tick();let reads=0;t.mailNotices.agent={sessionId:'agent'};
 t.client.gmailRead=async()=>{reads++;return {message:{id:'mail',threadId:'thread',subject:'Review subject',snippet:'Public snippet'},historyId:'10',bodyText:'BODY MUST NOT ENTER REVIEW',attachments:[]};};
 t.mailNotices.tap={token:'ask',grantId:'grant-a',credentialId:'fixture-credential',userId:'fixture-owner',generation:'generation',question:true,messageId:'mail',threadId:'thread'};
 assert.equal(reads,0);t.mailNotices.listener();await t.tick();assert.equal(reads,1);assert.equal(t.mailNotices.review.notice.text,'Public snippet');assert.equal(await t.mailNotices.review.recheck(),true);assert.equal(reads,2);
 await t.mailNotices.review.release();assert.equal(t.mailNotices.released,1);assert.equal(t.mailNotices.consumed.length,0);t.shell.componentWillUnmount();
}
