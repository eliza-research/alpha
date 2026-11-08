# Cuttlefish resident JNI staging

A system APK needs its resident executables installed beside the app, not only
embedded in the ZIP. Alpha's native bridge locates Bun through Android's
`nativeLibraryDir`. The generic `android_app_import` does not install these JNI
files. A sideloaded APK's extracted libraries do not prove a system-image install.

For the reviewed x86_64 Cuttlefish product, explicitly select this staging lane:

```sh
node scripts/stage-aosp.mjs --development --target cuttlefish \
  --applied-build-patch soong-app-native \
  --apk /absolute/path/to/normalized-signed-launcher.apk \
  --apk-manifest /absolute/path/to/matching-apk-manifest.json \
  --aosp-source /absolute/path/to/aosp \
  --output /absolute/path/to/new-overlay
```

The normal APK hash, signer, launcher, profile, packaged-runtime and secure-camera
source gates run first. Staging is atomic into a new external directory; it does
not change the AOSP source or build an image. Install the reviewed generated
content under `vendor/alphaphone` and inherit its `product.mk` from the explicit
`alpha_cf_x86_64_phone` product. Production staging still requires the complete
production source/product lock, release signer, listener and distributable APK;
this development command does not satisfy those gates. The product descriptor
(`android/aosp/product.json`) is checked by the shared
`packages/os/scripts/android/cuttlefish-product.mjs` against the shared reviewed
`cuttlefish` profile in `vendor/eliza/packages/os/android/aosp.lock.json`
(android-17.0.0_r1); Alpha keeps no Cuttlefish source lock of its own. Its host
package hashes and the image platform certificate stay unset until the image
host and release signer are chosen (A-01, A-06).

Launcher APK admission is shared: `scripts/stage-aosp.mjs` passes Alpha's policy
(`artifacts/test-mocks/`, its `apk-manifest.json` and `release-blockers.mjs`) to
`packages/os/scripts/android/image-apk-admission.mjs`, which refuses test-mocks paths and web
bundles, judges the recorded release row, and admits only debuggable APKs for development. The
same module checks the reviewed source overrides of a staging run (applied patch preimages,
revisions, paths and bytes against the pinned source lock).

`stage-aosp-native.py --target cuttlefish` selects only `lib/x86_64`, checks ELF64
little-endian x86 machine headers, and requires the complete resident runtime.
It verifies the original runtime file inventory, selected x64 Bun artifact pin,
JNI/asset equality, source stamp and complete worker closure. Cloud omission and
mixed-profile checks remain unchanged. ARM libraries in a multi-ABI APK cannot
substitute for missing or invalid x86 libraries. Unknown targets are rejected.

The shared native admission verifies the payload. Alpha then converts its legacy
install rules to a Soong `android_app_import` with required `prebuilt_app_native`
modules, because this Cuttlefish product ignores `Android.mk`. Apply the exact
recorded patch in `vendor/eliza/packages/os/android/patches/soong-app-native` and pass its admission flag above.
`config.fs`, included by the product fragment, makes Bun and both loader files
0755 and the shared libraries 0644 under
`/product/app/AlphaPhone/lib/x86_64`. The launcher ZIP is unchanged. Pixel's
`--target pixel10a` keeps the existing ARM64/stallion installation lane.

Offline fixtures cover wrong/missing ABI payloads, missing runtime files,
self-consistent substitutions that disagree with the trusted Bun pin, exact
installation paths and executable modes. They do not prove AOSP compilation,
full-image boot, native execution, HOME selection, Cloud access or release
qualification. Generated `runtimeVerified` and `deployReady` remain false;
those checks need separate image/device evidence.
