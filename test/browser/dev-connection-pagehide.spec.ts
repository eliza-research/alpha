import {test,expect} from '@playwright/test';

test('departing development connection stops rendering until page restoration',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Agent connection',exact:true}).click();
 await expect(page.getByRole('button',{name:'Connect development profile'})).toBeVisible();
 await page.evaluate(async()=>{
  const read=Storage.prototype.getItem;
  const hidden=Object.getOwnPropertyDescriptor(document,'hidden');
  Storage.prototype.getItem=function(){throw new DOMException('Storage revoked during navigation','NS_ERROR_FAILURE');};
  try {
   Object.defineProperty(document,'hidden',{configurable:true,value:true});
   document.dispatchEvent(new Event('visibilitychange'));
   window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
   await new Promise(resolve=>setTimeout(resolve,50));
  } finally {
   Storage.prototype.getItem=read;
   if(hidden)Object.defineProperty(document,'hidden',hidden);else delete (document as any).hidden;
   window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
   document.dispatchEvent(new Event('visibilitychange'));
  }
 });
 await expect(page.getByRole('button',{name:'Connect development profile'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Agent connection',exact:true})).toBeVisible();
 expect(errors).toEqual([]);
 await page.getByRole('button',{name:'Agent connection',exact:true}).click();
 await expect(page.getByRole('button',{name:'Connect development profile'})).toBeVisible();
});
