import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
// Photos view rules (design/view-refresh-2026-11 section 2). Each block names the specs/photos-library
// Design.cfg rule it implements. Source-level: browser specs drive the rendered view.
const v=await import('../apps/app/src/runtime/photos-view.ts');
const now=new Date(2026,10,6,15,0).getTime(),DAY=86400000;
const row=(id,date,extra={})=>({id,date,...extra});

test('day sections: Today, Yesterday, weekday dates within 30 days, then month and year',()=>{
 assert.equal(v.sectionKey(now-60000,now).label,'Today');
 assert.equal(v.sectionKey(now-DAY,now).label,'Yesterday');
 assert.equal(v.sectionKey(new Date(2026,9,31,9).getTime(),now).label,'Sat, Oct 31');
 assert.equal(v.sectionKey(new Date(2026,8,2).getTime(),now).label,'September 2026');
 assert.equal(v.sectionKey(new Date(2025,10,20).getTime(),now).label,'November 2025');
 const rows=v.newestFirst([row('a',now-2*DAY),row('b',now-60000),row('c',now-61000),row('d',new Date(2026,5,1).getTime()),row('e',new Date(2026,5,3).getTime())]);
 const groups=v.groupSections(rows,now);
 assert.deepEqual(groups.map(g=>[g.label,g.items.map(r=>r.id)]),[['Today',['b','c']],[v.sectionKey(now-2*DAY,now).label,['a']],['June 2026',['e','d']]]);
 // DATE_TAKEN wins over the added date when the provider has it.
 assert.equal(v.shotAt({date:now,taken:now-5*DAY}),now-5*DAY);assert.equal(v.shotAt({date:now,taken:0}),now);
});

test('NewestNeverDropped: the window keeps the newest rows; paging and favorite never reorder',()=>{
 const page1=[row('5',5),row('4',4)],page2=[row('3',3),row('2',2),row('1',1)];
 let window=v.mergeWindow([],page1,3);window=v.mergeWindow(window,page2,3);
 assert.deepEqual(window.map(r=>r.id),['5','4','3'],'the oldest fall off, never the newest (the old slice(-240) kept the oldest)');
 // Equal capture times keep a stable identity order.
 assert.deepEqual(v.newestFirst([row('a',1),row('c',1),row('b',1)]).map(r=>r.id),['c','b','a']);
 // A favorite patch replaces in place; a restore inserts at its date, not at the top.
 const patched=v.patchRows(window,[{...window[1],favorite:true}],()=>true);
 assert.deepEqual(patched.map(r=>r.id),['5','4','3']);assert.equal(patched[1].favorite,true);
 assert.deepEqual(v.insertRows(window,[row('4.5',4.5)]).map(r=>r.id),['5','4.5','4','3']);
 assert.deepEqual(v.patchRows(window,[{...window[0],trashed:true}],r=>!r.trashed).map(r=>r.id),['4','3']);
});

test('FixPatch / NoSpuriousClear: a store event keeps the selection and viewer unless their items left',()=>{
 const pool=[row('a',3,{mutationRevision:'2'}),row('b',2),row('c',1)];
 const selection=[row('a',3,{mutationRevision:'1'}),row('x',9)];
 assert.deepEqual(v.patchSelection(selection,pool),[pool[0]],'kept rows take the current revision; gone rows drop');
 assert.equal(v.patchSelection(undefined,pool),undefined,'not selecting stays not selecting');
 assert.deepEqual(v.patchSelection([],pool),[],'an empty selection is still a selection');
 assert.equal(v.viewerSurvives('b',pool),true);assert.equal(v.viewerSurvives('x',pool),false);assert.equal(v.viewerSurvives('x',pool,id=>id==='x'),true,'an item on a later page still exists');
 assert.equal(v.viewerSurvives(null,pool),true);
});

test('FixFavToggle and FixNoCap: Favorite toggles; large selections batch without a visible cap',()=>{
 assert.equal(v.favoriteTarget([{favorite:true},{favorite:true}]),false,'all favourites: unfavourite');
 assert.equal(v.favoriteTarget([{favorite:true},{favorite:false}]),true);
 assert.deepEqual(v.batches(Array.from({length:45},(_,i)=>i),20).map(b=>b.length),[20,20,5]);
 assert.deepEqual(v.batches([],20),[]);
});

