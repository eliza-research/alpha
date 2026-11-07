import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

for(const own of [false,true])test(`the real ${own?'own-key':'development'} adapter forwards accepted SDK progress state, ignores raw progress and retires its callbacks`, async () => {
  const requests = [];
  const states = [];
  let current = true;
  const agent = {async request(route) {
    requests.push(route);
    if (route.startsWith('/api/v1/voice/session/health?')) return {ready: true, turnTerminal: true, conversationId: 'owned-conversation', agentId: 'owned-agent', speechRoute: 'direct'};
    assert.equal(route, '/api/views/voice-channel');
    return {wsUrl: 'ws://owned.invalid/__alpha-local-renderer/ws?ticket=synthetic', expiresAt: Date.now() + 60000};
  }};
  const fixture = {
    own,
    connection: {
      getSnapshot:()=>({residentInference:own?"direct":"cloud",providerStatus:{voiceConfigured:own}}),
      getBrowserSpeechAgent: () => agent,
      voiceConversationCurrent: () => true,
      voiceRendererClientId: () => 'owned-renderer',
    },
    client: {async stop() {}, async start() {}, recheck() {}, setMicrophoneMuted() {}, get microphoneMuted() { return false; }, get microphoneAutomaticallyMuted() { return false; }},
  };
  const previous = globalThis.__alphaVoiceProgressFixture;
  globalThis.__alphaVoiceProgressFixture = fixture;
  const stubs = new Map([
    ['./connection-ui', 'export const connectionController=globalThis.__alphaVoiceProgressFixture.connection;'],
    ['./development-cloud-voice', 'export const developmentCloudRealtimeVoiceEnabled=false;'],
    ['./development-cartesia-flag', 'export const developmentCartesiaVoiceEnabled=!globalThis.__alphaVoiceProgressFixture.own;'],
    ['../browser/device-preferences', 'export async function readDevicePreferences(){return {askBeforeAgentActions:true};}'],
    ['@elizaos/ui/voice/voice-session-client', 'export function createVoiceSessionClient(options){globalThis.__alphaVoiceProgressFixture.options=options;return globalThis.__alphaVoiceProgressFixture.client;}'],
  ]);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-progress-forwarding-'));
  const target = path.join(directory, 'adapter.cjs');
  let conversation;
  try {
    const bundle = await build({entryPoints: ['apps/app/src/runtime/development-cartesia-conversation.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [{name: 'closed-voice-ports', setup(builder) {
      builder.onResolve({filter: /.*/}, args => stubs.has(args.path) ? {path: args.path, namespace: 'closed-voice-ports'} : undefined);
      builder.onLoad({filter: /.*/, namespace: 'closed-voice-ports'}, args => ({contents: stubs.get(args.path), loader: 'js'}));
    }}]});
    fs.writeFileSync(target, bundle.outputFiles[0].text);
    const {developmentCartesiaConversation} = createRequire(import.meta.url)(target);
    const oldWindow = globalThis.window;
    const oldLocation = globalThis.location;
    const oldWebSocket = globalThis.WebSocket;
    globalThis.window = {addEventListener() {}, removeEventListener() {}};
    globalThis.location = {host: 'owned.invalid'};
    globalThis.WebSocket = class {
      constructor() { queueMicrotask(() => this.onopen?.()); }
      close() { this.onclose?.(); }
    };
    try {
      conversation = await developmentCartesiaConversation({binding: {conversationId: 'owned-conversation', session: {agentId: 'owned-agent'}}, assertCurrent() { if (!current) throw new DOMException('Retired binding', 'AbortError'); }, onState: (phase, progressText) => states.push({phase, progressText}), onTranscript() { throw Error('No transcript is part of this presentation test'); }, onError(error) { throw error; }});
      fixture.options.onState({phase: 'thinking', progressText: 'Creating that now.'});
      assert.deepEqual(states.at(-1), {phase: 'thinking', progressText: 'Creating that now.'});
      const acceptedCount = states.length;
      fixture.options.onServerEvent({t: 'progress', traceId: 'obsolete-trace', text: 'Rejected stale label'});
      assert.equal(states.length, acceptedCount, 'raw server events must not bypass the SDK state reducer');
      fixture.options.onState({phase: 'listening', progressText: ''});
      assert.deepEqual(states.at(-1), {phase: 'listening', progressText: ''});
      current = false;
      assert.throws(() => fixture.options.onState({phase: 'thinking', progressText: 'Wrong binding'}), {name: 'AbortError'});
      assert.equal(states.length, acceptedCount + 1);
      current = true;
      await conversation.stop();
      conversation = undefined;
      fixture.options.onState({phase: 'thinking', progressText: 'After Stop'});
      assert.equal(states.length, acceptedCount + 1);
      assert.equal(requests.length, 2, 'only closed health and renderer ports ran; no voice consent, mint, provider, model or TTS effect');
    } finally { globalThis.window = oldWindow; globalThis.location = oldLocation; globalThis.WebSocket = oldWebSocket; }
  } finally {
    await conversation?.stop();
    globalThis.__alphaVoiceProgressFixture = previous;
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
