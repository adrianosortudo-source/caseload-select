# Phase 1 — Migration Lineage Normalization Manifest (2026-07-18)

Branch: `chore/migration-lineage-normalization-2026-07-18`, based on `origin/main` at `a75070d`
(the current tip at time of branching). Filename-only change: 116 files renamed, **zero SQL content
modified** (`git diff --cached --stat`: 116 files changed, 0 insertions, 0 deletions).

## Why

Supabase's CLI derives a migration's version from the leading run of digits in its filename. Several
groups of files in `supabase/migrations/` share the same bare 8-digit date prefix (e.g. twelve files
all begin `20260414_...`), which makes them collide on version even though their filenames and
content differ. This blocks a genuinely fresh `supabase start` / `db push` from a clean state. This
manifest documents the rename applied to resolve it, cleanly separated from any SQL content change or
any historical-source recovery work (those are separate, later phases).

## The two categories

**59 files renamed to their true, verified production ledger version.** Each of these was
cross-checked read-only against `ssxryjxifwiivghglqer` (`supabase_migrations.schema_migrations`,
matched by base migration name, not by date, since `migration repair`'s version-date and the
content's original authored date frequently differ — see the schema-parity corrective audit's
Finding 14 for the mechanism). For these 59, `supabase db push` / `migration list` will now recognize
the local file as already-applied at that exact version, with **zero `migration repair` calls
required** going forward.

**57 files given deterministic, collision-only naming (date + zero-padded sequence number).** No
unique production ledger row exists to match:
- 48 predate the ledger's own inception (`20260518193933`) — production has no ledger row for content
  from before that point, by construction, regardless of what version their local file carries.
- 9 are live in production today but were never tracked under any ledger version (independently
  verified in the schema-parity corrective audit's Finding 10, via direct table/column/function
  presence checks, not inferred from a name match): `firm_onboarding_customer_base`,
  `deliverables_article_meta`, `deliverables_review_notified_at`, `firm_analytics_config`,
  `content_studio_foundation`, `deliverables_kicker`,
  `firm_onboarding_v2_phase1_bing_apple_fees`, `screened_leads_contact_postal_code`,
  `fix_cron_health_http_correlation`.

