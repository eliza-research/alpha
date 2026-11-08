import { test, expect } from '@playwright/test';

// The live voice client (apps/app/src/runtime/live-voice.ts) in a real browser against a stub
// agent: POST /api/asr/local-inference/live answered by a route handler, and the ephemeral
// voice-transcript agent events delivered over a stubbed agent WebSocket. No microphone, model or
// network: the stub speaks the upstream wire format (elizaOS #36213 / #36214).
test('live voice: partials render as interim text, stale turns are dropped and the final arrives once', async ({ page }) => {
  const posts: any[] = [];
  let socket: import('@playwright/test').WebSocketRoute | undefined;
  await page.routeWebSocket('ws://stub-agent.invalid/ws', ws => { socket = ws; });
  await page.route('https://stub-agent.invalid/api/asr/local-inference/live', async route => {
    const body = route.request().postDataJSON();posts.push(body);
    const end = Array.isArray(body.vad) && body.vad.some((edge: any) => edge.type === 'speech-end');
    await route.fulfill({ json: { ok: true, sessionId: body.sessionId, mode: 'stream', framesReceived: posts.length, ...(end ? { final: { turnId: 'turn-1', text: 'Remind me to call Sam at five', mode: 'stream', asrFinalFromSpeechEndMs: 120 } } : {}) } });
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const live = await import('/src/runtime/live-voice.ts');
    const w = window as any;
    const view = document.createElement('p');view.setAttribute('data-test-interim', '');document.body.append(view);
    w.liveFinals = [];
    w.liveSession = live.createLiveVoiceSession({
      transport: {
        post: async (body: any, signal: AbortSignal) => (await fetch('https://stub-agent.invalid/api/asr/local-inference/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })).json(),
        subscribe: live.webSocketAgentEvents(() => new WebSocket('ws://stub-agent.invalid/ws')),
      },
      onInterim: (text: string) => { view.textContent = text; },
      onFinal: (final: any, latency: any) => { w.liveFinals.push({ final, latency }); },
    });
    w.liveFrame = () => live.encodeLiveFrame(new Float32Array(512).fill(0.05), Date.now());
  });
  await expect.poll(() => socket !== undefined).toBe(true);
  const sessionId = await page.evaluate(() => (window as any).liveSession.sessionId);
  const send = (payload: Record<string, unknown>) => socket!.send(JSON.stringify({ type: 'agent_event', version: 1, ephemeral: true, eventId: 'eph-1', stream: 'voice-transcript', ts: Date.now(), runId: `voice-transcript:${sessionId}`, seq: 1, payload: { type: 'voice-transcript', sessionId, ...payload } }));

  await page.evaluate(() => (window as any).liveSession.push([(window as any).liveFrame()], [{ type: 'speech-start', timestampMs: Date.now() }]));
  send({ turnId: 'turn-1', phase: 'speech-start' });
  send({ turnId: 'turn-1', phase: 'partial', text: 'Remind me', seq: 1 });
  await expect(page.locator('[data-test-interim]')).toHaveText('Remind me');
  send({ turnId: 'turn-1', phase: 'partial', text: 'Remind me to call Sam', seq: 2 });
  await expect(page.locator('[data-test-interim]')).toHaveText('Remind me to call Sam');
  // A stale turn and another session never replace the interim text.
  send({ turnId: 'turn-0', phase: 'partial', text: 'from an earlier turn', seq: 7 });
  socket!.send(JSON.stringify({ type: 'agent_event', stream: 'voice-transcript', payload: { type: 'voice-transcript', sessionId: 'other', turnId: 'turn-1', phase: 'partial', text: 'not this session', seq: 3 } }));
  await page.waitForTimeout(100);
  await expect(page.locator('[data-test-interim]')).toHaveText('Remind me to call Sam');

  await page.evaluate(() => (window as any).liveSession.push([(window as any).liveFrame()], [{ type: 'speech-end', timestampMs: Date.now() }]));
  send({ turnId: 'turn-1', phase: 'final', text: 'Remind me to call Sam at five', mode: 'stream', asrFinalFromSpeechEndMs: 120 });
  await expect(page.locator('[data-test-interim]')).toHaveText('');
  const finals = await page.evaluate(() => (window as any).liveFinals);
  expect(finals).toHaveLength(1);
  expect(finals[0].final).toEqual({ turnId: 'turn-1', text: 'Remind me to call Sam at five', mode: 'stream', asrFinalFromSpeechEndMs: 120 });
  expect(finals[0].latency.partials).toBe(2);
  expect(typeof finals[0].latency.firstPartialMs).toBe('number');
  expect(posts.map(body => body.vad?.[0]?.type)).toEqual(['speech-start', 'speech-end']);
  expect(posts[0].frames[0]).toMatchObject({ sampleRate: 16000, channels: 1, samples: 512 });
  // Interim text never reaches storage.
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored).not.toContain('Remind me to call Sam');
  await page.evaluate(() => (window as any).liveSession.close());
  expect(posts.at(-1)).toMatchObject({ sessionId, close: true });
});

// The shared native live transport (@elizaos/voice/native-live, projected from the pin) that
// native-live-voice.ts binds to AlphaVoiceCloud, driven in a real browser by a fake bridge that
// emits the bridge's events, with partials over a stubbed agent WebSocket. No microphone, VAD,
// model or native code: the bridge here is a page object speaking the bridge's event contract.
test('native live transport: owner-routed capture admits only its own events, gates partials and fences an owner change', async ({ page }) => {
  let socket: import('@playwright/test').WebSocketRoute | undefined;
  await page.routeWebSocket('ws://stub-agent.invalid/ws', ws => { socket = ws; });
  const shared = '/@fs' + new URL('../../.eliza/client-features/packages/voice/src/native-live-voice.ts', import.meta.url).pathname;
  const sharedLive = '/@fs' + new URL('../../.eliza/client-features/packages/voice/src/live-voice-session.ts', import.meta.url).pathname;
  await page.goto('/');
  await page.evaluate(async ([nativeUrl, liveUrl]) => {
    const native = await import(nativeUrl), live = await import(liveUrl);
    const w = window as any;
    const view = document.createElement('p');view.setAttribute('data-test-native-interim', '');document.body.append(view);
    const listeners = new Map<string, Set<(event: any) => void>>();
    w.bridge = { starts: [] as any[], stops: [] as any[], emit: (name: string, event: any) => listeners.get(name)?.forEach(fn => fn(event)) };
    const port = {
      liveCaptureStatus: async () => ({ available: true, nativeTransport: true }),
      startLiveCapture: async (input: any) => { w.bridge.starts.push(input); return { captureId: input.captureId, sampleRate: 16000, echoCancelled: true, nativeAsr: input.nativeAsr === true }; },
      stopLiveCapture: async (input: any) => { w.bridge.stops.push(input); return { captureId: input.captureId, serverClosed: true }; },
      addListener: async (name: string, fn: (event: any) => void) => { const set = listeners.get(name) ?? new Set(); listeners.set(name, set); set.add(fn); return { remove: async () => { set.delete(fn); } }; },
    };
    w.owner = 'owner-1';
    const subscribe = live.webSocketAgentEvents(() => new WebSocket('ws://stub-agent.invalid/ws'));
    const voice = native.createNativeLiveVoice({ port, available: () => true, resident: () => ({ sessionId: 'session-1', ownerId: w.owner, request: async () => ({ ready: true }), subscribe }) });
    w.segments = [];w.lost = [];
    w.capture = await voice.open({ signal: new AbortController().signal, echoCancel: true, onSegment: (text: string | null) => w.segments.push(text), onInterim: (text: string) => { view.textContent = text; }, onLost: (error: any) => w.lost.push(String(error?.message)) });
    w.captureId = w.bridge.starts[0].captureId;
  }, [shared, sharedLive]);
  await expect.poll(() => socket !== undefined).toBe(true);
  const captureId = await page.evaluate(() => (window as any).captureId);
  expect(await page.evaluate(() => (window as any).bridge.starts[0])).toMatchObject({ nativeAsr: true, ownerId: 'owner-1', echoCancel: true });
  const send = (payload: Record<string, unknown>) => socket!.send(JSON.stringify({ type: 'agent_event', stream: 'voice-transcript', payload: { type: 'voice-transcript', ...payload } }));
  send({ sessionId: captureId, turnId: 't1', phase: 'speech-start' });
  send({ sessionId: captureId, turnId: 't1', phase: 'partial', text: 'Call Sam', seq: 1 });
  await expect(page.locator('[data-test-native-interim]')).toHaveText('Call Sam');
  // Another capture's partials and a stale capture's final never reach this one.
  send({ sessionId: 'another-capture', turnId: 't1', phase: 'partial', text: 'not mine', seq: 2 });
  await page.evaluate(() => (window as any).bridge.emit('liveCaptureTranscript', { captureId: 'stale', final: { turnId: 'x', text: 'stale', mode: 'stream' } }));
  await page.waitForTimeout(100);
  await expect(page.locator('[data-test-native-interim]')).toHaveText('Call Sam');
  await page.evaluate(id => { const b = (window as any).bridge; b.emit('liveCaptureFrames', { captureId: id, vad: [{ type: 'speech-start', timestampMs: 1 }, { type: 'speech-end', timestampMs: 2 }] }); b.emit('liveCaptureTranscript', { captureId: id, final: { turnId: 't1', text: 'Call Sam at five', mode: 'stream' } }); }, captureId);
  await expect(page.locator('[data-test-native-interim]')).toHaveText('');
  expect(await page.evaluate(() => (window as any).segments)).toEqual(['Call Sam at five']);
  // An owner change fences the next event and discards the capture.
  await page.evaluate(id => { const w = window as any; w.owner = 'owner-2'; w.bridge.emit('liveCaptureTranscript', { captureId: id, final: { turnId: 't2', text: 'private', mode: 'stream' } }); }, captureId);
  await expect.poll(() => page.evaluate(() => (window as any).bridge.stops.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).bridge.stops[0])).toMatchObject({ captureId, discard: true });
  expect(await page.evaluate(() => (window as any).lost)).toEqual(['The agent session changed.']);
  expect(await page.evaluate(() => (window as any).segments)).toEqual(['Call Sam at five']);
});
