-- Migration: Add location column to intake_firms
-- Used by retainer.ts to populate firm_location on the retainer agreement PDF.
-- Fallback in code: "Toronto, ON"

ALTER TABLE intake_firms
  ADD COLUMN IF NOT EXISTS location text;
