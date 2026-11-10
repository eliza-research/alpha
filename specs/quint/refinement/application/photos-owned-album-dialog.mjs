import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkTraces} from '../check-traces.mjs';
import {compilePhotosWindow, createPhotosWindowFixture, rawRow} from './photos-window.mjs';
import {boundInputs, call, captureSources, checkpoint, deferred, tick, trace} from './support.mjs';

const model = 'PhotosOwnedAlbumDialog';
const driver = fileURLToPath(import.meta.url);
const windowDriver = fileURLToPath(new URL('./photos-window.mjs', import.meta.url));
const albums = ['a', 'b'].map(id => ({id, name: id.toUpperCase(), revision: 'r-' + id, memberIds: [], count: 0}));

export async function createOwnedAlbumFixture(compiled) {
  const calls = [];
  const f = await createPhotosWindowFixture(compiled, {
    albumPort: {
      async albums() {return {items: structuredClone(albums)};},
      changeAlbum(payload) {
        const task = deferred();
        calls.push({payload: structuredClone(payload), task, settled: false});
        return task.promise;
      },
    },
  });
  await f.render(); // Let the first render's asynchronous album read finish.
  const button = f.document.createElement('button');
  const open = async id => {
    if (id === 'new') {
      (await f.render()).newAlbum({currentTarget: button});
    } else if (id === 'selection') {
      await f.access(0);
      await f.page(0, [{...rawRow(1), mutationRevision: 'mr1'}]);
      (await f.render()).selStart();
      (await f.render()).selAll();
      (await f.render()).selAlbum({currentTarget: button});
    } else {
      (await f.render()).tiles.find(tile => tile.id === 'custom:' + id).open();
      (await f.render()).alb.manage({currentTarget: button});
    }
    return (await f.render()).am;
  };
  const finish = async success => {
    const pending = calls.find(request => !request.settled);
    assert.ok(pending, 'Expected one pending album request');
    pending.settled = true;
    if (success) pending.task.resolve({id: pending.payload.id ?? 'created', revision: 'updated'});
    else pending.task.reject(Error('Album changed in the fixture'));
    await tick();
    await tick();
  };
  const close = async () => {
    f.retire();
    for (const request of calls) if (!request.settled) request.task.reject(Error('Fixture teardown'));
    await f.close();
  };
  return {f, calls, open, finish, close};
}

