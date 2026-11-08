import {openLegacyNotes} from './helpers/legacy-notes';
/*
 * Journey J03: Inbox attachment -> Files -> reviewed document question -> reviewed summary note
 * with a verified source reference, driven start to finish through rendered controls in the
 * browser build with the development agent profile.
 *
 * Loop covered in one test:
 *  1. A development incoming email with a text attachment arrives ("Device controls" ->
 *     "Incoming email"). Inbox -> message -> attachment review -> "Save to Files".
 *  2. Files -> Internal storage -> open the saved document -> "Ask Alpha" -> review/trim the excerpt ->
 *     "Use in conversation" -> Send.
 *  3. "Review summary note": Cancel saves nothing; then edit and "Save reviewed note".
 *  4. Reload: the note persists once with its source reference; "Open linked source" opens the
 *     exact source document.
 *  5. The source bytes change: the reference fails closed and opens nothing.
 *  6. The source file is deleted in Files: the reference fails closed and the note is unchanged.
 *
 * Synthetic fixtures (external boundaries only):
 *  - Mail: the development incoming-email simulator. No mailbox, provider or network is used.
 *    Provider (Gmail) attachment review and its Save to Files are covered separately by
 *    inbox-save-attachment.spec.ts with a closed provider fixture.
 *  - Agent: the development agent profile with a scripted reply.
 *  - Source change (step 5): the browser build has no rendered control that edits a stored
 *    file's bytes in place, so the stored bytes are changed directly in the Files database, the
 *    same external-change simulation source-reference-integrity.spec.ts uses. Everything that
 *    reacts to the change is the real UI.
 *
 * Native-only / not provable here:
 *  - A real mailbox attachment, Android document-provider grants (expired URI, revoked account),
 *    and a provider file changing underneath a persisted URI grant.
 *  - A real agent's answer quality.
 *
 * A pass is source/test evidence only. It is not APK, emulator, AOSP image, device or
 * real-integration evidence.
 */
import {test,expect,type Page} from '@playwright/test';
import {createHash} from 'node:crypto';
import {returnToApps} from './app-navigation';

test.setTimeout(300_000);

const contents='Public fact: twelve raised beds.\nPRIVATE OMIT: do not send this line.';
const excerpt='Public fact: twelve raised beds.';
const reply='The report says there are twelve raised beds.';
const failClosed='Linked source changed or access is unavailable. Choose the matching source file again.';

// READ-ONLY views of persisted state.
const notes=(page:Page)=>page.evaluate(async()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())||'{"records":[]}').records as any[]);
const files=(page:Page)=>page.evaluate(async()=>{const{registerPlugin}=await import('/src/platform-plugins.ts');return (await registerPlugin<any>('AlphaFiles').list({})).entries as any[];});
const agentMessages=(page:Page)=>page.evaluate(async()=>(await (await import('/src/browser/development-agent-document.ts')).readDevelopmentAgent((await import('/src/browser/development-identity.ts')).developmentIdentity('local'))).conversations.flatMap((c:any)=>c.messages) as any[]);
const ready=(page:Page)=>expect(page.getByRole('button',{name:'Settings',exact:true})).toBeVisible({timeout:90_000});

async function openLinkedSource(page:Page){
 await returnToApps(page);
 await openLegacyNotes(page);
 await page.getByRole('button',{name:'Open Garden summary',exact:true}).click();
 await page.getByRole('button',{name:'Attachment',exact:true}).click();
 const source=page.getByRole('dialog',{name:'Note source document'});
 await expect(source).toContainText('garden-report.txt');
 await source.getByRole('button',{name:'Open linked source',exact:true}).click();
 return source;
}

