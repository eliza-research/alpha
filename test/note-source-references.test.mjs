// J03 option (a): a note's linked source keeps its Android read grant while a note references it.
// The reference rules, three-day unsaved grace and grant release are the shared native media module's
// (SourceReferences, SourceReferenceStore, SelectedDocuments; tested there). These are source checks of
// Alpha's wiring and installed names. Not Android evidence: no provider grant has been held or released
// on a device or emulator here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {root,nativeSource} from './fixtures/jvm-tools.mjs';

test('Notes source links keep their installed preference names and use the shared store',()=>{
 const names=readFileSync(nativeSource('NoteSourceReferences.java'),'utf8');
 assert.match(names,/static final String PREFERENCES="note-source-references";/);
 assert.match(names,/static final String RETAINED_PREFERENCES="note-source-reference-times";/);
 assert.match(names,/new SourceReferenceStore\(context\.getApplicationContext\(\),PREFERENCES,RETAINED_PREFERENCES\)/);
 assert.doesNotMatch(names,/GRACE_MS|unreferenced\(|orphaned\(/,'no second copy of the shared rules');
});

test('forgetting or evicting a picker selection never releases a grant a note link names',()=>{
 const access=readFileSync(nativeSource('SelectedDocumentAccess.java'),'utf8');
 assert.match(access,/static final String PREFERENCES="selected-documents",PREVIEW_PREFIX="document-";/,'installed registry and preview names');
 assert.match(access,/new SelectedDocuments\(app,PREFERENCES,PREVIEW_PREFIX,NoteSourceReferences\.store\(app\)::retains\)/,'the shared registry keeps grants a note link names');
 assert.doesNotMatch(access,/releasePersistableUriPermission|getPersistedUriPermissions/,'grant handling lives in the shared module');
});

test('Notes reconcile references after every Trash maintenance pass and when a link is replaced',()=>{
 const plugin=readFileSync(nativeSource('AlphaMailAttachmentsPlugin.java'),'utf8');
 const method=plugin.slice(plugin.indexOf('@PluginMethod public void releaseSourceReferences('),plugin.indexOf('private JSObject saveResult('));
 assert.match(method,/if\(!SourceReferences\.valid\(value\)\)throw new IllegalArgumentException\(\);/,'the whole keep list is validated before any work');
 assert.match(method,/NoteSourceReferences\.store\(getContext\(\)\)\.reconcile\(keep,System\.currentTimeMillis\(\),uri->SelectedDocumentAccess\.releaseUnreferenced\(getContext\(\),uri\)\);/);
 const retain=plugin.slice(plugin.indexOf('@PluginMethod public void retainSourceReference('),plugin.indexOf('@PluginMethod public void openSourceReference('));
 assert.match(retain,/if\(!hash\(bytes\)\.equals\(call\.getString\("sha256"\)\)\|\|token!=generation\.get\(\)\)throw new SecurityException\(\);/,'only the reviewed bytes are linked');
 assert.match(retain,/NoteSourceReferences\.store\(getContext\(\)\)\.retain\(uri,System\.currentTimeMillis\(\)\)/,'every retain (re)starts a stored grace period');
 assert.match(plugin,/Uri uri=NoteSourceReferences\.store\(getContext\(\)\)\.resolve\(call\.getString\("reference"\)\);/,'reopening requires a stored reference and a held grant');
 assert.doesNotMatch(plugin,/retainedAt\.put\(/,'the grace period does not live only in process memory');
 const trash=readFileSync(join(root,'apps/app/src/prototype/notes-trash-adapter.ts'),'utf8');
 assert.match(trash,/releaseUnusedSourceReferences\(\[\.\.\.await savedNotes\(\),\.\.\.\(await readNotesTrash\(\)\)\.entries\.map\(entry=>entry\.note\)\]\)/,'saved and restorable notes keep their links');
 const source=readFileSync(join(root,'apps/app/src/prototype/note-source-adapter.ts'),'utf8');
 assert.match(source,/await attachments\.releaseSourceReferences\(\{keep\}\);/);
 assert.match(source,/if\(source\?\.reference&&source\.reference!==next\?\.reference\)void api\.notesTrash\?\.maintain\?\.\(\);/);
});
