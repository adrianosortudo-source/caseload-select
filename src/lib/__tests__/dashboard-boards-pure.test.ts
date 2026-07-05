import { describe, it, expect } from 'vitest';
import { computeTriageBoard, computePipelineBoard, computeHealthBoard } from '@/lib/dashboard-boards-pure';

const NOW = new Date('2026-07-05T12:00:00.000Z');

describe('computeTriageBoard', () => {
  it('counts by band, defaulting an unbanded row to unrated', () => {
    const board = computeTriageBoard([
      { band: 'A', decision_deadline: null, submitted_at: NOW.toISOString() },
      { band: 'A', decision_deadline: null, submitted_at: NOW.toISOString() },
      { band: null, decision_deadline: null, submitted_at: NOW.toISOString() },
    ], NOW);
    expect(board.bandCounts).toMatchObject({ A: 2, B: 0, C: 0, D: 0, unrated: 1 });
    expect(board.total).toBe(3);
  });

  it('flags a passed deadline as overdue', () => {
    const board = computeTriageBoard([
      { band: 'B', decision_deadline: '2026-07-05T00:00:00.000Z', submitted_at: NOW.toISOString() },
    ], NOW);
    expect(board.overdueCount).toBe(1);
    expect(board.dueSoonCount).toBe(0);
  });

  it('flags a deadline within the next 12h as due soon, not overdue', () => {
    const board = computeTriageBoard([
      { band: 'B', decision_deadline: '2026-07-05T18:00:00.000Z', submitted_at: NOW.toISOString() },
    ], NOW);
    expect(board.dueSoonCount).toBe(1);
    expect(board.overdueCount).toBe(0);
  });

  it('ignores a deadline more than 12h away', () => {
    const board = computeTriageBoard([
      { band: 'B', decision_deadline: '2026-07-07T00:00:00.000Z', submitted_at: NOW.toISOString() },
    ], NOW);
    expect(board.dueSoonCount).toBe(0);
    expect(board.overdueCount).toBe(0);
  });

  it('buckets aging by hours since submission', () => {
    const board = computeTriageBoard([
      { band: 'A', decision_deadline: null, submitted_at: '2026-07-05T11:00:00.000Z' }, // 1h
      { band: 'A', decision_deadline: null, submitted_at: '2026-07-05T02:00:00.000Z' }, // 10h
      { band: 'A', decision_deadline: null, submitted_at: '2026-07-01T00:00:00.000Z' }, // days
    ], NOW);
    expect(board.agingBuckets).toEqual({ under4h: 1, between4And24h: 1, over24h: 1 });
  });

  it('returns zeroed board for no rows', () => {
    const board = computeTriageBoard([], NOW);
    expect(board.total).toBe(0);
    expect(board.overdueCount).toBe(0);
  });
});

describe('computePipelineBoard', () => {
  it('counts matters by stage', () => {
    const board = computePipelineBoard([
      { matter_stage: 'active', matter_stage_changed_at: NOW.toISOString(), created_at: NOW.toISOString() },
      { matter_stage: 'active', matter_stage_changed_at: NOW.toISOString(), created_at: NOW.toISOString() },
      { matter_stage: 'intake', matter_stage_changed_at: NOW.toISOString(), created_at: NOW.toISOString() },
    ], NOW);
    expect(board.stageCounts).toMatchObject({ intake: 1, active: 2, retainer_pending: 0, closing: 0, closed: 0 });
    expect(board.total).toBe(3);
  });

  it('computes average days in the current stage per stage', () => {
    const board = computePipelineBoard([
      { matter_stage: 'active', matter_stage_changed_at: '2026-07-01T12:00:00.000Z', created_at: '2026-06-01T00:00:00.000Z' }, // 4 days
      { matter_stage: 'active', matter_stage_changed_at: '2026-07-03T12:00:00.000Z', created_at: '2026-06-01T00:00:00.000Z' }, // 2 days
    ], NOW);
    expect(board.avgDaysInCurrentStage.active).toBeCloseTo(3, 5);
  });

  it('returns null average for a stage with no matters', () => {
    const board = computePipelineBoard([
      { matter_stage: 'active', matter_stage_changed_at: NOW.toISOString(), created_at: NOW.toISOString() },
    ], NOW);
    expect(board.avgDaysInCurrentStage.closed).toBeNull();
  });

  it('computes promotionRate as the share of matters past intake', () => {
    const board = computePipelineBoard([
      { matter_stage: 'intake', matter_stage_changed_at: NOW.toISOString(), created_at: NOW.toISOString() },
      { matter_stage: 'active', matter_stage_changed_at: NOW.toISOString(), created_at: NOW.toISOString() },
      { matter_stage: 'closed', matter_stage_changed_at: NOW.toISOString(), created_at: NOW.toISOString() },
      { matter_stage: 'closed', matter_stage_changed_at: NOW.toISOString(), created_at: NOW.toISOString() },
    ], NOW);
    expect(board.promotionRate).toBe(0.75);
  });

  it('returns null promotionRate for zero matters', () => {
    expect(computePipelineBoard([], NOW).promotionRate).toBeNull();
  });
});

describe('computeHealthBoard', () => {
  it('computes consent coverage as the share of explicit or implied rows', () => {
    const board = computeHealthBoard({
      consentRows: [
        { email_consent_status: 'explicit' }, { email_consent_status: 'implied' },
        { email_consent_status: 'unknown' }, { email_consent_status: 'declined' },
      ],
      channelRows: [],
      shadowMessageCount: 0,
      notificationFailureCount: 0,
    });
    expect(board.consentCoverageRate).toBe(0.5);
    expect(board.totalLeads).toBe(4);
  });

  it('returns null consent coverage for zero leads', () => {
    const board = computeHealthBoard({ consentRows: [], channelRows: [], shadowMessageCount: 0, notificationFailureCount: 0 });
    expect(board.consentCoverageRate).toBeNull();
  });

  it('builds a channel mix sorted by count descending, defaulting a null channel to web', () => {
    const board = computeHealthBoard({
      consentRows: [],
      channelRows: [{ channel: 'voice' }, { channel: null }, { channel: null }, { channel: 'whatsapp' }],
      shadowMessageCount: 0,
      notificationFailureCount: 0,
    });
    expect(board.channelMix).toEqual([
      { channel: 'web', count: 2 },
      { channel: 'voice', count: 1 },
      { channel: 'whatsapp', count: 1 },
    ]);
  });

  it('passes through shadow cadence volume and notification failure count', () => {
    const board = computeHealthBoard({ consentRows: [], channelRows: [], shadowMessageCount: 42, notificationFailureCount: 3 });
    expect(board.shadowCadenceVolume).toBe(42);
    expect(board.notificationFailureCount).toBe(3);
  });
});
