import type { EngineState, SlotDefinition } from './types';
import { getSlotsForMatter } from './slotRegistry';

const lower = (s: string) => s.toLowerCase();

function matchPattern(text: string, patterns: string[]): string | null {
  const t = lower(text);
  for (const p of patterns) {
    if (t.includes(lower(p))) return p;
  }
  return null;
}

function slotAlreadyFilled(state: EngineState, slotId: string): boolean {
  const val = state.slots[slotId];
  if (val !== null && val !== undefined && val !== '') return true;
  const meta = state.slot_meta[slotId];
  if (meta && (meta.source === 'explicit' || meta.source === 'answered')) return true;
  if (state.slot_evidence[slotId]) return true;
  return false;
}

export function extractSlotEvidence(input: string, state: EngineState): EngineState {
  if (!state.matter_type || state.matter_type === 'unknown') return state;

  const applicable = getSlotsForMatter(state.matter_type);
  const updated = { ...state };
  updated.slots = { ...state.slots };
  updated.slot_meta = { ...state.slot_meta };
  updated.slot_evidence = { ...state.slot_evidence };

  for (const slot of applicable) {
    if (slotAlreadyFilled(updated, slot.id)) continue;
    const evidence = tryExtractEvidence(input, slot);
    if (!evidence) continue;

    updated.slot_evidence[slot.id] = {
      value: evidence.value,
      matched_pattern: evidence.pattern,
      confidence: evidence.confidence,
      source: 'explicit',
    };
    updated.slots[slot.id] = evidence.value;
    updated.slot_meta[slot.id] = {
      source: 'explicit',
      evidence: evidence.pattern,
      confidence: evidence.confidence,
    };
  }

  return updated;
}

interface EvidenceResult {
  value: string;
  pattern: string;
  confidence: number;
}

function tryExtractEvidence(input: string, slot: SlotDefinition): EvidenceResult | null {
  if (!slot.evidence_patterns) return null;

  for (const [optionKey, patterns] of Object.entries(slot.evidence_patterns)) {
    if (!patterns) continue;
    const matched = matchPattern(input, patterns);
    if (matched) {
      return {
        value: mapEvidenceKey(slot, optionKey),
        pattern: matched,
        confidence: 0.9,
      };
    }
  }

  return null;
}

// Some slots use internal keys that differ from option labels
function mapEvidenceKey(slot: SlotDefinition, key: string): string {
  // ownership_percentage uses 'known' as a sentinel
  if (slot.id === 'ownership_percentage' && key === 'known') {
    return 'known';
  }
  return key;
}

// ─── Advisory-specific extraction ─────────────────────────────────────────
// Derives advisory_specific_task automatically from advisory_concern

export function deriveAdvisorySpecificTask(state: EngineState): EngineState {
  if (state.matter_type !== 'business_setup_advisory') return state;
  if (slotAlreadyFilled(state, 'advisory_specific_task')) return state;

  const concern = state.slots['advisory_concern'];
  if (!concern) return state;

  const map: Record<string, string> = {
    'Knowing what kind of company to set up': 'Choosing the right structure',
    'Deciding who owns what': 'Splitting ownership',
    'Avoiding problems with a partner later': 'Protecting against future problems',
    'Reviewing documents before signing': 'Reviewing documents',
  };

  const derived = map[concern];
  if (!derived) return state;

  const updated = { ...state };
  updated.slots = { ...state.slots, advisory_specific_task: derived };
  updated.slot_meta = {
    ...state.slot_meta,
    advisory_specific_task: { source: 'inferred', evidence: 'derived from advisory_concern' },
  };
  return updated;
}

// ─── Full evidence pass ────────────────────────────────────────────────────

export function runEvidencePass(input: string, state: EngineState): EngineState {
  let s = extractSlotEvidence(input, state);
  s = deriveAdvisorySpecificTask(s);
  return s;
}
