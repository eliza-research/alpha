import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
// Alpha's composer contract, run against the shared controller exactly as the pin projects it
// (apps/app/src/prototype/assistant-draft-controller.ts only re-exports it under Alpha's name).
const code=stripTypeScriptTypes(readFileSync(new URL('../.eliza/client-features/packages/ui/src/state/durable-draft-controller.ts',import.meta.url),'utf8'),{mode:'transform'});
const {DurableDraftController:AssistantDraftController}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('Alpha binds its draft controller name to the shared implementation',()=>{
 assert.match(readFileSync(new URL('../apps/app/src/prototype/assistant-draft-controller.ts',import.meta.url),'utf8'),/export \{DurableDraftController as AssistantDraftController\} from '\.\.\/\.\.\/\.\.\/\.\.\/\.eliza\/client-features\/packages\/ui\/src\/state\/durable-draft-controller\.ts';/);
});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const record=(text,revision='1')=>({version:1,binding:'test',revision,text});
function fixture(messages){let text='',saved=null;const store={async read(){return saved;},async save(expected,value){assert.deepEqual(expected,saved);return saved=record(value,String(Number(saved?.revision||0)+1));}};const c=new AssistantDraftController(async()=>store,()=>text,value=>{text=value;},()=>{},messages);return {c,store,set:value=>{text=value;c.edit(value);},get:()=>text,saved:()=>saved,external:value=>{saved=record(value,'external');}};}
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
test('persistent read failure remains actionable and cannot send or overwrite a draft',async()=>{
 const f=fixture();f.store.read=async()=>{throw Error('Unavailable');};f.set('Unsent words');await f.c.open('one');
 assert.equal(f.get(),'Unsent words');assert.equal(f.saved(),null);assert.equal(f.c.state.error,true);
 await assert.rejects(f.c.hold('Unsent words'),/Review local draft storage/);
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
// Owner, 2026-11-03: Alpha's composer is built with {notSent:''}. A refused send's text comes back
// with no line under the composer; the shared default above stays for other hosts.
const alphaComposer=(()=>{const adapter=readFileSync(new URL('../apps/app/src/prototype/agent-adapter.ts',import.meta.url),'utf8'),start=adapter.indexOf('this.composerDraft=new AssistantDraftController(');return adapter.slice(start,adapter.indexOf('\n',start));})();
test('Alpha\'s composer puts a refused send back with no line under it, and the next Send dispatches it once',async()=>{
 assert.match(alphaComposer,/,\(\)=>\{if\(this\.live\)this\.setState\(\{\}\);\},\{notSent:''\}\);$/);
 const f=fixture({notSent:''});f.external('Refused while offline');await f.c.open('one');await f.c.hold('Refused while offline');f.set('');await tick();
 f.c.release();await tick();
 assert.equal(f.get(),'Refused while offline');assert.equal(f.saved().text,'Refused while offline');assert.notEqual(f.saved().sending,true);
 assert.equal(f.c.state.message,'');assert.equal(f.c.holding,false,'nothing is left waiting to send by itself');
 await f.c.hold('Refused while offline');f.set('');await tick();await f.c.commit();
 assert.equal(f.saved().text,'');assert.equal(f.c.state.message,'');
});
test('Alpha\'s composer keeps every other draft status',async()=>{
 const f=fixture({notSent:''});f.external('Unsent words');await f.c.open('one');await f.c.hold('Unsent words');f.set('');await tick();
 f.c.retire();f.set('');f.c.release();await tick();
 assert.match(f.c.state.message,/kept as a draft in its own conversation/);
 const g=fixture({notSent:''});g.store.read=async()=>{throw Error('Unavailable');};g.set('Unsent words');await g.c.open('one');
 assert.match(g.c.state.message,/could not be read/);
});
test('typing during the send is kept after the restored text and after a commit',async()=>{
 const f=fixture();f.external('First');await f.c.open('one');await f.c.hold('First');f.set('');f.set('Second');await tick();
 f.c.release();await tick();assert.equal(f.get(),'First\nSecond');assert.equal(f.saved().text,'First\nSecond');
 await f.c.hold('First\nSecond');f.set('');f.set('Third');await tick();await f.c.commit();await tick();
 assert.equal(f.saved().text,'Third');assert.equal(f.get(),'Third');
});
test('holding refuses a changed draft and a second concurrent send',async()=>{
 const f=fixture();f.external('Draft');await f.c.open('one');
 await assert.rejects(f.c.hold('Other text'),/draft changed/);await assert.rejects(f.c.hold('Draft',()=>false),/draft changed/);
 await f.c.hold('Draft');await assert.rejects(f.c.hold('Draft'),/Review local draft storage/);
 f.c.release();assert.equal(f.saved().text,'Draft');
});
test('a reopened binding for the same conversation never offers the in-flight text again',async()=>{
 const f=fixture();f.external('In flight');await f.c.open('one');await f.c.hold('In flight');f.set('');await tick();
 f.c.retire();await f.c.open('one');assert.equal(f.get(),'','the in-flight text is not restored as a fresh draft');
 await f.c.commit();assert.equal(f.saved().text,'');
 f.set('Next message');await tick();assert.equal(f.saved().text,'Next message','the reopened binding saves with the committed receipt');
});
// A binding is an owner, agent and conversation identity: once the composer has moved to another
// binding (or none), the unsent text stays saved, unmarked, with its own conversation and is never
// put in this composer, where the next binding would adopt it. Reopening its binding restores it.
test('a connection change before dispatch keeps the text saved with its own conversation, never in the next binding',async()=>{
 const f=fixture();f.external('Unsent words');await f.c.open('one');await f.c.hold('Unsent words');f.set('');await tick();
 f.c.retire();f.set('');f.c.release();await tick();
 assert.equal(f.get(),'');assert.equal(f.saved().text,'Unsent words');assert.notEqual(f.saved().sending,true);
 assert.match(f.c.state.message,/kept as a draft in its own conversation/);
 await f.c.open('one');assert.equal(f.get(),'Unsent words');
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

test('hold binds exact authored whitespace and preserves it through a failed dispatch',async()=>{
 const f=fixture(),authored='  Indented.\n\nTrailing.  \n';f.external(authored);await f.c.open('one');
 await assert.rejects(f.c.hold(authored.trim()),/draft changed/);
 await f.c.hold(authored);f.set('');await tick();f.c.release();await tick();
 assert.equal(f.get(),authored);assert.equal(f.saved().text,authored);
});
// The device slot keeps a message's saved copy marked as sending until its dispatch settles, so a
// restart (or another window) never offers it again as a draft; the owner reviews it instead.
const rowsCode=stripTypeScriptTypes(readFileSync(new URL('../.eliza/client-features/packages/ui/src/state/durable-draft.ts',import.meta.url),'utf8'),{mode:'transform'});
const {compareExchangeDraftStore}=await import('data:text/javascript;base64,'+Buffer.from(rowsCode).toString('base64'));
test('a restart during a send offers the message for review and never restores it as a draft',async()=>{
 let raw=null;const slot={async read(){return raw;},async compareExchange(expected,value){if(raw!==expected)return {status:'conflict'};raw=value;return {status:'saved'};}};
 const run=()=>{let text='';const c=new AssistantDraftController(async binding=>compareExchangeDraftStore(binding,slot),()=>text,value=>{text=value;},()=>{});return {c,get:()=>text,set:value=>{text=value;c.edit(value);}};};
 const first=run(),key=JSON.stringify(['origin','owner','agent','conversation']);
 await first.c.open(key);first.set('Sent before the app stopped');
 await first.c.hold('Sent before the app stopped');first.set('');
 assert.deepEqual(JSON.parse(raw),{version:1,binding:key,revision:JSON.parse(raw).revision,text:'Sent before the app stopped',sending:true});
 const next=run();await next.c.open(key);
 assert.equal(next.get(),'');assert.equal(next.c.state.unsettled,true);assert.equal(next.c.state.savedText,'Sent before the app stopped');
 await assert.rejects(next.c.hold(''),/may already have been sent/);
 next.c.keepCurrent();await tick();
 assert.deepEqual(Object.keys(JSON.parse(raw)).sort(),['binding','revision','text','version']);assert.equal(JSON.parse(raw).text,'');
 // The previous run's commit, if it ever came, finds a newer copy and clears nothing else.
 await first.c.commit();assert.equal(JSON.parse(raw).text,'');
});
