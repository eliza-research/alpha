# Sign in, Inbox, Calendar and Maps: review and proposed flows

Status, 2026-11-06: the app-side part of this proposal is **implemented and not
committed** (see "Implemented in the app" below). The Cloud-side work and the owner
settings in section 3 are still open. The prototype is a clickable mock-up and the Quint
models are design-level models. Neither one proves the shipped code. Device and
live-Cloud acceptance have not been run (see `AGENTS.md`).

## Implemented in the app (uncommitted)

### Gmail and Google connect

- **One shared connect flow.** `apps/app/src/runtime/google-connect-flow.ts` is used by
  Inbox, Calendar and Settings › Google accounts.
- **One consent for everything.** It asks for Gmail changes and Calendar write together.
- **Custom Tab with an App Link return.** Google opens in a Custom Tab
  (`AlphaConnectionPlugin.startBrowser`). When Android has verified the `eliza.app` App
  Link, Cloud is given `redirectUrl=https://eliza.app/alphaphone/google/return?state=…`.
  Cloud already accepts that origin, so success returns straight to Alpha with no
  cloud.eliza.app page. The new App Link filter is declared in `android/app/build.gradle`.
  `GoogleConnectReturn.java` parses both of Cloud's return shapes.
- **Refresh on return.** Every return to Alpha re-reads the grant, so the "Check Google
  connections" button and the "return here and check" text are gone.
- **Inbox:**
  - "Connect Gmail" starts Google directly; there is no Google accounts panel in between.
  - Inbox re-reads accounts whenever Alpha comes back to the front (Android never sent
    `appResumed`).
  - Signed out, it shows "Sign in to use Gmail" and a Sign in chip that opens the
    sign-in methods.

### Calendar

- **No picker gate.** Calendar picks the primary calendar of the connected Google
  account by itself.
- **Connect from Calendar.** Without a Calendar grant, the Calendar screen shows "Show
  your Google Calendar · Connect".
- **Bad events are skipped.** A zero-length or unreadable Google event is skipped
  instead of failing the whole feed.
- **Less text.** The "Read only", "has not been checked" and "Local calendars only" copy
  is gone.

### Sign in

- **Chooser opens at once.** It offers Continue with Google (when ready), plus one
  "Email or phone number" field with Continue.
- **Readiness in the background.** The readiness check runs without blocking the screen,
  so there is no "Sign in with Eliza Cloud" step and no 6-second "Checking…" wait.
- **No Retry buttons.** Readiness is re-checked on network return, on resume and every
  15 s.
- **Saved sign-in reconnects by itself.** A kept sign-in that Cloud has not refused is
  retried automatically (on network return, on resume, then with backoff). The page shows
  "Waiting for connection" and "Use another account". The "Retry saved connection"
  buttons are removed.
- **Codes verify on the sixth digit.**

### Maps

- **Connects at sign-in.** Cloud Maps connects at sign-in or launch, not when Maps opens.
  It reconnects on account change, network return and resume, so agent navigation no
  longer needs Maps opened first.
- **Real failure reasons.** Failures show the real reason, for example "Maps isn't
  available yet." or "Maps comes with an Eliza Cloud plan.", never "Connect a Maps
  provider".

### Still open on the app side

- Editing, deleting and RSVP for Google events in Alpha.
- Multi-calendar display.
- Week, Month and Schedule views, and Search.
- Native (Play services) Google authorization.
- Navigation surviving the assistant closing.
- Keeping the route when a reroute fails.

### Verification

- **Commands run:**
  - `tsc --noEmit` passes.
  - The changed unit and flow tests pass under Node 24: Inbox, Calendar display and
    reader, Google panel, Maps, sign-in flow, phone login, login surfaces and Gmail grants.
  - New tests: the plain-JVM `GoogleConnectReturn` parser test and a wiring test.
  - Java compiles for `standaloneDebug` and `launcherRelease`, and the merged manifests
    declare `https://eliza.app/alphaphone/google/return`.
- **Not run:**
  - A full APK build. It is blocked by the unrelated "Embedding host requalification
    required" check from the upstream pin bump.
  - Device, emulator and live-Cloud runs.

