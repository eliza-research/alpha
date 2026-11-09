import {productionCloud, stagingCloud} from './cloud-deployment.generated.ts';
import {browserCloudResidentEnabled,browserCloudResidentEnvironment} from './browser-cloud-resident.ts';
import {calendarSyncHttp,type CalendarSyncRequest} from './calendar-linked-provider.ts';
import type {AutomationsMethod} from './automations-route-policy.ts';
import { reviewMailAttachment, type MailAttachment } from './inbox-attachment.ts';
import { reviewOpaqueAttachment, type OpaqueMailAttachment } from './inbox-operation.ts';
import { gmailCapabilitiesFor } from './gmail-grants.ts';
import type { CloudMapsRoute } from '../maps/cloud-provider.ts';
import { authenticated as signInAuthenticated, googleOutcome, type CloudSignInGoogleOutcome, CloudSignInError, emailStarted, verified as signInVerified, type CloudSignInAuthenticated, type CloudSignInEmailStarted, type CloudSignInMfaRequired, type CloudSignInPort } from './cloud-sign-in.ts';
import { BILLING_LIMITS_PATH, ENTITLEMENT_KEYS_PATH, ENTITLEMENT_PATH, REDEEM_PATH, fallbackPlanFromLimits, normalizeSubscriptionCode, readServiceLimit, SubscriptionRedeemError, type EntitlementSource, type FallbackPlan, type RedeemResult } from './subscription-entitlement.ts';
/** Narrow Alpha adapter for Eliza Cloud managed services: sign-in, identity, subscription plan and
 * the connected Google services. Sign-in is in-app (cloud-sign-in.ts) once the native host reports
 * Cloud ready for this phone: the host signs in with Steward and mints an `eliza_mobile_` key through
 * Cloud's mobile App Auth routes, so no Eliza Cloud web page is opened. Until then `login()` keeps the
 * Cloud sign-in hand-off (v3's cloud/api/auth/cli-session) as the product path. Contracts inspected
 * in cloud/api/v1/app-auth, cloud/api/auth/cli-session, cloud/api/v1/eliza/google and
 * ui/src/api/client-cloud.ts. Native composition owns HTTP and secure storage. This module never
 * stores credentials in renderer persistence or logs them.
 * The agent always runs on the phone: this adapter has no hosted-agent discovery, runtime or
 * pairing route. The development-only hosted-agent fixture extends it in
 * development-cloud-agents.ts and is constructed only in ELIZA_DEV_ALLOW_TEST_MOCKS=1 builds. */
export type CloudEnvironment = "production" | "staging";
export type CloudAuthority = { readonly name: string; readonly api: string; readonly web: string; readonly agents: string; readonly entitlementAudience: string };
// Staging is admitted in test mocks or the explicitly selected real browser Cloud QA host. QA builds reach
// api-staging.eliza.app, its issuer and its web origins (docs/cloud-subscription-qa.md).
// Vite replaces import.meta.env at build time, so flag-off bundles fold the staging
// authority away. Node contract tests import this source without Vite and keep both.
const stagingAvailable: boolean = import.meta.env === undefined || import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS === '1' || (browserCloudResidentEnabled && browserCloudResidentEnvironment === 'staging');
const authorities: Partial<Record<CloudEnvironment, CloudAuthority>> = {
  production: productionCloud,
  ...(stagingAvailable ? { staging: stagingCloud } : {}),
};
/** Display names follow the same build gate as request authorities. */
export function cloudServiceName(environment: CloudEnvironment): string { return authorities[environment]?.name ?? 'Cloud service'; }
/** Whether this build can address the environment. Production builds expose only production. */
export function cloudEnvironmentAvailable(environment: CloudEnvironment): boolean { return authorities[environment] !== undefined; }
/** The one hosted plan page an environment opens in the system browser. Nothing else is opened for billing. */
export function planManagementUrl(environment: CloudEnvironment): string {
  const authority = authorities[environment];
  if (!authority) throw new Error("This Cloud environment is unavailable in this build.");
  return `https://${authority.agents}/cloud/billing`;
}
export interface CloudCredential {
  /** Local generation identifier, never an authentication credential. */
  credentialId?: string;
  token?: string;
  /** Development host reference; it is never a Cloud bearer credential. */
  credentialReference?: string;
  expiresAt?: number;
  userId?: string;
  organizationId?: string;
  /** Cloud's id for an in-app sign-in key (mobile App Auth credentialId). Not a secret. */
  serverCredentialId?: string;
}
function sameCloudCredential(a: CloudCredential | null, b: CloudCredential | null): boolean {
  return a === null || b === null ? a === b : a.credentialId === b.credentialId && a.token === b.token && a.credentialReference === b.credentialReference;
}
export interface CloudCredentialStore {
  acceptsReferences?: boolean;
  read(environment: CloudEnvironment): Promise<CloudCredential | null>;
  /** Must atomically reject an aborted signal before committing to native secure storage. */
  write(environment: CloudEnvironment, credential: CloudCredential, signal: AbortSignal): Promise<void>;
  clear(environment: CloudEnvironment): Promise<void>;
  /** Optional browser-host capability: atomically remove only the captured reference generation. */
  clearIfCurrent?(environment: CloudEnvironment, expected: CloudCredential | null): Promise<void>;
}
/** The native adapter must enforce the timeout and AbortSignal, reject redirects,
 * and return decoded JSON. It must never log headers, bodies, or auth URLs. */
export interface CloudNativeRequest {
  (input: { url: string; method: AutomationsMethod | 'PATCH'; headers: Record<string, string>;
    body?: unknown; credentialReference?: string; signal: AbortSignal; timeoutMs: number; redirect: "error"; expiresAt?: number;
  }): Promise<{ status: number; data: unknown; /** Raw Retry-After header of an error response, when present. */ retryAfter?: string }>;
}
/** Optional transport capabilities. The native transport admits only GET and POST today, so
 * credential self-revocation (DELETE) is reported unsupported unless the host opts in. */
export interface CloudProtocolOptions { deleteRequests?: boolean;
  /** In-app sign-in host. Absent where this build has no sign-in (the production web build). */
  signIn?: CloudSignInPort }
/** Server-side revocation of the CLI-issued credential. `supported:false` means nothing was sent
 * or the deployed Cloud has no self-revocation route; the local credential is cleared either way. */
export type CloudSessionRevocation =
  | { supported: true; revoked: true; credentialId: string | null; revokedAt: string | null }
  | { supported: false; reason: "transport" | "server" | "no-credential" };
export interface CloudLoginAttempt { sessionId: string; expiresAt: number; browserUrl: string }
/** What happened to a sign-in this login replaced: absent when none was saved. Only a confirmed
 * server-side revocation is `revoked`; anything else is reported as unconfirmed. */
export interface CloudLoginResult { previousSignIn?: "revoked" | "unconfirmed" }
export interface CloudAgent {
  id: string; name: string | null; status: string; executionTier: string | null;
  /** Only validated REST targets, never internal bridge URLs. Null until available. */
  runtimeUrl: string | null;
}
export interface GoogleConnection {
  configured: boolean; connected: boolean; reason: string;
  connectionId: string | null; grantedCapabilities: string[];
}
/** Managed Google Calendar wire data. Cloud enforces ownership of each grant. */
export interface GoogleCalendarSummary {
  calendarId:string; summary:string; description:string|null; primary:boolean; accessRole:string;
  backgroundColor:string|null; foregroundColor:string|null; timeZone:string|null; selected:boolean;
}
export interface GoogleCalendarEvent {
  externalId:string; calendarId:string; title:string; description:string; location:string; status:string;
  startAt:string; endAt:string; isAllDay:boolean; timezone:string|null; htmlLink:string|null; conferenceLink:string|null;
  organizer:Record<string,unknown>|null;
  attendees:Array<{email:string|null;displayName:string|null;responseStatus:string|null;self:boolean;organizer:boolean;optional:boolean}>;
  metadata:Record<string,unknown>;
}
/** Fields Alpha sends when creating a Google event. Instants are ISO strings with `Z` or an offset;
 * `timeZone` is the IANA zone Google stores. Guests are emails only; Google sends no invitations
 * for owner-side writes (Cloud has no `sendUpdates`). */
export interface GoogleCalendarEventInput {
  title:string; description?:string; location?:string; startAt:string; endAt:string; timeZone:string;
  attendees?:Array<{email:string;displayName?:string;optional?:boolean}>;
}
/** Fields of an update. Guests are deliberately absent: Cloud's PATCH replaces the whole guest list
 * without anyone's answer, which would reset every reply. `responseStatus` is the owner's own RSVP;
 * current Cloud drops it, so callers send it only behind a capability flag and check the result. */
