import {verifyAospClockHandlers as verifySystemClock} from '../vendor/eliza/packages/os/scripts/android/aosp-clock-handlers.mjs';

export {clockProductRequirement} from '../vendor/eliza/packages/os/scripts/android/aosp-clock-handlers.mjs';

/** Keep the product CLI's environment hint while using Eliza's system Clock admission. */
export function verifyAospClockHandlers(run, user, expectedFingerprint) {
  try {
    return verifySystemClock(run, user, expectedFingerprint);
  } catch (error) {
    if (error.message === 'Explicit expected image fingerprint required')
      throw Error('Explicit expected image fingerprint required (ALPHA_EXPECTED_IMAGE_FINGERPRINT)', {cause: error});
    throw error;
  }
}
