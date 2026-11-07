# Prototype camera adapter integration

`apps/app/src/prototype/camera-adapter.ts` preserves the existing camera controls,
photo thumbnail grid and immersive viewer. Install it after the native and
selected-document adapters using
`installPrototypeCameraAdapter(Component, VIEWS)`. Keep fixture mode unmodified.
The return value removes listeners, restores module methods and stops preview.

The native dependency remains pinned at the commit in `upstream.lock.json`.
The adapter registers only the Android wire subset as `ElizaCamera`; it does not
pull an upstream workspace dependency graph into the renderer.

The preview/capture/recording lifecycle is upstream's shared camera session
(`plugin-native-camera/src/session.ts`, projected into
`.eliza/client-features`), the same one `CameraPageView` drives. The adapter
supplies only Alpha's presentation and destinations: the access panel and
notices, the preview mask, preview and recording options, and the
`recordingSaved` hook that reads a finished recording back from Photos. Epoch
fencing, chained releases, the one-capture-at-a-time lock and single-flight
recording finalization are not reimplemented here. Explicit-denial
classification and resume recovery come from the shared host ports.

## Android wiring for the build owner

The Gradle host is generated from `android/consumer-host.json` by the pinned upstream
consumer-host generator (`npm run android:host`). The camera module is one of its
`profile.modules` entries, linked into the app:

```json
{ "name": "eliza-camera", "source": { "root": "upstream", "path": "plugins/plugin-native-camera/android" } }
```

In `MainActivity.java`, alongside the existing plugin registration before
`super.onCreate(savedInstanceState)`:

```java
registerPlugin(ai.eliza.plugins.camera.CameraPlugin.class);
```

The generated root build declares Kotlin 2.2.20 and AGP 8.13.0 (the generator's
reviewed toolchain). Upstream
applies `org.jetbrains.kotlin.android`, targets Java/Kotlin 21 and declares
CameraX 1.5.3 and ExifInterface 1.4.2. Its manifest merges CAMERA, RECORD_AUDIO
and WRITE_EXTERNAL_STORAGE (maximum API 28). This adapter does not request
microphone access or invoke video recording. `startPreview` requests the camera
permission itself. Do not add a duplicate prompt for all upstream permissions.
Verify both release and debug variants contain the plugin class.

## Exact native rendering contract

`vendor/eliza/plugins/plugin-native-camera/src/definitions.ts` declares an
`HTMLElement` preview argument for web. The pinned Android implementation,
`android/src/main/java/ai/eliza/plugins/camera/CameraPlugin.kt`, ignores that
argument. `startPreviewInternal` creates a MATCH_PARENT `PreviewView`, inserts it
at index zero in the WebView's parent and makes the WebView background
transparent. It accepts direction, resolution and mirror; it does not implement
DOM element bounds or a rectangle argument. Serializing an HTMLElement would
not bind a native preview to it.

The product adapter therefore reveals that native full-screen preview through
the exact existing viewfinder aperture. It marks the viewfinder's ancestor chain
transparent and masks the rest of the prototype screen black, using the actual
DOM rectangle and scale. It hides the decorative frame behind the screen while
preview is active. It removes those marks on leave, backgrounding and disposal.
The original top/bottom controls remain WebView controls. The full native preview
is cropped by the aperture; CameraX sensor framing is not resized to the smaller
DOM rectangle. A future exact viewfinder-framing requirement would need a
reviewed upstream rectangle/layout feature, not invented JavaScript arguments.
Tap focus is normalized to the full WebView viewport because the native metering
surface is full-parent. Insets and visual focus alignment require device tests.

## Implemented behavior and limits

Entering the real camera screen starts CameraX preview. Permission denial or
missing bridge shows an explicit message and the shutter retries. Leaving,
backgrounding and cleanup stop preview and invalidate pending controls. Switching,
flash, zoom and focus report confirmation only after their native promises finish.
Unsupported device controls show a failure and do not change cached UI settings.

The shutter requests JPEG quality 85 at the camera's original oriented dimensions
with native gallery saving. The pinned plugin independently replaces width and
height when requested; the earlier width-only request could distort aspect ratio.
Current source omits both dimensions and uses AlphaPhotos for bounded display
previews. Build 18 passed capture/readback in both variants; a manual front-camera capture saved and displayed its native 960 × 1280 dimensions.
Only a response with an actual path, encoded image and positive dimensions becomes
a completed capture. The returned image appears in the existing last-photo button
and Photos grid/viewer. The current source adds `AlphaPhotos`, a product-owned,
read-only MediaStore adapter that selects only this package's published, non-trashed
images. It loads 24 records at a time, decodes thumbnails to at most 240 pixels and
decodes a selected preview to at most 1024 pixels. Images and URI authority are not
stored in localStorage. Photos and Camera reload the catalog after Activity
recreation; background/resume refreshes it. Other personal images still use the
Android picker. A deleted or unreadable capture reports an error instead of a
successful preview. If a capture completes after navigation,
its real gallery receipt is retained without navigating the user back.

Video, OCR/scanning, image analysis, editing, sharing, favorites and deletion of
captured images are explicitly not integrated. No synthetic capture, scan result,
recording timer or image-analysis answer is produced. Gallery errors can have
upstream cleanup implications; the adapter never claims success without the
completed native photo receipt.

## Verification boundary

Build 18 passed both variants of the full Android suite, including genuine CameraX
capture, MediaStore byte readback and capture → Activity recreation → Photos →
saved image. A separate manual build 17 run verified catalog reload after a
confirmed process stop and fresh launch. Activity recreation is not a full process-death test.
Permission denial/retry is a separate opt-in instrumentation fixture. Manual preview
framing, switch/zoom/focus/flash, rapid navigation, background/resume and both
variants remain distinct acceptance checks. Use [verification gates](verification.md) and revision-bound reports rather than
treating this implementation description as current test evidence.

Build 17 update: repository verification and both debug/release variants passed.
The standalone capture → MediaStore byte readback → Activity recreation → Photos
viewer flow passed, and a separate revoked-permission test passed deny → shutter
retry → grant → native preview. Both have terminal evidence under
`test-results/prototype-build17`. Full process death, paging beyond 24 images and
external deletion are still distinct checks; recreation alone does not prove them.
