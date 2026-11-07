import {test,expect,type Page} from '@playwright/test';
import {canonicalNotesFixture,openCanonicalNotes} from './helpers/canonical-notes';
import {setTextScale} from './accessibility-states';

// Live agent Notes are drawn by Alpha's own Notes template, the one mock mode shows, in the view refresh
// layout (PLAN.md section 3): header with Back, title, Record and +, the folder chips, and a one-column
// list (title, date, two-line preview) with a Pinned section. Recently deleted is a folder chip while it
// has items; Previous notes is a quiet text action under the list. Screenshots land in test-results/notes-restore for side-by-side review
// with the mock-mode reference.
const SHOTS='test-results/notes-restore';
const at='2026-10-30T09:00:00.000Z';
const note=(id:string,title:string,body:string,format?:{kind:string;data:Record<string,unknown>})=>({id,title,body:body?'\n'+body:'',color:'yellow',createdAt:at,updatedAt:at,...(format?{format}:{})});
const NOTES=[
 note('voice-sync','Design sync','',{kind:'voice',data:{dur:408,when:'Yesterday · 4:10 PM',
  lines:[{s:'me',t:'Lock screen first. Notifications stay as icons until you unlock.',at:0},{s:'me',t:'Voice still works locked, but the answers stay vague.',at:42},{s:'me',t:'Cut the mark button from the recorder.',at:190}],
  summary:['Notifications stay as icons until unlock','Voice works while locked; answers stay vague','The recorder drops the mark button'],
  actions:[{t:'Wire the recorder into Notes by Thursday',done:false},{t:'Send the prototype to the team tonight',done:true},{t:'Book a design review next week',done:false}]}}),
 note('launch','Launch checklist','Confirm attestation flow\nShip the keys-on-device doc\nDry run Friday',{kind:'text',data:{pinned:true}}),
 note('groceries','Groceries','',{kind:'list',data:{items:[{t:'Oat milk',done:true},{t:'Espresso beans',done:false},{t:'Lemons',done:false},{t:'Sourdough loaf',done:false}]}}),
 note('agents','The case for on-device agents','',{kind:'link',data:{url:'https://news.example/on-device-agents',domain:'news.example',clips:['Keys that never leave the device change what an assistant can be trusted with.','The phone becomes the agent\'s body, not just its screen.']}}),
 note('gifts','Gift ideas','Film camera, ceramics class.\nThe print show at the museum.'),
 // A voice-kind record without transcript, summary or actions is a plain text card.
 note('voicemail','Radiator','Call the landlord Friday. Bedroom radiator clanks all night.',{kind:'voice',data:{}}),
];
async function openSeeded(page:Page,path='/'){
 const fixture=await canonicalNotesFixture(page,{path,notes:NOTES});await openCanonicalNotes(page);
 await expect(page.getByRole('button',{name:'Open Design sync',exact:true})).toBeVisible();
 await page.evaluate(()=>document.fonts.ready);
 return fixture;
}
const card=(page:Page,title:string)=>page.getByRole('button',{name:`Open ${title}`,exact:true});
async function shot(page:Page,name:string){await page.screenshot({path:`${SHOTS}/${name}.png`,animations:'disabled'});}
/** Geometry and paint of the Notes list that the mock design fixes, header actions and their icons included. */
async function layout(page:Page){
 return page.evaluate(()=>{
  const box=(el:Element|null)=>{if(!el)return null;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {x:Math.round(r.x),w:Math.round(r.width),radius:s.borderRadius,bg:s.backgroundColor};};
  const cards=[...document.querySelectorAll('[data-alpha-subview="notes-list"] button.notes-row')];
  // Mock mode's banner moves the whole view down, so header actions are placed within their header.
  const header=document.querySelector('[data-alpha-subview="notes-list"] [data-alpha-app-header="main"]')!,top=header.getBoundingClientRect().y;
  const actions=[...header.querySelectorAll('button')].map(el=>{const r=el.getBoundingClientRect(),icon=el.querySelector('[data-alpha-icon]');return {x:Math.round(r.x),y:Math.round(r.y-top),w:Math.round(r.width),h:Math.round(r.height),icon:icon?.getAttribute('data-alpha-icon'),iconSize:icon&&Math.round(icon.getBoundingClientRect().width)};});
  return {title:getComputedStyle(document.querySelector('[data-alpha-app-title]')!).fontSize,search:box(document.querySelector('[data-alpha-subview="notes-list"] button[aria-label="Search notes"]')),
   columns:[...new Set(cards.map(el=>Math.round(el.getBoundingClientRect().x)))].sort((a,b)=>a-b),first:box(cards[0]),actions};
 });
}

