import {openBrowserCalendar} from './helpers/browser-calendar';
import {expect,type Page,type BrowserContext,type Locator} from '@playwright/test';
/** These storage fixtures never capture or play real media, including incidental alert priming. */
export async function guardCalendarFixture(context:BrowserContext){await context.addInitScript(()=>{
 Object.defineProperty(window,'AudioContext',{configurable:true,value:class{state='suspended';resume=async()=>{};close=async()=>{};}});
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{throw Error('Calendar fixture must not capture media');}}});
 HTMLMediaElement.prototype.play=async()=>{throw Error('Calendar fixture must not play media');};
});}
/** The modal editor keeps its form inert until its draft opens, and fill() silently does nothing on an inert field. */
export const calendarEditorReady=(dialog:Locator)=>expect(dialog.getByRole('button',{name:'Save event',exact:true})).toBeEnabled();
/** Quiet autosave readiness is its durable receipt, not presentation copy. */
export async function expectSavedCalendarDraft(page:Page,kind:'creation'|'edit'|'modal',extra:Record<string,unknown>={}){
 const expected=kind==='modal'?{
  title:await page.getByLabel('Event title',{exact:true}).inputValue(),
  body:await page.getByLabel('Event description',{exact:true}).inputValue(),
  location:await page.getByLabel('Event location',{exact:true}).inputValue(),
  start:await page.getByLabel('Starts',{exact:true}).inputValue(),end:await page.getByLabel('Ends',{exact:true}).inputValue(),
 }:{
  title:await page.getByRole('textbox',{name:'Title',exact:true}).inputValue(),
  notes:await page.getByRole('textbox',{name:'Notes',exact:true}).inputValue(),
  ...((await page.getByRole('switch',{name:'All day',exact:true}).getAttribute('aria-checked'))==='true'?{allDay:true}:{}),
 };
 await expect.poll(()=>page.evaluate(async kind=>{
  const {assistantDraftStore}=await import('/src/runtime/assistant-draft-store.ts');let binding:string;
  if(kind==='modal'){const {calendarDocument}=await import('/src/browser/calendar-store.ts');const row=JSON.parse((await calendarDocument.readRaw())!).events[0];binding=JSON.stringify(['calendar-modal-editor','app',row.id]);}
  else binding=JSON.stringify([kind==='creation'?'calendar-creation-form':'calendar-inline-edit-form','app']);
  const text=(await(await assistantDraftStore(binding)).read())?.text;if(!text)return null;const data=JSON.parse(text);return kind==='modal'?data.fields:kind==='edit'?data.editable.form:data.form;
 },kind)).toMatchObject({...expected,...extra});
}

/** An old saved reminder form is still restorable after its creation tab was removed. */
export async function restoreLegacyReminderForm(page:Page){
 await page.evaluate(async()=>{
  const {assistantDraftStore}=await import('/src/runtime/assistant-draft-store.ts');
  const store=await assistantDraftStore(JSON.stringify(['calendar-creation-form','app']));
  const saved=await store.read();
  if(!saved?.text)throw Error('The existing creation form was not retained');
  const value=JSON.parse(saved.text);value.form.cal='alpha-reminders';
  await store.save(saved,JSON.stringify(value));
 });
 await page.reload();await openBrowserCalendar(page);
 await page.getByRole('button',{name:'New event',exact:true}).click();
}