test('J03: an Inbox attachment is saved to Files, analysed, and kept as a reviewed note whose source link opens the source and fails closed when it changes or is deleted',async({page})=>{
 await page.goto('/?mode=dev&tools=1');await ready(page);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Agent connection',exact:true}).click();
 await page.getByRole('textbox',{name:'Scripted reply'}).fill(reply);
 await page.getByRole('button',{name:'Save development reply'}).click();
 await page.getByRole('button',{name:'Connect development profile'}).click();
 await returnToApps(page);await openLegacyNotes(page);await returnToApps(page);

 // ---- 1. Incoming email attachment -> Inbox review -> Save to Files ----
 await page.getByRole('button',{name:'Device controls',exact:true}).click();
 await page.getByRole('button',{name:'Incoming email',exact:true}).click();
 const incoming=page.getByRole('dialog',{name:'Incoming email',exact:true});
 await incoming.getByLabel('Subject',{exact:true}).fill('Garden report');
 await incoming.getByLabel('Email body',{exact:true}).fill('Report attached.');
 await incoming.getByLabel('Attachments',{exact:true}).setInputFiles({name:'garden-report.txt',mimeType:'text/plain',buffer:Buffer.from(contents)});
 await expect(incoming.getByRole('status')).toHaveText('1 attachment ready');
 await incoming.getByRole('button',{name:'Deliver',exact:true}).click();
 await expect(incoming).toHaveCount(0);
 await returnToApps(page);
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await page.getByRole('button',{name:/Garden report/}).click();
 await expect(page.getByRole('heading',{name:'Garden report',level:1})).toBeVisible();
 expect(await files(page)).toEqual([]);
 await page.getByRole('button',{name:'Open garden-report.txt',exact:true}).click();
 const attachment=page.getByRole('dialog',{name:'Reviewed attachment'});
 await expect(attachment).toContainText(excerpt);
 // Reviewing the attachment stores nothing.
 expect(await files(page)).toEqual([]);
 const saveToFiles=attachment.getByRole('button',{name:'Save to Files',exact:true});
 await saveToFiles.click();
 await expect(attachment.getByRole('status')).toHaveText('Saved in Files. Exact bytes verified.');
 await expect(saveToFiles).toBeDisabled();
 await attachment.getByRole('button',{name:'Done',exact:true}).click();
 await expect(attachment).toHaveCount(0);
 const stored=await files(page);
 expect(stored.map(e=>[e.name,e.mimeType,e.size])).toEqual([['garden-report.txt','text/plain',Buffer.byteLength(contents)]]);

 // ---- 2. Files -> open -> reviewed question to the agent ----
 await returnToApps(page);
 await page.getByRole('button',{name:'Files',exact:true}).click();
 await page.getByRole('button',{name:'Internal storage',exact:true}).click();
 await page.getByRole('button',{name:'Open garden-report.txt',exact:true}).click();
 await expect(page.getByText('PRIVATE OMIT: do not send this line.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Ask Alpha',exact:true}).click();
 const question=page.getByRole('dialog',{name:'Ask about selected content'});
 await expect(question.getByRole('textbox',{name:'Content excerpt'})).toHaveValue(contents);
 await expect(question.getByRole('checkbox',{name:'Link this source when saving the answer to Notes'})).toBeChecked();
 await question.getByRole('textbox',{name:'Content excerpt'}).fill(excerpt);
 await question.getByRole('button',{name:'Use in conversation',exact:true}).click();
 await expect(question).toHaveCount(0);
 // Composed only: nothing reaches the agent before Send.
 expect(await agentMessages(page)).toEqual([]);
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.getByText('Review summary note',{exact:true})).toBeVisible();
 const sent=await agentMessages(page);
 expect(sent.map(m=>m.role)).toEqual(['user','assistant']);
 expect(sent[0].text).toContain(excerpt);
 expect(JSON.stringify(sent)).not.toContain('PRIVATE OMIT');
 expect(sent[1].text).toBe(reply);

 // ---- 3. Reviewed, editable summary note with a source reference ----
 expect(await notes(page)).toEqual([]);
 await page.getByText('Review summary note',{exact:true}).click();
 const review=page.getByRole('dialog',{name:'Save reviewed summary note'});
 await expect(review.getByRole('textbox',{name:'Summary note text'})).toHaveValue(reply);
 await expect(review).toContainText('The note will link to garden-report.txt.');
 await review.getByRole('button',{name:'Cancel',exact:true}).click();
 expect(await notes(page)).toEqual([]);
 await page.getByText('Review summary note',{exact:true}).click();
 await review.getByRole('textbox',{name:'Summary note title'}).fill('Garden summary');
 await review.getByRole('textbox',{name:'Summary note text'}).fill('There are twelve raised beds.');
 await review.getByRole('button',{name:'Save reviewed note',exact:true}).click();
 await expect(review).toHaveCount(0);
 await expect(page.getByText('Summary note saved',{exact:true})).toBeVisible();
 // The saved card stays saved: it does not revert to a review, and choosing it is not a second Save.
 await expect(page.getByText('Review summary note',{exact:true})).toHaveCount(0);
 await page.getByText('Summary note saved',{exact:true}).click();
 await expect(review).toHaveCount(0);
 await expect(page.getByText('Summary note saved',{exact:true})).toHaveCount(1);
 await expect(page.getByText('Review summary note',{exact:true})).toHaveCount(0);
 const retained=await notes(page);
 expect(retained).toHaveLength(1);
 expect(retained[0]).toMatchObject({title:'Garden summary',body:'There are twelve raised beds.'});
 expect(retained[0].documentSource).toEqual({version:1,name:'garden-report.txt',mimeType:'text/plain',size:Buffer.byteLength(contents),sha256:createHash('sha256').update(contents).digest('hex'),reference:expect.stringMatching(/^b1:[a-f0-9-]{36}$/)});
 expect(JSON.stringify(retained)).not.toContain('PRIVATE OMIT');

 // ---- 4. Reload: note persists once; its verified source reference opens the source ----
 await page.reload();await ready(page);
 // Rendered first: the Notes list shows the summary exactly once.
 await returnToApps(page);
 await openLegacyNotes(page);
 await expect(page.getByRole('button',{name:'Open Garden summary',exact:true})).toHaveCount(1);
 await expect(page.getByRole('region',{name:'Notes'}).getByRole('button',{name:/^Open (?!Trash$)/})).toHaveCount(1);
 // Storage agrees (secondary check).
 expect(await notes(page)).toEqual(retained);
 expect((await files(page)).map(e=>e.name)).toEqual(['garden-report.txt']);
 let source=await openLinkedSource(page);
 const preview=page.getByRole('dialog',{name:'Reviewed attachment'});
 await expect(preview).toContainText('garden-report.txt');
 await expect(preview).toContainText('PRIVATE OMIT: do not send this line.');
 // A source opened from a note is a read-only review; it does not offer another copy.
 await expect(preview.getByRole('button',{name:'Save to Files',exact:true})).toHaveCount(0);
 await preview.getByRole('button',{name:'Done',exact:true}).click();
 await expect(preview).toHaveCount(0);
 await source.getByRole('button',{name:'Done',exact:true}).click();

 // ---- 5. The stored source bytes change: the reference fails closed ----
 // External-change simulation (see header): no rendered control edits stored bytes in place.
 await page.evaluate(()=>new Promise<void>((resolve,reject)=>{const open=indexedDB.open('alpha.browser.files.v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('entries','readwrite'),store=tx.objectStore('entries'),all=store.getAll();all.onsuccess=()=>{const row=all.result.find((r:any)=>r.name==='garden-report.txt');row.bytes=new TextEncoder().encode('Public fact: thirteen raised beds.').buffer;row.size=row.bytes.byteLength;store.put(row);};tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};};}));
 source=await openLinkedSource(page);
 await expect(source.getByRole('status')).toHaveText(failClosed);
 await expect(preview).toHaveCount(0);
 expect(await notes(page)).toEqual(retained);
 await source.getByRole('button',{name:'Done',exact:true}).click();

 // ---- 6. The source file is deleted in Files: the reference fails closed ----
 await returnToApps(page);
 await page.getByRole('button',{name:'Files',exact:true}).click();
 await page.getByRole('button',{name:'Internal storage',exact:true}).click();
 await page.getByRole('button',{name:'Sort and more',exact:true}).click();await page.getByRole('button',{name:'Select',exact:true}).click();
 await page.getByRole('button',{name:'Select garden-report.txt',exact:true}).click();
 // Delete moves to Trash; only a confirmed Empty deletes.
 await page.getByRole('toolbar',{name:'Selection actions'}).getByRole('button',{name:'Delete',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open garden-report.txt',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('button',{name:'Trash',exact:true}).click();
 await page.getByRole('button',{name:'Empty',exact:true}).click();await page.getByRole('dialog',{name:'Empty Trash?',exact:true}).getByRole('button',{name:'Empty',exact:true}).click();
 await expect(page.getByRole('button',{name:'garden-report.txt',exact:true})).toHaveCount(0);
 expect((await files(page)).filter(e=>!e.name.startsWith('.'))).toEqual([]);
 source=await openLinkedSource(page);
 await expect(source.getByRole('status')).toHaveText(failClosed);
 await expect(preview).toHaveCount(0);
 await source.getByRole('button',{name:'Done',exact:true}).click();
 await page.reload();await ready(page);
 // The note and its recorded provenance survive; only the link's target is gone.
 expect(await notes(page)).toEqual(retained);
 expect((await files(page)).filter(e=>!e.name.startsWith('.'))).toEqual([]);
});
