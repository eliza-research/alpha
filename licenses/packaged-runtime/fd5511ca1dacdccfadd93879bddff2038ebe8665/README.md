# Packaged runtime notice snapshot

This archive preserves the complete notices from the strict Android build at the recorded Eliza pin. It is evidence for those packaged bytes, not a dependency list for the source-only web build.

The public web defaults are generated with `node scripts/generate-licenses.mjs`. They can be checked in a clean checkout without a local runtime. `npm run android:build:local` stages the runtime and regenerates the complete public notices with `--packaged-runtime` before packaging; APK verification requires those runtime notices. After building, regenerate the source-only defaults before committing.

`snapshot.json` binds the archived notice files to their hashes and the staged agent bundle inventory. It does not establish voice, device, integration, or user acceptance.
