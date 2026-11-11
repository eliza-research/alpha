import test from 'node:test';
import assert from 'node:assert/strict';
import {replayVideoRecorder} from '../specs/quint/refinement/native/video-recorder.mjs';

test('the browser video recorder follows every VideoRecorder model step', {timeout: 180000}, async () => {
  const receipt = await replayVideoRecorder({traces: 400, maxSteps: 20});
  assert.equal(receipt.traces, 400);
  assert.ok(receipt.steps > 3000, JSON.stringify(receipt));
  for (const action of ['startResolved', 'chunk', 'limitOrTrackEnded', 'recorderStopped', 'prefixRead', 'recorderError', 'stopDeadline', 'finish', 'finalized', 'stopPreview'])
    assert.ok(receipt.actions[action] > 0, action);
});
test('a recorder that discards the video at the size limit is rejected by the replay', {timeout: 180000}, async () => {
  await assert.rejects(replayVideoRecorder({traces: 400, maxSteps: 20, rewrite: {'browser/video-capture.ts': text =>
    text.replace("if(admitted.stop){full=true;stop();}", "if(admitted.stop){full=true;finish(Error('Video exceeded the size limit.'));}")}}), /trace \d+ step \d+ /);
});
test('a recorder that admits chunks after the limit is rejected by the replay', {timeout: 180000}, async () => {
  await assert.rejects(replayVideoRecorder({traces: 400, maxSteps: 20, rewrite: {'browser/video-capture.ts': text =>
    text.replace("if(full){truncated||=event.data.size>0;return;}", "if(full){truncated||=event.data.size>0;}").replace("if(bytes+chunk>max)return {keep:false,stop:true,bytes};", "")}}), /trace \d+ step \d+ /);
});

test('a recorder that saves a retained prefix without reading its media is rejected by replay', {timeout: 180000}, async () => {
  await assert.rejects(replayVideoRecorder({traces: 400, maxSteps: 20, rewrite: {'browser/video-capture.ts': text =>
    text.replace('if(truncated){', 'if(false){')}}), /trace \d+ step \d+ /);
});
