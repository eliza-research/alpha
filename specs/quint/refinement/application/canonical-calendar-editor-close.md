# Mounted canonical Calendar editor close

`CanonicalCalendarEditorClose` covers the real Calendar list, event detail,
editor and attendee picker. Alpha Back closes the picker before the
editor. Header close dismisses the editor directly. Resume restores the
exact owner, form identity, event target and last valid title. Confirmed
discard clears the retained form and its validation flag when the durable
consume succeeds. A refused or failed discard leaves the retained draft
available. New and Edit both keep a retained draft until explicit
Resume or Discard.

The Chromium campaign checks 80 checkpoints across eight schedules using
the mounted Alpha Shell, real Calendar source adapter and IndexedDB
draft store. It observes all ten modeled state fields and six derived
rendered controls. The schedules include exact detail return, same and
different event edit admission, a held and failed durable discard,
overlong title recovery, re-admission to Calendar Settings, and
replacement ownership with the earlier owner’s durable slot intact.

The model bounds two owners, two writable fixture events and four
generated form identities. Title equality classes cover blank, source
event text, two valid edits and an overlong edit. The closed record
transport rejects provider writes. Provider saves, the alternate draft
destinations, and general draft recovery are separate.

```sh
bun test test/quint-canonical-calendar-editor-close.test.mjs
```