test('drag-to-extend selects the range in grid order; pinch moves between 3 and 5 columns',()=>{
 const order=['a','b','c','d','e'].map(id=>({id}));
 assert.deepEqual(v.dragRange(order,'b','d').map(r=>r.id),['b','c','d']);
 assert.deepEqual(v.dragRange(order,'d','b').map(r=>r.id),['b','c','d']);
 assert.deepEqual(v.dragRange(order,'b','z'),[]);
 assert.equal(v.GRID_COLUMNS.default,4);
 assert.equal(v.pinchColumns(4,100,140),3);assert.equal(v.pinchColumns(4,100,70),5);assert.equal(v.pinchColumns(4,100,105),4);
 assert.equal(v.pinchColumns(3,100,200),3);assert.equal(v.pinchColumns(5,100,10),5);assert.equal(v.pinchColumns(4,0,10),4);
});

test('photos_filter matching is local and read-only: dates, kind, favorite, album and date words',()=>{
 const sat=new Date(2026,9,31,10).getTime(),photo=row('p',sat,{kind:'image',favorite:true,folder:'DCIM/Camera/',width:4,height:3}),clip=row('v',now,{kind:'video',folder:'Pictures/Screenshots/'});
 const frozen=JSON.stringify([photo,clip]);
 assert.equal(v.filterMatches(photo,{from:sat-1,to:sat+1}),true);assert.equal(v.filterMatches(clip,{from:sat-1,to:sat+1}),false);
 assert.equal(v.filterMatches(clip,{kind:'video'}),true);assert.equal(v.filterMatches(photo,{kind:'video'}),false);
 assert.equal(v.filterMatches(photo,{favorite:true}),true);assert.equal(v.filterMatches(clip,{favorite:true}),false);
 assert.equal(v.filterMatches(photo,{album:'camera'}),true);assert.equal(v.filterMatches(clip,{album:'screenshots'}),true);
 assert.equal(v.filterMatches(photo,{album:'custom:1'},key=>key==='custom:1'?['p']:undefined),true);assert.equal(v.filterMatches(clip,{album:'custom:1'},()=>['p']),false);
 assert.equal(v.filterMatches(photo,{text:'saturday weekend'},undefined,new Date(now)),true);
 assert.equal(v.filterMatches(photo,{text:'IMG_2041'},undefined,new Date(now)),false,'file names are never matched');
 assert.equal(JSON.stringify([photo,clip]),frozen,'FilterIsReadOnly: matching never changes rows');
 assert.equal(v.filterLabel({favorite:true,kind:'video'}),'Favorites · Videos');
 assert.equal(v.filterLabel({from:sat,to:sat+DAY}),'Oct 31 – Nov 1');
 assert.equal(v.filterLabel({album:'custom:1'},()=>'Big Sur'),'Big Sur');
});

test('Recently deleted shows days left; Info formats size; the viewer title is the capture date and time',()=>{
 assert.equal(v.daysLeft(now+29.2*DAY,now),30);assert.equal(v.daysLeft(now-DAY,now),0);assert.equal(v.daysLeft(0,now),undefined);
 assert.equal(v.formatBytes(3400000),'3.4 MB');assert.equal(v.formatBytes(980),'980 B');assert.equal(v.formatBytes(0),'');
 assert.deepEqual(v.viewerTitle(now-60000,now),{day:'Today',time:'2:59 PM'});
 assert.equal(v.viewerTitle(new Date(2026,1,3,9,5).getTime(),now).day,'Tue, Feb 3, 2026');
});

