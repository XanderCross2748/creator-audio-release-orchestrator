import assert from "node:assert/strict";
import test from "node:test";
import { decideRelease } from "../src/release_decision.js";

test("queues a subscriber update when the recording announces a ready download", () => {
  const decision = decideRelease(
    "Studio subscribers: the texture pack download is ready in your library.",
  );

  assert.deepEqual(decision, {
    assetStatus: "release_ready",
    subscriberUpdate: "queued",
    summary: "Studio subscribers: the texture pack download is ready in your library.",
  });
});

test("holds the update while an unfinished release is reviewed", () => {
  const decision = decideRelease("I am still editing the texture pack notes.");

  assert.equal(decision.assetStatus, "needs_review");
  assert.equal(decision.subscriberUpdate, "held");
});
