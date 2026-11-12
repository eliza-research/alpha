import test from 'node:test';
import assert from 'node:assert/strict';
import {checkinDisplayText} from '../apps/app/src/runtime/action-message-presentation.ts';

const id='7204d731-7cfd-4708-a15d-d3f57c682855';
const marker=`[CHOICE:checkin-${id} id=${id}]
All good=All good
details ${id}=Show details
snooze ${id}=Snooze
[/CHOICE]`;
const text='Take twenty quiet minutes before bed.\n'+marker;
const row={id:'saved-checkin',role:'assistant',source:'lifeops-checkin',text};
test('service-authored check-ins preserve prose and original text while hiding only their canonical suffix',()=>{
 assert.equal(checkinDisplayText(row),'Take twenty quiet minutes before bed.');
 assert.equal(row.text,text);
 assert.equal(checkinDisplayText({...row,text:text.replaceAll('\n','\r\n')}),'Take twenty quiet minutes before bed.');
});
test('user, ordinary assistant, quoted, malformed and ambiguous choice text is preserved',()=>{
 for(const candidate of [
  {...row,role:'user'}, {...row,source:'client_chat'}, {...row,source:undefined},
  {...row,text:'Example:\n```\n'+marker+'\n```'},
  {...row,text:'Example:\n```\n'+marker},
  {...row,text:'Example:\n'+marker.split('\n').map(line=>'> '+line).join('\n')},
  {...row,text:text+'\nLater prose'}, {...row,text:marker},
  {...row,text:text+'\n'+marker},
  {...row,text:text.replace('snooze '+id,'snooze different')},
  {...row,text:text.replace('All good=All good','send=Send email')},
 ])assert.equal(checkinDisplayText(candidate),undefined);
});
