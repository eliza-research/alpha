import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('Calendar connection entry retains session and draft fences without generic manager fallback',()=>{
 const source=readFileSync(new URL('../apps/app/src/prototype/agent-calendar-adapter.ts',import.meta.url),'utf8');
 const code=source.slice(source.indexOf(' p.calendarConnectionScope=function(){'),source.indexOf(' p.calendarSelection=function(){'));
 const shell={live:true,authority:'canonical',draft:{},messages:[],vget(){return this.draft;},toast(t){this.messages.push(t);}};
 shell.draft.calendarAuthority='canonical';
 let target={identity:{owner:'one'},sessionId:'s1',scope:{feature:'calendar'},current:()=>true};
 const calendar={state:{ownerKey:'one'}};shell.agentCalendar=calendar;
 const context={p:{},owner:shell,controller:calendar,port:()=>target,calendarOwnerKey:p=>p.identity.owner};
 vm.runInNewContext(code,context);const open=()=>context.p.calendarConnectionScope.call(shell);
 const scope=open();assert.ok(scope);assert.equal(scope.current(),true);assert.equal(scope.canChange(),true);
 for(const key of ['form']){shell.draft[key]={};assert.equal(scope.canChange(),false);assert.equal(open(),null);delete shell.draft[key];}
 for(const key of ['canonicalDraftText','canonicalDraftInvalid']){shell[key]=true;assert.equal(scope.canChange(),false);assert.equal(open(),null);delete shell[key];}
 for(const key of ['opening','consuming']){shell.canonicalDraft={state:{[key]:true}};assert.equal(scope.canChange(),false);assert.equal(open(),null);}delete shell.canonicalDraft;
 const original=target;target={...target,sessionId:'s2'};assert.equal(scope.current(),false);target=original;
 target={...target,scope:{feature:'other'}};assert.equal(scope.current(),false);target=original;
 target={...target,identity:{owner:'two'}};assert.equal(scope.current(),false);assert.equal(open(),null);target=original;
 for(const authority of ['android-native','browser-local','legacy','legacy-google']){shell.draft.calendarAuthority=authority;assert.equal(scope.current(),false);assert.equal(open(),null);}shell.draft.calendarAuthority='canonical';
 shell.live=false;assert.equal(scope.current(),false);shell.live=true;target=null;assert.equal(scope.current(),false);assert.equal(open(),null);target=original;
 context.controller={};assert.equal(scope.current(),false);context.controller=calendar;context.owner={};assert.equal(scope.current(),false);context.owner=shell;
 const settings=readFileSync(new URL('../apps/app/src/prototype/settings-adapter.ts',import.meta.url),'utf8');
 const section=settings.split('// calendar-settings:begin')[1].split('// calendar-settings:end')[0];
 assert.equal(section.includes('Review calendar sync'),false);assert.equal(section.includes('googleConnectionController.open()'),false);
 const handler=section.match(/go:\(\)=>\{const scope=owner\?\.calendarConnectionScope\?\.\(\);if\(scope\)googleConnectionController.openCalendar\(scope\);\}/)[0];
 let calls=[];vm.runInNewContext('('+handler.slice(3)+')()',{owner:{calendarConnectionScope:()=>scope},googleConnectionController:{openCalendar:s=>calls.push(s)}});assert.deepEqual(calls,[scope]);
 calls=[];vm.runInNewContext('('+handler.slice(3)+')()',{owner:{calendarConnectionScope:()=>null},googleConnectionController:{openCalendar:s=>calls.push(s)}});assert.deepEqual(calls,[]);
});
