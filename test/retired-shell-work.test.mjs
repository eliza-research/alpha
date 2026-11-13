import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyImageContacts} from '../apps/app/src/runtime/image-contacts.ts';

test('Android image refresh retires open Contacts before revoking admission',async()=>{
 const source=readFileSync('apps/app/src/main.tsx','utf8');
 const refreshSource=source.match(/^    const refreshImage\s*=\s*async\b[\s\S]*?^    };/m)?.[0];
 assert.ok(refreshSource,'find the mounted Android image refresh callback');
 let admitted=false,homes=0,capability={aospImage:true,contacts:true};
 const order=['settings'],senseAdmissions=[];
 const shell={state:{view:null},S(){return {view:admitted||this.state.view!=='contacts'?this.state.view:null};},goHome(){
  assert.equal(this.S().view,'contacts','the view must still be visible to its leave hook');
  homes++;this.state.view=null;
 }};
 const refresh=new Function('DeviceApps','admitImageContacts','ORDER','shell','applyImageContacts','admitImageSense',refreshSource+'\nreturn refreshImage;')(
  {platformCapabilities:async()=>capability},value=>{admitted=value;},order,shell,applyImageContacts,value=>senseAdmissions.push(value));
 await refresh(true);
 assert.equal(admitted,true);
 assert.deepEqual(order,['settings','contacts']);
 assert.deepEqual(senseAdmissions,[capability]);
 shell.state.view='contacts';
 capability={aospImage:true,contacts:false};
 await refresh();
 assert.equal(admitted,false);
 assert.equal(shell.state.view,null,'the hidden raw view must not return when image capability is later re-admitted');
 assert.equal(homes,1);
 assert.deepEqual(order,['settings']);
 shell.state.view='settings';
 capability={aospImage:false,contacts:true};
 await refresh();
 assert.equal(admitted,false,'Contacts requires an admitted image');
 capability={aospImage:true,contacts:true};
 await refresh();
 assert.equal(admitted,true);
 assert.equal(shell.state.view,'settings');
 assert.equal(homes,1,'a different current view stays open');
 assert.equal(senseAdmissions.length,1,'Android resume refreshes Contacts without changing the startup Sense admission');
});

test('a retired send finally cannot clear the newer send typing lease',()=>{
 const source=readFileSync('apps/app/src/prototype/agent-adapter.ts','utf8');
 const start=source.indexOf('    finally { if(this.sendAttempt===attempt)');
 const end=source.indexOf('\n  };',start);
 assert.ok(start>=0&&end>start);
 const cleanup=new Function('attempt','try {} '+source.slice(start,end));
 const old={},current={},writes=[];
 const shell={live:true,sendAttempt:current,setState:value=>writes.push(value)};
 cleanup.call(shell,old);
 assert.equal(shell.sendAttempt,current);assert.deepEqual(writes,[]);
 cleanup.call(shell,current);
 assert.equal(shell.sendAttempt,null);assert.deepEqual(writes,[{typing:false,turnStatus:''}]);
 shell.live=false;shell.sendAttempt=current;cleanup.call(shell,current);
 assert.equal(shell.sendAttempt,null);assert.equal(writes.length,1,'unmounted shells release ownership without painting');
});
