import test from 'node:test';
import assert from 'node:assert/strict';
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

test('explicit real Cloud resident fixes one issuer without enabling mock selection',()=>{
 const cloud={development:true,testMocks:false,android:false,cloudResident:true,previewEnvironment:'staging'};
 assert.equal(resolveCloudEnvironment(cloud,'production'),'staging');
 assert.equal(resolveCloudEnvironment({...cloud,previewEnvironment:'production'},'staging'),'production');
 assert.equal(resolveCloudEnvironment({...cloud,development:false},'staging'),'production');
 assert.equal(resolveCloudEnvironment({...cloud,android:true},'staging'),'production');
});