- Prototype: [`prototype.html`](prototype.html). Serve the repository root (for example
  `python3 -m http.server 8790` from the repo) and open
  `http://127.0.0.1:8790/docs/flow-redesign-2026-11/prototype.html`.
  Use the switches on the left for offline mode, no Play services (the AOSP image), a
  missing plan, Maps being down, a Google-side conflict and a broken event.
- Models are now [Quint specifications](../../specs/quint/legacy/README.md).
  Their check commands, translation notes and source provenance are documented
  there. The [historical TLC results](tla/results.md) retain the earlier evidence.

Each model uses one switch, `Design`. `"current"` models the code at `ef9fbf7cd7`
and `"proposed"` models this redesign. Both are checked against the same properties.

## 1. What is wrong today, and why

### Gmail login lands on cloud.eliza.app

Here is the chain, traced in code:

1. Inbox › **Connect Gmail** opens the Google accounts panel. **Connect Google account**
   then calls `POST /api/v1/eliza/google/connect/initiate` **without a `redirectUrl`**
   (`apps/app/src/runtime/cloud-protocol.ts:559`).
2. Alpha opens the URL with a plain `ACTION_VIEW` in the system browser, not a Custom
   Tab (`AlphaConnectionPlugin.java:323`).
3. Google returns to Cloud's callback. Cloud stores the grant and then, because no
   return URL was given, redirects to `https://cloud.eliza.app/auth/success`
   (`vendor/eliza/packages/cloud/api/v1/oauth/generic-callback.ts:148`).
4. That page verifies a "proof" with an endpoint that needs a cloud.eliza.app
   browser session. Alpha signs in inside the app, so the browser has none and the
   page shows "Connection Could Not Be Verified". It also cannot close itself (there is
   no `window.opener`), and its "Return to App" button links to Cloud's home page.
5. Alpha never re-checks when you come back. The panel has no resume listener, and
   Inbox's `appResumed` hook is never emitted on Android. Leaving Inbox and coming back
   re-reads the grant, which is why "close it and go back to Inbox" works.

Cloud can already return to an app (`APP_OAUTH_RETURN_URLS`, `appReturn: 2`, with the
result in the URL fragment), but Alpha does not use it.

### Calendar "doesn't work" even with Gmail connected

The Gmail connect does include Calendar read. The real problem is that Calendar
**shows Google events only after one calendar is chosen** in
Settings › Google accounts › "Calendar to display". The default is "Local calendars
only". The Calendar screen has no link to that setting and says nothing while it is
unset (`google-calendar-view-adapter.ts:30`). Other problems:

- Only one Google calendar can be shown, and it is read-only.
- One zero-length Google event fails the whole feed (`google-calendar.ts:62`).
- Two-way "linked sync" needs its own review, its own write grant and an agent
  session, and its conflicts have no way out (`code-alpha-runtime-008/009`).
- An expired Cloud sign-in is reported as "Connect Google Calendar".
- There is no search and no schedule list.

### Sign in

- The production page has one button, "Sign in with Eliza Cloud". It leads to a
  "Checking Eliza Cloud sign-in…" wait of up to 6 seconds, and only then to the real
  choices (`connection-ui.tsx:1944`).
- The "saved" text is **"Retry saved connection"** and "Your saved Cloud sign-in…",
  which refer to the Cloud key stored on the phone. There is no saved draft. Both the
  button and the chooser's "Retry" are manual.
- Google is shown only after a readiness probe confirms the App Link and Steward's
  callback allowlist. On 2026-10-24 Steward was still refusing Alpha's callback
  (`docs/native-google-sign-in-deployment.md`), so production offers email only.
- A saved sign-in that cannot be checked while offline still gets the full-screen
  Sign in page.
- Signing in with Google grants identity only. Gmail and Calendar need a second consent.

### Maps "can't connect to the map provider"

- Cloud serves `/api/v1/maps/*`, but its only provider is a self-hosted
  OpenStreetMap stack (Nominatim plus GraphHopper/Valhalla). **No Google Maps wrapper
  exists in Cloud.**
