-- seed-demo-leads.sql
--
-- Idempotent reseed of 15 fictional leads + intake_sessions for the
-- Hartwell Law PC [DEMO] firm so /demo/portal/leads and /demo/portal/pipeline
-- have realistic data to render. Re-runnable: existing demo seed rows
-- (source='demo_seed' or status='demo_seed') are removed first.
--
-- Coverage:
--   Band A x 2  (hot, recent, urgent)
--   Band B x 3  (warm)
--   Band C x 4  (qualified, mid-band)
--   Band D x 3  (nurture)
--   Band E x 2  (out of scope)
--   Band X x 1  (Needs Review fallback - KB-23 Lesson 02)
--
-- Stage coverage spans new_lead through client_won + client_lost + needs_review.

DO $$
DECLARE
  firm uuid := '1f5a2391-85d8-45a2-b427-90441e78a93c';
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); s3 uuid := gen_random_uuid();
  s4 uuid := gen_random_uuid(); s5 uuid := gen_random_uuid(); s6 uuid := gen_random_uuid();
  s7 uuid := gen_random_uuid(); s8 uuid := gen_random_uuid(); s9 uuid := gen_random_uuid();
  s10 uuid := gen_random_uuid(); s11 uuid := gen_random_uuid(); s12 uuid := gen_random_uuid();
  s13 uuid := gen_random_uuid(); s14 uuid := gen_random_uuid(); s15 uuid := gen_random_uuid();
