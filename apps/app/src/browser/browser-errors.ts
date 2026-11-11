import {CapacitorException,ExceptionCode} from '@capacitor/core';

/** The native tab host's refusal when the System WebView lacks isolated profiles, and what Alpha says instead. */
export const PROFILE_UNSUPPORTED_NATIVE_MESSAGE='This Android WebView does not support isolated browser profiles';
export const PROFILE_UNSUPPORTED_MESSAGE='Update WebView';

/** Keep Browser recovery guidance intact; native implementation names are not user instructions. */
export function browserErrorMessage(error:unknown):string {
 if(error instanceof CapacitorException && error.code===ExceptionCode.Unimplemented)return 'Unavailable';
 if(error instanceof Error && error.message===PROFILE_UNSUPPORTED_NATIVE_MESSAGE)return PROFILE_UNSUPPORTED_MESSAGE;
 return error instanceof Error ? error.message : 'Browser unavailable';
}
