import { Capacitor, registerPlugin } from '@capacitor/core';

import { PHONE_WORKFLOW_CALENDAR_ANCHOR_PROTOCOL } from '../../../../.eliza/client-features/packages/contracts/src/phone-workflow.ts';

export type WorkflowDeviceProtocol = 1 | 2 | 3 | 4 | typeof PHONE_WORKFLOW_CALENDAR_ANCHOR_PROTOCOL;

/** Presentation-capable phones can also verify a Calendar range against the persisted run time. */
export async function workflowDeviceProtocol(signal: AbortSignal): Promise<1 | typeof PHONE_WORKFLOW_CALENDAR_ANCHOR_PROTOCOL> {
  return (await workflowPresentationProtocol(signal)) === 2 ? PHONE_WORKFLOW_CALENDAR_ANCHOR_PROTOCOL : 1;
}

const olderWorkflowProtocol: Partial<Record<WorkflowDeviceProtocol, WorkflowDeviceProtocol>> = {
  [PHONE_WORKFLOW_CALENDAR_ANCHOR_PROTOCOL]: 4,
  4: 3,
  3: 2,
};

/** HTTP 409 permits a compatibility attempt for the same device. Protocol 4 keeps older
 * relative Calendar reviews available. Other failures leave the enrollment unresolved. */
export async function registerWorkflowDevice<T>(protocol: WorkflowDeviceProtocol, register: (protocol: WorkflowDeviceProtocol) => Promise<T>, signal: AbortSignal): Promise<{ registered: T; workflowProtocol: WorkflowDeviceProtocol }> {
  for (;;) {
    signal.throwIfAborted();
    try {
      const registered = await register(protocol);
      signal.throwIfAborted();
      return { registered, workflowProtocol: protocol };
    } catch (error) {
      signal.throwIfAborted();
      const status = error && typeof error === 'object' ? Reflect.get(error, 'status') : undefined;
      const older = olderWorkflowProtocol[protocol];
      if (status !== 409 || older === undefined) throw error;
      protocol = older;
    }
  }
}
/** Probe installed bridge code, not permissions or model readiness. Older APKs, whose bridge lacks
 * the method, remain protocol 1. A stalled bridge is probed once more; if it still stalls this call answers 1
 * without remembering it, so the next connect probes again. A protocol 2 answer is kept for the process.
 */
export async function workflowPresentationProtocol(signal: AbortSignal): Promise<1 | 2> {
  signal.throwIfAborted();
  if (!Capacitor.isNativePlatform() || presentationReady) return 2;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await probePresentation(signal);
    if (result === 'stalled') continue;
    if (result === 2) presentationReady = true;
    return result;
  }
  return 1;
}
let presentationReady = false;
async function probePresentation(signal: AbortSignal): Promise<1 | 2 | 'stalled'> {
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
    if (result === null) return 'stalled';
    return result.every(value => value?.protocol === 2) ? 2 : 1;
  } catch { signal.throwIfAborted(); return 1; }
  finally { clearTimeout(timer); if(cancel)signal.removeEventListener('abort',cancel); }
}
