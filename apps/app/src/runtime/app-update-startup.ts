type Activation = { activationId: string; bridgeId: string };
type StartupPort = {
  updateState(): Promise<unknown>;
  activateUpdate(input: Activation & { ready: true }): Promise<unknown>;
  continueUpdate(input: Activation): Promise<unknown>;
};

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const identity = (value: unknown): value is string => typeof value === 'string' && uuid.test(value);

/** Bundled older hosts have no update journal. An advertised journal must answer. */
export function supportsAppUpdateStartup(headers: unknown): boolean {
  return Array.isArray(headers) && headers.some(header =>
    header?.name === 'AlphaDevice' && Array.isArray(header.methods) &&
    header.methods.some((method: { name?: unknown }) => method?.name === 'updateState'));
}

/** A newly created WebView has no mounted editors. It can acknowledge its own
 * preparation, then hold the mount until the installer no longer owns a pause. */
export async function waitForAppUpdateStartup(
  port: Pick<StartupPort, 'updateState' | 'activateUpdate'>,
  wait = () => new Promise<void>(resolve => setTimeout(resolve, 1000)),
  confirmation?: (pending: Activation | undefined) => void,
): Promise<void> {
  let pending: Activation | undefined;
  let acknowledged: string | undefined;
  for (;;) {
    const state = await port.updateState().catch(() => undefined);
    let resumable: Activation | undefined;
    if (state && typeof state === 'object' && 'bridgeId' in state && identity(state.bridgeId)) {
      if ('pending' in state && state.pending === false) {
        if (!pending || (
          state.bridgeId === pending.bridgeId &&
          'activationId' in state && state.activationId === pending.activationId &&
          'outcome' in state && (state.outcome === 'canceled' || state.outcome === 'failed' || state.outcome === 'installed')
        )) return;
      }
      if ('pending' in state && state.pending === true &&
          'activationId' in state && identity(state.activationId) &&
          'phase' in state && (state.phase === 'preparing' || state.phase === 'paused') &&
          (!pending || pending.bridgeId === state.bridgeId)) {
        pending = { activationId: state.activationId, bridgeId: state.bridgeId };
        if (state.phase === 'paused' && 'canContinue' in state && state.canContinue === true) resumable = pending;
        if (state.phase === 'preparing' && acknowledged !== pending.activationId) {
          acknowledged = pending.activationId;
          // A late readiness can be rejected after seal or cancellation. Read
          // the exact native state again, without replaying this acknowledgment.
          await port.activateUpdate({ ...pending, ready: true }).catch(() => {});
        }
      }
    }
    confirmation?.(resumable);
    await wait();
  }
}

/** Keep the Android confirmation reachable without starting any draft owner. */
export async function holdAppUpdateStartup(port: StartupPort, root: HTMLElement): Promise<void> {
  const panel = document.createElement('div');
  panel.className = 'alpha-update-startup';
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  status.textContent = 'Updating Alpha…';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Continue update';
  panel.append(status, button);
  let current: Activation | undefined;
  button.onclick = async () => {
    if (!current || button.disabled) return;
    button.disabled = true;
    try { await port.continueUpdate(current); } catch { /* Read the exact native state again. */ }
    finally { button.disabled = false; }
  };
  try {
    await waitForAppUpdateStartup(port, undefined, activation => {
      current = activation;
      button.hidden = !current;
      if (!panel.isConnected) root.append(panel);
    });
  } finally {
    panel.remove();
  }
}
