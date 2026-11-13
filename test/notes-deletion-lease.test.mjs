// Notes Trash lease (AP-10, MVP-15). Host-JVM run of the native lease decision, agreement of the
// shared renderer lease length with it, and source checks of where each side applies it. Not Android or
// emulator evidence: the WorkManager job and the plugin-load pass have not been run against a row.
import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeSource,fixture,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';

test('the native passes leave a leased row untouched and finish one whose lease expired',{skip:jsonJarSkip},()=>{
 assert.match(runJvm([nativeSource('NotesDeletionLease.java'),fixture('NotesDeletionLeaseTest.java')],'ai.alphacompute.alphaphone.NotesDeletionLeaseTest',{json:true}),/^PASS notes deletion lease/);
});

