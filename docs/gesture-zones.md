# Gesture zones and Android's notification shade

This page says which swipes belong to Android and which to Alpha, and how a person reaches
notifications and quick settings. It records the behaviour in source after the owner's
2026-10-12 decisions A-32 and A-33 (issues #416 and #417): `apps/app/src/prototype/model.js`,
`system-shade.ts`, `template.html`, `phone.css`, the shared `SystemShade.java` (plugin-native-system,
consumed through the pin) and `AlphaDevicePlugin.java`.
Browser tests are Chromium on a development or production build. They are not emulator,
TalkBack, AOSP-image or device evidence. The instrumented classes named at the end, except
`NotificationChannelsInstrumentedTest`, ran at `69a4be6c` on an API 35 Google APIs emulator on
2026-10-14 (class E, developer APKs, [verification](verification.md#emulator-results-at-69a4be6c-2026-10-14-system-shade-416-417)).
There `AccessibilityInstrumentedTest` tested a Home **Open notifications** button that has since
been removed; its current pull-only body has no recorded emulator run. None of this is AOSP-image,
Pixel 10a, TalkBack, Switch Access or device acceptance.

## The rule

Android's shade is the one notification and quick-settings surface. Alpha posts its notices
(workflow results and approvals, hosted results, reminders) as ordinary Android notifications
whose taps are bound to their owner (`WorkflowNoticeTaps`, `HostedNoticePoster`), and Android
shows, taps, clears and silences them. Alpha draws no notification panel, no quick-settings
tiles and no brightness control of its own in any product build. Workflow history stays in
Alpha (Home's Workflows card, then History); Settings stays reachable from Home.

The earlier Alpha panel, opened from a "Notifications" handle on Home, competed with Android's
shade and is removed from product builds. The browser development build
(`ELIZA_DEV_ALLOW_TEST_MOCKS=1`, not on Android) keeps it only as a stand-in for Android's
SystemUI, because a browser has none; it is a developer surface (`simulatedShade`).

## The zones

| Zone | Owner | What happens |
| --- | --- | --- |
| A downward swipe from the top edge of the screen (the status bar) | Android | Android opens its own shade, in both flavors. Alpha does not answer it. |
| Launcher Home: a downward pull that starts on empty Home | Alpha asks Android | Asks Android to expand its shade (`AlphaDevice.openNotificationShade`). See "Empty Home" below for what is not empty Home. |
| Standalone app: any downward pull on Home | Nobody in Alpha | An ordinary app: Android's top-edge swipe is the way in. |
| A swipe in from the left or right edge | Android (gesture navigation) | Android delivers Back. In the browser build the same swipe within 30px of an edge goes Back. |
| A swipe up from the bottom edge | Android (gesture navigation) | Android delivers HOME; the launcher flavor shows Alpha Home. |
| A swipe up on Alpha Home, away from the bottom edge | Home content | Scrolls Home if its content overflows. Open the conversation from the chat dock. |
| The open chat sheet: the Resize chat grabber | Alpha | The sheet follows the finger and rests where it is released. A release within 120 canvas pixels of the collapsed form collapses it, within 120 of the top goes full screen, and a flick (at least 1 canvas pixel per millisecond at release) jumps to either end (`chatRelease` in `chat-overlay-motion-adapter.ts`). |
| Outside the open chat sheet (portrait) | Alpha | Any touch, tap or drag, collapses the chat and reaches nothing underneath; the next touch is ordinary. Assistive technology activates controls directly. In landscape the chat docks beside the app, which stays live. |
| Outside a focused composer or a composer raised from the pill | Alpha | The first tap dismisses the keyboard and returns the dock to rest. The draft stays. The next tap reaches the app. |
| Full-screen chat | Alpha | No grabber: nothing of Alpha's competes with Android's top-edge band. The header starts 16 screen pixels below Android's status bar on the launcher (`--alpha-chat-full-top`, at least 60px of canvas). Shrink chat returns to the last resting height, Minimize chat collapses. |

## Empty Home

`emptyHomeShadePull` in `system-shade.ts` decides. A pull asks for Android's shade only when all
of these hold:

- the launcher presentation, not the standalone app or the assistant surface;
- Home with nothing over it: no app view, conversation sheet or full chat, voice session,
  app drawer, secure (locked camera) state or development shade;
- a clearly downward pull: more than 46 canvas pixels, and more than 1.5 times its sideways
  travel (a card row or Back is sideways);
- it started below Android's 44px status bar band (a pull from there is Android's own);
- it started inside the Home layer, not on an editable element, not while a text field has focus
  (the keyboard may be up), and not on content that is scrolled away from its top (that content
  scrolls back first).

On a phone the WebView may take a vertical drag for scrolling before the page sees it. A Home
whose content fits the screen is marked `data-alpha-home-fits="true"` and gives vertical drags to
the page (`touch-action: pan-x pinch-zoom`). A Home that overflows (large
text or display size) scrolls normally; only at its top, where it cannot scroll further down, does
Alpha take a clearly downward drag on empty Home from the WebView (a non-passive `touchmove` that
calls `preventDefault`, `overflowPullDecision` in `system-shade.ts`), so that pull reaches Alpha
too. Upward drags, sideways drags and drags on a Home scrolled away from its top stay the
WebView's. Chromium's touch pipeline is covered by the short portrait case (412x560) in
`notifications-handle.spec.ts`, since the launcher is portrait only; whether the AOSP image's WebView delivers either path is not
measured.

## Asking Android

`AlphaDevice.openNotificationShade` (launcher flavor) calls
`StatusBarManager.expandNotificationsPanel` by reflection, with the install-time
`EXPAND_STATUS_BAR` permission that only the launcher flavor's manifest declares. It answers
only while Alpha's window has focus. It resolves with one status:

| Status | Meaning | What Alpha shows |
| --- | --- | --- |
| `opened` | Android accepted the call | Nothing more. Not a measurement that the shade is on screen. |
| `standalone` | The standalone app never asks | "Swipe down from the top edge of the screen for Android notifications." |
| `permission-missing`, `unsupported` | No permission, no status bar service, a refused or missing method | "Android did not open its notifications from Alpha. Swipe down from the top edge of the screen instead." |
| `not-in-front` | Alpha's window does not have focus | "Alpha is not in front. Swipe down from the top edge of the screen for Android notifications." |

A failed bridge call is treated as `unsupported`. No status is ever reported as opened unless
Android accepted the call.

## Tests

| Test | Lane | Shows |
| --- | --- | --- |
| `test/system-shade.test.mjs` | `npm test` | The decision rules for empty Home, the surface choice, the fallback text, the template and model gates, the launcher-only permission and the native outcome mapping (source shape). |
| `test/gesture-zones-single-instance.test.mjs` | `npm test` | The swipe handler only asks for Android's shade; the development stand-in is gated; no instrumented test still looks for an Alpha panel. |
| `test/browser/notifications-handle.spec.ts` | `npm run test:browser` | Standalone: no notifications button on Home, and no pull opens anything. Launcher (with the development stand-in): no notifications button on Home; a pull down on empty Home (upper, middle or lower) opens the stand-in, and Close, Back, Escape and an upward swipe close it; the status bar band, sideways drags, an open conversation sheet, an app view, a focused composer and a scrolled Home do not; in landscape an overflowing Home still scrolls with touch and a downward touch pull at its top opens the stand-in; Home content starts 12 screen pixels below a taller status bar at 360, 412 and 480px; every Home app stays reachable above the dock at 200% text. |
| `test/browser/settings-truth.production.spec.ts` | `npm run test:browser:production` | The flag-off bundle with a stubbed Android bridge: no Alpha shade, tiles, brightness or notifications button; an empty-Home pull calls `openNotificationShade`, and so does a second one; a focused composer does not; every non-opened outcome shows its fallback; the browser build has no shade or button. |
| `SystemShadeInstrumentedTest` | emulator (Home method: test-mocks build) | Outcome mapping; EXPAND_STATUS_BAR declared and held by the launcher flavor only; launcher Home's request and empty-Home pull open Android's shade, each pull must reach Alpha's Home and the shade counts only when Alpha asked for it; a pull with the composer focused makes no request; standalone never asks. Passed on both flavors at `69a4be6c` on the API 35 emulator, and 5 of 5 runs with the launcher flavor selected as HOME. A production build covers Home with the Cloud sign-in gate, so there the Home method is skipped. |
| `NotificationsInstrumentedTest` (test-mocks build) | emulator | A posted notice is found and tapped on its own row in Android's shade (opened with Android's global action) and its PendingIntent fires; a notice whose target was cancelled dispatches nothing and does not open its neighbour; the page has no Alpha shade. Passed on both flavors at `69a4be6c`, and 5 of 5 runs as HOME. Android 15 bundles two notices into a collapsed automatic group; tapping that group's summary sent nothing and cancelled both, so the test expands the group first, as a person would. |
| `NotificationChannelsInstrumentedTest` | emulator (campaign `test-native-permissions.mjs channels`) | The recovered channel's notice is tapped in Android's shade. Not run at this source. |
| `AccessibilityInstrumentedTest.homeShadeSettingsAndComposerAtDoubleFontScale` | emulator | A top-edge swipe opens Android's shade with no Alpha panel behind it; Home has no notifications button in either flavor; on the launcher a pull that starts on empty Home opens Android's shade. The pass on both flavors (test-mocks build) at `69a4be6c` covered the earlier body, which used the removed button (an accessibility click sent through UiAutomation, and a pull from the button); this pull-only body has not run. TalkBack and Switch Access on the image are unmeasured. |

## Left open

- Actual AOSP portrait, landscape and lock-screen screenshots of Android's shade with Alpha's
  notices, branding, insets, Do Not Disturb, clear and tap behaviour, and the listening indicator
  (#416, with #424 for the listening tile and #425 for owner-bound reposting).
- Swipe, tap, TalkBack and return behaviour on the AOSP image and a Pixel 10a (#417).
- Asking Alpha about one of its own notices used to start from the Alpha panel. In product
  builds there is no such entry until it is offered from the notice itself (a notification
  action); the browser development stand-in still shows it for development only.

## Reviewed questions from workflow step notices

An Alpha workflow step notice has a native **Ask Alpha** action alongside its normal
open tap. Android requires unlock for the action. It carries the existing opaque,
owner-bound route, never notification text in Intent extras. Alpha resolves the exact
workflow and run under the current agent before offering the editable excerpt review.
Continue rereads the still-posted notice and its revision, consumes only that reviewed
tap, and fills a conversation draft. Send remains a separate choice. Account changes,
Home/background transitions, dismissed/replaced notices and sensitive excerpts cannot
silently insert text. Cancel (or Escape/Back) settles the Ask tap natively and returns
it to untapped, so the review never reopens itself; leaving for Home or the background
keeps it for the next return. If the step notice is gone when its Ask tap is read (timed
out, swiped or withdrawn), there is nothing left to review, and the tap opens its run
like the notice body. Withdrawing a notice revokes both its open and Ask PendingIntents.

This first native action covers workflow **step** notices only. Approval notices retain
their existing run-review tap; Calendar/reminder and other notice publishers still need
an equivalent owner/source-bound review path. Issue #449 remains open for that parity
and actual Android execution. Source tests and synthetic browser bridges do not prove
SystemUI delivery, lock behavior or AOSP/device acceptance.
