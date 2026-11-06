import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
const code=stripTypeScriptTypes(readFileSync('apps/app/src/prototype/assistant-draft-controller.ts','utf8'),{mode:'transform'});
const {AssistantDraftController}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const record=(text,revision='1')=>({version:1,binding:'test',revision,text});
function fixture(){let text='',saved=null;const store={async read(){return saved;},async save(expected,value){assert.deepEqual(expected,saved);return saved=record(value,String(Number(saved?.revision||0)+1));}};const c=new AssistantDraftController(async()=>store,()=>text,value=>{text=value;},()=>{});return {c,store,set:value=>{text=value;c.edit(value);},get:()=>text,saved:()=>saved,external:value=>{saved=record(value,'external');}};}
test('opening quietly retries a transient read without losing restored draft text',async()=>{
 const f=fixture();f.external('Keep these words');const read=f.store.read;let attempts=0;
 f.store.read=async()=>{if(++attempts===1)throw Error('Storage opening');return read();};
 const opening=f.c.open('one');assert.equal(f.c.state.message,'');assert.equal(f.c.state.opening,true);
 await opening;assert.equal(attempts,2);assert.equal(f.c.state.error,false);assert.equal(f.get(),'Keep these words');
});
test('a retired draft cannot restore its text after a storage-open retry',async()=>{
 const f=fixture();let attempts=0;f.store.read=async()=>{attempts++;throw Error('Unavailable');};
 const opening=f.c.open('old');await tick();f.c.retire();f.set('New words');await opening;
 assert.equal(attempts,1);assert.equal(f.get(),'New words');assert.equal(f.c.state.error,false);
});
test('repeated connection notifications wait for the same pending draft read',async()=>{
 const f=fixture();let finish;f.store.read=()=>new Promise(resolve=>{finish=resolve;});
 const first=f.c.open('one');let secondFinished=false;const second=f.c.open('one').then(()=>{secondFinished=true;});
 await tick();assert.equal(secondFinished,false);finish(record('Saved words'));await Promise.all([first,second]);
 assert.equal(f.get(),'Saved words');assert.equal(f.c.state.opening,false);
});
test('persistent read failure stays actionable, never overwrites a draft and never blocks sending',async()=>{
 const f=fixture();f.store.read=async()=>{throw Error('Unavailable');};f.set('Unsent words');await f.c.open('one');
 assert.equal(f.get(),'Unsent words');assert.equal(f.saved(),null);assert.equal(f.c.state.error,true);
 assert.equal(await f.c.hold('Unsent words'),true);f.set('');f.set('Newer');f.c.release();
 assert.equal(f.get(),'Unsent words\nNewer','text held only in memory always returns to the composer');assert.equal(f.saved(),null);
 assert.equal(await f.c.hold('Unsent words\nNewer'),true);f.set('');await f.c.commit();assert.equal(f.saved(),null);
});
test('a failed draft write never blocks sending',async()=>{
 const f=fixture();await f.c.open('one');f.store.save=async()=>{throw Error('Write failed');};f.set('Send anyway');
 assert.equal(await f.c.hold('Send anyway'),true);f.set('');await f.c.commit();assert.equal(f.get(),'');
});
test('the saved draft keeps the text while a send is in flight and clears only after dispatch',async()=>{
 const f=fixture();f.external('Hello agent');await f.c.open('one');assert.equal(f.get(),'Hello agent');
 await f.c.hold('Hello agent');f.set('');await tick();
 assert.equal(f.saved().text,'Hello agent','clearing the composer for the in-flight message does not clear the saved draft');
 await f.c.commit();assert.equal(f.saved().text,'');assert.equal(f.get(),'');
});
test('a pre-dispatch failure returns the text to the composer and keeps it saved',async()=>{
 const f=fixture();f.external('Not yet sent');await f.c.open('one');await f.c.hold('Not yet sent');f.set('');await tick();
 f.c.release();await tick();
 assert.equal(f.get(),'Not yet sent');assert.equal(f.saved().text,'Not yet sent');assert.match(f.c.state.message,/back in the composer/);
});
test('typing during the send is kept after the restored text and after a commit',async()=>{
 const f=fixture();f.external('First');await f.c.open('one');await f.c.hold('First');f.set('');f.set('Second');await tick();
 f.c.release();await tick();assert.equal(f.get(),'First\nSecond');assert.equal(f.saved().text,'First\nSecond');
 await f.c.hold('First\nSecond');f.set('');f.set('Third');await tick();await f.c.commit();await tick();
 assert.equal(f.saved().text,'Third');assert.equal(f.get(),'Third');
});
test('holding quietly declines an edited or stale send and refuses a second concurrent send',async()=>{
 const f=fixture();f.external('Draft');await f.c.open('one');
 assert.equal(await f.c.hold('Other text'),false);assert.equal(await f.c.hold('Draft',()=>false),false);assert.equal(f.c.holding,false);assert.equal(f.c.state.message,'');
 assert.equal(await f.c.hold('Draft'),true);await assert.rejects(f.c.hold('Draft'),/already being sent/);
 f.c.release();assert.equal(f.saved().text,'Draft');
});
test('a reopened binding for the same conversation never offers the in-flight text again',async()=>{
 const f=fixture();f.external('In flight');await f.c.open('one');await f.c.hold('In flight');f.set('');await tick();
 f.c.retire();await f.c.open('one');assert.equal(f.get(),'','the in-flight text is not restored as a fresh draft');
 await f.c.commit();assert.equal(f.saved().text,'');
 f.set('Next message');await tick();assert.equal(f.saved().text,'Next message','the reopened binding saves with the committed receipt');
});
test('a connection change before dispatch keeps the text saved with its conversation and returns it to an empty composer',async()=>{
 const f=fixture();f.external('Unsent words');await f.c.open('one');await f.c.hold('Unsent words');f.set('');await tick();
 f.c.retire();f.set('');f.c.release();
 assert.equal(f.get(),'Unsent words');assert.equal(f.saved().text,'Unsent words');assert.match(f.c.state.message,/back in the composer/);
});
test('typing as the reply arrives is queued after the commit, never racing it into a conflict',async()=>{
 const f=fixture();f.external('Sent text');await f.c.open('one');await f.c.hold('Sent text');f.set('');await tick();
 const committing=f.c.commit();f.set('Typed during commit');await committing;await tick();await tick();
 assert.equal(f.c.state.conflict,false);assert.equal(f.c.state.error,false);
 assert.equal(f.saved().text,'Typed during commit');assert.equal(f.get(),'Typed during commit');
});