Both sub-groups are expected to still show as **local-only** in `supabase migration list` — this is
correct and by design, not an error, and this phase does **not** attempt to close that gap via
`migration repair` (that decision belongs to a later, explicitly-reviewed phase per the corrective
task's own safety boundary #4).

## Full rename table

| Original filename | New filename | True ledger version? | Reason |
|---|---|---|---|
| `20260414_conflict_check.sql` | `20260414000001_conflict_check.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260414_custom_domain.sql` | `20260414000002_custom_domain.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260414_intake_firms_location.sql` | `20260414000003_intake_firms_location.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260414_j10_re_engagement.sql` | `20260414000004_j10_re_engagement.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260414_j11_j12_relationship_nurture.sql` | `20260414000005_j11_j12_relationship_nurture.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260414_j2_consultation_reminders.sql` | `20260414000006_j2_consultation_reminders.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260414_j7_welcome_onboarding.sql` | `20260414000007_j7_welcome_onboarding.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260414_j8_matter_active.sql` | `20260414000008_j8_matter_active.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260414_j9_review_request.sql` | `20260414000009_j9_review_request.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260414_journey_sequences.sql` | `20260414000010_journey_sequences.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260414_portal_clio.sql` | `20260414000011_portal_clio.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260414_retainer_agreements.sql` | `20260414000012_retainer_agreements.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260415_dashboard_columns.sql` | `20260415000001_dashboard_columns.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260415_dashboard_v2.sql` | `20260415000002_dashboard_v2.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260415_leads_intake_session_id.sql` | `20260415000003_leads_intake_session_id.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260417_round3_memo.sql` | `20260417000001_round3_memo.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260417_sub_type_conflicts.sql` | `20260417000002_sub_type_conflicts.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260418_matter_routing.sql` | `20260418000001_matter_routing.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260418_retainer_fks.sql` | `20260418000002_retainer_fks.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260418_storage_intake_attachments.sql` | `20260418000003_storage_intake_attachments.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260423_leads_cpi_explainability.sql` | `20260423000001_leads_cpi_explainability.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260423_leads_scoring_model.sql` | `20260423000002_leads_scoring_model.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260423_rls_hardening.sql` | `20260423000003_rls_hardening.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260423_rls_hardening_fix.sql` | `20260423000004_rls_hardening_fix.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260423_rls_hardening_sweep.sql` | `20260423000005_rls_hardening_sweep.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260505_firm_decline_templates.sql` | `20260505000001_firm_decline_templates.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260505_screened_leads.sql` | `20260505000002_screened_leads.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260505_screened_leads_dashboard_indexes.sql` | `20260505000003_screened_leads_dashboard_indexes.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260505_webhook_outbox.sql` | `20260505000004_webhook_outbox.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260506_firm_files.sql` | `20260506000001_firm_files.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260506_firm_lawyers.sql` | `20260506000002_firm_lawyers.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260506_pg_cron_pg_net_setup.sql` | `20260506000003_pg_cron_pg_net_setup.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260513_cron_health_rpc.sql` | `20260513000001_cron_health_rpc.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260513_firm_onboarding_access_grant_status.sql` | `20260513000002_firm_onboarding_access_grant_status.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260513_firm_onboarding_booking_url.sql` | `20260513000003_firm_onboarding_booking_url.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260513_firm_onboarding_channels_and_signature.sql` | `20260513000004_firm_onboarding_channels_and_signature.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260513_firm_onboarding_gbp_admin_status.sql` | `20260513000005_firm_onboarding_gbp_admin_status.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260513_firm_onboarding_intake.sql` | `20260513000006_firm_onboarding_intake.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260513_firm_onboarding_intake_doc_upload.sql` | `20260513000007_firm_onboarding_intake_doc_upload.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260513_firm_onboarding_practice_scope_and_systems.sql` | `20260513000008_firm_onboarding_practice_scope_and_systems.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260513_voice_webhook_secret.sql` | `20260513000009_voice_webhook_secret.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260514_intake_firms_channel_asset_ids.sql` | `20260514000001_intake_firms_channel_asset_ids.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260514_screened_leads_actor_role.sql` | `20260514000002_screened_leads_actor_role.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260515_band_d_and_referred_status.sql` | `20260515000001_band_d_and_referred_status.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260515_screened_leads_utm_referrer.sql` | `20260515000002_screened_leads_utm_referrer.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260516_channel_intake_sessions.sql` | `20260516000001_channel_intake_sessions.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260516_intake_firms_meta_access_tokens.sql` | `20260516000002_intake_firms_meta_access_tokens.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260516_unconfirmed_inquiries.sql` | `20260516000003_unconfirmed_inquiries.sql` | No | pre-ledger content; local collision resolved deterministically, no production row exists to match |
| `20260520_firm_onboarding_directory_prep.sql` | `20260520173822_firm_onboarding_directory_prep.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260520_firm_onboarding_notification_tracking.sql` | `20260520192341_firm_onboarding_notification_tracking.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260520_s8p1_client_matters.sql` | `20260522014558_s8p1_client_matters.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260520_s8p1_explainer_articles.sql` | `20260522014657_s8p1_explainer_articles.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260520_s8p1_firm_lawyers_roles.sql` | `20260522014449_s8p1_firm_lawyers_roles.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260520_s8p1_intake_firms_routing.sql` | `20260522014515_s8p1_intake_firms_routing.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260520_s8p1_matter_messages.sql` | `20260522014628_s8p1_matter_messages.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260520_s8p1_notification_batch_cron.sql` | `20260522014741_s8p1_notification_batch_cron.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260520_s8p1_notification_outbox.sql` | `20260522014728_s8p1_notification_outbox.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260521_intake_firms_ghl_location_id.sql` | `20260521232106_intake_firms_ghl_location_id.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260521_intake_firms_voice_api_token.sql` | `20260521225705_intake_firms_voice_api_token.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260526_channel_sessions_screened_lead_link.sql` | `20260526133906_channel_sessions_screened_lead_link.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260526_intake_firms_token_expiry.sql` | `20260526040314_intake_firms_token_expiry.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260526_intake_firms_token_expiry_trigger.sql` | `20260526134701_intake_firms_token_expiry_trigger.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260609_otp_attempt_cap.sql` | `20260610012500_otp_attempt_cap.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260609_processed_channel_messages.sql` | `20260610012439_processed_channel_messages.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260609_screened_leads_notification_state.sql` | `20260610012451_screened_leads_notification_state.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260609_webhook_outbox_action_check_expand.sql` | `20260610012511_webhook_outbox_action_check_expand.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260616_firm_files_links_and_sections.sql` | `20260616190231_firm_files_links_and_sections.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260616_firm_lawyers_disabled.sql` | `20260616195645_firm_lawyers_disabled.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260617_firm_onboarding_customer_base.sql` | `20260617000001_firm_onboarding_customer_base.sql` | No | no ledger row found (Finding 10 class); local collision resolved deterministically, stays local-only in dry-run by design |
| `20260617_firm_onboarding_v2_fields.sql` | `20260618002440_firm_onboarding_v2_fields.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260617_screened_leads_archive.sql` | `20260617183933_screened_leads_archive.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260623_approval_rpc_atomic.sql` | `20260624005320_approval_rpc_atomic.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260623_content_approval.sql` | `20260623214957_content_approval.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260623_content_approval_rls_lockdown.sql` | `20260623225040_content_approval_rls_lockdown.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260623_deliverables_article_meta.sql` | `20260623000004_deliverables_article_meta.sql` | No | no ledger row found (Finding 10 class); local collision resolved deterministically, stays local-only in dry-run by design |
| `20260623_deliverables_review_notified_at.sql` | `20260623000005_deliverables_review_notified_at.sql` | No | no ledger row found (Finding 10 class); local collision resolved deterministically, stays local-only in dry-run by design |
| `20260623_firm_analytics_config.sql` | `20260623000006_firm_analytics_config.sql` | No | no ledger row found (Finding 10 class); local collision resolved deterministically, stays local-only in dry-run by design |
| `20260623_intake_attachments_private.sql` | `20260623235317_intake_attachments_private.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260623_intake_firms_is_demo.sql` | `20260624015747_intake_firms_is_demo.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260623_matter_messages_threading.sql` | `20260623213534_matter_messages_threading.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260624_content_periods.sql` | `20260624173013_content_periods.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260624_content_plan_settings.sql` | `20260624181016_content_plan_settings.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260624_content_studio_foundation.sql` | `20260624000003_content_studio_foundation.sql` | No | no ledger row found (Finding 10 class); local collision resolved deterministically, stays local-only in dry-run by design |
| `20260624_deliverables_kicker.sql` | `20260624000004_deliverables_kicker.sql` | No | no ledger row found (Finding 10 class); local collision resolved deterministically, stays local-only in dry-run by design |
| `20260624_force_rls_three_pii_tables.sql` | `20260624145957_force_rls_three_pii_tables.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260624_notification_outbox_deliverable_events.sql` | `20260624131132_notification_outbox_deliverable_events.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260624_operator_firm_messages_context.sql` | `20260624173258_operator_firm_messages_context.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260624_operator_firm_messaging.sql` | `20260624132001_operator_firm_messaging.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260624_operator_firm_messaging_phase2.sql` | `20260624145310_operator_firm_messaging_phase2.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260625_agency_crm.sql` | `20260625184449_agency_crm.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260625_firm_about_explainer.sql` | `20260625215747_firm_about_explainer.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260625_firm_about_links.sql` | `20260625222355_firm_about_links.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260625_firm_onboarding_v2_phase1_bing_apple_fees.sql` | `20260625000004_firm_onboarding_v2_phase1_bing_apple_fees.sql` | No | no ledger row found (Finding 10 class); local collision resolved deterministically, stays local-only in dry-run by design |
| `20260625_intake_firms_read_scoring_port.sql` | `20260626031528_intake_firms_read_scoring_port.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260625_portal_signin_codes.sql` | `20260625011646_portal_signin_codes.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260625_screened_leads_contact_postal_code.sql` | `20260625000007_screened_leads_contact_postal_code.sql` | No | no ledger row found (Finding 10 class); local collision resolved deterministically, stays local-only in dry-run by design |
| `20260625_screened_leads_scoring_delta.sql` | `20260625224856_screened_leads_scoring_delta.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260626_fix_cron_health_http_correlation.sql` | `20260626000001_fix_cron_health_http_correlation.sql` | No | no ledger row found (Finding 10 class); local collision resolved deterministically, stays local-only in dry-run by design |
| `20260626_matter_promotion_events.sql` | `20260626173506_matter_promotion_events.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260626_screened_leads_axis_reasoning.sql` | `20260626174343_screened_leads_axis_reasoning.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260626_screened_leads_consent.sql` | `20260626203055_screened_leads_consent.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260702_screened_leads_deadline_reminder.sql` | `20260702145505_screened_leads_deadline_reminder.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260702_seo_check_runs.sql` | `20260703185959_seo_check_runs.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260705_booking_adapter_wp6.sql` | `20260705181015_booking_adapter_wp6.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260705_cadence_audit_fixes.sql` | `20260705233907_cadence_audit_fixes.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260705_cadence_wp1_extensions.sql` | `20260705171351_cadence_wp1_extensions.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260705_dashboard_views_wp5.sql` | `20260705180445_dashboard_views_wp5.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260705_ghl_export_wp8.sql` | `20260705182716_ghl_export_wp8.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260705_review_automation_wp4.sql` | `20260705175533_review_automation_wp4.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260706_agency_prospects_dedupe_key.sql` | `20260706040407_agency_prospects_dedupe_key.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260706_cadence_rules_trigger_type_field_change_only.sql` | `20260706040354_cadence_rules_trigger_type_field_change_only.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260706_consent_log_repair_cron.sql` | `20260706045625_consent_log_repair_cron.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260706_screened_leads_gclid.sql` | `20260706041720_screened_leads_gclid.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260706_web_intake_sessions_gclid.sql` | `20260706042154_web_intake_sessions_gclid.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260707_consent_log_repair_antijoin_fn.sql` | `20260706142705_consent_log_repair_antijoin_fn.sql` | Yes | matched to true production ledger version (zero repair needed) |
| `20260707_deliverable_current_version_invariant.sql` | `20260706162509_deliverable_current_version_invariant.sql` | Yes | matched to true production ledger version (zero repair needed) |
