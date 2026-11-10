import test from 'node:test';
import assert from 'node:assert/strict';
import {parseXmlTree} from '../vendor/eliza/packages/app/scripts/lib/android-manifest-facts.mjs';
import {appLinkFilters, requiredAppLinkProblems} from '../scripts/render-assetlinks.mjs';

const expected={host:'login.example.org',path:'/alphaphone/auth/callback',activity:'ai.elizaresearch.alphaphone.MainActivity'};
const attribute=(name,value,indent=8)=>`${' '.repeat(indent)}A: http://schemas.android.com/apk/res/android:${name}(0x01010000)=${value}`;
const quoted=(name,value,indent)=>attribute(name,JSON.stringify(value),indent);
function filter({host=expected.host,path=expected.path,autoVerify=true,scheme='https',pathKey='path',action='android.intent.action.VIEW',categories=['android.intent.category.DEFAULT','android.intent.category.BROWSABLE']}={}) {
 return ['      E: intent-filter (line=4)',
  ...(autoVerify===null?[]:[attribute('autoVerify',`(type 0x12)${autoVerify?'0xffffffff':'0x0'}`)]),
  '        E: action (line=5)',quoted('name',action,10),
  ...categories.flatMap(name=>['        E: category (line=6)',quoted('name',name,10)]),
  '        E: data (line=7)',quoted('scheme',scheme,10),quoted('host',host,10),quoted(pathKey,path,10),
 ].join('\n');
}
function manifest(filters,{activity='.MainActivity',exported=true}={}) {
 return ['E: manifest (line=1)','  A: package="ai.elizaresearch.alphaphone"','  E: application (line=2)',
  '    E: activity (line=3)',quoted('name',activity,6),attribute('exported',`(type 0x12)${exported?'0xffffffff':'0x0'}`,6),filters].join('\n');
}
const problems=(xml)=>requiredAppLinkProblems(parseXmlTree(xml),expected);

test('callback verifier accepts the exact exported autoVerify filter and preserves host-reporting shape',()=>{
 const xml=manifest(filter());
 assert.deepEqual(problems(xml),[]);
 assert.deepEqual(appLinkFilters(xml),{present:true,hosts:['login.example.org']});
 assert.deepEqual(problems(manifest(filter(),{activity:expected.activity})),[]);
 // Separate <data> elements still describe the same exact Android intent filter.
 const split=filter().replace(quoted('host',expected.host,10),'        E: data (line=8)\n'+quoted('host',expected.host,10))
  .replace(quoted('path',expected.path,10),'        E: data (line=9)\n'+quoted('path',expected.path,10));
 assert.deepEqual(problems(manifest(split)),[]);
});

for(const [name,change] of [
 ['wrong host',{host:'other.example.org'}],['wrong path',{path:'/other/callback'}],
 ['path prefix',{pathKey:'pathPrefix'}],['path pattern',{pathKey:'pathPattern'}],
 ['HTTP',{scheme:'http'}],['missing autoVerify',{autoVerify:null}],['false autoVerify',{autoVerify:false}],
 ['wrong action',{action:'android.intent.action.SEND'}],['missing browsable category',{categories:['android.intent.category.DEFAULT']}],
])test(`callback verifier rejects ${name}`,()=>{
 assert.match(problems(manifest(filter(change))).join('\n'),/Missing exported HTTPS autoVerify callback/);
});

test('callback verifier does not combine unrelated filters or accept another/hidden activity',()=>{
 assert.ok(problems(manifest(filter({host:'other.example.org'})+'\n'+filter({autoVerify:false}))).length);
 assert.ok(problems(manifest(filter(),{activity:'.AnotherActivity'})).length);
 assert.ok(problems(manifest(filter(),{exported:false})).length);
 assert.ok(problems(manifest(filter({path:'/prefix'})+'\n'+filter({pathKey:'pathPrefix'}))).length);
 const broad=filter()+'\n        E: data (line=9)\n'+quoted('host','other.example.org',10);
 assert.ok(problems(manifest(broad)).length,'extra authorities cannot broaden the callback filter');
});