export async function checkPhotosOwnedAlbumDialog(extraSources = []) {
  const modelPath = 'specs/quint/application/' + model + '.qnt';
  captureSources([modelPath, windowDriver, 'apps/app/src/prototype/template.html']);
  const compiled = await compilePhotosWindow([driver, ...extraSources]);
  const sources = [...compiled.sources, windowDriver, 'apps/app/src/prototype/template.html', modelPath];
  const traces = [];
  async function scenario(name, run) {
    const t = await createOwnedAlbumFixture(compiled), {f} = t;
    const snapshots = new Map();
    const observe = async () => {
      const rendered = await f.render();
      const dialog = rendered.albumManager ? rendered.am : null;
      const disposed = f.inspect().disposed;
      return {
        's.dialog.stage': !dialog ? 'closed' : dialog.confirming ? 'delete' : dialog.managing ? 'manage'
          : dialog.choosing ? 'choose' : 'create',
        's.dialog.name': dialog?.name ?? '',
        's.active': f.active && !disposed,
        's.visible': !f.document.hidden,
        's.disposed': disposed,
        's.busy': f.inspect().mutating,
        's.requests': t.calls.map(({payload}) => ({
          operation: payload.operation, album: payload.id ?? '', revision: payload.revision ?? '', name: payload.name ?? '',
          media: payload.mediaId ?? '', mediaRevision: payload.mediaRevision ?? '',
        })),
        's.toasts': f.toasts.length,
      };
    };
    const replay = trace(name, await observe());
    const mark = async (action, ...args) => checkpoint(replay, [action, ...args].join(' '), call(action, ...args), await observe());
    const open = async album => {await t.open(album); await mark('openDialog', album);};
    const render = async slot => {
      snapshots.set(slot, (await f.render()).am);
      assert.ok(snapshots.get(slot));
      await mark('renderDialog', slot);
    };
    const click = async (slot, verb, name = '') => {
      const retained = snapshots.get(slot);
      if (verb === 'name') retained.onName({target: {value: name}});
      else if (verb === 'chooseCreate') retained.create();
      else if (verb === 'chooseA') retained.items.find(item => item.id === 'custom:a').go();
      else retained[verb === 'ask' ? 'askDelete' : verb]();
      await tick();
      await mark('invoke', slot, verb, name);
    };
    const finish = async ok => {await t.finish(ok); await mark('finish', ok);};
    const visibility = async shown => {await (shown ? f.show() : f.hide()); await mark('visibility', shown);};
    const leave = async () => {await f.leave(); await mark('leave');};
    const enter = async () => {await f.enter(); await mark('enter');};
    const dispose = async () => {f.retire(); await mark('dispose');};
    try {
      await run({open, render, click, finish, visibility, leave, enter, dispose});
      traces.push(replay);
    } finally {await t.close();}
  }
  await scenario('replacement retires retained name, save and close', async c => {
    await c.open('a'); await c.render(1); await c.click(1, 'close'); await c.open('b'); await c.render(2);
    await c.click(1, 'name', 'stale'); await c.click(1, 'save'); await c.click(1, 'close');
    await c.click(2, 'name', 'current'); await c.click(2, 'save'); await c.finish(true);
  });
  await scenario('Delete confirmation retires the previous stage', async c => {
    await c.open('a'); await c.render(1); await c.click(1, 'ask');
    await c.click(1, 'save'); await c.click(1, 'delete'); await c.render(2); await c.click(2, 'delete'); await c.finish(true);
  });
  await scenario('a retained Delete cannot act on a replacement confirmation', async c => {
    await c.open('a'); await c.render(1); await c.click(1, 'ask'); await c.render(1); await c.click(1, 'close');
    await c.open('b'); await c.render(2); await c.click(2, 'ask'); await c.render(2); await c.click(1, 'delete');
    await c.click(2, 'delete'); await c.finish(true);
  });
  for (const outcome of [true, false]) {
    await scenario('the successor owns publication after old settlement ' + outcome, async c => {
      await c.open('a'); await c.render(1); await c.click(1, 'save'); await c.click(1, 'close'); await c.open('b');
      await c.finish(outcome); await c.render(2); await c.click(2, 'save'); await c.finish(true);
    });
  }
  await scenario('one pending dispatch, with explicit retry after current failure', async c => {
    await c.open('new'); await c.render(1); await c.click(1, 'name', 'Created'); await c.click(1, 'save');
    await c.click(1, 'save'); await c.finish(false); await c.click(1, 'save'); await c.finish(true);
  });
  await scenario('hidden and departed controls cannot dispatch', async c => {
    await c.open('new'); await c.render(1); await c.visibility(false); await c.click(1, 'save'); await c.visibility(true);
    await c.leave(); await c.enter(); await c.open('new'); await c.click(1, 'save'); await c.render(2);
    await c.click(2, 'name', 'Visible'); await c.click(2, 'save'); await c.finish(true);
  });
  await scenario('disposed renderer cannot publish a pending completion', async c => {
    await c.open('a'); await c.render(1); await c.click(1, 'save'); await c.dispose(); await c.click(1, 'save');
    await c.finish(false);
  });
  await scenario('selection adds the shown media revision to the shown album revision', async c => {
    await c.open('selection'); await c.render(1); await c.click(1, 'chooseA'); await c.finish(true);
  });
  await scenario('creating from a selection retires the earlier membership controls', async c => {
    await c.open('selection'); await c.render(1); await c.click(1, 'chooseCreate'); await c.click(1, 'chooseA');
    await c.render(2); await c.click(2, 'name', 'New collection'); await c.click(2, 'save'); await c.finish(true);
  });
  return checkTraces(boundInputs({model, modelPath, sources, traces, scope: 'bounded-orchestration',
    assumptions: [
      'Actual Photos renderer and its rendered album controls execute against a closed synthetic Photos library. Request payloads, dialog publication and toast counts are observed.',
      'Two existing album revisions, one selected media revision and a new-album path. Multi-item batch add, album list persistence and actual platform behavior remain separate obligations.',
    ],
  }));
}
