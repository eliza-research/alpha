// Notes Trash lease (AP-10, MVP-15). Host-JVM run of the native lease decision, agreement of the
// shared renderer lease length with it, and source checks of where each side applies it. Not Android or
// emulator evidence: the WorkManager job and the plugin-load pass have not been run against a row.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {root,nativeSource,fixture,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';

test('the native passes leave a leased row untouched and finish one whose lease expired',{skip:jsonJarSkip},()=>{
 assert.match(runJvm([nativeSource('NotesDeletionLease.java'),fixture('NotesDeletionLeaseTest.java')],'ai.elizaresearch.alphaphone.NotesDeletionLeaseTest',{json:true}),/^PASS notes deletion lease/);
});

test('finishPermanentDeletions consults the lease before any recording or Notes readback is acted on',()=>{
 const source=readFileSync(nativeSource('AlphaNoteAudioPlugin.java'),'utf8');
 const finish=source.slice(source.indexOf('static int finishPermanentDeletions('),source.indexOf('static List<String> trashEntrySpans('));
 const bound=finish.indexOf('boolean bound=Boolean.TRUE.equals(row.opt("permanent"))&&!NotesDeletionLease.held(row,now)&&');
 // The recording steps are the shared store's (elizaOS plugin-native-media RecordingStore.finishPermanent).
 assert.ok(bound>0&&bound<finish.indexOf('recordings(context).finishPermanent('),'a held row is never bound, so it is kept byte for byte');
 // Both native entry points run the same pass; Trash expiry already skips every row with a recovery row.
 assert.match(source,/private void sweepTrashOnStart\(\)\{[\s\S]*?finishPermanentDeletions\(getContext\(\),System\.currentTimeMillis\(\)\)/);
 assert.match(source,/public Result doWork\(\)\{[\s\S]*?finishPermanentDeletions\(getApplicationContext\(\),System\.currentTimeMillis\(\)\)/);
 assert.match(source,/due=!pending\.has\(id\)&&!liveAudio\.contains\(audioId\);/);
});

test('the renderer leases each step and every row it shows, and lease lengths agree',()=>{
 // The lease helpers and their unit cases are the shared plugin-notes recording-deletion module
 // (plugins/plugin-notes/test/notes-recording-deletion.test.mjs). The shared store needs the
 // TypeScript transform, so the bound constant is read in a child process.
 const leaseMs=Number(execFileSync(process.execPath,['--experimental-transform-types','--no-warnings','--input-type=module','-e',"const m=await import('./apps/app/src/runtime/permanent-voice-deletion.ts');console.log(m.PERMANENT_DELETION_LEASE_MS);"],{cwd:root,encoding:'utf8'}).trim());
 const java=readFileSync(nativeSource('NotesDeletionLease.java'),'utf8');
 assert.equal(leaseMs,20*60*1000);
 assert.match(java,/static final long LEASE_MS=20L\*60\*1000;/);
 const binding=readFileSync(join(root,'apps/app/src/runtime/permanent-voice-deletion.ts'),'utf8');
 assert.match(binding,/createNotesDeletionClaims\('alpha\.notes-deletion-claim\.v1:'\)/,'the installed claim name is kept');
 const voice=readFileSync(join(root,'apps/app/src/prototype/voice-adapter.ts'),'utf8');
 assert.match(voice,/row=leasedDeletionRow\(\{id:crypto\.randomUUID\(\)/,'a new row is written leased');
 assert.match(voice,/const dispatched=leasedDeletionRow\(\{\.\.\.row,audioRequested:true as const\},Date\.now\(\)\);await changeAudioDeletion\(row,false,dispatched\);/,'each step renews it');
 // The status pass, the interrupted-deletion settlement and lease renewal are the shared recording
 // effects (plugins/plugin-notes/test/notes-recording-effects.test.mjs); Alpha wires its rows to them.
 assert.match(voice,/createNotesRecordingEffects\(\{recordings:noteAudio,journal:audioDeletionJournal,savedNotes,now:\(\)=>Date\.now\(\)\}\)/,'the native recording store backs the shared effects');
 assert.match(voice,/await recordingEffects\(\)\.renewLeases\(\);/,'rows shown under review stay leased');
 assert.match(voice,/const startedHere=sessionDeletions\.has\(row\.id\);\s*const retired=await recordingEffects\(\)\.reconcile\(row,\{startedHere,claimedElsewhere:\(\)=>deletionClaimedElsewhere\(row\.id\)/,'another live view\'s row is not settled');
 assert.match(voice,/sessionDeletions\.add\(row\.id\);claimDeletion\(row\.id\);/);
});
