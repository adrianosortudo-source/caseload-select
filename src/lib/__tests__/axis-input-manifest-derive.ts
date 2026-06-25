/**
 * Axis-input manifest GENERATOR (H1).
 *
 * Derives, per in-scope matter type, which slots feed which scoring axis, by
 * reading the real scorers in src/lib/screen-engine/band.ts as the source of
 * truth. NOT hand-authored (H1 spec section 8, "no invention"): this parses
 * the scorer branches and replicates the baseline fall-through rule.
 *
 * This helper lives under __tests__ and is used by:
 *   - the drift test (re-derive == committed AXIS_INPUT_MANIFEST), and
 *   - the regeneration step (writes the committed manifest).
 * It reads band.ts via fs, so it only runs in node/test, never in the app
 * bundle. See scoring-axis-manifest.ts for the consumed, committed artifact
 * and the note on why the manifest is housed in lib/ rather than the engine.
 *
 * Two derivation modes per axis (the spec's illustrative example only showed
 * the first):
 *   1. specific branch: scoreValueSpecific / scoreComplexitySpecific /
 *      scoreUrgency have `if (t === 'X')` branches that read explicit slot
 *      literals. Those literals are the axis's slots for X.
 *   2. baseline fall-through: matter types WITHOUT a value/complexity branch
 *      fall to baselineValueScore / baselineComplexityScore, which read every
 *      applies_to slot (minus contact + universal readiness). Those matter
 *      types get the registry's applies_to set for value + complexity.
 *      Urgency has no baseline slot read, so its fall-through set is empty.
 *   readiness is universal (the three readiness slots parsed from band.ts)
 *   plus any matter-specific readiness add-ons (e.g. will_drafting).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SLOT_REGISTRY, IN_SCOPE_MATTER_TYPES } from '@/lib/screen-engine/slotRegistry';
import type { MatterType } from '@/lib/screen-engine/types';
import type { AxisInputManifest, SlotRef, Axis } from '@/lib/scoring-axis-manifest';

const BAND_TS_PATH = join(process.cwd(), 'src', 'lib', 'screen-engine', 'band.ts');

// ── source-parse helpers ────────────────────────────────────────────────────

function readBandSource(): string {
  return readFileSync(BAND_TS_PATH, 'utf8');
}

/** Body of a top-level function, bracket-matched from its signature. */
function functionBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error(`scorer not found in band.ts: ${signature}`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error(`unbalanced braces for ${signature}`);
}

const SLOT_CALL_RE = /(?:slotValue|isAnswered)\s*\(\s*state\s*,\s*'([^']+)'\s*\)/g;
const MATTER_GUARD_RE = /(?:\bt|state\.matter_type)\s*===\s*'([^']+)'/g;

function slotIdsIn(block: string): string[] {
  const ids = new Set<string>();
  for (const m of block.matchAll(SLOT_CALL_RE)) ids.add(m[1]);
  return [...ids];
}

function matterTypesIn(condition: string): string[] {
  return [...condition.matchAll(MATTER_GUARD_RE)].map((m) => m[1]);
}

/**
 * Walk a scorer body, attributing each `if (t === 'X' [|| ...]) { ... }`
 * matter-type branch to the slot literals it reads. Handles both block-bodied
 * branches and single-statement branches (e.g. `if (...) return 3;`).
 */
