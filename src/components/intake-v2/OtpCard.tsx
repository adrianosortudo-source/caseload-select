"use client";

/**
 * OtpCard — 6-digit code input.
 *
 * Single input that auto-formats to digits, confirms when 6 digits are entered,
 * and offers a resend option. The parent handles the actual /api/otp/verify
 * call and the resend via /api/otp/send.
 */

import { useEffect, useRef, useState } from "react";

interface Props {
  /** Email or phone the code was sent to (for display). */
  destination: string;
  /** Verify handler. Receives the 6-digit code. */
  onVerify: (code: string) => void;
  /** Resend handler. */
  onResend: () => void;
  /** Loading state from parent. */
  loading?: boolean;
  /** Error message from parent (e.g. "Code didn't match"). */
  errorMessage?: string;
}

export function OtpCard({ destination, onVerify, onResend, loading, errorMessage }: Props) {
  const [code, setCode] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  function handleInput(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6 && !loading) {
      onVerify(digits);
    }
  }

  function handleResend() {
    if (resendCooldown > 0 || loading) return;
    onResend();
    setResendCooldown(30);
  }

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2.5">
        <h2 className="text-[26px] sm:text-[30px] leading-tight font-extrabold text-[#1E2F58]" style={{ fontFamily: "Manrope, sans-serif" }}>
          Check for your code.
        </h2>
        <p className="text-[15px] text-[#1E2F58]/65 leading-relaxed" style={{ fontFamily: "DM Sans, sans-serif" }}>
          We sent a 6-digit code to <span className="font-semibold text-[#1E2F58]">{destination}</span>. Enter it below to confirm and finish.
        </p>
      </div>

      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={code}
        onChange={e => handleInput(e.target.value)}
        placeholder="000000"
        className={[
          "w-full text-center text-[32px] tracking-[0.4em] font-bold py-4 rounded-xl",
          "bg-white border transition-all",
          errorMessage ? "border-red-400" : "border-[#1E2F58]/15 focus:border-[#1E2F58]",
          "text-[#1E2F58] placeholder:text-[#1E2F58]/25 focus:outline-none",
          "shadow-[0_2px_10px_rgba(30,47,88,0.06)]",
        ].join(" ")}
        style={{ fontFamily: "DM Sans, sans-serif" }}
      />

      {errorMessage && (
        <p className="text-[14px] text-red-600 -mt-3" style={{ fontFamily: "DM Sans, sans-serif" }}>
          {errorMessage}
        </p>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleResend}
          disabled={resendCooldown > 0 || loading}
          className="text-[14px] font-medium text-[#1E2F58] hover:text-[#1E2F58]/80 disabled:text-[#1E2F58]/40 disabled:cursor-not-allowed"
          style={{ fontFamily: "DM Sans, sans-serif" }}
        >
          {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
        </button>

        {loading && (
          <span className="text-[14px] text-[#1E2F58]/55" style={{ fontFamily: "DM Sans, sans-serif" }}>
            Verifying...
          </span>
        )}
      </div>
    </div>
  );
}
