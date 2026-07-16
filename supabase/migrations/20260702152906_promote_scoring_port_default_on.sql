-- C3 confidence pilot promotion (2026-07-02). Audit confirmed zero drift
-- across 38 backfilled DRG rows over the 2026-06-28 to 2026-07-02 monitoring
-- window; tiers correctly track row-level evidence and band stays independent
-- of confidence. Flip the opt-in flag to opt-out: new firms default true,
-- existing firms backfilled true. read_scoring_port=false remains the
-- documented instant-rollback path if drift ever appears.
ALTER TABLE intake_firms ALTER COLUMN read_scoring_port SET DEFAULT true;
UPDATE intake_firms SET read_scoring_port = true WHERE read_scoring_port = false;
