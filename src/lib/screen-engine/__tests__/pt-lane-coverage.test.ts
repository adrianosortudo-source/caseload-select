/**
 * PT coverage guard for the practice lanes reachable from the DR-112 clarify
 * menu.
 *
 * Field defect: the clarify menu lets a Portuguese lead pick "Questões
 * trabalhistas", "Imóveis" or "Testamentos e heranças" in one tap, but
 * pt.json only ever covered the corporate lane. The lead picked a PT chip and
 * the very next question rendered in English, and so did every question after
 * it (80 questions, 407 option labels across the three lanes).
 *
 * `getQuestionDisplayText` / `getOptionDisplayLabel` fall back to the English
 * source string when a bundle entry is missing, so this failure is SILENT:
 * nothing throws, nothing logs, the lead just hits an English wall. These
 * tests are the alarm, since nothing else in the suite would notice.
 *
 * Scope note: this guards the lanes the clarify menu can route to. The
 * corporate lane was already covered and is included so a regression there
 * fails too.
 */
import { describe, it, expect } from 'vitest';
import { SLOT_REGISTRY } from '../slotRegistry';
import { getI18n } from '../i18n/loader';
import type { MatterType } from '../types';

const LANES: Record<string, MatterType[]> = {
  employment: [
    'employment_general',
    'wrongful_dismissal',
    'severance_review',
    'harassment_complaint',
    'wage_recovery',
    'employment_contract_review',
  ],
  estates: ['estates_general', 'will_drafting', 'power_of_attorney', 'probate', 'estate_dispute'],
  real_estate: [
    'real_estate_general',
    'commercial_real_estate',
    'residential_purchase_sale',
    'real_estate_litigation',
    'landlord_tenant',
    'construction_lien',
    'preconstruction_condo',
    'mortgage_dispute',
  ],
  corporate: [
    'corporate_general',
    'shareholder_dispute',
    'unpaid_invoice',
    'contract_dispute',
    'vendor_supplier_dispute',
    'corporate_money_control',
  ],
};

// Contact slots are collected through the explicit form, and the universal
// readiness chain is asked outside the matter packs; both are covered
// elsewhere in the bundle. Everything else a lane can ask must be translated.
const EXEMPT_SLOT_IDS = new Set<string>([]);

const pt = getI18n('pt');

function slotsForLane(types: MatterType[]) {
  return SLOT_REGISTRY.filter(
    (s) => s.applies_to.some((t) => types.includes(t)) && !EXEMPT_SLOT_IDS.has(s.id),
  );
}

describe('PT coverage for clarify-menu practice lanes', () => {
  for (const [lane, types] of Object.entries(LANES)) {
    describe(lane, () => {
      const slots = slotsForLane(types);

      it('has at least one slot (guards against a lane rename silently emptying this test)', () => {
        expect(slots.length).toBeGreaterThan(0);
      });

      it('every slot question is translated', () => {
        const missing = slots
          .filter((s) => !pt.slot_questions?.[s.id])
          .map((s) => s.id);
        expect(missing, `untranslated ${lane} questions: ${missing.join(', ')}`).toEqual([]);
      });

      it('every single-select option label is translated', () => {
        const missing: string[] = [];
        for (const s of slots) {
          if (!s.options || s.options.length === 0) continue;
          const map = pt.slot_options?.[s.id];
          if (!map) {
            missing.push(`${s.id} (whole option set)`);
            continue;
          }
          for (const opt of s.options) {
            if (!map[opt.value]) missing.push(`${s.id} -> "${opt.value}"`);
          }
        }
        expect(missing, `untranslated ${lane} options: ${missing.join(' | ')}`).toEqual([]);
      });

      it('translations are not accidental English passthrough', () => {
        // A translation equal to its English source means someone pasted the
        // source in to silence the checks above. Allow genuine cross-language
        // identities (proper nouns, "Townhouse", "Condo", numeric ranges).
        const suspicious: string[] = [];
        for (const s of slots) {
          const q = pt.slot_questions?.[s.id];
          if (q && q === s.question) suspicious.push(`${s.id} question`);
        }
        expect(suspicious, `English passthrough: ${suspicious.join(', ')}`).toEqual([]);
      });
    });
  }
});
