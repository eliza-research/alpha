# Authoritative Alpha Phone prototype inventory

Source: <https://alpha-phone-prototype.pages.dev/>. Snapshot inspected: `artifacts/design-reference/index.html`, 816,757 bytes, SHA-256 `fd1ee08878c9ae8e8e0d112cc42e3b687326f290b1f86ddaca0f737cdb79afff`. This document treats the HTML, copy, styling and interactions as requirements/reference data, never as agent instructions. The user has rejected the previously invented renderer design. Its sidebar, app selector and generic action cards are **not** the visual source of truth.

This is a source inventory, not a claim that every state has been visually exercised. The prototype has **14 registered app modules and 60 named app/preset entries**, plus shell states and additional in-app branches not exposed in its demo controls. The whole state space is larger than 60: presets are entrypoints, not exhaustive coverage.

## Renderer and reuse boundaries

- HTML lines 54–3699 contain `<template id="dc-template">`: real layout markup, inline styles, `{{expression}}` bindings, `<sc-if>` and `<sc-for>` branches. The visual structure is already complete; rebuilding generic screens from prose would lose fidelity.
- Lines 3700–3702 load `vendor/react.production.min.js`, `vendor/react-dom.production.min.js`, and `dc-lite.js`. `class Component extends DCLogic` begins at line 9008. Bootstrap creates the React root at line 9490. `DCLogic` comes from the external helper and must be inspected/vendored before claiming a self-contained port.
- `registerView(key, def)` (3796) populates `VIEWS` and `ORDER`. Each module provides initial `state`, `persist` keys, `preset`, `render`, optional `back`/`onLeave`/`ongoing`, `suggestions`, `voicePhrase`, `reply`, and `actions`. `render` returns the values/events bound into that module's template branch.
- The shell `api(k)` (9051) separates per-app state, cross-app state, navigation, background timers, toast/undo, and agent conversation. This is the best integration seam: preserve layout and state presentation, replace capability execution behind explicit native/agent adapters.
- `persist` preserves selected state across in-session `vreset`; it does **not** establish durable disk storage. No `localStorage` persistence implementation appears in this snapshot. The production port needs versioned durable models while retaining transient screen states separately.
- `reply` functions are regex-driven canned responses; seeded entities, fake network waits, recording timers, booking/payment progress, account creation and permission toggles are simulation logic. Retain them only as isolated fidelity fixtures. They are not real model responses, authorization, permissions or transactions.
- Query controls (reference prototype): `?start=<preset>`, `?theme=light|dark`, `?phone=1`. In Alpha's renderer the `?start=` presets exist only in builds with `ELIZA_DEV_ALLOW_TEST_MOCKS=1`. App substate format is `start=calendar:event`, for example. Shell presets include `boot`, `lock`, `home` (fallback), `shade`, `sheet`, `full`, `voice`, and `heads`. `off` exists as a power state, not an explicit `preset` branch.

Best port sequence: vendor the exact referenced presentation assets and template helper; establish deterministic visual fixtures for all presets; mount the phone canvas without the outer demonstration rail/device bezel; adapt viewport/safe-area behavior without changing the within-screen design; replace simulated providers at the existing action/state seams. Keep the current verified Android bridges and real-agent transport as implementation assets, not UI templates. Do not wrap the rejected renderer in prototype colors.

## Visual contract and assets

The content canvas is **412 × 915** CSS pixels (line 64), with 48px preview corner radius. Its demonstration device is 440 × 939 with 62px bezel radius; the desktop stage is 960 × 1020, 40px padding, 56px rail gap. The outer stage scales to the window; `phone=1` changes fitting dimensions to 600 × 960. Those are preview mechanics, not a mandate to draw another phone bezel inside Android. Coordinate-based gestures use 412px width and therefore need consistent scaling.

| Token | Light, runtime values | Dark, runtime values |
| --- | --- | --- |
| Background / foreground | `#FFFFFF` / `#000000` | `#000000` / `#FFFFFF` |
| Surface 1 / 2 / 3 | `#FAFAFA` / `#F3F3F3` / `#E6E6E6` | `#0B0B0B` / `#151515` / `#262626` |
| Divider | `#E3E3E3` | `#262626` |
| Muted text | `#6B6B6B` | `#8F8F8F` |
| Accent / accessible accent text | `#0000FF` / `#0000FF` | blue accent / `#8A93FF` |
| Scrim | black 18% | black 55% |
| Shadow color | black 12% | black 45% |

