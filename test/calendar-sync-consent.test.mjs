import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {nativeSource,fixture,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';

// Plain-JVM run of the native consent rule for Google Calendar sync writes. Not Android evidence.
test('Google Calendar sync writes need the native consent for the exact grant, account and calendar',{skip:jsonJarSkip},()=>{
 assert.equal(runJvm([nativeSource('CalendarSyncConsent.java'),fixture('CalendarSyncConsentTest.java')],'ai.elizaresearch.alphaphone.CalendarSyncConsentTest',{json:true}).trim(),'PASS calendar sync consent');
});

// Source-order check: the transport applies the consent rule before connecting or writing a body.
test('the native transport checks Calendar sync consent before any connection',()=>{
 const source=readFileSync(resolve(import.meta.dirname,'../android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaConnectionPlugin.java'),'utf8');
 const request=source.slice(source.indexOf('@PluginMethod public void request('),source.indexOf('@PluginMethod public void cancel('));
 const consent=request.indexOf('if(CalendarSyncConsent.write(url.getRawPath(),method)&&!CalendarSyncConsent.admits(url.getRawPath(),url.getRawQuery(),method,call.getString("body"),calendarSyncConsent()))throw new IllegalArgumentException();');
 assert.ok(consent>request.indexOf('if(!ConnectionRoutes.managedService('),'consent follows route admission');
 assert.ok(consent<request.indexOf('openConnection()')&&consent<request.indexOf('call.getObject("headers"'),'consent precedes the connection');
 assert.match(source,/private String calendarSyncConsent\(\)throws Exception\{return readCredentialSlot\(CalendarSyncBridge\.SLOT\);\}/);
});
