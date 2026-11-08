import React, {act, Component, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {installHomeShell} from '../../../../apps/app/src/prototype/home-shell';
import {appKey, type InstalledApp, type LaunchTarget} from '../../../../.eliza/client-features/plugins/plugin-native-system/src/client/launcher';
import {navigateMobileShell, type MobileShellNavigationAction} from '../../../../.eliza/client-features/packages/ui/src/mobile-shell/navigation';

const catalog: Record<number, InstalledApp> = {
  1: {packageName:'org.fixture.clock',activityName:'org.fixture.clock.Main',label:'Clock'},
  2: {packageName:'org.fixture.mail',activityName:'org.fixture.mail.Main',user:'10',profile:'work',label:'Mail'},
};
const keys = new Map(Object.entries(catalog).map(([id, app]) => [appKey(app), Number(id)]));
const selected = (key: string | null | undefined) => key ? keys.get(key) ?? 0 : 0;
const required = <T,>(value: T | null | undefined, label: string): T => {
  if (value == null) throw Error(label);
  return value;
};
const same = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) throw Error(`${label}: ${String(actual)} differs from ${String(expected)}`);
};
const browser = globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean; quintDrawerPort?: unknown; quintDrawerFixture?: unknown};
browser.IS_REACT_ACT_ENVIRONMENT = true;

type DrawerRef = {press?: {pointer: number; key: string} | null; swallow?: string; opened?: string | null};
type HostState = {drawer:boolean;drawerQ:string;drawerMenu:string|null;view:null;stack:[]};
type HomeOut = {isOn:boolean;isView:boolean;homeHidden:boolean;drawerOpen?:boolean;allAppsDrawer?:ReactNode};
class HostBase extends Component<Record<string, never>, HostState> {
  state: HostState = {drawer:false,drawerQ:'',drawerMenu:null,view:null,stack:[]};
  S() {return this.state;}
  componentDidMount() {}
  componentWillUnmount() {}
  shellNavigate(action: MobileShellNavigationAction) {
    const next = navigateMobileShell({view:this.state.view,stack:this.state.stack,drawer:this.state.drawer,drawerQuery:this.state.drawerQ},action);
    return {drawer:next.drawer,drawerQ:next.drawerQuery};
  }
  renderVals(): HomeOut {return {isOn:true,isView:false,homeHidden:this.state.drawer};}
  render() {
    const out = this.renderVals();
    return out.drawerOpen ? out.allAppsDrawer : null;
  }
}
type Host = HostBase & {openAllApps(): void};

