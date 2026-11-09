import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { checkPhotosTrash } from "../specs/quint/refinement/application/photos-trash.mjs";
test("native Photos Trash reloads after hiding and fences old replies", { timeout: 18e4 }, async () => {
  const receipt = await checkPhotosTrash([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 14);
});
