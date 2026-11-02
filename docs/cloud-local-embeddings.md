# Cloud profile with local embeddings

`--local-embeddings` is an explicit packaging capability of the existing Cloud profile, not another inference provider or runtime profile. It retains the canonical BGE small model (384 dimensions) and the qualified ARM64 `libelizainference.so`, `libelizavoicejni.so`, and `libc++_shared.so`. No local chat, recognition or speech model is added. Cloud text and optional Cartesia speech continue to use their existing routes.

The shared native provider admission must include the reviewed Direct embedding fix: validated Cerebras selection uses `NativeRuntimeEmbeddings.applyLocal`; Cloud selection keeps its Cloud route. Without local files, Direct embeddings remain unavailable and never silently fall back to Cloud. The same model path, vector space and data store are used.

After preparing the genuine resident bundle, stage the existing runtime/model using:

```sh
npm run agent:stage-android -- --runtime-profile=cloud --local-embeddings
```

Staging declares the requested capability and preserves the producer's BGE provenance. It does not qualify native libraries. Build and qualify the current embedding host through the existing component producer, then stage its reviewed receipt with `scripts/stage-embedding-host.mjs --receipt <receipt>`. The old recorded libraries cannot pass this gate. The component producer's import closure must be qualified separately before running it.

Then use:

```sh
npm run android:build -- --runtime-profile=cloud --local-embeddings
```

The option propagates through preflight, Gradle, APK verification, archives, and signing verification. Admission requires the exact model and qualified library hashes, rejects unsupported ABIs, additional local models and speech assets, and rejects a mismatch between the selected capability and the staged/build metadata. The ordinary Cloud profile still excludes all local models and inference libraries.

Source and synthetic ZIP tests do not establish native execution or complete Direct functionality. Before calling this ready, qualify the current engine/JNI/model on Android, then test Direct prompts and Notes/Calendar with no Cloud credentials, plus Cloud-to-Direct and Direct-to-Cloud switching. AOSP image staging currently rejects this extended Cloud capability; its independent profile admission is not changed by this APK patch.
