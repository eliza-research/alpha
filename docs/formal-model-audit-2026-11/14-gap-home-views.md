# 14. Gap pass: Per-view logic in prototype/model.js

Single-pass findings from a second auditor covering files the first pass read only in part. Not adversarially verified; each is re-verified before a fix.

Paths: `M` = `apps/app/src/prototype/model.js`, `T` = `.../prototype/template.html`, `DA` = `.../prototype/data-adapter.ts`, `HL` = `.../prototype/home-launcher.ts`, `Q` = `specs/quint`. All of `M` (5,779 lines) was read; nothing was run. `HL` (95–352) and `DA` (60–245) were read only in part.

## Inventory (state / handlers / timers / Quint)

`M` registers 14 modules, not 19; `T` has matching `is.*` gates only for those 14 (T:147–3832). Shell timers: `api.later/every` go to group `m_<view>` and are cleared in `leave()` before `onLeave` (M:5273–5285); `laterBg/everyBg` go to `bg_<view>` and survive (M:5264–5266). `coverage.json` maps `M` to Application, ShellNavigation, DevelopmentDevice, CalendarPresentation, ChatInput, SettingsNav only.

| View | State and handlers in `M` | Timers / guards | Quint |
|---|---|---|---|
| home | no module; `BASE.screen/view/now/hint` (M:5141–5149); cards computed in DA:71–161, visibility DA:193–203 | 15 s clock (M:5155) | HomeLayout (legacy, `T` only) |
| assistant | `chat, msgs, draft, editCard, typing, voice, vtext, vcap`; back M:5368–5372 | send 800/700/1300 ms (M:5509–5513); voice 45 ms + group `v` (M:5544–5558) | ChatInput (legacy), ShellNavigation.chat; voice and typing unmodeled |
| apps | `drawer, drawerQ` (M:5147); back M:5367; launcher snapshot + `generation` in HL:139–141 | load generation guard (HL:151–158); `launching` latch (HL:197) | ShellNavigation.drawer only |
| notifications | `nGone, nSlide, shade`; production forces `shadeN: []` (DA:139) | 250 ms dismiss (M:5615) | ShellNavigation.shade; NotificationCollection covers the adapter, not this |
| reminders | none; no-op placeholders (M:1494); alias to calendar (`agent-adapter.ts:345`) | generation guard (`reminder-adapter.ts:89–115`) | DeviceActions |
| passwords | none; one binding (T:1556) | – | CredentialVault |
| phone | M:219; back 231–236; onLeave 243–250; ongoing 238–242; module global `PN` (M:130) | bg 2400 ms connect + 1 Hz tick (M:178–184); screening 1900 ms (M:448); voicemail 250 ms (M:362); `PN.boot` latch (M:304–307) | DevelopmentDevice (call only) |
| messages | M:532; back 541–547; onLeave 548–551 | bot 900/2600 ms with `stillSent` (M:511–517); swipe 260 ms | none (DevelopmentDevice.unread is a counter) |
| contacts | M:3434 `list, q, searching, open, edit, add, form`; back 3442–3447; no onLeave | none | none (DeviceActions covers `contacts-adapter.ts`) |
| calendar | M:1199; back 1220–1230; onLeave 1219 | `CAL_PENDING` latch + `later(0)` (M:1344–1353) | CalendarPresentation |
| inbox | M:826; back 837–845; onLeave 846 | swipe 260 ms | none for `M` |
| browser | M:1718–1724; back 1741–1757 | agent step chain guarded by `ag` (M:1684, 1710) | none for `M` |
| camera | M:1960; back 1965; onLeave 1966; global `CAM` (M:1915) | 1 Hz drift (M:1995); bg record tick (M:2040); raw long-press timeout (M:2053) | none |
| photos | M:2268; back `phBack` 2227–2237 | raw long-press timer + window listeners (M:2355–2360) | none |
| maps | M:2692; back 2710–2718; ongoing 2704–2709 | bg nav tick 850 ms (M:2685) | none for `M` |
| notes | M:3074; back 3084–3090; onLeave 3091; global `NT` (M:2969) | bg record 250 ms (M:3023); play 250 ms; dictation 38 ms; raw `setTimeout` latch (M:3161–3164) | none for `M` |
| files | M:3642; back 3650–3659; onLeave 3660 | play 250 ms (M:3797) | none for `M` |
| workflows | M:4345; back 4364–4370 | run chain 550 ms × n (M:4488–4494), guarded by `st.running` | none for `M` |
| settings | M:4682–4691; back 4707–4720 | many `api.later` (M:4919, 4935, 4994, 5026, 5096, 5109) | SettingsNav (legacy) |

