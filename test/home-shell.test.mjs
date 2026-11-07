// Alpha's Home and app grid render from the shared mobile shell (@elizaos/ui/mobile-shell), its Apps
// drawer from apps-drawer.tsx, with the product record in config/alpha-product.json. Shared controller and search cases live in
// the upstream mobile-shell and native-system suites.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';
import {renderToStaticMarkup} from 'react-dom/server';
import {cloneElement,createElement} from 'react';
const {installHomeShell}=await tsImport('../apps/app/src/prototype/home-shell.ts',import.meta.url);
const {navigateMobileShell}=await tsImport('../.eliza/client-features/packages/ui/src/mobile-shell/navigation.ts',import.meta.url);
const icon='data:image/png;base64,iVBORw0KGgo=';
const apps=[
 {packageName:'com.android.settings',label:'Settings',icon},
 {packageName:'org.example.camera',label:'Caméra'},
];
const PRODUCT=['alpha:inbox','alpha:calendar','alpha:browser','alpha:camera','alpha:photos','alpha:maps','alpha:notes','alpha:files','alpha:automations','alpha:settings'];

function shellClass(opened){
  return class Shell {
    constructor(){this.state={drawer:false,drawerQ:''};}
    S(){return {view:null,stack:[],...this.state};}
    setState(patch){this.state={...this.state,...patch};}
    vget(){return {};}
    openView(key){opened.push(key);}
    back(){if(this.state.drawer)this.setState(this.shellNavigate({type:'back'}));}
    goHome(){this.setState(this.shellNavigate({type:'home'}));}
    toast(){}
    shellNavigate(action){const next=navigateMobileShell({view:null,stack:[],drawer:!!this.state.drawer,drawerQuery:this.state.drawerQ||''},action);return {view:next.view,stack:[...next.stack],drawer:next.drawer,drawerQ:next.drawerQuery};}
    renderVals(){return {isOn:true,isView:false,homeHidden:false};}
  };
}
const tiles=markup=>[...markup.matchAll(/data-mobile-shell-tile="" aria-label="([^"]+)"/g)].map(match=>match[1]);

