import {googleWorkspaceRedirectAllowed} from './google-workspace-return.ts';
import {productionCloud, stagingCloud} from './cloud-deployment.generated.ts';
import {browserCloudResidentEnabled,browserCloudResidentEnvironment} from './browser-cloud-resident.ts';
import {calendarSyncHttp,type CalendarSyncRequest} from './calendar-linked-provider.ts';
import type {AutomationsMethod} from './automations-route-policy.ts';
import { reviewMailAttachment } from './inbox-attachment.ts';
import type { OpaqueMailAttachment } from './inbox-operation.ts';
import { gmailCapabilitiesFor, gmailConsentCapabilities, type GmailGrantRequest } from './gmail-grants.ts';
import { ManagedGmailMailboxClient } from '../../../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/managed-gmail-client.ts';
import type { GmailAccount, GmailDraftContent, GmailDraftSummary, GmailInboxCapabilities, GmailInboxReceipt, GmailReadResult, GmailSearchPage, GmailThreadPage, GoogleConnection } from '../../../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/types.ts';
import type { CloudMapsRoute } from '../maps/cloud-provider.ts';
import { authenticated as signInAuthenticated, googleOutcome, type CloudSignInGoogleOutcome, CloudSignInError, emailStarted, verified as signInVerified, type CloudSignInAuthenticated, type CloudSignInEmailStarted, type CloudSignInMfaRequired, type CloudSignInPort } from './cloud-sign-in.ts';
import type { EntitlementSource, FallbackPlan, OrganizationCreditBalance, RedeemResult } from './subscription-entitlement.ts';
import { CloudAccountBillingClient, CloudBillingError, type CloudBillingRequest, type CloudBillingResponse } from '../../../../.eliza/client-features/packages/cloud/sdk/src/cloud-account-billing.ts';
/** Narrow Alpha adapter for Eliza Cloud managed services: sign-in, identity, subscription plan and
 * the connected Google services. Sign-in is in-app (cloud-sign-in.ts) once the native host reports
 * Cloud ready for this phone: the host signs in with Steward and mints an `eliza_mobile_` key through
 * Cloud's mobile App Auth routes, so no Eliza Cloud web page is opened. That is the only product
 * sign-in. The Cloud sign-in hand-off (`login()`, v3's cloud/api/auth/cli-session) is a development
 * surface: it exists only in ELIZA_DEV_ALLOW_TEST_MOCKS=1 builds and the loopback browser Cloud host
 * (`cloudSignInHandOffAvailable`); product bundles fold it away. Contracts inspected
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
/**
 * Whether this build carries the Cloud sign-in hand-off (cli-session, the hosted cli-login page, then
 * polling). Product builds sign in only through the native in-app host (cloud-sign-in.ts); the
 * hand-off is a test-mocks diagnostic and the loopback browser Cloud host's sign-in. Vite folds this
 * to false in product bundles, so the hand-off body and its routes are not shipped there. Node
 * contract tests import this source without Vite and keep it.
 */
export const cloudSignInHandOffAvailable: boolean = import.meta.env === undefined || import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS === '1' || browserCloudResidentEnabled;
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
export type { GoogleConnection } from '../../../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/types.ts';
/** Managed Google Calendar wire data (@elizaos/plugin-calendar/linked-sync). Cloud enforces ownership of each
 * grant and exhausts provider pages before returning; no client cursor exists. */
