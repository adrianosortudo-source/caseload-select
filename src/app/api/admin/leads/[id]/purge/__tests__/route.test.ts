import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authorized: true,
  purgeLeadPii: vi.fn(),
}));

vi.mock('@/lib/cron-auth', () => ({
  isCronAuthorized: vi.fn(() => mocks.authorized),
}));
vi.mock('@/lib/data-retention', () => ({ purgeLeadPii: mocks.purgeLeadPii }));

import { POST } from '../route';

const FIRM_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';

function request(body?: unknown): NextRequest {
  return new Request('https://app.caseloadselect.ca/api/admin/leads/lead-1/purge', {
    method: 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}

function params(id = 'L-2026-09-02-001') {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mocks.authorized = true;
  mocks.purgeLeadPii.mockReset().mockResolvedValue({
    ok: true,
    deletion_request_id: REQUEST_ID,
    screened_lead_redacted: true,
    legacy_lead_anonymized: false,
    external_cleanup_status: 'complete',
  });
});

describe('POST /api/admin/leads/[id]/purge', () => {
  it('rejects an unauthorized caller before deletion', async () => {
    mocks.authorized = false;

    const response = await POST(request({ firm_id: FIRM_ID }), params());

    expect(response.status).toBe(401);
    expect(mocks.purgeLeadPii).not.toHaveBeenCalled();
  });

  it('passes the tenant, reason and request ID to the erasure coordinator', async () => {
    const response = await POST(
      request({
        firm_id: FIRM_ID,
        reason: 'subject_request',
        deletion_request_id: REQUEST_ID,
      }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(mocks.purgeLeadPii).toHaveBeenCalledWith('L-2026-09-02-001', {
      firmId: FIRM_ID,
      reason: 'subject_request',
      deletionRequestId: REQUEST_ID,
      externalCleanup: undefined,
    });
  });

  it('requires an explicit tenant for every operator deletion request', async () => {
    const response = await POST(
      request({ deletion_request_id: REQUEST_ID }),
      params(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'firm_id is required for tenant-scoped deletion',
    });
    expect(mocks.purgeLeadPii).not.toHaveBeenCalled();
  });

  it('accepts explicit external cleanup evidence for a retry', async () => {
    const response = await POST(
      request({
        firm_id: FIRM_ID,
        deletion_request_id: REQUEST_ID,
        external_cleanup: {
          ghl_status: 'completed',
          meta_status: 'provider_managed',
          resend_status: 'provider_managed',
        },
      }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(mocks.purgeLeadPii).toHaveBeenCalledWith(
      'L-2026-09-02-001',
      expect.objectContaining({
        firmId: FIRM_ID,
        externalCleanup: {
          ghlStatus: 'completed',
          metaStatus: 'provider_managed',
          resendStatus: 'provider_managed',
        },
      }),
    );
  });

  it('rejects invalid or unexpected cleanup evidence', async () => {
    const badStatus = await POST(
      request({ external_cleanup: { ghl_status: 'done-ish' } }),
      params(),
    );
    expect(badStatus.status).toBe(400);

    const badField = await POST(
      request({ external_cleanup: { storage_deleted_count: 9 } }),
      params(),
    );
    expect(badField.status).toBe(400);
    expect(mocks.purgeLeadPii).not.toHaveBeenCalled();
  });

  it('does not allow provider-managed to stand in for required GHL cleanup', async () => {
    const response = await POST(
      request({
        firm_id: FIRM_ID,
        deletion_request_id: REQUEST_ID,
        external_cleanup: {
          ghl_status: 'provider_managed',
          meta_status: 'provider_managed',
          resend_status: 'provider_managed',
        },
      }),
      params(),
    );

    expect(response.status).toBe(400);
    expect(mocks.purgeLeadPii).not.toHaveBeenCalled();
  });

  it('surfaces partial cleanup as a failure with the durable request ID', async () => {
    mocks.purgeLeadPii.mockResolvedValueOnce({
      ok: false,
      deletion_request_id: REQUEST_ID,
      screened_lead_redacted: true,
      legacy_lead_anonymized: false,
      external_cleanup_status: 'pending',
      error: 'external privacy cleanup requires explicit operator completion',
    });

    const response = await POST(request({ firm_id: FIRM_ID }), params());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      database_redacted: true,
      deletion_request_id: REQUEST_ID,
      external_cleanup_status: 'pending',
    });
  });

  it('rejects malformed tenant and request identifiers', async () => {
    const badFirm = await POST(request({ firm_id: 'firm-1' }), params());
    const badRequest = await POST(
      request({ deletion_request_id: 'request-1' }),
      params(),
    );

    expect(badFirm.status).toBe(400);
    expect(badRequest.status).toBe(400);
    expect(mocks.purgeLeadPii).not.toHaveBeenCalled();
  });
});
