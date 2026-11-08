import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from './support/strip-types.mjs';import vm from 'node:vm';import {JSDOM} from 'jsdom';
const read=p=>readFileSync('apps/app/src/'+p,'utf8');
const ts=s=>stripTypeScriptTypes(s,{mode:'transform'}).replace(/^export /gm,'');
const between=(s,a,b)=>{const x=s.indexOf(a),y=s.indexOf(b,x);assert.ok(x>=0&&y>x,a);return s.slice(x,y);};
test('Settings Back restores a replaced uniquely named control',()=>{
 const dom=new JSDOM('<div id="pages"><div data-settings-page="Settings"><button aria-label="First">First</button><button aria-label="Google">Google</button></div></div>');const document=dom.window.document;
 const s=read('prototype/model.js'),body=between(s,'var stPageFocus =','/* the prototype page');
 const f=vm.runInNewContext(body+';stPageAccess',{document,Map,WeakMap,Array});const root=document.querySelector('#pages'),top=root.firstElementChild;f(root);top.querySelector('[aria-label="Google"]').focus();
 const child=document.createElement('div');child.setAttribute('data-settings-page','Google');child.innerHTML='<button>Back</button>';root.append(child);f(root);
 top.innerHTML='<button aria-label="First">First</button><button aria-label="Google">Google</button>';child.remove();f(root);
 assert.equal(document.activeElement.getAttribute('aria-label'),'Google');assert.equal(top.inert,false);dom.window.close();
});
test('Home keeps widget shells visible without inventing data or reading a provider',()=>{
 const s=read('prototype/data-adapter.ts'),body=between(s,'export function installHomeCardVisibility(','/** Neutral Home');let values={},opens=0;
 class Shell{renderVals(){return values;}}
 vm.runInNewContext(ts(body)+';installHomeCardVisibility(Shell,()=>opens())',{Shell,Date,formatFullDate:()=> 'Saturday, November 7',opens:()=>opens++});const shell=new Shell();
 for(const connected of [undefined,true,false]){values={homeGoogleConnected:connected};const out=shell.renderVals();assert.equal(out.homeShowDate,false);assert.equal(out.homeShowSetup,false);assert.equal(out.homeShowCalendar,true);assert.equal(out.homeShowInbox,true);assert.equal(out.homeShowWorkflows,true);assert.equal(out.homeCalendarHasEvent,undefined);assert.equal(out.homeInboxHasRows,undefined);}
 for(const key of ['homeCalendarHasEvent','homeWorkflowHasRows','homeInboxHasRows','homeBriefHas']){values={[key]:true,homeGoogleConnected:false};const out=shell.renderVals();assert.equal(out[key],true);assert.equal(out.homeShowDate,false);assert.equal(out.homeShowSetup,false);}
 assert.equal(opens,0);shell.renderVals().connectGoogle();assert.equal(opens,1);
});

function announcer(){const dom=new JSDOM('<body><input id="composer"></body>'),document=dom.window.document;let hidden=false;Object.defineProperty(document,'hidden',{get:()=>hidden});let frame=0;const frames=new Map();
 const s=read('prototype/subview-accessibility.ts'),body=s.slice(s.indexOf('type ReplyShell ='));
 class Shell{state={screen:'home',msgs:[{id:'u1',from:'user',text:'Hi'}]};connectionSession='one';live=true;voice=false;S(){return this.state;}voiceConversationActive(){return this.voice;}componentDidMount(){}componentDidUpdate(){}componentWillUnmount(){} }
 vm.runInNewContext(ts(body)+';installReplyAnnouncer(Shell)',{Shell,document,requestAnimationFrame:f=>{frames.set(++frame,f);return frame;},cancelAnimationFrame:id=>frames.delete(id)});
 const shell=new Shell();shell.componentDidMount();const flush=()=>{for(const [id,f] of [...frames]){frames.delete(id);f();}};flush();document.querySelector('#composer').focus();
 const update=patch=>{const before=shell.state;shell.state={...before,...patch};shell.componentDidUpdate({},before);};return {shell,document,update,flush,hide:()=>hidden=true,text:()=>document.querySelector('[data-alpha-reply-announcer]')?.textContent,close:()=>dom.window.close()};}
test('screen reader hears replying then one settled reply, never streamed tokens or focus movement',()=>{
 const f=announcer();try{f.update({typing:true});f.flush();assert.equal(f.text(),'Alpha is replying');f.update({msgs:[{id:'u1',from:'user'},{id:'a1',from:'agent',text:'par',streaming:true}]});f.flush();assert.equal(f.text(),'Alpha is replying');f.update({typing:false,msgs:[{id:'u1',from:'user'},{id:'a1',from:'agent',text:'Hello',streaming:false}]});f.flush();assert.equal(f.text(),'Hello');assert.equal(f.document.activeElement.id,'composer');}finally{f.close();}});
