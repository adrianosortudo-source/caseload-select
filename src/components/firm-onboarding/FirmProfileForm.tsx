"use client";

/**
 * FirmProfileForm: the v2 "Firm Profile" intake (Form 2 of 2).
 *
 * Operations, brand, and growth details that do not gate a registration, so
 * this runs on a calmer clock than the registration form. Posts to
 * /api/firm-profile/[token]/submit with form_type='profile'. Shares the visual
 * language with FirmOnboardingForm; the small layout helpers are duplicated
 * here on purpose to keep the registration form untouched.
 */

import { useState } from "react";
import { MAX_CLIENT_LIST_FILES, type ClientListFile } from "@/lib/firm-onboarding-client-list";

interface Props {
  token: string;
  firmLabel: string;
}

interface ProfileState {
  legal_name: string;
  authorized_rep_email: string;
  office_model: string;
  firm_size: string;
  annual_revenue_band: string;
  second_contact: string;
  ooo_pattern: string;
  past_clients_active: string;
  past_clients_mid: string;
  past_clients_closed: string;
  baseline_inquiry_volume: string;
  fee_structure: string;
  fee_exclusions: string;
  fee_deal_variation: string;
  fee_publish_preference: string;
  payment_methods: string[];
  esignature_tool: string;
  marketing_crm: string;
  brand_assets_status: string;
  brand_assets_notes: string;
  photos_status: string;
  social_linkedin_personal: string;
  social_instagram: string;
  social_x: string;
  social_facebook: string;
  icp_want_more: string;
  icp_decline: string;
  review_comfort: string;
  profile_notes: string;
  signed_name: string;
  signed_email: string;
  client_list_path: "" | "share_with_us" | "self_upload";
  client_list_files: ClientListFile[];
  client_list_attested: boolean;
  client_list_self_upload_confirmed: boolean;
}

const INITIAL: ProfileState = {
  legal_name: "",
  authorized_rep_email: "",
  office_model: "",
  firm_size: "",
  annual_revenue_band: "",
  second_contact: "",
  ooo_pattern: "",
  past_clients_active: "",
  past_clients_mid: "",
  past_clients_closed: "",
  baseline_inquiry_volume: "",
  fee_structure: "",
  fee_exclusions: "",
  fee_deal_variation: "",
  fee_publish_preference: "",
  payment_methods: [],
  esignature_tool: "",
  marketing_crm: "",
  brand_assets_status: "",
  brand_assets_notes: "",
  photos_status: "",
  social_linkedin_personal: "",
  social_instagram: "",
  social_x: "",
  social_facebook: "",
  icp_want_more: "",
  icp_decline: "",
  review_comfort: "",
  profile_notes: "",
  signed_name: "",
  signed_email: "",
  client_list_path: "",
  client_list_files: [],
  client_list_attested: false,
  client_list_self_upload_confirmed: false,
};

type UploadState =
  | { status: "idle" }
  | { status: "uploading"; name: string }
  | { status: "done"; name: string; sizeBytes: number }
  | { status: "error"; message: string };

const PAYMENT_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "stripe", label: "Stripe or card" },
  { key: "interac", label: "Interac e-transfer" },
  { key: "cheque", label: "Cheque" },
  { key: "other", label: "Other" },
];