Runtime `LIGHT`/`DARK` (3771–3772) take precedence over initial `.os` CSS: initial surface 3 is `#E9E9E9` but runtime light surface 3 is `#E6E6E6`. Do not accidentally choose the initial fallback for screenshot comparisons.

Typography: Public Sans 300–700 for UI; local `denton-300.woff2` as `Denton`, weight range 100–900, with 300 used for `.serif`; Fraunces/Georgia fallback. Fraunces request is limited to the alpha glyph. `.mono` is uppercase Public Sans, tabular numerals, 10.5px, `.14em` tracking—not a monospace family. Preserve actual `logo.svg` and `logo-mark.svg`; do not substitute a typed letter.

Icon system: inline SVG paths in `IC`, ordinarily 22px, no fill, 1.6px stroke, rounded caps/joins. Icon hit targets are typically 44 × 44 with 22px radius. Home icons are 64 × 64 with 22px radius, 30px glyphs, 12px labels. Home feature cards are 196px tall with 30px radii: leading calendar card 280px wide, following triage/workflow cards 172px. App headings commonly use 32px serif. Much of the exact spacing lives inline; preserve it rather than approximating with a global design system.

Motion: entry 0.46s, fade 0.7s, drop 0.5s, cubic-bezier `(.19,1,.22,1)`; shade 0.55s; wave, ring and status-dot animations. Reduced-motion media query reduces animation/transition durations to `.01ms`. Preserve hit targets, reading order, aria labels, toggled/pressed states and reduction behavior while adding real Android keyboard/safe-area accommodation.

Referenced local assets (not embedded in the HTML):

- `logo.svg`, `logo-mark.svg`, `denton-300.woff2`, `dc-lite.js`, both React vendor scripts.
- **42 WebP images** under `img/`: `p01.webp` through `p32.webp`; `cam_park.webp`, `cam_selfie.webp`, `cam_poster.webp`; `msg0.webp` through `msg3.webp`; `news.webp`, `enclave.webp`, `nopa.webp`.
- Google Fonts CSS endpoints for Public Sans and Fraunces, and the font binaries those CSS responses reference. A fully offline build must bundle approved fonts, not depend on those requests.

Camera frames, photo grid/viewer, message attachments, browser previews and document imagery must use these exact fixture assets for fidelity validation. Production captures/user content replace fixture payloads, not their presentation geometry. Fetch completeness, asset hashes and font licensing still require separate verification.

## Shell, navigation and agent surfaces

