import {expect,test} from '@playwright/test';

test('a failed IndexedDB read or removal never reports a temporary sign-out and can retry the durable slot',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev');
 const result=await page.evaluate(async()=>{
  const {createBrowserConnection}=await import('/src/runtime/native-connection.ts');
  const slot='cloud:production',other='cloud:staging',name='alpha-connection-secrets.v1';
  const store=createBrowserConnection();
  await store.secureWrite({slot,value:'synthetic-production'});
  await store.secureWrite({slot:other,value:'synthetic-staging'});
  const open=IDBFactory.prototype.open;
  const blocked=createBrowserConnection();
  const failures:string[]=[];
  IDBFactory.prototype.open=function(database,version){
   if(database===name)throw new DOMException('Simulated storage denial','SecurityError');
   return open.call(this,database,version);
  };
  try{
   for(const operation of [()=>blocked.secureRead({slot}),()=>blocked.secureRemove({slot}),()=>blocked.secureCompareExchange({slot,expectedValue:null,value:'temporary'})]){
    try{await operation();failures.push('acknowledged');}catch(error){failures.push((error as Error).message);}
   }
  }finally{IDBFactory.prototype.open=open;}
  const retained=(await blocked.secureRead({slot})).value;
  // Another client replaces the exact old generation. The old compare-and-clear must leave it.
  await store.secureWrite({slot,value:'synthetic-replacement'});
  const oldClear=await blocked.secureCompareExchange({slot,expectedValue:'synthetic-production',value:null});
  const replacement=(await createBrowserConnection().secureRead({slot})).value;
  await blocked.secureRemove({slot});
  const reopened=createBrowserConnection();
  return {failures,retained,oldClear,replacement,removed:(await reopened.secureRead({slot})).value,other:(await reopened.secureRead({slot:other})).value};
 });
 expect(result.failures).toEqual(Array(3).fill('Saved sign-in storage could not be accessed. Try again when browser storage is available.'));
 expect(result.retained).toBe('synthetic-production');
 expect(result.oldClear.status).toBe('conflict');
 expect(result.replacement).toBe('synthetic-replacement');
 expect(result.removed).toBeNull();
 expect(result.other).toBe('synthetic-staging');
});
