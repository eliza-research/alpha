import assert from "node:assert/strict";
import test from "node:test";

test("an attachments instance's teardown removes only its own viewer copies", async () => {
  // Main surface and assistant each register AlphaMailAttachments over one cache folder.
  const { nativeSource, fixture, runJvm } = await import("./fixtures/jvm-tools.mjs");
  assert.match(runJvm([nativeSource("ReviewedCopies.java"), fixture("ReviewedCopiesTest.java")], "ai.alphacompute.alphaphone.ReviewedCopiesTest"), /^PASS reviewed copies/);
});