export default function FirmProfileForm({ token, firmLabel }: Props) {
  const [form, setForm] = useState<ProfileState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [upload, setUpload] = useState<UploadState>({ status: "idle" });

  function update<K extends keyof ProfileState>(key: K, value: ProfileState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function togglePayment(key: string) {
    setForm((prev) => ({
      ...prev,
      payment_methods: prev.payment_methods.includes(key)
        ? prev.payment_methods.filter((k) => k !== key)
        : [...prev.payment_methods, key],
    }));
  }

  async function handleFileUpload(file: File) {
    setUpload({ status: "uploading", name: file.name });
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`/api/firm-profile/${encodeURIComponent(token)}/upload`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error ?? "upload failed");
      setForm((prev) => ({
        ...prev,
        client_list_files: [
          ...prev.client_list_files,
          {
            storage_path: json.storage_path,
            original_name: json.original_name,
            size_bytes: json.size_bytes,
            mime_type: json.mime_type,
          },
        ],
      }));
      setUpload({ status: "idle" });
    } catch (err) {
      setUpload({ status: "error", message: err instanceof Error ? err.message : "upload failed" });
    }
  }

  function removeFile(index: number) {
    setForm((prev) => ({
      ...prev,
      client_list_files: prev.client_list_files.filter((_, i) => i !== index),
    }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.legal_name.trim()) {
      setError("Please enter your firm's legal name.");
      return;
    }
    if (!form.authorized_rep_email.trim()) {
      setError("Please enter your email so we can reach you about this profile.");
      return;
    }
    if (!form.signed_name.trim()) {
      setError("Please sign the form at the bottom (type your full name).");
      return;
    }
    if (!form.client_list_path) {
      setError("Please choose how you want to hand over the client list.");
      return;
    }
    if (form.client_list_path === "share_with_us" && form.client_list_files.length === 0) {
      setError("Please upload at least one client file, or switch to the self-upload option.");
      return;
    }
    if (form.client_list_path === "self_upload" && !form.client_list_self_upload_confirmed) {
      setError("Please confirm the firm will upload the list itself.");
      return;
    }
    if (!form.client_list_attested) {
      setError("Please confirm the consent statement for the client list.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/firm-profile/${encodeURIComponent(token)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          signed_email: form.signed_email.trim() || form.authorized_rep_email,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json?.error ?? "Submission failed");
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div style={{ background: "#FFFFFF", border: "1px solid #E4E2DB", borderRadius: "4px", padding: "32px 28px" }}>
        <p style={{ fontFamily: "var(--font-oxanium), sans-serif", fontSize: "0.68rem", letterSpacing: "0.2em", textTransform: "uppercase", color: "#27834A", fontWeight: 600, marginBottom: "10px" }}>
          Received
        </p>
        <h2 style={{ fontFamily: "var(--font-manrope), sans-serif", fontWeight: 800, fontSize: "1.6rem", color: "#1E2F58", margin: "0 0 10px" }}>
          Thank you
        </h2>
        <p style={{ fontFamily: "var(--font-dm-sans), sans-serif", fontSize: "1rem", color: "#4a5a72", lineHeight: 1.6, margin: 0 }}>
          Your firm profile is in. We will fold these details into your setup and follow up if anything needs a quick clarification. You can close this tab.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-10">
      <Section title="Your firm" subtitle="So we attach this profile to the right firm.">
        <Field label="Legal business name" hint="The same name you gave on the registration form.">
          <input type="text" required value={form.legal_name} onChange={(e) => update("legal_name", e.target.value)} style={inputStyle} placeholder="e.g. Smith Law Professional Corporation" />
        </Field>
        <Field label="Your email" hint="Where we reach you about this profile.">
          <input type="email" required value={form.authorized_rep_email} onChange={(e) => update("authorized_rep_email", e.target.value)} style={inputStyle} placeholder="you@yourfirm.ca" />
        </Field>
      </Section>

      <Section title="A. Firm shape" subtitle="How the firm runs day to day.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Office model" hint="Drives whether your Google Business Profile shows a walk-in address.">
            <select value={form.office_model} onChange={(e) => update("office_model", e.target.value)} style={inputStyle}>
              <option value="">Select</option>
              <option value="remote">Remote only</option>
              <option value="hybrid">Hybrid</option>
              <option value="in_office">In-office</option>
            </select>
          </Field>
          <Field label="Firm size">
            <select value={form.firm_size} onChange={(e) => update("firm_size", e.target.value)} style={inputStyle}>
              <option value="">Select</option>
              <option value="solo">Solo</option>
              <option value="two">Two lawyers</option>
              <option value="three_plus">Three or more</option>
            </select>
          </Field>
        </div>
        <Field label="Approximate annual revenue band (optional)" hint="Helps confirm the right CaseLoad tier. A round band is fine.">
          <select value={form.annual_revenue_band} onChange={(e) => update("annual_revenue_band", e.target.value)} style={inputStyle}>
            <option value="">Select</option>
            <option value="under_250k">Under 250k</option>
            <option value="250k_500k">250k to 500k</option>
            <option value="500k_1m">500k to 1M</option>
            <option value="over_1m">Over 1M</option>
          </select>
        </Field>
        <Field label="Second contact or operational backup (optional)" hint="An admin, paralegal, or anyone besides the lead lawyer who helps run intake. If there is no one yet, say so.">
          <input type="text" value={form.second_contact} onChange={(e) => update("second_contact", e.target.value)} style={inputStyle} placeholder="Name and role, or 'no one yet'" />
        </Field>
        <Field label="Seasonal or recurring out-of-office pattern (optional)" hint="Any predictable stretch you are away. Affects auto-reply tone and intake handoff.">
          <textarea value={form.ooo_pattern} onChange={(e) => update("ooo_pattern", e.target.value)} style={areaStyle} placeholder="e.g. Away in Brazil roughly December through February each year" />
        </Field>
      </Section>

      <Section title="B. Existing client base" subtitle="Rough numbers are fine. Your client list is how the reactivation and review systems start, so this part is required.">
        <Field label="Approximate past-client count, segmented">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <SubInput label="Active matters" value={form.past_clients_active} onChange={(v) => update("past_clients_active", v)} placeholder="e.g. 12" />
            <SubInput label="Mid-engagement" value={form.past_clients_mid} onChange={(v) => update("past_clients_mid", v)} placeholder="e.g. 20" />
            <SubInput label="Closed or past" value={form.past_clients_closed} onChange={(v) => update("past_clients_closed", v)} placeholder="e.g. 150" />
          </div>
        </Field>
        <Field label="Baseline inquiry volume, last 90 days" hint="Roughly how many new inquiries or leads you got per month before CaseLoad Select. This is the number we measure lift against.">
          <input type="number" inputMode="numeric" value={form.baseline_inquiry_volume} onChange={(e) => update("baseline_inquiry_volume", e.target.value)} style={{ ...inputStyle, maxWidth: "280px" }} placeholder="Approx new inquiries per month" />
        </Field>

        <Field label="How do you want to hand over the client list?">
          <div className="space-y-2">
            {CLIENT_LIST_PATH_OPTIONS.map((opt) => {
              const checked = form.client_list_path === opt.value;
              return (
                <label
                  key={opt.value}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "12px",
                    padding: "14px 16px",
                    background: checked ? "#F4F3EF" : "#FBFAF6",
                    border: checked ? "1px solid #1E2F58" : "1px solid #E4E2DB",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="client_list_path"
                    checked={checked}
                    onChange={() => update("client_list_path", opt.value)}
                    style={{ marginTop: "3px" }}
                  />
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "var(--font-dm-sans), sans-serif", fontWeight: 600, fontSize: "0.92rem", color: "#1E2F58" }}>
                        {opt.label}
                      </span>
                      {opt.recommended ? (
                        <span
                          style={{
                            fontFamily: "var(--font-oxanium), sans-serif",
                            fontSize: "0.62rem",
                            fontWeight: 700,
                            letterSpacing: "0.12em",
                            textTransform: "uppercase",
                            color: "#8B7A5E",
                            background: "#F4EFE3",
                            border: "1px solid #C4B49A",
                            borderRadius: "3px",
                            padding: "2px 6px",
                          }}
                        >
                          Recommended
                        </span>
                      ) : null}
                    </div>
                    <p style={{ fontFamily: "var(--font-dm-sans), sans-serif", fontSize: "0.85rem", color: "#6B665E", marginTop: "4px", lineHeight: 1.5 }}>
                      {opt.description}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </Field>

        {form.client_list_path === "share_with_us" ? (
          <Field
            label="Upload your client files"
            hint="Any format you already have works: a spreadsheet, a PDF, an export from Outlook or your practice software, even photos of a printed list. Up to 10 files, 50 MB each. We need each client's name, email or phone, the practice area, and roughly when the matter closed. No case details, no documents from the file."
          >
            <ClientListFileUploader
              files={form.client_list_files}
              upload={upload}
              onPick={handleFileUpload}
              onRemove={removeFile}
            />
            <p style={{ fontFamily: "var(--font-dm-sans), sans-serif", fontSize: "0.82rem", color: "#6B665E", marginTop: "10px", lineHeight: 1.5 }}>
              How your data is handled: CaseLoad Select processes the list solely on the firm&apos;s behalf under PIPEDA, stores it on Canadian servers, and deletes its working copy once the import into your CRM is verified.
            </p>
          </Field>
        ) : null}

        {form.client_list_path === "self_upload" ? (
          <div style={{ background: "#FBFAF6", border: "1px dashed #C4B49A", borderRadius: "4px", padding: "16px 18px" }}>
            <p style={{ fontFamily: "var(--font-dm-sans), sans-serif", fontSize: "0.9rem", color: "#3F3C36", lineHeight: 1.6, marginBottom: "12px" }}>
              Download the template, fill the Client List tab (one row per client), and follow the guide. We will send CRM access for the upload.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "14px" }}>
              <a
                href="/firm-onboarding-guides/client-list-template.xlsx"
                target="_blank"
                rel="noreferrer"
                style={{ fontFamily: "var(--font-dm-sans), sans-serif", fontSize: "0.9rem", color: "#1E2F58", textDecoration: "underline" }}
              >
                Download the template (Excel)
              </a>
              <a
                href="/firm-onboarding-guides/client-list.html"
                target="_blank"
                rel="noreferrer"
                style={{ fontFamily: "var(--font-dm-sans), sans-serif", fontSize: "0.9rem", color: "#1E2F58", textDecoration: "underline" }}
              >
                How to fill it in, including the consent rules
              </a>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={form.client_list_self_upload_confirmed}
                onChange={(e) => update("client_list_self_upload_confirmed", e.target.checked)}
              />
              <span style={{ fontFamily: "var(--font-dm-sans), sans-serif", fontSize: "0.9rem", color: "#3F3C36" }}>
                We will upload the completed list to the CRM ourselves.
              </span>
            </label>
          </div>
        ) : null}

        {form.client_list_path ? (
          <div style={{ background: "#FBFAF6", border: "1px solid #C4B49A", borderRadius: "4px", padding: "18px 20px" }}>
            <p style={{ fontFamily: "var(--font-oxanium), sans-serif", fontSize: "0.68rem", letterSpacing: "0.2em", textTransform: "uppercase", color: "#8B7A5E", fontWeight: 600, marginBottom: "12px" }}>
              Consent
            </p>
            <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={form.client_list_attested}
                onChange={(e) => update("client_list_attested", e.target.checked)}
                style={{ marginTop: "3px" }}
              />
              <span style={{ fontFamily: "var(--font-dm-sans), sans-serif", fontSize: "0.9rem", color: "#3F3C36", lineHeight: 1.6 }}>
                I confirm the firm has a lawful basis under Canada&apos;s Anti-Spam Legislation (CASL) to email the clients on this list, or has recorded each client&apos;s consent basis (Express, Implied, or Unknown) so anyone without a valid basis is left out of every send. The firm remains the owner of this data.
              </span>
            </label>
          </div>
        ) : null}
      </Section>

      <Section title="C. Fees and engagement" subtitle="High level is enough. We refine the specifics together later.">
        <Field label="Fee structure summary" hint="Flat fee, hourly, or mixed, and which practice areas use which.">
          <textarea value={form.fee_structure} onChange={(e) => update("fee_structure", e.target.value)} style={areaStyle} placeholder="e.g. Flat fee for residential closings and simple wills; hourly for litigation; commercial real estate quoted per matter" />
        </Field>
        <Field label="What's excluded from your fee?" hint="Anything the client pays separately from your quoted fee: a registration fee, a lender fee, disbursements, HST, anything with its own number attached.">
          <textarea value={form.fee_exclusions} onChange={(e) => update("fee_exclusions", e.target.value)} style={areaStyle} placeholder="e.g. Mortgage registration fee ($399-599, ours, not the lender's) is billed separately from the flat fee" />
        </Field>
        <Field label="Does your fee change by deal type?" hint="Cash vs. financed, insured vs. conventional, anything that changes what a client actually owes.">
          <textarea value={form.fee_deal_variation} onChange={(e) => update("fee_deal_variation", e.target.value)} style={areaStyle} placeholder="e.g. Cash purchases pay the flat fee only; financed purchases add the mortgage registration fee" />
        </Field>
        <Field label="How should we publish your numbers?" hint="Controls how precise the public-facing pricing tools and copy get.">
          <select value={form.fee_publish_preference} onChange={(e) => update("fee_publish_preference", e.target.value)} style={inputStyle}>
            <option value="">Select</option>
            <option value="line_item">Full line-item breakdown</option>
            <option value="lump_estimate">One lump estimate or range</option>
            <option value="confirm_first">Case-by-case, confirm with me before publishing</option>
          </select>
        </Field>
        <Field label="How do clients pay you?" hint="Select all that apply.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {PAYMENT_OPTIONS.map((p) => {
              const checked = form.payment_methods.includes(p.key);
              return (
                <label key={p.key} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", background: checked ? "#F4F3EF" : "#FBFAF6", border: checked ? "1px solid #1E2F58" : "1px solid #E4E2DB", borderRadius: "4px", cursor: "pointer" }}>
                  <input type="checkbox" checked={checked} onChange={() => togglePayment(p.key)} />
                  <span style={{ fontFamily: "var(--font-dm-sans), sans-serif", fontSize: "0.92rem", color: "#1E2F58" }}>{p.label}</span>
                </label>
              );
            })}
          </div>
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="E-signature tool" hint="For engagement letters and retainers.">
            <select value={form.esignature_tool} onChange={(e) => update("esignature_tool", e.target.value)} style={inputStyle}>
              <option value="">Select</option>
              <option value="docusign">DocuSign or similar</option>
              <option value="pms_native">Native in my practice management system</option>
              <option value="none">None yet</option>
            </select>
          </Field>
          <Field label="Existing CRM or marketing email tool" hint="Separate from your practice management system.">
            <select value={form.marketing_crm} onChange={(e) => update("marketing_crm", e.target.value)} style={inputStyle}>
              <option value="">Select</option>
              <option value="none">None</option>
              <option value="mailchimp">Mailchimp</option>
              <option value="klaviyo">Klaviyo</option>
              <option value="ghl">GoHighLevel already</option>
              <option value="other">Other</option>
            </select>
          </Field>
        </div>
      </Section>

      <Section title="D. Brand and presence" subtitle="Tells us whether we build from scratch or extend.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Existing brand assets" hint="Logo file, defined colour hex codes, chosen fonts.">
            <select value={form.brand_assets_status} onChange={(e) => update("brand_assets_status", e.target.value)} style={inputStyle}>
              <option value="">Select</option>
              <option value="all">Have all of it</option>
              <option value="some">Have some of it</option>
              <option value="none">None, build from scratch</option>
            </select>
          </Field>
          <Field label="Photos and headshots">
            <select value={form.photos_status} onChange={(e) => update("photos_status", e.target.value)} style={inputStyle}>
              <option value="">Select</option>
              <option value="have">I have current professional photos</option>
              <option value="need_shoot">I need a shoot</option>
              <option value="ai_ok">I am open to AI-generated imagery</option>
            </select>
          </Field>
        </div>
        <Field label="Brand notes (optional)" hint="Hex codes, font names, or where your logo file lives. We follow up for the actual files.">
          <textarea value={form.brand_assets_notes} onChange={(e) => update("brand_assets_notes", e.target.value)} style={areaStyle} placeholder="e.g. Navy #1E2F58 and gold #C4B49A; headings in Manrope; logo in our Google Drive" />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Personal LinkedIn URL (optional)" hint="Helps us re-share firm articles.">
            <input type="url" value={form.social_linkedin_personal} onChange={(e) => update("social_linkedin_personal", e.target.value)} style={inputStyle} placeholder="https://linkedin.com/in/..." />
          </Field>
          <Field label="Instagram handle (optional)">
            <input type="text" value={form.social_instagram} onChange={(e) => update("social_instagram", e.target.value)} style={inputStyle} placeholder="@yourfirm" />
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="X / Twitter handle (optional)">
            <input type="text" value={form.social_x} onChange={(e) => update("social_x", e.target.value)} style={inputStyle} placeholder="@yourfirm" />
          </Field>
          <Field label="Existing Facebook Page or profile (optional)">
            <input type="url" value={form.social_facebook} onChange={(e) => update("social_facebook", e.target.value)} style={inputStyle} placeholder="https://facebook.com/..." />
          </Field>
        </div>
      </Section>

      <Section title="E. Growth and screening" subtitle="Sharpens routing and keeps the review-collection journey on the right foot.">
        <Field label="Who you want more of" hint="The kind of client or matter you would happily take more of.">
          <textarea value={form.icp_want_more} onChange={(e) => update("icp_want_more", e.target.value)} style={areaStyle} placeholder="e.g. Commercial real estate purchases over 1M; incorporations for healthcare professionals" />
        </Field>
        <Field label="What you decline" hint="Matter types you turn away, even within your practice areas.">
          <textarea value={form.icp_decline} onChange={(e) => update("icp_decline", e.target.value)} style={areaStyle} placeholder="e.g. No contingency personal injury; no rural land severances" />
        </Field>
        <Field label="Review-collection comfort" hint="When you are comfortable asking for a review, who to ask, which platform, and any hard nos.">
          <textarea value={form.review_comfort} onChange={(e) => update("review_comfort", e.target.value)} style={areaStyle} placeholder="e.g. Only after a matter closes well; Google reviews only; never cold-ask litigation clients" />
        </Field>
      </Section>

      <Section title="F. Anything else" subtitle="Then sign to submit.">
        <Field label="Notes (optional)">
          <textarea value={form.profile_notes} onChange={(e) => update("profile_notes", e.target.value)} style={areaStyle} placeholder="Anything that did not fit the questions above" />
        </Field>

        <div style={{ background: "#FBFAF6", border: "1px solid #C4B49A", borderRadius: "4px", padding: "22px 24px", marginTop: "8px" }}>
          <p style={{ fontFamily: "var(--font-oxanium), sans-serif", fontSize: "0.68rem", letterSpacing: "0.2em", textTransform: "uppercase", color: "#8B7A5E", fontWeight: 600, marginBottom: "12px" }}>
            Authorisation
          </p>
          <p style={{ fontFamily: "var(--font-dm-sans), sans-serif", fontSize: "0.9rem", color: "#3F3C36", lineHeight: 1.6, marginBottom: "20px" }}>
            By signing below, I confirm I am authorised to provide this information on behalf of <strong>{firmLabel}</strong>.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Signed by">
              <input type="text" required value={form.signed_name} onChange={(e) => update("signed_name", e.target.value)} style={inputStyle} placeholder="Type your full name" />
            </Field>
            <Field label="Email (optional)">
              <input type="email" value={form.signed_email} onChange={(e) => update("signed_email", e.target.value)} style={inputStyle} placeholder="you@yourfirm.ca" />
            </Field>
          </div>
        </div>

        {error ? (
          <p style={{ fontFamily: "var(--font-dm-sans), sans-serif", fontSize: "0.9rem", color: "#B00020", padding: "10px 14px", background: "#FFF5F5", border: "1px solid #FFD8D8", borderRadius: "4px" }}>
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting || !form.signed_name.trim() || !form.legal_name.trim() || upload.status === "uploading"}
          style={{
            background: submitting || !form.signed_name.trim() || !form.legal_name.trim() ? "#8090A8" : "#1E2F58",
            color: "#FFFFFF",
            border: "none",
            padding: "16px 32px",
            fontFamily: "var(--font-manrope), sans-serif",
            fontWeight: 700,
            fontSize: "0.95rem",
            borderRadius: "4px",
            cursor: submitting ? "not-allowed" : "pointer",
            width: "100%",
            maxWidth: "320px",
          }}
        >
          {submitting ? "Sending..." : "Submit firm profile"}
        </button>
      </Section>
    </form>
  );
}

