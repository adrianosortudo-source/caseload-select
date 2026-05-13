/**
 * Layout scoped to /firm-onboarding/*
 *
 * Loads the three brand-book fonts (Oxanium for labels and the logo word
 * "CaseLoad Select", Manrope for headings, DM Sans for body) and exposes
 * them as CSS variables so child components can reference them via
 * var(--font-oxanium) etc. Scoping the font load to this route subtree
 * keeps the rest of the app (which uses Tailwind defaults) untouched.
 *
 * Per Brand Book ACTS V1:
 *   --font-display: Oxanium (logos, labels, taglines)
 *   --font-heading: Manrope 700-800 (h1, h2, h3)
 *   --font-body:    DM Sans 300-600 (body)
 */

import { Oxanium, Manrope, DM_Sans, Caveat } from "next/font/google";

const oxanium = Oxanium({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-oxanium",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-dm-sans",
  display: "swap",
});

// Caveat — cursive font used by the typed signature input at the bottom of
// the form. Aesthetic only; the signed_name value is plain text.
const caveat = Caveat({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-caveat",
  display: "swap",
});

export default function FirmOnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${oxanium.variable} ${manrope.variable} ${dmSans.variable} ${caveat.variable}`}
      style={{ fontFamily: "var(--font-dm-sans), system-ui, sans-serif" }}
    >
      {children}
    </div>
  );
}
