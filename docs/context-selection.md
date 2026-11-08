# Folder, notification and capture context selection

Scope: inventory item MVP-13 (AP-04, AP-10). This records what the renderer implements.
It is not evidence of an APK build, an emulator run, real integrations or device acceptance;
those gates stay open (see [current status](mvp-current-status.md)).

## Two separate things

1. **Selected identity** travels in the agent context envelope
   (`apps/app/src/runtime/phone-context.ts`). It is an opaque kind, id and revision. It never
   contains a name, path, URI, text or image.
2. **Reviewed content** reaches the conversation only as an excerpt the owner saw and could
   edit in the "Ask about selected content" review, then sent themselves.

## Sources

| Source | Identity | Review scope | Ends when |
| --- | --- | --- | --- |
| Selected document (`selection-adapter.ts`) | `document`, picker capability, accept epoch plus rename count | The shown text or PDF page | Closed, forgotten, reselected or renamed |
| Alpha Phone notification (`notifications-adapter.ts`) | `notification`, id, revision, `accountId: own` | That notification's shown title and text | The shade closes, or the row is dismissed, updated or hidden |
| Saved photo or video (`camera-adapter.ts`) | `photo` or `video`, library id, session-local `capture-<session>-N` counter (`createCaptureRevisions`) | The open item, described or read locally (English OCR) | Another item opens, or it is edited, favorited, trashed or removed |
| Camera frame | none | One unsaved frame | The camera closes or restarts |
| Settings page (`context-selection.ts`) | `settings`, section slug only | none | The page changes. Credential pages have no identity |

The provider's own folder revision embeds the display name, so it is used only for local
comparison and never sent. The photo library's own revision is not sent either: on Android it
is the item's added time and byte size, with a `|generation` suffix (which the wire contract
refuses) once an item was favorited, trashed or restored. The shared counter changes exactly
when that item's library revision or mutation revision changes. The photo `id` is still the
library's item id (on Android the MediaStore row number).

## Change during review

A folder is read again when the owner chooses "Use in conversation". A deleted, added,
renamed or replaced entry, a changed folder or ended access adds nothing to the conversation;
the folder is shown as it now is and must be reviewed again. Only the folder's first page is
read again: it must be exactly the entries that were loaded first, cover every entry the excerpt
names, and report the same total. A notification is listed again the same way and must still be
present with the reviewed revision and text; its review also closes when the shade closes. A
saved photo or video is read again from the library: one trashed, edited or removed since the
review started adds nothing and its viewer closes. A neighbor never stands in for the reviewed
item. A draft that was already placed is still subject to the
existing dispatch check: a changed context revision returns the message to the composer.

## Visibly unavailable

- Other apps' mirrored notifications (P-03) and rows listed with the `hosted` source offer no
  question. On Android every notification Alpha Phone itself posted is listed as an own row,
  including workflow and hosted-result notices; the review scope is still only the title and
  text that row shows.
- A notification whose content is withheld (device locked, or marked secret) offers no question.
  The browser build shows an empty row; Android shows fixed placeholder wording, which is matched
  by its exact text (`HIDDEN_NOTICE_TITLE`, `HIDDEN_NOTICE_TEXTS`).
- Excerpts that look like credentials or verification codes are refused in the notification review.
- A typed Photos or Files search question is not a capture. Outside the browser development
  profile it reports that content analysis is not connected.
- A Photos viewer question with no saved item open, and a Camera question while the camera
  is not ready, report that nothing was sent.

## Tests

`test/context-selection.test.mjs` (rules) and `test/browser/context-selection.spec.ts`
(rendered flows in the browser build). The browser app-files store cannot lose a grant, so the
revoke case stubs the listing answer at the plugin boundary, as does the case for Android's
withheld-notification wording. Android folder grants, MediaStore revisions and the notification
listener are not exercised by these tests: the Android photo revision format and placeholder
wording are checked only against the Java source text.