function queuedRestoreFixture(savedText=null){
 let text='',saved=savedText===null?null:record(savedText),commitRestore;
 const store={async read(){return saved;},async save(expected,value){assert.deepEqual(expected,saved);return saved=record(value);}};
 const c=new AssistantDraftController(async()=>store,()=>text,(value,expected,current)=>new Promise(resolve=>{commitRestore=()=>{if((!current||current())&&(expected===undefined||text===expected))text=value;resolve();};}),()=>{});
 return {c,get:()=>text,saved:()=>saved,type:value=>{text=value;c.edit(value);},commit:()=>commitRestore()};
}
test('queued draft restore cannot clear newer unsent typing at UI commit',async()=>{
 const f=queuedRestoreFixture(),opening=f.c.open('one');await tick();f.type('Retained unsent draft');f.commit();await opening;await tick();
 assert.equal(f.get(),'Retained unsent draft');assert.equal(f.saved().text,'Retained unsent draft');
});
test('queued draft restore cannot overwrite a retired conversation binding',async()=>{
 const f=queuedRestoreFixture('Old conversation draft'),opening=f.c.open('old');await tick();f.c.retire();f.type('New conversation words');f.commit();await opening;
 assert.equal(f.get(),'New conversation words');
});
test('queued draft restore preserves both saved text and newer typing for review',async()=>{
 const f=queuedRestoreFixture('Previously saved draft'),opening=f.c.open('one');await tick();f.type('New unsent words');f.commit();await opening;await tick();
 assert.equal(f.get(),'New unsent words');assert.equal(f.saved().text,'Previously saved draft');assert.equal(f.c.state.conflict,true);assert.equal(f.c.state.savedText,'Previously saved draft');
});
