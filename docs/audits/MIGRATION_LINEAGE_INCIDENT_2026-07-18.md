---
doc-type: audit
scope: supabase-migration-lineage
auditor: Claude Sonnet 5
date: 2026-07-18
status: FROZEN — production migration commands halted pending human/data-engineer-approved remediation design
supersedes-claim: "RESOLVED" language in PR #57 / docs/BASELINE_MIGRATION_DECISION_RECORD.md, corrected here
related-docs:
  - docs/BASELINE_MIGRATION_DECISION_RECORD.md (PR #57's own decision record; the source of the repair action this doc audits)
  - docs/audits/MIGRATION-LINEAGE-REPORT-2026-07-16.md (earlier, PR #57-independent instance of the same drift pattern; several of its open items are now resolved, tracked below)
  - docs/audits/migration-lineage-mapping-2026-07-16.json (machine-readable precedent for this doc's reconciliation table)
---

# Migration Lineage Incident: production ledger reconciliation, 2026-07-18

## Status and scope correction

PR #57 ("Supabase migration baseline reconciliation") was previously described in project memory and in its own CI comments as **RESOLVED**. An independent post-merge audit the same day found that claim overstated: PR #57 genuinely fixed fresh local/CI bootstrapping (`supabase start` now succeeds from an empty Postgres), but it did **not** restore a trustworthy correspondence between the migration files in git, Supabase's production ledger, and the actual production schema. `supabase db push --dry-run` against production still refuses to compute a push plan.

**This is not schema or data corruption.** Every table/trigger spot-checked during the audit matches production exactly, and the mechanism that created the ledger duplication (`supabase migration repair --status applied`, documented in `docs/BASELINE_MIGRATION_DECISION_RECORD.md` Section 9) is metadata-only and executes no SQL. The issue is migration bookkeeping: production's ledger now carries duplicate version rows for the same logical migration, and many local files still use synthetic timestamps rather than their real production-ledger versions. This is why `db push --dry-run` refuses, and it is a controlled incident to reconcile deliberately, not a cleanup task to rush.

**Note on "silent":** the repair action was documented in `BASELINE_MIGRATION_DECISION_RECORD.md` Section 9 at the time it was run. The problem was that this documentation wasn't visible enough in the PR body or release summary, and the prior "RESOLVED" framing overstated its effect. This doc corrects that visibility gap.

## 1. Freeze (in effect as of 2026-07-18)

**No production migration commands for CaseLoad Select until a human/data-engineer-approved remediation design exists and is executed.** This specifically means, against `ssxryjxifwiivghglqer`:

- No `supabase db push` (real or `--dry-run` is fine; only non-dry-run pushes are frozen)
- No `supabase migration repair`
- No `supabase db pull`
- No new "baseline" or reconstruction migrations applied
- No filename renames of already-applied migrations

This freeze does not block local development, `supabase start` against a fresh local/CI Postgres, or read-only investigation (`list_migrations`, `execute_sql` SELECTs, `migration list --linked`).

## 2. Branch protection: `enforce_admins` enabled

Confirmed via GitHub API before this change: `enforce_admins: false` on `main`'s branch protection meant the 5 required status checks (including "Publication concurrency integration tests (real Postgres)") were bypassable by any repository admin — required-but-bypassable is advisory, not a gate.

**Change made 2026-07-18:** `enforce_admins` set to `true` via `gh api repos/adrianosortudo-source/caseload-select/branches/main/protection/enforce_admins -X POST`. Confirmed after: `"enforce_admins":{"enabled":true}`.

**`strict` deliberately left unchanged (`false`)** — this affects whether a PR's required checks must re-run against an up-to-date `main` before merge, which has merge-workflow implications beyond this incident. Left as a separate decision for the operator, not bundled into this fix.

## 3. Full ledger reconciliation report

Method: pulled the complete production ledger (`list_migrations`, 256 rows) and the complete local `supabase/migrations/` file list (180 files, including 1 baseline migration and 1 intentionally-manual runbook file) from the actual merged `main` tip (`398a9fb`, no `supabase/migrations/` changes since the audited PR #57 merge commit `c9ee643`). Computed a SHA256 hash of every local file's content. Cross-referenced against the 59-entry true-production-ledger-version table independently verified by the separate `migration-lineage-normalization` investigation (read-only, via direct `schema_migrations` cross-check). Classified every local file and every ledger row programmatically (script + full data retained alongside this report's source materials).

Every classification below was computed from the actual data, not hand-transcribed.

## A. Exact match (105 files)

Local file version has exactly one corresponding production ledger row, at the same version. No duplicate bookkeeping. This does not by itself prove the SQL was executed for real vs. marked applied via repair — see the incident doc for that distinction on the baseline file specifically.

<details><summary>Full list (105)</summary>

| Version | Local filename | SHA256 (16-char prefix) |
| --- | --- | --- |
| 20260413 | 20260413_add_confirmed_answers.sql | c22d4aedbddd5f2f |
| 20260414000001 | 20260414000001_conflict_check.sql | 2b561f99680261aa |
| 20260414000002 | 20260414000002_custom_domain.sql | 4788d23f0e7da0b4 |
| 20260414000003 | 20260414000003_intake_firms_location.sql | e37118049ae3ccc8 |
| 20260414000004 | 20260414000004_j10_re_engagement.sql | b51231c7f6c5ff58 |
| 20260414000005 | 20260414000005_j11_j12_relationship_nurture.sql | 86bfde789c67ff4e |
| 20260414000006 | 20260414000006_j2_consultation_reminders.sql | f7984637da8838c4 |
| 20260414000007 | 20260414000007_j7_welcome_onboarding.sql | e0e339252232f70c |
| 20260414000008 | 20260414000008_j8_matter_active.sql | 614d7205df01c6bd |
| 20260414000009 | 20260414000009_j9_review_request.sql | 565c153bb0f54f9f |
| 20260414000010 | 20260414000010_journey_sequences.sql | 4035e45107d7a9aa |
| 20260414000011 | 20260414000011_portal_clio.sql | 8140f216a9525ac8 |
| 20260414000012 | 20260414000012_retainer_agreements.sql | 636ead5dc49d7115 |
| 20260415000001 | 20260415000001_dashboard_columns.sql | 33e4b451f3824070 |
| 20260415000002 | 20260415000002_dashboard_v2.sql | 72aef6c897ec337e |
| 20260415000003 | 20260415000003_leads_intake_session_id.sql | 49f59f325bba00d0 |
| 20260417000001 | 20260417000001_round3_memo.sql | 1fbff74883aaab47 |
| 20260417000002 | 20260417000002_sub_type_conflicts.sql | 3360f1cca085e58c |
| 20260418000001 | 20260418000001_matter_routing.sql | c9103a807bfabefd |
| 20260418000002 | 20260418000002_retainer_fks.sql | eda6217191b48899 |
| 20260418000003 | 20260418000003_storage_intake_attachments.sql | b7c54464821c793c |
| 20260421 | 20260421_intake_sessions_practice_sub_type.sql | c002e3cb21989a4d |
| 20260423000001 | 20260423000001_leads_cpi_explainability.sql | 0caf1c129e052295 |
| 20260423000002 | 20260423000002_leads_scoring_model.sql | 6a9cf00dc62ef4c7 |
| 20260423000003 | 20260423000003_rls_hardening.sql | d038fdf109a4c667 |
| 20260423000004 | 20260423000004_rls_hardening_fix.sql | ed1cc815c4991b5c |
| 20260423000005 | 20260423000005_rls_hardening_sweep.sql | 691a88c28a9b8e01 |
| 20260429 | 20260429_band_x_check_constraint.sql | f70861ba2c11bc9f |
| 20260505000001 | 20260505000001_firm_decline_templates.sql | 910488312c895212 |
| 20260505000002 | 20260505000002_screened_leads.sql | 3a82e132e08334c3 |
| 20260505000003 | 20260505000003_screened_leads_dashboard_indexes.sql | ef49cdd049ae1914 |
| 20260505000004 | 20260505000004_webhook_outbox.sql | 9e3812ad66892c6c |
| 20260506000001 | 20260506000001_firm_lawyers.sql | 41c4cf5fbe5f7f1f |
| 20260506000002 | 20260506000002_firm_files.sql | 67efccc35e2c9b9e |
| 20260506000003 | 20260506000003_pg_cron_pg_net_setup.sql | bb52fdf1f4f80784 |
| 20260512 | 20260512_intake_language_and_raw_transcript.sql | 6e3eb02456487a48 |
| 20260513000001 | 20260513000001_firm_onboarding_intake.sql | ed9409b464ab57c6 |
| 20260513000002 | 20260513000002_cron_health_rpc.sql | 99197a55a77e765a |
| 20260513000003 | 20260513000003_firm_onboarding_access_grant_status.sql | 519e09d45c5c3248 |
| 20260513000004 | 20260513000004_firm_onboarding_booking_url.sql | 6b518628c3f69535 |
| 20260513000005 | 20260513000005_firm_onboarding_channels_and_signature.sql | b256cc92667eb476 |
| 20260513000006 | 20260513000006_firm_onboarding_gbp_admin_status.sql | a1cb67658802ed44 |
| 20260513000007 | 20260513000007_firm_onboarding_intake_doc_upload.sql | 7b8fc79064b50c8a |
| 20260513000008 | 20260513000008_firm_onboarding_practice_scope_and_systems.sql | 5ca74a77bab6c8ed |
| 20260513000009 | 20260513000009_voice_webhook_secret.sql | 340b1da013ff978a |
| 20260514000001 | 20260514000001_intake_firms_channel_asset_ids.sql | 72f177a96ee78e2a |
| 20260514000002 | 20260514000002_screened_leads_actor_role.sql | dab6050f935d3f32 |
| 20260515000001 | 20260515000001_band_d_and_referred_status.sql | 44832d84ecdbd4e1 |
| 20260515000002 | 20260515000002_screened_leads_utm_referrer.sql | d45a3f41fd14f435 |
| 20260516000001 | 20260516000001_channel_intake_sessions.sql | 99ea11ec93b8f5d2 |
| 20260516000002 | 20260516000002_intake_firms_meta_access_tokens.sql | 4e1c09b909672a7a |
| 20260516000003 | 20260516000003_unconfirmed_inquiries.sql | 939692abdb45fe8b |
| 20260605175457 | 20260605175457_security_lockdown_anon_authenticated.sql | 6f6527c4da1717e2 |
| 20260617000001 | 20260617000001_firm_onboarding_customer_base.sql | 076ca6846b259e96 |
| 20260623000004 | 20260623000004_deliverables_article_meta.sql | 5c7c1e7b29280782 |
| 20260623000005 | 20260623000005_deliverables_review_notified_at.sql | 827fc48cefe3729f |
| 20260623000006 | 20260623000006_firm_analytics_config.sql | 6e52d77ac9a2252f |
| 20260624000003 | 20260624000003_content_studio_foundation.sql | 8f926449a8c052f4 |
| 20260624000004 | 20260624000004_deliverables_kicker.sql | 46f6414fb127998d |
| 20260625000004 | 20260625000004_firm_onboarding_v2_phase1_bing_apple_fees.sql | 3b82eecf88d99a52 |
| 20260625000007 | 20260625000007_screened_leads_contact_postal_code.sql | 11ea890392b925c4 |
| 20260626000001 | 20260626000001_fix_cron_health_http_correlation.sql | e49a348c532570b6 |
| 20260702152906 | 20260702152906_promote_scoring_port_default_on.sql | 24d6feb7fbfe0ccf |
| 20260702154220 | 20260702154220_screened_leads_decision_reason_code.sql | 53c0ddfce098d0fc |
| 20260702155341 | 20260702155341_web_intake_sessions.sql | 92c27c188f1a0f35 |
| 20260702190957 | 20260702190957_j8_client_matters_milestone_fields_schema.sql | 4d97dafdbe033b37 |
| 20260706200052 | 20260706200052_operator_preview_log.sql | 07c210aaa02a7be5 |
| 20260713234759 | 20260713234759_deliverable_suggestions.sql | 43ab6ebf1c4f8fcb |
| 20260713235455 | 20260713235455_deliverable_suggestion_atomic_workflow.sql | 8b27f69c510e81f6 |
| 20260714001604 | 20260714001604_deliverable_suggestion_fk_indexes.sql | 8a817cd866c60d18 |
| 20260714011950 | 20260714011950_deliverable_suggestion_release_hardening.sql | e8c8e240672d9c81 |
| 20260714141535 | 20260714141535_publication_metadata.sql | 8b00b5178f561c5f |
| 20260714141612 | 20260714141612_publication_artifacts.sql | 0e63bd42d40a00aa |
| 20260714141709 | 20260714141709_publication_artifacts_fk_indexes.sql | e86ec86b647812c8 |
| 20260714180754 | 20260714180754_publication_artifacts_uniqueness.sql | d5cc2fa897837158 |
| 20260715191156 | 20260715191156_20260715130000_approval_records_append_only.sql | 48cb82878aca3026 |
| 20260715191218 | 20260715191218_20260715130100_content_placements.sql | a7e026e88d08379b |
| 20260715191243 | 20260715191243_20260715130200_publication_receipts.sql | 1d58b4c774ffe764 |
| 20260715193131 | 20260715193131_20260715120000_content_periods_readiness_activation.sql | f8e8a8c87c94af59 |
| 20260715193139 | 20260715193139_20260715120200_content_deliverables_cta_target_path.sql | e1d0da4ecbac47c7 |
| 20260715193146 | 20260715193146_20260715120400_founder_vesting_cta_target_path_fix.sql | 7531eff582bbc3e2 |
| 20260715193201 | 20260715193201_20260715120500_relocation_clause_publication_metadata.sql | 5beac63e9c0c5a8e |
| 20260715193211 | 20260715193211_20260715121000_already_published_retroactive_review_publication_metadata.sql | 5fb1c0950ec108ef |
| 20260715193219 | 20260715193219_20260715121500_decision_tools_publication_metadata.sql | 9731d1a7d17c8180 |
| 20260715193236 | 20260715193236_20260715122000_renewal_clause_publication_metadata.sql | c971f7c0e0dc3606 |
| 20260715193255 | 20260715193255_20260715122500_equal_shares_unequal_control_publication_metadata.sql | 6308e3c4271a07ba |
| 20260715193313 | 20260715193313_20260715123000_power_of_attorney_publication_metadata.sql | 80e55683c1beec4f |
| 20260715193329 | 20260715193329_20260715123500_shareholder_agreement_clauses_publication_metadata.sql | 89ce8c4f150304a0 |
| 20260715193342 | 20260715193342_20260715124000_content_periods_lifecycle_inventory.sql | 80392ffc51adeb3b |
| 20260715210116 | 20260715210116_content_periods_enforced_monotonic.sql | fae871979ba23eb1 |
| 20260715225139 | 20260715225139_publication_receipt_integrity_hardening.sql | 3dc3c9859644d344 |
| 20260715231733 | 20260715231733_publication_receipt_hardening_supplement.sql | ce526ee44721c834 |
| 20260715232702 | 20260715232702_20260715234500_publication_artifacts_dedupe_partial_index.sql | 4bffe7c7b3470345 |
| 20260716144315 | 20260716144315_publication_receipt_verification_after_revision_fix.sql | bfa50215f95287c0 |
| 20260716144510 | 20260716144510_publication_receipt_concurrency_lock.sql | 1df70155cd4bc236 |
| 20260716144723 | 20260716144723_publication_receipt_reconcile_concurrency_lock_merge.sql | 57dd99c7fcce566b |
| 20260716150130 | 20260716150130_publication_placement_claims.sql | 17ffba6081b26d46 |
| 20260716155746 | 20260716155746_publication_placement_claim_race_fix.sql | 4a10d728a306e12d |
| 20260716205822 | 20260716205822_publication_receipt_claim_binding.sql | 2ab8f4afe764a8c1 |
| 20260716205829 | 20260716205829_publication_placement_claim_mutation_lockdown.sql | 6c1b0a02b63891e5 |
| 20260716210037 | 20260716210037_publication_receipt_claim_release_revoke_public_execute.sql | 914c06946d193a5a |
| 20260717001444 | 20260717001444_publication_receipt_actor_binding_and_hash_trust_fix.sql | fd0734bbac3f42dd |
| 20260717001510 | 20260717001510_publication_placement_claim_idempotency_identity_scoping.sql | 8a3041bb15851e62 |
| 20260717015014 | 20260717015014_publication_placement_claim_idempotency_firm_scoping.sql | b1bcd84ad24543ad |
| 20260717230956 | 20260717230956_standing_publishing_authorization.sql | f71e53cf028584ab |

</details>

## B. Duplicate ledger rows — local file matches one row, but another ledger row exists for the same content at a different version (73 files)

This is the core finding: production's ledger has TWO rows for the same logical migration (one at the true original applied version, one at the version PR #57's local file now carries). Where a `trueVersion` is populated, it was independently verified by the separate `migration-lineage-normalization` investigation via read-only cross-check against `supabase_migrations.schema_migrations`; where blank, the duplicate was detected by this reconciliation script's general slug-matching but wasn't part of that investigation's curated 59-row true-version table (still real, just not independently pre-verified by that specific document).

| Local version | Local filename | Other ledger version(s) for same content | Independently-verified true version |
| --- | --- | --- | --- |
| 20260518 | 20260518_enable_rls_firm_onboarding_intake.sql | 20260518205041 | (not in curated true-version table) |
| 20260520000001 | 20260520000001_firm_onboarding_directory_prep.sql | 20260520173822 | 20260520173822 |
| 20260520000002 | 20260520000002_firm_onboarding_notification_tracking.sql | 20260520192341 | 20260520192341 |
| 20260520000003 | 20260520000003_s8p1_client_matters.sql | 20260522014558 | 20260522014558 |
| 20260520000004 | 20260520000004_s8p1_explainer_articles.sql | 20260522014657 | 20260522014657 |
| 20260520000005 | 20260520000005_s8p1_firm_lawyers_roles.sql | 20260522014449 | 20260522014449 |
| 20260520000006 | 20260520000006_s8p1_intake_firms_routing.sql | 20260522014515 | 20260522014515 |
| 20260520000007 | 20260520000007_s8p1_matter_messages.sql | 20260522014628 | 20260522014628 |
| 20260520000008 | 20260520000008_s8p1_notification_batch_cron.sql | 20260522014741 | 20260522014741 |
| 20260520000009 | 20260520000009_s8p1_notification_outbox.sql | 20260522014728 | 20260522014728 |
| 20260521000001 | 20260521000001_intake_firms_ghl_location_id.sql | 20260521232106 | 20260521232106 |
| 20260521000002 | 20260521000002_intake_firms_voice_api_token.sql | 20260521225705 | 20260521225705 |
| 20260525 | 20260525_channel_intake_sessions_recent_finalized_index.sql | 20260525172702 | (not in curated true-version table) |
| 20260526000001 | 20260526000001_channel_sessions_screened_lead_link.sql | 20260526133906 | 20260526133906 |
| 20260526000002 | 20260526000002_intake_firms_token_expiry.sql | 20260526040314 | 20260526040314 |
| 20260526000003 | 20260526000003_intake_firms_token_expiry_trigger.sql | 20260526134701 | 20260526134701 |
| 20260601 | 20260601_voice_callback_requests.sql | 20260602001337 | (not in curated true-version table) |
| 20260602 | 20260602_intake_firms_gemini_disabled_alert.sql | 20260603011534 | (not in curated true-version table) |
| 20260605 | 20260605_voice_callback_promoted_link.sql | 20260605173558 | (not in curated true-version table) |
| 20260609000001 | 20260609000001_otp_attempt_cap.sql | 20260610012500 | 20260610012500 |
| 20260609000002 | 20260609000002_processed_channel_messages.sql | 20260610012439 | 20260610012439 |
| 20260609000003 | 20260609000003_screened_leads_notification_state.sql | 20260610012451 | 20260610012451 |
| 20260609000004 | 20260609000004_webhook_outbox_action_check_expand.sql | 20260610012511 | 20260610012511 |
| 20260611000000 | 20260611000000_voice_turn_sessions.sql | 20260628235155 | (not in curated true-version table) |
| 20260616000001 | 20260616000001_firm_files_links_and_sections.sql | 20260616190231 | 20260616190231 |
| 20260616000002 | 20260616000002_firm_lawyers_disabled.sql | 20260616195645 | 20260616195645 |
| 20260617000002 | 20260617000002_firm_onboarding_v2_fields.sql | 20260618002440 | 20260618002440 |
| 20260617000003 | 20260617000003_screened_leads_archive.sql | 20260617183933 | 20260617183933 |
| 20260623000001 | 20260623000001_approval_rpc_atomic.sql | 20260624005320 | 20260624005320 |
| 20260623000002 | 20260623000002_content_approval.sql | 20260623214957 | 20260623214957 |
| 20260623000003 | 20260623000003_content_approval_rls_lockdown.sql | 20260623225040 | 20260623225040 |
| 20260623000007 | 20260623000007_intake_attachments_private.sql | 20260623235317 | 20260623235317 |
| 20260623000008 | 20260623000008_intake_firms_is_demo.sql | 20260624015747 | 20260624015747 |
| 20260623000009 | 20260623000009_matter_messages_threading.sql | 20260623213534 | 20260623213534 |
| 20260624000001 | 20260624000001_content_periods.sql | 20260624173013 | 20260624173013 |
| 20260624000002 | 20260624000002_content_plan_settings.sql | 20260624181016 | 20260624181016 |
| 20260624000005 | 20260624000005_force_rls_three_pii_tables.sql | 20260624145957 | 20260624145957 |
| 20260624000006 | 20260624000006_notification_outbox_deliverable_events.sql | 20260624131132 | 20260624131132 |
| 20260624000007 | 20260624000007_operator_firm_messaging.sql | 20260624132001 | 20260624132001 |
| 20260624000008 | 20260624000008_operator_firm_messages_context.sql | 20260624173258 | 20260624173258 |
| 20260624000009 | 20260624000009_operator_firm_messaging_phase2.sql | 20260624145310 | 20260624145310 |
| 20260625000001 | 20260625000001_agency_crm.sql | 20260625184449 | 20260625184449 |
| 20260625000002 | 20260625000002_firm_about_explainer.sql | 20260625215747 | 20260625215747 |
| 20260625000003 | 20260625000003_firm_about_links.sql | 20260625222355 | 20260625222355 |
| 20260625000005 | 20260625000005_intake_firms_read_scoring_port.sql | 20260626031528 | 20260626031528 |
| 20260625000006 | 20260625000006_portal_signin_codes.sql | 20260625011646 | 20260625011646 |
| 20260625000008 | 20260625000008_screened_leads_scoring_delta.sql | 20260625224856 | 20260625224856 |
| 20260626000000 | 20260626000000_screened_conflict_checks.sql | 20260628234330 | (not in curated true-version table) |
| 20260626000002 | 20260626000002_matter_promotion_events.sql | 20260626173506 | 20260626173506 |
| 20260626000003 | 20260626000003_screened_leads_axis_reasoning.sql | 20260626174343 | 20260626174343 |
| 20260626000004 | 20260626000004_screened_leads_consent.sql | 20260626203055 | 20260626203055 |
| 20260626203055 | 20260626203055_20260626_screened_leads_consent.sql | 20260626000004 | 20260626203055 |
| 20260628 | 20260628_m1_parties_activities.sql | 20260629014003 | (not in curated true-version table) |
| 20260701 | 20260701_seo_audit_runs.sql | 20260703191317 | (not in curated true-version table) |
| 20260702000001 | 20260702000001_screened_leads_deadline_reminder.sql | 20260702145505 | 20260702145505 |
| 20260702000002 | 20260702000002_seo_check_runs.sql | 20260703185959 | 20260703185959 |
| 20260703 | 20260703_cadence_engine_shadow.sql | 20260703204338 | (not in curated true-version table) |
| 20260705000001 | 20260705000001_booking_adapter_wp6.sql | 20260705181015 | 20260705181015 |
| 20260705000002 | 20260705000002_cadence_audit_fixes.sql | 20260705233907 | 20260705233907 |
| 20260705000003 | 20260705000003_cadence_wp1_extensions.sql | 20260705171351 | 20260705171351 |
| 20260705000004 | 20260705000004_dashboard_views_wp5.sql | 20260705180445 | 20260705180445 |
| 20260705000005 | 20260705000005_ghl_export_wp8.sql | 20260705182716 | 20260705182716 |
| 20260705000006 | 20260705000006_review_automation_wp4.sql | 20260705175533 | 20260705175533 |
| 20260706000001 | 20260706000001_agency_prospects_dedupe_key.sql | 20260706040407 | 20260706040407 |
| 20260706000002 | 20260706000002_cadence_rules_trigger_type_field_change_only.sql | 20260706040354 | 20260706040354 |
| 20260706000003 | 20260706000003_consent_log_repair_cron.sql | 20260706045625 | 20260706045625 |
| 20260706000004 | 20260706000004_screened_leads_gclid.sql | 20260706041720 | 20260706041720 |
| 20260706000005 | 20260706000005_web_intake_sessions_gclid.sql | 20260706042154 | 20260706042154 |
| 20260707000001 | 20260707000001_consent_log_repair_antijoin_fn.sql | 20260706142705 | 20260706142705 |
| 20260707000002 | 20260707000002_deliverable_current_version_invariant.sql | 20260706162509 | 20260706162509 |
| 20260709 | 20260709_deliverable_change_request_loop.sql | 20260709201137 | (not in curated true-version table) |
| 20260716000000 | 20260716000000_firm_assist_corpus.sql | 20260716022452 | (not in curated true-version table) |
| 20260717030000 | 20260717030000_content_attribution_evidence.sql | 20260717224806 | (not in curated true-version table) |

## C. Reconstructed baseline (1 file)

| Version | Local filename | SHA256 (16-char prefix) |
| --- | --- | --- |
| 20260412235959 | 20260412235959_historical_baseline_pre_cutover.sql | 1b3b5cf39c2c9ec8 |

Provenance: introspection of the pre-cutover project + current production (see `docs/BASELINE_MIGRATION_DECISION_RECORD.md`). Column-level verified against live production for 8 of 9 covered tables during the 2026-07-18 audit (see [[project_pr57-post-merge-audit-2026-07-18]]).

## D. Ledger rows with genuinely no local file anywhere in the repo (7 rows)

| Ledger version | Ledger name |
| --- | --- |
| 20260518193933 | enable_required_extensions |
| 20260626100000 | content_studio_format_taxonomy |
| 20260626100100 | content_studio_doctrine_p0 |
| 20260626100200 | content_studio_compliance_formats |
| 20260712183638 | add_firm_profile_fee_detail_fields |
| 20260713185849 | pdf_artifact_integrity |
| 20260717231158 | standing_publishing_authorization_notification_pref_null_fix |

These are real, applied production content with zero corresponding `.sql` file under any name in this repo's git history, and are NOT covered by the historical baseline file either. One of these (`standing_publishing_authorization_notification_pref_null_fix`) is already documented in `CLAUDE.md` as a known, deliberately-unreconstructed gap. The other 6 have not been previously documented as gaps as far as this reconciliation found.

**Requirement for remediation:** each of these 7 is its own, individually documented provenance investigation — not a single blanket reconstruction pass. Current production schema shape (table/column/function definitions read live) is necessary evidence but is not by itself sufficient to justify writing a migration file and claiming it as that migration's original content: shape alone cannot prove the reconstructed SQL matches what was actually run, in what order, or with what since-superseded intermediate state. `docs/BASELINE_MIGRATION_DECISION_RECORD.md`'s own methodology for the historical baseline file (Sections 2-4: cross-referencing two independent live databases, git-history search across every branch, explicit "what is NOT invented" accounting) is the evidentiary bar each of these 7 should be held to, not a lower one.

## Summary counts

| Category | Count |
| --- | --- |
| C_RECONSTRUCTED_BASELINE | 1 |
| A_EXACT_MATCH | 105 |
| B_DUPLICATE_LEDGER_ROWS_LOCAL_MATCHES_ONE | 72 |
| B_LOCAL_VERSION_NOT_IN_LEDGER_BUT_SLUG_APPLIED_ELSEWHERE | 1 |
| MANUAL_RUNBOOK_NOT_A_MIGRATION | 1 |

- Total local migration files: 180 (178 real migrations + 1 baseline + 1 manual-runbook-not-a-migration)
- Total production ledger rows: 256
- Orphan ledger rows (no local file at that exact version): 78 — of which 71 correspond to a local file that exists under a *different* version (category B), and 7 have no local file at all (category D)


### Footnote: a genuine repo-level duplicate, not just a ledger duplicate

`20260626000004_screened_leads_consent.sql` and `20260626203055_20260626_screened_leads_consent.sql` are two **separate files on disk**, not just two ledger rows. Their bodies are otherwise identical but their header comments contradict each other: one says `STATUS: DRAFT. NOT APPLIED TO PROD`, the other says `STATUS: APPLIED TO PROD (confirmed live via Supabase MCP 2026-07-02...)`. The second, corrected file is accurate (the content is live). The first, stale file should eventually be resolved as part of remediation — not removed unilaterally now, per the freeze.

**Requirement for remediation:** this is a source-control hygiene issue, resolved by an approved source-of-truth decision about which file (or a merged replacement) stays — it is never resolved by any `migration repair` or other production-ledger operation. The ledger already has the correct single applied version for this content; nothing about the ledger needs to change to fix this. Do not conflate cleaning up the duplicate file with touching production's migration bookkeeping.

### Cross-reference to the 2026-07-16 report

`docs/audits/MIGRATION-LINEAGE-REPORT-2026-07-16.md` found the same underlying "apply directly, commit the file later" pattern independently, before PR #57 and before this incident. Of its 7 flagged gaps: `20260715232702` (dedupe partial-index) was resolved via PR #37; `deliverable_suggestions`, `deliverable_suggestion_atomic_workflow`, `deliverable_suggestion_fk_indexes`, and `deliverable_suggestion_release_hardening` are now present on `main` (all appear in Category A above) — resolved since that report was written. `pdf_artifact_integrity` and `add_firm_profile_fee_detail_fields` remain unresolved and appear again in Category D above. This incident's Category D also surfaces 5 gaps that report didn't cover: `enable_required_extensions` (predates that report's scope), the 3 `content_studio_*` migrations, and `standing_publishing_authorization_notification_pref_null_fix` (postdates that report, already flagged separately in `CLAUDE.md`).

## 4. Remediation gate

**No ledger remediation (repair, rename, revert, `db pull`, or new corrective migration) proceeds without a human- or data-engineer-approved design**, reviewed against this reconciliation table specifically. The goal of that design is a reproducible baseline and a safe forward migration path — not cosmetic filename consistency. Candidate approaches (true-ledger-version renames for the 73 duplicate-row files, a `migration repair --status reverted` pass for the true-original rows once the local files are corrected, reconstruction of the 7 Category D files from live introspection) are exactly the kind of broad repair commands this freeze exists to gate, not options to execute unilaterally from this document.

## 5. Publishing Operator scope note

The existing portal and production releases are not automatically unsafe because of this incident — schema and data integrity are intact. The Publishing Operator build stays paused specifically for any work that would require **new** Supabase migrations, since adding more database history on top of an unresolved ledger compounds the problem this document exists to close. Portal/UI work that touches no `supabase/migrations/` file is not blocked by this freeze.
