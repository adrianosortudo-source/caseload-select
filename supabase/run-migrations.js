#!/usr/bin/env node
/**
 * run-migrations.js
 *
 * Executes all pending Supabase migrations via the Management API.
 * Requires a Supabase Personal Access Token (PAT).
 *
 * Usage:
 *   node supabase/run-migrations.js <personal-access-token>
 *
 * Get token at: https://supabase.com/dashboard/account/tokens
 * Token format: sbp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 */

const fs   = require("fs");
const path = require("path");
const https = require("https");

const PROJECT_REF = "qpzopweonveumvuqkqgw";
const API_BASE    = "https://api.supabase.com";

// ── Migration files in execution order ────────────────────────────────────────
const MIGRATIONS = [
  // NOTE: 20260413_add_confirmed_answers.sql is a deliberate no-op (comment only).
  "20260414_portal_clio.sql",
  "20260414_custom_domain.sql",
  "20260414_intake_firms_location.sql",
  "20260414_journey_sequences.sql",
  "20260414_conflict_check.sql",
  "20260414_j2_consultation_reminders.sql",
  "20260414_j7_welcome_onboarding.sql",
  "20260414_j8_matter_active.sql",
  "20260414_j9_review_request.sql",
  "20260414_j10_re_engagement.sql",
  "20260414_j11_j12_relationship_nurture.sql",
  "20260414_retainer_agreements.sql",
  "20260415_leads_intake_session_id.sql",
  "20260415_dashboard_columns.sql",
  "20260415_dashboard_v2.sql",
  "20260417_sub_type_conflicts.sql",
  "20260417_round3_memo.sql",
  "20260418_retainer_fks.sql",
  "20260418_matter_routing.sql",
  "20260418_storage_intake_attachments.sql",
  "20260421_intake_sessions_practice_sub_type.sql",
  "20260423_leads_cpi_explainability.sql",
  "20260423_leads_scoring_model.sql",
  "20260423_rls_hardening.sql",
  "20260423_rls_hardening_fix.sql",
  "20260423_rls_hardening_sweep.sql",
  "20260505_screened_leads.sql",
  "20260505_screened_leads_dashboard_indexes.sql",
  "20260505_firm_decline_templates.sql",
];

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

// ── HTTP helper ───────────────────────────────────────────────────────────────
function post(token, query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const options = {
      hostname: "api.supabase.com",
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type":  "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, status: res.statusCode, body: data });
        } else {
          resolve({ ok: false, status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const token = process.argv[2];
  if (!token || !token.startsWith("sbp_")) {
    console.error("Usage: node supabase/run-migrations.js <personal-access-token>");
    console.error("Token must start with 'sbp_'");
    console.error("Get one at: https://supabase.com/dashboard/account/tokens");
    process.exit(1);
  }

  console.log(`\nConnecting to project: ${PROJECT_REF}`);

  // Verify token works first
  const ping = await post(token, "SELECT current_database()");
  if (!ping.ok) {
    console.error(`\n✗ Auth failed (HTTP ${ping.status}): ${ping.body}`);
    console.error("Check your token at https://supabase.com/dashboard/account/tokens");
    process.exit(1);
  }
  console.log("✓ Token valid\n");

  let passed = 0;
  let failed = 0;

  for (const file of MIGRATIONS) {
    const filePath = path.join(MIGRATIONS_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.log(`  SKIP  ${file} (file not found)`);
      continue;
    }

    const sql = fs.readFileSync(filePath, "utf8").trim();
    // Skip files that are entirely comments (no executable SQL)
    const strippedComments = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (!strippedComments) {
      console.log(`  SKIP  ${file} (no-op)`);
      continue;
    }

    process.stdout.write(`  RUN   ${file} ... `);
    const result = await post(token, sql);
    if (result.ok) {
      console.log("✓");
      passed++;
    } else {
      console.log(`✗ (HTTP ${result.status})`);
      try {
        const parsed = JSON.parse(result.body);
        console.error(`         ${parsed.message || result.body}`);
      } catch {
        console.error(`         ${result.body.slice(0, 200)}`);
      }
      failed++;
    }
  }

  console.log(`\n────────────────────────────────`);
  console.log(`  ${passed} passed   ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailed migrations are listed above. Fix errors and re-run — all statements are idempotent.");
    process.exit(1);
  } else {
    console.log("\nAll migrations applied successfully.");
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
