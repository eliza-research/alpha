import React from 'react';
import {MailFolderPicker} from '../.eliza/client-features/plugins/plugin-inbox/src/components/mailbox/MailFolderPicker.tsx';
import {mailSenderImage} from '../apps/app/src/runtime/mail-sender-image.ts';
import {decodeMailPreview} from '../apps/app/src/runtime/mail-preview.ts';
import {readGmailAccountChoice,saveGmailAccountChoice} from '../apps/app/src/runtime/gmail-account-selection.ts';
import {GmailReadAhead} from '../apps/app/src/runtime/gmail-read-ahead.ts';
import {presentHomeInboxCard} from '../apps/app/src/prototype/home-cards.ts';
// Real Inbox adapter lifecycle with an account-bound provider fixture, no real mail.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ServiceReadCache} from '../apps/app/src/runtime/service-read-cache.ts';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {composerKind,composerContent,reviewBinding,reviewBindingRefusal, InboxOperation } from '../apps/app/src/runtime/inbox-operation.ts';
import { reviewMailAttachment } from '../apps/app/src/runtime/inbox-attachment.ts';
import { reviewMailContext, validateMailContext } from '../apps/app/src/runtime/reviewed-mail-context.ts';
import { cloudServiceName, CloudProtocolError, safeMailLink } from '../apps/app/src/runtime/cloud-protocol.ts';
import { linkifyMailText, linkTextMismatch } from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/links.ts';
import { reviewOpaqueAttachment, checkOutgoingAttachments, outgoingAttachmentLimits, attachmentBytes } from '../apps/app/src/runtime/inbox-operation.ts';
import * as mailbox from '../apps/app/src/runtime/gmail-mailbox.ts';
import * as grants from '../apps/app/src/runtime/gmail-grants.ts';
import * as googleAccounts from '../apps/app/src/runtime/google-accounts.ts';
import { presentHomeInboxStatus } from '../apps/app/src/prototype/home-cards.ts';
import { formatTime } from '../apps/app/src/prototype/locale-time.ts';
import {createMailReviewController} from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/review-controller.ts';
import {createMailDraftsController} from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/drafts-controller.ts';
import * as mailboxList from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/mailbox-list.ts';
let session='account-a',agent='remote-a',releaseSearch,releaseAccounts,delayAccounts=true,delay=false,failNext=null,connected=true,readGrant=true,confirmAnswer=true;
const slots=new Map(),reads=[],searches=[],disconnects=[],toasts=[],events=[],initiates=[],handoffs=[];
// Authorization handoff stays off in this flow: Gmail consent moved to Settings › Google (google-connection-ui).
let oauthUrl=null,handoff=null,inboxActive=true;
const mail=(id,extra={})=>({id,threadId:'thread-'+id,subject:'Fixture '+id,from:'Sender',fromEmail:'sender@example.invalid',to:['fixture@example.invalid'],snippet:'Preview',receivedAt:'2026-09-30T00:00:00Z',unread:false,...extra});
// Gmail mailbox revision per page (elizaOS/eliza#35908); a query without an entry models an older Cloud server.
const revisions={};
const pages={'in:inbox':[[mail('mail-1',{unread:true}),mail('mail-2')],[mail('mail-2'),mail('mail-3')]],'in:sent':[[mail('sent-1',{to:['friend@example.invalid']})]],'from:fixture':[[mail('mail-1')]]};
let providerBody='Fixture body';
const client={
 gmailAccounts:async()=>{if(delayAccounts)await new Promise(resolve=>{releaseAccounts=resolve;});return [{connectionId:'grant-a',label:'Fixture account',connected,grantedCapabilities:connected&&readGrant?['google.gmail.triage']:[]}];},
 gmailSearch:async(_grant,query,_signal,size,pageToken)=>{searches.push({query,size,pageToken:pageToken??null});if(failNext){const error=failNext;failNext=null;throw error;}
  const list=pages[query]||[[]],index=pageToken?Number(pageToken.slice(5)):0,result={messages:list[index]||[],syncedAt:'revision',nextPageToken:index+1<list.length?'page-'+(index+1):null,...(revisions[query]?.[index]?{mailboxHistoryId:revisions[query][index]}:{})};
  if(delay)return new Promise(resolve=>{releaseSearch=()=>resolve(result);});return result;},
 gmailRead:async(_grant,id)=>{reads.push(id);return {message:Object.values(pages).flat(2).find(m=>m.id===id),bodyText:providerBody};},
 disconnectGmail:async(id)=>{disconnects.push(id);connected=false;},
 initiateGmail:async(...args)=>{initiates.push(args.slice(1));if(!oauthUrl)throw new Error('No automatic OAuth');return oauthUrl;},
};
const listeners=new Set();
const backgroundSelections=[];
const controller={getCloudClient:()=>session?{client,sessionId:session,credentialId:'fixture-credential'}:null,getSnapshot:()=>({session:{sessionId:agent},cloudAccount:session?{environment:'production',userId:'fixture-owner',sessionId:session,credentialId:'fixture-credential'}:null}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},rejectCloudSession:()=>false,open:()=>{}};
class Shell{renderVals(){return {};}constructor(){this.st={q:null,compose:null};}componentDidMount(){}componentWillUnmount(){}vset(_,p){Object.assign(this.st,p);}}
const views={inbox:{state:{}}};
const strip=async(file,name)=>{let source=await readFile(new URL(`../apps/app/src/prototype/${file}`,import.meta.url),'utf8');source=source.replace(/^import .*;\n/gm,'').replace(/^export (?=(?:async )?function |const |let |interface |type )/gm,'')+`\n${[].concat(name).map(n=>`globalThis.${n}=${n};`).join('')}`;return '{'+stripTypeScriptTypes(source,{mode:'transform'})+'}';};
const windowFixture={addEventListener:(name,fn)=>events.push({name,fn}),removeEventListener:()=>{},dispatchEvent:event=>{events.push({dispatched:event.type,detail:event.detail});return true;},confirm:()=>confirmAnswer};
class CustomEvent{constructor(type,init){this.type=type;this.detail=init?.detail;}}
let latestDraftEdit=null;
const inboxUnsaved=()=>({ready:Promise.resolve(),available:false,conflict:false,error:false,status:'',peek:()=>null,edit(record){latestDraftEdit=structuredClone(record);},clear:async()=>{},retire(){},resume(){}});
const sandbox={...mailboxList,createMailReviewController,createMailDraftsController,reviewMailAttachment,cloudServiceName,linkifyMailText,linkTextMismatch,React,MailFolderPicker,mailSenderImage,serviceReadCache:async()=>null,decodeMailPreview,cachedDevicePreferences:()=>({autoLoadMailImages:true}),initializeDevicePreferences:()=>{},configureGmailBackground:async selection=>{backgroundSelections.push(selection);},withdrawGmailBackground:async()=>{},pendingGmailNotice:async()=>null,consumeGmailNotice:async()=>{},onGmailNotice:async()=>({remove:async()=>{}}),prepareMailHtml:()=>{throw Error("HTML uses the rendered browser test");},readGmailAccountChoice:()=> 'grant-a',saveGmailAccountChoice,GmailReadAhead,URL,presentHomeInboxStatus,inboxUnsaved,InboxOperation,composerKind,composerContent,reviewBinding,reviewBindingRefusal,safeMailLink,reviewOpaqueAttachment,checkOutgoingAttachments,outgoingAttachmentLimits, attachmentBytes,reviewMailAttachment,reviewMailContext,validateMailContext,...mailbox,...googleAccounts,...grants,Event,googleConnectionController:{open(){throw Error('Explicit Google authorization not exercised by this read fixture');}},registerPlugin:()=>({cancel:async()=>{}}),crypto:globalThis.crypto,TextEncoder,structuredClone,secureConnectionStore:{read:async key=>slots.get(key)??null,compareExchange:async(key,prior,next)=>{if(JSON.stringify(slots.get(key)??null)!==JSON.stringify(prior))return {status:'conflict'};if(next===null)slots.delete(key);else slots.set(key,next);return {status:'saved'};}},connectionController:controller,DailyApps:{addListener:async()=>({remove:async()=>{}})},openConnectionBrowser:async(url,signal)=>{handoffs.push(url);if(!oauthUrl)throw new Error('No automatic OAuth');if(handoff)await new Promise((resolve,reject)=>{handoff.resolve=resolve;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});},queueMicrotask,setTimeout,AbortController,DOMException,Date,console,window:windowFixture,CustomEvent,document:{addEventListener(){},removeEventListener(){},documentElement:{dataset:{connectionMode:'live'}}}};
sandbox.inboxLocalStore=sandbox.secureConnectionStore;vm.createContext(sandbox);
for(const [file,name] of [['inbox-provider-controls.ts','inboxProviderControls'],['inbox-drafts.ts','inboxDrafts'],['inbox-cloud-adapter.ts',['installInboxCloudAdapter','inboxAttention','openInbox','linkifyMailText','linkTextMismatch']]])vm.runInContext(await strip(file,name),sandbox);
// Home's mail card is the shared overview presenter, read when Home renders.
sandbox.presentHomeInboxCard=presentHomeInboxCard;
sandbox.installInboxCloudAdapter(Shell,views);const inboxAttentionNow=()=>sandbox.inboxAttention();
const shell=new Shell();shell.componentDidMount();
const swipes=new Map();const api={sw:fn=>{const handlers={down(){},up(){}};swipes.set(handlers,fn);return handlers;},swallowed:()=>false,get:()=>shell.st,isActive:()=>inboxActive,set:p=>shell.vset('inbox',p),toast:text=>toasts.push(text)};
const render=()=>views.inbox.render(shell.st,api);const tick=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setTimeout(r,0));};
const local=value=>JSON.parse(JSON.stringify(value));// vm-realm arrays compare by value
const chip=label=>{if(label==='Check connection')return {pick:()=>shell.inboxAccountsChanged({})};if(label==='Refresh')return {pick:render().refresh};const found=[...render().chips,...render().extraFolders].find(c=>c.label===label);assert.ok(found,`chip ${label} in ${render().chips.map(c=>c.label)}`);return found;};

