import assert from "node:assert/strict";
import test from "node:test";
import { documents, questions } from "./fixtures.mjs";
import { scoreRetrieval } from "./score.mjs";

function basis(n) {
  const values = Array(768).fill(0);
  values[n] = 1;
  return values;
}

test("scores held-out known and unknown questions with overlapping tenant topics", () => {
  assert.equal(documents.length, 12);
  assert.equal(questions.length, 30);
  const index = documents.map((_, i) => basis(i % 6));
  const queries = questions.map(q => q.expected ? index[documents.findIndex(doc => doc.id === q.expected)] : basis(72));
  const result = scoreRetrieval(index, queries);
  for (const s of [result.heldOutAtExistingFloor, result.heldOutAtCalibratedFloor]) {
    assert.equal(s.top1, 12);
    assert.equal(s.correctlyEmpty, 4);
    assert.ok(s.cases.every(q => q.candidates.every(id => id.startsWith(q.firm + "/"))));
  }
  // When a model confuses a held-out query, the score must detect the error.
  const changed = [...queries];
  changed[questions.findIndex(q => q.split === "evaluation" && q.expected)] = basis(5);
  assert.equal(scoreRetrieval(index, changed).heldOutAtCalibratedFloor.top1, 11);
  assert.throws(() => scoreRetrieval(index, queries.slice(1)), /Missing/);
  assert.throws(() => scoreRetrieval([Array(768).fill(0), ...index.slice(1)], queries), /magnitude/);
  assert.throws(() => scoreRetrieval([[1], ...index.slice(1)], queries), /768/);
});
