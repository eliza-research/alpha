# Local agent voice validation

2026-09-30: the isolated real Eliza app host on loopback port47844 produced local
Kokoro speech and a real Cerebras `qwen-3.8-27b` text reply in the same runtime.
This is host HTTP proof, not phone microphone/playback or enclave acceptance.
The original47840 runtime was left running and unchanged.

`test-results/local-agent-voice/paired-http.json` records owner pairing, TTS
readiness true, authenticated HTTP200 WAV (297644 bytes), absent and invalid
bearer HTTP401, and the synthetic multiplication reply42. The request Host is
`10.0.2.2:47844`, preventing loopback trust from substituting for session auth.
Only synthetic text/audio was used. No bearer appears in the evidence.

## Source fixes and reproducibility

Upstream changes arrive as reviewed upstream commits through a pin move in `upstream.lock.json`, or as an explicit tested native patch admitted by `patches/eliza/native-manifest.json` (`scripts/prepare-patched-native.ts`, rebased onto `bc71e21f3b` on 2026-10-13). The earlier voice patch series was retired in `34b3c82a` (2026-10-03) and `55c2944f` (2026-10-04), and its last reference went in `530d3b26` (2026-10-10), each when the pinned upstream already carried the change. The run below was made with the patch and is kept as history; it has not been repeated at the current pin.

Historical record: `patches/eliza/0002-paired-local-voice.patch` (historical; retired in `34b3c82a`) had its exact base and SHA256 in
`patches/eliza/local-voice-source-base.json` (historical, retired with it). It was applied only to the isolated
upstream worktree, never `vendor/eliza`. Four changed upstream files pass Biome;
a clean-base patch applicability check passes. Full upstream typecheck was not
run. The actual source runtime loaded and served the patched routes.

The app route dispatcher now supplies its existing AuthStore/CSRF resolver as
an in-process callback to ASR/TTS only. A client cannot set that callback through
headers or a body. Standalone plugin fallback and sensitive model-management
route authorization remain unchanged. ASR gets exact session route declarations
that were missing from the managed route policy. Runtime-mode restrictions are
unchanged. TTS readiness checks registrations of the same local providers used
by POST, rather than accepting an unrelated cloud TTS registration. Readiness
is registration availability; successful audio is separately tested.

Start with explicit, already-installed voice assets and native library:

```sh
npm run agent:prepare   # artifacts/local-agent-resident-<pinned commit>
ELIZA_INFERENCE_LIBRARY=/absolute/libelizainference.dylib \
ELIZA_KOKORO_MODEL_DIR=/absolute/kokoro \
node scripts/start-local-voice-agent.ts   # optional: --source <prepared tree> --profile <dir> --port <n> --bun <path>
# test-paired-local-voice.mjs (Kokoro era) was deleted on 2026-10-14
```

The launcher uses the normal protected AlphaPhone Cerebras key file and a
separate `~/.local/share/alphaphone/local-voice` profile. It whitelists the two
voice paths, uses `--conditions=eliza-source`, and sets no local text model or
text assignment. The Kokoro directory must contain supported GGUF, tokenizer,
and voice assets. Neither model nor native library enters the Android APK.
Using default distribution exports without rebuilding loads stale plugin routes.
The proof establishes a normal ephemeral paired session; it does not export it.

## Remaining ASR and phone gates

Paired ASR status now correctly returns HTTP200 with `ready:false`. The curated
Eliza1 bundle request was rejected by its existing release-quality gate before
weights downloaded (7859 manifest bytes). Evidence: `install-request.json` and
`install-result.json` under the same results directory. No gate was bypassed,
model activated, or Cerebras routing replaced. Current fused ASR requires an
eligible Eliza1 bundle; supported standalone Kokoro supplies TTS only.

The independent legacy47831 Whisper fixture is historical ASR evidence for a
different protocol. It is not ASR on this paired runtime. Paired native voice UI
still needs authenticated binary requests, AAC-to-mono-PCM-WAV conversion,
account/lifecycle cancellation and real playback testing, gated by selected
server capability. Cloud voice remains separately account/authentication gated.
Local Notes audio plus manual transcript is already a separate supported flow. The browser
build has no speech engine of its own (P-42): local transcription in a browser goes through the
local agent above, and without it reports `local-agent-required`
([browser-speech-recognition.md](browser-speech-recognition.md)).

## Notes playback implementation (next Android verification)

The Notes manual-transcript review can now show the existing **Listen to
transcript** control when the selected paired agent's authenticated local TTS
status returns `ready:true`. No text is sent by that probe. Only pressing Listen
sends the edited transcript to the agent; the recorded audio stays on the phone.
Cloud-account voice behavior remains separate. This adds no paired composer ASR.

`AlphaVoiceCloud` resolves the paired bearer directly from encrypted native
storage and matches selected origin, owner and expiry before opening the fixed
TTS route. HTTPS is required outside debug loopback. Redirects, wrong identity,
expired binding and non-audio responses are rejected. Playback is private,
bounded, single-use and cancelled on view/account/background/chooser changes.
The registration-backed readiness probe may still encounter unavailable model
assets at synthesis; that produces an honest playback error and preserves the
transcript.

Typecheck and the extended actual renderer adapter fixture pass. The added
`PairedVoiceInstrumentedTest` exercises the real native bridge, secure store,
synthetic HTTP server and MediaPlayer, including stale binding, insecure origin,
MIME and redirect rejection. Its device execution is pending the parent Build63
run. This is not yet phone-to-real-agent playback acceptance.

## Build63 phone TTS evidence

`test-results/prototype-build63/paired-voice-live/result.json` passes both archived app distributions: actual chooser pairing to the isolated Eliza47844 host, authenticated readiness, Notes manual transcript review, explicit Listen, actual native decoded playback completion and cancellation. Recording ingress is an instrumentation-owned synthetic PCM file; no microphone is started and no ASR result is simulated. Original selection and encrypted credential are restored. The separate `PairedVoiceInstrumentedTest` also passes both distributions for native HTTP credential binding, stale identity/expiry/origin rejection, real MediaPlayer decoding, one-use playback, MIME and redirect rejection. That second test uses a synthetic HTTP server and is distinguished from live Eliza evidence.
