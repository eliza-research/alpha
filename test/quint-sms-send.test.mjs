import test from 'node:test';
import {runSmsSendCase1,runSmsSendCase2} from '../specs/quint/refinement/services/sms-send-replay.mjs';

test('the Messages adapter follows SmsSend scenarios, witnesses and random walks', {timeout: 240000}, async () => runSmsSendCase1(undefined));
test('accepted empty SMS and retired uncertain SMS cannot dispatch; fresh owner text mints a new identity', async () => runSmsSendCase2(undefined));
