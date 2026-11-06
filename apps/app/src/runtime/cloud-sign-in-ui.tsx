import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { SignInView } from './connection-ui';

/**
 * Alpha's own Eliza Cloud sign-in screens: Google (a Custom Tab that returns to Alpha), or an email
 * code typed here, then a second verification when the account has one. No Eliza Cloud web page.
 * Codes go straight to the controller and are never kept in component state after submission.
 */
export interface CloudSignInActions {
  phone?(number: string): void; google(): void; email(address: string): void; verify(code: string): void; resend(): void; retry(): void; cancel(): void;
}
export function CloudSignInPanel({ view, busy, google, phone, emailEnabled = true, message, error, actions, extra, canGoBack = true, methodsUnconfirmed = false }: {
  view: SignInView; busy: boolean; google: boolean; phone?: boolean; emailEnabled?: boolean; message: string; error: string; actions: CloudSignInActions;
  /** Optional hosted sign-in entry supplied by the caller's build gate. */
  extra?: ReactNode;
  canGoBack?: boolean;
  methodsUnconfirmed?: boolean;
}) {
  const phoneInput = useRef<HTMLInputElement>(null);
  const email = useRef<HTMLInputElement>(null), code = useRef<HTMLInputElement>(null);
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
    if (!busy) (view.step === 'code' || view.step === 'mfa' ? code : view.step === 'choose' ? emailEnabled ? email : phone ? phoneInput : null : null)?.current?.focus();
  }, [view.step, busy, emailEnabled, phone]);
  const wait = view.step === 'code' ? Math.max(0, Math.ceil((view.resendAt - now) / 1000)) : 0;
  const submitCode = (event: FormEvent) => { event.preventDefault(); const input = code.current; const value = input?.value || ''; if (input) input.value = ''; actions.verify(value); };
  return <>
    <header><h1 id="cloud-sign-in-title" className="serif">Sign in</h1></header>
    {view.step === 'choose' && <>
      {!google && !phone && !emailEnabled && <p role="status">Sign-in is unavailable. Try again later.</p>}
      {google && <div className="alpha-connection-actions"><button disabled={busy} onClick={actions.google}>Continue with Google</button></div>}
      {emailEnabled && <form className="alpha-cloud-sign-in-email" aria-label="Sign in with email" onSubmit={event => { event.preventDefault(); actions.email(email.current?.value || ''); }}>
        <label>Email<input ref={email} type="email" name="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" maxLength={320} required disabled={busy} /></label>
        <button disabled={busy}>Email me a code</button>
      </form>}
      {phone && <form aria-label="Sign in with phone" onSubmit={event => { event.preventDefault(); actions.phone?.(phoneInput.current?.value || ''); }}>
        <label>Phone number with country code<input ref={phoneInput} type="tel" name="phone" autoComplete="tel" placeholder="+14155550100" maxLength={16} required disabled={busy} /></label>
        <button disabled={busy}>Text me a code</button>
      </form>}
    </>}
    {(view.step === 'code' || view.step === 'mfa') && <form className="alpha-cloud-sign-in-code" aria-label={view.step === 'code' ? view.phone ? 'Enter your phone code' : 'Enter your email code' : 'Enter your verification code'} onSubmit={submitCode}>
      {view.step === 'code' && <p>Code sent to <strong>{view.phone || view.email}</strong>.</p>}
      {view.step === 'mfa' && <p>{view.method === 'totp' ? 'Enter your authenticator code.' : view.method === 'sms' ? 'Enter your text-message code.' : 'This verification method is unavailable.'}</p>}
      {(view.step === 'code' || view.method !== 'passkey') && <>
        <label>Six-digit code<input ref={code} name="one-time-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 -]{6,9}" maxLength={9} required disabled={busy} /></label>
        <button disabled={busy}>Verify</button>
      </>}
      {view.step === 'code' && <button type="button" disabled={busy || wait > 0} onClick={actions.resend}>{wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}</button>}
    </form>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="alpha-connection-error">{error}</p>}
    <div className="alpha-connection-actions">
      {view.step === 'choose' && (error || methodsUnconfirmed || (!google && !phone && !emailEnabled)) && <button disabled={busy} onClick={actions.retry}>Retry</button>}
      {(view.step !== 'choose' || canGoBack || busy) && <button className="alpha-connection-cancel" onClick={actions.cancel}>{view.step === 'choose' && !busy ? 'Back' : 'Cancel sign-in'}</button>}
      {view.step === 'choose' && extra}
    </div>
  </>;
}
