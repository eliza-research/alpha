import test from 'node:test';
import {runMmsComposeCase1,runMmsComposeCase2,runMmsComposeCase3} from '../specs/quint/refinement/services/mms-compose-replay.mjs';

test('the MMS composer follows MmsCompose scenarios, witnesses and random walks', {timeout: 240000}, async () => runMmsComposeCase1(undefined));
test('accepted empty MMS and hidden uncertain MMS cannot dispatch; an owned edit starts a new identity', async () => runMmsComposeCase2(undefined));
test('a declined MMS review is reviewed again under a new operation ID without editing the draft', async () => runMmsComposeCase3(undefined));
