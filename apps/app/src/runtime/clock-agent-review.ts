import {registerPlugin} from '../platform-plugins';
import {createClockReviewExecutor,type ClockReviewBridge} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/clock-review-executor';
// One owner-retirement registry for this renderer; native approval remains in AlphaActionJournal.
const executor=createClockReviewExecutor(registerPlugin<ClockReviewBridge>('AlphaActionJournal'));
export const retireClockReviews=executor.retire;
export const reviewAgentClock=executor.review;