// ── layout helpers (duplicated from FirmOnboardingForm on purpose) ──────────

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section style={{ background: "#FFFFFF", padding: "clamp(20px, 4vw, 28px) clamp(18px, 5vw, 30px)", borderRadius: "4px", border: "1px solid #E4E2DB" }}>
      <h2 style={{ fontFamily: "var(--font-manrope), sans-serif", fontWeight: 700, fontSize: "clamp(1.1rem, 3.8vw, 1.25rem)", color: "#1E2F58", marginBottom: subtitle ? "4px" : "20px", lineHeight: 1.25 }}>
        {title}
      </h2>
      {subtitle ? (
        <p style={{ fontFamily: "var(--font-dm-sans), sans-serif", fontSize: "0.88rem", color: "#5C5850", marginBottom: "22px" }}>{subtitle}</p>
      ) : null}
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontFamily: "var(--font-dm-sans), sans-serif", fontWeight: 600, fontSize: "0.92rem", color: "#1E2F58", display: "block", marginBottom: hint ? "4px" : "6px" }}>
        {label}
      </label>
      {hint ? (
        <p style={{ fontFamily: "var(--font-dm-sans), sans-serif", fontSize: "0.82rem", color: "#6B665E", marginBottom: "8px", lineHeight: 1.5 }}>{hint}</p>
      ) : null}
      {children}
    </div>
  );
}

function SubInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label style={{ fontFamily: "var(--font-oxanium), sans-serif", fontSize: "0.66rem", fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "#8B7A5E", display: "block", marginBottom: "4px" }}>
        {label}
      </label>
      <input type="number" inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} placeholder={placeholder} />
    </div>
  );
}

const CLIENT_LIST_PATH_OPTIONS: Array<{
  value: "share_with_us" | "self_upload";
  label: string;
  description: string;
  recommended?: boolean;
}> = [
  {
    value: "share_with_us",
    label: "Share the list with CaseLoad Select",
    description:
      "Send whatever you already have. We clean it, format it, load it into your CRM, then delete our working copy. Nothing for you to prepare.",
    recommended: true,
  },
  {
    value: "self_upload",
    label: "We will upload it ourselves",
    description:
      "You fill our template and upload the list to the CRM with access we send you. Choose this only if the firm prefers not to hand the file over.",
  },
];

const CLIENT_LIST_ACCEPT =
  ".csv,.xlsx,.xls,.ods,.numbers,.pdf,.doc,.docx,.rtf,.txt,.vcf,.png,.jpg,.jpeg,.heic,.heif,.webp";

function ClientListFileUploader({
  files,
  upload,
  onPick,
  onRemove,
}: {
  files: ClientListFile[];
  upload: UploadState;
  onPick: (file: File) => void;
  onRemove: (index: number) => void;
}) {
  const inputId = "client-list-upload";
  const atCap = files.length >= MAX_CLIENT_LIST_FILES;
  return (
    <div>
      {files.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "10px" }}>
          {files.map((f, i) => (
            <div
              key={`${f.storage_path}-${i}`}
              style={{
                background: "#FBFAF6",
                border: "1px dashed #C4B49A",
                borderRadius: "4px",
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-dm-sans), sans-serif",
                  fontSize: "0.88rem",
                  color: "#1E2F58",
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ color: "#27834A", marginRight: "8px" }}>✓</span>
                {f.original_name}
              </span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                style={{ fontFamily: "var(--font-dm-sans), sans-serif", fontSize: "0.82rem", color: "#1E2F58", background: "transparent", border: "1px solid #C4B49A", padding: "6px 12px", borderRadius: "4px", cursor: "pointer" }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {!atCap ? (
        <div style={{ background: "#FBFAF6", border: "1px dashed #C4B49A", borderRadius: "4px", padding: "14px 16px" }}>
          <label htmlFor={inputId} style={{ display: "inline-block", fontFamily: "var(--font-manrope), sans-serif", fontWeight: 600, fontSize: "0.88rem", color: "#FFFFFF", background: "#1E2F58", padding: "10px 18px", borderRadius: "4px", cursor: "pointer" }}>
            {upload.status === "uploading" ? "Uploading..." : "Add a file"}
          </label>
          <input
            id={inputId}
            type="file"
            accept={CLIENT_LIST_ACCEPT}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
              e.target.value = "";
            }}
            style={{ display: "none" }}
          />
          <span style={{ marginLeft: "12px", fontFamily: "var(--font-dm-sans), sans-serif", fontSize: "0.85rem", color: "#6B665E" }}>
            Up to 10 files, 50 MB each
          </span>
          {upload.status === "error" ? (
            <p style={{ marginTop: "10px", fontFamily: "var(--font-dm-sans), sans-serif", fontSize: "0.85rem", color: "#B00020" }}>
              Upload failed: {upload.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  fontFamily: "var(--font-dm-sans), sans-serif",
  fontSize: "1rem",
  color: "#3F3C36",
  background: "#FFFFFF",
  border: "1px solid #D8D5CB",
  borderRadius: "4px",
  outline: "none",
};

const areaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: "70px",
  resize: "vertical",
};
