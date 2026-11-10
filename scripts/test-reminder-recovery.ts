import {runReminderRecovery} from './reminder-recovery-fixture.ts';
const [appApk,testApk,output='test-results/reminder-recovery']=process.argv.slice(2);
await runReminderRecovery(false,appApk,testApk,output);
