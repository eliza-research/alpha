import {retireGmailBackground} from './gmail-background';
import type {GmailAccount} from './cloud-protocol';
import {disconnectGmailAccount, type GmailDisconnectOutcome} from './gmail-mailbox';
import {calendarSourceKey,type AgentCalendar,type AgentCalendarSyncReview} from './agent-calendar';
import type {CanonicalCalendarSyncSettings} from './calendar-sync-settings';
import type {LifeOpsCalendarSummary, LifeOpsLinkedCalendarControl} from '../../../../.eliza/client-features/packages/contracts/src/calendar';

/** Google accounts for one captured Cloud session, and the same Agent Calendar's lifecycle around them:
 * Connect links it to Google through the canonical sync control (linkGoogleCalendar), and disconnect
 * pauses that link (googleCalendarDisconnectLifecycle) while the ordinary privacy revoke runs
 * (disconnectGoogleWithCalendar). Browser and native share this orchestration only; CalendarService
 * remains the record authority. */

export interface GoogleDisconnectLease {
  origin: string;
  ownerId: string;
  agentId: string;
  sessionId: string;
  credentialBinding: string;
  sourceGeneration: string;
}
/** The canonical Calendar source fields a disconnect reads. managedGoogleConnectionId is the verified host's
 * association, decoded by the strict canonical decoder; never derive it here. */
type GoogleDisconnectCalendarSource = Pick<LifeOpsCalendarSummary, 'provider' | 'side' | 'grantId' |
  'connectorAccountId' | 'calendarId' | 'selectionVersion' | 'managedGoogleConnectionId'>;
export interface GoogleDisconnectReview {
  lease: GoogleDisconnectLease;
  control: LifeOpsLinkedCalendarControl | null;
  sources: readonly GoogleDisconnectCalendarSource[];
}
export interface GoogleDisconnectPauseRequest {
  operation: 'pause';
  expectedRevision: number;
  idempotencyKey: string;
}
export type DisconnectCleanupStatus = 'confirmed' | 'unknown' | 'unavailable' | 'not-applicable';
export interface GoogleDisconnectPorts<T> {
  current(): GoogleDisconnectReview | null;
  /** Cloud privacy binding is independent of optional Calendar cleanup availability.
   * When omitted, existing callers retain their single captured-lease check. */
  privacyCurrent?(): void;
  /** Existing ordinary one-POST + account-readback helper; its transport budget is unchanged. */
  revoke(connectionId: string, signal: AbortSignal): Promise<T>;
  /** Existing canonical updateLinkedCalendarControl, bound to the captured owner/agent. */
  pause?(request: GoogleDisconnectPauseRequest, signal: AbortSignal): Promise<LifeOpsLinkedCalendarControl>;
  /** Existing source-specific callback retirement only. This is NOT provider drain. */
  retireCallbacks?(connectionId: string): Promise<void>;
}
const leaseFields: readonly (keyof GoogleDisconnectLease)[] =
  ['origin', 'ownerId', 'agentId', 'sessionId', 'credentialBinding', 'sourceGeneration'];
/** A verified Google connection UUID: the only ids a Calendar-aware disconnect accepts. */
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const scoped = /^alpha-google:[a-f0-9]{64}$/;
const aborted = () => new DOMException('The Google disconnect owner or source changed.', 'AbortError');
function sameLease(a: GoogleDisconnectLease, b: GoogleDisconnectLease): boolean {
  return leaseFields.every(key => typeof a[key] === 'string' && a[key].length > 0 && a[key] === b[key]);
}
function destinationKey(control: LifeOpsLinkedCalendarControl): string {
  return JSON.stringify([control.revision, control.destination?.connectorAccountId,
    control.destination?.providerCalendarId]);
}
function matchedSource(review: GoogleDisconnectReview, connectionId: string): GoogleDisconnectCalendarSource | null {
  const target = review.control?.destination;
  if (!target) return null;
  const rows = review.sources.filter(row => row.connectorAccountId === target.connectorAccountId &&
    row.calendarId === target.providerCalendarId);
  if (rows.length !== 1) return null;
  const row = rows[0];
  return row.provider === 'google' && row.side === 'owner' && scoped.test(row.connectorAccountId) &&
    row.grantId === row.connectorAccountId && Number.isSafeInteger(row.selectionVersion) &&
    row.selectionVersion >= 0 && row.managedGoogleConnectionId === connectionId ? row : null;
}
/** Finite cleanup observation: confirmed only by a valid result within the budget, otherwise unknown. */
function observe<T>(work: Promise<T>, milliseconds: number, validate: (value: T) => boolean,
  expired?: () => void): Promise<'confirmed' | 'unknown'> {
  return new Promise(resolve => {
    let done = false;
    const settle = (status: 'confirmed' | 'unknown') => {
      if (done) return;
      done = true; clearTimeout(timer); resolve(status);
    };
    const timer = setTimeout(() => { try { expired?.(); } finally { settle('unknown'); } }, milliseconds);
    // Both branches handle late settlement; no replay or late result publication.
    void work.then(value => {
      try { settle(validate(value) ? 'confirmed' : 'unknown'); } catch { settle('unknown'); }
    }, () => settle('unknown'));
  });
}

