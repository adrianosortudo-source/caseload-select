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
  linkedin_admin_status: string;
  linkedin_admin_blocker_note: string;
  m365_admin_status: string;
  m365_admin_blocker_note: string;
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
  linkedin_admin_status: "",
  linkedin_admin_blocker_note: "",
  m365_admin_status: "",
  m365_admin_blocker_note: "",
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

    if (!form.consent_acknowledged) {
      setError("Please acknowledge the consent at the bottom of the form.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/firm-onboarding/${encodeURIComponent(token)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
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
      </Section>

      {/* Section 2: SMS A2P 10DLC */}
      <Section title="2. SMS — A2P 10DLC brand registration" subtitle="Carrier-required for outbound SMS to your leads">
        <Field label="Vertical" hint="Pick the one that most accurately describes your firm.">
          <select
            value={form.sms_vertical}
            onChange={(e) => update("sms_vertical", e.target.value)}
            style={inputStyle}
          >
            <option value="LEGAL_SERVICES">Legal services</option>
            <option value="PROFESSIONAL_SERVICES">Professional services</option>
          </select>
        </Field>

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

      {/* Section 3: WhatsApp Business */}
      <Section title="3. WhatsApp Business" subtitle="So we can register a WhatsApp Business Account (WABA) on your behalf">
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
        title="4. Meta Business Manager"
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

      {/* Section 5: LinkedIn Company Page admin */}
      <Section
        title="5. LinkedIn Company Page admin"
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

      {/* Section 6: Microsoft 365 admin */}
      <Section
        title="6. Microsoft 365 admin for email authentication"
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

      {/* Section 7: notes + consent + submit */}
      <Section title="7. Anything else?" subtitle="Optional notes, questions, or context">
        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            style={{ ...inputStyle, minHeight: "90px", resize: "vertical" }}
            placeholder="Optional"
          />
        </Field>

        <div
          style={{
            background: "#FBFAF6",
            border: "1px solid #E4E2DB",
            padding: "16px 18px",
            borderRadius: "4px",
          }}
        >
          <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={form.consent_acknowledged}
              onChange={(e) => update("consent_acknowledged", e.target.checked)}
              style={{ marginTop: "4px" }}
              required
            />
            <span
              style={{
                fontFamily: "var(--font-dm-sans), sans-serif",
                fontSize: "0.9rem",
                color: "#3F3C36",
                lineHeight: 1.55,
              }}
            >
              I confirm I am authorised to provide this information on behalf of {firmLabel}.
              I authorise CaseLoad Select to use these details to register the firm with the
              SMS carriers (A2P 10DLC), with Meta (WhatsApp Business), and to configure the
              firm&apos;s GoHighLevel sub-account. CaseLoad Select will not share these
              details with any party other than the registration providers listed above.
            </span>
          </label>
        </div>

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
            submitting || !form.consent_acknowledged || upload.status === "uploading"
          }
          style={{
            background:
              submitting || !form.consent_acknowledged || upload.status === "uploading"
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
              submitting || !form.consent_acknowledged || upload.status === "uploading"
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
