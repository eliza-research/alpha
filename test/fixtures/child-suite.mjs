/** Run one scripts/ child suite from the repository root and report its output when it fails. */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
export function runChildSuite(script,{flags=[],timeout=60_000,cwd=new URL('../..',import.meta.url)}={}) {
 // An independent child process. A script that declares node:test cases needs Bun's test runner;
 // the others are plain programs.
 const env={...process.env};
 const declaresTests=/from ['"]node:test['"]/.test(readFileSync(join(cwd instanceof URL?fileURLToPath(cwd):String(cwd),'scripts',script),'utf8'));
 try { return execFileSync(process.execPath,[...flags,...(declaresTests?['test',`./scripts/${script}`]:[`scripts/${script}`])],{cwd,timeout,stdio:'pipe',env,encoding:'utf8'}); }
 catch(error) { throw new Error(`${script} failed (status ${error.status}, signal ${error.signal}):\n${error.stdout||''}\n${error.stderr||''}`,{cause:error}); }
}
