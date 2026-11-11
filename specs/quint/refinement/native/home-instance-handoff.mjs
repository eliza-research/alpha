import {fileURLToPath} from 'node:url';
import {app, directory} from './java.mjs';
import {mainActivityPlatform} from './main-activity-platform.mjs';
import {modelTraces, replayJava} from './itf-replay.mjs';

/** HomeInstanceHandoff traces replayed on the real MainActivity over the Android/Capacitor ports. */
export function checkHomeInstanceHandoff({traces = 60, maxSteps = 30} = {}) {
  const generated = modelTraces({model: 'HomeInstanceHandoff', traces, maxSteps, witnesses: ['FallbackWitness', 'UnacknowledgedHandOffWitness', 'FrontStartMadeInstanceWitness', 'HomeRelaunchWitness']});
  const fixture = mainActivityPlatform();
  try {
    return replayJava({
      harness: 'HomeInstanceHandoffReplay.java',
      sources: [app + 'MainActivity.java', app + 'RendererRecoveryBudget.java', `${directory}/MainActivityPorts.java`, ...fixture.paths],
      traces: generated,
      required: ['externalStart', 'frontStartArrives', 'liveResumes', 'relaunch', 'destroyLive'],
      reached: {
        'a hand-off': state => state.operation === 'hand-off',
        'an unacknowledged hand-off': state => state.unacked > 0 && !state.unreliable,
        'an unreliable hand-off': state => state.unreliable,
        'two page owners': state => state.pages.length === 2,
        'a front start that made an instance': state => state.operation === 'front-made-instance',
        'a relaunched home-type owner': state => state.operation === 'relaunch' && state.liveTaskHome,
      },
    });
  } finally { fixture.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(checkHomeInstanceHandoff(), null, 2));
