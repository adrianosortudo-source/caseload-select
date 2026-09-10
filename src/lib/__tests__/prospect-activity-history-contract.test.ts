import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/lib/prospect-operations.ts'), 'utf8');
const historyReader = source.slice(
  source.indexOf('export async function getProspectSourceConversation'),
  source.indexOf('export async function getAgencyProspectConversation'),
);

describe('prospect activity history query contract', () => {
  it('uses an explicit activity page bound instead of the implicit PostgREST cap', () => {
    expect(historyReader).toMatch(
      /from\('prospect_activities'\)[\s\S]*?\.(?:limit|range)\(/,
    );
  });

  it('keeps activity pages deterministic when timestamps match', () => {
    const occurredOrder = historyReader.indexOf(".order('occurred_at', { ascending: false })");
    const idOrder = historyReader.indexOf(".order('id', { ascending: false })");
    expect(occurredOrder).toBeGreaterThan(-1);
    expect(idOrder).toBeGreaterThan(occurredOrder);
  });
});
