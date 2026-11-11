// Real Inbox adapter lifecycle with an account-bound provider fixture, no real mail.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {SavedMailbox} from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/mailbox-list.ts';
import {ServiceReadCache} from '../apps/app/src/runtime/service-read-cache.ts';
import {saveGmailAccountChoice} from '../apps/app/src/runtime/gmail-account-selection.ts';
import {formatTime} from '../apps/app/src/prototype/locale-time.ts';
import {homeReadIsStale, presentHomeInboxCard, presentHomeInboxStatus, whenLabel} from '../apps/app/src/prototype/home-cards.ts';
import {CloudProtocolError} from '../apps/app/src/runtime/cloud-protocol.ts';
import {classifyGmailFailure} from '../apps/app/src/runtime/gmail-mailbox.ts';
import type {MailBackgroundSelection} from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/background-notices.ts';
import type {GmailInboxOperationKind} from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/types.ts';
import {inboxMemoryStore} from './fixtures/inbox-memory.ts';
import type {InboxUnsaved} from '../apps/app/src/runtime/inbox-unsaved-record.ts';
import {inboxAdapterBindings, InboxFixtureShell, installInboxFixture, last, loadInboxFixture, mail, type InboxFixtureApi} from './inbox-adapter-fixture.ts';

type Action = () => void;
type SearchCall = {query: string; size: number; pageToken: string | null};
type Mail = ReturnType<typeof mail>;
let accountReads=0;
let session='account-a', agent='remote-a', delayAccounts=true, delay=false, connected=true, readGrant=true, inboxActive=true;
const pending: {search?: Action; accounts?: Action} = {};
const release = (kind: keyof typeof pending) => {
 const resume = pending[kind];
 assert.ok(resume, `Expected a held ${kind} fixture request`);
 resume();
};
let failNext: Error | null = null;
const slots = new Map<string, unknown>(), reads: string[] = [], searches: SearchCall[] = [], disconnects: string[] = [], toasts: string[] = [];
const events = new Map<string, (event: Event) => void>();
const fixtureMail = (id: string, extra: Partial<Mail> = {}) => mail(id, {to:['fixture@example.invalid'], ...extra});
// Gmail mailbox revision per page (elizaOS/eliza#35908); a query without an entry models an older Cloud server.
const revisions: Record<string, string[] | undefined> = {};
const pages: Record<string, Mail[][]> = {'in:inbox':[[fixtureMail('mail-1',{unread:true}),fixtureMail('mail-2')],[fixtureMail('mail-2'),fixtureMail('mail-3')]],'in:sent':[[fixtureMail('sent-1',{to:['friend@example.invalid']})]],'from:fixture':[[fixtureMail('mail-1')]]};
let providerBody='Fixture body';
const client={
 gmailAccounts:async()=>{accountReads++;if(delayAccounts)await new Promise<void>(resolve=>{pending.accounts=resolve;});return [{connectionId:'grant-a',label:'Fixture account',connected,grantedCapabilities:connected&&readGrant?['google.gmail.triage']:[]}];},
 gmailSearch:async(_grant: string,query: string,_signal: AbortSignal,size: number,pageToken?: string)=>{searches.push({query,size,pageToken:pageToken??null});if(failNext){const error=failNext;failNext=null;throw error;}
  const list=pages[query]||[[]],index=pageToken?Number(pageToken.slice(5)):0,result={messages:list[index]||[],syncedAt:'revision',nextPageToken:index+1<list.length?'page-'+(index+1):null,...(revisions[query]?.[index]?{mailboxHistoryId:revisions[query][index]}:{})};
  if(delay)return new Promise(resolve=>{pending.search=()=>resolve(result);});return result;},
 gmailRead:async(_grant: string,id: string)=>{reads.push(id);return {message:Object.values(pages).flat(2).find(m=>m.id===id),bodyText:providerBody};},
 disconnectGmail:async(id: string)=>{disconnects.push(id);connected=false;},
};
const listeners = new Set<Action>();
const backgroundSelections: (MailBackgroundSelection | null)[] = [];
type Rejection = {status?: number; code?: string};
type Client = typeof client & {gmailInboxCapabilities?: () => Promise<{readState: boolean}>};
type CloudBinding = {client: Client; sessionId: string; credentialId: string};
type CloudSnapshot = {
 session: {sessionId: string};
 cloudAccount: {environment: string; userId: string; sessionId: string; credentialId: string; organizationId?: string} | null;
};
const controller={getCloudClient:(): CloudBinding | null=>session?{client,sessionId:session,credentialId:'fixture-credential'}:null,getSnapshot:(): CloudSnapshot=>({session:{sessionId:agent},cloudAccount:session?{environment:'production',userId:'fixture-owner',sessionId:session,credentialId:'fixture-credential'}:null}),subscribe:(fn: Action)=>{listeners.add(fn);return()=>listeners.delete(fn);},rejectCloudSession:(_id: string,_error: Rejection)=>false,open:()=>{}};
const windowFixture = {
 addEventListener: (name: string, listener: (event: Event) => void) => events.set(name,listener),
 removeEventListener() {},
 dispatchEvent: () => true,
 confirm: () => true,
};
let latestDraftEdit: InboxUnsaved | null = null;
const inboxUnsaved=()=>({ready:Promise.resolve(),available:false,conflict:false,error:false,status:'',peek:()=>null,edit(record: InboxUnsaved){latestDraftEdit=structuredClone(record);},clear:async()=>{},retire(){},resume(){}});
type ReadCache = {get(key: string): Promise<{value: unknown} | null>; put(key: string, value: unknown): Promise<void>; clear(): Promise<void>};
const secureConnectionStore = inboxMemoryStore(slots);
const sandbox = await loadInboxFixture(inboxAdapterBindings({
 serviceReadCache: async (): Promise<ReadCache | null> => null,
 configureGmailBackground: async (selection: MailBackgroundSelection | null) => {backgroundSelections.push(selection);},
 withdrawGmailBackground: async () => {},
 pendingGmailNotice: async () => null,
 consumeGmailNotice: async () => {},
 onGmailNotice: async () => ({remove:async()=>{}}),
 readGmailAccountChoice: () => 'grant-a',
 saveGmailAccountChoice,
 presentHomeInboxStatus,
 presentHomeInboxCard,
 homeReadIsStale,
 inboxUnsaved,
 registerPlugin: () => ({cancel:async()=>{}}),
 secureConnectionStore,
 inboxLocalStore: secureConnectionStore,
 connectionController: controller,
 DailyApps: {addListener: async (_name: string, _fn: Action) => ({remove:async()=>{}})},
 window: windowFixture,
 document: {querySelector(){return null;},addEventListener(){},removeEventListener(){},documentElement:{dataset:{connectionMode:'live'}}},
}));
const inboxAttentionNow = () => sandbox.inboxAttention();
const swipes = new Map<object, (offset: number, velocity: number) => void>();
function inboxFixture() {
 const Shell = class extends InboxFixtureShell {};
 const views = installInboxFixture(sandbox, Shell);
 const shell = new Shell();
 const api: InboxFixtureApi = {
  sw: callback => {const handlers={down(){},up(){}};swipes.set(handlers,callback);return handlers;},
  swallowed: () => false, get: () => shell.st, isActive: () => inboxActive,
  set: patch => shell.vset('inbox',patch), toast: text => toasts.push(text),
 };
 return {shell,views,api,render:()=>views.inbox.render(shell.st,api)};
}
const {shell, views, api, render} = inboxFixture();
shell.componentDidMount();
const tick=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setTimeout(resolve,0));};
const local=<T>(value: T): T=>JSON.parse(JSON.stringify(value)); // VM-realm arrays compare by value.
const chip=(label: string)=>{
 if(label==='Check connection')return {pick:()=>shell.inboxAccountsChanged()};
 if(label==='Refresh')return {pick:render().refresh};
 const rendering=render(), found=[...rendering.chips,...rendering.extraFolders].find(item=>item.label===label);
 assert.ok(found,`chip ${label} in ${rendering.chips.map(item=>item.label)}`);
 return found;
};
interface HomeInboxValues {
 homeInboxTitle: string;
 homeInboxStatus: string;
 homeInboxCount: string;
 homeInboxDescription: string;
 homeInboxHasRows: boolean;
 homeInboxState: string;
 homeInboxRows: {subject: string; from: string}[];
}
const homeValues = (shell: InboxFixtureShell) => shell.renderVals() as HomeInboxValues;
function composer(view = render()) {
 assert.ok(view.c, 'Expected an Inbox composer');
 return view.c;
}
function reader(view = render()) {
 assert.ok(view.d, 'Expected an Inbox reader');
 return view.d;
}

