import {calendarDocument} from './calendar-store';
import {openDomainRecovery} from './domain-recovery';
import {prepareCalendarBackup,prepareCalendarSalvage} from './calendar-backup';
import {revision} from './revision';
export function openCalendarRecovery(){openDomainRecovery(calendarDocument,'calendar','App calendar recovery','Download a backup first.',undefined,{
 prepare(raw){const state=prepareCalendarBackup(raw,revision);return {raw:JSON.stringify(state),summary:`${state.events.length} events\n`+state.events.slice(0,20).map(event=>event.title).join('\n')+(state.events.length>20?'\n…':'')};},
 salvage(raw){const {state,skipped}=prepareCalendarSalvage(raw,revision);return {raw:JSON.stringify(state),summary:`${state.events.length} ok · ${skipped.length} skipped\n`+state.events.slice(0,20).map(event=>event.title).join('\n')+(state.events.length>20?'\n…':'')+'\n'+skipped.slice(0,20).map(row=>`Skipped record ${row.index}: ${row.reason}`).join('\n')+(skipped.length>20?'\nMore skipped records are retained in your original backup.':'')};},
 save:(expected,raw,signal)=>calendarDocument.restore(expected,raw,signal),
});}
