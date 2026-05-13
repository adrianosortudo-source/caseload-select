#!/usr/bin/env python3
"""
CaseLoad Select · Core Chassis · Phase 6
Creates all email templates in GHL via REST API.
Run once. Templates are idempotent by name at the GHL level.

Required env vars (set before running):
  GHL_PIT  — Private Integration Token with scopes:
             emails/builder.write, emails/builder.readonly
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

# ── Shared layout fragments ────────────────────────────────────────────────

HEADER = """<div style="background:#1E2F58;padding:24px 32px;">
  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:18px;color:#FFFFFF;letter-spacing:0.5px;">{{custom_values.firm.display_name}}</p>
</div>"""

FOOTER = """<div style="background:#F4F3EF;padding:20px 32px;border-top:1px solid #E4E2DB;">
  <p style="margin:0 0 10px;font-size:11px;color:#5C5850;line-height:1.6;">{{custom_values.compliance.lso_disclaimer}}</p>
  <p style="margin:0 0 6px;font-size:11px;color:#5C5850;">{{custom_values.firm.legal_name}}<br>{{custom_values.firm.address}}</p>
  <p style="margin:0;font-size:11px;color:#9B9690;"><a href="{{contact.unsubscribe_url}}" style="color:#9B9690;text-decoration:underline;">Unsubscribe</a></p>
</div>"""

def wrap(body_html: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <style>
    body {{margin:0;padding:0;background:#F4F3EF;-webkit-text-size-adjust:100%;}}
    a {{color:#1E2F58;}}
    @media only screen and (max-width:620px) {{
      .outer {{width:100%!important;padding:0 12px!important;}}
    }}
  </style>
</head>
<body style="margin:0;padding:20px 0;background:#F4F3EF;font-family:Arial,Helvetica,sans-serif;">
  <table class="outer" width="600" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;background:#FFFFFF;border:1px solid #E4E2DB;">
    <tr><td>
      {HEADER}
      <div style="padding:32px 32px 24px;">
{body_html}
      </div>
      {FOOTER}
    </td></tr>
  </table>
</body>
</html>"""

# ── Template definitions ───────────────────────────────────────────────────

