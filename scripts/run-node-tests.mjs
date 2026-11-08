#!/usr/bin/env node
// Runs the node test suite: node scripts/run-node-tests.mjs [node --test options]
// Options come before the file glob so `npm test -- --test-name-pattern=x` reaches node --test.
// ALPHA_TEST_CONCURRENCY sets the worker count (default 4, the CI value).
import {spawn} from 'node:child_process';
const concurrency=process.env.ALPHA_TEST_CONCURRENCY||'4';
if(!/^[1-9]\d*$/.test(concurrency)){console.error('ALPHA_TEST_CONCURRENCY must be a positive integer');process.exit(2);}
const child=spawn(process.execPath,['--test',`--test-concurrency=${concurrency}`,'--test-timeout=600000',...process.argv.slice(2),'test/*.test.mjs'],{stdio:'inherit',cwd:new URL('..',import.meta.url)});
for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.on(signal,()=>{if(!child.killed)child.kill(signal);});
child.on('error',error=>{console.error(error.message);process.exit(1);});
child.on('exit',(code,signal)=>{if(signal){process.removeAllListeners(signal);process.kill(process.pid,signal);}else process.exit(code??1);});
