// Alpha's Home, app grid and All apps render from the shared mobile shell (@elizaos/ui/mobile-shell)
// with the product record in config/alpha-product.json. Shared controller and search cases live in
// the upstream mobile-shell and native-system suites.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';
import {renderToStaticMarkup} from 'react-dom/server';
const {installHomeShell}=await tsImport('../apps/app/src/prototype/home-shell.ts',import.meta.url);
const {navigateMobileShell}=await tsImport('../.eliza/client-features/packages/ui/src/mobile-shell/navigation.ts',import.meta.url);
const icon='data:image/png;base64,iVBORw0KGgo=';
const apps=[
 {packageName:'com.android.settings',label:'Settings',icon},
 {packageName:'org.example.camera',label:'Caméra'},
];
const PRODUCT=['alpha:inbox','alpha:calendar','alpha:browser','alpha:camera','alpha:photos','alpha:maps','alpha:notes','alpha:files','alpha:automations','alpha:settings'];

function shellClass(opened,toasts=[]){
  return class Shell {
    toast(message){toasts.push(message);}
    constructor(){this.state={drawer:false,drawerQ:''};}
    S(){return {view:null,stack:[],...this.state};}
    setState(patch){this.state={...this.state,...patch};}
    vget(){return {};}
    openView(key){opened.push(key);}
    shellNavigate(action){const next=navigateMobileShell({view:null,stack:[],drawer:!!this.state.drawer,drawerQuery:this.state.drawerQ||''},action);return {view:next.view,stack:[...next.stack],drawer:next.drawer,drawerQ:next.drawerQuery};}
    renderVals(){return {isOn:true,isView:false,homeHidden:false};}
  };
}
const tiles=markup=>[...markup.matchAll(/data-mobile-shell-tile="" aria-label="([^"]+)"/g)].map(match=>match[1]);

test('Home and All apps list the same favorites; product views open in Alpha, installed apps by component', async () => {
  const previous=globalThis.document;
  globalThis.document=Object.assign(new EventTarget(),{hidden:false});
  let saved=null;const opened=[],nativeCalls=[];
  const Shell=shellClass(opened);
  const shell=installHomeShell(Shell,{inbox:{badge:()=>true}},{list:async()=>({apps}),launch:async target=>{nativeCalls.push(target);}},
    {favorites:{read:()=>saved,write:keys=>{saved=[...keys];}}});
  const home=new Shell();
  let rendered=home.renderVals();
  home.componentDidMount();
  try {
  // Canonical ids, product order, labels from the record; Workflows is the automations view.
  assert.deepEqual(tiles(renderToStaticMarkup(rendered.homeShell)),['Inbox','Calendar','Browser','Camera','Photos','Maps','Notes','Files','Workflows','Settings','All apps']);
  const markup=renderToStaticMarkup(rendered.homeShell);
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
  assert.match(drawer,/aria-label="Open Settings \(Alpha Phone\)"/);assert.match(drawer,/aria-label="Open Settings \(com.android.settings\)"/);
  const find=key=>shell.launcher.snapshot().apps.find(app=>(app.packageName+(app.activityName?'/'+app.activityName:''))===key);
  await shell.launcher.launch(find('alpha:automations'));
  await shell.launcher.launch(find('alpha:settings'));
  assert.deepEqual(opened,['workflows','settings'],'product entries open the Alpha renderer view');
  assert.deepEqual(nativeCalls,[]);
  await shell.launcher.launch(find('com.android.settings'));
  assert.deepEqual(nativeCalls,[{packageName:'com.android.settings'}]);
  shell.launcher.toggleFavorite(find('com.android.settings'));
  shell.launcher.toggleFavorite(find('alpha:notes'));
  const homeTiles=tiles(renderToStaticMarkup(home.renderVals().homeShell));
  assert.equal(homeTiles.includes('Notes'),false);assert.equal(homeTiles.at(-2),'Settings');
  assert.match(renderToStaticMarkup(home.renderVals().homeShell),/<img alt="" src="data:image\/png;base64,iVBORw0KGgo="\/>/,'an installed favorite keeps its platform icon');
  // Back closes the drawer through the shared navigation state.
  home.setState(home.shellNavigate({type:'back'}));
  assert.equal(home.renderVals().drawerOpen,false);
  } finally { home.componentWillUnmount(); if(previous===undefined)delete globalThis.document;else globalThis.document=previous; }
});

