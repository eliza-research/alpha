import {test,expect,type Page} from '@playwright/test';
// MVP-14: "Use in email" from the assistant conversation into the exact email selected in Inbox.
// Closed fixture: a synthetic Cloud client and agent session, no account, network or mail. Any
// provider write (prepare or dispatch) fails the test.
const first='Thanks for the plan. Tuesday at 10 works for me.',second='I will bring the printed copies.';
const menu=(page:Page)=>page.getByRole('menu',{name:'Message actions'});
const review=(page:Page)=>page.getByRole('dialog',{name:'Review email suggestion',exact:true});
const reply=(page:Page,text:string)=>page.locator('[data-alpha-message-text]').filter({hasText:text});
const body=(page:Page)=>page.getByRole('textbox',{name:'Message',exact:true});
async function setup(page:Page,theme='light',own=false,launcher=false){
 // The launcher shell reserves the status bar above a full-height conversation, as the phone does.
 await page.goto('/?theme='+theme+(launcher?'&shell=launcher':''));
 await page.evaluate(async own=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const {secureConnectionStore:s}=await import('/src/runtime/native-connection.ts');
  const {Component}=await import('/src/prototype/model.js');
  const f=(window as any).useInEmail={slots:{} as Record<string,unknown>,writes:0,shell:null as any};
  s.read=async(key:string)=>structuredClone(f.slots[key]??null) as any;
  s.compareExchange=async(key:string,prior:unknown,next:unknown)=>{if(JSON.stringify(f.slots[key]??null)!==JSON.stringify(prior))return {status:'conflict'} as any;f.slots[key]=structuredClone(next);return {status:'saved'} as any;};
  const message={id:'selected',threadId:'thread',from:own?'Fixture owner':'Fixture sender',fromEmail:own?'Owner@example.invalid':'sender@example.invalid',to:['owner@example.invalid'],subject:'Planning session',snippet:'Can you do Tuesday?',receivedAt:'2026-10-04T12:00:00Z',unread:false};
  const write=async()=>{f.writes++;throw Error('No provider writes allowed');};
  const client={gmailAccounts:async()=>[{connectionId:'fixture-grant',label:'owner@example.invalid',connected:true,grantedCapabilities:['google.gmail.triage']}],gmailInboxCapabilities:async()=>({send:false,providerDrafts:false,mailboxMutations:false,...(own?{from:'owner@example.invalid'}:{})}),gmailSearch:async()=>({messages:[message],syncedAt:'1'}),gmailRead:async()=>({message,bodyText:'Can you do Tuesday at 10?',historyId:'1',attachments:[]}),gmailPrepareOperation:write,gmailDispatchOperation:write};
  c.getCloudClient=()=>({client,sessionId:'fixture-session'} as any);
  const snapshot={...c.getSnapshot(),session:{ownerId:'fixture-owner',agentId:'fixture-agent',sessionId:'fixture-agent-session',origin:'https://agent.invalid'},cloudAccount:{environment:'production',userId:'fixture-owner',sessionId:'fixture-session',credentialId:'fixture'}} as any;c.getSnapshot=()=>snapshot;
  const original=Component.prototype.renderVals;Component.prototype.renderVals=function(){f.shell=this;return original.call(this);};
 },own);
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await page.getByText('Planning session',{exact:true}).click();
 await expect(page.getByText('Can you do Tuesday at 10?',{exact:true})).toBeVisible();
}
/** The assistant's finished reply, as the conversation shows it. No agent or model runs. */
const say=(page:Page,text:string)=>page.evaluate(text=>(window as any).useInEmail.shell.agentSay(text),text);
const openReview=async(page:Page,text:string)=>{await reply(page,text).click();await menu(page).getByRole('menuitem',{name:'Use in email',exact:true}).click();await expect(review(page)).toBeVisible();};

