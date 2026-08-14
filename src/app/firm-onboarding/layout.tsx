/**
 * Layout scoped to /firm-onboarding/*.
 *
 * Oxanium and Manrope use repository-owned variable-font files. DM Sans and
 * Caveat are lockfile-pinned packages loaded by the root layout. Every face is
 * therefore available without a build-time request to Google Fonts.
 */

import localFont from "next/font/local";

const oxanium = localFont({
  src: "../../../public/fonts/Oxanium-VF.ttf",
  weight: "200 800",
  variable: "--font-oxanium",
  display: "swap",
});

const manrope = localFont({
  src: "../../../public/fonts/Manrope-VF.ttf",
  weight: "200 800",
  variable: "--font-manrope",
  display: "swap",
});

export default function FirmOnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${oxanium.variable} ${manrope.variable}`}
      style={{ fontFamily: "var(--font-dm-sans), system-ui, sans-serif" }}
    >
      {children}
    </div>
  );
}
