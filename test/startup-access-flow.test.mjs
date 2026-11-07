import test from 'node:test';
import assert from 'node:assert/strict';
// Alpha's binding of the shared walkthrough (packages/ui permission-walkthrough) at the prepared pin.
const flow=await import('../apps/app/src/startup-permission-flow.ts');
test('photo grant description preserves selected/partial scope and rejects locked or malformed native results',()=>{
 assert.match(flow.startupPhotoAccess({scope:'selected',locked:false}).description,/Selected/);
 assert.match(flow.startupPhotoAccess({scope:'partial',locked:false}).description,/Limited/);
 assert.equal(flow.startupPhotoAccess({scope:'denied',locked:false}).granted,false);
 for(const value of [null,{scope:['full'],locked:false},{scope:'full',locked:true},{scope:'full'}])assert.throws(()=>flow.startupPhotoAccess(value));
});
test('Google identity alone cannot claim mail/calendar access',()=>{
 const account={connected:true,connectionId:'connection',grantedCapabilities:[]};
 assert.deepEqual(flow.startupGoogleAccess([account]),{gmail:false,calendar:false});
 assert.deepEqual(flow.startupGoogleAccess([{...account,grantedCapabilities:['google.gmail.triage','google.calendar.read']}]),{gmail:true,calendar:true});
 assert.deepEqual(flow.startupGoogleAccess([{...account,connectionId:null,grantedCapabilities:['google.gmail.triage']},{...account,connected:false,grantedCapabilities:['google.calendar.read']}]),{gmail:false,calendar:false});
});
test('checks never prompt, denial persists to settings, and a granted readback retires the prompt',async()=>{
 const values=new Map();const store={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 let granted=false,requests=0,settings=0;
 const bridge={status:async()=>({granted,enabled:granted}),request:async()=>{requests++;},openSettings:async()=>{settings++;granted=true;}};
 const first=flow.createStartupPermissionFlow(bridge,{key:'camera',store});
 assert.equal(await first.refresh(),'request');assert.equal(requests,0);
 assert.equal(await first.enable(),'settings');assert.equal(requests,1);
 const cold=flow.createStartupPermissionFlow(bridge,{key:'camera',store});
 assert.equal(await cold.refresh(),'settings');assert.equal(await cold.enable(),'ready');assert.equal(requests,1);assert.equal(settings,1);
 flow.writeStartupPermissionMemory({dismissed:true},store);assert.equal(flow.readStartupPermissionMemory(store).dismissed,true);
 flow.reopenStartupPermissions(store);assert.equal(flow.readStartupPermissionMemory(store).dismissed,false);assert.equal(flow.readStartupPermissionMemory(store).attempted.camera,true);
});

test('location metadata labels approximate and precise grants without accepting malformed accuracy',()=>{
 assert.match(flow.startupLocationAccess({location:'granted',accuracy:'approximate'}).description,/Approximate/);
 assert.match(flow.startupLocationAccess({location:'granted',accuracy:'precise'}).description,/Precise/);
 assert.equal(flow.startupLocationAccess({location:'denied',accuracy:'none'}).granted,false);
 for(const value of [null,{location:'granted',accuracy:'none'},{location:'granted',accuracy:['precise']},{location:'denied',accuracy:'precise'},{location:'prompt'}])assert.throws(()=>flow.startupLocationAccess(value));
});