- Production has no `ELIZA_MAPS_*` configuration, so capabilities answers
  `503 maps_not_configured`.
- Production also has `INFERENCE_STRONG_REVOCATION_ENABLED = "false"`
  (`api/wrangler.toml:389`). Admission would therefore still fail with
  `maps_allowance_unconfigured`, and no `ELIZA_CLOUD_MAPS_REQUEST_ALLOWANCES` is set.
- The app turns every failure into "Connect a Maps provider to search places and plan
  routes" (`contracts.ts:230`).
- The session starts only when the Maps screen opens, and after a failure only a new
  search retries.
- The agent cannot navigate until Maps has been opened by hand
  (`ctl-alphaphone-011`).
- Closing the assistant ends navigation, and a failed reroute discards the route.

## 2. Proposed flows

All four flows follow the same rules. The owner leaves Alpha only for Google's own
consent. Nothing asks the owner to press Retry. Errors name their cause in a few
words. Every screen loses its explanatory paragraphs.

### Sign in (`../../specs/quint/legacy/SignIn.qnt`)

- **One screen.** The only controls are **Continue with Google** and an
  **Email or phone number** field with **Continue**. There is no "Sign in with Eliza
  Cloud" step, no Checking wait, no Retry and no Retry saved connection.
- **Google with Play services** (standalone APK). Android's own account and consent
  sheets appear and no browser opens. The app receives a server auth code that Cloud
  exchanges.
- **Google without Play services** (AOSP image). A Custom Tab opens on Google. Google
  returns to a verified App Link, Android brings Alpha forward and the tab is finished.
  No Eliza Cloud page appears.
- **The same Google consent connects Gmail and Calendar** (`gmail.modify` and
  `calendar.events`). The owner can untick either one; Inbox or Calendar then shows its
  own Connect button.
- **Email or phone.** One field accepts either and detects which it is. The next
  screen is "Check your email" (or messages). The code verifies on the sixth digit, SMS
  and email autofill work, and Resend shows a countdown. Nothing leaves the app.
- **Offline.** A step the owner starts is held behind a "Waiting for connection" button
  and sent automatically when the network returns. A saved sign-in always goes straight
  Home, online or not. The sign-in page appears only when Cloud actually refuses the key.

### Gmail and Inbox (`../../specs/quint/legacy/GoogleConnect.qnt`)

- If the owner signed in with Google, Inbox opens with mail and needs no setup.
- Otherwise Inbox shows a mail icon and **Connect Gmail**, and nothing else. The button
  starts Google directly; the Google accounts panel and "Check Google connections"
  are not in this path.
- Cloud redirects to `https://eliza.app/alphaphone/google/return` (App Link). Alpha
  takes the result from the URL fragment and refreshes Inbox and Calendar at once.
- The consent asks for all scopes once, with `include_granted_scopes`, so later
  requests never drop access that was already granted. There is no separate "Enable
  Gmail changes" step.

### Calendar (`../../specs/quint/legacy/Calendar.qnt`)

- **Google appears as soon as it is connected.** Every calendar the owner shows on
  Google appears, colour-coded and toggled from the title menu. The Settings picker
  is removed.
- **Not connected:** a single row on the Calendar screen reads "Show your Google
  Calendar · Connect".
- **Views:** Schedule, Day, Week and Month, plus Search, a Today button and a + button.
- **Google events are first-class.** The owner can create, edit, delete (this event,
  this and following, or all) and RSVP, through Cloud's existing
  `POST/PATCH/DELETE /api/v1/eliza/google/calendar/events`.
- **Delete** shows Undo, and nothing reaches Google until Undo closes.
- **Offline:** changes show at once with a small "waiting to sync" dot.
- **A conflict** shows once, on the event: **Keep mine / Keep Google's**.
- **A broken event** is skipped; it never blanks the calendar.
- **Linked sync goes away.** Google is the source of truth when it is connected (with
  an offline cache), and device calendars stay as they are for phone-only events.

### Maps (`../../specs/quint/legacy/Maps.qnt`)

