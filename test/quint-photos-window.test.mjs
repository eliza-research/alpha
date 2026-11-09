import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { checkPhotosWindow, compilePhotosWindow, createPhotosWindowFixture } from "../specs/quint/refinement/application/photos-window.mjs";
test("native Photos window keeps hidden and replaced reads from publishing", { timeout: 18e4 }, async () => {
  const receipt = await checkPhotosWindow([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 19);
});
test("an old Photos summary failure preserves the current successful counts", async () => {
  const compiled = await compilePhotosWindow([fileURLToPath(import.meta.url)]), f = await createPhotosWindowFixture(compiled, { holdCounts: true });
  try {
    await f.render();
    await f.access(0);
    await f.page(0, [{ id: "m:1", date: 1, image: "", width: 1, height: 1, revision: "r1" }]);
    assert.equal(f.summaries.length, 2);
    await f.counts(1);
    assert.equal(f.inspect().counts.favorites, 1);
    await f.counts(0, false);
    assert.equal(f.inspect().countsError, false);
    assert.equal(f.inspect().counts.favorites, 1);
  } finally {
    await f.close();
  }
});