assert.equal(shell.renderVals().homeInboxTitle,'Inbox');assert.equal(searches.length,0,'Home does not discover accounts or read mail');
assert.equal(sandbox.inboxAttention().unread,undefined,'no count is claimed before any read');
// Home's read time is the completed first-page read; a later page or a local recount never moves it.
const realNow=Date.now,noon=new Date();noon.setHours(12,0,0,0);const clock=minutes=>{const value=noon.getTime()+minutes*60000;Date.now=()=>value;return formatTime(new Date(value));};
const firstRead=clock(0);
render();await tick();assert.equal(searches.length,1,'remembered first page starts before account discovery finishes');assert.equal(render().rows.length,0,'speculative mail is not displayed before account verification');delayAccounts=false;releaseAccounts();await tick();
assert.equal(shell.renderVals().homeInboxStatus,`Recent email · Updated ${firstRead}`,'a partial page names its read time');
assert.equal(shell.renderVals().homeInboxCount,'1+ unread');assert.deepEqual(local(shell.renderVals().homeInboxRows),[{subject:'Fixture mail-1',from:'Sender'}]);
assert.deepEqual(searches.map(s=>s.pageToken),[null,'page-1'],'one first page plus one bounded read-ahead');
assert.equal(render().rows.length,2);assert.equal(views.inbox.badge(),true,'badge reflects a real unread provider message');
assert.equal(render().hasMore,true,'provider page token offers Load more');
const laterPage=clock(7);assert.notEqual(laterPage,firstRead);
delay=true;render().loadMore();await tick();assert.equal(render().hasMore,true,'pending pagination stays visible');assert.equal(render().loadMoreLabel,'Loading more…');assert.equal(render().loadMoreDisabled,true);const pendingCount=searches.length;render().loadMore();await tick();assert.equal(searches.length,pendingCount,'double tap never starts another page');releaseSearch();delay=false;await tick();assert.equal(render().loadingMore,false);
assert.deepEqual(searches.at(-1),{query:'in:inbox',size:25,pageToken:'page-1'},'Load more sends the opaque provider page token');
assert.match(shell.renderVals().homeInboxStatus,new RegExp(` · Updated ${firstRead.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`),'a later page keeps the time of the oldest data counted');
assert.equal(shell.renderVals().homeInboxDescription,shell.renderVals().homeInboxStatus);
assert.deepEqual(local(render().rows.map(r=>r.subj)),['Fixture mail-1','Fixture mail-2','Fixture mail-3'],'pages append without duplicates');
assert.equal(render().hasMore,false,'last page has no Load more');
const beforeWarm=searches.length;views.inbox.onLeave();render();await tick();assert.equal(render().rows.length,3,'warm reopen restores only the same account list');assert.equal(render().cachedListShown,true);assert.equal(searches.length,beforeWarm,'warm reopen spends zero account or page requests');
assert.equal(shell.renderVals().homeInboxCount,'1 unread','complete paging removes the lower-bound qualifier');const homeSearches=searches.length;for(let i=0;i<5;i++)shell.renderVals();assert.equal(searches.length,homeSearches,'Home rerenders never fetch mail');
render();[...swipes.values()].at(-1)(-120,4);await tick();assert.match(toasts.at(-1),/Enable Gmail changes in Settings/,'swipe without the grant changes nothing');
const refreshed=clock(19);
chip('Refresh').pick();await tick();assert.deepEqual(searches.filter(s=>!s.pageToken).at(-1),{query:'in:inbox',size:25,pageToken:null},'Refresh restarts from the first page');
assert.match(shell.renderVals().homeInboxStatus,new RegExp(`Updated ${refreshed.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`),'a completed refresh moves the read time');
assert.equal(render().rows.length,2);
const readsBeforeOpen=reads.length;render().rows[0].open();assert.equal(render().d.body,'Fixture body','a prepared message opens immediately');await tick();assert.equal(reads.length,readsBeforeOpen,'opening the prepared body never repeats its read');
agent='remote-b';for(const fn of listeners)fn();assert.equal(shell.st.nativeMailSelection,null,'target change clears observation authority');assert.equal(render().d.body,'Fixture body','Cloud mailbox remains independent');
views.inbox.back(shell.st,api);
chip('Sent').pick();await tick();assert.equal(searches.at(-1).query,'in:sent','Sent folder uses an in:sent query');
assert.equal(render().rows[0].name,'To: friend@example.invalid','Sent rows show recipients');assert.equal(views.inbox.badge(),true,'Sent results do not clear the Inbox badge');assert.deepEqual(local(shell.renderVals().homeInboxRows),[{subject:'Fixture mail-1',from:'Sender'}],'Sent does not replace cached Inbox metadata');
const folderReturnSearches=searches.length;chip('Inbox').pick();assert.equal(render().rows.length,2,'folder switching immediately restores its loaded list');await tick();assert.equal(searches.filter(row=>!row.pageToken).at(-1).query,'in:sent','returning Inbox does not fetch its first page again');assert.equal(searches.length,folderReturnSearches,'cached folder switch adds no page read');Date.now=realNow;
render().openSearch();assert.equal(render().rows.length,0,'entering search clears prior-query results');render().onQ({target:{value:'from:fixture'}});
delay=true;render().submitSearch({preventDefault(){},currentTarget:{querySelector:()=>({value:shell.st.q,blur(){}})}});await tick();assert.match(shell.renderVals().homeInboxStatus,/Updating email/);session='account-b';for(const fn of listeners)fn();releaseSearch();await tick();assert.equal(render().rows.length,0,'late previous-account results discarded');
assert.equal(views.inbox.badge(),false,'account change clears the badge');assert.equal(shell.renderVals().homeInboxHasRows,false,'account change retires cached subjects');
delay=false;session='account-a';for(const fn of listeners)fn();render().closeSearch();await tick();assert.equal(shell.st.q,null);
render();await tick();assert.equal(render().rows.length,2,'re-bound account loads again');

