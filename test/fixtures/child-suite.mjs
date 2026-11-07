/** Run one scripts/ child suite from the repository root and report its output when it fails. */
import {execFileSync} from 'node:child_process';
export function runChildSuite(script,{flags=[],timeout=60_000,cwd=new URL('../..',import.meta.url)}={}) {
 // An independent child suite, not an IPC worker of node:test.
 const env={...process.env};
 delete env.NODE_TEST_CONTEXT;
 try { return execFileSync(process.execPath,[...flags,`scripts/${script}`],{cwd,timeout,stdio:'pipe',env,encoding:'utf8'}); }
 catch(error) { throw new Error(`${script} failed (status ${error.status}, signal ${error.signal}):\n${error.stdout||''}\n${error.stderr||''}`,{cause:error}); }
}