function branchSlotsByMatter(funcBody: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  let i = 0;
  while (i < funcBody.length) {
    const ifAt = funcBody.indexOf('if (', i);
    if (ifAt < 0) break;
    const parenOpen = funcBody.indexOf('(', ifAt);
    let depth = 0;
    let parenClose = parenOpen;
    for (let k = parenOpen; k < funcBody.length; k++) {
      if (funcBody[k] === '(') depth++;
      else if (funcBody[k] === ')' && --depth === 0) { parenClose = k; break; }
    }
    const condition = funcBody.slice(parenOpen + 1, parenClose);
    const matters = matterTypesIn(condition);
    if (matters.length === 0) { i = parenClose + 1; continue; } // not a matter guard

    // What follows the guard: a `{...}` block, or a single statement to `;`.
    let after = parenClose + 1;
    while (after < funcBody.length && /\s/.test(funcBody[after])) after++;
    let blockEnd: number;
    let block: string;
    if (funcBody[after] === '{') {
      let bdepth = 0;
      blockEnd = after;
      for (let b = after; b < funcBody.length; b++) {
        if (funcBody[b] === '{') bdepth++;
        else if (funcBody[b] === '}' && --bdepth === 0) { blockEnd = b; break; }
      }
      block = funcBody.slice(after + 1, blockEnd);
    } else {
      blockEnd = funcBody.indexOf(';', after);
      if (blockEnd < 0) blockEnd = funcBody.length - 1;
      block = funcBody.slice(after, blockEnd);
    }
    const slots = slotIdsIn(block);
    for (const t of matters) {
      if (!out.has(t)) out.set(t, new Set());
      slots.forEach((s) => out.get(t)!.add(s));
    }
    i = blockEnd + 1;
  }
  return out;
}

/** Parse `const UNIVERSAL_READINESS_SLOT_IDS = new Set([ '...', ... ])`. */
function universalReadinessIds(src: string): string[] {
  const m = src.match(/UNIVERSAL_READINESS_SLOT_IDS\s*=\s*new Set\(\[([^\]]*)\]/);
  if (!m) throw new Error('UNIVERSAL_READINESS_SLOT_IDS not found in band.ts');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

// ── registry helpers ────────────────────────────────────────────────────────

function questionFor(slotId: string): string {
  return SLOT_REGISTRY.find((s) => s.id === slotId)?.question ?? slotId;
}

function toRefs(slotIds: Iterable<string>): SlotRef[] {
  return [...new Set(slotIds)]
    .sort()
    .map((slotId) => ({ slotId, label: questionFor(slotId) }));
}

/** Baseline applies_to set: what baselineValueScore/baselineComplexityScore read. */
function baselineAppliesTo(matter: MatterType, readinessIds: Set<string>): string[] {
  return SLOT_REGISTRY.filter(
    (s) => s.applies_to.includes(matter) && s.tier !== 'contact' && !readinessIds.has(s.id),
  ).map((s) => s.id);
}

// ── public ──────────────────────────────────────────────────────────────────

export function deriveAxisInputManifest(): AxisInputManifest {
  const src = readBandSource();
  const readinessIds = new Set(universalReadinessIds(src));

  const valueBranch = branchSlotsByMatter(functionBody(src, 'function scoreValueSpecific'));
  const complexityBranch = branchSlotsByMatter(functionBody(src, 'function scoreComplexitySpecific'));
  const urgencyBranch = branchSlotsByMatter(functionBody(src, 'function scoreUrgency'));
  const readinessBranch = branchSlotsByMatter(functionBody(src, 'function scoreReadiness'));

  const manifest: AxisInputManifest = {};
  for (const matter of IN_SCOPE_MATTER_TYPES) {
    const value = valueBranch.has(matter)
      ? [...valueBranch.get(matter)!]
      : baselineAppliesTo(matter, readinessIds);
    const complexity = complexityBranch.has(matter)
      ? [...complexityBranch.get(matter)!]
      : baselineAppliesTo(matter, readinessIds);
    const urgency = urgencyBranch.has(matter) ? [...urgencyBranch.get(matter)!] : [];
    const readiness = [...readinessIds, ...(readinessBranch.get(matter) ?? [])];

    manifest[matter] = {
      value: toRefs(value),
      complexity: toRefs(complexity),
      urgency: toRefs(urgency),
      readiness: toRefs(readiness),
    };
  }
  return manifest;
}

export const AXES: Axis[] = ['value', 'complexity', 'urgency', 'readiness'];
