import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// The resident's local speech routes accept only its per-boot token. The owner token gets 401,
// and a 401 clears the enrollment (upstream defect 1). Device evidence only.
const source = readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java', 'utf8');

test('local speech routes use the per-boot token and every other route the owner session', () => {
  assert.match(source, /static String routeToken\(String path,String session\)\{return path\.startsWith\("\/api\/asr\/local-inference\/"\)\?ElizaAgentService\.localAgentToken\(\):session;\}/);
  assert.match(source, /"Bearer "\+routeToken\("\/api\/asr\/local-inference\/live",token\)/);
  assert.match(source, /if\(token!=null\)headers\.put\("Authorization","Bearer "\+routeToken\(path,token\)\);/);
});