export interface GoogleCalendarEventPatch {
  title?:string; description?:string; location?:string; startAt?:string; endAt?:string; timeZone?:string;
  responseStatus?:'accepted'|'declined'|'tentative';
}
/** Core exhausts provider pages before returning; no client cursor exists. */
export interface GoogleCalendarFeed { calendarId:string; events:GoogleCalendarEvent[]; syncedAt:string }
export interface GoogleCalendarRange { timeMin:string; timeMax:string; timeZone:string }
export interface GmailInboxCapabilities {
  version:1; from:string; threads:boolean; send:boolean; providerDrafts:boolean;
  mailboxMutations:boolean; attachments:boolean; providerExactlyOnce:false; atomicDraftReplacement:false;
  /** Reviewed mark-read/mark-unread operations. Older servers omit it: false. */
  readState:boolean;
  /** Provider draft listing and content reads. Absent: false. */
  draftsList:boolean;
  /** Forward with the source message's attachments bound to its historyId. Absent: false. */
  forwardAttachments:boolean;
  /** Gmail search can list Trash. Absent: false. */
  searchTrash:boolean;
  /** Opaque byte-copy download of any attachment type under the cap. Absent: false. */
  opaqueAttachments:boolean;
  /** Outgoing attachment policy. Older servers publish maximumOutgoing 1 or omit the policy. */
  attachmentPolicy:{maximumOutgoing:number;maximumBytes:number;maximumTotalBytes:number};
}
/** A provider-extracted link: inert data, never fetched or rendered as HTML. */
export interface GmailLink { href: string; text: string }
export interface GmailDraftSummary { draftId: string; messageId: string; subject: string; to: string[]; snippet: string; updatedAt: string | null }
export interface GmailDraftContent { draftId: string; messageId: string; providerDigest: string; to: string[]; cc: string[]; bcc: string[]; subject: string; bodyText: string; threaded: boolean; attachmentCount: number;
  /** False for an HTML-only draft, whose formatting a plain-text edit would discard. */
  plainText: boolean }
export interface GmailInboxReceipt {
  requestId:string; kind:'send'|'draft-create'|'draft-replace'|'draft-delete'|'archive'|'unarchive'|'trash'|'untrash'|'mark-read'|'mark-unread';
  reviewDigest:string; state:'prepared'|'dispatched'|'succeeded'|'rejected'|'outcome-unknown';
  providerResult:Record<string,unknown>|null; rejectionCode:string|null;
}
export interface GmailAccount extends GoogleConnection { label: string }
export interface GmailMessage {
  id: string; threadId: string; subject: string; from: string; fromEmail: string | null;
  to: string[]; cc?: string[]; replyTo?: string | null; snippet: string; receivedAt: string; unread: boolean;
  /** Search hint from a multipart/mixed container; absent on older servers. */
  hasAttachments?: boolean;
}
/** Only absolute http(s) links without credentials are kept; anything else is dropped as untrusted. */
export function safeMailLink(value: unknown): GmailLink | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.href !== "string" || row.href.length > 2048 || typeof row.text !== "string") return null;
  let url: URL;
  try { url = new URL(row.href); } catch { return null; }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || !url.hostname) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip control characters from untrusted labels.
  const text = row.text.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return { href: url.href, text: text || url.hostname };
}
function mailLinks(value: unknown): GmailLink[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200) throw new CloudProtocolError("invalid-response");
  const seen = new Set<string>(), links: GmailLink[] = [];
  for (const row of value) { const link = safeMailLink(row); if (link && !seen.has(link.href)) { seen.add(link.href); links.push(link); } }
  return links.slice(0, 50);
}
/** The complete optional display body; oversized HTML keeps the plain alternative. */
function mailHtml(value: unknown): {bodyHtml?: string} {
  if (value !== undefined && value !== null && typeof value !== 'string') throw new CloudProtocolError('invalid-response');
  return typeof value === 'string' && value && new TextEncoder().encode(value).length <= 512 * 1024
    ? {bodyHtml: value} : {};
}
export class CloudProtocolError extends Error {
  constructor(readonly code: "invalid-response" | "http" | "expired" | "credentials-missing" | "credential-consumed" | "login-active" | "account-changed", readonly status?: number, readonly data?: unknown, readonly retryAfter?: string) {
    super(`Cloud ${code}${status ? ` (${status})` : ""}`);
    this.name = "CloudProtocolError";
  }
}
export type ObjectValue = Record<string, unknown>;
export function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CloudProtocolError("invalid-response");
  return value as ObjectValue;
}
export function string(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new CloudProtocolError("invalid-response");
  return value;
}
export function optionalString(value: unknown): string | null { return value == null ? null : string(value); }
export function uuid(value: unknown): string {
  const id = string(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new CloudProtocolError("invalid-response");
  return id;
}
export function timestamp(value: unknown): number {
  const parsed = Date.parse(string(value));
  if (!Number.isFinite(parsed)) throw new CloudProtocolError("invalid-response");
  return parsed;
}
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** Event ids that may travel in a path. The route allow-lists refuse `%`, so ids that would need
 * encoding stay read-only. */
export const GOOGLE_CALENDAR_EVENT_ID=/^[A-Za-z0-9_]{1,1024}$/;
function googleCalendarEventId(value:string):string {
  if(typeof value!=='string'||!GOOGLE_CALENDAR_EVENT_ID.test(value))throw new TypeError('Calendar event cannot be changed');
  return value;
}
function isoInstant(value:unknown,field:string):string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw new TypeError(`Invalid Calendar ${field}`);
  return value;
}
function ianaZone(value:unknown):string {
  if(typeof value!=='string'||!value.trim())throw new TypeError('Invalid Calendar time zone');
  try{new Intl.DateTimeFormat('en-US',{timeZone:value}).format();}catch{throw new TypeError('Invalid Calendar time zone');}
  return value;
}
/** Validates write fields and returns only those to send. `create` requires title, both instants and the zone. */
function googleCalendarWriteFields(input:GoogleCalendarEventInput|GoogleCalendarEventPatch,create:boolean):Record<string,unknown> {
  const out:Record<string,unknown>={};
  if(!input||typeof input!=='object')throw new TypeError('Invalid Calendar change');
  if(create||input.title!==undefined){
    const title=typeof input.title==='string'?input.title.trim():'';
    if(!title||title.length>1024)throw new TypeError('Calendar event needs a title');
    out.title=title;
  }
  for(const key of ['description','location'] as const){
    const value=input[key];
    if(value===undefined)continue;
    if(typeof value!=='string'||value.length>8192)throw new TypeError(`Invalid Calendar ${key}`);
    out[key]=value;
  }
  if(create||input.startAt!==undefined)out.startAt=isoInstant(input.startAt,'start');
  if(create||input.endAt!==undefined)out.endAt=isoInstant(input.endAt,'end');
  if(create||input.timeZone!==undefined)out.timeZone=ianaZone(input.timeZone);
  if(typeof out.startAt==='string'&&typeof out.endAt==='string'&&Date.parse(out.endAt)<Date.parse(out.startAt))throw new TypeError('Calendar event must end after it starts');
  if(create&&'attendees' in input&&input.attendees!==undefined){
    if(!Array.isArray(input.attendees)||input.attendees.length>100)throw new TypeError('Invalid Calendar guests');
    out.attendees=input.attendees.map(guest=>{
      if(!guest||typeof guest.email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email.trim()))throw new TypeError('Invalid Calendar guest');
      return {email:guest.email.trim(),...(typeof guest.displayName==='string'&&guest.displayName.trim()?{displayName:guest.displayName.trim()}:{}),...(guest.optional===true?{optional:true}:{})};
    });
  }
  if(!create&&'responseStatus' in input&&input.responseStatus!==undefined){
    if(!['accepted','declined','tentative'].includes(input.responseStatus))throw new TypeError('Invalid Calendar reply');
    out.responseStatus=input.responseStatus;
  }
  return out;
}
/** One Cloud Google Calendar event (feed rows and write responses share this shape). The event
 * must belong to `calendarId`; malformed rows are an invalid response. */
