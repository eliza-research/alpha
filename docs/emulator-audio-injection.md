# Known speech through the emulated microphone

`scripts/inject-emulator-audio.py` streams a known speech WAV through the installed
Android Emulator's `EmulatorController.injectAudio` RPC. It never replaces the
application's captured audio file or supplies a transcript. The exact recorder,
AAC encoding, host ASR, review and save paths still have to run through the app UI.
This proves emulated microphone input, not physical microphone hardware.

## Dependencies and preparation

Use an isolated host environment (no global or app dependency change):

```sh
/Users/shawwalters/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m venv /tmp/alpha-grpc-runtime
/tmp/alpha-grpc-runtime/bin/pip install grpcio grpcio-tools
/tmp/alpha-grpc-runtime/bin/python scripts/inject-emulator-audio.py --prepare /tmp/alphaphone-known-speech.wav
```

Preparation uses macOS `say` Samantha and installed `/opt/homebrew/bin/ffmpeg`.
The phrase is “Please remember to water the plants tomorrow morning.” The WAV
is mono16kHz signed16 PCM. Its hash is reported; no credentials are reported.

## Coordinated run

Before opening the app microphone, the emulator owner can use the read-only
`--check-microphone` flag with the admitted authenticated runtime and explicit
port (for example `--port 5556 --check-microphone`). It calls only
`getMicrophoneState`, reads no WAV and reports `hostMicEnabled` and
`safeForControlledInjection`. Host input enabled returns exit2; safe returns
exit0. Missing supported bearer discovery refuses as before. This flag cannot be
combined with `--prepare` or `--inject`; it never disables host input or injects
audio. Temporary local protocol compilation is not an emulator/file-state change.
For the current Cloud chat test, use the separately reviewed **Open Calendar**
fixture and the normal Talk control after this preflight. The Notes/local-ASR
record/save campaign below is historical evidence for a different flow, not a
substitute for Cartesia STT, Cerebras action and Cartesia playback acceptance.

The emulator owner launches phone port5554 with a loopback gRPC endpoint and
`-grpc-use-token` (for example `-grpc 8554 -grpc-use-token`). Do not restart a
shared running emulator while another test owns it. The helper requires its
matching `pid_<PID>.ini` discovery file, current-user ownership, `port.serial=5554`,
`grpc.port`, and `grpc.token`. Standard macOS discovery directory is
`~/Library/Caches/TemporaryItems/avd/running`; use `--metadata /path/pid_<PID>.ini`
only for another actual emulator-generated discovery location. It never accepts
a token on the command line and has no unauthenticated fallback. JWT-only
endpoints are reported but not used; signing support is not implemented.

Run without flags to inspect matching process/metadata **keys only**. The current
pre-restart phone PID50064 had no discovery file; authentication could not be
inferred. No injection was attempted during that inspection.

1. Open Notes → Record and transcribe → Start recording. Grant microphone access.
2. Once the UI confirms recording, run:

```sh
/tmp/alpha-grpc-runtime/bin/python scripts/inject-emulator-audio.py --inject /tmp/alphaphone-known-speech.wav
```

3. Wait for injection success, then tap Stop recording in the app.
4. Tap Transcribe locally. Confirm actual recognized text contains the phrase.
5. Edit review text, save explicitly, reopen Notes and verify persisted bytes.
6. Record APK hashes, injection report, transcript and saved-note evidence.

The helper queries microphone state and rejects enabled host-microphone input;
it never changes that setting. It sends20ms chunks, with0.5s silence before/after,
and uses default backpressured delivery, a45s RPC deadline, a30s fixture limit.
The installed proto is compiled temporarily so service contracts match the
installed emulator. A cancelled/failed injection does not imply successful
capture; discard the app recording and retry the full flow explicitly.

Sources: installed `~/Library/Android/sdk/emulator/lib/emulator_controller.proto`
(lines334–348,1500–1547 in emulator36.5.10) and the
[official protocol](https://github.com/google/android-emulator-webrtc/blob/master/proto/emulator_controller.proto).
[Android's GUI documentation](https://developer.android.com/studio/run/emulator-extended-controls)
only documents host-microphone input, not a file-upload control.
