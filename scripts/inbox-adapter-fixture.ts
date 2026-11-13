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
import {prototypeScript} from './fixtures/prototype-script.ts';
import {inboxMemoryStore} from './fixtures/inbox-memory.ts';
import {sha256Hex as digest} from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/digest.ts';
import { InboxOperation, composerKind, composerContent, reviewBinding, reviewBindingRefusal, reviewOpaqueAttachment, checkOutgoingAttachments, outgoingAttachmentLimits, attachmentBytes } from '../apps/app/src/runtime/inbox-operation.ts';
import { reviewMailAttachment } from '../apps/app/src/runtime/inbox-attachment.ts';
import { reviewMailContext, validateMailContext } from '../apps/app/src/runtime/reviewed-mail-context.ts';
import { cloudServiceName, safeMailLink } from '../apps/app/src/runtime/cloud-protocol.ts';
import { linkifyMailText, linkTextMismatch } from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/links.ts';
import * as mailbox from '../apps/app/src/runtime/gmail-mailbox.ts';
import * as googleAccounts from '../apps/app/src/runtime/google-accounts.ts';
import * as grants from '../apps/app/src/runtime/gmail-grants.ts';
import {createMailReviewController, type MailReviewView} from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/review-controller.ts';
import {createMailDraftsController, type MailDraftsController, type SuggestionTarget} from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/drafts-controller.ts';
import * as mailboxList from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/mailbox-list.ts';

import type {
 GmailAccount, GmailInboxCapabilities, GmailInboxOperationKind, GmailInboxReceipt, GmailDraftContent,
 GmailDraftSummary, GmailMessage, GmailReadResult, GmailSearchPage, GmailThreadPage,
} from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/types.ts';
import type {InboxAttention} from '../apps/app/src/prototype/inbox-cloud-adapter.ts';
import type {reviewOwnNoticeQuestion} from '../apps/app/src/prototype/own-notice-question.ts';
import type {MailNoticeTap} from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/background-notices.ts';
import type {OutgoingMailAttachment} from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/attachments.ts';