export function parseGoogleCalendarEvent(value:unknown,calendarId:string):GoogleCalendarEvent {
  const plain=(value:unknown)=>{if(typeof value!=='string')throw new CloudProtocolError('invalid-response');return value;};
  const flag=(value:unknown)=>{if(typeof value!=='boolean')throw new CloudProtocolError('invalid-response');return value;};
  const row=object(value),externalId=string(row.externalId);
  if(row.calendarId!==calendarId||!Array.isArray(row.attendees)||timestamp(row.endAt)<timestamp(row.startAt))throw new CloudProtocolError('invalid-response');
  return {externalId,calendarId,title:plain(row.title),description:plain(row.description),location:plain(row.location),status:string(row.status),startAt:string(row.startAt),endAt:string(row.endAt),isAllDay:flag(row.isAllDay),timezone:optionalString(row.timezone),htmlLink:optionalString(row.htmlLink),conferenceLink:optionalString(row.conferenceLink),organizer:row.organizer==null?null:object(row.organizer),metadata:object(row.metadata),attendees:row.attendees.map(value=>{const a=object(value);return {email:optionalString(a.email),displayName:optionalString(a.displayName),responseStatus:optionalString(a.responseStatus),self:flag(a.self),organizer:flag(a.organizer),optional:flag(a.optional)};})};
}
const GMAIL_CAPABILITIES: readonly string[] = ["google.basic_identity", "google.gmail.triage", "google.gmail.send", "google.gmail.drafts", "google.gmail.mailbox"];
export class CloudProtocol {
  protected activeLogin: AbortController | null = null;
  constructor(readonly environment: CloudEnvironment, private readonly request: CloudNativeRequest,
    protected readonly credentials: CloudCredentialStore,
    protected readonly openExternal: (url: string, signal: AbortSignal) => Promise<void>,
    private readonly options: CloudProtocolOptions = {}) {}
  protected get authority(): CloudAuthority {
    const authority = authorities[this.environment];
    if (!authority) throw new Error("This Cloud environment is unavailable in this build.");
    return authority;
  }
  protected async requestData(path: string, signal: AbortSignal, options: { credentialReference?: string; body?: unknown; method?: AutomationsMethod | 'PATCH'; authenticated?: boolean; runtimeBase?: string; timeoutMs?: number; headers?: Record<string,string>; credentialId?: string; expiresAt?: number; onStatus?: (status:number)=>void } = {}) {
    signal.throwIfAborted();
    let credentialReference: string | undefined;
    const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
    if (options.authenticated) {
      const credential = await this.credentials.read(this.environment);
      signal.throwIfAborted();
      if (!credential) throw new CloudProtocolError("credentials-missing");
      if (options.credentialId && credential.credentialId !== options.credentialId) throw new Error("Cloud account changed");
      if (options.credentialReference !== undefined && credential.credentialReference !== options.credentialReference) throw new Error("Cloud account changed");
      if (credential.expiresAt !== undefined && credential.expiresAt <= Date.now()) throw new CloudProtocolError("expired");
      if(credential.credentialReference){
        if(!this.credentials.acceptsReferences || credential.token)throw new CloudProtocolError("invalid-response");
        credentialReference=credential.credentialReference;
      }else if(credential.token)headers.Authorization = `Bearer ${credential.token}`;
      else throw new CloudProtocolError("credentials-missing");
    }
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await this.request({ url: (options.runtimeBase ?? this.authority.api) + path,
      method: options.method ?? (options.body === undefined ? "GET" : "POST"), headers, body: options.body,
      signal, credentialReference, timeoutMs: options.timeoutMs ?? 30_000, redirect: "error", ...(options.expiresAt === undefined ? {} : {expiresAt:options.expiresAt}) });
    signal.throwIfAborted();
    if (response.status < 200 || response.status >= 300) throw new CloudProtocolError("http", response.status, response.data, response.retryAfter);
    options.onStatus?.(response.status);
    return response.data;
  }
  protected async call(path: string, signal: AbortSignal, options: { body?: unknown; method?: AutomationsMethod | 'PATCH'; authenticated?: boolean; runtimeBase?: string; timeoutMs?: number; headers?: Record<string,string>; credentialId?: string; expiresAt?: number } = {}) {
    return object(await this.requestData(path, signal, options));
  }
  /** Plan state from the read-only billing snapshot, used only while the entitlement route is
   * absent. `null` when the snapshot route is absent too or does not report a known plan state. */
  async billingFallbackPlan(signal: AbortSignal): Promise<FallbackPlan | null> {
    signal.throwIfAborted();
    const credential = await this.credentials.read(this.environment);
    signal.throwIfAborted();
    if (!credential?.credentialId) throw new CloudProtocolError("credentials-missing");
    let data: ObjectValue;
    try { data = await this.call(BILLING_LIMITS_PATH, signal, { authenticated: true, credentialId: credential.credentialId }); }
    catch (error) {
      if (error instanceof CloudProtocolError && error.code === "http" && [404, 405, 501].includes(error.status ?? 0)) return null;
      throw error;
    }
    await this.assertSameCredential(credential.credentialId, signal);
    if (data.success !== true) return null;
    return fallbackPlanFromLimits(data);
  }
  /**
   * Redeems a subscription grant code for the signed-in account. `idempotencyKey` is fresh for
   * each owner submission; a transport failure (the request may have arrived) is retried once
   * with the same key, which Cloud answers with the original grant. HTTP refusals are never
   * retried. The code is never logged, stored or put in an error.
   */
  async redeemSubscriptionCode(code: string, idempotencyKey: string, signal: AbortSignal): Promise<RedeemResult> {
    signal.throwIfAborted();
    const normalized = normalizeSubscriptionCode(code);
    if (!normalized) throw new SubscriptionRedeemError("invalid");
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new TypeError("Invalid idempotency key");
    const credential = await this.credentials.read(this.environment);
    signal.throwIfAborted();
    if (!credential?.credentialId) throw new CloudProtocolError("credentials-missing");
    let data: ObjectValue | undefined;
    for (let attempt = 0; data === undefined; attempt++) {
      try { data = await this.call(REDEEM_PATH, signal, { authenticated: true, credentialId: credential.credentialId, body: { code: normalized, idempotencyKey } }); }
      catch (error) {
        signal.throwIfAborted();
        if (error instanceof CloudProtocolError) {
          if (error.code !== "http") throw error;
          const status = error.status ?? 0, body = error.data && typeof error.data === "object" ? error.data as ObjectValue : {};
          if (status === 401) throw error;
          if (status === 400) throw new SubscriptionRedeemError("invalid");
          if (status === 409) throw new SubscriptionRedeemError(body.code === "subscription_grant_already_redeemed" ? "already-redeemed" : "invalid");
          if (status === 429) throw new SubscriptionRedeemError("rate-limited", readServiceLimit({ status, data: error.data, retryAfter: error.retryAfter })?.retryAfterMs ?? null);
          if (status === 403) throw new SubscriptionRedeemError("account");
          throw new SubscriptionRedeemError("unavailable");
        }
        if (error instanceof Error && error.message === "Cloud account changed") throw error;
        // Transport failure: the request may have reached Cloud. One replay with the same key.
        if (attempt >= 1) throw new SubscriptionRedeemError("unavailable");
        await delay(1000, signal);
      }
    }
    await this.assertSameCredential(credential.credentialId, signal);
    const grant = data.grant && typeof data.grant === "object" && !Array.isArray(data.grant) ? data.grant as ObjectValue : null;
    if (data.success !== true || !grant || typeof data.replayed !== "boolean") throw new SubscriptionRedeemError("unavailable");
    if (grant.revoked === true) throw new SubscriptionRedeemError("invalid");
    const endsAt = typeof grant.endsAt === "string" ? Date.parse(grant.endsAt) : NaN;
    const summary = data.entitlement && typeof data.entitlement === "object" ? data.entitlement as ObjectValue : null;
    const plan = summary?.plan && typeof summary.plan === "object" ? summary.plan as ObjectValue : null;
    const planName = typeof plan?.name === "string" && plan.name.trim() && plan.name.length <= 80 && !/[\x00-\x1f\x7f]/.test(plan.name) ? plan.name.trim() : null;
    const until = typeof summary?.effectiveUntil === "string" ? Date.parse(summary.effectiveUntil) : NaN;
    return { planEndsAt: Number.isFinite(until) ? until : grant.paidPlanTakesPrecedence === true || !Number.isFinite(endsAt) ? null : endsAt, replayed: data.replayed, grantEndsAt: Number.isFinite(endsAt) ? endsAt : null, paidPlanTakesPrecedence: grant.paidPlanTakesPrecedence === true, planName };
  }
  private async assertSameCredential(credentialId: string, signal: AbortSignal) {
    const current = await this.credentials.read(this.environment);
    signal.throwIfAborted();
    if (current?.credentialId !== credentialId) throw new CloudProtocolError("account-changed");
    if (current.expiresAt !== undefined && current.expiresAt <= Date.now()) throw new CloudProtocolError("expired");
  }
  /** Cloud API origin, used as the entitlement issuer. */
  get entitlementIssuer(): string { return this.authority.api; }
  /** Short-lived signed subscription entitlement (proposed Cloud contract, issue #410). Read at
   * admission and by the background refresher, never per assistant turn. `null` means the
   * deployed Cloud does not offer the route yet (404/405/501). */
  async subscriptionEntitlement(signal: AbortSignal): Promise<string | null> {
    signal.throwIfAborted();
    const credential = await this.credentials.read(this.environment);
    signal.throwIfAborted();
    if (!credential?.credentialId) throw new CloudProtocolError("credentials-missing");
    let data: ObjectValue;
    try { data = await this.call(ENTITLEMENT_PATH, signal, { authenticated: true, credentialId: credential.credentialId }); }
    catch (error) {
      if (error instanceof CloudProtocolError && error.code === "http" && [404, 405, 501].includes(error.status ?? 0)) return null;
      throw error;
    }
    await this.assertSameCredential(credential.credentialId, signal);
    if (typeof data.entitlement !== "string" || !data.entitlement || data.entitlement.length > 8192) throw new CloudProtocolError("invalid-response");
    return data.entitlement;
  }
  /** Public ES256 verification keys for entitlements. Never private material. */
  async subscriptionEntitlementKeys(signal: AbortSignal): Promise<JsonWebKey[]> {
    const data = await this.call(ENTITLEMENT_KEYS_PATH, signal);
    if (!Array.isArray(data.keys) || data.keys.length > 16) throw new CloudProtocolError("invalid-response");
    return data.keys.filter((key): key is JsonWebKey => !!key && typeof key === "object" && !Array.isArray(key)
      && (key as ObjectValue).kty === "EC" && (key as ObjectValue).crv === "P-256" && (key as ObjectValue).d === undefined
      && typeof (key as ObjectValue).kid === "string" && typeof (key as ObjectValue).x === "string" && typeof (key as ObjectValue).y === "string");
  }
  /** Entitlement ports for checkEntitlement, bound to this client. */
  entitlementSource(): EntitlementSource {
    return { issuer: this.entitlementIssuer, audience: this.authority.entitlementAudience,
      entitlement: signal => this.subscriptionEntitlement(signal),
      entitlementKeys: signal => this.subscriptionEntitlementKeys(signal),
      fallbackPlan: signal => this.billingFallbackPlan(signal) };
  }
  /** Opens Cloud's hosted plan page (exactly planManagementUrl) in the system browser. No
   * checkout, upgrade or overage purchase is created here; the owner chooses a plan in Cloud. */
  async openSubscriptionManagement(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await this.openExternal(planManagementUrl(this.environment), signal);
    signal.throwIfAborted();
  }
  /** Whether this build can sign in here. The production web build has no sign-in host. */
  get signInAvailable(): boolean { return this.options.signIn !== undefined; }
  cancelLogin(): void {
    this.activeLogin?.abort(new DOMException("Login cancelled", "AbortError"));
    void this.options.signIn?.cancel().catch(() => { /* Nothing pending. */ });
  }
  /**
   * One sign-in step at a time (`login-active`). Cancelling the signal cancels the host's attempt,
   * which burns a pending Google record. Host failures arrive as CloudSignInError codes only.
   */
  private async signInStep<T>(signal: AbortSignal, run: (port: CloudSignInPort) => Promise<unknown>, parse: (value: unknown) => T): Promise<T> {
    void this.authority; // A flag-off build has no staging authority: refuse before any host call.
    const port = this.options.signIn;
    if (!port) throw new CloudSignInError("unavailable");
    if (this.activeLogin) throw new CloudProtocolError("login-active");
    signal.throwIfAborted();
    const controller = new AbortController();
    this.activeLogin = controller;
    let rejectAbort: (reason: unknown) => void = () => {};
    const interrupted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const abort = () => controller.abort(signal.reason);
    const cancelled = () => { void port.cancel().catch(() => {}); rejectAbort(controller.signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    controller.signal.addEventListener("abort", cancelled, { once: true });
    try {
      const value = await Promise.race([run(port), interrupted]);
      controller.signal.throwIfAborted();
      return parse(value);
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (error instanceof CloudProtocolError) throw error;
      throw CloudSignInError.from(error);
    } finally {
      signal.removeEventListener("abort", abort);
      controller.signal.removeEventListener("abort", cancelled);
      if (this.activeLogin === controller) this.activeLogin = null;
    }
  }
  /**
   * The Cloud sign-in hand-off (cli-session, the hosted cli-login page, then polling). The product
   * sign-in path until the in-app host reports Cloud ready for this phone (connection-ui
   * inAppSignInMethods), and a diagnostic fallback in test-mocks builds afterwards. Only one poller
   * may claim the server's single-consumption credential. A cancelled/lost claim is not retried
   * automatically; start a fresh login.
   */
  async login(signal: AbortSignal, onWaiting?: (attempt: CloudLoginAttempt) => void): Promise<CloudLoginResult> {
    if (this.activeLogin) throw new CloudProtocolError("login-active");
    signal.throwIfAborted();
    const controller = new AbortController();
    this.activeLogin = controller;
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      // The server issues the UUID; client-chosen IDs are deliberately ignored.
      const created = await this.call("/api/auth/cli-session", controller.signal, { body: {} });
      const sessionId = uuid(created.sessionId);
      const expiresAt = timestamp(created.expiresAt);
      if (expiresAt <= Date.now()) throw new CloudProtocolError("expired");
      expiryTimer = setTimeout(() => controller.abort(new CloudProtocolError("expired")), Math.min(expiresAt - Date.now(), 2_147_483_647));
      const browserUrl = `${this.authority.web}/auth/cli-login?session=${encodeURIComponent(sessionId)}&app=alpha`;
      onWaiting?.({ sessionId, expiresAt, browserUrl });
      await this.openExternal(browserUrl, controller.signal);
      if (Date.now() >= expiresAt) throw new CloudProtocolError("expired");
      while (true) {
        controller.signal.throwIfAborted();
        if (Date.now() >= expiresAt) throw new CloudProtocolError("expired");
        let response: ObjectValue;
        try { response = await this.call(`/api/auth/cli-session/${sessionId}`, controller.signal, {expiresAt}); }
        catch (error) {
          if (Date.now() >= expiresAt) throw new CloudProtocolError("expired");
          if (error instanceof CloudProtocolError && (error.status === 404 || error.status === 410)) throw new CloudProtocolError("expired");
          throw error;
        }
        if (Date.now() >= expiresAt) throw new CloudProtocolError("expired");
        const data = response.data == null ? response : object(response.data);
        if (data.status === "authenticated") {
          const token = ["token", "accessToken", "stewardToken", "sessionToken", "apiKey"]
            .flatMap(key => [response[key], data[key]]).find(value => typeof value === "string" && value.trim());
          const reference=data.credentialReference ?? response.credentialReference;
          if(!token && !(this.credentials.acceptsReferences && typeof reference==="string" && /^browser-cloud-reference:[0-9a-f-]{36}$/.test(reference)))throw new CloudProtocolError("credential-consumed");
          const credential: CloudCredential = token ? {token:string(token)} : {credentialReference:string(reference)};
          if (data.expiresAt != null) credential.expiresAt = timestamp(data.expiresAt);
          if (credential.expiresAt !== undefined && credential.expiresAt <= Date.now()) throw new CloudProtocolError("expired");
          if (data.userId != null) credential.userId = string(data.userId);
          if (data.organizationId != null) credential.organizationId = string(data.organizationId);
          controller.signal.throwIfAborted();
          if (Date.now() >= expiresAt) throw new CloudProtocolError("expired");
          // The new key replaces a saved one. Revoke the old key first, once and best effort: a
          // failed or unconfirmed revocation never blocks this sign-in. The write below replaces the
          // old key in place (stores that bind a claim to the key it replaces stay atomic).
          const previousSignIn = await this.revokeReplaced(controller.signal, credential);
          controller.signal.throwIfAborted();
          if (Date.now() >= expiresAt) throw new CloudProtocolError("expired");
          await this.credentials.write(this.environment, credential, controller.signal);
          return previousSignIn ? { previousSignIn } : {};
        }
        if (data.status === "expired") throw new CloudProtocolError("expired");
        if (data.status !== "pending") throw new CloudProtocolError("invalid-response");
        await delay(Math.min(1500, Math.max(1, expiresAt - Date.now())), controller.signal);
      }
    } finally {
      clearTimeout(expiryTimer);
      signal.removeEventListener("abort", abort);
      this.activeLogin = null;
    }
  }
  /** The host stored the key before reporting success; confirm this store now holds a sign-in. */
  private async storedSignIn(outcome: CloudSignInAuthenticated, signal: AbortSignal): Promise<CloudSignInAuthenticated> {
    const credential = await this.credentials.read(this.environment);
    signal.throwIfAborted();
    const usable = !!credential?.credentialId && (typeof credential.token === "string" && !!credential.token
      || !!this.credentials.acceptsReferences && typeof credential.credentialReference === "string");
    if (!usable) throw new CloudProtocolError("credentials-missing");
    if (credential.expiresAt !== undefined && credential.expiresAt <= Date.now()) throw new CloudProtocolError("expired");
    return outcome;
  }
  /** Google through a verified App Link: request native MFA, or finish after the key is stored. */
  async signInWithGoogle(signal: AbortSignal): Promise<CloudSignInGoogleOutcome> {
    const outcome = await this.signInStep(signal, port => port.startGoogle({ environment: this.environment }), value => googleOutcome(value, this.environment));
    return outcome.status === "mfa" ? outcome : this.storedSignIn(outcome, signal);
  }
  /** Sends a six-digit code to the address. The address is never stored or logged here. */
  async startEmailSignIn(email: string, signal: AbortSignal): Promise<CloudSignInEmailStarted> {
    return this.signInStep(signal, port => port.startEmail({ environment: this.environment, email: email.trim() }), emailStarted);
  }
  async startPhoneSignIn(phone: string, signal: AbortSignal): Promise<CloudSignInEmailStarted> {
    return this.signInStep(signal, port => { if (!port.startPhone) throw new CloudSignInError('unavailable'); return port.startPhone({ environment: this.environment, phone: phone.trim() }); }, emailStarted);
  }
  async verifyPhoneSignIn(attemptId: string, code: string, signal: AbortSignal): Promise<CloudSignInAuthenticated | CloudSignInMfaRequired> {
    const outcome = await this.signInStep(signal, port => { if (!port.verifyPhone) throw new CloudSignInError('unavailable'); return port.verifyPhone({ attemptId, code }); }, value => signInVerified(value, this.environment));
    return outcome.status === "mfa" ? outcome : this.storedSignIn(outcome, signal);
  }
  async verifyEmailSignIn(attemptId: string, code: string, signal: AbortSignal): Promise<CloudSignInAuthenticated | CloudSignInMfaRequired> {
    const outcome = await this.signInStep(signal, port => port.verifyEmail({ attemptId, code }), value => signInVerified(value, this.environment));
    return outcome.status === "mfa" ? outcome : this.storedSignIn(outcome, signal);
  }
  async verifyMfaSignIn(attemptId: string, code: string, signal: AbortSignal): Promise<CloudSignInAuthenticated> {
    const outcome = await this.signInStep(signal, port => port.verifyMfa({ attemptId, code }), value => signInAuthenticated(value, this.environment));
    return this.storedSignIn(outcome, signal);
  }
  async disconnect(expected?: CloudCredential | null): Promise<void> {
    this.cancelLogin();
    if (expected !== undefined && this.credentials.clearIfCurrent) await this.credentials.clearIfCurrent(this.environment, expected);
    else if (expected === undefined || sameCloudCredential(await this.credentials.read(this.environment), expected)) await this.credentials.clear(this.environment);
  }
  /** Revokes the presented sign-in key with Cloud's self-revocation route
   * (`DELETE /api/v1/api-keys/current`), then clears local storage. One attempt, never retried:
   * a lost response is reported as an error and the local credential is still cleared. */
  async revokeSession(signal: AbortSignal, expected?: CloudCredential | null): Promise<CloudSessionRevocation> {
    this.cancelLogin();
    const credential = await this.credentials.read(this.environment);
    signal.throwIfAborted();
    if (expected !== undefined && !sameCloudCredential(credential, expected)) throw new Error("Cloud account changed");
    if (!credential) return { supported: false, reason: "no-credential" };
    return this.revokeStored(credential, signal);
  }
  /** One revocation of the saved key a new login is about to replace. Never retried or thrown. */
  private async revokeReplaced(signal: AbortSignal, issued: CloudCredential): Promise<"revoked" | "unconfirmed" | undefined> {
    let previous: CloudCredential | null;
    try { previous = await this.credentials.read(this.environment); } catch { return "unconfirmed"; }
    // Nothing saved, or Cloud handed back the key already saved: there is nothing to replace.
    if (!previous || (issued.token !== undefined && previous.token === issued.token) || (issued.credentialReference !== undefined && previous.credentialReference === issued.credentialReference)) return undefined;
    try { const result = await this.revokeStored(previous, signal, false); return result.supported && result.revoked ? "revoked" : "unconfirmed"; }
    catch { return "unconfirmed"; }
  }
  private async revokeStored(credential: CloudCredential, signal: AbortSignal, clearLocal = true): Promise<CloudSessionRevocation> {
    try {
      if (!this.options.deleteRequests) return { supported: false, reason: "transport" };
      let data: unknown;
      try {
        data = await this.requestData("/api/v1/api-keys/current", signal, { authenticated: true, method: "DELETE",
          ...(credential.credentialId ? { credentialId: credential.credentialId } : {}), ...(credential.credentialReference ? {credentialReference:credential.credentialReference} : {}) });
      } catch (error) {
        if (error instanceof CloudProtocolError && error.code === "http" && (error.status === 404 || error.status === 405 || error.status === 501)) return { supported: false, reason: "server" };
        throw error;
      }
      const result = object(data);
      if (result.success !== true || (result.status !== undefined && result.status !== "revoked")) throw new CloudProtocolError("invalid-response");
      return { supported: true, revoked: true, credentialId: typeof result.credentialId === "string" ? result.credentialId : null, revokedAt: typeof result.revokedAt === "string" ? result.revokedAt : null };
    } finally {
      const current = clearLocal ? await this.credentials.read(this.environment) : null;
      if (current?.credentialId === credential.credentialId && current?.token === credential.token && current?.credentialReference === credential.credentialReference) {
        if(this.credentials.clearIfCurrent)await this.credentials.clearIfCurrent(this.environment,credential);
        else await this.credentials.clear(this.environment);
      }
    }
  }
  protected success(response: ObjectValue): unknown {
    if (response.success !== true) throw new CloudProtocolError("invalid-response");
    return response.data;
  }
  /** Authenticated identity is server-derived, never inferred from entered email. */
  async identity(signal: AbortSignal): Promise<{ userId: string; organizationId?: string;email?:string }> {
    const data = object(this.success(await this.call("/api/v1/user", signal, { authenticated: true })));
    return { userId: uuid(data.id), ...(typeof data.email==='string'&&data.email.trim()&&data.email.length<=320?{email:data.email.trim()}:{}), ...(data.organization_id == null ? {} : { organizationId: uuid(data.organization_id) }) };
  }
  /** Read access by default; Calendar writes require explicit additional consent. */
  async initiateGoogle(signal:AbortSignal, calendarPermission:'read'|'write'='read', gmailPermission:'read'|'modify'|'send'|'drafts'|'mailbox'='read', redirectUrl?:string):Promise<string> {
    if(!['read','write'].includes(calendarPermission))throw new TypeError('Invalid Calendar permission');
    if(!['read','modify','send','drafts','mailbox'].includes(gmailPermission))throw new TypeError('Invalid Gmail permission');
    // An App Link return (https://eliza.app/alphaphone/google/return?state=…) brings Google's result
    // straight back to Alpha instead of Cloud's web success page.
    if(redirectUrl!==undefined&&!/^https:\/\/[a-z0-9.-]+\/alphaphone\/google\/return\?state=[A-Za-z0-9_-]{43}$/.test(redirectUrl))throw new TypeError('Invalid Google return');
    const response=object(await this.accountRequest('/api/v1/eliza/google/connect/initiate',signal,{side:'owner',...(redirectUrl?{redirectUrl}:{}),capabilities:[
      ...gmailCapabilitiesFor(gmailPermission==='modify'?'modify':'read'),'google.calendar.read',...(calendarPermission==='write'?['google.calendar.write']:[]),
      ...(['read','modify'].includes(gmailPermission)?[]:[gmailPermission==='send'?'google.gmail.send':gmailPermission==='drafts'?'google.gmail.drafts':'google.gmail.mailbox']),
    ]}));
    return this.googleAuthUrl(response.authUrl);
  }
  private googleAuthUrl(value:unknown):string {
    let url:URL;try{url=new URL(string(value));}catch{throw new CloudProtocolError('invalid-response');}
    if(url.origin!=='https://accounts.google.com'||url.username||url.password||url.hash)throw new CloudProtocolError('invalid-response');
    return url.href;
  }
  /** Reject responses from an account that changed while its request was in flight. */
  private async accountRequest(path:string,signal:AbortSignal,body?:unknown,options:{method?:AutomationsMethod|'PATCH';headers?:Record<string,string>}={}):Promise<unknown> {
    const credential=await this.credentials.read(this.environment);signal.throwIfAborted();
    if(!credential)throw new CloudProtocolError('credentials-missing');
    const binding=JSON.stringify([credential.credentialId,credential.credentialReference,credential.token,credential.userId,credential.organizationId]);
    try { return await this.requestData(path,signal,{authenticated:true,credentialId:credential.credentialId,body,...options}); }
    finally {
      const current=await this.credentials.read(this.environment);signal.throwIfAborted();
      if(!current||JSON.stringify([current.credentialId,current.credentialReference,current.token,current.userId,current.organizationId])!==binding)throw new CloudProtocolError('account-changed');
    }
  }
  /** Eliza Cloud Maps data (#412) on the exact reviewed routes. Queries and coordinates
   * travel only in the JSON body; capabilities is a bare read. GPS and navigation stay on the phone. */
  async mapsRequest(route:CloudMapsRoute,signal:AbortSignal,body?:Record<string,unknown>):Promise<Record<string,unknown>> {
    if(!['capabilities','geocode','reverse','places/search','places/details','routes'].includes(route)||(route==='capabilities')!==(body===undefined))throw new CloudProtocolError('invalid-response');
    return object(await this.accountRequest(`/api/v1/maps/${route}`,signal,body,body===undefined?{}:{headers:{'Idempotency-Key':crypto.randomUUID()}}));
  }
  async googleCalendarSync(input:CalendarSyncRequest,signal:AbortSignal):Promise<unknown> {
    const request=calendarSyncHttp(input);
    return this.accountRequest(request.path,signal,'body' in request?request.body:undefined,{method:request.method});
  }
  async googleCalendars(grantId:string,signal:AbortSignal):Promise<GoogleCalendarSummary[]> {
    const params=new URLSearchParams({side:'owner',grantId:uuid(grantId)});
    const data=await this.accountRequest(`/api/v1/eliza/google/calendar/calendars?${params}`,signal);
    if(!Array.isArray(data))throw new CloudProtocolError('invalid-response');
    const seen=new Set<string>();
    return data.map(value=>{
      const row=object(value),calendarId=string(row.calendarId);
      if(seen.has(calendarId)||typeof row.primary!=='boolean'||typeof row.selected!=='boolean')throw new CloudProtocolError('invalid-response');
      seen.add(calendarId);
      return {calendarId,summary:string(row.summary),description:optionalString(row.description),primary:row.primary,accessRole:string(row.accessRole),backgroundColor:optionalString(row.backgroundColor),foregroundColor:optionalString(row.foregroundColor),timeZone:optionalString(row.timeZone),selected:row.selected};
    });
  }
  async googleCalendarFeed(grantId:string,calendarId:string,range:GoogleCalendarRange,signal:AbortSignal):Promise<GoogleCalendarFeed> {
    uuid(grantId);string(calendarId);
    if(timestamp(range.timeMax)<=timestamp(range.timeMin))throw new TypeError('Calendar range must end after it starts');
    try{new Intl.DateTimeFormat('en-US',{timeZone:range.timeZone}).format();}catch{throw new TypeError('Invalid Calendar time zone');}
    const params=new URLSearchParams({side:'owner',grantId,calendarId,timeMin:range.timeMin,timeMax:range.timeMax,timeZone:range.timeZone});
    const data=object(await this.accountRequest(`/api/v1/eliza/google/calendar/feed?${params}`,signal));
    if(data.calendarId!==calendarId||!Array.isArray(data.events)||data.nextPageToken!=null||data.truncated===true)throw new CloudProtocolError('invalid-response');
    timestamp(data.syncedAt);
    const seen=new Set<string>();
    const events=data.events.map(value=>{
      const event=parseGoogleCalendarEvent(value,calendarId);
      if(seen.has(event.externalId))throw new CloudProtocolError('invalid-response');
      seen.add(event.externalId);return event;
    });
    return {calendarId,events,syncedAt:string(data.syncedAt)};
  }
  /** Creates an event on one Google calendar (owner side). Cloud answers `{event}` with the
   * created event in the feed's shape; it must belong to the calendar that was asked for. */
  async googleCalendarCreateEvent(grantId:string,calendarId:string,input:GoogleCalendarEventInput,signal:AbortSignal):Promise<GoogleCalendarEvent> {
    uuid(grantId);string(calendarId);
    const fields=googleCalendarWriteFields(input,true);
    const data=object(await this.accountRequest('/api/v1/eliza/google/calendar/events',signal,{side:'owner',grantId,calendarId,...fields}));
    return parseGoogleCalendarEvent(data.event,calendarId);
  }
  /** Changes the named fields of one event. Only fields present in `patch` are sent; Google keeps
   * the rest. Answers `{event}` with the changed event. */
  async googleCalendarUpdateEvent(grantId:string,calendarId:string,eventId:string,patch:GoogleCalendarEventPatch,signal:AbortSignal):Promise<GoogleCalendarEvent> {
    uuid(grantId);string(calendarId);googleCalendarEventId(eventId);
    const fields=googleCalendarWriteFields(patch,false);
    if(!Object.keys(fields).length)throw new TypeError('Calendar change is empty');
    const data=object(await this.accountRequest(`/api/v1/eliza/google/calendar/events/${eventId}`,signal,{side:'owner',grantId,calendarId,...fields},{method:'PATCH'}));
    return parseGoogleCalendarEvent(data.event,calendarId);
  }
  /** Deletes one event. Cloud answers `{ok:true}`; anything else is an invalid response. */
  async googleCalendarDeleteEvent(grantId:string,calendarId:string,eventId:string,signal:AbortSignal):Promise<void> {
    uuid(grantId);string(calendarId);googleCalendarEventId(eventId);
    const params=new URLSearchParams({side:'owner',grantId,calendarId});
    const data=object(await this.accountRequest(`/api/v1/eliza/google/calendar/events/${eventId}?${params}`,signal,undefined,{method:'DELETE'}));
    if(data.ok!==true)throw new CloudProtocolError('invalid-response');
  }
  /** Starts Google consent. `read` asks for read access only; `modify` is the one incremental step
   * for approved mailbox changes (gmail-grants.ts). The single-capability values remain for callers
   * that ask for one change capability. Cloud maps exactly the requested capabilities to Google
   * scopes, so the request also names what the selected account already holds
   * (`grantedCapabilities`); otherwise a reconnect could drop an earlier grant. Only known Gmail
   * capabilities are carried over. Callers that pass no grants keep the plain request. */
  async initiateGmail(signal: AbortSignal, permission: 'read'|'modify'|'send'|'drafts'|'mailbox' = 'read', grantedCapabilities: readonly string[] = []): Promise<string> {
    const requested = permission === "read" || permission === "modify" ? gmailCapabilitiesFor(permission)
      : ["google.basic_identity", "google.gmail.triage", permission === "send" ? "google.gmail.send" : permission === "drafts" ? "google.gmail.drafts" : "google.gmail.mailbox"];
    const kept = grantedCapabilities.filter(capability => GMAIL_CAPABILITIES.includes(capability));
    const capabilities = [...new Set(["google.basic_identity", "google.gmail.triage", ...kept, ...requested])];
    const response = await this.call("/api/v1/eliza/google/connect/initiate", signal, { authenticated: true,
      body: { side: "owner", capabilities } });
    return this.googleAuthUrl(response.authUrl);
  }

  private googleConnection(value: unknown): GmailAccount {
    const data = object(value);
    if (typeof data.configured !== "boolean" || typeof data.connected !== "boolean" || !Array.isArray(data.grantedCapabilities)) throw new CloudProtocolError("invalid-response");
    const identity = data.identity == null ? {} : object(data.identity);
    return { configured: data.configured, connected: data.connected, reason: string(data.reason),
      connectionId: optionalString(data.connectionId), grantedCapabilities: data.grantedCapabilities.map(string),
      label: optionalString(identity.email) ?? optionalString(identity.name) ?? "Google account" };
  }
  async gmailAccounts(signal: AbortSignal): Promise<GmailAccount[]> {
    const data = await this.requestData("/api/v1/eliza/google/accounts?side=owner", signal, { authenticated: true });
    if (!Array.isArray(data)) throw new CloudProtocolError("invalid-response");
    return data.map(value => this.googleConnection(value));
  }
  private gmailMessage(value: unknown): GmailMessage {
    const data = object(value);
    if (!Array.isArray(data.to) || typeof data.isUnread !== "boolean" || typeof data.subject !== "string" || typeof data.snippet !== "string") throw new CloudProtocolError("invalid-response");
    return { id: string(data.externalId), threadId: string(data.threadId), subject: data.subject,
      from: string(data.from), fromEmail: optionalString(data.fromEmail), to: data.to.map(string), cc: Array.isArray(data.cc)?data.cc.map(string):[], replyTo:optionalString(data.replyTo),
      snippet: data.snippet, receivedAt: string(data.receivedAt), unread: data.isUnread,
      ...(data.hasAttachments === undefined ? {} : typeof data.hasAttachments === "boolean" ? { hasAttachments: data.hasAttachments } : (() => { throw new CloudProtocolError("invalid-response"); })()) };
  }
  /** One page of results. `nextPageToken` is the provider's opaque cursor for the same query, or null. */
  /** One search page. `mailboxHistoryId` is the Gmail mailbox revision read before the page was listed
   * (elizaOS/eliza#35908); two pages of one search with different values came from a changed mailbox.
   * Older Cloud servers omit it. */
  async gmailSearch(grantId: string, query: string, signal: AbortSignal, maxResults: 10 | 25 | 50 = 25, pageToken?: string): Promise<{ messages: GmailMessage[]; syncedAt: string; nextPageToken: string | null; mailboxHistoryId?: string; supportsSpamTrash: boolean }> {
    if (pageToken !== undefined && (typeof pageToken !== "string" || !pageToken || pageToken.length > 4096)) throw new TypeError("Invalid Gmail page token");
    const params = new URLSearchParams({ side: "owner", grantId: string(grantId), query: string(query), maxResults: String(maxResults) });
    if (pageToken !== undefined) params.set("pageToken", pageToken);
    const data = await this.call(`/api/v1/eliza/google/gmail/search?${params}`, signal, { authenticated: true });
    if (!Array.isArray(data.messages)) throw new CloudProtocolError("invalid-response");
    const next = data.nextPageToken;
    if (next != null && (typeof next !== "string" || !next || next.length > 4096 || next === pageToken)) throw new CloudProtocolError("invalid-response");
    const revision = data.mailboxHistoryId;
    if (revision != null && (typeof revision !== "string" || !/^\d{1,20}$/.test(revision))) throw new CloudProtocolError("invalid-response");
    if(data.supportsSpamTrash!==undefined&&typeof data.supportsSpamTrash!=='boolean')throw new CloudProtocolError('invalid-response');
    return { messages: data.messages.map(value => this.gmailMessage(value)), syncedAt: string(data.syncedAt), nextPageToken: next == null ? null : next, ...(revision == null ? {} : { mailboxHistoryId: revision }), supportsSpamTrash: data.supportsSpamTrash === true };
  }
  /** Revokes Eliza Cloud's stored Google grant for one owner connection. It does not delete mail and
   * cannot remove the app from the user's Google Account permissions; callers verify with gmailAccounts. */
  async disconnectGmail(connectionId: string, signal: AbortSignal): Promise<void> {
    const data = await this.call("/api/v1/eliza/google/disconnect", signal, { authenticated: true, body: { side: "owner", connectionId: string(connectionId) } });
    if (data.ok !== true) throw new CloudProtocolError("invalid-response");
  }
  async gmailRead(grantId: string, messageId: string, signal: AbortSignal): Promise<{ message: GmailMessage; bodyText: string; bodyHtml?:string; links: GmailLink[];historyId:string|null;attachments:{partId:string;name:string;mimeType:string;size:number;supported:boolean}[] }> {
    const params = new URLSearchParams({ side: "owner", grantId: string(grantId), messageId: string(messageId) });
    const data = await this.call(`/api/v1/eliza/google/gmail/read?${params}`, signal, { authenticated: true });
    if (typeof data.bodyText !== "string") throw new CloudProtocolError("invalid-response");
    const message = this.gmailMessage(data.message);
    if (message.id !== messageId) throw new CloudProtocolError("invalid-response");
    const metadata=data.message&&typeof data.message==='object'?object(object(data.message).metadata??{}):{};
    const attachments=Array.isArray(data.attachments)?data.attachments.map(value=>{const a=object(value);const name=typeof a.filename==='string'?a.filename:a.name;if(typeof a.partId!=='string'||typeof name!=='string'||typeof a.mimeType!=='string'||!Number.isSafeInteger(a.size)||(a.size as number)<0||a.supported!==undefined&&typeof a.supported!=='boolean')throw new CloudProtocolError('invalid-response');return {partId:a.partId,name,mimeType:a.mimeType,size:a.size as number,supported:typeof a.supported==='boolean'?a.supported:['application/pdf','text/plain','image/png','image/jpeg','image/webp'].includes(a.mimeType)};}):[];
    return { message, bodyText: data.bodyText,...mailHtml(data.bodyHtml), links: mailLinks(data.links),historyId:typeof metadata.historyId==='string'?metadata.historyId:null,attachments };
  }
  async gmailInboxCapabilities(grantId:string,signal:AbortSignal):Promise<GmailInboxCapabilities> {
    const data=await this.call(`/api/v1/eliza/google/gmail/inbox-v1/capabilities?${new URLSearchParams({grantId})}`,signal,{authenticated:true});
    if(data.version!==1||data.providerExactlyOnce!==false||data.atomicDraftReplacement!==false||['threads','send','providerDrafts','mailboxMutations','attachments'].some(key=>typeof data[key]!=='boolean'))throw new CloudProtocolError('invalid-response');
    for(const key of ['readState','draftsList','forwardAttachments','opaqueAttachments','searchTrash'])if(data[key]!==undefined&&typeof data[key]!=='boolean')throw new CloudProtocolError('invalid-response');
    const policy=data.attachmentPolicy===undefined?{}:object(data.attachmentPolicy),limit=(value:unknown,fallback:number,max:number)=>{if(value===undefined)return fallback;if(!Number.isSafeInteger(value)||(value as number)<1||(value as number)>max)throw new CloudProtocolError('invalid-response');return value as number;};
    const maximumBytes=limit(policy.maximumBytes,5*1024*1024,25*1024*1024),attachmentPolicy={maximumOutgoing:limit(policy.maximumOutgoing,1,20),maximumBytes,maximumTotalBytes:limit(policy.maximumTotalBytes,maximumBytes,25*1024*1024)};
    return {version:1,from:string(data.from),threads:data.threads as boolean,send:data.send as boolean,providerDrafts:data.providerDrafts as boolean,mailboxMutations:data.mailboxMutations as boolean,attachments:data.attachments as boolean,providerExactlyOnce:false,atomicDraftReplacement:false,readState:data.readState===true,draftsList:data.draftsList===true,forwardAttachments:data.forwardAttachments===true,opaqueAttachments:data.opaqueAttachments===true,searchTrash:data.searchTrash===true,attachmentPolicy};
  }
  async gmailThread(grantId:string,threadId:string,signal:AbortSignal,cursor?:{offset:number;historyId:string}) {
    const params=new URLSearchParams({grantId,threadId});if(cursor){params.set('offset',String(cursor.offset));params.set('historyId',cursor.historyId);}
    const data=await this.call(`/api/v1/eliza/google/gmail/inbox-v1/thread?${params}`,signal,{authenticated:true});
    if(data.version!==1||data.threadId!==threadId||!Array.isArray(data.messages)||data.messages.length>25||!Number.isSafeInteger(data.total)||!Number.isSafeInteger(data.offset)||data.offset!==(cursor?.offset??0))throw new CloudProtocolError('invalid-response');
    const messages=data.messages.map(row=>{const item=object(row),message=this.gmailMessage(item.message);if(message.threadId!==threadId||typeof item.bodyText!=='string')throw new CloudProtocolError('invalid-response');return {message,bodyText:item.bodyText,...mailHtml(item.bodyHtml),links:mailLinks(item.links),historyId:typeof item.historyId==='string'?item.historyId:null,attachments:Array.isArray(item.attachments)?item.attachments.map(value=>{const a=object(value);if(typeof a.name!=='string'||typeof a.mimeType!=='string'||typeof a.size!=='number'||typeof a.supported!=='boolean')throw new CloudProtocolError('invalid-response');return {partId:typeof a.partId==='string'?a.partId:(()=>{throw new CloudProtocolError('invalid-response')})(),name:a.name,mimeType:a.mimeType,size:a.size,supported:a.supported};}):[]};});
    const total=data.total as number,offset=data.offset as number;if(total<offset+messages.length||total>2000||data.nextOffset!==(offset+messages.length<total?offset+messages.length:null))throw new CloudProtocolError('invalid-response');
    const historyId=string(data.historyId);if(cursor&&cursor.historyId!==historyId)throw new CloudProtocolError('invalid-response');return {messages,total,offset,historyId,nextOffset:data.nextOffset as number|null};
  }
  /** Opaque byte copy of any type under the server cap. The bytes are never
   * previewed or interpreted; only the name, size and SHA-256 are checked here. */
  async gmailOpaqueAttachment(grantId:string,messageId:string,partId:string,historyId:string,signal:AbortSignal):Promise<OpaqueMailAttachment>{
    const data=await this.call(`/api/v1/eliza/google/gmail/inbox-v1/attachment?${new URLSearchParams({grantId,messageId,partId,historyId,opaque:'1'})}`,signal,{authenticated:true});
    if(data.version!==1||data.opaque!==true||data.messageId!==messageId||data.partId!==partId||data.historyId!==historyId)throw new CloudProtocolError('invalid-response');
    let checked:OpaqueMailAttachment;try{checked=await reviewOpaqueAttachment({name:string(data.name),mimeType:typeof data.mimeType==='string'?data.mimeType:'',dataBase64:string(data.dataBase64)});}catch{throw new CloudProtocolError('invalid-response');}
    if(checked.sha256!==data.sha256||checked.size!==data.size)throw new CloudProtocolError('invalid-response');return checked;
  }
  /** One page of provider drafts. Metadata only; open one with gmailDraftContent. */
  async gmailDrafts(grantId:string,signal:AbortSignal,pageToken?:string):Promise<{drafts:GmailDraftSummary[];nextPageToken:string|null}>{
    if(pageToken!==undefined&&(!pageToken||pageToken.length>4096))throw new TypeError('Invalid Gmail page token');
    const params=new URLSearchParams({grantId});if(pageToken!==undefined)params.set('pageToken',pageToken);
    const data=await this.call(`/api/v1/eliza/google/gmail/inbox-v1/drafts?${params}`,signal,{authenticated:true});
    if(data.version!==1||!Array.isArray(data.drafts)||data.drafts.length>50)throw new CloudProtocolError('invalid-response');
    const next=data.nextPageToken;if(next!=null&&(typeof next!=='string'||!next||next.length>4096||next===pageToken))throw new CloudProtocolError('invalid-response');
    const drafts=data.drafts.map(row=>{const d=object(row);if(!Array.isArray(d.to)||typeof d.subject!=='string'||typeof d.snippet!=='string')throw new CloudProtocolError('invalid-response');return {draftId:string(d.draftId),messageId:string(d.messageId),subject:d.subject,to:d.to.map(string),snippet:d.snippet,updatedAt:optionalString(d.updatedAt)};});
    return {drafts,nextPageToken:next==null?null:next};
  }
  /** Exact provider draft content and its raw-MIME digest from one snapshot. */
  async gmailDraftContent(grantId:string,draftId:string,signal:AbortSignal):Promise<GmailDraftContent>{
    const data=await this.call(`/api/v1/eliza/google/gmail/inbox-v1/draft?${new URLSearchParams({grantId,draftId,content:'1'})}`,signal,{authenticated:true});
    if(data.id!==draftId||typeof data.providerDigest!=='string'||!/^[a-f0-9]{64}$/.test(data.providerDigest))throw new CloudProtocolError('invalid-response');
    const content=object(data.content),list=(value:unknown)=>{if(!Array.isArray(value)||value.length>50)throw new CloudProtocolError('invalid-response');return value.map(string);};
    if(typeof content.subject!=='string'||typeof content.bodyText!=='string'||typeof content.threaded!=='boolean'||!Number.isSafeInteger(content.attachmentCount)||typeof content.plainText!=='boolean')throw new CloudProtocolError('invalid-response');
    return {draftId,messageId:string(data.messageId),providerDigest:data.providerDigest,to:list(content.to),cc:list(content.cc),bcc:list(content.bcc),subject:content.subject,bodyText:content.bodyText,threaded:content.threaded,attachmentCount:content.attachmentCount as number,plainText:content.plainText};
  }
  async gmailAttachment(grantId:string,messageId:string,partId:string,historyId:string,signal:AbortSignal){
    const data=await this.call(`/api/v1/eliza/google/gmail/inbox-v1/attachment?${new URLSearchParams({grantId,messageId,partId,historyId})}`,signal,{authenticated:true});
    if(data.version!==1||data.messageId!==messageId||data.partId!==partId||data.historyId!==historyId)throw new CloudProtocolError('invalid-response');
    const file={name:string(data.name),mimeType:data.mimeType,dataBase64:string(data.dataBase64)} as MailAttachment;const checked=await reviewMailAttachment(file);if(checked.sha256!==data.sha256||checked.size!==data.size)throw new CloudProtocolError('invalid-response');return {...checked,dataBase64:file.dataBase64};
  }
  async gmailDraft(grantId:string,draftId:string,signal:AbortSignal){
    const data=await this.call(`/api/v1/eliza/google/gmail/inbox-v1/draft?${new URLSearchParams({grantId,draftId})}`,signal,{authenticated:true});
    if(data.id!==draftId||typeof data.providerDigest!=='string'||!/[a-f0-9]{64}/.test(data.providerDigest))throw new CloudProtocolError('invalid-response');return {draftId,messageId:string(data.messageId),providerDigest:data.providerDigest};
  }
  private gmailInboxReceipt(value:unknown,requestId:string):GmailInboxReceipt {
    const data=object(value);if(data.requestId!==requestId||!['send','draft-create','draft-replace','draft-delete','archive','unarchive','trash','untrash','mark-read','mark-unread'].includes(String(data.kind))||!['prepared','dispatched','succeeded','rejected','outcome-unknown'].includes(String(data.state))||typeof data.reviewDigest!=='string'||!/^[a-f0-9]{64}$/.test(data.reviewDigest))throw new CloudProtocolError('invalid-response');
    const providerResult=data.providerResult===null?null:object(data.providerResult);if((data.state==='succeeded')!==(providerResult!==null))throw new CloudProtocolError('invalid-response');
    return {requestId,kind:data.kind as GmailInboxReceipt['kind'],state:data.state as GmailInboxReceipt['state'],reviewDigest:data.reviewDigest,providerResult,rejectionCode:data.rejectionCode===null?null:string(data.rejectionCode)};
  }
  async gmailPrepareOperation(grantId:string,requestId:string,proposal:Record<string,unknown>,signal:AbortSignal) {
    const data=await this.call('/api/v1/eliza/google/gmail/inbox-v1/operations',signal,{authenticated:true,body:{grantId,requestId,proposal}});if(data.version!==1||data.providerExactlyOnce!==false)throw new CloudProtocolError('invalid-response');return {receipt:this.gmailInboxReceipt(data.receipt,requestId),review:object(data.review)};
  }
  /** One explicit reviewed dispatch. The caller persists its intent before calling.
   * Any lost/aborted response must use gmailOperation, never an automatic send retry. */
  async gmailDispatchOperation(grantId:string,requestId:string,reviewDigest:string,proposal:Record<string,unknown>,signal:AbortSignal) {
    const data=await this.call(`/api/v1/eliza/google/gmail/inbox-v1/operations/${encodeURIComponent(requestId)}/dispatch`,signal,{authenticated:true,body:{grantId,reviewDigest,proposal},timeoutMs:45000});if(data.version!==1||data.providerExactlyOnce!==false)throw new CloudProtocolError('invalid-response');return this.gmailInboxReceipt(data.receipt,requestId);
  }
  async gmailOperation(grantId:string,requestId:string,signal:AbortSignal) {
    const data=await this.call(`/api/v1/eliza/google/gmail/inbox-v1/operations/${encodeURIComponent(requestId)}?${new URLSearchParams({grantId})}`,signal,{authenticated:true});if(data.version!==1||data.providerExactlyOnce!==false)throw new CloudProtocolError('invalid-response');return this.gmailInboxReceipt(data.receipt,requestId);
  }
  async gmailStatus(signal: AbortSignal): Promise<GoogleConnection> {
    const data = await this.call("/api/v1/eliza/google/status?side=owner", signal, { authenticated: true });
    if (typeof data.configured !== "boolean" || typeof data.connected !== "boolean" || !Array.isArray(data.grantedCapabilities)) throw new CloudProtocolError("invalid-response");
    return { configured: data.configured, connected: data.connected, reason: string(data.reason),
      connectionId: optionalString(data.connectionId), grantedCapabilities: data.grantedCapabilities.map(string) };
  }
}
