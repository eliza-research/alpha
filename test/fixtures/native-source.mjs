/** Stage exact pinned native inputs privately; never write through shared staging aliases. */
import {mkdirSync,cpSync,symlinkSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {preparePatchedNative,NATIVE_SOURCE_MANIFEST} from '../../scripts/prepare-patched-native.mjs';
export function prepareNativeFixture(root,directory) {
 const fixture=join(realpathSync(directory),'native-source');
 mkdirSync(join(fixture,'vendor'),{recursive:true});
 symlinkSync(realpathSync(join(root,'vendor/eliza')),join(fixture,'vendor/eliza'),'dir');
 cpSync(join(root,'upstream.lock.json'),join(fixture,'upstream.lock.json'));
 mkdirSync(join(fixture,'android'));
 cpSync(join(root,NATIVE_SOURCE_MANIFEST),join(fixture,NATIVE_SOURCE_MANIFEST));
 return preparePatchedNative({root:fixture});
}
