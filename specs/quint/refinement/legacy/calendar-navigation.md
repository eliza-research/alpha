# Historical Calendar navigation comparison

This source campaign uses the unchanged proposed `Calendar` model. It
compares Day and Month switching, a new editor’s Back, an existing editor’s
return to the exact event, and the second loaded event. The mounted
Chromium renderer supplies the actual layer, event focus, loaded fixture
rows, and available Edit and Back controls. The source’s Month Back maps
to the historical `Switch("Day")` transition. Typing into the current
durable form stutters for the historical state.

Four schedules and 16 checkpoints passed. Two bounded Eliza rows supply
the historical writable event capability for the navigation comparison.
The closed transport reads fixture CalendarService responses and
rejects writes. This campaign does not exercise the historical Week,
Schedule, Search, RSVP, Google account picker, malformed-feed,
optimistic outbox, conflict or delete-undo semantics.

```sh
bun test test/quint-historical-calendar-navigation.test.mjs
```
