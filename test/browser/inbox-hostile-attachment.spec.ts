// J03-8 (docs/core-loop-audit.md): hostile mail attachments. An HTML file with script, an SVG with
// script, an oversized file and files whose bytes do not match their declared type are driven
// through the rendered Inbox attachment controls. None may execute, navigate, load anything, or
// reach the agent; what the review shows is inert text.
//
// Evidence boundary: source/test evidence for the browser renderer. The mailbox is a synthetic
// provider at the Cloud client boundary; each attachment response is the JSON a hostile or broken
// server would return, passed through the product's own CloudProtocol response validation
// (gmailAttachment / gmailOpaqueAttachment) so the real checks run. Android's MailAttachment
// plugin, its viewer handoff and Files provider are native and not exercised here.
import {createHash} from 'node:crypto';
import {test,expect,type Page} from '@playwright/test';

const ATTACKER='attacker.invalid';
const html=`<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://${ATTACKER}/meta"><link rel="stylesheet" href="https://${ATTACKER}/style.css"></head><body onload="top.hostile='onload'"><script>try{top.hostile='script'}catch(e){}window.hostile='script';fetch('https://${ATTACKER}/script');top.location='https://${ATTACKER}/navigate';</script><img src="https://${ATTACKER}/beacon.png"><img src="x" onerror="top.hostile='onerror';fetch('https://${ATTACKER}/onerror')"><a id="a" href="https://${ATTACKER}/link">Invoice</a><form action="https://${ATTACKER}/form"><input name="password"></form></body></html>`;
const svg=`<svg xmlns="http://www.w3.org/2000/svg" onload="top.hostile='svg-onload';fetch('https://${ATTACKER}/svg-onload')"><script>try{top.hostile='svg-script'}catch(e){}fetch('https://${ATTACKER}/svg-script')</script><image href="https://${ATTACKER}/svg-image.png"/><foreignObject><iframe xmlns="http://www.w3.org/1999/xhtml" src="https://${ATTACKER}/svg-frame"></iframe></foreignObject></svg>`;
const b64=(text:string)=>Buffer.from(text,'latin1').toString('base64');
const sha=(text:string)=>createHash('sha256').update(Buffer.from(text,'latin1')).digest('hex');
type Part={partId:string;name:string;mimeType:string;size:number;supported:boolean;response:Record<string,unknown>|null};
const part=(partId:string,name:string,mimeType:string,supported:boolean,bytes:string,extra:Partial<Part>&{opaque?:boolean}={}):Part=>({partId,name,mimeType,size:Buffer.byteLength(bytes,'latin1'),supported,
 response:{version:1,messageId:'selected',partId,historyId:'1',name,mimeType,dataBase64:b64(bytes),sha256:sha(bytes),size:Buffer.byteLength(bytes,'latin1'),...(supported?{}:{opaque:true})},...extra});

