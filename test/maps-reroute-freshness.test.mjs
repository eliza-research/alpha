import test from 'node:test';
import {execFileSync} from 'node:child_process';
test('Maps renderer reroute preserves the route when location becomes unusable',()=>{
 execFileSync(process.execPath,['--import=tsx','--test','scripts/test-maps-reroute-freshness.mjs'],{stdio:'pipe',timeout:60_000});
});