test('default Alpha Home performs no installed-app scan until the drawer opens', async () => {
  const previous=globalThis.document;
  globalThis.document=Object.assign(new EventTarget(),{hidden:false});
  let reads=0,saved=null;
  const Shell=shellClass([]);
  try {
    const shell=installHomeShell(Shell,{},{list:async()=>{reads++;return {apps};},launch:async()=>{}},{favorites:{read:()=>saved,write:keys=>{saved=[...keys];}}});
    const home=new Shell();home.renderVals();home.componentDidMount();
    await new Promise(setImmediate);assert.equal(reads,0);
    home.openAllApps();await new Promise(setImmediate);assert.equal(reads,1);
    assert.equal(shell.launcher.snapshot().apps.length,apps.length+PRODUCT.length);
    home.componentWillUnmount();
  } finally { if(previous===undefined)delete globalThis.document;else globalThis.document=previous; }
});

test('with the drawer closed, Home toasts a failed launch and a failed app read once', async () => {
  const previous=globalThis.document;
  globalThis.document=Object.assign(new EventTarget(),{hidden:false});
  let saved=[...PRODUCT,'com.android.settings'],listing='ok';const toasts=[];
  const Shell=shellClass([],toasts);
  const shell=installHomeShell(Shell,{},{list:async()=>{if(listing==='fail')throw new Error('offline');return {apps};},launch:async()=>{throw new Error('Work apps are paused.');}},
    {favorites:{read:()=>saved,write:keys=>{saved=[...keys];}}});
  const home=new Shell();home.renderVals();home.componentDidMount();
  try {
    home.openAllApps();await new Promise(setImmediate);
    const settings=shell.launcher.snapshot().apps.find(app=>app.packageName==='com.android.settings');
    // The open drawer shows the launch error inline; no toast.
    await shell.launcher.launch(settings);
    assert.match(shell.launcher.snapshot().launchError,/Work apps are paused/);
    assert.deepEqual(toasts,[]);
    home.setState(home.shellNavigate({type:'drawer',open:false}));
    await shell.launcher.launch(shell.launcher.snapshot().apps.find(app=>app.packageName==='com.android.settings'));
    assert.deepEqual(toasts,['Settings could not be opened. Work apps are paused.']);
    // A failed read drops the pinned app from Home; repeated failed refreshes report it once.
    listing='fail';
    await shell.launcher.refresh();await shell.launcher.refresh();
    assert.equal(shell.launcher.snapshot().status,'failed');
    assert.deepEqual(toasts.slice(1),["Apps couldn't load. Open All apps to try again."]);
    // A failed launch whose follow-up read also fails reports only the launch.
    listing='ok';await shell.launcher.refresh();toasts.length=0;listing='fail';
    await shell.launcher.launch(shell.launcher.snapshot().apps.find(app=>app.packageName==='com.android.settings'));
    assert.equal(shell.launcher.snapshot().status,'failed');
    assert.deepEqual(toasts,['Settings could not be opened. Work apps are paused.']);
    // A background read that fails while another app is open does not toast over it.
    listing='ok';await shell.launcher.refresh();toasts.length=0;home.setState({view:'inbox'});listing='fail';
    await shell.launcher.refresh();
    assert.equal(shell.launcher.snapshot().status,'failed');
    assert.deepEqual(toasts,[]);
  } finally { home.componentWillUnmount(); if(previous===undefined)delete globalThis.document;else globalThis.document=previous; }
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
