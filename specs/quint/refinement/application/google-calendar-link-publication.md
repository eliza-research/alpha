# Google Calendar link publication in the mounted panel

`GoogleCalendarLinkPublication` follows the current Calendar intent in
`GoogleConnectionsPanel`. A link and an account read have independent
busy ownership. A link can publish its notice and retained review only
while its token, Cloud binding and Calendar intent remain current.

The source campaign mounts the actual React panel in Chromium and
compares 181 checkpoints across 23 schedules. Controlled account,
browser-host and Calendar-link ports allow old and replacement replies
to settle independently. The campaign checks same-intent owner and
client changes, stale host permission, Calendar scope loss, the visible
notice, retained review, busy state, and the real inert and focus cleanup.
It also observes the continuation from verified account readback.

The application Settings Calendar row opens this panel through
`googleConnectionController.openCalendar`. The separate
`openCalendarSyncSettings` export in `calendar-sync-settings.ts` has
test callers. `test/calendar-sync-settings-navigation.test.mjs` calls
both modes, and `test/browser/calendar-sync-fixture.ts` calls legacy
mode. The production source contains the definition and internal
canonical branch.

The mounted fixture uses a known-on Calendar access receipt. Access
persistence, link readback, Calendar control, disconnect, native access
publication and installed provider effects have separate scopes.

```sh
node --test test/quint-google-calendar-link-publication.test.mjs
```
