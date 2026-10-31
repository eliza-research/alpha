/** Shared browser/native orchestration only. CalendarService remains the record authority. */
export interface GoogleDisconnectLease {
  origin: string;
  ownerId: string;
  agentId: string;
  sessionId: string;
  credentialBinding: string;
  sourceGeneration: string;
}
/** Structural projection of the forthcoming official LifeOpsCalendarSummary field.
 * The verified host/strict canonical decoder supplies it; never derive it here. */
export interface GoogleDisconnectCalendarSource {
  provider: string;
  side: string;
  grantId: string;
  connectorAccountId: string;
  calendarId: string;
  selectionVersion: number;
  managedGoogleConnectionId?: string;
}
export interface GoogleDisconnectControl {
  revision: number;
  paused: boolean;
  destination: { connectorAccountId: string; providerCalendarId: string } | null;
  pendingDispatch: { linkId: string } | null;
}
export interface GoogleDisconnectReview {
  lease: GoogleDisconnectLease;
  control: GoogleDisconnectControl | null;
  sources: readonly GoogleDisconnectCalendarSource[];
}
export interface GoogleDisconnectPauseRequest {
  operation: 'pause';
  expectedRevision: number;
  idempotencyKey: string;
}
export type DisconnectCleanupStatus = 'confirmed' | 'unknown' | 'unavailable' | 'not-applicable';
export interface GoogleDisconnectPorts<T> {
  current(): GoogleDisconnectReview | null;
  /** Cloud privacy binding is independent of optional Calendar cleanup availability.
   * When omitted, existing callers retain their single captured-lease check. */
  privacyCurrent?(): void;
  /** Existing ordinary one-POST + account-readback helper; its transport budget is unchanged. */
  revoke(connectionId: string, signal: AbortSignal): Promise<T>;
  /** Existing canonical updateLinkedCalendarControl, bound to the captured owner/agent. */
  pause?(request: GoogleDisconnectPauseRequest, signal: AbortSignal): Promise<GoogleDisconnectControl>;
  /** Existing source-specific callback retirement only. This is NOT provider drain. */
  retireCallbacks?(connectionId: string): Promise<void>;
}
const leaseFields: readonly (keyof GoogleDisconnectLease)[] =
  ['origin', 'ownerId', 'agentId', 'sessionId', 'credentialBinding', 'sourceGeneration'];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const scoped = /^alpha-google:[a-f0-9]{64}$/;
const aborted = () => new DOMException('The Google disconnect owner or source changed.', 'AbortError');
function sameLease(a: GoogleDisconnectLease, b: GoogleDisconnectLease): boolean {
  return leaseFields.every(key => typeof a[key] === 'string' && a[key].length > 0 && a[key] === b[key]);
}
function destinationKey(control: GoogleDisconnectControl): string {
  return JSON.stringify([control.revision, control.destination?.connectorAccountId,
    control.destination?.providerCalendarId]);
}
function matchedSource(review: GoogleDisconnectReview, connectionId: string): GoogleDisconnectCalendarSource | null {
  const target = review.control?.destination;
  if (!target) return null;
  const rows = review.sources.filter(row => row.connectorAccountId === target.connectorAccountId &&
    row.calendarId === target.providerCalendarId);
  if (rows.length !== 1) return null;
  const row = rows[0];
  return row.provider === 'google' && row.side === 'owner' && scoped.test(row.connectorAccountId) &&
    row.grantId === row.connectorAccountId && Number.isSafeInteger(row.selectionVersion) &&
    row.selectionVersion >= 0 && row.managedGoogleConnectionId === connectionId ? row : null;
}
function observe<T>(work: Promise<T>, milliseconds: number, validate: (value: T) => boolean,
  expired?: () => void): Promise<'confirmed' | 'unknown'> {
  return new Promise(resolve => {
    let done = false;
    const settle = (status: 'confirmed' | 'unknown') => {
      if (done) return;
      done = true; clearTimeout(timer); resolve(status);
    };
    const timer = setTimeout(() => { try { expired?.(); } finally { settle('unknown'); } }, milliseconds);
    // Both branches handle late settlement; no replay or late result publication.
    void work.then(value => {
      try { settle(validate(value) ? 'confirmed' : 'unknown'); } catch { settle('unknown'); }
    }, () => settle('unknown'));
  });
}

/** Cost: at most one local control pause, one ordinary privacy helper invocation,
 * and one callback retirement. No event/link/provider writes, retries or storage. */