TEMPLATES = [

  # ── J1 · Lead acknowledgment (all bands) ─────────────────────────────
  {
    "name": "J1_acknowledgment_email",
    "subject": "Your inquiry is with us, {{contact.first_name}}",
    "html": wrap("""
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">Hi {{contact.first_name}},</p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          Thank you for reaching out to {{custom_values.firm.display_name}}. Your inquiry has been received and is under review.
        </p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          A member of our team will follow up with you shortly. If your matter is time-sensitive, you are welcome to call us directly at {{custom_values.firm.phone}}.
        </p>
        <p style="margin:0 0 24px;font-size:15px;color:#0D1520;line-height:1.6;">
          We appreciate your patience.
        </p>
        <p style="margin:0;font-size:15px;color:#0D1520;line-height:1.6;">
          {{custom_values.lawyer.first_name}} {{custom_values.lawyer.last_name}}<br>
          <span style="color:#5C5850;font-size:13px;">{{custom_values.lawyer.title}}, {{custom_values.firm.display_name}}</span>
        </p>
"""),
  },

  # ── J1 · Band A brief delivery (to lawyer) ───────────────────────────
  {
    "name": "J1_brief_delivery_email",
    "subject": "Band A lead: {{contact.first_name}} {{contact.last_name}} — action required",
    "html": wrap("""
        <div style="background:#1E2F58;border-radius:3px;padding:12px 18px;margin-bottom:24px;display:inline-block;">
          <p style="margin:0;font-size:11px;font-family:Arial,Helvetica,sans-serif;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#C4B49A;">Band A — Priority Intake</p>
        </div>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">A high-priority inquiry has arrived and is waiting for your review.</p>

        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;border:1px solid #E4E2DB;border-radius:3px;">
          <tr style="background:#F4F3EF;">
            <td style="padding:10px 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#5C5850;border-bottom:1px solid #E4E2DB;" colspan="2">Lead Summary</td>
          </tr>
          <tr>
            <td style="padding:10px 16px;font-size:13px;color:#5C5850;border-bottom:1px solid #E4E2DB;width:140px;">Name</td>
            <td style="padding:10px 16px;font-size:13px;color:#0D1520;border-bottom:1px solid #E4E2DB;font-weight:600;">{{contact.first_name}} {{contact.last_name}}</td>
          </tr>
          <tr>
            <td style="padding:10px 16px;font-size:13px;color:#5C5850;border-bottom:1px solid #E4E2DB;">Phone</td>
            <td style="padding:10px 16px;font-size:13px;color:#0D1520;border-bottom:1px solid #E4E2DB;"><a href="tel:{{contact.phone}}" style="color:#1E2F58;">{{contact.phone}}</a></td>
          </tr>
          <tr>
            <td style="padding:10px 16px;font-size:13px;color:#5C5850;border-bottom:1px solid #E4E2DB;">Email</td>
            <td style="padding:10px 16px;font-size:13px;color:#0D1520;border-bottom:1px solid #E4E2DB;"><a href="mailto:{{contact.email}}" style="color:#1E2F58;">{{contact.email}}</a></td>
          </tr>
          <tr>
            <td style="padding:10px 16px;font-size:13px;color:#5C5850;border-bottom:1px solid #E4E2DB;">Practice Area</td>
            <td style="padding:10px 16px;font-size:13px;color:#0D1520;border-bottom:1px solid #E4E2DB;">{{contact.practice_area}}</td>
          </tr>
          <tr>
            <td style="padding:10px 16px;font-size:13px;color:#5C5850;border-bottom:1px solid #E4E2DB;">CPI Score</td>
            <td style="padding:10px 16px;font-size:13px;color:#0D1520;border-bottom:1px solid #E4E2DB;font-weight:600;">{{contact.cpi_score}} / 100</td>
          </tr>
          <tr>
            <td style="padding:10px 16px;font-size:13px;color:#5C5850;">Matter</td>
            <td style="padding:10px 16px;font-size:13px;color:#0D1520;">{{contact.matter_summary}}</td>
          </tr>
        </table>

        <p style="margin:0 0 20px;font-size:14px;color:#0D1520;line-height:1.6;">
          Open the triage portal to review the full brief and record your Take or Pass decision within 48 hours.
        </p>

        <a href="{{custom_values.portal.lawyer_url}}" style="display:inline-block;background:#1E2F58;color:#FFFFFF;font-size:13px;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:3px;letter-spacing:0.04em;">Open Triage Portal</a>
"""),
  },

  # ── J2 · Booking invite (Band B, to lead) ────────────────────────────
  {
    "name": "J2_booking_invite_email",
    "subject": "Next step: schedule your consultation with {{custom_values.firm.display_name}}",
    "html": wrap("""
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">Hi {{contact.first_name}},</p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          Thank you for your inquiry. Based on what you shared, we would like to schedule a consultation to discuss your matter in more detail.
        </p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          Use the link below to choose a time that works for you. The consultation is 30 minutes and can be held by phone or video.
        </p>

        <div style="margin:28px 0;">
          <a href="{{custom_values.calendar.consult_url}}" style="display:inline-block;background:#1E2F58;color:#FFFFFF;font-size:13px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:3px;letter-spacing:0.04em;">Book Your Consultation</a>
        </div>

        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          If you have questions before booking, you can reach us at <a href="mailto:{{custom_values.firm.email}}" style="color:#1E2F58;">{{custom_values.firm.email}}</a> or {{custom_values.firm.phone}}.
        </p>
        <p style="margin:0;font-size:15px;color:#0D1520;line-height:1.6;">
          {{custom_values.lawyer.first_name}} {{custom_values.lawyer.last_name}}<br>
          <span style="color:#5C5850;font-size:13px;">{{custom_values.lawyer.title}}, {{custom_values.firm.display_name}}</span>
        </p>
"""),
  },

  # ── J2 · Booking reminder (+48h, to lead) ────────────────────────────
  {
    "name": "J2_booking_reminder_email",
    "subject": "Following up: your consultation with {{custom_values.firm.display_name}}",
    "html": wrap("""
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">Hi {{contact.first_name}},</p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          I wanted to follow up on the consultation invitation sent a couple of days ago. If you are still looking for assistance with your matter, we are ready to connect.
        </p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          The booking link is still open. Choose a time below whenever it works for you.
        </p>

        <div style="margin:28px 0;">
          <a href="{{custom_values.calendar.consult_url}}" style="display:inline-block;background:#1E2F58;color:#FFFFFF;font-size:13px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:3px;letter-spacing:0.04em;">Book Your Consultation</a>
        </div>

        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          If your situation has changed or you have questions, reply to this email or call us at {{custom_values.firm.phone}}.
        </p>
        <p style="margin:0;font-size:15px;color:#0D1520;line-height:1.6;">
          {{custom_values.lawyer.first_name}} {{custom_values.lawyer.last_name}}<br>
          <span style="color:#5C5850;font-size:13px;">{{custom_values.firm.display_name}}</span>
        </p>
"""),
  },

  # ── J3 · Band C triage notification (to lawyer) ──────────────────────
  {
    "name": "J3_triage_notification_email",
    "subject": "Band C inquiry for review: {{contact.first_name}} {{contact.last_name}}",
    "html": wrap("""
        <div style="background:#F4F3EF;border-left:3px solid #C4B49A;padding:12px 18px;margin-bottom:24px;">
          <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:#5C5850;">Band C — Lawyer Decision Required</p>
        </div>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          A new inquiry has arrived and requires your Take or Pass decision within 48 hours.
        </p>

        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;border:1px solid #E4E2DB;border-radius:3px;">
          <tr style="background:#F4F3EF;">
            <td style="padding:10px 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#5C5850;border-bottom:1px solid #E4E2DB;" colspan="2">Lead Summary</td>
          </tr>
          <tr>
            <td style="padding:10px 16px;font-size:13px;color:#5C5850;border-bottom:1px solid #E4E2DB;width:140px;">Name</td>
            <td style="padding:10px 16px;font-size:13px;color:#0D1520;border-bottom:1px solid #E4E2DB;font-weight:600;">{{contact.first_name}} {{contact.last_name}}</td>
          </tr>
          <tr>
            <td style="padding:10px 16px;font-size:13px;color:#5C5850;border-bottom:1px solid #E4E2DB;">Practice Area</td>
            <td style="padding:10px 16px;font-size:13px;color:#0D1520;border-bottom:1px solid #E4E2DB;">{{contact.practice_area}}</td>
          </tr>
          <tr>
            <td style="padding:10px 16px;font-size:13px;color:#5C5850;border-bottom:1px solid #E4E2DB;">CPI Score</td>
            <td style="padding:10px 16px;font-size:13px;color:#0D1520;border-bottom:1px solid #E4E2DB;">{{contact.cpi_score}} / 100</td>
          </tr>
          <tr>
            <td style="padding:10px 16px;font-size:13px;color:#5C5850;">Matter</td>
            <td style="padding:10px 16px;font-size:13px;color:#0D1520;">{{contact.matter_summary}}</td>
          </tr>
        </table>

        <p style="margin:0 0 20px;font-size:14px;color:#0D1520;line-height:1.6;">
          If you do not record a decision within 48 hours, the backstop fires and the inquiry is declined automatically.
        </p>

        <a href="{{custom_values.portal.lawyer_url}}" style="display:inline-block;background:#1E2F58;color:#FFFFFF;font-size:13px;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:3px;letter-spacing:0.04em;">Open Triage Portal</a>
"""),
  },

  # ── J4 · Decline with grace (to lead) ────────────────────────────────
  {
    "name": "J4_decline_email",
    "subject": "Regarding your inquiry to {{custom_values.firm.display_name}}",
    "html": wrap("""
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">Hi {{contact.first_name}},</p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          Thank you for contacting {{custom_values.firm.display_name}}. We have reviewed your inquiry carefully.
        </p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          At this time, we are not able to assist with your matter. This does not reflect the strength of your position. It reflects the boundaries of our current capacity and the specific areas we are able to serve well.
        </p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          We encourage you to reach out to another qualified lawyer as soon as possible, particularly if your matter has a time-sensitive element.
        </p>
        <p style="margin:0 0 24px;font-size:15px;color:#0D1520;line-height:1.6;">
          The Law Society of Ontario's referral service (1-800-268-8326) can connect you with a lawyer in your area. Ontario Legal Aid (1-800-668-8258) is another option if you qualify.
        </p>
        <p style="margin:0;font-size:15px;color:#0D1520;line-height:1.6;">
          We wish you the best with your matter.<br><br>
          {{custom_values.lawyer.first_name}} {{custom_values.lawyer.last_name}}<br>
          <span style="color:#5C5850;font-size:13px;">{{custom_values.lawyer.title}}, {{custom_values.firm.display_name}}</span>
        </p>
"""),
  },

  # ── Recovery A · Step 1 (spoke, no book) ─────────────────────────────
  {
    "name": "RecoveryA_step1_email",
    "subject": "Still here when the timing works, {{contact.first_name}}",
    "html": wrap("""
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">Hi {{contact.first_name}},</p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          We spoke recently about your matter and I wanted to check in. If the timing was not right then, that is understandable.
        </p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          If you are ready to move forward or have additional questions, the consultation booking is still open.
        </p>

        <div style="margin:28px 0;">
          <a href="{{custom_values.calendar.consult_url}}" style="display:inline-block;background:#1E2F58;color:#FFFFFF;font-size:13px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:3px;letter-spacing:0.04em;">Book a Consultation</a>
        </div>

        <p style="margin:0;font-size:15px;color:#0D1520;line-height:1.6;">
          {{custom_values.lawyer.first_name}} {{custom_values.lawyer.last_name}}<br>
          <span style="color:#5C5850;font-size:13px;">{{custom_values.firm.display_name}} — {{custom_values.firm.phone}}</span>
        </p>
"""),
  },

  # ── Recovery A · Step 2 (+7d) ─────────────────────────────────────────
  {
    "name": "RecoveryA_step2_email",
    "subject": "One last check-in, {{contact.first_name}}",
    "html": wrap("""
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">Hi {{contact.first_name}},</p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          This is a final follow-up. If your legal matter is still pending and you would like to speak with us, we are available.
        </p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          Simply reply to this email or call {{custom_values.firm.phone}} to connect. We will not send further messages after this one.
        </p>
        <p style="margin:0;font-size:15px;color:#0D1520;line-height:1.6;">
          {{custom_values.lawyer.first_name}} {{custom_values.lawyer.last_name}}<br>
          <span style="color:#5C5850;font-size:13px;">{{custom_values.firm.display_name}}</span>
        </p>
"""),
  },

  # ── Recovery B · Step 1 (consulted, no sign) ─────────────────────────
  {
    "name": "RecoveryB_step1_email",
    "subject": "Questions after your consultation, {{contact.first_name}}?",
    "html": wrap("""
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">Hi {{contact.first_name}},</p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          Thank you for taking the time to meet with us. I wanted to follow up and see if you had any questions about what we discussed.
        </p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          Decisions like this take time, and that is completely normal. If there is anything I can clarify or if you are ready to take the next step, please do not hesitate to reach out.
        </p>
        <p style="margin:0 0 24px;font-size:15px;color:#0D1520;line-height:1.6;">
          Reply to this email or call us directly at {{custom_values.firm.phone}}.
        </p>
        <p style="margin:0;font-size:15px;color:#0D1520;line-height:1.6;">
          {{custom_values.lawyer.first_name}} {{custom_values.lawyer.last_name}}<br>
          <span style="color:#5C5850;font-size:13px;">{{custom_values.lawyer.title}}, {{custom_values.firm.display_name}}</span>
        </p>
"""),
  },

  # ── Recovery B · Step 2 (+7d) ─────────────────────────────────────────
  {
    "name": "RecoveryB_step2_email",
    "subject": "Following up from {{custom_values.lawyer.first_name}} at {{custom_values.firm.display_name}}",
    "html": wrap("""
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">Hi {{contact.first_name}},</p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          I am following up one more time after our recent consultation. If you are still considering your options, I am happy to answer any outstanding questions.
        </p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          If you have decided to proceed with another firm, I wish you the best. No reply is necessary.
        </p>
        <p style="margin:0;font-size:15px;color:#0D1520;line-height:1.6;">
          {{custom_values.lawyer.first_name}} {{custom_values.lawyer.last_name}}<br>
          <span style="color:#5C5850;font-size:13px;">{{custom_values.firm.display_name}} — {{custom_values.firm.phone}}</span>
        </p>
"""),
  },

  # ── J5 · Consult reminder (-24h) ─────────────────────────────────────
  {
    "name": "J5_consult_reminder_email",
    "subject": "Reminder: your consultation tomorrow with {{custom_values.firm.display_name}}",
    "html": wrap("""
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">Hi {{contact.first_name}},</p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          This is a reminder that your consultation with {{custom_values.lawyer.first_name}} {{custom_values.lawyer.last_name}} is scheduled for tomorrow.
        </p>

        <div style="background:#F4F3EF;border:1px solid #E4E2DB;border-radius:3px;padding:16px 20px;margin:20px 0;">
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#5C5850;">What to prepare</p>
          <ul style="margin:0;padding-left:18px;font-size:14px;color:#0D1520;line-height:1.7;">
            <li>A brief summary of your situation (dates, parties involved, what you need)</li>
            <li>Any relevant documents (contracts, correspondence, notices) if you have them</li>
            <li>Your questions for the lawyer</li>
          </ul>
        </div>

        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          If you need to reschedule, please do so at least 24 hours in advance using the link below or by calling us at {{custom_values.firm.phone}}.
        </p>

        <div style="margin:24px 0;">
          <a href="{{custom_values.calendar.consult_url}}" style="display:inline-block;background:#1E2F58;color:#FFFFFF;font-size:13px;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:3px;letter-spacing:0.04em;">Reschedule if Needed</a>
        </div>

        <p style="margin:0;font-size:15px;color:#0D1520;line-height:1.6;">
          We look forward to speaking with you.<br><br>
          {{custom_values.lawyer.first_name}} {{custom_values.lawyer.last_name}}<br>
          <span style="color:#5C5850;font-size:13px;">{{custom_values.firm.display_name}}</span>
        </p>
"""),
  },

  # ── J7 · Welcome (post-retainer) ─────────────────────────────────────
  {
    "name": "J7_welcome_email",
    "subject": "Welcome to {{custom_values.firm.display_name}}, {{contact.first_name}}",
    "html": wrap("""
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">Hi {{contact.first_name}},</p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          Thank you for engaging {{custom_values.firm.display_name}}. We are glad to be working with you.
        </p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          Here is what you can expect from us:
        </p>

        <ul style="margin:0 0 20px;padding-left:18px;font-size:14px;color:#0D1520;line-height:1.8;">
          <li>We will keep you informed at each key stage of your matter.</li>
          <li>You will receive updates by email unless you prefer another method.</li>
          <li>For urgent questions, contact us at <a href="tel:{{custom_values.firm.phone}}" style="color:#1E2F58;">{{custom_values.firm.phone}}</a> or <a href="mailto:{{custom_values.firm.email}}" style="color:#1E2F58;">{{custom_values.firm.email}}</a>.</li>
        </ul>

        <p style="margin:0 0 24px;font-size:15px;color:#0D1520;line-height:1.6;">
          Your client portal is available at {{custom_values.portal.client_url}} for document access and matter status.
        </p>
        <p style="margin:0;font-size:15px;color:#0D1520;line-height:1.6;">
          {{custom_values.lawyer.first_name}} {{custom_values.lawyer.last_name}}<br>
          <span style="color:#5C5850;font-size:13px;">{{custom_values.lawyer.title}}, {{custom_values.firm.display_name}}</span>
        </p>
"""),
  },

  # ── J9 · Review request email (follow-up after SMS) ──────────────────
  {
    "name": "J9_review_request_email",
    "subject": "A small favour, {{contact.first_name}}",
    "html": wrap("""
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">Hi {{contact.first_name}},</p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          It was a pleasure working with you. I hope your matter has resolved well.
        </p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          If you found our service helpful, a Google review would mean a great deal to us. Reviews help other people in similar situations find the right legal help.
        </p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          It takes less than two minutes and your honest feedback is all we ask.
        </p>

        <div style="margin:28px 0;">
          <a href="{{custom_values.firm.website}}" style="display:inline-block;background:#1E2F58;color:#FFFFFF;font-size:13px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:3px;letter-spacing:0.04em;">Leave a Google Review</a>
        </div>

        <p style="margin:0;font-size:15px;color:#0D1520;line-height:1.6;">
          Thank you, {{contact.first_name}}.<br><br>
          {{custom_values.lawyer.first_name}} {{custom_values.lawyer.last_name}}<br>
          <span style="color:#5C5850;font-size:13px;">{{custom_values.firm.display_name}}</span>
        </p>
"""),
  },

  # ── J11 · Long-term hold reactivation ────────────────────────────────
  {
    "name": "J11_reactivation_email",
    "subject": "Reconnecting, {{contact.first_name}}",
    "html": wrap("""
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">Hi {{contact.first_name}},</p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          Some time has passed since we last spoke about your matter. I wanted to check in to see if your situation has changed and whether we might be of assistance now.
        </p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          If the timing is now right, I would be glad to reconnect. A 30-minute consultation is available at your convenience.
        </p>

        <div style="margin:28px 0;">
          <a href="{{custom_values.calendar.consult_url}}" style="display:inline-block;background:#1E2F58;color:#FFFFFF;font-size:13px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:3px;letter-spacing:0.04em;">Book a Consultation</a>
        </div>

        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          If your matter has been resolved or is no longer active, no reply is needed. We wish you the best.
        </p>
        <p style="margin:0;font-size:15px;color:#0D1520;line-height:1.6;">
          {{custom_values.lawyer.first_name}} {{custom_values.lawyer.last_name}}<br>
          <span style="color:#5C5850;font-size:13px;">{{custom_values.firm.display_name}}</span>
        </p>
"""),
  },

  # ── J12 · Review follow-up email (+48h if no review) ─────────────────
  {
    "name": "J12_review_followup_email",
    "subject": "Following up: your review of {{custom_values.firm.display_name}}",
    "html": wrap("""
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">Hi {{contact.first_name}},</p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          I sent a text a couple of days ago asking for a Google review. I appreciate that your time is limited, so I am following up by email in case it is more convenient.
        </p>
        <p style="margin:0 0 16px;font-size:15px;color:#0D1520;line-height:1.6;">
          If you were satisfied with our service, a brief review helps others in similar situations find legal help they can trust.
        </p>

        <div style="margin:28px 0;">
          <a href="{{custom_values.firm.website}}" style="display:inline-block;background:#1E2F58;color:#FFFFFF;font-size:13px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:3px;letter-spacing:0.04em;">Leave a Google Review</a>
        </div>

        <p style="margin:0;font-size:15px;color:#0D1520;line-height:1.6;">
          Thank you for your trust, {{contact.first_name}}.<br><br>
          {{custom_values.lawyer.first_name}} {{custom_values.lawyer.last_name}}<br>
          <span style="color:#5C5850;font-size:13px;">{{custom_values.firm.display_name}}</span>
        </p>
"""),
  },

]