Wallet is also registered (M:3936) but is not in ShellNavigation's `Views`.

## A. Model-vs-code discrepancies

1. **ShellNavigation `Views`** (`Q/application/ShellNavigation.qnt:6–8`) lists home, assistant, apps, notifications, reminders, passwords as views. In code they are `view: null`, chat modes, a `drawer` flag, a dev shade, a calendar alias, and nothing at all.
2. **Back order.** The model closes modal → shade → drawer → chat full → sheet → `"input"` → home (qnt:18–24). Code closes shade first, then drawer, voice, chat, and only then view-internal sheets via `m.back` (M:5365–5378). Code also returns to `rest()` (often `"hidden"`), has an extra input→hidden step (M:5372), and a 6-deep cross-app stack (M:5352, 5377). None of `stack`, `voice`, `secure`, `screen` is in the model.
3. **DevelopmentDevice call guards.**
   - Model `mute`/`speaker` require `call == "active"`; code offers the controls while still "Calling…" (M:397–403).
   - Model `dial` requires idle; code replaces a live call (M:172).
   - Model `decline` always sets voicemail; code only when there is no reply text and the fixture exists (M:211).
   - `hold`, `min`, `ai`, `ret` are unmodeled.
4. **CalendarPresentation `ScheduleStartsToday`.** `view` survives resets (M:1200, 5242–5244), and several patches set `day ≠ 0` without checking the view (M:1237, 1286, 1339, 1350; week strip 1369; swipe 1409). The agenda card (M:1339) leaves schedule view on day 1 with no Today button (M:1577).
5. **`ExclusiveTransientOverlay`.** The model forbids the menu with the delete sheet open (qnt:38); `toggleMenu` and `del` have no guard (M:1508, 1580).
6. **SettingsNav.** `NoInfoRows` and `ConfirmBeforeDestroy` do not hold for `M`: `kInfo` rows at M:4906, 4947, 4982, 5000, 5006, 5063; "Remove account" deletes with undo only (M:5064, 4633–4637).
7. **HomeLayout** treats calendar `event` and `loading` as exclusive. Code shows the card whenever an agenda row exists, independent of source state (DA:83, 98, 196).
8. **Coverage allocation.** `home-launcher.ts` and `home-cards.ts` are assigned to PreferencesAndPresentation, which has no launcher or card state.

## B. Unmodeled state machines

- **Call UI.** States: idle / dialing / live / held × minimised × ringing / screening. Events: start, accept, decline, end, tick, leave. At risk: `PN.live == st.callWho` (two sources of truth, M:130 vs state) and "inCall ⇔ callWho set".
- **Launcher.** `status ∈ {idle, loading, ready, failed}` × `launching` × `generation` × favorites. At risk: `launching` clears. There is no timeout if `bridge.launch` never settles (HL:197–205), so all rows stay disabled.
- **Voice.** off → listening → thinking → speaking → off (M:5531–5562). At risk: at most one `vI`; voice off after lock or `preset`.
- **Camera.** `rec` × `mode`. At risk: `rec ⇒ mode == "video"`. `openView` skips the reset while recording but applies the patch (M:5357–5358), so the assistant's selfie nav (M:1987) gives `mode: photo, rec: true`.
- **Timed busy latches.** `settings.busy/models.pct`, `workflows.running`, `browser.ag`, `notes.proc`, `messages.typing`. At risk: every latch is eventually released. View timers die on leave; the state does not.
- **Toast/undo slot.** A single `undoFn` (M:5224).
- **Secure mode.** At risk: `secure ⇒ view ∈ {camera, photos, wallet}`. The `keepState`/`keepStack` branches return before the secure check (M:5346–5350); callers exist at `maps-adapter.ts:109` and `maps-chat-adapter.ts:45`.
- **Contacts editor.** list / detail / edit / add × form. At risk: the edit target exists (`ctSave` toasts "Saved" on a deleted id, M:3413).
- **Module globals vs component lifetime.** `PN`, `CAM`, `NT`, `CAL_PENDING` are not reset on unmount (M:5204–5209).

## C. Defects

