import test from 'node:test';import assert from 'node:assert/strict';const m=await import('../apps/app/src/prototype/context-selection.ts');
const {sanitizePhoneContext}=await import('../apps/app/src/runtime/phone-context.ts');
// Android reports a folder revision that embeds its display name, size and time.
const androidRevision=(name,modified=1)=>`${name}|vnd.android.document/directory|-1|${modified}|8`;
const entry=(id,name,extra={})=>({id,parentId:'tree-root',name,mimeType:'text/plain',directory:false,size:3,revision:`${name}|text/plain|3|1|0`,...extra});
const listing=(entries,extra={})=>({status:'ready',message:'',folder:{id:'tree-root',name:'PRIVATE_FOLDER_NAME',revision:androidRevision('PRIVATE_FOLDER_NAME'),directory:true},entries,...extra});
const label=(mime,directory)=>directory?'Folder':mime==='text/plain'?'Text':'File';

test('a folder identity is its opaque tree id and a local counter, never the provider revision or a name',()=>{
 const revisions=m.createFolderRevisions();
 const first=revisions(m.folderScope(listing([entry('e1','PRIVATE_FILE_NAME.txt')])));
 assert.deepEqual(Object.keys(first).sort(),['id','kind','revision']);assert.equal(first.kind,'folder');assert.equal(first.id,'tree-root');
 assert.match(first.revision,/^listing-[0-9a-f]{12}-1$/);
 // Another app session never repeats a revision for the same folder id, whatever it lists.
 const later=m.createFolderRevisions()(m.folderScope(listing([entry('e9','other.txt')])));
 assert.equal(later.id,first.id);assert.notEqual(later.revision,first.revision);
 assert.doesNotMatch(JSON.stringify(first),/PRIVATE|\|/);
 // The wire contract accepts it for Files and nowhere else.
 assert.deepEqual(sanitizePhoneContext({view:'files',revision:1,sensitive:false,selectedObject:first}).selectedObject,first);
 assert.throws(()=>sanitizePhoneContext({view:'notes',revision:1,sensitive:false,selectedObject:first}));
 // The provider's own revision string would be refused, so it must never be used as the identity.
 assert.throws(()=>sanitizePhoneContext({view:'files',revision:1,sensitive:false,selectedObject:{kind:'folder',id:'tree-root',revision:androidRevision('PRIVATE_FOLDER_NAME')}}));
});
test('the folder revision is stable for an unchanged listing and changes with the folder or any loaded entry',()=>{
 const revisions=m.createFolderRevisions();
 const base=[entry('e1','a.txt'),entry('e2','b.txt')];
 const one=revisions(m.folderScope(listing(base))).revision;
 assert.equal(revisions(m.folderScope(listing([...base].reverse()))).revision,one,'order alone is not a change');
 const renamed=revisions(m.folderScope(listing([entry('e1','a.txt'),entry('e2','renamed.txt')]))).revision;
 assert.notEqual(renamed,one);
 const removed=revisions(m.folderScope(listing([entry('e1','a.txt')]))).revision;
 assert.notEqual(removed,renamed);
 const folderChanged=revisions(m.folderScope({...listing([entry('e1','a.txt')]),folder:{id:'tree-root',name:'PRIVATE_FOLDER_NAME',revision:androidRevision('PRIVATE_FOLDER_NAME',2)}})).revision;
 assert.notEqual(folderChanged,removed);
 // A different folder never reuses another folder's identity.
 const other=revisions(m.folderScope({...listing(base),folder:{id:'tree-other',name:'Other',revision:'x'}}));
 assert.equal(other.id,'tree-other');assert.notEqual(other.revision,one);
 assert.equal(revisions(undefined),undefined);
 // Remembered listings are bounded. A folder that was forgotten gets a new revision, never an old one.
 const issued=new Set([one,renamed,removed,folderChanged,other.revision]);
 for(let index=0;index<80;index++){const next=revisions(m.folderScope({...listing(base),folder:{id:'tree-many-'+index,name:'n',revision:'x'}})).revision;assert.ok(!issued.has(next));issued.add(next);}
 assert.ok(!issued.has(revisions(m.folderScope({...listing([entry('e1','a.txt')]),folder:{id:'tree-root',name:'PRIVATE_FOLDER_NAME',revision:androidRevision('PRIVATE_FOLDER_NAME',2)}})).revision));
 for(const bad of [undefined,{},{folder:{id:'/storage/emulated/0/Private',revision:'1'}},{folder:{id:'tree-root'}},{folder:{id:'tree-root',revision:'1'},entries:[{id:'e1'}]}])assert.equal(m.folderScope(bad),undefined);
});
test('a reviewed folder is current only when a fresh read matches it exactly',()=>{
 const reviewed=m.folderScope(listing([entry('e1','a.txt'),entry('e2','b.txt')]));
 assert.equal(m.folderScopeCurrent(reviewed,listing([entry('e2','b.txt'),entry('e1','a.txt')])),true);
 // Deleted, added, replaced-in-place and renamed entries, a changed folder and lost access all fail.
 assert.equal(m.folderScopeCurrent(reviewed,listing([entry('e1','a.txt')])),false,'deleted entry');
 assert.equal(m.folderScopeCurrent(reviewed,listing([entry('e1','a.txt'),entry('e2','b.txt'),entry('e3','c.txt')])),false,'added entry');
 assert.equal(m.folderScopeCurrent(reviewed,listing([entry('e1','a.txt'),entry('e9','b.txt')])),false,'neighbor with the same name');
 assert.equal(m.folderScopeCurrent(reviewed,listing([entry('e1','a.txt'),entry('e2','b.txt',{revision:'b.txt|text/plain|4|2|0'})])),false,'edited entry');
 assert.equal(m.folderScopeCurrent(reviewed,{...listing([entry('e1','a.txt'),entry('e2','b.txt')]),folder:{id:'tree-other',name:'x',revision:androidRevision('PRIVATE_FOLDER_NAME')}}),false,'another folder');
 for(const status of ['revoked','unavailable','unsupported'])assert.equal(m.folderScopeCurrent(reviewed,{status,message:'Folder access ended.'}),false,status);
 // Several loaded pages (Android lists 250 at a time): the fresh read is the first page. It must
 // be exactly the first entries that were loaded, and the reported total must be unchanged.
 const many=Array.from({length:300},(_,index)=>entry('p'+index,'f'+index+'.txt'));
 const paged=m.folderScope(listing(many,{total:300}));
 const firstPage=many.slice(0,250);
 assert.equal(m.folderScopeCurrent(paged,listing(firstPage,{total:300,cursor:'next'})),true);
 assert.equal(m.folderScopeCurrent(paged,listing(firstPage,{total:301,cursor:'next'})),false,'entry added beyond the loaded pages');
 assert.equal(m.folderScopeCurrent(paged,listing([...firstPage.slice(0,249),entry('p900','z.txt')],{total:300,cursor:'next'})),false,'unknown entry');
 // An entry named in the excerpt was deleted and another added elsewhere: the total is the same and
 // every fresh entry was loaded before, but the first page is no longer the reviewed first page.
 assert.equal(m.folderScopeCurrent(paged,listing(many.slice(1,251),{total:300,cursor:'next'})),false,'deleted entry replaced by a later one');
 // A fresh page too short to cover what the excerpt names proves nothing.
 assert.equal(m.folderScopeCurrent(paged,listing(many.slice(0,100),{total:300,cursor:'next'})),false,'short page');
 assert.equal(m.folderScopeCurrent(paged,listing(firstPage,{total:300})),false,'the later pages are gone');
 assert.equal(m.folderScopeCurrent(m.folderScope(listing(firstPage,{total:300,cursor:'next'})),listing(firstPage,{total:300,cursor:'next'})),true,'one loaded page');
 assert.equal(m.folderScopeCurrent(m.folderScope(listing([entry('e1','a.txt'),entry('e1','a.txt')])),listing([entry('e1','a.txt'),entry('e1','a.txt')])),false,'duplicate identities are not a listing');
});
test('the folder excerpt lists only the loaded entries of that one folder and says what is left out',()=>{
 const scope=m.folderScope(listing([entry('e1','a.txt'),entry('d1','Sub',{directory:true,mimeType:'vnd.android.document/directory'})],{cursor:'next',total:40}));
 const text=m.folderExcerpt(scope,label);
 assert.deepEqual(text.split('\n'),['Folder: PRIVATE_FOLDER_NAME','2 entries listed by name and type. File contents and subfolder contents are not included.','- a.txt (Text)','- Sub (Folder)','More… (40 total)']);
 assert.match(m.folderExcerpt(m.folderScope(listing([])),label),/^Empty$/m);
 const many=m.folderScope(listing(Array.from({length:m.FOLDER_EXCERPT_LIMIT+3},(_,i)=>entry('e'+i,'f'+i+'.txt'))));
 const lines=m.folderExcerpt(many,label).split('\n');
 assert.equal(lines.filter(line=>line.startsWith('- ')).length,m.FOLDER_EXCERPT_LIMIT);assert.equal(lines.at(-1),'3 more loaded entries are not listed here.');
});
test('only an unredacted own notification is reviewable, and only while that exact revision is listed',()=>{
 const own={id:'reminder-1',revision:'occ-1',source:'own',appLabel:'Alpha Phone',title:'Call the clinic',text:'Before noon'};
 assert.equal(m.noticeReviewable(own),true);
 assert.equal(m.noticeExcerpt(own),'Call the clinic\nBefore noon');
 assert.equal(m.noticeReviewable({...own,source:'external'}),false,'another app');
 assert.equal(m.noticeReviewable({...own,source:'hosted'}),false,'hosted result');
 assert.equal(m.noticeReviewable({...own,title:'Alpha Phone',text:''}),false,'redacted while locked');
 assert.equal(m.noticeReviewable({...own,title:'',text:''}),false,'nothing shown');
 // Android withholds content with fixed wording instead of an empty row. That wording is not content.
 for(const text of m.HIDDEN_NOTICE_TEXTS){
  assert.equal(m.noticeReviewable({...own,title:m.HIDDEN_NOTICE_TITLE,text}),false,text);
  assert.equal(m.noticeHidden({...own,title:m.HIDDEN_NOTICE_TITLE,text}),true);
 }
 assert.equal(m.noticeReviewable({...own,title:m.HIDDEN_NOTICE_TITLE,text:''}),false);
 assert.equal(m.noticeReviewable({...own,text:'Unlock to view'}),true,'an ordinary reminder may say this');
 assert.equal(m.noticeReviewable({...own,text:''}),true,'a title-only reminder');
 assert.equal(m.noticeReviewable({...own,id:'has space'}),false);
 const reviewed={id:own.id,revision:own.revision,source:'own'};
 assert.equal(m.noticeCurrent(reviewed,[own,{...own,id:'reminder-2'}]),true);
 assert.equal(m.noticeCurrent(reviewed,[{...own,id:'reminder-2'}]),false,'dismissed: the neighbor never stands in');
 assert.equal(m.noticeCurrent(reviewed,[{...own,revision:'occ-2'}]),false,'updated');
 assert.equal(m.noticeCurrent(reviewed,[{...own,source:'external'}]),false,'same id from another source');
 assert.equal(m.noticeCurrent(reviewed,[own,{...own,revision:'occ-2'}]),false,'ambiguous');
 assert.equal(m.noticeCurrent(reviewed,undefined),false);
});
test('a capture question carries the exact open item; a library search is never a capture',()=>{
 assert.deepEqual(m.captureQuestion('camera','ask','ask',{}),{kind:'frame'});
 assert.deepEqual(m.captureQuestion('photos','ask','v.ask',{open:'native-photo-42'}),{kind:'item',id:'native-photo-42'});
 assert.deepEqual(m.captureQuestion('photos','ask','v.ask',{open:null}),{kind:'none'});
 assert.deepEqual(m.captureQuestion('photos','ask','groups.0.items.1.ask',{open:'native-photo-42'}),{kind:'none'});
 for(const key of ['askQ','askSearch'])for(const module of ['camera','photos'])assert.deepEqual(m.captureQuestion(module,key,key,{open:'native-photo-42',q:'beach'}),{kind:'search'});
 assert.equal(m.captureQuestion('files','ask','pv.ask',{open:'x'}),undefined);
 assert.equal(m.captureQuestion('photos','share','v.share',{open:'x'}),undefined);
});
test('a saved capture identity is its id and a local counter, never the library revision',()=>{
 const captures=m.createCaptureRevisions();
 // Android's library revision is DATE_ADDED:SIZE, with "|generation" appended after a favorite,
 // trash or restore (the shared OwnedMediaLibrary.metadata Alpha's Photos plugin uses). Neither the
 // time nor the size is an identity, and the wire contract refuses '|', which would fail every
 // message sent while that item is open.
 const plain={kind:'image',id:'native-camera-42',revision:'1760000000:52344',mutationRevision:'1760000000:52344:916:0'};
 const flagged={...plain,revision:'1760000000:52344|917',mutationRevision:'1760000000:52344:917:0'};
 assert.throws(()=>sanitizePhoneContext({view:'photos',revision:1,sensitive:false,selectedObject:{kind:'photo',id:flagged.id,revision:flagged.revision}}));
 const first=captures(plain);
 assert.deepEqual(Object.keys(first).sort(),['id','kind','revision']);assert.equal(first.kind,'photo');assert.equal(first.id,'native-camera-42');
 assert.match(first.revision,/^capture-[0-9a-f]{12}-1$/);
 assert.doesNotMatch(JSON.stringify(first),/1760000000|52344|\|/,'no added time, size or provider separator');
 assert.deepEqual(captures({...plain}),first,'an unchanged item keeps its identity');
 // A favorite, trash, restore or edit changes the library revision, so the identity changes too.
 const second=captures(flagged);
 assert.equal(second.id,first.id);assert.equal(second.revision,first.revision.replace(/-1$/,'-2'));assert.doesNotMatch(JSON.stringify(second),/1760000000:52344|\|917/);
 assert.deepEqual(sanitizePhoneContext({view:'photos',revision:1,sensitive:false,selectedObject:second}).selectedObject,second);
 // The browser library keeps one revision per item and changes only its mutation revision.
 const browser={kind:'video',id:'native-camera-3f0c',revision:'9d2e',mutationRevision:'m1'};
 const video=captures(browser);assert.equal(video.kind,'video');
 assert.notEqual(captures({...browser,mutationRevision:'m2'}).revision,video.revision,'a changed item');
 // Going back to an earlier library revision is still a new identity, never a reused one.
 assert.ok(![first.revision,second.revision].includes(captures(plain).revision));
 // Two items never share a revision, and another app session never repeats one.
 assert.notEqual(captures({...plain,id:'native-camera-43'}).revision,captures(plain).revision);
 assert.notEqual(m.createCaptureRevisions()(plain).revision,first.revision);
 // Remembered items are bounded; a forgotten item gets a new revision, never an old one.
 const issued=new Set();for(let index=0;index<300;index++){const next=captures({...plain,id:'native-camera-many-'+index}).revision;assert.ok(!issued.has(next));issued.add(next);}
 assert.ok(!issued.has(captures({...plain,id:'native-camera-many-0'}).revision));
 // Anything without an opaque id or a library revision has no identity.
 for(const bad of [undefined,{},{id:'native-camera-1'},{id:'native-camera-1',revision:''},{id:'/storage/DCIM/1.jpg',revision:'1'},{id:'has space',revision:'1'},{id:'native-camera-1',revision:7}])assert.equal(captures(bad),null);
});
test('location tiles ask the picker for a list of valid document types',()=>{
 const valid=/^[a-z]+\/([a-z0-9][a-z0-9.+-]{0,126}|\*)$/;
 for(const [name,expected] of [['Pictures',['image/*']],['Recordings',['audio/*']],['Movies',['video/*']],['Documents',['application/pdf','text/*','application/*']]]){
  const types=m.locationMimeTypes(name);assert.deepEqual(types,expected);
  // DailyAppsPlugin.mimeTypes refuses anything that is not an array of single types.
  assert.ok(Array.isArray(types)&&types.length<=12&&types.every(type=>valid.test(type)&&!type.includes(',')));
 }
 assert.equal(m.locationMimeTypes('Downloads'),undefined);
});
test('a Settings page identity is its section slug; credential pages have none',()=>{
 assert.deepEqual(m.settingsSelection({page:'privacy'}),{kind:'settings',id:'privacy'});
 assert.deepEqual(m.settingsSelection({page:null,settingsCategory:'settings-apps'}),{kind:'settings',id:'settings-apps'});
 assert.deepEqual(m.settingsSelection({page:'display',settingsCategory:'settings-general'}),{kind:'settings',id:'display'});
 assert.equal(m.settingsSelection({page:null,settingsCategory:'passwords'}),undefined);
 assert.equal(m.settingsSelection({page:null,settingsCategory:'display'}),undefined);
 assert.equal(m.settingsSelection({page:'password-entry',settingsCategory:'settings-apps'}),undefined);
 assert.deepEqual(sanitizePhoneContext({view:'settings',revision:2,sensitive:false,selectedObject:m.settingsSelection({page:'display'})}).selectedObject,{kind:'settings',id:'display'});
 for(const page of ['passwords','vault','unlock','api-keys','Privacy','a b',null,undefined,7])assert.equal(m.settingsSelection({page}),undefined,String(page));
 assert.equal(m.settingsSelection(undefined),undefined);
});