/** Records everything a hostile attachment could do: requests, navigation, dialogs, popups, script effects. */
async function watch(page:Page){
 const seen={requests:[] as string[],navigations:[] as string[],dialogs:[] as string[],popups:0};
 await page.route(url=>url.hostname===ATTACKER,route=>{seen.requests.push(route.request().url());return route.abort();});
 page.on('framenavigated',frame=>{if(frame.url().includes(ATTACKER))seen.navigations.push(frame.url());});
 page.on('dialog',dialog=>{seen.dialogs.push(dialog.message());void dialog.dismiss();});
 page.on('popup',()=>{seen.popups++;});
 return seen;
}
async function expectInert(page:Page,seen:Awaited<ReturnType<typeof watch>>){
 await page.waitForTimeout(400); // a refresh, onload or image fetch would have fired by now
 expect(seen).toEqual({requests:[],navigations:[],dialogs:[],popups:0});
 expect(await page.evaluate(()=>(window as any).hostile)).toBeUndefined();
 expect(new URL(page.url()).hostname).toBe('127.0.0.1');
 // No frame was created for attachment content, and no element built from it is in the document.
 expect(page.frames().filter(frame=>frame!==page.mainFrame()&&!/^about:blank$/.test(frame.url())).map(frame=>frame.url())).toEqual([]);
 expect(await page.evaluate(()=>document.querySelectorAll('a#a, input[name="password"], img[src*="attacker"], svg image, foreignObject').length)).toBe(0);
}
async function setup(page:Page,parts:Part[],options:{opaque?:boolean;agent?:boolean}={}){
 // The fixture models an installation that already finished access setup; a signed-in account with
 // pending setup is owed the startup walkthrough, which would otherwise cover Home once the swapped
 // snapshot re-renders (startup-permissions-walkthrough.spec.ts owns that flow).
 await page.addInitScript(()=>localStorage.setItem('alpha:startup-permission-walkthrough:v1',JSON.stringify({version:1,status:'completed',step:4})));
 await page.goto('/');
 await page.evaluate(async({parts,options})=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const {inboxLocalStore:s}=await import('/src/runtime/inbox-local-store.ts');
  const {CloudProtocol}=await import('/src/runtime/cloud-protocol.ts');
  s.read=async()=>null;s.compareExchange=async()=>({status:'saved'});
  const f=(window as any).hostileFixture={attachmentRequests:[] as string[],mutations:0,agentPosts:[] as unknown[]};
  const message={id:'selected',threadId:'thread',from:'Fixture sender',fromEmail:'sender@example.invalid',to:['reader@example.invalid'],cc:[],replyTo:null,subject:'Invoices attached',snippet:'See attached',receivedAt:'2026-10-04T12:00:00Z',unread:false};
  // The product's own response validation (CloudProtocol over the shared managed Gmail client), fed the
  // server's JSON for the requested part through a synthetic authenticated transport.
  const validated=(method:'gmailAttachment'|'gmailOpaqueAttachment')=>async(grant:string,messageId:string,partId:string,historyId:string,signal:AbortSignal)=>{
   f.attachmentRequests.push(`${method}:${partId}`);
   const row=parts.find(part=>part.partId===partId);
   const protocol=new CloudProtocol('production',async()=>({status:200,data:structuredClone(row!.response)}),{read:async()=>({token:'fixture-token',credentialId:'fixture'}),write:async()=>{},clear:async()=>{}},async()=>{});
   return (protocol as any)[method](grant,messageId,partId,historyId,signal);
  };
  const client={
   gmailAccounts:async()=>[{connectionId:'fixture-grant',label:'Fixture mailbox',configured:true,connected:true,reason:'connected',grantedCapabilities:['google.gmail.triage']}],
   gmailInboxCapabilities:async()=>({version:1,from:'reader@example.invalid',threads:false,send:false,providerDrafts:false,mailboxMutations:false,attachments:true,providerExactlyOnce:false,atomicDraftReplacement:false,readState:false,opaqueAttachments:options.opaque!==false}),
   gmailSearch:async()=>({messages:[message],syncedAt:'1',nextPageToken:null}),
   gmailRead:async()=>({message,bodyText:'Please open the attached invoice.',historyId:'1',links:[],attachments:parts.map(({partId,name,mimeType,size,supported})=>({partId,name,mimeType,size,supported}))}),
   gmailAttachment:validated('gmailAttachment'),gmailOpaqueAttachment:validated('gmailOpaqueAttachment'),
   gmailPrepareOperation:async()=>{f.mutations++;throw Error('No provider writes');},
  };
  c.getCloudClient=()=>({client,sessionId:'fixture-session',credentialId:'fixture'} as any);
  const snapshot={...c.getSnapshot(),cloudAccount:{environment:'production',userId:'fixture-owner',sessionId:'fixture-session',credentialId:'fixture'},...(options.agent?{session:{sessionId:'agent-session',agentId:'agent-1',ownerId:'fixture-owner',origin:'https://agent.example.invalid'}}:{})} as any;c.getSnapshot=()=>snapshot;
 },{parts,options});
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await page.getByText('Invoices attached',{exact:true}).click();
 await expect(page.getByRole('region',{name:'Email message'})).toContainText('Please open the attached invoice.');
}
const fixture=(page:Page)=>page.evaluate(()=>(window as any).hostileFixture as {attachmentRequests:string[];mutations:number});
const files=(page:Page)=>page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return (await registerPlugin<any>('AlphaFiles').list({})).entries.map((entry:any)=>entry.name as string);});
const review=(page:Page)=>page.getByRole('dialog',{name:'Review attachment'});
const REFUSED='This attachment does not match its type or is too large. It was not opened or saved.';
/** A refused file is reported as refused: never as Gmail being unavailable, with no Retry (the same bytes
 * would be refused again), and the message stays open for the next file. */
