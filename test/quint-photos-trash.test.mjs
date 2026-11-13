import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {captureSources, boundInputs, call, trace, checkpoint} from '../specs/quint/refinement/application/support.mjs';
import {compilePhotosWindow, createPhotosWindowFixture, rawRow, rowOf, cursorOf} from '../specs/quint/refinement/application/photos-window.mjs';

const driver = fileURLToPath(import.meta.url);
function observe(f) {
  const value = f.inspect(), last = f.trashes.at(-1);
  return {
    "s.hidden": f.document.hidden,
    "s.active": f.active,
    "s.disposed": value.disposed,
    "s.rows": value.trash.map(rowOf),
    "s.loaded": value.trashLoaded,
    "s.loading": value.trashLoading,
    "s.pending": f.trashes.some((request) => !request.settled),
    "s.next": cursorOf(value.trashNext),
    "s.epoch": value.trashEpoch,
    "s.again": value.trashRefreshAgain,
    "s.job": f.trashes.length,
    "s.token": last?.token ?? 0,
    "s.more": last?.more ?? false,
    "s.error": !!f.state.nativeTrashError
  };
}
async function checkPhotosTrash(extraSources = []) {
  captureSources([driver, ...extraSources]);
  const compiled = await compilePhotosWindow([driver, ...extraSources]), traces = [];
  const cases = [
    "initial",
    "hidden-pending",
    "hide-after-loaded",
    "hidden-show-pending",
    "hidden-failure",
    "old-failure-after-resume",
    "failure",
    "retry",
    "coalesce",
    "more",
    "dispose-pending",
    "dispose-loaded",
    "leave-pending",
    "inactive-show"
  ];
  for (const name of cases) {
    const f = await createPhotosWindowFixture(compiled, { holdTrash: true });
    f.state.album = "trash";
    const t = trace(name, observe(f)), step = (label, action) => checkpoint(t, label, action, observe(f));
    const reply = async (index, rows = [rawRow(1)], next = "", success = true) => {
      await f.trash(index, rows.map((row) => ({ ...row, trashed: true })), next, success);
      step("native Trash reply " + index, call("reply", rows.map(rowOf), cursorOf(next), success));
    };
    try {
      await f.render();
      step("mounted Trash starts its real read", call("request", false));
      if (name === "coalesce") {
        await f.access(0);
        await f.page(0, []);
        await f.emitLibrary();
        step("provider event coalesces a pending Trash reload", call("request", false));
        await reply(0);
        await reply(1, [rawRow(2)]);
      } else if (name === "dispose-pending") {
        f.retire();
        step("dispose while native Trash waits", call("dispose"));
        await reply(0);
      } else if (name === "leave-pending" || name === "inactive-show") {
        await f.leave();
        step("leave the visible view", call("leave"));
        if (name === "inactive-show") {
          await f.hide();
          step("hide inactive native cache", call("hide"));
          await f.show();
          step("show while another view is active", call("show"));
          await reply(0);
          await f.enter();
          step("actual return reloads invalidated Trash", call("enter"));
          await reply(1, [rawRow(2)]);
        } else await reply(0);
      } else if (["hidden-pending", "hidden-show-pending", "hidden-failure", "old-failure-after-resume"].includes(name)) {
        await f.hide();
        step("hide while Trash is pending", call("hide"));
        const resume = name === "hidden-show-pending" || name === "old-failure-after-resume";
        if (resume) {
          await f.show();
          step("return queues a fresh Trash load", call("show"));
        }
        await reply(0, [rawRow(1)], "", name !== "hidden-failure" && name !== "old-failure-after-resume");
        if (resume) await reply(1, [rawRow(2)]);
      } else if (name === "failure" || name === "retry") {
        await reply(0, [], "", false);
        if (name === "retry") {
          const out = await f.render();
          out.alb.loadMore();
          await new Promise((resolve) => setImmediate(resolve));
          step("visible retry starts fresh Trash read", call("request", false));
          await reply(1);
        }
      } else {
        await reply(0, [rawRow(1)], name === "more" ? "c1" : "");
        if (name === "hide-after-loaded") {
          await f.hide();
          step("native hide invalidates loaded marker", call("hide"));
          await f.show();
          step("visible return starts reload", call("show"));
          await reply(1);
        }
        if (name === "more") {
          await f.more();
          step("real Trash scroll loads more", call("request", true));
          await reply(1, [rawRow(2)]);
        }
        if (name === "dispose-loaded") {
          f.retire();
          step("dispose retained Trash cache", call("dispose"));
        }
      }
      traces.push(t);
    } finally {
      await f.close();
    }
  }
  return checkTraces(boundInputs({ model: "PhotosTrash", sources: compiled.sources, traces, scope: "bounded-component", assumptions: [
    "Actual installed native Photos adapter and row-order helpers execute through render, provider event, scroll, retry and page visibility. Deferred native Trash replies supply controlled data.",
    "Three stable media identities, four request identities, two cursors and finite revision/date classes bound the model. The read-only closure observer and native request history supply all projected state.",
    "The model covers Trash request serialization, coalescing, hidden/disposed publication, loaded-marker invalidation and resume. Permanent deletion, restore mutation, selection, native retention and browser-owned Trash remain separate protocols."
  ] }));
}

test("native Photos Trash reloads after hiding and fences old replies", { timeout: scaledTimeout(180_000) }, async () => {
  const receipt = await checkPhotosTrash([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 14);
});
