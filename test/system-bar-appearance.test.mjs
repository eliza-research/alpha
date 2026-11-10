import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from './support/strip-types.mjs';import vm from 'node:vm';
const source=readFileSync('apps/app/src/prototype/settings-adapter.ts','utf8');
const slice=(a,b)=>{const x=source.indexOf(a),y=source.indexOf(b,x);assert.ok(x>=0&&y>x,a);return source.slice(x,y);};
function harness(native=true,fail=false){
 const sent=[];const code=stripTypeScriptTypes(slice('let systemBarTheme','\n}\n')+'\n}',{mode:'transform'});
 const context={sent,Capacitor:{isNativePlatform:()=>native},device:{setSystemBarAppearance:input=>{sent.push(input.dark);return fail?Promise.reject(Error('x')):Promise.resolve();}}};
 vm.runInNewContext(code+';globalThis.sync=syncSystemBars;',context);return context;
}
test('Alpha theme drives Android bar icons once per change, natively only',async()=>{
 const f=harness();for(const theme of ['light','light','dark','dark',undefined,'system','light'])f.sync(theme);
 assert.deepEqual(f.sent,[false,true,false]);
 const web=harness(false);web.sync('dark');assert.deepEqual(web.sent,[]);
 const failing=harness(true,true);failing.sync('dark');await new Promise(r=>setTimeout(r));failing.sync('dark');assert.deepEqual(failing.sent,[true,true]);
});
test('mount and every update send the drawn theme; native reapplies it after recreation',()=>{
 assert.match(source,/mount\.call\(this\); owner = this; syncSystemBars\(this\.state\?\.theme\|\|this\.props\?\.theme\);/);
 assert.match(slice('p.componentDidUpdate','p.componentWillUnmount'),/syncSystemBars\(theme\|\|this\.props\?\.theme\);/);
 const plugin=readFileSync('android/app/src/main/java/ai/alphacompute/alphaphone/AlphaDevicePlugin.java','utf8');
 assert.match(plugin,/setAppearanceLightStatusBars\(!dark\);bars\.setAppearanceLightNavigationBars\(!dark\);/);
 const activity=readFileSync('android/app/src/main/java/ai/alphacompute/alphaphone/MainActivity.java','utf8');
 assert.ok(activity.indexOf('AlphaDevicePlugin.applySystemBarAppearance(this);')>activity.indexOf('setNavigationBarContrastEnforced(false)'));
});
