# Renderer accessibility checks (MVP-48, software part)

This describes what the browser tests check for accessibility and layout resilience,
the sizes they treat as supported, and what they cannot show. It covers the renderer
only. TalkBack, Switch Access, a physical large-font pass, device rotation, gesture
navigation, process death and full storage on hardware remain device acceptance in
`docs/pilot-acceptance-runbook.md` and are not closed by anything here.

## What runs

| Spec | Lane | Scope |
| --- | --- | --- |
| `test/browser/accessibility-sweep.spec.ts` | `npm run test:browser` | Every state in `test/browser/accessibility-states.ts`: live (no connection, no data), fixture (populated lists, open subviews, menus, search fields, sheets and the Undo toast), provider-connected (a signed-in account with a connected mailbox, synthetic, round 10) and the two recovery screens |
| `test/browser/accessibility-sweep.production.spec.ts` | `npm run test:browser:production` | The live states against the flag-off production bundle |
| `test/browser/accessibility-audit.spec.ts` | `npm run test:browser` | Each rule fires on a seeded defect and stays quiet on corrected markup |
| `test/browser/accessibility-resilience.spec.ts` | `npm run test:browser` | Behaviour behind the defects the sweep found |
| `test/browser/accessibility-lifecycle.spec.ts` | `npm run test:browser` | Every retained view through repeated HOME (with menus, sheets and dialogs open), rotation, a reload, camera permission withdrawn while away and the network going away mid-session, at 100% and 200% text: focus, names, reading order and the composer draft (AP-15) |
| `test/browser/view-focus.spec.ts` | `npm run test:browser` | Focus moved by a screen change, HOME, Apps or a rotation lands on the new screen's name; focus somewhere real stays |
| `test/browser/accessibility-sign-in.production.spec.ts` | `npm run test:browser:production` | The required Eliza Cloud sign-in page of a signed-out production phone (P-43) at 100% and 200% text and in landscape; nothing is entered or sent |
| `test/browser/large-text-overlap.spec.ts` | `npm run test:browser` | Home, the app library and the tile grids at 100%, 150% and 200% text, measured from bounding boxes (round 8, after the round-7 emulator run showed the Home card title printed over its neighbours at 200% font) |
| `test/browser/notifications-handle.spec.ts` | `npm run test:browser` | A pull on launcher's empty Home that asks for Android's shade, and the gesture zones ([gesture zones](gesture-zones.md)) |

The checks live in `test/browser/accessibility-audit.ts` and need no added dependency.
Names, roles and focusability are read from desktop Chromium's accessibility tree. Android
WebView computes its tree with the same engine, but the Android mapping and what TalkBack
announces are not exercised here. Geometry, contrast and clipping are measured in the page.

