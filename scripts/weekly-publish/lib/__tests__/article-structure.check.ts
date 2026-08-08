/**
 * Fixture assertions for canon/article-structure.ts and the revised
 * canon/locked-strings.ts, run directly:
 *   npx tsx scripts/weekly-publish/lib/__tests__/article-structure.check.ts
 *
 * NOT a vitest file, same reasoning and header precedent as
 * placement-resolution.check.ts in this directory: this repo's
 * vitest.config.ts only collects src/**\/__tests__/**\/*.test.ts, so a
 * vitest file under scripts/ would never run and would be dead
 * false-confidence (EXECUTION-PLAN_publish-gate-truthfulness_v1 Decision
 * D6). Plain node:assert/strict, exercised directly as this plan's own
 * Phase 1.4 verification.
 */
import assert from "node:assert/strict";
import { evaluateArticleStructure } from "../../canon/article-structure";
import { evaluateLeadMagnetCta } from "../../canon/locked-strings";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  PASS  ${name}`);
}

console.log("article-structure.check.ts");

// --- realistic bodies, one per (formatFamily, locale) pair, each passing ---

const counselNoteEn = `
  <p>Direct answer up front.</p>
  <h2>The Five-Line Brief</h2>
  <ul><li>Risk</li><li>Price</li><li>Timeline</li><li>Decision</li><li>Next step</li></ul>
  <h2>Decision Box</h2>
  <p>Decision framing.</p>
  <h2>Frequently asked questions</h2>
  <p>Q1... A1...</p>
`;

const counselNotePt = `
  <p>Resposta direta no início.</p>
  <h2>O essencial em cinco linhas</h2>
  <ul><li>Risco</li><li>Preço</li><li>Prazo</li><li>Decisão</li><li>Próximo passo</li></ul>
  <h2>Caixa de decisão</h2>
  <p>Enquadramento da decisão.</p>
  <h2>Perguntas frequentes</h2>
  <p>P1... R1...</p>
`;

const clauseEn = `
  <p>One consequential clause, explained.</p>
  <h2>Decision Box</h2>
  <p>Decision framing.</p>
  <h2>Frequently asked questions</h2>
  <p>Q1... A1...</p>
`;

const clausePt = `
  <p>Uma cláusula consequente, explicada.</p>
  <h2>Caixa de decisão</h2>
  <p>Enquadramento da decisão.</p>
  <h2>Perguntas frequentes</h2>
  <p>P1... R1...</p>
`;

check("counsel_note / en-CA: realistic body with all three headings passes", () => {
  const result = evaluateArticleStructure("counsel_note", "en-CA", counselNoteEn);
  assert.equal(result.ok, true);
  assert.match(result.detail, /3 required section\(s\) found/);
});

check("counsel_note / pt-BR: realistic Portuguese body with all three headings passes", () => {
  const result = evaluateArticleStructure("counsel_note", "pt-BR", counselNotePt);
  assert.equal(result.ok, true);
  assert.match(result.detail, /3 required section\(s\) found/);
});

check("clause_in_the_margin / en-CA: realistic body (no Five-Line Brief) passes", () => {
  const result = evaluateArticleStructure("clause_in_the_margin", "en-CA", clauseEn);
  assert.equal(result.ok, true);
  assert.match(result.detail, /2 required section\(s\) found, 1 forbidden section\(s\) confirmed absent/);
});

check("clause_in_the_margin / pt-BR: realistic Portuguese body (no Five-Line Brief) passes", () => {
  const result = evaluateArticleStructure("clause_in_the_margin", "pt-BR", clausePt);
  assert.equal(result.ok, true);
  assert.match(result.detail, /2 required section\(s\) found, 1 forbidden section\(s\) confirmed absent/);
});

// --- a Clause carrying a Five-Line Brief FAILS (canon forbids it) ---

check("clause_in_the_margin / en-CA: a Clause WITH a Five-Line Brief heading fails", () => {
  const badClause = `<h2>The Five-Line Brief</h2><p>...</p>${clauseEn}`;
  const result = evaluateArticleStructure("clause_in_the_margin", "en-CA", badClause);
  assert.equal(result.ok, false);
  assert.match(result.detail, /forbidden section present: The Five-Line Brief/);
});

// --- a Counsel Note missing its FAQ heading FAILS ---

check("counsel_note / en-CA: missing FAQ heading fails, names exactly that heading", () => {
  const noFaq = `
    <h2>The Five-Line Brief</h2><p>...</p>
    <h2>Decision Box</h2><p>...</p>
  `;
  const result = evaluateArticleStructure("counsel_note", "en-CA", noFaq);
  assert.equal(result.ok, false);
  assert.match(result.detail, /missing required: Frequently asked questions/);
});

// --- fail-closed: unknown format family / unknown locale ---

check("an unknown format family FAILS (fail-closed, Standing Rule 4), never passes silently", () => {
  const result = evaluateArticleStructure("some_new_format", "en-CA", counselNoteEn);
  assert.equal(result.ok, false);
  assert.match(result.detail, /no structure canon entry/);
  assert.match(result.detail, /formatFamily="some_new_format"/);
});

check("an unknown locale FAILS (fail-closed, Standing Rule 4), never passes silently", () => {
  const result = evaluateArticleStructure("counsel_note", "fr-CA", counselNoteEn);
  assert.equal(result.ok, false);
  assert.match(result.detail, /no structure canon entry/);
  assert.match(result.detail, /locale="fr-CA"/);
});

// --- Decision D3: a loose substring match would be fooled by this prose sentence; the exact-<h2> match must not be ---

check("D3: prose containing 'five short lines' is NOT mistaken for a Five-Line Brief heading (Counsel Note lacking the real heading still fails)", () => {
  const proseOnly = `
    <p>A useful internal brief can be five short lines, but that is not a substitute for the real section below.</p>
    <h2>Decision Box</h2><p>...</p>
    <h2>Frequently asked questions</h2><p>...</p>
  `;
  const result = evaluateArticleStructure("counsel_note", "en-CA", proseOnly);
  assert.equal(result.ok, false);
  assert.match(result.detail, /missing required: The Five-Line Brief/);
});

// --- lead-magnet CTA rule (Decision D4) ---

check("lead-magnet CTA: a body with a real https://drglaw.ca/ href passes", () => {
  const body = `<p>Get the checklist: <a href="https://drglaw.ca/resources/federal-corporation-annual-filing-checklist">Download</a></p>`;
  const result = evaluateLeadMagnetCta(body);
  assert.equal(result.ok, true);
  assert.match(result.detail, /1 href\(s\) beginning https:\/\/drglaw\.ca\//);
});

check("lead-magnet CTA: a body with the retired [FORM DESTINATION PENDING] placeholder fails", () => {
  const body = `<p>Get the checklist: <a href="[FORM DESTINATION PENDING]">Download</a></p>`;
  const result = evaluateLeadMagnetCta(body);
  assert.equal(result.ok, false);
  assert.match(result.detail, /placeholder href\(s\) found/);
});

check("lead-magnet CTA: a body with no href at all fails", () => {
  const body = `<p>Get the checklist by contacting the firm directly.</p>`;
  const result = evaluateLeadMagnetCta(body);
  assert.equal(result.ok, false);
  assert.match(result.detail, /no href attributes found in body at all/);
});

console.log(`\n${passed}/${passed} PASS`);