// Classified failures each offer an explicit Retry; nothing retries on its own.
for(const [error,kind,text] of [[new TypeError('Failed to fetch'),'offline',/offline/],[new CloudProtocolError('http',409),'revoked',/revoked or needs authorization/],[new CloudProtocolError('http',503),'unavailable',/unavailable/]]){
 failNext=error;const before=searches.filter(s=>!s.pageToken).length;chip('Refresh').pick();await tick();
 assert.equal(searches.filter(s=>!s.pageToken).length,before+1,'one demand attempt only');assert.match(render().emptyText,text,kind);const home=shell.renderVals();if(kind==='revoked'){assert.equal(home.homeInboxHasRows,false,'revoked access retires cached Home subjects');assert.equal(home.homeInboxStatus,'','Home keeps the approved quiet uncached failure state');assert.equal(home.homeInboxState,'pending','an unverified failed read is not an empty success');assert.doesNotMatch(home.homeInboxCount,/0 unread|Nothing unread/,'failure never claims a verified empty Inbox');}else{assert.equal(home.homeInboxHasRows,true,'same-account cached mail survives a failed refresh');assert.match(home.homeInboxStatus,/retry/,'cached Home mail keeps its failed-refresh state');}chip('Retry');if(kind==='revoked')assert.equal(shell.renderVals().homeInboxHasRows,false,'revoked access drops cached subjects');
 if(kind==='revoked')chip('Reconnect Gmail');
 chip('Retry').pick();await tick();assert.equal(searches.filter(s=>!s.pageToken).length,before+2,'Retry is the explicit second demand attempt');assert.equal(render().rows.length,2);
}
// P-37: the read grant is withdrawn on the same connection. The re-read drops the shown mail, the
// Home preview and the badge at once; nothing read under the old grant is shown again.
assert.equal(shell.renderVals().homeInboxHasRows,true);assert.equal(views.inbox.badge(),true);
readGrant=false;chip('Check connection').pick();await tick();
assert.equal(render().rows.length,0,'mail read under the withdrawn grant is gone');assert.equal(shell.renderVals().homeInboxHasRows,false,'Home preview dropped');assert.equal(views.inbox.badge(),false,'badge dropped');
assert.equal(inboxAttentionNow().unread,undefined,'Home attention no longer counts the old mail and claims no count it did not read');
readGrant=true;const regranted=searches.filter(row=>!row.pageToken).length;chip('Check connection').pick();await tick();assert.equal(searches.filter(row=>!row.pageToken).length,regranted+1,'a renewed read grant reads again');assert.equal(render().rows.length,2);
assert.equal(mailbox.classifyGmailFailure(new CloudProtocolError('http',409),'operation').kind,'stale','operation 409 is a stale review');
assert.equal(mailbox.classifyGmailFailure(new CloudProtocolError('http',500),'read',false).kind,'offline','browser offline wins');