function mount(selectedFavorites: number[]) {
  const timers = new Map<number, () => void>(), retired: (() => void)[] = [];
  let timerId = 0, inventory = [1, 2], favorites = selectedFavorites.map(id => appKey(catalog[id]));
  let owner: Host | null = null, lastLaunch = 0, infoTarget = 0, infoNotice = false;
  let information: {resolve:()=>void;reject:(error:Error)=>void} | null = null;
  const port = {
    inspect: undefined as (() => DrawerRef) | undefined,
    setTimeout(run: () => void, duration: number) {
      same(duration,450,'Actual hold duration');
      same(timers.size,0,'Single drawer hold');
      timers.set(++timerId,run);
      return timerId;
    },
    clearTimeout(id: number) {
      retired.push(required(timers.get(id),'Held timer cancelled'));
      timers.delete(id);
    },
  };
  browser.quintDrawerPort = port;
  function exact(target: LaunchTarget) {
    const id = required(keys.get(appKey(target)),'Exact launcher component and profile');
    same(target.packageName,catalog[id].packageName,'Package');
    same(target.activityName,catalog[id].activityName,'Activity');
    same(target.user,catalog[id].user,'Profile');
    return id;
  }
  class DrawerHost extends HostBase {
    toast(message: string) {
      same(message,`${catalog[infoTarget].label} info could not be opened. Fixture refusal`,'Actual App Info failure notice');
      infoNotice = true;
    }
  }
  const shell = installHomeShell(DrawerHost,{},{
    list:async()=>({apps:inventory.map(id=>catalog[id])}),
    launch:async target=>{lastLaunch=exact(target);},
  },{
    appInventory:'simulated',follow:false,
    favorites:{read:()=>favorites,write(value){favorites=[...value];}},
    appInfo(target) {
      same(information,null,'One outstanding App Info call');
      infoTarget=exact(target);
      return new Promise<void>((resolve,reject)=>{information={resolve,reject};});
    },
  });
  const root = createRoot(required(document.getElementById('mount'),'Fixture root'));
  const drawer = () => document.querySelector<HTMLDivElement>('[data-alpha-apps-drawer]');
  const rootDrawer = () => required(drawer(),'Open Apps drawer');
  const input = () => required(rootDrawer().querySelector<HTMLInputElement>('[aria-label="Search apps"]'),'Search input');
  const openMenu = () => rootDrawer().querySelector<HTMLDivElement>('[data-launcher-menu]');
  const menu = () => required(openMenu(),'Open app menu');
  const tile = (id:number) => required(rootDrawer().querySelector<HTMLButtonElement>(
    `[data-launcher-app="${CSS.escape(appKey(catalog[id]))}"] > button`),'Visible app tile');
  const button = (root:Element,label:string) => required(root.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`),label);
  const menuItem = (label:string) => required([...menu().querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    .find(item=>item.textContent?.trim()===label),label);
  const host = () => required(owner,'Mounted Alpha Home adapter');
  const pointer = (target:Element,type:string,id:number,far=false) => target.dispatchEvent(new PointerEvent(type,{
    bubbles:true,cancelable:true,pointerType:'touch',pointerId:id,button:0,clientX:far?11:0,
  }));
  const key = (target:Element,value:string) => target.dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
  const appFor = (node:Element|null) => selected(node?.closest('[data-launcher-app]')?.getAttribute('data-launcher-app'));
  function focus() {
    const element = document.activeElement;
    if (element === inputWhenPresent()) return {kind:'search',app:0};
    if (element?.id==='outside') return {kind:'outside',app:0};
    const app = appFor(element);
    if (app && element?.closest('[data-launcher-menu]'))
      return {kind:element.textContent?.trim()==='App info'?'info':'add',app};
    return app ? {kind:'tile',app} : {kind:'body',app:0};
  }
  function inputWhenPresent() {return drawer()?.querySelector('[aria-label="Search apps"]');}
  const operations = {
    openDrawer() {host().openAllApps();},
    closeDrawer() {button(rootDrawer(),'Close apps').click();},
    async replaceInventory(ids:number[]) {inventory=ids;await shell.launcher.load();},
    search(value:string) {
      const search = input();
      search.focus();
      required(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set,'Native input setter').call(search,value);
      search.dispatchEvent(new Event('input',{bubbles:true}));
    },
    down(id:number,owner:number) {pointer(tile(id),'pointerdown',owner);},
    movePointer(id:number,owner:number,far:boolean) {pointer(tile(id),'pointermove',owner,far);},
    release(owner:number,cancel=false) {
      const target=required(rootDrawer().querySelector('[data-launcher-app] > button'),'Release target');
      pointer(target,cancel?'pointercancel':'pointerup',owner);
    },
    hold() {
      same(timers.size,1,'Current timer exists');
      const [id,run]=required(timers.entries().next().value,'Current timer');
      timers.delete(id);
      run();
    },
    oldTimeout() {required(retired.at(-1),'Earlier retired timer')();},
    context(id:number) {tile(id).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));},
    tap(id:number) {tile(id).click();},
    focusOutside() {required(document.getElementById('outside'),'Outside focus target').focus();},
    focusSearch() {input().focus();},
    menuKey(value:string) {key(required(document.activeElement,'Focused menu item'),value);},
    escape() {key(rootDrawer(),'Escape');},
    closeMenu() {button(rootDrawer(),'Close menu').click();},
    addHome() {menuItem('Add to Home').click();},
    appInfo() {const info=menuItem('App info');info.focus();info.click();},
    async infoReply(ok:boolean) {
      const waiting=required(information,'Current App Info call');
      information=null;
      if(ok)waiting.resolve();else waiting.reject(Error('Fixture refusal'));
      await Promise.resolve();
    },
  };
  function observe() {
    const element=drawer(), view=host().S(), refs=element?port.inspect?.():undefined;
    const actualMenu = appFor(element?.querySelector('[data-launcher-menu]') ?? null);
    same(selected(view.drawerMenu),actualMenu,'Committed menu owner matches the host selection');
    if(refs) same(selected(refs.opened),actualMenu,'Focus restoration sees the committed menu');
    same(!!refs?.press,!!timers.size,'React press ref owns the live timer');
    const projected = shell.launcher.snapshot();
    return {'s.open':!!element,'s.inventory':projected.apps.map(app=>selected(appKey(app))).filter(Boolean),
      's.query':view.drawerQ,'s.menu':actualMenu,'s.press':{pointer:refs?.press?.pointer??0,app:selected(refs?.press?.key)},
      's.swallow':selected(refs?.swallow),'s.focus':focus(),
      's.favorites':projected.favorites.map(selected).filter(Boolean),'s.lastLaunch':lastLaunch,
      's.infoTarget':infoTarget,'s.infoPending':!!information,'s.infoNotice':infoNotice,
      visible:element?[...element.querySelectorAll('[data-launcher-app]')].map(appFor):[]};
  }
  return {
    async start() {
      await act(async()=>{root.render(<DrawerHost ref={node=>{owner=node as Host|null;}}/>);});
      await act(async()=>{await shell.launcher.load();});
      return observe();
    },
    async step(operation:keyof typeof operations,args:unknown[]) {
      await act(async()=>{await Reflect.apply(operations[operation],operations,args);});
      return observe();
    },
    async close() {await act(async()=>{root.unmount();});},
  };
}
let campaign: ReturnType<typeof mount> | undefined;
browser.quintDrawerFixture = {
  async reset(favorites:number[]) {
    await campaign?.close();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    campaign=mount(favorites);
    return campaign.start();
  },
  step(operation:Parameters<ReturnType<typeof mount>['step']>[0],args:unknown[]) {return required(campaign,'Fixture campaign').step(operation,args);},
  async close() {await campaign?.close();campaign=undefined;},
};
