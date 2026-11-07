import type { CloudEnvironment } from './cloud-protocol';

/**
 * In-app Eliza Cloud sign-in port (owner directive 2026-10-14). Sign-in happens on Alpha's own
 * screens: an email code typed into Alpha, or Google's consent in a Custom Tab that returns to a
 * verified App Link. No Eliza Cloud web page is part of a successful sign-in.
 *
 * The port's host (AlphaCloudSignInPlugin on Android, the development Cloud bridge in a test-mocks
 * browser build) holds the Steward session, the PKCE verifiers and states and the authorization
 * codes; none of them crosses to the renderer. The minted `eliza_mobile_` key is written to the
 * existing `cloud:<environment>` slot before it is acknowledged. That slot is renderer-readable on
 * Android (RendererCredentialSlots does not protect it), exactly like the key the Cloud sign-in
 * hand-off stores, because the renderer's Cloud requests send it as their Bearer. The port's
 * outcomes themselves carry no secret.
 *
 * Email remains in Alpha when readiness is unavailable. The readiness probe gates Google;
 * it never selects hosted login as a fallback.
 */
export type CloudSignInFailureCode =
  | 'cancelled' | 'login-active' | 'invalid-phone' | 'invalid-email' | 'invalid-code' | 'cooldown' | 'expired' | 'rate-limited'
  | 'offline' | 'dns' | 'timeout' | 'secure-connection' | 'unavailable' | 'account-check' | 'state-mismatch' | 'browser-closed' | 'browser-unavailable'
  | 'provider-refused' | 'mfa-browser' | 'mfa-unsupported' | 'activation-pending' | 'storage' | 'rejected' | 'invalid-request'
  | 'app-link-unverified' | 'attempts-exhausted';
