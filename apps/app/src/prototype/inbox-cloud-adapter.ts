import React from 'react';
import {MailFolderPicker} from './mail-folder-picker';
import {serviceReadCache} from '../runtime/service-read-cache-store';
import type {ServiceReadCache} from '../runtime/service-read-cache';
import {mailSenderImage} from '../runtime/mail-sender-image';
import {decodeMailPreview} from '../runtime/mail-preview';
import {alphaClient} from '../runtime/alpha-client';
import {reviewOwnNoticeQuestion} from './own-notice-question';
import {configureGmailBackground,withdrawGmailBackground,releaseGmailQuestion,pendingGmailNotice,consumeGmailNotice,onGmailNotice} from '../runtime/gmail-background';
import {cachedDevicePreferences,initializeDevicePreferences} from '../browser/device-preferences';
import {prepareMailHtml} from '../runtime/mail-html';
import {readGmailAccountChoice,saveGmailAccountChoice} from '../runtime/gmail-account-selection';
import {GmailReadAhead} from '../runtime/gmail-read-ahead';
import { registerPlugin } from '../platform-plugins';
const attachmentNative=registerPlugin<{openReviewed(input:Record<string,unknown>):Promise<{message:string}>;saveReviewed(input:Record<string,unknown>):Promise<{status:string;message:string}>;cancel():Promise<void>}>('AlphaMailAttachments');
import {reviewMailContext,validateMailContext,type ReviewedMailContext,type MailContextSource} from '../runtime/reviewed-mail-context';
import { inboxProviderControls } from './inbox-provider-controls';
import { presentHomeAttention, presentHomeInboxStatus } from './home-cards';
import { inboxDrafts, type ComposePrefill, type SuggestionTarget } from './inbox-drafts';
import { attachmentReadFailure, classifyGmailFailure, gmailReadable, setGmailReadState, GMAIL_ACCOUNTS_CHANGED, type GmailFailureKind } from '../runtime/gmail-mailbox';
import { connectionController, agentPendingText } from '../runtime/connection-ui';
import { gmailGrantChange, gmailInboxAllows, gmailModifyIncomplete, gmailReadCacheKey } from '../runtime/gmail-grants';
import { safeMailLink, type GmailAccount, type GmailDraftContent, type GmailDraftSummary, type GmailLink, type GmailMessage } from '../runtime/cloud-protocol';
import { reviewOpaqueAttachment } from '../runtime/inbox-operation';
import {googleConnect,googleConnectNote} from '../runtime/google-connect-flow';
import {GOOGLE_ACCOUNTS_CHANGED} from '../runtime/google-accounts';
import { DailyApps } from '../daily';

type Bag = Record<string, any>;
/** A suggestion destination with the account it belongs to. Tokens stay inside the renderer. */
export type EmailTarget = SuggestionTarget & { accountId?: string; account?: string };
/** What Home may show about mail. Only counts, the account label and a time leave the Inbox closure;
 * no subject, sender or body. `unreadMore` means the bounded query or loaded pages did not see every message. */
