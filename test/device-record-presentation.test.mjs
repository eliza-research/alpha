import test from 'node:test';
import assert from 'node:assert/strict';

const {presentDeviceRecordOperation}=await import('../apps/app/src/runtime/device-record-presentation.ts');

test('agent delete review cards describe what the phone does',()=>{
  const cases=[
    [{type:'calendar_delete',target:{sourceId:'local',eventId:'e1',revision:'r1'}},
      'Delete selected event','Delete this event. You can Undo for 10 seconds. If its calendar syncs with an account, the account is updated after that.','Deleted selected event.'],
    [{type:'notes_delete',target:{noteId:'n1',revision:'r1'}},
      'Move selected note to Trash','Move this note to Trash. A voice note’s recording moves with it.','Moved selected note to Trash.'],
  ];
  for(const [operation,title,details,applied] of cases){
    const presented=presentDeviceRecordOperation(operation,'UTC');
    assert.equal(presented.title,title);
    assert.equal(presented.description,`${title}\n${details}`);
    assert.equal(presented.appliedSummary,applied);
    assert.doesNotMatch(presented.description,/cannot be undone|from this phone|retained/);
  }
});