assert.equal(homeValues(shell).homeInboxTitle,'Inbox');assert.equal(searches.length,0,'Home does not discover accounts or read mail');
assert.equal(sandbox.inboxAttention().unread,undefined,'no count is claimed before any read');
// Home's read time is the completed first-page read; a later page or a local recount never moves it.
const realNow=Date.now,noon=new Date();noon.setHours(12,0,0,0);const clock=(minutes: number)=>{const value=noon.getTime()+minutes*60000;Date.now=()=>value;return formatTime(new Date(value));};
const firstRead=clock(0);
render();await tick();assert.equal(searches.length,1,'remembered first page starts before account discovery finishes');assert.equal(render().rows.length,0,'speculative mail is not displayed before account verification');delayAccounts=false;release('accounts');await tick();
assert.equal(homeValues(shell).homeInboxStatus,`Recent email · Updated ${firstRead}`,'a partial page names its read time');
assert.equal(homeValues(shell).homeInboxCount,'1+ unread');assert.deepEqual(local(homeValues(shell).homeInboxRows),[{subject:'Fixture mail-1',from:'Sender'}]);
assert.deepEqual(searches.map(s=>s.pageToken),[null,'page-1'],'one first page plus one bounded read-ahead');
assert.equal(render().rows.length,2);assert.equal(views.inbox.badge(),true,'badge reflects a real unread provider message');
assert.equal(render().hasMore,true,'provider page token offers Load more');
const laterPage=clock(7);assert.notEqual(laterPage,firstRead);
delay=true;render().loadMore();await tick();assert.equal(render().hasMore,true,'pending pagination stays visible');assert.equal(render().loadMoreLabel,'Loading more…');assert.equal(render().loadMoreDisabled,true);const pendingCount=searches.length;render().loadMore();await tick();assert.equal(searches.length,pendingCount,'double tap never starts another page');release('search');delay=false;await tick();assert.equal(render().loadingMore,false);
assert.deepEqual(searches.at(-1),{query:'in:inbox',size:25,pageToken:'page-1'},'Load more sends the opaque provider page token');
assert.match(homeValues(shell).homeInboxStatus,new RegExp(` · Updated ${firstRead.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`),'a later page keeps the time of the oldest data counted');
assert.equal(homeValues(shell).homeInboxDescription,homeValues(shell).homeInboxStatus);
assert.deepEqual(local(render().rows.map(r=>r.subj)),['Fixture mail-1','Fixture mail-2','Fixture mail-3'],'pages append without duplicates');
assert.equal(render().hasMore,false,'last page has no Load more');
const beforeWarm=searches.length;views.inbox.onLeave();render();await tick();assert.equal(render().rows.length,3,'warm reopen restores only the same account list');assert.equal(render().cachedListShown,true);assert.equal(searches.length,beforeWarm,'warm reopen spends zero account or page requests');
assert.equal(homeValues(shell).homeInboxCount,'1 unread','complete paging removes the lower-bound qualifier');const homeSearches=searches.length;for(let i=0;i<5;i++)homeValues(shell);assert.equal(searches.length,homeSearches,'Home rerenders never fetch mail');
render();last([...swipes.values()])(-120,4);await tick();assert.match(last(toasts),/doesn’t allow archiving\. See Settings → Connections → Manage Google accounts\.$/,'swipe without the grant changes nothing');
const refreshed=clock(19);
chip('Refresh').pick();await tick();assert.deepEqual(searches.filter(s=>!s.pageToken).at(-1),{query:'in:inbox',size:25,pageToken:null},'Refresh restarts from the first page');
assert.match(homeValues(shell).homeInboxStatus,new RegExp(`Updated ${refreshed.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`),'a completed refresh moves the read time');
assert.equal(render().rows.length,2);
const readsBeforeOpen=reads.length;render().rows[0].open();assert.equal(reader().body,'Fixture body','a prepared message opens immediately');await tick();assert.equal(reads.length,readsBeforeOpen,'opening the prepared body never repeats its read');
agent='remote-b';for(const fn of listeners)fn();assert.equal(shell.st.nativeMailSelection,null,'target change clears observation authority');assert.equal(reader().body,'Fixture body','Cloud mailbox remains independent');
views.inbox.back(shell.st,api);
chip('Sent').pick();await tick();assert.equal(last(searches).query,'in:sent','Sent folder uses an in:sent query');
assert.equal(render().rows[0].name,'To: friend@example.invalid','Sent rows show recipients');assert.equal(views.inbox.badge(),true,'Sent results do not clear the Inbox badge');assert.deepEqual(local(homeValues(shell).homeInboxRows),[{subject:'Fixture mail-1',from:'Sender'}],'Sent does not replace cached Inbox metadata');
const folderReturnSearches=searches.length;chip('Inbox').pick();assert.equal(render().rows.length,2,'folder switching immediately restores its loaded list');await tick();assert.equal(last(searches.filter(row=>!row.pageToken)).query,'in:sent','returning Inbox does not fetch its first page again');assert.equal(searches.length,folderReturnSearches,'cached folder switch adds no page read');Date.now=realNow;
render().openSearch();assert.equal(render().rows.length,0,'entering search clears prior-query results');render().onQ({target:{value:'from:fixture'}});
delay=true;render().submitSearch({preventDefault(){},currentTarget:{querySelector:()=>({value:shell.st.q,blur(){}})}});await tick();assert.match(homeValues(shell).homeInboxStatus,/Updating email/);session='account-b';for(const fn of listeners)fn();release('search');await tick();assert.equal(render().rows.length,0,'late previous-account results discarded');
assert.equal(views.inbox.badge(),false,'account change clears the badge');assert.equal(homeValues(shell).homeInboxHasRows,false,'account change retires cached subjects');
delay=false;session='account-a';for(const fn of listeners)fn();render().closeSearch();await tick();assert.equal(shell.st.q,null);
render();await tick();assert.equal(render().rows.length,2,'re-bound account loads again');

