/** Transient speech only. No chat rows, agent request, provider selection or record store. */
export interface BatchProgressCue {
  turnId: string;
  conversationId: string;
  ownerId: string;
  kind: 'thinking' | 'running_action' | 'running_tool';
  label?: string;
  actionName?: string;
  toolName?: string;
}
export const batchVoiceProgressEvents = new EventTarget();
export const batchVoiceReplyEvents = new EventTarget();
export function emitBatchReply(binding: ReturnType<typeof batchProgressBinding>): void {
  if (binding) batchVoiceReplyEvents.dispatchEvent(new CustomEvent('reply', { detail: Object.freeze({ ...binding }) }));
}
/** Correlation comes from the actual already-dispatched local stream request, not status prose. */
export function batchProgressBinding(request?: { path: string; ownerId: string; body: string }):
  Pick<BatchProgressCue, 'turnId' | 'conversationId' | 'ownerId'> | undefined {
  if (!request || typeof request.body !== 'string' || request.body.length > 200000 ||
      typeof request.ownerId !== 'string' || !request.ownerId.trim() || request.ownerId.length > 128) return;
  const conversation = /^\/api\/conversations\/([a-f0-9-]{36})\/messages\/stream$/i.exec(request.path)?.[1];
  if (!conversation) return;
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  if (!uuid.test(conversation)) return;
  try {
    const body = JSON.parse(request.body);
    if (body?.channelType !== 'VOICE_DM' || typeof body.clientMessageId !== 'string' || !uuid.test(body.clientMessageId)) return;
    return { turnId: body.clientMessageId, conversationId: conversation, ownerId: request.ownerId };
  } catch { return; }
}
export function emitBatchProgress(binding: ReturnType<typeof batchProgressBinding>, status: Record<string, unknown>): void {
  if (!binding || !['thinking', 'running_action', 'running_tool'].includes(String(status.kind))) return;
  const cue: BatchProgressCue = { ...binding, kind: status.kind as BatchProgressCue['kind'],
    ...(typeof status.label === 'string' ? { label: status.label } : {}),
    ...(typeof status.actionName === 'string' ? { actionName: status.actionName } : {}),
    ...(typeof status.toolName === 'string' ? { toolName: status.toolName } : {}) };
  if (genuineBatchProgress(cue)) batchVoiceProgressEvents.dispatchEvent(new CustomEvent('progress', { detail: Object.freeze(cue) }));
}
export function genuineBatchProgress(value: BatchProgressCue): boolean {
  const bounded = (text: unknown) => typeof text === 'string' && !!text.trim() && text.length <= 160;
  return value.kind === 'thinking' ? bounded(value.label) : value.kind === 'running_action'
    ? bounded(value.actionName) : value.kind === 'running_tool' && bounded(value.toolName);
}
export function createBatchProgressAcknowledgment(input: {
  turnId: string; conversationId: string; ownerId: string;
  signal: AbortSignal;
  assertCurrent(): void;
  captureRetired(): boolean;
  /** Existing selected speech facade; settles only after matching playback/media cleanup. */
  speak(text: string, signal: AbortSignal): Promise<void>;
}) {
  const cue = new AbortController();
  let used = false, final = false, retired = false;
  let pending: Promise<void> = Promise.resolve();
  const check = () => { input.signal.throwIfAborted(); input.assertCurrent(); };
  const cancel = () => { retired = true; cue.abort(input.signal.reason ?? new DOMException('Voice cue retired.', 'AbortError')); };
  input.signal.addEventListener('abort', cancel, { once: true });
  if (input.signal.aborted) cancel();
  const preempt = () => { final = true; cue.abort(new DOMException('Final voice reply superseded its cue.', 'AbortError')); };
  return {
    progress(value: BatchProgressCue): void {
      if (used || final || retired || cue.signal.aborted || !genuineBatchProgress(value) ||
          value.turnId !== input.turnId || value.conversationId !== input.conversationId || value.ownerId !== input.ownerId)
        return;
      try { check(); if (!input.captureRetired()) return; } catch { cancel(); return; }
      used = true;
      // One microtask lets an already-ready final/token preempt queued prospective speech.
      pending = Promise.resolve().then(async () => {
        if (final || retired || cue.signal.aborted) return;
        check();
        if (!input.captureRetired()) throw Error('Voice capture was not retired before acknowledgement.');
        try { await input.speak('On it.', cue.signal); }
        catch (error) {
          // Normal selected playback may reject AbortError AFTER confirmed cleanup.
          // Unconfirmed cleanup/provider errors are not hidden or converted into permission to listen.
          if (!(cue.signal.aborted && error instanceof Error && error.name === 'AbortError')) throw error;
        }
      });
      void pending.catch(() => {});
    },
    replyStarted(): void { preempt(); },
    async finish(): Promise<void> {
      preempt();
      try { await pending; check(); }
      finally { input.signal.removeEventListener('abort', cancel); }
    },
    async stop(): Promise<void> {
      cancel();
      try { await pending; }
      finally { input.signal.removeEventListener('abort', cancel); }
    },
  };
}
