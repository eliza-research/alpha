import type {Page, TestInfo} from '@playwright/test';

/** Test-only observation. Keep the original receiver, arguments, return value and rejection;
 * retain only fixed operation names and return/throw counts, never bridge inputs or error text.
 * Do not observe returned Promises: even adding a rejection handler changes unhandled-rejection
 * behavior. Session state and existing fixture counters describe asynchronous progress at failure. */
export function observeVoiceFixture(root: any = globalThis) {
  const fixture = root.live, bridge = root.Capacitor;
  if (!fixture || typeof bridge?.nativePromise !== 'function' || fixture.failureNativeMetadata) return;
  const prior = bridge.nativePromise, events: Array<Record<string, unknown>> = [];
  fixture.failureNativeMetadata = events;
  bridge.nativePromise = function (this: unknown, ...args: any[]) {
    const [plugin, method] = args;
    let operation: string | undefined;
    try {
      if (plugin === 'AlphaVoiceCloud' && ['startLiveCapture', 'stopLiveCapture', 'synthesizeLocal', 'play', 'stopPlayback', 'cancel', 'releaseLocalSpeech', 'cancelRecording'].includes(method)) operation = method;
      if (plugin === 'Agent') {
        if (method === 'requestStream') operation = 'conversation-stream';
        if (method === 'cancelStream') operation = 'cancel-stream';
        if (method === 'request') operation = 'native-request';
      }
    } catch { /* Diagnostics cannot prevent the native call. */ }
    if (!operation || events.length >= 64) return Reflect.apply(prior, this, args);
    const row: Record<string, unknown> = {operation, outcome: 'entered'};
    try { events.push(row); } catch { return Reflect.apply(prior, this, args); }
    const outcome = (value: string) => { try { row.outcome = value; } catch { /* Diagnostic mutation cannot affect a bridge call. */ } };
    try {
      const value = Reflect.apply(prior, this, args);
      outcome('returned');
      return value;
    } catch (error) { outcome('threw'); throw error; }
  };
}

/** Serializable inside page.evaluate and directly executable by the focused unit tests. */
export function voiceFixtureFailureMetadata(root: any = globalThis) {
  const fixture = root.live;
  if (!fixture) return null;
  const count = (value: unknown) => Array.isArray(value) ? Math.min(value.length, 1_000_000) : 0;
  const operations = ['startLiveCapture', 'stopLiveCapture', 'synthesizeLocal', 'play', 'stopPlayback', 'cancel', 'releaseLocalSpeech', 'cancelRecording', 'conversation-stream', 'cancel-stream', 'native-request'];
  const phases = ['idle', 'starting', 'listening', 'thinking', 'speaking', 'stopping', 'error', 'awaiting-user-input'];
  const snapshot = typeof fixture.sharedVoiceSession?.getSnapshot === 'function' ? fixture.sharedVoiceSession.getSnapshot() : undefined;
  const surface = root.document?.querySelector('[role="region"][aria-label="Voice conversation"]');
  const renderedPhase = surface?.getAttribute('data-voice-state');
  const routes = Array.isArray(fixture.routes) ? fixture.routes.slice(0, 1000) : [];
  return {
    version: 1, scope: 'synthetic-voice-fixture-failure-only',
    renderedPhase: surface ? (phases.includes(renderedPhase) ? renderedPhase : 'unknown') : 'absent',
    snapshotAvailable: !!snapshot,
    snapshot: snapshot ? {phase: phases.includes(snapshot.phase) ? snapshot.phase : 'unknown', hearing: snapshot.hearing === true, muted: snapshot.muted === true, inputHeld: snapshot.inputHeld === true, hasPendingText: typeof snapshot.pendingText === 'string' && !!snapshot.pendingText, hasTranscript: typeof snapshot.transcript === 'string' && !!snapshot.transcript, hasError: snapshot.error !== undefined} : undefined,
    counts: {captures: count(fixture.captures), stops: count(fixture.stops), activeCapturePresent: fixture.active != null, asrRoutes: count(fixture.routes), closeRoutes: routes.filter((row: any) => row?.close === true).length, routeFrames: Math.min(routes.reduce((total: number, row: any) => total + count(row?.frames), 0), 1_000_000), endOfTurnRequests: count(fixture.eotCalls), heardReports: count(fixture.heard), syntheses: count(fixture.spoken), plays: count(fixture.plays), playbackStops: Number.isSafeInteger(fixture.stopped) && fixture.stopped >= 0 ? Math.min(fixture.stopped, 1_000_000) : 0, posts: count(root.flagOff?.posts), unexpectedNativeRequests: count(root.flagOff?.unexpected), forbiddenVoiceRequests: count(fixture.forbidden)},
    nativeRequests: Array.isArray(fixture.failureNativeMetadata) ? fixture.failureNativeMetadata.slice(0, 64).filter((row: any) => operations.includes(row?.operation)).map((row: any) => ({operation: row.operation, outcome: ['entered', 'returned', 'threw'].includes(row.outcome) ? row.outcome : 'unknown'})) : [],
  };
}

export async function attachVoiceFailureMetadata(page: Page, info: TestInfo) {
  if (info.status === info.expectedStatus || !['failed', 'timedOut', 'interrupted'].includes(info.status || '')) return;
  let metadata: unknown;
  try { metadata = await page.evaluate(voiceFixtureFailureMetadata); }
  catch { metadata = {version: 1, diagnosticCaptureFailed: true}; }
  if (metadata) {
    try { await info.attach('voice-fixture-failure-metadata', {body: Buffer.from(JSON.stringify(metadata)), contentType: 'application/json'}); }
    catch { /* Diagnostics must not add a hook error to the original test failure. */ }
  }
}