1. **Phantom call from a digit-less dial (high).** Dial `*` or `#`, then Call. `pnFmt` returns `""`, so `num` is `""` and `pnWant` is null, but `callWho` and `PN.live` are `"#"` (M:421–427, 167, 171–177). There is no call screen and no hang-up control; the 1 Hz tick and the status chip run forever. Fix: return from `dialCall` when `pnDigits(d)` is empty.
2. **Redialling the live callee resets the call (high).** With the banner showing (T:161 + 173), tapping the same person calls `pnStart`, which skips `pnEnd` for the same id and resets `callAt/liveAt` (M:172–177). Duration is lost and no recents row is written. Fix: `if (PN.live === id) { api.set({ min: false }); return; }`.
3. **Maps render crash (high logic, medium reachability).** "300 Folsom St" geocodes exactly to `MAPS_ME`, giving a one-point route (M:2616–2619). Directions then reads `dst.pts[1][1]` (M:2895) and throws in render. Fix: guard `dst.pts.length > 1`.
4. **Undo silently lost (medium).** Any later toast overwrites `undoFn` (M:5224–5227). Maps voice-guidance toasts fire from a background timer (M:2681), so they cancel a pending delete-undo in any app. Fix: do not replace an undo toast with a non-undo toast until its window expires.
5. **Model download stuck (high, fixture data).** Start a download and leave Settings within 2.25 s. The timers are cancelled (M:4994, 5285), `models` is persisted (M:4692), and the guard `if (done || going) return` (M:4991) blocks any retry. Fix: reset `0 ≤ pct < 100` on entry, or use background timers.
6. **Stale read after batched set (medium).** `pnEnd` queues `ret: null`, then `pnStart` reads `api.get("phone").ret` from pre-update state (M:172, 177, 194; `vset` is a functional `setState`, M:5232–5238). The second call inherits the first call's return target.
7. **Undo restores whole-array snapshots (medium).** Inbox archive/delete and wallet remove put back the old array (M:803–805, 969–971, 1000–1003, 4043), reverting any change made inside the undo window. Fix: re-insert by id, as notes/files/contacts already do.
8. **Per-render work regardless of view (medium, performance).** Runs on every `setState`, including the 22 Hz voice, 26 Hz dictation, 4 Hz and 1 Hz ticks:
   - agenda filter/map/sort (DA:83–94);
   - a synchronous `localStorage` probe on non-native builds (DA:225);
   - launcher `setBuiltins` and row building for every installed app with the drawer closed (HL:300–340).
   Fix: gate on `!isView` / `drawerOpen`, memoise on input identity.
9. **Stale playback flags (low).** Notes `onLeave` clears timers but leaves `playing`/`dict` true (M:3091).
10. **Contact grouping (low).** A non-ASCII initial gets `#` but sorts among letters, so headers repeat (M:3513–3518).

## D. Modeling opportunities

- **CallSession.qnt.** Replace the DevelopmentDevice call slice with one sum-typed state. Invariants: controls ⇒ live; a single live id; each end logs exactly one recents row; a digit-less dial is rejected.
- **ShellBack.qnt.** Add `stack`, `voice`, `secure`, the `hidden` chat mode and view layers. Invariants: back always makes progress; `secure` confinement; stack ≤ 6 and only admitted views.
- **TimedLatch.qnt.** A generic "latch set ⇒ a timer exists in a live group". It would have caught C5 and the stuck `running/ag/proc` cases.
- **Launcher.qnt.** Generation supersession, `launching` liveness, favorites ≤ `MAX_FAVORITES`, no launch of an uninstalled key.
- **ToastUndo.qnt.** An undo stays available for its whole window.
- **CalendarPresentation.** Add an `externalPatch(day)` action so `ScheduleStartsToday` is checked against deep links.
- **Pure functions suited to pre/postconditions:**
  - `pnFmt`, `pnDigits`, `pnWant` — post: `pnWant` non-null iff a call id exists (M:135–167);
  - `mapsAddr`, `mapsSteps`, `mapsAt`, `mapsStepIdx` — post: `pts.length ≥ 2` or directions unavailable (M:2606–2684);
  - `calOccurs` (skip/until/weekly, M:1123–1132) and the lane layout (M:1373–1380);
  - `notesLeave`, `notesEmpty` (M:2981–2999);
  - `phParse`, `phMatch` (M:2177–2220);
  - `walLuhn` (M:3933);
  - `cleanKeys` (HL:100–104) and the agenda ordering comparator (DA:92).

## Earlier unverified claims

No claim list was included in the task text, so these are verdicts on its premises.

- "19 per-view modules in `model.js`": **refuted** — 14 are registered; home, assistant, apps, notifications, reminders, passwords have none.
- "About 5,700 lines": **confirmed** (5,779).
- "Home cards, attention and clock tick live in the shell model": **partly** — the clock does (M:5155); cards and attention are in DA.
- "Apps drawer state is in the model": **partly** — only `drawer/drawerQ`; the inventory machine is in HL.
- "Reminders has per-view state in the model": **refuted** — placeholders only (M:1494).