BEGIN
  -- Clean prior seed
  DELETE FROM leads WHERE law_firm_id = firm AND source = 'demo_seed';
  DELETE FROM intake_sessions WHERE firm_id = firm AND (scoring->>'_demo_seed') = 'true';

  -- ─── Sessions (15) ───
  INSERT INTO intake_sessions (id, firm_id, channel, status, band, practice_area, practice_sub_type, situation_summary, memo_text, memo_generated_at, contact, scoring, otp_verified, created_at)
  VALUES
  (s1, firm, 'widget', 'complete', 'A', 'Personal Injury', 'pi_mva',
    'A pedestrian struck by a commercial truck on the 401 last Tuesday. Active treatment ongoing, missed three weeks of work. Police report assigns clear fault to the truck driver. Limitations period not engaged.',
    'Client: Sarah Mitchell. Matter: motor vehicle collision, pedestrian-vs-truck on 401 Eastbound near Yonge, last Tuesday. Liability: clear, police report attributes 100% fault to commercial driver. Damages: ongoing physiotherapy, three weeks of lost wages, no return-to-work date. Urgency: high - SABS deadline approaching, statutory notice required within 30 days. Recommend: same-day consult, retain immediately to preserve LTD options and SABS application.',
    now() - interval '2 hours',
    '{"first_name":"Sarah","last_name":"Mitchell","email":"sarah.m@example.ca","phone":"+14165550101"}'::jsonb,
    jsonb_build_object(
      '_demo_seed', true,
      '_reasoning', 'Band A. Recent MVA on the 401 with commercial defendant, clear liability per police report, ongoing treatment with documented work loss. SABS notice window open. Strong fit, high value, urgent.',
      '_score_confidence', 0.92,
      '_meta', jsonb_build_object('prompt_version','2026-04-29.kb23-reasoning','model_id','google/gemini-2.5-flash','first_message_at',(now() - interval '2 hours' - interval '48 seconds')::text,'finalized_at',(now() - interval '2 hours')::text)
    ),
    true, now() - interval '2 hours'),

  (s2, firm, 'widget', 'complete', 'A', 'Employment Law', 'emp_dismissal',
    'Senior Director terminated without cause after 12 years. Salary $185k. Severance offered (8 weeks) but unsigned. Bardal factors point to substantial entitlement.',
    'Client: James Chen, Senior Director, technology firm. Tenure: 12 years. Compensation: $185k base, RSU grants. Termination: without cause, allegedly part of restructuring, package presented but not yet executed. Bardal: age, tenure, executive role, specialised experience all favour client. Recommend: same-day consult before signing window closes; package likely undervalues entitlement by 8-14 months.',
    now() - interval '4 hours',
    '{"first_name":"James","last_name":"Chen","email":"jchen@example.ca","phone":"+14165550102"}'::jsonb,
    jsonb_build_object(
      '_demo_seed', true,
      '_reasoning', 'Band A. Without-cause termination after 12 years, $185k salary, severance offered but unsigned. Bardal factors point to substantial entitlement. Active matter, high value, time-sensitive sign window.',
      '_score_confidence', 0.94,
      '_meta', jsonb_build_object('prompt_version','2026-04-29.kb23-reasoning','model_id','google/gemini-2.5-flash','first_message_at',(now() - interval '4 hours' - interval '52 seconds')::text,'finalized_at',(now() - interval '4 hours')::text)
    ),
    true, now() - interval '4 hours'),

  (s3, firm, 'widget', 'complete', 'B', 'Family Law', 'fam_divorce',
    'Recently separated couple, 8 years married, two children. Property in Toronto, joint mortgage. Both parties want to file. No DV history.',
    'Client: Priya Patel. Matter: divorce, two children (ages 6 and 9), matrimonial home in North York under joint title with mortgage. Both parties cooperative. Custody: jointly desired shared parenting. Property: equalisation calculations needed; small RRSP, joint TFSA. No safety concerns. Recommend: schedule full consult; mediation viable, court application unnecessary at this stage.',
    now() - interval '1 day',
    '{"first_name":"Priya","last_name":"Patel","email":"priya.p@example.ca","phone":"+14165550103"}'::jsonb,
    jsonb_build_object(
      '_demo_seed', true,
      '_reasoning', 'Band B. Cooperative divorce, eight-year marriage, two children, joint property and matrimonial home. Mediation-viable. No urgency events but full retainer scope on equalisation and parenting plan.',
      '_score_confidence', 0.88,
      '_meta', jsonb_build_object('prompt_version','2026-04-29.kb23-reasoning','model_id','google/gemini-2.5-flash','first_message_at',(now() - interval '1 day' - interval '45 seconds')::text,'finalized_at',(now() - interval '1 day')::text)
    ),
    true, now() - interval '1 day'),

  (s4, firm, 'widget', 'complete', 'B', 'Corporate', 'corp_shareholder_dispute',
    '50/50 shareholder dispute. Other partner suspected of $200k personal expenses through company account. Bank statements obtained.',
    'Client: Marcus O''Brien, equal shareholder, two-shareholder Ontario corp. Allegation: business partner used company funds for personal expenses (~$200k over 12 months). Documentation: full bank statements obtained. Remedies: oppression action under OBCA s.248 viable; derivative action also possible. Urgency: ongoing dissipation. Recommend: consult this week, send Section 245 demand for shareholder books prior to litigation.',
    now() - interval '2 days',
    '{"first_name":"Marcus","last_name":"O''Brien","email":"mob@example.ca","phone":"+14165550104"}'::jsonb,
    jsonb_build_object(
      '_demo_seed', true,
      '_reasoning', 'Band B. Equal shareholder, documented misappropriation around $200k, bank statements in hand, business still operating. Multiple remedies (oppression, derivative). Urgency driven by ongoing dissipation.',
      '_score_confidence', 0.86,
      '_meta', jsonb_build_object('prompt_version','2026-04-29.kb23-reasoning','model_id','google/gemini-2.5-flash','first_message_at',(now() - interval '2 days' - interval '63 seconds')::text,'finalized_at',(now() - interval '2 days')::text)
    ),
    true, now() - interval '2 days'),

  (s5, firm, 'widget', 'complete', 'B', 'Civil Litigation', 'civ_defendant',
    'Served with Statement of Claim for $400k breach of contract. 20 days to defend. Has the original written agreement.',
    NULL, NULL,
    '{"first_name":"Jennifer","last_name":"Wong","email":"jwong@example.ca","phone":"+14165550105"}'::jsonb,
    jsonb_build_object(
      '_demo_seed', true,
      '_reasoning', 'Band B. Active litigation, $400k contract dispute, hard 20-day defence deadline, written agreement available. Default judgment risk if missed. Time-sensitive defence retainer.',
      '_score_confidence', 0.85,
      '_meta', jsonb_build_object('prompt_version','2026-04-29.kb23-reasoning','model_id','google/gemini-2.5-flash','first_message_at',(now() - interval '3 days' - interval '41 seconds')::text,'finalized_at',(now() - interval '3 days')::text)
    ),
    true, now() - interval '3 days'),

  (s6, firm, 'widget', 'complete', 'C', 'Real Estate', 'real_purchase',
    'First-time homebuyer, signed APS for resale condo in Liberty Village. Closing in 45 days. Standard purchase, no conditional clauses pending.',
    NULL, NULL,
    '{"first_name":"David","last_name":"Sokolov","email":"dsoko@example.ca","phone":"+14165550106"}'::jsonb,
    jsonb_build_object(
      '_demo_seed', true,
      '_reasoning', 'Band C. Standard residential closing, signed APS, 45-day timeline, no flagged conditions. Routine purchase scope, modest fee, no urgency events.',
      '_score_confidence', 0.83,
      '_meta', jsonb_build_object('prompt_version','2026-04-29.kb23-reasoning','model_id','google/gemini-2.5-flash','first_message_at',(now() - interval '5 days' - interval '38 seconds')::text,'finalized_at',(now() - interval '5 days')::text)
    ),
    true, now() - interval '5 days'),

  (s7, firm, 'widget', 'complete', 'C', 'Immigration', 'imm_spousal',
    'Spousal sponsorship for partner from Brazil. Met in person, married 14 months ago. Standard inland application, no prior refusals.',
    NULL, NULL,
    '{"first_name":"Aisha","last_name":"Rahman","email":"aisha.r@example.ca","phone":"+14165550107"}'::jsonb,
    jsonb_build_object(
      '_demo_seed', true,
      '_reasoning', 'Band C. Standard inland spousal sponsorship, marriage 14 months, no prior refusals or admissibility concerns. Routine IRCC matter, no procedural urgency.',
      '_score_confidence', 0.81,
      '_meta', jsonb_build_object('prompt_version','2026-04-29.kb23-reasoning','model_id','google/gemini-2.5-flash','first_message_at',(now() - interval '6 days' - interval '49 seconds')::text,'finalized_at',(now() - interval '6 days')::text)
    ),
    true, now() - interval '6 days'),

  (s8, firm, 'widget', 'complete', 'C', 'Wills & Estates', 'est_planning',
    'Couple in their 50s with two adult children, primary residence and rental property. Need wills, POA finance, POA personal care.',
    NULL, NULL,
    '{"first_name":"Robert","last_name":"MacDonald","email":"rmacd@example.ca","phone":"+14165550108"}'::jsonb,
    jsonb_build_object(
      '_demo_seed', true,
      '_reasoning', 'Band C. Standard estate planning package: two wills, four POAs, modest rental property to address. No contested issues, no offshore complexity.',
      '_score_confidence', 0.84,
      '_meta', jsonb_build_object('prompt_version','2026-04-29.kb23-reasoning','model_id','google/gemini-2.5-flash','first_message_at',(now() - interval '8 days' - interval '52 seconds')::text,'finalized_at',(now() - interval '8 days')::text)
    ),
    true, now() - interval '8 days'),

  (s9, firm, 'widget', 'complete', 'C', 'Construction', 'const_lien',
    'Subcontractor unpaid $87k on commercial fit-out in Mississauga. 35 days since substantial performance. Lien window open but tightening.',
    NULL, NULL,
    '{"first_name":"Linda","last_name":"Hernandez","email":"lhern@example.ca","phone":"+14165550109"}'::jsonb,
    jsonb_build_object(
      '_demo_seed', true,
      '_reasoning', 'Band C. Construction lien claim of $87k, 35 days post substantial performance, lien window open. Standard construction lien retainer, modest fee, time-aware.',
      '_score_confidence', 0.79,
      '_meta', jsonb_build_object('prompt_version','2026-04-29.kb23-reasoning','model_id','google/gemini-2.5-flash','first_message_at',(now() - interval '10 days' - interval '44 seconds')::text,'finalized_at',(now() - interval '10 days')::text)
    ),
    true, now() - interval '10 days'),

  (s10, firm, 'widget', 'complete', 'D', 'Employment Law', 'emp_harassment',
    'Workplace bullying complaint over six months. Documented some incidents in personal notes. Still employed. No HR complaint filed.',
    NULL, NULL,
    '{"first_name":"Kevin","last_name":"Park","email":"kpark@example.ca","phone":"+14165550110"}'::jsonb,
    jsonb_build_object(
      '_demo_seed', true,
      '_reasoning', 'Band D. Personal harassment claim, still employed, no formal HR complaint, documentation thin. Possible HRTO route but evidence trail needs building before any actionable claim.',
      '_score_confidence', 0.72,
      '_meta', jsonb_build_object('prompt_version','2026-04-29.kb23-reasoning','model_id','google/gemini-2.5-flash','first_message_at',(now() - interval '12 days' - interval '57 seconds')::text,'finalized_at',(now() - interval '12 days')::text)
    ),
    true, now() - interval '12 days'),

  (s11, firm, 'widget', 'complete', 'D', 'Personal Injury', 'pi_slip_fall',
    'Slip and fall on commercial property eight months ago. Bruising, no medical visit, no incident report filed.',
    NULL, NULL,
    '{"first_name":"Emma","last_name":"Williams","email":"ewilliams@example.ca","phone":"+14165550111"}'::jsonb,
    jsonb_build_object(
      '_demo_seed', true,
      '_reasoning', 'Band D. Slip and fall with no medical record, no incident report, eight months elapsed. Documentation thin and damages unquantified. Limitations period still open but evidentiary hurdle is high.',
      '_score_confidence', 0.7,
      '_meta', jsonb_build_object('prompt_version','2026-04-29.kb23-reasoning','model_id','google/gemini-2.5-flash','first_message_at',(now() - interval '14 days' - interval '46 seconds')::text,'finalized_at',(now() - interval '14 days')::text)
    ),
    false, now() - interval '14 days'),

  (s12, firm, 'widget', 'complete', 'D', 'Tax Law', 'tax_audit',
    'CRA audit notice received for 2022 tax year. Self-employed contractor. No representative engaged yet.',
    NULL, NULL,
    '{"first_name":"Hassan","last_name":"Karimi","email":"hkarimi@example.ca","phone":"+14165550112"}'::jsonb,
    jsonb_build_object(
      '_demo_seed', true,
      '_reasoning', 'Band D. CRA audit on a single tax year, self-employed contractor, modest reassessment risk. Routine objection scope, fee economics tight unless reassessment is large.',
      '_score_confidence', 0.74,
      '_meta', jsonb_build_object('prompt_version','2026-04-29.kb23-reasoning','model_id','google/gemini-2.5-flash','first_message_at',(now() - interval '16 days' - interval '51 seconds')::text,'finalized_at',(now() - interval '16 days')::text)
    ),
    true, now() - interval '16 days'),

  (s13, firm, 'widget', 'complete', 'E', 'Civil Litigation', 'civ_small_claims',
    'Friend owes $1200 from a private loan two years ago. No written agreement. Small Claims jurisdiction.',
    NULL, NULL,
    '{"first_name":"Tyler","last_name":"Brooks","email":"tbrooks@example.ca","phone":"+14165550113"}'::jsonb,
    jsonb_build_object(
      '_demo_seed', true,
      '_reasoning', 'Band E. Quantum below Small Claims fee threshold, no written agreement, near limitations. Self-help small claims filing more economical than retained counsel.',
      '_score_confidence', 0.78,
      '_meta', jsonb_build_object('prompt_version','2026-04-29.kb23-reasoning','model_id','google/gemini-2.5-flash','first_message_at',(now() - interval '18 days' - interval '36 seconds')::text,'finalized_at',(now() - interval '18 days')::text)
    ),
    false, now() - interval '18 days'),

  (s14, firm, 'widget', 'complete', 'E', 'Out of Scope', NULL,
    'US-based plaintiff inquiring about Ontario contract dispute. No Ontario nexus beyond opposing party residence.',
    NULL, NULL,
    '{"first_name":"Sophia","last_name":"Kowalski","email":"skowalski@example.ca","phone":"+14165550114"}'::jsonb,
    jsonb_build_object(
      '_demo_seed', true,
      '_reasoning', 'Band E. Plaintiff resides in Michigan, contract performed primarily in the United States. Ontario forum selection unlikely to favour client; firm''s service area is GTA.',
      '_score_confidence', 0.82,
      '_meta', jsonb_build_object('prompt_version','2026-04-29.kb23-reasoning','model_id','google/gemini-2.5-flash','first_message_at',(now() - interval '21 days' - interval '47 seconds')::text,'finalized_at',(now() - interval '21 days')::text)
    ),
    false, now() - interval '21 days'),

  (s15, firm, 'widget', 'in_progress', 'X', NULL, NULL,
    NULL, NULL, NULL,
    '{"first_name":"Ryan","last_name":"Patel","email":"rpatel@example.ca","phone":"+14165550115"}'::jsonb,
    jsonb_build_object(
      '_demo_seed', true,
      '_reasoning', 'Routed to Needs Review: Model confidence 0.42 below 0.60 floor.',
      '_score_confidence', 0.42,
      '_band_x_reason', 'low_confidence',
      '_meta', jsonb_build_object('prompt_version','2026-04-29.kb23-reasoning','model_id','google/gemini-2.5-flash','first_message_at',(now() - interval '6 hours' - interval '32 seconds')::text,'finalized_at',(now() - interval '6 hours')::text)
    ),
    false, now() - interval '6 hours');

  -- ─── Leads (15) ───
  INSERT INTO leads (
    name, email, phone, case_type, description, stage, band, priority_band,
    fit_score, value_score, geo_score, contactability_score, legitimacy_score,
    complexity_score, urgency_score, strategic_score, fee_score,
    cpi_score, priority_index, estimated_value, urgency, source, location, city,
    intake_session_id, law_firm_id, first_contact_at, stage_changed_at, created_at
  ) VALUES
  ('Sarah Mitchell','sarah.m@example.ca','+14165550101','Personal Injury',
    'Pedestrian struck by commercial truck on the 401 last Tuesday. Active treatment, missed three weeks of work. Police report assigns clear fault.',
    'consultation_scheduled','A','A',
    28, 60, 10, 10, 8, 22, 18, 10, 10, 88, 88, 280000,
    'this_week','demo_seed','Toronto','Toronto', s1, firm,
    now() - interval '1 hour 30 minutes', now() - interval '45 minutes', now() - interval '2 hours'),

  ('James Chen','jchen@example.ca','+14165550102','Employment Law',
    'Senior Director terminated without cause after 12 years. $185k salary, severance offered but unsigned.',
    'consultation_scheduled','A','A',
    27, 58, 10, 10, 7, 22, 16, 10, 10, 85, 85, 425000,
    'this_week','demo_seed','Toronto','Toronto', s2, firm,
    now() - interval '3 hours', now() - interval '2 hours', now() - interval '4 hours'),

  ('Priya Patel','priya.p@example.ca','+14165550103','Family Law',
    'Recently separated, eight-year marriage, two children, matrimonial home in North York with joint mortgage.',
    'consultation_held','B','B',
    26, 45, 10, 10, 6, 18, 8, 9, 10, 71, 71, 38000,
    '30_days','demo_seed','North York','North York', s3, firm,
    now() - interval '20 hours', now() - interval '6 hours', now() - interval '1 day'),

  ('Marcus O''Brien','mob@example.ca','+14165550104','Corporate',
    '50/50 shareholder dispute. Partner used company funds for personal expenses (~$200k). Bank statements obtained.',
    'qualified','B','B',
    25, 44, 10, 9, 6, 19, 10, 8, 7, 69, 69, 220000,
    '30_days','demo_seed','Toronto','Toronto', s4, firm,
    now() - interval '36 hours', now() - interval '20 hours', now() - interval '2 days'),

  ('Jennifer Wong','jwong@example.ca','+14165550105','Civil Litigation',
    'Served with Statement of Claim for $400k breach of contract. 20 days to defend.',
    'qualified','B','B',
    24, 43, 10, 9, 7, 17, 12, 7, 7, 67, 67, 95000,
    'this_week','demo_seed','Toronto','Toronto', s5, firm,
    now() - interval '2 days 15 hours', now() - interval '1 day 22 hours', now() - interval '3 days'),

  ('David Sokolov','dsoko@example.ca','+14165550106','Real Estate',
    'First-time homebuyer, signed APS for resale condo in Liberty Village. Closing in 45 days.',
    'proposal_sent','C','C',
    22, 32, 10, 9, 8, 12, 6, 6, 8, 54, 54, 4200,
    '60_days','demo_seed','Toronto','Toronto', s6, firm,
    now() - interval '4 days 18 hours', now() - interval '2 days', now() - interval '5 days'),

  ('Aisha Rahman','aisha.r@example.ca','+14165550107','Immigration',
    'Spousal sponsorship for partner from Brazil. Marriage 14 months. Standard inland application.',
    'qualified','C','C',
    22, 30, 9, 9, 7, 13, 4, 6, 7, 52, 52, 6500,
    '90_days','demo_seed','Toronto','Toronto', s7, firm,
    now() - interval '5 days 20 hours', now() - interval '4 days', now() - interval '6 days'),

  ('Robert MacDonald','rmacd@example.ca','+14165550108','Wills & Estates',
    'Couple, two adult children, primary residence and rental property. Wills + POAs needed.',
    'contacted','C','C',
    21, 28, 10, 8, 7, 11, 4, 5, 8, 49, 49, 3800,
    '60_days','demo_seed','Etobicoke','Etobicoke', s8, firm,
    now() - interval '7 days 12 hours', now() - interval '6 days', now() - interval '8 days'),

  ('Linda Hernandez','lhern@example.ca','+14165550109','Construction',
    'Subcontractor unpaid $87k on commercial fit-out in Mississauga. 35 days post substantial performance.',
    'contacted','C','C',
    21, 27, 9, 8, 7, 12, 6, 5, 4, 48, 48, 87000,
    '30_days','demo_seed','Mississauga','Mississauga', s9, firm,
    now() - interval '9 days 14 hours', now() - interval '7 days', now() - interval '10 days'),

  ('Kevin Park','kpark@example.ca','+14165550110','Employment Law',
    'Workplace bullying complaint over six months. Documented in personal notes. Still employed.',
    'contacted','D','D',
    16, 18, 8, 6, 5, 7, 4, 4, 3, 34, 34, 12000,
    'exploring','demo_seed','Scarborough','Scarborough', s10, firm,
    now() - interval '11 days', now() - interval '10 days', now() - interval '12 days'),

  ('Emma Williams','ewilliams@example.ca','+14165550111','Personal Injury',
    'Slip and fall on commercial property eight months ago. Bruising, no medical visit, no incident report.',
    'new_lead','D','D',
    16, 16, 8, 6, 5, 6, 2, 4, 4, 32, 32, 8500,
    'exploring','demo_seed','Toronto','Toronto', s11, firm,
    NULL, now() - interval '14 days', now() - interval '14 days'),

  ('Hassan Karimi','hkarimi@example.ca','+14165550112','Tax Law',
    'CRA audit notice for 2022 tax year. Self-employed contractor.',
    'new_lead','D','D',
    18, 14, 9, 7, 6, 5, 4, 3, 2, 32, 32, 7200,
    '30_days','demo_seed','Toronto','Toronto', s12, firm,
    NULL, now() - interval '16 days', now() - interval '16 days'),

  ('Tyler Brooks','tbrooks@example.ca','+14165550113','Civil Litigation',
    'Friend owes $1200 from a private loan two years ago. No written agreement.',
    'client_lost','E','E',
    12, 6, 7, 5, 3, 2, 1, 1, 2, 18, 18, 1200,
    'exploring','demo_seed','Toronto','Toronto', s13, firm,
    now() - interval '17 days', now() - interval '17 days', now() - interval '18 days'),

  ('Sophia Kowalski','skowalski@example.ca','+14165550114','Civil Litigation',
    'US-based plaintiff inquiring about Ontario contract dispute. No Ontario nexus.',
    'client_lost','E','E',
    8, 4, 2, 4, 4, 2, 0, 1, 1, 12, 12, 0,
    'exploring','demo_seed','Detroit','Detroit', s14, firm,
    now() - interval '20 days', now() - interval '20 days', now() - interval '21 days'),

  ('Ryan Patel','rpatel@example.ca','+14165550115','Pending Triage',
    'asdf asdf 12345 partial response. Engine flagged for human review.',
    'needs_review','X','X',
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    NULL,'demo_seed','Toronto','Toronto', s15, firm,
    NULL, now() - interval '6 hours', now() - interval '6 hours');

  -- One Band B retained for the win column on the pipeline view
  UPDATE leads SET stage = 'client_won', stage_changed_at = now() - interval '8 hours'
  WHERE intake_session_id = s2;
END $$;

SELECT 'seeded' AS status, count(*) AS leads FROM leads WHERE law_firm_id = '1f5a2391-85d8-45a2-b427-90441e78a93c' AND source = 'demo_seed';
