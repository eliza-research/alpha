/**
 * Alpha's binding to the shared latest-Clock-handoff record. It is not an alarm database
 * or replay journal and never dispatches; validation, the stale-snapshot refusal and the
 * older-build legacy copy check are upstream. Alpha keeps only its installed slot and
 * legacy key so existing records stay readable.
 */
import {
  createClockHandoffHistory as createSharedClockHandoffHistory,
  type ClockHandoffHistoryStorage,
} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/clock-handoff-history.ts';
export type {ClockHandoffRecord,ClockHandoffSnapshot} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/clock-handoff-history.ts';
export const clockHandoffLegacyKey='alphaphone:clock-handoff:v1';
export const clockHandoffSlot='clock-handoff:v1:device';
export function createClockHandoffHistory(storage:ClockHandoffHistoryStorage,legacy:()=>string|null){
 return createSharedClockHandoffHistory({storage,slot:clockHandoffSlot,legacy});
}