test('a photo another app rewrote in place is refused at send time',()=>{
 // Android rows: revision and mutationRevision keep the shared editor's format (added time and size,
 // plus generation and trash on API 30+); contentRevision adds the modified time and generation.
 const reviewed={id:'native-camera-7',revision:'1700000000:2048',mutationRevision:'1700000000:2048:12:0',contentRevision:'1700000100:2048:12',trashed:false};
 assert.equal(m.captureUnchanged(reviewed,{...reviewed}),true,'the same row is unchanged');
 // Same added time and size (an in-place rewrite on API 29 keeps both); only the content revision moves.
 assert.equal(m.captureUnchanged(reviewed,{...reviewed,contentRevision:'1700000500:2048:12'}),false,'modified time changed');
 assert.equal(m.captureUnchanged(reviewed,{...reviewed,mutationRevision:'1700000000:4096:13:0',contentRevision:'1700000500:4096:13'}),false,'size and generation changed');
 assert.equal(m.captureUnchanged(reviewed,{...reviewed,contentRevision:undefined}),false,'a row that lost its content revision is not the reviewed item');
 assert.equal(m.captureUnchanged(reviewed,{...reviewed,trashed:true}),false,'trashed');
 assert.equal(m.captureUnchanged(reviewed,undefined),false,'removed');
 // The browser build has no content revision; its rows compare as before.
 const browser={id:'b1',revision:'r1',mutationRevision:'m1'};
 assert.equal(m.captureUnchanged(browser,{...browser}),true);assert.equal(m.captureUnchanged(browser,{...browser,mutationRevision:'m2'}),false);
 // The shared identity moves with the content revision, so the old identity is never reused for the rewritten file.
 const revisions=m.createCaptureRevisions(),before=revisions({kind:'image',...reviewed}),after=revisions({kind:'image',...reviewed,contentRevision:'1700000500:2048:12'});
 assert.equal(before.id,after.id);assert.notEqual(before.revision,after.revision);
});
