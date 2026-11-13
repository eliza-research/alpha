import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeSource,fixture,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';

// Plain-JVM run of the native consent rule for Google Calendar sync writes. Not Android evidence.
test('Google Calendar sync writes need the native consent for the exact grant, account and calendar',{skip:jsonJarSkip},()=>{
 assert.equal(runJvm([nativeSource('CalendarSyncConsent.java'),fixture('CalendarSyncConsentTest.java')],'ai.alphacompute.alphaphone.CalendarSyncConsentTest',{json:true}).trim(),'PASS calendar sync consent');
});
