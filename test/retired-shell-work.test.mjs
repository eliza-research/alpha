import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyImageContacts} from '../apps/app/src/runtime/image-contacts.ts';

test('image revocation retires the raw Contacts view after the presentation gate hides it',async()=>{
 const source=readFileSync('apps/app/src/main.tsx','utf8');
 const start=source.indexOf('    const refreshImage=async(');
 const end=source.indexOf('\n    };',start);
 assert.ok(start>=0&&end>start);
 let admitted=true,homes=0;
 const ORDER=['contacts','settings'];
 const shell={state:{view:'contacts'},S(){return {view:admitted?this.state.view:null};},goHome(){homes++;this.state.view=null;}};
 const refresh=new Function('DeviceApps','admitImageContacts','ORDER','shell','applyImageContacts','admitImageSense',source.slice(start,end)+'\n};return refreshImage;')(
  {platformCapabilities:async()=>({aospImage:true,contacts:false})},value=>{admitted=value;},ORDER,shell,applyImageContacts,
  ()=>assert.fail('a resume must not readmit Sense for the lifetime of the activity'));
 await refresh();
 assert.equal(admitted,false);
 assert.equal(shell.state.view,null,'the hidden raw view must not return when image capability is later re-admitted');
 assert.equal(homes,1);
 assert.deepEqual(ORDER,['settings']);
 shell.state.view='settings';await refresh();assert.equal(homes,1,'a different current view stays open');
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
