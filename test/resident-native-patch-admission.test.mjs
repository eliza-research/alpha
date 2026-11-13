import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {preparePatchedNative} from '../scripts/prepare-patched-native.ts';
test('obsolete resident patch slot is refused rather than reapplied',()=>{
 assert.throws(()=>preparePatchedNative({manifestFile:'resident-native-manifest.json'}),/Unknown native patch slot/);
 assert.equal(fs.existsSync('patches/eliza/resident-ipc-recovery.patch'),false);
});
