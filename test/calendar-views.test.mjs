import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

// Calendar views (docs/flow-redesign-2026-11): the pure Week/Month/Schedule/Search builders and the
// actual renderer's calendar module. No browser, provider or Google access.
const strip=path=>stripTypeScriptTypes(readFileSync(path,'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'strip'});
const days=strip('apps/app/src/prototype/calendar-days.ts'),views=strip('apps/app/src/prototype/calendar-views.ts');
const model=readFileSync('apps/app/src/prototype/model.js','utf8');
const calendar=model.slice(model.indexOf('/* ===== module: calendar ===== */'),model.indexOf('/* ===== module: browser ===== */'));
// Friday 6 November 2026, noon local time.
const instant=new Date(2026,10,6,12).getTime();
class FixedDate extends Date {constructor(...args){super(...(args.length?args:[instant]));}static now(){return instant;}}
const plain=value=>JSON.parse(JSON.stringify(value));

function pure(){
  const ctx=vm.createContext({Date:FixedDate,Intl});
  vm.runInContext('const currentSurfaceLayout=()=>({split:false,calendarDays:1,agenda:false});\n'+days+'\n'+views+'\nglobalThis.api={calendarViewDays,calendarLoadRange,calendarView,calendarMonthCells,calendarScheduleRows,calendarSearchRows};',ctx);
  return ctx.api;
}

function renderer(events,patch={}){
  const ctx=vm.createContext({Date:FixedDate,Intl,console,IC:{up:'up',down:'down',phone:'phone',pin:'pin'},CAL_SEED:[],CAL_PREP:{},PEOPLE:[],copy:()=>({}),
    formatHours:value=>String(value),fmtT:value=>String(value),formatHoursRange:(a,b)=>`${a}–${b}`,formatHour:value=>String(value),formatShortDate:date=>date.toISOString().slice(0,10),formatMonthTitle:date=>`month ${date.getFullYear()}-${date.getMonth()+1}`,weekdayName:()=>'Fri',
    registerView:(_key,value)=>{ctx.view=value;}});
  vm.runInContext('const currentSurfaceLayout=()=>({split:false,calendarDays:1,agenda:false});\n'+days+'\n'+views+'\n'+calendar,ctx);
  const state={...ctx.view.state,events,...patch},toasts=[];
  const api={now:new FixedDate(),get:key=>key==='calendar'?state:{},set:value=>Object.assign(state,value),setView:(_key,value)=>Object.assign(state,value),sw:()=>({}),track:()=>'',kx:()=>0,swallowed:()=>false,toast:(text,options)=>toasts.push([text,options]),person:()=>null,later:()=>{},send:()=>{},open:()=>{}};
  return {view:ctx.view,state,toasts,render:()=>ctx.view.render(state,api),back:()=>ctx.view.back(state,api)};
}
const fixture=()=>[
  {id:'standup',off:-7,t:9.5,d:.25,title:'Standup',cal:'work',repeat:'weekdays',where:'',who:[],notes:''},
  {id:'lunch',off:1,t:12.5,d:1,title:'Lunch with Dana',cal:'personal',repeat:'none',where:'Harbor Roasters',who:[],notes:'Bring the plan'},
  {id:'trip',off:0,t:0,d:0,allDay:true,title:'Conference',cal:'personal',repeat:'none',where:'',who:[],notes:''},
];

test('Week is Monday to Sunday of the selected day; Day keeps the measured columns',()=>{
  const {calendarViewDays,calendarView}=pure();
  assert.deepEqual([...calendarViewDays('week',0,instant)],[-4,-3,-2,-1,0,1,2]);
  assert.deepEqual([...calendarViewDays('week',3,instant)],[3,4,5,6,7,8,9]);
  assert.deepEqual([...calendarViewDays('day',3,instant,1)],[3]);
  assert.deepEqual([...calendarViewDays('day',3,instant,3)],[2,3,4]);
  assert.equal(calendarView('month'),'month');assert.equal(calendarView('agenda'),'day');assert.equal(calendarView(undefined),'day');
});

test('the load range covers the shown month and its neighbours, moves with Month view and widens for Search',()=>{
  const {calendarLoadRange}=pure();
  const around=calendarLoadRange({day:0,month:null},instant);
  assert.equal(around.begin,new Date(2026,9,1).getTime());assert.equal(around.end,new Date(2027,0,1).getTime());
  const later=calendarLoadRange({day:0,month:2},instant);
  assert.equal(later.begin,new Date(2026,11,1).getTime());assert.equal(later.end,new Date(2027,2,1).getTime());
  assert.notEqual(later.key,around.key);
  const search=calendarLoadRange({day:0,month:null,search:''},instant);
  assert.equal(search.begin,new Date(2026,7,8).getTime());assert.equal(search.end,new Date(2027,10,7).getTime());
});

test('Month cells are whole weeks with up to three chips and a count for the rest',()=>{
  const {calendarMonthCells}=pure();
  const busy=off=>off===3?[1,2,3,4].map(n=>({title:`Event ${n}`,color:'red',t:n})):off===0?[{title:'Timed',color:'blue',t:9},{title:'All day',color:'green',allDay:true}]:[];
  const cells=calendarMonthCells(new Date(2026,10,20),instant,busy,{selected:0});
  assert.equal(cells.length,42,'November 2026 starts on a Sunday and needs six rows');
  assert.equal(cells[0].off,-11);assert.equal(cells[0].n,26);assert.equal(cells[0].inMonth,false);
  const today=cells.find(cell=>cell.isToday);
  assert.equal(today.n,6);assert.equal(today.selected,true);assert.deepEqual(plain(today.chips.map(chip=>chip.title)),['All day','Timed'],'all-day chips lead');
  const full=cells.find(cell=>cell.off===3);
  assert.deepEqual(plain(full.chips.map(chip=>chip.title)),['Event 1','Event 2','Event 3']);assert.equal(full.more,'+1');assert.match(full.label,/4 events$/);
  assert.equal(calendarMonthCells(new Date(2027,1,1),instant,()=>[]).length,35,'February 2027 fits five rows');
});

test('Schedule lists only days with events, from the first day on, and Search matches title, place and notes',()=>{
  const {calendarScheduleRows,calendarSearchRows}=pure();
  const rows=calendarScheduleRows(0,40,off=>off===0||off===30?[{title:'Late',color:'x',t:18},{title:'Trip',color:'x',allDay:true}]:[],instant);
  assert.deepEqual(plain(rows.map(row=>row.off)),[0,30]);
  assert.equal(rows[0].isToday,true);assert.deepEqual(plain(rows[0].items.map(item=>item.title)),['Trip','Late']);
  assert.ok(rows[0].monthHead&&rows[1].monthHead,'a month heading starts each month');
  const events=[{title:'Dentist',where:'Bright Smile',notes:'',start:3},{title:'Lunch',where:'Harbor Roasters',notes:'',start:2},{title:'Gym',where:'',notes:'bring the harbor pass',start:1}];
  assert.deepEqual(plain(calendarSearchRows('HARBOR',events,100,instant).map(row=>row.title)),['Lunch','Gym'],'earlier days: most recent first');
  assert.deepEqual(plain(calendarSearchRows('  ',events)),[]);
});

test('Search lists today and later first, then earlier days, and the cap keeps upcoming rows',()=>{
  const {calendarSearchRows}=pure();
  const midnight=new Date(2026,10,6).getTime(),hour=3600000,day=24*hour;
  // A weekday standup: 90 days back to a year ahead, one row per occurrence (as provider rows are).
  const series=Array.from({length:456},(_,index)=>({title:'Standup',start:midnight+(index-90)*day+9.5*hour,index:index-90}));
  const rows=calendarSearchRows('standup',series,100,instant);
  assert.equal(rows.length,100);
  assert.deepEqual(plain(rows.slice(0,3).map(row=>row.index)),[0,1,2],'today’s occurrence leads, even after it started');
  assert.ok(rows.every(row=>row.index>=0),'upcoming occurrences fill the cap before any past one');
  const few=calendarSearchRows('standup',series.filter(row=>row.index>=-2&&row.index<=1),100,instant);
  assert.deepEqual(plain(few.map(row=>row.index)),[0,1,-1,-2]);
});

test('the title menu switches views and lists a switch per calendar with its colour',()=>{
  const h=renderer(fixture(),{googleCalendars:[{id:'family',name:'Family',color:'#f4511e'}]});
  h.state.events.push({id:'dinner',off:2,t:18,d:2,title:'Dinner at Mom’s',cal:'family',repeat:'none',where:'',who:[],notes:''});
  let out=h.render();
  assert.equal(out.view,'day');assert.equal(out.menuOpen,false);
  out.toggleMenu();out=h.render();assert.equal(out.menuOpen,true);
  assert.deepEqual(plain(out.viewMenu.map(item=>[item.label,item.checked])),[['Schedule','false'],['Day','true'],['Week','false'],['Month','false']]);
  assert.deepEqual(plain(out.calToggles.map(row=>[row.name,row.checked,row.dot])),[['Personal','true','var(--fg)'],['Work','true','var(--acct)'],['Family','true','#f4511e']]);
  out.calToggles.find(row=>row.name==='Work').toggle();out=h.render();
  assert.equal(out.calToggles.find(row=>row.name==='Work').checked,'false','a hidden calendar keeps its switch');
  out.viewMenu.find(item=>item.id==='week').pick();
  assert.equal(h.state.view,'week');assert.equal(h.state.menu,false);
  assert.equal(h.view.persist.includes('view'),true,'the chosen view is remembered');
});

test('Week view draws seven compact columns and a column head opens that day',()=>{
  const h=renderer(fixture(),{view:'week'});
  const out=h.render();
  assert.equal(out.weekView,true);assert.equal(out.timelineView,true);assert.equal(out.multiDay,true);assert.equal(out.dayCount,7);
  assert.deepEqual(plain(out.dayColumns.map(column=>column.off)),[-4,-3,-2,-1,0,1,2]);
  assert.deepEqual(plain(out.dayColumns.map(column=>column.events.map(event=>event.title))),[['Standup'],['Standup'],['Standup'],['Standup'],['Conference','Standup'],['Lunch with Dana'],[]]);
  assert.ok(out.dayColumns.every(column=>column.events.every(event=>event.showTime===false&&event.sub==='')));
  out.dayColumns[1].pick();assert.equal(h.state.view,'day');assert.equal(h.state.day,-3);
});

test('Month view shows chips per day; tapping a day opens it in Day view',()=>{
  const h=renderer(fixture(),{view:'month',month:0});
  let out=h.render();
  assert.equal(out.monthView,true);assert.equal(out.timelineView,false);assert.equal(out.month,'month 2026-11');
  const today=out.monthCells.find(cell=>cell.isToday);
  assert.deepEqual(plain(today.chips.map(chip=>chip.title)),['Conference','Standup']);
  assert.match(today.numCss,/--acc/);
  assert.equal(out.monthCells.find(cell=>cell.off===2).chips.length,0,'Sunday: no standup');
  assert.equal(out.monthCells.find(cell=>cell.off===7).chips.length,1,'a week later: the standup repeats');
  out.mNext();out=h.render();assert.equal(out.month,'month 2026-12');assert.equal(out.notToday,true);
  out.goToday();assert.equal(h.state.month,0);assert.equal(h.state.day,0);
  out=h.render();out.monthCells.find(cell=>cell.off===1).pick();
  assert.deepEqual([h.state.view,h.state.day,h.state.month],['day',1,null]);
});

test('Schedule runs from today; Search opens the event; the empty state is short',()=>{
  const h=renderer(fixture(),{view:'schedule'});
  let out=h.render();
  assert.equal(out.scheduleRows[0].off,0);assert.deepEqual(plain(out.scheduleRows[0].items.map(item=>item.title)),['Conference','Standup']);
  assert.deepEqual(plain(out.scheduleRows[1].items.map(item=>item.title)),['Lunch with Dana']);
  assert.equal(out.scheduleEmpty,false);assert.equal(out.notToday,false);
  out.scheduleRows[1].items[0].open();assert.equal(h.state.open,'lunch');assert.equal(h.state.openDay,1);
  h.state.open=null;h.state.openDay=null;
  out.openSearch();out=h.render();
  assert.equal(out.searching,true);assert.equal(out.notSearching,false);assert.deepEqual(plain(out.searchRows),[]);assert.equal(out.searchEmpty,false);
  out.onSearch({target:{value:'bring the'}});out=h.render();
  assert.deepEqual(plain(out.searchRows.map(row=>row.title)),['Lunch with Dana']);
  out.searchRows[0].open();assert.equal(h.state.open,'lunch');assert.equal(h.state.openDay,1);assert.equal(h.state.day,0,'Schedule stays on today');assert.equal(h.state.search,'bring the','closing the event returns to the results');
  h.state.search='nothing like this';out=h.render();assert.equal(out.searchEmpty,true);
  const empty=renderer([],{view:'schedule'}).render();
  assert.equal(empty.scheduleEmpty,true);assert.equal(empty.emptyText,'Nothing scheduled');
  assert.equal(renderer([]).render().emptyText,'Nothing scheduled');
});

test('Schedule stays on today after an event far ahead is opened and closed',()=>{
  const far={id:'far',off:95,t:10,d:1,title:'Far review',cal:'work',repeat:'none',where:'',who:[],notes:''};
  const {calendarLoadRange}=pure();
  const contains=state=>{const range=calendarLoadRange(state,instant);return range.begin<=instant&&range.end>instant;};
  // From Search: open the result, Back to the results, Back out of Search.
  const h=renderer([...fixture(),far],{view:'schedule',search:'far'});
  h.render().searchRows[0].open();assert.equal(h.state.open,'far');assert.equal(h.state.openDay,95);assert.equal(h.state.day,0);
  assert.equal(h.back(),true);assert.equal(h.state.open,null);assert.equal(h.state.day,0);
  assert.equal(h.back(),true);assert.equal(h.state.search,null);assert.equal(h.state.day,0);
  assert.ok(contains(h.state));assert.equal(h.render().scheduleRows[0].off,0);
  // The detail's close button, and a day moved by something else, still read from today.
  h.state.open='far';h.state.openDay=95;h.render().ev.close();assert.equal(h.state.day,0);
  h.state.day=95;assert.ok(contains(h.state),'Schedule anchors its read window on today');
  assert.equal(h.render().scheduleRows[0].off,0);
  // Deleting and saving from Schedule keep it on today too.
  h.state.day=0;h.state.open='far';h.state.openDay=95;h.render().ev.del();assert.equal(h.state.day,0);
  h.render().newEvent();h.state.form={...h.state.form,title:'Later',off:60};h.render().f.save();assert.equal(h.state.day,0);
  // Day view still follows the event.
  const d=renderer([...fixture(),far],{search:'far'});d.render().searchRows[0].open();assert.equal(d.state.day,95);
});

test('Back closes the delete sheet, then the event, then the menu, then Search',()=>{
  const h=renderer(fixture(),{menu:true,search:'x',open:'standup',openDay:0,deleteAsk:{id:'standup',off:0}});
  assert.equal(h.back(),true);assert.equal(h.state.deleteAsk,null);
  assert.equal(h.back(),true);assert.equal(h.state.open,null);
  assert.equal(h.back(),true);assert.equal(h.state.menu,false);
  assert.equal(h.back(),true);assert.equal(h.state.search,null);
  assert.equal(h.back(),false);
});

test('deleting a repeating event asks for its scope; one occurrence can be removed and restored',()=>{
  const h=renderer(fixture(),{open:'standup',openDay:0});
  let out=h.render();
  out.ev.del();assert.deepEqual(plain(h.state.deleteAsk),{id:'standup',off:0});
  out=h.render();
  assert.equal(out.deleteSheet.title,'Delete “Standup”?');
  assert.deepEqual(plain(out.deleteSheet.options.map(option=>option.label)),['This event','This and following events','All events']);
  out.deleteSheet.options[0].go();
  assert.equal(h.state.deleteAsk,null);assert.equal(h.state.open,null);
  out=h.render();assert.equal(out.events.some(event=>event.title==='Standup'),false,'today’s occurrence is gone');
  h.state.day=-1;assert.equal(h.render().events.some(event=>event.title==='Standup'),true,'other occurrences stay');
  const [label,options]=h.toasts.at(-1);assert.equal(label,'Standup deleted');options.undo();
  h.state.day=0;assert.equal(h.render().events.some(event=>event.title==='Standup'),true,'Undo restores the occurrence');
  // This and following: the series ends the day before.
  h.state.deleteAsk={id:'standup',off:0};h.render().deleteSheet.options[1].go();
  assert.equal(h.state.events.find(event=>event.id==='standup').until,-1);
  // A one-off event is deleted at once, with Undo.
  h.state.open='lunch';h.state.openDay=1;h.render().ev.del();
  assert.equal(h.state.deleteAsk,null);assert.equal(h.state.events.some(event=>event.id==='lunch'),false);
});

test('a change waiting to sync is marked on its block and in its detail',()=>{
  const h=renderer([{id:'p',off:0,t:10,d:1,title:'Offline edit',cal:'personal',repeat:'none',where:'',who:[],notes:'',pendingSync:true}]);
  const out=h.render();
  assert.equal(out.events[0].pending,true);
  h.state.open='p';h.state.openDay=0;const detail=h.render().ev;
  assert.equal(detail.pending,true);assert.equal(detail.sourceNote,'');assert.equal(detail.conflict,null);
});
