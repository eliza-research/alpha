import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {checkinDisplayText,systemNoticeKind,systemNoticeDisplayText} from '../apps/app/src/runtime/action-message-presentation.ts';

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
test('actual history projection preserves source text and only attaches a trusted presentation',()=>{
 const source=readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');
 const a=source.indexOf('function restoredMessages('),b=source.indexOf('/** Eliza Cloud\'s API',a);
 assert.ok(a>=0&&b>a);
 const project=new Function('checkinDisplayText','systemNoticeKind','systemNoticeDisplayText','restoredText',
  stripTypeScriptTypes(source.slice(a,b),{mode:'transform'})+';return restoredMessages;'
 )(checkinDisplayText,systemNoticeKind,systemNoticeDisplayText,value=>value);
 const [checkin,user,quoted]=project([row,{...row,id:'user',role:'user'},{...row,id:'quoted',source:'client_chat'}]);
 assert.equal(checkin.displayText,'Take twenty quiet minutes before bed.');
 assert.equal(checkin.text,text);
 assert.equal(user.text,text);assert.equal(user.displayText,undefined);
 assert.equal(quoted.text,text);assert.equal(quoted.displayText,undefined);
 const model=readFileSync('apps/app/src/prototype/model.js','utf8');
 const begin=model.indexOf('    var msgs = S.msgs.map('),end=model.indexOf('    var baseSug =',begin);
 assert.ok(begin>=0&&end>begin);
 const render=new Function('S','IC','self',model.slice(begin,end)+';return msgs;');
 const [rendered,renderedUser]=render({msgs:[checkin,{...user,displayText:'untrusted projection'}]}, {}, {});
 assert.equal(rendered.displayText,'Take twenty quiet minutes before bed.');
 assert.equal(rendered.text,text,'copy and reply retain the original text');
 assert.equal(renderedUser.displayText,text,'a user row cannot supply a display projection');

});
