import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './strip-types.mjs';

// Execute the actual shell helper; these lifecycle fixtures have no saved attachments.
const source=readFileSync(new URL('../../apps/app/src/prototype/agent-adapter.ts',import.meta.url),'utf8');
const start=source.indexOf('function attachmentKey(');
const end=source.indexOf('\nconst preDispatchRefusals',start);
assert.ok(start>=0&&end>start,'attachment restoration source boundary');
const load=new Function('browserDocuments',stripTypeScriptTypes(source.slice(start,end),{mode:'strip'})+'\nreturn restoreAttachments;');
export const restoreAttachments=load({read:async()=>null});