/** Cost: at most one local control pause, one ordinary privacy helper invocation,
 * and one callback retirement. No event/link/provider writes, retries or storage. */
export async function disconnectGoogleWithCalendar<T>(input: {
  review: GoogleDisconnectReview;
  connectionId: string;
  pauseKey: string;
  signal: AbortSignal;
  ports: GoogleDisconnectPorts<T>;
  pauseObservationMs?: number;
  retirementObservationMs?: number;
}): Promise<{ privacy: T; calendarPause: DisconnectCleanupStatus; callbackRetirement: DisconnectCleanupStatus;
  providerDrain: 'unavailable'; pauseRequest: GoogleDisconnectPauseRequest | null }> {
  const { ports, connectionId, signal } = input;
  signal.throwIfAborted();
  if (!uuid.test(connectionId)) throw new TypeError('Choose a verified Google connection UUID.');
  // Snapshot only public authority metadata; never retain a mutable review as a lease.
  const lease = { ...input.review.lease };
  const control = input.review.control ? { ...input.review.control,
    destination: input.review.control.destination ? { ...input.review.control.destination } : null,
    pendingDispatch: input.review.control.pendingDispatch ? { ...input.review.control.pendingDispatch } : null } : null;
  const review = { lease, control, sources: input.review.sources.map(source => ({ ...source })) };
  const current = () => {
    signal.throwIfAborted();
    const live = ports.current();
    if (!live || !sameLease(lease, live.lease)) throw aborted();
    return live;
  };
  const privacyCurrent = () => {
    signal.throwIfAborted();
    if (ports.privacyCurrent) ports.privacyCurrent(); else current();
  };
  privacyCurrent();
  const pauseMs = input.pauseObservationMs ?? 3000, retireMs = input.retirementObservationMs ?? 1000;
  if (!Number.isSafeInteger(pauseMs) || pauseMs < 1 || pauseMs > 3000 ||
      !Number.isSafeInteger(retireMs) || retireMs < 1 || retireMs > 1000)
    throw new TypeError('Cleanup observation budgets exceed the reviewed bounds.');
  const target = matchedSource(review, connectionId);
  let pauseRequest: GoogleDisconnectPauseRequest | null = null;
  let pause: Promise<DisconnectCleanupStatus> = Promise.resolve('unavailable');
  let retirement: Promise<DisconnectCleanupStatus> = Promise.resolve('unavailable');
  const pauseController = new AbortController();
  const cancelPause = () => pauseController.abort(signal.reason);
  signal.addEventListener('abort', cancelPause, { once: true });
  try {
    if (ports.retireCallbacks) {
      try {
        privacyCurrent();
        retirement = observe(Promise.resolve(ports.retireCallbacks(connectionId)), retireMs, () => true);
      } catch { retirement = Promise.resolve('unknown'); }
    }
    // Unmapped or unrelated destinations never cause a global or guessed pause.
    if (!control?.destination) pause = Promise.resolve('not-applicable');
    else if (target && ports.pause) {
      // Calendar cleanup is optional: its owner/source loss cannot veto Cloud revoke.
      let live: GoogleDisconnectReview | null = null;
      try { live = current(); } catch { /* stale cleanup remains unavailable */ }
      const liveSource = live ? matchedSource(live, connectionId) : null;
      if (live?.control && Number.isSafeInteger(control.revision) && control.revision >= 0 &&
          input.pauseKey.trim() && input.pauseKey.length <= 512 &&
          destinationKey(live.control) === destinationKey(control) && liveSource &&
          liveSource.selectionVersion === target.selectionVersion) {
        const request: GoogleDisconnectPauseRequest = { operation: 'pause',
          expectedRevision: control.revision, idempotencyKey: input.pauseKey };
        pauseRequest = { ...request };
        try {
          current();
          pause = observe(Promise.resolve(ports.pause(request, pauseController.signal)), pauseMs, result => {
            current(); // Late Calendar results never confirm a retired generation.
            return Number.isSafeInteger(result.revision) && result.revision === control.revision + 1 &&
            result.paused === true && JSON.stringify(result.destination) === JSON.stringify(control.destination) &&
            JSON.stringify(result.pendingDispatch) === JSON.stringify(control.pendingDispatch);
          },
          () => pauseController.abort(new DOMException('Pause outcome is unknown.', 'TimeoutError')));
        } catch { pause = Promise.resolve('unknown'); }
      }
    }
    // Never await local cleanup before starting ordinary privacy revocation.
    privacyCurrent();
    const privacy = await ports.revoke(connectionId, signal);
    let [calendarPause, callbackRetirement] = await Promise.all([pause, retirement]);
    privacyCurrent(); // Only Cloud privacy authority may suppress its completed result.
    if (ports.privacyCurrent && calendarPause === 'confirmed') {
      try { current(); } catch { calendarPause = 'unknown'; }
    }
    return { privacy, calendarPause, callbackRetirement, providerDrain: 'unavailable', pauseRequest };
  } finally {
    signal.removeEventListener('abort', cancelPause);
    // Observers own finite timers/late rejection handlers; no unbounded finally wait.
  }
}