// Content shared from Notes becomes a reviewed local draft, not a silent no-op.
shell.st.compose={to:'Speaker name',subject:'Shared note',body:'· line one'};render();await tick();render();await tick();
assert.equal(shell.st.compose,null,'shared compose request is consumed once');
const composed=render();assert.equal(composed.composing,true,'shared content opens a composer');assert.equal(composed.c.subject,'Shared note');assert.equal(composed.c.body,'· line one');
assert.deepEqual(local(composed.c.chips),[],'non-address recipients are not guessed');assert.match(composed.c.status,/nothing has been sent/);
assert.equal(composed.c.attachLabel,'Attach file');assert.equal(composed.c.showRecipientDetails,false);composed.c.toggleRecipientDetails();assert.equal(render().c.showRecipientDetails,true);
assert.equal(composed.c.multi,false,'From switcher only appears with more than one account');
assert.deepEqual(local(views.inbox.suggestions(shell.st)),['Help me write this email']);
views.inbox.back(shell.st,api);composed.c.discard();render().c.confirmDiscard();await tick();
assert.deepEqual(local(views.inbox.suggestions(shell.st)),['Help me write an email'],'no unwired inbox automation chips (organize-inbox removed)');
assert.equal(render().composing,false,'discarded shared draft is gone');
shell.st.compose={subject:'Photo',body:'',attach:['photo-1']};render();await tick();render();await tick();
assert.equal(render().c.subject,'Photo');assert.deepEqual(local(render().c.atts),[],'prototype item ids are never turned into attachments');assert.match(render().c.status,/not attached automatically/);
views.inbox.back(shell.st,api);render().c.discard();render().c.confirmDiscard();await tick();
shell.st.compose={to:'second@example.invalid',subject:'Second share',body:'Earlier shared text'};render();await tick();render();await tick();assert.equal(render().c.subject,'Second share');
const secondShare=local(latestDraftEdit);assert.deepEqual(secondShare.draft.to,['second@example.invalid']);assert.equal(secondShare.draft.body,'Earlier shared text');
shell.st.compose={subject:'Third share',body:'New shared text'};render();await tick();render();await tick();assert.equal(render().c.subject,'Third share','a share opens a separate draft after preserving the open email');assert.equal(render().c.body,'New shared text');assert.match(render().c.status,/nothing has been sent/);
const preservedShelf=[...slots.entries()].find(([key])=>key.startsWith('inbox-drafts:v1:shelf:'))?.[1];
assert.ok(preservedShelf,'the previous email is stored on the account-bound shelf');assert.equal(preservedShelf.owner,secondShare.owner);
assert.deepEqual(local(preservedShelf.items),[{draft:secondShare.draft,toQ:secondShare.toQ}],'the entire previous draft, including id, revision, recipients and text, survives unchanged');
assert.notEqual(latestDraftEdit.draft.id,secondShare.draft.id,'the newly shared email has its own draft identity');
views.inbox.back(shell.st,api);render().c.discard();render().c.confirmDiscard();await tick();

