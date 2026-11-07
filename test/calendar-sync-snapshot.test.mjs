import test from 'node:test';
import assert from 'node:assert/strict';
import {jvmSkip} from './fixtures/jvm-tools.mjs';
import {calendarSyncSnapshotJvm} from './fixtures/calendar-sync-snapshot-jvm.mjs';
test('native sync snapshots read exact owned rows and preserve all conditional dependencies',{skip:jvmSkip(['json','javac','sqlite3'])},()=>{
 const [verdict,timed]=calendarSyncSnapshotJvm().trim().split('\n');
 assert.equal(verdict,'PASS exact owned Calendar sync snapshots, tombstones and atomic assertions');
 assert.equal(JSON.parse(timed).isAllDay,false);
});
