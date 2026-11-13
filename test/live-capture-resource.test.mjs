import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {nativeSource, runJvm, upstreamBridgeSource, upstreamVoiceFixture, upstreamVoiceSource} from './fixtures/jvm-tools.mjs';

test('capture cancellation unblocks a read and serializes source release', () => {
 assert.match(runJvm([upstreamVoiceSource('LocalMicrophoneLease.java'), upstreamVoiceSource('LiveCaptureResource.java'), upstreamVoiceFixture('LiveCaptureResourceTest.java')], 'ai.eliza.voice.LiveCaptureResourceTest'), /^PASS live capture resource/);
 // Ensure the exercised owner is wired into the shared production capture and microphone, not a test-only path.
 const source=fs.readFileSync(upstreamVoiceSource('LiveVoiceCapture.java'),'utf8');
 assert.match(source,/resource\.requestStop\(\);[\s\S]*active\.join\(1500\)/);
 assert.match(source,/public void requestStop\(\)\{try\{recorder\.stop\(\)/);
 assert.match(source,/if\(!resource\.attach\(recorder\)\)throw/);
 assert.match(source,/finally\{\s*try\{resource\.release\(recorder\);\}/);
});

test('native admission cancels permission/start before the serialized worker can finish', () => {
 assert.match(runJvm([upstreamVoiceSource('LiveCaptureAdmission.java'), upstreamVoiceFixture('LiveCaptureAdmissionTest.java')], 'ai.eliza.voice.LiveCaptureAdmissionTest'), /^PASS live capture admission/);
 // Alpha's plugin delegates ordering to the shared controller, reserving before the permission prompt
 // and gating events on its own lifecycle epoch (LiveCaptureControllerTest covers the ordering).
 const controller=fs.readFileSync(upstreamVoiceSource('LiveCaptureController.java'),'utf8');
 assert.match(controller,/admission\.attach\(ticket,[\s\S]*next\.start\(\)/);
 const stop=controller.slice(controller.indexOf(' public void stop('),controller.indexOf(' /** Pause:'));
 assert.match(stop,/admission\.stop\(id,discard\);/);
 assert.ok(stop.indexOf('admission.stop(id,discard)')<stop.indexOf('pipe.close(true,cutoff)'), 'Stop is published before transport cancellation can wake startup');
 assert.ok(stop.indexOf('admission.stop(id,discard)')<stop.indexOf('submit(worker'), 'Stop is published before queued worker cleanup');
 assert.match(controller,/next\.start\(\);[\s\S]*?current=next;\s*if\(!host\.canStart\(epoch\)\|\|!admission\.run\(ticket\)\|\|!startup\.report\(\)\)\{admission\.discard\(ticket\);boolean released=retire\(next\);closePipe\(id,true,now\(\)\);if\(!released\)result\.refused\("Microphone release is unconfirmed",CAPTURE\);else refuse\(/,
  'A refused late startup discards its event admission before clearing the published capture and stopping its source');
 // The published capture is cleared only once its microphone release is confirmed; an unconfirmed one stays the owner.
 assert.match(controller,/private boolean retire\(LiveVoiceCapture capture\)\{\s*try\{capture\.stopAndWait\(\);if\(live==capture\)live=null;if\(current==capture\)current=null;return true;\}\s*catch\(RuntimeException unconfirmed\)\{live=capture;current=capture;return false;\}\s*\}/,
  'Retiring a capture stops its source and waits for release before clearing it');
 const plugin=fs.readFileSync(upstreamBridgeSource('LocalSpeechBridgePlugin.java'),'utf8');
 assert.match(plugin,/LiveCaptureAdmission\.Ticket ticket=live\.reserve\(id,epoch\.get\(\)\);\s*if\(getPermissionState\("microphone"\)/);
 assert.match(plugin,/public boolean open\(long admitted\)\{return !destroyed&&speechForeground&&admitted==epoch\.get\(\);\}/);
});
