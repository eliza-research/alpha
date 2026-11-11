# Canonical Calendar draft handoff

`CanonicalCalendarDraftHandoff` models the mounted Note and scanned-event
reviews at the canonical Calendar entry point. A retained form, an opening
slot or a pending consume keeps an incoming form with its origin review.
The exact current port and available canonical source can admit a fresh
form. The separate reminder editor leaves the existing canonical slot
untouched.

Five source schedules and 44 checkpoints cover all nine state fields and
14 transition actions. Chromium drives the actual Note actions and real
scan review, with a generated JPEG, local OCR, closed media and
app-record ports, and actual IndexedDB. The schedules verify exact
stored bytes, Note refusal and re-admission, Camera dialog retention,
a held consume, a replacement owner’s held read, and unapproved
legacy preservation.

The model bounds two owners and one fixture of each incoming type.
The camera fixture enters at the captured-image review boundary.
Physical capture, OCR quality, general provider behavior, and installed
process death are separate.

```sh
bun test test/quint-canonical-calendar-draft-handoff.test.mjs
```
