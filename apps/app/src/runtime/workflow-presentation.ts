import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Workflow device protocol this renderer registers: 2 adds foreground presentation, 3 adds the
 * selected-reminders read (served by the reminder list every presentation-capable build has).
 */
export async function workflowDeviceProtocol(signal: AbortSignal): Promise<1 | 3> {
  return (await workflowPresentationProtocol(signal)) === 2 ? 3 : 1;
}
/**
 * Registers with `protocol`, and once more at protocol 2 when an agent that predates the
 * selected-reminders read refuses protocol 3 (its device routes answer a rejected request with
 * HTTP 409). Any other failure (sign-in, network, server, or an error carrying no HTTP status) is not retried, so a transient fault
 * never downgrades the enrollment. Registration is idempotent for the same device.
 */
export async function registerWorkflowDevice<T>(protocol: 1 | 2 | 3, register: (protocol: 1 | 2 | 3) => Promise<T>, signal: AbortSignal): Promise<{ registered: T; workflowProtocol: 1 | 2 | 3 }> {
  try { return { registered: await register(protocol), workflowProtocol: protocol }; }
  catch (error) {
    signal.throwIfAborted();
    const status = error && typeof error === 'object' ? Reflect.get(error, 'status') : undefined;
    if (protocol !== 3 || status !== 409) throw error;
    return { registered: await register(2), workflowProtocol: 2 };
  }
}
/** Probe installed bridge code, not permissions or model readiness. Older APKs remain protocol 1. */
export async function workflowPresentationProtocol(signal: AbortSignal): Promise<1 | 2> {
  signal.throwIfAborted();
  if (!Capacitor.isNativePlatform()) return 2;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  try {
    const probes = Promise.all(['AlphaNotifications', 'AlphaVoiceCloud'].map(name =>
      registerPlugin<{workflowPresentationCapabilities(): Promise<{protocol?: unknown}>}>(name).workflowPresentationCapabilities()));
    const result = await Promise.race([
      probes,
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 2000); }),
      new Promise<never>((_, reject) => { cancel = () => reject(signal.reason); signal.addEventListener('abort', cancel, {once:true}); if(signal.aborted)cancel(); }),
    ]);
    signal.throwIfAborted();
    return result?.every(value => value?.protocol === 2) ? 2 : 1;
  } catch { signal.throwIfAborted(); return 1; }
  finally { clearTimeout(timer); if(cancel)signal.removeEventListener('abort',cancel); }
}