export type GoogleAccountsCalendarReview = Omit<GoogleDisconnectReview, 'sources'> & {
  sources: readonly LifeOpsCalendarSummary[];
};

export interface GoogleDisconnectContext {
  readonly connectionId: string;
  readonly pauseKey: string;
  readonly review: GoogleDisconnectReview;
  readonly status: 'unknown';
}
/** Supplied by the active canonical Calendar owner, never a second Calendar store.
 * review/current use official decoded Summary data and the existing owner/session/source generation.
 * pause is the existing canonical updateLinkedCalendarControl, not link-level disconnect. */
export interface GoogleAccountsCalendarLifecycle {
  capture(): GoogleAccountsCalendarReview | null;
  current(): GoogleAccountsCalendarReview | null;
  pause(request: GoogleDisconnectPauseRequest, signal: AbortSignal): Promise<LifeOpsLinkedCalendarControl>;
  /** Caller retains the operation key/context before dispatch, including privacy throw/abort paths. */
  retain(context: GoogleDisconnectContext): void;
}
/** A Google grant can authorize Gmail and Calendar together. Never call this account deletion. */
export const GOOGLE_ACCOUNTS_CHANGED = 'alpha:google-accounts-changed';

export interface GoogleAccountsClient {
  initiateGoogle(signal: AbortSignal, calendarPermission?: 'read' | 'write', gmailPermission?: 'read' | 'modify' | 'send' | 'drafts' | 'mailbox'): Promise<string>;
  initiateGoogleWithReturn?(signal:AbortSignal,redirectUrl:string,calendarPermission?:'read'|'write',gmailPermission?:'read'|'modify'|'send'|'drafts'|'mailbox'):Promise<{authUrl:string;appReturn:boolean}>;
  gmailAccounts(signal: AbortSignal): Promise<GmailAccount[]>;
  disconnectGmail(connectionId: string, signal: AbortSignal): Promise<void>;
}
export interface GoogleAccountsBinding {
  client: GoogleAccountsClient;
  sessionId: string;
  credentialId: string;
}

export function notifyGoogleAccountsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(GOOGLE_ACCOUNTS_CHANGED));
}

export function googleDisconnectConfirmation(label: string, serviceName = 'Cloud'): string {
  return `Disconnect ${label} from Alpha Phone?\n\nThis removes ${serviceName}'s stored Google connection, including Gmail and Calendar access granted through it. Your Google account, mail and calendar events are not deleted. Local drafts stay in this app until you discard them.`;
}

export function googleDisconnectMessage(outcome: GmailDisconnectOutcome, label: string, serviceName = 'Cloud'): string {
  if (outcome === 'disconnected') return `${label} is disconnected from Alpha. ${serviceName} no longer holds this Google connection's Gmail or Calendar access. Your Google account, mail and events were not deleted; local drafts stay in this app. Google may still list the app in your Google Account permissions.`;
  if (outcome === 'still-connected') return `Disconnect was requested, but Google still reports ${label} as connected to Alpha. Check the connection again.`;
  return `Disconnect of ${label} was not confirmed. Check the connection before trying again.`;
}

