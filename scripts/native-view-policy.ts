import {readFileSync} from 'node:fs';

/** Product-owned renderer routes, never caller-supplied view metadata. */
export const nativeViewPolicyPath = new URL('../config/native-view-declarations.json', import.meta.url);
export const nativeViewDeclarationsJson = readFileSync(nativeViewPolicyPath, 'utf8');
