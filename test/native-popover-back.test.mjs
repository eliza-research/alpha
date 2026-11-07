import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import vm from 'node:vm';
const source=readFileSync('apps/app/src/prototype/agent-adapter.ts','utf8');
const begin=source.indexOf('this.backHandler = (event: Event) => {'),end=source.indexOf("window.addEventListener('alpha-back', this.backHandler)",begin);
assert.ok(begin>=0&&end>begin);
const slice=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert.ok(a>=0&&b>a,from);return source.slice(a,b);};
const panels=stripTypeScriptTypes(slice('  function modalPanels(){','  // Native Back reaches'),{mode:'strip'});
const availability=stripTypeScriptTypes(slice('  function updateBackAvailability(','\n  const notesLeave'),{mode:'strip'});
const code=panels+stripTypeScriptTypes(source.slice(begin,end),{mode:'strip'});
function fixture({popover=true,dialog=false,supported=true,toast=false,fallback=false}={}){
 const calls={popover:0,focus:0,dialog:0,navigate:0,cancelReply:0};
 const menu={id:'alpha-mail-folders',hidePopover(){calls.popover++;popover=false;}};
 const mirror={id:'',dialogToast:true,hidePopover(){calls.popover++;}};
 const trigger={getAttribute:key=>key==='popovertarget'?menu.id:null,focus:()=>calls.focus++};
 const modal={dispatchEvent:()=>{calls.dialog++;return true;},close(){}};
 const context=vm.createContext({Event,dismissMailFolderMenu:()=>{if(!fallback)return false;fallback=false;calls.focus++;return true;},HTMLElement:{prototype:supported?{hidePopover(){}}:{}},getComputedStyle:()=>({visibility:'visible'}),document:{
  querySelectorAll:selector=>selector.startsWith('[popover]:popover-open')?(assert.ok(supported),[...(popover?[menu]:[]),...(toast?[mirror]:[])].filter(element=>!selector.includes(':not([data-alpha-dialog-toast])')||!element.dialogToast)):selector==='[popovertarget]'?[trigger]:selector==='dialog[open]'&&dialog?[modal]:[],
  querySelector:()=>({inert:false}),
 },connectionController:{cancelViewNavigation:()=>calls.cancelReply++},shell:{back:()=>calls.navigate++}});
 vm.runInContext('(function(){'+code+'}).call(shell)',context);
 return {calls,back:()=>{const event=new Event('alpha-back',{cancelable:true});context.shell.backHandler(event);return event;}};
}
test('native Back closes the popover first and preserves the underlying view and reply',()=>{
 const f=fixture({dialog:true});assert.equal(f.back().defaultPrevented,true);
 assert.deepEqual(f.calls,{popover:1,focus:1,dialog:0,navigate:0,cancelReply:0});
 assert.equal(f.back().defaultPrevented,true);
 assert.deepEqual(f.calls,{popover:1,focus:1,dialog:1,navigate:0,cancelReply:0});
});
test('normal Back still navigates, including hosts without the Popover API',()=>{
 for(const supported of [true,false]){const f=fixture({popover:false,supported});f.back();assert.deepEqual(f.calls,{popover:0,focus:0,dialog:0,navigate:1,cancelReply:1});}
});
test('a manual toast mirror never consumes Back from a dialog or after it closes',()=>{
 const dialog=fixture({popover:false,dialog:true,toast:true});dialog.back();
 assert.deepEqual(dialog.calls,{popover:0,focus:0,dialog:1,navigate:0,cancelReply:0});
 const page=fixture({popover:false,toast:true});page.back();
 assert.deepEqual(page.calls,{popover:0,focus:0,dialog:0,navigate:1,cancelReply:1});
});

test('legacy folder Back closes only its visible menu before shell navigation',()=>{
 const f=fixture({supported:false,popover:false,fallback:true});assert.equal(f.back().defaultPrevented,true);
 assert.deepEqual(f.calls,{popover:0,focus:1,dialog:0,navigate:0,cancelReply:0});
 f.back();assert.deepEqual(f.calls,{popover:0,focus:1,dialog:0,navigate:1,cancelReply:1});
});

// MainActivity forwards Back to the renderer only when alphaCanGoBack is true; otherwise standalone finishes.
const activity=readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/MainActivity.java','utf8');
const script=(()=>{const m=activity.match(/String script = "([^"]+)"\s*\+ \(BuildConfig\.IS_LAUNCHER[^?]+\? "[^"]+" : "([^"]+)"\) \+ "([^"]+)";/);assert.ok(m,'MainActivity Back script');return m[1]+m[2]+m[3];})();
function phone({drawer=false,digest=false}={}){
 const calls={navigate:0,cancel:0,back:0};
 const panel={closest:()=>null,getAttribute:()=>null,getClientRects:()=>[{}],dispatchEvent:event=>{if(event.type==='cancel')calls.cancel++;return true;}};
 const html={dataset:{}},state={view:null,drawer,shade:false,chat:'hidden',voice:'off'};
 const window={dispatchEvent:event=>{if(event.type==='alpha-back')calls.back++;return true;}};
 const context=vm.createContext({Event,window,dismissMailFolderMenu:()=>false,HTMLElement:{prototype:{hidePopover(){}}},getComputedStyle:()=>({visibility:'visible'}),document:{
  documentElement:html,
  querySelectorAll:selector=>selector.startsWith('[role="dialog"][aria-modal="true"]')&&digest?[panel]:[],
  querySelector:selector=>selector==='.os'?{inert:digest}:null,
 },connectionController:{getSnapshot:()=>({open:false}),cancelViewNavigation:()=>{}},shell:{S:()=>state,back:()=>calls.navigate++}});
 vm.runInContext(panels+availability+';updateBackAvailability(shell);(function(){'+code+'}).call(shell)',context);
 return {calls,html,native:()=>vm.runInContext(script,context),back:()=>context.shell.backHandler(new Event('alpha-back',{cancelable:true}))};
}
test('native Back reaches the renderer with the All apps drawer open, and closes it',()=>{
 const f=phone({drawer:true});assert.equal(f.html.dataset.alphaCanGoBack,'true');
 assert.equal(f.native(),true,'standalone keeps the Activity');assert.equal(f.calls.back,1);
 f.back();assert.equal(f.calls.navigate,1,'shell Back closes the drawer');
});
test('native Back reaches the renderer with the digest panel open, and asks the panel to close',()=>{
 const f=phone({digest:true});assert.equal(f.html.dataset.alphaCanGoBack,'true');
 assert.equal(f.native(),true);f.back();
 assert.deepEqual({navigate:f.calls.navigate,cancel:f.calls.cancel},{navigate:0,cancel:1},'the phone under the panel stays put');
});
test('root Home with nothing open still lets standalone finish',()=>{
 const f=phone();assert.equal(f.html.dataset.alphaCanGoBack,'false');assert.equal(f.native(),false);assert.equal(f.calls.back,0);
});
