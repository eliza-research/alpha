/** Root-owned execution only: real combined-host speech, explicit review and delayed-response cancellation. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { androidEnv } from './toolchain.ts';

type AudioReceipt = { sha256: string; bytes: number };
type Capture = {
  text: string;
  posts: number;
  pairings: number;
  audio: AudioReceipt[];
  held: boolean;
  cancelled: boolean;
  failed: boolean;
  lateResponseAttempted: boolean;
};
type Result = {
  variant: string;
  runId: string;
  passed: boolean;
  appSha256: string;
  testSha256: string;
  failedStage?: string;
  fixtureCleanupFailed?: boolean;
};

const serial = process.env.ANDROID_SERIAL;
const archive = process.env.ALPHA_BUILD_ARCHIVE;
const sessionFile = process.env.ALPHA_COMBINED_OWNER_SESSION;
const sourceFile = process.env.ALPHA_COMBINED_SOURCE_MANIFEST;
assert.ok(serial && /^emulator-\d+$/.test(serial), 'Explicit emulator serial required');
assert.ok(archive && sessionFile && sourceFile, 'Explicit archive, owner session and combined source manifest required');
const out = path.resolve(process.env.ALPHA_CAMPAIGN_OUTPUT || path.join(archive, 'browser-reading-live'));
assert.ok(out.startsWith(path.resolve('test-results') + path.sep), 'Campaign evidence must remain beneath test-results');
assert.equal(fs.existsSync(out), false, 'Use a new campaign output; preserve earlier evidence');

const manifest: Record<string, string> = JSON.parse(fs.readFileSync(path.join(archive, 'apk-manifest.json'), 'utf8'));
const source: { contentSha256: string; revision: string } = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
const profile = process.env.ALPHA_COMBINED_PROFILE || path.join(os.homedir(), '.local/share/alphaphone/combined-agent-47858');
const processRecord: typeof source & { port: number } = JSON.parse(fs.readFileSync(path.join(profile, 'process.json'), 'utf8'));
assert.equal(processRecord.port, 47858);
assert.equal(processRecord.contentSha256, source.contentSha256);
assert.equal(processRecord.revision, source.revision);
const stat = fs.lstatSync(sessionFile);
assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0);
const owner: { token: string } = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
assert.equal(typeof owner.token, 'string');
assert.ok(owner.token.length > 20);

const host = 'http://127.0.0.1:47858';
const origin = 'http://10.0.2.2:47861';
const hash = (value: Buffer) => crypto.createHash('sha256').update(value).digest('hex');

async function request<T>(route: string): Promise<T> {
  const response = await fetch(host + route, {
    headers: {
      Host: '10.0.2.2:47858',
      'X-Forwarded-For': '192.0.2.1',
      Authorization: `Bearer ${owner.token}`,
      'Content-Type': 'application/json',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  assert.ok(response.ok, `Combined setup HTTP ${response.status}`);
  return response.json();
}

const me = await request<{ access?: { role: string; mode: string }; identity: { id: string } }>('/api/auth/me');
const agents = await request<{ agents: { id: string }[] }>('/api/agents');
assert.equal(me.access?.role, 'OWNER');
assert.equal(me.access?.mode, 'session');
assert.equal(agents.agents?.length, 1);
const { ready, provider, format, sampleRate, maxCharacters } = await request<Record<string, unknown>>('/api/tts/paradee/status');
assert.deepEqual(
  { ready, provider, format, sampleRate, maxCharacters },
  { ready: true, provider: 'libelizainference-paradee', format: 'pcm16-wav', sampleRate: 24000, maxCharacters: 500 },
  'Paired speech status is not what PairedSpeechContract.ttsReady accepts',
);

let active: Capture | null = null;
const proxy = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/__reading/state') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      posts: active?.posts || 0,
      held: !!active?.held,
      cancelled: !!active?.cancelled,
    }));
    return;
  }
  if (!req.url?.startsWith('/api/') || req.url.includes('://')) {
    res.writeHead(404).end();
    return;
  }
  const campaign = active;
  const tts = req.method === 'POST' && req.url === '/api/tts/paradee';
  if (tts && !campaign) {
    res.writeHead(409).end();
    return;
  }

  if (tts && campaign) {
    let bodyBytes = 0;
    const body: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      bodyBytes += chunk.length;
      if (bodyBytes > 32768) {
        campaign.failed = true;
        req.destroy();
      } else {
        body.push(chunk);
      }
    });
    req.on('end', () => {
      try {
        const parsed: { text: string } = JSON.parse(Buffer.concat(body).toString('utf8'));
        assert.equal(parsed.text, campaign.text);
        const requestId = req.headers['x-request-id'];
        assert.ok(typeof requestId === 'string');
        assert.match(requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        campaign.posts++;
      } catch {
        campaign.failed = true;
      }
    });
  }

  const upstream = http.request(host + req.url, {
    method: req.method,
    headers: { ...req.headers, host: '10.0.2.2:47858', 'x-forwarded-for': '192.0.2.1' },
    timeout: 180000,
  }, reply => {
    if (req.url === '/api/auth/pair' && req.method === 'POST' && reply.statusCode === 200 && campaign) {
      campaign.pairings++;
    }
    if (!tts || !campaign) {
      res.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(res);
      return;
    }

    let bytes = 0;
    const chunks: Buffer[] = [];
    reply.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) {
        campaign.failed = true;
        upstream.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    reply.on('end', () => {
      try {
        const audio = Buffer.concat(chunks);
        assert.equal(reply.statusCode, 200);
        assert.match(reply.headers['content-type'] || '', /^audio\/wav(?:;|$)/);
        assert.equal(reply.headers['x-request-id'], req.headers['x-request-id']);
        assert.equal(reply.headers['x-eliza-speech-provider'], 'libelizainference-paradee');
        assert.equal(audio.subarray(0, 4).toString(), 'RIFF');
        assert.equal(audio.subarray(8, 12).toString(), 'WAVE');
        assert.ok(audio.length > 44);
        campaign.audio.push({ sha256: hash(audio), bytes: audio.length });
        if (campaign.posts === 2) {
          campaign.held = true;
          const timeout = setTimeout(() => {
            campaign.failed = true;
            res.destroy();
          }, 30000);
          res.once('close', () => {
            clearTimeout(timeout);
            if (!res.writableEnded) {
              campaign.cancelled = true;
              // A late send must leave the closed native request closed.
              res.end(audio);
              campaign.lateResponseAttempted = true;
            } else {
              campaign.failed = true;
            }
          });
          return;
        }
        assert.equal(campaign.posts, 1);
        const headers: http.OutgoingHttpHeaders = { ...reply.headers, 'content-length': String(audio.length) };
        delete headers['transfer-encoding'];
        res.writeHead(200, headers).end(audio);
      } catch {
        campaign.failed = true;
        res.destroy();
      }
    });
    reply.on('error', () => {
      campaign.failed = true;
      res.destroy();
    });
  });
  upstream.on('timeout', () => upstream.destroy());
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  res.on('close', () => {
    if (!res.writableEnded) upstream.destroy();
  });
  req.pipe(upstream);
});

await new Promise<void>((resolve, reject) => {
  proxy.once('error', reject);
  proxy.listen(47861, '127.0.0.1', resolve);
});
const env = androidEnv();
const adb = path.join(env.ANDROID_HOME, 'platform-tools/adb');
const { appId: app }: { appId: string } = JSON.parse(fs.readFileSync('app.config.json', 'utf8'));
fs.mkdirSync(out, { recursive: true });
const results: Result[] = [];

const run = (args: string[], input?: string) => new Promise<string>((resolve, reject) => {
  const child = spawn(adb, ['-s', serial, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  const timer = setTimeout(() => {
    child.kill('SIGTERM');
    reject(Error('Browser reading device timeout'));
  }, 600000);
  child.stdout.on('data', chunk => {
    output += chunk;
    if (output.length > 2e6) child.kill('SIGTERM');
  });
  child.stderr.resume();
  child.on('error', () => {
    clearTimeout(timer);
    reject(Error('Device command failed'));
  });
  child.on('close', code => {
    clearTimeout(timer);
    if (code === 0) resolve(output);
    else reject(Error('Device command failed'));
  });
  child.stdin.end(input);
});

try {
  const unauthenticated = await fetch('http://127.0.0.1:47861/api/tts/paradee/status', {
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(unauthenticated.status, 401);
  for (const variant of ['standalone', 'launcher']) {
    const apk = path.join(archive, `${variant}-debug.apk`);
    const test = path.join(archive, `${variant}-androidTest.apk`);
    const appSha256 = manifest[path.basename(apk)];
    const testSha256 = manifest[path.basename(test)];
    assert.equal(hash(fs.readFileSync(apk)), appSha256);
    assert.equal(hash(fs.readFileSync(test)), testSha256);

    const runId = crypto.randomUUID();
    const record: Result = { variant, runId, passed: false, appSha256, testSha256 };
    let stage = 'install';
    try {
      await run(['install', '--no-incremental', '-r', apk]);
      await run(['install', '--no-incremental', '-r', test]);
      const pair = await request<{ code: string }>('/api/auth/pair-code');
      assert.equal(typeof pair.code, 'string');
      active = {
        text: 'Please remember to water the plants tomorrow morning.',
        posts: 0,
        pairings: 0,
        audio: [],
        held: false,
        cancelled: false,
        failed: false,
        lateResponseAttempted: false,
      };
      await run(['shell', `run-as ${app} sh -c 'umask 077; mkdir -p files; cat > files/browser-reading-fixture.json'`], JSON.stringify({
        origin, runId, code: pair.code, ownerId: me.identity.id, agentId: agents.agents[0].id, text: active.text,
      }));
      stage = 'native-flow';
      const log = await run([
        'shell', 'am', 'instrument', '-w', '-r', '-e', 'browserReadingLive', '1',
        '-e', 'class', app + '.BrowserReadingLiveInstrumentedTest', app + '.test/androidx.test.runner.AndroidJUnitRunner',
      ]);
      fs.writeFileSync(path.join(out, variant + '.txt'), log);
      assert.match(log, /OK \(1 test\)/);
      assert.doesNotMatch(log, /FAILURES|INSTRUMENTATION_FAILED|Process crashed/);
      stage = 'transport-receipts';
      assert.equal(active.failed, false);
      assert.equal(active.posts, 2);
      assert.equal(active.pairings, 1);
      assert.equal(active.audio.length, 2);
      assert.equal(active.held, true);
      assert.equal(active.cancelled, true);
      assert.equal(active.lateResponseAttempted, true);
      Object.assign(record, {
        passed: true,
        pairings: 1,
        exactApprovedTextPosts: 2,
        actualSpeechAudio: active.audio,
        heldResponseCancelled: true,
        lateResponseAttempted: true,
        stages: [...log.matchAll(/browserReadingStage=([^\r\n]+)/g)].map(match => match[1]),
      });
    } catch {
      record.failedStage = stage;
    } finally {
      try {
        await run(['shell', `run-as ${app} rm -f files/browser-reading-fixture.json`]);
      } catch {
        record.passed = false;
        record.fixtureCleanupFailed = true;
      }
      results.push(record);
      active = null;
      fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({
        sourceContentSha256: source.contentSha256,
        unauthenticatedStatus: 401,
        realMicrophoneTested: false,
        allBrowserFlowsAccepted: false,
        results,
      }, null, 2));
    }
    if (!record.passed) break;
  }
} finally {
  proxy.closeAllConnections();
  await new Promise<void>(resolve => proxy.close(() => resolve()));
}
if (results.length !== 2 || results.some(result => !result.passed)) process.exitCode = 1;
