-- Codex re-audit CP-03, applied to prod 2026-06-23 via Supabase MCP.
--
-- The OTP-verify demo bypass was gated by a regex against intake_firms.name,
-- which is mutable text and not auditable. A rename to include "[DEMO]"
-- silently turns off OTP enforcement; a rename away from "[DEMO]" silently
-- turns it back on. Replace with a dedicated boolean so the security posture
-- is explicit and immutable except by an operator decision on the column.
--
-- Backfill the existing single demo firm (Hartwell Law PC [DEMO]); leave
-- every other firm false. The OTP verify route now checks this column
-- directly.

ALTER TABLE intake_firms
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

UPDATE intake_firms
   SET is_demo = true
 WHERE name ILIKE '%[DEMO]%' AND is_demo = false;

COMMENT ON COLUMN intake_firms.is_demo IS
  'When true, the OTP verify route accepts any 6-digit code for sessions on this firm (sales-demo bypass). Set explicitly by the operator on synthetic-data firms only. Never set on a firm that holds real client PII.';
