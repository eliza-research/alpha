# Settings

Settings shows only what Alpha can change or must disclose, built from real device and agent
state (`apps/app/src/prototype/settings-adapter.ts`). It repeats no Android fact Alpha cannot
change (radios, volumes, battery, build), and each flow has one entry. This page describes source
behaviour and browser tests; it is not emulator, AOSP-image or device evidence.

## Top level

| Group | Row | Opens or does |
| --- | --- | --- |
| (header) | Agent name | edited in place |
| Account | Eliza Cloud (the deployment's service name) · plan or `Sign in` | the account and plan page: plan facts, Approve this phone again (while the sign-in key is expiring), Redeem code, Manage plan, Sign out (confirmed) |
| | Google · account count or `Connect` | the Google accounts sheet: connect, disconnect, calendars |
| Assistant | Ask before acting | switch |
| | Agent connection · status | the agent page (Android): status, Restart Alpha, recovery details, New conversation, Earlier conversations, actions to confirm. Elsewhere it opens the connection panel |
| | AI · provider | the provider choice |
| | Listening · status (AOSP listener only) | Pause, Turn off, the listener's settings |
| | Wake listening (only when a stop was not confirmed) | a fact pointing to Android settings |
| | Scheduled digests | the digests sheet |
| Apps | Calendars | Google Calendar, a retry or access review when the calendar needs attention, recovery of saved events |
| | Passwords | Alpha's password manager and the Android password provider |
| | Photos access · scope (Android) | Android's photo access prompt |
| | Load images in email | switch |
| | Make Alpha your Home app (launcher, while not Home) | Android's role dialog |
| Appearance | Theme | System, Light or Dark |
| | Text size | slider |
| Notifications | Notifications · state | Android's notification page for Alpha (the browser's alert settings in a browser build) |
| | Notifications from other apps · state | collection, apps and previews, history, Android notification access |
| Privacy | App permissions · summary (Android) | Android's permission page for Alpha |
| | Finish setup (only while a startup permission is missing) | the startup access panel |
| System | Android settings (launcher) | Android's Settings |
| | Install update (only when the manifest offers one) | the verified download and Android's installer |
| | About · version | version and install date, Problem log, Export diagnostics, Open source licenses, Check for updates |
| | Developer (developer builds only) | developer facts |
| (last) | Reset Alpha data (Android) | Android's confirmed reset |

Rules:

- A row is a label with at most one short value at the right. A switch carries no sentence unless
  it would otherwise mislead. Errors are toasts, not rows.
- Destructive actions confirm first (Sign out, Clear history, Clear problem log).
- Routes: `settingsPage` accepts only the pages in `SETTINGS_PAGES` (and `developer` behind the
  developer gate); any other page opens the top level.
- Android Back and each page's own back control go to the same parent (`SETTINGS_PARENT`):
  Earlier conversations and recovery details to Agent connection, Problem log and licenses to
  About, a password entry to Passwords, every other page to the top level.

## Tests

- `test/settings-truth.test.mjs`: routing, Back parents, a top level without fact rows, the
  account page (`cloudAccountPage`) and the permission summary.
- `test/cloud-plan-cancel.test.mjs`: the account page's plan actions.
- `test/browser/settings-navigation.spec.ts` and the Settings production specs
  (`settings.production.spec.ts`, `settings-truth.production.spec.ts`).
