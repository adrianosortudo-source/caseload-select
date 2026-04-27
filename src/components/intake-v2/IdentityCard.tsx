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
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s()+\-.]{7,}$/;

export function IdentityCard({ initialName = "", initialEmail = "", initialPhone = "", onSubmit, loading }: Props) {
  const [name, setName]   = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState(initialPhone);

  const valid = name.trim().length >= 2 && EMAIL_RE.test(email.trim()) && PHONE_RE.test(phone.trim());

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
          Your lawyer will see this case file and reach out within hours. We will text a quick code to confirm your number.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Input id="v2-name"  label="Full name"     value={name}  onChange={setName}  type="text"  autoComplete="name" />
        <Input id="v2-email" label="Email"         value={email} onChange={setEmail} type="email" autoComplete="email" />
        <Input id="v2-phone" label="Phone number"  value={phone} onChange={setPhone} type="tel"   autoComplete="tel" />
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
