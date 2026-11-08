import test from 'node:test';
import {execFileSync} from 'node:child_process';
test('Maps renderer reroute preserves the route when location becomes unusable',()=>{
 // An independent child suite: inheriting NODE_TEST_CONTEXT would make it report to this
 // runner over IPC and exit 0 even when its own tests fail.
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 try{execFileSync(process.execPath,['--experimental-transform-types','--test','scripts/test-maps-reroute-freshness.mjs'],{stdio:'pipe',timeout:60_000,env,encoding:'utf8'});}
 catch(error){throw new Error(`reroute freshness suite failed (status ${error.status}):\n${error.stdout||''}\n${error.stderr||''}`,{cause:error});}
});