async function expectRefused(page:Page){
 await expect(page.getByText(REFUSED,{exact:true}).first()).toBeVisible();
 await expect(page.getByText(/Gmail is unavailable/)).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Retry',exact:true})).toHaveCount(0);
 await expect(page.getByRole('region',{name:'Email message'})).toContainText('Please open the attached invoice.');
}

const openFile=async(page:Page,name:string)=>{
 await page.reload();
 await page.getByRole('button',{name:'Files',exact:true}).click();
 await page.getByRole('button',{name:'Internal storage',exact:true}).click();
 await page.getByRole('button',{name:`Open ${name}`,exact:true}).click();
};
const storedBytes=(page:Page,name:string)=>page.evaluate(async name=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const f=registerPlugin<any>('AlphaFiles'),row=(await f.list({})).entries.find((entry:any)=>entry.name===name),selected=await f.select({id:row.id});try{return (await f.attachment(selected)).dataBase64 as string;}finally{await f.forgetSelected(selected);}},name);

for(const [label,name,mimeType,bytes] of [['an HTML attachment with script','invoice.html','text/html',html],['an SVG attachment with script','diagram.svg','image/svg+xml',svg]] as const)
test(`${label} is never rendered: the review is inert text, Save to Files keeps the exact bytes, and opening it in Files runs and loads nothing`,async({page})=>{
 test.setTimeout(120_000);
 const seen=await watch(page);
 await setup(page,[part('p1',name,mimeType,false,bytes)]);
 const row=page.getByRole('region',{name:'Email message'});
 await expect(row).toContainText(`${Buffer.byteLength(bytes,'latin1')} bytes · No preview · Save to Files`);
 await page.getByText(name,{exact:true}).click();
 // The review names the file, its hash, type and size, and shows none of its content.
 await expect(review(page).getByRole('heading',{name,exact:true})).toBeVisible();
 await expect(review(page)).toContainText(`SHA-256 ${sha(bytes)}`);
 await expect(review(page)).toContainText(`${mimeType} · ${Buffer.byteLength(bytes,'latin1')} bytes. This type is not previewed or opened by Alpha. Save to Files stores an exact copy of the bytes; nothing is shared with the agent.`);
 await expect(review(page)).not.toContainText('Invoice');
 await expect(review(page).getByRole('button',{name:'Open reviewed file',exact:true})).toHaveCount(0);
 expect(await review(page).locator('iframe, object, embed, img, svg image, script, a[href]').count()).toBe(0);
 await expectInert(page,seen);
 expect(await files(page)).toEqual([]);

 const save=review(page).getByRole('button',{name:'Save to Files',exact:true});
 await save.dblclick();
 await expect(review(page).getByRole('status')).toHaveText('Saved in Files. Exact bytes verified.');
 await expect(save).toBeDisabled();
 expect(await files(page)).toEqual([name]);
 expect(await storedBytes(page,name)).toBe(b64(bytes));
 expect(await fixture(page)).toMatchObject({attachmentRequests:['gmailOpaqueAttachment:p1'],mutations:0});
 await expectInert(page,seen);

 // Opening the saved copy in Files: the bytes are stored, never interpreted as a page.
 await openFile(page,name);
 await expect(page.getByText(new RegExp(`^${mimeType.replace(/[+/]/g,'\\$&')} · `)).first()).toBeVisible();
 await expectInert(page,seen);
});

test('active content served under a previewable type is shown as literal text or refused, and nothing is saved from a refused file',async({page})=>{
 test.setTimeout(120_000);
 const seen=await watch(page);
 await setup(page,[
  // A .txt that is really a web page: allowed, because text is only ever shown as text.
  part('as-text','notes.txt','text/plain',true,html),
  // Bytes that do not match the declared image or PDF type, and a name that does not match its type.
  part('as-png','photo.png','image/png',true,html),
  part('as-pdf','scan.pdf','application/pdf',true,svg),
  part('as-jpeg','logo.jpg','image/jpeg',true,svg),
  part('html-named-text','page.html','text/plain',true,html),
  part('svg-as-supported','vector.svg','image/svg+xml',true,svg),
 ]);
 await page.getByText('notes.txt',{exact:true}).click();
 await expect(review(page).getByRole('heading',{name:'notes.txt',exact:true})).toBeVisible();
 // The markup is visible as characters; no element was created from it.
 await expect(review(page).getByText(html,{exact:true})).toBeVisible();
 await expectInert(page,seen);
 await review(page).getByRole('button',{name:'Back to message',exact:true}).click();

 for(const [name,requested] of [['photo.png','as-png'],['scan.pdf','as-pdf'],['logo.jpg','as-jpeg'],['page.html','html-named-text'],['vector.svg','svg-as-supported']] as const){
  await page.getByRole('region',{name:'Email message'}).getByText(name,{exact:true}).click();
  // The response fails the type check: no review opens and the person is told the file was refused.
  await expectRefused(page);
  await expect(review(page)).toHaveCount(0);
  await expect(page.getByRole('dialog',{name:'Reviewed attachment'})).toHaveCount(0);
  await expectInert(page,seen);
  // Choosing it again asks again and is refused again; it never falls back to showing the file.
  await page.getByRole('region',{name:'Email message'}).getByText(name,{exact:true}).click();
  await expect.poll(async()=>(await fixture(page)).attachmentRequests.filter(request=>request.endsWith(':'+requested)).length).toBe(2);
  await expectRefused(page);
  await expect(review(page)).toHaveCount(0);
 }
 expect(await files(page)).toEqual([]);
 expect((await fixture(page)).mutations).toBe(0);
});

