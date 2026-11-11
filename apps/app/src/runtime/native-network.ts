/** A local Android observation, never a Cloud reachability or billing request. Unknown native
 * state must not turn a stale WebView offline hint into a refusal of the owner's message. */
export function readNativeNetwork(read: () => Promise<unknown>, signal?: AbortSignal, timeoutMs = 1500): Promise<boolean | undefined> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (connected?: boolean, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error !== undefined) reject(error); else resolve(connected);
    };
    const abort = () => finish(undefined, signal?.reason ?? new DOMException('Network observation cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(), timeoutMs);
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) { abort(); return; }
    Promise.resolve().then(read).then(value => {
      const connected = value && typeof value === 'object' && 'connected' in value ? value.connected : undefined;
      finish(typeof connected === 'boolean' ? connected : undefined);
    }, () => finish());
  });
}
