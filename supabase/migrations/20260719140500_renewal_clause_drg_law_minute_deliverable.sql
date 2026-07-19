-- The Renewal Clause: add the 14th deliverable, The DRG Law Minute edition
-- No. 01. This is the first period built under the Content Studio v5.2
-- model (up to 14 artifacts, 4 channels, Tuesday-Wednesday window). The
-- existing 13 deliverables in this period (backfilled by
-- 20260715193236_20260715122000_renewal_clause_publication_metadata.sql)
-- are untouched by this file.
--
-- Depends on 20260719140000_content_deliverables_email_role_widen.sql
-- (deliverable_role 'email_newsletter', publication_destination 'email').
--
-- Status is 'draft', not 'in_review': this has not been submitted for
-- review yet, and no approval is fabricated here. requires_legal_approval
-- is explicitly set true (a per-row override, not the profile default)
-- because this is the first-ever edition of a new format touching CASL
-- consent and LSO Rule 4.2-1 at once; it gets an explicit legal read
-- regardless of what the default profile for 'email_newsletter' becomes
-- later. publication_path is left NULL: this has not been sent and has no
-- live location. The content_placements row's scheduled_publish_date is
-- also NULL for the same reason: real readiness prerequisites (consent
-- audit, sender identity, unsubscribe mechanism, live-link verification)
-- are unmet as of 2026-07-19 -- see FOLLOWUPS.md rows dated 2026-07-19 for
-- DRGLaw_ContentStrategy_v4.2.html (Toronto mailing address is a
-- placeholder; consent audit not yet run; send platform/reply-to
-- undecided). Do not flip status/publication_path/scheduled_publish_date
-- to look ready without those three being genuinely resolved.
--
-- NOT APPLIED. See the freeze note in the companion migration
-- (20260719140000_content_deliverables_email_role_widen.sql). Prepared for
-- review; do not `supabase db push` before human/data-engineer approval.

do $$
declare
  v_firm_id      uuid := 'eec1d25e-a047-4827-8e4a-6eb96becca2b'; -- DRG Law
  v_period_id    uuid := '7ca11880-42a9-4bab-940a-baf2966b9f7e'; -- The Renewal Clause
  v_deliverable  uuid := gen_random_uuid();
  v_version      uuid := gen_random_uuid();
  v_body         text := $body$
<p>Damaris here.</p>
<p>A tenant signs a five-year commercial lease. Buried in the renewal section is a clause that reads as routine: the landlord&rsquo;s consent to the renewal &ldquo;shall not be unreasonably withheld.&rdquo; Reasonable sounds safe. It is not defined anywhere in the lease.</p>
<p>That gap is where most renewal disputes start. A landlord can hold up a renewal on grounds that feel arbitrary to the tenant and defensible to the landlord, and &ldquo;reasonable&rdquo; becomes whatever a court eventually decides, months after the business needed an answer.</p>
<p>The fix sits earlier than the dispute. A renewal clause can name the specific conditions a landlord may rely on to withhold consent, and set a deadline for the decision. That turns a vague standard into a checklist both sides can point to before year three arrives, not after.</p>
<p>This week&rsquo;s Counsel Note walks through the clause in full. The companion piece looks at the good-standing language landlords often attach to it, and the checklist lays out the questions worth asking before you sign.</p>
<p><a href="{{counsel_note_url}}">Read the Counsel Note</a> &middot; <a href="{{clause_margin_url}}">The good-standing clause</a> &middot; <a href="{{checklist_url}}">Get the checklist</a></p>
<p>Damaris</p>
<p>P.S. Questions about your own lease? Reply, I read these.</p>
<hr />
<p><small>Damaris Guimaraes &middot; DRG Law. This note shares general legal information, not legal advice about your specific matter. Reply-to: info@drglaw.ca (replies are triaged by the team, not a guarantee Damaris personally answers each one). Mailing address: {{PLACEHOLDER -- DRG Law's canonical Toronto mailing address, not yet confirmed, see FOLLOWUPS.md 2026-07-19}}. Unsubscribe: {{PLACEHOLDER -- pending send-platform decision, see FOLLOWUPS.md 2026-07-19}}. Sent only to recipients with a documented active consent basis, no recorded unsubscribe, and a valid applicable sending basis under Canada's Anti-Spam Legislation, verified through a consent audit before send (not yet run as of 2026-07-19).</small></p>
$body$;
begin
  insert into public.content_deliverables (
    id, firm_id, title, description, content_kind, status,
    created_by_role, period_id, format, kicker, locale,
    deliverable_role, publication_destination, publication_path,
    requires_legal_approval
  ) values (
    v_deliverable, v_firm_id,
    'The renewal clause is not a formality',
    'The DRG Law Minute, edition No. 01. Weekly relationship email, English only, sent Wednesday only after the Tuesday cluster''s linked pages verify live. Subject: "The renewal clause is not a formality". Preview: "A five-year lease, one clause, and the difference it makes at year three." Not ready to send: consent audit not run, mailing address placeholder, send platform/reply-to undecided (FOLLOWUPS.md, 2026-07-19).',
    'text', 'draft',
    'operator', v_period_id, 'DRG Law Minute', 'Minute No. 01', 'en-CA',
    'email_newsletter', 'email', null,
    true
  );

  insert into public.deliverable_versions (
    id, deliverable_id, firm_id, version_number, body_html, note, created_by_role
  ) values (
    v_version, v_deliverable, v_firm_id, 1, v_body,
    'First draft, edition No. 01. Links are placeholders pending live-link verification; footer mailing address and unsubscribe mechanism are placeholders pending Adriano''s confirmation (FOLLOWUPS.md, 2026-07-19).',
    'operator'
  );

  update public.content_deliverables
     set current_version_id = v_version
   where id = v_deliverable;

  insert into public.content_placements (
    firm_id, period_id, deliverable_id, destination, locale,
    required_artifact_type, state, created_by_role
  ) values (
    v_firm_id, v_period_id, v_deliverable, 'email_delivery', 'en-CA',
    'email', 'planned', 'operator'
  );
end $$;
