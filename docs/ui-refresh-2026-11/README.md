# UI refresh, November 2026: Settings, Home and the chat dock

This is a historical design and model input. Current behavior is documented in
[Settings](../settings.md), [Daily overview](../daily-overview.md) and
[Gesture zones](../gesture-zones.md). The current product uses grouped Settings and keeps empty
Home widgets visible. The original TLA files and results below remain available for the Quint
legacy model references.


Review of four owner requests (2026-11-06): slim Settings, clean up Home's top card row, stop the
app grid moving, and make the chat dock behave by one set of rules. Each part has a model in
[Quint specifications](../../specs/quint/legacy/README.md) comparing the historical current
code with this design. The [historical TLC results](tla/results.md) are retained, alongside
an interactive before/after prototype in [`prototypes/`](prototypes/index.html).

Evidence class: source review, TLC and the browser development build. Nothing here is emulator,
AOSP-image or device evidence.

## Chat dock and overlay

### What is wrong now

| Problem | Where |
| --- | --- |
| Only the open half sheet guards outside touches. After the pill's keyboard button raises the bar, a tap above it reaches the app and the bar stays up. | `chat-overlay-motion-adapter.ts` `scrimPE` is `auto` only for `sheet` |
| With the keyboard up on Home, a tap on an app icon both closes the keyboard and opens the app. | no guard for a focused composer |
| Back from a bar raised over an app leaves the app instead of lowering the bar. | `model.js` `back()` has no `input` step |
| An upward drag anywhere on Home, more than 46px, opens the chat. | `model.js` `swipe()`: `if (dy < -T) return this.setState({ chat: "sheet" })` |

TLC: `NoLeak`, `NoStrayOpen`, `BackInOrder` and `OneTouchDown` fail for the current code
(2 to 5-state counterexamples) and hold for this design.

### Rules

States: **pill** (`hidden`), **bar** (`input`), **sheet**, **full**; plus whether the composer has
focus (keyboard up). Each view has a resting form: the bar on Home and Browser, the pill elsewhere.

1. **Raised** means above the resting form or keyboard up: the sheet; the bar in a pill view; the
   bar with focus.
2. While raised, the **first touch outside** the dock or sheet lowers it to the resting form,
   closes the keyboard and reaches nothing underneath. The next touch is ordinary. (Same as the
   sheet does today, now for every raised state.)
3. **Only the dock opens the chat**: tap the Alpha mark, or drag up from the bar or pill. A drag
   anywhere else scrolls or does nothing. Android's bottom-edge swipe still goes Home.
4. **Back unwinds one level**: keyboard, then full to sheet, sheet to rest, raised bar to pill,
   then the view's own Back.
5. A draft is never discarded by lowering; reopening the bar shows it.

## Home

### Top card row

| Card | Shown when | Otherwise |
| --- | --- | --- |
| Calendar | there is a next event or an overdue reminder | hidden (no "Loading events…", "No upcoming events", "Connect your calendar") |
| Workflows | at least one enabled workflow or automation | hidden (no "Open to view", "No brief yet", "Connect your agent") |
| Inbox | Gmail is connected and unread mail is loaded | hidden (no "Set up Gmail", "Inbox", "Open to load email") |
| Latest brief | a retained brief exists | hidden (unchanged) |

