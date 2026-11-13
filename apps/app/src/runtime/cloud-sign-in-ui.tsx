import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { SignInView } from './connection-ui';
import { Busy } from './status-ui';
import { iconStyle } from '../icon-style';

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
export function AlphaAuthBrand() {
  return <div className="alpha-auth-brand"><span className="alpha-auth-mark" aria-hidden="true"/></div>;
}
/** Exact busy messages the controller uses; the panel shows them on the control that started them. */
export const SIGN_IN_SENDING = 'Sending code';
// Must equal the controller message set while a verified sign-in is admitted (connection-ui.tsx residentSignedIn).
export const SIGN_IN_SIGNING_IN = 'Signing in…';
export const SIGN_IN_BROWSER = 'In browser';
type Pending = 'email' | 'phone' | 'resend' | null;
export function CloudSignInPanel({ view, busy, google, phone, emailEnabled = true, message, error, errorIsNotice = false, actions, extra, ready = true, dismissible = true, probing = false, unavailable = false, ownKeys, alternate, focusEmailOnChoose = true }: {
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
  /** An untouched first-run landing keeps focus outside the empty email field. */
  focusEmailOnChoose?: boolean;
}) {
  const googleButton=useRef<HTMLButtonElement>(null);
  const email = useRef<HTMLInputElement>(null), code = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState<Pending>(null);
  // The owner's last explicit choice wins; until then a prefilled number (Back from a text-message
  // code, a failed send) selects the phone form.
  const choose = view.step === 'choose' ? view : null;
  // One field takes an email address or a phone number; the method follows what was typed.
  const showPhone = !!phone && !emailEnabled;
  const [codeValue, setCodeValue] = useState('');
  const [typedMethod, setTypedMethod] = useState<'email' | 'phone' | null>(null);
  useEffect(() => setTypedMethod(null), [view.step]);
  const methodFor = (value: string) => phone && (!emailEnabled || /^\+?[\d\s().-]{6,}$/.test(value.trim())) ? 'phone' : 'email';
  const sendMethod = phone && emailEnabled && typedMethod ? typedMethod : methodFor(choose?.phone ?? choose?.email ?? '');
  const deadline = view.step === 'code' ? view.resendAt : choose?.sendAfter?.[sendMethod] ?? 0;
  const checking = view.step === 'choose' && !alternate && (probing || (!ready && !unavailable));
  // Resend becomes available when the host's cooldown ends; the countdown is the only timer.
  useEffect(() => {
    // The owner may spend minutes entering an address before this panel reaches the code step.
    // Start the displayed cooldown from the host's new deadline, not this component's mount time.
    setNow(Date.now());
    if (deadline <= Date.now()) return;
    const timer = setInterval(() => { setNow(Date.now()); if (Date.now() >= deadline) clearInterval(timer); }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  useEffect(() => { if (!busy) setPending(null); }, [busy, view.step]);
  useEffect(() => { setCodeValue(''); }, [view.step, view.step === 'code' || view.step === 'mfa' ? view.attemptId : '']);
  useEffect(() => {
    // Disabled inputs lose focus during verification. Restore it for a wrong-code retry too, with
    // the rejected code selected so the next digits replace it.
    if (busy || checking || alternate) return;
    const target = view.step === 'code' || view.step === 'mfa' ? code : view.step === 'choose' ? google ? googleButton : focusEmailOnChoose ? email : null : null;
    target?.current?.focus();
    if (error && target === code) code.current?.select();
  }, [view.step, busy, checking, google, emailEnabled, phone, error, !!alternate, focusEmailOnChoose]);
  const wait = Math.max(0, Math.ceil((deadline - now) / 1000));
  const sending = busy && message === SIGN_IN_SENDING;
  const signingIn = busy && message === SIGN_IN_SIGNING_IN;
  const verifying = busy && !sending && (view.step === 'code' || view.step === 'mfa');
  const inlineStatus = (view.step === 'google' && message === SIGN_IN_BROWSER) || sending || verifying;
  const passkey = view.step === 'mfa' && view.method === 'passkey';
  // An expired or exhausted code cannot be verified; only a new code continues.
  const stale = view.step === 'code' && view.stale === true;
  const submitCode = (event: FormEvent) => { event.preventDefault(); if (!busy && ready && !stale) actions.verify(code.current?.value || ''); };
  const noMethods = ready && !google && !emailEnabled && !phone;
  const title = view.step === 'choose' ? 'Alpha' : view.step === 'google' ? 'In browser' : passkey ? 'Can’t sign in' : 'Enter code';
  const codeError = (view.step === 'code' || (view.step === 'mfa' && !passkey)) && !!error && !errorIsNotice;
  const errorLine = error && !codeError ? <p role={errorIsNotice ? 'status' : 'alert'} className={errorIsNotice ? 'alpha-auth-notice' : 'alpha-connection-error'}>{error}</p> : null;
  // Back always returns to the chooser (or closes an explicit entry). The required page's own
  // readiness check is not something the owner started, so it offers nothing to go back from.
  const back = !alternate && (view.step !== 'choose' || dismissible || busy);
  if (checking) return <div id="cloud-sign-in-title" className="alpha-auth-loading" role="status" aria-label="Loading Alpha"/>;
  return <>
    <AlphaAuthBrand/>
    <header className={choose ? 'alpha-auth-chooser' : undefined}><h1 id="cloud-sign-in-title" className="serif">{title}</h1></header>
    {view.step === 'choose' && alternate}
    {view.step === 'choose' && !alternate && (unavailable || noMethods) && <div className="alpha-auth-methods">
      {errorLine ?? <p role="status">Unavailable</p>}
      {actions.retry && <button type="button" className="alpha-btn alpha-btn--primary" onClick={actions.retry}>Try again</button>}
    </div>}
    {view.step === 'choose' && !alternate && !unavailable && !noMethods && <div className="alpha-auth-methods">
      {google && <button ref={googleButton} type="button" className="alpha-btn alpha-btn--secondary alpha-auth-google" disabled={busy} onClick={actions.google}><span aria-hidden="true" className="alpha-google-icon"/>Continue with Google</button>}
      {google && (emailEnabled || phone) && <div className="alpha-auth-divider" aria-hidden="true">or</div>}
      {(emailEnabled || phone) && <form className="alpha-cloud-sign-in-email" aria-label={emailEnabled && phone ? 'Sign in with email or phone' : showPhone ? 'Sign in with phone' : 'Sign in with email'} onSubmit={event => { event.preventDefault(); const value = (email.current?.value || '').trim(); const method = methodFor(value); if ((choose?.sendAfter?.[method] ?? 0) > Date.now()) return; setPending(method); if (method === 'phone') actions.phone?.(value); else actions.email(value); }}>
        <label>{emailEnabled && phone ? 'Email or phone' : showPhone ? 'Phone' : 'Email'}<input ref={email} type={showPhone ? 'tel' : emailEnabled && phone ? 'text' : 'email'} name={showPhone ? 'phone' : 'email'} autoComplete={showPhone ? 'tel' : emailEnabled && phone ? 'username' : 'email'} autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode={showPhone ? 'tel' : 'email'} maxLength={320} required onInput={event => setTypedMethod(methodFor(event.currentTarget.value))} defaultValue={choose?.email || choose?.phone || undefined} disabled={busy || !ready} /></label>
        <button className="alpha-btn alpha-btn--primary" aria-busy={(sending && pending !== 'resend') || undefined} disabled={busy || !ready || wait > 0}>{sending && pending !== 'resend' ? <Busy label="Sending code"/> : wait > 0 ? `Send code · ${wait}s` : 'Send code'}</button>
      </form>}
      {!google && actions.retry && <button type="button" className="alpha-btn alpha-btn--text" aria-label="Retry Google sign-in" disabled={busy} onClick={actions.retry}><span aria-hidden="true" style={iconStyle('rotate-cw')}/> Retry</button>}
      {errorLine}
    </div>}
    {(view.step === 'code' || view.step === 'mfa') && <form key={`${view.step}:${view.attemptId}`} className="alpha-cloud-sign-in-code" aria-busy={busy || undefined} aria-label={view.step === 'code' ? view.phone ? 'Enter your phone code' : 'Enter your email code' : 'Enter your verification code'} onSubmit={submitCode}>
      {view.step === 'code' && <p><span aria-hidden="true" style={iconStyle(view.phone ? 'phone' : 'mail')}/> <span className="alpha-sr">Code sent to </span><strong>{view.phone || view.email}</strong></p>}
      {view.step === 'mfa' && !passkey && <p><span aria-hidden="true" style={iconStyle(view.method === 'totp' ? 'shield' : 'phone')}/> {view.method === 'totp' ? 'Authenticator' : 'Phone code'}</p>}
      {!passkey && <>
        {/* Six boxes show the digits; one real field keeps paste, autofill and screen readers working. */}
        <label className="alpha-code-boxes" data-invalid={codeError || undefined}><span className="alpha-sr">Code</span>{Array.from({length: 6}, (_, index) => { const digits = codeValue.replace(/\D/g, ''); return <span key={index} aria-hidden="true" data-active={index === Math.min(digits.length, 5) || undefined}>{digits[index] ?? ''}</span>; })}<input ref={code} name="one-time-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 -]{6,9}" maxLength={9} required disabled={busy} onInput={event => setCodeValue(event.currentTarget.value)}
          aria-label="Code" aria-invalid={codeError || undefined} aria-describedby={codeError ? 'cloud-sign-in-code-error' : undefined} /></label>
        {codeError && <p id="cloud-sign-in-code-error" role="alert" className="alpha-connection-error">{error}</p>}
        <button className="alpha-btn alpha-btn--primary alpha-auth-submit" aria-live="polite" aria-busy={verifying || undefined} disabled={busy || stale}>{verifying ? <Busy label={signingIn ? 'Signing in' : 'Checking code'}/> : 'Verify'}</button>
      </>}
      {view.step === 'code' && <button type="button" className="alpha-btn alpha-btn--text alpha-auth-resend" aria-busy={sending || undefined} disabled={busy || wait > 0} onClick={() => { setPending('resend'); actions.resend(); }}>{sending ? <Busy label="Sending code"/> : wait > 0 ? `Resend · ${wait}s` : 'Resend'}</button>}
    </form>}
    {view.step === 'google' && <div className="alpha-auth-methods">
      <p className="alpha-auth-waiting" aria-hidden="true"><span className="alpha-spinner"/></p>
      {actions.reopenGoogle && <button type="button" className="alpha-btn alpha-btn--secondary alpha-auth-google" onClick={actions.reopenGoogle}><span aria-hidden="true" className="alpha-google-icon"/>Reopen<span className="alpha-sr"> Google</span></button>}
    </div>}
    {view.step !== 'choose' && errorLine}
    {!alternate && message && !inlineStatus && <p role="status">{busy ? <Busy label={message}/> : message}</p>}
    {view.step === 'choose' && !alternate && (ownKeys || extra) && <div className="alpha-auth-alt">
      {ownKeys && <button type="button" className="alpha-btn alpha-btn--text" disabled={busy} onClick={ownKeys}>Use my own keys</button>}
      {extra}
    </div>}
    {back && <div className="alpha-connection-actions alpha-auth-footer">
      <button type="button" className="alpha-btn alpha-btn--text alpha-btn--quiet alpha-connection-cancel" onClick={actions.cancel}>Back</button>
    </div>}
  </>;
}
