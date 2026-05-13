"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  token: string;
  firmLabel: string;
}

interface FormState {
  legal_name: string;
  business_number: string;
  business_address: string;
  business_website: string;
  business_email: string;
  authorized_rep_name: string;
  authorized_rep_title: string;
  authorized_rep_email: string;
  authorized_rep_phone: string;
  booking_url: string;
  sms_vertical: string;
  sms_sender_phone_preference: string;
  whatsapp_number_decision: string;
  whatsapp_display_name: string;
  whatsapp_business_verification_doc_note: string;
  verification_doc_storage_path: string | null;
  verification_doc_original_name: string | null;
  verification_doc_size_bytes: number | null;
  verification_doc_mime_type: string | null;
  has_facebook_account: string;
  has_meta_business_manager: string;
  meta_business_manager_url: string;
  will_add_operator_as_admin: string;
  meta_admin_status: string;
  meta_admin_blocker_note: string;
  gbp_admin_status: string;
  gbp_admin_blocker_note: string;
  linkedin_admin_status: string;
  linkedin_admin_blocker_note: string;
  m365_admin_status: string;
  m365_admin_blocker_note: string;
  // Section 1 extensions (operating hours + additional lawyers beyond the
  // authorized rep).
  office_hours: string;
  additional_lawyers: Array<{ name: string; email: string; role: string }>;
  // Section 2: Practice scope. The arrays + free-text "other" capture the
  // condensed-list-plus-free-text input pattern used in the form.
  practice_areas: string[];
  practice_areas_other: string;
  service_area: string;
  service_area_other: string;
  out_of_scope_notes: string;
  // Section 3: Existing systems + migration context.
  existing_website_form_url: string;
  existing_phone_lines: string;
  practice_management_system: string;
  practice_management_system_other: string;
  pms_integration_preference: string;
  // Channel mix the firm wants CaseLoad Screen to handle (multi-select).
  // Web is always implied (the widget). The rest are opt-in.
  intake_channels: string[];
  // Typed signature block at the bottom (replaces the bare consent checkbox).
  // Filling signed_name + clicking Submit = explicit authorization.
  signed_name: string;
  signed_email: string;
  consent_acknowledged: boolean;
  notes: string;
}

type UploadState =
  | { status: "idle" }
  | { status: "uploading"; name: string }
  | { status: "done"; name: string; sizeBytes: number }
  | { status: "error"; message: string };

const INITIAL: FormState = {
  legal_name: "",
  business_number: "",
  business_address: "",
  business_website: "",
  business_email: "",
  authorized_rep_name: "",
  authorized_rep_title: "",
  authorized_rep_email: "",
  authorized_rep_phone: "",
  booking_url: "",
  sms_vertical: "LEGAL_SERVICES",
  sms_sender_phone_preference: "",
  whatsapp_number_decision: "",
  whatsapp_display_name: "",
  whatsapp_business_verification_doc_note: "",
  verification_doc_storage_path: null,
  verification_doc_original_name: null,
  verification_doc_size_bytes: null,
  verification_doc_mime_type: null,
  has_facebook_account: "",
  has_meta_business_manager: "",
  meta_business_manager_url: "",
  will_add_operator_as_admin: "",
  meta_admin_status: "",
  meta_admin_blocker_note: "",
  gbp_admin_status: "",
  gbp_admin_blocker_note: "",
  linkedin_admin_status: "",
  linkedin_admin_blocker_note: "",
  m365_admin_status: "",
  m365_admin_blocker_note: "",
  office_hours: "",
  additional_lawyers: [],
  practice_areas: [],
  practice_areas_other: "",
  service_area: "",
  service_area_other: "",
  out_of_scope_notes: "",
  existing_website_form_url: "",
  existing_phone_lines: "",
  practice_management_system: "",
  practice_management_system_other: "",
  pms_integration_preference: "",
  // Pre-check the three defaults (whatsapp + sms + voice). Rep can uncheck
  // any of them and opt into the others.
  intake_channels: ["whatsapp", "sms", "voice"],
  signed_name: "",
  signed_email: "",
  consent_acknowledged: false,
  notes: "",
};

