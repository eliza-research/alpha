import {test,expect} from '@playwright/test';

// The Privacy & data page and About's runtime facts were removed with the Settings refresh (docs/ui-refresh-2026-11).
test('connected browser host retains resident memory status',async({page},info)=>{
 test.skip(process.env.VITE_LOCAL_AGENT!=='1','Requires the browser local-agent development profile');
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 // Real browser connection protocol; synthetic authenticated host boundary only.
 await page.route('**/__alpha-local-agent',async route=>{
  const input=route.request().postDataJSON();let body:unknown;
  if(input.path==='/api/auth/me')body={identity:{kind:'owner',id:'host-review-owner'},access:{role:'OWNER',mode:'session'}};
  else if(input.path==='/api/agents')body={agents:[{id:'host-review-agent',name:'Review host',status:'running'}]};
  else if(input.path==='/api/client-devices/register')body={installationId:input.headers['X-Eliza-Device-Id'],enrollmentId:'host-review-enrollment',capabilities:[]};
  else if(input.path==='/api/conversations')body={conversations:[]};
  else body={};
  await route.fulfill({json:{status:200,body:JSON.stringify(body)}});
 });
 await page.goto('/?tools=1');
 await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.initialize();await c.startLocal();if(c.getSnapshot().kind!=='resident'||!c.getSnapshot().session)throw Error('Synthetic host did not connect');});
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Developer',exact:true}).click();
 await expect(page.getByText('Usage not reported by agent',{exact:true})).toBeVisible();
 await page.evaluate(async()=>{await(await import('/src/runtime/connection-ui.tsx')).connectionController.offline();});
 // P-43: the development host stays resident; offline() returns to that agent.
 await expect.poll(()=>page.evaluate(async()=>{const c=(await import('/src/runtime/connection-ui.tsx')).connectionController;return {kind:c.getSnapshot().kind,connected:!!c.getSnapshot().session};})).toEqual({kind:'resident',connected:true});
 await expect(page.getByText('Agent memory',{exact:true}).locator('..').getByText('Usage not reported by agent',{exact:true})).toBeVisible();
});
