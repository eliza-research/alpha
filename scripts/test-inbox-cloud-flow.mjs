import React from 'react';
import {MailFolderPicker} from '../apps/app/src/prototype/mail-folder-picker.tsx';
import {mailSenderImage} from '../apps/app/src/runtime/mail-sender-image.ts';
import {decodeMailPreview} from '../apps/app/src/runtime/mail-preview.ts';
import {readGmailAccountChoice,saveGmailAccountChoice} from '../apps/app/src/runtime/gmail-account-selection.ts';
import {GmailReadAhead} from '../apps/app/src/runtime/gmail-read-ahead.ts';
// Real Inbox adapter lifecycle with an account-bound provider fixture, no real mail.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {composerKind,composerContent,reviewBinding,reviewBindingRefusal, InboxOperation } from '../apps/app/src/runtime/inbox-operation.ts';
import { reviewMailAttachment } from '../apps/app/src/runtime/inbox-attachment.ts';
import { reviewMailContext, validateMailContext } from '../apps/app/src/runtime/reviewed-mail-context.ts';
import { cloudServiceName, CloudProtocolError, safeMailLink } from '../apps/app/src/runtime/cloud-protocol.ts';
import { reviewOpaqueAttachment, checkOutgoingAttachments, outgoingAttachmentLimits, attachmentBytes } from '../apps/app/src/runtime/inbox-operation.ts';
import * as mailbox from '../apps/app/src/runtime/gmail-mailbox.ts';
import * as grants from '../apps/app/src/runtime/gmail-grants.ts';
import * as googleAccounts from '../apps/app/src/runtime/google-accounts.ts';
import { presentHomeInboxStatus } from '../apps/app/src/prototype/home-cards.ts';
import { formatTime } from '../apps/app/src/prototype/locale-time.ts';
let accountReads=0,session='account-a',agent='remote-a',releaseSearch,releaseAccounts,delayAccounts=true,delay=false,failNext=null,connected=true,readGrant=true,confirmAnswer=true;
const slots=new Map(),reads=[],searches=[],disconnects=[],toasts=[],events=[],initiates=[],handoffs=[];
// Authorization handoff stays off in this flow: Gmail consent moved to Settings › Google (google-connection-ui).
let oauthUrl=null,handoff=null,inboxActive=true;
const mail=(id,extra={})=>({id,threadId:'thread-'+id,subject:'Fixture '+id,from:'Sender',fromEmail:'sender@example.invalid',to:['fixture@example.invalid'],snippet:'Preview',receivedAt:'2026-09-30T00:00:00Z',unread:false,...extra});
// Gmail mailbox revision per page (elizaOS/eliza#35908); a query without an entry models an older Cloud server.
const revisions={};
const pages={'in:inbox':[[mail('mail-1',{unread:true}),mail('mail-2')],[mail('mail-2'),mail('mail-3')]],'in:sent':[[mail('sent-1',{to:['friend@example.invalid']})]],'from:fixture':[[mail('mail-1')]]};
let providerBody='Fixture body';
const client={
 gmailAccounts:async()=>{accountReads++;if(delayAccounts)await new Promise(resolve=>{releaseAccounts=resolve;});return [{connectionId:'grant-a',label:'Fixture account',connected,grantedCapabilities:connected&&readGrant?['google.gmail.triage']:[]}];},
 gmailSearch:async(_grant,query,_signal,size,pageToken)=>{searches.push({query,size,pageToken:pageToken??null});if(failNext){const error=failNext;failNext=null;throw error;}
  const list=pages[query]||[[]],index=pageToken?Number(pageToken.slice(5)):0,result={messages:list[index]||[],syncedAt:'revision',nextPageToken:index+1<list.length?'page-'+(index+1):null,...(revisions[query]?.[index]?{mailboxHistoryId:revisions[query][index]}:{})};
  if(delay)return new Promise(resolve=>{releaseSearch=()=>resolve(result);});return result;},
 gmailRead:async(_grant,id)=>{reads.push(id);return {message:Object.values(pages).flat(2).find(m=>m.id===id),bodyText:providerBody};},
 disconnectGmail:async(id)=>{disconnects.push(id);connected=false;},
 initiateGmail:async(...args)=>{initiates.push(args.slice(1));if(!oauthUrl)throw new Error('No automatic OAuth');return oauthUrl;},
};
const listeners=new Set(),documentListeners=new Map(),appListeners=new Map();
const controller={getCloudClient:()=>session?{client,sessionId:session}:null,getSnapshot:()=>({session:{sessionId:agent},cloudAccount:session?{environment:'production',userId:'fixture-owner',sessionId:session}:null}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},rejectCloudSession:()=>false,open:()=>{}};
class Shell{renderVals(){return {};}constructor(){this.st={q:null,compose:null};}componentDidMount(){}componentWillUnmount(){}vset(_,p){Object.assign(this.st,p);}}
const views={inbox:{state:{}}};
const strip=async(file,name)=>{let source=await readFile(new URL(`../apps/app/src/prototype/${file}`,import.meta.url),'utf8');source=source.replace(/^import .*;\n/gm,'').replace(/^export (?=(?:async )?function |const |let |interface |type )/gm,'')+`\n${[].concat(name).map(n=>`globalThis.${n}=${n};`).join('')}`;return '{'+stripTypeScriptTypes(source,{mode:'strip'})+'}';};
const windowFixture={addEventListener:(name,fn)=>events.push({name,fn}),removeEventListener:()=>{},dispatchEvent:event=>{events.push({dispatched:event.type,detail:event.detail});return true;},confirm:()=>confirmAnswer};
class CustomEvent{constructor(type,init){this.type=type;this.detail=init?.detail;}}
let latestDraftEdit=null;
const inboxUnsaved=()=>({ready:Promise.resolve(),available:false,conflict:false,error:false,status:'',peek:()=>null,edit(record){latestDraftEdit=structuredClone(record);},clear:async()=>{},retire(){},resume(){}});
const sandbox={cloudServiceName,React,MailFolderPicker,mailSenderImage,serviceReadCache:async()=>null,decodeMailPreview,cachedDevicePreferences:()=>({autoLoadMailImages:true}),initializeDevicePreferences:()=>{},configureGmailBackground:async()=>{},withdrawGmailBackground:async()=>{},pendingGmailNotice:async()=>null,consumeGmailNotice:async()=>{},onGmailNotice:async()=>({remove:async()=>{}}),prepareMailHtml:()=>{throw Error("HTML uses the rendered browser test");},readGmailAccountChoice:()=> 'grant-a',saveGmailAccountChoice,GmailReadAhead,URL,presentHomeInboxStatus,inboxUnsaved,InboxOperation,composerKind,composerContent,reviewBinding,reviewBindingRefusal,safeMailLink,reviewOpaqueAttachment,checkOutgoingAttachments,outgoingAttachmentLimits, attachmentBytes,reviewMailAttachment,reviewMailContext,validateMailContext,...mailbox,...googleAccounts,...grants,Event,googleConnect:{start(){throw Error('Explicit Google authorization not exercised by this read fixture');},getSnapshot:()=>'idle',subscribe:()=>()=>{}},googleConnectNote:()=>'',googleConnectionController:{open(){throw Error('Explicit Google authorization not exercised by this read fixture');}},registerPlugin:()=>({cancel:async()=>{}}),crypto:globalThis.crypto,TextEncoder,structuredClone,secureConnectionStore:{read:async key=>slots.get(key)??null,compareExchange:async(key,prior,next)=>{if(JSON.stringify(slots.get(key)??null)!==JSON.stringify(prior))return {status:'conflict'};if(next===null)slots.delete(key);else slots.set(key,next);return {status:'saved'};}},connectionController:controller,DailyApps:{addListener:async(name,fn)=>{appListeners.set(name,fn);return {remove:async()=>{}};}},openConnectionBrowser:async(url,signal)=>{handoffs.push(url);if(!oauthUrl)throw new Error('No automatic OAuth');if(handoff)await new Promise((resolve,reject)=>{handoff.resolve=resolve;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});},queueMicrotask,setTimeout,AbortController,DOMException,Date,console,window:windowFixture,CustomEvent,document:{hidden:false,addEventListener(name,fn){documentListeners.set(name,fn);},removeEventListener(){},documentElement:{dataset:{connectionMode:'live'}}}};
sandbox.inboxLocalStore=sandbox.secureConnectionStore;vm.createContext(sandbox);
for(const [file,name] of [['inbox-provider-controls.ts','inboxProviderControls'],['inbox-drafts.ts','inboxDrafts'],['inbox-cloud-adapter.ts',['installInboxCloudAdapter','inboxAttention','openInbox','linkifyMailText','linkTextMismatch']]])vm.runInContext(await strip(file,name),sandbox);
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
render();[...swipes.values()].at(-1)(-120,4);await tick();assert.match(toasts.at(-1),/Reconnect Gmail to archive/,'swipe without the grant changes nothing');
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
for(const [error,kind,text] of [[new TypeError('Failed to fetch'),'offline',/^Offline$/],[new CloudProtocolError('http',409),'revoked',/needs to be reconnected/],[new CloudProtocolError('http',503),'unavailable',/unavailable/]]){
 failNext=error;const before=searches.filter(s=>!s.pageToken).length;chip('Refresh').pick();await tick();
 assert.equal(searches.filter(s=>!s.pageToken).length,before+1,'one demand attempt only');assert.match(render().emptyText,text,kind);assert.match(shell.renderVals().homeInboxStatus,/retry/,'Home keeps failure distinct from an empty Inbox');if(kind==='revoked')assert.equal(shell.renderVals().homeInboxHasRows,false,'revoked access drops cached subjects');
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
 assert.equal(toasts.slice(toastsBefore).some(t=>/New mail arrived/.test(t)),changed,`${label}: the change is reported once`);
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
// specs/quint/legacy/GoogleConnect.qnt "Inbox fresh on return": the return-to-front re-check is in flight when the
// connect flow reports the new grant; that report replaces the read instead of stranding Inbox.
{delayAccounts=true;const before=accountReads;documentListeners.get('visibilitychange')();await tick();assert.equal(accountReads,before+1,'returning to Alpha re-reads the grant');
const superseded=releaseAccounts;shell.inboxAccountsChanged({});await tick();assert.equal(accountReads,before+2,'a Google change during the re-check starts a fresh read');
delayAccounts=false;releaseAccounts();superseded();await tick();const out=render();assert.notEqual(out.emptyText,'Checking Gmail connection…');assert.ok(out.rows.length>0,'the mailbox loads after the grant changes');}
// Signed out, the empty state carries one Sign in button and no chip row (docs/flow-redesign-2026-11).
{const signIns=[];controller.openCloudAccount=()=>signIns.push(1);session=null;for(const fn of listeners)fn();await tick();const out=render();
// Coming back to Alpha signed out never opens the account sheet by itself, and Home offers no Connect Google.
const readsSignedOut=accountReads;documentListeners.get('visibilitychange')();appListeners.get('appResumed')();await tick();assert.equal(signIns.length,0,'returning to Alpha signed out opens nothing');assert.equal(accountReads,readsSignedOut);
{const snapshot=controller.getSnapshot;controller.getSnapshot=()=>({...snapshot(),startupResolved:true});assert.equal(shell.renderVals().homeGoogleConnected,undefined,'signed out, Google is not reported disconnected');controller.getSnapshot=snapshot;}
assert.equal(out.emptyText,'Sign in to use Inbox.');assert.equal(out.emptyAdd,true,'signed out shows the Sign in button');assert.equal(out.addAccountLabel,'Sign in');assert.equal(out.chips.length,0,'no separate Sign in chip');
out.addAcct();assert.equal(signIns.length,1,'Sign in opens the Cloud account flow, never Google consent');delete controller.openCloudAccount;session='account-a';for(const fn of listeners)fn();await tick();}
shell.componentWillUnmount();
console.log('PASS: Inbox auto-load, Refresh, provider paging, Sent folder, unread badge, account/query fences, classified errors with explicit Retry, shared compose prefill, compact toolbar and immediate pagination feedback. Provider fixture only.');

// A new adapter instance represents a reload: restore only the current owner's retained inbox.
const cachedAt=Date.now()-30000,cachedReadLabel=formatTime(new Date(cachedAt));
const retainedMailbox={accounts:[{connectionId:'grant-a',label:'Fixture account',connected:true,grantedCapabilities:['google.gmail.triage']}],selected:'grant-a',spamTrashSearch:false,lists:[{key:'old-session-key',at:cachedAt,firstPageRevision:null,messages:[mail('retained-unread',{unread:true})],query:'in:inbox',cursor:null,revision:'old-revision',cursors:[],newerMail:false,status:'Retained inbox'}],bodies:[]};
sandbox.serviceReadCache=async()=>({get:async key=>key==='gmail:mailbox'?{value:structuredClone(retainedMailbox)}:null,put:async()=>{},clear:async()=>{}});
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
reloaded.componentWillUnmount();
console.log('PASS: Reloaded Inbox cache also restores Home subjects/count/time without a provider read.');