export async function disconnectGoogleWithCalendar<T>(input: {
  review: GoogleDisconnectReview;
  connectionId: string;
  pauseKey: string;
  signal: AbortSignal;
  ports: GoogleDisconnectPorts<T>;
  pauseObservationMs?: number;
  retirementObservationMs?: number;
}): Promise<{ privacy: T; calendarPause: DisconnectCleanupStatus; callbackRetirement: DisconnectCleanupStatus;
  providerDrain: 'unavailable'; pauseRequest: GoogleDisconnectPauseRequest | null }> {
  const { ports, connectionId, signal } = input;
  signal.throwIfAborted();
  if (!uuid.test(connectionId)) throw new TypeError('Choose a verified Google connection UUID.');
  // Snapshot only public authority metadata; never retain a mutable review as a lease.
  const lease = { ...input.review.lease };
  const control = input.review.control ? { ...input.review.control,
    destination: input.review.control.destination ? { ...input.review.control.destination } : null,
    pendingDispatch: input.review.control.pendingDispatch ? { ...input.review.control.pendingDispatch } : null } : null;
  const review = { lease, control, sources: input.review.sources.map(source => ({ ...source })) };
  const current = () => {
    signal.throwIfAborted();
    const live = ports.current();
    if (!live || !sameLease(lease, live.lease)) throw aborted();
    return live;
  };
  const privacyCurrent = () => {
    signal.throwIfAborted();
    if (ports.privacyCurrent) ports.privacyCurrent(); else current();
  };
  privacyCurrent();
  const pauseMs = input.pauseObservationMs ?? 3000, retireMs = input.retirementObservationMs ?? 1000;
  if (!Number.isSafeInteger(pauseMs) || pauseMs < 1 || pauseMs > 3000 ||
      !Number.isSafeInteger(retireMs) || retireMs < 1 || retireMs > 1000)
    throw new TypeError('Cleanup observation budgets exceed the reviewed bounds.');
  const target = matchedSource(review, connectionId);
  let pauseRequest: GoogleDisconnectPauseRequest | null = null;
  let pause: Promise<DisconnectCleanupStatus> = Promise.resolve('unavailable');
  let retirement: Promise<DisconnectCleanupStatus> = Promise.resolve('unavailable');
  const pauseController = new AbortController();
  const cancelPause = () => pauseController.abort(signal.reason);
  signal.addEventListener('abort', cancelPause, { once: true });
  try {
    if (ports.retireCallbacks) {
      try {
        privacyCurrent();
        retirement = observe(Promise.resolve(ports.retireCallbacks(connectionId)), retireMs, () => true);
      } catch { retirement = Promise.resolve('unknown'); }
    }
    // Unmapped or unrelated destinations never cause a global or guessed pause.
    if (!control?.destination) pause = Promise.resolve('not-applicable');
    else if (target && ports.pause) {
      // Calendar cleanup is optional: its owner/source loss cannot veto Cloud revoke.
      let live: GoogleDisconnectReview | null = null;
      try { live = current(); } catch { /* stale cleanup remains unavailable */ }
      const liveSource = live ? matchedSource(live, connectionId) : null;
      if (live?.control && Number.isSafeInteger(control.revision) && control.revision >= 0 &&
          input.pauseKey.trim() && input.pauseKey.length <= 512 &&
          destinationKey(live.control) === destinationKey(control) && liveSource &&
          liveSource.selectionVersion === target.selectionVersion) {
        const request: GoogleDisconnectPauseRequest = { operation: 'pause',
          expectedRevision: control.revision, idempotencyKey: input.pauseKey };
        pauseRequest = { ...request };
        try {
          current();
          pause = observe(Promise.resolve(ports.pause(request, pauseController.signal)), pauseMs, result => {
            current(); // Late Calendar results never confirm a retired generation.
            return Number.isSafeInteger(result.revision) && result.revision === control.revision + 1 &&
            result.paused === true && JSON.stringify(result.destination) === JSON.stringify(control.destination) &&
            JSON.stringify(result.pendingDispatch) === JSON.stringify(control.pendingDispatch);
          },
          () => pauseController.abort(new DOMException('Pause outcome is unknown.', 'TimeoutError')));
        } catch { pause = Promise.resolve('unknown'); }
      }
    }
    // Never await local cleanup before starting ordinary privacy revocation.
    privacyCurrent();
    const privacy = await ports.revoke(connectionId, signal);
    let [calendarPause, callbackRetirement] = await Promise.all([pause, retirement]);
    privacyCurrent(); // Only Cloud privacy authority may suppress its completed result.
    if (ports.privacyCurrent && calendarPause === 'confirmed') {
      try { current(); } catch { calendarPause = 'unknown'; }
    }
    return { privacy, calendarPause, callbackRetirement, providerDrain: 'unavailable', pauseRequest };
  } finally {
    signal.removeEventListener('abort', cancelPause);
    // Observers own finite timers/late rejection handlers; no unbounded finally wait.
  }
}