- **Eliza Cloud wraps Google Maps Platform** for search and autocomplete (Places API,
  New), place details, routes (Routes API: drive, walk, bicycle and transit, with
  traffic) and map tiles (Map Tiles API, proxied). The phone never holds a Google key.
- **There is no "Maps provider"** anywhere in the UI.
- **The Maps session starts at launch** once the owner is signed in. It reconnects by
  itself when the network returns, the plan changes or Cloud recovers.
- **Errors are one line:** *Offline*, *Maps comes with an Eliza Cloud plan* (with
  **See plans**), or *Maps is unavailable right now. Trying again automatically.*
- **Screen flow:** search (with chips) › results › place sheet (Directions, Save,
  Share, Call) › route sheet (mode times, Start) › navigation › arrived. Back unwinds
  one step at a time.
- **Location** is asked for the first time it is needed. Coordinates are never typed.
- **Agent:** "coffee near me", "directions to the ferry terminal" and "take me home"
  work from chat or from the Ask Alpha button on Maps, even if Maps was never opened.
  Maps opens at the result. Navigation starts with one tap on Start, or immediately
  when "Ask before agent actions" is off.
- **Navigation** survives closing the assistant. A failed reroute keeps the current
  route and tries again.

## 3. What you need to configure

These are deployment settings for Eliza Cloud, Google Cloud and the release build. I
cannot set any of them from this repository.

### Google Cloud Console: the project that owns Cloud's `GOOGLE_CLIENT_ID`

1. Create an **Android OAuth client** for package `ai.alphacompute.alphaphone` with
   the **release** signing SHA-1 (`android/release-signer.json`); add the debug SHA-1
   for development builds. It must be in the same project as Cloud's web client so
   that native authorization returns a server auth code for that client.
2. On the OAuth consent screen, list `gmail.modify` and `calendar.events`, plus
   `openid`, `email` and `profile`, and keep the app's Google verification current.
   `gmail.modify` is a restricted scope.
3. Add `https://cloud.eliza.app/api/v1/oauth/google/callback` (already present) as an
   authorised redirect URI on the web client.
4. **Maps:** enable **Places API (New)**, **Routes API**, **Geocoding API** and
   **Map Tiles API** on a billed project. Create a server key restricted to those APIs.

### Eliza Cloud (API worker, production)

| Setting | Value | Why |
|---|---|---|
| `APP_OAUTH_RETURN_URLS` | `https://eliza.app/alphaphone/google/return` | Lets the Google connector return to Alpha instead of `/auth/success` |
| `INFERENCE_STRONG_REVOCATION_ENABLED` | `true` (currently `false` in `[vars]`) | Maps admission refuses every request without it |
| `ELIZA_CLOUD_PLAN_RATE_LIMITS` | selected | Maps allowance gate |
| `ELIZA_CLOUD_MAPS_REQUEST_ALLOWANCES` | `{selected:true, plans:{<plan>:{requests, windowSeconds}}}` for each plan sold with Alpha | Maps allowance gate |
| `GOOGLE_MAPS_API_KEY` (secret) and a provider selection such as `ELIZA_MAPS_PROVIDER=google` | the server key above | New Google provider (upstream work, below) |
| Steward tenant `elizacloud` `allowedRedirectUrls` | add `https://eliza.app/alphaphone/auth/callback` | Only needed for the Custom Tab sign-in path; it is what currently hides Google |

On staging, the allowance settings must also reach the admission worker
(`int-eliza-1-020`).

### eliza.app and the release build

- `https://eliza.app/.well-known/assetlinks.json` must list the **release**
  certificate. On 2026-10-24 it listed the development signer.
- Build with `ELIZAOS_APP_LINK_HOST=eliza.app`. The manifest overlay gains
  `/alphaphone/google/return` (app change, below).
- Read the result back with `adb shell pm get-app-links ai.alphacompute.alphaphone`.

## 4. Implementation plan (after approval)

### App (this repository)

