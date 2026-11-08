# Live browser QA

The `test/browser/*.local.spec.ts` specs exercise a real local agent and real speech
providers. No default Playwright project runs them (`playwright.config.ts` ignores
`.local.spec.ts`, and `test/playwright-projects.test.mjs` holds that). They run only in
the `live` project, which exists only when it is selected:

```sh
npm run test:browser:live
```

The script sets `ELIZA_DEV_ALLOW_TEST_MOCKS=1`, `VITE_LOCAL_AGENT=1` and
`ALPHA_LOCAL_AGENT_TOKEN_FILE` (default `~/.local/share/alphaphone/local-remote/owner-token`,
the owner token `npm run agent:local` writes), starts its own `npm run dev:ui` server on
port 5317 and runs one worker. Each spec still skips unless its own opt-in is set.

## Before running

1. Start the agent in another terminal: `npm run agent:local` (loopback port 47839, the
   bridge's default `ALPHA_LOCAL_AGENT_ORIGIN`). Configure its speech provider as in
   [local agent setup](local-agent-development.md). Set `ALPHA_REMOTE_PROFILE`,
   `ALPHA_REMOTE_PORT`, `ALPHA_LOCAL_AGENT_TOKEN_FILE` and `ALPHA_LOCAL_AGENT_ORIGIN`
   together to use another profile.
2. Choose the microphone for the voice specs. Set `ALPHA_LIVE_FAKE_AUDIO` to an absolute
   WAV path and the live project launches Chromium with `--use-fake-ui-for-media-stream`,
   `--use-fake-device-for-media-stream` and `--use-file-for-fake-audio-capture`. The
   direct voice spec expects the recording to say "open notes". Without it, Chromium uses
   the physical microphone and someone must speak.

## Specs and their opt-ins

| Spec | Opt-in | Also needs |
| --- | --- | --- |
| `browser-agent-playback.local.spec.ts` | `ALPHA_REAL_LOCAL_TTS=1` | A freshly restarted agent with local TTS (`/api/tts/paradee`). |
| `direct-voice-live.local.spec.ts` | `ALPHA_LIVE_VOICE_QA=1` | A realtime voice route on the bridge: `ALPHA_DEV_CARTESIA=1` with `VITE_ALPHA_DEV_CARTESIA=1`, or `ALPHA_DEV_CLOUD_REALTIME_VOICE=1` with `VITE_ALPHA_DEV_CLOUD_REALTIME_VOICE=1`. `ALPHA_LONG_VOICE_QA=1` adds the 125-second rotation check. |
| `cloud-tts-latency.local.spec.ts`, `cloud-voice-live.local.spec.ts` | `ALPHA_LIVE_CLOUD_VOICE_QA=1` | [Development Cloud speech](development-cloud-voice.md): `ALPHA_DEV_CLOUD_VOICE=1` and `VITE_ALPHA_DEV_CLOUD_VOICE=1`, and an agent with Cloud credentials. |

The direct voice spec records the route the bridge actually served, read from the first
session health envelope, as `speechRoute` in its `receipt.json`, and checks the Cloud
provider fields when that route is `cloud`.

Receipts and screenshots go to `test-results/browser/`. A pass here is a browser run
against a host agent on this computer. It does not qualify Android, a device or a user.
