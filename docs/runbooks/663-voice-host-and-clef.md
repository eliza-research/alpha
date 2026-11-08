# #663 Admit the on-device voice host and decide the Clef endpointing model

Owner prep for [#663](https://github.com/eliza-research/alphaphone/issues/663) (checklist steps
H-18 and H-19 in [human actions](../human-actions.md), requirement AP-06, umbrellas #381, #397,
#413, #423). It turns H-18 into exact steps, lists which fields of
`android/voice-host/qualified-voice-host.json` keep `qualified: false`, reports whether H-19
applies today and drafts both Clef decision entries. It changes no record, no build input and
no APK. Nothing in this page was run on an emulator, image or device.

Evidence classes stay separate: component corpora on a device, an APK build, an installed-app
run, physical capture and playback, and user acceptance. None proves another, and no desktop or
model-card figure is a phone measurement ("fastest on phone" needs a phone run).

## Read-only findings (2026-10-28, `origin/main` 94676c82, pin `1f2a922f86e2`)

| Probe | Result |
| --- | --- |
| `npm run human:status` | `H-18 open: qualified: false (device executed: true, emulator executed: true, user accepted: false)`; `H-19 not needed: script-supplied while remapBuildPath is true`; `H-20 open` |
| `npm run android:build:inputs` | `[PERSON] on-device voice outputs` (not staged in `.eliza/paradee-voice/native`), `[PERSON] on-device voice qualified`, `[PERSON] release signer`; `embedding host libraries` is a `[script]` row (`npm run agent:build-embedding-host`) |
| `android/embedding-host/build-toolchain.json` | `remapBuildPath: true`; its evidence says fresh-path and cross-host reproduction of the current engine "has not been measured" |
| `android/voice-host/qualified-voice-host.json` | schema 2, `pin` = `upstream.lock.json` commit, `qualified: false`, `evidence.deviceExecuted: true`, `evidence.emulatorDeviceExecuted: true`, `evidence.userAccepted: false`, `evidence.scope` "component corpora and full Alpha JNI embedding only" |

**H-19 does not apply today.** The report lists the embedding host as script-supplied. It turns
into a person step only if `npm run agent:build-embedding-host` (a step of
`npm run android:build:local`) cannot reproduce the reviewed bytes on the build host. Then the
row becomes `[PERSON]` and the chain stops at Gradle `:app:verifyEmbeddingHost`. Because cross-host
reproduction has not been measured, the first strict build on a new host is when that shows up.
Run `npm run android:build:inputs` again after that build.

Side observation: with `vendor/eliza` not checked out, the report's "pinned upstream checkout" row
prints the superproject's commit (`vendor/eliza at 94676c82…`) because `git -C vendor/eliza`
falls through to the parent repository. The row is still correctly `missing`, but the commit it
prints is misleading.

## Which fields block `qualified: true`

`scripts/voice-host.mjs` `voiceHostProblems` refuses `qualified: true` unless
`evidence.deviceExecuted === true` **and** `evidence.userAccepted === true`.
`evidence.emulatorDeviceExecuted` must also be a boolean. Release admission
(`scripts/release-blockers.mjs`, `scripts/verify-apks.mjs`) also needs the packaged bytes to
match the record exactly.

| Field | Now | Blocks `qualified: true`? | What sets it |
| --- | --- | --- | --- |
| `qualified` | `false` | the flag itself | the reviewer, last |
| `evidence.userAccepted` | `false` | **yes (schema)** | named reviewer, after the installed-app and physical checks below |
| `evidence.deviceExecuted` | `true` | no; already true (Pixel ARM64 component corpora, `docs/evidence/native-c95a`) | already recorded |
| `evidence.emulatorDeviceExecuted` | `true` | no (must only be boolean) | already recorded |
| `evidence.scope`, `acceptance` | component corpora only | not checked by the schema, but they record that installed-app streaming and cancellation, physical capture and playback, workflows and user acceptance are pending | reviewer rewrites them with the new records |
| `evidence.records[]` | six native-c95a component files | not checked | append the new installed-app and physical records |
| packaged bytes vs `abis[].libraries`, `models[]` | not staged in this checkout | `verify-apks` blocks distribution on any difference | staging (step 3) |

**Schema gap.** Only `userAccepted` is enforced. Installed-app streaming and cancellation and
physical capture and playback have no field, so setting `userAccepted: true` and
`qualified: true` would pass the schema with no record of those checks. Recommendation (not done
here): before admission, add required `evidence.installedApp` and `evidence.physicalAudio`
objects with `recorded`, `record`, `reviewer` and `date`, and reject `qualified: true` without
them, in the same reviewed change.

Reviewer items the schema does not check: `components[1].license` is `UNVERIFIED` (elizaOS voice
runtime sources). Phonon-2 has training-data licence flags (CHiME-6 CC-BY-SA-4.0, SPGISpeech).
eSpeak NG is GPL-3.0-or-later. Under P-09 these are flagged and never block a build, but a named
reviewer should look at them before saying the host is accepted.

## Qualification runbook (H-18)

Roles: a **named reviewer** (records acceptance) and an **operator** (runs devices). Hardware:
one physical ARM64 Pixel (a Pixel 10a for the product claim), one API 35 x86_64 emulator, wired
or Bluetooth headset for routing checks. Toolchain: NDK 28.2.13676358, CMake 4.0.3 (the record's
`componentBuild`), JDK 21, Android SDK platform 36.

### 1. Pinned checkout

```sh
git submodule update --init vendor/eliza
git -C vendor/eliza rev-parse HEAD          # must print the commit in upstream.lock.json
npm run upstream:prepare-client
```

Never edit `vendor/eliza`. The upstream qualify project builds inside the checkout. Build it from a
separate disposable worktree of the same commit, for example
`git -C vendor/eliza worktree add /abs/eliza-qualify "$(jq -r .commit upstream.lock.json)"`, so build outputs never land in
the vendor checkout.

### 2. Build the voice outputs at the pin

```sh
node scripts/build-pinned-voice.mjs --workspace /abs/voice-work --out /abs/voice-out-$(date +%F)
```

`--out` must be a new directory outside `vendor`. The wrapper checks that sources are clean
before and after, and checks every output hash. Expected: `/abs/voice-out-…/build-record.json`
lists `jniLibs/arm64-v8a/libelizainference.so` (8,066,120 bytes, sha256 `c1679c25…`) and the
x86_64 engine recorded in the voice host record. If the engine bytes differ, staging refuses
them. Do not use `--unrecorded-engine` for qualification (it is for hosted developer APKs only).

### 3. Models and staging

Put these in `/abs/voice-models` with the exact bytes the record pins:
`asr/phonon-2-fv5.gguf` (208,932,352 bytes, sha256 `c0f6ad42f0a5…`), `vad/silero-vad-v5.gguf`
(620,736 bytes, the pinned Hugging Face revision in `models[10].url`) and the Phonon-2 NOTICE and
licence text (`licenses/Phonon-2-*`).

```sh
node scripts/android-stage-voice-models.mjs --plan
node scripts/android-stage-voice-models.mjs --from /abs/voice-out-… --from /abs/voice-models
node scripts/voice-host.mjs --verify        # {"status":"packaged","qualified":false}
npm run android:build:inputs                # "on-device voice outputs" now [ready]
```

### 4. Component qualification on both ABIs (upstream harness)

From the disposable eliza worktree, build and install `packages/app/scripts/paradee-voice/qualify`
(`:app:assembleDebug :app:assembleDebugAndroidTest`, `-PasrFixturesDir=<dir>` from
`host-wer-gate.ts --export-device-fixtures <dir>`). Then run the instrumentation once on the ARM64
Pixel and once on the x86_64 emulator:

```sh
adb -s <serial> shell am instrument -w -r ai.eliza.voicequalify.test/androidx.test.runner.AndroidJUnitRunner \
  | tee docs/evidence/<new-dir>/voice-<pixel|emulator>.log
```

Expected (format of the retained `docs/evidence/native-c95a/voice-pixel.log`): both
`AsrWerTest.nativeAsrMeetsWerOnPinnedSpeech` and `ParadeeRoundTripTest` pass, with
`INSTRUMENTATION_RESULT: asr-wer=WER=…` around 2% and `silence=empty`, and `paradee-roundtrip=WER=…`
around 4.5%. Pull the JSON reports from `/storage/emulated/0/Android/data/ai.eliza.voicequalify/files/`.
This is **component** evidence. It repeats what `native-c95a` already holds and is needed only
when the bytes change.

### 5. Installed-app checks (the missing evidence)

Build both variants with the full chain (`npm run android:build:local`, see README), install the
standalone and launcher APKs on the Pixel, sign in, and record each item as pass or fail with
the diagnostics export (`alpha-native-voice-timing-v3`; numbers only, never audio or text):

| # | Check | Pass when |
| --- | --- | --- |
| I-1 | Transcribe: speak, Stop | Editable text appears in review, nothing is sent until Send |
| I-2 | Voice assistant streaming | Interim "Heard so far, not sent" text updates; final arrives once per turn |
| I-3 | Endpointing | Turn submits about 1.2 s after speech ends; timing record `endpoint.path` is `gap` (or `semantic` where the scorer loaded), with the reason recorded |
| I-4 | Cancel before playback | Speech during a pending reply cancels it; the turn is not resent |
| I-5 | Barge-in during playback | With echo canceller attached, speech interrupts; the view marks "(Interrupted…)" and only played sentences are kept; a `heard` outcome is recorded |
| I-6 | No Stop speaking button | Voice view shows only Mute and Stop voice conversation |
| I-7 | Cough or echo of the reply | Reply keeps running |
| I-8 | Action proposal reply | Voice ends for review; nothing is approved automatically |
| I-9 | Account change / sign-out mid-turn | Capture stops; no audio crosses owners |

### 6. Physical capture and playback

On the Pixel speaker and microphone, a wired headset and a Bluetooth headset: capture level is
non-zero; replies are audible; audio focus ducks or pauses media and restores it; an incoming call
stops capture and playback; screen lock stops capture. Record pass or fail per route.

### 7. Record and admit

Commit the new records under `docs/evidence/<dated-dir>/`. Then, in one reviewed change to
`android/voice-host/qualified-voice-host.json`: append the records to `evidence.records`, rewrite
`evidence.scope` and `acceptance` to name exactly what ran, set `evidence.userAccepted: true`
(named reviewer and date in `acceptance`), then `qualified: true`. Check:

```sh
node --test test/voice-host-record.test.mjs test/human-actions.test.mjs
npm run human:status                        # H-18 done
```

`qualified: true` makes releases distributable only together with a signer (H-08 to H-10). It
says nothing about the always-on listener (#664) or the AOSP image.

## Clef: what the pin actually does

P-39 says the short gap should "evaluate semantic turn completion with Clef". The pin has no Clef
model, loader or decision head. Cloudflare Clef-Flash is 9B (full Clef 27B) and has no on-device
build ([local speech research](../local-speech-research-2026-10-12.md)). What ships at the pin
(see [fused speech](../fused-speech.md), Endpointing):

- After a 300 ms gap the renderer asks the resident's `POST /api/asr/local-inference/end-of-turn`.
  That route is the fused **Eliza-1** end-of-turn scorer (elizaOS #36546), not Clef. It has a
  600 ms deadline, and a long gap of 1,200 ms always submits.
- The route never loads a model. It answers only where the resident's voice bridge and fused text
  context are loaded. Otherwise every turn falls back to the long gap
  (`scorer-unsupported`, `ffi-context-unloaded`, …). How often it answers on the phone has not
  been measured.
- The 300/600/1,200 ms values are engineering defaults, not measurements.

Any small model admitted here must be GGUF on libelizainference: no other neural runtime may
ship (`test/llama-cpp-only.test.mjs`, `scripts/audit-production-bundle.mjs`, P-42). An ONNX model
such as Smart Turn v3 (8M, acoustic) would need an upstream GGUF port first.

## Decisions for the owner

### D-1 Clef endpointing (required by #663 step 4)

| Option | What it means | What it changes |
| --- | --- | --- |
| **A. Accept the long-gap fallback** (documented default, H-18 text) | Voice turns end on the 1,200 ms gap. The pinned Eliza-1 scorer may end turns earlier where the resident has it loaded. No Clef model ships. | P-39 is amended: "Clef" becomes "the pinned Eliza-1 end-of-turn scorer when available, otherwise the long gap". #423 can close its Clef item. Without a scorer answer, a turn submits about 1.7 s after the last word (about 512 ms VAD hangover plus 1,200 ms). No new bytes, no new qualification. |
| **B. Admit a small turn-detection model under #423** | A reviewed, on-device GGUF turn-detection model (text or acoustic, well under 1B) behind the existing short-gap hook. It is admitted like Phonon-2: pinned bytes, licence, upstream loader, phone measurements. | A new upstream step (model and loader in libelizainference, an `end-of-turn` backend), a voice host record change (new `models[]` row, new role), re-running H-18 on both ABIs, phone measurements of latency, memory, battery and false-submit rate. Delays H-18 until done. |

Recommendation: **A now, B later as its own issue.** H-18 already documents A, so it does not
block admission. Revisit B once phone measurements of the Eliza-1 scorer's availability exist.

### D-2 Who signs H-18 (required)

The named reviewer who sets `userAccepted: true`. No default. Shaw is the accountable release
owner (P-16).

### D-3 Tighten the voice host schema before admission (recommended, optional)

Default: leave the schema as is. Recommendation: add the required `installedApp` and
`physicalAudio` evidence fields described above, so `qualified: true` cannot be recorded without
them. Changes `scripts/voice-host.mjs` and its test, and does not touch the record bytes.

## Draft decision entries

Paste exactly one of these into `docs/decisions.md` after the owner chooses (number assigned at
merge time; P-56 is the last entry on `main` today).

**Variant A (long-gap fallback):**

> - **P-xx — MVP-01 ([#423](https://github.com/AlphaCompute/alphaphone/issues/423), #663):** Clef is not admitted (owner, 2026-10-__). Clef-Flash is 9B with no on-device build. The voice assistant ends a turn on the long gap (1,200 ms after VAD speech-end). At the short gap (300 ms) it asks the pinned Eliza-1 end-of-turn scorer (`/api/asr/local-inference/end-of-turn`, elizaOS #36546), which submits early only when available and complete. Unavailable is never complete. The gap values are engineering defaults to tune on a device. Amends P-39's "with Clef". A small turn-detection model may be proposed later as a separately reviewed GGUF admission. No hosted endpointing is used.

**Variant B (admit a small turn-detection model):**

> - **P-xx — MVP-01 ([#423](https://github.com/AlphaCompute/alphaphone/issues/423), #663):** Instead of Clef-Flash (9B, no on-device build), Alpha admits `<model name, revision, bytes, sha256, licence>` as its short-gap turn-completion model (owner, 2026-10-__). It runs as GGUF on libelizainference through `<upstream loader/PR>`. It ships in the voice bundle as a new `models[]` row of `android/voice-host/qualified-voice-host.json`, and the host is qualified again on both ABIs (H-18). The long gap (1,200 ms) still always submits, and an unavailable or late model never counts as complete. Admission needs phone measurements of p95 decision latency, resident memory, battery cost and false-submit rate on `<device>`, not desktop model-card figures. Amends P-39's "with Clef".

## Remaining human steps

1. Owner: choose D-1 (A or B) and D-2. Optionally D-3.
2. Operator: steps 1 to 6 above on a physical ARM64 Pixel and the API 35 emulator. Commit the records.
3. Reviewer: step 7, plus the chosen decision entry in `docs/decisions.md`.
4. Anyone, after the first strict build on the release host: `npm run android:build:inputs`. If
   the embedding host row turns `[PERSON]`, do H-19 (`node scripts/stage-embedding-host.mjs
   --receipt docs/evidence/native-c95a/embedding-QUALIFICATION.json`, or qualify a candidate with
   ARM64 execution evidence).
