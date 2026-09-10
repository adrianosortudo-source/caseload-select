import { NextRequest, NextResponse } from 'next/server';

import { getOperatorSession } from '@/lib/portal-auth';
import {
  listProspectingControlPlaneSources,
  PROSPECTING_CONTROL_PLANE_DEFAULT_PAGE_SIZE,
  PROSPECTING_CONTROL_PLANE_MAX_PAGE_SIZE,
} from '@/lib/prospect-source-registry';

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number): number | null {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

/**
 * Operator-only readback for the immutable Prospecting Control Plane source
 * ledger. The source system is fixed server-side and cannot be changed by a
 * query parameter.
 */
export async function GET(request: NextRequest) {
  if (!(await getOperatorSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const page = boundedInteger(request.nextUrl.searchParams.get('page'), 1, 1, 100_000);
  const pageSize = boundedInteger(
    request.nextUrl.searchParams.get('page_size'),
    PROSPECTING_CONTROL_PLANE_DEFAULT_PAGE_SIZE,
    1,
    PROSPECTING_CONTROL_PLANE_MAX_PAGE_SIZE,
  );
  if (page === null || pageSize === null) {
    return NextResponse.json({ error: 'Invalid pagination parameters' }, { status: 400 });
  }

  try {
    return NextResponse.json(await listProspectingControlPlaneSources({ page, pageSize }));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
