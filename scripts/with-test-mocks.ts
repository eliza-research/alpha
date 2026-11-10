#!/usr/bin/env node
// Runs one command with the upstream test-mocks switch explicitly on:
//   node scripts/with-test-mocks.ts <command> [...args]
// Used by `npm run dev` and test-mocks builds. Production scripts never use it.
import {spawn} from 'node:child_process';
const [command,...args]=process.argv.slice(2);
if(!command){console.error('Usage: node scripts/with-test-mocks.ts <command> [...args]');process.exit(2);}
const child=spawn(command,args,{stdio:'inherit',shell:process.platform==='win32',env:{...process.env,ELIZA_DEV_ALLOW_TEST_MOCKS:'1'}});
const forward=(signal: any)=>{if(!child.killed)child.kill(signal);};
for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.on(signal,()=>forward(signal));
child.on('error',(error: any)=>{console.error(error.message);process.exit(1);});
child.on('exit',(code: any,signal: any)=>{if(signal){process.removeAllListeners(signal);process.kill(process.pid,signal);}else process.exit(code??1);});
