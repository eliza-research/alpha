# Native live speech transport

The current Android bridge advertises `nativeTransport` from `liveCaptureStatus`.
The renderer supplies the enrolled owner identity and a random capture/session ID,
then starts native live capture with `nativeAsr: true`. The native transport admits
the ASR session before opening the microphone. Decoder work deferred until speech
still counts against the bounded queue; overload stops capture rather than retaining
unbounded audio. Android captures and runs
Silero VAD as before, but forwards the captured PCM directly over the private
resident IPC to `/api/asr/local-inference/live`. `liveCaptureFrames` contains only
levels and VAD edges on this path. `liveCaptureTranscript` contains projected final
transcripts or fixed error codes. The existing voice-only event feed can supply
interim text. No model, source pin, admission record, or speech policy changes.

`AlphaLocalAgentPlugin.openNativeVoiceTransport` snapshots the existing enrollment:
owner, token, root token and lifecycle epoch. It never pairs or enrolls. Every
request and returned IPC frame checks that binding, including same-owner
re-enrollment. An idle transport checks it every 250 ms. A changed binding stops
capture and never sends cleanup with new credentials.

The shared `ai.eliza.voice.LiveSegmentPipe` (plugin-local-inference), driven by
`LiveCaptureController`, holds at most eight batches, each at most 32 frames and
128 KiB of serialized data. A single worker drains them in order. Saturation drops
queued audio, stops capture and reports a fixed failure; it does not keep recording
or retry. One native transport worker per bridge surface uses a synchronous queue
with no worker backlog. PCM and transcript state are not persisted or logged.

The private IPC's normal buffered inference API raises caller timeouts. This path
therefore uses its existing cancellable stream handle (shared `BufferedStreamExchange`) with a separate eight-second
deadline and a 128 KiB response limit. It assembles the JSON response natively and
projects only transcript fields. Stop's graceful close drains admitted audio and
closes the session. Queued frames after the Stop cutoff are omitted. Audio already
sent before Android receives Stop cannot be retracted. `serverClosed` explicitly
acknowledges the route's close response; lack of acknowledgement is an error, not
success. The caller waits at most twelve seconds before switching to discard.

Cancel immediately discards queued audio and late output, cancels an in-flight IPC
read, and requests close only under the original enrollment. Closing IPC does not
roll back model work already running in the resident process. The current upstream
close route finalizes and disposes its session; this is not a new native model
cancellation API. Renderer cancellation remains capture/session-bound and an abort
can overtake either startup or graceful close. An already-running platform
microphone constructor cannot be forcibly interrupted; late opening is cleaned up
without being admitted.

An older installed native bridge that does not advertise this capability continues
to use the compatibility path: PCM still crosses the renderer there. Native-route
errors do not silently switch transports or replay audio. Full native turn control,
Clef admission and TTS/playback orchestration remain separate work; the renderer
still owns the voice-assistant interaction state machine, including the semantic
end-of-turn and heard-content requests (elizaOS #36546/#36547, see
[fused speech](fused-speech.md)), which use the ordinary owner-bound resident request
path, not this PCM transport.

Host JVM tests exercise the queue, cutoff, cancellation, idle re-enrollment,
response limits and cancellable deadlines. TypeScript port tests execute the actual
metadata/transcript adapter, including delayed startup and cancellation during
close. These are source tests. APK compilation, physical microphone/speaker,
acoustic latency, barge-in and user acceptance require separate evidence. This does
not qualify speech or close issues #397, #413, #423 or #395.