for(const theme of ['light','dark'])test(`reviewed reply fills the selected email's draft and never sends: ${theme}`,async({page},info)=>{
 await setup(page,theme);await say(page,first);await expect(reply(page,first)).toBeVisible();
 await reply(page,first).click();
 const item=menu(page).getByRole('menuitem',{name:'Use in email',exact:true});await expect(item).toBeVisible();
 expect(await item.evaluate(element=>element.clientHeight)).toBeGreaterThanOrEqual(44);
 await item.click();
 const dialog=review(page);await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
 await expect(dialog.locator('[data-alpha-email-use-account]')).toHaveText('From owner@example.invalid');
 await expect(dialog.locator('[data-alpha-email-use-destination]')).toHaveText('New reply to sender@example.invalid (Fixture sender) · Re: Planning session');
 await expect(dialog.getByRole('region',{name:'Suggested text'})).toHaveText(first);
 await expect(dialog).toContainText('Draft only · text only');
 expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('use-in-email-review-'+theme+'.png'),animations:'disabled'});
 // Focus stays inside the review; Escape cancels without creating a draft.
 await page.keyboard.press('Shift+Tab');await expect(dialog.getByRole('button',{name:'Insert into draft',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(reply(page,first)).toBeFocused();await expect(menu(page)).toHaveCount(0);
 await expect(body(page)).toHaveCount(0);
 // Confirming opens the normal composer for exactly that reply, under the reviewed account.
 await openReview(page,first);await review(page).getByRole('button',{name:'Insert into draft',exact:true}).click();
 await expect(review(page)).toHaveCount(0);
 await expect(body(page)).toHaveValue(first);await expect(body(page)).toBeInViewport();
 await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Re: Planning session');
 await expect(page.getByText('sender@example.invalid',{exact:true})).toBeVisible();
 await expect(page.getByText(/Agent suggestion placed in a local draft\. Review and edit before sending; nothing has been sent\./)).toBeVisible();
 await page.screenshot({path:info.outputPath('use-in-email-draft-'+theme+'.png'),animations:'disabled'});
 expect(await page.evaluate(()=>(window as any).useInEmail.writes)).toBe(0);
});

// The edited-draft and outside-Inbox cases run on the production bundle in use-in-email.production.spec.ts.
test('a reply from another agent session is not inserted',async({page})=>{
 await setup(page);await say(page,first);await openReview(page,first);
 // The agent changes while the review is open: the review closes and no draft is created.
 await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');const now=c.getSnapshot();const next={...now,session:{...now.session,sessionId:'another-agent-session'}} as any;c.getSnapshot=()=>next;});
 await review(page).getByRole('button',{name:'Insert into draft',exact:true}).click();
 await expect(review(page)).toHaveCount(0);await expect(body(page)).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).useInEmail.writes)).toBe(0);
});

test('system Back cancels the review, and a message from the account itself names no recipient',async({page})=>{
 await setup(page,'light',true);await say(page,first);await openReview(page,first);
 const dialog=review(page);
 // The draft a reply to your own message gets has no recipient, so the review names none.
 await expect(dialog.locator('[data-alpha-email-use-destination]')).toHaveText('New reply · Re: Planning session · no recipients yet');
 // Everything behind the review is inert: the selected email cannot change underneath it.
 expect(await page.evaluate(()=>!!document.querySelector('[data-alpha-message-text]')?.closest('[inert]')&&!!Array.from(document.querySelectorAll('*')).find(node=>node.textContent==='Can you do Tuesday at 10?')?.closest('[inert]'))).toBe(true);
 // Back closes only the review: nothing is inserted and the email stays selected.
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
 await expect(dialog).toHaveCount(0);await expect(body(page)).toHaveCount(0);
 await expect(page.getByText('Can you do Tuesday at 10?',{exact:true})).toBeVisible();await expect(reply(page,first)).toBeVisible();
 await openReview(page,first);await review(page).getByRole('button',{name:'Insert into draft',exact:true}).click();
 await expect(body(page)).toHaveValue(first);
 await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Re: Planning session');
 await expect(page.getByRole('textbox',{name:'To',exact:true})).toBeVisible();await expect(page.locator('.inbox-recipient-chip')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).useInEmail.writes)).toBe(0);
});

test('a full-height conversation keeps the review below the status bar, and a set-aside draft is named as off screen',async({page})=>{
 await setup(page,'light',false,true);await say(page,first);await expect(reply(page,first)).toBeVisible();
 await page.getByRole('button',{name:'Expand chat',exact:true}).click();await expect(page.getByRole('button',{name:'Shrink chat',exact:true})).toBeVisible();
 const tops=()=>page.evaluate(()=>{const top=(selector:string)=>Math.round(document.querySelector(selector)!.getBoundingClientRect().top);return {panel:top('[data-alpha-layer="conversation"]'),header:top('[data-alpha-chat-header]'),cancel:document.querySelector('[aria-label="Review email suggestion"] button')?Math.round(document.querySelector('[aria-label="Review email suggestion"] button')!.getBoundingClientRect().top):-1};});
 // The full-height conversation reserves the status bar above its header.
 await expect.poll(async()=>{const now=await tops();return now.header-now.panel;}).toBeGreaterThanOrEqual(40);
 await openReview(page,first);
 const dialog=review(page),measured=await tops();
 expect(measured.cancel).toBeGreaterThanOrEqual(measured.header);
 expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
 await dialog.getByRole('button',{name:'Insert into draft',exact:true}).click();await expect(body(page)).toHaveValue(first);
 // System Back closes the composer; the one draft for this account stays, off screen.
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
 await expect(body(page)).toHaveCount(0);await expect(page.getByText('Can you do Tuesday at 10?',{exact:true})).toBeVisible();
 await say(page,second);await expect(reply(page,second)).toBeVisible();await openReview(page,second);
 await expect(dialog.locator('[data-alpha-email-use-destination]')).toHaveText('Your unfinished reply draft (not on screen) · Re: Planning session · to sender@example.invalid');
 await expect(dialog.locator('[data-alpha-email-use-effect]')).toHaveText('This draft already has text. The suggestion is added below it; nothing is replaced.');
 await dialog.getByRole('button',{name:'Add below existing text',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect(body(page)).toHaveValue(first+'\n\n'+second);
 expect(await page.evaluate(()=>(window as any).useInEmail.writes)).toBe(0);
});
