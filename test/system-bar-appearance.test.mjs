import test from 'node:test';import assert from 'node:assert/strict';
import {installSystemBarAppearance} from '../apps/app/src/prototype/system-bar-appearance.ts';
function shell(native=true,fail=false){
 const sent=[],calls=[];class Shell{componentDidMount(){calls.push('mount');}componentDidUpdate(){calls.push('update');}}
 installSystemBarAppearance(Shell,native,{setSystemBarAppearance:input=>{sent.push(input.dark);return fail?Promise.reject(Error('x')):Promise.resolve();}});
 const s=new Shell();s.props={theme:'light'};s.state={};return {s,sent,calls};
}
test('the drawn theme drives Android bar icons once per change, natively only',()=>{
 const {s,sent,calls}=shell();s.componentDidMount();s.componentDidUpdate();
 for(const theme of ['dark','dark',null,'light','system'])s.state={theme},s.componentDidUpdate();
 assert.deepEqual(sent,[false,true,false]);assert.deepEqual(calls.slice(0,2),['mount','update']);
 const web=shell(false);web.s.componentDidMount();web.s.state={theme:'dark'};web.s.componentDidUpdate();assert.deepEqual(web.sent,[]);assert.deepEqual(web.calls,['mount','update']);
});
test('a failed native call is retried on the next update',async()=>{
 const {s,sent}=shell(true,true);s.state={theme:'dark'};s.componentDidMount();await new Promise(r=>setTimeout(r));s.componentDidUpdate();assert.deepEqual(sent,[true,true]);
});
