/**
 * Alpha's bindings to the shared external Clock handoff policy. Android Clock owns
 * alarms (P-17): a handoff receipt proves only that Clock opened, never that an
 * alarm exists, changed or rang. Validation, capability policy and review text are
 * upstream; Alpha supplies only its brand name and existing import names.
 */
import {
  assertClockHandoffObservation,
  assertClockHandoffTimeZone,
  buildClockHandoffRequest,
  clockHandoffFormDays,
  clockHandoffReceipt,
  describeClockHandoff as describeSharedClockHandoff,
  isClockHandoffOperation,
  validateClockHandoffDispatch,
  validateClockHandoffResult,
} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/clock-handoff.ts';
import type {ClockHandoffOperation} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/clock-contract.ts';
export {CLOCK_CAPABILITY, clockTimeZone} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/clock-contract.ts';
export type {ClockDay, ClockHandoffOperation as ClockOperation, ClockHandoffResult as ClockResult, ClockHandoffResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/clock-contract.ts';
export {CLOCK_DAY_NAMES, clockHandoffCapabilities, currentClockTimeZone, describeClockDays} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/clock-handoff.ts';
export type {ClockHandoffSetRequest as ClockSetRequest, ClockHandoffRequest as ClockDraftRequest} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/clock-handoff.ts';

/** Alpha's Clock form: one to seven unique days, ascending for EXTRA_DAYS. */
export const clockDays = clockHandoffFormDays;
export const isClockOperation = isClockHandoffOperation;
/** Handoffs only; an explicit empty repeat is dispatched as a one-time alarm. */
export const validateClockOperation = validateClockHandoffDispatch;
export const assertClockObservation = assertClockHandoffObservation;
export const validateClockOutcome = validateClockHandoffResult;
/** Bind a native dispatcher reply ({status}) to its typed handoff receipt. */
export const validateClockResult = clockHandoffReceipt;
export const buildClockRequest = buildClockHandoffRequest;
export function assertClockTimeZone(operation: ClockHandoffOperation, observed: string | undefined) {
  assertClockHandoffTimeZone(operation, observed);
}
export function describeClockHandoff(operation: ClockHandoffOperation): string {
  return describeSharedClockHandoff(operation, 'Alpha');
}