# ── Create templates ───────────────────────────────────────────────────────

def create_template(t: dict) -> dict:
    payload = {
        "locationId": LOC,
        "name": t["name"],
        "type": "html",
        "subject": t.get("subject", ""),
        "html": t["html"],
    }
    payload_str = json.dumps(payload)
    cmd = [
        "curl", "-s", "-w", "\n%{http_code}",
        "-X", "POST", f"{BASE}/emails/builder",
        "-H", f"Authorization: Bearer {PIT}",
        "-H", "Version: 2021-07-28",
        "-H", "Content-Type: application/json",
        "-d", payload_str,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        output = result.stdout.strip()
        parts = output.rsplit("\n", 1)
        body_text = parts[0] if len(parts) == 2 else output
        http_code = int(parts[1]) if len(parts) == 2 else 0
        body = json.loads(body_text)
        if http_code == 200 or body.get("status") == "ok":
            return {"name": t["name"], "status": "ok", "id": body.get("id", "?")}
        return {"name": t["name"], "status": "error", "code": http_code, "body": body_text[:200]}
    except Exception as e:
        return {"name": t["name"], "status": "error", "code": 0, "body": str(e)}

results = []
for tmpl in TEMPLATES:
    r = create_template(tmpl)
    results.append(r)
    status_icon = "OK" if r["status"] == "ok" else "!!"
    if r["status"] == "ok":
        print(f"  [{status_icon}]  {r['name']}  ->  {r['id']}")
    else:
        print(f"  [{status_icon}]  {r['name']}  ->  ERROR {r.get('code')}  {r.get('body','')[:120]}")

print("")
print("-" * 60)
ok = sum(1 for r in results if r["status"] == "ok")
print(f"  {ok}/{len(results)} templates created successfully")
print("-" * 60)