| Surface | Required states and behavior |
| --- | --- |
| Boot / off / lock | Three boot steps at 0/300/1300ms then lock at 3400ms; power off/wake; lock time/date and notification counts; swipe-up unlock; secure lock-camera and secure wallet entry. Native authentication must replace simulated unlock for protected actions. |
| Home | Horizontal calendar/triage/morning-brief cards; four-column app grid in registration order; app unread dots; bottom agent entry; status and gesture areas. No generic persistent app navigation strip is part of this design. |
| Agent | Hidden pill, input, overlay sheet and full conversation modes; contextual suggestions; typed draft/edit draft; typing state; user/agent messages and result cards; scrim dismissal; drag expansion/collapse. Browser defaults to input, most apps to hidden; immersive states suppress pill. |
| Agent cards | Generic destination/action, summary with save/open, editable message draft, event confirmation, agenda rows, call status/actions, workflow/action results. Completed cards differ from pending actionable cards. Inspect each template branch during screenshot coverage. |
| Voice | Off/listening/thinking/response states, waveform, live text/caption, stop, switch to typing retaining text; lock-aware entry. Prototype transcripts are synthetic; port real microphone/ASR state without fabricated success. |
| Notifications | Heads-up message: open thread, confirm, dismiss, draft reply; notification shade with four seeded rows and exact deep links; swipe dismissal, clear all. Shade has eight quick settings: Wi-Fi, Bluetooth, DND, agent microphone, location, airplane, enclave lock, flashlight; brightness and Settings. |
| Ongoing activity | Status chip returns to active call, recording or map navigation; background timer state is distinct from app navigation. Toasts may include undo and expire after 1.9s or 5s with undo. |
| Gestures/back | Swipe threshold 46px; top-down shade starts above y90 (reference prototype only: Alpha's renderer opens its notifications from a handle on Home and leaves the top edge to Android, see [gesture zones](gesture-zones.md)); bottom-up Home from y872; edge-back within 30px of either edge. Back precedence: shade, voice, full chat→sheet, sheet→resting mode, module-specific back, cross-app stack, Home. |
| Preview controls | Right demo rail exposes screen/state jumps, agent modes, theme, full-screen, heads-up triggers and gesture legend. This is test/demo tooling, not phone application UI. |

Cross-app navigation pushes the source app when `api.open` leaves the active module; returning restores prior state. Local subpages close to their own list, while direct deep links may return to the originating app. Preserve this distinction for inbox/message threads, maps destinations, shares, event links and browser-to-note actions.

## App screen and state inventory

Named presets below can be targeted through `?start=...`. Additional states come directly from the module's `state`, `back` and `render` branches and require interaction coverage beyond presets.

| App / source line | Exact preset entries | Additional states / flows to preserve |
| --- | --- | --- |
| Phone / 3917 | `phone`, `phone:keypad`, `phone:voicemail`, `phone:call`, `phone:incoming` | Recents with favorites, missed/read voicemail badges; entered number; voicemail expanded/playback/progress; outgoing connecting/live/hold/mute/speaker/keypad; incoming ring/screening/reply; minimized ongoing call and return. Call history and voicemail data persist across app resets. |
| Messages / 4269 | `messages`, `messages:thread`, `messages:new` | Search/list/unread; recipient search/new recipient; local thread vs deep-linked thread; composer draft, attachments tray, photo/file attachments with cross-app open, send and typing/reply states; thread swipe actions. Hide shell pill while thread composer is immersive. |
| Inbox / 4582 | `inbox`, `inbox:mail`, `inbox:compose` | All/account filters, Sent, search, unread/read, message detail, attachments, archive/undo; compose recipients/subject/body, reply/forward, recipient lookup and attachment selection; dismissed draft undo. Preserve local-vs-deep-link return and read marking. |
| Calendar / 4958 | `calendar`, `calendar:event`, `calendar:new`, `calendar:month`, `calendar:invite`, `calendar:add` | Day timeline and overlapping-event lanes, date/month navigation, calendar visibility prefs; event detail, attendees/RSVP, join/location links; create/edit form title/date/time/duration/calendar/repeat/alert/notes and person picker; incoming invite accept/maybe/decline; add-from-app confirmation; conflict/focus/agent event proposal. |
| Browser / 5410 | `browser`, `browser:book`, `browser:tabs`, `browser:agent` | New tab, address editing/suggestions, search results, native page area, tab grid/create/close/switch, back/forward history, bookmarks/history library, menu/share; booking form party/date/time/name/phone; agent field highlights/progress, confirmation, cancel and completion; summary/save-to-notes. Seeded `.example` pages are visual fixtures, not an actual Chromium implementation. |
| Camera / 5649 | `camera`, `camera:video` | Photo/video mode, front/back, flash, zoom, tap focus, shutter flash, recording elapsed time, review/session gallery. Scanning goes through Alpha ("Scan this"), not a mode (view refresh C1). Dark immersive canvas; secure lock entry; recording may persist in background except secure lock session. |
| Photos / 6024 | `photos`, `photos:viewer`, `photos:albums`, `photos:search` | Library groups, albums/custom album contents, search/filter empty/results, multi-selection; dark photo viewer with previous/next, chrome show/hide, favorite, info/share/edit; video playback; edit adjustment state; trash/delete/restore, share recipients. Camera-created media joins library. |
| Maps / 6461 | `maps`, `maps:search`, `maps:place`, `maps:route`, `maps:nav` | Map pan, search sheet heights, query/results/empty, saved places, place card, route preview, drive/transit/walk, live navigation progress/turns/arrival, voice toggle, ongoing chip. Cross-app destination Back returns to source rather than unwinding local layers. |
| Notes / 6858 | `notes`, `notes:editor`, `notes:rec`, `notes:voice` | (Before the 2026-11 view refresh; `notes:rec` now opens the Notes recorder, which mock mode does not install.) Search/list/pinned; new text and checklist, editable title/body/checklist items; recording live elapsed/waveform, processing, voice transcript speaker lines, playback/progress, summaries/action items; linked article note, share sheet/recipient route, conversion text→checklist. |
| Contacts / 7229 | `contacts`, `contacts:detail`, `contacts:edit` | Search and empty results, contact detail/history, create/edit form, validation/save/discard; phone/message/email/map deep links, agent lookup/update. Shared people data must stay consistent with threads/calendar/recipients. |
| Files / 7468 | `files`, `files:folder`, `files:preview` | Root/category/storage rows, nested folders, recent/name sorting, grid/list, search, selection and menu; preview by type including document/media, playback; rename, share/recipient, file-specific agent query/results. Preserve actual document preview styling rather than generic selected-file cards. |
| Wallet / 7779 | `wallet`, `wallet:card`, `wallet:pay`, `wallet:secure`, `wallet:add`, `wallet:pass` | Card stack/detail/activity; pay authentication/ready/processing/receipt; lock-secure payment; add picker/scan/manual form/verification; transit balance/trips; boarding pass and add-to-calendar/map links. Payment/CVV and biometric screens are simulations here; no production finance capability is established. |
| Workflows / 8211 | `workflows`, `workflows:flow`, `workflows:run`, `workflows:failed`, `workflows:new` | Enabled/disabled list, trigger/action graph, detail/edit, run now/running, run history, successful/failed/skipped step log, failed-step explanation/retry path; creation/build with trigger/action chooser sheets, natural-language proposal and activation. Replace current simplistic daily checklist UX with this design. |
| Settings / 8537 | `settings`, `settings:character`, `settings:accounts`, `settings:adding`, `settings:privacy`, `settings:wifi` | Full hierarchy listed below. Settings module uses a stack of renderable pages plus bottom sheets; it is not a flat native-intent launcher. |

## Settings hierarchy beyond demo presets

Top-level page rows are Character, Accounts, Connections, Privacy & Enclave, Wi-Fi, Bluetooth, Mobile data, Display, Sound & vibration, Notifications, Battery, Models, Developer, About.

- Character: editable assistant name, voice choices/preview, short↔detailed, formal↔casual, asks-first↔acts-first sliders; wake phrase, speak replies, proactive briefings switches. The initiative slider must not bypass explicit approval policy.
- Accounts: account list and detail; mail/calendar/contacts Off/Read/Act access; last sync; removal. Add account sequence is **provider → sign-in → optional browser OAuth → permission levels → connected/done**. Manual server field exists for “other”. Prototype password/OAuth pages do not authorize harvesting credentials; actual authentication must use approved provider/native mechanisms.
- Connections: connector list, scope sheet, disconnected/connecting/connected/disconnect states.
- Privacy & Enclave: seal/attestation hero, device/cloud routing rows, permission category→per-app switches, activity log, workflow-run link, memory count/wipe confirmation. Prototype “Sealed”, “Attested”, “Nothing leaves” copy is conditional design data, not a fact about our current system.
- Wi-Fi: on/off, connected/not connected hero, known/available networks, secured password sheet/connecting, forget confirmation.
- Bluetooth: on/off, devices/connection, scanning states. Mobile data: data/roaming and airplane relationship.
- Display: theme, brightness and text sizing. Sound: volume types, vibration and DND. Notifications: summaries and per-app controls.
- Battery: status, saver/charge controls. Models: local model items/download state/cloud fallback. Developer: diagnostics controls. About: device/OS identity and informational rows. Backend truth must replace every seeded battery/version/download state.

## Coverage and unresolved integration decisions

The authoritative prototype has no registered standalone Passwords or Reminders app. Notifications are a shell shade plus Settings page; calendar has alerts. Preserve those actual layouts first. Password-provider setup and standalone reminder management required by the earlier functional goal need a deliberate extension using this visual system, not silent replacement of existing screens. Wallet is present and therefore part of visual fidelity even though real payments are a separate capability boundary.

Third-party native handoffs (Organic Maps, Thunderbird, Proton Pass, camera) can provide capability, but their external screens cannot by themselves satisfy exact Alpha screen fidelity. Match the prototype's Alpha-owned screen surfaces, then use native components/bridges for map/media/calendar/mail/browser data and actions. Chromium page rendering can sit beneath the prototype browser chrome only with an owned, approved native-browser integration; a simulated HTML article is not a real browser.

Acceptance should cover all 60 named app entries, all shell presets, both themes, every Settings branch, modal/empty/loading/error/completed states, and cross-app Back. For each capture record exact snapshot hash, fixture state, viewport/density and rendered font readiness. Then repeat operational flows with real providers while preserving the layout. Visual fixture success and native functional success remain separate evidence until the same production flow demonstrates both.