// Classified failures keep the explicit header Refresh action; nothing retries on its own.
for(const [error,kind,text] of [[new TypeError('Failed to fetch'),'offline',/offline/],[new CloudProtocolError('http',409),'revoked',/revoked or needs authorization/],[new CloudProtocolError('http',503),'unavailable',/unavailable/]] as const){
 failNext=error;const before=searches.filter(s=>!s.pageToken).length;chip('Refresh').pick();await tick();
 assert.equal(searches.filter(s=>!s.pageToken).length,before+1,'one demand attempt only');assert.match(render().emptyText,text,kind);const home=homeValues(shell);if(kind==='revoked'){assert.equal(home.homeInboxHasRows,false,'revoked access retires cached Home subjects');assert.equal(home.homeInboxStatus,'','Home keeps the approved quiet uncached failure state');assert.equal(home.homeInboxState,'pending','an unverified failed read is not an empty success');assert.doesNotMatch(home.homeInboxCount,/0 unread|Nothing unread/,'failure never claims a verified empty Inbox');}else{assert.equal(home.homeInboxHasRows,true,'same-account cached mail survives a failed refresh');assert.match(home.homeInboxStatus,/retry/,'cached Home mail keeps its failed-refresh state');}assert.equal(render().refreshDisabled,false);if(kind==='revoked')assert.equal(homeValues(shell).homeInboxHasRows,false,'revoked access drops cached subjects');
 if(kind==='revoked')chip('Reconnect Gmail');
 render().refresh();await tick();assert.equal(searches.filter(s=>!s.pageToken).length,before+2,'Refresh is the explicit second demand attempt');assert.equal(render().rows.length,2);
}
// P-37: the read grant is withdrawn on the same connection. The re-read drops the shown mail, the
// Home preview and the badge at once; nothing read under the old grant is shown again.
assert.equal(homeValues(shell).homeInboxHasRows,true);assert.equal(views.inbox.badge(),true);
readGrant=false;chip('Check connection').pick();await tick();
assert.equal(render().rows.length,0,'mail read under the withdrawn grant is gone');assert.equal(homeValues(shell).homeInboxHasRows,false,'Home preview dropped');assert.equal(views.inbox.badge(),false,'badge dropped');
assert.equal(inboxAttentionNow().unread,undefined,'Home attention no longer counts the old mail and claims no count it did not read');
readGrant=true;const regranted=searches.filter(row=>!row.pageToken).length;chip('Check connection').pick();await tick();assert.equal(searches.filter(row=>!row.pageToken).length,regranted+1,'a renewed read grant reads again');assert.equal(render().rows.length,2);
assert.equal(classifyGmailFailure(new CloudProtocolError('http',409),'operation').kind,'stale','operation 409 is a stale review');
assert.equal(classifyGmailFailure(new CloudProtocolError('http',500),'read',false).kind,'offline','browser offline wins');

