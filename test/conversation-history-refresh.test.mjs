import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');
const part=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};

// Source shape only: the send marks the conversation for the existing resync flush.
test('a reply flagged historyRefreshRequired marks the conversation for resync after the send',()=>{
 assert.match(part('  async send(text: string','    } catch (error) {'),/if\s*\(\s*'historyRefreshRequired' in reply\s*&&\s*reply\.historyRefreshRequired\s*===\s*true\s*\)\s*conversationResync\s*=\s*true;/);
});
