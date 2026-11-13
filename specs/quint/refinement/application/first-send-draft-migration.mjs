import {fileURLToPath} from 'node:url';
import {firstSendDraftMigrationFixture, firstSendDraftMigrationSources, migrationText, replacementText} from '../../../../test/fixtures/first-send-draft-migration.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {call, checkpoint, trace} from './support.mjs';

const model = 'FirstSendDraftMigration';
const driver = fileURLToPath(import.meta.url);
const fields = state => Object.fromEntries(Object.entries(state).map(([key, value]) => [`s.${key}`, value]));
const portAction = {destination: 'readDestination', source: 'readSource', confirmation: 'confirmDestination',
  clear: 'finishClear', retry: 'resumeRetry'};

export async function checkFirstSendDraftMigration(extraSources = []) {
  const sources = [...new Set([driver, ...firstSendDraftMigrationSources, ...extraSources,
    fileURLToPath(new URL('./support.mjs', import.meta.url)), 'upstream.lock.json', 'scripts/prepare-client-features.ts'])];
  const driverHashes = captureInputs(sources);
  const traces = [];
  async function scenario(name, run, initial = migrationText) {
    const fixture = await firstSendDraftMigrationFixture(initial);
    const t = trace(name, fields(fixture.observe()), call('initDestination', initial));
    const mark = (label, action) => checkpoint(t, label, action, fields(fixture.observe()));
    const advance = async (phase, label) => {await fixture.advance(phase);mark(label, call(portAction[phase]));};
    const rebind = () => {fixture.rebind();mark('The composer binds a different owner and conversation', call('rebind'));};
    const retire = () => {fixture.retire();mark('The shell lifetime retires', call('retire'));};
    const replaceDestination = text => {
      fixture.replaceDestination(text);
      mark('A competing destination write commits different revision bytes', call('replaceDestination', text));
    };
    const replaceSource = (text, sending = false) => {
      fixture.replaceSource(text, sending);
      mark('A competing source write changes its revisioned record', call('replaceSource', text, sending));
    };
    const clearDispatch = async () => {
      await advance('source', 'The exact source receipt is read');
      await advance('confirmation', 'Current ownership and the destination copy admit the source CAS');
    };
    await fixture.start();
    mark('The real adapter begins its first destination read', call('start'));
    await run({advance, rebind, retire, replaceDestination, replaceSource, clearDispatch});
    traces.push(t);
  }
  const destination = c => c.advance('destination', 'The first destination receipt can start a source read');
  await scenario('matching destination and source clear only the source slot', async c => {
    await destination(c);await c.clearDispatch();
    await c.advance('clear', 'The raw store accepts the exact source receipt and records a revisioned clear');
  });
  await scenario('a new binding during the first destination read cannot begin the source read', async c => {
    c.rebind();await c.advance('destination', 'The read completing for a replaced binding retires the migration');
  });
  await scenario('a new binding during the source read cannot dispatch a clear', async c => {
    await destination(c);c.rebind();await c.advance('source', 'The old source receipt cannot clear after binding replacement');
  });
  await scenario('shell retirement during source read preserves its durable copy', async c => {
    await destination(c);c.retire();await c.advance('source', 'The retired owner cannot clear its source receipt');
  });
  await scenario('shell retirement while confirmation is held prevents dispatch', async c => {
    await destination(c);await c.advance('source', 'The source receipt starts a fresh destination confirmation');
    c.retire();await c.advance('confirmation', 'A matching confirmation cannot outlive the owner');
  });
  await scenario('destination disagreement during source read retains the source through bounded retries', async c => {
    await destination(c);c.replaceDestination(replacementText);
    await c.advance('source', 'The source receipt requires a new destination read');
    await c.advance('confirmation', 'A different destination copy prevents clear and starts the first retry');
    for (let i = 0; i < 3; i++) {
      await c.advance('retry', 'The next actual retry timer fires');
      await c.advance('destination', 'The disagreeing destination still prevents source clear');
    }
  });
  await scenario('a still-marked source keeps its unsettled sending record', async c => {
    await destination(c);c.replaceSource(migrationText, true);
    await c.advance('source', 'The marked source schedules a retry without clearing');
    c.rebind();await c.advance('retry', 'Retirement before retry leaves the marked source intact');
  });
  await scenario('a newer source CAS receipt protects different source text', async c => {
    await destination(c);await c.clearDispatch();c.replaceSource(replacementText);
    await c.advance('clear', 'The raw CAS refuses to clear a newer source revision');
    await c.advance('retry', 'A conflict starts a fresh check');await destination(c);
    await c.advance('source', 'The changed source text stops migration');
  });
  await scenario('a same-text source revision is compared again after the first CAS conflict', async c => {
    await destination(c);await c.clearDispatch();c.replaceSource(migrationText);
    await c.advance('clear', 'A new revision conflicts despite equal source text');
    await c.advance('retry', 'The adapter retries instead of reusing the old source receipt');await destination(c);
    await c.clearDispatch();await c.advance('clear', 'The fresh exact source receipt permits a revisioned clear');
  });
  await scenario('a destination that later receives the matching text permits a retry', async c => {
    await c.advance('destination', 'The destination has yet to confirm the transferred text');
    c.replaceDestination(migrationText);await c.advance('retry', 'The existing retry checks the newly saved destination');
    await destination(c);await c.clearDispatch();await c.advance('clear', 'A confirmed destination permits the source CAS');
  }, replacementText);
  await scenario('a destination write after source CAS dispatch remains independent', async c => {
    await destination(c);await c.clearDispatch();c.replaceDestination(replacementText);
    await c.advance('clear', 'The already-dispatched exact source CAS can settle despite the independent destination write');
  });
  return checkTraces({model, scope: 'bounded-orchestration', sources, driverHashes, traces,
    assumptions: ['The actual Alpha migration helper and prepared shared draft CAS run over in-memory exact raw slots. Each read, retry timer and source exchange is held at its real port.',
      'The shell lifetime and exact destination binding are controlled. The model begins at cleanup, after the composer would have copied the held text, and abstracts all store errors except a competing source CAS.',
      'One source slot, one destination slot, two texts, one competing write per slot and four total attempts. Cross-store writes are independent after dispatch. Transport, installed persistence and same-key lifetime reuse remain separate.']});
}
