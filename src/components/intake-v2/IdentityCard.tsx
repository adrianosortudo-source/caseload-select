"use client";

/**
 * IdentityCard — name + email + phone capture, single screen.
 *
 * Brand-styled, mobile-first. Submit button enables when name + email + phone
 * pass minimal validation. The parent handles the actual /api/screen call to
 * submit identity and trigger OTP.
 */

import { useState } from "react";

interface Props {
  /** Initial values, e.g. when user backs into screen with prior input. */
  initialName?: string;
  initialEmail?: string;
  initialPhone?: string;
  /** Submit handler. Receives validated values. */
  onSubmit: (name: string, email: string, phone: string) => void;
  /** Disable submit while parent processes (loading state). */
  loading?: boolean;
  /** Firm name shown in the consent label. */
  firmName?: string;
  /** Absolute URL for the privacy policy link. */
  privacyUrl?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s()+\-.]{7,}$/;

export function IdentityCard({ initialName = "", initialEmail = "", initialPhone = "", onSubmit, loading, firmName, privacyUrl = "https://app.caseloadselect.ca/privacy" }: Props) {
  const [name, setName]   = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState(initialPhone);
  const [consentGiven, setConsentGiven] = useState(false);

  const valid = name.trim().length >= 2 && EMAIL_RE.test(email.trim()) && PHONE_RE.test(phone.trim()) && consentGiven;

  function handleSubmit() {
    if (!valid || loading) return;
    onSubmit(name.trim(), email.trim(), phone.trim());
  }

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2.5">
        <h2 className="text-[26px] sm:text-[30px] leading-tight font-extrabold text-[#1E2F58]" style={{ fontFamily: "Manrope, sans-serif" }}>
          Almost there. Where do we send it?
        </h2>
        <p className="text-[15px] text-[#1E2F58]/65 leading-relaxed" style={{ fontFamily: "DM Sans, sans-serif" }}>
          A lawyer will review this case file. If your matter fits the firm&rsquo;s practice, the firm will reach out directly. We will text a quick code to confirm your number.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Input id="v2-name"  label="Full name"     value={name}  onChange={setName}  type="text"  autoComplete="name" />
        <Input id="v2-email" label="Email"         value={email} onChange={setEmail} type="email" autoComplete="email" />
        <Input id="v2-phone" label="Phone number"  value={phone} onChange={setPhone} type="tel"   autoComplete="tel" />
      </div>

      <div className="flex items-start gap-3">
        <input
          id="v2-consent"
          type="checkbox"
          checked={consentGiven}
          onChange={e => setConsentGiven(e.target.checked)}
          className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer rounded border-[#1E2F58]/30 accent-[#1E2F58]"
        />
        <label
          htmlFor="v2-consent"
          className="text-[12px] text-[#1E2F58]/65 leading-relaxed cursor-pointer"
          style={{ fontFamily: "DM Sans, sans-serif" }}
        >
          I agree that {firmName ? firmName : "this firm"} and CaseLoad Select may use my contact details to follow up on this inquiry and send related communications. Marketing messages will include an unsubscribe option. This is not legal advice and submitting does not create a lawyer-client relationship.{" "}
          <a
            href={privacyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-[#1E2F58] transition-colors"
          >
            Privacy Policy
          </a>
        </label>
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!valid || loading}
        className={[
          "w-full min-h-[52px] rounded-full text-[15px] font-semibold transition-all",
          valid && !loading
            ? "bg-[#1E2F58] text-white hover:shadow-[0_4px_14px_rgba(30,47,88,0.25)]"
            : "bg-[#1E2F58]/15 text-[#1E2F58]/40 cursor-not-allowed",
        ].join(" ")}
        style={{ fontFamily: "DM Sans, sans-serif" }}
      >
        {loading ? "Sending code..." : "Send my code"}
      </button>
    </div>
  );
}

interface InputProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type: "text" | "email" | "tel";
  autoComplete: string;
}

function Input({ id, label, value, onChange, type, autoComplete }: InputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-[#1E2F58]/70 px-1" style={{ fontFamily: "DM Sans, sans-serif" }}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={[
          "w-full px-4 py-3.5 rounded-xl text-[16px] bg-white border transition-all",
          focused ? "border-[#1E2F58] shadow-[0_2px_10px_rgba(30,47,88,0.08)]" : "border-[#1E2F58]/15",
          "text-[#1E2F58] placeholder:text-[#1E2F58]/35 focus:outline-none",
        ].join(" ")}
        style={{ fontFamily: "DM Sans, sans-serif" }}
      />
    </div>
  );
}