type Action = () => void;
type Account = Pick<GmailAccount, 'connectionId' | 'label' | 'connected' | 'grantedCapabilities'>;
type Message = Pick<GmailMessage, 'id' | 'threadId' | 'subject' | 'snippet'> & Partial<GmailMessage>;
type Read = Pick<GmailReadResult, 'bodyText'> & Partial<Omit<GmailReadResult, 'message' | 'bodyText'>> & {message: Message};
type Search = Omit<GmailSearchPage, 'supportsSpamTrash'>;
type Call = string | [operation: string, ...values: (string | number | null | undefined)[]];
type ReviewNotice = Parameters<typeof reviewOwnNoticeQuestion>[0];
type Proposal = {
 kind: GmailInboxOperationKind;
 mode?: string;
 attachments?: OutgoingMailAttachment[];
 forwardAttachments?: {messageId: string; historyId: string; partIds: string[]};
 messageId?: string;
 draftId?: string;
 expectedDigest?: string;
 expectedHistoryId?: string;
};
interface FixtureClient {
 gmailAccounts(signal?: AbortSignal): Promise<Account[]>;
 gmailSearch(grant: string, query: string, signal: AbortSignal, size: number, pageToken?: string): Promise<Search>;
 gmailRead(grant: string, id: string, signal: AbortSignal): Promise<Read>;
 gmailThread(grant: string, threadId: string, signal: AbortSignal, cursor?: number): Promise<GmailThreadPage>;
 gmailInboxCapabilities(): Promise<GmailInboxCapabilities>;
 gmailDrafts(grant: string, signal: AbortSignal, pageToken?: string): Promise<{drafts: GmailDraftSummary[]; nextPageToken: string | null}>;
 gmailDraftContent(grant: string, draftId: string): Promise<GmailDraftContent>;
 gmailOpaqueAttachment(grant: string, messageId: string, partId: string, historyId: string): Promise<unknown>;
 gmailAttachment(): Promise<never>;
 gmailPrepareOperation(grant: string, requestId: string, proposal: Proposal): Promise<{receipt: GmailInboxReceipt; review: unknown}>;
 gmailDispatchOperation(grant: string, requestId: string, digest: string, proposal: Proposal): Promise<GmailInboxReceipt>;
 gmailOperation(): Promise<never>;
}
type State = {q: string | null; compose: unknown; open?: string | null; nativeMailSelection?: unknown};
type Chip = {label: string; pick: Action; on?: boolean};
type Reader = {
 body: string; failed: boolean; canLoadThread: boolean; loadThread: Action;
 hasThread: boolean; nextThread: Action; archive: Action; canArchive: boolean;
 canToggleRead: boolean; toggleRead: Action; forward: Action; ask: Action; hasLinks: boolean;
 links: {href: string; mismatch: boolean; open: Action}[];
 atts: {size: string; open: Action}[];
};
type Rendering = ReturnType<MailDraftsController['render']> & MailReviewView & {
 chips: Chip[];
 extraFolders: Chip[];
 rows: {name: string; subj: string; clip: boolean; label: string; time: string; open: Action}[];
 d: Reader | null;
 attachment: {external: boolean; text: string; save: Action; close: Action; saveDisabled: boolean; saveStatus: string; saveLabel?: string} | null;
 cachedListNotice: string;
 cachedListShown: boolean;
 refreshDisabled: boolean;
 emptyText: string;
 emptyAdd: boolean;
 loadMoreLabel: string;
 openSearch: Action;
 closeSearch: Action;
 onQ: (event: {target: {value: string}}) => void;
 submitSearch: (event: {preventDefault(): void; currentTarget: {querySelector(): {value: string | null; blur(): void}}}) => void;
 compose: Action;
 hasMore: boolean;
 loadMore: Action;
 loadMoreDisabled: boolean;
 loadingMore: boolean;
 refresh: Action;
};
export type InboxFixtureApi = {
 sw: (onSwipe: (offset: number, velocity: number) => void) => {down: Action; up: Action};
 swallowed: () => boolean;
 get: () => State;
 isActive: () => boolean;
 set: (patch: Partial<State>) => void;
 toast: (message: string) => void;
 attachReviewedMail?: (title: string, from: string, validate: () => Promise<string>) => void;
};
interface InboxView {
 state: object;
 render(state: State, api: InboxFixtureApi): Rendering;
 badge(): boolean;
 onLeave(): void;
 back(state: State, api: InboxFixtureApi): boolean;
 suggestions(state: State): string[];
 useInEmail(text: string, review?: {token: string; append?: boolean}): boolean;
 emailTarget(): SuggestionTarget;
}
type Cache = {
 get(key: string): Promise<{value: unknown; at: number} | null>;
 put(key: string, value: unknown): Promise<void>;
 clear(): Promise<void>;
};
type NativeAttachment = {opaque?: boolean; reviewed?: boolean};
type DocumentFixture = {
 hidden: boolean;
 addEventListener(name: string, listener: Action): void;
 removeEventListener(name: string, listener: Action): void;
 documentElement: {dataset: {connectionMode: string}};
};

// vm-realm values compare by JSON value.
export function deq(actual: unknown, expected: unknown, message?: string) {
 const plain: unknown = actual === undefined ? undefined : JSON.parse(JSON.stringify(actual));
 if (message === undefined) assert.deepEqual(plain, expected);
 else assert.deepEqual(plain, expected, message);
}
const b64=(text: string)=>Buffer.from(text).toString('base64');
// The adapter compares against the fixture clock below, so "today" is that clock's local day.
export const FIXTURE_NOW=Date.UTC(2026,9,8,12);
export const today=new Date(FIXTURE_NOW);today.setHours(9,41,0,0);
export const mail=(id: string,extra: Partial<GmailMessage>={}): GmailMessage=>({id,threadId:'thread-'+id,subject:'Fixture '+id,from:'Sender',fromEmail:'sender@example.invalid',to:['owner@example.invalid'],snippet:'Preview',receivedAt:'2026-09-30T00:00:00Z',unread:false,...extra});
export const inboxPage=[mail('m1',{unread:true,hasAttachments:true,receivedAt:today.toISOString()}),mail('m2',{unread:true}),mail('m3')];

