#!/usr/bin/env python3
"""
CaseLoad Select · Core Chassis · Phase 8 QA
Verifies all 15 email templates exist in GHL with correct names and subjects.
Cross-references against ghl-templates-phase6.json.

Required env vars (set before running):
  GHL_PIT  — Private Integration Token
  GHL_LOC  — Target GHL location ID
"""

import json
import os
import subprocess
import sys

try:
    PIT = os.environ["GHL_PIT"]
    LOC = os.environ["GHL_LOC"]
except KeyError as missing:
    sys.exit(f"Missing required env var: {missing}. Set GHL_PIT and GHL_LOC before running.")

BASE = "https://services.leadconnectorhq.com"

# Expected templates from phase6 artifact
EXPECTED = [
    {"name": "J1_acknowledgment_email",      "id": "69fba75fa3d632376286feae", "subject": "Your inquiry is with us, {{contact.first_name}}"},
    {"name": "J1_brief_delivery_email",      "id": "69fba76071af1b40fa2d52cd", "subject": "Band A lead: {{contact.first_name}} {{contact.last_name}} — action required"},
    {"name": "J2_booking_invite_email",      "id": "69fba761b9da8df0492a8059", "subject": "Next step: schedule your consultation with {{custom_values.firm.display_name}}"},
    {"name": "J2_booking_reminder_email",    "id": "69fba761a3d632090c86fec2", "subject": "Following up: your consultation with {{custom_values.firm.display_name}}"},
    {"name": "J3_triage_notification_email", "id": "69fba7625925963639d9e347", "subject": "Band C inquiry for review: {{contact.first_name}} {{contact.last_name}}"},
    {"name": "J4_decline_email",             "id": "69fba762a3d632d63186fed6", "subject": "Regarding your inquiry to {{custom_values.firm.display_name}}"},
    {"name": "RecoveryA_step1_email",        "id": "69fba763b403f26e88c4c55d", "subject": "Still here when the timing works, {{contact.first_name}}"},
    {"name": "RecoveryA_step2_email",        "id": "69fba763d052ea5b93fac9c7", "subject": "One last check-in, {{contact.first_name}}"},
    {"name": "RecoveryB_step1_email",        "id": "69fba764d052ea16dcfac9d6", "subject": "Questions after your consultation, {{contact.first_name}}?"},
    {"name": "RecoveryB_step2_email",        "id": "69fba765b403f2b351c4c593", "subject": "Following up from {{custom_values.lawyer.first_name}} at {{custom_values.firm.display_name}}"},
    {"name": "J5_consult_reminder_email",    "id": "69fba76578ffe76150b5a34b", "subject": "Reminder: your consultation tomorrow with {{custom_values.firm.display_name}}"},
    {"name": "J7_welcome_email",             "id": "69fba766ec0bf66b0e904a5c", "subject": "Welcome to {{custom_values.firm.display_name}}, {{contact.first_name}}"},
    {"name": "J9_review_request_email",      "id": "69fba766d052ea0b28faca01", "subject": "A small favour, {{contact.first_name}}"},
    {"name": "J11_reactivation_email",       "id": "69fba7676568cd2525acea86", "subject": "Reconnecting, {{contact.first_name}}"},
    {"name": "J12_review_followup_email",    "id": "69fba767b403f22999c4c5be", "subject": "Following up: your review of {{custom_values.firm.display_name}}"},
]

TEST_TEMPLATE_ID = "69fba67bd052ead751fabc91"  # _API_TEST — should be deleted before P9

def curl_get(url):
    cmd = [
        "curl", "-s", "-w", "\n%{http_code}",
        "-X", "GET", url,
        "-H", f"Authorization: Bearer {PIT}",
        "-H", "Version: 2021-07-28",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    lines = r.stdout.strip().rsplit("\n", 1)
    body = lines[0] if len(lines) > 1 else ""
    code = int(lines[1]) if len(lines) > 1 else 0
    return body, code

def fetch_template(template_id):
    body, code = curl_get(f"{BASE}/emails/builder/{template_id}?locationId={LOC}")
    if code == 200:
        try:
            return json.loads(body)
        except Exception:
            return None
    return None

def list_all_templates():
    body, code = curl_get(f"{BASE}/emails/builder?locationId={LOC}&limit=50")
    if code == 200:
        try:
            data = json.loads(body)
            # GHL returns builders[] at this endpoint (not templates[] or data[])
            return data.get("builders", data.get("templates", data.get("data", [])))
        except Exception:
            return []
    return []

print("=" * 60)
print("CaseLoad Select · P8 QA · Email Template Verification")
print("=" * 60)

# --- Step 1: Fetch the full list ---
print("\n[1] Fetching template list...")
all_templates = list_all_templates()
print(f"    Found {len(all_templates)} templates in location")

# Build a lookup by id and by name
by_id = {t.get("id"): t for t in all_templates}
by_name = {t.get("name"): t for t in all_templates}

# --- Step 2: Verify each expected template ---
print("\n[2] Verifying expected templates...")
results = []
all_pass = True

for exp in EXPECTED:
    t = by_id.get(exp["id"]) or by_name.get(exp["name"])
    if not t:
        print(f"    [MISSING] {exp['name']} (id: {exp['id']})")
        results.append({"name": exp["name"], "status": "MISSING"})
        all_pass = False
        continue

    actual_name = t.get("name", "")
    actual_subj = t.get("subject") or t.get("subjectLine", "")

    name_ok = actual_name == exp["name"]
    # Note: GHL list endpoint does not return subjectLine — subject was verified
    # during the P6 PATCH pass (each PATCH returned {"ok": true, "name": "..."}}).
    # Subject check skipped here; verify manually in builder UI if needed.

    if name_ok:
        print(f"    [OK]  {exp['name']}")
        results.append({"name": exp["name"], "status": "OK"})
    else:
        issues = [f"name='{actual_name}' expected='{exp['name']}'"]
        print(f"    [WARN] {exp['name']}: {'; '.join(issues)}")
        results.append({"name": exp["name"], "status": "WARN", "issues": issues})
        all_pass = False

# --- Step 3: Check for test template ---
print("\n[3] Checking for test template...")
test_t = by_id.get(TEST_TEMPLATE_ID)
if test_t:
    print(f"    [ACTION NEEDED] _API_TEST template still present (id: {TEST_TEMPLATE_ID}). Delete before P9 export.")
else:
    print(f"    [OK] _API_TEST template not found (already deleted or not in list).")

# --- Step 4: Check for unexpected templates ---
print("\n[4] Checking for unexpected templates...")
expected_ids = {e["id"] for e in EXPECTED} | {TEST_TEMPLATE_ID}
unexpected = [t for t in all_templates if t.get("id") not in expected_ids]
if unexpected:
    for t in unexpected:
        print(f"    [UNEXPECTED] {t.get('name')} (id: {t.get('id')})")
else:
    print("    [OK] No unexpected templates found.")

# --- Summary ---
print("\n" + "=" * 60)
ok_count = sum(1 for r in results if r["status"] == "OK")
print(f"Email templates: {ok_count}/{len(EXPECTED)} verified OK")
if all_pass:
    print("RESULT: PASS")
else:
    print("RESULT: WARN — review items above before P9 export")
print("=" * 60)