export interface InboxAttention {
  state: 'not-connected' | 'loading' | 'ready' | 'error' | 'stale';
  /** Undefined until a page was read: a stale or loading state never claims a count it did not see. */
  unread: number | undefined; unreadMore: boolean; source: string | null; updatedAt: string | null;
}
let attention: InboxAttention = { state: 'not-connected', unread: undefined, unreadMore: false, source: null, updatedAt: null };
const attentionListeners = new Set<() => void>();
let openInboxHandler: (() => void) | null = null;
function setAttention(next: Partial<InboxAttention>) {
  const value = { ...attention, ...next };
  if (JSON.stringify(value) === JSON.stringify(attention)) return;
  attention = value;
  for (const listener of [...attentionListeners]) { try { listener(); } catch { /* a listener failure never blocks Inbox */ } }
}
/** Home attention summary, computed from the connected account and the last explicitly loaded Inbox page. */
export function inboxAttention(): InboxAttention { return { ...attention }; }
export function subscribeInboxAttention(listener: () => void): () => void { attentionListeners.add(listener); return () => { attentionListeners.delete(listener); }; }
/** Opens the Inbox list (Home's triage tile). A no-op until the Inbox adapter is installed. */
export function openInbox(): void { openInboxHandler?.(); }
/** Plain-text https URLs in a message body, trimmed of trailing punctuation. Nothing is fetched. */
export function linkifyMailText(text: string): GmailLink[] {
  const links: GmailLink[] = [], seen = new Set<string>();
  for (const match of String(text || '').matchAll(/https:\/\/[^\s<>"'`]+/gi)) {
    // Trailing punctuation is trimmed in one linear pass (hostile bodies may end a URL with a long run
    // of ")"); a ")" stays while it closes a "(" in the URL.
    const raw = match[0];
    let end = raw.length, open = 0, close = 0;
    for (const c of raw) { if (c === '(') open++; else if (c === ')') close++; }
    while (end > 0 && '.,;:!?)]}>'.includes(raw[end - 1])) { if (raw[end - 1] === ')') { if (open >= close) break; close--; } end--; }
    const link = safeMailLink({ href: raw.slice(0, end), text: raw.slice(0, end) });
    if (link && !seen.has(link.href)) { seen.add(link.href); links.push(link); }
    if (links.length >= 50) break;
  }
  return links;
}
/** The link text names a different site than the destination (a common phishing pattern). */
export function linkTextMismatch(link: GmailLink): boolean {
  let host: string;
  try { host = new URL(link.href).hostname.toLowerCase().replace(/^www\./, ''); } catch { return true; }
  const named = link.text.toLowerCase().match(/(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,63})(?=[\/:\s]|$)/);
  if (!named) return false;
  const shown = named[1].replace(/^www\./, '');
  return shown !== host && !host.endsWith('.' + shown);
}
/** Managed Gmail reads and explicit encrypted local drafts in the reference Inbox layout. Provider content lives
 * only in this closure, never prototype persistence or automatic agent context. */
export function installInboxCloudAdapter(Component: any, views: Record<string, Bag>) {
  const view = views.inbox, p = Component.prototype;
  view.persist = [];
  view.state = { ...view.state, mails: [], sent: [], open: null, compose: null, q: null, nativeMailSelection: null };
  view.reply = () => null;
  let shell: Bag | undefined, api: Bag | undefined;
  let accounts: GmailAccount[] = [], messages: GmailMessage[] = [], accountsChecked = false,accountsSession='';
  type Folder = 'inbox' | 'sent' | 'drafts' | 'archive' | 'trash' | 'starred' | 'all' | 'spam';
  const MAILBOX_CHANGED = 'New mail arrived.';
  let newerMail = false,spamTrashSearch=false;
  /** Gmail mailbox revision reported with the first page of the loaded list, when the server sends one. */
  let firstPageRevision: string | null = null;
  const watchSelectedMail=()=>{const binding=connectionController.getCloudClient();if(binding)void configureGmailBackground(binding.credentialId,selected).catch(()=>{});};
  let closeMailQuestion:(()=>void)|undefined;
  let noticeAttempt=0,noAgentNoticeToken='';
  async function openNotice(){
    if(document.hidden||!shell||closeMailQuestion)return;
    const noticeShell=shell,attempt=++noticeAttempt;
    try{
      const tap=await pendingGmailNotice(),binding=connectionController.getCloudClient(),owner=connectionController.getSnapshot().cloudAccount;
      if(document.hidden||shell!==noticeShell||attempt!==noticeAttempt||!tap||!binding||!owner||binding.credentialId!==tap.credentialId||owner.userId!==tap.userId)return;
      const rows=await binding.client.gmailAccounts(new AbortController().signal);
      const current=()=>!document.hidden&&shell===noticeShell&&attempt===noticeAttempt&&connectionController.getCloudClient()?.sessionId===binding.sessionId&&connectionController.getCloudClient()?.credentialId===tap.credentialId;
      if(!current())return;
      const account=rows.find(row=>row.connectionId===tap.grantId&&gmailReadable(row));if(!account)return;
      if(tap.question){
        const agent=connectionController.getSnapshot().session,enrollment=JSON.stringify(connectionController.getWorkflowDeviceTarget());
        const live=()=>current()&&connectionController.getSnapshot().session===agent&&JSON.stringify(connectionController.getWorkflowDeviceTarget())===enrollment&&!connectionController.getSnapshot().open&&!alphaClient.getState().context.sensitive;
        if(!agent&&current()&&noAgentNoticeToken!==tap.token){noAgentNoticeToken=tap.token;noticeShell.toast('Select an agent before asking about this message. The notification is retained.');}
        if(!agent||!tap.messageId||!tap.threadId||!live())return;
        // Explicit Ask reads the exact current message; background delivery never fetches its body.
        // Only the subject/snippet selected here enters review, never body or attachments.
        let read:Awaited<ReturnType<typeof binding.client.gmailRead>>;
        try{read=await binding.client.gmailRead(tap.grantId,tap.messageId,new AbortController().signal);}
        catch{if(live()){accounts=rows;accountsChecked=true;accountsSession=binding.sessionId;folder='inbox';spamTrashSearch=false;publish({q:null,open:null});selectAccount(account,true);noticeShell.openView?.('inbox',{open:null,q:null});noticeShell.toast('The notification message is unavailable. Review Inbox; nothing was added to your conversation.');}return;}
        if(!live()||read.message.id!==tap.messageId||read.message.threadId!==tap.threadId)return;
        const excerpt={id:tap.messageId,revision:tap.generation,source:'own' as const,appLabel:'Alpha Phone',title:read.message.subject,text:read.message.snippet};
        const revision=read.historyId;
        closeMailQuestion=reviewOwnNoticeQuestion({notice:excerpt,current:live,recheck:async()=>{
          const again=await pendingGmailNotice();if(!live()||again?.token!==tap.token||!again.question||again.generation!==tap.generation)return false;
          const fresh=await binding.client.gmailRead(tap.grantId,tap.messageId!,new AbortController().signal);
          return live()&&fresh.historyId===revision&&fresh.message.id===tap.messageId&&fresh.message.threadId===tap.threadId&&fresh.message.subject===excerpt.title&&fresh.message.snippet===excerpt.text;
        },consume:()=>consumeGmailNotice(tap.token),release:()=>releaseGmailQuestion(tap.token),compose:draft=>noticeShell.api(noticeShell.S().view).composeContentQuestion(draft),report:message=>noticeShell.toast(message),closed:()=>{closeMailQuestion=undefined;}});
        return;
      }
      // Consumption rechecks the native generation. A tap opens only the Inbox list, never marks a message read.
      await consumeGmailNotice(tap.token);if(!current()||!shell)return;
      accounts=rows;accountsChecked=true;accountsSession=binding.sessionId;folder='inbox';spamTrashSearch=false;publish({q:null,open:null});selectAccount(account,true);shell.openView?.('inbox',{open:null,q:null});
    }catch{/* A stale, locked or revoked tap cannot reveal another account's Inbox. */}
  }
  const folderQuery: Record<Folder, string> = { inbox: 'in:inbox', sent: 'in:sent', drafts: 'in:drafts', archive: 'in:archive', trash: 'in:trash', starred:'is:starred', all:'-in:spam -in:trash',spam:'in:spam' };
  let loadedQuery = '', nextPageToken: string | null = null, folder: Folder = 'inbox';
  // Provider drafts are listed separately from messages.
  let providerDrafts: GmailDraftSummary[] = [];
  // Only a boolean leaves this closure: the Home badge reflects the last loaded Inbox page(s).
  // Home retains only metadata from Inbox pages the user already loaded, never message bodies.
  // `key` is the P-37 read-cache identity (Cloud session, connection, read grant): Home shows the
  // preview only while the selected account still has that identity.
  type InboxPreview = {key:string;sessionId:string;accountId:string;messages:Pick<GmailMessage,'id'|'subject'|'from'|'unread'>[];more:boolean;readAt:number|null};
  let inboxPreview:InboxPreview|null=null;
  let homePreview:(InboxPreview&{owner:string;label:string})|null=null;
  let homeFailure:GmailFailureKind|null=null;
  let hasUnread = false;
  let failure: { kind: GmailFailureKind; retry: () => void } | null = null;
  // A moved email (From switcher) names its target account and how to return it to the source.
  type PendingCompose = ComposePrefill & { account?: string; returnTo?: GmailAccount; restore?: () => void };
  let pendingCompose: PendingCompose | null = null, lastCompose: unknown = null, resumeDraftFor = '', composeAttempt = 0;
  // Read-state requests are keyed by account and message. One may be in flight per message, and an
  // automatic mark-read whose outcome was not confirmed is never sent again for that message.
  const readStateInFlight = new Set<string>(), readStateUnconfirmed = new Set<string>();
  let seenCursors = new Set<string>();
  /** Retires queued shares and returns a pending moved email to its source account. */
  const returnPending = () => { composeAttempt++; pendingCompose?.restore?.(); pendingCompose = null; };
  let thread: {id:string;previousOffsets:number[];offset:number;historyId:string;nextOffset:number|null;total:number;messages:{message:GmailMessage;bodyText:string;links?:GmailLink[];historyId:string|null;attachments?:{partId:string;name:string;mimeType:string;size:number;supported:boolean}[]}[]}|null=null;
  let contextReview:ReviewedMailContext|null=null,contextBusy=false;
  // Link rows per opened body: the body text is scanned once, not on every render.
  const linkRowCache=new WeakMap<object,{label:string;href:string;host:string;mismatch:boolean;open:()=>void}[]>();
  let attachmentView:{name:string;text:string;hash:string;external:boolean;open:()=>void;save:()=>void;saveDisabled:boolean;saveStatus:string}|null=null;
  type MailBody={ message: GmailMessage; bodyText: string;bodyHtml?:string; loading?:boolean;failed?:boolean; links?: GmailLink[]; historyId?:string|null;attachments?:{partId:string;name:string;mimeType:string;size:number;supported:boolean}[] };
  let selected='',body:MailBody|null=null;
  let remoteImagesShown=false;
  const htmlBodies=new WeakMap<MailBody,Partial<Record<'hidden'|'shown',ReturnType<typeof prepareMailHtml>>>>();
  const messageBodies=new Map<string,{at:number;body:MailBody}>();
  const pendingBodies=new Map<string,{controller:AbortController;result:Promise<{ok:true;body:MailBody}|{ok:false;error:unknown}>}>();
  function stopBodyReads(){for(const row of pendingBodies.values())row.controller.abort();pendingBodies.clear();}
  // Budget: at most two read-only bodies ahead while Inbox is visible. No label
  // changes, attachments, timers or background reads after leaving the app.
  function prepareBodies(){
    const binding=connectionController.getCloudClient(),accountId=selected;
    if(!binding||typeof binding.client.gmailRead!=='function'||!api?.isActive()||document.hidden||draftsView()||drafts.render().composing)return;
    for(const message of messages.slice(0,2)){
      const key=bodyKey(message.id),cached=messageBodies.get(key);
      if(cached&&Date.now()-cached.at<LIST_TTL||pendingBodies.has(key)||pendingBodies.size>=2)continue;
      const controller=new AbortController();
      const result=binding.client.gmailRead(accountId,message.id,controller.signal).then(value=>{
        if(value.message.id!==message.id)throw Error('Mailbox message changed');
        controller.signal.throwIfAborted();if(key!==bodyKey(message.id)||!api?.isActive())throw new DOMException('Mailbox changed','AbortError');
        rememberBody(value);return {ok:true as const,body:value};
      },error=>({ok:false as const,error})).catch(error=>({ok:false as const,error}));
      pendingBodies.set(key,{controller,result});
      void result.then(outcome=>{
        if(pendingBodies.get(key)?.controller===controller)pendingBodies.delete(key);
        if(outcome.ok||controller.signal.aborted||key!==bodyKey(message.id)||!api?.isActive())return;
        if(connectionController.rejectCloudSession(binding.sessionId,outcome.error))return;
        const classified=classifyGmailFailure(outcome.error,'read');
        if(classified.kind!=='revoked')return;
        invalidateList();generation++;operation?.abort();operation=null;
        messages=[];providerDrafts=[];body=null;thread=null;nextPageToken=null;loadedQuery='';hasUnread=false;inboxPreview=null;accountsChecked=false;
        phase='error';status=classified.message;homeFailure='revoked';failure={kind:'revoked',retry:()=>void refreshAccounts()};
        setAttention({state:'error',unread:undefined,unreadMore:false,source:null,updatedAt:null});
        publish({open:null,nativeMailSelection:null});
      });
    }
  }

  const bodyKey=(id:string)=>{const binding=connectionController.getCloudClient();return JSON.stringify([binding?.sessionId,binding?.credentialId,selected,id]);};
  function rememberBody(value:MailBody){if(value.loading)return;const key=bodyKey(value.message.id);messageBodies.delete(key);messageBodies.set(key,{at:Date.now(),body:value});let bytes=0;for(const row of messageBodies.values())bytes+=new TextEncoder().encode(JSON.stringify(row.body)).length;while(messageBodies.size>16||bytes>4*1024*1024){const first=messageBodies.keys().next().value!;bytes-=new TextEncoder().encode(JSON.stringify(messageBodies.get(first)!.body)).length;messageBodies.delete(first);}persistMailbox();}
  let status = 'Sign in to use Inbox.', phase = 'idle', revision = '';
  let agentSession = connectionController.getSnapshot().session?.sessionId;
  let operation: AbortController | null = null, generation = 0, sessionId: string | undefined;
  const readAhead = new GmailReadAhead<Awaited<ReturnType<NonNullable<ReturnType<typeof connectionController.getCloudClient>>['client']['gmailSearch']>>>();
  const LIST_TTL = 300000;
  let listReadAt=0,cachedListShown=false;
  type CachedList={key:string;at:number;firstPageRevision:string|null;messages:GmailMessage[];query:string;cursor:string|null;revision:string;cursors:string[];newerMail:boolean;status:string};
  const folderLists=new Map<string,CachedList>();
  let offline:ServiceReadCache|null=null,offlineIdentity='',mailCacheEpoch=0,homeRestoreAttempt='';
  type CachedMailbox = {accounts:GmailAccount[];selected:string;spamTrashSearch:boolean;lists:CachedList[];bodies:{at:number;body:MailBody}[]};
  const offlineOwner=()=>{const account=connectionController.getSnapshot().cloudAccount,binding=connectionController.getCloudClient();return account?.organizationId&&binding?{environment:account.environment,userId:account.userId,organizationId:account.organizationId,credentialId:binding.credentialId}:null;};
  async function offlineStore(){const owner=offlineOwner();if(!owner)return null;const identity=JSON.stringify(owner),cache=await serviceReadCache(owner);if(JSON.stringify(offlineOwner())!==identity)return null;offline=cache;offlineIdentity=identity;return cache;}
  /** One local, owner-bound startup read; no mailbox refresh, body read or draft binding. */
  async function restoreHomeMailbox(){
    const binding=connectionController.getCloudClient(),owner=offlineOwner();
    if(!binding||!owner||!shell||selected||api?.isActive()||Object.values(owner).some(v=>typeof v!=='string'||!v))return;
    const identity=JSON.stringify(owner),attempt=JSON.stringify([identity,binding.sessionId]);
    if(homeRestoreAttempt===attempt)return;
    homeRestoreAttempt=attempt;
    const token=generation,epoch=mailCacheEpoch;
    try{
      const saved=await(await offlineStore())?.get<CachedMailbox>('gmail:mailbox'),active=connectionController.getCloudClient();
      if(!saved||!shell||selected||api?.isActive()||generation!==token||mailCacheEpoch!==epoch||identity!==JSON.stringify(offlineOwner())||binding.client!==active?.client||binding.sessionId!==active?.sessionId)return;
      const value=saved.value,hint=readGmailAccountChoice(connectionController.getSnapshot().cloudAccount);
      if(!Array.isArray(value.accounts)||!Array.isArray(value.lists)||hint&&hint!==value.selected)return;
      const account=value.accounts.find(a=>a&&a.connectionId===value.selected&&typeof a.label==='string'&&Array.isArray(a.grantedCapabilities)&&gmailReadable(a));
      if(!account)return;
      const now=Date.now(),row=value.lists.filter(r=>r?.query==='in:inbox'&&Number.isFinite(r.at)&&r.at<=now&&now-r.at<30*86400000).sort((a,b)=>b.at-a.at)[0];
      if(!row||!Array.isArray(row.messages)||row.messages.length>100||row.cursor!==null&&typeof row.cursor!=='string'||row.messages.some(m=>!m||typeof m.id!=='string'||typeof m.subject!=='string'||typeof m.from!=='string'||typeof m.unread!=='boolean'))return;
      const key=gmailReadCacheKey(binding.sessionId,account);if(!key)return;
      const messages=row.messages.map(({id,subject,from,unread})=>({id,subject,from,unread})),unread=messages.filter(m=>m.unread).length;
      homePreview={key,owner:identity,label:account.label,sessionId:binding.sessionId,accountId:value.selected,messages,more:row.cursor!==null,readAt:row.at};
      hasUnread=unread>0;
      setAttention({state:'stale',unread,unreadMore:row.cursor!==null,source:account.label,updatedAt:new Date(row.at).toISOString()});
      publish();
    }catch{/* Inbox can still open normally when its optional saved Home summary is unavailable. */}
  }
  // Cost: one bounded local snapshot write after a successful page/body read. No credentials or timers.
  function persistMailbox(){const epoch=mailCacheEpoch;if(!accountsChecked||!selected||failure)return;const accountId=selected,snapshot={accounts,selected,spamTrashSearch,lists:[...folderLists.values()].filter(row=>JSON.parse(row.key)[2]===selected),bodies:[...messageBodies.values()]};void offlineStore().then(cache=>{if(cache&&epoch===mailCacheEpoch&&selected===accountId)return cache.put('gmail:mailbox',snapshot);}).catch(()=>{});}
  function purgeOffline(){++mailCacheEpoch;if(offline)void offline.clear().catch(()=>{});offline=null;offlineIdentity='';homePreview=null;homeRestoreAttempt='';}
  async function restoreMailbox(){
    const binding=connectionController.getCloudClient(),token=generation;
    try{
      const cache=await offlineStore(),saved=await cache?.get<CachedMailbox>('gmail:mailbox');
      const active=connectionController.getCloudClient();if(!saved||generation!==token||binding?.client!==active?.client||binding?.sessionId!==active?.sessionId||!api?.isActive())return false;
      const value=saved.value,hint=readGmailAccountChoice(connectionController.getSnapshot().cloudAccount);
      if(!Array.isArray(value.accounts)||!value.accounts.every(a=>a&&typeof a.label==='string'&&Array.isArray(a.grantedCapabilities))||!Array.isArray(value.lists)||!Array.isArray(value.bodies)||hint&&hint!==value.selected)return false;
      const chosen=value.accounts.find(a=>a.connectionId===value.selected&&gmailReadable(a));if(!chosen)return false;
      accounts=value.accounts;selected=value.selected;accountsChecked=true;accountsSession=binding!.sessionId;spamTrashSearch=value.spamTrashSearch===true;
      for(const row of value.lists){if(!Array.isArray(row.messages)||row.messages.some(m=>!m||typeof m.id!=='string'||typeof m.from!=='string'||typeof m.snippet!=='string'||!Array.isArray(m.to)))continue;const key=JSON.stringify([binding!.sessionId,binding!.credentialId,selected,row.query]);folderLists.set(key,{...row,key});}
      for(const row of value.bodies){if(row?.body?.message?.id&&typeof row.body.bodyText==='string')messageBodies.set(bodyKey(row.body.message.id),row);}
      if(!restoreList())return false;phase='ready';publish();void provider.bind(selected);void drafts.bind(selected,chosen.label);return true;
    }catch{return false;}
  }
  async function openMailbox(){const restored=await restoreMailbox();if(!api?.isActive())return;if(!restored)phase='ready';if(!restored||Date.now()-listReadAt>=60000)await refreshAccounts(restored);}

  function rememberList(){if(operation||failure||!loadedQuery||loadedQuery==='in:drafts'||messages.length>100)return;const key=listKey();folderLists.delete(key);folderLists.set(key,{key,at:listReadAt,firstPageRevision,messages:[...messages],query:loadedQuery,cursor:nextPageToken,revision,cursors:[...seenCursors],newerMail,status});while(folderLists.size>8)folderLists.delete(folderLists.keys().next().value!);persistMailbox();}
  const listKey=(accountId=selected)=>{const binding=connectionController.getCloudClient();return JSON.stringify([binding?.sessionId,binding?.credentialId,accountId,currentQuery()]);};
  function invalidateList(persist=true,keepReadAhead=false){++mailCacheEpoch;if(persist&&offline)void offline.put('gmail:mailbox',null).catch(()=>{});stopBodyReads();if(!keepReadAhead)readAhead.invalidate();folderLists.clear();messageBodies.clear();cachedListShown=false;}
  function prepareNextPage(){
    const binding=connectionController.getCloudClient(),cursor=nextPageToken,key=listKey(),accountId=selected,query=currentQuery();
    if(!binding||!cursor||!api?.isActive()||document.hidden||draftsView()||loadedQuery!==query)return;
    readAhead.prepare(key,cursor,async signal=>{
      const page=await binding.client.gmailSearch(accountId,query,signal,25,cursor);
      if(!api?.isActive()||key!==listKey()||binding.client!==connectionController.getCloudClient()?.client)throw new DOMException('Mailbox changed','AbortError');
      return page;
    });
  }
  function restoreList(){
    const cachedList=folderLists.get(listKey());
    if(!cachedList||Date.now()-cachedList.at>=30*86400000||!readable().some(a=>a.connectionId===selected)){folderLists.delete(listKey());return false;}
    listReadAt=cachedList.at;firstPageRevision=cachedList.firstPageRevision??null;messages=cachedList.messages;loadedQuery=cachedList.query;nextPageToken=cachedList.cursor;revision=cachedList.revision;seenCursors=new Set(cachedList.cursors);newerMail=cachedList.newerMail;status=cachedList.status;phase='ready';cachedListShown=true;
    // Warm restoration can run during render; notify Home only after that render.
    const restoredGeneration=generation,restoredKey=readKey();
    queueMicrotask(()=>{
      if(generation!==restoredGeneration||readKey()!==restoredKey||loadedQuery!==cachedList.query||messages!==cachedList.messages)return;
      recountUnread(cachedList.cursor!==null,false,cachedList.at);
      if(api?.isActive()){prepareNextPage();prepareBodies();}
    });return true;
  }

  const publish = (patch: Bag = {}) => shell?.vset('inbox', { nativeMailTick: Date.now(), ...patch });
  const provider = inboxProviderControls(() => publish(), text => api?.toast(text));
  const drafts = inboxDrafts(() => publish(), text => api?.toast(text), provider);
  provider.setEditor((proposal,reference)=>drafts.editProvider(proposal,reference));
  provider.setComposer(()=>drafts.email());
  const readable = () => accounts.filter(gmailReadable);
  const currentQuery = () => String(api?.get('inbox')?.q || '').trim() || folderQuery[folder];
  /** Read-cache identity of the selected account now; null while nothing it read may be shown. */
  const readKey = (id = selected) => gmailReadCacheKey(connectionController.getCloudClient()?.sessionId, accounts.find(a => a.connectionId === id));
  const accountLabel = (id = selected) => accounts.find(a => a.connectionId === id)?.label || null;
  const grants = () => accounts.find(a => a.connectionId === selected)?.grantedCapabilities ?? [];
  // `fresh` marks a completed first-page provider read. Later pages and local recounts keep that
  // time, so the time shown is never newer than the oldest data counted; no time is invented.
  const recountUnread = (more=inboxPreview?.more??nextPageToken!==null,fresh=false,restoredReadAt?:number) => {
    const key=readKey();
    if(loadedQuery==='in:inbox')homePreview=null;
    if (loadedQuery === 'in:inbox') inboxPreview=key?{key,sessionId:connectionController.getCloudClient()?.sessionId||'',accountId:selected,messages:messages.map(({id,subject,from,unread})=>({id,subject,from,unread})),more,readAt:fresh?Date.now():restoredReadAt??(inboxPreview?.key===key?inboxPreview.readAt:null)}:null;
    if(loadedQuery==='in:inbox')setAttention({state:'ready',unread:messages.filter(m=>m.unread).length,unreadMore:more,source:accountLabel(),updatedAt:restoredReadAt!==undefined?new Date(restoredReadAt).toISOString():(revision||new Date().toISOString())});
    hasUnread=!!inboxPreview?.messages.some(m=>m.unread);
  };
  drafts.setFromSwitch({ count: () => readable().length, cycle: () => void switchFrom() });
  provider.setObservers({
    // A provider-confirmed send removes the local copies of exactly the draft it was sent from.
    sent: (source, proposal, grant) => void drafts.settleSent(source.draftId, proposal, grant, (source as { savedRevision?: string }).savedRevision), sentNote: source => drafts.sentNote(source.draftId),
    // A stale review was discarded without dispatch; reload the open message so the user sees its current state.
    stale: () => { if (body) void open(body.message); else void load(); },
    receipt: receipt => {
      const id = typeof receipt.providerResult?.messageId === 'string' ? receipt.providerResult.messageId : '';
      if (!id || !['archive', 'trash'].includes(receipt.kind) || !messages.some(m => m.id === id)) return;
      folderLists.clear();readAhead.invalidate();messageBodies.delete(bodyKey(id));
      messages = messages.filter(m => m.id !== id);
      if(inboxPreview?.accountId===selected)inboxPreview.messages=inboxPreview.messages.filter(m=>m.id!==id);
      recountUnread();
      if (body?.message.id === id) { body = null; thread = null; publish({ open: null, nativeMailSelection: null }); } else publish();
    },
  });
  provider.onRestored(() => { if (selected && !draftsView()) void load(); });
  function clear(preserveOffline=false) {
    composeAttempt++; noticeAttempt++;
    invalidateList(!preserveOffline);spamTrashSearch=false;
    providerDrafts = [];
    setAttention({ state: connectionController.getCloudClient() ? 'loading' : 'not-connected', unread: undefined, unreadMore: false, source: null, updatedAt: null });
    void attachmentNative.cancel().catch(()=>{});contextReview=null;attachmentView=null;provider.reset(); drafts.reset();
    generation++; operation?.abort(); operation = null;
    thread=null; accounts = []; accountsChecked = false;accountsSession=''; messages = []; selected = ''; loadedQuery = ''; nextPageToken = null; body = null; phase = 'idle'; revision = '';
    hasUnread = false; inboxPreview=null;homePreview=null;homeRestoreAttempt='';homeFailure=null; failure = null; pendingCompose = null; resumeDraftFor = '';
    readStateInFlight.clear(); readStateUnconfirmed.clear(); seenCursors = new Set();
    status = 'Sign in to use Inbox.';
    publish({ mails: [], sent: [], open: null, compose: null, nativeMailSelection: null });
  }
  /** One provider read at a time. `retry` is offered after a classified failure; `keep` leaves the
   * loaded list in place when only a message, attachment or later page failed. */
  async function work(label: string, task: (binding: NonNullable<ReturnType<typeof connectionController.getCloudClient>>, signal: AbortSignal, valid: () => boolean) => Promise<void>, retry?: () => void, keep = false, kept = '') {
    if (operation) return;
    const binding = connectionController.getCloudClient();
    if (!binding) { connectionController.openCloudAccount(); return; }
    const token = ++generation, controller = new AbortController();
    operation = controller; phase = 'busy'; status = label; failure = null; homeFailure=null;publish();
    const valid = () => token === generation && !controller.signal.aborted && binding.sessionId === connectionController.getCloudClient()?.sessionId;
    try { await task(binding, controller.signal, valid); }
    catch (error) {
      if (valid() && connectionController.rejectCloudSession(binding.sessionId, error)) {
        purgeOffline();status = 'Sign in again to use Gmail.'; publish(); return;
      }
      if (valid()) {
        readAhead.invalidate();
        const classified = classifyGmailFailure(error, 'read');
        // A refused attachment is a decision about one file: the message stays open, Home is not told
        // that Gmail failed, and no Retry is offered because the same bytes would be refused again.
        if (classified.kind === 'refused') { status = classified.message; api?.toast(status); publish(); return; }
        homeFailure=classified.kind;
        if(classified.kind==='revoked'){purgeOffline();invalidateList();inboxPreview=null;hasUnread=false;messages=[];nextPageToken=null;}
        if (!keep) { messages = []; nextPageToken = null; }
        const pendingReader=body?.loading&&api?.get('inbox')?.open===body.message.id&&classified.kind!=='revoked';
        if(pendingReader)body={...body!,loading:false,failed:true,bodyText:classified.message};else if(!keep||body?.loading)body=null;thread = null; phase = 'error'; status = classified.message + (keep && messages.length ? kept : '');
        failure = retry ? { kind: classified.kind, retry } : null;
        if (keep && messages.length) api?.toast(status);
        publish(pendingReader?{nativeMailSelection:null}:{ open: null, nativeMailSelection: null });
      }
    } finally { if (token === generation) { operation = null; if (phase === 'busy') phase = 'ready'; publish(); } }
  }
  async function refreshAccounts(preserveSelection=false) {
    readAhead.pause();stopBodyReads();
    let loadAfter = false;
    await work('Checking Gmail connection…', async (binding, signal, valid) => {
      const {client}=binding;
      const hint=readGmailAccountChoice(connectionController.getSnapshot().cloudAccount);
      const query=currentQuery(),captured=connectionController.getCloudClient();
      // Cost: account discovery + at most one first-page read in parallel, never polling.
      // A remembered ID is not permission: both reads are owner-authorized by Cloud.
      if(hint&&!draftsView()&&!preserveSelection)readAhead.prepare(listKey(hint),'',async pageSignal=>{
        const abort=()=>readAhead.invalidate();signal.addEventListener('abort',abort,{once:true});
        try{const page=await client.gmailSearch(hint,query,pageSignal,25);pageSignal.throwIfAborted();const current=connectionController.getCloudClient();if(current?.client!==captured?.client||current?.sessionId!==captured?.sessionId||current?.credentialId!==captured?.credentialId)throw new DOMException('Mailbox changed','AbortError');return page;}
        finally{signal.removeEventListener('abort',abort);}
      });
      const result = await client.gmailAccounts(signal);
      if (!valid()) return;
      const previous=selected,before={sessionId:accountsSession||null,account:accounts.find(a=>a.connectionId===previous)};accounts = result; accountsChecked = true; accountsSession = binding.sessionId;
      // P-37: a withdrawn change grant discards the unsent review prepared under it (nothing is
      // dispatched); a changed read-cache identity (session, connection or read grant) drops the mail read under it.
      const grantChange=gmailGrantChange(before,{sessionId:binding.sessionId,account:accounts.find(a=>a.connectionId===previous)});
      if(previous&&grantChange.withdrawn.length)provider.withdrawn();
      if (!accounts.some(a => a.connectionId === selected && a.connected && a.grantedCapabilities.includes('google.gmail.triage'))) selected = accounts.find(a => a.connected && a.grantedCapabilities.includes('google.gmail.triage'))?.connectionId || '';
      const dropped=previous!==selected||(!!previous&&grantChange.dropReadCache);
      if(dropped){invalidateList(true,!previous&&hint===selected);inboxPreview=null;hasUnread=false;if(selected)setAttention({state:'loading',unread:undefined,unreadMore:false,source:null,updatedAt:null});}
      if(hint&&hint!==selected)readAhead.invalidate();
      saveGmailAccountChoice(connectionController.getSnapshot().cloudAccount,selected||null);watchSelectedMail();
      const retained=preserveSelection&&!!selected&&!dropped;
      if(!retained){void attachmentNative.cancel().catch(()=>{});attachmentView=null;contextReview=null;thread=null;messages=[];body=null;}
      void provider.bind(selected); void drafts.bind(selected, accounts.find(a => a.connectionId === selected)?.label || '');
      if(!retained){status = selected ? 'Loading Gmail…' : '';nextPageToken=null;loadedQuery='';providerDrafts=[];if(!selected){hasUnread=false;setAttention({state:'not-connected',unread:undefined,unreadMore:false,source:null,updatedAt:null});}}
      loadAfter = !!selected && (!retained||Date.now()-listReadAt>=60000&&api?.get('inbox')?.open==null);
      publish(retained?{}:{ open: null, nativeMailSelection: null });
    }, () => void refreshAccounts(preserveSelection), preserveSelection);
    persistMailbox();
    // Opening Inbox or connecting an account shows its messages without another tap.
    if (loadAfter && api?.isActive()) await load();
  }
  function selectAccount(a: GmailAccount, force = false) {
    invalidateList();
    if (operation && !force) return;
    if (operation) { generation++; operation.abort(); operation = null; phase = 'ready'; }
    void attachmentNative.cancel().catch(()=>{});contextReview=null;attachmentView=null;inboxPreview=null;homeFailure=null;hasUnread=false;selected = gmailReadable(a) ? a.connectionId! : '';saveGmailAccountChoice(connectionController.getSnapshot().cloudAccount,selected||null);watchSelectedMail(); void provider.bind(selected); void drafts.bind(selected, a.label); messages = []; body = null; thread = null; nextPageToken = null; loadedQuery = ''; failure = null;
    status = selected ? 'Loading Gmail…' : 'This account needs Gmail authorization';
    publish({ open: null, nativeMailSelection: null });
    if (selected) void load();
  }
  /** Continues an open new email under the next connected account. Nothing is sent or saved remotely. */
  async function switchFrom() {
    const eligible = readable(); if (operation || eligible.length < 2) return;
    const index = eligible.findIndex(a => a.connectionId === selected), previous = eligible[index], next = eligible[(index + 1) % eligible.length];
    if (!previous || next.connectionId === previous.connectionId) return;
    const content = await drafts.transfer(); if (!content) return;
    const { savedRemains, restore, ...moved } = content;
    // The account changed while the draft was being moved: keep it with the account it came from.
    if (selected !== previous.connectionId) { restore(); resumeDraftFor = previous.connectionId!; selectAccount(previous, true); return; }
    // A read that started meanwhile must not keep the composer on the previous account.
    selectAccount(next, true);
    returnPending();
    pendingCompose = { ...moved, moved: true, account: next.connectionId!, returnTo: previous, restore,
      status: `From changed to ${next.label}. Review before sending; nothing has been sent.${savedRemains ? ` A saved local copy remains with ${previous.label}.` : ''}` };
    publish();
  }
  const draftsView = () => folder === 'drafts' && !String(api?.get('inbox')?.q || '').trim();
  /** Provider drafts list: metadata only until one is opened for editing. */
  async function loadDrafts(more = false) {
    const accountId = selected, pageToken = more && loadedQuery === 'in:drafts' ? nextPageToken : null;
    if (more && !pageToken) return;
    if (operation) return;
    if (!provider.capabilities()?.draftsList) { messages = []; providerDrafts = []; nextPageToken = null; loadedQuery = 'in:drafts'; phase = 'ready'; status = 'Drafts on this device'; publish({ open: null, nativeMailSelection: null }); return; }
    if (pageToken) nextPageToken = null;
    loadingMore = more;
    const loadGeneration = generation + 1;
    try { await work(more ? 'Loading more drafts…' : 'Loading Gmail drafts…', async ({ client }, signal, valid) => {
      const result = await client.gmailDrafts(accountId, signal, pageToken || undefined);
      if (!valid() || selected !== accountId || !draftsView()) return;
      const seen = new Set(pageToken ? providerDrafts.map(d => d.draftId) : []);
      providerDrafts = pageToken ? [...providerDrafts, ...result.drafts.filter(d => !seen.has(d.draftId))] : result.drafts;
      messages = []; body = null; loadedQuery = 'in:drafts';
      const next = result.nextPageToken; nextPageToken = next && !seenCursors.has(next) ? next : null; if (nextPageToken) seenCursors.add(nextPageToken);
      status = providerDrafts.length ? `${providerDrafts.length} Gmail drafts` : 'No Gmail drafts';
      publish({ open: null, nativeMailSelection: null });
    }, () => void loadDrafts(), more); } finally { if (generation === loadGeneration) { loadingMore = false; publish(); } }
  }
  /** Opens one provider draft in the composer as an editable Gmail draft. Replies and drafts with
   * attachments stay in Gmail: their thread headers or bytes cannot be reproduced exactly here. */
  async function openDraft(summary: GmailDraftSummary) {
    if (api?.swallowed?.()) return;
    const accountId = selected, holder: { content: GmailDraftContent | null } = { content: null };
    await work('Opening Gmail draft…', async ({ client }, signal, valid) => {
      const value = await client.gmailDraftContent(accountId, summary.draftId, signal);
      if (!valid() || accountId !== selected) return;
      holder.content = value; status = providerDrafts.length ? `${providerDrafts.length} Gmail drafts` : status;
    }, () => void openDraft(summary), true);
    const draft = holder.content;
    if (!draft || accountId !== selected) return;
    if (draft.threaded || draft.attachmentCount > 0 || !draft.plainText) { api?.toast('This Gmail draft is a reply, has attachments or formatting. Open it in Gmail to edit it; nothing was changed.'); return; }
    const opened = await drafts.editProvider({ mode: 'compose', to: draft.to, cc: draft.cc, bcc: draft.bcc, subject: draft.subject, bodyText: draft.bodyText, attachments: [] }, { draftId: draft.draftId, providerDigest: draft.providerDigest });
    if (!opened && !drafts.render().composing) api?.toast('Save or discard the open email first. The Gmail draft was not opened.');
  }
  let loadingMore = false;
  async function load(more = false) {
    if (!selected) { await refreshAccounts(); return; }
    if (draftsView()) { await loadDrafts(more); return; }
    const accountId = selected, query = currentQuery();
    const pageToken = more && query === loadedQuery ? nextPageToken : null;
    if (more && !pageToken) return;
    if (operation) return;
    if(!more){folderLists.delete(listKey());cachedListShown=false;}
    // A cursor is used once. If its page fails (for example an expired cursor), Load more is not
    // offered again with it; Retry reloads the list from the first page instead.
    if (pageToken) nextPageToken = null;
    loadingMore = more;
    const loadGeneration = generation + 1;
    try { await work(more ? 'Loading more messages…' : 'Loading Gmail…', async ({ client }, signal, valid) => {
      const prepared=await readAhead.take(listKey(),pageToken||'',signal);
      if(!prepared)readAhead.invalidate(listKey());
      const result = prepared??await client.gmailSearch(accountId, query, signal, 25, pageToken || undefined);
      if (!valid() || selected !== accountId || currentQuery() !== query) return;
      const seen = new Set(pageToken ? messages.map(m => m.id) : []);
      // A later page that repeats a loaded message was cut from a mailbox that changed after the
      // earlier pages were read (new mail moved every row down). The repeat is dropped as before,
      // and the list says that it is no longer the whole mailbox.
      // The mailbox revision says the same for a removed message, which no repeat can show: a later
      // page whose revision differs from the first page's was listed from a changed mailbox. A server
      // that sends no revision (older Cloud) leaves only the repeat check.
      const revisionChanged = !!pageToken && !!firstPageRevision && !!result.mailboxHistoryId && result.mailboxHistoryId !== firstPageRevision;
      const shifted = !!pageToken && (revisionChanged || result.messages.some(m => seen.has(m.id)));
      // A message the provider lists twice, in one page or across pages, is shown once.
      const fresh = result.messages.filter(m => !seen.has(m.id) && !!seen.add(m.id));
      messages = pageToken ? [...messages, ...fresh] : fresh;
      if (!pageToken) { seenCursors = new Set(); firstPageRevision = result.mailboxHistoryId ?? null; }
      // A provider cursor that repeats would page forever; treat it as the end of the results.
      const next = result.nextPageToken ?? null;
      nextPageToken = next && !seenCursors.has(next) ? next : null;
      if (nextPageToken) seenCursors.add(nextPageToken);
      spamTrashSearch=result.supportsSpamTrash===true;
      loadedQuery = query; revision = result.syncedAt;listReadAt=Date.now();cachedListShown=false;
      recountUnread(result.nextPageToken!=null,!pageToken);
      if (!pageToken) body = null;
      providerDrafts = [];
      status = messages.length ? `${messages.length} messages loaded` : query === 'in:inbox' ? 'Your Inbox is empty' : query === 'in:sent' ? 'No sent messages' : query === folderQuery.archive ? 'No archived messages' : query === 'in:trash' ? 'Trash is empty' : 'No messages match this search';
      newerMail = pageToken ? newerMail || shifted : false;
      if (shifted) api?.toast(MAILBOX_CHANGED);
      publish(pageToken ? {} : { open: null, nativeMailSelection: null });
    }, () => void load(), more||messages.length>0, more ? ' The messages already shown were kept. Retry reloads the list from the start.' : ''); } finally { if (generation === loadGeneration) { loadingMore = false; publish();if(!failure&&phase==='ready'){rememberList();prepareNextPage();prepareBodies();} } }
  }
  function setFolder(next: Folder) {
    if (folder === next && !api?.get('inbox')?.q && (messages.length || providerDrafts.length)) return;
    rememberList();readAhead.pause();stopBodyReads();
    generation++; operation?.abort(); operation = null;
    folder = next; thread = null; messages = []; providerDrafts = []; body = null; loadedQuery = ''; nextPageToken = null; failure = null; phase = 'ready';
    publish({ q: null, open: null, nativeMailSelection: null });
    if(restoreList()){publish();if(Date.now()-listReadAt>=60000)void load();}else void load();
  }
  /** Marks a loaded message read or unread through the reviewed provider operation, once. */
  async function setRead(message: GmailMessage, historyId: string, unread: boolean, explicit: boolean) {
    const binding = connectionController.getCloudClient(), accountId = selected;
    if (!binding || !accountId || !provider.capabilities()?.readState) { if (explicit) api?.toast('This account cannot change read state here. Nothing was changed.'); return; }
    const current = () => accountId === selected && binding.sessionId === connectionController.getCloudClient()?.sessionId;
    const key = JSON.stringify([accountId, message.id]);
    if (readStateInFlight.has(key)) { if (explicit) api?.toast('A read-state change for this message is still in progress.'); return; }
    if (!explicit && readStateUnconfirmed.has(key)) return;
    readStateInFlight.add(key);
    try {
      const result = await setGmailReadState(binding.client, accountId, { messageId: message.id, expectedHistoryId: historyId, unread }, new AbortController().signal);
      if (!result) readStateUnconfirmed.add(key); else readStateUnconfirmed.delete(key);
      if (!current()) return;
      if (!result) { if (explicit) api?.toast('Read state was not confirmed. Refresh to check it before trying again.'); return; }
      folderLists.clear();readAhead.invalidate();messageBodies.delete(bodyKey(message.id));
      const update = (m: GmailMessage) => m.id === message.id ? { ...m, unread } : m;
      if(inboxPreview?.sessionId===binding.sessionId&&inboxPreview.accountId===accountId)inboxPreview.messages=inboxPreview.messages.map(m=>m.id===message.id?{...m,unread}:m);
      messages = messages.map(update); recountUnread();
      if (thread) thread = { ...thread, messages: thread.messages.map(row => row.message.id === message.id ? { ...row, message: update(row.message), historyId: result.historyId ?? row.historyId } : row) };
      if (body?.message.id === message.id) body = { ...body, message: update(body.message), historyId: result.historyId ?? body.historyId };
      publish();
    } catch (error) {
      // Any failure may have reached Gmail; an automatic mark-read is not sent again for this message.
      readStateUnconfirmed.add(key);
      if (explicit && current()) api?.toast(classifyGmailFailure(error, 'operation').message);
    } finally { readStateInFlight.delete(key); }
  }
  /** Swipe left routes to the same reviewed archive flow as the message view. */
  async function swipeArchive(message: GmailMessage) {
    const caps = provider.capabilities();
    if (!caps || !gmailInboxAllows(caps, 'archive')) { api?.toast('Reconnect Gmail to archive.'); return; }
    if (!caps.threads) { api?.toast('Open the message to archive it.'); return; }
    const accountId = selected; let historyId: string | null = null;
    await work('Preparing archive review…', async ({ client }, signal, valid) => {
      const page = await client.gmailThread(accountId, message.threadId, signal);
      if (!valid() || accountId !== selected) return;
      historyId = page.messages.find(row => row.message.id === message.id)?.historyId ?? null;
      status = messages.length ? `${messages.length} messages loaded` : status;
    }, () => void swipeArchive(message), true);
    if (accountId !== selected) return;
    if (!historyId) { api?.toast('Open the message to archive it.'); return; }
    void provider.prepare({ kind: 'archive', messageId: message.id, expectedHistoryId: historyId });
  }
  async function open(message: GmailMessage) {
    if(api?.swallowed?.())return;
    generation++;operation?.abort();operation=null;
    const accountId=selected,key=bodyKey(message.id),cached=messageBodies.get(key);
    thread=null;contextReview=null;attachmentView=null;remoteImagesShown=false;
    body=cached&&Date.now()-cached.at<30*86400000?cached.body:{message,bodyText:'',loading:true};
    publish({open:message.id,openLocal:true,nativeMailSelection:null});
    if(!body.loading&&cached&&Date.now()-cached.at<LIST_TTL){if(message.unread&&body.historyId&&provider.capabilities()?.readState)void setRead(body.message,body.historyId,false,false);return;}
    await work('Loading message…',async({client},signal,valid)=>{
      const pending=pendingBodies.get(key);let result:MailBody;
      if(pending){const abort=()=>pending.controller.abort();signal.addEventListener('abort',abort,{once:true});try{const prepared=await pending.result;signal.throwIfAborted();if(!prepared.ok)throw prepared.error;result=prepared.body;}finally{signal.removeEventListener('abort',abort);}}else result=await client.gmailRead(accountId,message.id,signal);
      if(!valid()||accountId!==selected||api?.get('inbox')?.open!==message.id)return;
      body=result;rememberBody(result);
      publish({nativeMailSelection:{kind:'email',id:message.id,accountId,revision}});
    },()=>void open(message),true);
    const opened=body as typeof body;
    if(opened?.message.id===message.id&&message.unread&&opened.historyId&&provider.capabilities()?.readState)void setRead(opened.message,opened.historyId,false,false);
  }
  async function loadThread(){
    if(!body||body.loading||!provider.capabilities()?.threads)return;
    const message=body.message,accountId=selected;
    await work('Loading conversation…',async({client},signal,valid)=>{
      const page=await client.gmailThread(accountId,message.threadId,signal);
      if(!valid()||accountId!==selected||body?.message.id!==message.id)return;
      thread={id:message.threadId,previousOffsets:[],...page};
      for(const item of page.messages)rememberBody(item);
      const exact=page.messages.find(row=>row.message.id===message.id);if(exact)body=exact;
      publish();
    },()=>void loadThread(),true);
  }
  function mailContext():MailContextSource {if(!body||!selected||!body.historyId)throw new Error('Refresh this message before sharing');return {accountId:selected,messageId:body.message.id,revision:body.historyId,from:body.message.from,to:body.message.to,subject:body.message.subject,bodyText:body.bodyText};}
  async function askAgent(){try{const destination=connectionController.getSnapshot().session;if(!destination)throw new Error(agentPendingText());const source=mailContext(),token=generation;const review=await reviewMailContext(source,destination);if(token!==generation||JSON.stringify(source)!==JSON.stringify(mailContext()))throw new Error('Message changed');contextReview=review;publish();}catch(error){api?.toast((error as Error).message);}}
  async function sendContext(){if(!contextReview||contextBusy)return;contextBusy=true;publish();try{const review=contextReview,destination=connectionController.getSnapshot().session;if(!destination)throw new Error('Agent disconnected');const text=await validateMailContext(review,mailContext(),destination);if(contextReview!==review)throw new Error('Review closed');contextReview=null;publish();if(!api)throw new Error("Inbox closed");await api.sendReviewedMail(text,destination);}catch(error){api?.toast((error as Error).message);}finally{contextBusy=false;publish();}}
  async function openAttachment(source:NonNullable<typeof body>,attachment:NonNullable<NonNullable<typeof body>['attachments']>[number]){
    if(!source.historyId){api?.toast('Refresh this message before opening its attachments.');return;}
    if(!attachment.supported){await saveOpaque(source,attachment);return;}const accountId=selected;
    await work('Loading selected attachment…',async({client},signal,valid)=>{const file=await client.gmailAttachment(accountId,source.message.id,attachment.partId,source.historyId!,signal).catch(error=>{throw attachmentReadFailure(error);});if(!valid()||accountId!==selected||body!==source)return;const reviewGeneration=generation;const review={name:file.name,text:file.text??`${file.mimeType} · ${file.size} bytes. Open a temporary read-only copy in an installed viewer. The viewer receives this file.`,hash:file.sha256,external:file.text===undefined,open:()=>{if(accountId!==selected||body!==source)return;void attachmentNative.openReviewed({...file,reviewed:true}).then(result=>api?.toast(result.message)).catch(error=>api?.toast(error.message));},saveDisabled:false,saveStatus:'',save:()=>{
      if(review.saveDisabled||attachmentView!==review||accountId!==selected||body!==source||generation!==reviewGeneration)return;
      review.saveDisabled=true;review.saveStatus='Saving reviewed attachment…';publish();
      void attachmentNative.saveReviewed({...file,reviewed:true}).then(result=>{if(attachmentView!==review||generation!==reviewGeneration)return;review.saveStatus=result.message;review.saveDisabled=result.status!=='cancelled';publish();}).catch(()=>{if(attachmentView!==review||generation!==reviewGeneration)return;review.saveStatus='Save not confirmed. Inspect Files before trying again.';publish();});
    }};attachmentView=review;publish();},()=>void openAttachment(source,attachment),true);
  }
  /** Unsupported types (for example .docx or .zip) can only be saved as an exact byte copy: no preview,
   * no viewer handoff and no agent access. Requires the server's opaque download. */
  async function saveOpaque(source:NonNullable<typeof body>,attachment:NonNullable<NonNullable<typeof body>['attachments']>[number]){
    if(!provider.capabilities()?.opaqueAttachments||attachment.size>5*1024*1024){api?.toast('This attachment type cannot be previewed here, and this account cannot save it to Files. Open it in Gmail.');return;}
    const accountId=selected;
    await work('Loading attachment bytes…',async({client},signal,valid)=>{const file=await client.gmailOpaqueAttachment(accountId,source.message.id,attachment.partId,source.historyId!,signal).catch(error=>{throw attachmentReadFailure(error);});const checked=await reviewOpaqueAttachment(file);if(checked.sha256!==file.sha256||checked.size!==file.size)throw new Error('Attachment changed');if(!valid()||accountId!==selected||body!==source)return;const reviewGeneration=generation;
      const review={name:file.name,text:`${file.mimeType} · ${file.size} bytes. This type is not previewed or opened by Alpha. Save to Files stores an exact copy of the bytes; nothing is shared with the agent.`,hash:file.sha256,external:false,open:()=>{},saveDisabled:false,saveStatus:'',save:()=>{
        if(review.saveDisabled||attachmentView!==review||accountId!==selected||body!==source||generation!==reviewGeneration)return;
        review.saveDisabled=true;review.saveStatus='Saving exact copy…';publish();
        void attachmentNative.saveReviewed({...file,reviewed:true,opaque:true}).then(result=>{if(attachmentView!==review||generation!==reviewGeneration)return;review.saveStatus=result.message;review.saveDisabled=result.status!=='cancelled';publish();}).catch(()=>{if(attachmentView!==review||generation!==reviewGeneration)return;review.saveStatus='Save not confirmed. Inspect Files before trying again.';publish();});
      }};attachmentView=review;publish();},()=>void saveOpaque(source,attachment),true);
  }
  async function nextThreadPage(previous=false){
    const prior=thread,accountId=selected;if(!prior||(!previous&&prior.nextOffset===null))return;
    await work('Loading next thread page…',async({client},signal,valid)=>{
      const page=await client.gmailThread(accountId,prior.id,signal,{offset:previous?(prior.previousOffsets.at(-1)??0):prior.nextOffset!,historyId:prior.historyId});
      if(!valid()||accountId!==selected||thread!==prior)return;
      thread={id:prior.id,previousOffsets:previous?prior.previousOffsets.slice(0,-1):[...prior.previousOffsets,prior.offset],...page};body=page.messages[0]||null;publish({open:body?.message.id||null,nativeMailSelection:null});
    },()=>void nextThreadPage(previous),true);
  }
  function changeQuery(query: string | null) {
    rememberList();readAhead.pause();stopBodyReads();cachedListShown=false;
    generation++; operation?.abort(); operation = null;
    thread=null; messages = []; body = null; loadedQuery = ''; nextPageToken = null; failure = null;
    phase = 'ready'; status = query === null ? (selected ? 'Loading Gmail…' : '') : 'Search your email';
    publish({ q: query, open: null, nativeMailSelection: null });
    if (query === null && selected) queueMicrotask(() => { if (api?.isActive() && api.get('inbox')?.q == null){if(restoreList()){publish();if(Date.now()-listReadAt>=60000)void load();}else void load();} });
  }
  const unsupported = () => api?.toast('Gmail is read-only here. No message has been changed or sent.');
  /** Links open only in Alpha's Browser, only for HTTPS, and only after the user reviews the destination. */
  function openLink(link: GmailLink) {
    let url: URL; try { url = new URL(link.href); } catch { api?.toast('This link is not valid. Nothing was opened.'); return; }
    if (url.protocol !== 'https:' || url.username || url.password) { api?.toast('Only HTTPS links open in Browser. Nothing was opened.'); return; }
    const warning = linkTextMismatch(link) ? `\n\nWarning: the email shows “${link.text}”, but the link goes to ${url.hostname}.` : '';
    if (!window.confirm(`Open this link in Browser?\n\nSite: ${url.hostname}\n${url.href}${warning}\n\nThe email's sender chose this link. Opening it loads that site.`)) return;
    const navigate = (shell as Bag | undefined)?.browserNavigateApproved;
    if (typeof navigate !== 'function') { api?.toast('Browser is unavailable. Nothing was opened.'); return; }
    void Promise.resolve(navigate.call(shell, url.href, new AbortController().signal)).catch(() => api?.toast('Browser could not open this link.'));
  }
  view.back = (st: Bag, current: Bag) => {
    if(contextReview){contextReview=null;publish();return true;}
    if(attachmentView){void attachmentNative.cancel().catch(()=>{});attachmentView=null;publish();return true;}
    if (provider.close()) return true;
    if (drafts.close()) return true;
    if (st.open != null) { generation++;operation?.abort();operation=null;body = null; current.set({ open: null, nativeMailSelection: null }); return true; }
    if (st.q != null) { changeQuery(null); return true; }
    return false;
  };
  view.badge = () => hasUnread;
  // Home uses only already-authorized cached metadata; opening Home never reads mail.
  const homeRender = p.renderVals;
  p.renderVals = function () {
    const out = homeRender.call(this), binding=connectionController.getCloudClient(),key=readKey();
    const restored=binding&&homePreview&&homePreview.sessionId===binding.sessionId&&homePreview.owner===JSON.stringify(offlineOwner())&&(!selected||selected===homePreview.accountId&&key===homePreview.key)?homePreview:null,connected=readable().length>0||!!restored;
    // An unresolved startup has not established that email is disconnected.
    const disconnected=connectionController.getSnapshot().startupResolved===true&&(!binding||accountsChecked&&!connected);
    const cached=key&&inboxPreview?.key===key&&inboxPreview.sessionId===binding?.sessionId&&inboxPreview.accountId===selected?inboxPreview:restored;
    const unread=cached?.messages.filter(m=>m.unread)||[],pending=phase==='busy'||phase==='scheduled';
    const count=unread.length?`${unread.length}${cached?.more?'+':''} unread`:'';
    // Account and read time of the page the user loaded in Inbox; Home never reads mail to refresh it.
    const homeInboxStatus=presentHomeInboxStatus({failure:!!homeFailure,pending,cached:cached?{more:cached.more,label:accounts.find(a=>a.connectionId===selected)?.label||restored?.label||'',readAt:cached.readAt}:null,connected,unchecked:!!binding&&!accountsChecked,now:Date.now()});
    // The loaded page was dropped (an account change or disconnect elsewhere) after a real read:
    // the card says when it last updated, with the last count only in the accessible name.
    const stale=binding&&!cached&&!homeFailure&&!pending&&attention.state==='stale'&&attention.updatedAt?presentHomeAttention({state:'stale',unread:attention.unread,...(attention.source?{source:attention.source}:{}),updatedAt:attention.updatedAt},Date.now()):null;
    if(stale)return {...out,homeGoogleConnected:!binding?undefined:disconnected?false:connected?true:undefined,homeAttentionLabel:stale.label,homeInboxCount:'',homeInboxRows:[],homeInboxHasRows:false,homeInboxTitle:'Inbox',homeInboxStatus:stale.text,homeInboxDescription:stale.text};
    return {...out,homeGoogleConnected:!binding?undefined:disconnected?false:connected?true:undefined,homeAttentionLabel:count?`Open Inbox: ${count} email${unread.length===1?'':'s'}`:disconnected?'Connect email':'Open Inbox',
      homeInboxCount:count,homeInboxRows:unread.slice(0,2).map(m=>({subject:m.subject||'(no subject)',from:m.from})),homeInboxHasRows:unread.length>0,
      homeInboxTitle:unread.length?'':homeFailure==='revoked'?'Reconnect email':homeFailure?'Email unavailable':pending?'Loading email…':cached&&!cached.more?'No unread email':disconnected?'Connect email':'Inbox',
      homeInboxStatus,homeInboxDescription:homeInboxStatus};
  };
  // Mail content is never sent to the agent automatically, so chips ask only for help the agent can give.
  // Sharing one message goes through the explicit "Review email with agent" review.
  view.suggestions = (st: Bag) => drafts.render().composing ? ['Help me write this email'] : st.open != null ? ['Help me write a reply'] : ['Help me write an email'];
  const openReply = () => { const st = api?.get('inbox'), current = body; return current && st?.open != null && current.message.id === st.open ? current : undefined; };
  /** The exact destination a suggestion would use now: the selected account, and the open draft, the
   * open message (a reply) or a new email. The assistant review shows it and passes its token back. */
  view.emailTarget = (): EmailTarget => {
    const binding = connectionController.getCloudClient();
    if (!binding || !selected) return { ready: false, reason: 'Connect a Gmail account in Inbox first. Nothing was added.', token: '' };
    // A mail operation, attachment or sharing review already on screen is finished or closed first.
    if (contextReview || attachmentView || provider.render().providerReview) return { ready: false, reason: 'Finish or close the review that is open in Inbox first. Nothing was added.', token: '', accountId: selected, account: accountLabel() || undefined };
    const current = openReply(), target = drafts.suggestionTarget(current?.message);
    return { ...target, accountId: selected, account: accountLabel() || 'Selected Gmail account',
      token: JSON.stringify([binding.sessionId, selected, accountLabel(), target.token, current ? [current.message.id, current.historyId ?? null] : null]) };
  };
  /** "Use in email" for an agent reply while Inbox is open: a local draft bound to the selected account,
   * replying to the open message when there is one. It opens the normal composer; nothing is sent. */
  view.useInEmail = (text: string, expected?: { token: string; append?: boolean }): boolean => {
    if (!selected) { api?.toast('Connect a Gmail account first. Nothing was added.'); return false; }
    const reply = openReply()?.message;
    if (!expected) return drafts.useSuggestion(text, reply);
    // The reviewed destination must be unchanged: same Cloud session, account, draft content and message.
    const now = view.emailTarget() as EmailTarget;
    if (!now.ready || now.token !== expected.token) return false;
    return drafts.useSuggestion(text, reply, { token: drafts.suggestionTarget(reply).token, append: expected.append === true && now.append });
  };
  /** Files uses an account-bound destination without implicitly replying to a hidden message. */
  view.fileEmailTarget = (): EmailTarget => {
    const binding=connectionController.getCloudClient(),available=view.emailTarget() as EmailTarget;
    if(!binding||!available.ready)return available;
    const target=drafts.suggestionTarget();
    return {...target,accountId:selected,account:accountLabel()||'Selected Gmail account',token:JSON.stringify([binding.sessionId,selected,target.token])};
  };
  view.attachReviewedFile = (file: import('../runtime/inbox-attachment').MailAttachment,token:string):boolean => {
    const target=view.fileEmailTarget() as EmailTarget;
    if(!target.ready||target.token!==token)return false;
    return drafts.attachReviewed(file,drafts.suggestionTarget().token);
  };
  view.voicePhrase = 'Help me write an email';
  /** Content shared from Notes, Photos or Files becomes a new local draft for review; nothing is sent. */
  function shared(value: Bag): ComposePrefill {
    const list = (v: unknown) => Array.isArray(v) ? v.filter((a): a is string => typeof a === 'string') : typeof v === 'string' ? [v] : [];
    const attached = Array.isArray(value.attach) && value.attach.length > 0;
    return { to: list(value.to), subject: typeof value.subject === 'string' ? value.subject : '', body: typeof value.body === 'string' ? value.body : '',
      status: attached ? 'Shared draft. The shared items are not attached automatically; use Attach to choose a file. Review before sending; nothing has been sent.' : 'Shared draft. Review before sending; nothing has been sent.' };
  }
  view.onLeave = () => {
    rememberList();readAhead.pause();stopBodyReads();cachedListShown=false;
    // Home retains only metadata already loaded by the user.
    if (attention.state === 'ready' || attention.state === 'loading') setAttention({ state: 'stale' });
    returnPending(); resumeDraftFor = ''; if (connectionController.getCloudClient()) { phase = 'idle'; loadedQuery = ''; nextPageToken = null; failure = null; } void attachmentNative.cancel().catch(()=>{}); contextReview=null;attachmentView=null;generation++; operation?.abort(); operation = null; drafts.close(); messages = []; body = null; publish({ open: null, nativeMailSelection: null }); };
  view.render = (st: Bag, current: Bag) => {
    api = current;
    const binding = connectionController.getCloudClient();
    if (phase === 'idle' && binding && current.isActive()) {
      if(restoreList()){if(Date.now()-listReadAt>=60000)queueMicrotask(()=>{if(api?.isActive()&&!operation)void refreshAccounts(true);});}
      else{phase = 'scheduled'; queueMicrotask(() => { if (api?.isActive()) void openMailbox(); });}
    }
    const folderIcons:Record<string,string>={Inbox:'inbox',Sent:'send',Archive:'archive',Spam:'shield-alert',Drafts:'file-text',Trash:'trash-2',Starred:'star',"All mail":'mail'};
    const chip = (label: string, action: () => void, on = false) => ({ label, on,icon:folderIcons[label]?'/icons/lucide/'+folderIcons[label]+'.svg':null,
      css: on ? 'background:var(--fg);color:var(--bg)' : 'background:var(--s2);color:var(--fg)', pick: action });
    if (st.compose && typeof st.compose === 'object' && st.compose !== lastCompose) {
      const incoming = lastCompose = st.compose;
      returnPending(); pendingCompose = shared(incoming);
      queueMicrotask(() => { if (api?.get('inbox')?.compose === incoming) publish({ compose: null }); });
    }
    if (pendingCompose && selected && drafts.ready && (!pendingCompose.account || pendingCompose.account === selected)) {
      const prefill = pendingCompose; pendingCompose = null;
      const attempt = composeAttempt, account = selected, source = binding;
      const current = () => {
        const active = connectionController.getCloudClient();
        return attempt === composeAttempt && !!api?.isActive() && selected === account &&
          source?.client === active?.client && source?.sessionId === active?.sessionId && source?.credentialId === active?.credentialId;
      };
      queueMicrotask(() => {
        if (!current()) { prefill.restore?.(); return; }
        if (!prefill.returnTo) { void drafts.newSharedEmail(prefill, current); return; }
        if (drafts.begin(undefined, undefined, '', prefill)) return;
        // The other account already holds a draft or retained edits; the moved email goes back.
        const target = accounts.find(a => a.connectionId === prefill.account)?.label || 'The other account';
        prefill.restore?.();
        const back = accounts.find(a => a.connectionId === prefill.returnTo!.connectionId && gmailReadable(a));
        if (back) { resumeDraftFor = back.connectionId!; selectAccount(back, true); }
        api?.toast(`${target} already has a local draft, so this email stays with ${prefill.returnTo!.label}. Nothing has been sent.`);
      });
    }
    if (resumeDraftFor && resumeDraftFor === selected && drafts.ready) { resumeDraftFor = ''; queueMicrotask(() => { if (drafts.hasDraft) drafts.begin(); }); }
    const sentView = loadedQuery === 'in:sent';
    const chips: Bag[] = binding ? [
      ...(failure ? [chip('Retry', failure.retry)] : []),
      ...(failure?.kind === 'revoked' ? [chip('Reconnect Gmail', () => void googleConnect.start())] : []),
      ...(selected && st.q == null ? [chip('Inbox', () => setFolder('inbox'), folder === 'inbox'), chip('Sent', () => setFolder('sent'), folder === 'sent'),
        chip('Archive', () => setFolder('archive'), folder === 'archive')] : []),
      // Stays after the notice has passed, until the list is loaded again from its first page.
      ...(selected && newerMail && messages.length && loadedQuery === currentQuery() ? [chip('Load newer mail', () => void load())] : []),
      ...((readable().length > 1) ? readable().map(a => chip(a.label, () => selectAccount(a), a.connectionId === selected)) : []),
    ] : [];
    const extraFolders = binding&&selected&&st.q==null?[
      {...chip('Starred',()=>setFolder('starred'),folder==='starred'),value:'starred'},
      {...chip('All mail',()=>setFolder('all'),folder==='all'),value:'all'},
      {...chip('Drafts',()=>setFolder('drafts'),folder==='drafts'),value:'drafts'},
      {...chip(spamTrashSearch?'Spam':'Spam — not available yet',()=>setFolder('spam'),folder==='spam'),value:'spam',disabled:!spamTrashSearch},
      {...chip(spamTrashSearch||provider.capabilities()?.searchTrash?'Trash':'Trash — not available yet',()=>setFolder('trash'),folder==='trash'),value:'trash',disabled:!spamTrashSearch&&!provider.capabilities()?.searchTrash},
    ]:[];
    for(const row of extraFolders)Object.assign(row,{icon:'/icons/lucide/'+folderIcons[row.value==='all'?'All mail':row.value==='spam'?'Spam':row.value==='trash'?'Trash':row.label]+'.svg',checkCss:row.on?'':'visibility:hidden'});
    const localDrafts=drafts.chips(chip);
    chips.push(...provider.chips(chip));

    // Today's mail shows its time; older mail its date.
    const date = (value: string | null) => { const d = new Date(value || ''); if (!value || Number.isNaN(d.valueOf())) return ''; const now = new Date();
      return d.toDateString() === now.toDateString() ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
    const activeBody = st.open && body?.message.id === st.open ? body : null;
    const rows:Bag[] = messages.map(m => {
      // The shell's swipe recognizer keeps edge gestures for system navigation; a left swipe on a row
      // routes to the reviewed archive flow, any other swipe falls through to the shell.
      const swipe = current.sw?.((dx: number, dy: number) => { if (dx >= 0 || Math.abs(dx) < Math.abs(dy)) return false; void swipeArchive(m); return true; }) ?? { down: () => {}, up: () => {} };
      const senderImage=mailSenderImage(sentView?null:m.fromEmail,cachedDevicePreferences()?.autoLoadMailImages===true);
      const name = sentView ? (m.to.length ? `To: ${m.to.join(', ')}` : 'To: (no recipients)') : m.from; return { name, senderImage,hideSenderImage:(event:Event)=>{(event.currentTarget as HTMLImageElement).style.display='none';}, ini: (sentView ? m.to[0] || '?' : m.from).slice(0, 1).toUpperCase(), subj: m.subject || '(no subject)',
      snip: decodeMailPreview(m.snippet), time: date(m.receivedAt), nameW: m.unread ? '700' : '500', subjCss: 'color:var(--fg)',
      dot: m.unread ? 'var(--acct)' : 'transparent', clip: !!m.hasAttachments, tx: 0, current: st.open === m.id ? 'true' : 'false',
      down: swipe.down, up: swipe.up,
      label: `${m.unread ? 'Unread, ' : ''}${name}, ${m.subject}${m.hasAttachments ? ', has attachments' : ''}`, open: () => void open(m) }; });
    if (draftsView()) rows.splice(0, rows.length, ...providerDrafts.map(d => { const name = d.to.length ? `Draft to ${d.to.join(', ')}` : 'Draft (no recipients)';
      return { name, ini: 'D', subj: d.subject || '(no subject)', snip: decodeMailPreview(d.snippet), time: date(d.updatedAt), nameW: '500', subjCss: 'color:var(--fg)', dot: 'transparent', clip: false, tx: 0, current: 'false',
        down: () => {}, up: () => {}, label: `Gmail draft, ${name}, ${d.subject || '(no subject)'}`, open: () => void openDraft(d) }; }));
    if(draftsView())rows.unshift(...localDrafts.map(action=>({name:'On this device',ini:'D',subj:action.recovery?action.label:action.subject,snip:action.label==='Earlier version of a sent email'?action.label:action.snippet,time:'Draft',nameW:'500',subjCss:'color:var(--fg)',dot:'transparent',clip:false,tx:0,current:'false',down:()=>{},up:()=>{},label:`Local draft, ${action.recovery?action.label:action.subject}`,open:action.pick})));
    const linkRows = (source: NonNullable<typeof body>) => { const cached = linkRowCache.get(source); if (cached) return cached; const seen = new Set<string>(), list: GmailLink[] = [];
      for (const link of [...(source.links || []), ...linkifyMailText(source.bodyText)]) if (link.href.startsWith('https://') && !seen.has(link.href) && list.length < 50) { seen.add(link.href); list.push(link); }
      const rows = list.map(link => { const host = new URL(link.href).hostname; return { label: link.text === link.href ? host : `${link.text} (${host})`, href: link.href, host, mismatch: linkTextMismatch(link),
        open: () => openLink(link) }; });
      linkRowCache.set(source, rows); return rows; };
    const showRemoteImages=remoteImagesShown||cachedDevicePreferences()?.autoLoadMailImages===true;
    let formatted:ReturnType<typeof prepareMailHtml>|null=null;
    if(activeBody?.bodyHtml&&!activeBody.loading&&!activeBody.failed){
      let cached=htmlBodies.get(activeBody);if(!cached){cached={};htmlBodies.set(activeBody,cached);}
      const mode=showRemoteImages?'shown':'hidden';
      formatted=cached[mode]??=prepareMailHtml(activeBody.bodyHtml,showRemoteImages);
    }
    const activeLinks=activeBody?(formatted?linkRows(activeBody).filter(link=>!formatted!.inlineLinks.has(link.href)):linkRows(activeBody)):[];
    const htmlLoaded=(event:Bag)=>{const frame=event.currentTarget as HTMLIFrameElement,doc=frame.contentDocument;if(!doc)return;
      const resize=()=>{if(frame.isConnected)frame.style.height=Math.min(32000,Math.max(120,doc.documentElement.scrollHeight,doc.body.scrollHeight))+'px';};resize();doc.addEventListener('load',resize,true);
      const follow=(event:Event)=>{const target=(event.target as Element)?.closest('a[data-alpha-link]');if(!target)return;event.preventDefault();if(body!==activeBody)return;openLink({href:target.getAttribute('data-alpha-link')!,text:target.textContent||''});};
      doc.addEventListener('click',follow);doc.addEventListener('keydown',event=>{if(event.key==='Enter')follow(event);});
    };

    const needsGmailConnection=!!binding&&accountsChecked&&accountsSession===binding.sessionId&&!selected&&!operation&&phase!=='scheduled'&&!failure;
    return {folderTitle:folder==='inbox'?'Inbox':folder==='sent'?'Sent':folder==='archive'?'Archive':extraFolders.find(row=>row.value===folder)?.label||'Inbox',folderChips:chips.filter(row=>['Inbox','Sent','Archive'].includes(row.label)),actionChips:chips.filter(row=>!['Inbox','Sent','Archive'].includes(row.label)),hasActionChips:chips.some(row=>!['Inbox','Sent','Archive'].includes(row.label)),extraFolders,hasExtraFolders:!!extraFolders.length,extraFolderCss:extraFolders.some(row=>row.on)?'width:112px;background:var(--fg);color:var(--bg)':'',extraFolderLabel:extraFolders.find(row=>row.on)?.label||'More',folderPicker:extraFolders.length?React.createElement(MailFolderPicker,{folders:extraFolders}):null, contextReviewOpen:!!contextReview,contextReview:contextReview?{source:`From: ${contextReview.source.from}\nTo: ${contextReview.source.to.join(', ')}\nSubject: ${contextReview.source.subject}\n\n${contextReview.source.bodyText}`,destination:`${contextReview.destination.origin} · agent ${contextReview.destination.agentId} · owner ${contextReview.destination.ownerId}`,send:()=>void sendContext(),busy:contextBusy,close:()=>{contextReview=null;publish();}}:null,attachmentOpen:!!attachmentView,attachment:attachmentView?{...attachmentView,close:()=>{void attachmentNative.cancel().catch(()=>{});attachmentView=null;publish();}}:null,chips, rows, searching: st.q != null, notSearching: st.q == null, q: st.q || '', hasQ: false,
      openSearch: () => changeQuery(''), closeSearch: () => changeQuery(null), clearSearch:()=>{changeQuery('');queueMicrotask(()=>document.querySelector<HTMLInputElement>('.mail-search-input')?.focus());}, onQ: (e: Bag) => changeQuery(e.target.value), submitSearch:(event:Event)=>{event.preventDefault();const input=(event.currentTarget as HTMLFormElement).querySelector<HTMLInputElement>('input');if(!input?.value.trim())return;input.blur();void load();},
      compose: () => void drafts.newEmail(), empty: rows.length === 0, emptyIcon: 'M4 6h16v12H4zM4 6l8 6 8-6', emptyText: needsGmailConnection ? googleConnectNote() : pendingCompose && !selected && binding && !failure ? 'Checking Gmail connection…' : status,
      hasMore: rows.length > 0 && (!!nextPageToken || (!!operation && loadingMore)), loadingMore: !!operation && loadingMore, loadMoreDisabled: !!operation, loadMoreLabel: operation && loadingMore ? 'Loading more…' : 'Load more', loadMore: () => void load(true),
      canRefresh: !!selected, refreshDisabled: !!operation, refresh: () => { invalidateList(); void provider.bind(selected); void load(); },
      cachedListShown, cachedListNotice: cachedListShown&&messages.length?(failure?.kind==='offline'?'Offline · showing saved mail':failure?'Saved mail · Could not update':phase==='busy'?'Updating mail…':''):'',
      // Signed out, the empty state's one button signs in; signed in without Gmail, it connects Gmail.
      emptyAdd: needsGmailConnection || !binding, addAccountLabel: !binding ? 'Sign in' : googleConnect.getSnapshot()==='waiting' ? 'Connecting…' : 'Connect Gmail', addAcct: () => { if (!connectionController.getCloudClient()) connectionController.openCloudAccount(); else void googleConnect.start(); }, detail: !!activeBody, ...drafts.render(), ...provider.render(),
      d: activeBody ? { hasThread:!!thread,threadRows:thread?thread.messages.map(row=>chip(`${row.message.from}: ${row.message.subject}`,()=>{body=row;publish({open:row.message.id,nativeMailSelection:null});})):[], hasPreviousThread:!!thread&&thread.previousOffsets.length>0,previousThread:()=>void nextThreadPage(true),hasNextThread:thread?.nextOffset!=null, nextThread:()=>void nextThreadPage(), threadStatus:thread?`${thread.total} messages in this thread`:'', subj: activeBody.message.subject || '(no subject)', name: activeBody.message.from,
        fullFrom:activeBody.message.fromEmail?`${activeBody.message.from} <${activeBody.message.fromEmail}>`:'Sender address unavailable',fullTo:activeBody.message.to.join(', ')||'Undisclosed recipients',fullCc:(activeBody.message.cc||[]).join(', '),hasCc:!!activeBody.message.cc?.length,fullReplyTo:activeBody.message.replyTo||'',hasReplyTo:!!activeBody.message.replyTo&&activeBody.message.replyTo!==activeBody.message.fromEmail,fullDate:new Date(activeBody.message.receivedAt).toLocaleString(undefined,{dateStyle:'full',timeStyle:'long'}),ini: activeBody.message.from.slice(0, 1).toUpperCase(), senderImage:mailSenderImage(activeBody.message.fromEmail,cachedDevicePreferences()?.autoLoadMailImages===true),hideSenderImage:(event:Event)=>{(event.currentTarget as HTMLImageElement).style.display='none';}, meta: `To ${activeBody.message.to.join(', ')} · ${date(activeBody.message.receivedAt)}`,
        hasHtml:!!formatted,noHtml:!formatted,htmlDocument:formatted?.document||'',htmlLoaded,hasRemoteImages:!!formatted?.remoteImages&&!showRemoteImages,showImages:()=>{remoteImagesShown=true;publish();},failed:!!activeBody.failed,retry:()=>void open(activeBody.message),
        body: activeBody.loading?'Loading message…':activeBody.bodyText || '(Empty message)', loading:!!activeBody.loading,canLoadThread:!thread&&!activeBody.loading&&!!provider.capabilities()?.threads,loadThread:()=>void loadThread(), noPerson: true, hasPerson: false, hasAtt:!!activeBody.attachments?.length,atts:(activeBody.attachments||[]).map(a=>({name:a.name,size:`${a.size} bytes · ${a.supported?'Review attachment':provider.capabilities()?.opaqueAttachments&&a.size<=5*1024*1024?'No preview · Save to Files':'Unsupported type or size'}`,open:()=>void openAttachment(activeBody,a)})),
        links:activeLinks,hasLinks:activeLinks.length>0,linkSummary:`Other links (${activeLinks.length})`,
        canTrash:!!provider.capabilities()?.mailboxMutations&&!!activeBody.historyId,
        canArchive: !!provider.capabilities()?.mailboxMutations&&!!activeBody.historyId,
        canToggleRead: !!provider.capabilities()?.readState&&!!activeBody.historyId, readLabel: activeBody.message.unread ? 'Mark read' : 'Mark unread', toggleRead: () => { if (activeBody.historyId) void setRead(activeBody.message, activeBody.historyId, !activeBody.message.unread, true); }, canAsk:!!body?.historyId&&!!connectionController.getSnapshot().session,ask:()=>void askAgent(),reply: () => {if(!activeBody.loading)void drafts.newEmail(activeBody.message);},canReplyAll:true,replyAll:()=>{if(!activeBody.loading)void drafts.newEmail(activeBody.message,'reply-all');}, forward: ()=>{if(!activeBody.loading)void drafts.newEmail(activeBody.message,'forward',activeBody.bodyText,{forward:activeBody.historyId&&activeBody.attachments?.length?{messageId:activeBody.message.id,historyId:activeBody.historyId,parts:activeBody.attachments.filter(a=>a.partId&&a.size<=5*1024*1024).map(a=>({partId:a.partId,name:a.name,mimeType:a.mimeType,size:a.size}))}:null});}, del: ()=>{if(!activeBody.historyId){unsupported();return;}void provider.prepare({kind:'trash',messageId:activeBody.message.id,expectedHistoryId:activeBody.historyId});}, archive: ()=>{if(!activeBody.historyId){unsupported();return;}void provider.prepare({kind:'archive',messageId:activeBody.message.id,expectedHistoryId:activeBody.historyId});} } : null };
  };
  const mount = p.componentDidMount, unmount = p.componentWillUnmount;
  p.componentDidMount = function () {
    mount.call(this); shell = this;
    this.inboxImagePreferenceChanged=()=>{remoteImagesShown=false;publish();};
    window.addEventListener('alpha:device-settings',this.inboxImagePreferenceChanged);
    initializeDevicePreferences(); sessionId = connectionController.getCloudClient()?.sessionId;
    openInboxHandler = () => this.openView?.('inbox', { open: null, q: null });
    this.inboxConnectionUnsubscribe = connectionController.subscribe(() => {
      const next = connectionController.getCloudClient()?.sessionId;
      // Renderer hydration/reconnect is not a native credential transition. Native admission
      // and the encrypted credential observer invalidate genuine owner changes.
      if (next !== sessionId) {if(offlineIdentity&&JSON.stringify(offlineOwner())!==offlineIdentity)purgeOffline(); sessionId = next; clear(); if(next)void openNotice(); }
      const nextAgent = connectionController.getSnapshot().session?.sessionId;
      if (nextAgent !== agentSession) { contextReview=null;agentSession = nextAgent; publish({ nativeMailSelection: null }); }
      void restoreHomeMailbox();
    });
    this.gmailNoticeListener=onGmailNotice(()=>void openNotice());void openNotice();
    // Coming back to Alpha (from Google's consent, or anywhere) re-reads the grant: no Check button.
    this.inboxVisibility=()=>{if(document.hidden){readAhead.pause();stopBodyReads();}else{void openNotice();if(api?.isActive()&&!operation&&connectionController.getCloudClient())void refreshAccounts(true);}};
    this.inboxConnectNote=googleConnect.subscribe(()=>publish());
    document.addEventListener('visibilitychange',this.inboxVisibility);
    this.inboxResume = DailyApps.addListener('appResumed', () => { void openNotice(); if (api?.isActive() && !operation && connectionController.getCloudClient()) void refreshAccounts(true); }).catch(() => null);
    // Settings can disconnect an account; re-check instead of showing a revoked mailbox.
    this.inboxAccountsChanged = (event: Event) => {
      void withdrawGmailBackground().catch(()=>{});purgeOffline();invalidateList();saveGmailAccountChoice(connectionController.getSnapshot().cloudAccount,null);
      if ((event as CustomEvent).detail?.source === 'inbox') return;
      // Active Inbox: a read already in flight (the return-to-front re-check) predates this change,
      // so it is replaced by a fresh one instead of leaving Inbox on 'Checking…'.
      if (api?.isActive()) { generation++; operation?.abort(); operation = null; void refreshAccounts(); return; }
      // Drop provider content now; the next open re-checks accounts and rebinds drafts per account.
      generation++; operation?.abort(); operation = null; messages = []; providerDrafts = []; body = null; thread = null; nextPageToken = null; loadedQuery = ''; hasUnread = false; inboxPreview=null;homeFailure=null;accountsChecked=false;failure = null;
      // Stale, with the count and time of the last real read when there was one; never a zero nobody read.
      const read = attention.updatedAt !== null && attention.unread !== undefined;
      setAttention({ state: 'stale', unread: read ? attention.unread : undefined, unreadMore: read && attention.unreadMore, source: read ? attention.source : null, updatedAt: read ? attention.updatedAt : null });
      phase = 'idle'; status = 'Checking Gmail connection…'; publish({ open: null, nativeMailSelection: null });
    };
    window.addEventListener(GMAIL_ACCOUNTS_CHANGED, this.inboxAccountsChanged);window.addEventListener(GOOGLE_ACCOUNTS_CHANGED, this.inboxAccountsChanged);
    void restoreHomeMailbox();
  };
  p.componentWillUnmount = function () {
    closeMailQuestion?.();closeMailQuestion=undefined;noticeAttempt++;void this.gmailNoticeListener?.then((handle:Bag)=>handle.remove()).catch(()=>{});
    window.removeEventListener('alpha:device-settings',this.inboxImagePreferenceChanged);
    document.removeEventListener('visibilitychange',this.inboxVisibility);this.inboxConnectNote?.();
    this.inboxConnectionUnsubscribe?.(); void this.inboxResume?.then((handle: Bag) => handle?.remove()); window.removeEventListener(GMAIL_ACCOUNTS_CHANGED, this.inboxAccountsChanged);window.removeEventListener(GOOGLE_ACCOUNTS_CHANGED, this.inboxAccountsChanged);
    shell = undefined; openInboxHandler = null; clear(true); setAttention({ state: 'not-connected', unread: undefined, unreadMore: false, source: null, updatedAt: null }); unmount?.call(this);
  };
}
