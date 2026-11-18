import { documents, questions } from "./fixtures.mjs";

function unitVector(values) {
  if (!Array.isArray(values) || values.length !== 768 || !values.every(Number.isFinite)) {
    throw new Error("Expected a 768-dimensional finite vector.");
  }
  const length = Math.hypot(...values);
  if (!length || !Number.isFinite(length)) throw new Error("Invalid vector magnitude.");
  return values.map(value => value / length);
}

export function scoreRetrieval(documentVectors, questionVectors) {
  if (documents.length !== documentVectors.length || questions.length !== questionVectors.length) {
    throw new Error("Missing document or query embeddings.");
  }
  const index = documents.map((doc, i) => ({ ...doc, vector: unitVector(documentVectors[i]) }));
  const rankings = questions.map((question, i) => {
    const query = unitVector(questionVectors[i]);
    const matches = index.filter(doc => doc.firm === question.firm).map(doc => ({
      id: doc.id, score: query.reduce((sum, value, j) => sum + value * doc.vector[j], 0),
    })).sort((a, b) => b.score - a.score);
    return { ...question, matches };
  });
  function atThreshold(split, threshold) {
    const cases = rankings.filter(row => row.split === split).map(row => {
      // Mirrors the app's cosine floor and top-8 retrieval limit, before answer generation.
      const candidates = row.matches.filter(match => match.score >= threshold).slice(0, 8).map(match => match.id);
      return { question: row.text, firm: row.firm, expected: row.expected, candidates };
    });
    const positives = cases.filter(row => row.expected !== null);
    const negatives = cases.filter(row => row.expected === null);
    const top1 = positives.filter(row => row.candidates[0] === row.expected).length;
    const top3 = positives.filter(row => row.candidates.slice(0, 3).includes(row.expected)).length;
    const correctlyEmpty = negatives.filter(row => !row.candidates.length).length;
    return { threshold, positives: positives.length, top1, top3, negatives: negatives.length, correctlyEmpty, cases };
  }
  const thresholds = [0.35, 0.45, 0.55, 0.65, 0.75];
  const calibration = thresholds.map(value => atThreshold("calibration", value));
  const quality = s => s.top1 / s.positives + s.correctlyEmpty / s.negatives;
  const chosen = [...calibration].sort((a,b) => quality(b) - quality(a) || b.threshold - a.threshold)[0];
  return {
    calibration: calibration.map(({ cases, ...totals }) => totals),
    heldOutAtExistingFloor: atThreshold("evaluation", 0.55),
    heldOutAtCalibratedFloor: atThreshold("evaluation", chosen.threshold),
  };
}