| Rule | Meaning |
| --- | --- |
| `accessible-name` | A control, dialog or image is exposed without a name |
| `keyboard-focusable` | An exposed control cannot take focus |
| `aria-hidden-focus`, `focus-in-hidden-content` | Focus can enter content hidden from assistive technology |
| `click-without-control` | A click handler sits on an element that is not a control |
| `aria-reference` | A label or description reference does not resolve to exactly one element |
| `focus-trap`, `focus-not-visible`, `focus-order-unbounded` | Tab stops moving, lands on an invisible element, or never returns |
| `focus-order-incomplete` | Outside a dialog, a full Tab cycle skipped an exposed tab stop |
| `focus-behind-scrim` | With a menu or sheet open, Tab reached a control under its scrim or panel |
| `target-size` | A pointer target is smaller than 24 by 24 CSS pixels (WCAG 2.5.8) |
| `contrast` | Text is below 4.5:1, or 3:1 for large text, against what is painted behind it |
| `text-clipped`, `text-off-screen`, `label-overflows-control` | Text is cut through, leaves the phone sideways, or spills out of its control |
| `text-lines-overlap` | Wrapped text sits on line boxes shorter than the text, so lines print over each other |
| `control-off-screen`, `control-unreachable` | A control leaves the phone, or sits outside the screen with no scroller |
| `text-overlap` | Two pieces of readable text from different elements are painted over each other (measured from their line boxes after clipping, each reduced to its em box; text under an opaque layer is not counted) |
| `label-word-broken` | A short word in a control's label is split across lines ("Calenda" / "r") |
| `control-overlap` | Two controls share more than a few pixels and neither is behind an opaque layer |
| `control-clipped` | A control is cut through by a box that does not scroll |
| `obscured-by-dock` | A control or a line of text is painted under the floating dock (the composer bar with anything stacked on it, the pill, the resting conversation sheet). On Home and in the app library any overlap with the composer or pill fails. In an app's own scroller, which passes under the dock by design, it fails when the scroller has too little range left to bring the item wholly above the dock (round 10) |
| `focus-obscured` | A tab stop took focus with part of its painted box under the dock. A focusable scroll region is exempt: it is the scroller, and its content is judged by `obscured-by-dock` (round 10) |
| `toast-not-announced`, `toast-covered` | A toast on screen is inert (under a top-layer dialog, so removed from the accessibility tree), or something is painted over it (round 10) |
| `text-truncated` | Reported, not failed: a deliberate ellipsis or line clamp |
| `reading-order` | TalkBack's linear order goes up the screen: the next node starts above the previous one by more than half the taller of the two, without starting a new column to its right (the rule `TalkBackOrder.java` applies on Android) |
| `assistant-group-order`, `assistant-group-duplicate` | App content is read after the floating assistant controls, or more than one assistant group is exposed |

Menus and sheets drawn over a scrim (browser menu and share, photo info and share, note
share, file sort, move and share, the workflow step editor and the Settings sheet) own
focus while open: the page under them leaves the tab order and the accessibility tree,
Escape and Back close them, and focus returns to the control that opened them when that
control still exists. Their scrim stays exposed as a named close control for touch.

Toasts ("Saved", refusals, "Deleted … Undo") are written into a polite live region that
is always present, and an open menu or inline dialog does not take that region out of
the accessibility tree. A top-layer `<dialog>` makes the page, and that region with it,
inert. While one is open it therefore has a live region of its own
(`runtime/toast-layer.ts`): an element inside the dialog, present and empty from the moment
the dialog opens, shown as a manual popover so it is drawn above the dialog. A toast raised
meanwhile is copied into the region of the topmost modal dialog, and its Undo runs the
page's Undo. Whether TalkBack speaks either region is a device check.

## Reading order and focus

TalkBack reads a WebView in the order of its accessibility tree, which follows the DOM, not
the screen. `auditReadingOrder` walks Chromium's accessibility tree the way Android WebView
exposes it (a control is one node with its label, a heading or text-only element is one
node) and judges the visible nodes by where they are painted, with the rule
`AccessibilityInstrumentedTest`, `AccessibilityViewsInstrumentedTest` and
`AccessibilityLifecycleInstrumentedTest` apply on an emulator (`TalkBackOrder.java`). Every
lane of the sweep runs it. Not judged: live regions (announced, not read on to), the order
inside one bar of controls (an app header keeps navigation, title, actions when a large
font moves its title below its buttons; the camera's capture row keeps its order as a
landscape rail), names painted on the pannable map, and content outside the phone screen.
The conversation sheet floats over the app like the dock and is read after it.

What it found, fixed in the renderer: Maps read its credits and pins before the search
field and status drawn over the top of the map, and its route card and turn banner after
Recenter (the layers drawn over the map now come first; stacking is by z-index); the
browser page stayed in the order and Tab sequence under the address suggestions that cover
it (it is now inert while the address is edited); and HOME left the browser build's alarm
settings dialog open over Home.

Opening an app, HOME, Back and Apps retire the layer that held focus, and the browser
then drops focus to the page body, where TalkBack (which follows input focus in WebView)
announces nothing. `runtime/view-focus.ts` moves focus a screen change dropped to what is
now in front: an inline modal surface by its label, else the app's visible title, its
labelled region, or the Home region. The target takes focus only programmatically
(`tabindex="-1"`), so Tab continues into the screen from there; focus a view put somewhere
real, native dialogs, the conversation and the voice panel are left alone.