test('the Photos view carries no search box, scope narration or 20-item cap',()=>{
 const adapter=readFileSync('apps/app/src/prototype/camera-adapter.ts','utf8'),template=readFileSync('apps/app/src/prototype/template.html','utf8');
 const photos=template.slice(template.indexOf('<sc-if value="{{is.photos}}">'),template.indexOf('<sc-if value="{{is.maps}}">'));
 for(const slop of ['Captured on this device','Permitted library','up to 240','so far','Only photos and videos saved by Alpha','Choose photo access','Saves a new copy','original unchanged ·','Open to preview, or select','Select up to 20','Select first 20','Device library'])assert.equal(adapter.includes(slop)||photos.includes(slop),false,slop);
 assert.doesNotMatch(photos,/aria-label="Search photos"|photos\.searching|photos\.onQ/);
 assert.doesNotMatch(adapter,/slice\(-240\)|deviceLibrary\.tile\(/);
 assert.match(photos,/Allow access to all photos/);assert.match(photos,/Save copy/);assert.match(photos,/Add to album/);
});

test('virtualised grid: only on-screen rows render; spacers keep the total height and sections keep their headers',()=>{
 // 4 columns over 398px with 2px gaps: 98px tiles, a 100px row pitch; 40px headers.
 const base={columns:4,width:398,gap:2,header:40,overscan:0,viewport:500};
 const sizes=[8,400,30];
 const total=sizes.reduce((sum,n)=>sum+40+Math.ceil(n/4)*100-2,0);
 const top=v.virtualGrid(sizes,{...base,scrollTop:0});
 assert.equal(top.total,total);assert.equal(top.before,0);
 assert.deepEqual(top.sections.map(s=>s.index),[0,1],'the first two sections touch the first screen');
 assert.deepEqual([top.sections[0].from,top.sections[0].to,top.sections[0].padTop,top.sections[0].padBottom],[0,8,0,0]);
 const rendered=top.sections.reduce((n,s)=>n+s.to-s.from,0);
 assert.ok(rendered<=4*7,'about one screen of tiles, not 438');
 // Heights add up exactly: spacers + headers + rendered rows + paddings == total.
 const height=r=>r.before+r.after+r.sections.reduce((h,s)=>{const rows=Math.ceil((s.to-s.from)/4);return h+40+s.padTop+s.padBottom+(rows?rows*100-2:0);},0);
 for(const scrollTop of [0,137,2000,5000,9999,20000]){const r=v.virtualGrid(sizes,{...base,scrollTop});assert.equal(height(r),total,`height at ${scrollTop}`);assert.ok(r.sections.reduce((n,s)=>n+s.to-s.from,0)<=4*7,`bounded at ${scrollTop}`);}
 // Deep in the long section: rows before become top padding inside that section, so its sticky header stays.
 const mid=v.virtualGrid(sizes,{...base,scrollTop:5000});
 assert.equal(mid.sections.length,1);assert.equal(mid.sections[0].index,1);assert.ok(mid.sections[0].padTop>0&&mid.sections[0].padBottom>0);
 assert.equal(mid.before,40+2*100-2,'the first section is one spacer');
 assert.equal(mid.sections[0].from%4,0,'rows start at a column boundary');
 // Overscan renders extra rows each way; pinch to 3 or 5 columns changes the layout, not the rule.
 assert.ok(v.virtualGrid(sizes,{...base,scrollTop:5000,overscan:3}).sections[0].to-v.virtualGrid(sizes,{...base,scrollTop:5000,overscan:3}).sections[0].from>mid.sections[0].to-mid.sections[0].from);
 for(const columns of [3,5]){const r=v.virtualGrid(sizes,{...base,columns,scrollTop:3000});assert.equal(r.sections[0].from%columns,0);}
 assert.deepEqual(v.virtualGrid([],{...base,scrollTop:0}),{before:0,after:0,sections:[],total:0});
});

test('the Library grid is virtualised: rendered tiles come from virtualGrid windows with spacers',()=>{
 const camera=readFileSync('apps/app/src/prototype/camera-adapter.ts','utf8'),template=readFileSync('apps/app/src/prototype/template.html','utf8');
 assert.match(camera,/virtualGrid\(grouped\.map\(group => group\.items\.length\), gridMetrics\(\)\)/);
 assert.match(camera,/tiles\(group\.items\.slice\(part\.from, part\.to\)/);
 assert.match(template,/style="\{\{photos\.gridBefore\}\}"[\s\S]*\{\{g\.pad\}\}[\s\S]*style="\{\{photos\.gridAfter\}\}"/);
});