/** One captured Cloud session owns every request and result. Recreate after an account change. */
export function createGoogleAccounts(
  binding: GoogleAccountsBinding,
  current: () => GoogleAccountsBinding | null,
  changed: () => void = notifyGoogleAccountsChanged,
  calendar?: GoogleAccountsCalendarLifecycle,
) {
  const {client, sessionId, credentialId} = binding;
  const check = (signal: AbortSignal) => {
    signal.throwIfAborted();
    const live = current();
    if (!live || live.client !== client || live.sessionId !== sessionId || live.credentialId !== credentialId) {
      throw new DOMException('The Cloud account changed. Check Google connections again.', 'AbortError');
    }
  };
  return {
    async list(signal: AbortSignal): Promise<GmailAccount[]> {
      check(signal);
      const accounts = await client.gmailAccounts(signal);
      check(signal);
      return accounts;
    },
    /** Returns the authorization URL only; authorization completion must be checked with list. */
    async connect(signal: AbortSignal, calendarPermission: 'read' | 'write' = 'read', gmailPermission: 'read' | 'modify' | 'send' | 'drafts' | 'mailbox' = 'read'): Promise<string> {
      check(signal);
      const url = await client.initiateGoogle(signal, calendarPermission, gmailPermission);
      check(signal);
      return url;
    },
    async connectWithReturn(signal:AbortSignal,redirectUrl:string,calendarPermission:'read'|'write'='read',gmailPermission:'read'|'modify'|'send'|'drafts'|'mailbox'='read') {
      check(signal);
      const result=client.initiateGoogleWithReturn?await client.initiateGoogleWithReturn(signal,redirectUrl,calendarPermission,gmailPermission):{authUrl:await client.initiateGoogle(signal,calendarPermission,gmailPermission),appReturn:false};
      check(signal);return result;
    },
    /** Caller owns confirmation. Reuse Gmail's one-request, read-back-verified grant revocation. */
    async disconnect(connectionId: string, signal: AbortSignal) {
      check(signal);
      if (!connectionId.trim()) throw new TypeError('Choose a Google connection to disconnect.');
      // Start retiring native callbacks/notices first, but never let local bookkeeping
      // delay or block the privacy-relevant remote revoke on this captured binding.
      const ordinaryRevoke = (id: string, requestSignal: AbortSignal) => disconnectGmailAccount({
          async disconnectGmail(id, requestSignal) {
            check(requestSignal);
            await client.disconnectGmail(id, requestSignal);
            check(requestSignal);
          },
          async gmailAccounts(requestSignal) {
            check(requestSignal);
            const accounts = await client.gmailAccounts(requestSignal);
            check(requestSignal);
            return accounts;
          },
        }, id, requestSignal);
      // Feature detection: old/missing mapping never blocks privacy or means disconnected.
      let captured: GoogleDisconnectReview | null = null;
      let context: GoogleDisconnectContext | null = null;
      let operationReview: GoogleDisconnectReview | null = null;
      let operationKey: string | null = null;
      try {
        captured = calendar?.capture() ?? null;
        if (captured && uuid.test(connectionId)) {
          operationKey = crypto.randomUUID();
          operationReview = structuredClone(captured);
          context = Object.freeze({ connectionId, pauseKey: operationKey,
            review: structuredClone(operationReview), status: 'unknown' as const });
          calendar!.retain(context); // Failure means no pause: ordinary privacy still works.
        }
      } catch { captured = null; context = null; }
      let cleanup: { calendarPause: DisconnectCleanupStatus; callbackRetirement: DisconnectCleanupStatus;
        providerDrain: 'unavailable'; pauseRequest: GoogleDisconnectPauseRequest | null };
      let result: Awaited<ReturnType<typeof disconnectGmailAccount>>;
      if (captured && context && calendar) {
        const canonical = calendar;
        const settled = await disconnectGoogleWithCalendar({ review: operationReview!, connectionId,
          pauseKey: operationKey!, signal, ports: {
            privacyCurrent: () => check(signal),
            current: () => { check(signal); return canonical.current(); },
            pause: (request, pauseSignal) => { check(signal); return canonical.pause(request, pauseSignal); },
            retireCallbacks: id => { check(signal); return retireGmailBackground(id).settled(); },
            revoke: ordinaryRevoke,
          } });
        result = settled.privacy;
        cleanup = settled;
      } else {
        // Existing non-UUID/old-source connections remain revocable under their original grammar.
        let retirement: Promise<DisconnectCleanupStatus>;
        try { retirement = observe(retireGmailBackground(connectionId).settled(), 1000, () => true); }
        catch { retirement = Promise.resolve('unknown'); }
        result = await ordinaryRevoke(connectionId, signal);
        cleanup = { calendarPause: 'unavailable', callbackRetirement: await retirement,
          providerDrain: 'unavailable', pauseRequest: null };
      }
        check(signal);
        // Even an uncertain mutation needs a fresh account read on the other surfaces.
        changed();
        return { ...result, calendarLifecycle: { calendarPause: cleanup.calendarPause,
          callbackRetirement: cleanup.callbackRetirement, providerDrain: cleanup.providerDrain,
          pauseRequest: cleanup.pauseRequest } };
    },
  };
}