import type { GoogleCalendarEvent, GoogleCalendarFeed, GoogleCalendarRange, GoogleCalendarSummary } from '../../../../.eliza/client-features/plugins/plugin-calendar/src/linked-sync/google-reader.ts';
export type { GoogleCalendarEvent, GoogleCalendarFeed, GoogleCalendarRange, GoogleCalendarSummary };
export type { GmailAccount, GmailDraftContent, GmailDraftSummary, GmailInboxCapabilities, GmailInboxReceipt, GmailLink, GmailMessage } from '../../../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/types.ts';
/** Only absolute http(s) links without credentials are kept; anything else is dropped as untrusted. */
export { safeMailLink } from '../../../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/links.ts';
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
  protected async requestData(path: string, signal: AbortSignal, options: { credentialReference?: string; body?: unknown; method?: AutomationsMethod | 'PATCH'; authenticated?: boolean; runtimeBase?: string; timeoutMs?: number; headers?: Record<string,string>; credentialId?: string; expiresAt?: number; onStatus?: (status:number)=>void; /** Answer every HTTP status; the caller interprets it. */ anyStatus?: boolean } = {}): Promise<unknown> {
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
    if (options.anyStatus) return response;
    if (response.status < 200 || response.status >= 300) throw new CloudProtocolError("http", response.status, response.data, response.retryAfter);
    options.onStatus?.(response.status);
    return response.data;
  }
  /**
   * Account billing (plan fallback, credit state, entitlement, redemption and self-revocation) is
   * the shared credential-bound reader `@elizaos/cloud-sdk/cloud-account-billing`. This adapter
   * supplies only the native transport and this environment's secure credential store; the reader
   * keeps the same-credential and account-changed fences.
   */
  private billingClient: CloudAccountBillingClient | null = null;
  protected get billing(): CloudAccountBillingClient {
    return this.billingClient ??= new CloudAccountBillingClient({
      readCredential: () => this.credentials.read(this.environment),
      request: async (input: CloudBillingRequest): Promise<CloudBillingResponse> => {
        const credential = input.credential;
        const answer = await this.requestData(input.path, input.signal, { anyStatus: true, method: input.method, ...(input.body === undefined ? {} : { body: input.body }),
          ...(credential ? { authenticated: true, ...(credential.credentialId ? { credentialId: credential.credentialId } : {}), ...(credential.credentialReference ? { credentialReference: credential.credentialReference } : {}) } : {}) });
        return answer as CloudBillingResponse;
      },
      // A changed account is never replayed; a lost redemption request is replayed once.
      replayable: error => !(error instanceof CloudProtocolError) && !(error instanceof Error && error.message === "Cloud account changed"),
      deleteRequests: this.options.deleteRequests === true,
    });
  }
  /** The shared reader's refusals keep this adapter's error type for its callers. */
  private async billingRead<T>(read: () => Promise<T>): Promise<T> {
    try { return await read(); }
    catch (error) {
      if (error instanceof CloudBillingError) throw new CloudProtocolError(error.code, error.status, error.data, error.retryAfter);
      throw error;
    }
  }
  protected async call(path: string, signal: AbortSignal, options: { body?: unknown; method?: AutomationsMethod | 'PATCH'; authenticated?: boolean; runtimeBase?: string; timeoutMs?: number; headers?: Record<string,string>; credentialId?: string; expiresAt?: number } = {}) {
    return object(await this.requestData(path, signal, options));
  }
  /** Plan state from the read-only billing snapshot, used only while the entitlement route is
   * absent. `null` when the snapshot route is absent too or does not report a known plan state. */
  async billingFallbackPlan(signal: AbortSignal): Promise<FallbackPlan | null> {
    return this.billingRead(() => this.billing.fallbackPlan(signal));
  }
  /** Read-only UI eligibility, bound to the current credential. Never grants spending authority. */
  async membershipBalance(signal: AbortSignal): Promise<'zero' | 'funded' | 'unavailable'> {
    return (await this.membershipCredits(signal)).state;
  }
  async membershipCredits(signal: AbortSignal): Promise<OrganizationCreditBalance> {
    return this.billingRead(() => this.billing.credits(signal));
  }
  /**
   * Redeems a subscription grant code for the signed-in account. `idempotencyKey` is fresh for
   * each owner submission; a transport failure (the request may have arrived) is retried once
   * with the same key, which Cloud answers with the original grant. HTTP refusals are never
   * retried. The code is never logged, stored or put in an error.
   */
  async redeemSubscriptionCode(code: string, idempotencyKey: string, signal: AbortSignal): Promise<RedeemResult> {
    return this.billingRead(() => this.billing.redeem(code, idempotencyKey, signal));
  }
  /** Cloud API origin, used as the entitlement issuer. */
  get entitlementIssuer(): string { return this.authority.api; }
  /** Short-lived signed subscription entitlement (proposed Cloud contract, issue #410). Read at
   * admission and by the background refresher, never per assistant turn. `null` means the
   * deployed Cloud does not offer the route yet (404/405/501). */
  async subscriptionEntitlement(signal: AbortSignal): Promise<string | null> {
    return this.billingRead(() => this.billing.entitlement(signal));
  }
  /** Public ES256 verification keys for entitlements. Never private material. */
  async subscriptionEntitlementKeys(signal: AbortSignal): Promise<JsonWebKey[]> {
    return this.billingRead(() => this.billing.entitlementKeys(signal));
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
   * The Cloud sign-in hand-off (cli-session, the hosted cli-login page, then polling). A development
   * surface only (`cloudSignInHandOffAvailable`): a product build refuses it as `unavailable` before
   * any request, and the in-app host (signInWithGoogle/startEmailSignIn) is the one sign-in path.
   * Only one poller may claim the server's single-consumption credential. A cancelled/lost claim is
   * not retried automatically; start a fresh login.
   */
  async login(signal: AbortSignal, onWaiting?: (attempt: CloudLoginAttempt) => void): Promise<CloudLoginResult> {
    if (!cloudSignInHandOffAvailable) throw new CloudSignInError("unavailable");
    return this.handOffLogin(signal, onWaiting);
  }
  private async handOffLogin(signal: AbortSignal, onWaiting?: (attempt: CloudLoginAttempt) => void): Promise<CloudLoginResult> {
    // Folded away in product bundles: no hand-off route or hosted page string ships.
    if (!cloudSignInHandOffAvailable) throw new CloudSignInError("unavailable");
    else {
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
  /** Google through the native account picker: request native MFA, or finish after the key is stored. */
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
    try { return await this.revokeStored(credential, signal); }
    finally {
      if (!await this.credentials.read(this.environment)) await this.options.signIn?.clearCredentialState?.().catch(() => {});
    }
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
      // One attempt through the shared reader, never retried; the local copy is cleared below.
      return await this.billingRead(() => this.billing.revoke(credential, signal));
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
  private async requestGoogleAuthorization(signal:AbortSignal, calendarPermission:'read'|'write'='read', gmailPermission:'read'|'modify'|'send'|'drafts'|'mailbox'='read', redirectUrl?:string):Promise<{authUrl:string;appReturn:boolean}> {
    if(redirectUrl!==undefined&&!googleWorkspaceRedirectAllowed(redirectUrl))throw new TypeError('Invalid Google return URL');
    if(!['read','write'].includes(calendarPermission))throw new TypeError('Invalid Calendar permission');
    if(!['read','modify','send','drafts','mailbox'].includes(gmailPermission))throw new TypeError('Invalid Gmail permission');
    const response=object(await this.accountRequest('/api/v1/eliza/google/connect/initiate',signal,{side:'owner',...(redirectUrl?{redirectUrl}:{}),capabilities:[
      ...gmailCapabilitiesFor(gmailPermission==='modify'?'modify':'read'),'google.calendar.read',...(calendarPermission==='write'?['google.calendar.write']:[]),
      ...(['read','modify'].includes(gmailPermission)?[]:[gmailPermission==='send'?'google.gmail.send':gmailPermission==='drafts'?'google.gmail.drafts':'google.gmail.mailbox']),
    ]}));
    return {authUrl:this.googleAuthUrl(response.authUrl),appReturn:redirectUrl!==undefined&&response.appReturn===2};
  }
  async initiateGoogle(signal:AbortSignal,calendarPermission:'read'|'write'='read',gmailPermission:'read'|'modify'|'send'|'drafts'|'mailbox'='read'):Promise<string> {
    return (await this.requestGoogleAuthorization(signal,calendarPermission,gmailPermission)).authUrl;
  }
  async initiateGoogleWithReturn(signal:AbortSignal,redirectUrl:string,calendarPermission:'read'|'write'='read',gmailPermission:'read'|'modify'|'send'|'drafts'|'mailbox'='read'):Promise<{authUrl:string;appReturn:boolean}> {
    return this.requestGoogleAuthorization(signal,calendarPermission,gmailPermission,redirectUrl);
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
    const plain=(value:unknown)=>{if(typeof value!=='string')throw new CloudProtocolError('invalid-response');return value;};
    const flag=(value:unknown)=>{if(typeof value!=='boolean')throw new CloudProtocolError('invalid-response');return value;};
    const seen=new Set<string>();
    const events=data.events.map(value=>{
      const row=object(value),externalId=string(row.externalId);
      if(row.calendarId!==calendarId||seen.has(externalId)||!Array.isArray(row.attendees)||timestamp(row.endAt)<timestamp(row.startAt))throw new CloudProtocolError('invalid-response');
      seen.add(externalId);
      return {externalId,calendarId,title:plain(row.title),description:plain(row.description),location:plain(row.location),status:string(row.status),startAt:string(row.startAt),endAt:string(row.endAt),isAllDay:flag(row.isAllDay),timezone:optionalString(row.timezone),htmlLink:optionalString(row.htmlLink),conferenceLink:optionalString(row.conferenceLink),organizer:row.organizer==null?null:object(row.organizer),metadata:object(row.metadata),attendees:row.attendees.map(value=>{const a=object(value);return {email:optionalString(a.email),displayName:optionalString(a.displayName),responseStatus:optionalString(a.responseStatus),self:flag(a.self),organizer:flag(a.organizer),optional:flag(a.optional)};})};
    });
    return {calendarId,events,syncedAt:string(data.syncedAt)};
  }
  /** Starts Google consent. `read` asks for read access only; `modify` is the one incremental step
   * for approved mailbox changes (gmail-grants.ts). The single-capability values remain for callers
   * that ask for one change capability. Cloud maps exactly the requested capabilities to Google
   * scopes, so the request also names what the selected account already holds
   * (`grantedCapabilities`); otherwise a reconnect could drop an earlier grant. Only known Gmail
   * capabilities are carried over. Callers that pass no grants keep the plain request. */
  async initiateGmail(signal: AbortSignal, permission: GmailGrantRequest = 'read', grantedCapabilities: readonly string[] = []): Promise<string> {
    const response = await this.call("/api/v1/eliza/google/connect/initiate", signal, { authenticated: true,
      body: { side: "owner", capabilities: gmailConsentCapabilities(permission, grantedCapabilities) } });
    return this.googleAuthUrl(response.authUrl);
  }
  /** The shared managed Gmail client (@elizaos/plugin-inbox/mailbox) on this Cloud credential and transport. */
  private gmailClient?: ManagedGmailMailboxClient;
  private get gmail(): ManagedGmailMailboxClient {
    this.gmailClient ??= new ManagedGmailMailboxClient({
      request: (path, signal, options = {}) => this.requestData(path, signal, { authenticated: true, ...options }),
      invalidResponse: () => new CloudProtocolError("invalid-response"),
      reviewAttachment: reviewMailAttachment,
    });
    return this.gmailClient;
  }
  gmailAccounts(signal: AbortSignal): Promise<GmailAccount[]> { return this.gmail.gmailAccounts(signal); }
  /** One search page. `mailboxHistoryId` is the Gmail mailbox revision read before the page was listed
   * (elizaOS/eliza#35908); two pages of one search with different values came from a changed mailbox.
   * Older Cloud servers omit it. */
  gmailSearch(grantId: string, query: string, signal: AbortSignal, maxResults: 10 | 25 | 50 = 25, pageToken?: string): Promise<GmailSearchPage> {
    return this.gmail.gmailSearch(grantId, query, signal, maxResults, pageToken);
  }
  /** Revokes Eliza Cloud's stored Google grant for one owner connection. It does not delete mail and
   * cannot remove the app from the user's Google Account permissions; callers verify with gmailAccounts. */
  disconnectGmail(connectionId: string, signal: AbortSignal): Promise<void> { return this.gmail.disconnectGmail(connectionId, signal); }
  gmailRead(grantId: string, messageId: string, signal: AbortSignal): Promise<GmailReadResult> { return this.gmail.gmailRead(grantId, messageId, signal); }
  gmailInboxCapabilities(grantId: string, signal: AbortSignal): Promise<GmailInboxCapabilities> { return this.gmail.gmailInboxCapabilities(grantId, signal); }
  gmailThread(grantId: string, threadId: string, signal: AbortSignal, cursor?: { offset: number; historyId: string }): Promise<GmailThreadPage> {
    return this.gmail.gmailThread(grantId, threadId, signal, cursor);
  }
  /** Opaque byte copy of any type under the server cap. The bytes are never
   * previewed or interpreted; only the name, size and SHA-256 are checked here. */
  gmailOpaqueAttachment(grantId: string, messageId: string, partId: string, historyId: string, signal: AbortSignal): Promise<OpaqueMailAttachment> {
    return this.gmail.gmailOpaqueAttachment(grantId, messageId, partId, historyId, signal);
  }
  /** One page of provider drafts. Metadata only; open one with gmailDraftContent. */
  gmailDrafts(grantId: string, signal: AbortSignal, pageToken?: string): Promise<{ drafts: GmailDraftSummary[]; nextPageToken: string | null }> {
    return this.gmail.gmailDrafts(grantId, signal, pageToken);
  }
  /** Exact provider draft content and its raw-MIME digest from one snapshot. */
  gmailDraftContent(grantId: string, draftId: string, signal: AbortSignal): Promise<GmailDraftContent> { return this.gmail.gmailDraftContent(grantId, draftId, signal); }
  gmailAttachment(grantId: string, messageId: string, partId: string, historyId: string, signal: AbortSignal) {
    return this.gmail.gmailAttachment(grantId, messageId, partId, historyId, signal);
  }
  gmailDraft(grantId: string, draftId: string, signal: AbortSignal) { return this.gmail.gmailDraft(grantId, draftId, signal); }
  gmailPrepareOperation(grantId: string, requestId: string, proposal: Record<string, unknown>, signal: AbortSignal) {
    return this.gmail.gmailPrepareOperation(grantId, requestId, proposal, signal);
  }
  /** One explicit reviewed dispatch. The caller persists its intent before calling.
   * Any lost/aborted response must use gmailOperation, never an automatic send retry. */
  gmailDispatchOperation(grantId: string, requestId: string, reviewDigest: string, proposal: Record<string, unknown>, signal: AbortSignal): Promise<GmailInboxReceipt> {
    return this.gmail.gmailDispatchOperation(grantId, requestId, reviewDigest, proposal, signal);
  }
  gmailOperation(grantId: string, requestId: string, signal: AbortSignal): Promise<GmailInboxReceipt> { return this.gmail.gmailOperation(grantId, requestId, signal); }
  gmailStatus(signal: AbortSignal): Promise<GoogleConnection> { return this.gmail.gmailStatus(signal); }
}