for(const retire of ['hidden','unmounted','owner','owner-before-frame','voice'])test(`queued announcement cannot escape ${retire}`,()=>{
 const f=announcer();try{f.update({typing:true});if(retire==='hidden')f.hide();if(retire==='unmounted')f.shell.componentWillUnmount();if(retire==='owner'){f.shell.connectionSession='two';f.update({msgs:[{id:'v1',from:'user'}],typing:false});}if(retire==='owner-before-frame')f.shell.connectionSession='two';if(retire==='voice')f.shell.voice=true;f.flush();assert.ok(!f.text());}finally{f.close();}});
test('a replaced conversation history is not read aloud',()=>{const f=announcer();try{f.update({msgs:[{id:'u2',from:'user'},{id:'a2',from:'agent',text:'Old saved answer'}]});f.flush();assert.equal(f.text(),'');}finally{f.close();}});

test('Settings row identity survives asynchronous insertion and nested Back retains parent',()=>{
 const s=read('prototype/settings-adapter.ts');const body=between(s,'    // Stable identities keep focused controls attached','    if(!Capacitor.isNativePlatform())');
 const normalize=out=>vm.runInNewContext(ts(body)+';out',{out,Map,JSON,String});
 const first=normalize({stack:[{title:'Settings',groups:[{cap:'Account',rows:[{label:'Google'},{label:'About'}]}]}]});
 const second=normalize({stack:[{title:'Settings',groups:[{cap:'Account',rows:[{label:'Finish setup'},{label:'Google'},{label:'About'}]}]}]});
 assert.equal(first.stack[0].groups[0].id,second.stack[0].groups[0].id);assert.equal(first.stack[0].groups[0].rows[1].id,second.stack[0].groups[0].rows[2].id);
 const back=between(s,'  const categoryNames:','  definition.render =');const calls=[],definition={back:()=>false};vm.runInNewContext(ts(back),{definition,PASSWORD_PAGES:['password-provider','password-entry'],leavePasswordManager:()=>calls.push('leave-manager'),leavePasswordEntry:()=>calls.push('leave-entry')});
 assert.equal(definition.back({page:'password-entry'},{set:p=>calls.push(p.page)}),true);assert.deepEqual(calls,['leave-entry','password-provider']);
});
test('keyboard hide and background retire composer focus without changing the draft',()=>{
 const s=read('prototype/chat-overlay-motion-adapter.ts'),body=between(s,'\t\tconst free = keyboardFreeHeight();','\n\t};\n\tp.componentDidUpdate');
 let height=800,hidden=false,blurs=0;const listeners=new Map(),active={matches:()=>true,blur(){blurs++;}};
 const shell={chatInputFocused:true,chatScrimPress:{pointer:1},draft:'Keep this draft'};class Element{}Object.setPrototypeOf(active,Element.prototype);
 const window={innerWidth:400,get innerHeight(){return height;},visualViewport:{get height(){return height;},addEventListener:(type,fn)=>listeners.set('vv'+type,fn)},addEventListener(){}};
 const document={get hidden(){return hidden;},activeElement:active,documentElement:{clientWidth:400,get clientHeight(){return height;}},addEventListener:(type,fn)=>listeners.set(type,fn)};
 vm.runInNewContext('(function(){'+ts(body)+'}).call(shell)',{shell,window,document,HTMLElement:Element,keyboardFreeHeight:()=>{let max=0;return(_w,h,editing)=>{if(!editing)max=h;return max||h;};},isEditing:()=>true});
 height=500;shell.dockKeyboardWatch();height=800;shell.dockKeyboardWatch();assert.equal(blurs,1);
 hidden=true;shell.dockHiddenWatch();assert.equal(shell.chatInputFocused,false);assert.equal(shell.chatScrimPress,undefined);assert.equal(shell.draft,'Keep this draft');
});

test('About exposes the existing Connection help controller and Back returns to About',()=>{
 const s=read('prototype/settings-adapter.ts'),body=between(s,'    const connectionHelpRow =','    const licensesRow =');
 const calls=[],api={set:patch=>calls.push(patch.page)},connectionController={open:()=>calls.push('connection')};
 const row=native=>vm.runInNewContext(ts(body)+';connectionHelpRow()',{connection:{name:'Alpha'},Capacitor:{isNativePlatform:()=>native},testMocksEnabled:false,api,connectionController});
 assert.equal(row(true).label,'Connection help');row(true).go();assert.deepEqual(calls,['agent-connection']);
 row(false).go();assert.deepEqual(calls,['agent-connection','connection']);
 assert.match(s,/group\(\[licensesRow\(\),connectionHelpRow\(\)\]\)/);
 const back=between(s,'  const categoryNames:','  definition.render ='),definition={back:()=>false};
 vm.runInNewContext(ts(back),{definition,PASSWORD_PAGES:[],leavePasswordManager(){},leavePasswordEntry(){}});
 assert.equal(definition.back({page:'agent-connection'},{set:patch=>calls.push(patch.page)}),true);
 assert.equal(calls.at(-1),'about');
});
