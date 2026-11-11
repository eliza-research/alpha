# Connect Google Calendar readback

`GoogleCalendarLinkFlow` follows the renderer's Connect Google Calendar
helper after account verification. It waits for Calendar to settle,
keeps a saved destination or selects the unique authorized primary, and
uses a new review before resume. The last review can report a clean active
link, an advancing dispatch, an unresolved dispatch or a conflict.

The source campaign compares 205 checkpoints across 42 schedules. It
executes `linkGoogleCalendar` with its real settlement subscription and
operation-key derivation. Controlled Calendar methods hold each review,
dispatch admission, provider reply and linked-events read independently.
The campaign compares exact control revision, source identity, operation
key and returned status text. It checks that a write clears the retained
review only at dispatch and that a lost reply cannot confirm sync.

The model bounds two accounts and owners, three destinations, three review
rounds and two control writes. It records the helper's return value. The
mounted caller owns UI publication, and `AgentCalendarSyncControl` covers
the separate renderer control client. Installed provider behavior and
durable replay have their own boundaries.

```sh
bun test test/quint-google-calendar-link-flow.test.mjs
```