function scenario({caps={},accounts=null,nativePlatform=false}: {caps?: Partial<GmailInboxCapabilities>; accounts?: Account[] | null; nativePlatform?: boolean}={}){
 let session: string | null = 'session-a';
 let clock = FIXTURE_NOW, probeFail: Error | null = null, probeGate: Promise<void> | null = null;
 const calls: Call[] = [], toasts: string[] = [], prepared: Proposal[] = [], dispatched: number[] = [];
 const opened: NativeAttachment[] = [], saved: NativeAttachment[] = [], navigations: string[] = [], confirms: string[] = [], resume: Action[] = [];
 let confirmAnswer = true;
 const defaultAccounts=[{connectionId:'grant-a',label:'Fixture account',connected:true,grantedCapabilities:['google.gmail.triage']}];
 const capabilities: GmailInboxCapabilities = {version:1,from:'owner@example.invalid',threads:true,send:true,providerDrafts:true,mailboxMutations:true,attachments:true,providerExactlyOnce:false,atomicDraftReplacement:false,readState:false,draftsList:false,forwardAttachments:false,opaqueAttachments:false,searchTrash:false,attachmentPolicy:{maximumOutgoing:1,maximumBytes:5242880,maximumTotalBytes:5242880},...caps};
 const bodies: Record<string, Pick<GmailReadResult, 'bodyText' | 'links' | 'attachments'> | undefined> = {m1:{bodyText:'See https://docs.example.org/plan?x=1. and the old http://insecure.example.net page',links:[{href:'https://tracker.attacker.invalid/r',text:'www.bank.example.com'},{href:'https://docs.example.org/plan?x=1',text:'the plan'}],attachments:[{partId:'1',name:'report.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size:12,supported:false},{partId:'2',name:'notes.txt',mimeType:'text/plain',size:5,supported:true}]}};
 const client: FixtureClient = {
  gmailAccounts:async()=>{calls.push('accounts');return accounts||defaultAccounts;},
  gmailSearch:async(_grant,query,_signal,size,pageToken)=>{calls.push(['search',query,size,pageToken??null]);if(query==='in:inbox is:unread'&&probeGate)await probeGate;if(query==='in:inbox is:unread'&&probeFail){throw probeFail;}
   if(query==='in:inbox is:unread')return {messages:inboxPage.filter(m=>m.unread),syncedAt:'2026-10-08T12:00:00Z',nextPageToken:null};
   if(query==='in:inbox')return {messages:inboxPage,syncedAt:'2026-10-08T12:01:00Z',nextPageToken:null};
   return {messages:query==='in:archive'?[mail('arch-1')]:query==='in:trash'?[mail('trash-1')]:[],syncedAt:'2026-10-08T12:02:00Z',nextPageToken:null};},
  gmailRead:async(_grant,id)=>{calls.push(['read',id]);const m=inboxPage.find(x=>x.id===id)||mail(id);return {message:m,bodyText:bodies[id]?.bodyText||'Plain body',links:bodies[id]?.links||[],historyId:'h-'+id,attachments:bodies[id]?.attachments||[]};},
  gmailThread:async(_grant,threadId)=>{calls.push(['thread',threadId]);const id=threadId.slice(7),m=inboxPage.find(x=>x.id===id)||mail(id);return {messages:[{message:m,bodyText:bodies[id]?.bodyText||'Plain body',links:bodies[id]?.links||[],historyId:'h-'+id,attachments:bodies[id]?.attachments||[]}],total:1,offset:0,historyId:'th',nextOffset:null};},
  gmailInboxCapabilities:async()=>capabilities,
  gmailDrafts:async()=>{calls.push('drafts');return {drafts:[{draftId:'d1',messageId:'dm1',subject:'Plan draft',to:['friend@example.invalid'],snippet:'Draft body',updatedAt:today.toISOString()},{draftId:'d2',messageId:'dm2',subject:'Re: thread',to:[],snippet:'',updatedAt:null}],nextPageToken:null};},
  gmailDraftContent:async(_grant,draftId)=>{calls.push(['draft',draftId]);return draftId==='d1'?{draftId,messageId:'dm1',providerDigest:'a'.repeat(64),to:['friend@example.invalid'],cc:[],bcc:[],subject:'Plan draft',bodyText:'Draft body',threaded:false,attachmentCount:0,plainText:true}:{draftId,messageId:'dm2',providerDigest:'b'.repeat(64),to:[],cc:[],bcc:[],subject:'Re: thread',bodyText:'',threaded:true,attachmentCount:0,plainText:true};},
  gmailOpaqueAttachment:async(_grant,messageId,partId,historyId)=>{calls.push(['opaque',messageId,partId,historyId]);const data=b64('PK\u0003\u0004docx');return {name:'report.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',dataBase64:data,size:8,sha256:await digest('PK\u0003\u0004docx'),opaque:true};},
  gmailAttachment:async()=>{calls.push('attachment');throw new Error('not used');},
  gmailPrepareOperation:async(_grant,requestId,proposal)=>{prepared.push(structuredClone(proposal));const files=await Promise.all((proposal.attachments||[]).map(async f=>{const {text,...m}=await reviewMailAttachment(f);return m;}));
   const review={...proposal,from:'owner@example.invalid',attachments:files,...(proposal.forwardAttachments?{forwardSource:{messageId:proposal.forwardAttachments.messageId,historyId:proposal.forwardAttachments.historyId},forwardedAttachments:proposal.forwardAttachments.partIds.map(partId=>({partId,name:'notes.txt',mimeType:'text/plain',size:5,sha256:'c'.repeat(64)}))}:{})};
   delete review.forwardAttachments;return {receipt:{requestId,kind:proposal.kind,state:'prepared',reviewDigest:await digest(JSON.stringify(review)),providerResult:null,rejectionCode:null},review};},
  gmailDispatchOperation:async()=>{dispatched.push(1);throw new Error('No dispatch in this fixture');},
  gmailOperation:async()=>{throw new Error('No receipt');},
 };
 const listeners = new Set<Action>(), slots = new Map<string, unknown>();
 const controller={getCloudClient:()=>session?{client,sessionId:session,credentialId:'fixture-credential'}:null,getWorkflowDeviceTarget:()=>({installationId:'device'}),getSnapshot:()=>({session:mailNotices?.agent||null,cloudAccount:session?{environment:'production',userId:'fixture-owner',sessionId:session}:null}),subscribe:(fn: Action)=>{listeners.add(fn);return()=>listeners.delete(fn);},rejectCloudSession:()=>false,open:()=>{}};
 let selectionCount=0;const files=[{name:'a.txt',mimeType:'text/plain',text:'alpha'},{name:'b.txt',mimeType:'text/plain',text:'bravo'},{name:'c.txt',mimeType:'text/plain',text:'charlie'}];
 const native={cancel:async()=>{},openReviewed:async (input: NativeAttachment)=>{opened.push(input);return {message:'opened'};},saveReviewed:async (input: NativeAttachment)=>{saved.push(input);return {status:'saved',message:'Saved to the chosen destination. Exact bytes verified.'};},
  readSelected:async({selectionId}: {selectionId: string})=>{const f=files[Number(selectionId.slice(4))%3];return {name:f.name,mimeType:f.mimeType,dataBase64:b64(f.text),size:f.text.length,sha256:await digest(f.text)};}};
 class FixedDate extends Date{constructor(value: number | string | Date=clock){super(value);}static now(){return clock;}}
 const windowFixture={addEventListener(){},removeEventListener(){},dispatchEvent(){return true;},confirm:(text: string)=>{confirms.push(text);return confirmAnswer;}};
 const inboxUnsaved=()=>({ready:Promise.resolve(),available:false,conflict:false,error:false,status:'',peek:()=>null,edit(){},clear:async()=>{},retire(){},resume(){}});
 // The saved account choice (a hint only) lives in this scenario's own storage.
 const choiceSlots = new Map<string, string>();
 const choices = {getItem: (key: string) => choiceSlots.get(key) ?? null,
  setItem: (key: string, value: string) => choiceSlots.set(key, value),
  removeItem: (key: string) => choiceSlots.delete(key)};

 const mailNotices: {
  tap: MailNoticeTap | null;
  withdrawals: number;
  withdrawn: (string | null)[];
  consumed: string[];
  listener: Action;
  agent: {sessionId: string; agentId?: string; ownerId?: string; origin?: string} | null;
  review: ReviewNotice | null;
  released: number;
 } = {tap:null,withdrawals:0,withdrawn:[],consumed:[],listener:()=>{throw Error('Mail notice listener not registered');},agent:null,review:null,released:0};
 const document: DocumentFixture & {querySelector(): null} = {querySelector:()=>null,hidden:false, addEventListener(){}, removeEventListener(){}, documentElement:{dataset:{connectionMode:'live'}}};
 const serviceReadCache = async (): Promise<Cache | null> => null;

 const sandbox=inboxAdapterBindings({MailboxListCache:class extends mailboxList.MailboxListCache{get(key: string,now=clock){return super.get(key,now);}},MailBodyCache:class extends mailboxList.MailBodyCache<Read>{remember(key: string,body: Read,now=clock){return super.remember(key,body,now);}},serviceReadCache,alphaClient:{getState:()=>({context:{sensitive:false}})},reviewOwnNoticeQuestion:(options: ReviewNotice)=>{mailNotices.review=options;return ()=>{};},releaseGmailQuestion:async()=>{mailNotices.released++;mailNotices.tap=null;},configureGmailBackground:async()=>{},withdrawGmailBackground:async (grant?: string)=>{mailNotices.withdrawals++;mailNotices.withdrawn.push(grant??null);},pendingGmailNotice:async (): Promise<MailNoticeTap | null>=>mailNotices.tap,consumeGmailNotice:async (token: string)=>{mailNotices.consumed.push(token);mailNotices.tap=null;},onGmailNotice:async (fn: Action)=>{mailNotices.listener=fn;return {remove:async()=>{}};},readGmailAccountChoice:(owner: Parameters<typeof readGmailAccountChoice>[0])=>readGmailAccountChoice(owner,choices),saveGmailAccountChoice:(owner: Parameters<typeof saveGmailAccountChoice>[0], id: string | null)=>saveGmailAccountChoice(owner,id,choices),Date:FixedDate,inboxUnsaved,
  registerPlugin:()=>native,
  Capacitor:{isNativePlatform:()=>nativePlatform},
  secureConnectionStore:inboxMemoryStore(slots),
  connectionController:controller,
  DailyApps:{addListener:async(name: string,fn: Action)=>{if(name==='appResumed')resume.push(fn);return {remove:async()=>{}};},perform:async()=>({status:'selected',selectionId:'sel-'+(selectionCount++),name:'file'}),forgetSelected:async()=>{}},
  // The in-app review (apps/app/src/browser/review.ts) is rendered by the browser checks; this fixture answers it.
  BrowserReviews:class{confirm(_id: string,title: string,details: string,_label?: string,choice?: {current?:()=>boolean}){confirms.push(title+'\n'+details);return Promise.resolve(confirmAnswer&&choice?.current?.()!==false);}cancel(){}cancelAll(){}},
  window:windowFixture,document});
 return {choices,mailNotices,sandbox,client,native,calls,toasts,prepared,dispatched,opened,saved,navigations,confirms,resume,listeners,slots,
  setSession:(value: string | null)=>{session=value;for(const fn of listeners)fn();},
  advance:(ms: number)=>{clock+=ms;},
  gate:()=>{let release: Action;probeGate=new Promise<void>(resolve=>{release=resolve;});return ()=>{probeGate=null;release();};},
  failProbe:(error: Error | null)=>{probeFail=error;},
  answer:(value: boolean)=>{confirmAnswer=value;},
};
}
const fixtureSources = [
 ['inbox-provider-controls.ts','inboxProviderControls'],
 ['inbox-drafts.ts','inboxDrafts'],
 ['inbox-cloud-adapter.ts',['installInboxCloudAdapter','inboxAttention','openInbox','linkifyMailText','linkTextMismatch']],
] as const;
export class InboxFixtureShell {
 st: State = {q:null, compose:null};
 opened: [string, Partial<State>][] = [];
 declare inboxAccountsChanged: () => Promise<void>;
 componentDidMount() {}
 componentWillUnmount() {}
 renderVals(): object { return {}; }
 vset(_view: string, patch: Partial<State>) { Object.assign(this.st, patch); }
 openView(view: string, patch: Partial<State>) { this.opened.push([view, patch]); }
}

export function inboxAdapterBindings<T extends object>(overrides: T) {
 return {
  ...mailboxList, formatMonthDay, formatTime, formatFullDateTime, weekdayName, formatBytes,
  createMailReviewController, createMailDraftsController, reviewMailAttachment,
  Capacitor:{isNativePlatform:()=>false},
  cloudServiceName, linkifyMailText, linkTextMismatch, React, MailFolderPicker, mailSenderImage, decodeMailPreview,
  cachedDevicePreferences:()=>({autoLoadMailImages:true}), initializeDevicePreferences:()=>{},
  prepareMailHtml:()=>{throw Error('HTML uses the rendered browser test');},
  GmailReadAhead, URL, Date, InboxOperation, composerKind, composerContent, reviewBinding, reviewBindingRefusal,
  reviewOpaqueAttachment, checkOutgoingAttachments, outgoingAttachmentLimits, attachmentBytes,
  safeMailLink, reviewMailContext, validateMailContext, ...mailbox, ...googleAccounts, ...grants,
  googleConnectionController:{open(){throw Error('Explicit Google authorization not exercised by this read fixture');}},
  openConnectionBrowser:async()=>{throw Error('No automatic OAuth');},
  crypto:globalThis.crypto, TextEncoder, structuredClone, Event, CustomEvent, queueMicrotask, setTimeout,
  AbortController, DOMException, console, atob, btoa,
  ...overrides,
 };
}

type InboxExports = {
 installInboxCloudAdapter(component: typeof InboxFixtureShell, views: {inbox: Partial<InboxView>}): void;
 inboxAttention(): InboxAttention;
 openInbox(): void;
};

export async function loadInboxFixture<T extends object>(sandbox: T): Promise<T & InboxExports> {
 vm.createContext(sandbox);
 for (const [file,names] of fixtureSources) vm.runInContext(await prototypeScript(file,names),sandbox);
 const exported: T & Partial<InboxExports> = sandbox;
 assert.ok(exported.installInboxCloudAdapter && exported.inboxAttention && exported.openInbox, 'Inbox adapter exports installed');
 return exported as T & InboxExports;
}

export function installInboxFixture(adapter: InboxExports, Shell: typeof InboxFixtureShell) {
 const views: {inbox: Partial<InboxView> & {state: object}} = {inbox:{state:{}}};
 adapter.installInboxCloudAdapter(Shell, views);
 const view = views.inbox;
 assert.ok(view.render && view.badge && view.onLeave && view.back && view.suggestions && view.useInEmail && view.emailTarget);
 return {inbox: view as InboxView};
}

export async function boot(options?: Parameters<typeof scenario>[0]) {
 const s = scenario(options);
 const adapter = await loadInboxFixture({...s.sandbox, inboxLocalStore: s.sandbox.secureConnectionStore});
 const attentionBefore = adapter.inboxAttention();
 const Shell = class extends InboxFixtureShell {
  browserNavigateApproved(href: string) { s.navigations.push(href); return Promise.resolve(); }
 };
 const views = installInboxFixture(adapter, Shell);
 const inbox = views.inbox;
 const shell = new Shell();
 let active = false;
 const api: InboxFixtureApi = {sw:()=>({down(){},up(){}}),swallowed:()=>false,get:()=>shell.st,isActive:()=>active,
  set:patch=>shell.vset('inbox',patch),toast:text=>s.toasts.push(text)};
 const tick = async () => { for(let i=0;i<40;i++) await new Promise(resolve=>setTimeout(resolve,0)); };
 const render = () => inbox.render(shell.st,api);
 const chip = (label: string) => {
  const rendering = render();
  const found = [...rendering.chips,...rendering.extraFolders].find(item=>item.label===label);
  assert.ok(found,`chip ${label} in ${rendering.chips.map(item=>item.label)}`);
  return found;
 };
 return {...s,sandbox:adapter,views,shell,api,tick,render,chip,attentionBefore,
  setActive:(value: boolean)=>{active=value;},attention:()=>adapter.inboxAttention(),mount:()=>shell.componentDidMount(),
  reader() { const reader = render().d; assert.ok(reader,'Expected Inbox reader'); return reader; },
  composer() { const composer = render().c; assert.ok(composer,'Expected Inbox composer'); return composer; },
  attachment() { const attachment = render().attachment; assert.ok(attachment,'Expected attachment review'); return attachment; },
  provider() { const provider = render().provider; assert.ok(provider,'Expected provider review'); return provider; },
 };
}

export function last<T>(rows: readonly T[]): T {
 const value = rows.at(-1);
 assert.ok(value !== undefined, 'Expected a recorded fixture observation');
 return value;
}

export const searches = ({calls}: {calls: Call[]}) => calls.filter((call): call is Exclude<Call, string> => Array.isArray(call) && call[0]==='search');
