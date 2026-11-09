# Pixel native integration review

The application candidate adds touch-only focus-ring suppression, bounded queued pinch zoom,
native focus feedback, target-lens focus reset and optional shutter feedback. Preview ownership,
stop, capture and stale completions continue through the shared camera session. Screen focus
ownership remains unchanged; styling now records keyboard-navigation intent separately.

The browser host is compiled once as its existing native module. Normal/private profile names,
stored tabs, cookies, bookmarks and reviewed reading identities remain Alpha's existing inputs.
The optional below-host presentation requires current host rectangles. Malformed presentation
withdraws input/reading authority. The existing native input router owns geometry and gesture
routing. BrowserUnderlay records the bounded admission and sticky-gesture contract; its pause
transition abstracts Android gesture cancellation. Native runtime sequencing still requires the
exact signed-app check. BrowserSession and BrowserSiteState retain session/site authority.

The additional native module source includes generic implementations that Alpha does not
register as product plugins, plus Android/JVM test support. They retain explicit source-audit
obligations; allocation is not whole-library formal verification. Coordinates, clipping, camera
capabilities, autofocus completion, audio policy and timing remain native/physical evidence.
The 30 native library tests, 14 disposable Android underlay cases and camera/browser regressions
are separate receipts. Coroutines remain on the existing 1.9.0 runtime; the four actual Android
runtime classpaths and notices were regenerated.

No source inventory update establishes APK signing, update retention, Pixel acceptance,
production OTA trust/recovery or recording approval.
