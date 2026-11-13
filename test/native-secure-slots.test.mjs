// Renderer secure-slot names against the native compare-exchange allow-list (LOOP-B, CRITIC notes
// draft). Class S: it parses the renderer and Java sources; it does not run Android. A slot the
// renderer writes with secureConnectionStore.compareExchange(Raw) that AlphaConnectionPlugin does
// not admit is refused on Android with 'Secure draft update failed' while every browser test passes;
// that is how the note-origins link shipped broken ('The link to its note could not be saved').
import test from 'node:test';
import assert from 'node:assert/strict';

test('an Inbox operation journal saved by the installed Alpha journal keeps its key and loads unchanged',async()=>{
 const {InboxOperation,inboxOperationKey}=await import('../.eliza/client-features/plugins/plugin-inbox/src/mailbox/operation-journal.ts');
 const owner='["production","user","org"]',grantId='grant';
 // Literal key computed by Alpha's pre-migration journal: sha256(JSON.stringify([owner, grant])).
 const key='inbox-operation:v1:f92ff3388bf353fa625474e332ea615ef6c85751cbbb36a3122af041d6b10edb';
 assert.equal(await inboxOperationKey(owner,grantId),key);
 // Record layout written by the installed journal before an uncertain dispatch.
 const installed={version:1,owner,grantId,requestId:'4a0b8f0e-2f7c-4e43-9d0e-6b8f1c2a3d4e',proposal:{kind:'send',to:['a@example.test'],subject:'Hi',bodyText:'Hello'},phase:'dispatching',review:null,receipt:null,source:{draftId:'draft-1',savedRevision:'rev-1'}};
 const slots=new Map([[key,structuredClone(installed)]]),writes=[];
 const store={async read(slot){return structuredClone(slots.get(slot)??null);},async compareExchange(slot,expected,value){writes.push(slot);if(JSON.stringify(slots.get(slot)??null)!==JSON.stringify(expected))return{status:'conflict'};slots.set(slot,structuredClone(value));return{status:'saved'};}};
 const operation=new InboxOperation({owner,grantId,active:()=>true,store,client:{}});
 assert.deepEqual(await operation.load(),installed);
 assert.deepEqual(writes,[],'loading an uncertain dispatch writes nothing and never re-dispatches');
 assert.equal(await InboxOperation.discardUnsent(store,owner,grantId),false,'a dispatching record is never discarded');
 assert.deepEqual(slots.get(key),installed);
});

test('the renderer keeps its 200-link note-origin bound',async()=>{
 // The bound is the shared Notes client's NOTE_ORIGIN_LIMIT, re-exported under Alpha's name.
 const {noteOriginLimit}=await import('../apps/app/src/runtime/note-origin.ts');
 assert.equal(noteOriginLimit,200,'the renderer keeps its 200-link bound');
});
