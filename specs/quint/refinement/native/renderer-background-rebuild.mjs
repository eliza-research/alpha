import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {app, directory} from './java.mjs';
import {mainActivityPlatform} from './main-activity-platform.mjs';
import {modelTraces, replayJava} from './itf-replay.mjs';

// The activity's started state is an input here, so the lifecycle port carries it.
const lifecycle = `package androidx.lifecycle;
public class Lifecycle {
  public enum State {CREATED, STARTED; public boolean isAtLeast(State value) {return compareTo(value) >= 0;}}
  public State state = State.STARTED;
  public State getCurrentState() {return state;}
}`;

/** RendererBackgroundRebuild traces replayed on two real MainActivity surfaces and their shared budget. */
export function checkRendererBackgroundRebuild({traces = 60, maxSteps = 40} = {}) {
  const generated = modelTraces({model: 'RendererBackgroundRebuild', traces, maxSteps, witnesses: ['BackgroundRebuildWitness', 'UncountedReclaimWitness', 'HiddenEscapeWitness', 'SharedDeathSpentOnceWitness', 'OvertakenSurfaceWitness']});
  const fixture = mainActivityPlatform();
  try {
    writeFileSync(join(fixture.directory, 'androidx/lifecycle/Lifecycle.java'), lifecycle);
    const surfaces = state => Object.values(state.surfaces);
    return replayJava({
      harness: 'RendererBackgroundRebuildReplay.java',
      sources: [app + 'MainActivity.java', app + 'RendererRecoveryBudget.java', `${directory}/MainActivityPorts.java`, ...fixture.paths],
      traces: generated,
      required: ['start', 'stop', 'rendererDies', 'report', 'repeatReport', 'timerFires', 'reload', 'recreated', 'windowPasses'],
      reached: {
        'a rebuild waiting for the next start': state => surfaces(state).some(surface => surface.pendingRebuild),
        'an uncounted background reclaim': state => state.rendererDeaths > state.deaths && surfaces(state).every(surface => !surface.owed),
        'the escape view on a hidden HOME surface': state => state.surfaces.launcher.escape && !state.surfaces.launcher.started,
        'a backoff recreation': state => surfaces(state).some(surface => surface.scheduled === 'backoff'),
        'a shared death reported twice': state => surfaces(state).every(surface => surface.recovering),
        'a surface overtaken by a late counted report': state => surfaces(state).some(surface => surface.alive && surface.createdAt < state.deaths),
        'a new window after 60 s': state => state.stale,
      },
    });
  } finally { fixture.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(checkRendererBackgroundRebuild(), null, 2));