test('live agent Notes use the mock-mode Notes design with typed cards',async({page})=>{
 await page.goto('/?mode=mock&start=notes');await expect(page.getByRole('button',{name:'Open Design sync',exact:true})).toBeVisible();
 const mock=await layout(page);await shot(page,'reference-mock-list');
 // The mock checklist editor, for the side-by-side review of the live one.
 await card(page,'Groceries').click();await expect(page.getByRole('button',{name:'Uncheck Oat milk',exact:true})).toBeVisible();
 await shot(page,'reference-mock-checklist');
 const {foreign,errors}=await openSeeded(page);
 // Same header as mock mode: Back, title, Record and +, each in the same place, size and icon.
 expect(await layout(page)).toEqual(mock);
 await expect(page.getByRole('heading',{name:'Notes',exact:true})).toBeVisible();
 const header=page.locator('[data-alpha-subview="notes-list"] [data-alpha-app-header="main"]');
 expect(await header.getByRole('button').evaluateAll(list=>list.map(el=>el.getAttribute('aria-label')))).toEqual(['Back to apps','Record and transcribe','New note']);
 for(const name of ['Back to apps','Record and transcribe','New note','All','New folder'])await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
 // No search pill and no Trash in the header (decisions P2, N2).
 await expect(page.getByRole('button',{name:'Search notes',exact:true})).toHaveCount(0);
 await expect(header.getByRole('button',{name:'Open Trash',exact:true})).toHaveCount(0);
 // One column: Pinned first, every row at the same x.
 const order=await page.locator('[data-alpha-subview="notes-list"] button.notes-row').evaluateAll(list=>list.map(el=>[el.getAttribute('aria-label'),Math.round(el.getBoundingClientRect().x)]));
 expect(order[0][0]).toBe('Open Launch checklist');expect(order).toHaveLength(6);expect(new Set(order.map(([,x])=>x)).size).toBe(1);
 await expect(page.locator('.notes-section',{hasText:'Pinned'})).toBeVisible();
 await expect(card(page,'Design sync')).toContainText('6:48');
 await expect(card(page,'The case for on-device agents')).toContainText('news.example');
 await expect(card(page,'Groceries')).toContainText('☑ Oat milk');
 await expect(card(page,'Radiator')).toContainText('Call the landlord Friday.');
 // The shared Notes view's agent ids stay on the matching controls (canonical-notes-ui.ts, template.html).
 const ids=(scope:string)=>page.locator(`${scope} [data-agent-id]`).evaluateAll(list=>list.filter(el=>(el as HTMLElement).getClientRects().length).map(el=>el.getAttribute('data-agent-id')));
 const listIds=await ids('[data-alpha-subview="notes-list"]');
 expect(listIds.slice(0,4)).toEqual(['notes-record','notes-new','notes-new-folder','launch']);expect(listIds.at(-1)).toBe('notes-source-legacy');
 expect([...listIds].sort()).toEqual(['agents','gifts','groceries','launch','notes-new','notes-new-folder','notes-record','notes-source-legacy','voice-sync','voicemail']);
 await shot(page,'live-list');
 // Recently deleted shows only while it has items; Previous notes is a quiet text action under the list.
 await expect(page.getByRole('button',{name:'Recently deleted',exact:true})).toHaveCount(0);
 const previous=page.getByRole('button',{name:'Previous notes',exact:true});
 await previous.scrollIntoViewIfNeeded();await expect(previous).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 const [p,last]=[(await previous.boundingBox())!,(await card(page,'Radiator').boundingBox())!];
 expect(p.height).toBeGreaterThanOrEqual(48);expect(p.y).toBeGreaterThan(last.y);
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});