/** needs-grant: no verified Calendar write grant, so nothing was read or changed. Only synced and syncing are read back.
 * review: the last sync readback with no control write sent after it, kept for the Calendar disconnect lifecycle. */
export type GoogleCalendarLink={outcome:'synced'|'syncing'|'needs-grant'|'not-linked'|'unconfirmed';message:string;review?:AgentCalendarSyncReview};
/** Same reviewed transition, same key: a retry replays its receipt; a newer revision is a new operation. */
async function linkOperationKey(...parts:unknown[]){
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(parts))));
 return 'alpha-calendar-connect:'+Array.from(digest,n=>n.toString(16).padStart(2,'0')).join('');
}
/** A foreground refresh or another Calendar write holds the control; wait for it instead of failing the link. */
function calendarSettled(calendar:AgentCalendar,signal:AbortSignal){
 return new Promise<void>((resolve,reject)=>{
  const check=()=>{if(signal.aborted)done(()=>reject(signal.reason));else if(calendar.state.status!=='loading'&&!calendar.state.mutating)done(resolve);};
  const unsubscribe=calendar.subscribe(check),done=(then:()=>void)=>{unsubscribe();signal.removeEventListener('abort',check);then();};
  signal.addEventListener('abort',check);check();
 });
}
/** One Calendar: after Google's grant readback, link the same Eliza Calendar to the owner's unique primary Google
 * calendar through the existing select/resume control (expected revisions, pending dispatch kept for review).
 * Two-way sync, link dedupe and the all-eligible bootstrap on resume stay in the shared Calendar service. */