// A removed message repeats no row, so only the mailbox revision shows that the later page came
// from a changed mailbox: the list offers Load newer mail. Same revision: no change is claimed.
const savedInbox=pages['in:inbox'];
pages['in:inbox']=[[mail('rev-1'),mail('rev-2')],[mail('rev-4')]];
for(const [label,second,changed] of [['same revision','1001',false],['changed revision','1002',true],['older server','',false]]){
 revisions['in:inbox']=second?['1001',second]:undefined;const toastsBefore=toasts.length;
 chip('Refresh').pick();await tick();assert.equal(render().hasMore,true,label);
 render().loadMore();await tick();
 assert.deepEqual(local(render().rows.map(r=>r.subj)),['Fixture rev-1','Fixture rev-2','Fixture rev-4'],`${label}: no row repeats`);
 assert.equal(render().chips.some(c=>c.label==='Load newer mail'),changed,`${label}: Load newer mail offered only for a changed revision`);
 assert.equal(toasts.slice(toastsBefore).some(t=>/Newer mail arrived/.test(t)),changed,`${label}: the change is reported once`);
 if(changed){const before=searches.length;chip('Load newer mail').pick();await tick();assert.deepEqual(searches.slice(before)[0],{query:'in:inbox',size:25,pageToken:null},'Load newer mail reloads from page one');assert.deepEqual(searches.slice(before+1).map(row=>row.pageToken),searches.length>before+1?['page-1']:[],'only the bounded read-ahead follows');assert.equal(render().chips.some(c=>c.label==='Load newer mail'),false,'a fresh first page clears the change');}
}
delete revisions['in:inbox'];pages['in:inbox']=savedInbox;
// Only a complete successful empty page can claim no unread mail.
pages['in:inbox']=[[]];chip('Refresh').pick();await tick();assert.equal(shell.renderVals().homeInboxTitle,'No unread email');assert.equal(shell.renderVals().homeInboxHasRows,false);
views.inbox.onLeave();const leftSearches=searches.length;assert.equal(shell.renderVals().homeInboxTitle,'No unread email','Home retains metadata after full messages are retired');assert.equal(searches.length,leftSearches,'returning Home never fetches mail');render();await tick();
// Accounts changed elsewhere while Inbox is closed: stale, with the count and time of the last real read.
views.inbox.onLeave();const lastRead=local(sandbox.inboxAttention());assert.equal(lastRead.state,'stale');assert.equal(lastRead.unread,0);assert.ok(lastRead.updatedAt,'the last read time is kept');
inboxActive=false;events.find(e=>e.name==='alpha:gmail-accounts-changed').fn(new CustomEvent('alpha:gmail-accounts-changed',{detail:{source:'settings'}}));
assert.deepEqual(local(sandbox.inboxAttention()),{...lastRead,state:'stale'},'stale keeps the last real read, never a new zero');
inboxActive=true;render();await tick();