test('live agent Notes in dark mode, the text editor and the checklist editor',async({page})=>{
 const {foreign,errors}=await openSeeded(page,'/?theme=dark');
 await shot(page,'live-list-dark');
 await card(page,'Launch checklist').click();
 await expect(page.getByRole('textbox',{name:'Note',exact:true})).toHaveValue('Confirm attestation flow\nShip the keys-on-device doc\nDry run Friday');
 for(const name of ['Back to notes','Turn into checklist','Share note','More','Review reminder draft','Review calendar event draft']){
  const control=page.getByRole('button',{name,exact:true});await expect(control).toBeVisible();
  const box=(await control.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(412);
  // The editor header: Back · Checklist · Share · ⋯ at 44px; the draft actions are full 48px rows.
  expect(box.height).toBeGreaterThanOrEqual(name.startsWith('Review')?47.5:43.5);
 }
 // ⋯ holds Unpin, Move to… and Delete.
 await page.getByRole('button',{name:'More',exact:true}).click();
 const menu=page.getByRole('dialog',{name:'Note actions'});
 for(const name of ['Unpin','Move to…','Delete'])await expect(menu.getByRole('button',{name,exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);
 await shot(page,'live-editor-dark');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await card(page,'Groceries').click();
 await expect(page.getByRole('button',{name:'Uncheck Oat milk',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Check Lemons',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).canonicalNotesFixture.state.notes.find((n:any)=>n.id==='groceries').format.data.items[2])).toEqual({t:'Lemons',done:true});
 expect(await page.locator('[data-alpha-subview="notes-editor"] [data-agent-id]').evaluateAll(list=>list.map(el=>el.getAttribute('data-agent-id')))).toEqual(
  expect.arrayContaining(['notes-back','notes-format','notes-share','notes-more','notes-title','notes-draftReminder','notes-draftEvent','notes-remove-item-0','notes-remove-item-3','notes-add-item']));
 await shot(page,'live-checklist-dark');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await card(page,'Design sync').click();
 await expect(page.getByText('Notifications stay as icons until unlock',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Play recording',exact:true}).or(page.getByRole('button',{name:'Play',exact:true}))).toHaveCount(0);
 expect(await page.locator('[data-alpha-subview="notes-voice"] [data-agent-id]').evaluateAll(list=>list.map(el=>el.getAttribute('data-agent-id')))).toEqual(
  expect.arrayContaining(['notes-back','notes-share','notes-more','notes-action-0','notes-action-2']));
 await shot(page,'live-voice-dark');
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});

test('live agent Notes light editor, checklist and restore-only Recently deleted',async({page})=>{
 const {foreign,errors}=await openSeeded(page);
 await card(page,'Launch checklist').click();
 await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Launch checklist');
 await shot(page,'live-editor');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await card(page,'Groceries').click();
 await expect(page.getByRole('button',{name:'Uncheck Oat milk',exact:true})).toBeVisible();
 await shot(page,'live-checklist');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await card(page,'Gift ideas').click();
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('dialog',{name:'Note actions'}).getByRole('button',{name:'Delete',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).canonicalNotesFixture.state.trash.length)).toBe(1);
 await page.getByRole('button',{name:'Recently deleted',exact:true}).click();
 const trash=page.locator('[data-alpha-subview="notes-trash"]');
 await expect(trash.getByRole('button',{name:'Gift ideas',exact:true})).toBeVisible();
 await expect(trash.getByRole('button',{name:'Empty Recently deleted',exact:true})).toHaveCount(0);
 await shot(page,'live-trash');
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});

test('live agent Notes at 300% text keep cards and controls on screen',async({page})=>{
 test.setTimeout(90_000);
 await page.goto('/?mode=mock&start=notes');await expect(page.getByRole('button',{name:'Open Design sync',exact:true})).toBeVisible();
 await setTextScale(page,3);await shot(page,'reference-mock-list-300pct');
 const {foreign,errors}=await openSeeded(page);
 await setTextScale(page,3);
 const overflow=await page.evaluate(()=>{
  const out:string[]=[];
  for(const el of document.querySelectorAll<HTMLElement>('[data-alpha-subview="notes-list"] button')){
   if(!el.getClientRects().length)continue;const r=el.getBoundingClientRect();
   if(r.left<-1||r.right>innerWidth+1)out.push(`${el.getAttribute('aria-label')} outside the screen`);
   if(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1)out.push(`${el.getAttribute('aria-label')} clips its text`);
  }
  return out;
 });
 expect(overflow).toEqual([]);
 for(const name of ['Back to apps','Record and transcribe','New note','New folder']){const box=(await page.getByRole('button',{name,exact:true}).boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.x+box.width).toBeLessThanOrEqual(413);}
 await shot(page,'live-list-300pct');
 await card(page,'Launch checklist').click();
 await expect(page.getByRole('textbox',{name:'Note',exact:true})).toBeVisible();
 await shot(page,'live-editor-300pct');
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});
