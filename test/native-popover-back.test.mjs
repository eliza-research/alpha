import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=readFileSync('apps/app/src/prototype/agent-adapter.ts','utf8');
const begin=source.indexOf('this.backHandler = (event: Event) => {'),end=source.indexOf("window.addEventListener('alpha-back', this.backHandler)",begin);
assert.ok(begin>=0&&end>begin);
const code=stripTypeScriptTypes(source.slice(begin,end),{mode:'transform'});
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
