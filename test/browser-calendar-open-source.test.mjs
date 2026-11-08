import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';

const adapter=readFileSync('apps/app/src/prototype/browser-adapter.ts','utf8');
const calendar=readFileSync('apps/app/src/prototype/agent-calendar-adapter.ts','utf8');
const scope=calendar.slice(calendar.indexOf('export const browserCalendarScope='),calendar.indexOf('export const deviceCalendarScope='));
const handler=adapter.slice(adapter.indexOf('  const openBrowserView ='),adapter.indexOf("  window.addEventListener('alpha:browser-open-view'"));
function open({testMocks=true,platform='web',authority='browser-local',view='calendar'}={}){
 const calls=[],shell={vget:()=>({calendarAuthority:authority}),openView:(...args)=>calls.push(args)};
 const execute=new Function('shell','testMocksEnabled','Capacitor',stripTypeScriptTypes(scope.replace('export ', '')+handler, {mode:'transform'})+';return openBrowserView;')(shell,testMocks,{getPlatform:()=>platform});
 execute({detail:view});return calls;
}
test('a browser Calendar link preserves an explicitly selected source',()=>{
 assert.deepEqual(open(),[['calendar',{calendarAuthority:'browser-local'}]]);
});
test('ordinary, native and production Calendar links never adopt the browser source',()=>{
 for(const setup of [{authority:'canonical'},{authority:'legacy'},{authority:'android-native',platform:'android'},{platform:'android'},{testMocks:false}]){
  assert.deepEqual(open(setup),[['calendar',undefined]],JSON.stringify(setup));
 }
});
test('another browser view never receives Calendar authority',()=>{
 for(const view of ['browser','notes','files','workflows'])assert.deepEqual(open({view}),[[view,undefined]]);
});
