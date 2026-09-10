import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeRoot = resolve(process.cwd(), 'src/app/api/admin/prospect-operations');

function route(relativePath: string): string {
  const path = resolve(routeRoot, relativePath);
  expect(existsSync(path), `Missing operator API route: ${relativePath}`).toBe(true);
  return readFileSync(path, 'utf8');
}

function expectOperatorGuard(source: string): void {
  expect(source).toContain('getOperatorSession');
  expect(source).toContain("{ error: 'Unauthorized' }");
  expect(source).toContain('{ status: 401 }');
}

describe('prospect source-backed route surface', () => {
  it('exposes one operator-only batch status endpoint for prospect lists', () => {
    const source = route('source-states/route.ts');
    expect(source).toContain('export async function POST');
    expectOperatorGuard(source);
    expect(source).toContain('listProspectSourceContactStates');
    expect(source).toContain('source_system');
    expect(source).toContain('source_record_keys');
    expect(source).toContain('{ states:');
  });

  it('exposes operator-only source conversation read and control updates', () => {
    const source = route('conversations/source/route.ts');
    expect(source).toContain('export async function GET');
    expect(source).toContain('export async function PATCH');
    expectOperatorGuard(source);
    expect(source).toContain('source_system');
    expect(source).toContain('source_record_key');
  });

  it('exposes an operator-only conversation control update for CRM prospects', () => {
    const source = route('conversations/[conversation_id]/route.ts');
    expect(source).toContain('export async function PATCH');
    expectOperatorGuard(source);
  });
});
