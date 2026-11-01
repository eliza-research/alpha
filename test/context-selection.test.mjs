import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const m=await import('../apps/app/src/prototype/context-selection.ts');
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
 assert.deepEqual(text.split('\n'),['Folder: PRIVATE_FOLDER_NAME','2 entries listed by name and type. File contents and subfolder contents are not included.','- a.txt (Text)','- Sub (Folder)','The folder has more entries that are not loaded (40 in total).']);
 assert.match(m.folderExcerpt(m.folderScope(listing([])),label),/This folder is empty\./);
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
 // The shared host plugin (vendor/eliza) builds the hidden title from Alpha's appLabel().
 const host=readFileSync('vendor/eliza/plugins/plugin-native-notifications/android/src/capacitor/java/ai/eliza/plugins/notifications/NotificationsHostPlugin.java','utf8');
 const java=readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaNotificationsPlugin.java','utf8');
 const label=/protected String appLabel\(\)\{return "([^"]+)";\}/.exec(java)?.[1];
 assert.equal(`${label} notification`,m.HIDDEN_NOTICE_TITLE,'Android hidden title');
 assert.ok(host.includes('item.put("title",hidden?label+" notification":'),'Android hidden title');
 assert.ok(host.includes(`item.put("text",hidden?(locked?"${m.HIDDEN_NOTICE_TEXTS[0]}":"${m.HIDDEN_NOTICE_TEXTS[1]}"):`),'Android hidden text');
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
 // AlphaPhotos registers the shared PhotosPlugin with Alpha's media names; the shared bridge builds the library.
 const java=readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaPhotosPlugin.java','utf8');
 assert.match(java,/public class AlphaPhotosPlugin extends PhotosPlugin \{/);
 assert.match(java,/@Override protected OwnedMediaConfig mediaConfig\(\)\{return MEDIA_CONFIG;\}/);
 const bridge=readFileSync(new URL('../vendor/eliza/plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media/PhotosPlugin.java',import.meta.url),'utf8');
 assert.match(bridge,/owned = new OwnedMediaLibrary\(getContext\(\), config, playback::revoke\);/);
 const library=readFileSync(new URL('../vendor/eliza/plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media/OwnedMediaLibrary.java',import.meta.url),'utf8').replace(/\s+/g,' ');
 assert.match(library,/String base = row\.getLong\(3\) \+ ":" \+ row\.getLong\(4\);/,'Android revision base');
 assert.match(library,/"revision", base \+ \(Build\.VERSION\.SDK_INT >= 30 && marker\.startsWith\(base \+ "\|"\) \? "\|" \+ row\.getLong\(9\) : ""\)\);/,'Android revision format');
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
 const adapter=readFileSync('apps/app/src/prototype/camera-adapter.ts','utf8');
 assert.match(adapter,/const captureSelection=createCaptureRevisions\(\);/);
 assert.equal((adapter.match(/nativePhotoSelection: ?captureSelection\(/g)||[]).length,2);
 assert.doesNotMatch(adapter,/nativePhotoSelection: ?\{/,'every published photo identity goes through the local mapping');
});
test('the native adapter passes an item identity, not a generic wrapper, to the capture question',()=>{
 const source=readFileSync('apps/app/src/prototype/native-adapter.ts','utf8');
 assert.match(source,/askAboutCapture\(\{ id: capture\.id \}\)/);
 assert.match(source,/askAboutCapture\(\)/);
 assert.doesNotMatch(source,/askAboutCapture[^;]*\{ module, key, row/);
 // A failed question is reported, not silently dropped.
 assert.match(source,/Nothing has been sent\./);
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
 // The native list and read report contentRevision from MediaStore DATE_MODIFIED, size and generation.
 const photos=readFileSync(new URL('../vendor/eliza/plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media/OwnedMediaLibrary.java',import.meta.url),'utf8').replace(/\s+/g,' ');
 assert.match(photos,/item\.put\("contentRevision", contentRevision\(row\)\);/);
 assert.match(photos,/private static String contentRevision\(Cursor row\) \{ return row\.getLong\(row\.getColumnIndexOrThrow\(MediaStore\.MediaColumns\.DATE_MODIFIED\)\) \+ ":" \+ row\.getLong\(4\) \+ \(Build\.VERSION\.SDK_INT >= 30 \? ":" \+ row\.getLong\(9\) : ""\); \}/);
 assert.match(photos,/result\[result\.length - 1\] = MediaStore\.MediaColumns\.DATE_MODIFIED;/);
 const camera=readFileSync('apps/app/src/prototype/camera-adapter.ts','utf8');
 assert.match(camera,/const unchanged=\(row:SavedPhoto\)=>captureUnchanged\(selected,row\);/,'the send-time re-read uses the content check');
});
test('hosted-result, digest and workflow notices are never reviewable; reminder and navigation rows are',()=>{
 const own={source:'own',id:'n1',revision:'r1',title:'Digest ready',text:'Mail from Dana'};
 for(const kind of ['hosted-result','workflow','other','digest',''])assert.equal(m.noticeReviewable({...own,kind}),false,kind);
 assert.equal(m.noticeReviewable({...own,kind:'reminder'}),true);assert.equal(m.noticeReviewable({...own,kind:'navigation'}),true);
 // Browser rows carry no kind: workflow notices and Focus-held messages are refused by id, reminders and calendar alerts kept.
 assert.equal(m.noticeReviewable({...own,id:'workflow:run-1'}),false);assert.equal(m.noticeReviewable({...own,id:'focus:key'}),false);
 assert.equal(m.noticeReviewable({...own,id:'calendar:alert-1'}),true);assert.equal(m.noticeReviewable({...own}),true);
 assert.equal(m.noticeKind({id:'calendar:x'}),'calendar');assert.equal(m.noticeKind({id:'x',kind:'hosted-result'}),'hosted-result');
 // The native list returns a kind for every own row, from the posting channel.
 const host=readFileSync('vendor/eliza/plugins/plugin-native-notifications/android/src/capacitor/java/ai/eliza/plugins/notifications/NotificationsHostPlugin.java','utf8');
 assert.match(host,/item\.put\("source","own"\);item\.put\("kind",noticeKind\(n\.getChannelId\(\)\)\);/);
 const plugin=readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaNotificationsPlugin.java','utf8');
 assert.match(plugin,/@Override protected String noticeKind\(String channel\)\{return kind\(channel\);\}/);
 const kinds=plugin.slice(plugin.indexOf('static String kind('),plugin.lastIndexOf('\n}'));
 assert.match(kinds,/AlphaHostedResultsPlugin\.CHANNEL\.equals\(channel\)\)return "hosted-result";/);
 assert.match(kinds,/WorkflowNoticePoster\.CHANNEL\.equals\(channel\)\|\|WorkflowNoticePoster\.APPROVAL_CHANNEL\.equals\(channel\)\)return "workflow";/);
 assert.match(kinds,/return "other";\n \}/,'an unknown channel is not reviewable');
 for(const kind of [...kinds.matchAll(/return "([a-z-]+)"/g)].map(match=>match[1]))
  assert.equal(m.ASKABLE_NOTICE_KINDS.includes(kind),['reminder','navigation'].includes(kind),`native kind ${kind}`);
});
test('a mail context switched, deleted or changed during its review cannot send a neighbouring message',async()=>{
 const mail=await import('../apps/app/src/runtime/reviewed-mail-context.ts');
 const source={accountId:'grant',messageId:'first',revision:'h-1',from:'Sender',to:['reader@example.invalid'],subject:'Reviewed',bodyText:'REVIEWED_BODY'};
 const destination={ownerId:'owner',agentId:'agent-1',sessionId:'session',origin:'https://agent.example.invalid'};
 const review=await mail.reviewMailContext(source,destination);
 assert.match(await mail.validateMailContext(review,structuredClone(source),structuredClone(destination)),/REVIEWED_BODY/);
 const refused=(current,dest=destination)=>assert.rejects(mail.validateMailContext(review,current,dest),/Message or destination changed/);
 // Switched to the neighbour in the same thread, or the same id at a new revision or with other text.
 await refused({...source,messageId:'neighbor',revision:'h-neighbor',bodyText:'NEIGHBOR_BODY_CANARY'});
 await refused({...source,revision:'h-2'});
 await refused({...source,bodyText:'REVIEWED_BODY edited'});
 await refused({...source,accountId:'other-grant'});
 await refused(source,{...destination,sessionId:'other-session'});
 // The adapter reads the open message at send time; a deleted message is no source at all.
 const adapter=readFileSync('apps/app/src/prototype/inbox-cloud-adapter.ts','utf8');
 assert.match(adapter,/function mailContext\(\):MailContextSource \{if\(!body\|\|!selected\|\|!body\.historyId\)throw new Error\('Refresh this message before sharing'\);/);
 assert.match(adapter,/const text=await validateMailContext\(review,mailContext\(\),destination\);/);
 assert.match(adapter,/if \(body\?\.message\.id === id\) \{ body = null;/,'an archived or trashed open message is cleared');
});


test('calendar source discovery coalesces per owner, retries failures and fences old sources',async()=>{
 const {stripTypeScriptTypes}=await import('node:module');const vm=await import('node:vm');
 const core=readFileSync(new URL('../vendor/eliza/packages/core/src/runtime/single-flight-memo.ts',import.meta.url),'utf8').replace(/^export /gm,'');
 const SingleFlightMemo=vm.runInNewContext(stripTypeScriptTypes(core,{mode:'transform'})+';SingleFlightMemo');
 const ui=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
 const source=ui.slice(ui.indexOf('type CalendarAgendaSourceObservation='),ui.indexOf('async function deviceCapabilities'));
 const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
 const window=new EventTarget();let calls=0;const queue=[];
 const contract=readFileSync(new URL('../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/calendar-contract.ts',import.meta.url),'utf8').replace(/^export /gm,'');
 const {calendarSource,calendarTarget}=vm.runInNewContext(stripTypeScriptTypes(contract,{mode:'transform'})+';({calendarSource,calendarTarget})');
 const context=(id,revision)=>({view:'calendar',sensitive:false,revision:1,selectedObject:{kind:'calendar-source',id,revision,accountId:id,sourceRevision:revision}});
 const one='1'.repeat(64),two='2'.repeat(64),oldRevision='3'.repeat(64),newRevision='4'.repeat(64),ownerRevision='5'.repeat(64);
 const sandbox={SingleFlightMemo,calendarSource,calendarTarget,window,Capacitor:{isNativePlatform:()=>false},registerPlugin:()=>({prepareAgentSource(){calls++;return queue.shift();}})};
 const {calendarAgendaObservation:read}=vm.runInNewContext(stripTypeScriptTypes(source,{mode:'transform'})+';({calendarAgendaObservation})',sandbox);
 const owner={supportsCalendarAgenda:true},first=deferred();queue.push(first.promise);
 const a=read(owner,context('local',one)),b=read(owner,context('local',one));await Promise.resolve();assert.equal(calls,1);first.resolve({sourceId:'local',sourceRevision:one});await Promise.all([a,b]);
 queue.push(Promise.reject(Error('unavailable')));const failOwner={supportsCalendarAgenda:true};assert.equal(await read(failOwner,context('local',two)),undefined);
 queue.push(Promise.resolve({sourceId:'local',sourceRevision:two}));assert.equal((await read(failOwner,context('local',two))).sourceId,'local');
 const old=deferred();queue.push(old.promise);const changing={supportsCalendarAgenda:true};const pending=read(changing,context('local',oldRevision));await Promise.resolve();window.dispatchEvent(new Event('alpha:calendar-sync-source-changed'));old.resolve({sourceId:'local',sourceRevision:oldRevision});assert.equal(await pending,undefined);
 queue.push(Promise.resolve({sourceId:'local',sourceRevision:newRevision}));assert.equal((await read(changing,context('local',newRevision))).sourceId,'local');
 queue.push(Promise.resolve({sourceId:'local',sourceRevision:ownerRevision}));assert.equal((await read({supportsCalendarAgenda:true},context('local',ownerRevision))).sourceId,'local');
 assert.equal(queue.length,0);
});
