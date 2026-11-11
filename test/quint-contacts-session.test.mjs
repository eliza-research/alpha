import test from 'node:test';
import {runContactsSessionCase1} from '../specs/quint/refinement/services/contacts-session-replay.mjs';

test('the Contacts adapter follows ContactsSession scenarios, witnesses and random walks', {timeout: 240000}, async () => runContactsSessionCase1(undefined));