export interface CloudSignInAuthenticated {
  status: 'authenticated';
  environment: CloudEnvironment;
  expiresAt: number;
  /** True when this sign-in created the Eliza Cloud account; null when Cloud did not say. */
  accountCreated: boolean | null;
  /** What happened to the key this sign-in replaced: absent when none was saved (as CloudLoginResult). */
  previousSignIn?: 'revoked' | 'unconfirmed';
}
export interface CloudSignInEmailStarted { attemptId: string; expiresAt: number; resendAt: number }
export interface CloudSignInMfaRequired { status: 'mfa'; method: 'totp' | 'sms' | 'passkey'; expiresAt: number }
export interface CloudSignInGoogleMfaRequired extends CloudSignInMfaRequired { attemptId: string; environment: CloudEnvironment }
export type CloudSignInGoogleOutcome = CloudSignInAuthenticated | CloudSignInGoogleMfaRequired;
export interface CloudSignInPort {
  serviceInfo?(input: { environment: CloudEnvironment }): Promise<unknown>;
  /** Opens Google's consent in a Custom Tab and resolves once the App Link return is exchanged. */
  startGoogle(input: { environment: CloudEnvironment }): Promise<unknown>;
  startEmail(input: { environment: CloudEnvironment; email: string }): Promise<unknown>;
  startPhone?(input: { environment: CloudEnvironment; phone: string }): Promise<unknown>;
  verifyPhone?(input: { attemptId: string; code: string }): Promise<unknown>;
  verifyEmail(input: { attemptId: string; code: string }): Promise<unknown>;
  verifyMfa(input: { attemptId: string; code: string }): Promise<unknown>;
  /** Revalidates a retained MFA event against the current native attempt; no network or secrets. */
  resumeMfa?(input: { attemptId: string; environment: CloudEnvironment }): Promise<unknown>;
  /** Ends the attempt and burns any pending Google record. Idempotent. */
  cancel(): Promise<void>;
  /** Which methods this host offers and whether Cloud is ready for in-app sign-in on this phone
   * (`inApp`, from the host's cached readiness probe). Hosts without Google (the browser bridge) say so. */
  status?(input?: { environment: CloudEnvironment; refresh?: boolean }): Promise<unknown>;
  /** `signInCompleted`: a Google return that completed after Alpha restarted (no waiting call).
   * `signInIncomplete`: a return without a sign-in result arrived with no waiting call.
   * `signInMfaRequired`: a retained hint that must be revalidated through resumeMfa. */
  addListener?(event: 'signInCompleted' | 'signInIncomplete' | 'signInMfaRequired', listener: (outcome: unknown) => void): Promise<unknown>;
}
const CODES = new Set<string>(['cancelled', 'login-active', 'invalid-phone', 'invalid-email', 'invalid-code', 'cooldown', 'expired', 'rate-limited', 'offline', 'dns', 'timeout', 'secure-connection', 'unavailable', 'account-check', 'state-mismatch', 'browser-closed', 'browser-unavailable', 'provider-refused', 'mfa-browser', 'mfa-unsupported', 'activation-pending', 'storage', 'rejected', 'invalid-request', 'app-link-unverified', 'attempts-exhausted']);
export class CloudSignInError extends Error {
  readonly code: CloudSignInFailureCode;
  constructor(code: CloudSignInFailureCode) { super(`Cloud sign-in ${code}`); this.code = code; this.name = 'CloudSignInError'; }
  static from(error: unknown): CloudSignInError {
    if (error instanceof CloudSignInError) return error;
    const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
    return new CloudSignInError(typeof code === 'string' && CODES.has(code) ? code as CloudSignInFailureCode : 'unavailable');
  }
}
/** Shown on the method choice while Cloud cannot be reached; Alpha re-checks by itself. */
export const SIGN_IN_WAITING = 'Waiting for connection';
/** A Resend on the code step that could not reach Cloud: no new code was sent. */
export const SIGN_IN_RESEND_FAILED = 'Couldn’t send a new code. Check your connection.';
/** Owner-facing copy. Never includes server text, codes or addresses. */
export function signInFailureMessage(code: CloudSignInFailureCode, serviceName: string): string {
  switch (code) {
    case 'cancelled': return '';
    case 'login-active': return 'A sign-in is already in progress. Finish or cancel it first.';
    case 'invalid-phone': return 'Enter your phone number with its country code, such as +14155550100.';
    case 'invalid-email': return 'Enter a valid email address.';
    case 'invalid-code': return 'That code didn’t work. Check it, or resend.';
    case 'cooldown': return 'Wait a minute before sending another code.';
    case 'expired': return 'This sign-in expired. Start again.';
    case 'rate-limited': return 'Too many attempts. Wait a few minutes, then try again.';
    case 'offline': return `Alpha could not reach ${serviceName}. Check your connection, then enter the code again.`;
    case 'dns': return `Could not find ${serviceName}. Check your connection, then enter the code again.`;
    case 'timeout': return `${serviceName} took too long to respond. Enter the code again.`;
    case 'secure-connection': return `Could not securely connect to ${serviceName}. Check the phone’s date and time, then try again.`;
    case 'account-check': return 'This account needs extra verification. Use account recovery.';
    case 'state-mismatch': return 'Sign-in didn’t finish. Try again.';
    case 'browser-closed': return '';
    case 'browser-unavailable': return 'Google sign-in isn’t available. Use email.';
    case 'provider-refused': return 'Google didn’t sign you in. Try again or use email.';
    case 'mfa-browser': return 'This account needs a second step. Sign in with your email to finish.';
    case 'mfa-unsupported': return 'This account’s second step isn’t supported yet. Use account recovery.';
    case 'activation-pending': return `Signed in, but ${serviceName} has not confirmed this phone yet. Alpha retries when it starts again; you can also sign in again.`;
    case 'storage': return 'Couldn’t save your sign-in. Try again.';
    case 'app-link-unverified': return 'Alpha did not receive the sign-in from your browser, so you are not signed in yet. Start sign-in again in Alpha.';
    case 'attempts-exhausted': return 'Too many incorrect codes. Send a new code and try again.';
    case 'rejected': case 'invalid-request': return 'Sign-in was refused. Try again.';
    default: return `${serviceName} sign-in is unavailable right now. Try again.`;
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CloudSignInError('unavailable');
  return value as Record<string, unknown>;
}
function time(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) throw new CloudSignInError('unavailable');
  return parsed;
}
export function authenticated(value: unknown, environment: CloudEnvironment): CloudSignInAuthenticated {
  const row = object(value);
  if (row.status !== 'authenticated' || row.environment !== environment) throw new CloudSignInError('unavailable');
  for (const key of Object.keys(row)) if (!['status', 'environment', 'expiresAt', 'accountCreated', 'previousSignIn'].includes(key)) throw new CloudSignInError('unavailable');
  if (row.previousSignIn !== undefined && row.previousSignIn !== 'revoked' && row.previousSignIn !== 'unconfirmed') throw new CloudSignInError('unavailable');
  return { status: 'authenticated', environment, expiresAt: time(row.expiresAt), accountCreated: typeof row.accountCreated === 'boolean' ? row.accountCreated : null,
    ...(row.previousSignIn === undefined ? {} : { previousSignIn: row.previousSignIn }) };
}
export function emailStarted(value: unknown): CloudSignInEmailStarted {
  const row = object(value);
  if (typeof row.attemptId !== 'string' || !/^[0-9a-f-]{36}$/i.test(row.attemptId)) throw new CloudSignInError('unavailable');
  return { attemptId: row.attemptId, expiresAt: time(row.expiresAt), resendAt: time(row.resendAt) };
}
export function verified(value: unknown, environment: CloudEnvironment): CloudSignInAuthenticated | CloudSignInMfaRequired {
  const row = object(value);
  if (row.status === 'mfa') {
    if (row.method !== 'totp' && row.method !== 'sms' && row.method !== 'passkey') throw new CloudSignInError('unavailable');
    return { status: 'mfa', method: row.method, expiresAt: time(row.expiresAt) };
  }
  return authenticated(row, environment);
}
/** Google may require a native second factor before a credential exists. Bind it to this attempt/environment. */
export function googleOutcome(value: unknown, environment: CloudEnvironment): CloudSignInGoogleOutcome {
  const row = object(value);
  const outcome = verified(row, environment);
  if (outcome.status !== 'mfa') return outcome;
  if (row.environment !== environment || typeof row.attemptId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.attemptId)) throw new CloudSignInError('unavailable');
  if (Object.keys(row).some(key => !['status', 'method', 'expiresAt', 'attemptId', 'environment'].includes(key))) throw new CloudSignInError('unavailable');
  if (outcome.expiresAt <= Date.now()) throw new CloudSignInError('expired');
  return { ...outcome, attemptId: row.attemptId, environment };
}
export const normalizeSignInCode = (value: string): string | null => { const digits = value.replace(/[\s-]/g, ''); return /^\d{6}$/.test(digits) ? digits : null; };
export const validSignInEmail = (value: string): boolean => value.length <= 320 && /^[^\s@\p{Cc}\p{Cf}]+@[^\s@\p{Cc}\p{Cf}]+\.[^\s@\p{Cc}\p{Cf}]+$/u.test(value.trim());
/** Explicit provider capabilities from the host. Unknown readiness keeps the existing email error/retry
 * surface; known disabled methods stay hidden. Optional SMS is never inferred from an older host. */
export function signInReadiness(value: unknown): { google: boolean; phone: boolean; email: boolean } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.inApp !== true && row.methodsKnown !== true) return null;
  return { google: row.google === true, phone: row.phone === true, email: row.email === true };
}

export const validSignInPhone = (value: string): boolean => /^\+[1-9][0-9]{6,14}$/.test(value.trim());