// Account management lives in Settings; a connected inbox never prompts to connect again.
assert.equal(render().chips.some(c=>/Connect Gmail|Check connection|Authorize|Disconnect|Fixture account/.test(c.label)),false);
assert.equal(render().emptyAdd,false,'connected empty mailbox is not a connect prompt');
// Explicit refresh also refreshes bodies, including an older text-only response after a server upgrade.
pages['in:inbox']=[[mail('mail-1')]];chip('Refresh').pick();await tick();render().rows[0].open();await tick();assert.equal(render().d.body,'Fixture body');views.inbox.back(shell.st,api);providerBody='Fresh provider body';const beforeBodyRefresh=reads.length;chip('Refresh').pick();await tick();render().rows[0].open();await tick();assert.equal(render().d.body,'Fresh provider body');assert.ok(reads.length>beforeBodyRefresh,'Refresh never keeps an obsolete cached body');views.inbox.back(shell.st,api);
assert.deepEqual(disconnects,[],'Inbox has no disconnect mutation');
shell.componentWillUnmount();
console.log('PASS: Inbox auto-load, Refresh, provider paging, Sent folder, unread badge, account/query fences, classified errors with explicit Retry, shared compose prefill, compact toolbar and immediate pagination feedback. Provider fixture only.');

// A new adapter instance represents a reload: restore only the current owner's retained inbox.
const cachedAt=Date.now()-30000,cachedReadLabel=formatTime(new Date(cachedAt));
const retainedMailbox={accounts:[{connectionId:'grant-a',label:'Fixture account',connected:true,grantedCapabilities:['google.gmail.triage']}],selected:'grant-a',spamTrashSearch:false,lists:[{key:'old-session-key',at:cachedAt,firstPageRevision:null,messages:[mail('retained-unread',{unread:true})],query:'in:inbox',cursor:null,revision:'old-revision',cursors:[],newerMail:false,status:'Retained inbox'}],bodies:[]};
sandbox.serviceReadCache=async()=>({get:async key=>key==='gmail:mailbox'?{value:structuredClone(retainedMailbox)}:null,put:async()=>{},clear:async()=>{}});
// Without a nameable owner (no organization) the saved native selection and cursor are never withdrawn.
assert.equal(backgroundSelections.filter(selection=>selection===null).length,1,'only the unselected start withdraws; a selected account whose owner has no organization never does');const selectionsBeforeReload=backgroundSelections.length;
const priorSnapshot=controller.getSnapshot;controller.getSnapshot=()=>({...priorSnapshot(),cloudAccount:{...priorSnapshot().cloudAccount,organizationId:'fixture-org'}});
class ReloadShell {constructor(){this.st={q:null,compose:null};}renderVals(){return {};}componentDidMount(){}componentWillUnmount(){}vset(_,patch){Object.assign(this.st,patch);}}
const reloadViews={inbox:{state:{}}};sandbox.installInboxCloudAdapter(ReloadShell,reloadViews);const reloaded=new ReloadShell();reloaded.componentDidMount();
const reloadApi={...api,get:()=>reloaded.st,set:patch=>reloaded.vset('inbox',patch)};const searchesBeforeRestore=searches.length;
reloadViews.inbox.render(reloaded.st,reloadApi);await tick();
assert.equal(reloadViews.inbox.render(reloaded.st,reloadApi).rows.length,1,'cached Inbox renders after reload');
assert.equal(reloaded.renderVals().homeInboxCount,'1 unread','Home rebuilds the same cached unread count after reload');
assert.deepEqual(local(reloaded.renderVals().homeInboxRows),[{subject:'Fixture retained-unread',from:'Sender'}]);
assert.equal(reloaded.renderVals().homeInboxStatus,`Fixture account · Updated ${cachedReadLabel}`,'restore keeps the original read time');
assert.equal(searches.length,searchesBeforeRestore,'fresh retained snapshot needs no provider read to populate Home');
assert.equal(backgroundSelections.length,selectionsBeforeReload,'cold-start hydration neither withdraws nor reconfigures native background checks');
reloaded.componentWillUnmount();
console.log('PASS: Reloaded Inbox cache also restores Home subjects/count/time without a provider read.');