export default function FirmOnboardingForm({ token, firmLabel }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadState>({ status: "idle" });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleFileUpload(file: File) {
    setUpload({ status: "uploading", name: file.name });

    const fd = new FormData();
    fd.append("file", file);

    try {
      const res = await fetch(
        `/api/firm-onboarding/${encodeURIComponent(token)}/upload`,
        { method: "POST", body: fd }
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json?.error ?? "upload failed");
      }
      setForm((prev) => ({
        ...prev,
        verification_doc_storage_path: json.storage_path,
        verification_doc_original_name: json.original_name,
        verification_doc_size_bytes: json.size_bytes,
        verification_doc_mime_type: json.mime_type,
      }));
      setUpload({
        status: "done",
        name: json.original_name,
        sizeBytes: json.size_bytes,
      });
    } catch (err) {
      setUpload({
        status: "error",
        message: err instanceof Error ? err.message : "upload failed",
      });
    }
  }

  function clearUpload() {
    setForm((prev) => ({
      ...prev,
      verification_doc_storage_path: null,
      verification_doc_original_name: null,
      verification_doc_size_bytes: null,
      verification_doc_mime_type: null,
    }));
    setUpload({ status: "idle" });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // The signature is the consent. We require a typed name at the bottom of
    // the form before allowing submit.
    if (!form.signed_name.trim()) {
      setError("Please sign the form at the bottom (type your full name).");
      return;
    }

    // The signature email defaults to the rep email entered in Section 1.
    // Persist that fallback before sending.
    const submitBody = {
      ...form,
      signed_email: form.signed_email.trim() || form.authorized_rep_email,
    };

    setSubmitting(true);
    try {
      const res = await fetch(`/api/firm-onboarding/${encodeURIComponent(token)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitBody),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json?.error ?? "Submission failed");
      }
      router.push(`/firm-onboarding/${encodeURIComponent(token)}/submitted`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-10">
      {/* Section 1: business identity */}
      <Section title="1. Business identity" subtitle="Shared by SMS, WhatsApp, and Voice AI registrations">
        <Field label="Legal business name" hint="Exact spelling on your Articles of Incorporation, including 'Professional Corporation' or 'PC' if registered that way.">
          <input
            type="text"
            required
            value={form.legal_name}
            onChange={(e) => update("legal_name", e.target.value)}
            style={inputStyle}
            placeholder="e.g. Smith Law Professional Corporation"
          />
        </Field>

        <Field label="CRA Business Number (BN)" hint="9 digits, with the program account suffix (e.g., 123456789RC0001). Find on any CRA correspondence or with your accountant.">
          <input
            type="text"
            required
            value={form.business_number}
            onChange={(e) => update("business_number", e.target.value)}
            style={inputStyle}
            placeholder="123456789RC0001"
          />
        </Field>

        <Field label="Registered business address" hint="Street, city, province, postal code. Must match what is on your Articles of Incorporation.">
          <textarea
            required
            value={form.business_address}
            onChange={(e) => update("business_address", e.target.value)}
            style={{ ...inputStyle, minHeight: "70px", resize: "vertical" }}
            placeholder="100 King Street West, Suite 2200, Toronto, ON M5X 1C7"
          />
        </Field>

        <Field label="Business website" hint="Your firm's public site. Must be live with the firm's legal name and address visible somewhere on the page (footer is fine).">
          <input
            type="url"
            required
            value={form.business_website}
            onChange={(e) => update("business_website", e.target.value)}
            style={inputStyle}
            placeholder="https://yourfirm.ca"
          />
        </Field>

        <Field label="Business email for support" hint="A reachable inbox a client could write to. Example: info@yourfirm.ca">
          <input
            type="email"
            required
            value={form.business_email}
            onChange={(e) => update("business_email", e.target.value)}
            style={inputStyle}
            placeholder="info@yourfirm.ca"
          />
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Authorized representative — name">
            <input
              type="text"
              required
              value={form.authorized_rep_name}
              onChange={(e) => update("authorized_rep_name", e.target.value)}
              style={inputStyle}
              placeholder="Full name"
            />
          </Field>
          <Field label="Authorized representative — title">
            <input
              type="text"
              required
              value={form.authorized_rep_title}
              onChange={(e) => update("authorized_rep_title", e.target.value)}
              style={inputStyle}
              placeholder="Principal, Managing Lawyer, etc."
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Authorized representative — email">
            <input
              type="email"
              required
              value={form.authorized_rep_email}
              onChange={(e) => update("authorized_rep_email", e.target.value)}
              style={inputStyle}
              placeholder="you@yourfirm.ca"
            />
          </Field>
          <Field label="Authorized representative — direct phone">
            <input
              type="tel"
              required
              value={form.authorized_rep_phone}
              onChange={(e) => update("authorized_rep_phone", e.target.value)}
              style={inputStyle}
              placeholder="(416) 555-0100"
            />
          </Field>
        </div>

        <Field
          label="Calendar booking link (optional)"
          hint="Where clients book consultations with you — Calendly, Cal.com, GHL native calendar, etc. If you don't have one yet, leave blank and we'll set one up together."
        >
          <input
            type="url"
            value={form.booking_url}
            onChange={(e) => update("booking_url", e.target.value)}
            style={inputStyle}
            placeholder="https://calendly.com/yourfirm"
          />
        </Field>

        <Field
          label="Office hours (optional)"
          hint="When your firm is open for inquiries. Affects the tone of automated acknowledgments (formal during hours, after-hours tone outside). Default if blank: Monday-Friday, 9am-5pm Toronto time."
        >
          <input
            type="text"
            value={form.office_hours}
            onChange={(e) => update("office_hours", e.target.value)}
            style={inputStyle}
            placeholder="e.g. Monday-Friday 9am-6pm, Saturday by appointment"
          />
        </Field>

        <Field
          label="Additional lawyers"
          hint="Anyone besides the authorized representative who should get new-lead notifications and access to the lawyer triage portal. Leave blank if you are a solo practitioner."
        >
          <AdditionalLawyersBlock
            lawyers={form.additional_lawyers}
            onChange={(next) => update("additional_lawyers", next)}
          />
        </Field>
      </Section>

      {/* Section 2: Practice scope */}
      <Section
        title="2. Practice scope"
        subtitle="So we know which leads are in-scope vs out-of-scope when the screen engine routes intake"
      >
        <Field
          label="Primary practice areas"
          hint="Check every area the firm currently handles. If anything is missing from this list, add it in the free-text below. The screen engine uses this to route in-scope leads to the lawyer and decline-with-grace on out-of-scope matters."
        >
          <PracticeAreasMultiSelect
            value={form.practice_areas}
            onChange={(next) => update("practice_areas", next)}
          />
        </Field>

        <Field
          label="Other practice areas (optional)"
          hint="Anything not on the list above. Comma-separated."
        >
          <input
            type="text"
            value={form.practice_areas_other}
            onChange={(e) => update("practice_areas_other", e.target.value)}
            style={inputStyle}
            placeholder="e.g. Cryptocurrency disputes, Animal law, Aviation law"
          />
        </Field>

        <Field
          label="Geographic service area"
          hint="The geography the firm serves. Determines whether leads from outside the area get declined as OOS or routed to the lawyer."
        >
          <RadioGroup
            name="service_area"
            value={form.service_area}
            onChange={(v) => update("service_area", v)}
            options={[
              { value: "toronto_core", label: "Toronto core (downtown + 416)" },
              { value: "gta", label: "Greater Toronto Area (Toronto + 416/647/905)" },
              { value: "ontario_wide", label: "Ontario-wide" },
              { value: "cross_border", label: "Cross-border (Ontario + other jurisdictions)" },
              { value: "other", label: "Other / multi-province" },
            ]}
          />
        </Field>

        {form.service_area === "other" ? (
          <Field label="Specify your service area" hint="Cities, provinces, or other geographic descriptors.">
            <input
              type="text"
              value={form.service_area_other}
              onChange={(e) => update("service_area_other", e.target.value)}
              style={inputStyle}
              placeholder="e.g. Ontario + British Columbia, federal courts nationally"
            />
          </Field>
        ) : null}

        <Field
          label="Out-of-scope matters (optional)"
          hint="Specific matter types you explicitly do not handle, even within your primary practice areas. Helps the screen engine decline-with-grace earlier and refer the lead to a more suitable firm."
        >
          <textarea
            value={form.out_of_scope_notes}
            onChange={(e) => update("out_of_scope_notes", e.target.value)}
            style={{ ...inputStyle, minHeight: "70px", resize: "vertical" }}
            placeholder="e.g. We handle family law but not LGBTQ+ family cases, or we handle real estate but only residential not commercial"
          />
        </Field>
      </Section>

      {/* Section 3: Existing systems + migration */}
      <Section
        title="3. Existing systems + migration"
        subtitle="What the firm uses today, so we can integrate or migrate cleanly"
      >
        <Field
          label="Current website contact form URL (optional)"
          hint="If your website has a contact form today, paste the URL. When we go live, we replace it with the CaseLoad Screen widget. Leave blank if there isn't one or if you don't have a website yet."
        >
          <input
            type="url"
            value={form.existing_website_form_url}
            onChange={(e) => update("existing_website_form_url", e.target.value)}
            style={inputStyle}
            placeholder="https://yourfirm.ca/contact"
          />
        </Field>

        <Field
          label="Existing phone line(s) for legal inquiries (optional)"
          hint="Main number(s) clients use today to reach you. If you want to forward an existing number to the new GHL line, list it here. Format: any."
        >
          <textarea
            value={form.existing_phone_lines}
            onChange={(e) => update("existing_phone_lines", e.target.value)}
            style={{ ...inputStyle, minHeight: "60px", resize: "vertical" }}
            placeholder="e.g. (416) 555-0100 main line, (416) 555-0101 direct line"
          />
        </Field>

        <Field
          label="Practice management system"
          hint="Which platform the firm uses to manage matters, clients, and billing. Drives how we integrate (Clio has a full integration; others vary). Pick the one you use; we walk through the integration scope together after submission."
        >
          <RadioGroup
            name="practice_management_system"
            value={form.practice_management_system}
            onChange={(v) => update("practice_management_system", v)}
            options={[
              { value: "clio", label: "Clio (fully integrated)" },
              { value: "practice_panther", label: "PracticePanther" },
              { value: "mycase", label: "MyCase" },
              { value: "cosmolex", label: "CosmoLex" },
              { value: "leap", label: "LEAP" },
              { value: "pclaw", label: "PCLaw" },
              { value: "soluno", label: "Soluno" },
              { value: "other", label: "Other (specify below)" },
              { value: "none", label: "None / spreadsheets / file folders" },
            ]}
          />
        </Field>

        {form.practice_management_system === "other" ? (
          <Field label="Which system?" hint="Name and (if known) the vendor URL.">
            <input
              type="text"
              value={form.practice_management_system_other}
              onChange={(e) => update("practice_management_system_other", e.target.value)}
              style={inputStyle}
              placeholder="e.g. Smokeball, Rocket Matter, Filevine"
            />
          </Field>
        ) : null}

        {form.practice_management_system && form.practice_management_system !== "none" ? (
          <Field
            label="Integration preference"
            hint="Whether you want CaseLoad Select to integrate with your system at go-live so client_won leads auto-create matters and conflict checks query your existing client database."
          >
            <RadioGroup
              name="pms_integration_preference"
              value={form.pms_integration_preference}
              onChange={(v) => update("pms_integration_preference", v)}
              options={[
                { value: "yes", label: "Yes, integrate at go-live" },
                { value: "not_now", label: "Not now — we will run side-by-side and revisit" },
                { value: "discuss", label: "Let's discuss the scope together" },
              ]}
            />
          </Field>
        ) : null}
      </Section>

      {/* Section 4: SMS A2P 10DLC */}
      <Section title="4. SMS — A2P 10DLC brand registration" subtitle="Carrier-required for outbound SMS to your leads">
        <Field
          label="Sender phone number preference"
          hint="The number your SMS will originate from. Default: we provision a new GHL number for you with a Toronto area code. If you prefer to port an existing line, describe it here and we will coordinate the port separately (2-4 week timeline)."
        >
          <textarea
            value={form.sms_sender_phone_preference}
            onChange={(e) => update("sms_sender_phone_preference", e.target.value)}
            style={{ ...inputStyle, minHeight: "60px", resize: "vertical" }}
            placeholder="Default: provision new GHL number. Or describe a preference."
          />
        </Field>
      </Section>

      {/* Section 3: Intake channels + WhatsApp setup */}
      <Section title="5. Intake channels + WhatsApp setup" subtitle="Which channels CaseLoad Screen should handle, and the WhatsApp specifics if you want it">
        <Field
          label="Beyond your website widget, which channels do you want CaseLoad Screen to handle intake on?"
          hint="The first three are the default channel mix we set up for every firm. The next three are opt-in — they need extra Meta-side setup we'll walk through together. Check all that apply."
        >
          <ChannelMultiSelect
            value={form.intake_channels}
            onChange={(next) => update("intake_channels", next)}
          />
        </Field>

        <Field
          label="Phone number for WhatsApp"
          hint="The same GHL number above will double as your WhatsApp Business number — one line handles Voice AI, SMS, and WhatsApp. The number can never be used on consumer WhatsApp once registered. Confirm below."
        >
          <RadioGroup
            name="whatsapp_number_decision"
            options={[
              { value: "provision_new_ghl_number", label: "Yes, provision a new GHL number that doubles as our WhatsApp number." },
              { value: "different_carrier_line", label: "I want WhatsApp on a different number (we will coordinate separately)." },
            ]}
            value={form.whatsapp_number_decision}
            onChange={(v) => update("whatsapp_number_decision", v)}
          />
        </Field>

        <Field
          label="WhatsApp display name"
          hint="What clients see when your firm messages them on WhatsApp. Cannot include generic phrases (e.g., 'Best Legal Help Inc' will be rejected by Meta). Recommended: your firm's recognised short name."
        >
          <input
            type="text"
            value={form.whatsapp_display_name}
            onChange={(e) => update("whatsapp_display_name", e.target.value)}
            style={inputStyle}
            placeholder="e.g. Smith Law"
          />
        </Field>

        <Field
          label="Business verification document"
          hint="Meta will ask for one of: Articles of Incorporation, a recent utility bill at the registered address, OR a recent tax document. Tell us which document you will provide and (optionally) upload it now — PDF, JPG, or PNG up to 10 MB. If you would rather send it later, leave the upload blank; we will email you a secure link."
        >
          <select
            value={form.whatsapp_business_verification_doc_note}
            onChange={(e) => update("whatsapp_business_verification_doc_note", e.target.value)}
            style={inputStyle}
          >
            <option value="">— Select the document type —</option>
            <option value="articles_of_incorporation">Articles of Incorporation</option>
            <option value="utility_bill">Recent utility bill (registered address)</option>
            <option value="tax_document">Recent tax document</option>
            <option value="not_sure">Not sure yet — let&apos;s discuss</option>
          </select>

          <FileUploadBlock
            upload={upload}
            onPick={handleFileUpload}
            onClear={clearUpload}
          />
        </Field>
      </Section>

      {/* Section 4: Meta Business Manager */}
      <Section
        title="6. Meta Business Manager"
        subtitle="Prerequisites for WhatsApp. Required by Meta before we can register your WABA"
      >
        <Field
          label="Do you have a Facebook account?"
          hint="Required to authenticate with Meta. If not, you can create one in five minutes — no business activity needs to happen on Facebook itself."
        >
          <RadioGroup
            name="has_facebook_account"
            options={[
              { value: "yes", label: "Yes" },
              { value: "no", label: "No — I will create one before we start" },
            ]}
            value={form.has_facebook_account}
            onChange={(v) => update("has_facebook_account", v)}
          />
        </Field>

        <Field
          label="Do you have a Meta Business Manager account for your firm?"
          hint="This is where your WhatsApp Business Account will live. If you do not have one, we create it together as the first step."
        >
          <RadioGroup
            name="has_meta_business_manager"
            options={[
              { value: "yes", label: "Yes" },
              { value: "no", label: "No — we will create one together" },
              { value: "not_sure", label: "Not sure" },
            ]}
            value={form.has_meta_business_manager}
            onChange={(v) => update("has_meta_business_manager", v)}
          />
        </Field>

        {form.has_meta_business_manager === "yes" ? (
          <Field
            label="Meta Business Manager URL or Business ID"
            hint="If you can copy the URL of your Meta Business Manager page (or the Business ID from Settings), paste it here. Optional — we can find it together if you do not have it handy."
          >
            <input
              type="text"
              value={form.meta_business_manager_url}
              onChange={(e) => update("meta_business_manager_url", e.target.value)}
              style={inputStyle}
              placeholder="https://business.facebook.com/settings/info?business_id=..."
            />
          </Field>
        ) : null}

        <Field
          label="Will you add CaseLoad Select as an admin on your Meta Business Manager?"
          hint="Required for us to submit WhatsApp message templates and handle re-verifications without needing you to be available each time. Standard part of the done-for-you model. Admin access can be revoked at any time."
        >
          <RadioGroup
            name="will_add_operator_as_admin"
            options={[
              { value: "yes", label: "Yes" },
              { value: "discuss", label: "Let's discuss this first" },
            ]}
            value={form.will_add_operator_as_admin}
            onChange={(v) => update("will_add_operator_as_admin", v)}
          />
        </Field>

        <p style={{ fontFamily: "var(--font-dm-sans), sans-serif", fontSize: "0.95rem", color: "#4a5a72", lineHeight: 1.6, marginBottom: "16px", marginTop: "8px" }}>
          A four-step walkthrough is available if you want to grant admin access now.
        </p>

        <GuideLinkButton
          href={`/firm-onboarding-guides/meta.html?token=${encodeURIComponent(token)}`}
          label="View the Meta Business Manager guide"
        />

        <AccessStatusBlock
          label="Meta admin access status"
          hint="Set this once you have run through the Meta guide. If you hit a blocker, describe it below."
          status={form.meta_admin_status}
          onStatusChange={(v) => update("meta_admin_status", v)}
          blockerNote={form.meta_admin_blocker_note}
          onBlockerNoteChange={(v) => update("meta_admin_blocker_note", v)}
        />
      </Section>

      {/* Section 5: Google Business Profile manager */}
      <Section
        title="7. Google Business Profile manager"
        subtitle="So we can run local SEO, respond to reviews, and (optionally) handle GBP chat intake on your behalf"
      >
        <p style={{ fontFamily: "var(--font-dm-sans), sans-serif", fontSize: "0.95rem", color: "#4a5a72", lineHeight: 1.6, marginBottom: "16px" }}>
          Google Business Profile is the foundation of local search visibility for a Toronto law firm. We need Manager-level access (not Owner — you stay Owner) to keep the profile current, respond to reviews under your guidelines, and manage GBP chat if you chose that intake channel. Three-step walkthrough opens in a new tab.
        </p>

        <GuideLinkButton
          href={`/firm-onboarding-guides/gbp.html?token=${encodeURIComponent(token)}`}
          label="View the Google Business Profile guide"
        />

        <AccessStatusBlock
          label="Google Business Profile Manager status"
          hint="Set this once you have run through the guide. If you already added CaseLoad Select as a Manager previously, pick 'Done — access granted'."
          status={form.gbp_admin_status}
          onStatusChange={(v) => update("gbp_admin_status", v)}
          blockerNote={form.gbp_admin_blocker_note}
          onBlockerNoteChange={(v) => update("gbp_admin_blocker_note", v)}
        />
      </Section>

      {/* Section 6: LinkedIn Company Page admin */}
      <Section
        title="8. LinkedIn Company Page admin"
        subtitle="So we can publish and manage the firm Company Page on your behalf"
      >
        <p style={{ fontFamily: "var(--font-dm-sans), sans-serif", fontSize: "0.95rem", color: "#4a5a72", lineHeight: 1.6, marginBottom: "16px" }}>
          The firm&apos;s LinkedIn Company Page is the centre of authority-building on the platform. We need Super admin access to post content, respond to messages, and manage the Page going forward. The four-step setup walkthrough opens in a new tab.
        </p>

        <GuideLinkButton
          href={`/firm-onboarding-guides/linkedin.html?token=${encodeURIComponent(token)}`}
          label="View the LinkedIn setup guide"
        />

        <AccessStatusBlock
          label="LinkedIn Super admin status"
          hint="Set this once you have run through the guide. If you hit a blocker, describe it below."
          status={form.linkedin_admin_status}
          onStatusChange={(v) => update("linkedin_admin_status", v)}
          blockerNote={form.linkedin_admin_blocker_note}
          onBlockerNoteChange={(v) => update("linkedin_admin_blocker_note", v)}
        />
      </Section>

      {/* Section 7: Microsoft 365 admin */}
      <Section
        title="9. Microsoft 365 admin for email authentication"
        subtitle="Time-boxed Exchange Admin access so we can configure SPF, DKIM, and DMARC on your sending domain"
      >
        <p style={{ fontFamily: "var(--font-dm-sans), sans-serif", fontSize: "0.95rem", color: "#4a5a72", lineHeight: 1.6, marginBottom: "16px" }}>
          Authenticated email is the difference between inbox and spam. We need Exchange Administrator (guest user) access for roughly five business days to enable DKIM signing and configure the related DNS records. The role is the surgical minimum — it does not give visibility into mailbox content — and it is revoked the moment authentication is verified live.
        </p>

        <GuideLinkButton
          href={`/firm-onboarding-guides/m365.html?token=${encodeURIComponent(token)}`}
          label="View the Microsoft 365 setup guide"
        />

        <AccessStatusBlock
          label="Microsoft 365 Exchange Admin status"
          hint="Set this once you have run through the guide. If the invitation flow trips up, describe it below and we will walk through it together."
          status={form.m365_admin_status}
          onStatusChange={(v) => update("m365_admin_status", v)}
          blockerNote={form.m365_admin_blocker_note}
          onBlockerNoteChange={(v) => update("m365_admin_blocker_note", v)}
        />
      </Section>

      {/* Section 8: notes + signature + submit */}
      <Section title="10. Notes + authorisation" subtitle="Optional notes, then sign to submit">
        <Field label="Notes (optional)">
          <textarea
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            style={{ ...inputStyle, minHeight: "90px", resize: "vertical" }}
            placeholder="Anything you want us to know that did not fit the questions above"
          />
        </Field>

        <SignatureBlock
          firmLabel={firmLabel}
          name={form.signed_name}
          onNameChange={(v) => {
            update("signed_name", v);
            // The signature acts as the consent — keep the boolean in sync so
            // any external code that still checks consent_acknowledged stays
            // truthful to what actually happened.
            update("consent_acknowledged", v.trim().length > 0);
          }}
          email={form.signed_email || form.authorized_rep_email}
          onEmailChange={(v) => update("signed_email", v)}
        />

        {error ? (
          <p
            style={{
              fontFamily: "var(--font-dm-sans), sans-serif",
              fontSize: "0.9rem",
              color: "#B00020",
              padding: "10px 14px",
              background: "#FFF5F5",
              border: "1px solid #FFD8D8",
              borderRadius: "4px",
            }}
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={
            submitting || !form.signed_name.trim() || upload.status === "uploading"
          }
          style={{
            background:
              submitting || !form.signed_name.trim() || upload.status === "uploading"
                ? "#8090A8"
                : "#1E2F58",
            color: "#FFFFFF",
            border: "none",
            padding: "16px 32px",
            fontFamily: "var(--font-manrope), sans-serif",
            fontWeight: 700,
            fontSize: "0.95rem",
            borderRadius: "4px",
            cursor:
              submitting || !form.signed_name.trim() || upload.status === "uploading"
                ? "not-allowed"
                : "pointer",
            letterSpacing: "0.01em",
            transition: "background 0.15s",
            width: "100%",
            maxWidth: "320px",
          }}
        >
          {submitting
            ? "Sending..."
            : upload.status === "uploading"
              ? "Waiting for upload..."
              : "Submit to CaseLoad Select"}
        </button>
      </Section>
    </form>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "#FFFFFF",
        // Fluid padding: 20px on small phones, scales up to 28/30px on desktop
        padding: "clamp(20px, 4vw, 28px) clamp(18px, 5vw, 30px)",
        borderRadius: "4px",
        border: "1px solid #E4E2DB",
      }}
    >
      <h2
        style={{
          fontFamily: "var(--font-manrope), sans-serif",
          fontWeight: 700,
          fontSize: "clamp(1.1rem, 3.8vw, 1.25rem)",
          color: "#1E2F58",
          marginBottom: subtitle ? "4px" : "20px",
          letterSpacing: "-0.005em",
          lineHeight: 1.25,
        }}
      >
        {title}
      </h2>
      {subtitle ? (
        <p
          style={{
            fontFamily: "var(--font-dm-sans), sans-serif",
            fontSize: "0.88rem",
            color: "#5C5850",
            marginBottom: "22px",
          }}
        >
          {subtitle}
        </p>
      ) : null}
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        style={{
          fontFamily: "var(--font-dm-sans), sans-serif",
          fontWeight: 600,
          fontSize: "0.92rem",
          color: "#1E2F58",
          display: "block",
          marginBottom: hint ? "4px" : "6px",
        }}
      >
        {label}
      </label>
      {hint ? (
        <p
          style={{
            fontFamily: "var(--font-dm-sans), sans-serif",
            fontSize: "0.82rem",
            color: "#6B665E",
            marginBottom: "8px",
            lineHeight: 1.5,
          }}
        >
          {hint}
        </p>
      ) : null}
      {children}
    </div>
  );
}

function RadioGroup({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {options.map((opt) => (
        <label
          key={opt.value}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "10px",
            padding: "10px 14px",
            background: value === opt.value ? "#F4F3EF" : "#FBFAF6",
            border: value === opt.value ? "1px solid #1E2F58" : "1px solid #E4E2DB",
            borderRadius: "4px",
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            style={{ marginTop: "3px" }}
            required
          />
          <span
            style={{
              fontFamily: "var(--font-dm-sans), sans-serif",
              fontSize: "0.9rem",
              color: "#3F3C36",
              lineHeight: 1.5,
            }}
          >
            {opt.label}
          </span>
        </label>
      ))}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  fontFamily: "var(--font-dm-sans), sans-serif",
  // 16px minimum to prevent iOS Safari from zooming when the input is focused.
  fontSize: "1rem",
  color: "#3F3C36",
  background: "#FFFFFF",
  border: "1px solid #D8D5CB",
  borderRadius: "4px",
  outline: "none",
};

function FileUploadBlock({
  upload,
  onPick,
  onClear,
}: {
  upload: UploadState;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const inputId = "verification-doc-upload";

  return (
    <div
      style={{
        marginTop: "12px",
        background: "#FBFAF6",
        border: "1px dashed #C4B49A",
        borderRadius: "4px",
        padding: "14px 16px",
      }}
    >
      {upload.status === "idle" || upload.status === "error" ? (
        <>
          <label
            htmlFor={inputId}
            style={{
              display: "inline-block",
              fontFamily: "var(--font-manrope), sans-serif",
              fontWeight: 600,
              fontSize: "0.88rem",
              color: "#FFFFFF",
              background: "#1E2F58",
              padding: "10px 18px",
              borderRadius: "4px",
              cursor: "pointer",
              letterSpacing: "0.01em",
            }}
          >
            Choose a file
          </label>
          <input
            id={inputId}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
              // Reset the input so the same file can be picked again after clearing.
              e.target.value = "";
            }}
            style={{ display: "none" }}
          />
          <span
            style={{
              marginLeft: "12px",
              fontFamily: "var(--font-dm-sans), sans-serif",
              fontSize: "0.85rem",
              color: "#6B665E",
            }}
          >
            PDF, JPG, or PNG · up to 10 MB · optional
          </span>
          {upload.status === "error" ? (
            <p
              style={{
                marginTop: "10px",
                fontFamily: "var(--font-dm-sans), sans-serif",
                fontSize: "0.85rem",
                color: "#B00020",
              }}
            >
              Upload failed: {upload.message}
            </p>
          ) : null}
        </>
      ) : upload.status === "uploading" ? (
        <p
          style={{
            fontFamily: "var(--font-dm-sans), sans-serif",
            fontSize: "0.92rem",
            color: "#3F3C36",
            margin: 0,
          }}
        >
          Uploading <b>{upload.name}</b>...
        </p>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, flex: "1 1 auto" }}>
            <p
              style={{
                fontFamily: "var(--font-manrope), sans-serif",
                fontWeight: 600,
                fontSize: "0.92rem",
                color: "#1E2F58",
                margin: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ marginRight: "8px", color: "#27834A" }}>✓</span>
              {upload.name}
            </p>
            <p
              style={{
                fontFamily: "var(--font-dm-sans), sans-serif",
                fontSize: "0.82rem",
                color: "#6B665E",
                margin: "4px 0 0",
              }}
            >
              Uploaded · {Math.round((upload.sizeBytes / 1024) * 10) / 10} KB
            </p>
          </div>
          <button
            type="button"
            onClick={onClear}
            style={{
              fontFamily: "var(--font-dm-sans), sans-serif",
              fontSize: "0.85rem",
              color: "#1E2F58",
              background: "transparent",
              border: "1px solid #C4B49A",
              padding: "8px 14px",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Replace
          </button>
        </div>
      )}
    </div>
  );
}

// ── Additional lawyers block (Section 1 extension) ──────────────────────

function AdditionalLawyersBlock({
  lawyers,
  onChange,
}: {
  lawyers: Array<{ name: string; email: string; role: string }>;
  onChange: (next: Array<{ name: string; email: string; role: string }>) => void;
}) {
  function addRow() {
    onChange([...lawyers, { name: "", email: "", role: "" }]);
  }
  function removeRow(idx: number) {
    onChange(lawyers.filter((_, i) => i !== idx));
  }
  function updateRow(idx: number, key: "name" | "email" | "role", value: string) {
    onChange(lawyers.map((l, i) => (i === idx ? { ...l, [key]: value } : l)));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {lawyers.map((lawyer, idx) => (
        <div
          key={idx}
          style={{
            background: "#FBFAF6",
            border: "1px solid #E4E2DB",
            borderRadius: "4px",
            padding: "14px 16px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr auto",
            gap: "12px",
            alignItems: "flex-end",
          }}
        >
          <div>
            <label style={subFieldLabelStyle}>Name</label>
            <input
              type="text"
              value={lawyer.name}
              onChange={(e) => updateRow(idx, "name", e.target.value)}
              style={inputStyle}
              placeholder="Full name"
            />
          </div>
          <div>
            <label style={subFieldLabelStyle}>Email</label>
            <input
              type="email"
              value={lawyer.email}
              onChange={(e) => updateRow(idx, "email", e.target.value)}
              style={inputStyle}
              placeholder="lawyer@yourfirm.ca"
            />
          </div>
          <button
            type="button"
            onClick={() => removeRow(idx)}
            style={{
              background: "transparent",
              border: "1px solid #C4B49A",
              color: "#1E2F58",
              padding: "10px 14px",
              borderRadius: "4px",
              cursor: "pointer",
              fontFamily: "var(--font-dm-sans), sans-serif",
              fontSize: "0.82rem",
              whiteSpace: "nowrap",
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        style={{
          alignSelf: "flex-start",
          background: "#FFFFFF",
          border: "1px dashed #C4B49A",
          color: "#1E2F58",
          padding: "10px 18px",
          borderRadius: "4px",
          cursor: "pointer",
          fontFamily: "var(--font-manrope), sans-serif",
          fontSize: "0.88rem",
          fontWeight: 600,
        }}
      >
        + Add {lawyers.length === 0 ? "another lawyer" : "one more"}
      </button>
    </div>
  );
}

const subFieldLabelStyle: React.CSSProperties = {
  fontFamily: "var(--font-oxanium), sans-serif",
  fontSize: "0.66rem",
  fontWeight: 600,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "#8B7A5E",
  display: "block",
  marginBottom: "4px",
};

// ── Practice areas multi-select (Section 2) ─────────────────────────────

const PRACTICE_AREAS: Array<{ key: string; label: string }> = [
  { key: "family", label: "Family Law" },
  { key: "civil_litigation", label: "Civil Litigation" },
  { key: "real_estate", label: "Real Estate Law" },
  { key: "corporate", label: "Corporate & Commercial" },
  { key: "wills_estates", label: "Wills & Estates" },
  { key: "employment", label: "Employment Law" },
  { key: "immigration", label: "Immigration & Refugee" },
  { key: "personal_injury", label: "Personal Injury" },
  { key: "criminal", label: "Criminal Defence" },
  { key: "landlord_tenant", label: "Landlord & Tenant" },
  { key: "tax", label: "Tax Law" },
  { key: "insurance", label: "Insurance Law" },
  { key: "construction", label: "Construction Law" },
  { key: "intellectual_property", label: "Intellectual Property" },
  { key: "administrative", label: "Administrative & Regulatory" },
];

function PracticeAreasMultiSelect({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(key: string) {
    if (value.includes(key)) {
      onChange(value.filter((k) => k !== key));
    } else {
      onChange([...value, key]);
    }
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: "8px",
      }}
    >
      {PRACTICE_AREAS.map((area) => {
        const checked = value.includes(area.key);
        return (
          <label
            key={area.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 12px",
              background: checked ? "#F4F3EF" : "#FBFAF6",
              border: checked ? "1px solid #1E2F58" : "1px solid #E4E2DB",
              borderRadius: "4px",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(area.key)}
              style={{ flexShrink: 0 }}
            />
            <span
              style={{
                fontFamily: "var(--font-dm-sans), sans-serif",
                fontSize: "0.92rem",
                color: "#1E2F58",
              }}
            >
              {area.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}

// ── Channel selector ────────────────────────────────────────────────────

const CHANNELS: Array<{ key: string; label: string; hint?: string; preset?: boolean }> = [
  { key: "whatsapp", label: "WhatsApp Business", hint: "Default — we're setting this up", preset: true },
  { key: "sms", label: "SMS", hint: "Default — we're setting this up", preset: true },
  { key: "voice", label: "Voice / phone calls", hint: "Default — Voice AI on the firm GHL line", preset: true },
  { key: "instagram_dm", label: "Instagram DM", hint: "Requires an Instagram Business account + Meta App Review (1-3 weeks first-time only)" },
  { key: "facebook_messenger", label: "Facebook Messenger", hint: "Requires a Facebook Page + Meta App Review (shares the review with Instagram DM)" },
  { key: "gbp_chat", label: "Google Business Profile chat", hint: "Requires a verified Google Business Profile" },
  { key: "discuss", label: "Not sure yet — let's talk", hint: "Pick this if you want to discuss the channel mix together before deciding" },
];

function ChannelMultiSelect({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(key: string) {
    if (value.includes(key)) {
      onChange(value.filter((k) => k !== key));
    } else {
      onChange([...value, key]);
    }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {CHANNELS.map((channel) => {
        const checked = value.includes(channel.key);
        return (
          <label
            key={channel.key}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "12px",
              padding: "12px 14px",
              background: checked ? "#F4F3EF" : "#FBFAF6",
              border: checked ? "1px solid #1E2F58" : "1px solid #E4E2DB",
              borderRadius: "4px",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(channel.key)}
              style={{ marginTop: "3px", flexShrink: 0 }}
            />
            <div style={{ minWidth: 0, flex: "1 1 auto" }}>
              <div
                style={{
                  fontFamily: "var(--font-manrope), sans-serif",
                  fontWeight: 600,
                  fontSize: "0.93rem",
                  color: "#1E2F58",
                }}
              >
                {channel.label}
              </div>
              {channel.hint ? (
                <div
                  style={{
                    fontFamily: "var(--font-dm-sans), sans-serif",
                    fontSize: "0.82rem",
                    color: channel.preset ? "#27834A" : "#6B665E",
                    marginTop: "2px",
                    lineHeight: 1.45,
                  }}
                >
                  {channel.hint}
                </div>
              ) : null}
            </div>
          </label>
        );
      })}
    </div>
  );
}

// ── Signature block ─────────────────────────────────────────────────────

function SignatureBlock({
  firmLabel,
  name,
  onNameChange,
  email,
  onEmailChange,
}: {
  firmLabel: string;
  name: string;
  onNameChange: (v: string) => void;
  email: string;
  onEmailChange: (v: string) => void;
}) {
  // Render today's date in the user's locale — display only, the server
  // captures the canonical submitted_at when the row is persisted.
  const today = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div
      style={{
        background: "#FBFAF6",
        border: "1px solid #C4B49A",
        borderRadius: "4px",
        padding: "22px 24px",
        marginTop: "8px",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-oxanium), sans-serif",
          fontSize: "0.68rem",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "#8B7A5E",
          fontWeight: 600,
          marginBottom: "12px",
        }}
      >
        Authorisation
      </p>
      <p
        style={{
          fontFamily: "var(--font-dm-sans), sans-serif",
          fontSize: "0.9rem",
          color: "#3F3C36",
          lineHeight: 1.6,
          marginBottom: "22px",
        }}
      >
        By signing below, I confirm I am authorised to provide this information on behalf of{" "}
        <strong>{firmLabel}</strong>. I authorise CaseLoad Select to use these details to register the firm with the SMS carriers (A2P 10DLC), with Meta (Business Manager, WhatsApp Business, and the social DM channels selected above), with Google (Business Profile management), with LinkedIn (Company Page admin), and with Microsoft 365 (Exchange admin for email DNS authentication). I also authorise CaseLoad Select to act on the firm&apos;s behalf in configuring the firm&apos;s practice management system integration where applicable. CaseLoad Select will not share these details with any party other than the registration and integration providers listed.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "18px",
        }}
      >
        <SignatureField label="Signed by" value={name} onChange={onNameChange} placeholder="Type your full name" required />
        <SignatureField label="Email" value={email} onChange={onEmailChange} placeholder="you@yourfirm.ca" />
      </div>
      <div style={{ marginTop: "14px" }}>
        <SignatureField label="Date" value={today} readOnly />
      </div>
    </div>
  );
}

function SignatureField({
  label,
  value,
  onChange,
  placeholder,
  required,
  readOnly,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  readOnly?: boolean;
}) {
  return (
    <div>
      <label
        style={{
          fontFamily: "var(--font-oxanium), sans-serif",
          fontWeight: 600,
          fontSize: "0.66rem",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "#8B7A5E",
          display: "block",
          marginBottom: "4px",
        }}
      >
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder}
        readOnly={readOnly}
        required={required}
        style={{
          width: "100%",
          padding: "8px 2px",
          background: "transparent",
          border: "none",
          borderBottom: "1px solid #1E2F58",
          fontFamily: readOnly ? "var(--font-dm-sans), sans-serif" : "var(--font-caveat), var(--font-dm-sans), cursive",
          fontSize: readOnly ? "1rem" : "1.4rem",
          fontWeight: readOnly ? 400 : 500,
          color: "#1E2F58",
          outline: "none",
          borderRadius: 0,
        }}
      />
    </div>
  );
}

// ── Access-grant helpers ────────────────────────────────────────────────

function GuideLinkButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        background: "#1E2F58",
        color: "#FFFFFF",
        textDecoration: "none",
        padding: "12px 22px",
        borderRadius: "4px",
        fontFamily: "var(--font-manrope), sans-serif",
        fontWeight: 600,
        fontSize: "0.92rem",
        letterSpacing: "0.01em",
        marginBottom: "20px",
      }}
    >
      {label}
      <span aria-hidden style={{ fontSize: "0.85em" }}>↗</span>
    </a>
  );
}

function AccessStatusBlock({
  label,
  hint,
  status,
  onStatusChange,
  blockerNote,
  onBlockerNoteChange,
}: {
  label: string;
  hint: string;
  status: string;
  onStatusChange: (v: string) => void;
  blockerNote: string;
  onBlockerNoteChange: (v: string) => void;
}) {
  return (
    <div style={{ marginTop: "8px" }}>
      <Field label={label} hint={hint}>
        <RadioGroup
          name={`status-${label}`}
          options={[
            { value: "not_started", label: "Not started yet" },
            { value: "in_progress", label: "In progress" },
            { value: "granted", label: "Done — access granted" },
            { value: "blocked", label: "Blocked — see notes below" },
          ]}
          value={status}
          onChange={onStatusChange}
        />
      </Field>
      {status === "blocked" ? (
        <div style={{ marginTop: "12px" }}>
          <Field label="What's blocking you?" hint="Briefly describe the error or screen you got stuck on. We will follow up.">
            <textarea
              value={blockerNote}
              onChange={(e) => onBlockerNoteChange(e.target.value)}
              style={{
                width: "100%",
                padding: "12px 14px",
                fontFamily: "var(--font-dm-sans), sans-serif",
                fontSize: "1rem",
                color: "#3F3C36",
                background: "#FFFFFF",
                border: "1px solid #D8D5CB",
                borderRadius: "4px",
                outline: "none",
                minHeight: "80px",
                resize: "vertical",
              }}
              placeholder="e.g. The Add button is greyed out, or I got a permissions error..."
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}