export async function linkGoogleCalendar(scope:CanonicalCalendarSyncSettings,accounts:readonly GmailAccount[],signal:AbortSignal):Promise<GoogleCalendarLink>{
 const granted=accounts.filter(account=>account.connected&&account.grantedCapabilities.includes('google.calendar.write'));
 if(!granted.length)return{outcome:'needs-grant',message:accounts.some(account=>account.connected&&account.grantedCapabilities.includes('google.calendar.read'))?'Google Calendar access is read only, so Calendar is not synced. Approve Calendar changes for Google to sync; Calendar keeps working on this phone.':'Google Calendar is not connected. Calendar keeps working on this phone.'};
 const emails=new Set(granted.map(account=>account.label.toLowerCase()));
 const fence=()=>!signal.aborted&&scope.current()&&scope.canChange();
 const ready=async()=>{await calendarSettled(scope.calendar,signal);return fence();};
 // sent: a control write was dispatched, so any later failure is unconfirmed. revision: our last committed transition.
 // latest: the last readback with no write sent after it.
 let sent=false,revision:number|undefined,latest:AgentCalendarSyncReview|undefined;
 const result=(outcome:GoogleCalendarLink['outcome'],message:string):GoogleCalendarLink=>latest?{outcome,message,review:latest}:{outcome,message};
 const stopped=()=>result('not-linked',signal.aborted||!scope.current()?'Calendar sync was not finished. Calendar keeps working on this phone.':'Finish or close the Calendar draft, then connect Google Calendar again.');
 const unconfirmed=(reason='')=>result('unconfirmed',`${reason}Calendar sync was not confirmed; check it before another change.`);
 try{
  // Review, select the primary, review, resume, review: Synced is the last readback, never the last request.
  for(let step=0;step<3;step++){
   if(!await ready())return stopped();
   if(!['ready','partial','unavailable'].includes(scope.calendar.state.status))return sent?unconfirmed():result('not-linked','Waiting for Calendar. Nothing was sent; connect Google Calendar again when Calendar is ready.');
   const review=latest=await scope.calendar.reviewSync(),control=review.control,owner=scope.calendar.state.ownerKey;
   if(revision!==undefined&&control.revision!==revision)return result('not-linked','Calendar sync changed elsewhere. Review Calendar sync; saved events are unchanged.');
   const saved=control.destination&&review.sources.find(source=>source.connectorAccountId===control.destination?.connectorAccountId&&source.calendarId===control.destination.providerCalendarId);
   if(control.destination&&!saved)return result('not-linked','The saved Google sync calendar is unavailable. Review Calendar sync; saved events are unchanged.');
   // Only an approved (and, when Google named one, the returned) account may be reported Synced or resumed.
   if(saved&&!emails.has(saved.accountEmail?.toLowerCase()??''))return result('not-linked','The saved Google sync calendar is not on the Google account approved for Calendar changes. Review Calendar sync; saved events are unchanged.');
   // Active with a background dispatch (the push resume starts) is on, not Synced: it has no checkpoint to read back.
   if(saved&&!control.paused)return control.pendingDispatch?result('syncing',`Sync on. Calendar is syncing with ${saved.summary} in Google.`):result('synced',`Calendar syncs with ${saved.summary} in Google.`);
   if(control.pendingDispatch)return result('not-linked','A prior Calendar sync operation needs review in Calendar sync before Google can sync.');
   if(step===2)break; // The last step only reads back.
   const primary=review.sources.filter(source=>source.primary===true&&emails.has(source.accountEmail?.toLowerCase()??''));
   if(!saved&&primary.length!==1)return result('not-linked','Choose the Google calendar to sync in Calendar sync. Calendar keeps working on this phone.');
   // A reviewed destination keeps its mappings: resume it rather than replace it with the primary.
   const operation=saved?'resume':'select',target=saved||primary[0];
   const key=await linkOperationKey(owner,operation,control.revision,target.connectorAccountId,target.calendarId);
   if(!await ready())return stopped();
   // Sent only once changeSync's own fence, owner and destination checks pass, right before its control write.
   revision=(await scope.calendar.changeSync(review,operation,key,fence,saved?undefined:calendarSourceKey(target),()=>{sent=true;latest=undefined;})).revision;
  }
 }catch(error){
  const reason=(error instanceof Error?error.message:'').replace(/\.$/,'');
  return sent?unconfirmed(`${reason||'Calendar sync could not be verified'}. `):!fence()?stopped():result('not-linked',`${reason||'Calendar sync could not be reviewed'}. Calendar sync was not finished; nothing was sent. Calendar keeps working on this phone.`);
 }
 return unconfirmed();
}
/** createGoogleAccounts' fourth argument when the Google panel was opened from Calendar. capture and current are synchronous
 * snapshots of that Calendar's last captured sync review: no network and no second store. current keeps the lease only while
 * the same owner's Calendar scope is current, with the sources that Calendar already holds; changeSync re-verifies owner,
 * session and scope before the pause write. pause is the canonical changeSync pause, never a link-level pause. retain records
 * the operation key and UNKNOWN context, which the callsite does before any pause or revoke. */
export function googleCalendarDisconnectLifecycle(scope:CanonicalCalendarSyncSettings,captured:()=>AgentCalendarSyncReview|undefined,credentialBinding:()=>string|null,retained:Map<string,GoogleDisconnectContext>):GoogleAccountsCalendarLifecycle{
 const snapshot=(live:boolean):GoogleAccountsCalendarReview|null=>{
  const review=captured(),cloud=credentialBinding();
  if(!review||!cloud||!scope.current())return null;
  const [ownerKey,sessionId]=JSON.parse(review.binding) as [string,string];
  if(scope.calendar.state.ownerKey!==ownerKey)return null;
  const [origin,ownerId,agentId]=JSON.parse(ownerKey) as [string,string,string];
  return structuredClone({lease:{origin,ownerId,agentId,sessionId,credentialBinding:cloud,sourceGeneration:review.binding},control:review.control,sources:live?scope.calendar.state.calendars:review.sources});
 };
 return {
  capture:()=>snapshot(false),current:()=>snapshot(true),
  retain(context){retained.set(context.pauseKey,context);},
  async pause(request,signal){
   signal.throwIfAborted();const review=captured();
   if(!review||request.operation!=='pause'||request.expectedRevision!==review.control.revision)throw Error('Calendar sync changed; review Calendar sync');
   return scope.calendar.changeSync(review,'pause',request.idempotencyKey,()=>!signal.aborted&&scope.current());
  },
 };
}
