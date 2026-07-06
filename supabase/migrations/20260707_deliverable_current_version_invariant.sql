-- Deliverable current-version invariant
--
-- Invariant: if a deliverable has any versions, content_deliverables.current_version_id
-- points at the highest-numbered one.
--
-- Until now that rule lived only in application code (lib/deliverables.ts addVersion,
-- which UPDATEs the pointer after inserting a version). Any other writer that inserts
-- a version row directly (seed scripts, bulk backfills, manual SQL, future migrations)
-- left current_version_id NULL. In the review UI that produces a silent dead-end: the
-- sign-off panel can only sign the current version, so a null pointer hides the Approve
-- button with no explanation and no "switch to current" banner to recover from.
--
-- This migration moves the invariant into the database so no writer can violate it,
-- then repairs the rows already broken.
--
-- current_version_id stays NULLABLE on purpose: a deliverable legitimately exists with
-- zero versions between creation and its first posted version. The rule is conditional
-- (versions exist -> pointer set), which a trigger enforces and a NOT NULL cannot.

-- ─── Trigger: advance the pointer on every version insert ─────────────────────

CREATE OR REPLACE FUNCTION deliverable_track_current_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Advance the parent's pointer when the inserted row is the highest version
  -- for that deliverable. Matches the existing app behaviour (posting a new
  -- version advances current_version_id); this only guarantees it for every
  -- writer. Lower-numbered historical inserts do not move the pointer.
  IF NEW.version_number = (
    SELECT max(version_number)
    FROM deliverable_versions
    WHERE deliverable_id = NEW.deliverable_id
  ) THEN
    UPDATE content_deliverables
    SET current_version_id = NEW.id,
        updated_at = now()
    WHERE id = NEW.deliverable_id
      AND current_version_id IS DISTINCT FROM NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deliverable_track_current_version ON deliverable_versions;
CREATE TRIGGER trg_deliverable_track_current_version
  AFTER INSERT ON deliverable_versions
  FOR EACH ROW
  EXECUTE FUNCTION deliverable_track_current_version();

-- ─── One-time backfill: repair rows with versions but a null pointer ──────────
--
-- Idempotent: scoped to current_version_id IS NULL, so re-running is a no-op.
-- Deliberately does NOT touch updated_at, to avoid reordering the deliverables
-- list (which sorts by updated_at) on a pure data repair.

UPDATE content_deliverables d
SET current_version_id = lv.id
FROM (
  SELECT DISTINCT ON (deliverable_id) deliverable_id, id
  FROM deliverable_versions
  ORDER BY deliverable_id, version_number DESC
) lv
WHERE lv.deliverable_id = d.id
  AND d.current_version_id IS NULL;