test('an oversized attachment is refused before any bytes are requested, and a response larger or other than declared is refused',async({page})=>{
 test.setTimeout(120_000);
 const seen=await watch(page);
 const big='A'.repeat(5*1024*1024+1);
 const lying=part('lying','small.bin','application/octet-stream',false,big);
 const swapped=part('swapped','ledger.bin','application/octet-stream',false,'declared bytes');
 swapped.response={...swapped.response!,dataBase64:b64(html)}; // not the bytes its hash and size describe
 await setup(page,[
  {partId:'honest',name:'archive.zip',mimeType:'application/zip',size:6*1024*1024,supported:false,response:null},
  {...lying,size:120}, // the listing understates the size
  swapped,
  part('traversal','..','text/html',false,html),
 ]);
 await page.getByText('archive.zip',{exact:true}).click();
 await expect(page.getByText('This attachment type cannot be previewed here, and this account cannot save it to Files. Open it in Gmail.',{exact:true})).toBeVisible();
 await expect(review(page)).toHaveCount(0);
 expect((await fixture(page)).attachmentRequests).toEqual([]);

 for(const [name,requested] of [['small.bin','lying'],['ledger.bin','swapped'],['..','traversal']] as const){
  // An understated size (the bytes exceed the cap), bytes other than the hash describes, and an unsafe name.
  await page.getByRole('region',{name:'Email message'}).getByText(name,{exact:true}).click();
  await expectRefused(page);
  await expect(review(page)).toHaveCount(0);
  expect((await fixture(page)).attachmentRequests.at(-1)).toBe(`gmailOpaqueAttachment:${requested}`);
 }
 expect(await files(page)).toEqual([]);
 await expectInert(page,seen);
});

test('an account that cannot save unpreviewed types offers nothing for an HTML attachment and requests no bytes',async({page})=>{
 const seen=await watch(page);
 await setup(page,[part('p1','invoice.html','text/html',false,html)],{opaque:false});
 await expect(page.getByRole('region',{name:'Email message'})).toContainText('Unsupported type or size');
 await page.getByText('invoice.html',{exact:true}).click();
 await expect(page.getByText('This attachment type cannot be previewed here, and this account cannot save it to Files. Open it in Gmail.',{exact:true})).toBeVisible();
 await expect(review(page)).toHaveCount(0);
 expect(await fixture(page)).toMatchObject({attachmentRequests:[],mutations:0});
 expect(await files(page)).toEqual([]);
 await expectInert(page,seen);
});

test('sharing the email with the agent is reviewed first and never includes an attachment name or its bytes',async({page})=>{
 const seen=await watch(page);
 await setup(page,[part('p1','invoice.html','text/html',false,html),part('p2','notes.txt','text/plain',true,html)],{agent:true});
 // Looking at an attachment does not put it in front of the agent.
 await page.getByText('notes.txt',{exact:true}).click();
 await expect(review(page).getByText(html,{exact:true})).toBeVisible();
 expect(JSON.stringify(await page.evaluate(async()=>(await import('/src/runtime/alpha-client.ts')).alphaClient.getState().context))).not.toMatch(/notes\.txt|invoice\.html|attacker\.invalid|onerror/);
 await review(page).getByRole('button',{name:'Back to message',exact:true}).click();
 await page.getByRole('button',{name:'Review email with agent',exact:true}).click();
 const sharing=page.getByRole('dialog',{name:'Review email sharing'});
 await expect(sharing).toContainText('The complete text below will be sent. Attachments are excluded.');
 await expect(sharing).toContainText('Please open the attached invoice.');
 await expect(sharing).not.toContainText('invoice.html');
 await expect(sharing).not.toContainText('notes.txt');
 await expect(sharing).not.toContainText(ATTACKER);
 await sharing.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(sharing).toHaveCount(0);
 await expectInert(page,seen);
});

