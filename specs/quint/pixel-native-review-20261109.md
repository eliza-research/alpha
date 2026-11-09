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

Keyboard dismissal now consumes the actual Android IME-visible to IME-hidden transition.
It releases only the active Alpha composer, including full conversation; initial/repeated hidden
insets and another text field retain focus. Browser previews retain viewport inference. The
KeyboardFocus model separates IME visibility from resizing, and the production-handler tests
exercise both composers, retained draft/selection, retap, initial hidden state and foreign focus.
The old Pixel v44 reproduced hidden IME with retained composer focus and a failed retap.
The new native bridge still requires installation and physical verification; a model/test pass
does not establish that result.

The launcher adds an auxiliary voice IME for LatinIME's microphone shortcut. Dictation owns a
bounded recording and inserts only into the unchanged original editor after current provider
authority is checked. It does not submit text. The KeyboardDictation model is refined against
the actual Java gate; separate host tests exercise stale recording IDs, cancelled results,
sensitive fields and intercepted real-client HTTP routes. Direct uses its existing Cartesia key
without Cloud fallback; Cloud uses its selected account. These controlled HTTP tests are not live
provider evidence. Android input-method switching, actual insertion and cancellation, full-image
enablement and the interaction with native keyboard-hide focus remain installed-device gates.