test('Home lists the favorites with an Apps tile; Apps lists installed apps only; product views open in Alpha, installed apps by component', async () => {
  const previous=globalThis.document;
  globalThis.document=Object.assign(new EventTarget(),{hidden:false});
  let saved=null;const opened=[],nativeCalls=[];
  const Shell=shellClass(opened);
  const shell=installHomeShell(Shell,{inbox:{badge:()=>true}},{list:async()=>({apps}),launch:async target=>{nativeCalls.push(target);}},
    {appInventory:'simulated',favorites:{read:()=>saved,write:keys=>{saved=[...keys];}}});
  const home=new Shell();
  let rendered=home.renderVals();
  home.componentDidMount();
  try {
  // Canonical ids, product order, labels from the record; Workflows is the automations view.
  assert.deepEqual(tiles(renderToStaticMarkup(rendered.homeShell)),['Inbox','Calendar','Browser','Camera','Photos','Maps','Notes','Files','Workflows','Settings','Apps']);
  const markup=renderToStaticMarkup(rendered.homeShell);
  assert.match(markup,/aria-label="Apps" aria-haspopup="dialog"/);
  assert.doesNotMatch(markup,/All apps/);
  assert.match(markup,/data-alpha-layer="home"/);assert.match(markup,/data-alpha-home-apps=""/);assert.match(markup,/data-alpha-home-layout=""/);
  assert.match(markup,/mask:url\(&quot;\/icons\/lucide\/workflow\.svg&quot;\)/,'view glyphs come from the product icon set');
  assert.equal((markup.match(/data-mobile-shell-tile-badge=""/g)||[]).length,1,'only Inbox reports a badge');
  home.openAllApps();
  assert.equal(home.state.drawer,true);
  await shell.launcher.load();
  assert.deepEqual(saved,PRODUCT,'first open saves the product views as the default favorites');
  rendered=home.renderVals();
  assert.equal(rendered.drawerOpen,true);
  const drawer=renderToStaticMarkup(rendered.allAppsDrawer);
  assert.match(drawer,/data-alpha-layer="drawer"/);assert.match(drawer,/class="alpha-app-drawer fadein"/);
  assert.match(drawer,/role="dialog" aria-modal="true" aria-label="Apps"/);assert.match(drawer,/<h1[^>]*>Apps<\/h1>/);
  assert.match(drawer,/aria-label="Search apps"/);assert.match(drawer,/aria-label="Close apps"/);
  // Installed apps only, alphabetical, no product views, no count, no favorite or move controls.
  assert.deepEqual([...drawer.matchAll(/aria-label="Open ([^"]+)"/g)].map(m=>m[1]),['Caméra','Settings']);
  assert.doesNotMatch(drawer,/Inbox|Workflows|favorites|earlier|later|\d+ apps?</);
  assert.match(drawer,/class="alpha-fit-grid" data-alpha-apps-grid="" style="--fit-columns:4;--fit-min:62px/,'a 4-column icon grid');
  const find=key=>shell.launcher.snapshot().apps.find(app=>(app.packageName+(app.activityName?'/'+app.activityName:''))===key);
  await shell.launcher.launch(find('alpha:automations'));
  await shell.launcher.launch(find('alpha:settings'));
  assert.deepEqual(opened,['workflows','settings'],'product entries open the Alpha renderer view');
  assert.deepEqual(nativeCalls,[]);
  await shell.launcher.launch(find('com.android.settings'));
  assert.deepEqual(nativeCalls,[{packageName:'com.android.settings'}]);
  // Add to Home from the drawer's menu puts the app on Home and closes the drawer.
  rendered.allAppsDrawer.props.onAddHome(find('com.android.settings'));
  assert.equal(home.state.drawer,false);
  shell.launcher.toggleFavorite(find('alpha:notes'));
  const homeTiles=tiles(renderToStaticMarkup(home.renderVals().homeShell));
  assert.equal(homeTiles.includes('Notes'),false);assert.deepEqual(homeTiles.slice(-2),['Settings','Apps']);
  assert.match(renderToStaticMarkup(home.renderVals().homeShell),/<img alt="" src="data:image\/png;base64,iVBORw0KGgo="\/>/,'an installed favorite keeps its platform icon');
  // Back closes the drawer through the shared navigation state.
  home.openAllApps();
  home.back();
  assert.equal(home.renderVals().drawerOpen,false);
  } finally { home.componentWillUnmount(); if(previous===undefined)delete globalThis.document;else globalThis.document=previous; }
});

test('the drawer menu offers Add to Home (or On Home) and App info for exactly the listed entry; the dialer keeps its installed component', async () => {
  const previous=globalThis.document;
  globalThis.document=Object.assign(new EventTarget(),{hidden:false});
  const listed=[...apps,{packageName:'com.android.dialer',activityName:'com.android.dialer.Main',label:'Dialer'},{packageName:'org.example.mail',activityName:'org.example.Mail',label:'Mail',user:'10',profile:'work'}];
  let saved=null;const info=[];
  const Shell=shellClass([]);
  const shell=installHomeShell(Shell,{},{list:async()=>({apps:listed}),launch:async()=>{},resolveDefault:async()=>({available:true,packageName:'com.android.dialer',label:'Dialer'}),openDefault:async()=>{}},
    {appInventory:'simulated',favorites:{read:()=>saved,write:keys=>{saved=[...keys];}},appInfo:async target=>{info.push(target);}});
  const home=new Shell();home.renderVals();home.componentDidMount();
  try {
    home.openAllApps();await shell.launcher.load();
    let rendered=home.renderVals(),drawer=renderToStaticMarkup(rendered.allAppsDrawer);
    assert.deepEqual([...drawer.matchAll(/aria-label="Open ([^"]+)"/g)].map(m=>m[1]),['Caméra','Dialer','Mail (Work)','Settings'],'the dialer appears once with its installed identity');
    assert.doesNotMatch(drawer,/role="menu"/);
    // Activating a tile launches its app, so the button announces no popup; the menu is the long-press action.
    assert.doesNotMatch(drawer,/aria-haspopup="menu"|aria-expanded=/);
    const work=shell.launcher.snapshot().apps.find(app=>app.user==='10');
    const key='org.example.mail/org.example.Mail#10';
    rendered.allAppsDrawer.props.onMenu(key);
    rendered=home.renderVals();drawer=renderToStaticMarkup(rendered.allAppsDrawer);
    assert.match(drawer,/role="menu" aria-label="Mail"/);
    assert.match(drawer,/role="menuitem"[^>]*>.*?Add to Home<\/button>/);assert.match(drawer,/App info<\/button>/);
    // Back closes the menu first, then the drawer.
    home.back();assert.equal(home.state.drawerMenu,null);assert.equal(home.state.drawer,true);
    rendered.allAppsDrawer.props.onAppInfo(work);
    assert.deepEqual(info,[{packageName:'org.example.mail',activityName:'org.example.Mail',user:'10'}],'App info names the exact component and profile');
    shell.launcher.toggleFavorite(work);
    home.setState({drawerMenu:key});
    drawer=renderToStaticMarkup(home.renderVals().allAppsDrawer);
    assert.match(drawer,/role="menuitem" disabled=""[^>]*>.*?On Home<\/button>/,'an app already on Home cannot be added again');
    // The dialer's own entry keeps its menu on the installed tile.
    home.setState({drawerMenu:'com.android.dialer/com.android.dialer.Main'});
    assert.match(renderToStaticMarkup(home.renderVals().allAppsDrawer),/role="menu" aria-label="Dialer"/);
    // Without an App info opener (the browser) the menu has Add to Home only.
    const plain=installHomeShell(shellClass([]),{},{list:async()=>({apps}),launch:async()=>{}},{appInventory:'simulated',favorites:{read:()=>[],write:()=>{}}});
    await plain.launcher.load();
    const other=new (shellClass([]))();other.setState({drawer:true,drawerMenu:'com.android.settings'});
    assert.doesNotMatch(renderToStaticMarkup(other.renderVals().allAppsDrawer),/App info/);
  } finally { home.componentWillUnmount(); if(previous===undefined)delete globalThis.document;else globalThis.document=previous; }
});

test('Home edit mode: long press enters it, − removes, drag and arrows rearrange, + restores hidden views, Done/Back/Home/opening a view end it', async () => {
  const previous=globalThis.document,previousFrame=globalThis.requestAnimationFrame;
  const elements=new Map();
  globalThis.document=Object.assign(new EventTarget(),{hidden:false,querySelector:()=>null,elementsFromPoint:(x)=>elements.get(x)||[]});
  globalThis.requestAnimationFrame=()=>0;
  let saved=['alpha:inbox','alpha:calendar','alpha:notes','com.android.settings'];
  const opened=[];
  const Shell=shellClass(opened);
  const shell=installHomeShell(Shell,{},{list:async()=>({apps}),launch:async()=>{}},{appInventory:'simulated',favorites:{read:()=>saved,write:keys=>{saved=[...keys];}}});
  const home=new Shell();home.renderVals();home.componentDidMount();
  // A tile as the grid's handlers see it: the face carries the Home key; the "−" is inside it.
  const tile=key=>{const face={getAttribute:()=>key};const el={querySelector:()=>face,getBoundingClientRect:()=>({width:64}),offsetWidth:64,style:{},setAttribute(){},removeAttribute(){}};el.closest=s=>s==='[data-mobile-shell-tile]'?el:null;return el;};
  const minus=key=>{const t=tile(key);return {closest:s=>s==='[data-alpha-home-remove]'?{}:t.closest(s)};};
  const event=(target,extra={})=>{const e={target,button:0,clientX:0,clientY:0,detail:1,pointerId:1,currentTarget:{setPointerCapture(){}},defaultPrevented:false,stopped:false,preventDefault(){e.defaultPrevented=true;},stopPropagation(){e.stopped=true;},...extra};return e;};
  try {
    await shell.launcher.load();
    let grid=home.renderVals().homeShell.props.gridProps;
    assert.equal(grid['data-alpha-home-editing'],undefined);
    // The context-menu gesture (or a held press) enters edit mode; its tap does not open the view.
    grid.onContextMenu(event(tile('alpha:notes')));
    assert.equal(home.state.homeEdit,true);
    const swallowed=event(tile('alpha:notes'));grid.onClickCapture(swallowed);
    assert.equal(swallowed.stopped,true);assert.deepEqual(opened,[]);
    let rendered=home.renderVals();grid=rendered.homeShell.props.gridProps;
    assert.equal(grid['data-alpha-home-editing'],'true');assert.equal(rendered.homeEdit.on,true);
    let markup=renderToStaticMarkup(rendered.homeShell);
    assert.deepEqual(tiles(markup),['Remove Inbox from Home','Remove Calendar from Home','Remove Notes from Home','Remove Settings from Home'],'no Apps tile while editing');
    assert.equal((markup.match(/data-alpha-home-remove=""/g)||[]).length,4);
    // A tap on the icon itself does nothing; the "−" (or a keyboard activation) removes.
    const tap=event(tile('alpha:calendar'));grid.onClickCapture(tap);
    assert.equal(tap.stopped,true);assert.deepEqual(saved,['alpha:inbox','alpha:calendar','alpha:notes','com.android.settings']);
    grid.onClickCapture(event(minus('alpha:calendar')));
    assert.deepEqual(saved,['alpha:inbox','alpha:notes','com.android.settings']);
    grid.onClickCapture(event(tile('com.android.settings'),{detail:0}));
    assert.deepEqual(saved,['alpha:inbox','alpha:notes']);
    // Arrow keys move the focused icon one place.
    grid=home.renderVals().homeShell.props.gridProps;
    grid.onKeyDown(event(tile('alpha:inbox'),{key:'ArrowRight'}));
    assert.deepEqual(saved,['alpha:notes','alpha:inbox']);
    // A drag drops an icon where another one is.
    shell.launcher.toggleFavorite(shell.launcher.snapshot().apps.find(app=>app.packageName==='alpha:files'));
    assert.deepEqual(saved,['alpha:notes','alpha:inbox','alpha:files']);
    grid=home.renderVals().homeShell.props.gridProps;
    const dragged=tile('alpha:files');
    elements.set(40,[dragged,tile('alpha:notes')]);
    grid.onPointerDown(event(dragged,{clientX:0}));
    grid.onPointerMove(event(dragged,{clientX:40}));
    grid.onPointerUp(event(dragged,{clientX:40}));
    assert.deepEqual(saved,['alpha:files','alpha:notes','alpha:inbox']);
    const after=event(dragged);grid.onClickCapture(after);assert.equal(after.stopped,true,'the drop does not also tap');
    // "+" lists the product views not on Home and puts one back.
    rendered=home.renderVals();
    assert.deepEqual(rendered.homeEdit.hidden.map(h=>h.label),['Calendar','Browser','Camera','Photos','Maps','Workflows','Settings']);
    rendered.homeEdit.add();assert.equal(home.renderVals().homeEdit.adding,true);
    home.renderVals().homeEdit.hidden.find(h=>h.label==='Calendar').add();
    assert.deepEqual(saved,['alpha:files','alpha:notes','alpha:inbox','alpha:calendar']);
    // Back closes the sheet, then edit mode.
    home.back();assert.equal(home.state.homeAdd,false);assert.equal(home.state.homeEdit,true);
    home.openAllApps();assert.equal(home.state.drawer,false,'Apps does not open while editing');
    home.back();assert.equal(home.state.homeEdit,false);
    home.setState({homeEdit:true});home.renderVals().homeEdit.done();assert.equal(home.state.homeEdit,false);
    home.setState({homeEdit:true,homeAdd:true});home.goHome();assert.equal(home.state.homeEdit,false);assert.equal(home.state.homeAdd,false);
    home.setState({homeEdit:true});home.openView('notes');assert.equal(home.state.homeEdit,false);assert.deepEqual(opened,['notes']);
    assert.match(renderToStaticMarkup(home.renderVals().homeShell),/aria-label="Apps"/,'the Apps tile returns after editing');
  } finally { home.componentWillUnmount(); globalThis.requestAnimationFrame=previousFrame; if(previous===undefined)delete globalThis.document;else globalThis.document=previous; }
});

test('default Alpha Home performs no installed-app scan until the drawer opens', async () => {
  const previous=globalThis.document;
  globalThis.document=Object.assign(new EventTarget(),{hidden:false});
  let reads=0,saved=null;
  const Shell=shellClass([]);
  try {
    const shell=installHomeShell(Shell,{},{list:async()=>{reads++;return {apps};},launch:async()=>{}},{appInventory:'simulated',favorites:{read:()=>saved,write:keys=>{saved=[...keys];}}});
    const home=new Shell();home.renderVals();home.componentDidMount();
    await new Promise(setImmediate);assert.equal(reads,0);
    home.openAllApps();await new Promise(setImmediate);assert.equal(reads,1);
    assert.equal(shell.launcher.snapshot().apps.length,apps.length+PRODUCT.length);
    home.componentWillUnmount();
  } finally { if(previous===undefined)delete globalThis.document;else globalThis.document=previous; }
});

test('installed favorites with older Alpha view ids are migrated to canonical ids before the first read', () => {
  const store=new Map([['alpha.launcher.favorites.v1',JSON.stringify({version:2,keys:['alpha:notes','com.android.settings','alpha:workflows'],defaultPolicy:'alpha-apps'})]]);
  const storage=()=>({getItem:key=>store.get(key)??null,setItem:(key,value)=>{store.set(key,value);}});
  const shell=installHomeShell(shellClass([]),{},{list:async()=>({apps}),launch:async()=>{}},{storage});
  assert.deepEqual(JSON.parse(store.get('alpha.launcher.favorites.v1')),{version:2,keys:['alpha:notes','com.android.settings','alpha:automations'],defaultPolicy:'alpha-apps'});
  assert.deepEqual(shell.launcher.snapshot().favorites,['alpha:notes','com.android.settings','alpha:automations']);
  assert.deepEqual(shell.migration,{status:'migrated',renamed:1},'the shared launcher join reports the one migration');
  // A later start finds nothing left to rename; the record keeps Alpha's own format.
  assert.deepEqual(installHomeShell(shellClass([]),{},{list:async()=>({apps}),launch:async()=>{}},{storage}).migration,{status:'unchanged'});
  shell.launcher.toggleFavorite({packageName:'alpha:notes',label:'Notes'});
  assert.deepEqual(JSON.parse(store.get('alpha.launcher.favorites.v1')),{version:2,keys:['com.android.settings','alpha:automations'],defaultPolicy:'alpha-apps'});
});

test('Home has its built-in tiles without an installed app inventory', () => {
  const Shell = shellClass([]);
  let reads = 0;
  installHomeShell(Shell, {}, {list: async () => {reads++;return {apps};}, launch: async () => {}},
    {favorites: {read: () => null, write: () => {}}});
  const home = new Shell();
  const {homeShell, allAppsDrawer, drawerOpen} = home.renderVals();
  assert.ok(tiles(renderToStaticMarkup(homeShell)).includes('Calendar'));
  assert.ok(!tiles(renderToStaticMarkup(homeShell)).some(label => /^(All )?[Aa]pps$/.test(label)));
  assert.equal(allAppsDrawer, null);
  assert.equal(drawerOpen, false);
  home.openAllApps();
  assert.equal(reads, 0);
  assert.equal(home.state.drawer, false);
});

test('the empty Home card row is hidden without hiding app tiles', () => {
  const Shell = shellClass([]);
  const render = Shell.prototype.renderVals;
  Shell.prototype.renderVals = function () {
    return {...render.call(this), homeHasOverviewCards: false};
  };
  installHomeShell(Shell, {}, {list: async () => ({apps: []}), launch: async () => {}},
    {favorites: {read: () => null, write: () => {}}});
  const {homeShell} = new Shell().renderVals();
  const markup = renderToStaticMarkup(cloneElement(homeShell, {cards: createElement('div')}));
  assert.match(markup, /<div class="scr" hidden="" style="display:none" data-mobile-shell-cards=""/);
  assert.ok(tiles(markup).includes('Calendar'));
});

test('Back leaves edit mode under voice or an open conversation, and a menu whose app is gone costs no extra Back', async () => {
  const previous=globalThis.document;
  globalThis.document=Object.assign(new EventTarget(),{hidden:false});
  const based=[];
  class Shell extends shellClass([]) { back(){based.push({...this.state});super.back();} }
  const shell=installHomeShell(Shell,{},{list:async()=>({apps}),launch:async()=>{}},{appInventory:'simulated',favorites:{read:()=>[],write:()=>{}}});
  const home=new Shell();home.renderVals();home.componentDidMount();
  try {
    await shell.launcher.load();
    // Voice or the conversation sheet is above edit mode: the base Back handles it, edit mode stays.
    for (const above of [{voice:'listening'},{chat:'sheet'},{chat:'full'}]) {
      home.setState({homeEdit:true,homeAdd:true,voice:'off',chat:'rest',...above});based.length=0;
      home.back();
      assert.equal(home.state.homeEdit,true,`edit mode stays under ${JSON.stringify(above)}`);
      assert.equal(home.state.homeAdd,true);
      assert.equal(based.length,1,'the base Back ran');
    }
    home.setState({voice:'off',chat:'rest'});
    home.back();assert.equal(home.state.homeAdd,false);
    home.back();assert.equal(home.state.homeEdit,false);
    // An entry removed while its menu is open: no menu shows, and one Back closes the drawer.
    home.openAllApps();await shell.launcher.load();
    home.setState({drawerMenu:'org.example.gone'});
    assert.doesNotMatch(renderToStaticMarkup(home.renderVals().allAppsDrawer),/role="menu"/);
    home.back();
    assert.equal(home.state.drawer,false,'the first Back closes the drawer');
    assert.equal(home.state.drawerMenu,null);
  } finally { home.componentWillUnmount(); if(previous===undefined)delete globalThis.document;else globalThis.document=previous; }
});

test('a favorites save that fails in Home edit mode shows its error in the edit bar; the next good edit clears it', async () => {
  const previous=globalThis.document,previousFrame=globalThis.requestAnimationFrame;
  globalThis.document=Object.assign(new EventTarget(),{hidden:false,querySelector:()=>null,elementsFromPoint:()=>[]});
  globalThis.requestAnimationFrame=()=>0;
  let saved=['alpha:inbox','alpha:notes'],fail=false;
  const Shell=shellClass([]);
  const shell=installHomeShell(Shell,{},{list:async()=>({apps}),launch:async()=>{}},{appInventory:'simulated',favorites:{read:()=>saved,write:keys=>{if(fail)throw Error('full');saved=[...keys];}}});
  const home=new Shell();home.renderVals();home.componentDidMount();
  const tile=key=>{const face={getAttribute:()=>key};const el={querySelector:()=>face,style:{},setAttribute(){},removeAttribute(){}};el.closest=s=>s==='[data-mobile-shell-tile]'?el:null;return el;};
  const event=(target,extra={})=>{const e={target,button:0,clientX:0,clientY:0,detail:0,preventDefault(){},stopPropagation(){},...extra};return e;};
  try {
    await shell.launcher.load();
    home.setState({homeEdit:true});
    assert.equal(home.renderVals().homeEdit.error,'');
    fail=true;
    home.renderVals().homeShell.props.gridProps.onClickCapture(event(tile('alpha:notes')));
    assert.deepEqual(saved,['alpha:inbox','alpha:notes'],'nothing changed');
    assert.match(home.renderVals().homeEdit.error,/Favorites could not be saved/);
    fail=false;
    home.renderVals().homeShell.props.gridProps.onKeyDown(event(tile('alpha:inbox'),{key:'ArrowRight'}));
    assert.deepEqual(saved,['alpha:notes','alpha:inbox']);
    assert.equal(home.renderVals().homeEdit.error,'');
  } finally { home.componentWillUnmount(); globalThis.requestAnimationFrame=previousFrame; if(previous===undefined)delete globalThis.document;else globalThis.document=previous; }
  const {readFileSync}=await import('node:fs');
  assert.match(readFileSync(new URL('../apps/app/src/prototype/template.html',import.meta.url),'utf8'),/<sc-if value="\{\{homeEdit\.error\}\}"><p role="alert"[^>]*>\{\{homeEdit\.error\}\}<\/p><\/sc-if>/);
});