// A file that is a valid image for its first bytes and a web page after them, and names that look
// like URLs. The type check passes the polyglot, so its preview is what has to be inert.
test('a PNG-and-HTML polyglot is previewed only as a sandboxed image, and URL-like names are refused or shown as plain text',async({page})=>{
 test.setTimeout(120_000);
 const seen=await watch(page);
 const polyglot='\x89PNG\r\n\x1a\n'+html+svg;
 const scheme='javascript:top.hostile=1;.txt',dataName='data:text/html,<script>top.hostile=1</script>.txt';
 await setup(page,[
  part('polyglot','photo.png','image/png',true,polyglot),
  part('data-name',dataName,'text/plain',true,'plain'),
  part('scheme-name',scheme,'text/plain',true,html),
 ]);
 await page.getByText('photo.png',{exact:true}).click();
 await expect(review(page).getByRole('heading',{name:'photo.png',exact:true})).toBeVisible();
 await expect(review(page)).toContainText(`SHA-256 ${sha(polyglot)}`);
 await expect(review(page)).not.toContainText('Invoice');
 await review(page).getByRole('button',{name:'Open reviewed file',exact:true}).click();
 const opened=page.getByRole('dialog',{name:'Reviewed attachment'});
 await expect(opened.getByRole('heading',{name:'photo.png',exact:true})).toBeVisible();
 // One frame, with every sandbox restriction, showing a blob typed as the image it was checked as.
 const frames=await opened.locator('iframe').evaluateAll(nodes=>nodes.map(node=>({sandbox:node.getAttribute('sandbox'),blob:(node as HTMLIFrameElement).src.startsWith('blob:'),attributes:node.getAttributeNames().sort()})));
 expect(frames).toEqual([{sandbox:'',blob:true,attributes:['sandbox','src','title']}]);
 expect(await opened.locator('iframe').evaluate(async node=>(await (await fetch((node as HTMLIFrameElement).src)).blob()).type)).toBe('image/png');
 expect(await opened.locator('script, object, embed, a[href]:not([download]), form').count()).toBe(0);
 // The Download control saves the blob under the checked name; it is not a link that navigates.
 expect(await opened.locator('a[download]').evaluateAll(nodes=>nodes.map(node=>[node.getAttribute('download'),(node as HTMLAnchorElement).protocol,node.getAttribute('target')]))).toEqual([['photo.png','blob:',null]]);
 await page.waitForTimeout(600);
 expect(seen).toEqual({requests:[],navigations:[],dialogs:[],popups:0});
 expect(await page.evaluate(()=>(window as any).hostile)).toBeUndefined();
 expect(page.frames().map(frame=>new URL(frame.url()).protocol).filter(protocol=>protocol!=='http:'&&protocol!=='blob:'&&protocol!=='about:')).toEqual([]);
 expect(new URL(page.url()).hostname).toBe('127.0.0.1');
 await opened.getByRole('button',{name:'Done',exact:true}).click();
 await expect(opened).toHaveCount(0);
 expect(page.frames().filter(frame=>frame.url().startsWith('blob:'))).toEqual([]);
 await review(page).getByRole('button',{name:'Back to message',exact:true}).click();

 // A data: URL as a file name contains a path separator: the response is refused, nothing opens.
 await page.getByRole('region',{name:'Email message'}).getByText(dataName,{exact:true}).click();
 await expectRefused(page);
 await expect(review(page)).toHaveCount(0);

 // A name that reads as a script URL is only ever text: in the list, the review and Files.
 await page.getByRole('region',{name:'Email message'}).getByText(scheme,{exact:true}).click();
 await expect(review(page).getByRole('heading',{name:scheme,exact:true})).toBeVisible();
 await expect(review(page).getByText(html,{exact:true})).toBeVisible();
 expect(await page.locator('a[href^="javascript:"], [src^="javascript:"], a[href^="data:"], [src^="data:text/html"]').count()).toBe(0);
 await expectInert(page,seen);
 expect((await fixture(page)).mutations).toBe(0);
});