// Content shared from Notes becomes a reviewed local draft, not a silent no-op.
shell.st.compose={to:'Speaker name',subject:'Shared note',body:'· line one'};render();await tick();render();await tick();
assert.equal(shell.st.compose,null,'shared compose request is consumed once');
const composed=render();assert.equal(composed.composing,true,'shared content opens a composer');assert.equal(composer(composed).subject,'Shared note');assert.equal(composer(composed).body,'· line one');
assert.deepEqual(local(composer(composed).chips),[],'non-address recipients are not guessed');assert.match(composer(composed).status,/nothing has been sent/);
assert.equal(composer(composed).attachLabel,'Attach file');assert.equal(composer(composed).showRecipientDetails,false);composer(composed).toggleRecipientDetails();assert.equal(composer().showRecipientDetails,true);
assert.equal(composer(composed).multi,false,'From switcher only appears with more than one account');
assert.deepEqual(local(views.inbox.suggestions(shell.st)),['Help me write this email']);
views.inbox.back(shell.st,api);composer(composed).discard();composer().confirmDiscard();await tick();
assert.deepEqual(local(views.inbox.suggestions(shell.st)),['Help me write an email'],'no unwired inbox automation chips (organize-inbox removed)');
assert.equal(render().composing,false,'discarded shared draft is gone');
shell.st.compose={subject:'Photo',body:'',attach:['photo-1']};render();await tick();render();await tick();
assert.equal(composer().subject,'Photo');assert.deepEqual(local(composer().atts),[],'prototype item ids are never turned into attachments');assert.match(composer().status,/Shared items aren't attached/);
views.inbox.back(shell.st,api);composer().discard();composer().confirmDiscard();await tick();
shell.st.compose={to:'second@example.invalid',subject:'Second share',body:'Earlier shared text'};render();await tick();render();await tick();assert.equal(composer().subject,'Second share');
const secondShare=local(latestDraftEdit as InboxUnsaved | null);assert.ok(secondShare);assert.deepEqual(secondShare.draft.to,['second@example.invalid']);assert.equal(secondShare.draft.body,'Earlier shared text');
shell.st.compose={subject:'Third share',body:'New shared text'};render();await tick();render();await tick();assert.equal(composer().subject,'Third share','a share opens a separate draft after preserving the open email');assert.equal(composer().body,'New shared text');assert.match(composer().status,/nothing has been sent/);
const preservedShelf=[...slots.entries()].find(([key])=>key.startsWith('inbox-drafts:v1:shelf:'))?.[1] as {owner: string; items: unknown[]} | undefined;
assert.ok(preservedShelf,'the previous email is stored on the account-bound shelf');assert.equal(preservedShelf.owner,secondShare.owner);
assert.deepEqual(local(preservedShelf.items),[{draft:secondShare.draft,toQ:secondShare.toQ}],'the entire previous draft, including id, revision, recipients and text, survives unchanged');
const thirdShare=latestDraftEdit as InboxUnsaved | null;assert.ok(thirdShare);assert.notEqual(thirdShare.draft.id,secondShare.draft.id,'the newly shared email has its own draft identity');
views.inbox.back(shell.st,api);composer().discard();composer().confirmDiscard();await tick();

// A removed message repeats no row, so only the mailbox revision shows that the later page came
// from a changed mailbox: the list offers Load newer mail. Same revision: no change is claimed.
const savedInbox=pages['in:inbox'];
pages['in:inbox']=[[fixtureMail('rev-1'),fixtureMail('rev-2')],[fixtureMail('rev-4')]];
for(const [label,second,changed] of [['same revision','1001',false],['changed revision','1002',true],['older server','',false]] as const){
 revisions['in:inbox']=second?['1001',second]:undefined;const toastsBefore=toasts.length;
 chip('Refresh').pick();await tick();assert.equal(render().hasMore,true,label);
 render().loadMore();await tick();
 assert.deepEqual(local(render().rows.map(r=>r.subj)),['Fixture rev-1','Fixture rev-2','Fixture rev-4'],`${label}: no row repeats`);
 assert.equal(render().chips.some(c=>c.label==='Load newer mail'),changed,`${label}: Load newer mail offered only for a changed revision`);
 assert.equal(toasts.slice(toastsBefore).some(t=>/Newer mail arrived/.test(t)),changed,`${label}: the change is reported once`);
 if(changed){const before: number=searches.length;chip('Load newer mail').pick();await tick();assert.deepEqual(searches.slice(before)[0],{query:'in:inbox',size:25,pageToken:null},'Load newer mail reloads from page one');assert.deepEqual(searches.slice(before+1).map(row=>row.pageToken),searches.length>before+1?['page-1']:[],'only the bounded read-ahead follows');assert.equal(render().chips.some(c=>c.label==='Load newer mail'),false,'a fresh first page clears the change');}
}
delete revisions['in:inbox'];pages['in:inbox']=savedInbox;
// Only a complete successful empty page can claim no unread mail.
pages['in:inbox']=[[]];chip('Refresh').pick();await tick();assert.equal(homeValues(shell).homeInboxTitle,'No unread email');assert.equal(homeValues(shell).homeInboxHasRows,false);
views.inbox.onLeave();const leftSearches=searches.length;assert.equal(homeValues(shell).homeInboxTitle,'No unread email','Home retains metadata after full messages are retired');assert.equal(searches.length,leftSearches,'returning Home never fetches mail');render();await tick();
// Account changes withdraw the prior summary until the current grant is verified.
pages['in:inbox']=[[fixtureMail('scope-proof',{unread:true})]];chip('Refresh').pick();await tick();
views.inbox.onLeave();const lastRead=local(sandbox.inboxAttention());assert.equal(lastRead.unread,1);assert.ok(lastRead.updatedAt);
inboxActive=false;delayAccounts=true;
const changed=events.get('alpha:gmail-accounts-changed');assert.ok(changed);
const firstCheck=changed(new CustomEvent('alpha:gmail-accounts-changed',{detail:{source:'settings'}})),firstAccounts=pending.accounts;
assert.ok(firstAccounts);
assert.equal(sandbox.inboxAttention().state,'loading');assert.equal(sandbox.inboxAttention().unread,undefined);assert.equal(sandbox.inboxAttention().source,null);
assert.deepEqual(local(homeValues(shell).homeInboxRows),[],'the previous account summary disappears before account lookup returns');
const secondCheck=changed(new CustomEvent('alpha:gmail-accounts-changed',{detail:{source:'settings'}})),secondAccounts=pending.accounts;
assert.ok(secondAccounts);assert.notEqual(firstAccounts,secondAccounts);
firstAccounts();await firstCheck;
assert.equal(sandbox.inboxAttention().state,'loading','a superseded account reply cannot republish the old summary');
assert.deepEqual(local(homeValues(shell).homeInboxRows),[]);
delayAccounts=false;secondAccounts();await secondCheck;await tick();
inboxActive=true;render();await tick();

// Account management lives in Settings; a connected inbox never prompts to connect again.
assert.equal(render().chips.some(c=>/Connect Gmail|Check connection|Authorize|Disconnect|Fixture account/.test(c.label)),false);
assert.equal(render().emptyAdd,false,'connected empty mailbox is not a connect prompt');
// Explicit refresh also refreshes bodies, including an older text-only response after a server upgrade.
pages['in:inbox']=[[fixtureMail('mail-1')]];chip('Refresh').pick();await tick();render().rows[0].open();await tick();assert.equal(reader().body,'Fixture body');views.inbox.back(shell.st,api);providerBody='Fresh provider body';const beforeBodyRefresh=reads.length;chip('Refresh').pick();await tick();render().rows[0].open();await tick();assert.equal(reader().body,'Fresh provider body');assert.ok(reads.length>beforeBodyRefresh,'Refresh never keeps an obsolete cached body');views.inbox.back(shell.st,api);
assert.deepEqual(disconnects,[],'Inbox has no disconnect mutation');
shell.componentWillUnmount();
console.log('PASS: Inbox auto-load, Refresh, provider paging, Sent folder, unread badge, account/query fences, classified errors with explicit header Refresh, shared compose prefill, compact toolbar and immediate pagination feedback. Provider fixture only.');

// A new adapter instance represents a reload: restore only the current owner's retained inbox.
// Deliberately cross local midnight: the retained timestamp is unchanged while its label includes the prior date.
// Today's 00:00:15 keeps the restored row inside the 30-day window later checks read on the real clock; yesterday's in the first 15 s of a day, so the row is never in the future.
const restoreDay=new Date();if(Date.now()<new Date(restoreDay).setHours(0,0,15,0))restoreDay.setDate(restoreDay.getDate()-1);
const restoreNow=restoreDay.setHours(0,0,15,0),cachedAt=restoreNow-30000,cachedReadLabel=whenLabel(cachedAt,restoreNow);
assert.notEqual(cachedReadLabel,formatTime(new Date(cachedAt)),'prior-day label includes its date');
type FixtureMailbox = Omit<SavedMailbox<{message: Mail; bodyText: string}>, 'accounts'> & {
 accounts: {connectionId: string; label: string; connected: boolean; grantedCapabilities: string[]}[];
};
const retainedMailbox: FixtureMailbox={accounts:[{connectionId:'grant-a',label:'Fixture account',connected:true,grantedCapabilities:['google.gmail.triage']}],selected:'grant-a',spamTrashSearch:false,lists:[{key:'old-session-key',at:cachedAt,firstPageRevision:null,messages:[fixtureMail('retained-unread',{unread:true})],query:'in:inbox',cursor:null,revision:'old-revision',cursors:[],newerMail:false,status:'Retained inbox'}],bodies:[]};
sandbox.serviceReadCache=async()=>({get:async key=>key==='gmail:mailbox'?{value:structuredClone(retainedMailbox)}:null,put:async()=>{},clear:async()=>{}});
// Without a nameable owner (no organization) the saved native selection and cursor are never withdrawn.
assert.equal(backgroundSelections.filter(selection=>selection===null).length,1,'only the unselected start withdraws; a selected account whose owner has no organization never does');const selectionsBeforeReload=backgroundSelections.length;
const priorSnapshot=controller.getSnapshot;controller.getSnapshot=()=>{
 const snapshot = priorSnapshot();
 return {...snapshot,cloudAccount:snapshot.cloudAccount ? {...snapshot.cloudAccount,organizationId:'fixture-org'} : null};
};
const {shell: reloaded, render: reloadInbox} = inboxFixture();
reloaded.componentDidMount();
const searchesBeforeRestore=searches.length,accountReadsBeforeRestore=accountReads;
const priorRestoreClock=Date.now;Date.now=()=>restoreNow;
reloadInbox();await tick();
assert.equal(reloadInbox().rows.length,1,'cached Inbox renders after reload');
assert.equal(homeValues(reloaded).homeInboxCount,'1 unread','Home rebuilds the same cached unread count after reload');
assert.deepEqual(local(homeValues(reloaded).homeInboxRows),[{subject:'Fixture retained-unread',from:'Sender'}]);
assert.equal(homeValues(reloaded).homeInboxStatus,`Fixture account · Updated ${cachedReadLabel}`,'restore formats the original read time across midnight');
assert.equal(sandbox.inboxAttention().updatedAt,new Date(cachedAt).toISOString(),'restore preserves the exact original read timestamp');
Date.now=priorRestoreClock;
assert.equal(searches.length,searchesBeforeRestore,'fresh retained snapshot needs no provider read to populate Home');
assert.ok(accountReads>accountReadsBeforeRestore,'a saved mailbox is revalidated against current account grants');
assert.deepEqual(backgroundSelections.slice(selectionsBeforeReload).map(selection=>selection?.grantId),['grant-a'],'grant revalidation keeps the same native background account');
reloaded.componentWillUnmount();
console.log('PASS: Reloaded Inbox cache also restores Home subjects/count/time without a provider read.');

// Home's startup warmup: a late saved summary, a same-account rebind and a revoked grant.
{
 const {shell: home, views: warmViews, render: inbox} = inboxFixture();
 let cleared=0;const gate=Promise.withResolvers<void>(),resumed: Action[]=[];
 sandbox.serviceReadCache=async()=>({get:async key=>{await gate.promise;return key==='gmail:mailbox'&&!cleared?{value:structuredClone(retainedMailbox)}:null;},put:async()=>{},clear:async()=>{cleared++;}});
 sandbox.DailyApps={addListener:async(_,fn)=>{resumed.push(fn);return {remove:async()=>{}};}};
 pages['in:inbox']=[[fixtureMail('fresh-1',{unread:true}),fixtureMail('fresh-2',{unread:true})]];inboxActive=false;const before=searches.length;
 home.componentDidMount();await tick();for(const fn of listeners)fn();await tick();gate.resolve();await tick();
 assert.deepEqual(searches.slice(before),[{query:'in:inbox',size:25,pageToken:null}],'Home reads one bounded header page');
 assert.deepEqual(local(homeValues(home).homeInboxRows),[{subject:'Fixture fresh-1',from:'Sender'},{subject:'Fixture fresh-2',from:'Sender'}],'a saved summary that lands after the warmup never replaces it');
 inboxActive=true;inbox();await tick();inbox().rows[0].open();await tick();assert.equal(home.st.open,'fresh-1');const opened=searches.length;
 const rebound={...client};controller.getCloudClient=()=>session?{client:rebound,sessionId:session,credentialId:'fixture-credential'}:null;for(const fn of listeners)fn();await tick();
 assert.equal(inbox().rows.length,2,'a same-account rebind keeps the mailbox');assert.equal(home.st.open,'fresh-1','and the open message');assert.ok(inbox().d,'and its body');assert.equal(searches.length,opened,'and reads nothing again');
 warmViews.inbox.onLeave();inboxActive=false;assert.equal(homeValues(home).homeInboxHasRows,true);
 const now=Date.now;Date.now=()=>now()+61000;failNext=new CloudProtocolError('http',403);for(const fn of resumed)fn();await tick();Date.now=now;
 assert.equal(cleared,1,'a revoked warmup purges the saved mailbox');const revoked=homeValues(home);
 assert.equal(revoked.homeInboxHasRows,false,'and the Inbox page Home was showing');assert.equal(revoked.homeInboxStatus,'');assert.equal(warmViews.inbox.badge(),false);
 home.componentWillUnmount();
}
console.log('PASS: Home warmup outlives a late saved summary and a same-account rebind; a revoked warmup purges saved mail.');

// Home-only use saves its accepted page without replacing the richer mailbox.
await test('Home warmup persists headers for immediate reload while refresh is pending or fails',async()=>{
 const owner='home-saved-read',original=structuredClone(retainedMailbox);
 original.lists.push({...original.lists[0],query:'in:sent',messages:[fixtureMail('sent-retained')]});
 original.bodies.push({at:Date.now(),body:{message:fixtureMail('retained-unread'),bodyText:'Previously opened body'}});
 let raw: unknown={version:1,owner,entries:[{key:'gmail:mailbox',at:Date.now(),value:original}]};
 const cache=new ServiceReadCache(owner,{read:async()=>structuredClone(raw),compareExchange:async(before,next)=>{assert.deepEqual(before,raw);raw=structuredClone(next);return 'saved';}});
 const previousCache=sandbox.serviceReadCache,previousClient=controller.getCloudClient;
 sandbox.serviceReadCache=async()=>cache;controller.getCloudClient=()=>session?{client,sessionId:session,credentialId:'fixture-credential'}:null;
 const installed: InboxFixtureShell[]=[];
 const mount=()=>{const {shell:h,views:v,api:a}=inboxFixture();h.componentDidMount();installed.push(h);return {h,v,a};};
 try{
  inboxActive=false;connected=true;readGrant=true;delayAccounts=false;delay=false;failNext=null;
  pages['in:inbox']=[[fixtureMail('home-saved',{unread:true})]];
  const beforeBodies=reads.length,beforeSearch=searches.length,first=mount();await tick();
  assert.equal(searches.length,beforeSearch+1,'Home uses its one existing header read');
  assert.equal(reads.length,beforeBodies,'Home does not read bodies');
  assert.deepEqual((await cache.get<FixtureMailbox>('gmail:mailbox'))?.value,original,'warmup preserves bodies and other folders');
  const saved=(await cache.get<FixtureMailbox>('gmail:home'))?.value;assert.ok(saved);
  assert.deepEqual(local(saved.lists[0].messages),pages['in:inbox'][0],'cache contains the actual accepted header rows');
  assert.deepEqual(local(saved.bodies),[]);assert.equal(saved.lists.length,1);assert.equal(saved.accounts.length,1);
  first.h.componentWillUnmount();installed.pop();
  delayAccounts=true;failNext=new CloudProtocolError('http',503);
  const second=mount();await tick();
  assert.deepEqual(local(homeValues(second.h).homeInboxRows),[{subject:'Fixture home-saved',from:'Sender'}],'saved Home rows appear before the network answers');
  assert.equal(homeValues(second.h).homeInboxCount,'1 unread');
  assert.equal(sandbox.inboxAttention().updatedAt,new Date(saved.lists[0].at).toISOString(),'reload keeps the accepted read time');
  inboxActive=true;second.v.inbox.render(second.h.st,second.a);await tick();
  assert.equal(second.v.inbox.render(second.h.st,second.a).rows[0].subj,'Fixture home-saved','Inbox also restores the newer header page while refresh is pending');
  delayAccounts=false;release('accounts');await tick();
  assert.equal(second.v.inbox.render(second.h.st,second.a).rows[0].subj,'Fixture home-saved','a failed refresh keeps the restored list');
  const restored=(await cache.get<FixtureMailbox>('gmail:mailbox'))?.value;assert.ok(restored);
  assert.ok(restored.lists.some(row=>row.query==='in:sent'&&row.messages[0].id==='sent-retained'),'restoring the Home page keeps other folders');
  assert.ok(restored.bodies.some(row=>row.body.bodyText==='Previously opened body'),'restoring the Home page keeps cached bodies');
  assert.deepEqual((await cache.get<FixtureMailbox>('gmail:home'))?.value,saved,'failed refresh keeps the accepted Home snapshot');
 }finally{for(const h of installed)h.componentWillUnmount();sandbox.serviceReadCache=previousCache;controller.getCloudClient=previousClient;delayAccounts=false;failNext=null;}
});

await test('a late disk restore cannot replace the newer live Home page when Inbox opens',async()=>{
 const previousCache=sandbox.serviceReadCache,previousClient=controller.getCloudClient;
 let gets=0;const disk=Promise.withResolvers<void>();
 sandbox.serviceReadCache=async()=>({get:async key=>{if(++gets>2)await disk.promise;return key==='gmail:mailbox'?{value:structuredClone(retainedMailbox)}:null;},put:async()=>{},clear:async()=>{}});
 controller.getCloudClient=()=>session?{client,sessionId:session,credentialId:'fixture-credential'}:null;
 const {shell:h,render:inbox}=inboxFixture();
 try{
  inboxActive=false;delayAccounts=false;delay=true;failNext=null;pages['in:inbox']=[[fixtureMail('live-after-disk-start',{unread:true})]];
  const beforeSearch=searches.length;h.componentDidMount();await tick();
  assert.deepEqual(local(homeValues(h).homeInboxRows),[{subject:'Fixture retained-unread',from:'Sender'}]);
  assert.equal(searches.length,beforeSearch+1,'the existing Home refresh waits for its response');
  inboxActive=true;inbox();await tick();assert.equal(gets,4,'Inbox restoration is waiting for both disk snapshots');
  delay=false;release('search');await tick();
  assert.deepEqual(local(homeValues(h).homeInboxRows),[{subject:'Fixture live-after-disk-start',from:'Sender'}],'the live result is accepted before disk completes');
  failNext=new CloudProtocolError('http',503);disk.resolve();await tick();
  assert.deepEqual(local(inbox().rows.map(row=>row.subj)),['Fixture live-after-disk-start'],'late disk cannot replace the live page in Inbox');
  assert.deepEqual(local(homeValues(h).homeInboxRows),[{subject:'Fixture live-after-disk-start',from:'Sender'}]);
  assert.equal(searches.length,beforeSearch+1,'opening reuses the accepted live result without another page read');
 }finally{disk.resolve();h.componentWillUnmount();sandbox.serviceReadCache=previousCache;controller.getCloudClient=previousClient;delay=false;delayAccounts=false;failNext=null;}
});

for(const candidate of ['newer-mailbox','invalid-home','different-account','home-only'])await test(`Home selects the latest valid saved page: ${candidate}`,async()=>{
 const full=structuredClone(retainedMailbox),home=structuredClone(retainedMailbox);
 full.lists[0].at=Date.now()-1000;full.lists[0].messages=[fixtureMail('new-full',{unread:true})];
 home.lists[0].at=full.lists[0].at-1000;home.lists[0].messages=[fixtureMail('old-home',{unread:true})];
 if(candidate==='invalid-home'){home.lists[0].at=Date.now()+60000;}
 if(candidate==='different-account'){home.selected='grant-b';home.accounts[0].connectionId='grant-b';home.lists[0].at=Date.now();}
 const previousCache=sandbox.serviceReadCache,previousClient=controller.getCloudClient;
 sandbox.serviceReadCache=async()=>({get:async key=>candidate==='home-only'&&key==='gmail:mailbox'?null:({value:key==='gmail:home'?home:full}),put:async()=>{},clear:async()=>{}});
 controller.getCloudClient=()=>session?{client,sessionId:session,credentialId:'fixture-credential'}:null;
 const {shell:h}=inboxFixture();
 try{inboxActive=false;delayAccounts=true;h.componentDidMount();await tick();assert.deepEqual(local(homeValues(h).homeInboxRows),[{subject:candidate==='home-only'?'Fixture old-home':'Fixture new-full',from:'Sender'}]);}
 finally{h.componentWillUnmount();sandbox.serviceReadCache=previousCache;controller.getCloudClient=previousClient;delayAccounts=false;release('accounts');await tick();}
});

// A fresh Home adapter never opens Inbox: `selected` must not mask the revoked restore gate.
for(const purgeFailure of ['reject','exhausted-cas'])await test(`a fresh Home shell cannot restore revoked subjects after ${purgeFailure} purge`,async()=>{
 const {shell: fresh} = inboxFixture();
 let localGets=0,casAttempts=0,purgeSettled;
 const owner='fresh-revoked-cache-'+purgeFailure;
 const raw={version:1,owner,entries:['gmail:mailbox','gmail:home'].map(key=>({key,at:Date.now(),value:structuredClone(retainedMailbox)}))};
 const cache=new ServiceReadCache(owner,{read:async()=>structuredClone(raw),compareExchange:async()=>{casAttempts++;if(purgeFailure==='reject')throw Error('Closed fixture failed purge');return 'conflict';}});
 const get=cache.get.bind(cache),clear=cache.clear.bind(cache);
 cache.get=async function<T>(key: string){localGets++;return get<T>(key);};
 cache.clear=function(){const task=clear();purgeSettled=task.then(()=>{},()=>{});return task;};
 const previousCache=sandbox.serviceReadCache,previousClient=controller.getCloudClient;
 sandbox.serviceReadCache=async()=>cache;controller.getCloudClient=()=>session?{client,sessionId:session,credentialId:'fixture-credential'}:null;
 inboxActive=false;connected=true;readGrant=true;delay=false;delayAccounts=true;failNext=new CloudProtocolError('http',403);
 const beforeSearch=searches.length,beforeBodies=reads.length,priorAccountGate=pending.accounts;
 try{
  fresh.componentDidMount();await tick();
  assert.equal(localGets,2,'fresh Home reads each saved snapshot once before network decision');
  assert.deepEqual(local(homeValues(fresh).homeInboxRows),[{subject:'Fixture retained-unread',from:'Sender'}],'saved subject was genuinely visible before revocation');
  assert.equal(typeof pending.accounts,'function','warmup discovery is pending, without an Inbox render/open');
  assert.notEqual(pending.accounts,priorAccountGate,'this fresh shell reached its own gated account discovery');
  delayAccounts=false;release('accounts');await tick();
  assert.ok(purgeSettled,'warm403 actually called the real cache clear');await purgeSettled;await tick();
  assert.equal(casAttempts,purgeFailure==='reject'?1:3,'real ServiceReadCache exercised rejected or exhausted purge');
  assert.equal(raw.entries[0].value.lists[0].messages[0].subject,'Fixture retained-unread','failed purge leaves a real readable stale snapshot');
  const restored = await get<typeof retainedMailbox>('gmail:mailbox');assert.ok(restored);
  assert.equal(restored.value.lists[0].messages[0].subject,'Fixture retained-unread','the real cache can still serve the stale saved subject after failed deletion');
  assert.equal(searches.length,beforeSearch+1,'one bounded warm page received403');
  assert.equal(homeValues(fresh).homeInboxHasRows,false,'warm403 initially retires its subject');
  const getsAfterRevocation=localGets;
  for(const listener of [...listeners])listener();await tick();
  const after=homeValues(fresh);
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

// An expired Cloud key while changing read state signs out the session captured before the request.
await test('read state with an expired Cloud key rejects the captured session and asks for sign-in',async()=>{
 const {shell: shellR, render: inbox} = inboxFixture();
 const rejected: [string, Rejection][] = [], prepares: string[] = [],previousClient=controller.getCloudClient,previousReject=controller.rejectCloudSession,previousCache=sandbox.serviceReadCache;
 let expire: CloudProtocolError | null = null;
 const readClient={...client,
  gmailInboxCapabilities:async()=>({readState:true}),
  gmailRead:async(_grant: string,id: string)=>({message:fixtureMail(id),bodyText:'Read-state body',historyId:'history-'+id}),
  gmailPrepareOperation:async(_grant: string,_request: string,proposal: {kind: GmailInboxOperationKind})=>{prepares.push(proposal.kind);throw expire;},
 };
 pages['in:inbox']=[[fixtureMail('read-1'),fixtureMail('read-2')]];sandbox.serviceReadCache=async()=>null;
 controller.getCloudClient=()=>session?{client:readClient,sessionId:session,credentialId:'fixture-credential'}:null;
 controller.rejectCloudSession=(sessionId,error)=>{rejected.push([sessionId,error]);return error?.status===401||error?.code==='expired';};
 inboxActive=true;connected=true;readGrant=true;delayAccounts=false;delay=false;failNext=null;
 try{
  shellR.componentDidMount();inbox();await tick();for(const fn of listeners)fn();await tick();
  inbox().rows[0].open();await tick();await tick();
  assert.equal(inbox().d?.canToggleRead,true,'the fixture account can change read state');
  for(const error of [new CloudProtocolError('http',401),new CloudProtocolError('expired')]){
   expire=error;const toastsBefore=toasts.length,rejectedBefore=rejected.length;
   reader(inbox()).toggleRead();await tick();
   assert.equal(prepares.at(-1),'mark-unread','one explicit change was sent');
   assert.deepEqual(rejected.slice(rejectedBefore).map(([id,e])=>[id,e===error]),[[session,true]],'the captured session is rejected with the request error');
   assert.deepEqual(toasts.slice(toastsBefore),['Cloud sign-in expired. Sign in again to update read state.'],'the sign-in message replaces the generic receipt message');
  }
  expire=new CloudProtocolError('http',503);const toastsBefore=toasts.length;
  reader(inbox()).toggleRead();await tick();
  assert.equal(toasts.length,toastsBefore+1);assert.doesNotMatch(last(toasts),/sign-in expired/,'an unavailable Cloud keeps the classified message');
 }finally{
  shellR.componentWillUnmount();controller.getCloudClient=previousClient;controller.rejectCloudSession=previousReject;sandbox.serviceReadCache=previousCache;
 }
});
