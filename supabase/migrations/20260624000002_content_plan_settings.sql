-- Per-firm content-plan settings: an operator-written batch "ask" note and a
-- custom "review by" deadline, shown in the review-overview panel. One row per
-- firm. The computed next-publish deadline stands in when review_by is unset.
--
-- Service-role only. RLS forced + anon/authenticated/PUBLIC revoked in the same
-- migration, per the Database Access Invariant.

CREATE TABLE IF NOT EXISTS content_plan_settings (
  firm_id    uuid PRIMARY KEY,
  ask        text,
  review_by  date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE content_plan_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_plan_settings FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON content_plan_settings FROM anon, authenticated, PUBLIC;

NOTIFY pgrst, 'reload schema';
