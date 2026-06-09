/**
 * Slot-label completeness gate (#176, 2026-06-09).
 *
 * Field-detected on the DRG WhatsApp brief L-2026-06-09-DF5: Resolved Facts
 * rendered `cross_border_work`, `regulated_industry`, `revenue_expectation`,
 * and `employees_planned` as raw snake_case ids because SLOT_LABELS had not
 * kept up with the registry. The renderer falls back via
 * `SLOT_LABELS[id] ?? id`, so any unlabeled slot leaks its internal id onto
 * the lawyer-facing brief. The audit found 89 of 139 registry slots missing
 * (everything added after the corporate era: real estate, employment,
 * estates, universal readiness, setup extras).
 *
 * This gate makes the failure structural: a new registry slot without a
 * SLOT_LABELS entry fails the suite, in both repos (the engine mirrors per
 * DR-033, and this test imports only engine modules).
 */

import { describe, it, expect } from 'vitest';
import { SLOT_REGISTRY } from '../slotRegistry';
import { SLOT_LABELS } from '../report';

describe('SLOT_LABELS covers every registry slot', () => {
  it('no slot falls back to its raw snake_case id on the lawyer brief', () => {
    const missing = SLOT_REGISTRY.filter((s) => !SLOT_LABELS[s.id]).map((s) => s.id);
    expect(missing).toEqual([]);
  });

  it('labels are display strings, not ids (no snake_case leaks in the map itself)', () => {
    const snakey = Object.entries(SLOT_LABELS)
      .filter(([, label]) => /_/.test(label))
      .map(([id, label]) => `${id} -> ${label}`);
    expect(snakey).toEqual([]);
  });
});
