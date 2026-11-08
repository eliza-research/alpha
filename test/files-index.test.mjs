import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
const {createFilesIndex,compareFilesEntries,matchesFileQuery,sortLabel,RECENT_LIMIT,filesIndexKey}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(readFileSync('apps/app/src/prototype/files-index.ts','utf8'))).toString('base64'));
const memory=()=>{const values=new Map();return {getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),values};};

test('recent sort is newest modified first with folders first and unknown times last; name sort is natural',()=>{
 const rows=[{name:'b.txt',directory:false,modified:100},{name:'a.txt',directory:false,modified:300},{name:'Zeta',directory:true,modified:1},{name:'c.txt',directory:false},{name:'file10.txt',directory:false,modified:300},{name:'Alpha',directory:true,modified:5}];
 assert.deepEqual([...rows].sort(compareFilesEntries('recent')).map(r=>r.name),['Alpha','Zeta','a.txt','file10.txt','b.txt','c.txt']);
 assert.deepEqual([...rows,{name:'file9.txt',directory:false}].sort(compareFilesEntries('name')).map(r=>r.name),['Alpha','Zeta','a.txt','b.txt','c.txt','file9.txt','file10.txt']);
 assert.equal(compareFilesEntries('name')({name:'A',directory:false},{name:'a',directory:false})<0,true,'stable tie-break');
 assert.equal(sortLabel('name'),'Sorted by name');assert.equal(sortLabel('recent'),'Sorted by newest');
});
test('recent rows persist newest first, keep same-name picks and report evicted grants',()=>{
 const store=memory();let now=1;const index=createFilesIndex(store,()=>++now);
 assert.deepEqual(index.record({kind:'selected',name:'Scan.pdf',mimeType:'application/pdf',selectionId:'s1'}),[]);
 index.record({kind:'scan-pdf',name:'Alpha scan.pdf',mimeType:'application/pdf'});
 assert.deepEqual(index.record({kind:'selected',name:'Scan.pdf',mimeType:'application/pdf',selectionId:'s2'}),[],'a second file with the same name releases nothing');
 assert.deepEqual(index.list().map(r=>[r.kind,r.name,r.selectionId]),[['selected','Scan.pdf','s2'],['scan-pdf','Alpha scan.pdf',undefined],['selected','Scan.pdf','s1']]);
 assert.equal(createFilesIndex(store).list().length,3,'survives a restart');assert.equal(index.has('s2'),true);assert.equal(index.has('s1'),true);
 const evicted=[];for(let i=0;i<RECENT_LIMIT-1;i++)evicted.push(...index.record({kind:'selected',name:'n'+i+'.txt',mimeType:'text/plain',selectionId:'x'+i}));
 assert.deepEqual(evicted,['s1'],'only grants that fall out of Recent are released');assert.equal(index.list().length,RECENT_LIMIT);
});
test('reopening a folder file replaces its row and returns the older selection',()=>{
 const index=createFilesIndex(memory());
 assert.deepEqual(index.record({kind:'tree',name:'notes.txt',mimeType:'text/plain',selectionId:'t1',treeId:'tree-1'}),[]);
 assert.deepEqual(index.record({kind:'tree',name:'notes.txt',mimeType:'text/plain',selectionId:'t2',treeId:'tree-1'}),['t1']);
 assert.deepEqual(index.record({kind:'tree',name:'notes.txt',mimeType:'text/plain',selectionId:'t2',treeId:'tree-1'}),[],'the same selection is kept');
 assert.deepEqual(index.list().map(r=>r.selectionId),['t2']);
});
test('revoked rows stay visible as Select again and tree capabilities end with the session',()=>{
 const store=memory();const index=createFilesIndex(store);
 index.record({kind:'tree',name:'notes.txt',mimeType:'text/plain',selectionId:'t1',treeId:'tree-1'});index.record({kind:'selected',name:'a.pdf',mimeType:'application/pdf',selectionId:'s1'});
 assert.deepEqual(index.revokeTree(),['t1'],'revoked tree grants are returned for release');assert.deepEqual(index.list().map(r=>r.status).sort(),['ready','revoked']);
 assert.equal(index.has('t1'),false);assert.deepEqual(index.revokeTree(),[]);
 const row=index.list().find(r=>r.kind==='selected');index.revoke(row.key);assert.equal(index.list().every(r=>r.status==='revoked'),true);
 index.record({kind:'tree',name:'notes.txt',mimeType:'text/plain',selectionId:'t2',treeId:'tree-2'});assert.equal(index.list().filter(r=>r.name==='notes.txt').length,1,'reopening replaces the revoked row');
 index.setOpen('t2');assert.equal(createFilesIndex(store).open(),'t2');index.setOpen(null);assert.equal(createFilesIndex(store).open(),null);
});
test('stored rows are validated and never invent access',()=>{
 const store=memory();store.setItem(filesIndexKey,JSON.stringify([{key:'k',kind:'selected',name:'ok.txt',mimeType:'text/plain',openedAt:1,status:'ready',selectionId:'good-id'},{key:'k2',kind:'selected',name:'bad',mimeType:'text/plain',openedAt:1,status:'ready',selectionId:'content://x/y'},{kind:'other'},null,'x']));
 assert.deepEqual(createFilesIndex(store).list().map(r=>r.name),['ok.txt']);
 store.setItem(filesIndexKey,'{');assert.deepEqual(createFilesIndex(store).list(),[]);
 const broken={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){}};const index=createFilesIndex(broken);index.record({kind:'scan-pdf',name:'x.pdf',mimeType:'application/pdf'});assert.deepEqual(index.list(),[]);
});
test('search matches name and type words by prefix',()=>{
 assert.equal(matchesFileQuery({name:'Quarterly Report 2026.pdf',mimeType:'application/pdf'},'quart rep'),true);
 assert.equal(matchesFileQuery({name:'notes.txt',mimeType:'text/plain'},'text'),true);
 assert.equal(matchesFileQuery({name:'Résumé.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},'resume document'),true);
 assert.equal(matchesFileQuery({name:'notes.txt',mimeType:'text/plain'},'pdf'),false);
 assert.equal(matchesFileQuery({name:'notes.txt',mimeType:'text/plain'},'  '),false);
});
