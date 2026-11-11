import test from 'node:test';
import {runPhoneSessionCase1} from '../specs/quint/refinement/services/phone-session-replay.mjs';

test('the Phone adapter follows PhoneSession scenarios, witnesses and random walks', {timeout: 240000}, async () => runPhoneSessionCase1(undefined));
