import type {CloudServiceInfo} from './cloud-service-info';
import {cloudServiceName, type CloudEnvironment} from './cloud-protocol';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { SignInView } from './connection-ui';

/**
 * Alpha's own Eliza Cloud sign-in screens: Google (Android's native account picker), or an email
 * code typed here, then a second verification when the account has one. No Eliza Cloud web page.
 * Codes stay in the input while verification is pending or can be retried. They are never stored
 * outside the form, and a different attempt or verification step replaces the input.
 */
export interface CloudSignInActions {
  phone?(number: string): void; google(): void; email(address: string): void; verify(code: string): void; resend(): void; cancel(): void;
}
export function AlphaAuthBrand() {
  return <div className="alpha-auth-brand"><span className="alpha-auth-mark" aria-hidden="true"/><span className="serif">Alpha</span></div>;
}
export function CloudSignInPanel({ view, busy, google, phone, emailEnabled = true, serviceLoader, message, error, errorIsNotice = false, actions, extra, ready = true, dismissible = true }: {
  view: SignInView; busy: boolean; google: boolean; phone?: boolean; emailEnabled?: boolean; serviceLoader?: (environment: CloudEnvironment) => Promise<CloudServiceInfo>; message: string; error: string; actions: CloudSignInActions;
  errorIsNotice?: boolean;
  /** Optional hosted sign-in entry supplied by the caller's build gate. */
  extra?: ReactNode;
  /** The native readiness probe has admitted this attempt. */
  ready?: boolean;
  /** Required first-run sign-in has no screen to go Back to. */
  dismissible?: boolean;
}) {
  const [service,setService]=useState<CloudServiceInfo|null>(null),[serviceError,setServiceError]=useState(false),[retry,setRetry]=useState(0);
  const [legal,setLegal]=useState<'terms'|'privacy'|null>(null);
  const googleButton=useRef<HTMLButtonElement>(null);
  const legalHeading=useRef<HTMLHeadingElement>(null),legalTrigger=useRef<HTMLButtonElement|null>(null);
  useEffect(()=>{
    let current=true;setService(null);setServiceError(false);setLegal(null);
    if(serviceLoader)void serviceLoader(view.environment).then(value=>{if(current)setService(value);},()=>{if(current)setServiceError(true);});
    return ()=>{current=false;};
  },[serviceLoader,view.environment,retry]);
  useEffect(()=>{if(legal)legalHeading.current?.focus();else legalTrigger.current?.focus();},[legal]);
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
    if (!busy) (view.step === 'code' || view.step === 'mfa' ? code : view.step === 'choose' ? google ? googleButton : emailEnabled ? email : phoneInput : null)?.current?.focus();
  }, [view.step, busy, google, emailEnabled, phone]);
  const wait = view.step === 'code' ? Math.max(0, Math.ceil((view.resendAt - now) / 1000)) : 0;
  const sending = message === 'Sending your code…';
  // The code is verified; the account is being admitted (connection-ui residentSignedIn).
  const signingIn = message === 'Signing in…';
  const inlineStatus = busy && ((view.step === 'choose' && ready && sending) || ((view.step === 'code' || view.step === 'mfa') && (sending || signingIn || message === 'Checking your code…')));
  const submitCode = (event: FormEvent) => { event.preventDefault(); if (!busy && ready) actions.verify(code.current?.value || ''); };
  return <>
    <AlphaAuthBrand/>
    <header><h1 id="cloud-sign-in-title" className="serif">{view.step === 'choose' ? 'Welcome to Alpha.' : view.step === 'google' ? 'Continue with Google' : 'Check your code.'}</h1></header>
    <div hidden={legal !== null}>
    {view.step === 'choose' && <>
      {!google && !phone && !emailEnabled && <p role="status">This service offers no sign-in method supported by this app. Contact the service administrator.</p>}
      <p className="alpha-auth-intro">Use your {service?.name || cloudServiceName(view.environment)} account to sign in. Your agent runs on this device.</p>
      <p role="note">Sign in to verify your account. You’ll review access before authorizing Alpha Phone.</p>
      {ready && !google && <p id="alpha-google-unavailable" role="status">Google sign-in is unavailable. Use another sign-in method below.</p>}
      <div className="alpha-connection-actions alpha-auth-google"><button ref={googleButton} disabled={busy || !ready || !google} onClick={actions.google}><span aria-hidden="true" className="alpha-google-icon"/>Continue with Google</button></div>
      {emailEnabled && <form className="alpha-cloud-sign-in-email" aria-label="Sign in with email" onSubmit={event => { event.preventDefault(); actions.email(email.current?.value || ''); }}>
        <label>Email<input ref={email} type="email" name="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" maxLength={320} required disabled={busy || !ready} /></label>
        <button disabled={busy || !ready}>{busy && sending ? 'Sending code…' : 'Email me a code'}</button>
      </form>}
      {phone && <form aria-label="Sign in with phone" onSubmit={event => { event.preventDefault(); actions.phone?.(phoneInput.current?.value || ''); }}>
        <label>Phone number with country code<input ref={phoneInput} type="tel" name="phone" autoComplete="tel" placeholder="+14155550100" maxLength={16} required disabled={busy || !ready} /></label>
        <button disabled={busy || !ready}>Text me a code</button>
      </form>}
    </>}
    {view.step === 'google' && <p>Choose your Google account in the Android sign-in sheet. Alpha will finish signing you in.</p>}
    {(view.step === 'code' || view.step === 'mfa') && <form key={`${view.step}:${view.attemptId}`} className="alpha-cloud-sign-in-code" aria-busy={busy || undefined} aria-label={view.step === 'code' ? view.phone ? 'Enter your phone code' : 'Enter your email code' : 'Enter your verification code'} onSubmit={submitCode}>
      {view.step === 'code' && <p>Enter the six-digit code sent to <strong>{view.phone || view.email}</strong>.</p>}
      {view.step === 'mfa' && <p>{view.method === 'totp' ? 'This account uses an authenticator app. Enter its six-digit code.' : view.method === 'sms' ? 'Enter the six-digit code sent to your phone.' : 'This account’s second verification is not available in Alpha yet.'}</p>}
      {(view.step === 'code' || view.method !== 'passkey') && <>
        <label>Six-digit code<input ref={code} name="one-time-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 -]{6,9}" maxLength={9} required disabled={busy} /></label>
        <button className="alpha-auth-submit" aria-live="polite" aria-busy={busy || undefined} disabled={busy}>{busy ? sending ? 'Sending code…' : signingIn ? 'Signing in…' : 'Checking code…' : 'Verify'}</button>
      </>}
      {view.step === 'code' && <button type="button" disabled={busy || wait > 0} onClick={actions.resend}>{wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}</button>}
    </form>}
    {message && !inlineStatus && <p role="status">{message}</p>}
    {error && <p role={errorIsNotice ? 'status' : 'alert'} className={errorIsNotice ? 'alpha-auth-notice' : 'alpha-connection-error'}>{error}</p>}
    <div className="alpha-connection-actions">
      {(dismissible || view.step !== 'choose' || busy) && <button type="button" className="alpha-connection-cancel" onClick={actions.cancel}>{view.step === 'choose' && !busy ? 'Back' : 'Cancel sign-in'}</button>}
      {view.step === 'choose' && extra}
    </div>
    {service && <p><button type="button" disabled={busy} onClick={event=>{legalTrigger.current=event.currentTarget;setLegal('terms');}}>Terms of Service</button> and <button type="button" disabled={busy} onClick={event=>{legalTrigger.current=event.currentTarget;setLegal('privacy');}}>Privacy Policy</button>.</p>}
    {serviceError && <p role="status">Service information is unavailable. <button type="button" disabled={busy} onClick={()=>setRetry(value=>value+1)}>Retry service information</button></p>}
    </div>
    {legal && service && <section aria-labelledby="cloud-legal-title" className="alpha-cloud-legal">
      <button type="button" onClick={()=>setLegal(null)}>Back to sign-in</button>
      <h2 id="cloud-legal-title" tabIndex={-1} ref={legalHeading}>{service[legal].title}</h2>
      <p>{service.name} · Revision {service[legal].revision}</p>
      {service[legal].sections.map((section,index)=><section key={index}><h3>{section.title}</h3>{section.paragraphs.map((paragraph,i)=><p key={i} style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{paragraph}</p>)}</section>)}
      <button type="button" onClick={()=>setLegal(null)}>Return to sign-in</button>
    </section>}
  </>;
}
