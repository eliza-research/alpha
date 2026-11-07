import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { SignInView } from './connection-ui';
import { SIGN_IN_WAITING } from './cloud-sign-in';

/**
 * Alpha's own Eliza Cloud sign-in screens: Google (a Custom Tab that returns to Alpha), or an email
 * code typed here, then a second verification when the account has one. No Eliza Cloud web page.
 * Codes go straight to the controller and are never kept in component state after submission.
 */
export interface CloudSignInActions {
  phone?(number: string): void; google(): void; email(address: string): void; verify(code: string): void; resend(): void; retry(): void; cancel(): void;
  /** Back from the code or second-verification step to the method choice. */
  back?(): void;
}
const ADDRESS_ERROR_ID = 'alpha-sign-in-address-error';
export function CloudSignInPanel({ view, busy, google, phone, emailEnabled = true, message, error, actions, extra, canGoBack = true, methodsUnconfirmed = false, pending }: {
  view: SignInView; busy: boolean; google: boolean; phone?: boolean; emailEnabled?: boolean; message: string; error: string; actions: CloudSignInActions;
  /** Optional hosted sign-in entry supplied by the caller's build gate. */
  extra?: ReactNode;
  canGoBack?: boolean;
  methodsUnconfirmed?: boolean;
  /** A step started offline waits behind a locked "Waiting for connection" control. */
  pending?: 'email' | 'phone' | 'google';
}) {
  const address = useRef<HTMLInputElement>(null), code = useRef<HTMLInputElement>(null);
  const [addressError, setAddressError] = useState('');
  const [now, setNow] = useState(() => Date.now());
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
  useEffect(() => {
    // Disabled inputs lose focus during verification. Restore it for a wrong-code retry too.
    if (!busy) (view.step === 'code' || view.step === 'mfa' ? code : view.step === 'choose' && (emailEnabled || phone) ? address : null)?.current?.focus();
  }, [view.step, busy, emailEnabled, phone]);
  // Unconfirmed or unavailable methods and a connection error are re-checked automatically: when
  // the network returns, when Alpha comes back to the front, and every 15 seconds. No Retry button.
  const recheck = view.step === 'choose' && (methodsUnconfirmed || !!error || !!pending || (!google && !phone && !emailEnabled));
  useEffect(() => {
    if (!recheck) return;
    const run = () => { if (!document.hidden) actions.retry(); };
    const timer = setInterval(run, 15000);
    window.addEventListener('online', run); document.addEventListener('visibilitychange', run);
    return () => { clearInterval(timer); window.removeEventListener('online', run); document.removeEventListener('visibilitychange', run); };
  }, [recheck, actions]);
  const wait = view.step === 'code' ? Math.max(0, Math.ceil((view.resendAt - now) / 1000)) : 0;
  // One field: an address with @ is email; a number with its country code is a phone.
  const submitAddress = (event: FormEvent) => {
    event.preventDefault();
    const value = (address.current?.value || '').trim(), digits = value.replace(/[\s().-]/g, '');
    if (emailEnabled && value.includes('@')) { setAddressError(''); actions.email(value); return; }
    if (phone && /^\+?\d{7,15}$/.test(digits)) {
      if (!digits.startsWith('+')) { setAddressError('Add the country code, for example +1 415 555 0100.'); return; }
      setAddressError(''); actions.phone?.(digits); return;
    }
    setAddressError(phone && emailEnabled ? 'Enter an email or a phone number.' : phone ? 'Enter a phone number with its country code.' : 'Enter a valid email address.');
  };
  const submitCode = (event: FormEvent) => { event.preventDefault(); const input = code.current; const value = input?.value || ''; if (input) input.value = ''; actions.verify(value); };
  // A connection failure on the method choice is re-checked automatically: say so, not an alert.
  const held = view.step === 'choose' && !!pending, locked = busy || held;
  const waiting = view.step === 'choose' && !held && (error === SIGN_IN_WAITING || (!google && !phone && !emailEnabled));
  const back = view.step !== 'choose' || canGoBack || busy;
  return <>
    <header><h1 id="cloud-sign-in-title" className="serif">{view.step === 'code' ? view.phone ? 'Check your messages' : 'Check your email' : 'Sign in'}</h1></header>
    {view.step === 'choose' && <>
      {google && <div className="alpha-connection-actions"><button className="alpha-cloud-sign-in-google" disabled={locked} onClick={actions.google}>{held && pending === 'google' ? SIGN_IN_WAITING : 'Continue with Google'}</button></div>}
      {google && (emailEnabled || phone) && <div className="alpha-cloud-sign-in-or" aria-hidden="true">or</div>}
      {(emailEnabled || phone) && <form className="alpha-cloud-sign-in-email" aria-label="Sign in with email or phone" onSubmit={submitAddress}>
        <input ref={address} aria-label={emailEnabled && phone ? 'Email or phone number' : phone ? 'Phone number' : 'Email'} placeholder={emailEnabled && phone ? 'Email or phone number' : phone ? 'Phone number' : 'Email'} name="username" autoComplete={phone && !emailEnabled ? 'tel' : 'username'} autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode={phone && !emailEnabled ? 'tel' : 'email'} maxLength={320} required disabled={locked} onInput={() => setAddressError('')}
          aria-invalid={!!addressError || undefined} aria-describedby={addressError ? ADDRESS_ERROR_ID : undefined} />
        {addressError && <p id={ADDRESS_ERROR_ID} role="alert" className="alpha-connection-error">{addressError}</p>}
        <button disabled={locked}>{held && pending !== 'google' ? SIGN_IN_WAITING : 'Continue'}</button>
      </form>}
    </>}
    {(view.step === 'code' || view.step === 'mfa') && <form className="alpha-cloud-sign-in-code" aria-label={view.step === 'code' ? view.phone ? 'Enter your phone code' : 'Enter your email code' : 'Enter your verification code'} onSubmit={submitCode}>
      {view.step === 'code' && <p>Enter the code sent to <strong>{view.phone || view.email}</strong></p>}
      {view.step === 'mfa' && <p>{view.method === 'totp' ? 'Enter your authenticator code.' : view.method === 'sms' ? 'Enter your text-message code.' : 'This verification method is unavailable.'}</p>}
      {(view.step === 'code' || view.method !== 'passkey') && <>
        <input ref={code} aria-label="Six-digit code" placeholder="000000" name="one-time-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 -]{6,9}" maxLength={9} required disabled={busy}
          onInput={event => { const digits = event.currentTarget.value.replace(/\D/g, ''); if (digits.length === 6) event.currentTarget.form?.requestSubmit(); }} />
      </>}
      {view.step === 'code' && <button type="button" disabled={busy || wait > 0} onClick={actions.resend}>{wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}</button>}
    </form>}
    {message && <p role="status">{message}</p>}
    {waiting && <p role="status">{SIGN_IN_WAITING}</p>}
    {error && error !== SIGN_IN_WAITING && <p role="alert" className="alpha-connection-error">{error}</p>}
    {(back || (view.step === 'choose' && extra)) && <div className="alpha-connection-actions">
      {view.step === 'choose' && extra}
      {back && <button className="alpha-connection-cancel" onClick={!busy && view.step !== 'choose' && actions.back ? actions.back : actions.cancel}>{busy ? 'Cancel sign-in' : 'Back'}</button>}
    </div>}
  </>;
}