// Home's startup warmup: a late saved summary, a same-account rebind and a revoked grant.
{
 class WarmShell{constructor(){this.st={q:null,compose:null};}renderVals(){return {};}componentDidMount(){}componentWillUnmount(){}vset(_,patch){Object.assign(this.st,patch);}}
 const warmViews={inbox:{state:{}}};sandbox.installInboxCloudAdapter(WarmShell,warmViews);const home=new WarmShell(),warmApi={...api,get:()=>home.st,set:patch=>home.vset('inbox',patch)},inbox=()=>warmViews.inbox.render(home.st,warmApi);
 let release,cleared=0;const gate=new Promise(r=>{release=r;}),resumed=[];
 sandbox.serviceReadCache=async()=>({get:async key=>{await gate;return key==='gmail:mailbox'&&!cleared?{value:structuredClone(retainedMailbox)}:null;},put:async()=>{},clear:async()=>{cleared++;}});
 sandbox.DailyApps={addListener:async(_,fn)=>{resumed.push(fn);return {remove:async()=>{}};}};
 pages['in:inbox']=[[mail('fresh-1',{unread:true}),mail('fresh-2',{unread:true})]];inboxActive=false;const before=searches.length;
 home.componentDidMount();await tick();for(const fn of listeners)fn();await tick();release();await tick();
 assert.deepEqual(searches.slice(before),[{query:'in:inbox',size:25,pageToken:null}],'Home reads one bounded header page');
 assert.deepEqual(local(home.renderVals().homeInboxRows),[{subject:'Fixture fresh-1',from:'Sender'},{subject:'Fixture fresh-2',from:'Sender'}],'a saved summary that lands after the warmup never replaces it');
 inboxActive=true;inbox();await tick();inbox().rows[0].open();await tick();assert.equal(home.st.open,'fresh-1');const opened=searches.length;
 const rebound={...client};controller.getCloudClient=()=>session?{client:rebound,sessionId:session,credentialId:'fixture-credential'}:null;for(const fn of listeners)fn();await tick();
 assert.equal(inbox().rows.length,2,'a same-account rebind keeps the mailbox');assert.equal(home.st.open,'fresh-1','and the open message');assert.ok(inbox().d,'and its body');assert.equal(searches.length,opened,'and reads nothing again');
 warmViews.inbox.onLeave();inboxActive=false;assert.equal(home.renderVals().homeInboxHasRows,true);
 const now=Date.now;Date.now=()=>now()+61000;failNext=new CloudProtocolError('http',403);for(const fn of resumed)fn();await tick();Date.now=now;
 assert.equal(cleared,1,'a revoked warmup purges the saved mailbox');const revoked=home.renderVals();
 assert.equal(revoked.homeInboxHasRows,false,'and the Inbox page Home was showing');assert.equal(revoked.homeInboxStatus,'');assert.equal(warmViews.inbox.badge(),false);
 home.componentWillUnmount();
}
console.log('PASS: Home warmup outlives a late saved summary and a same-account rebind; a revoked warmup purges saved mail.');

