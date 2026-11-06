# Notes recorder native patches

Two explicit native patches admitted by `native-manifest.json` (applied by
`scripts/prepare-patched-native.mjs` into the staged Android sources; the vendor checkout is
never edited). Base: elizaOS/eliza `0594fc72da4450a84a986ad12e730e3faa902018`. Both are
upstream proposals; once merged and the pin moves, drop them from the manifest.

## notes-recording-store.patch (`plugins/plugin-native-media/android`)

`RecordingStore` gains `Limits` (largest file, longest duration, longest transcript, restore
window) with `CLIPS` as the unchanged default, a constructor taking a host's `Limits`, and
`retain(..., boolean move)`, which renames a source in the same file system into place
instead of copying it.

Alpha uses it in `AlphaNoteAudioPlugin`:
- Notes recordings (`AlphaNoteRecorder`, PLAN.md section 3 "Unlimited recording") have no
  length or size bound; their transcript is bounded at 150,000 characters, which fits the
  512 KiB `note-audio-metadata:v1:` slot. The joined file is moved, not copied.
- Both clips and Notes recordings use a 60-day restore window (`AUDIO_BACKSTOP_MS`, twice the
  30-day Recently deleted retention). With the store's default 30 days the orphan backstop
  fired a few milliseconds before the Trash rules, erasing a recording a restorable note
  still used.

## notes-recording-segments.patch (`plugins/plugin-local-inference/native/android`)

`LocalVoiceRecording.selectAlso(Function<String,File>)`: a host's own finished recordings that
transcription may select by id when no draft matches. Alpha registers the Notes recorder's
finished segments (`<recordingId>-s<n>`), so the shared on-device, paired and Cloud
transcription methods accept a segment exactly as they accept a draft. A draft with the same
id is always chosen first.

## Tests

`node scripts/prepare-patched-native.mjs` admits both (digests, headers, `patch --fuzz=0`,
full output inventory). `test/resident-native-patch-admission.test.mjs`,
`test/gradle-verification.test.mjs`, `test/android-host.test.mjs`,
`test/source-snapshot.test.mjs` and `test/android-dependency-fingerprint.test.mjs` pass.
The patched Java has not been compiled here; the Android build compiles it.
