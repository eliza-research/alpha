import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {resolveCloudEnvironment} from '../apps/app/src/runtime/cloud-environment-selection.ts';
const preview={development:true,testMocks:true,android:false,previewEnvironment:'staging'};
test('staging default requires exact public flag plus development, test-mocks and non-Android',()=>{
 assert.equal(resolveCloudEnvironment(preview),'staging');
 for(const policy of [{...preview,development:false},{...preview,testMocks:false},{...preview,android:true},{...preview,previewEnvironment:undefined},{...preview,previewEnvironment:'production'},{...preview,previewEnvironment:'STAGING'},{...preview,previewEnvironment:'/some/staging/profile'}])assert.equal(resolveCloudEnvironment(policy),'production');
});
test('explicit saved/current environment wins over the preview default; production excludes staging',()=>{
 assert.equal(resolveCloudEnvironment(preview,'production'),'production');assert.equal(resolveCloudEnvironment({...preview,previewEnvironment:undefined},'staging'),'staging');
 assert.equal(resolveCloudEnvironment({...preview,development:false,testMocks:false},'staging'),'production');
 assert.equal(resolveCloudEnvironment({...preview,development:false,android:true,testMocks:false},'staging'),'production');
});
test('a hidden selector retains current Cloud issuer and actual sign-in dispatcher receives that issuer',async()=>{
 const ui=fs.readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
 const calls=[];
 const expression=ui.match(/const env = \(\): CloudEnvironment => ([^\n;]+);/)[1];
 const method=ui.match(/  async cloudLogin\(environment: CloudEnvironment\) \{([\s\S]*?)\n  \},/)[1];
 const actual=vm.runInNewContext(stripTypeScriptTypes('({async cloudLogin(environment: CloudEnvironment){'+method+'}})',{mode:'transform'}),{testMocksEnabled:true,isAndroid:false,browserLocalAgentEnabled:true,residentCloudFlow:()=>false,connectionController:{browserCloudLogin:async value=>calls.push(value),beginSignIn:async value=>calls.push(value)}});
 for(const [control,current] of [[null,'staging'],[null,'production'],[{value:'production'},'staging'],[{value:'staging'},'production']]){
  const selected=vm.runInNewContext(expression,{resolveCloudEnvironment,cloudEnvironmentPolicy:preview,environment:{current:control},snapshot:{},cloud:{environment:current}});
  await actual.cloudLogin(selected);
 }
 assert.deepEqual(calls,['staging','production','production','staging']);
 assert.match(ui,/let cloud = makeCloud\(resolveCloudEnvironment\(cloudEnvironmentPolicy, savedCloudEnvironment\)\)/);
 assert.match(ui,/savedCloudEnvironment = localStorage.getItem\(CLOUD_SERVICE\)/);
 assert.match(ui,/environment.current\?\.value \?\? snapshot.signIn\?\.environment \?\? cloud.environment/);
 assert.match(ui,/defaultValue=\{resolveCloudEnvironment\(cloudEnvironmentPolicy, snapshot.signIn\?\.environment \?\? cloud.environment\)\}/);
 assert.match(ui,/connectionController.cloudLogin\(env\(\)\)/);
 assert.match(ui,/async cloudLogin\(environment: CloudEnvironment\)[\s\S]*?connectionController.beginSignIn\(environment\)/);
});
test('the new resolver has no credential, profile, login or storage side effects',()=>{
 const source=fs.readFileSync(new URL('../apps/app/src/runtime/cloud-environment-selection.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/localStorage|credential|token|fetch\(|login\(|dirname|profile/);
});

test('explicit real Cloud resident fixes one issuer without enabling mock selection',()=>{
 const cloud={development:true,testMocks:false,android:false,cloudResident:true,previewEnvironment:'staging'};
 assert.equal(resolveCloudEnvironment(cloud,'production'),'staging');
 assert.equal(resolveCloudEnvironment({...cloud,previewEnvironment:'production'},'staging'),'production');
 assert.equal(resolveCloudEnvironment({...cloud,development:false},'staging'),'production');
 assert.equal(resolveCloudEnvironment({...cloud,android:true},'staging'),'production');
});
