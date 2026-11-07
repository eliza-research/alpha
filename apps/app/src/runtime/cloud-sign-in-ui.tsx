import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { SignInView } from './connection-ui';

/**
 * Alpha's own Eliza Cloud sign-in screens: Google in the user's external browser, or an email or
 * text-message code typed here, then a second verification when the account has one. No Eliza
 * Cloud web page. Codes stay in the input while verification is pending or can be retried. They
 * are never stored outside the form, and a different attempt or verification step replaces the input.
 */
export interface CloudSignInActions {
  phone?(number: string): void; google(): void; email(address: string): void; verify(code: string): void; resend(): void; cancel(): void; retry?(): void;
  /** Ends the waiting Google attempt and opens a fresh Google page. */
  reopenGoogle?(): void;
}
export function AlphaAuthBrand({loading = false}: {loading?: boolean} = {}) {
  return <div className="alpha-auth-brand" id={loading ? 'cloud-sign-in-title' : undefined}
    role={loading ? 'status' : undefined} aria-label={loading ? 'Loading Alpha' : undefined}>
    <span className="alpha-auth-mark" aria-hidden="true"/>
  </div>;
}
/** Exact busy messages the controller uses; the panel shows them on the control that started them. */
export const SIGN_IN_SENDING = 'Sending your code…';
export const SIGN_IN_SIGNING_IN = 'Signing in…';
export const SIGN_IN_BROWSER = 'Continue in your browser.';
type Pending = 'email' | 'phone' | 'resend' | null;
export function CloudSignInPanel({ view, busy, google, phone, emailEnabled = true, message, error, errorIsNotice = false, actions, extra, ready = true, dismissible = true, probing = false, unavailable = false, ownKeys, alternate }: {
  view: SignInView; busy: boolean; google: boolean; phone?: boolean; emailEnabled?: boolean; message: string; error: string; actions: CloudSignInActions;
  errorIsNotice?: boolean;
  /** Low-emphasis entries under the methods (saved sign-in recovery, test-mocks diagnostics). */
  extra?: ReactNode;
  /** The native readiness probe has admitted this attempt. */
  ready?: boolean;
  /** Required first-run sign-in has no screen to go Back to. */
  dismissible?: boolean;
  /** The readiness probe is running; it is not an attempt the owner started. */
  probing?: boolean;
  /** Readiness failed or was cancelled: only the reason and one retry are shown. */
  unavailable?: boolean;
  /** Offers the owner-provided keys path instead of Cloud sign-in. */
  ownKeys?: () => void;
  /** Replaces the sign-in methods, status and footer while the owner-provided keys form is open. */
  alternate?: ReactNode;
}) {
  const googleButton=useRef<HTMLButtonElement>(null);
  const phoneInput = useRef<HTMLInputElement>(null);
  const email = useRef<HTMLInputElement>(null), code = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState<Pending>(null);
  // The owner's last explicit choice wins; until then a prefilled number (Back from a text-message
  // code, a failed send) selects the phone form.
  const [method, setMethod] = useState<'email' | 'phone' | null>(null);
  const choose = view.step === 'choose' ? view : null;
  const showPhone = !!phone && (!emailEnabled || (method ?? (choose?.phone && !choose.email ? 'phone' : 'email')) === 'phone');
  const checking = view.step === 'choose' && (probing || (!ready && !unavailable));
  // Resend becomes available when the host's cooldown ends; the countdown is the only timer.
  useEffect(() => {
    if (view.step !== 'code') return;
    // The owner may spend minutes entering an address before this panel reaches the code step.
    // Start the displayed cooldown from the host's new deadline, not this component's mount time.
    setNow(Date.now());
    if (view.resendAt <= Date.now()) return;
    const timer = setInterval(() => { setNow(Date.now()); if (Date.now() >= view.resendAt) clearInterval(timer); }, 1000);
    return () => clearInterval(timer);
  }, [view]);
  useEffect(() => { if (!busy) setPending(null); }, [busy, view.step]);
  // Switching between email and text message moves focus to the field that replaced the other one.
  const switched = useRef(false);
  useEffect(() => { if (!switched.current) { switched.current = true; return; } (showPhone ? phoneInput : email).current?.focus(); }, [method]);
  useEffect(() => {
    // Disabled inputs lose focus during verification. Restore it for a wrong-code retry too, with
    // the rejected code selected so the next digits replace it.
    if (busy || checking || alternate) return;
    const target = view.step === 'code' || view.step === 'mfa' ? code : view.step === 'choose' ? google ? googleButton : showPhone ? phoneInput : email : null;
    target?.current?.focus();
    if (error && target === code) code.current?.select();
  }, [view.step, busy, checking, google, emailEnabled, phone, error, !!alternate]);
  const wait = view.step === 'code' ? Math.max(0, Math.ceil((view.resendAt - now) / 1000)) : 0;
  const sending = busy && message === SIGN_IN_SENDING;
  const signingIn = busy && message === SIGN_IN_SIGNING_IN;
  const verifying = busy && !sending && (view.step === 'code' || view.step === 'mfa');
  const inlineStatus = (view.step === 'google' && message === SIGN_IN_BROWSER) || sending || verifying;
  const passkey = view.step === 'mfa' && view.method === 'passkey';
  // An expired or exhausted code cannot be verified; only a new code continues.
  const stale = view.step === 'code' && view.stale === true;
  const submitCode = (event: FormEvent) => { event.preventDefault(); if (!busy && ready && !stale) actions.verify(code.current?.value || ''); };
  const noMethods = ready && !google && !emailEnabled && !phone;
  const title = view.step === 'choose' ? 'Welcome to Alpha.' : view.step === 'google' ? 'Finish in your browser.' : passkey ? 'Can’t finish sign-in' : 'Check your code.';
  const codeError = (view.step === 'code' || (view.step === 'mfa' && !passkey)) && !!error && !errorIsNotice;
  const errorLine = error && !codeError ? <p role={errorIsNotice ? 'status' : 'alert'} className={errorIsNotice ? 'alpha-auth-notice' : 'alpha-connection-error'}>{error}</p> : null;
  // Back always returns to the chooser (or closes an explicit entry). The required page's own
  // readiness check is not something the owner started, so it offers nothing to go back from.
  const back = !alternate && (view.step !== 'choose' || dismissible || busy);
  const sendLabel = (method: 'email' | 'phone', idle: string) => sending && pending === method ? 'Sending code…' : idle;
  if (checking) return <><AlphaAuthBrand loading/></>;
  return <>
    <AlphaAuthBrand/>
    <header className={choose ? 'alpha-auth-chooser' : undefined}><h1 id="cloud-sign-in-title" className="serif">{title}</h1></header>
    {view.step === 'choose' && alternate}
    {view.step === 'choose' && !alternate && (unavailable || noMethods) && <div className="alpha-auth-methods">
      {errorLine ?? <p role="status">Sign-in is unavailable.</p>}
      {actions.retry && <button type="button" className="alpha-btn alpha-btn--primary" onClick={actions.retry}>Try again</button>}
    </div>}
    {view.step === 'choose' && !alternate && !unavailable && !noMethods && <div className="alpha-auth-methods">
      {google && <button ref={googleButton} type="button" className="alpha-btn alpha-btn--secondary alpha-auth-google" disabled={busy} onClick={actions.google}><span aria-hidden="true" className="alpha-google-icon"/>Continue with Google</button>}
      {google && (emailEnabled || phone) && <div className="alpha-auth-divider" aria-hidden="true">or</div>}
      {emailEnabled && !showPhone && <form className="alpha-cloud-sign-in-email" aria-label="Sign in with email" onSubmit={event => { event.preventDefault(); setPending('email'); actions.email(email.current?.value || ''); }}>
        <label>Email<input ref={email} type="email" name="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" maxLength={320} required defaultValue={choose?.email || undefined} disabled={busy || !ready} /></label>
        <button className="alpha-btn alpha-btn--primary" aria-busy={(sending && pending === 'email') || undefined} disabled={busy || !ready}>{sendLabel('email', 'Email me a code')}</button>
      </form>}
      {showPhone && <form className="alpha-cloud-sign-in-phone" aria-label="Sign in with phone" onSubmit={event => { event.preventDefault(); setPending('phone'); actions.phone?.(phoneInput.current?.value || ''); }}>
        <label>Phone number<input ref={phoneInput} type="tel" name="phone" autoComplete="tel" placeholder="+14155550100" maxLength={16} required defaultValue={choose?.phone || undefined} disabled={busy || !ready} /></label>
        <button className="alpha-btn alpha-btn--primary" aria-busy={(sending && pending === 'phone') || undefined} disabled={busy || !ready}>{sendLabel('phone', 'Text me a code')}</button>
      </form>}
      {emailEnabled && phone && <button type="button" className="alpha-btn alpha-btn--text" disabled={busy || !ready} onClick={() => setMethod(showPhone ? 'email' : 'phone')}>{showPhone ? 'Use email instead' : 'Use phone number instead'}</button>}
      {!google && actions.retry && <button type="button" className="alpha-btn alpha-btn--text" disabled={busy} onClick={actions.retry}>Retry Google sign-in</button>}
      {errorLine}
    </div>}
    {(view.step === 'code' || view.step === 'mfa') && <form key={`${view.step}:${view.attemptId}`} className="alpha-cloud-sign-in-code" aria-busy={busy || undefined} aria-label={view.step === 'code' ? view.phone ? 'Enter your phone code' : 'Enter your email code' : 'Enter your verification code'} onSubmit={submitCode}>
      {view.step === 'code' && <p>Code sent to <strong>{view.phone || view.email}</strong>.</p>}
      {view.step === 'mfa' && !passkey && <p>{view.method === 'totp' ? 'Enter your authenticator code.' : 'Enter the code sent to your phone.'}</p>}
      {!passkey && <>
        <label>Six-digit code<input ref={code} name="one-time-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 -]{6,9}" maxLength={9} required disabled={busy}
          aria-invalid={codeError || undefined} aria-describedby={codeError ? 'cloud-sign-in-code-error' : undefined} /></label>
        {codeError && <p id="cloud-sign-in-code-error" role="alert" className="alpha-connection-error">{error}</p>}
        <button className="alpha-btn alpha-btn--primary alpha-auth-submit" aria-live="polite" aria-busy={verifying || undefined} disabled={busy || stale}>{verifying ? signingIn ? 'Signing in…' : 'Checking code…' : 'Verify'}</button>
      </>}
      {view.step === 'code' && <button type="button" className="alpha-btn alpha-btn--text alpha-auth-resend" aria-busy={sending || undefined} disabled={busy || wait > 0} onClick={() => { setPending('resend'); actions.resend(); }}>{sending ? 'Sending code…' : wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}</button>}
    </form>}
    {view.step === 'google' && <div className="alpha-auth-methods">
      <p className="alpha-auth-waiting" aria-hidden="true"><span className="alpha-spinner"/></p>
      {actions.reopenGoogle && <button type="button" className="alpha-btn alpha-btn--secondary alpha-auth-google" onClick={actions.reopenGoogle}><span aria-hidden="true" className="alpha-google-icon"/>Open Google again</button>}
    </div>}
    {view.step !== 'choose' && errorLine}
    {!alternate && message && !inlineStatus && <p role="status">{message}</p>}
    {view.step === 'choose' && !alternate && (ownKeys || extra) && <div className="alpha-auth-alt">
      {ownKeys && <button type="button" className="alpha-btn alpha-btn--text" disabled={busy} onClick={ownKeys}>Use my own API keys</button>}
      {extra}
    </div>}
    {back && <div className="alpha-connection-actions alpha-auth-footer">
      <button type="button" className="alpha-btn alpha-btn--text alpha-btn--quiet alpha-connection-cancel" onClick={actions.cancel}>Back</button>
    </div>}
  </>;
}
