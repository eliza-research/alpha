/** Explicit closed browser-test ports installed by Playwright; never a product window contract. */
import type {connectionController} from '../apps/app/src/runtime/connection-ui.tsx';
import type {phoneContextMessage} from '../apps/app/src/runtime/phone-context.ts';
interface NativeFixtureBridge {
 PluginHeaders:{name:string;methods:{name:string;rtype:string}[]}[];
 nativePromise:(plugin:string,method:string,input:Record<string,any>)=>Promise<unknown>;
 nativeCallback?:(plugin:string,method:string,input:Record<string,any>,callback:(value:unknown)=>void)=>string;
}
interface BookmarkFixture {reads:number;writes:number;failNext:boolean;rows:string[];activeWrites:number;maxWrites:number;releases:(()=>void)[];hold:boolean;resume:()=>void}
interface AgentContextFixture {requests:ReturnType<typeof phoneContextMessage>[];delayed:boolean;aborts:number;closes:number;releases:(()=>void)[];controller:typeof connectionController}
interface InboxBrowserFixture {calls:string[];account:string;session:string;owner:string;snapshot?:{cloudAccount:{environment:string;userId:string;sessionId:string;credentialId:string;[field:string]:unknown};[field:string]:unknown}}
interface DocumentsFixture {status:string;exports:Record<string,unknown>[];imports:number}
declare global {
 interface Window {
  androidBridge:Record<string,unknown>;
  Capacitor:NativeFixtureBridge;
  bookmarkFixture:BookmarkFixture;
  fixture:AgentContextFixture;
  rateFixture:{mode:string;posts:number;creates:number;successes:number;paths:string[];accountReads:number};
  documentsFixture:DocumentsFixture;
  inboxFixture:InboxBrowserFixture;
  authorizationUrl:string;
  emitCallback:(value:{state:string;code?:string;error?:string})=>void;
  storedCallback:()=>{state:string;code?:string;error?:string}|null;
  switchOwner:(owner?:string)=>void;
  connected:number;
  opened:number;
  holdClear:boolean;
  releaseClear:()=>void;
  raceExchange:((slot?:string)=>void)|null;
  releaseDraftSave:()=>void;
  fixtureRead:(slot:string)=>Promise<unknown>;
  fixtureCAS:(...args:unknown[])=>Promise<unknown>;
  fixtureOriginalCAS:(...args:any[])=>Promise<unknown>;
 }
}
export {};