1. **Google connect:** pass `redirectUrl` when Cloud reports `appReturn: 2`; open a
   Custom Tab from `MainActivity`; handle the App Link return and refresh. Also
   refresh on every resume, which mitigates the symptom even before the Cloud setting
   exists. Connect starts from Inbox and Calendar directly, requests all scopes once,
   and treats Cloud's grant as additive.
2. **Native Google authorization** on Play-services devices:
   `Identity.getAuthorizationClient(...).authorize(...)` with
   `requestOfflineAccess(<Cloud web client id>)`, then post the server auth code to
   Cloud.
3. **Sign in:**
   - One screen; remove "Sign in with Eliza Cloud", Retry and Retry saved connection.
   - Compute readiness in the background; retry automatically on the `online` event
     and on resume.
   - A saved key goes Home even when offline.
   - Detect email or phone in one field and verify on the sixth digit.
4. **Calendar:**
   - Remove the selection gate; show every calendar from the feed with visibility
     toggles.
   - Add a Connect row; skip malformed events.
   - Edit, delete and RSVP Google events through the existing Cloud routes, with an
     outbox and Undo.
   - Add Schedule, Week, Month and Search.
   - Retire linked sync.
5. **Maps:**
   - Start the session at sign-in and reconnect automatically.
   - Map each failure to offline, plan or unavailable.
   - Accept `transit` and live traffic when Cloud advertises them.
   - Let agent requests open Maps; keep navigation running when the assistant closes;
     keep the route when a reroute fails.
6. Remove the explanatory copy listed in the prototype's "Today" panels.

### Eliza Cloud (upstream `elizaOS/eliza`, reviewed commit, then a pin bump)

1. **Google sign-in with scopes:** a mobile endpoint that exchanges either a native
   server auth code or a Custom Tab PKCE code. In one step it signs in (or creates)
   the Steward user, stores the Gmail and Calendar connection and returns the
   `eliza_mobile_` key.
2. Add `include_granted_scopes=true` to the connector's Google authorize URL.
3. **A Google Maps provider** registered through `registerMapsProvider`, with Places
   (New), Routes and Geocoding, plus a `/api/v1/maps/tiles/{z}/{x}/{y}` proxy for Map
   Tiles API session tiles. Google's terms require Google tiles under Google place
   results, so the OpenFreeMap basemap is retired for Google results.
4. **Calendar** conflict detection: pass the event ETag through
   (`If-Match` on PATCH/DELETE) and return 412 on mismatch.

### Acceptance

Each step needs its own evidence:

- `npm run verify` and the Android build for both distribution variants;
- emulator checks, both with Play services (the native sheet) and without (the
  Custom Tab returning on the App Link);
- live Cloud checks after the settings above;
- a device run on the Pixel.

## 5. Model-checking results

Each property is checked against both designs. The full table is in
[`tla/results.md`](tla/results.md); summary:

| Model | Properties | Current design | Proposed design |
|---|---|---|---|
| `SignIn` | no Cloud page, codes stay in app, no manual retry, saved sign-in never re-asked, no tab left behind, two taps, Google offered whenever possible, reaches Home | 4 of 8 violated | all hold |
| `GoogleConnect` | no Cloud page, no tab left behind, Inbox fresh on return, one grant for Inbox and Calendar, two taps to mail, scopes never shrink, returns to the app | 7 of 7 violated | all hold |
| `Calendar` | always Back, Google visible when connected, bad event isolated, editable when writable, saved change visible, Undo before send, outbox drains | 4 of 7 violated | all hold |
| `Maps` | no provider talk, honest errors, always Back, agent lands on the result, nav survives the assistant, route kept on failure, self-healing, agent served | 6 of 8 violated | all hold |

Writing the models changed the proposal:

- **Waiting for connection:** the owner could submit twice while offline, so the
  control is locked while a step waits.
- **Connect:** it could be tapped again while Google's sheet was open, so it is locked
  then too.
- **Consent unit:** Gmail and Calendar must each be one consent unit (`gmail.modify`,
  `calendar.events`). With separate read and write scopes, unticking "read" could leave
  Gmail write access without read.

The models count each Google sheet (pick an account, then Allow) as one step. When the
phone has a single Google account, Android skips the picker.
