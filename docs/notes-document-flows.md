# Notes sharing and text documents

Notes uses the common Share panel: Share to email opens an in-app draft,
Share externally opens the platform chooser, Copy text copies the selected
snapshot, and Save locally opens the document destination picker.
Opening the panel does not send content. Cancellation and a changed selection
retire the panel without invoking another destination.

The shared text snapshot includes the note title, a blank line and its body.
Text bodies retain their stored CR/LF and UTF-8 BOM characters; this is a saved
note representation, not a byte-for-byte copy of an imported source file.
Checklists include their checked states, links include their URL and excerpts,
and voice-note text explicitly excludes the audio recording. Native saving
writes the bounded UTF-8 snapshot and verifies the written bytes by readback.
Only a matching readback confirms success; unsupported readback is reported as
unverified. Cancellation does not report a saved file.

Production note import is disabled by the current data-migration policy.
The import path below remains available only in explicit development/test
builds. Its historical qualification is not current production acceptance.

## Development import and historical export qualification

The development Import text note action launches Android's explicit document
picker with text MIME filtering.
The selected content is read locally with the existing strict UTF-8/64 KiB
reader. A native-only transient-reader entrypoint avoids creating, persisting or
evicting any Files selection capability. UTF-8 BOM and CR/LF content are retained
for Notes; HTML textarea presentation normalizes line endings without changing
the stored imported body. Unsupported type/encoding, revoked access, oversized
content and cancellation do not create a note.

A successful import creates a new random-ID text note through the existing Notes
persistence/conflict guard. It never overwrites a same-title note. The source
filename provides the editable title; original content is not uploaded or sent
to an agent. Leaving Notes while selection is pending invalidates its completion.

The earlier Share sheet exposed Export text file for text notes. Export captured
the current title/body before opening ACTION_CREATE_DOCUMENT. The user chooses
the destination; native code writes that bounded UTF-8 snapshot, closes it and
reads back exact bytes. Only matching bytes produce an exported receipt. A
provider that accepts writes but cannot be read back returns **unverified**, with
an explicit instruction to inspect the destination before retrying. Partial
writes cannot be automatically rolled back across arbitrary providers. Cancelling
selection never reports export success. Checklist/audio/link notes are not
silently flattened; this slice exports plain text bodies only, with the title as
the suggested filename. No broad storage permission or persistent URI grant is
requested.

Native ownership: AlphaNoteDocumentsPlugin, registered in MainActivity; the read
implementation is the shared `SelectedDocuments` engine (elizaOS
`plugins/plugin-native-media`) behind Alpha's `SelectedDocumentAccess`, which keeps
the installed `selected-documents` registry and `document-` preview names. Renderer ownership:
notes-document-adapter.ts, installed after voice so existing audio UI/storage
continues to work. Mock mode (present only in `ELIZA_DEV_ALLOW_TEST_MOCKS=1` builds)
does not install this adapter or its native actions.
The current Share panel replaces that earlier sheet. Import stays conditional
on the development flag; saving selected note text remains a production action.

## Note to calendar and reminder hand-offs

A saved voice note can start a calendar event or reminder draft; the saved record keeps an
identity-only link back to the note. The contract, including the Android limits, is in
[calendar and reminder contracts](calendar-reminder-contract.md#note-origin-and-the-note-hand-offs).

## Verification

Run `npm run typecheck` and `node scripts/test-notes-documents-browser.mjs`.
The latter renders the actual Notes adapter/template with a synthetic native
boundary and checks development import, complete selected-note saving with its
title and unchanged CR/LF body, cancellation,
and browser reload. It is not Android/provider evidence.

The historical `NotesDocumentInstrumentedTest` import campaign contains two
native flows and one gated process method. Its old import and Share selectors
must be reconciled with the selected development build before rerunning it;
these descriptions are not a claim that the current production UI passed them:

- Actual SAF import, cancellation, export Save, independent exact-byte readback,
  re-import as a distinct note, and Activity recreation.
- Actual selected oversized/invalid-UTF-8 documents leave Notes unchanged.
- `documentProcessRestartPhase`, explicitly invoked by
  `scripts/test-native-restart.mjs notes`, prepares the same real document flow,
  then requires a changed PID before opening the saved note and checking exact
  stored content. The runner validates both APK hashes against one archive's
  manifest and matching distribution, force-stops between phases and attempts
  scoped cleanup. Fixture files/notes contain a unique synthetic UUID; no user
  note, arbitrary folder or broad trash cleanup is authorized.

Archive a matching APK pair with its flat `apk-manifest.json`, then run:

```
ANDROID_SERIAL=emulator-N ALPHA_NATIVE_TEST_AVD=owned-avd ALPHA_NATIVE_TEST_ABI=x86_64 \
node scripts/test-native-restart.mjs notes \
  test-results/notes-archive/standalone-debug.apk \
  test-results/notes-archive/standalone-androidTest.apk \
  test-results/notes-archive/notes-standalone
```

Repeat with matching launcher artifacts and a new output directory. The runner
leases the owned emulator, refuses existing package registrations, and creates
a disposable secondary user. Set `ALPHA_TEST_HOME_PACKAGE` for the stock HOME
package when it differs from `com.android.launcher3`. Strict instrumentation
records must prove the requested method completed; a summary line alone cannot
pass. Uncertain package cleanup retains the fixture user for recovery.

The native test obtains the exported file through real DocumentsUI selection,
then checks its provider-granted URI, unique name, MIME, encoded size,
modification-time window, read/write grant, delete support and exact bytes.
Cleanup reselects the exact file if needed and deletes only the validated grant.
Unknown metadata retains the private recovery journal. The test restores the
prior Files selection and checks that existing capabilities remain unchanged.
The runner's UUID binds the note record and export journal across phases.

Real DocumentsUI behavior, grant cleanup and errors require both-variant native
runs against the recorded APKs. Browser tests and compilation do not prove those
contracts. Private/cloud providers, interrupted writes, physical-device acceptance
and general multi-note import/export remain separate acceptance work.