With none shown, the row becomes one **date line** (weekday and date in the serif). While signed in
to Eliza Cloud with Google not connected it carries one **Connect Google** button, which opens the existing Google connection
flow: one consent covers Calendar and Gmail. Freshness lines ("Loaded 3:04 PM", "Read … from this
device") move to the accessible description only.

### The grid moves

Causes found:

1. Android's insets arrive from `DailyApps.surfaceInfo()` after the first paint. The dock moves up
   by the navigation bar, `dock-clearance.ts` re-measures it after the dock's entry animation
   (`animationend`), and Home's bottom padding grows: the grid shifts up about a second after
   Home appears.
2. The grid sits between two `flex-grow` spacers, so any change in the card row's height
   (loading text replaced by an event, a mail row, the brief card) moves it by half the change.
3. With the keyboard up the measured bar is far higher, so the reserve and the grid change while
   editing and change back, a frame or more late, when the keyboard closes.

Design: the grid is anchored to the bottom with a reserve computed in CSS from the insets alone
(`--alpha-bottom-clearance` + bar + gap), never from a measurement; the card row has one fixed
height shared by the date line; the last insets are stored and applied before the first paint.
TLC `GridStable` fails for the current code (2 states) and holds here.

## Settings

### What is wrong now

The production launcher's top level has about 30 rows. Many are facts Alpha cannot change
(Wi-Fi, Bluetooth, mobile data, volumes, battery, Android build, "Inference model: Not reported by
agent"), several pages only relay to an Android screen, the same flow is reachable from two or
three places, and most toggles carry a paragraph. Cloud sign-out has no confirmation. TLC:
`NoInfoRows`, `NoMirrorPages`, `SingleEntry` and `ConfirmBeforeDestroy` fail for the current
inventory.

### Proposed structure

| Group | Row | Kind |
| --- | --- | --- |
| (header) | Agent name | editable |
| Account | Eliza Cloud · plan | page: plan, renewal, Approve again (when expiring), Redeem code (when offered), Manage plan, Sign out (confirmed) |
| | Google · account count or "Connect" | existing Google accounts sheet (connect, disconnect, calendars) |
| Assistant | Ask before acting | switch |
| | Agent · status | page: Restart, recovery review, New conversation, earlier conversations, actions to confirm |
| | Listening · status (AOSP listener only) | page: Pause, Turn off, Listener settings |
| | Scheduled digests | existing sheet |
| Apps | Calendars | page: Refresh calendars, Google Calendar sync (browser build keeps per-calendar switches) |
| | Passwords | existing password manager, plus "Password provider" in Android |
| | Photos access · scope | opens Android's photo picker access |
| | Load images in email | switch |
| | Make Alpha your Home app (launcher, when not Home) | Android role dialog |
| Appearance | Theme | System / Light / Dark |
| | Text size | slider |
| Notifications | Notifications · state | Android's page for Alpha |
| | Notifications from other apps (native) | page: Collect, apps and previews, Keep history, Clear history (confirmed), Android access |
| Privacy | App permissions · summary | Android's page for Alpha |
| | Finish setup (only when a startup permission is missing) | startup access panel |
| System | Android settings (launcher) | Android's Settings |
| | About · version | page: Problem log, Export diagnostics, Open source licenses |
| | Reset Alpha data | Android-confirmed reset |

Removed: Wi-Fi, Bluetooth, Mobile data, Battery and Sound pages; Brightness; Models; Privacy &
data; Character (its Speech and "Personality settings: Managed by your agent" facts, and its second
digests row); Accounts and Connections (merged into Eliza Cloud and Google); Home app / Assistant
app facts; Default apps (Android settings covers it); About's Android, build, patch, runtime,
agent and "Updates: Alpha does not check for updates" rows; the per-channel notification list
(Android's page has it); every explanatory subtitle that restated a label.

Copy rules: a row is a label, optionally one short value at the right. No sentence under a
switch unless the switch would otherwise mislead. Errors are toasts, not rows.

## Prototypes

[`prototypes/index.html`](prototypes/index.html) runs in a browser with no build. Each section has a
**Current** and **Proposed** phone side by side driven by the same state machines as the models:
Settings navigation, Home card states and grid position (with buttons that deliver insets,
change sources and raise the keyboard), and the chat dock (tap outside, keyboard button, drags
from the dock and from content, Back).

## Implementation

| Area | Change | Where |
| --- | --- | --- |
| Chat dock | Outside-touch guard for every raised dock (`data-alpha-dock-guard`, below the dock, above apps); composer focus tracked with `onFocus`/`onBlur`; the keyboard closing by itself blurs the composer; Back lowers a raised bar | `chat-overlay-motion-adapter.ts`, `template.html`, `dc-lite.js`, `model.js` `back()` |
| Gestures | Home's swipe-up-anywhere rule removed; the dock's own drag handlers still open the chat | `model.js` `swipe()`, `docs/gesture-zones.md` |
| Home cards | Visibility pass installed outermost (`installHomeCardVisibility`); date line with Connect Google; only enabled workflows listed; source, origin and freshness lines removed (kept in `aria-description`); opening Calendar by any route retries a failed read | `data-adapter.ts`, `workflow-adapter.ts`, `automations-adapter.ts`, `inbox-cloud-adapter.ts`, `template.html` |
| Home grid | Fixed card-row height shared with the date line; bottom-anchored grid with a CSS-only reserve; a taller dock adds scroll range only; Android insets cached and applied before the first paint | `phone.css`, `template.html`, `main.tsx` |
| Settings | Top level and pages rebuilt from real state; removed pages route to the top level; Cloud sign-out confirms; `system` Android page added | `settings-adapter.ts` (`cloudAccountPage`, `settingsPage`, `permissionSummary`), `AlphaDevicePlugin.java` |

Tests: `test/settings-truth.test.mjs`, `test/cloud-plan-cancel.test.mjs` (pure Settings helpers),
`test/browser/full-chat-grabber.spec.ts` (raised dock: outside tap captured, draft kept, Back
order, no stray open), `test/browser/home-daily-overview.spec.ts` (card rules, date line, grid
does not move when a card appears), and the Settings production specs.

## Emulator evidence (2026-11-06)

Class: emulator HOME-role test (API 35 Google APIs x86_64 image, `alpha-ui-refresh` AVD), launcher
flavor test-mocks debug APK set as the HOME role, driven with real Android input (`adb` taps,
swipes, the IME and the Back key) and read over the WebView's devtools socket. Not AOSP-image,
Pixel 10a or device acceptance. Script: [`evidence/emulator-dock-checks.mjs`](evidence/emulator-dock-checks.mjs),
results: [`evidence/emulator-dock-checks.json`](evidence/emulator-dock-checks.json).

| Check | Result |
| --- | --- |
| Cold start: the grid's top from the first frame for 4 s | drawn at 487, never moved |
| Keyboard up on Home, tap above the bar | keyboard closes, nothing opens; next tap on Calendar opens it |
| Keyboard closed with Android Back | composer lets go, guard off, next tap on Calendar opens it |
| Notes: keyboard button, tap on a note | bar lowers to the pill, still in Notes |
| Notes: raised bar, Back, Back | first closes the keyboard, second lowers to the pill, still in Notes |
| Upward swipe on Home content | chat stays closed |
| Upward swipe from the bar | chat opens |
| Grid top with the keyboard up and after it closes | 487 throughout |

The emulator showed one more cause of the grid moving that the browser could not: on Android the
WebView shrinks with the keyboard (`adjustResize`) and the phone canvas follows it, so Home laid
itself out again in the smaller canvas (grid 487 → 304) and jumped back when the keyboard closed.
`main.tsx` now publishes Home's keyboard-free height and bottom inset (`--alpha-home-height`,
`--alpha-home-bottom-inset`) only while nothing is being edited, and Home's layout uses them, so
the keyboard covers Home's bottom instead of re-laying it out.

Not done here: the distribution APK build stops at `lintLauncherDebug` because the launcher
manifest (committed before this work, ef9fbf7cd7) references `AlphaPowerVoiceActivity`, which is
not in this tree (also recorded in `docs/on-device-speech-2026-11-05.md`); `verify-apks` rejects
the release APKs for a missing staging sign-in return link from the in-progress sign-in redesign.
Device acceptance on the Pixel 10a was not run: installing this build there would replace the
build used for the on-device speech work.
