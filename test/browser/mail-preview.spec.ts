import {returnToApps} from './app-navigation';
import {test,expect,type Page} from '@playwright/test';
async function setup(page:Page){
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/');
 await page.evaluate(async()=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const message={id:'preview',threadId:'thread',subject:'Subject &amp; literal',from:'Sender',fromEmail:'sender@example.test',to:[],snippet:'We&#39;ll say &quot;hello&quot; &amp; it&#x27;s ready. &lt;img src="https://example.invalid/pixel"&gt;',receivedAt:'2026-10-14T12:00:00Z',unread:false};
  const client={gmailAccounts:async()=>[{connectionId:'preview-grant',label:'owner@example.test',connected:true,grantedCapabilities:['google.gmail.triage']}],gmailSearch:async()=>({messages:[message],syncedAt:'sync',nextPageToken:null}),gmailInboxCapabilities:async()=>({send:false,draftsList:true}),gmailDrafts:async()=>({drafts:[{draftId:'d',messageId:'dm',subject:'Provider draft',to:[],snippet:'It&#39;s a Gmail draft &amp; preview.',updatedAt:null}],nextPageToken:null})};
  c.getCloudClient=()=>({client,sessionId:'preview-session',credentialId:'fixture'} as any);const snapshot={...c.getSnapshot(),cloudAccount:{environment:'production',userId:'preview-owner',sessionId:'preview-session',credentialId:'fixture'}} as any;c.getSnapshot=()=>snapshot;
 });await page.getByRole('button',{name:'Inbox',exact:true}).click();
}
test('encoded Gmail previews render punctuation as text without loading markup',async({page})=>{
 let requests=0;await page.route('https://example.invalid/**',route=>{requests++;return route.abort();});await setup(page);
 const row=page.getByRole('button',{name:'Sender, Subject &amp; literal',exact:true});await expect(row).toContainText('We\'ll say "hello" & it\'s ready. <img src="https://example.invalid/pixel">');
 await expect(row.locator('img,script,iframe')).toHaveCount(0);expect(requests).toBe(0);
});
test('Gmail draft previews decode entities',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Other mail folders',exact:true}).click();await page.getByRole('menuitemradio',{name:'Drafts',exact:true}).click();
 await expect(page.getByRole('button',{name:/^Gmail draft,/})).toContainText('It\'s a Gmail draft & preview.');
});
test('text typed into a local draft remains literal',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Compose',exact:true}).click();await page.getByRole('textbox',{name:'Message',exact:true}).fill('My literal &amp; example');await returnToApps(page);await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await page.getByRole('button',{name:'Other mail folders',exact:true}).click();await page.getByRole('menuitemradio',{name:'Drafts',exact:true}).click();await expect(page.getByRole('button',{name:/^Draft,/})).toContainText('My literal &amp; example');
});