The mover itself is Eliza's shared `createScreenFocus` (`@elizaos/ui/accessibility`, projected
as `packages/ui/src/accessibility/screen-focus.ts`, with its own jsdom tests upstream);
`runtime/view-focus.ts` keeps only what is Alpha's: the title, region and Home selectors, the
surfaces that own their focus, and the `data-active-view` and `launcher-home` signals. It
needs a pin that contains that module (eliza branch `claude/alpha-c1-a11y`).

## The floating dock

The composer bar and the pill float over the page. Round 8's emulator run found Home's last
row drawn under the composer at 200% text, and TalkBack read the composer after controls
that sat lower on the screen. Since round 10:

- Home and the app library end above the dock. The dock's footprint is measured
  (`runtime/dock-clearance.ts`, published as `--alpha-dock-clearance`; the measuring and
  publishing are Eliza's shared `packages/ui/src/components/shell/dock-clearance.ts`, to which
  Alpha supplies its selectors and property names) rather than assumed
  to be 108px, because Android's navigation inset raises the dock and a status line or a
  longer draft makes it taller. 108px stays the minimum, so Home is unchanged wherever it
  already fitted. Home lays its rows out against the bar at rest (`--alpha-dock-rest`), so a
  status line that comes and goes above the bar shortens what is visible of Home and does
  not move every row. In landscape the dock is beside Home and nothing changes.
- An app's own page still scrolls under the dock, by design. A control that takes keyboard
  or switch focus there is scrolled wholly above the dock (scroll padding on the app
  scrollers, and `focusAppContent` for the rest). Focus that comes from a pointer is not
  moved: scrolling a pressed row out from under the finger loses the tap.
- The email composer's fields end above the dock too; its message field ran 16px under the
  pill (found by the provider-connected states).

The recovery screen dismisses any open modal dialog when it appears. A modal dialog is
drawn above everything else and would otherwise leave Reload covered and unfocusable.

## Supported sizes

These are the sizes the sweep holds the renderer to. They are test definitions, not a
product commitment; the landscape decision is still A-22 in `docs/decisions.md`.

- Portrait 412 by 915, light and dark: all rules.
- Text at 200%, portrait: clipping, overlap and dock rules, names, reading order, and no tab
  stop left under the dock. Android applies large text as WebView
  text zoom (the in-app text size multiplied by the system font scale), so 200% is the
  system's largest font at the default in-app size. The existing large-text specs cover
  150%, the largest in-app size.
- Landscape 915 by 412 on a touch phone: clipping, overlap and dock rules, names, tab order and
  reading order.
- Landscape 915 by 412 at 200% text: the same rules (round 10). It passed for every state
  without a layout change of its own.
- Text at 300%, portrait: the largest in-app size (150%) with the largest system font (200%),
  which Android multiplies. The 200% rules over every live state and every launcher state
  (`accessibility-sweep.spec.ts`, "300% text"). When the lane was added (cycle 2) 38 of the 55
  states passed; the other 17 fail on real layout defects (a display title split mid-word,
  segmented controls and header actions pushed off screen, chips and menu tiles narrower than
  their labels) and are tracked in issue #701. They are listed in `OPEN_AT_300` and still run
  every rule; each must still report a layout defect, so a fix (or a state that no longer opens or
  times out) fails the test, and the list can only shrink.

Truncation policy: a single-line ellipsis or line clamp on a preview of user content
(a mail snippet, a file name in a list, a note preview) is allowed, because the full text
is one tap away and is exposed whole to assistive technology. Text that is cut through
without an ellipsis is a failure. A screen's own title is not user content and is not
shortened: above 150% text (`alpha-text-xl`, set by `runtime/text-scale.ts`; 150% is the
largest in-app size, so this is reached only with a large system font) the title takes a
row of its own under the header's buttons and wraps there if it has to. "Photos", "Camera"
and "Password manager" were shortened with an ellipsis at 200% before round 10. The Home
calendar card grows with its title (round 8) and the title's line height now opens with the
text scale, so its last line is no longer cut by the clamp at 200%.

