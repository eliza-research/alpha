import { testMocksEnabled } from '../build-flags';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { errorClassOf, recordRendererFailure, type RendererFailureKind } from './crash-log';

declare const __APP_VERSION__: string;

/**
 * Diagnostics deliberately exclude error messages, stacks, URLs and storage: any of
 * them can carry note text, addresses or account data. Only the failure class is kept.
 */
export function recoveryDiagnostics(kind: RendererFailureKind, error: unknown): string {
  const name = errorClassOf(error);
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown';
  const platform = document.documentElement.classList.contains('native-phone') ? 'android' : 'web';
  return [`failure: ${kind}`, `error: ${name}`, `version: ${version}`, `platform: ${platform}`, `time: ${new Date().toISOString()}`].join('\n');
}

const recoveryStyle = {
  // The panel centres with auto margins inside a scrolling screen: with large text, an open
  // diagnostics block or a landscape window, the content scrolls instead of being cut off.
  screen: 'position:fixed;inset:0;z-index:2147483000;display:flex;overflow:auto;padding:24px;box-sizing:border-box;background:#f7f7f7;color:#171717;font:16px/1.5 system-ui,sans-serif',
  panel: 'max-width:380px;width:100%;margin:auto',
  button: 'min-height:48px;width:100%;margin:16px 0 8px;border:0;border-radius:24px;background:#171717;color:#fff;font:inherit;font-weight:600',
  pre: 'white-space:pre-wrap;font:12px/1.4 ui-monospace,monospace;background:#ececec;padding:12px;border-radius:12px',
};

/**
 * A modal <dialog> lives in the top layer: it paints over the recovery screen and makes it inert,
 * so Reload could be neither seen, focused nor announced until the orphaned dialog was dismissed.
 * Closing is each dialog's cancel path; nothing is confirmed on the user's behalf.
 */
function takeOverFromOpenDialogs(): void {
  for (const dialog of Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'))) {
    try { dialog.close(); } catch { /* A dialog that cannot close is removed with its tree on reload. */ }
    // A dialog whose close handler failed with the app would still cover recovery.
    if (dialog.open) dialog.remove();
  }
  document.querySelector<HTMLElement>('.alpha-recovery button')?.focus();
}

let shown = false;
/** Plain DOM so recovery still works when React itself failed to mount. */
export function showRecoveryScreen(kind: RendererFailureKind, error: unknown): void {
  if (shown) return;
  shown = true;
  // The failure class survives the reload in the local problem log (Settings > About).
  void recordRendererFailure(kind, error);
  const screen = document.createElement('div');
  screen.className = 'alpha-recovery';
  screen.setAttribute('role', 'alertdialog');
  screen.setAttribute('aria-labelledby', 'alpha-recovery-title');
  screen.style.cssText = recoveryStyle.screen;
  const panel = document.createElement('div'); panel.style.cssText = recoveryStyle.panel;
  const title = document.createElement('h1'); title.id = 'alpha-recovery-title'; title.textContent = 'Alpha Phone needs to reload';
  const text = document.createElement('p'); text.textContent = 'Something went wrong while showing this screen. Reload to continue.';
  const reload = document.createElement('button'); reload.type = 'button'; reload.textContent = 'Reload'; reload.style.cssText = recoveryStyle.button; reload.onclick = () => location.reload();
  const details = document.createElement('details');
  const summary = document.createElement('summary'); summary.textContent = 'Diagnostics';
  const pre = document.createElement('pre'); pre.style.cssText = recoveryStyle.pre; pre.textContent = recoveryDiagnostics(kind, error);
  details.append(summary, pre);
  panel.append(title, text, reload, details);
  screen.append(panel);
  // Whatever was on screen is no longer usable: keep focus and assistive technology in the dialog.
  for (const sibling of Array.from(document.body.children)) if (sibling instanceof HTMLElement && !sibling.matches('script,style,link')) sibling.inert = true;
  document.body.append(screen);
  takeOverFromOpenDialogs();
}

function appMounted(): boolean {
  const root = document.getElementById('root');
  return !!root && root.childElementCount > 0 && !root.hasAttribute('role');
}

let installed = false;
/**
 * Uncaught failures before the app has rendered leave a blank page; show recovery.
 * After mount, individual feature errors are handled by their own UI, and a fatal
 * render failure is caught by RootErrorBoundary instead.
 */
export function installGlobalErrorRecovery(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', event => {
    // Resource load failures are not script errors.
    if (!(event instanceof ErrorEvent) || (!event.error && !event.message)) return;
    if (!appMounted()) showRecoveryScreen('startup', event.error);
  });
  window.addEventListener('unhandledrejection', event => {
    if (!appMounted()) showRecoveryScreen('startup', event.reason);
  });
  if (testMocksEnabled) window.addEventListener('alpha:force-render-error', () => { forced = true; window.dispatchEvent(new Event('alpha:render-error-check')); });
}

let forced = false;
/** Test hook only reachable by dispatching a DOM event; it never alters data. */
function ForcedFailure({ children }: { children: ReactNode }) {
  // React retries a failed render once, so the flag stays set until the boundary catches it.
  if (forced) throw new Error('Forced render failure');
  return <>{children}</>;
}

export class RootErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; diagnostics: string; tick: number }> {
  state = { failed: false, diagnostics: '', tick: 0 };
  private check = () => this.setState(current => ({ tick: current.tick + 1 }));
  static getDerivedStateFromError(error: unknown) { return { failed: true, diagnostics: recoveryDiagnostics('render', error) }; }
  componentDidMount() { if (testMocksEnabled) window.addEventListener('alpha:render-error-check', this.check); }
  componentWillUnmount() { if (testMocksEnabled) window.removeEventListener('alpha:render-error-check', this.check); }
  componentDidCatch(error: unknown, _info: ErrorInfo) { forced = false; void recordRendererFailure('render', error); /* Diagnostics exclude component stacks and messages. */ takeOverFromOpenDialogs(); }
  render() {
    if (!this.state.failed) return testMocksEnabled ? <ForcedFailure>{this.props.children}</ForcedFailure> : this.props.children;
    return <div className="alpha-recovery" role="alertdialog" aria-labelledby="alpha-recovery-title" style={{ position: 'fixed', inset: 0, zIndex: 2147483000, display: 'flex', overflow: 'auto', padding: 24, boxSizing: 'border-box', background: '#f7f7f7', color: '#171717', font: '16px/1.5 system-ui,sans-serif' }}>
      <div style={{ maxWidth: 380, width: '100%', margin: 'auto' }}>
        <h1 id="alpha-recovery-title">Alpha Phone needs to reload</h1>
        <p>Something went wrong while showing this screen. Reload to continue.</p>
        <button type="button" autoFocus onClick={() => location.reload()} style={{ minHeight: 48, width: '100%', margin: '16px 0 8px', border: 0, borderRadius: 24, background: '#171717', color: '#fff', font: 'inherit', fontWeight: 600 }}>Reload</button>
        <details><summary>Diagnostics</summary><pre style={{ whiteSpace: 'pre-wrap', font: '12px/1.4 ui-monospace,monospace', background: '#ececec', padding: 12, borderRadius: 12 }}>{this.state.diagnostics}</pre></details>
      </div>
    </div>;
  }
}