// A fresh Home adapter never opens Inbox: `selected` must not mask the revoked restore gate.
for(const purgeFailure of ['reject','exhausted-cas'])await test(`a fresh Home shell cannot restore revoked subjects after ${purgeFailure} purge`,async()=>{
 class FreshHomeShell{constructor(){this.st={q:null,compose:null};}renderVals(){return {};}componentDidMount(){}componentWillUnmount(){}vset(_,patch){Object.assign(this.st,patch);}}
 const freshViews={inbox:{state:{}}};sandbox.installInboxCloudAdapter(FreshHomeShell,freshViews);
 let localGets=0,casAttempts=0,purgeSettled;
 const owner='fresh-revoked-cache-'+purgeFailure;
 const raw={version:1,owner,entries:[{key:'gmail:mailbox',at:Date.now(),value:structuredClone(retainedMailbox)}]};
 const cache=new ServiceReadCache(owner,{read:async()=>structuredClone(raw),compareExchange:async()=>{casAttempts++;if(purgeFailure==='reject')throw Error('Closed fixture failed purge');return 'conflict';}});
 const get=cache.get.bind(cache),clear=cache.clear.bind(cache);
 cache.get=async function(...args){localGets++;return get(...args);};
 cache.clear=function(){const task=clear();purgeSettled=task.then(()=>{},()=>{});return task;};
 const previousCache=sandbox.serviceReadCache,previousClient=controller.getCloudClient;
 sandbox.serviceReadCache=async()=>cache;controller.getCloudClient=()=>session?{client,sessionId:session,credentialId:'fixture-credential'}:null;
 const fresh=new FreshHomeShell();
 inboxActive=false;connected=true;readGrant=true;delay=false;delayAccounts=true;failNext=new CloudProtocolError('http',403);
 const beforeSearch=searches.length,beforeBodies=reads.length,priorAccountGate=releaseAccounts;
 try{
  fresh.componentDidMount();await tick();
  assert.equal(localGets,1,'fresh Home reads the real retained cache once before network decision');
  assert.deepEqual(local(fresh.renderVals().homeInboxRows),[{subject:'Fixture retained-unread',from:'Sender'}],'saved subject was genuinely visible before revocation');
  assert.equal(typeof releaseAccounts,'function','warmup discovery is pending, without an Inbox render/open');
  assert.notEqual(releaseAccounts,priorAccountGate,'this fresh shell reached its own gated account discovery');
  delayAccounts=false;releaseAccounts();await tick();
  assert.ok(purgeSettled,'warm403 actually called the real cache clear');await purgeSettled;await tick();
  assert.equal(casAttempts,purgeFailure==='reject'?1:3,'real ServiceReadCache exercised rejected or exhausted purge');
  assert.equal(raw.entries[0].value.lists[0].messages[0].subject,'Fixture retained-unread','failed purge leaves a real readable stale snapshot');
  assert.equal((await get('gmail:mailbox')).value.lists[0].messages[0].subject,'Fixture retained-unread','the real cache can still serve the stale saved subject after failed deletion');
  assert.equal(searches.length,beforeSearch+1,'one bounded warm page received403');
  assert.equal(fresh.renderVals().homeInboxHasRows,false,'warm403 initially retires its subject');
  const getsAfterRevocation=localGets;
  for(const listener of [...listeners])listener();await tick();
  const after=fresh.renderVals();
  assert.equal(after.homeInboxHasRows,false,'a NEW same-owner notification must not restore revoked subjects');
  assert.deepEqual(local(after.homeInboxRows),[],'no stale cached header survives known revocation');
  assert.equal(after.homeInboxStatus,'','the approved revoked-uncached state stays quiet');
  assert.equal(localGets,getsAfterRevocation,'the known revoked decision prevents a new cache read despite failed deletion');
  assert.equal(searches.length,beforeSearch+1,'notification does not silently retry provider access');
  assert.equal(reads.length,beforeBodies,'fresh Home never reads a body');
 }finally{
  fresh.componentWillUnmount();sandbox.serviceReadCache=previousCache;controller.getCloudClient=previousClient;delayAccounts=false;failNext=null;
 }
});