## Limits

- Large text is emulated by multiplying every declared pixel font size. WebView text zoom
  also scales pixel line heights, and CSS cannot read the zoom factor, so most fixes are
  layout rules (wrap, grow, or hide a whole line) and a device pass is still required.
  Where room has to be made (how many columns of labelled tiles fit, how wide a Home card
  may grow), the page measures the drawn text size with a hidden probe and publishes it as
  `--alpha-text-scale` (`runtime/text-scale.ts`). The probe is measured, not assumed:
  `AccessibilityInstrumentedTest` asserts it reads 2 at system font scale 2.0 inside the
  WebView. At `2961bd9e` (class E, developer APKs) the launcher flavor measured 2 and passed
  the overlap checks; the class then failed at its accessibility-click step on both flavors'
  runs as recorded in [verification](verification.md).
- Contrast is not computed for text over photographs, video, gradients or blur; the
  camera, photo and map overlay specs cover those surfaces.
- The map canvas is a pannable surface: labels and pins outside the frame are not
  failures. Places are also listed in the results sheet.
- Landscape is checked in a mobile-emulated Chromium viewport. Android rotation, insets
  and state restoration have an instrumentation source (`RotationInstrumentedTest`); it
  passed at `73b973a5` and `6dcdde34` (earlier pins) and was not run at the current pin, and a
  device pass is still required.
- The sweep runs the standalone presentation that a browser shows and, since the MVP
  completion integration, the launcher presentation too.
- The composer field keeps a pixel line height, and text typed into inputs is not judged
  for clipping; only rendered text nodes are.
- Zoom above 300% is not swept: 300% is the largest size the in-app setting and the system font
  can reach together. Display size (density) is not emulated.
- Provider-connected states are one synthetic mailbox held at the provider boundary
  (`connectMailbox` in `accessibility-states.ts`): Home with its unread card, the Inbox
  list, an empty folder, search, an open message, a long subject, compose, and Settings with
  its accounts and connections pages. No account, OAuth or mail exists. Since cycle 2 the
  connected states also cover an agent's own calendar (Agent Calendar on Home and in Calendar,
  held at the app-record boundary as in `home-daily-overview.spec.ts`), a linked Google Calendar
  account's sync sheet before and after its read-only review (`calendar-sync-fixture.ts`; no
  write is made) and a connected agent (the on-device development profile) in Settings and in a
  conversation with its reply. A Cloud-hosted agent and a password provider are not swept;
  dialogs and flows that need a permission are covered by their own accessibility specs. These
  states run on the development server only, so the flag-off production sweep does not include
  them. The fixture lock screen, the `photos-empty` viewer state and the launcher presentation
  of Home, Apps, the conversation and every retained app view are swept at 100% and 200%,
  and the launcher states at 300% too (`FIXTURE_STATES` and `LAUNCHER_STATES` in
  `accessibility-states.ts`).
- The dock rules judge the composer bar, the pill and the resting sheet. Only Home and the
  app library end above the dock; an app page's content still passes under it and is only
  required to be scrollable clear of it. The renderer reads every state's order; TalkBack's
  own order on an emulator (`AccessibilityViewsInstrumentedTest` reads every view,
  `AccessibilityLifecycleInstrumentedTest` after repeated HOME, rotation and a new process)
  has not been run, and TalkBack itself remains a device check.
- The dock's footprint is measured after layout. On Android it depends on insets the WebView
  reports; that path is not exercised in Chromium beyond setting the same custom property.
- A state is a screen as it opens. Flows inside a state (typing, multi-step dialogs,
  drag gestures) are not walked beyond the tab order. The scan fixture is checked once its
  result has arrived; the "Looking for a page" status shown for a second before it is not.
- Tab-order completeness counts the controls on screen when the walk starts. A control that
  arrives while the walk is under way is not reported as skipped.
